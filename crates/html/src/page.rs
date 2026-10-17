//! Page-level checks: `checkStaticPageTypography` (detect-html.mjs) and the
//! Section 6 document walks from `checks.mjs` (`isCardLike`,
//! `checkPageLayout`, `collectRepeatedContainerTextFindings`,
//! `checkRepeatedContainerTextFromDoc`, `checkCreamPalette`).

use crate::adapters::{class_selector, StyleRef};
use crate::background::{read_own_background_color, resolve_border_radius_px, sv};
use crate::dom::{StaticDocument, StaticElement};
use crate::quality::{has_nonblank_direct_text, pf0};
use impeccable_core::checks::embedded_content::{
    control_of, is_media_control_name, is_output_chrome, is_play_name, visible_chars, Control,
    CAPTION_MAX_CHARS,
};
use impeccable_core::checks::measures::{cream_from_class_list, is_cream_color};
use impeccable_core::checks::rules::{
    check_flat_type_hierarchy_samples, flat_type_hierarchy_severity, is_card_like_from_props,
    parse_font_weight, type_hierarchy_role, RuleHit,
    TypeSample, TYPE_HIERARCHY_SELECTOR,
};
use impeccable_core::checks::text_rules::{
    is_repeated_text_container, REPEATED_TEXT_CONTAINER_TAGS, REPEATED_TEXT_SKIP_SELECTOR,
};
use impeccable_core::constants::{overused_font_name, CSS_GENERIC_FONTS, OVERUSED_FONTS, SAFE_TAGS};
use impeccable_core::js::{self, number_to_string, parse_float};
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
        let primary = overused_font_name(&primary).map_or(primary, str::to_string);
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
    findings.extend(check_flat_type_hierarchy_from_doc(doc));
    findings
}

/// JS: checks.mjs#isRenderedTypeElement over the static cascade.
///
/// JS-PARITY: jsdom's `el.hidden` reflects the `hidden` attribute, which the
/// attribute test already covers. `contentVisibility` only ever reads its
/// `STATIC_DEFAULT_STYLE` default here: css-cascade.mjs#STATIC_PROP_MAP has no
/// `content-visibility` entry, so a declared `content-visibility: hidden`
/// never reaches the static computed style.
fn is_rendered_type_element(el: &StaticElement<'_>) -> bool {
    let mut current = Some(el.clone());
    while let Some(node) = current {
        if node.get_attribute("hidden").is_some() {
            return false;
        }
        let style = node.style();
        let display = js::to_lower_case(sv(style, "display"));
        let visibility = js::to_lower_case(sv(style, "visibility"));
        let content_visibility = js::to_lower_case(sv(style, "contentVisibility"));
        if display == "none"
            || visibility == "hidden"
            || visibility == "collapse"
            || content_visibility == "hidden"
        {
            return false;
        }
        let opacity = parse_float(sv(style, "opacity"));
        if opacity.is_finite() && opacity <= 0.01 {
            return false;
        }
        current = node.parent_element();
    }
    true
}

/// JS: checks.mjs#checkFlatTypeHierarchyFromDoc over the static document.
pub fn check_flat_type_hierarchy_from_doc(doc: &StaticDocument) -> Vec<RuleHit> {
    check_flat_type_hierarchy_samples(&flat_type_samples_from_doc(doc))
}

/// The severity [`check_flat_type_hierarchy_from_doc`]'s finding reports at
/// (see `flat_type_hierarchy_severity`): advisory when weight separates the
/// roles.
pub fn flat_type_hierarchy_severity_for_doc(doc: &StaticDocument) -> Option<&'static str> {
    flat_type_hierarchy_severity(&flat_type_samples_from_doc(doc))
}

fn flat_type_samples_from_doc(doc: &StaticDocument) -> Vec<TypeSample> {
    let mut samples: Vec<TypeSample> = Vec::new();
    for el in doc.query_selector_all(TYPE_HIERARCHY_SELECTOR) {
        if js::trim(&el.text_content()).is_empty() || !is_rendered_type_element(&el) {
            continue;
        }
        let font_size = parse_float(sv(el.style(), "fontSize"));
        if !font_size.is_finite() || font_size < 8.0 || font_size >= 200.0 {
            continue;
        }
        samples.push(TypeSample {
            role: type_hierarchy_role(&el.tag_lower()),
            size: font_size,
            weight: parse_font_weight(sv(el.style(), "fontWeight")),
        });
    }
    samples
}

// ─── Nested cards ───────────────────────────────────────────────────────────

static SHADOW_CLASS_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?-u:\b)shadow(?:-sm|-md|-lg|-xl|-2xl)?(?-u:\b)").expect("SHADOW_CLASS_RE")
});
static BOX_SHADOW_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new("(?i)box-shadow").expect("BOX_SHADOW_RE"));
/// A utility class that draws a border on every side: `border`, `border-2`,
/// `border-px`, `border-[3px]`, with any variant prefix (`md:border`) or `!`.
/// A side utility (`border-t`, `border-b-[4px]`, `border-x`) draws one or two
/// edges, and a colour or style utility (`border-black`, `border-dashed`)
/// draws none, so neither makes a card. The ASCII `\b` this replaces matched all of them,
/// since `-` is a word boundary.
static BORDER_CLASS_TOKEN_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^border(?:-[0-9]+|-px|-\[[0-9.]+(?:px|rem|em)\])?$").expect("BORDER_CLASS_TOKEN_RE")
});

fn class_draws_four_sided_border(cls: &str) -> bool {
    cls.split(|c: char| c.is_ascii_whitespace()).any(|token| {
        let utility = token.rsplit(':').next().unwrap_or(token);
        BORDER_CLASS_TOKEN_RE.is_match(utility.trim_start_matches('!'))
    })
}
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
    let has_border = class_draws_four_sided_border(cls);
    let width_px = pf0(sv(style, "width"));
    let has_radius = resolve_border_radius_px(style, width_px) > 0.0
        || ROUNDED_CLASS_RE.is_match(cls)
        || BORDER_RADIUS_RE.is_match(raw_style);
    let has_bg = BG_CLASS_RE.is_match(cls) || bg_decl_not_transparent(raw_style);
    is_card_like_from_props(has_shadow, has_border, has_radius, has_bg)
}

/// Tags whose text is set in a monospace face by the user agent: the static
/// cascade has no UA stylesheet, so the tag stands in for the face.
const MONOSPACE_TAGS: [&str; 5] = ["pre", "code", "samp", "kbd", "output"];

/// The controls inside `el` (itself included), with the name each reads by:
/// its `aria-label`, else its `title`, else its text (the URL engine's
/// `controls_in`).
fn controls_in<'a>(el: &StaticElement<'a>) -> Vec<(StaticElement<'a>, Control, String)> {
    let mut nodes = vec![*el];
    nodes.extend(el.query_selector_all("*"));
    nodes
        .into_iter()
        .filter_map(|n| {
            let kind = control_of(&n.tag_lower(), n.get_attribute("type"), n.get_attribute("role"))?;
            let name = n
                .get_attribute("aria-label")
                .or_else(|| n.get_attribute("title"))
                .map(str::to_string)
                .unwrap_or_else(|| n.text_content());
            Some((n, kind, name))
        })
        .collect()
}

/// Whether `el` frames embedded content that is its main child rather than
/// holding a second card (decision r4-p17-nested-cards-embedded-content).
/// "Inner boxes that hold ordinary text and controls still report", so each
/// reading also asks what else the box holds, as the URL engine does:
///
/// - a media player: an `<audio>` or `<video>` drawn with `controls`, or a
///   play or pause button beside a seek control; every control in the box is
///   the player's own and the text outside them is caption-length;
/// - a figure: an `<svg>` or a `<canvas>` with a caption, read here as a
///   `<figure>` or a `<figcaption>` since the file scan has no layout to
///   measure the figure's share of the box; the text beside the figure is
///   caption-length and no control sits outside it;
/// - a monospace output block (see `is_output_block`) whose box holds no
///   control but its own chrome (a copy button, an icon button).
fn frames_embedded_content(el: &StaticElement<'_>, outer: &StaticElement<'_>) -> bool {
    let controls = controls_in(el);
    // Media the cascade hides (`hidden`, `display: none`) shows no player,
    // as the URL engine, which needs the player's box, also finds.
    let player_media = el
        .query_selector_all("audio[controls], video[controls]")
        .iter()
        .any(is_rendered_type_element);
    let custom_player = controls
        .iter()
        .any(|(_, kind, name)| *kind == Control::Button && is_play_name(name))
        && (controls.iter().any(|(_, kind, _)| *kind == Control::Seek)
            || el.query_selector("progress").is_some());
    if (player_media || custom_player)
        && controls.iter().all(|(_, kind, name)| {
            *kind == Control::Seek || (*kind == Control::Button && is_media_control_name(name))
        })
    {
        let total = visible_chars(&el.text_content());
        let inside: usize = controls
            .iter()
            .filter(|(c, _, _)| !controls.iter().any(|(o, _, _)| o != c && o.contains(c)))
            .map(|(c, _, _)| visible_chars(&c.text_content()))
            .sum();
        if total.saturating_sub(inside) <= CAPTION_MAX_CHARS {
            return true;
        }
    }
    if el.tag_lower() == "figure" || el.query_selector("figcaption").is_some() {
        let total = visible_chars(&el.text_content());
        let figure = el.query_selector_all("svg, canvas").into_iter().any(|figure| {
            let caption = total.saturating_sub(visible_chars(&figure.text_content()));
            caption > 0
                && caption <= CAPTION_MAX_CHARS
                && controls.iter().all(|(c, _, _)| figure.contains(c))
        });
        if figure {
            return true;
        }
    }
    controls
        .iter()
        .all(|(c, kind, name)| is_output_chrome(*kind, name, &c.text_content()))
        && is_output_block(el, outer)
}

/// Inline tags a run of text passes through; the static cascade has no UA
/// stylesheet, so a declared `display` is read first and the tag stands in
/// for the default.
const INLINE_TAGS: [&str; 16] = [
    "a", "abbr", "b", "br", "code", "em", "i", "kbd", "mark", "s", "samp", "small", "span",
    "strong", "sub", "sup",
];

/// The file scan's reading of a monospace output block (r4-p17), as the URL
/// engine's `is_output_block`: one element holds 60% of the box's text, 90%
/// of that is in a monospace tag or face, and it is one run of text (a
/// monospace tag, preserved white space, or inline runs holding 80% of it).
fn is_output_block(el: &StaticElement<'_>, outer: &StaticElement<'_>) -> bool {
    let mono_face = |e: &StaticElement<'_>| {
        impeccable_core::checks::text_rules::is_monospace_family(sv(e.style(), "fontFamily"))
    };
    if mono_face(outer) {
        return false;
    }
    let mut nodes = vec![*el];
    nodes.extend(el.query_selector_all("*"));
    if nodes.len() > 2000 {
        return false;
    }
    let index: std::collections::HashMap<ego_tree::NodeId, usize> =
        nodes.iter().enumerate().map(|(i, n)| (n.id(), i)).collect();
    let mut text = vec![0usize; nodes.len()];
    let mut mono = vec![0usize; nodes.len()];
    let mut run = vec![0usize; nodes.len()];
    let mono_at = |i: usize| {
        let mut cur = Some(nodes[i]);
        while let Some(c) = cur {
            if MONOSPACE_TAGS.contains(&c.tag_lower().as_str()) || mono_face(&c) {
                return true;
            }
            if c == *el {
                break;
            }
            cur = c.parent_element();
        }
        false
    };
    for (i, node) in nodes.iter().enumerate() {
        let own = node.direct_text().chars().filter(|c| !c.is_whitespace()).count();
        text[i] = own;
        run[i] = own;
        if own > 0 && mono_at(i) {
            mono[i] = own;
        }
    }
    for i in (1..nodes.len()).rev() {
        let Some(&parent) = nodes[i].parent_element().and_then(|p| index.get(&p.id())) else {
            continue;
        };
        text[parent] += text[i];
        mono[parent] += mono[i];
        let display = sv(nodes[i].style(), "display");
        let inline = if display.is_empty() {
            INLINE_TAGS.contains(&nodes[i].tag_lower().as_str())
        } else {
            matches!(display, "inline" | "contents")
        };
        if inline {
            run[parent] += run[i];
        }
    }
    let total = text[0];
    total > 0
        && nodes.iter().enumerate().any(|(i, node)| {
            if (text[i] as f64) < total as f64 * 0.6 || (mono[i] as f64) < text[i] as f64 * 0.9 {
                return false;
            }
            let ws = sv(node.style(), "whiteSpace");
            MONOSPACE_TAGS.contains(&node.tag_lower().as_str())
                || ws.starts_with("pre")
                || ws == "break-spaces"
                || run[i] as f64 >= text[i] as f64 * 0.8
        })
}

/// Whether `el` is a dialog: a `<dialog>`, `role="dialog"` or
/// `role="alertdialog"`, or `aria-modal="true"`.
fn is_dialog_el(el: &StaticElement<'_>) -> bool {
    let role_dialog = el.get_attribute("role").is_some_and(|role| {
        role.split_ascii_whitespace()
            .any(|t| matches!(js::to_lower_case(t).as_str(), "dialog" | "alertdialog"))
    });
    let modal = el
        .get_attribute("aria-modal")
        .is_some_and(|v| js::to_lower_case(js::trim(v)) == "true");
    el.tag_lower() == "dialog" || role_dialog || modal
}

/// Whether the outer card is a dialog (r4-p17): the dialog itself, or the
/// first card-like box inside one (a modal's panel inside its overlay). A
/// card further in, inside the dialog's panel, is an ordinary card.
fn is_dialog_card(outer: &StaticElement<'_>) -> bool {
    if is_dialog_el(outer) {
        return true;
    }
    let mut cur = outer.parent_element();
    while let Some(a) = cur {
        if is_dialog_el(&a) {
            return true;
        }
        if is_card_like(&a) {
            return false;
        }
        cur = a.parent_element();
    }
    false
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
                if !is_dialog_card(&p) && !frames_embedded_content(el, &p) {
                    flagged.push(*el);
                }
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
            let mut hit = RuleHit::new(
                "nested-cards",
                format!("Card inside card ({})", el.tag_lower()),
            );
            // A mockup's panels report as advisory
            // (decision r6-t3-nested-cards-mockups).
            if crate::decorative_text::box_in_mockup(el) {
                hit.severity = Some(impeccable_core::checks::rules::ADVISORY_SEVERITY.to_string());
            }
            findings.push(hit);
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
                // A class that carries an id names one instance, not a spot,
                // as in the browser engine.
                let mut cls: Vec<&str> = if raw_cls.is_empty() {
                    Vec::new()
                } else {
                    WS_RE
                        .split(raw_cls)
                        .filter(|s| !s.is_empty() && !impeccable_core::checks::text_rules::is_id_like_class(s))
                        .collect()
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

#[cfg(test)]
mod tests {
    use super::class_draws_four_sided_border;

    #[test]
    fn only_all_sided_width_utilities_draw_a_card_border() {
        for cls in ["border", "card border-2", "md:border", "!border", "border-px", "rounded border-[3px]"] {
            assert!(class_draws_four_sided_border(cls), "{cls}");
        }
        for cls in ["border-t", "border-b-[4px]", "border-x", "border-black", "border-dashed", "border-t-px"] {
            assert!(!class_draws_four_sided_border(cls), "{cls}");
        }
    }
}
