//! Page-level checks: `checkStaticPageTypography` (detect-html.mjs) and the
//! Section 6 document walks from `checks.mjs` (`isCardLike`,
//! `checkPageLayout`, `collectRepeatedContainerTextFindings`,
//! `checkRepeatedContainerTextFromDoc`, `checkCreamPalette`).

use crate::adapters::{class_selector, StyleRef};
use crate::background::{read_own_background_color, resolve_border_radius_px, sv};
use crate::dom::{StaticDocument, StaticElement};
use crate::quality::{has_nonblank_direct_text, pf0};
use impeccable_core::checks::measures::{cream_from_class_list, is_cream_color};
use impeccable_core::checks::rules::{is_card_like_from_props, RuleHit};
use impeccable_core::checks::text_rules::{
    is_repeated_text_container, REPEATED_TEXT_CONTAINER_TAGS, REPEATED_TEXT_SKIP_SELECTOR,
};
use impeccable_core::constants::{CSS_GENERIC_FONTS, OVERUSED_FONTS, SAFE_TAGS};
use impeccable_core::js::{self, math_round, number_to_string, parse_float, to_fixed};
use impeccable_core::js_ext_b::{slice_utf16_prefix, utf16_len};
use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::HashSet;

static WS_RE: Lazy<Regex> = Lazy::new(|| Regex::new(&format!("{}+", js::WS)).expect("WS_RE"));

/// `f.trim().replace(/^['"]|['"]$/g, '').toLowerCase()`
fn font_token(f: &str) -> String {
    let t = js::trim(f);
    let t = t.strip_prefix(['\'', '"']).unwrap_or(t);
    let t = t.strip_suffix(['\'', '"']).unwrap_or(t);
    js::to_lower_case(t)
}

/// JS: detect-html.mjs#checkStaticPageTypography(document, window)
pub fn check_static_page_typography(doc: &StaticDocument) -> Vec<RuleHit> {
    let mut findings = Vec::new();
    let mut overused_found: Vec<String> = Vec::new();
    for el in doc.query_selector_all(
        "p, h1, h2, h3, h4, h5, h6, li, td, th, dd, blockquote, figcaption, a, button, label, span, div",
    ) {
        if !has_nonblank_direct_text(&el) {
            continue;
        }
        let ff = sv(el.style(), "fontFamily");
        // JS-PARITY: detect-html.mjs#checkStaticPageTypography uses
        // primaryFontFace(ff) whose default skip is CSS_GENERIC_FONTS, so a
        // system stack keeps its system face as primary (fix #678).
        let primary = ff
            .split(',')
            .map(font_token)
            .find(|f| !f.is_empty() && !CSS_GENERIC_FONTS.contains(&f.as_str()));
        let Some(primary) = primary else {
            continue;
        };
        if OVERUSED_FONTS.contains(&primary.as_str()) && !overused_found.contains(&primary) {
            overused_found.push(primary);
        }
    }
    for font in &overused_found {
        findings.push(RuleHit::new(
            "overused-font",
            format!("Primary font: {}", font),
        ));
    }
    let mut sizes: Vec<f64> = Vec::new();
    for el in
        doc.query_selector_all("h1, h2, h3, h4, h5, h6, p, span, a, li, td, th, label, button, div")
    {
        let font_size = parse_float(sv(el.style(), "fontSize"));
        if font_size >= 8.0 && font_size < 200.0 {
            let v = math_round(font_size * 10.0) / 10.0;
            if !sizes.contains(&v) {
                sizes.push(v);
            }
        }
    }
    if sizes.len() >= 3 {
        let mut sorted = sizes.clone();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let ratio = sorted[sorted.len() - 1] / sorted[0];
        if ratio < 2.0 {
            let list: Vec<String> = sorted
                .iter()
                .map(|s| format!("{}px", number_to_string(*s)))
                .collect();
            findings.push(RuleHit::new(
                "flat-type-hierarchy",
                format!(
                    "Sizes: {} (ratio {}:1)",
                    list.join(", "),
                    to_fixed(ratio, 1)
                ),
            ));
        }
    }
    findings
}

// ─── Nested cards ───────────────────────────────────────────────────────────

static SHADOW_CLASS_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?-u:\b)shadow(?:-sm|-md|-lg|-xl|-2xl)?(?-u:\b)").expect("SHADOW_CLASS_RE")
});
static BOX_SHADOW_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new("(?i)box-shadow").expect("BOX_SHADOW_RE"));
static BORDER_CLASS_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?-u:\b)border(?-u:\b)").expect("BORDER_CLASS_RE"));
static ROUNDED_CLASS_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?-u:\b)rounded(?:-sm|-md|-lg|-xl|-2xl|-full)?(?-u:\b)").expect("ROUNDED_CLASS_RE")
});
static BORDER_RADIUS_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new("(?i)border-radius").expect("BORDER_RADIUS_RE"));
static BG_CLASS_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?-u:\b)bg-(?:white|gray-[0-9]+|slate-[0-9]+)(?-u:\b)").expect("BG_CLASS_RE")
});
static BG_DECL_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        r"(?i)background(?:-color)?{ws}*:({ws}*)",
        ws = js::WS
    ))
    .expect("BG_DECL_RE")
});
static POSITIONED_CLASS_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?-u:\b)(?:absolute|fixed)(?-u:\b)").expect("POSITIONED_CLASS_RE"));
static POSITIONED_STYLE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        r"(?i)position{ws}*:{ws}*(?:absolute|fixed)",
        ws = js::WS
    ))
    .expect("POSITIONED_STYLE_RE")
});
static OVERLAY_CLASS_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(?-u:\b)(?:dropdown|popover|tooltip|menu|modal|dialog)(?-u:\b)")
        .expect("OVERLAY_CLASS_RE")
});

/// JS `/background(?:-color)?\s*:\s*(?!transparent)/i.test(rawStyle)`. With
/// backtracking, `\s*` gives back whitespace until the lookahead sees a
/// space, so the test only fails when `transparent` follows the colon with
/// no whitespace at all.
fn bg_decl_not_transparent(raw_style: &str) -> bool {
    for m in BG_DECL_RE.captures_iter(raw_style) {
        let ws = m.get(1).map(|g| g.as_str()).unwrap_or("");
        if !ws.is_empty() {
            return true;
        }
        let rest = &raw_style[m.get(0).unwrap().end()..];
        let head: String = rest.chars().take("transparent".len()).collect();
        if !head.eq_ignore_ascii_case("transparent") {
            return true;
        }
    }
    false
}

/// JS: checks.mjs#isCardLike(el, win)
pub fn is_card_like(el: &StaticElement<'_>) -> bool {
    let tag = el.tag_lower();
    if SAFE_TAGS.contains(&tag.as_str())
        || matches!(
            tag.as_str(),
            "input" | "select" | "textarea" | "img" | "video" | "canvas" | "picture"
        )
    {
        return false;
    }
    let style = el.style();
    let raw_style = el.get_attribute("style").unwrap_or("");
    let cls = el.get_attribute("class").unwrap_or("");
    let box_shadow = sv(style, "boxShadow");
    let has_shadow = (!box_shadow.is_empty() && box_shadow != "none")
        || SHADOW_CLASS_RE.is_match(cls)
        || BOX_SHADOW_RE.is_match(raw_style);
    let has_border = BORDER_CLASS_RE.is_match(cls);
    let width_px = pf0(sv(style, "width"));
    let has_radius = resolve_border_radius_px(style, width_px) > 0.0
        || ROUNDED_CLASS_RE.is_match(cls)
        || BORDER_RADIUS_RE.is_match(raw_style);
    let has_bg = BG_CLASS_RE.is_match(cls) || bg_decl_not_transparent(raw_style);
    is_card_like_from_props(has_shadow, has_border, has_radius, has_bg)
}

/// JS: checks.mjs#checkPageLayout(doc, win)
pub fn check_page_layout(doc: &StaticDocument) -> Vec<RuleHit> {
    let mut findings = Vec::new();
    let all = doc.query_selector_all("*");
    let mut flagged: Vec<StaticElement<'_>> = Vec::new();
    for el in &all {
        if !is_card_like(el) {
            continue;
        }
        if flagged.contains(el) {
            continue;
        }
        let tag = el.tag_lower();
        let cls = el.get_attribute("class").unwrap_or("");
        let raw_style = el.get_attribute("style").unwrap_or("");
        if tag == "pre" || tag == "code" {
            continue;
        }
        if POSITIONED_CLASS_RE.is_match(cls) || POSITIONED_STYLE_RE.is_match(raw_style) {
            continue;
        }
        if utf16_len(js::trim(&el.text_content())) < 10 {
            continue;
        }
        if OVERLAY_CLASS_RE.is_match(cls) {
            continue;
        }
        let mut parent = el.parent_element();
        while let Some(p) = parent {
            if is_card_like(&p) {
                flagged.push(*el);
                break;
            }
            parent = p.parent_element();
        }
    }
    for el in &flagged {
        let is_ancestor_of_flagged = flagged
            .iter()
            .any(|other| other != el && el.contains(other));
        if !is_ancestor_of_flagged {
            findings.push(RuleHit::new(
                "nested-cards",
                format!("Card inside card ({})", el.tag_lower()),
            ));
        }
    }
    findings
}

// ─── Repeated container text ────────────────────────────────────────────────

static ICON_CLASS_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        r"(?i)icon|material-symbols|(?:^|{ws})fa[srlbd]?(?:{ws}|-|$)",
        ws = js::WS
    ))
    .expect("ICON_CLASS_RE")
});
static ALPHA_RE: Lazy<Regex> = Lazy::new(|| Regex::new("[a-zA-Z]").expect("ALPHA_RE"));

fn is_visible(el: &StaticElement<'_>) -> bool {
    sv(el.style(), "display") != "none"
}

/// JS: checks.mjs#collectRepeatedContainerTextFindings(doc, getStyle, opts)
/// with `isVisible = display !== 'none'` (`checkRepeatedContainerTextFromDoc`).
pub fn check_repeated_container_text_from_doc(doc: &StaticDocument) -> Vec<RuleHit> {
    let mut findings = Vec::new();
    let mut containers: Vec<StaticElement<'_>> = Vec::new();
    let mut container_set: HashSet<ego_tree::NodeId> = HashSet::new();
    for el in doc.query_selector_all("*") {
        if !REPEATED_TEXT_CONTAINER_TAGS.contains(&el.tag_lower().as_str()) {
            continue;
        }
        if el.closest(REPEATED_TEXT_SKIP_SELECTOR).is_some() {
            continue;
        }
        if !is_repeated_text_container(Some(&StyleRef(el.style()))) {
            continue;
        }
        containers.push(el);
        container_set.insert(el.id());
    }

    for container in &containers {
        if !is_visible(container) {
            continue;
        }
        let descendants = container.query_selector_all("*");
        if descendants.len() > 250 {
            continue;
        }
        // text -> signatures, in first-seen order.
        let mut groups: Vec<(String, Vec<String>)> = Vec::new();
        for d in &descendants {
            let mut anc = d.parent_element();
            let mut owned_by_inner = false;
            while let Some(a) = anc {
                if a == *container {
                    break;
                }
                if container_set.contains(&a.id()) {
                    owned_by_inner = true;
                    break;
                }
                anc = a.parent_element();
            }
            if owned_by_inner {
                continue;
            }
            if d.closest(REPEATED_TEXT_SKIP_SELECTOR).is_some() {
                continue;
            }
            if ICON_CLASS_RE.is_match(d.get_attribute("class").unwrap_or("")) {
                continue;
            }
            if !is_visible(d) {
                continue;
            }
            let direct = crate::adapters::clean_inline_text(d);
            let len = utf16_len(&direct);
            if !(4..=48).contains(&len) {
                continue;
            }
            if !ALPHA_RE.is_match(&direct) {
                continue;
            }
            let mut sig: Vec<String> = Vec::new();
            let mut cur = Some(*d);
            while let Some(c) = cur {
                if c == *container {
                    break;
                }
                let raw_cls = js::trim(c.get_attribute("class").unwrap_or(""));
                let mut cls: Vec<&str> = if raw_cls.is_empty() {
                    Vec::new()
                } else {
                    WS_RE.split(raw_cls).filter(|s| !s.is_empty()).collect()
                };
                cls.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
                let cls = cls.join(".");
                sig.push(if cls.is_empty() {
                    c.tag_lower()
                } else {
                    format!("{}.{}", c.tag_lower(), cls)
                });
                cur = c.parent_element();
            }
            let joined = sig.join(">");
            match groups.iter_mut().find(|(t, _)| *t == direct) {
                Some((_, sigs)) => sigs.push(joined),
                None => groups.push((direct, vec![joined])),
            }
        }
        for (text, sigs) in &groups {
            if sigs.len() < 3 {
                continue;
            }
            let distinct: HashSet<&String> = sigs.iter().collect();
            if distinct.len() < 3 {
                continue;
            }
            findings.push(RuleHit::new(
                "repeated-container-text",
                format!(
                    "\"{}\" rendered {}× in distinct spots inside {}",
                    slice_utf16_prefix(text, 40),
                    sigs.len(),
                    class_selector(container)
                ),
            ));
        }
    }
    findings
}

// ─── Cream palette ──────────────────────────────────────────────────────────

/// JS: checks.mjs#checkCreamPalette(doc, win)
pub fn check_cream_palette(doc: &StaticDocument) -> Vec<RuleHit> {
    let mut findings = Vec::new();
    let Some(body) = doc.body() else {
        return findings;
    };
    let html = doc.document_element();
    let mut bg = read_own_background_color(&body, body.style());
    if bg.is_none() || bg.is_some_and(|c| c.a == Some(0.0)) {
        if let Some(h) = html.as_ref() {
            bg = read_own_background_color(h, h.style());
        }
    }
    if is_cream_color(bg.as_ref()) {
        let c = bg.unwrap();
        findings.push(RuleHit::new(
            "cream-palette",
            format!(
                "cream/beige page background rgb({}, {}, {})",
                number_to_string(c.r),
                number_to_string(c.g),
                number_to_string(c.b)
            ),
        ));
        return findings;
    }
    for el in [Some(body), html] {
        let cls = el.and_then(|e| e.get_attribute("class")).unwrap_or("");
        if let Some(tok) = cream_from_class_list(Some(cls)) {
            findings.push(RuleHit::new(
                "cream-palette",
                format!("cream/beige page background (Tailwind {})", tok),
            ));
            break;
        }
    }
    findings
}
