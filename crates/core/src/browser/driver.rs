//! index.mjs driver: `scopedIgnoreActive`, `collectBrowserFindings`, the
//! design-system checks, `serializeFindings`, `generateSelector`. See
//! browser/mod.rs. (Pipeline-proof skeleton; the full port replaces the body
//! of `collect_browser_findings`.)

#![allow(unused_imports)]
use super::dom::{tag_lower, Dom, ElId, Rect};
use super::element_checks::check_element_borders_dom;
use super::{BrowserConfig, BrowserFinding, DisabledValue, FindingGroup};
use crate::js_ext_a::JsMap;
use serde::Serialize;

/// The collect result type is shared.
pub use impeccable_foundation::browser::CollectResult;

/// JS: checks.mjs#scopedIgnoreActive(el, ruleId)
pub fn scoped_ignore_active(dom: &dyn Dom, el: ElId, rule_id: &str) -> bool {
    let rule = crate::js::to_lower_case(rule_id);
    // Handle 0 is JS null (a missing document.body): the walk never runs.
    let mut cur = if el == 0 { None } else { Some(el) };
    while let Some(c) = cur {
        if let Some(attr) = dom.attr(c, "data-impeccable-ignore") {
            let lowered = crate::js::to_lower_case(crate::js::trim(&attr));
            let rules: Vec<&str> = SPLIT_RE
                .split(&lowered)
                .filter(|s| !s.is_empty())
                .collect();
            if rules.is_empty() || rules.contains(&"*") || rules.contains(&rule.as_str()) {
                return true;
            }
        }
        cur = dom.parent(c);
    }
    false
}

static SPLIT_RE: once_cell::sync::Lazy<regex::Regex> = once_cell::sync::Lazy::new(|| {
    regex::Regex::new(&format!("[{},]+", crate::js::WS_CHARS)).expect("SPLIT_RE")
});

/// Group-map insertion (`addBrowserFindings`): scoped-ignore filter, then
/// append to the element's list or start one.
pub fn add_browser_findings(
    dom: &dyn Dom,
    groups: &mut Vec<FindingGroup>,
    el: ElId,
    findings: Vec<BrowserFinding>,
) {
    if findings.is_empty() {
        return;
    }
    let kept: Vec<BrowserFinding> = findings
        .into_iter()
        .filter(|f| !scoped_ignore_active(dom, el, &f.type_))
        .collect();
    if kept.is_empty() {
        return;
    }
    if let Some(g) = groups.iter_mut().find(|g| g.el == el) {
        g.findings.extend(kept);
    } else {
        groups.push(FindingGroup { el, findings: kept });
    }
}

// ─── Design system (index.mjs) ──────────────────────────────────────────────

/// The `seen` sets `collectBrowserFindings` threads through the element loop
/// (JS `designSeen = { fonts: new Set(), colors: new Set(), radii: new Set() }`).
#[derive(Debug, Default)]
pub struct DesignSeen {
    pub fonts: Vec<String>,
    pub colors: Vec<String>,
    pub radii: Vec<String>,
}

/// JS: index.mjs#browserDesignSystemConfig() — parsed once per collect;
/// `None` when `!raw?.present`.
#[derive(Debug, Clone, Default)]
pub struct DesignSystemConfig {
    pub has_fonts: bool,
    pub allowed_fonts: Vec<String>,
    pub has_colors: bool,
    pub allowed_colors: Vec<crate::color::Rgba>,
    pub has_radii: bool,
    pub allowed_radii: Vec<f64>,
    pub has_pill_radius: bool,
}

const DESIGN_COLOR_TOLERANCE: f64 = 6.0;
const DESIGN_RADIUS_TOLERANCE_PX: f64 = 0.5;
const DESIGN_SKIP_TAGS: &[&str] = &[
    "head", "title", "meta", "link", "style", "script", "noscript", "template", "source",
];

static WS_RE: once_cell::sync::Lazy<regex::Regex> = once_cell::sync::Lazy::new(|| {
    regex::Regex::new(&format!("{}+", crate::js::WS)).expect("WS_RE")
});
static VAR_RE: once_cell::sync::Lazy<regex::Regex> =
    once_cell::sync::Lazy::new(|| regex::Regex::new(&format!("{}\\(", crate::js::ci("var"))).expect("VAR_RE"));
static SLASH_RE: once_cell::sync::Lazy<regex::Regex> = once_cell::sync::Lazy::new(|| {
    regex::Regex::new(&format!("{ws}*/{ws}*", ws = crate::js::WS)).expect("SLASH_RE")
});

/// JS `String(value || '')` for a JSON value.
fn js_string_or_empty(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Number(n) => {
            let f = n.as_f64().unwrap_or(f64::NAN);
            if f == 0.0 || f.is_nan() {
                String::new()
            } else {
                crate::js::number_to_string(f)
            }
        }
        serde_json::Value::Bool(true) => "true".to_string(),
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => v.to_string(),
        _ => String::new(),
    }
}

/// JS `Number(value)` for a JSON value.
fn js_number(v: &serde_json::Value) -> f64 {
    match v {
        serde_json::Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        serde_json::Value::String(s) => crate::js::string_to_number(s),
        serde_json::Value::Bool(b) => {
            if *b {
                1.0
            } else {
                0.0
            }
        }
        serde_json::Value::Null => 0.0,
        serde_json::Value::Array(a) => {
            if a.is_empty() {
                0.0
            } else if a.len() == 1 {
                js_number(&a[0])
            } else {
                f64::NAN
            }
        }
        serde_json::Value::Object(_) => f64::NAN,
    }
}

/// JS truthiness of a JSON value.
fn truthy(v: &serde_json::Value) -> bool {
    match v {
        serde_json::Value::Null => false,
        serde_json::Value::Bool(b) => *b,
        serde_json::Value::Number(n) => n.as_f64().map(|f| f != 0.0 && !f.is_nan()).unwrap_or(false),
        serde_json::Value::String(s) => !s.is_empty(),
        _ => true,
    }
}

/// JS: index.mjs#normalizeBrowserFontName(value)
pub fn normalize_browser_font_name(value: &str) -> String {
    let t = crate::js::trim(value);
    // `.replace(/^["']|["']$/g, '')`: one leading and one trailing quote.
    let t = t.strip_prefix(['"', '\'']).unwrap_or(t);
    let t = t.strip_suffix(['"', '\'']).unwrap_or(t);
    let t = t.replace('+', " ");
    let t = WS_RE.replace_all(&t, " ");
    crate::js::to_lower_case(&t)
}

/// JS: index.mjs#browserPrimaryFont(stack)
pub fn browser_primary_font(stack: &str) -> String {
    if stack.is_empty() || VAR_RE.is_match(stack) {
        return String::new();
    }
    stack
        .split(',')
        .map(normalize_browser_font_name)
        .find(|font| !font.is_empty() && !crate::constants::GENERIC_FONTS.contains(&font.as_str()))
        .unwrap_or_default()
}

/// JS: index.mjs#browserDesignSystemConfig()
pub fn browser_design_system_config(config: &BrowserConfig) -> Option<DesignSystemConfig> {
    let raw = config.design_system.as_ref()?;
    let obj = raw.as_object()?;
    // JS `!raw?.present`.
    if !obj.get("present").map_or(false, truthy) {
        return None;
    }
    let arr = |k: &str| -> Vec<serde_json::Value> {
        obj.get(k).and_then(|v| v.as_array()).cloned().unwrap_or_default()
    };
    let mut allowed_fonts: Vec<String> = Vec::new();
    for v in arr("allowedFonts") {
        let f = normalize_browser_font_name(&js_string_or_empty(&v));
        if !f.is_empty() && !allowed_fonts.contains(&f) {
            allowed_fonts.push(f);
        }
    }
    let allowed_colors: Vec<crate::color::Rgba> = arr("allowedColors")
        .iter()
        .filter_map(|c| {
            let o = c.as_object()?;
            let r = o.get("r").and_then(|v| v.as_f64())?;
            let g = o.get("g").and_then(|v| v.as_f64())?;
            let b = o.get("b").and_then(|v| v.as_f64())?;
            if r.is_finite() && g.is_finite() && b.is_finite() {
                Some(crate::color::Rgba { r, g, b, a: None })
            } else {
                None
            }
        })
        .collect();
    let allowed_radii: Vec<f64> = arr("allowedRadii")
        .iter()
        .map(js_number)
        .filter(|px| px.is_finite())
        .collect();
    let is_true = |k: &str| matches!(obj.get(k), Some(serde_json::Value::Bool(true)));
    Some(DesignSystemConfig {
        has_fonts: is_true("hasFonts") && !allowed_fonts.is_empty(),
        allowed_fonts,
        has_colors: is_true("hasColors") && !allowed_colors.is_empty(),
        allowed_colors,
        has_radii: is_true("hasRadii") && !allowed_radii.is_empty(),
        allowed_radii,
        has_pill_radius: is_true("hasPillRadius"),
    })
}

/// JS: index.mjs#browserColorsClose(a, b)
pub fn browser_colors_close(a: &crate::color::Rgba, b: &crate::color::Rgba) -> bool {
    crate::js::math_max3((a.r - b.r).abs(), (a.g - b.g).abs(), (a.b - b.b).abs())
        <= DESIGN_COLOR_TOLERANCE
}

/// JS: index.mjs#isBrowserDesignColorAllowed(raw, designSystem)
pub fn is_browser_design_color_allowed(raw: &str, ds: Option<&DesignSystemConfig>) -> bool {
    let Some(ds) = ds else { return true };
    if !ds.has_colors {
        return true;
    }
    let text = crate::js::to_lower_case(crate::js::trim(raw));
    if text.is_empty()
        || text == "transparent"
        || text == "currentcolor"
        || text == "inherit"
        || text == "initial"
    {
        return true;
    }
    if text.contains("var(") {
        return true;
    }
    let Some(parsed) = crate::color::parse_any_color(Some(&text)) else {
        return true;
    };
    if parsed.alpha_or_one() <= 0.05 {
        return true;
    }
    ds.allowed_colors
        .iter()
        .any(|c| browser_colors_close(&parsed, c))
}

/// JS: index.mjs#isBrowserTransparentCss(value)
pub fn is_browser_transparent_css(value: &str) -> bool {
    let text = crate::js::to_lower_case(crate::js::trim(value));
    if text.is_empty() || text == "transparent" {
        return true;
    }
    match crate::color::parse_any_color(Some(&text)) {
        Some(c) => c.alpha_or_one() <= 0.05,
        None => false,
    }
}

/// JS: index.mjs#isBrowserDesignRadiusAllowed(raw, designSystem)
pub fn is_browser_design_radius_allowed(raw: &str, ds: Option<&DesignSystemConfig>) -> bool {
    let Some(ds) = ds else { return true };
    if !ds.has_radii {
        return true;
    }
    let text = crate::js::to_lower_case(crate::js::trim(raw));
    if text.is_empty() || text == "0" || text == "none" || text == "initial" || text == "inherit" {
        return true;
    }
    if text.contains("var(") || text.contains('%') {
        return true;
    }
    let Some(px) = crate::checks::measures::resolve_length_px(Some(&text), 16.0) else {
        return true;
    };
    if !px.is_finite() || px <= DESIGN_RADIUS_TOLERANCE_PX {
        return true;
    }
    if ds.has_pill_radius && px >= 99.0 {
        return true;
    }
    ds.allowed_radii
        .iter()
        .any(|allowed| (allowed - px).abs() <= DESIGN_RADIUS_TOLERANCE_PX)
}

/// JS: index.mjs#browserRadiusTokens(value)
pub fn browser_radius_tokens(value: &str) -> Vec<String> {
    let v = SLASH_RE.replace_all(value, " ");
    WS_RE
        .split(&v)
        .map(|t| crate::js::trim(t).to_string())
        .filter(|t| !t.is_empty())
        .collect()
}

/// JS: index.mjs#browserHasDirectText(el)
pub fn browser_has_direct_text(dom: &dyn Dom, el: ElId) -> bool {
    dom.direct_text_nodes(el)
        .iter()
        .any(|t| !crate::js::trim(t).is_empty())
}

/// JS: index.mjs#browserSampleText(el)
pub fn browser_sample_text(dom: &dyn Dom, el: ElId) -> String {
    let raw = dom.text_content(el);
    let text = WS_RE.replace_all(&raw, " ");
    let text = crate::js::trim(&text);
    if text.is_empty() {
        String::new()
    } else {
        format!(" \"{}\"", crate::js_ext_b::slice_utf16_prefix(text, 40))
    }
}

/// JS: index.mjs#shouldSkipDesignElement(el)
pub fn should_skip_design_element(dom: &dyn Dom, el: ElId) -> bool {
    let tag = tag_lower(dom, el);
    DESIGN_SKIP_TAGS.contains(&tag.as_str()) || is_element_hidden(dom, el)
}

/// JS: index.mjs#checkElementDesignSystemDOM(el, designSystem, seen)
pub fn check_element_design_system_dom(
    dom: &dyn Dom,
    el: ElId,
    ds: Option<&DesignSystemConfig>,
    seen: &mut DesignSeen,
) -> Vec<BrowserFinding> {
    let Some(ds) = ds else { return Vec::new() };
    if should_skip_design_element(dom, el) {
        return Vec::new();
    }
    let mut findings = Vec::new();
    let tag = {
        let t = tag_lower(dom, el);
        if t.is_empty() {
            "unknown".to_string()
        } else {
            t
        }
    };
    let ignore = |type_: &str, detail: String, value: String| BrowserFinding {
        type_: type_.to_string(),
        detail,
        severity: None,
        ignore_value: Some(value),
    };

    if ds.has_fonts && browser_has_direct_text(dom, el) {
        let font = browser_primary_font(&dom.style(el, "fontFamily"));
        if !font.is_empty() && !ds.allowed_fonts.contains(&font) && !seen.fonts.contains(&font) {
            seen.fonts.push(font.clone());
            findings.push(ignore(
                "design-system-font",
                format!(
                    "{}{} uses {}; not declared in DESIGN.md typography",
                    tag,
                    browser_sample_text(dom, el),
                    font
                ),
                font,
            ));
        }
    }

    if ds.has_colors {
        let mut color_checks: Vec<(String, String)> = Vec::new();
        if browser_has_direct_text(dom, el) {
            color_checks.push(("text color".to_string(), dom.style(el, "color")));
        }
        let bg = dom.style(el, "backgroundColor");
        if !is_browser_transparent_css(&bg) {
            color_checks.push(("background".to_string(), bg));
        }
        for side in ["Top", "Right", "Bottom", "Left"] {
            if super::dom::style_px(dom, el, &format!("border{side}Width")) > 0.0 {
                color_checks.push((
                    format!("border-{}", crate::js::to_lower_case(side)),
                    dom.style(el, &format!("border{side}Color")),
                ));
            }
        }
        if super::dom::style_px(dom, el, "outlineWidth") > 0.0 {
            color_checks.push(("outline".to_string(), dom.style(el, "outlineColor")));
        }
        for (kind, raw) in color_checks {
            let label = WS_RE.replace_all(crate::js::trim(&raw), " ").into_owned();
            if is_browser_design_color_allowed(&label, Some(ds)) {
                continue;
            }
            let key = format!("{kind}:{label}");
            if seen.colors.contains(&key) {
                continue;
            }
            seen.colors.push(key);
            findings.push(ignore(
                "design-system-color",
                format!(
                    "{} {} on {}{} is outside DESIGN.md colors",
                    kind,
                    label,
                    tag,
                    browser_sample_text(dom, el)
                ),
                label,
            ));
        }
    }

    if ds.has_radii {
        for token in browser_radius_tokens(&dom.style(el, "borderRadius")) {
            if is_browser_design_radius_allowed(&token, Some(ds)) {
                continue;
            }
            if seen.radii.contains(&token) {
                continue;
            }
            seen.radii.push(token.clone());
            findings.push(ignore(
                "design-system-radius",
                format!(
                    "border-radius {} on {}{} is outside the DESIGN.md rounded scale",
                    token,
                    tag,
                    browser_sample_text(dom, el)
                ),
                token,
            ));
        }
    }

    findings
}

/// JS `decodeURIComponent(s)`: `None` where it throws (malformed escape,
/// invalid UTF-8).
pub fn decode_uri_component(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len() {
                return None;
            }
            let h = (bytes[i + 1] as char).to_digit(16)?;
            let l = (bytes[i + 2] as char).to_digit(16)?;
            out.push((h * 16 + l) as u8);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// JS: index.mjs#decodeBrowserGoogleFamily(value)
pub fn decode_browser_google_family(value: &str) -> String {
    let family = value.split(':').next().unwrap_or("").replace('+', " ");
    decode_uri_component(&family).unwrap_or(family)
}

static GOOGLE_FAMILY_RE: once_cell::sync::Lazy<regex::Regex> = once_cell::sync::Lazy::new(|| {
    regex::Regex::new(r"[?&]family=([^&]+)").expect("GOOGLE_FAMILY_RE")
});

/// JS: index.mjs#checkBrowserDesignSystemSources(designSystem, seen)
pub fn check_browser_design_system_sources(
    dom: &dyn Dom,
    ds: Option<&DesignSystemConfig>,
    seen: &mut DesignSeen,
) -> Vec<BrowserFinding> {
    let Some(ds) = ds else { return Vec::new() };
    if !ds.has_fonts {
        return Vec::new();
    }
    let mut findings = Vec::new();
    for link in dom
        .query_all(None, "link[href*=\"fonts.googleapis.com/css\"]")
        .unwrap_or_default()
    {
        let href = dom.attr(link, "href").unwrap_or_default();
        for m in GOOGLE_FAMILY_RE.captures_iter(&href) {
            let display = decode_browser_google_family(&m[1]);
            let font = normalize_browser_font_name(&display);
            if font.is_empty() || ds.allowed_fonts.contains(&font) || seen.fonts.contains(&font) {
                continue;
            }
            seen.fonts.push(font);
            findings.push(BrowserFinding {
                type_: "design-system-font".to_string(),
                detail: format!(
                    "Google Fonts: {} is not declared in DESIGN.md typography",
                    display
                ),
                severity: None,
                ignore_value: Some(display),
            });
        }
    }
    findings
}

// ─── Regex-on-HTML pass ─────────────────────────────────────────────────────

static PSEUDO_SEGMENT_RE: once_cell::sync::Lazy<regex::Regex> = once_cell::sync::Lazy::new(|| {
    regex::Regex::new(r"::?[a-zA-Z-]+(\([^)]*\))?").expect("PSEUDO_SEGMENT_RE")
});
static ONLY_COMMAS_WS_RE: once_cell::sync::Lazy<regex::Regex> = once_cell::sync::Lazy::new(|| {
    regex::Regex::new(&format!("^[,{}]*$", crate::js::WS_CHARS)).expect("ONLY_COMMAS_WS_RE")
});

/// JS `s.replace(/,\s*(?=,|$)/g, '')`: drop a comma (and the whitespace
/// after it) that is followed by another comma or the end.
fn drop_dangling_commas(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == ',' {
            let mut j = i + 1;
            while j < chars.len() && crate::js::is_js_whitespace(chars[j]) {
                j += 1;
            }
            if j >= chars.len() || chars[j] == ',' {
                i = j;
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

/// The live-DOM scope of a CSS-text finding's selector: pseudo segments
/// stripped, dangling commas removed. `None` when nothing queryable is left
/// (the finding stays page-level).
///
/// Superseded by [`pseudo_element_host_selector`] for the driver's own
/// filter (#709); kept because the static engine still spells the scope this
/// way.
pub fn html_pattern_query(selector: &str) -> Option<String> {
    let stripped = PSEUDO_SEGMENT_RE.replace_all(selector, "");
    let query = drop_dangling_commas(crate::js::trim(&stripped));
    if query.is_empty() || ONLY_COMMAS_WS_RE.is_match(&query) {
        return None;
    }
    Some(query)
}

fn is_selector_name_char(c: Option<char>) -> bool {
    matches!(c, Some(c) if c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// JS: injected/index.mjs#pseudoElementHostSelector
///
/// Rewrites a selector so its pseudo-elements resolve to the live element
/// that originates them: `.card::before` to `.card`, and a hostless
/// `main > ::before` to `main > *`. `None` when the selector carries no
/// pseudo-element at all, which is the caller's signal that the full
/// selector is queryable as written.
///
/// JS-PARITY: the JS indexes UTF-16 code units; this walks chars, which
/// differs only for an astral character inside a selector literal.
pub fn pseudo_element_host_selector(selector: &str) -> Option<String> {
    const LEGACY_NAMES: &[&str] = &["before", "after", "first-letter", "first-line"];
    let raw: Vec<char> = selector.chars().collect();
    let consume_function = |start: usize| -> usize {
        let mut depth: i32 = 0;
        let mut quote: Option<char> = None;
        let mut i = start;
        while i < raw.len() {
            let ch = raw[i];
            if ch == '\\' {
                i += 2;
                continue;
            }
            if let Some(q) = quote {
                if ch == q {
                    quote = None;
                }
                i += 1;
                continue;
            }
            if ch == '"' || ch == '\'' {
                quote = Some(ch);
                i += 1;
                continue;
            }
            if ch == '(' {
                depth += 1;
            }
            if ch == ')' {
                depth -= 1;
                if depth == 0 {
                    return i + 1;
                }
            }
            i += 1;
        }
        raw.len()
    };

    let mut output = String::new();
    let mut found = false;
    let mut i = 0usize;
    while i < raw.len() {
        let ch = raw[i];
        if ch == '\\' {
            let end = raw.len().min(i + 2);
            output.extend(&raw[i..end]);
            i += 2;
            continue;
        }
        if ch == '"' || ch == '\'' {
            let quote = ch;
            let start = i;
            i += 1;
            while i < raw.len() {
                if raw[i] == '\\' {
                    i += 2;
                    continue;
                }
                let value = raw[i];
                i += 1;
                if value == quote {
                    break;
                }
            }
            output.extend(&raw[start..raw.len().min(i)]);
            continue;
        }
        if ch != ':' {
            output.push(ch);
            i += 1;
            continue;
        }

        let mut end = i + 1;
        let is_pseudo_element;
        if raw.get(end) == Some(&':') {
            end += 1;
            let name_start = end;
            while is_selector_name_char(raw.get(end).copied()) {
                end += 1;
            }
            is_pseudo_element = end > name_start;
        } else {
            let name_start = end;
            while is_selector_name_char(raw.get(end).copied()) {
                end += 1;
            }
            let name: String = raw[name_start..end].iter().collect();
            is_pseudo_element = LEGACY_NAMES.contains(&crate::js::to_lower_case(&name).as_str());
        }
        if !is_pseudo_element {
            output.push(ch);
            i += 1;
            continue;
        }
        if raw.get(end) == Some(&'(') {
            end = consume_function(end);
        }
        found = true;
        let last = output.chars().last();
        if last.is_none()
            || matches!(last, Some(c) if crate::js::is_js_whitespace(c)
                || c == '>' || c == '+' || c == '~' || c == ',')
        {
            output.push('*');
        }
        i = end;
    }
    if !found {
        return None;
    }
    Some(drop_dangling_commas(crate::js::trim(&output)))
}

/// JS: injected/index.mjs#selectorNodesForLiveDom
///
/// `None` means "unresolvable": the DOM API refused the selector, or the
/// pseudo-element rewrite left nothing queryable. An empty vector from a
/// selector the DOM did accept is authoritative, so an inactive
/// `:hover` / `:focus` / `:not()` rule is never broadened to its host.
pub fn selector_nodes_for_live_dom(dom: &dyn Dom, selector: &str) -> Option<Vec<ElId>> {
    let raw = crate::js::trim(selector);
    if raw.is_empty() {
        return None;
    }
    let Some(fallback) = pseudo_element_host_selector(raw) else {
        return dom.query_all(None, raw).ok();
    };
    if fallback.is_empty() || ONLY_COMMAS_WS_RE.is_match(&fallback) {
        return None;
    }
    dom.query_all(None, &fallback).ok()
}

/// The regex-on-HTML pass of collectBrowserFindings: `checkHtmlPatterns` on
/// the live document's HTML, selector-scoped filtering against the live DOM
/// (a selector matching nothing drops the finding; a match under a
/// data-impeccable-ignore ancestor is waived), and the mapping with the
/// pulsing-dot hero promotion. Returns `{ type, detail, severity? }`; the
/// caller applies `_ruleOk`.
pub fn scoped_html_pattern_findings(dom: &dyn Dom) -> Vec<BrowserFinding> {
    let html = dom.document_html_for_patterns();
    // Linked stylesheets are absent from the page's outerHTML, so the probe
    // hands their readable, live-resolving rules to the style corpus (#709).
    let mut corpora = crate::checks::html_patterns::build_html_pattern_corpora(&html);
    let linked_css = dom.linked_stylesheet_text();
    if !linked_css.is_empty() {
        corpora.style_text.push('\n');
        corpora.style_text.push_str(&linked_css);
    }
    let all = crate::checks::html_patterns::check_html_patterns(&html, Some(&corpora));
    let mut out = Vec::new();
    for f in all {
        if let Some(selector) = f.selector.as_deref().filter(|s| !s.is_empty()) {
            let Some(matches) = selector_nodes_for_live_dom(dom, selector) else {
                continue;
            };
            if matches.is_empty() {
                continue;
            }
            if !matches.iter().any(|el| !scoped_ignore_active(dom, *el, &f.id)) {
                continue;
            }
        }
        let mut item = BrowserFinding::new(f.id.clone(), f.snippet.clone());
        if let Some(sev) = f.severity.as_ref().filter(|s| !s.is_empty()) {
            item.severity = Some(sev.clone());
        } else if f.id == "pulsing-dot" {
            if let Some(selector) = f.selector.as_deref().filter(|s| !s.is_empty()) {
                if let Ok(Some(dot)) = dom.query_one(None, selector) {
                    let rect = dom.rect(dot);
                    let page_top = rect.top + dom.scroll_y();
                    if page_top <= 900.0 {
                        item.severity = Some("error".to_string());
                    }
                }
            }
        }
        out.push(item);
    }
    out
}

/// JS: index.mjs#serializeFindings(allFindings)
pub fn serialize_findings(dom: &dyn Dom, groups: &[FindingGroup]) -> serde_json::Value {
    use crate::registry::get_antipattern;
    use serde_json::{json, Map, Value};
    let body = dom.body();
    let root = dom.document_element();
    let mut out = Vec::with_capacity(groups.len());
    for g in groups {
        let el = g.el;
        let is_page_level = Some(el) == body || Some(el) == root;
        // JS `el.tagName?.toLowerCase() || 'unknown'`; a null body key has no
        // tagName.
        let tag_name = if el == 0 {
            "unknown".to_string()
        } else {
            let t = tag_lower(dom, el);
            if t.is_empty() {
                "unknown".to_string()
            } else {
                t
            }
        };
        let rect: Value = if el != 0 && !is_page_level {
            let r = dom.rect(el);
            json!({
                "x": r.x, "y": r.y, "width": r.width, "height": r.height,
                "top": r.top, "right": r.right, "bottom": r.bottom, "left": r.left,
            })
        } else {
            Value::Null
        };
        let findings: Vec<Value> = g
            .findings
            .iter()
            .map(|f| {
                let ap = get_antipattern(&f.type_);
                let severity = match (&f.severity, ap) {
                    (Some(s), _) if !s.is_empty() => s.clone(),
                    (_, Some(ap)) => ap.severity.unwrap_or("warning").to_string(),
                    _ => "warning".to_string(),
                };
                let mut m = Map::new();
                m.insert("type".into(), Value::String(f.type_.clone()));
                m.insert(
                    "category".into(),
                    Value::String(ap.map(|a| a.category).unwrap_or("quality").to_string()),
                );
                // Per-finding promotions override the registry default, so
                // derive the advisory flag strictly from the effective
                // severity (#709).
                let advisory = severity == "advisory";
                m.insert("severity".into(), Value::String(severity));
                m.insert("advisory".into(), Value::Bool(advisory));
                m.insert("detail".into(), Value::String(f.detail.clone()));
                m.insert(
                    "ignoreValue".into(),
                    Value::String(f.ignore_value.clone().unwrap_or_default()),
                );
                m.insert(
                    "name".into(),
                    Value::String(ap.map(|a| a.name.to_string()).unwrap_or_else(|| f.type_.clone())),
                );
                m.insert(
                    "description".into(),
                    Value::String(ap.map(|a| a.description).unwrap_or("").to_string()),
                );
                Value::Object(m)
            })
            .collect();
        let mut m = Map::new();
        m.insert(
            "selector".into(),
            Value::String(if el == 0 { "body".into() } else { generate_selector(dom, el) }),
        );
        m.insert("tagName".into(), Value::String(tag_name));
        m.insert("rect".into(), rect);
        m.insert("isPageLevel".into(), Value::Bool(is_page_level));
        m.insert("isHidden".into(), Value::Bool(if el == 0 { false } else { is_element_hidden(dom, el) }));
        m.insert("findings".into(), Value::Array(findings));
        out.push(Value::Object(m));
    }
    Value::Array(out)
}

// JS `/^(css|sc|emotion|jsx|module)-[\w-]{4,}$/i`, `/^_[\w-]{5,}$/`,
// `/^[a-z0-9]{6,}$/i` (JS `\w` is ASCII; the `i` flag folds ASCII only).
static HASHED_1: once_cell::sync::Lazy<regex::Regex> = once_cell::sync::Lazy::new(|| {
    regex::Regex::new(&format!(
        "^({}|{}|{}|{}|{})-[A-Za-z0-9_-]{{4,}}$",
        crate::js::ci("css"),
        crate::js::ci("sc"),
        crate::js::ci("emotion"),
        crate::js::ci("jsx"),
        crate::js::ci("module")
    ))
    .expect("HASHED_1")
});
static HASHED_2: once_cell::sync::Lazy<regex::Regex> =
    once_cell::sync::Lazy::new(|| regex::Regex::new(r"^_[A-Za-z0-9_-]{5,}$").expect("HASHED_2"));
static HASHED_3: once_cell::sync::Lazy<regex::Regex> =
    once_cell::sync::Lazy::new(|| regex::Regex::new(r"^[a-zA-Z0-9]{6,}$").expect("HASHED_3"));

/// JS: index.mjs#isLikelyHashedClass(c)
pub fn is_likely_hashed_class(c: &str) -> bool {
    if c.is_empty() {
        return true;
    }
    if HASHED_1.is_match(c) {
        return true;
    }
    if HASHED_2.is_match(c) {
        return true;
    }
    if HASHED_3.is_match(c) && c.bytes().any(|b| b.is_ascii_digit()) {
        return true;
    }
    false
}

/// JS `[...el.classList]`: the class attribute split on ASCII whitespace,
/// duplicates removed (DOMTokenList semantics), order preserved.
fn class_list(dom: &dyn Dom, el: ElId) -> Vec<String> {
    let cls = dom.attr(el, "class").unwrap_or_default();
    let mut out: Vec<String> = Vec::new();
    for tok in cls.split(|c: char| matches!(c, ' ' | '\t' | '\n' | '\x0C' | '\r')) {
        if tok.is_empty() || out.iter().any(|t| t == tok) {
            continue;
        }
        out.push(tok.to_string());
    }
    out
}

/// JS: index.mjs#buildSelectorSegment(el)
pub fn build_selector_segment(dom: &dyn Dom, el: ElId) -> String {
    let tag = tag_lower(dom, el);
    let mut sel = tag.clone();
    let classes: Vec<String> = class_list(dom, el)
        .into_iter()
        .filter(|c| !c.starts_with("impeccable-") && !is_likely_hashed_class(c))
        .take(2)
        .collect();
    if !classes.is_empty() {
        sel.push('.');
        sel.push_str(
            &classes
                .iter()
                .map(|c| dom.css_escape(c))
                .collect::<Vec<_>>()
                .join("."),
        );
    }
    if let Some(parent) = dom.parent(el) {
        match dom.query_all(Some(parent), &format!(":scope > {sel}")) {
            Ok(matching) => {
                if matching.len() > 1 {
                    let tag_name = dom.tag_name(el);
                    let same_type: Vec<ElId> = dom
                        .children(parent)
                        .into_iter()
                        .filter(|c| dom.tag_name(*c) == tag_name)
                        .collect();
                    let idx = same_type.iter().position(|c| *c == el).map(|i| i as i64).unwrap_or(-1) + 1;
                    sel.push_str(&format!(":nth-of-type({idx})"));
                }
            }
            Err(_) => {
                let idx = dom
                    .children(parent)
                    .iter()
                    .position(|c| *c == el)
                    .map(|i| i as i64)
                    .unwrap_or(-1)
                    + 1;
                sel = format!("{tag}:nth-child({idx})");
            }
        }
    }
    sel
}

/// JS: index.mjs#generateSelector(el)
pub fn generate_selector(dom: &dyn Dom, el: ElId) -> String {
    let body = dom.body();
    let root = dom.document_element();
    if Some(el) == body {
        return "body".to_string();
    }
    if Some(el) == root {
        return "html".to_string();
    }
    let el_id = super::dom::safe_id(dom, el);
    if !el_id.is_empty() {
        return format!("#{}", dom.css_escape(&el_id));
    }
    let mut parts: Vec<String> = Vec::new();
    let mut current = Some(el);
    let mut depth = 0;
    const MAX_DEPTH: usize = 10;
    while let Some(cur) = current {
        if Some(cur) == body || Some(cur) == root || depth >= MAX_DEPTH {
            break;
        }
        parts.insert(0, build_selector_segment(dom, cur));
        // JS `current.id` (the raw property, truthy check). Where the
        // property is not a string (shadowed by a named control) the object
        // is truthy and CSS.escape stringifies it; that garbage-selector case
        // is exactly issue #407 for the anchor path and is left as the JS
        // does it: id_prop None means the getter returned an element, which
        // is truthy → escape("[object HTMLInputElement]").
        let cur_id = match dom.id_prop(cur) {
            Some(id) => id,
            None => "[object HTMLInputElement]".to_string(),
        };
        if !cur_id.is_empty() {
            parts[0] = format!("#{}", dom.css_escape(&cur_id));
            break;
        }
        let try_selector = parts.join(" > ");
        if let Ok(matches) = dom.query_all(None, &try_selector) {
            if matches.len() == 1 && matches[0] == el {
                return try_selector;
            }
        }
        current = dom.parent(cur);
        depth += 1;
    }
    parts.join(" > ")
}

/// JS: index.mjs#isElementHidden(el)
pub fn is_element_hidden(dom: &dyn Dom, el: ElId) -> bool {
    if Some(el) == dom.body() || Some(el) == dom.document_element() {
        return false;
    }
    if let Some(v) = dom.check_visibility(el) {
        return !v;
    }
    dom.offset_width(el) == 0.0 && dom.offset_height(el) == 0.0
}

/// The `addVisualContrastResult` decision, split so the JS group map (keyed
/// by live Element) can stay a plain map: first resolve the target element
/// (`None` when the result is not a fail / has no finding / selector
/// unresolvable), then produce the finding to add given the element's
/// existing findings (`None` when a same-type finding exists or the scoped
/// ignore waives it).
pub fn visual_contrast_result_el(dom: &dyn Dom, result: &serde_json::Value) -> Option<ElId> {
    if result.get("status").and_then(|v| v.as_str()) != Some("fail") {
        return None;
    }
    if !result.get("finding").map_or(false, truthy) {
        return None;
    }
    let selector = result.get("selector")?;
    if !truthy(selector) {
        return None;
    }
    let sel = js_string_or_empty(selector);
    match dom.query_one(None, &sel) {
        Ok(Some(el)) => Some(el),
        _ => None,
    }
}

/// JS `a || b` over JSON values, stringified.
fn first_truthy_string(values: &[Option<&serde_json::Value>]) -> Option<String> {
    values
        .iter()
        .flatten()
        .find(|v| truthy(v))
        .map(|v| js_string_or_empty(v))
}

pub fn visual_contrast_result_finding(
    dom: &dyn Dom,
    el: ElId,
    existing: &[BrowserFinding],
    result: &serde_json::Value,
) -> Option<BrowserFinding> {
    let finding = result.get("finding")?;
    let finding_type = first_truthy_string(&[finding.get("type"), finding.get("id")])
        .unwrap_or_else(|| "low-contrast".to_string());
    if existing.iter().any(|f| f.type_ == finding_type) {
        return None;
    }
    let detail =
        first_truthy_string(&[finding.get("detail"), finding.get("snippet")]).unwrap_or_default();
    if scoped_ignore_active(dom, el, &finding_type) {
        return None;
    }
    Some(BrowserFinding::new(finding_type, detail))
}

fn hits(v: Vec<crate::checks::rules::RuleHit>) -> Vec<BrowserFinding> {
    v.iter().map(BrowserFinding::from_hit).collect()
}

// ─── value-level suppression (JS: index.mjs#collectBrowserFindings tail) ────
//
// `disabledRules` waives whole rules; this applies the config's remaining
// `ignoreValues` entries, which the CLI filters through
// `isIgnoredFindingValue` (crates/detect config.rs), so a project waiver like
// `overused-font = "geist mono"` reaches the overlay and the extension too.

/// The six rules whose findings carry a matchable value; keep in step with
/// `extract_finding_ignore_value` in crates/detect. Everything else is
/// suppressed by rule or by file scope, both already resolved into
/// `disabledRules` before the scan message was sent.
const DIRECT_VALUE_RULES: &[&str] = &[
    "overused-font",
    "bounce-easing",
    "design-system-font",
    "design-system-color",
    "design-system-radius",
    "design-system-font-size",
];

static EDGE_QUOTE_RE: once_cell::sync::Lazy<regex::Regex> =
    once_cell::sync::Lazy::new(|| regex::Regex::new(r#"^["']|["']$"#).expect("EDGE_QUOTE_RE"));
static WS_RUN_RE: once_cell::sync::Lazy<regex::Regex> = once_cell::sync::Lazy::new(|| {
    regex::Regex::new(&format!("[{}]+", crate::js::WS_CHARS)).expect("WS_RUN_RE")
});
static PRIMARY_FONT_RE: once_cell::sync::Lazy<regex::Regex> =
    once_cell::sync::Lazy::new(|| {
        regex::Regex::new(&format!(
            "(?i:Primary font):[{}]*([^()\n;]+)",
            crate::js::WS_CHARS
        ))
        .expect("PRIMARY_FONT_RE")
    });
static GOOGLE_LABEL_RE: once_cell::sync::Lazy<regex::Regex> =
    once_cell::sync::Lazy::new(|| {
        regex::Regex::new(&format!(
            "(?i:Google Fonts):[{}]*([^()\n;]+)",
            crate::js::WS_CHARS
        ))
        .expect("GOOGLE_LABEL_RE")
    });
static FAMILY_RE: once_cell::sync::Lazy<regex::Regex> = once_cell::sync::Lazy::new(|| {
    regex::Regex::new(&format!(
        r#"(?i:font-family)[{ws}]*:[{ws}]*["']?([^'",;\n]+)"#,
        ws = crate::js::WS_CHARS
    ))
    .expect("FAMILY_RE")
});
static COLOR_HEX_RE: once_cell::sync::Lazy<regex::Regex> = once_cell::sync::Lazy::new(|| {
    regex::Regex::new("^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$").expect("COLOR_HEX_RE")
});
static COLOR_RGB_RE: once_cell::sync::Lazy<regex::Regex> = once_cell::sync::Lazy::new(|| {
    regex::Regex::new(r"^rgba?\(([\s\S]*)\)$").expect("COLOR_RGB_RE")
});
static COLOR_CHANNEL_RE: once_cell::sync::Lazy<regex::Regex> =
    once_cell::sync::Lazy::new(|| {
        regex::Regex::new(r"^(-?\d*\.?\d+)(%)?$").expect("COLOR_CHANNEL_RE")
    });

/// JS `_normValue`: trim, drop one edge quote at each end, `+` to space,
/// collapse whitespace runs, lowercase.
pub fn normalize_browser_ignore_value(value: &str) -> String {
    let t = crate::js::trim(value);
    let t = EDGE_QUOTE_RE.replace_all(t, "");
    let t = t.replace('+', " ");
    let t = WS_RUN_RE.replace_all(&t, " ");
    crate::js::to_lower_case(&t)
}

/// JS `_colorKey`: `design-system-color` compares by color value, not by
/// spelling, because the browser reports computed `rgb(...)` strings while
/// waivers are usually written as hex. Mirrors `colorIgnoreKey` in
/// crates/detect for the hex and `rgb()`/`rgba()` forms; hsl stays CLI-only,
/// as it was in the JS engine.
pub fn browser_color_ignore_key(value: &str) -> String {
    let text = crate::js::to_lower_case(crate::js::trim(value));
    if let Some(m) = COLOR_HEX_RE.captures(&text) {
        let digits = m.get(1).unwrap().as_str();
        let expanded: String = if digits.len() <= 4 {
            digits.chars().flat_map(|c| [c, c]).collect()
        } else {
            digits.to_string()
        };
        let bytes: Vec<u32> = expanded
            .as_bytes()
            .chunks(2)
            .map(|c| u32::from_str_radix(std::str::from_utf8(c).unwrap_or("0"), 16).unwrap_or(0))
            .collect();
        let a = bytes.get(3).copied().unwrap_or(255);
        return format!("{},{},{},{}", bytes[0], bytes[1], bytes[2], a);
    }
    let Some(m) = COLOR_RGB_RE.captures(&text) else {
        return String::new();
    };
    // JS: body.trim().replace(/\s*\/\s*/g, ' / '), then split on ',' with the
    // trailing `a / b` group re-split, or on whitespace when there is no comma.
    let body = crate::js::trim(m.get(1).unwrap().as_str()).to_string();
    let body = slash_spaced(&body);
    let parts: Vec<String> = if body.contains(',') {
        let mut parts: Vec<String> = body
            .split(',')
            .map(|p| crate::js::trim(p).to_string())
            .filter(|p| !p.is_empty())
            .collect();
        if let Some(last) = parts.last().cloned() {
            if last.contains('/') {
                parts.pop();
                parts.extend(
                    last.split('/')
                        .map(|p| crate::js::trim(p).to_string())
                        .filter(|p| !p.is_empty()),
                );
            }
        }
        parts
    } else {
        WS_RUN_RE
            .split(&body)
            .filter(|p| !p.is_empty() && *p != "/")
            .map(|p| p.to_string())
            .collect()
    };
    if parts.len() < 3 || parts.len() > 4 {
        return String::new();
    }
    let channel = |raw: &str, is_alpha: bool| -> Option<f64> {
        let m = COLOR_CHANNEL_RE.captures(crate::js::trim(raw))?;
        let mut v: f64 = m.get(1).unwrap().as_str().parse().ok()?;
        if m.get(2).is_some() {
            v = if is_alpha { v / 100.0 } else { v * 2.55 };
        }
        let max = if is_alpha { 1.0 } else { 255.0 };
        if !v.is_finite() || v < 0.0 || v > max {
            return None;
        }
        Some(if is_alpha { v } else { v.round() })
    };
    let (Some(r), Some(g), Some(b)) = (
        channel(&parts[0], false),
        channel(&parts[1], false),
        channel(&parts[2], false),
    ) else {
        return String::new();
    };
    let a = match parts.get(3) {
        None => 1.0,
        Some(p) => match channel(p, true) {
            Some(v) => v,
            None => return String::new(),
        },
    };
    format!(
        "{},{},{},{}",
        crate::js::number_to_string(r),
        crate::js::number_to_string(g),
        crate::js::number_to_string(b),
        crate::js::number_to_string((a * 255.0).round())
    )
}

/// JS `.replace(/\s*\/\s*/g, ' / ')`.
fn slash_spaced(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let chars: Vec<char> = text.chars().collect();
    let is_ws = |c: char| c.is_whitespace() || c == '\u{feff}';
    let mut i = 0;
    while i < chars.len() {
        let start = i;
        while i < chars.len() && is_ws(chars[i]) {
            i += 1;
        }
        if i < chars.len() && chars[i] == '/' {
            i += 1;
            while i < chars.len() && is_ws(chars[i]) {
                i += 1;
            }
            out.push_str(" / ");
            continue;
        }
        i = start;
        out.push(chars[i]);
        i += 1;
    }
    out
}

/// JS `_findingValue`: the value a finding of a value-scoped rule offers to a
/// waiver, or empty when it offers none.
fn browser_finding_ignore_value(f: &BrowserFinding) -> String {
    if !DIRECT_VALUE_RULES.contains(&f.type_.as_str()) {
        return String::new();
    }
    if let Some(direct) = f.ignore_value.as_deref().filter(|s| !s.is_empty()) {
        return normalize_browser_ignore_value(direct);
    }
    // The CLI routes bounce-easing through extractMotionIgnoreValue and never
    // the font regexes; without a direct ignoreValue there is no value to
    // match, so do not invent one from unrelated CSS text.
    if f.type_ == "bounce-easing" {
        return String::new();
    }
    // The design-system checks set `ignoreValue` on their findings; the detail
    // fallback catches overused-font, whose value lives in its sentence.
    for re in [&*PRIMARY_FONT_RE, &*GOOGLE_LABEL_RE, &*FAMILY_RE] {
        if let Some(m) = re.captures(&f.detail) {
            return normalize_browser_ignore_value(m.get(1).unwrap().as_str());
        }
    }
    String::new()
}

/// JS `_valueIgnored`.
fn browser_value_ignored(f: &BrowserFinding, entries: &[(String, String)]) -> bool {
    let value = browser_finding_ignore_value(f);
    if value.is_empty() {
        return false;
    }
    entries.iter().any(|(rule, entry_value)| {
        rule == &f.type_
            && (entry_value == &value
                || (f.type_ == "design-system-color" && {
                    let key = browser_color_ignore_key(entry_value);
                    !key.is_empty() && key == browser_color_ignore_key(&value)
                }))
    })
}

/// JS: index.mjs#collectBrowserFindings()
pub fn collect_browser_findings(dom: &dyn Dom, config: &BrowserConfig) -> CollectResult {
    use super::element_checks as ec;
    use super::page_checks as pc;
    use super::quality as q;
    use super::text_collectors as tc;

    // A page matched by detector.ignoreFiles is waived wholesale: every scan
    // stage answers empty so the badge and toast read zero. Mirrors
    // shouldIgnoreDetectionFile in cli/lib/impeccable-config.mjs; the live
    // overlay resolves the globs per page (live-browser-ignores.js) and
    // forwards the verdict as config.skipScan. JS: index.mjs#skipScanActive().
    if config.extension_mode && config.skip_scan {
        return CollectResult { groups: Vec::new(), page_level: Vec::new() };
    }

    let mut groups: Vec<FindingGroup> = Vec::new();
    let mut page_level: Vec<BrowserFinding> = Vec::new();
    let disabled: Vec<String> = if config.extension_mode {
        config.disabled_rules.clone()
    } else {
        Vec::new()
    };
    let rule_ok = |id: &str| disabled.is_empty() || !disabled.iter().any(|d| d == id);
    let design_system = browser_design_system_config(config);
    let mut design_seen = DesignSeen::default();
    let body = dom.body();
    let root = dom.document_element();
    // JS `document.body` may be null on a bare document; every
    // `addBrowserFindings(groupMap, document.body, ...)` then keys on null.
    // Elements never equal null, so the page-level groups collapse under
    // handle 0 the same way they collapse under null.
    let body_key = body.unwrap_or(0);

    for el in dom.query_all(None, "*").unwrap_or_default() {
        if super::dom::closest_or_none(
            dom,
            el,
            ".impeccable-overlay, .impeccable-label, .impeccable-banner, .impeccable-tooltip",
        )
        .is_some()
        {
            continue;
        }
        let el_id = super::dom::safe_id(dom, el);
        if el_id.starts_with("claude-") || el_id.starts_with("cic-") {
            continue;
        }
        if super::dom::closest_or_none(dom, el, "[id^=\"impeccable-live-\"]").is_some() {
            continue;
        }
        if Some(el) == body || Some(el) == root {
            continue;
        }

        let mut findings: Vec<BrowserFinding> = Vec::new();
        findings.extend(hits(ec::check_element_borders_dom(dom, el)));
        findings.extend(hits(ec::check_element_pseudo_stripe_dom(dom, el)));
        findings.extend(hits(ec::check_element_colors_dom(dom, el)));
        findings.extend(hits(ec::check_element_motion_dom(dom, el)));
        findings.extend(hits(ec::check_element_glow_dom(dom, el)));
        findings.extend(hits(ec::check_element_ai_palette_dom(dom, el)));
        findings.extend(hits(ec::check_element_radial_spotlight_dom(dom, el)));
        findings.extend(hits(ec::check_element_icon_tile_dom(dom, el)));
        findings.extend(hits(ec::check_element_italic_serif_dom(dom, el)));
        findings.extend(hits(q::check_element_quality_dom(dom, el, config)));
        findings.extend(hits(ec::check_element_oversized_h1_dom(dom, el)));
        findings.extend(hits(ec::check_element_clipped_overflow_dom(dom, el)));
        findings.extend(hits(ec::check_element_gpt_border_shadow_dom(dom, el)));
        findings.extend(hits(ec::check_element_text_overflow_dom(dom, el)));
        findings.extend(ec::check_element_blinking_cursor_dom(dom, el));
        findings.extend(check_element_design_system_dom(
            dom,
            el,
            design_system.as_ref(),
            &mut design_seen,
        ));
        // Rule-pack element rules run last, so the built-in findings for this
        // element keep their order and their position in the group.
        if let Some(pack) = config.rule_pack {
            findings.extend(pack.check_element_dom(dom, el));
        }
        let findings: Vec<BrowserFinding> =
            findings.into_iter().filter(|f| rule_ok(&f.type_)).collect();
        add_browser_findings(dom, &mut groups, el, findings);

        // Hero eyebrow: highlight the previous sibling instead.
        let eyebrow: Vec<BrowserFinding> = hits(ec::check_element_hero_eyebrow_dom(dom, el))
            .into_iter()
            .filter(|f| rule_ok(&f.type_))
            .collect();
        if !eyebrow.is_empty() {
            if let Some(prev) = dom.previous_element_sibling(el) {
                add_browser_findings(dom, &mut groups, prev, eyebrow);
            }
        }
    }

    let page_pass = |groups: &mut Vec<FindingGroup>, page_level: &mut Vec<BrowserFinding>, list: Vec<BrowserFinding>| {
        let list: Vec<BrowserFinding> = list.into_iter().filter(|f| rule_ok(&f.type_)).collect();
        if !list.is_empty() {
            page_level.extend(list.iter().cloned());
            add_browser_findings(dom, groups, body_key, list);
        }
    };

    page_pass(
        &mut groups,
        &mut page_level,
        check_browser_design_system_sources(dom, design_system.as_ref(), &mut design_seen),
    );
    page_pass(&mut groups, &mut page_level, pc::check_typography(dom));
    page_pass(&mut groups, &mut page_level, hits(tc::check_kicker_above_heading_dom(dom)));
    page_pass(&mut groups, &mut page_level, hits(tc::check_numbered_section_labels_dom(dom)));
    page_pass(&mut groups, &mut page_level, hits(tc::check_repeated_container_text_dom(dom)));
    page_pass(&mut groups, &mut page_level, hits(tc::check_em_dash_overuse_dom(dom)));

    let el_pass = |groups: &mut Vec<FindingGroup>, list: Vec<super::ElFinding>| {
        for f in list {
            if !rule_ok(&f.finding.type_) {
                continue;
            }
            let target = f.el.unwrap_or(body_key);
            add_browser_findings(
                dom,
                groups,
                target,
                vec![BrowserFinding::new(f.finding.type_.clone(), f.finding.detail.clone())],
            );
        }
    };
    el_pass(&mut groups, pc::check_layout(dom));
    el_pass(&mut groups, pc::check_heading_rhythm_dom(dom));
    el_pass(&mut groups, pc::check_edge_flush_cards_dom(dom));
    el_pass(&mut groups, pc::check_text_occlusion_dom(dom));
    el_pass(&mut groups, pc::check_first_viewport_column_overflow_dom(dom));

    page_pass(&mut groups, &mut page_level, q::check_page_quality_dom(dom));
    page_pass(&mut groups, &mut page_level, hits(pc::check_cream_palette(dom)));
    page_pass(&mut groups, &mut page_level, scoped_html_pattern_findings(dom));

    // Rule-pack page rules run after every built-in page pass, through the
    // same attribution as the built-in checks that name their own element.
    if let Some(pack) = config.rule_pack {
        el_pass(&mut groups, pack.check_page_dom(dom));
    }

    // Value-level suppression runs last, over everything the passes produced,
    // so a project waiver covers a rule pack's findings the same way it covers
    // the built-in ones. JS: index.mjs#collectBrowserFindings() tail.
    let disabled_values: Vec<(String, String)> = if config.extension_mode {
        config
            .disabled_values
            .iter()
            .map(|e| {
                (
                    crate::js::to_lower_case(crate::js::trim(&e.rule)),
                    normalize_browser_ignore_value(&e.value),
                )
            })
            .collect()
    } else {
        Vec::new()
    };
    if !disabled_values.is_empty() {
        for group in groups.iter_mut() {
            group.findings.retain(|f| !browser_value_ignored(f, &disabled_values));
        }
        groups.retain(|g| !g.findings.is_empty());
        page_level.retain(|f| !browser_value_ignored(f, &disabled_values));
    }

    CollectResult { groups, page_level }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browser::fake_dom::FakeDom;
    use serde_json::json;

    fn ds_config(v: serde_json::Value) -> BrowserConfig {
        BrowserConfig {
            design_system: Some(v),
            ..Default::default()
        }
    }

    #[test]
    fn design_system_config_parses_and_gates_on_present() {
        assert!(browser_design_system_config(&ds_config(json!({ "present": false }))).is_none());
        let ds = browser_design_system_config(&ds_config(json!({
            "present": true,
            "hasFonts": true, "allowedFonts": ["Inter", "'Inter'", "Space+Grotesk", ""],
            "hasColors": true, "allowedColors": [{ "r": 10, "g": 20, "b": 30 }, { "r": "x" }],
            "hasRadii": true, "allowedRadii": [8, "12", "abc"],
            "hasPillRadius": true
        })))
        .unwrap();
        assert_eq!(ds.allowed_fonts, vec!["inter", "space grotesk"]);
        assert_eq!(ds.allowed_colors.len(), 1);
        assert_eq!(ds.allowed_radii, vec![8.0, 12.0]);
        assert!(ds.has_fonts && ds.has_colors && ds.has_radii && ds.has_pill_radius);
        // hasFonts without any usable font reads false.
        let ds2 = browser_design_system_config(&ds_config(json!({
            "present": true, "hasFonts": true, "allowedFonts": []
        })))
        .unwrap();
        assert!(!ds2.has_fonts && !ds2.has_colors && !ds2.has_radii);
    }

    #[test]
    fn primary_font_and_normalization() {
        assert_eq!(browser_primary_font("\"Inter\", system-ui, sans-serif"), "inter");
        assert_eq!(browser_primary_font("system-ui, sans-serif"), "");
        assert_eq!(browser_primary_font("system-ui, Roboto"), "roboto");
        assert_eq!(browser_primary_font("var(--font)"), "");
        assert_eq!(normalize_browser_font_name("  'Space+Grotesk'  "), "space grotesk");
    }

    #[test]
    fn design_element_findings_and_seen_dedupe() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let p = d.add(Some(body), "p");
        d.add_text(p, "Hello   world");
        d.set_styles(
            p,
            &[
                ("fontFamily", "Comic Sans MS, cursive"),
                ("color", "rgb(255, 0, 0)"),
                ("backgroundColor", "rgba(0, 0, 0, 0)"),
                ("borderTopWidth", "0px"),
                ("borderRightWidth", "0px"),
                ("borderBottomWidth", "1px"),
                ("borderLeftWidth", "0px"),
                ("borderBottomColor", "rgb(10, 20, 30)"),
                ("outlineWidth", "0px"),
                ("borderRadius", "8px 3px / 2px"),
            ],
        );
        d.el_mut(p).check_visibility = Some(true);
        let ds = browser_design_system_config(&ds_config(json!({
            "present": true,
            "hasFonts": true, "allowedFonts": ["Inter"],
            "hasColors": true, "allowedColors": [{ "r": 10, "g": 20, "b": 30 }],
            "hasRadii": true, "allowedRadii": [8], "hasPillRadius": false
        })))
        .unwrap();
        let mut seen = DesignSeen::default();
        let f = check_element_design_system_dom(&d, p, Some(&ds), &mut seen);
        let types: Vec<&str> = f.iter().map(|x| x.type_.as_str()).collect();
        assert_eq!(
            types,
            vec!["design-system-font", "design-system-color", "design-system-radius", "design-system-radius"]
        );
        assert_eq!(
            f[0].detail,
            "p \"Hello world\" uses comic sans ms; not declared in DESIGN.md typography"
        );
        assert_eq!(f[0].ignore_value.as_deref(), Some("comic sans ms"));
        assert_eq!(
            f[1].detail,
            "text color rgb(255, 0, 0) on p \"Hello world\" is outside DESIGN.md colors"
        );
        assert_eq!(f[2].detail, "border-radius 3px on p \"Hello world\" is outside the DESIGN.md rounded scale");
        assert_eq!(f[3].ignore_value.as_deref(), Some("2px"));
        // Second element with the same offenders adds nothing.
        let q = d.add(Some(body), "p");
        d.add_text(q, "Again");
        for (k, v) in d.el(p).styles.clone() {
            d.set_style(q, &k, &v);
        }
        d.el_mut(q).check_visibility = Some(true);
        assert!(check_element_design_system_dom(&d, q, Some(&ds), &mut seen).is_empty());
        // Hidden elements are skipped.
        d.el_mut(q).check_visibility = Some(false);
        let mut seen2 = DesignSeen::default();
        assert!(check_element_design_system_dom(&d, q, Some(&ds), &mut seen2).is_empty());
    }

    #[test]
    fn google_font_sources() {
        let mut d = FakeDom::new();
        let (html, _body) = d.with_page();
        let head = d.add(Some(html), "head");
        let link = d.add(Some(head), "link");
        d.set_attr(
            link,
            "href",
            "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;700&family=Inter&family=Bad%ZZ",
        );
        d.add_selector(link, "link[href*=\"fonts.googleapis.com/css\"]");
        let ds = browser_design_system_config(&ds_config(json!({
            "present": true, "hasFonts": true, "allowedFonts": ["Inter"]
        })))
        .unwrap();
        let mut seen = DesignSeen::default();
        let f = check_browser_design_system_sources(&d, Some(&ds), &mut seen);
        assert_eq!(f.len(), 2);
        assert_eq!(
            f[0].detail,
            "Google Fonts: Space Grotesk is not declared in DESIGN.md typography"
        );
        assert_eq!(f[0].ignore_value.as_deref(), Some("Space Grotesk"));
        // malformed escape: decodeURIComponent throws, the raw family stays
        assert_eq!(f[1].ignore_value.as_deref(), Some("Bad%ZZ"));
        assert_eq!(decode_uri_component("caf%C3%A9"), Some("café".to_string()));
        assert_eq!(decode_uri_component("%E2%82"), None);
    }

    #[test]
    fn selector_generation() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let main = d.add(Some(body), "main");
        d.set_attr(main, "id", "app");
        let sec = d.add(Some(main), "section");
        d.set_attr(sec, "class", "hero css-1a2b3c impeccable-x   hero-inner");
        let a = d.add(Some(sec), "p");
        let b = d.add(Some(sec), "p");
        d.set_attr(b, "class", "lead");
        // The fake matches `:scope > p` for both paragraphs and the composed
        // selectors document-wide.
        d.add_selector(a, ":scope > p");
        d.add_selector(b, ":scope > p");
        d.add_selector(b, ":scope > p.lead");
        assert_eq!(generate_selector(&d, main), "#app");
        assert_eq!(generate_selector(&d, body), "body");
        // p without class: two `:scope > p` matches → nth-of-type; the
        // partial `section.hero.hero-inner > p:nth-of-type(1)` matches nothing
        // in the fake, so the walk continues to the #app anchor.
        assert_eq!(
            generate_selector(&d, a),
            "#app > section.hero.hero-inner > p:nth-of-type(1)"
        );
        // Unique partial selector returns early.
        d.add_selector(b, "p.lead");
        assert_eq!(generate_selector(&d, b), "p.lead");
        assert!(is_likely_hashed_class("css-1a2b3c"));
        assert!(is_likely_hashed_class("_2x4hG"));
        assert!(is_likely_hashed_class("a1b2c3"));
        assert!(!is_likely_hashed_class("hero"));
        assert!(!is_likely_hashed_class("abcdefg"));
    }

    #[test]
    fn skip_scan_empties_the_collect_pass() {
        // JS: index.mjs#skipScanActive() — an ignoreFiles-waived page answers
        // every scan stage with the empty shape (upstream commit 00095adb).
        let make_dom = || {
            let mut d = FakeDom::new();
            let (html, _body) = d.with_page();
            let head = d.add(Some(html), "head");
            let link = d.add(Some(head), "link");
            d.set_attr(link, "href", "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;700");
            d.add_selector(link, "link[href*=\"fonts.googleapis.com/css\"]");
            d
        };
        let ds = json!({ "present": true, "hasFonts": true, "allowedFonts": ["Inter"] });
        let base = BrowserConfig { extension_mode: true, design_system: Some(ds), ..Default::default() };

        // The same page flags without skipScan...
        let d = make_dom();
        let out = collect_browser_findings(&d, &base);
        assert!(!out.groups.is_empty());
        assert!(!out.page_level.is_empty());

        // ...and answers empty with it.
        let skip = BrowserConfig { skip_scan: true, ..base.clone() };
        let d = make_dom();
        let out = collect_browser_findings(&d, &skip);
        assert!(out.groups.is_empty());
        assert!(out.page_level.is_empty());

        // The guard is extension-mode only, exactly as the JS reads it.
        let non_ext = BrowserConfig { extension_mode: false, skip_scan: true, ..skip };
        let d = make_dom();
        let out = collect_browser_findings(&d, &non_ext);
        assert!(!out.groups.is_empty());
    }

    #[test]
    fn skip_scan_covers_every_stage_of_the_collect_pass() {
        // The visual-contrast stage is not part of this pass (it runs in the
        // page, 50-scan.js), but everything the core produces has to be gone:
        // element groups, page-level findings, and the rule pack.
        let mut d = FakeDom::new();
        let (html, body) = d.with_page();
        let head = d.add(Some(html), "head");
        let link = d.add(Some(head), "link");
        d.set_attr(link, "href", "https://fonts.googleapis.com/css2?family=Poppins");
        d.add_selector(link, "link[href*=\"fonts.googleapis.com/css\"]");
        let p = d.add(Some(body), "p");
        d.add_text(p, "Hello");
        d.set_styles(p, &[("fontFamily", "Poppins, sans-serif")]);
        d.el_mut(p).check_visibility = Some(true);
        let ds = json!({ "present": true, "hasFonts": true, "allowedFonts": ["Inter"] });
        let cfg = BrowserConfig {
            extension_mode: true,
            skip_scan: true,
            design_system: Some(ds),
            ..Default::default()
        };
        let out = collect_browser_findings(&d, &cfg);
        assert!(out.groups.is_empty());
        assert!(out.page_level.is_empty());
    }

    /// The waiver plumbing the live overlay depends on: `disabledValues`
    /// entries resolved by live-browser-ignores.js suppress the matching
    /// findings where the findings are assembled, since the overlay draws its
    /// markers from what this pass returns. JS: index.mjs#collectBrowserFindings
    /// value-level suppression (issue #639).
    #[test]
    fn disabled_values_suppress_matching_findings() {
        let make_dom = || {
            let mut d = FakeDom::new();
            let (_h, body) = d.with_page();
            let p = d.add(Some(body), "p");
            d.add_text(p, "Hello");
            d.set_styles(
                p,
                &[
                    ("fontFamily", "Poppins, sans-serif"),
                    ("color", "rgb(255, 0, 0)"),
                    ("backgroundColor", "rgba(0, 0, 0, 0)"),
                ],
            );
            d.el_mut(p).check_visibility = Some(true);
            d
        };
        let ds = json!({
            "present": true,
            "hasFonts": true, "allowedFonts": ["Inter"],
            "hasColors": true, "allowedColors": [{ "r": 10, "g": 20, "b": 30 }]
        });
        let base = BrowserConfig {
            extension_mode: true,
            design_system: Some(ds),
            ..Default::default()
        };
        let types = |out: &CollectResult| -> Vec<String> {
            out.groups
                .iter()
                .flat_map(|g| g.findings.iter().map(|f| f.type_.clone()))
                .collect()
        };

        let unfiltered = collect_browser_findings(&make_dom(), &base);
        assert!(types(&unfiltered).contains(&"design-system-font".to_string()));
        assert!(types(&unfiltered).contains(&"design-system-color".to_string()));

        // A font waiver drops its finding and leaves the unrelated one.
        let font_waived = BrowserConfig {
            disabled_values: vec![DisabledValue {
                rule: "design-system-font".into(),
                value: "Poppins".into(),
            }],
            ..base.clone()
        };
        let out = collect_browser_findings(&make_dom(), &font_waived);
        assert!(!types(&out).contains(&"design-system-font".to_string()));
        assert!(types(&out).contains(&"design-system-color".to_string()));

        // Color waivers match by value, not by spelling: the browser reports
        // computed rgb(...) and the waiver is written as hex.
        let color_waived = BrowserConfig {
            disabled_values: vec![DisabledValue {
                rule: "design-system-color".into(),
                value: "#ff0000".into(),
            }],
            ..base.clone()
        };
        let out = collect_browser_findings(&make_dom(), &color_waived);
        assert!(!types(&out).contains(&"design-system-color".to_string()));
        assert!(types(&out).contains(&"design-system-font".to_string()));

        // A waiver for another rule's value changes nothing.
        let unrelated = BrowserConfig {
            disabled_values: vec![DisabledValue {
                rule: "design-system-font".into(),
                value: "Inter".into(),
            }],
            ..base.clone()
        };
        let out = collect_browser_findings(&make_dom(), &unrelated);
        assert_eq!(types(&out), types(&unfiltered));

        // Outside extension mode the config is whatever the page set, so the
        // list is ignored, exactly as the JS read it.
        let non_ext = BrowserConfig {
            extension_mode: false,
            ..font_waived
        };
        let out = collect_browser_findings(&make_dom(), &non_ext);
        assert!(types(&out).contains(&"design-system-font".to_string()));
    }

    #[test]
    fn disabled_values_parse_and_normalize_like_the_js() {
        // JS `.filter(e => e && typeof e === 'object' && e.rule && e.value)`:
        // a hand-edited __IMPECCABLE_CONFIG__ drops bad entries, it does not
        // fail the whole config.
        let cfg: BrowserConfig = serde_json::from_str(
            r##"{"extensionMode":true,"disabledValues":[
                {"rule":"overused-font","value":"Geist+Mono"},
                {"rule":"design-system-font"},
                {"value":"orphan"},
                "nope",
                {"rule":"design-system-color","value":"#FFF"}
            ]}"##,
        )
        .unwrap();
        assert_eq!(cfg.disabled_values.len(), 2);
        assert_eq!(cfg.disabled_values[0].value, "Geist+Mono");
        // A config with no disabledValues at all still parses.
        let bare: BrowserConfig = serde_json::from_str(r#"{"extensionMode":true}"#).unwrap();
        assert!(bare.disabled_values.is_empty());
        let junk: BrowserConfig =
            serde_json::from_str(r#"{"disabledValues":"not an array"}"#).unwrap();
        assert!(junk.disabled_values.is_empty());

        assert_eq!(normalize_browser_ignore_value("  \"Geist+Mono\" "), "geist mono");
        assert_eq!(browser_color_ignore_key("#fff"), "255,255,255,255");
        assert_eq!(browser_color_ignore_key("rgb(255, 0, 0)"), "255,0,0,255");
        assert_eq!(
            browser_color_ignore_key("rgb(255 255 255 / 50%)"),
            "255,255,255,128"
        );
        // hsl stays CLI-only in the browser matcher, as it was in the JS.
        assert_eq!(browser_color_ignore_key("hsl(0, 0%, 100%)"), "");
        assert_eq!(browser_color_ignore_key("not a color"), "");

        // bounce-easing without a direct ignoreValue offers no value: the CLI
        // routes it through the motion extractor and never the font regexes.
        let bounce = BrowserFinding::new("bounce-easing", "font-family: Poppins");
        assert!(browser_finding_ignore_value(&bounce).is_empty());
        let mut carried = BrowserFinding::new("overused-font", "Primary font: Poppins (etc)");
        assert_eq!(browser_finding_ignore_value(&carried), "poppins");
        carried.ignore_value = Some("Space Grotesk".into());
        assert_eq!(browser_finding_ignore_value(&carried), "space grotesk");
        // A rule outside the six offers nothing to match.
        assert!(browser_finding_ignore_value(&BrowserFinding::new("glow-effect", "x")).is_empty());
    }

    #[test]
    fn html_pattern_query_strips_pseudos_and_dangling_commas() {
        assert_eq!(html_pattern_query(".card::before"), Some(".card".to_string()));
        assert_eq!(html_pattern_query(".a:hover, .b::after"), Some(".a, .b".to_string()));
        assert_eq!(html_pattern_query("::before, ::after"), None);
        assert_eq!(html_pattern_query(".x:not(.y)::before"), Some(".x".to_string()));
        assert_eq!(html_pattern_query(".a::before,"), Some(".a".to_string()));
    }

    #[test]
    fn scoped_ignore_and_visual_merge() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let wrap = d.add(Some(body), "div");
        d.set_attr(wrap, "data-impeccable-ignore", "low-contrast, glow-effect");
        let p = d.add(Some(wrap), "p");
        d.add_selector(p, "#t");
        assert!(scoped_ignore_active(&d, p, "LOW-CONTRAST"));
        assert!(!scoped_ignore_active(&d, p, "side-tab"));
        let result = json!({
            "status": "fail", "selector": "#t",
            "finding": { "id": "low-contrast", "snippet": "browser contrast 2.0:1" }
        });
        assert_eq!(visual_contrast_result_el(&d, &result), Some(p));
        assert!(visual_contrast_result_finding(&d, p, &[], &result).is_none());
        d.set_attr(wrap, "data-impeccable-ignore", "glow-effect");
        let f = visual_contrast_result_finding(&d, p, &[], &result).unwrap();
        assert_eq!((f.type_.as_str(), f.detail.as_str()), ("low-contrast", "browser contrast 2.0:1"));
        let existing = vec![BrowserFinding::new("low-contrast", "x")];
        assert!(visual_contrast_result_finding(&d, p, &existing, &result).is_none());
        let pass = json!({ "status": "pass", "selector": "#t", "finding": null });
        assert_eq!(visual_contrast_result_el(&d, &pass), None);
    }
}

#[cfg(test)]
mod pseudo_host_tests {
    use super::pseudo_element_host_selector as host;

    #[test]
    fn pseudo_element_hosts() {
        // No pseudo-element: the full selector stays queryable as written.
        assert_eq!(host(".card"), None);
        assert_eq!(host("a:hover"), None);
        assert_eq!(host("li:not(.x)"), None);
        // Attached and hostless pseudo-elements.
        assert_eq!(host(".card::before"), Some(".card".to_string()));
        assert_eq!(host("main > ::before"), Some("main > *".to_string()));
        assert_eq!(host("::after"), Some("*".to_string()));
        // The legacy one-colon spellings only.
        assert_eq!(host(".c:before"), Some(".c".to_string()));
        assert_eq!(host(".c:focus"), None);
        // Functional pseudo-elements consume their argument list.
        assert_eq!(host("p::part(label) span"), Some("p span".to_string()));
        // Literals are preserved, colons inside them are not pseudo starts.
        assert_eq!(host("[data-x=\"a::b\"]"), None);
        assert_eq!(
            host("[data-x=\"a::b\"]::before"),
            Some("[data-x=\"a::b\"]".to_string())
        );
        // A pseudo-class keeps its colon while a pseudo-element resolves.
        assert_eq!(host("a:hover::after"), Some("a:hover".to_string()));
        // Values recorded from the JS on origin/main (#709).
        assert_eq!(host(".a::before, .b"), Some(".a, .b".to_string()));
        assert_eq!(host(".a::before,"), Some(".a".to_string()));
        assert_eq!(host("::before ::after"), Some("* *".to_string()));
        assert_eq!(host(r"\:esc::before"), Some(r"\:esc".to_string()));
        assert_eq!(host("a::before("), Some("a".to_string()));
        assert_eq!(host("div::first-line"), Some("div".to_string()));
    }
}
