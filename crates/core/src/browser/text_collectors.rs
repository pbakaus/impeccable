//! Kicker / numbered-label / em-dash / repeated-text browser collectors from
//! `checks.mjs` (`collectKickerCandidates`, `checkKickerAboveHeadingDOM`,
//! `collectNumberedSectionLabelCandidates`, `checkNumberedSectionLabelsDOM`,
//! `checkEmDashOveruseDOM`, `collectRepeatedContainerTextFindings`,
//! `checkRepeatedContainerTextDOM`) against the [`Dom`] probe. The pure
//! gates live in `checks::rules` / `checks::text_rules`.

use super::dom::{tag_lower, Dom, ElId, ElStyle};
use super::element_checks::{class_selector, is_rendered_for_browser_rule};
use crate::checks::measures::resolve_length_px;
use crate::checks::rules::{check_kicker_above_heading, KickerCandidate, RuleHit};
use crate::checks::text_rules::{
    check_em_dash_overuse, check_numbered_section_labels, is_kicker_candidate,
    is_numbered_section_label_candidate, is_repeated_text_container, parse_numbered_label_text,
    strip_edge_quotes, HEADING_TAGS, KICKER_CARD_CONTEXT_SELECTOR, KICKER_SKIP_SELECTOR,
    KickerCandidateInput, NumberedLabelCandidate, NumberedLabelCandidateInput,
    REPEATED_TEXT_CONTAINER_TAGS, REPEATED_TEXT_SKIP_SELECTOR,
};
use crate::js::{self, parse_float, parse_int};
use crate::js_ext_a::num_truthy;
use crate::js_ext_b::{slice_utf16_prefix, utf16_len};
use once_cell::sync::Lazy;
use regex::Regex;

static WS_RE: Lazy<Regex> = Lazy::new(|| Regex::new(&format!("{}+", js::WS)).expect("WS_RE"));

/// JS `s.replace(/\s+/g, ' ')`.
fn collapse_ws(s: &str) -> String {
    WS_RE.replace_all(s, " ").into_owned()
}

/// JS: checks.mjs#cleanInlineText(el): direct text nodes joined with a
/// space, whitespace collapsed, trimmed.
pub fn clean_inline_text(dom: &dyn Dom, el: ElId) -> String {
    let joined = dom.direct_text_nodes(el).join(" ");
    js::trim(&collapse_ws(&joined)).to_string()
}

/// `(el.textContent || '').replace(/\s+/g, ' ').trim()`
fn collapsed_text_content(dom: &dyn Dom, el: ElId) -> String {
    js::trim(&collapse_ws(&dom.text_content(el))).to_string()
}

/// JS: checks.mjs#isKickerCardContext(heading, kicker)
pub fn is_kicker_card_context(dom: &dyn Dom, heading: ElId, kicker: ElId) -> bool {
    match dom.closest(heading, KICKER_CARD_CONTEXT_SELECTOR) {
        Ok(Some(item)) => dom.contains(item, kicker),
        _ => false,
    }
}

static HEADING_LEVEL_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^h([1-6])$").expect("HEADING_LEVEL_RE"));

/// JS: checks.mjs#kickerHeadingLevel(heading)
pub fn kicker_heading_level(dom: &dyn Dom, heading: ElId) -> f64 {
    let tag = tag_lower(dom, heading);
    if let Some(m) = HEADING_LEVEL_RE.captures(&tag) {
        return parse_int(&m[1], 10);
    }
    let role = dom.attr(heading, "role").unwrap_or_default();
    if js::to_lower_case(&role) != "heading" {
        return 0.0;
    }
    let aria_level = parse_int(&dom.attr(heading, "aria-level").unwrap_or_default(), 10);
    if aria_level.is_finite() && aria_level >= 1.0 {
        aria_level
    } else {
        2.0
    }
}

/// `(value, fontSize) => resolveLengthPx(value, fontSize) || 0`
fn resolve_len_or_zero(value: &str, font_size: f64) -> f64 {
    match resolve_length_px(Some(value), font_size) {
        Some(n) if num_truthy(n) => n,
        _ => 0.0,
    }
}

/// `resolveLetterSpacing(style.fontSize || '', 16) || parseFloat(style.fontSize) || 0`
fn font_size_of(dom: &dyn Dom, el: ElId) -> f64 {
    let raw = dom.style(el, "fontSize");
    let a = resolve_len_or_zero(&raw, 16.0);
    if num_truthy(a) {
        return a;
    }
    let n = parse_float(&raw);
    if num_truthy(n) {
        n
    } else {
        0.0
    }
}

fn strip_edge_quotes_slice(text: &str, n: usize) -> String {
    slice_utf16_prefix(&strip_edge_quotes(text), n)
}

/// JS: checks.mjs#collectKickerCandidates(document, getComputedStyle, resolveLengthPx || 0)
pub fn collect_kicker_candidates(dom: &dyn Dom) -> Vec<KickerCandidate> {
    let mut candidates = Vec::new();
    for heading in dom
        .query_all(None, "h1, h2, h3, h4, [role=\"heading\"]")
        .unwrap_or_default()
    {
        let heading_level = kicker_heading_level(dom, heading);
        if !num_truthy(heading_level) || heading_level > 4.0 {
            continue;
        }
        if super::dom::closest_or_none(dom, heading, KICKER_SKIP_SELECTOR).is_some() {
            continue;
        }
        if super::dom::closest_or_none(
            dom,
            heading,
            "[role=\"tabpanel\"], [role=\"dialog\"], [role=\"application\"], dialog",
        )
        .is_some()
        {
            continue;
        }
        let Some(kicker) = dom.previous_element_sibling(heading) else {
            continue;
        };
        if super::dom::closest_or_none(dom, kicker, KICKER_SKIP_SELECTOR).is_some() {
            continue;
        }
        if is_kicker_card_context(dom, heading, kicker) {
            continue;
        }
        let heading_tag = tag_lower(dom, heading);
        let heading_text = collapsed_text_content(dom, heading);
        let kicker_text = {
            let t = clean_inline_text(dom, kicker);
            if t.is_empty() {
                collapsed_text_content(dom, kicker)
            } else {
                t
            }
        };
        let heading_font_size = font_size_of(dom, heading);
        let kicker_font_size = font_size_of(dom, kicker);
        let kicker_letter_spacing =
            resolve_len_or_zero(&dom.style(kicker, "letterSpacing"), kicker_font_size);
        let kicker_font_variant = format!(
            "{} {}",
            dom.style(kicker, "fontVariant"),
            dom.style(kicker, "fontVariantCaps")
        );
        if !is_kicker_candidate(&KickerCandidateInput {
            heading_level,
            heading_text: &heading_text,
            heading_font_size,
            kicker_tag: &tag_lower(dom, kicker),
            kicker_text: &kicker_text,
            kicker_text_transform: &dom.style(kicker, "textTransform"),
            kicker_font_variant: &kicker_font_variant,
            kicker_font_size,
            kicker_letter_spacing,
        }) {
            continue;
        }
        if heading_tag == "h1" && heading_font_size >= 48.0 && kicker_letter_spacing >= 1.6 {
            continue;
        }
        candidates.push(KickerCandidate {
            heading_tag,
            heading_text: strip_edge_quotes_slice(&heading_text, 60),
            kicker_text: slice_utf16_prefix(&kicker_text, 40),
        });
    }
    candidates
}

/// JS: checks.mjs#checkKickerAboveHeadingDOM()
pub fn check_kicker_above_heading_dom(dom: &dyn Dom) -> Vec<RuleHit> {
    check_kicker_above_heading(&collect_kicker_candidates(dom))
}

/// JS: checks.mjs#collectNumberedSectionLabelCandidates(document, ...)
pub fn collect_numbered_section_label_candidates(dom: &dyn Dom) -> Vec<NumberedLabelCandidate> {
    let mut candidates = Vec::new();
    let mut seen_labels: Vec<ElId> = Vec::new();
    for heading in dom.query_all(None, "h2, h3, h4").unwrap_or_default() {
        if super::dom::closest_or_none(dom, heading, KICKER_SKIP_SELECTOR).is_some() {
            continue;
        }
        let mut label = dom.previous_element_sibling(heading);
        if label.is_none() {
            if let Some(parent) = dom.parent(heading) {
                let first_child = dom.children(parent).into_iter().next();
                if first_child == Some(heading) {
                    label = dom.previous_element_sibling(parent);
                }
            }
        }
        let Some(label) = label else {
            continue;
        };
        if seen_labels.contains(&label) {
            continue;
        }
        if super::dom::closest_or_none(dom, label, KICKER_SKIP_SELECTOR).is_some() {
            continue;
        }
        if HEADING_TAGS.contains(&tag_lower(dom, label).as_str()) {
            continue;
        }
        if is_kicker_card_context(dom, heading, label) {
            continue;
        }
        let label_text = {
            let t = clean_inline_text(dom, label);
            if t.is_empty() {
                collapsed_text_content(dom, label)
            } else {
                t
            }
        };
        let Some(parsed) = parse_numbered_label_text(Some(&label_text)) else {
            continue;
        };
        let heading_text = collapsed_text_content(dom, heading);
        let heading_font_size = font_size_of(dom, heading);
        let label_font_size = font_size_of(dom, label);
        if !is_numbered_section_label_candidate(&NumberedLabelCandidateInput {
            heading_tag: &tag_lower(dom, heading),
            heading_text: &heading_text,
            heading_font_size,
            label_tag: &tag_lower(dom, label),
            label_index: Some(parsed.index),
            label_text: &parsed.text,
            label_font_size,
            label_letter_spacing: resolve_len_or_zero(
                &dom.style(label, "letterSpacing"),
                label_font_size,
            ),
            label_font_weight: &dom.style(label, "fontWeight"),
            label_font_family: &dom.style(label, "fontFamily"),
            label_text_transform: &dom.style(label, "textTransform"),
            label_color: &dom.style(label, "color"),
        }) {
            continue;
        }
        seen_labels.push(label);
        candidates.push(NumberedLabelCandidate {
            index: parsed.index,
            label_text: slice_utf16_prefix(&parsed.text, 24),
            heading_tag: tag_lower(dom, heading),
            heading_text: strip_edge_quotes_slice(&heading_text, 60),
        });
    }
    candidates
}

fn hits(v: Vec<crate::checks::measures::Finding>) -> Vec<RuleHit> {
    v.into_iter()
        .map(|f| RuleHit {
            id: f.id,
            snippet: f.snippet,
        })
        .collect()
}

/// JS: checks.mjs#checkNumberedSectionLabelsDOM()
pub fn check_numbered_section_labels_dom(dom: &dyn Dom) -> Vec<RuleHit> {
    hits(check_numbered_section_labels(
        &collect_numbered_section_label_candidates(dom),
        None,
    ))
}

/// JS: checks.mjs#checkEmDashOveruseDOM()
pub fn check_em_dash_overuse_dom(dom: &dyn Dom) -> Vec<RuleHit> {
    let Some(body) = dom.body() else {
        return Vec::new();
    };
    // innerText when it is a non-empty string, else textContent.
    let text = match dom.inner_text(body) {
        Some(t) => t,
        None => dom.text_content(body),
    };
    hits(check_em_dash_overuse(Some(&text)))
}

static ICON_CLASS_RE: Lazy<Regex> = Lazy::new(|| {
    // JS `/icon|material-symbols|(?:^|\s)fa[srlbd]?(?:\s|-|$)/i`, ASCII folding.
    Regex::new(&format!(
        "{icon}|{ms}|(?:^|{ws}){fa}[srlbdSRLBD]?(?:{ws}|-|$)",
        icon = js::ci("icon"),
        ms = js::ci("material-symbols"),
        fa = js::ci("fa"),
        ws = js::WS
    ))
    .expect("ICON_CLASS_RE")
});
static ALPHA_RE: Lazy<Regex> = Lazy::new(|| Regex::new("[a-zA-Z]").expect("ALPHA_RE"));

/// JS: checks.mjs#collectRepeatedContainerTextFindings(doc, getStyle, opts)
/// with `isVisible` supplied by the caller.
pub fn collect_repeated_container_text_findings(
    dom: &dyn Dom,
    is_visible: &dyn Fn(ElId) -> bool,
) -> Vec<RuleHit> {
    let mut findings = Vec::new();
    let mut containers: Vec<ElId> = Vec::new();
    for el in dom.query_all(None, "*").unwrap_or_default() {
        if !REPEATED_TEXT_CONTAINER_TAGS.contains(&tag_lower(dom, el).as_str()) {
            continue;
        }
        if super::dom::closest_or_none(dom, el, REPEATED_TEXT_SKIP_SELECTOR).is_some() {
            continue;
        }
        let style = ElStyle { dom, el };
        if !is_repeated_text_container(Some(&style)) {
            continue;
        }
        containers.push(el);
    }

    for &container in &containers {
        if !is_visible(container) {
            continue;
        }
        let descendants = dom.query_all(Some(container), "*").unwrap_or_default();
        if descendants.len() > 250 {
            continue;
        }
        // text -> signatures, in first-seen order (JS Map).
        let mut groups: Vec<(String, Vec<String>)> = Vec::new();
        for &d in &descendants {
            let mut anc = dom.parent(d);
            let mut owned_by_inner = false;
            while let Some(a) = anc {
                if a == container {
                    break;
                }
                if containers.contains(&a) {
                    owned_by_inner = true;
                    break;
                }
                anc = dom.parent(a);
            }
            if owned_by_inner {
                continue;
            }
            if super::dom::closest_or_none(dom, d, REPEATED_TEXT_SKIP_SELECTOR).is_some() {
                continue;
            }
            if ICON_CLASS_RE.is_match(&dom.attr(d, "class").unwrap_or_default()) {
                continue;
            }
            if !is_visible(d) {
                continue;
            }
            let direct = clean_inline_text(dom, d);
            let len = utf16_len(&direct);
            if !(4..=48).contains(&len) {
                continue;
            }
            if !ALPHA_RE.is_match(&direct) {
                continue;
            }
            let mut sig: Vec<String> = Vec::new();
            let mut cur = Some(d);
            while let Some(c) = cur {
                if c == container {
                    break;
                }
                let raw = dom.attr(c, "class").unwrap_or_default();
                let raw_cls = js::trim(&raw);
                let mut cls: Vec<&str> = if raw_cls.is_empty() {
                    Vec::new()
                } else {
                    WS_RE.split(raw_cls).filter(|s| !s.is_empty()).collect()
                };
                cls.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
                let cls = cls.join(".");
                sig.push(if cls.is_empty() {
                    tag_lower(dom, c)
                } else {
                    format!("{}.{}", tag_lower(dom, c), cls)
                });
                cur = dom.parent(c);
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
            let mut distinct: Vec<&String> = Vec::new();
            for s in sigs {
                if !distinct.contains(&s) {
                    distinct.push(s);
                }
            }
            if distinct.len() < 3 {
                continue;
            }
            findings.push(RuleHit::new(
                "repeated-container-text",
                format!(
                    "\"{}\" rendered {}× in distinct spots inside {}",
                    slice_utf16_prefix(text, 40),
                    sigs.len(),
                    class_selector(dom, container)
                ),
            ));
        }
    }
    findings
}

/// JS: checks.mjs#checkRepeatedContainerTextDOM()
pub fn check_repeated_container_text_dom(dom: &dyn Dom) -> Vec<RuleHit> {
    collect_repeated_container_text_findings(dom, &|el| is_rendered_for_browser_rule(dom, el))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browser::fake_dom::FakeDom;

    #[test]
    fn kicker_above_heading_collects_tracked_caps_label() {
        let mut d = FakeDom::new();
        let (_html, body) = d.with_page();
        let sec = d.add(Some(body), "section");
        let kicker = d.add(Some(sec), "p");
        d.add_text(kicker, "  Features  ");
        d.set_styles(
            kicker,
            &[
                ("fontSize", "12px"),
                ("letterSpacing", "1.2px"),
                ("textTransform", "uppercase"),
                ("fontVariant", "normal"),
                ("fontVariantCaps", "normal"),
            ],
        );
        let h = d.add(Some(sec), "h2");
        d.add_text(h, "Everything you need");
        d.set_style(h, "fontSize", "32px");
        let hits = check_kicker_above_heading_dom(&d);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, "kicker-above-heading");
        assert_eq!(
            hits[0].snippet,
            "kicker \"Features\" above h2 \"Everything you need\""
        );
        // A card context (heading inside <article> that also contains the
        // kicker) stands down.
        let art = d.add(Some(body), "article");
        let k2 = d.add(Some(art), "p");
        d.add_text(k2, "NEWS");
        d.set_styles(k2, &[("fontSize", "12px"), ("letterSpacing", "1.2px")]);
        let h2 = d.add(Some(art), "h3");
        d.add_text(h2, "Card heading");
        d.set_style(h2, "fontSize", "24px");
        assert_eq!(check_kicker_above_heading_dom(&d).len(), 1);
    }

    #[test]
    fn numbered_labels_need_two_distinct_indices() {
        let mut d = FakeDom::new();
        let (_html, body) = d.with_page();
        for (i, idx) in ["01", "02"].iter().enumerate() {
            let sec = d.add(Some(body), "section");
            let label = d.add(Some(sec), "span");
            d.add_text(label, idx);
            d.set_styles(
                label,
                &[
                    ("fontSize", "11px"),
                    ("letterSpacing", "1px"),
                    ("fontWeight", "700"),
                    ("fontFamily", "monospace"),
                    ("textTransform", "none"),
                    ("color", "rgb(0, 0, 0)"),
                ],
            );
            let h = d.add(Some(sec), "h2");
            d.add_text(h, &format!("Section number {}", i + 1));
            d.set_style(h, "fontSize", "28px");
        }
        let hits = check_numbered_section_labels_dom(&d);
        assert_eq!(hits.len(), 2);
        assert_eq!(
            hits[0].snippet,
            "tiny numbered label \"01\" beside h2 \"Section number 1\" (2 on page)"
        );
    }

    #[test]
    fn em_dash_uses_inner_text_then_text_content() {
        let mut d = FakeDom::new();
        let (_html, body) = d.with_page();
        let dashes = "a — b — c — d — e — f — g — h — i";
        d.add_text(body, dashes);
        let hits = check_em_dash_overuse_dom(&d);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].snippet, "8 em-dashes in body text");
        d.el_mut(body).inner_text = Some("no dashes here".to_string());
        assert!(check_em_dash_overuse_dom(&d).is_empty());
    }

    #[test]
    fn repeated_text_in_card_at_three_distinct_positions() {
        let mut d = FakeDom::new();
        let (_html, body) = d.with_page();
        let card = d.add(Some(body), "div");
        d.set_attr(card, "class", "card");
        d.set_styles(
            card,
            &[
                ("boxShadow", "rgba(0, 0, 0, 0.1) 0px 2px 4px"),
                ("borderTopWidth", "0px"),
                ("borderRightWidth", "0px"),
                ("borderBottomWidth", "0px"),
                ("borderLeftWidth", "0px"),
                ("borderRadius", "8px"),
                ("backgroundColor", "rgb(255, 255, 255)"),
            ],
        );
        for tag in ["p", "span", "em"] {
            let e = d.add(Some(card), tag);
            d.add_text(e, "Active");
        }
        let hits = check_repeated_container_text_dom(&d);
        assert_eq!(hits.len(), 1);
        // classSelector is fork A's (element_checks); the stub yields the
        // bare tag, the real one "div.card".
        assert!(hits[0]
            .snippet
            .starts_with("\"Active\" rendered 3× in distinct spots inside div"));
        // Parallel positions (same signature) do not count.
        let mut d2 = FakeDom::new();
        let (_h, b2) = d2.with_page();
        let card2 = d2.add(Some(b2), "div");
        d2.set_styles(
            card2,
            &[
                ("boxShadow", "rgba(0, 0, 0, 0.1) 0px 2px 4px"),
                ("borderRadius", "8px"),
                ("backgroundColor", "rgb(255, 255, 255)"),
            ],
        );
        for _ in 0..3 {
            let e = d2.add(Some(card2), "li");
            d2.add_text(e, "Active");
        }
        assert!(check_repeated_container_text_dom(&d2).is_empty());
    }
}
