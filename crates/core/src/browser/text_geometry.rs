//! Where a block's text is, for the rules that measure text geometry: the
//! extent of its glyphs, the pitch of its line boxes, and the clipping boxes
//! that cut it.
//!
//! A paragraph's border box spans its column whatever its text does: a
//! one-line note in a 1,200px box, a centred footer line, a sentence ended
//! early by a `<br>`. `line-length`, `body-text-viewport-edge`, `tight-leading`,
//! `cramped-padding` and `text-overflow` ask what a reader meets, so they read
//! the union of the Range client rects of the text ([`Dom::direct_text_rect`])
//! rather than the box. A Dom that cannot measure text answers `None` here,
//! and each rule then keeps the box it read before.

use super::dom::{direct_text, tag_lower, Dom, ElId, Rect};
use crate::checks::measures::resolve_length_px;
use crate::checks::text_rules::{is_monospace_family, MONOSPACE_ADVANCE_EM, NON_RENDERED_TAGS, PROPORTIONAL_ADVANCE_EM};
use crate::js::{self, parse_float};

/// Phrasing content: the tags whose text flows in the line boxes of the block
/// around them.
pub const PHRASING_TAGS: &[&str] = &[
    "a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "data", "del", "dfn", "em", "font", "i",
    "ins", "kbd", "mark", "q", "s", "samp", "small", "span", "strong", "sub", "sup", "time", "u",
    "var", "wbr",
];

/// `overflow-x`, from the shorthand's first value when the capture recorded
/// no longhand. `overflow-x: hidden` computes the shorthand to `hidden auto`,
/// so the shorthand says nothing about the x axis on its own.
pub fn overflow_x(dom: &dyn Dom, el: ElId) -> String {
    let x = dom.style(el, "overflowX");
    if !x.is_empty() {
        return x;
    }
    dom.style(el, "overflow").split_whitespace().next().unwrap_or("").to_string()
}

/// `overflow-y`, from the shorthand when the capture recorded no longhand:
/// its second value, or its only one.
pub fn overflow_y(dom: &dyn Dom, el: ElId) -> String {
    let y = dom.style(el, "overflowY");
    if !y.is_empty() {
        return y;
    }
    let shorthand = dom.style(el, "overflow");
    let mut values = shorthand.split_whitespace();
    let first = values.next().unwrap_or("");
    values.next().unwrap_or(first).to_string()
}

/// Whether `el` clips or scrolls its content on the x axis.
pub fn clips_x(dom: &dyn Dom, el: ElId) -> bool {
    matches!(overflow_x(dom, el).as_str(), "hidden" | "clip" | "auto" | "scroll")
}

/// An element that generates no box and paints nothing: a script inside a
/// paragraph, a `display: none` twin.
fn paints_nothing(dom: &dyn Dom, el: ElId) -> bool {
    NON_RENDERED_TAGS.contains(&tag_lower(dom, el).as_str()) || dom.style(el, "display") == "none"
}

/// A phrasing tag laid out inline. A capture that recorded no display counts
/// by its tag.
fn is_inline_phrasing(dom: &dyn Dom, el: ElId) -> bool {
    PHRASING_TAGS.contains(&tag_lower(dom, el).as_str())
        && matches!(dom.style(el, "display").as_str(), "inline" | "")
}

/// Whether everything under `el` is inline phrasing content (or paints
/// nothing), so all of its text runs in `el`'s own line boxes: a paragraph
/// whose words sit in `<b>`, `<i>` or `<span>`.
pub fn holds_only_phrasing(dom: &dyn Dom, el: ElId) -> bool {
    dom.children(el)
        .into_iter()
        .all(|c| paints_nothing(dom, c) || (is_inline_phrasing(dom, c) && holds_only_phrasing(dom, c)))
}

fn usable(r: &Rect) -> bool {
    r.all_finite() && r.width > 0.0 && r.height > 0.0
}

fn union(a: Option<Rect>, b: Rect) -> Rect {
    match a {
        None => b,
        Some(a) => {
            let left = js::math_min(a.left, b.left);
            let top = js::math_min(a.top, b.top);
            let right = js::math_max(a.right, b.right);
            let bottom = js::math_max(a.bottom, b.bottom);
            Rect::from_xywh(left, top, right - left, bottom - top)
        }
    }
}

fn extend_phrasing(dom: &dyn Dom, el: ElId, acc: &mut Option<Rect>) {
    if let Some(t) = dom.direct_text_rect(el) {
        if usable(&t) {
            *acc = Some(union(*acc, t));
        }
    }
    for c in dom.children(el) {
        if !paints_nothing(dom, c) && is_inline_phrasing(dom, c) {
            extend_phrasing(dom, c, acc);
        }
    }
}

/// The extent of the text `el` sets in its own line boxes: the union of the
/// text rects of its own text and of the inline phrasing elements under it.
/// `None` when none of it can be measured.
pub fn phrasing_text_extent(dom: &dyn Dom, el: ElId) -> Option<Rect> {
    let mut acc = None;
    extend_phrasing(dom, el, &mut acc);
    acc
}

/// One run of the text a block sets in its own line boxes: how many
/// characters it holds, its font size and its Latin glyph advance.
struct TextRun {
    chars: f64,
    font_size: f64,
    advance_em: f64,
}

fn collect_runs(dom: &dyn Dom, el: ElId, font_size: f64, runs: &mut Vec<TextRun>) {
    let advance_em = if is_monospace_family(&dom.style(el, "fontFamily")) {
        MONOSPACE_ADVANCE_EM
    } else {
        PROPORTIONAL_ADVANCE_EM
    };
    let chars = direct_text(dom, el).chars().filter(|c| !c.is_whitespace()).count() as f64;
    if chars > 0.0 {
        runs.push(TextRun { chars, font_size, advance_em });
    }
    for c in dom.children(el) {
        if !paints_nothing(dom, c) && is_inline_phrasing(dom, c) {
            let size = parse_float(&dom.style(c, "fontSize"));
            let size = if size.is_finite() && size > 0.0 { size } else { font_size };
            collect_runs(dom, c, size, runs);
        }
    }
}

fn weighted(runs: &[TextRun], value: fn(&TextRun) -> f64) -> f64 {
    let first = value(&runs[0]);
    if runs.iter().all(|r| value(r) == first) {
        return first;
    }
    let total: f64 = runs.iter().map(|r| r.chars).sum();
    runs.iter().map(|r| r.chars * value(r)).sum::<f64>() / total
}

/// The font `el`'s text is set in, for estimating characters per line from
/// its width: the font size of the text runs themselves and the average
/// advance of their Latin glyphs in ems ([`PROPORTIONAL_ADVANCE_EM`], or
/// [`MONOSPACE_ADVANCE_EM`] for a monospace face), each weighted by the
/// characters the run holds. A 16px paragraph whose words sit in a 24px span
/// is set at 24px. `font_size` is `el`'s own; a run whose size was not
/// recorded takes its parent's. With no text runs, `el`'s own font stands.
pub fn phrasing_text_font(dom: &dyn Dom, el: ElId, font_size: f64) -> (f64, f64) {
    let mut runs = Vec::new();
    collect_runs(dom, el, font_size, &mut runs);
    if runs.is_empty() {
        let advance = if is_monospace_family(&dom.style(el, "fontFamily")) {
            MONOSPACE_ADVANCE_EM
        } else {
            PROPORTIONAL_ADVANCE_EM
        };
        return (font_size, advance);
    }
    (weighted(&runs, |r| r.font_size), weighted(&runs, |r| r.advance_em))
}

/// The line-height `el`'s text is set at, for an element with its own
/// resolved `own` line-height. An inline element's line boxes belong to the
/// block around it, whose strut sets the pitch when it is taller than the
/// inline's own: an 11px link run at `line-height: 11px` inside a 14px block
/// lands on 14px lines. A block whose line-height cannot be resolved
/// (`normal`) leaves the element's own value, as before.
pub fn line_pitch_px(dom: &dyn Dom, el: ElId, own: f64) -> f64 {
    if dom.style(el, "display") != "inline" {
        return own;
    }
    let mut cur = dom.parent(el);
    while let Some(p) = cur {
        let display = dom.style(p, "display");
        if display != "inline" && display != "contents" {
            let font_size = parse_float(&dom.style(p, "fontSize"));
            if !(font_size.is_finite() && font_size > 0.0) {
                return own;
            }
            return match resolve_length_px(Some(&dom.style(p, "lineHeight")), font_size) {
                Some(block) if block.is_finite() && block > own => block,
                _ => own,
            };
        }
        cur = dom.parent(p);
    }
    own
}

/// Whether a horizontal scroller between `el` and the page root cuts `text`
/// at one of its sides: a slide in a track the visitor swipes, a paragraph in
/// a scrolled table. Scrolling brings that text into view, so what shows near
/// the viewport edge there is the track's clip, not the page's gutter.
///
/// Only a box that really scrolls on x counts: `overflow-x: auto` or `scroll`
/// with a `scrollWidth` past its `clientWidth`, the scroller the painted
/// predicate lets bring content into its box. A box that only hides its
/// overflow (a Tailwind `overflow-x-hidden` page wrapper, a section or card at
/// `overflow: hidden`) cannot tell a carousel track from text cut off by a
/// layout bug, and the text stays reported. A metric the capture did not
/// record proves no scroller either. The root and body stand for the viewport
/// and are not counted.
pub fn scrolling_ancestor_cuts(dom: &dyn Dom, el: ElId, text: &Rect) -> bool {
    let root = dom.document_element();
    let body = dom.body();
    let mut cur = dom.parent(el);
    while let Some(p) = cur {
        if Some(p) == root || Some(p) == body {
            break;
        }
        if scrolls_x(dom, p) || moves_a_track(dom, el, p) {
            let cr = dom.rect(p);
            if cr.all_finite() && (text.left < cr.left - 1.0 || text.right > cr.right + 1.0) {
                return true;
            }
        }
        cur = dom.parent(p);
    }
    false
}

/// Whether `clip`, a box that hides its horizontal overflow, holds a track a
/// script moves with transforms: an element between `el` and `clip` that
/// carries a `transform` or `translate`, lays out a row of at least two boxes
/// side by side, and whose content runs past `clip`'s width. Framer tickers
/// and Swiper, slick and Embla carousels move their track that way inside a
/// box that only hides overflow, and the script brings what the clip cuts
/// into view. A box that hides overflow around content with no such track (a
/// section cutting a paragraph at the screen edge) proves no track, and
/// neither does a metric the capture did not record.
pub(crate) fn moves_a_track(dom: &dyn Dom, el: ElId, clip: ElId) -> bool {
    if !matches!(overflow_x(dom, clip).as_str(), "hidden" | "clip") {
        return false;
    }
    let client = dom.client_width(clip);
    if !(client.is_finite() && client > 0.0) {
        return false;
    }
    let mut cur = dom.parent(el);
    while let Some(t) = cur {
        if t == clip {
            break;
        }
        let content = dom.scroll_width(t);
        if is_transformed(dom, t) && content.is_finite() && content > client + 1.0 && holds_row(dom, t) {
            return true;
        }
        cur = dom.parent(t);
    }
    false
}

/// Whether `el` rides a track that is moving at capture: a box between it and
/// a clip that hides x overflow which a running, endlessly repeating CSS
/// animation transforms ([`moves_a_track`] with the animation on the track).
/// paseo.sh's testimonial cards sit in a `social-proof-track` animated by
/// `social-proof-scroll`; where a card's text stands against the viewport
/// edge is where the capture caught it, not a gutter the page sets. A track a
/// script parks with a transform (a carousel at its first slide) holds still,
/// and its text is measured as before.
pub fn rides_a_running_track(dom: &dyn Dom, el: ElId) -> bool {
    let root = dom.document_element();
    let body = dom.body();
    let mut cur = dom.parent(el);
    while let Some(clip) = cur {
        if Some(clip) == root || Some(clip) == body {
            break;
        }
        if matches!(overflow_x(dom, clip).as_str(), "hidden" | "clip") {
            let client = dom.client_width(clip);
            let mut inner = dom.parent(el);
            while let Some(t) = inner {
                if t == clip {
                    break;
                }
                let content = dom.scroll_width(t);
                if client.is_finite()
                    && client > 0.0
                    && content.is_finite()
                    && content > client + 1.0
                    && is_transformed(dom, t)
                    && runs_endless_animation(dom, t)
                    && holds_row(dom, t)
                {
                    return true;
                }
                inner = dom.parent(t);
            }
        }
        cur = dom.parent(clip);
    }
    false
}

/// A CSS animation that never ends and moves the box: a name other than
/// `none` whose own `infinite` iteration count (the lists pair by position,
/// the shorter one repeating) sits on keyframes that move it (`transform` or
/// `translate`), or on keyframes the capture could not read. A one-shot
/// slide beside an endless fade or pulse is not a moving track, and neither
/// is an endless pulse whose transform only scales the box in place.
fn runs_endless_animation(dom: &dyn Dom, el: ElId) -> bool {
    let counts_raw = dom.style(el, "animationIterationCount");
    let counts: Vec<&str> = counts_raw.split(',').map(js::trim).collect();
    if counts.is_empty() {
        return false;
    }
    dom.style(el, "animationName").split(',').enumerate().any(|(i, name)| {
        let name = js::trim(name);
        !name.is_empty()
            && name != "none"
            && counts[i % counts.len()] == "infinite"
            && dom.keyframes(name).is_none_or(|frames| {
                frames.iter().any(|f| {
                    f.decls.iter().any(|(p, v)| match p.strip_prefix("-webkit-").unwrap_or(p) {
                        "translate" => true,
                        "transform" => !crate::checks::css_scan::transform_only_scales(v),
                        _ => false,
                    })
                })
            })
    })
}

/// The x range of a truncated line: text measured at `(left, right)` cut to
/// the padding box of `el`, which hides its own inline overflow. The caller
/// asks this only of a box that truncates by design (an ellipsis or a line
/// clamp on a box that generates one): the Range rect of such a line runs on
/// past the box (keydris.com's `div.truncate` 97px past a 390px viewport,
/// leilonozap.vercel.app's `p.truncate` 809px) while the line a visitor sees
/// ends in an ellipsis inside its card. An unmeasured box leaves the range
/// as it was.
///
/// Only the element's own clip is read. Text an ancestor cuts (a card or a
/// section at `overflow: hidden`) is cut mid-word with no marker, and the
/// rule keeps reporting it against the viewport, as before.
pub fn clamp_to_own_clip(dom: &dyn Dom, el: ElId, left: f64, right: f64) -> (f64, f64) {
    let r = dom.rect(el);
    if !(r.all_finite() && r.width > 0.0) {
        return (left, right);
    }
    let border = dom.client_left(el);
    let clip_left = r.left + if border.is_finite() && border > 0.0 { border } else { 0.0 };
    let client = dom.client_width(el);
    let clip_right = if client.is_finite() && client > 0.0 { clip_left + client } else { r.right };
    (js::math_max(left, clip_left), js::math_min(right, clip_right))
}

/// A `transform` or `translate` other than `none`, the identity matrix
/// included: a track parked at its first slide.
fn is_transformed(dom: &dyn Dom, el: ElId) -> bool {
    ["transform", "translate"].iter().any(|prop| {
        let v = dom.style(el, prop);
        !v.is_empty() && v != "none"
    })
}

/// Whether two consecutive children with area sit side by side: one starts
/// where the other ends, on overlapping lines.
fn holds_row(dom: &dyn Dom, el: ElId) -> bool {
    let boxes: Vec<Rect> = dom
        .children(el)
        .into_iter()
        .map(|c| dom.rect(c))
        .filter(|r| r.all_finite() && r.width >= 1.0 && r.height >= 1.0)
        .collect();
    boxes.windows(2).any(|w| {
        let (a, b) = (&w[0], &w[1]);
        let beside = b.left >= a.right - 1.0 || b.right <= a.left + 1.0;
        let same_line = js::math_min(a.bottom, b.bottom) - js::math_max(a.top, b.top) > 0.0;
        beside && same_line
    })
}

/// Whether `el` scrolls on the x axis and has content to scroll to.
pub(crate) fn scrolls_x(dom: &dyn Dom, el: ElId) -> bool {
    if !matches!(overflow_x(dom, el).as_str(), "auto" | "scroll") {
        return false;
    }
    let (scroll, client) = (dom.scroll_width(el), dom.client_width(el));
    scroll.is_finite() && client.is_finite() && scroll > client + 1.0
}

/// The height of one line's content area in ems: the font's ascent plus
/// descent, what a Range client rect spans for one line whatever the
/// line-height. About 1.2em for most text faces (1.1 to 1.5 across them).
const CONTENT_AREA_EM: f64 = 1.2;

/// How many line boxes a text rect `text_height` tall spans, for text set at
/// `font_size` on lines `pitch` apart. The union of a block's Range client
/// rects runs from the top of its first line's content area to the bottom of
/// its last's: one pitch per line after the first, plus one content area.
/// Dividing the height by the pitch alone reads two lines at
/// `line-height: 2.4` as one, since that height is short of 1.5 pitches.
pub fn text_line_count(text_height: f64, pitch: f64, font_size: f64) -> f64 {
    if !(text_height.is_finite() && pitch.is_finite() && pitch > 0.0) {
        return 1.0;
    }
    let content = if font_size.is_finite() && font_size > 0.0 {
        font_size * CONTENT_AREA_EM
    } else {
        0.0
    };
    let after_first = js::math_round((text_height - content) / pitch);
    1.0 + if after_first > 0.0 { after_first } else { 0.0 }
}

fn holds_break_in(dom: &dyn Dom, el: ElId) -> bool {
    dom.children(el).into_iter().any(|c| {
        !paints_nothing(dom, c)
            && is_inline_phrasing(dom, c)
            && (tag_lower(dom, c) == "br" || holds_break_in(dom, c))
    })
}

/// Whether a `<br>` ends a line among the text `el` sets in its own line
/// boxes, so its lines stop short of the box where the author broke them.
pub fn phrasing_holds_break(dom: &dyn Dom, el: ElId) -> bool {
    holds_break_in(dom, el)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browser::fake_dom::FakeDom;

    /// review of #947: a scale-only infinite pulse leaves the box where it
    /// is, so it is no moving track; a translate, or a transform that moves
    /// as well as scales, is.
    #[test]
    fn an_endless_scale_pulse_is_not_a_moving_track() {
        use crate::browser::dom::KeyframeFrame;
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let track = d.add(Some(body), "div");
        d.set_styles(track, &[("animationName", "beat"), ("animationIterationCount", "infinite")]);
        let frames = |decls: &[(&str, &str)]| {
            vec![KeyframeFrame { decls: decls.iter().map(|(p, v)| (p.to_string(), v.to_string())).collect() }]
        };
        d.keyframes.insert("beat".into(), frames(&[("transform", "scale(1.05)")]));
        assert!(!runs_endless_animation(&d, track), "scale pulse");
        d.keyframes.insert("beat".into(), frames(&[("-webkit-transform", "scaleX(0.9) scaleY(1.1)")]));
        assert!(!runs_endless_animation(&d, track), "two-axis scale pulse");
        d.keyframes.insert("beat".into(), frames(&[("transform", "translateX(-50%)")]));
        assert!(runs_endless_animation(&d, track), "a sliding track");
        d.keyframes.insert("beat".into(), frames(&[("transform", "scale(1.05) translateX(-10px)")]));
        assert!(runs_endless_animation(&d, track), "scale plus a move");
        d.keyframes.insert("beat".into(), frames(&[("transform", "scale(var(--s))")]));
        assert!(runs_endless_animation(&d, track), "an unreadable value");
        d.keyframes.insert("beat".into(), frames(&[("translate", "-100% 0")]));
        assert!(runs_endless_animation(&d, track), "the translate property");
        d.keyframes.remove("beat");
        assert!(runs_endless_animation(&d, track), "unread keyframes");
    }

    #[test]
    fn phrasing_extent_unions_inline_children_and_stops_at_blocks() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let p = d.add(Some(body), "p");
        d.set_style(p, "display", "block");
        let b = d.add(Some(p), "b");
        d.set_style(b, "display", "inline");
        d.add_text(b, "Bold opening words");
        d.set_text_rect(b, 40.0, 100.0, 300.0, 18.0);
        let i = d.add(Some(p), "i");
        d.set_style(i, "display", "inline");
        d.add_text(i, "and an italic run that wraps");
        d.set_text_rect(i, 20.0, 100.0, 600.0, 42.0);
        assert!(holds_only_phrasing(&d, p));
        let t = phrasing_text_extent(&d, p).expect("extent");
        assert_eq!((t.left, t.top, t.right, t.bottom), (20.0, 100.0, 620.0, 142.0));

        // A block child is not phrasing: the paragraph holds a component.
        let card = d.add(Some(p), "div");
        d.set_style(card, "display", "block");
        d.add_text(card, "card body");
        d.set_text_rect(card, 0.0, 200.0, 1000.0, 18.0);
        assert!(!holds_only_phrasing(&d, p));
        let t = phrasing_text_extent(&d, p).expect("extent");
        assert_eq!(t.right, 620.0, "the block child's text is not the paragraph's line");

        // Nothing measurable.
        let bare = d.add(Some(body), "p");
        let s = d.add(Some(bare), "span");
        d.add_text(s, "unmeasured");
        assert!(phrasing_text_extent(&d, bare).is_none());
    }

    /// review of observations-20 row 31: v0-optimus-delta.vercel.app's
    /// `section.overflow-hidden` and simplybudget.framer.ai's card cut text at
    /// the viewport edge, and hid it from body-text-viewport-edge. Only a box
    /// that really scrolls on x is a track.
    #[test]
    fn only_a_real_x_scroller_cuts_text_off_the_page() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let section = d.add(Some(body), "section");
        d.set_styles(section, &[("overflow", "hidden"), ("overflowX", "hidden")]);
        d.set_rect(section, 0.0, 0.0, 390.0, 400.0);
        d.el_mut(section).client_width = 390.0;
        d.el_mut(section).scroll_width = 451.0;
        let p = d.add(Some(section), "p");
        let cut = Rect::from_xywh(56.0, 20.0, 353.0, 48.0);
        assert!(!scrolling_ancestor_cuts(&d, p, &cut), "a box that only hides overflow");
        d.set_styles(section, &[("overflow", "hidden auto"), ("overflowX", "hidden")]);
        assert!(!scrolling_ancestor_cuts(&d, p, &cut), "overflow-x-hidden");

        // nike.com's `ul.slider`: auto on x, with slides to scroll to.
        d.set_styles(section, &[("overflow", "auto"), ("overflowX", "auto")]);
        assert!(scrolling_ancestor_cuts(&d, p, &cut), "a swiped track");
        // With nothing to scroll to, it is no track.
        d.el_mut(section).scroll_width = 390.0;
        assert!(!scrolling_ancestor_cuts(&d, p, &cut));
        // Nor with an unrecorded metric.
        d.el_mut(section).scroll_width = f64::NAN;
        assert!(!scrolling_ancestor_cuts(&d, p, &cut));
        // A scroller the text sits inside does not cut it.
        d.el_mut(section).scroll_width = 948.0;
        let inside = Rect::from_xywh(24.0, 20.0, 300.0, 48.0);
        assert!(!scrolling_ancestor_cuts(&d, p, &inside));
        // The root scrolls the page, and stands for the viewport.
        d.set_styles(section, &[("overflow", "visible"), ("overflowX", "visible")]);
        let html = d.document_element().expect("root");
        d.set_styles(html, &[("overflow", "auto"), ("overflowX", "auto")]);
        d.set_rect(html, 0.0, 0.0, 390.0, 900.0);
        d.el_mut(html).client_width = 390.0;
        d.el_mut(html).scroll_width = 600.0;
        assert!(!scrolling_ancestor_cuts(&d, p, &cut));
    }

    /// A Range rect spans one content area plus a pitch per extra line.
    #[test]
    fn line_count_reads_the_content_area_and_the_pitch() {
        // 16px text on 24px lines: one line is a ~19px rect, two ~43px.
        assert_eq!(text_line_count(19.0, 24.0, 16.0), 1.0);
        assert_eq!(text_line_count(43.0, 24.0, 16.0), 2.0);
        assert_eq!(text_line_count(91.0, 24.0, 16.0), 4.0);
        // prose.html `pl-lh`: Georgia at 16px on 38.4px lines. Two lines are
        // 38.4 + 18.2 = 56.6px, under 1.5 pitches (57.6px).
        assert_eq!(text_line_count(18.2, 38.4, 16.0), 1.0);
        assert_eq!(text_line_count(56.6, 38.4, 16.0), 2.0);
        // A tall face (a 1.5em content area) on tight 16px lines is one line.
        assert_eq!(text_line_count(24.0, 16.0, 16.0), 1.0);
        // veeza.ai 106327: DM Sans at 16px on 26px lines, a 47px rect.
        assert_eq!(text_line_count(47.0, 26.0, 16.0), 2.0);
        // Nothing to divide by.
        assert_eq!(text_line_count(47.0, 0.0, 16.0), 1.0);
        assert_eq!(text_line_count(f64::NAN, 26.0, 16.0), 1.0);
    }

    #[test]
    fn a_break_among_the_phrasing_ends_a_line() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let p = d.add(Some(body), "p");
        d.add_text(p, "A closing statement,");
        assert!(!phrasing_holds_break(&d, p));
        let strong = d.add(Some(p), "strong");
        d.set_style(strong, "display", "inline");
        let br = d.add(Some(strong), "br");
        d.set_style(br, "display", "inline");
        assert!(phrasing_holds_break(&d, p), "a break inside a bold run");
        // A break inside a block child ends that block's line, not these.
        let q = d.add(Some(body), "p");
        let card = d.add(Some(q), "div");
        d.set_style(card, "display", "block");
        let inner = d.add(Some(card), "br");
        d.set_style(inner, "display", "inline");
        assert!(!phrasing_holds_break(&d, q));
    }

    /// observations-25 issue 13: cvs.com's 16px paragraph sets its words in
    /// a 24px span, and avikmukherjee.com's copy is JetBrains Mono.
    #[test]
    fn the_text_font_is_read_from_the_runs() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let p = d.add(Some(body), "p");
        d.set_styles(p, &[("display", "block"), ("fontSize", "16px"), ("fontFamily", "\"CVS Sans Regular\", Helvetica, sans-serif")]);
        let span = d.add(Some(p), "span");
        d.set_styles(span, &[("display", "inline"), ("fontSize", "24px")]);
        d.add_text(span, "Create a good morning routine");
        assert_eq!(phrasing_text_font(&d, p, 16.0), (24.0, 0.5));
        // Own text beside it weighs in by its characters: 25 and 25.
        d.add_text(p, "abcdefghijklmnopqrstuvwxy");
        d.el_mut(span).child_nodes.clear();
        d.add_text(span, "ABCDEFGHIJKLMNOPQRSTUVWXY");
        assert_eq!(phrasing_text_font(&d, p, 16.0), (20.0, 0.5));
        // A run whose size was not recorded takes its parent's.
        d.set_style(span, "fontSize", "");
        assert_eq!(phrasing_text_font(&d, p, 16.0), (16.0, 0.5));

        let mono = d.add(Some(body), "p");
        d.set_styles(mono, &[("display", "block"), ("fontSize", "14px"), ("fontFamily", "\"JetBrains Mono\", ui-monospace, monospace")]);
        let strong = d.add(Some(mono), "strong");
        // Computed style carries the inherited face.
        d.set_styles(strong, &[("display", "inline"), ("fontFamily", "\"JetBrains Mono\", ui-monospace, monospace")]);
        d.add_text(strong, "How do you keep state correct");
        assert_eq!(phrasing_text_font(&d, mono, 14.0), (14.0, 0.6), "the run inherits the face");
        // A code run in a proportional paragraph: half the characters at 0.6.
        let prose = d.add(Some(body), "p");
        d.set_styles(prose, &[("display", "block"), ("fontSize", "16px"), ("fontFamily", "Georgia, serif")]);
        d.add_text(prose, "abcd");
        let code = d.add(Some(prose), "code");
        d.set_styles(code, &[("display", "inline"), ("fontSize", "16px"), ("fontFamily", "Menlo, monospace")]);
        d.add_text(code, "wxyz");
        let (size, advance) = phrasing_text_font(&d, prose, 16.0);
        assert_eq!(size, 16.0);
        assert!((advance - 0.55).abs() < 1e-9, "{advance}");
        // No text runs: the element's own font.
        let empty = d.add(Some(body), "p");
        d.set_styles(empty, &[("display", "block"), ("fontFamily", "monospace")]);
        assert_eq!(phrasing_text_font(&d, empty, 12.0), (12.0, 0.6));
    }

    /// observations-25 issue 24: tempra.framer.website's ticker moves a `ul`
    /// of items with a transform inside a box that only clips its overflow.
    #[test]
    fn a_transformed_row_inside_a_clip_is_a_track() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let clip = d.add(Some(body), "div");
        d.set_styles(clip, &[("overflow", "clip"), ("overflowX", "clip")]);
        d.set_rect(clip, 0.0, 10000.0, 390.0, 240.0);
        d.el_mut(clip).client_width = 390.0;
        d.el_mut(clip).scroll_width = 1405.0;
        let track = d.add(Some(clip), "ul");
        d.set_style(track, "transform", "matrix(1, 0, 0, 1, -195.183, 0)");
        d.set_rect(track, -175.0, 10000.0, 350.0, 236.0);
        d.el_mut(track).client_width = 350.0;
        d.el_mut(track).scroll_width = 1580.0;
        let first = d.add(Some(track), "li");
        d.set_rect(first, -175.0, 10000.0, 383.0, 236.0);
        let second = d.add(Some(track), "li");
        d.set_rect(second, 208.0, 10000.0, 383.0, 236.0);
        let p = d.add(Some(first), "p");
        let cut = Rect::from_xywh(-151.0, 10020.0, 335.0, 77.0);
        assert!(scrolling_ancestor_cuts(&d, p, &cut), "a ticker item");
        // The identity matrix parks a track at its first slide.
        d.set_style(track, "transform", "matrix(1, 0, 0, 1, 0, 0)");
        assert!(scrolling_ancestor_cuts(&d, p, &cut));
        // No transform: a section cutting its content is no track.
        d.set_style(track, "transform", "none");
        assert!(!scrolling_ancestor_cuts(&d, p, &cut));
        d.set_style(track, "transform", "matrix(1, 0, 0, 1, -195.183, 0)");
        // Content that does not run past the clip.
        d.el_mut(track).scroll_width = 390.0;
        assert!(!scrolling_ancestor_cuts(&d, p, &cut));
        // A metric the capture did not record proves no track.
        d.el_mut(track).scroll_width = f64::NAN;
        assert!(!scrolling_ancestor_cuts(&d, p, &cut));
        d.el_mut(track).scroll_width = 1580.0;
        // Boxes stacked, not side by side, are no row.
        d.set_rect(second, -175.0, 10236.0, 383.0, 236.0);
        assert!(!scrolling_ancestor_cuts(&d, p, &cut));
        d.set_rect(second, 208.0, 10000.0, 383.0, 236.0);
        // A box that scrolls on x without overflow to scroll to, and one
        // that shows its overflow, hold no transformed track.
        d.set_styles(clip, &[("overflow", "visible"), ("overflowX", "visible")]);
        assert!(!scrolling_ancestor_cuts(&d, p, &cut));
    }

    #[test]
    fn overflow_x_reads_the_longhand_first() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let main = d.add(Some(body), "main");
        d.set_styles(main, &[("overflow", "hidden auto"), ("overflowX", "hidden")]);
        assert_eq!(overflow_x(&d, main), "hidden");
        let legacy = d.add(Some(body), "div");
        d.set_style(legacy, "overflow", "auto scroll");
        assert_eq!(overflow_x(&d, legacy), "auto");
    }

    #[test]
    fn an_inline_run_sits_on_the_block_strut() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let block = d.add(Some(body), "div");
        d.set_styles(block, &[("display", "inline-block"), ("fontSize", "14px"), ("lineHeight", "14px")]);
        let span = d.add(Some(block), "span");
        d.set_styles(span, &[("display", "inline"), ("fontSize", "11px"), ("lineHeight", "11px")]);
        assert_eq!(line_pitch_px(&d, span, 11.0), 14.0);
        // A taller own line-height sets the pitch itself.
        assert_eq!(line_pitch_px(&d, span, 20.0), 20.0);
        // An unresolvable block strut leaves the own value.
        d.set_style(block, "lineHeight", "normal");
        assert_eq!(line_pitch_px(&d, span, 11.0), 11.0);
        // A block element is its own strut.
        d.set_style(span, "display", "block");
        assert_eq!(line_pitch_px(&d, span, 11.0), 11.0);
    }
}
