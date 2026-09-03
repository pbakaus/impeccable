//! Port of `cli/engine/rules/checks.mjs` CSS-text scanners: the functions
//! that read raw stylesheet / HTML text (no DOM) and return findings that
//! carry a source `index` (a byte offset here; JS reports UTF-16 units, see
//! `crate::js_ext_a::utf16_index`) and/or a `selector`.

use crate::checks::rules::{extract_shadow_lengths, find_shadow_color, ANY, B, D};
use crate::color::{
    color_to_hex, has_chroma, parse_any_color, relative_luminance, split_top_level_commas, Rgba,
};

use crate::js::{self, ci, math_min, number_to_string, parse_float, WS, WS_CHARS};

use crate::js_ext_a::{
    advance_utf16, is_word_byte, last_index_of_byte, split_commas_outside_parens, split_ws,
    utf16_index, JsMap,
};
use once_cell::sync::Lazy;
use regex::Regex;

/// The stylesheet-text utilities and finding shapes these scanners are built
/// on are open; re-exported so `checks::css_scan` stays one path.
pub use impeccable_foundation::css::scan::*;

macro_rules! re {
    ($name:ident, $pat:expr) => {
        static $name: Lazy<Regex> = Lazy::new(|| Regex::new(&$pat).expect(stringify!($name)));
    };
}

re!(
    VAR_REF_RE,
    format!(r"var\({WS}*(--[a-zA-Z0-9_-]+){WS}*(?:,{WS}*([^)]+))?\)")
);

/// JS: checks.mjs#resolveVarRefs (Section 4). Kept private to the CSS-text
/// scanners; the measures module carries the public port.
pub(crate) fn resolve_var_refs(raw: &str, custom_props: &CustomProps) -> String {
    resolve_var_refs_depth(raw, custom_props, 0)
}

fn resolve_var_refs_depth(raw: &str, custom_props: &CustomProps, depth: u32) -> String {
    if !raw.contains("var(") {
        return raw.to_string();
    }
    if depth > 8 {
        return raw.to_string();
    }
    VAR_REF_RE
        .replace_all(raw, |m: &regex::Captures| {
            let name = &m[1];
            if let Some(v) = custom_props.get(name) {
                return resolve_var_refs_depth(v, custom_props, depth + 1);
            }
            match m.get(2).map(|f| f.as_str()) {
                Some(fallback) if !fallback.is_empty() => {
                    resolve_var_refs_depth(js::trim(fallback), custom_props, depth + 1)
                }
                _ => m[0].to_string(),
            }
        })
        .into_owned()
}

// ─── cssTextHasDarkRootBg ───────────────────────────────────────────────────
re!(
    DARK_BG_RE,
    format!(
        r"{bg}(?:-{color})?{WS}*:{WS}*(?:#(?:0[0-9a-fA-F]|1[0-9a-fA-F]|2[0-3])[0-9a-fA-F]{{4}}{B}|#(?:0|1)[0-9a-fA-F]{{2}}{B}|{rgb}\({WS}*({D}{{1,2}}){WS}*,{WS}*({D}{{1,2}}){WS}*,{WS}*({D}{{1,2}}){WS}*\))",
        bg = ci("background"),
        color = ci("color"),
        rgb = ci("rgb")
    )
);
re!(
    TW_DARK_BG_RE,
    format!(r"{B}bg-(?:gray|slate|zinc|neutral|stone)-(?:9{D}{{2}}|800){B}")
);
re!(
    ROOT_BLOCK_RE,
    format!(
        r"(?:^|[}}{WS_CHARS},;>])(?:{body}|{html}|:{root}){WS}*(?:,[^{{]*)?\{{([^}}]*)\}}",
        body = ci("body"),
        html = ci("html"),
        root = ci("root")
    )
);
re!(
    INLINE_BODY_STYLE_RE,
    format!(
        r#"<{body}[^>]*{B}{style}{WS}*={WS}*"([^"]*)""#,
        body = ci("body"),
        style = ci("style")
    )
);
re!(
    BG_DECL_RE,
    format!(
        r"{bg}(?:-{color})?{WS}*:{WS}*([^;{{}}]+)",
        bg = ci("background"),
        color = ci("color")
    )
);

/// JS: checks.mjs#cssTextHasDarkRootBg
pub fn css_text_has_dark_root_bg(content: &str, custom_props: &CustomProps) -> bool {
    if DARK_BG_RE.is_match(content) || TW_DARK_BG_RE.is_match(content) {
        return true;
    }
    let mut root_scopes: Vec<&str> = Vec::new();
    for m in ROOT_BLOCK_RE.captures_iter(content) {
        root_scopes.push(m.get(1).unwrap().as_str());
    }
    if let Some(m) = INLINE_BODY_STYLE_RE.captures(content) {
        root_scopes.push(m.get(1).unwrap().as_str());
    }
    for scope in root_scopes {
        for bm in BG_DECL_RE.captures_iter(scope) {
            let resolved = resolve_var_refs(js::trim(&bm[1]), custom_props);
            if let Some(c) = parse_any_color(Some(&resolved)) {
                if c.alpha_or_one() > 0.5 && relative_luminance(&c) < 0.1 {
                    return true;
                }
            }
        }
    }
    false
}

// ─── scanCssTextForGlow ─────────────────────────────────────────────────────
re!(
    SHADOW_DECL_RE,
    format!(
        r"{B}({box}-{shadow}|{text}-{shadow}){WS}*:{WS}*([^;{{}}]+)",
        box = ci("box"),
        text = ci("text"),
        shadow = ci("shadow")
    )
);

/// JS: checks.mjs#scanCssTextForGlow
pub fn scan_css_text_for_glow(content: &str) -> Vec<IndexedHit> {
    let custom_props = collect_css_custom_props(content);
    let has_dark_bg = css_text_has_dark_root_bg(content, &custom_props);
    let mut results = Vec::new();
    for m in SHADOW_DECL_RE.captures_iter(content) {
        let prop = js::to_lower_case(&m[1]);
        let value = resolve_var_refs(js::trim(&m[2]), &custom_props);
        for layer in split_commas_outside_parens(&value) {
            let info = match find_shadow_color(layer) {
                Some(i) => i,
                None => continue,
            };
            let color = match info.color {
                Some(c) => c,
                None => continue,
            };
            if !has_chroma(Some(&color), Some(30.0)) {
                continue;
            }
            let vals = extract_shadow_lengths(layer, Some((info.start, info.end)));
            if vals.len() < 3 || vals[2] <= 4.0 {
                continue;
            }
            let zero_offset = vals[0] == 0.0 && vals[1] == 0.0;
            if !zero_offset && !has_dark_bg {
                continue;
            }
            results.push(IndexedHit {
                index: m.get(0).unwrap().start(),
                snippet: if zero_offset {
                    format!("Zero-offset {} glow ({})", prop, color_to_hex(Some(&color)))
                } else {
                    format!(
                        "Colored {} glow ({}) on dark page",
                        prop,
                        color_to_hex(Some(&color))
                    )
                },
            });
            break;
        }
    }
    results
}

// ─── scanCssTextForGridBackground ───────────────────────────────────────────
re!(
    HAIRLINE_RE,
    format!(
        r"{B}{D}{{1,3}}px{WS}*,{WS}*{transparent}{WS}+{D}{{1,3}}px",
        transparent = ci("transparent")
    )
);
re!(
    INVERTED_HAIRLINE_RE,
    format!(
        r"{transparent}{WS}+{calc}\(100%{WS}*-{WS}*{D}{{1,3}}px\)",
        transparent = ci("transparent"),
        calc = ci("calc")
    )
);
re!(
    SIZE_DECL_PX_RE,
    format!(
        r#"{bs}{WS}*:[^;{{}}"']*{B}{D}{{1,3}}px{B}"#,
        bs = ci("background-size")
    )
);
re!(SHORTHAND_PX_ANY_RE, format!(r"/{WS}*{D}{{1,3}}px{B}"));
re!(
    GRID_BG_DECL_RE,
    format!(
        r#"{B}{bg}(?:-{image})?{WS}*:{WS}*([^;{{}}"']*)"#,
        bg = ci("background"),
        image = ci("image")
    )
);
re!(
    GRID_BLOCK_RE,
    format!(
        r#"\{{([^{{}}]*)\}}|{style}{WS}*={WS}*"([^"]*)"|{style}{WS}*={WS}*'([^']*)'"#,
        style = ci("style")
    )
);

/// JS: checks.mjs#scanCssTextForGridBackground
pub fn scan_css_text_for_grid_background(content: &str) -> Vec<IndexedHit> {
    for blk in GRID_BLOCK_RE.captures_iter(content) {
        let block = blk
            .get(1)
            .or_else(|| blk.get(2))
            .or_else(|| blk.get(3))
            .map(|m| m.as_str())
            .filter(|s| !s.is_empty())
            .unwrap_or("");
        // JS `blk[1] || blk[2] || blk[3] || ''`: an empty capture falls
        // through to the next group, but only one group participates.
        let mut hairline_count = 0usize;
        let mut bg_joined = String::new();
        for bm in GRID_BG_DECL_RE.captures_iter(block) {
            let v = &bm[1];
            hairline_count += HAIRLINE_RE.find_iter(v).count();
            hairline_count += INVERTED_HAIRLINE_RE.find_iter(v).count();
            bg_joined.push_str(v);
            bg_joined.push(';');
        }
        if hairline_count == 0 {
            continue;
        }
        let has_px_cell =
            SIZE_DECL_PX_RE.is_match(block) || SHORTHAND_PX_ANY_RE.is_match(&bg_joined);
        // A single hairline is a line, divider, or rail, not a grid, even
        // when tiled by a 2D px cell (issue #615).
        if hairline_count >= 2 && has_px_cell {
            return vec![IndexedHit {
                index: blk.get(0).unwrap().start(),
                snippet: "two-axis grid-line gradient background".to_string(),
            }];
        }
    }
    Vec::new()
}

// ─── scanCssTextForRadialHalo ───────────────────────────────────────────────
re!(
    HALO_DECL_RE,
    format!(
        r"{bg}(?:-{image})?{WS}*:{WS}*([^;{{}}]+)",
        bg = ci("background"),
        image = ci("image")
    )
);
re!(URL_FN_RE, format!(r"{}{WS}*\(", ci("url")));
re!(
    RADIAL_GRAD_RE,
    format!(
        r"({repeating}-)?{radial}-{gradient}\(",
        repeating = ci("repeating"),
        radial = ci("radial"),
        gradient = ci("gradient")
    )
);
re!(
    HALO_COLOR_TOKEN_RE,
    format!(
        r"(?:{rgb}[aA]?|{hsl}[aA]?|{oklch}|{oklab}|{lab}|{lch}|{hwb}|{colormix})\([^)]*(?:\([^)]*\))?[^)]*\)|#[0-9a-fA-F]{{3,8}}{B}|{B}{transparent}{B}",
        rgb = ci("rgb"),
        hsl = ci("hsl"),
        oklch = ci("oklch"),
        oklab = ci("oklab"),
        lab = ci("lab"),
        lch = ci("lch"),
        hwb = ci("hwb"),
        colormix = ci("color-mix"),
        transparent = ci("transparent")
    )
);
re!(PX_STOP_RE, format!(r"(-?[0-9.]+)px{B}"));
re!(TRANSPARENT_EXACT_RE, format!(r"^{}$", ci("transparent")));

/// JS: checks.mjs#scanCssTextForRadialHalo
pub fn scan_css_text_for_radial_halo(content: &str) -> Vec<IndexedHit> {
    let custom_props = collect_css_custom_props(content);
    if !css_text_has_dark_root_bg(content, &custom_props) {
        return Vec::new();
    }
    let mut findings = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    for m in HALO_DECL_RE.captures_iter(content) {
        let value = resolve_var_refs(js::trim(&m[1]), &custom_props);
        if URL_FN_RE.is_match(&value) {
            continue;
        }
        let vbytes = value.as_bytes();
        for g in RADIAL_GRAD_RE.captures_iter(&value) {
            if g.get(1).is_some() {
                continue;
            }
            let g_start = g.get(0).unwrap().start();
            let open = match value[g_start..].find('(') {
                Some(p) => g_start + p,
                None => break,
            };
            let mut depth: i64 = 0;
            let mut end: Option<usize> = None;
            let mut i = open;
            while i < vbytes.len() {
                if vbytes[i] == b'(' {
                    depth += 1;
                } else if vbytes[i] == b')' {
                    depth -= 1;
                    if depth == 0 {
                        end = Some(i);
                        break;
                    }
                }
                i += 1;
            }
            let end = match end {
                Some(e) => e,
                None => break,
            };
            let args = split_top_level_commas(&value[open + 1..end]);
            if args.len() < 2 {
                continue;
            }
            let stops: Vec<&String> = args
                .iter()
                .filter(|a| HALO_COLOR_TOKEN_RE.is_match(a))
                .collect();
            if stops.len() < 2 {
                continue;
            }
            let px_stop = stops.iter().any(|s| {
                PX_STOP_RE
                    .captures(s)
                    .map_or(false, |pm| parse_float(&pm[1]).abs() <= 24.0)
            });
            if px_stop {
                continue;
            }
            let first = match HALO_COLOR_TOKEN_RE.find(stops[0]) {
                Some(f) => f.as_str(),
                None => continue,
            };
            let last = match HALO_COLOR_TOKEN_RE.find(stops[stops.len() - 1]) {
                Some(l) => l.as_str(),
                None => continue,
            };
            let last_color = if TRANSPARENT_EXACT_RE.is_match(last) {
                Some(Rgba::new(0.0, 0.0, 0.0, 0.0))
            } else {
                parse_any_color(Some(last))
            };
            match last_color {
                Some(c) if c.alpha_or_one() <= 0.05 => {}
                _ => continue,
            }
            let first_color = if TRANSPARENT_EXACT_RE.is_match(first) {
                None
            } else {
                parse_any_color(Some(first))
            };
            let first_color = match first_color {
                Some(c) => c,
                None => continue,
            };
            if first_color.alpha_or_one() < 0.7 {
                continue;
            }
            let spread = js::math_max3(first_color.r, first_color.g, first_color.b)
                - js::math_min3(first_color.r, first_color.g, first_color.b);
            if spread < 24.0 {
                continue;
            }
            let snippet = format!(
                "radial-gradient halo ({} → transparent) on dark page",
                color_to_hex(Some(&first_color))
            );
            if seen.contains(&snippet) {
                continue;
            }
            seen.push(snippet.clone());
            findings.push(IndexedHit {
                index: m.get(0).unwrap().start(),
                snippet,
            });
        }
    }
    findings
}

re!(CSS_RULE_BLOCK_RE, CSS_RULE_BLOCK_SOURCE.to_string());

/// JS `/(?:^|[<prefix>])(?:tok…)(?!<run class>)/i.test(s)`, evaluated as:
/// at the start and after every prefix char, take the maximal run of
/// `run` bytes and ask `pred` about it.
fn token_after_prefix(
    s: &str,
    is_prefix: impl Fn(char) -> bool,
    run: impl Fn(u8) -> bool,
    pred: impl Fn(&str) -> bool,
) -> bool {
    let bytes = s.as_bytes();
    let check = |p: usize| -> bool {
        let mut e = p;
        while e < bytes.len() && run(bytes[e]) {
            e += 1;
        }
        pred(&s[p..e])
    };
    if check(0) {
        return true;
    }
    for (i, c) in s.char_indices() {
        if is_prefix(c) && check(i + c.len_utf8()) {
            return true;
        }
    }
    false
}

/// JS `/(?:^|[\s>+~,(])(?:<tags>)(?![\w-])/i.test(selector)`.
fn selector_has_tag(selector: &str, tags: &[&str]) -> bool {
    token_after_prefix(
        selector,
        |c| js::is_js_whitespace(c) || matches!(c, '>' | '+' | '~' | ',' | '('),
        is_word_or_dash,
        |run| tags.iter().any(|t| run.eq_ignore_ascii_case(t)),
    )
}

/// JS `/(?:^|[\s._[-])(?:active|current|selected[…])(?![\w])/i.test(selector)`;
/// `prefixed` adds the `btn[\w-]*|button[\w-]*|link[\w-]*` alternatives.
fn selector_has_state_word(selector: &str, prefixed: bool) -> bool {
    token_after_prefix(
        selector,
        |c| js::is_js_whitespace(c) || matches!(c, '.' | '_' | '[' | '-'),
        is_word_or_dash,
        |run| {
            let word_len = run.bytes().take_while(|b| is_word_byte(*b)).count();
            let word = &run[..word_len];
            if ["active", "current", "selected"]
                .iter()
                .any(|w| word.eq_ignore_ascii_case(w))
            {
                return true;
            }
            if prefixed {
                let lower = run.to_ascii_lowercase();
                return lower.starts_with("btn")
                    || lower.starts_with("button")
                    || lower.starts_with("link");
            }
            false
        },
    )
}

re!(
    ARIA_SELECTED_TRUE_RE,
    format!(
        r#"\[{aria}{WS}*[*^$|~]?={WS}*["']?{t}"#,
        aria = ci("aria-selected"),
        t = ci("true")
    )
);
re!(ARIA_CURRENT_RE, format!(r"\[{}", ci("aria-current")));
re!(
    ARIA_CURRENT_FALSE_TAIL_RE,
    format!(r#"^{WS}*[*^$|~]?={WS}*["']?{f}"#, f = ci("false"))
);

/// JS `/\[aria-current(?!\s*[*^$|~]?=\s*["']?false)/i.test(selector)`.
fn has_aria_current_not_false(selector: &str) -> bool {
    ARIA_CURRENT_RE
        .find_iter(selector)
        .any(|m| !ARIA_CURRENT_FALSE_TAIL_RE.is_match(&selector[m.end()..]))
}

re!(
    STATE_PSEUDO_RE,
    format!(
        r":(?:{hover}|{focus}|{fv}|{fw}|{active}|{checked}){B}",
        hover = ci("hover"),
        focus = ci("focus"),
        fv = ci("focus-visible"),
        fw = ci("focus-within"),
        active = ci("active"),
        checked = ci("checked")
    )
);
re!(
    STATE_PSEUDO_TARGET_RE,
    format!(
        r":(?:{hover}|{focus}|{fv}|{fw}|{active}|{checked}|{target}){B}",
        hover = ci("hover"),
        focus = ci("focus"),
        fv = ci("focus-visible"),
        fw = ci("focus-within"),
        active = ci("active"),
        checked = ci("checked"),
        target = ci("target")
    )
);

// ─── scanCssTextForPseudoStripe ─────────────────────────────────────────────
re!(COMMENT_RE, format!(r"/\*{ANY}*?\*/"));

re!(
    PSEUDO_SEL_RE,
    format!(
        r"::?(?:{before}|{after}){B}",
        before = ci("before"),
        after = ci("after")
    )
);
re!(
    PROSE_TAG_RE,
    format!(
        r"{B}(?:{blockquote}|{pre}|{code}|{nav}|{hr}){B}",
        blockquote = ci("blockquote"),
        pre = ci("pre"),
        code = ci("code"),
        nav = ci("nav"),
        hr = ci("hr")
    )
);
re!(FULL_PCT_RE, r"^100(?:\.0*)?%$".to_string());
re!(
    NO_PAINT_BG_RE,
    format!(
        r"^(?:{none}|{transparent}|{inherit}|{initial}|{unset}|{currentcolor})$",
        none = ci("none"),
        transparent = ci("transparent"),
        inherit = ci("inherit"),
        initial = ci("initial"),
        unset = ci("unset"),
        currentcolor = ci("currentcolor")
    )
);
re!(
    STRIPE_COLOR_TOKEN_RE,
    format!(
        r"(?:{rgb}[aA]?|{hsl}[aA]?|{oklch}|{oklab}|{lab}|{lch}|{hwb})\([^)]*\)|#[0-9a-fA-F]{{3,8}}{B}",
        rgb = ci("rgb"),
        hsl = ci("hsl"),
        oklch = ci("oklch"),
        oklab = ci("oklab"),
        lab = ci("lab"),
        lch = ci("lch"),
        hwb = ci("hwb")
    )
);
re!(
    NEUTRAL_NAME_RE,
    format!(
        r"^(?:{white}|{black}|{gray}|{grey}|{silver})$",
        white = ci("white"),
        black = ci("black"),
        gray = ci("gray"),
        grey = ci("grey"),
        silver = ci("silver")
    )
);

/// Blank comment bodies byte-for-byte (JS: every code unit becomes a
/// space, newlines stay) so offsets survive.
fn blank_comments(raw: &str) -> String {
    COMMENT_RE
        .replace_all(raw, |m: &regex::Captures| {
            let mut out = String::new();
            for c in m[0].chars() {
                if c == '\n' {
                    out.push('\n');
                } else {
                    for _ in 0..c.len_utf16() {
                        out.push(' ');
                    }
                }
            }
            out
        })
        .into_owned()
}

fn get_or<'a>(decls: &'a DeclMap, a: &str, b: &str) -> &'a str {
    match decls.get(a) {
        Some(v) if !v.is_empty() => v,
        _ => match decls.get(b) {
            Some(v) if !v.is_empty() => v,
            _ => "",
        },
    }
}

/// JS: checks.mjs#scanCssTextForPseudoStripe
pub fn scan_css_text_for_pseudo_stripe(raw_content: &str) -> Vec<PatternFinding> {
    let content = blank_comments(raw_content);
    let custom_props = collect_css_custom_props(&content);
    let mut findings = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    for m in CSS_RULE_BLOCK_RE.captures_iter(&content) {
        let sel_raw = m.get(1).unwrap();
        let selector = js::trim(sel_raw.as_str());
        if !PSEUDO_SEL_RE.is_match(selector) {
            continue;
        }
        if PROSE_TAG_RE.is_match(selector) {
            continue;
        }
        let decls = parse_css_decl_block(&m[2]);
        let position = decls.get("position").map(|s| s.as_str());
        if position != Some("absolute") && position != Some("fixed") {
            continue;
        }
        let width_px = css_length_to_px(&resolve_var_refs(
            get_or(&decls, "width", "inline-size"),
            &custom_props,
        ));
        let height_px = css_length_to_px(&resolve_var_refs(
            get_or(&decls, "height", "block-size"),
            &custom_props,
        ));
        let vertical_candidate = width_px.map_or(false, |w| w >= 3.0 && w <= 12.0);
        let horizontal_candidate = height_px.map_or(false, |h| h >= 3.0 && h <= 12.0)
            && !selector_has_tag(
                selector,
                &["a", "button", "summary", "tr", "td", "th", "table", "li"],
            )
            && !ARIA_SELECTED_TRUE_RE.is_match(selector)
            && !has_aria_current_not_false(selector)
            && !selector_has_state_word(selector, true)
            && !STATE_PSEUDO_RE.is_match(selector);
        if !vertical_candidate && !horizontal_candidate {
            continue;
        }

        let mut top = decls.get("top").map(|s| s.as_str());
        let mut right = decls.get("right").map(|s| s.as_str());
        let mut bottom = decls.get("bottom").map(|s| s.as_str());
        let mut left = decls.get("left").map(|s| s.as_str());
        if let Some(inset) = decls.get("inset").filter(|s| !s.is_empty()) {
            let p = split_ws(inset);
            let (t, r, b, l) = match p.len() {
                1 => (p[0], p[0], p[0], p[0]),
                2 => (p[0], p[1], p[0], p[1]),
                3 => (p[0], p[1], p[2], p[1]),
                _ => (p[0], p[1], p[2], p[3]),
            };
            if top.is_none() {
                top = Some(t);
            }
            if right.is_none() {
                right = Some(r);
            }
            if bottom.is_none() {
                bottom = Some(b);
            }
            if left.is_none() {
                left = Some(l);
            }
        }
        if left.is_none() {
            left = decls.get("inset-inline-start").map(|s| s.as_str());
        }
        if right.is_none() {
            right = decls.get("inset-inline-end").map(|s| s.as_str());
        }

        let height_value = resolve_var_refs(get_or(&decls, "height", "block-size"), &custom_props);
        let height_value = js::trim(&height_value);
        let width_value = resolve_var_refs(get_or(&decls, "width", "inline-size"), &custom_props);
        let width_value = js::trim(&width_value);

        let mut edge: Option<&str> = None;
        let mut thickness_px: Option<f64> = None;
        if vertical_candidate {
            let top_px = css_length_to_px(&resolve_var_refs(top.unwrap_or(""), &custom_props));
            let bottom_px =
                css_length_to_px(&resolve_var_refs(bottom.unwrap_or(""), &custom_props));
            let full_height = (is_zero_offset(top) && is_zero_offset(bottom))
                || FULL_PCT_RE.is_match(height_value)
                || (top_px.is_some()
                    && bottom_px.is_some()
                    && top_px.unwrap() >= 0.0
                    && top_px.unwrap() <= 20.0
                    && bottom_px.unwrap() >= 0.0
                    && bottom_px.unwrap() <= 20.0);
            if full_height {
                edge = if is_zero_offset(left) {
                    Some("left")
                } else if is_zero_offset(right) {
                    Some("right")
                } else {
                    None
                };
                thickness_px = width_px;
            }
        }
        if edge.is_none() && horizontal_candidate {
            let full_width = (is_zero_offset(left) && is_zero_offset(right))
                || FULL_PCT_RE.is_match(width_value);
            if full_width {
                edge = if is_zero_offset(top) {
                    Some("top")
                } else if is_zero_offset(bottom) {
                    Some("bottom")
                } else {
                    None
                };
                thickness_px = height_px;
            }
        }
        let edge = match edge {
            Some(e) => e,
            None => continue,
        };

        let bg = resolve_var_refs(
            get_or(&decls, "background-color", "background"),
            &custom_props,
        );
        let bg = js::trim(&bg);
        if bg.is_empty() || NO_PAINT_BG_RE.is_match(bg) {
            continue;
        }
        let color_token = STRIPE_COLOR_TOKEN_RE.find(bg).map(|t| t.as_str());
        let parsed = parse_any_color(Some(color_token.unwrap_or(bg)));
        if let Some(c) = parsed {
            if c.alpha_or_one() < 0.1 {
                continue;
            }
            let spread = js::math_max3(c.r, c.g, c.b) - js::math_min3(c.r, c.g, c.b);
            if spread < 30.0 {
                continue;
            }
        } else if NEUTRAL_NAME_RE.is_match(bg) {
            continue;
        }

        if seen.iter().any(|s| s == selector) {
            continue;
        }
        seen.push(selector.to_string());
        let sel_text = sel_raw.as_str();
        // Offset into the blanked text; map it back onto `raw_content`
        // (blanking keeps UTF-16 positions, not byte positions).
        let blanked_start = sel_raw.start() + (sel_text.len() - js::trim_start(sel_text).len());
        let selector_start = advance_utf16(raw_content, 0, utf16_index(&content, blanked_start));
        findings.push(PatternFinding {
            id: "side-tab".to_string(),
            snippet: format!(
                "{} — absolute {}px pseudo-element stripe ({}: 0)",
                selector,
                thickness_px.map_or("null".to_string(), number_to_string),
                edge
            ),
            index: Some(selector_start),
            selector: Some(selector.to_string()),
            severity: None,
        });
    }
    findings
}

// ─── scanCssTextForInsetStripe ──────────────────────────────────────────────
re!(INSET_RE, format!(r"{B}{}{B}", ci("inset")));

/// JS: checks.mjs#scanCssTextForInsetStripe
pub fn scan_css_text_for_inset_stripe(content: &str) -> Vec<PatternFinding> {
    let custom_props = collect_css_custom_props(content);
    let mut findings = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    for m in CSS_RULE_BLOCK_RE.captures_iter(content) {
        let selector = js::trim(&m[1]);
        if STATE_PSEUDO_TARGET_RE.is_match(selector) {
            continue;
        }
        if ARIA_SELECTED_TRUE_RE.is_match(selector) {
            continue;
        }
        if has_aria_current_not_false(selector) {
            continue;
        }
        if selector_has_state_word(selector, false) {
            continue;
        }
        if selector_has_tag(
            selector,
            &[
                "button",
                "hr",
                "tr",
                "td",
                "th",
                "table",
                "blockquote",
                "pre",
                "code",
            ],
        ) {
            continue;
        }
        let decls = parse_css_decl_block(&m[2]);
        let shadow = match decls.get("box-shadow") {
            Some(s) if !s.is_empty() && INSET_RE.is_match(s) => s,
            _ => continue,
        };
        let declared_width = css_length_to_px(&resolve_var_refs(
            get_or(&decls, "width", "inline-size"),
            &custom_props,
        ));
        if declared_width.map_or(false, |w| w <= 40.0) {
            continue;
        }
        let value = resolve_var_refs(shadow, &custom_props);
        for layer in split_commas_outside_parens(&value) {
            if !INSET_RE.is_match(layer) {
                continue;
            }
            let info = match find_shadow_color(layer) {
                Some(i) => i,
                None => continue,
            };
            let c = match info.color {
                Some(c) => c,
                None => continue,
            };
            if c.alpha_or_one() < 0.1 {
                continue;
            }
            let chroma = js::math_max3(c.r, c.g, c.b) - js::math_min3(c.r, c.g, c.b);
            if chroma < 30.0 {
                continue;
            }
            let vals = extract_shadow_lengths(layer, Some((info.start, info.end)));
            let or0 = |i: usize| -> f64 {
                match vals.get(i) {
                    Some(v) if *v != 0.0 && !v.is_nan() => *v,
                    _ => 0.0,
                }
            };
            let x = or0(0);
            let y = or0(1);
            let blur = or0(2);
            let sp = or0(3);
            if blur != 0.0 || sp != 0.0 {
                continue;
            }
            let ax = x.abs();
            let ay = y.abs();
            let is_stripe =
                (ax >= 3.0 && ax <= 12.0 && ay == 0.0) || (ay >= 3.0 && ay <= 12.0 && ax == 0.0);
            if !is_stripe {
                continue;
            }
            if seen.iter().any(|s| s == selector) {
                break;
            }
            seen.push(selector.to_string());
            let edge = if ay == 0.0 {
                if x > 0.0 {
                    "left"
                } else {
                    "right"
                }
            } else if y > 0.0 {
                "top"
            } else {
                "bottom"
            };
            findings.push(PatternFinding {
                id: "side-tab".to_string(),
                snippet: format!(
                    "{} — inset box-shadow {}px stripe ({})",
                    selector,
                    number_to_string(if ay == 0.0 { ax } else { ay }),
                    edge
                ),
                selector: Some(selector.to_string()),
                index: None,
                severity: None,
            });
            break;
        }
    }
    findings
}

// ─── scanCssTextForOrganicClipPath ──────────────────────────────────────────
// A `clip-path: polygon(...)` with many vertices, or `clip-path: path(...)`
// with curves, is CSS approximating an organic contour: a torn edge, a blob,
// a silhouette. Geometric clips (few vertices, or vertices on the 0/50/100
// grid) pass; circle()/inset()/ellipse() pass.
const ORGANIC_POLYGON_MIN_VERTICES: usize = 10;

re!(
    ORGANIC_CLIP_RE,
    format!(
        r"{cp}{WS}*:{WS}*({polygon}|{path}){WS}*\(([^)]*(?:\)[^;}}]*)?)",
        cp = ci("clip-path"),
        polygon = ci("polygon"),
        path = ci("path")
    )
);
re!(CURVE_CMD_RE, "[CSQTAcsqta]".to_string());
re!(SIGNED_NUM_RE, r"-?[0-9.]+".to_string());

/// JS: checks.mjs#scanCssTextForOrganicClipPath
pub fn scan_css_text_for_organic_clip_path(style_text: &str) -> Vec<PatternFinding> {
    let mut findings = Vec::new();
    for m in ORGANIC_CLIP_RE.captures_iter(style_text) {
        let kind = js::to_lower_case(&m[1]);
        let body = m.get(2).map(|g| g.as_str()).unwrap_or("");
        let index = m.get(0).unwrap().start();
        if kind == "path" {
            // curves (C, S, Q, T, A, absolute or relative) drawing a contour,
            // not a rectilinear M/L/Z outline; letters in path data are only
            // commands
            let curves = CURVE_CMD_RE.find_iter(body).count();
            if curves < 3 {
                continue;
            }
            findings.push(PatternFinding {
                id: "organic-clip-path".to_string(),
                snippet: format!("clip-path: path() with {curves} curve segments"),
                selector: enclosing_css_selector(style_text, index),
                index: None,
                severity: None,
            });
            continue;
        }
        let points: Vec<&str> = body
            .split(',')
            .map(js::trim)
            .filter(|p| !p.is_empty())
            .collect();
        if points.len() < ORGANIC_POLYGON_MIN_VERTICES {
            continue;
        }
        // Vertices sitting on a coarse grid (multiples of 25%) are geometric;
        // a contour has arbitrary values.
        let mut off_grid = 0usize;
        for p in &points {
            for n in SIGNED_NUM_RE.find_iter(p) {
                let v = parse_float(n.as_str());
                if (v - js::math_round(v / 25.0) * 25.0).abs() > 0.5 {
                    off_grid += 1;
                }
            }
        }
        if off_grid < points.len() {
            continue;
        }
        findings.push(PatternFinding {
            id: "organic-clip-path".to_string(),
            snippet: format!(
                "clip-path: polygon() with {} vertices approximating an organic contour",
                points.len()
            ),
            selector: enclosing_css_selector(style_text, index),
            index: None,
            severity: None,
        });
    }
    findings
}

// ─── scanCssTextForBuriedRaster ─────────────────────────────────────────────
// A raster (background-image url) that never reaches the screen: under a
// near-opaque gradient wash in the same background stack. A tint under 0.9
// alpha passes; a blend mode passes; layers after the url() pass.
re!(
    BURIED_DECL_RE,
    format!(
        r"{bg}(?:-{image})?{WS}*:{WS}*([^;}}]+)",
        bg = ci("background"),
        image = ci("image")
    )
);
re!(BURIED_URL_RE, format!(r"{}\(", ci("url")));
re!(BURIED_GRADIENT_RE, format!(r"{}\(", ci("gradient")));
re!(
    BURIED_GRADIENT_FN_RE,
    format!(
        r"(?:{linear}|{radial}|{conic})-{gradient}\([^()]*(?:\([^()]*\)[^()]*)*\)",
        linear = ci("linear"),
        radial = ci("radial"),
        conic = ci("conic"),
        gradient = ci("gradient")
    )
);
re!(
    BURIED_ALPHA_RE,
    format!(
        r"{rgb}[aA]?\({WS}*[0-9.]+%?{WS}*,?{WS}*[0-9.]+%?{WS}*,?{WS}*[0-9.]+%?{WS}*(?:[,/]{WS}*([0-9.]+%?))?{WS}*\)|{hsl}[aA]?\([^)]*?(?:[,/]{WS}*([0-9.]+%?))?{WS}*\)",
        rgb = ci("rgb"),
        hsl = ci("hsl")
    )
);
re!(
    BURIED_COLOR_FN_STRIP_RE,
    format!(
        r"{rgb}[aA]?\([^)]*\)|{hsl}[aA]?\([^)]*\)",
        rgb = ci("rgb"),
        hsl = ci("hsl")
    )
);
re!(BURIED_HEX_RE, r"#([0-9a-fA-F]{3,8})(?-u:\b)".to_string());
re!(
    BURIED_NAMED_RE,
    format!(
        r"{B}(?:{}){B}",
        ["white", "black", "ivory", "beige", "linen", "snow", "cream"]
            .iter()
            .map(|w| ci(w))
            .collect::<Vec<_>>()
            .join("|")
    )
);
re!(
    BURIED_BG_BLEND_RE,
    format!(
        r"{background}-{blend}-{mode}{WS}*:{WS}*",
        background = ci("background"),
        blend = ci("blend"),
        mode = ci("mode")
    )
);
re!(
    BURIED_MIX_BLEND_RE,
    format!(
        r"{mix}-{blend}-{mode}{WS}*:{WS}*",
        mix = ci("mix"),
        blend = ci("blend"),
        mode = ci("mode")
    )
);

/// JS `/…-blend-mode\s*:\s*(?!normal)/i.test(rule)`. The lookahead's
/// backtracking means the test fails only when `normal` follows the colon
/// with no whitespace at all (with whitespace, a shorter `\s*` leaves the
/// probe on the space, where `(?!normal)` succeeds).
// JS-PARITY: checks.mjs#scanCssTextForBuriedRaster blend-mode guard,
// backtracking bug included.
fn blend_mode_declared_not_normal(rule: &str, re: &Regex) -> bool {
    for m in re.find_iter(rule) {
        let after_colon = {
            // Position right after the `:` (before `\s*`).
            let matched = m.as_str();
            let colon = matched
                .rfind(':')
                .map(|c| m.start() + c + 1)
                .unwrap_or(m.end());
            &rule[colon..]
        };
        // Every position the JS `\s*` could leave the probe at.
        let mut positions: Vec<usize> = vec![0];
        for (i, c) in after_colon.char_indices() {
            if is_js_ws(c) {
                positions.push(i + c.len_utf8());
            } else {
                break;
            }
        }
        for &k in &positions {
            let probe = after_colon[k..].as_bytes();
            let starts_normal = probe.len() >= 6 && probe[..6].eq_ignore_ascii_case(b"normal");
            if !starts_normal {
                return true;
            }
        }
    }
    false
}

fn is_js_ws(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\x0B' | '\x0C' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

/// JS alphaOf: an alpha token normalized to 0..1 ('0.8' -> 0.8, '80%' -> 0.8).
fn buried_alpha_of(a: Option<&str>) -> f64 {
    let Some(a) = a else { return 1.0 };
    let v = parse_float(a);
    if js::trim(a).ends_with('%') {
        v / 100.0
    } else {
        v
    }
}

/// JS: checks.mjs#scanCssTextForBuriedRaster
pub fn scan_css_text_for_buried_raster(style_text: &str) -> Vec<PatternFinding> {
    let mut findings = Vec::new();
    for m in BURIED_DECL_RE.captures_iter(style_text) {
        let value = m.get(1).map(|g| g.as_str()).unwrap_or("");
        let decl_index = m.get(0).unwrap().start();
        if !BURIED_URL_RE.is_match(value) || !BURIED_GRADIENT_RE.is_match(value) {
            continue;
        }
        // a blend mode declared in the same rule keeps the raster visible
        let rule_start = last_index_of_byte(style_text, b'{', decl_index).unwrap_or(0);
        let rule_end = style_text[decl_index..]
            .find('}')
            .map(|p| p + decl_index)
            .unwrap_or(style_text.len());
        let rule = &style_text[rule_start..rule_end];
        if blend_mode_declared_not_normal(rule, &BURIED_BG_BLEND_RE)
            || blend_mode_declared_not_normal(rule, &BURIED_MIX_BLEND_RE)
        {
            continue;
        }
        // Layers are painted first-on-top: only a wash listed BEFORE the
        // url() covers it. An image on top of a gradient is not buried.
        let first_url = match BURIED_URL_RE.find(value) {
            Some(u) => u.start(),
            None => continue,
        };
        let gradients: Vec<&str> = BURIED_GRADIENT_FN_RE
            .find_iter(value)
            .filter(|gm| gm.start() < first_url)
            .map(|gm| gm.as_str())
            .collect();
        let mut opaque_wash = false;
        for g in gradients {
            let mut alphas: Vec<f64> = BURIED_ALPHA_RE
                .captures_iter(g)
                .map(|a| buried_alpha_of(a.get(1).or_else(|| a.get(2)).map(|g| g.as_str())))
                .collect();
            let stripped = BURIED_COLOR_FN_STRIP_RE.replace_all(g, "").into_owned();
            // hex stops: 4- and 8-digit forms carry their own alpha
            for h in BURIED_HEX_RE.captures_iter(&stripped) {
                let hex = &h[1];
                if hex.len() == 4 {
                    let d = &hex[3..4];
                    alphas.push(crate::js::parse_int(&format!("{d}{d}"), 16) / 255.0);
                } else if hex.len() == 8 {
                    alphas.push(crate::js::parse_int(&hex[6..], 16) / 255.0);
                } else {
                    alphas.push(1.0);
                }
            }
            if BURIED_NAMED_RE.is_match(&stripped) {
                alphas.push(1.0);
            }
            if !alphas.is_empty() && alphas.iter().all(|a| !a.is_finite() || *a >= 0.9) {
                opaque_wash = true;
                break;
            }
        }
        if !opaque_wash {
            continue;
        }
        findings.push(PatternFinding {
            id: "buried-raster".to_string(),
            snippet: format!(
                "raster under a near-opaque gradient wash: {}",
                crate::js_ext_b::slice_utf16_prefix(js::trim(value), 90)
            ),
            selector: enclosing_css_selector(style_text, decl_index),
            index: None,
            severity: None,
        });
    }
    findings
}

re!(MARQUEE_TAG_RE, format!(r"<{}{B}", ci("marquee")));

/// JS: checks.mjs#scanCssTextForMarquee. `markup` defaults to `content`.
pub fn scan_css_text_for_marquee(content: &str, markup: Option<&str>) -> Vec<PatternFinding> {
    let markup = markup.unwrap_or(content);
    let mut findings = Vec::new();
    if MARQUEE_TAG_RE.is_match(markup) {
        findings.push(PatternFinding {
            id: "marquee".to_string(),
            snippet: "<marquee> element".to_string(),
            selector: Some("marquee".to_string()),
            index: None,
            severity: None,
        });
    }
    let marquee_keyframes = collect_marquee_keyframes(content);
    if marquee_keyframes.is_empty() {
        return findings;
    }
    let mut seen: Vec<String> = Vec::new();
    for m in CSS_RULE_BLOCK_RE.captures_iter(content) {
        let selector = js::trim(&m[1]);
        let decls = parse_css_decl_block(&m[2]);
        for name in infinite_animation_names(&decls) {
            if !marquee_keyframes.contains(&name) {
                continue;
            }
            let key = format!("{} {}", selector, name);
            if seen.contains(&key) {
                continue;
            }
            seen.push(key);
            findings.push(PatternFinding {
                id: "marquee".to_string(),
                snippet: format!(
                    "{} — infinite horizontal loop animation \"{}\"",
                    selector, name
                ),
                selector: Some(selector.to_string()),
                index: None,
                severity: None,
            });
        }
    }
    findings
}

re!(PCT_VALUE_RE, r"^([0-9.]+)%$".to_string());

/// JS: checks.mjs#isRoundDotRadius
pub fn is_round_dot_radius(radius_value: &str, w: f64, h: f64) -> bool {
    if radius_value.is_empty() {
        return false;
    }
    let trimmed = js::trim(radius_value);
    let first = split_ws(trimmed)[0];
    if let Some(pm) = PCT_VALUE_RE.captures(first) {
        return parse_float(&pm[1]) >= 40.0;
    }
    match css_length_to_px(first) {
        None => false,
        Some(px) => px >= 999.0 || px >= 0.4 * math_min(w, h),
    }
}

// ─── scanCssTextForPulsingDot ───────────────────────────────────────────────
re!(
    PULSE_NAME_RE,
    format!("{}|{}|{}", ci("pulse"), ci("blink"), ci("ping"))
);
re!(
    CLASS_ATTR_RE,
    format!(
        r#"{cls}{WS}*={WS}*(?:"([^"]*)"|'([^']*)')"#,
        cls = ci("class")
    )
);
re!(TW_ANIMATE_RE, format!(r"{B}animate-(ping|pulse){B}"));
re!(TW_ROUNDED_FULL_RE, format!(r"{B}rounded-full{B}"));
re!(
    TW_TINY_SIZE_RE,
    format!(r"{B}(?:w|h|size)-(?:1|1\.5|2|2\.5|3|3\.5|4){B}")
);

/// JS: checks.mjs#scanCssTextForPulsingDot. `markup` defaults to `content`.
pub fn scan_css_text_for_pulsing_dot(content: &str, markup: Option<&str>) -> Vec<PatternFinding> {
    let markup = markup.unwrap_or(content);
    let custom_props = collect_css_custom_props(content);
    let keyframes = collect_pulse_keyframes(content);
    let hero_ranges = landmark_source_ranges(markup);
    let mut findings = Vec::new();
    let mut seen: Vec<String> = Vec::new();

    let stripped = strip_reduced_motion_blocks(content);
    let scan_text = COMMENT_RE.replace_all(&stripped, " ").into_owned();
    let mut merged: JsMap<DeclMap> = JsMap::new();
    for m in CSS_RULE_BLOCK_RE.captures_iter(&scan_text) {
        let decls = parse_css_decl_block(&m[2]);
        if decls.is_empty() {
            continue;
        }
        for raw_selector in m[1].split(',') {
            let selector = js::trim(raw_selector);
            if selector.is_empty() || selector.starts_with('@') {
                continue;
            }
            if !merged.has(selector) {
                merged.set(selector, JsMap::new());
            }
            let acc = merged.get_mut(selector).unwrap();
            for (prop, value) in decls.iter() {
                acc.set(prop, value.clone());
            }
        }
    }

    for (selector, decls) in merged.iter() {
        let names = infinite_animation_names(decls);
        if names.is_empty() {
            continue;
        }
        let pulse_name = names.iter().find(|n| match keyframes.get(n) {
            Some(known) => *known,
            None => PULSE_NAME_RE.is_match(n),
        });
        let pulse_name = match pulse_name {
            Some(p) => p,
            None => continue,
        };
        let w = css_length_to_px(&resolve_var_refs(
            get_or(decls, "width", "inline-size"),
            &custom_props,
        ));
        let h = css_length_to_px(&resolve_var_refs(
            get_or(decls, "height", "block-size"),
            &custom_props,
        ));
        let (w, h) = match (w, h) {
            (Some(w), Some(h)) => (w, h),
            _ => continue,
        };
        if w < 2.0 || h < 2.0 || w > 16.0 || h > 16.0 {
            continue;
        }
        let radius = resolve_var_refs(
            decls.get("border-radius").map(|s| s.as_str()).unwrap_or(""),
            &custom_props,
        );
        if !is_round_dot_radius(&radius, w, h) {
            continue;
        }
        if seen.iter().any(|s| s == selector) {
            continue;
        }
        seen.push(selector.clone());
        let in_landmark = selector_hits_landmark(markup, selector, &hero_ranges);
        findings.push(PatternFinding {
            id: "pulsing-dot".to_string(),
            snippet: format!(
                "{} — {}x{}px dot with infinite \"{}\" animation{}",
                selector,
                number_to_string(w),
                number_to_string(h),
                pulse_name,
                if in_landmark { " in header/nav" } else { "" }
            ),
            selector: Some(selector.clone()),
            index: None,
            severity: if in_landmark {
                Some("error".to_string())
            } else {
                None
            },
        });
    }

    for cm in CLASS_ATTR_RE.captures_iter(markup) {
        let cls = cm
            .get(1)
            .or_else(|| cm.get(2))
            .map(|m| m.as_str())
            .filter(|s| !s.is_empty())
            .unwrap_or("");
        let anim = match TW_ANIMATE_RE.captures(cls) {
            Some(a) => a[1].to_string(),
            None => continue,
        };
        if !TW_ROUNDED_FULL_RE.is_match(cls) {
            continue;
        }
        if !TW_TINY_SIZE_RE.is_match(cls) {
            continue;
        }
        let key = format!("tw:{}", cls);
        if seen.contains(&key) {
            continue;
        }
        seen.push(key);
        let in_landmark = index_in_source_ranges(cm.get(0).unwrap().start(), &hero_ranges);
        findings.push(PatternFinding {
            id: "pulsing-dot".to_string(),
            snippet: format!(
                "animate-{} on tiny rounded-full element{}",
                anim,
                if in_landmark { " in header/nav" } else { "" }
            ),
            selector: None,
            index: None,
            severity: if in_landmark {
                Some("error".to_string())
            } else {
                None
            },
        });
    }

    findings
}

#[cfg(test)]
mod tests {
    use super::*;

    // Expected values come from running the JS functions in Node.

    fn dark(c: &str) -> bool {
        css_text_has_dark_root_bg(c, &collect_css_custom_props(c))
    }

    #[test]
    fn dark_root_bg_matches_node() {
        assert!(dark("body { background: #111827; }"));
        assert!(dark(":root{--bg:#0b0b0f} body{background:var(--bg)}"));
        assert!(dark(".chip{background:#000}"));
        assert!(dark("body{background: rgb(20, 20, 30)}"));
        assert!(!dark("body{background: rgba(0,0,0,0.3)}"));
        assert!(dark("<body style=\"background:#101010\">"));
        assert!(dark("html, .x { background-color: #0a0a0a }"));
        assert!(!dark("x{}body{color:red}"));
        assert!(dark("div{background:#fff} .card{ background: #123 }"));
        assert!(dark("<div class=\"bg-slate-900\">"));
    }

    #[test]
    fn enclosing_selector_matches_node() {
        let cases: &[(&str, usize, Option<&str>)] = &[
            (".a { color: red }", 8, Some(".a")),
            ("@media (x) { .b { c: d } }", 20, None),
            ("@media (x) { .b { c: d } }", 12, None),
            ("50% { c: d }", 6, None),
            ("from, to { c: d }", 12, None),
            ("a;b{c}", 4, Some("b")),
            ("{c}", 1, None),
            ("x", 0, None),
            ("", 0, None),
            (".a\n .b   .c { d }", 12, Some(".a .b .c")),
            ("<style>.q{r}", 10, None),
            (".a{b}.c{d}", 8, Some(".c")),
            (".a { b }", 0, None),
        ];
        for (text, idx, want) in cases {
            assert_eq!(
                enclosing_css_selector(text, *idx).as_deref(),
                *want,
                "{text:?} @ {idx}"
            );
        }
    }

    #[test]
    fn zero_offset_matches_node() {
        for v in ["0", "-0", "0px", "0%", "0rem", "0em", " 0 "] {
            assert!(is_zero_offset(Some(v)), "{v}");
        }
        for v in ["0.0", "1px", "", "auto", "0vw"] {
            assert!(!is_zero_offset(Some(v)), "{v}");
        }
        assert!(!is_zero_offset(None));
    }

    #[test]
    fn pulse_keyframes_match_node() {
        let m = collect_pulse_keyframes("@keyframes spin{to{transform:rotate(360deg)}} @keyframes pulse{50%{opacity:.5}} @-webkit-keyframes ping{75%{transform:scale(2)}} @keyframes glow{0%{box-shadow:0 0 0 red}}");
        let got: Vec<(String, bool)> = m.iter().cloned().collect();
        assert_eq!(
            got,
            vec![
                ("spin".to_string(), false),
                ("pulse".to_string(), true),
                ("ping".to_string(), true),
                ("glow".to_string(), true)
            ]
        );
        let m = collect_pulse_keyframes(
            "@keyframes a{0%{opacity:1}} @keyframes a{0%{transform:rotate(1deg)}}",
        );
        assert_eq!(m.entries(), &[("a".to_string(), true)]);
        let m = collect_pulse_keyframes(
            "@keyframes b{0%{transform:rotate(1deg)}} @keyframes b{0%{opacity:0}}",
        );
        assert_eq!(m.entries(), &[("b".to_string(), true)]);
        let m = collect_pulse_keyframes("@keyframes unterminated{ 0%{opacity:1}");
        assert_eq!(m.entries(), &[("unterminated".to_string(), true)]);
        let m =
            collect_pulse_keyframes("@keyframes n {50%{transform: translateY(2px) scale(1.2)}}");
        assert_eq!(m.entries(), &[("n".to_string(), true)]);
    }

    #[test]
    fn infinite_names_match_node() {
        let names = |b: &str| infinite_animation_names(&parse_css_decl_block(b));
        assert_eq!(names("animation: pulse 2s infinite"), vec!["pulse"]);
        assert_eq!(
            names("animation: 2s ease-in-out infinite pulse, spin 1s linear infinite"),
            vec!["pulse", "spin"]
        );
        assert!(names("animation: pulse 2s").is_empty());
        assert_eq!(
            names("animation-name: a, b, none; animation-iteration-count: infinite"),
            vec!["a", "b"]
        );
        assert!(names("animation-name: a; animation-iteration-count: 3").is_empty());
        assert!(names("animation: infinite 1s ease").is_empty());
        assert_eq!(
            names("animation: 3s cubic-bezier(0,0,1,1) infinite Blink"),
            vec!["Blink"]
        );
        assert_eq!(names("animation: 1s INFINITE my-anim"), vec!["my-anim"]);
    }

    #[test]
    fn decl_block_matches_node() {
        let d = parse_css_decl_block("color: red !important; width : 4PX ;;:x; a:; :b; b: 1: 2");
        assert_eq!(
            d.entries(),
            &[
                ("color".to_string(), "red".to_string()),
                ("width".to_string(), "4PX".to_string()),
                ("b".to_string(), "1: 2".to_string())
            ]
        );
        let d = parse_css_decl_block("Color:Red;color:blue");
        assert_eq!(d.entries(), &[("color".to_string(), "blue".to_string())]);
        assert!(parse_css_decl_block("").is_empty());
        assert!(parse_css_decl_block("x").is_empty());
    }

    #[test]
    fn round_dot_radius_matches_node() {
        let cases: &[(&str, f64, f64, bool)] = &[
            ("50%", 8.0, 8.0, true),
            ("40%", 8.0, 8.0, true),
            ("39.9%", 8.0, 8.0, false),
            ("999px", 8.0, 8.0, true),
            ("4px", 8.0, 8.0, true),
            ("3px", 8.0, 8.0, false),
            ("3px", 8.0, 6.0, true),
            ("9999px 0", 8.0, 8.0, true),
            ("", 8.0, 8.0, false),
            ("auto", 8.0, 8.0, false),
            ("1rem", 8.0, 8.0, true),
            ("0.25rem", 10.0, 10.0, true),
            ("50% 20%", 8.0, 8.0, true),
            ("  50%", 8.0, 8.0, true),
        ];
        for (r, w, h, want) in cases {
            assert_eq!(is_round_dot_radius(r, *w, *h), *want, "{r:?}");
        }
    }

    #[test]
    fn strip_reduced_motion_matches_node() {
        assert_eq!(
            strip_reduced_motion_blocks(
                "a{b:c} @media (prefers-reduced-motion: reduce) { .x { animation: none } } d{e:f}"
            ),
            "a{b:c}  d{e:f}"
        );
        assert_eq!(
            strip_reduced_motion_blocks(
                "@media screen and (prefers-reduced-motion:reduce){a{b:c}}tail"
            ),
            "tail"
        );
        assert_eq!(
            strip_reduced_motion_blocks("no media here"),
            "no media here"
        );
        assert_eq!(
            strip_reduced_motion_blocks("@media (prefers-reduced-motion: reduce) { unterminated"),
            ""
        );
        let keep = "@media (prefers-reduced-motion: no-preference) { a{b:c} }";
        assert_eq!(strip_reduced_motion_blocks(keep), keep);
    }

    #[test]
    fn landmarks_match_node() {
        assert_eq!(
            landmark_source_ranges("<header><nav>x</nav></header><nav>y</nav>"),
            vec![(0, 20), (8, 14), (29, 35)]
        );
        assert_eq!(
            landmark_source_ranges("<HEADER class=\"a\"><div>b</div></HEADER >"),
            vec![(0, 30)]
        );
        assert!(landmark_source_ranges("<headerx></headerx>").is_empty());
        assert!(landmark_source_ranges("</nav><nav>").is_empty());
        assert_eq!(
            landmark_source_ranges("<header><header></header>"),
            vec![(8, 16)]
        );
        assert!(!index_in_source_ranges(5, &[(0, 5)]));
        assert!(index_in_source_ranges(4, &[(0, 5)]));
        assert!(index_in_source_ranges(0, &[(0, 5)]));
        assert!(!index_in_source_ranges(3, &[]));
    }

    #[test]
    fn selector_hits_landmark_matches_node() {
        let html1 = "<header><div class=\"live-dot x\">a</div><span id=\"pulse\">b</span></header><div class=\"live-dot-x\">c</div><nav><i class=\"dot\"></i></nav>";
        let r1 = landmark_source_ranges(html1);
        let cases: &[(&str, bool)] = &[
            (".live-dot", true),
            (".live-dot-x", false),
            ("#pulse", true),
            ("#PULSE", true),
            ("div", false),
            (".a > .live-dot", true),
            (".x", true),
            (".dot", true),
            ("header .live-dot::before", true),
            (".dot,.nope", true),
            (".nope", false),
        ];
        for (sel, want) in cases {
            assert_eq!(selector_hits_landmark(html1, sel, &r1), *want, "{sel}");
        }
        let html2 = "<div data-id=\"q\" class=\"a\">1</div><header><p class=\"b\" data-class=\"q\">2</p><em id=\"q\">3</em></header>";
        let r2 = landmark_source_ranges(html2);
        assert!(selector_hits_landmark(html2, "#q", &r2));
        assert!(selector_hits_landmark(html2, ".q", &r2));
        assert!(selector_hits_landmark(html2, ".b", &r2));
        assert!(!selector_hits_landmark(html2, ".a", &r2));
        let html3 = "<header><a class='dot two'>x</a></header>";
        let r3 = landmark_source_ranges(html3);
        assert!(selector_hits_landmark(html3, ".two", &r3));
        assert!(!selector_hits_landmark(html3, ".tw", &r3));
    }

    #[test]
    fn var_refs_match_node() {
        let cp = collect_css_custom_props(":root{--a: var(--b); --b: #123; --c: var(--c)}");
        assert_eq!(resolve_var_refs("var(--a)", &cp), "#123");
        assert_eq!(resolve_var_refs("var(--zz, red)", &cp), "red");
        assert_eq!(resolve_var_refs("var(--zz)", &cp), "var(--zz)");
        assert_eq!(resolve_var_refs("var( --b , 1px )", &cp), "#123");
        assert_eq!(resolve_var_refs("x var(--c) y", &cp), "x var(--c) y");
        assert_eq!(resolve_var_refs("plain", &cp), "plain");
        assert_eq!(resolve_var_refs("var(--zz, )", &cp), "");
    }

    #[test]
    fn pseudo_stripe_lookarounds_match_node() {
        let h = |sel: &str| {
            format!("{sel}::before{{position:absolute;height:4px;left:0;right:0;top:0;background:#3b82f6}}")
        };
        let flags = |css: &str| !scan_css_text_for_pseudo_stripe(css).is_empty();
        assert!(!flags(&h(".card a")));
        assert!(flags(&h(".card .ab")));
        assert!(!flags(&h(".card [aria-current]")));
        assert!(!flags(&h(".card [aria-current=\"false\"]")));
        assert!(!flags(&h(".card .btn-x")));
        assert!(!flags(&h(".card .active-x")));
        assert!(flags(&h(".card .activex")));
        assert!(flags(&h(".card .xactive")));
        assert!(!flags(&h(".tabs [aria-selected]")));
        assert!(!flags(&h(".tabs [aria-selected=true]")));
        let li = scan_css_text_for_pseudo_stripe(
            "li::before{position:absolute;width:4px;left:0;top:0;bottom:0;background:#3b82f6}",
        );
        assert_eq!(
            li[0].snippet,
            "li::before — absolute 4px pseudo-element stripe (left: 0)"
        );
        let floating = scan_css_text_for_pseudo_stripe(
            ".x::before{position:absolute;width:4px;left:0;top:2px;bottom:3px;background:oklch(0.7 0.2 30)}",
        );
        assert_eq!(floating.len(), 1);
        let commented = scan_css_text_for_pseudo_stripe(
            "/* .c::before{position:absolute;width:4px;left:0;top:0;bottom:0;background:red} */ .d::after{position:absolute;width:4px;left:0;top:0;bottom:0;background:red}",
        );
        assert_eq!(commented.len(), 1);
        assert_eq!(commented[0].index, Some(83));
        assert_eq!(commented[0].selector.as_deref(), Some(".d::after"));
    }

    #[test]
    fn unicode_inputs_do_not_panic() {
        let samples = [
            "é.a::before{position:absolute;width:4px;left:0;top:0;bottom:0;background:#3b82f6}/*😀*/",
            "@keyframes 😀x{to{transform:translateX(-50%)}} .m{animation:😀x 1s infinite}",
            "<header><div class=\"dot😀 dot\" id=\"é\">x</div></header>.dot{width:8px;height:8px;border-radius:50%;animation:pulse 1s infinite}",
            "body{background:#000} .x{box-shadow:0 0 20px #f00; background: radial-gradient(#f00, transparent)}",
            "@media (prefers-reduced-motion: reduce){.a{b:c}}😀",
            "<svg width=\"300é\" viewBox=\"0 0 400 300\"><rect fill=\"a\"/><rect fill=\"b\"/><rect fill=\"c\"/><circle/><circle/><circle/><ellipse/><polygon/></svg>",
            "😀",
            "{😀",
            "@keyframes k{",
        ];
        for s in samples {
            let _ = scan_css_text_for_pseudo_stripe(s);
            let _ = scan_css_text_for_inset_stripe(s);
            let _ = scan_css_text_for_pulsing_dot(s, None);
            let _ = scan_css_text_for_marquee(s, None);
            let _ = scan_css_text_for_glow(s);
            let _ = scan_css_text_for_grid_background(s);
            let _ = scan_css_text_for_radial_halo(s);
            let _ = collect_marquee_keyframes(s);
            let _ = collect_pulse_keyframes(s);
            let _ = strip_reduced_motion_blocks(s);
            let _ = enclosing_css_selector(s, s.len());
            let _ = crate::checks::html_patterns::check_html_patterns(s, None);
            let _ = crate::checks::html_patterns::scan_html_for_shape_assembled_illustration(s);
        }
    }
}
