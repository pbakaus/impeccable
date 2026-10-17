//! Kicker / numbered-label / em-dash / repeated-text browser collectors from
//! `checks.mjs` (`collectKickerCandidates`, `checkKickerAboveHeadingDOM`,
//! `collectNumberedSectionLabelCandidates`, `checkNumberedSectionLabelsDOM`,
//! `checkEmDashOveruseDOM`, `collectRepeatedContainerTextFindings`,
//! `checkRepeatedContainerTextDOM`) against the [`Dom`] probe. The pure
//! gates live in `checks::rules` / `checks::text_rules`.

use super::dom::{matches_or_false, tag_lower, Dom, ElId, ElStyle};
use super::driver::DesignSystemConfig;
use super::element_checks::{class_selector, is_rendered_for_browser_rule};
use super::painted::{unpainted_for, PaintGate};
use super::{BrowserFinding, ElFinding};
use crate::checks::measures::resolve_length_px;
use crate::checks::rules::{check_kicker_above_heading, KickerCandidate, RuleHit};
use crate::checks::text_rules::{
    check_em_dash_overuse, check_numbered_section_labels, is_kicker_candidate,
    is_numbered_section_label_candidate, is_repeated_text_container, parse_numbered_label_text,
    strip_edge_quotes, HEADING_TAGS, KICKER_CARD_CONTEXT_SELECTOR, KICKER_SKIP_SELECTOR, LEADING_DISPLAY_TYPE_PX,
    KickerCandidateInput, NumberedLabel, NumberedLabelCandidate, NumberedLabelCandidateInput,
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

/// How many viewports tall a card-context element may be before it is the
/// page's frame rather than a card: outreign.io wraps its whole page in
/// `main > article`, 11,527px tall, and a card on a phone runs under two
/// screens.
pub const KICKER_CARD_MAX_VIEWPORTS: f64 = 2.0;

/// JS: checks.mjs#isKickerCardContext(heading, kicker), less a page-scale
/// ancestor: an `article` (or list item, link, button) more than
/// [`KICKER_CARD_MAX_VIEWPORTS`] viewports tall holds the page, and a label
/// and heading inside it share no card. Where the box or the viewport is not
/// measured the ancestor counts, as before.
pub fn is_kicker_card_context(dom: &dyn Dom, heading: ElId, kicker: ElId) -> bool {
    match dom.closest(heading, KICKER_CARD_CONTEXT_SELECTOR) {
        Ok(Some(item)) => {
            let viewport = dom.inner_height();
            let height = dom.rect(item).height;
            let page_scale = viewport.is_finite()
                && viewport > 0.0
                && height.is_finite()
                && height > viewport * KICKER_CARD_MAX_VIEWPORTS;
            !page_scale && dom.contains(item, kicker)
        }
        _ => false,
    }
}

/// Whether `kicker` sits in the card that holds `heading`: the nearest
/// ancestor of the heading drawn as a card (a boundary of its own, read from
/// the computed box), shorter than the viewport, whatever its tag. A label in
/// a card beside its title is the card's metadata, as it is in an `article`
/// or `li` card: aina-tech.io's white press card names its source ("The
/// Future Media") over its 20px h3 headline in a `div`. Only a card title
/// counts: an h3 or lower set under display size. A section's own heading in
/// a painted panel (redoubt.agency's h2 in the hero's side panel,
/// vestra.ai's 40px h3 across a feature band) keeps its eyebrow reported.
fn kicker_in_painted_card(dom: &dyn Dom, heading: ElId, kicker: ElId) -> bool {
    if kicker_heading_level(dom, heading) < 3.0 || font_size_of(dom, heading) >= LEADING_DISPLAY_TYPE_PX {
        return false;
    }
    let viewport = {
        let h = dom.inner_height();
        if num_truthy(h) {
            h
        } else {
            800.0
        }
    };
    let body = dom.body();
    let mut cur = dom.parent(heading);
    while let Some(c) = cur {
        if Some(c) == body {
            return false;
        }
        if super::page_checks::is_card_like_dom(dom, c) {
            return dom.rect(c).height < viewport && dom.contains(c, kicker);
        }
        cur = dom.parent(c);
    }
    false
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
    collect_kicker_candidates_with_elements(dom)
        .into_iter()
        .map(|(_, c)| c)
        .collect()
}

/// The same walk, each candidate paired with the eyebrow element it came
/// from. The finding is about that element and belongs on it: reported
/// against the page it named `body`, and a charged row has to have something
/// to point at (REN-406).
pub fn collect_kicker_candidates_with_elements(dom: &dyn Dom) -> Vec<(ElId, KickerCandidate)> {
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
        let Some(found) = label_before_heading(dom, heading) else {
            continue;
        };
        let kicker = found.label;
        if found.levels > 0 && !label_near_heading(dom, kicker, heading) {
            continue;
        }
        if super::dom::closest_or_none(dom, kicker, KICKER_SKIP_SELECTOR).is_some() {
            continue;
        }
        if is_kicker_card_context(dom, heading, kicker) || kicker_in_painted_card(dom, heading, kicker) {
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
        let kicker_type = label_type_element(dom, kicker);
        let kicker_font_size = font_size_of(dom, kicker_type);
        let kicker_letter_spacing =
            resolve_len_or_zero(&dom.style(kicker_type, "letterSpacing"), kicker_font_size);
        let kicker_font_variant = format!(
            "{} {}",
            dom.style(kicker_type, "fontVariant"),
            dom.style(kicker_type, "fontVariantCaps")
        );
        if !is_kicker_candidate(&KickerCandidateInput {
            heading_level,
            heading_text: &heading_text,
            heading_font_size,
            kicker_tag: &tag_lower(dom, kicker),
            kicker_text: &kicker_text,
            kicker_text_transform: &dom.style(kicker_type, "textTransform"),
            kicker_font_variant: &kicker_font_variant,
            kicker_font_size,
            kicker_letter_spacing,
        }) {
            continue;
        }
        // The hero rule takes a tracked label over a display h1. Its em
        // floor reaches only the labels that rule reads (the h1's own
        // previous sibling, at eyebrow size), and under the fixed 1.6px floor
        // the label is handed off only where the hero rule reports it: that
        // rule reads case from text-transform and typed capitals (not
        // small-caps) and passes over a dated meta line, so a label it leaves
        // is kept here.
        if heading_tag == "h1"
            && heading_font_size >= 48.0
            && (kicker_letter_spacing >= crate::checks::rules::HERO_EYEBROW_TRACKING_PX
                || (found.levels == 0
                    && kicker_font_size <= 14.0
                    && crate::checks::rules::hero_eyebrow_tracked(
                        kicker_letter_spacing,
                        kicker_font_size,
                        Some(crate::checks::rules::HERO_EYEBROW_TRACKING_EM),
                    )
                    && !super::element_checks::check_element_hero_eyebrow_dom(dom, heading)
                        .is_empty()))
        {
            continue;
        }
        // A pair a visitor cannot see (a section at `hidden`, an inactive
        // hero slide, a closed panel) puts no label above a heading on screen.
        if unpainted_for(dom, heading, PaintGate::Text).is_some()
            || unpainted_for(dom, kicker, PaintGate::Text).is_some()
        {
            continue;
        }
        candidates.push((
            kicker,
            KickerCandidate {
                heading_tag,
                heading_text: strip_edge_quotes_slice(&heading_text, 60),
                kicker_text: slice_utf16_prefix(&kicker_text, 40),
            },
        ));
    }
    candidates
}

/// JS: checks.mjs#checkKickerAboveHeadingDOM()
///
/// Two things the page-level version could not do. The finding lands on the
/// eyebrow it is about rather than on `body`. And an eyebrow the repository's
/// own design document names — `.eyebrow`, written into DESIGN.md as the one
/// place caps are allowed — is that repository's vocabulary, not slop: a
/// pattern the author's contract declares by name is a component with rules,
/// and charging it reviews the design system instead of the change (REN-406).
pub fn check_kicker_above_heading_dom(
    dom: &dyn Dom,
    design_system: Option<&DesignSystemConfig>,
) -> Vec<ElFinding> {
    let pairs: Vec<(ElId, KickerCandidate)> = collect_kicker_candidates_with_elements(dom)
        .into_iter()
        .filter(|(el, _)| !is_declared_component(dom, *el, design_system))
        .collect();
    let (els, candidates): (Vec<ElId>, Vec<KickerCandidate>) = pairs.into_iter().unzip();
    check_kicker_above_heading(&candidates)
        .into_iter()
        .zip(els)
        .map(|(hit, el)| ElFinding {
            el: Some(el),
            finding: BrowserFinding::new(hit.id, hit.snippet),
        })
        .collect()
}

/// Whether the repository's design document declares this element by name.
///
/// The selectors come from the DESIGN.md the review already parses, through
/// the same design-system config the colour and radius rules read.
pub fn is_declared_component(
    dom: &dyn Dom,
    el: ElId,
    design_system: Option<&DesignSystemConfig>,
) -> bool {
    let Some(ds) = design_system else {
        return false;
    };
    ds.declared_selectors
        .iter()
        .any(|sel| matches_or_false(dom, el, sel))
}

/// JS: checks.mjs#collectNumberedSectionLabelCandidates(document, ...)
pub fn collect_numbered_section_label_candidates(dom: &dyn Dom) -> Vec<NumberedLabelCandidate> {
    let mut candidates = Vec::new();
    let mut seen_labels: Vec<ElId> = Vec::new();
    for heading in dom.query_all(None, "h2, h3, h4").unwrap_or_default() {
        if super::dom::closest_or_none(dom, heading, KICKER_SKIP_SELECTOR).is_some() {
            continue;
        }
        let Some(found) = label_before_heading(dom, heading) else {
            continue;
        };
        let label = found.label;
        // One wrapper up was always read; past that, the label has to sit
        // beside or above the heading.
        if found.levels > 1 && !label_near_heading(dom, label, heading) {
            continue;
        }
        if seen_labels.contains(&label) {
            continue;
        }
        if super::dom::closest_or_none(dom, label, KICKER_SKIP_SELECTOR).is_some() {
            continue;
        }
        if HEADING_TAGS.contains(&tag_lower(dom, label).as_str()) {
            continue;
        }
        // A count beside an icon, or a label that holds an image, is a badge
        // (gig-connect's venue capacity, a people icon and "35" over the card
        // photo), not a section number. A plain "01" in a painted card stays:
        // numbered pricing and feature cards are the tell itself.
        if (is_kicker_card_context(dom, heading, label) && !in_an_unpainted_article(dom, heading, label))
            || numbered_label_holds_media(dom, label)
        {
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
        let Some(parsed) = parse_numbered_label_text(Some(&label_text)).or_else(|| parse_hash_numbered_label(&label_text))
        else {
            continue;
        };
        let heading_text = collapsed_text_content(dom, heading);
        let heading_font_size = font_size_of(dom, heading);
        let label_type = label_type_element(dom, label);
        let label_font_size = font_size_of(dom, label_type);
        if !is_numbered_section_label_candidate(&NumberedLabelCandidateInput {
            heading_tag: &tag_lower(dom, heading),
            heading_text: &heading_text,
            heading_font_size,
            label_tag: &tag_lower(dom, label),
            label_index: Some(parsed.index),
            label_text: &parsed.text,
            label_font_size,
            label_letter_spacing: resolve_len_or_zero(
                &dom.style(label_type, "letterSpacing"),
                label_font_size,
            ),
            label_font_weight: &dom.style(label_type, "fontWeight"),
            label_font_family: &dom.style(label_type, "fontFamily"),
            label_text_transform: &dom.style(label_type, "textTransform"),
            label_color: &dom.style(label_type, "color"),
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
    // `#` labels that all carry the same word after the number ("#1 Rated",
    // "#2 Rated", "#3 Rated") are a ranked list, not named sections.
    let hash_words: Vec<Option<String>> =
        candidates.iter().filter(|c| c.label_text.starts_with('#')).map(|c| hash_label_word(&c.label_text)).collect();
    if hash_words.len() >= 2 && hash_words[0].is_some() && hash_words.iter().all(|w| *w == hash_words[0]) {
        candidates.retain(|c| !c.label_text.starts_with('#'));
    }
    candidates
}

/// A numbered label written with a leading `#`: "#1 Connect", "#6
/// Experiment" (nousresearch.com's feature labels), or a bare "#03". One or
/// two digits right after the `#`, then nothing or a space and a word.
static HASH_LABEL_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^#([0-9]{1,2})(?: [^ ].*)?$").expect("HASH_LABEL_RE"));

/// Words that make a `#` label a rank ("#1 Rated", "#2 Best seller"), not a
/// section number.
const RANKING_WORDS: &[&str] = &[
    "rated", "ranked", "rank", "best", "top", "in", "pick", "choice", "overall", "seller", "bestseller",
    "selling", "voted", "place", "trending",
];

/// The first word after the number of a `#` label, lowercased: "#1 Connect"
/// reads "connect", a bare "#03" reads none.
fn hash_label_word(text: &str) -> Option<String> {
    let rest = text.strip_prefix('#')?.trim_start_matches(|c: char| c.is_ascii_digit());
    rest.split_whitespace()
        .next()
        .map(|w| w.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase())
        .filter(|w| !w.is_empty())
}

/// [`parse_numbered_label_text`] for a label with a leading `#`, which the
/// shared parser (pinned by the frozen vectors) reads as no number. The text
/// is whitespace-collapsed and trimmed first, and held to the same 40
/// characters and index of 40 at most.
fn parse_hash_numbered_label(raw: &str) -> Option<NumberedLabel> {
    let text = js::trim(&collapse_ws(raw)).to_string();
    if utf16_len(&text) > 40 {
        return None;
    }
    if hash_label_word(&text).is_some_and(|w| RANKING_WORDS.contains(&w.as_str())) {
        return None;
    }
    let index = parse_int(&HASH_LABEL_RE.captures(&text)?[1], 10);
    (index.is_finite() && index <= 40.0).then_some(NumberedLabel { index, text })
}

/// How many wrappers past an article the drawn-box walk climbs: a card
/// component that draws the card on a `div` around the semantic article.
const ARTICLE_WRAPPER_LEVELS: usize = 3;

/// The card contexts that hold an article and keep it a card whatever
/// either paints: a link, a button, a list item.
const ARTICLE_HOLDER_SELECTOR: &str = "a,button,li,[role=\"listitem\"],[role=\"option\"]";

/// Whether the card context that holds a numbered label and its heading is
/// an `article` nothing draws as a box. nousresearch.com wraps each feature
/// in a bare `article.landing-feature`, its "#1 Connect" label over a 46px
/// h3 on the section's own grey, which is a section, not a card.
///
/// The article is a card when a link, button or list item holds it, or when
/// a box that also holds the label is drawn ([`draws_a_box`]): from the
/// heading's parent up to the article, then up to
/// [`ARTICLE_WRAPPER_LEVELS`] wrappers past it whose only element child is
/// the box below (a card component drawn on a `div` or `a` around the
/// article). The walk stops at a box that holds anything else, the grid or
/// section the cards sit in.
fn in_an_unpainted_article(dom: &dyn Dom, heading: ElId, label: ElId) -> bool {
    let Ok(Some(item)) = dom.closest(heading, KICKER_CARD_CONTEXT_SELECTOR) else {
        return false;
    };
    if tag_lower(dom, item) != "article" {
        return false;
    }
    if dom.parent(item).is_some_and(|p| super::dom::closest_or_none(dom, p, ARTICLE_HOLDER_SELECTOR).is_some()) {
        return false;
    }
    let mut cur = dom.parent(heading);
    while let Some(c) = cur {
        if dom.contains(c, label) && draws_a_box(dom, c) {
            return false;
        }
        if c == item {
            break;
        }
        cur = dom.parent(c);
    }
    let body = dom.body();
    let mut below = item;
    for _ in 0..ARTICLE_WRAPPER_LEVELS {
        let Some(up) = dom.parent(below) else { break };
        if Some(up) == body || dom.children(up).as_slice() != [below] {
            break;
        }
        if draws_a_box(dom, up) {
            return false;
        }
        below = up;
    }
    true
}

/// Whether `el` is drawn as a box a reader sees around what it holds: a card
/// ([`super::page_checks::is_card_like_dom`]), a fill that differs from the
/// surface under it, a shadow, or a border drawn on three sides or more (a
/// square bordered card).
fn draws_a_box(dom: &dyn Dom, el: ElId) -> bool {
    if super::page_checks::is_card_like_dom(dom, el) || super::page_checks::fill_differs_from_surface(dom, el) {
        return true;
    }
    let shadow = crate::checks::measures::parse_shadow_layers(&dom.style(el, "boxShadow"));
    if shadow.iter().any(|l| {
        l.alpha >= crate::checks::measures::FAINT_PAINT_ALPHA && (l.x != 0.0 || l.y != 0.0 || l.blur > 0.0 || l.spread != 0.0)
    }) {
        return true;
    }
    super::element_checks::drawn_border_sides(dom, el) >= 3
}

/// The media that make a numbered label a picture rather than a section
/// number: a photo, a video or a canvas inside it.
pub const NUMBERED_LABEL_MEDIA_SELECTOR: &str = "img, picture, video, canvas";

/// Whether `label` is a badge or a picture, not a section number: it holds a
/// photo ([`NUMBERED_LABEL_MEDIA_SELECTOR`]), or an icon set in the same box
/// as the number's own text (a people icon and "35"). An icon in a tile
/// beside a card's "02" leaves the "02" a number.
fn numbered_label_holds_media(dom: &dyn Dom, label: ElId) -> bool {
    let found = |selector: &str| dom.query_all(Some(label), selector).unwrap_or_default();
    found(NUMBERED_LABEL_MEDIA_SELECTOR).iter().any(|&el| el != label)
        || found("svg").iter().any(|&svg| {
            dom.parent(svg)
                .is_some_and(|box_| holds_number_text(&super::dom::direct_text(dom, box_)))
        })
}

/// Whether a box's own text is the number a numbered label reads: an icon
/// beside other words ("Feature") is not beside the number.
pub fn holds_number_text(own_text: &str) -> bool {
    let text = js::trim(&collapse_ws(own_text)).to_string();
    !text.is_empty() && parse_numbered_label_text(Some(&text)).is_some()
}

fn hits(v: Vec<crate::checks::measures::Finding>) -> Vec<RuleHit> {
    v.into_iter()
        .map(|f| RuleHit {
            id: f.id,
            snippet: f.snippet,
            severity: None,
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
        Some(t) => without_choice_lines(dom, &without_lone_dash_cells(&t)),
        None => dom.text_content(body),
    };
    hits(check_em_dash_overuse(Some(&text)))
}

/// `innerText` without the lines a rendered `<select>`'s choices put there.
/// A `<select>` lists each `<option>` on a line of its own, and a currency
/// picker that writes "USD", a dash, "US Dollar" a hundred and fifty times
/// (vaultlykeep.com) holds no sentence. Each choice removes one line whose
/// collapsed text equals it, so the same words in the copy stay.
fn without_choice_lines(dom: &dyn Dom, text: &str) -> String {
    // Only a rendered `<select>` writes its options into `innerText`; a
    // hidden one, or a `<datalist>`, writes nothing, and its text must not
    // erase the same words in the copy.
    let mut choices: Vec<String> = dom
        .query_all(None, "option")
        .unwrap_or_default()
        .into_iter()
        .filter(|&o| {
            dom.closest(o, "select")
                .ok()
                .flatten()
                .is_some_and(|select| super::element_checks::is_painted_for_browser_rule(dom, select))
        })
        .map(|o| collapsed_text_content(dom, o))
        .filter(|t| !t.is_empty())
        .collect();
    if choices.is_empty() {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    for (i, line) in text.split('\n').enumerate() {
        let key = js::trim(&collapse_ws(line)).to_string();
        if let Some(at) = choices.iter().position(|c| *c == key) {
            choices.swap_remove(at);
            continue;
        }
        if i > 0 {
            out.push('\n');
        }
        out.push_str(line);
    }
    out
}

/// `innerText` without the cells whose whole text is a dash. A pricing matrix
/// marks every feature a plan lacks with one, and a mark alone in a cell is
/// not punctuation in prose. `innerText` separates table cells with a tab and
/// block boxes (grid cells included) with a line break, so a cell is a run
/// between those.
fn without_lone_dash_cells(text: &str) -> String {
    let is_dash_cell = |segment: &str| {
        let t = js::trim(segment);
        !t.is_empty() && t.chars().all(|c| matches!(c, '—' | '–' | '-'))
    };
    if !text.split(['\n', '\t']).any(is_dash_cell) {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    let mut start = 0usize;
    for (i, c) in text.char_indices() {
        if c == '\n' || c == '\t' {
            let segment = &text[start..i];
            if !is_dash_cell(segment) {
                out.push_str(segment);
            }
            out.push(c);
            start = i + c.len_utf8();
        }
    }
    let segment = &text[start..];
    if !is_dash_cell(segment) {
        out.push_str(segment);
    }
    out
}

/// How many wrappers a label collector climbs when the heading leads its
/// wrapper. Framer nests a card heading four single-child boxes deep.
pub const LABEL_CLIMB_LEVELS: usize = 4;

/// The widest gap a label may leave to its heading once the collector has
/// climbed past a wrapper: the label has to sit just above or just before it.
pub const LABEL_CLIMBED_MAX_GAP_PX: f64 = 96.0;

/// A label candidate and how many wrappers the collector climbed to reach it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LabelBefore {
    pub label: ElId,
    pub levels: usize,
}

/// The element a label before `heading` would be: its previous element
/// sibling, or, while the heading (then each wrapper above it) is the first
/// element child of its parent, that wrapper's previous element sibling, at
/// most [`LABEL_CLIMB_LEVELS`] wrappers up. `body` and `html` end the climb.
pub fn label_before_heading(dom: &dyn Dom, heading: ElId) -> Option<LabelBefore> {
    let mut current = heading;
    for levels in 0..=LABEL_CLIMB_LEVELS {
        if let Some(label) = dom.previous_element_sibling(current) {
            return Some(LabelBefore { label, levels });
        }
        let parent = dom.parent(current)?;
        if Some(parent) == dom.body() || Some(parent) == dom.document_element() {
            return None;
        }
        current = parent;
    }
    None
}

/// Whether `label` sits just above or just before `heading`: it does not start
/// below the heading, and the gap between the two boxes is at most
/// [`LABEL_CLIMBED_MAX_GAP_PX`]. A label with no box is not measured and does
/// not count.
pub fn label_near_heading(dom: &dyn Dom, label: ElId, heading: ElId) -> bool {
    let l = dom.rect(label);
    let h = dom.rect(heading);
    if l.width <= 0.0 || l.height <= 0.0 || h.width <= 0.0 || h.height <= 0.0 {
        return false;
    }
    if l.top >= h.bottom {
        return false;
    }
    let gap = (h.top - l.bottom).max(h.left - l.right).max(0.0);
    gap <= LABEL_CLIMBED_MAX_GAP_PX
}

/// The element that sets a label's type: the label itself when it has text of
/// its own, else the one element child that holds its text, at most three
/// levels down. Framer sets an eyebrow's size, tracking and case on a `p`
/// inside a bare `div`, and a mono index often sits in a `span` inside a sized
/// column. A chip puts an icon beside its text span (redoubt.agency's flag
/// svg, uncoverroads.com's status dot): children that hold no text are the
/// chip's marks, and the one that holds the text sets the type. A wrapper
/// with two children that both hold text is read as itself.
pub fn label_type_element(dom: &dyn Dom, label: ElId) -> ElId {
    let mut el = label;
    for _ in 0..3 {
        if !clean_inline_text(dom, el).is_empty() {
            return el;
        }
        let children = dom.children(el);
        let mut with_text = children
            .iter()
            .copied()
            .filter(|&c| !js::trim(&dom.text_content(c)).is_empty());
        let (Some(only), None) = (with_text.next(), with_text.next()) else {
            return el;
        };
        el = only;
    }
    el
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
                // A class that carries an id (`jet-listing-dynamic-post-43268`,
                // `elementor-element-a565c83`) names one instance, not a
                // spot: the slides of one carousel differ by nothing else.
                let mut cls: Vec<&str> = if raw_cls.is_empty() {
                    Vec::new()
                } else {
                    WS_RE
                        .split(raw_cls)
                        .filter(|s| !s.is_empty() && !crate::checks::text_rules::is_id_like_class(s))
                        .collect()
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
    // Text a visitor cannot see at capture repeats nothing on screen: the
    // slides a carousel parks past its window carry the same label as the one
    // it shows. The Text paint gate is asked of an element only once it has
    // passed the cheaper rendered test.
    collect_repeated_container_text_findings(dom, &|el| {
        if !is_rendered_for_browser_rule(dom, el) {
            return false;
        }
        // The collector asks this of the container and of each element
        // under it. The Text gate needs text, so it is asked only of an
        // element that holds some; a container's box is asked the gate's
        // walk without that test.
        if super::dom::has_direct_text_longer_than(dom, el, 0) {
            super::painted::unpainted_for(dom, el, super::painted::PaintGate::Text).is_none()
        } else {
            super::painted::unpainted_text_box(dom, el).is_none()
        }
    })
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
        d.set_rect(kicker, 40.0, 100.0, 240.0, 16.0);
        let h = d.add(Some(sec), "h2");
        d.add_text(h, "Everything you need");
        d.set_style(h, "fontSize", "32px");
        d.set_rect(h, 40.0, 124.0, 600.0, 40.0);
        let hits = check_kicker_above_heading_dom(&d, None);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].finding.type_, "kicker-above-heading");
        assert_eq!(
            hits[0].finding.detail,
            "kicker \"Features\" above h2 \"Everything you need\""
        );
        // The finding names the eyebrow, not the page (REN-406).
        assert_eq!(hits[0].el, Some(kicker));

        // An eyebrow the repository's DESIGN.md declares by name stands down.
        d.add_selector(kicker, ".eyebrow");
        let ds = DesignSystemConfig {
            declared_selectors: vec![".eyebrow".to_string()],
            ..Default::default()
        };
        assert!(check_kicker_above_heading_dom(&d, Some(&ds)).is_empty());
        // A selector the document does not name leaves it charged.
        let other = DesignSystemConfig {
            declared_selectors: vec![".kicker".to_string()],
            ..Default::default()
        };
        assert_eq!(check_kicker_above_heading_dom(&d, Some(&other)).len(), 1);
        // A card context (heading inside <article> that also contains the
        // kicker) stands down.
        let art = d.add(Some(body), "article");
        let k2 = d.add(Some(art), "p");
        d.add_text(k2, "NEWS");
        d.set_styles(k2, &[("fontSize", "12px"), ("letterSpacing", "1.2px")]);
        d.set_rect(k2, 40.0, 300.0, 240.0, 16.0);
        let h2 = d.add(Some(art), "h3");
        d.add_text(h2, "Card heading");
        d.set_style(h2, "fontSize", "24px");
        d.set_rect(h2, 40.0, 324.0, 600.0, 32.0);
        assert_eq!(check_kicker_above_heading_dom(&d, None).len(), 1);
    }

    /// The kicker rule hands a label over a display h1 to the hero rule only
    /// where the hero rule reports it. A small-caps kicker at 0.1em is not
    /// caps to the hero rule, so it stays a kicker; the same label set in
    /// uppercase goes to the hero rule.
    #[test]
    fn kicker_hands_off_only_what_the_hero_rule_reports() {
        let hero = |d: &mut FakeDom, body: ElId, y: f64, variant: &str, transform: &str, heading: &str| {
            let sec = d.add(Some(body), "section");
            let kicker = d.add(Some(sec), "p");
            d.add_text(kicker, "new in version four");
            d.set_styles(
                kicker,
                &[
                    ("fontSize", "13px"),
                    ("letterSpacing", "1.3px"),
                    ("textTransform", transform),
                    ("fontVariant", variant),
                    ("fontVariantCaps", variant),
                ],
            );
            d.set_rect(kicker, 40.0, y, 240.0, 18.0);
            let h = d.add(Some(sec), "h1");
            d.add_text(h, heading);
            d.set_style(h, "fontSize", "56px");
            d.set_rect(h, 40.0, y + 30.0, 900.0, 64.0);
        };
        let mut d = FakeDom::new();
        let (_html, body) = d.with_page();
        hero(&mut d, body, 100.0, "small-caps", "none", "The workspace that thinks");
        let hits = check_kicker_above_heading_dom(&d, None);
        assert_eq!(hits.len(), 1, "{hits:?}");
        assert!(hits[0].finding.detail.contains("new in version four"));

        let mut d = FakeDom::new();
        let (_html, body) = d.with_page();
        hero(&mut d, body, 100.0, "normal", "uppercase", "The workspace that thinks");
        assert!(check_kicker_above_heading_dom(&d, None).is_empty());
    }

    /// demotv.lol's hero pair in a section at `hidden`, and exxonmobil.com's
    /// inactive slide: the same label and heading a visitor cannot see.
    #[test]
    fn kicker_above_heading_skips_a_pair_nobody_sees() {
        let pair = |d: &mut FakeDom, parent: ElId, y: f64, heading: &str| {
            let kicker = d.add(Some(parent), "span");
            d.add_text(kicker, "Channel battle");
            d.set_styles(
                kicker,
                &[("fontSize", "12px"), ("letterSpacing", "1.3px"), ("textTransform", "uppercase")],
            );
            d.set_rect(kicker, 40.0, y, 240.0, 16.0);
            let h = d.add(Some(parent), "h2");
            d.add_text(h, heading);
            d.set_style(h, "fontSize", "32px");
            d.set_rect(h, 40.0, y + 24.0, 600.0, 40.0);
            (kicker, h)
        };
        let mut d = FakeDom::new();
        let (_html, body) = d.with_page();
        let shown = d.add(Some(body), "div");
        pair(&mut d, shown, 100.0, "Which would you try");

        let hidden = d.add(Some(body), "section");
        d.set_attr(hidden, "hidden", "");
        d.set_style(hidden, "display", "none");
        let (k, h) = pair(&mut d, hidden, 0.0, "Watch both demos");
        for el in [hidden, k, h] {
            d.el_mut(el).check_visibility = Some(false);
            d.set_rect(el, 0.0, 0.0, 0.0, 0.0);
        }

        let slide = d.add(Some(body), "div");
        d.set_styles(slide, &[("opacity", "0"), ("visibility", "hidden")]);
        d.set_rect(slide, 0.0, 300.0, 1280.0, 400.0);
        let (k, h) = pair(&mut d, slide, 320.0, "Second quarter results");
        for el in [k, h] {
            d.set_style(el, "visibility", "hidden");
            d.el_mut(el).check_visibility = Some(false);
        }

        let hits = check_kicker_above_heading_dom(&d, None);
        let snippets: Vec<&str> = hits.iter().map(|h| h.finding.detail.as_str()).collect();
        assert_eq!(snippets, vec!["kicker \"Channel battle\" above h2 \"Which would you try\""]);
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

    /// nousresearch.com miss 458: "#1 Connect" to "#6 Experiment", 10px
    /// uppercase over 46px h3s, each pair in a bare `article` on the
    /// section's grey. The `#` reads as the number, and an article drawn as
    /// nothing is not a card. The same articles drawn as cards keep the
    /// card exemption, and a ranking word after the number still parses as
    /// a label only when its text is the label's.
    #[test]
    fn numbered_labels_read_a_hash_and_need_a_drawn_article() {
        let build = |card: bool, texts: [&str; 2]| {
            let mut d = FakeDom::new();
            let (_html, body) = d.with_page();
            d.set_style(body, "backgroundColor", "rgb(242, 242, 242)");
            for (i, text) in texts.iter().enumerate() {
                let article = d.add(Some(body), "article");
                d.set_rect(article, 95.0, 2461.0 + i as f64 * 600.0, 333.0, 540.0);
                if card {
                    d.set_styles(
                        article,
                        &[
                            ("boxShadow", "rgba(0, 0, 0, 0.1) 0px 2px 8px 0px"),
                            ("borderRadius", "12px"),
                            ("backgroundColor", "rgb(255, 255, 255)"),
                        ],
                    );
                }
                let head = d.add(Some(article), "div");
                let label = d.add(Some(head), "p");
                d.add_text(label, text);
                d.set_styles(
                    label,
                    &[
                        ("fontSize", "10px"),
                        ("textTransform", "uppercase"),
                        ("fontWeight", "400"),
                        ("fontFamily", "sans-serif"),
                        ("color", "rgb(0, 0, 0)"),
                    ],
                );
                let h = d.add(Some(head), "h3");
                d.add_text(h, &format!("Feature {}", i + 1));
                d.set_style(h, "fontSize", "46px");
            }
            check_numbered_section_labels_dom(&d)
        };
        let hits = build(false, ["#1 Connect", "#2 Remember"]);
        assert_eq!(hits.len(), 2, "{hits:?}");
        assert_eq!(hits[0].snippet, "tiny numbered label \"#1 Connect\" beside h3 \"Feature 1\" (2 on page)");
        assert!(build(true, ["#1 Connect", "#2 Remember"]).is_empty(), "drawn as cards");
        assert_eq!(build(false, ["#01", "#02"]).len(), 2, "a bare hash index");
        assert!(build(false, ["#1Connect", "#2Remember"]).is_empty(), "no space after the number");
        assert!(build(false, ["#123 Connect", "#124 Remember"]).is_empty(), "three digits");
    }

    /// Review of round 11: a card drawn outside the article (a link or a
    /// `div` card component around it) keeps the card exemption, and a
    /// ranked list of `#` labels is not section numbering.
    #[test]
    fn numbered_labels_keep_cards_drawn_around_the_article_and_skip_ranks() {
        let build = |wrapper: Option<&str>, texts: [&str; 3]| {
            let mut d = FakeDom::new();
            let (_html, body) = d.with_page();
            d.set_style(body, "backgroundColor", "rgb(255, 255, 255)");
            let grid = d.add(Some(body), "div");
            for (i, text) in texts.iter().enumerate() {
                let parent = match wrapper {
                    Some(tag) => {
                        let w = d.add(Some(grid), tag);
                        d.set_styles(
                            w,
                            &[
                                ("boxShadow", "rgba(0, 0, 0, 0.12) 0px 2px 8px 0px"),
                                ("borderRadius", "16px"),
                                ("backgroundColor", "rgb(243, 239, 230)"),
                            ],
                        );
                        w
                    }
                    None => grid,
                };
                let article = d.add(Some(parent), "article");
                d.set_rect(article, 24.0 + i as f64 * 360.0, 100.0, 330.0, 300.0);
                let label = d.add(Some(article), "span");
                d.add_text(label, text);
                d.set_styles(
                    label,
                    &[
                        ("fontSize", "11px"),
                        ("textTransform", "uppercase"),
                        ("fontFamily", "monospace"),
                        ("color", "rgb(102, 102, 102)"),
                    ],
                );
                let h = d.add(Some(article), "h3");
                d.add_text(h, &format!("Step {}", i + 1));
                d.set_style(h, "fontSize", "28px");
            }
            check_numbered_section_labels_dom(&d).len()
        };
        assert_eq!(build(None, ["01", "02", "03"]), 3, "bare articles");
        assert_eq!(build(Some("a"), ["01", "02", "03"]), 0, "a link around each article");
        assert_eq!(build(Some("div"), ["#1", "#2", "#3"]), 0, "a drawn div around each article");
        assert_eq!(build(None, ["#1 Rated", "#2 Rated", "#3 Rated"]), 0, "a ranking word");
        assert_eq!(build(None, ["#1 Fast", "#2 Fast", "#3 Fast"]), 0, "one word repeated");
        assert_eq!(build(None, ["#1 Plan", "#2 Build", "#3 Ship"]), 3, "named sections");
    }

    /// gig-connect-six.vercel.app: a capacity badge, a people icon and a
    /// count in one box, is not a section number.
    #[test]
    fn numbered_labels_holding_an_icon_are_badges() {
        let build = |icon: Option<&str>| {
            let mut d = FakeDom::new();
            let (_html, body) = d.with_page();
            for (i, idx) in ["35", "30"].iter().enumerate() {
                let sec = d.add(Some(body), "section");
                let label = d.add(Some(sec), "span");
                match icon {
                    Some("beside") => {
                        d.add(Some(label), "svg");
                    }
                    Some(_) => {
                        let tile = d.add(Some(label), "div");
                        d.add(Some(tile), "svg");
                    }
                    None => {}
                }
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
                d.add_text(h, &format!("Venue number {}", i + 1));
                d.set_style(h, "fontSize", "28px");
            }
            d
        };
        assert_eq!(check_numbered_section_labels_dom(&build(None)).len(), 2);
        assert!(check_numbered_section_labels_dom(&build(Some("beside"))).is_empty());
        // An icon in a tile of its own beside a card's number leaves the
        // number a number (arbiproseller-app.vercel.app's feature cards).
        assert_eq!(check_numbered_section_labels_dom(&build(Some("tile"))).len(), 2);
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

    /// visiby.net: a pricing matrix marks every missing feature with a lone
    /// dash in its cell.
    #[test]
    fn em_dash_skips_cells_whose_whole_text_is_a_dash() {
        let mut d = FakeDom::new();
        let (_html, body) = d.with_page();
        d.add_text(body, "placeholder");
        let matrix = "FEATURES\n25 prompts / month\t✓\t—\t—\t—\nAPI access\t—\t—\t✓\t✓\n".repeat(6);
        d.el_mut(body).inner_text = Some(format!("Track your brand — and climb.\n{matrix}"));
        assert!(check_em_dash_overuse_dom(&d).is_empty());
        let prose = "a — b — c — d — e — f — g — h — i\n";
        d.el_mut(body).inner_text = Some(format!("{prose}{matrix}"));
        let hits = check_em_dash_overuse_dom(&d);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].snippet, "8 em-dashes in body text");
        assert_eq!(without_lone_dash_cells("x\t—\ty\n -- \n"), "x\t\ty\n\n");
        assert_eq!(without_lone_dash_cells("no cells — here"), "no cells — here");
    }

    /// vaultlykeep.com: a currency picker lists "USD — US Dollar" and a
    /// hundred more, each option on its own line of `innerText`.
    #[test]
    fn em_dash_skips_the_lines_a_select_lists() {
        let mut d = FakeDom::new();
        let (_html, body) = d.with_page();
        let select = d.add(Some(body), "select");
        let codes = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "CNY", "INR", "CHF"];
        let mut lines = vec!["Prices shown in USD".to_string()];
        for code in codes {
            let option = d.add(Some(select), "option");
            d.add_text(option, &format!("{code} — {code} currency"));
            lines.push(format!("{code} — {code} currency"));
        }
        d.el_mut(body).inner_text = Some(lines.join("\n"));
        assert!(check_em_dash_overuse_dom(&d).is_empty());
        // The same lines written as copy outside the control still count.
        let prose: Vec<String> = codes.iter().map(|c| format!("{c} — said once more")).collect();
        d.el_mut(body).inner_text = Some(format!("{}\n{}", lines.join("\n"), prose.join("\n")));
        assert_eq!(check_em_dash_overuse_dom(&d)[0].snippet, "9 em-dashes in body text");

        // A hidden picker writes nothing into `innerText`: its options do
        // not erase the same words written as copy.
        let mut d = FakeDom::new();
        let (_html, body) = d.with_page();
        let select = d.add(Some(body), "select");
        d.set_style(select, "display", "none");
        d.el_mut(select).check_visibility = Some(false);
        for code in codes {
            let option = d.add(Some(select), "option");
            d.add_text(option, &format!("{code} — said once more"));
        }
        d.el_mut(body).inner_text = Some(prose.join("\n"));
        assert_eq!(check_em_dash_overuse_dom(&d)[0].snippet, "9 em-dashes in body text");
    }

    #[test]
    fn label_before_heading_climbs_first_children_up_to_the_limit() {
        let mut d = FakeDom::new();
        let (_html, body) = d.with_page();
        // Framer: the heading four single-child wrappers below the tile's
        // sibling.
        let row = d.add(Some(body), "div");
        let tile = d.add(Some(row), "div");
        let mut at = d.add(Some(row), "div");
        for _ in 0..3 {
            at = d.add(Some(at), "div");
        }
        let h6 = d.add(Some(at), "h6");
        assert_eq!(
            label_before_heading(&d, h6),
            Some(LabelBefore { label: tile, levels: 4 })
        );
        // One wrapper more is past the limit.
        let row = d.add(Some(body), "div");
        let _tile = d.add(Some(row), "div");
        let mut at = d.add(Some(row), "div");
        for _ in 0..4 {
            at = d.add(Some(at), "div");
        }
        let deep = d.add(Some(at), "h6");
        assert_eq!(label_before_heading(&d, deep), None);
        // A heading with a previous sibling reads it, as before.
        let wrap = d.add(Some(body), "div");
        let note = d.add(Some(wrap), "p");
        let h3 = d.add(Some(wrap), "h3");
        assert_eq!(
            label_before_heading(&d, h3),
            Some(LabelBefore { label: note, levels: 0 })
        );
        // The climb ends at body.
        let top = d.add(Some(body), "h2");
        let _ = top;
        let lone_body = {
            let mut d = FakeDom::new();
            let (_html, body) = d.with_page();
            let h = d.add(Some(body), "h2");
            label_before_heading(&d, h)
        };
        assert_eq!(lone_body, None);
    }

    /// dadastudio.framer.website: the eyebrow's type is set on a p inside a
    /// bare div, and the heading leads its own wrapper.
    #[test]
    fn kicker_collector_climbs_a_wrapper_and_reads_the_text_child() {
        let mut d = FakeDom::new();
        let (_html, body) = d.with_page();
        let sec = d.add(Some(body), "section");
        let wrap = d.add(Some(sec), "div");
        d.set_rect(wrap, 48.0, 100.0, 600.0, 14.0);
        d.set_style(wrap, "fontSize", "12px");
        let p = d.add(Some(wrap), "p");
        d.add_text(p, "Hear from our client");
        d.set_styles(
            p,
            &[
                ("fontSize", "12.375px"),
                ("letterSpacing", "0.99px"),
                ("textTransform", "uppercase"),
                ("fontVariant", "normal"),
                ("fontVariantCaps", "normal"),
            ],
        );
        let heading_wrap = d.add(Some(sec), "div");
        d.set_rect(heading_wrap, 48.0, 146.0, 600.0, 90.0);
        let h = d.add(Some(heading_wrap), "h2");
        d.add_text(h, "The kind of work");
        d.set_style(h, "fontSize", "40px");
        d.set_rect(h, 48.0, 146.0, 600.0, 90.0);
        let hits = check_kicker_above_heading_dom(&d, None);
        assert_eq!(hits.len(), 1, "{hits:?}");
        assert_eq!(
            hits[0].finding.detail,
            "kicker \"Hear from our client\" above h2 \"The kind of work\""
        );
        // A label far above the wrapped heading is not its kicker.
        d.set_rect(h, 48.0, 400.0, 600.0, 90.0);
        assert!(check_kicker_above_heading_dom(&d, None).is_empty());
        // Nor is a label with no box to measure.
        d.set_rect(h, 48.0, 146.0, 600.0, 90.0);
        d.set_rect(wrap, 0.0, 0.0, 0.0, 0.0);
        assert!(check_kicker_above_heading_dom(&d, None).is_empty());
    }

    /// v0-optimus-delta.vercel.app: a mono index in a column beside the
    /// heading's grandparent.
    #[test]
    fn numbered_labels_climb_to_an_index_column() {
        let mut d = FakeDom::new();
        let (_html, body) = d.with_page();
        for (i, idx) in ["01", "02"].iter().enumerate() {
            let y = 100.0 + 320.0 * i as f64;
            let row = d.add(Some(body), "div");
            let col = d.add(Some(row), "div");
            d.set_style(col, "fontSize", "16px");
            d.set_rect(col, 48.0, y, 17.0, 160.0);
            let span = d.add(Some(col), "span");
            d.add_text(span, idx);
            d.set_styles(
                span,
                &[
                    ("fontSize", "14px"),
                    ("fontFamily", "\"JetBrains Mono\", monospace"),
                    ("fontWeight", "400"),
                    ("letterSpacing", "normal"),
                    ("textTransform", "none"),
                    ("color", "rgb(113, 113, 122)"),
                ],
            );
            let body_col = d.add(Some(row), "div");
            let grid = d.add(Some(body_col), "div");
            let item = d.add(Some(grid), "div");
            let h = d.add(Some(item), "h3");
            d.add_text(h, &format!("Capability {}", i + 1));
            d.set_style(h, "fontSize", "36px");
            d.set_rect(h, 128.0, y + 23.0, 535.0, 40.0);
        }
        let hits = check_numbered_section_labels_dom(&d);
        assert_eq!(hits.len(), 2, "{hits:?}");
        assert_eq!(
            hits[0].snippet,
            "tiny numbered label \"01\" beside h3 \"Capability 1\" (2 on page)"
        );
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
        d.set_rect(card, 0.0, 0.0, 400.0, 200.0);
        let mut spots = Vec::new();
        for (i, tag) in ["p", "span", "em"].into_iter().enumerate() {
            let e = d.add(Some(card), tag);
            d.add_text(e, "Active");
            d.set_style(e, "fontSize", "14px");
            d.set_rect(e, 20.0, 20.0 + 30.0 * i as f64, 60.0, 20.0);
            spots.push(e);
        }
        let hits = check_repeated_container_text_dom(&d);
        assert_eq!(hits.len(), 1);
        // classSelector is fork A's (element_checks); the stub yields the
        // bare tag, the real one "div.card".
        assert!(hits[0]
            .snippet
            .starts_with("\"Active\" rendered 3× in distinct spots inside div"));
        // observations-35 row 15 (kinghost.com.br 218763): a spot a visitor
        // cannot see repeats nothing. With one of the three unpainted, two
        // are left.
        d.set_style(spots[2], "visibility", "hidden");
        assert!(check_repeated_container_text_dom(&d).is_empty(), "a hidden spot");
        d.set_style(spots[2], "visibility", "visible");
        assert_eq!(check_repeated_container_text_dom(&d).len(), 1);
        // Classes that carry an id name an instance, not a spot: three
        // slides that differ by nothing else are one spot three times.
        for (e, id) in spots.iter().zip(["post-43268", "post-22775", "post-42287"]) {
            d.el_mut(*e).tag = "P".to_string();
            d.set_attr(*e, "class", &format!("term jet-listing-dynamic-{id}"));
        }
        assert!(check_repeated_container_text_dom(&d).is_empty(), "id-like classes");
        for (e, class) in spots.iter().zip(["term title", "term badge", "term footer"]) {
            d.set_attr(*e, "class", class);
        }
        assert_eq!(check_repeated_container_text_dom(&d).len(), 1, "three named spots");
        use crate::checks::text_rules::is_id_like_class;
        assert!(is_id_like_class("elementor-element-a565c83"));
        assert!(is_id_like_class("elementor-dcss-67254963955209192"));
        assert!(is_id_like_class("jet_listing_43268"));
        for plain in ["grid-col-desk-2", "elementor-col-50", "text-gray-500", "card", "face-cafe", "w-1/2"] {
            assert!(!is_id_like_class(plain), "{plain}");
        }

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
