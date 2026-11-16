//! Where a block's lines break: `straggler` (one word alone on a
//! paragraph's last line) and `unbalanced-heading` (a short heading whose
//! last line is far shorter than the line above it).
//!
//! Both read the rendered lines (`Dom::text_line_rects`, one rect per line
//! box), so only the URL engine reports them: the static engine lays out
//! nothing. Both stand down where the author already chose how the lines
//! break: `text-wrap: balance`, a `<br>`, preformatted text. `pretty` stands
//! down `straggler` only: it pulls a word down beside a lone last word but
//! does not even out a heading, and it inherits, so `pretty` on `body` would
//! otherwise silence every heading on the page. In a browser that drops
//! `pretty` at parse time, `straggler` also reads it from the raw `style`
//! attribute and `<style>` text, gated on the page flag (#1136).
//!
//! Both are advisory. An uneven break can be the design: a headline that
//! lands on one word for weight, a poster line, a pull quote.

use super::dom::{ancestors_inclusive, matches_or_false, renders_no_text, tag_lower, Dom, DomChild, ElId, Rect};
use super::quality::{is_atomic_inline, is_visually_hidden, rendered_text_len};
use super::text_geometry::{holds_only_phrasing, phrasing_holds_break};
use crate::checks::css_scan::enclosing_css_selector;
use crate::checks::rules::{is_heading_tag, RuleHit};
use crate::checks::text_rules::is_cjk_text;
use crate::js::{self, math_round, number_to_string};
use once_cell::sync::Lazy;
use regex::Regex;

/// The prose blocks a straggler is read in.
const STRAGGLER_TAGS: &[&str] = &["p", "li", "dd", "blockquote", "figcaption"];

/// A last line wider than this share of the widest line is a long word that
/// fills its line, not a hole under the block.
const STRAGGLER_MAX_FILL: f64 = 0.3;

/// A column that holds fewer characters a line than this sets one-word lines
/// whatever the wrap does: a narrow card, a sidebar list item.
const STRAGGLER_MIN_COLUMN_CHARS: f64 = 30.0;

/// The most lines Chromium balances. A longer block set `text-wrap: balance`
/// falls back to the default wrap, straggler and all.
const BALANCE_MAX_LINES: usize = 6;

/// A heading of more lines than this is a statement set as a heading, and
/// its last line is a paragraph's last line.
const HEADING_MAX_LINES: usize = 3;

/// A heading's last line under this share of the line above it reads as a
/// leftover, not as the second half of the heading. `text-wrap: balance`
/// sets the two near even.
const HEADING_MIN_TAIL_RATIO: f64 = 0.35;

/// A heading column that holds fewer characters a line than this cannot set
/// even lines whatever the wrap does: a three-word title in a sidebar card.
const HEADING_MIN_COLUMN_CHARS: f64 = 20.0;

/// The fewest words a block needs before its wrap can be changed: `balance`
/// and `pretty` move words between lines, and two words have nowhere to go.
const MIN_WORDS: usize = 3;

/// How far up from a block [`lines_run_past_a_clip`] looks for the box
/// that clips its lines, as the tight-leading floor looks for a line clamp.
const CLIP_SEARCH_DEPTH: usize = 4;

/// The widths of the lines `el`'s text rendered on, top to bottom.
///
/// `None` when the lines do not stack in one column. Lines come back sorted
/// top to bottom, so across `column-count` columns the lowest line need not
/// be the last one read, and the rules would judge the wrong line. A line
/// that shares no horizontal span with the widest one sits in another
/// column; centered and indented lines still overlap it.
fn line_widths(dom: &dyn Dom, el: ElId) -> Option<Vec<f64>> {
    let rects: Vec<_> = dom
        .text_line_rects(el)?
        .into_iter()
        .filter(|r| r.width > 0.0 && r.height > 0.0)
        .collect();
    if lines_run_past_a_clip(dom, el, &rects) {
        return None;
    }
    let widest = rects.iter().copied().reduce(|a, b| if b.width > a.width { b } else { a });
    if let Some(w) = widest {
        if rects.iter().any(|r| r.right <= w.left || r.left >= w.right) {
            return None;
        }
    }
    Some(rects.into_iter().map(|r| r.width).collect())
}

/// Whether `el`'s computed `text-wrap-style` is `style`. Chrome before 130
/// computed `text-wrap` alone, as a longhand that took the same values.
fn wraps_with(dom: &dyn Dom, el: ElId, style: &str) -> bool {
    let computed = dom.style(el, "textWrapStyle");
    let computed = if computed.is_empty() { dom.style(el, "textWrap") } else { computed };
    computed.split_whitespace().any(|s| s == style)
}

/// A `text-wrap` or `text-wrap-style` declaration and its value; `--text-wrap`
/// is a custom property's name, not a declaration of it.
static PRETTY_WRAP_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)(?:^|[^\w-])text-wrap(?:-style)?\s*:([^;{}]*)").expect("PRETTY_WRAP_RE"));
static CSS_COMMENT_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"/\*[\s\S]*?\*/").expect("CSS_COMMENT_RE"));

/// Whether the author set `text-wrap: pretty` and the browser dropped it
/// (issue #1136): the page flag says `pretty` is not applied, and the raw
/// text still declares it, in the `style` attribute of `el` or an ancestor or
/// in a `<style>` rule whose selector matches one of them. The nearest
/// element up the chain that declares `text-wrap` at all decides, by the last
/// declaration that reaches it (an `!important` one first, the `style`
/// attribute after the `<style>` rules, specificity not weighed), so an
/// explicit reset keeps the finding; `inherit` and `unset` pass the decision
/// to the ancestor. Linked stylesheets, `@import` and shadow-tree styles are
/// not read.
fn pretty_wrap_dropped(dom: &dyn Dom, el: ElId, rules: &TextWrapRules) -> bool {
    if dom.text_wrap_pretty_supported() != Some(false) {
        return false;
    }
    for c in ancestors_inclusive(dom, el) {
        let mut decls: Vec<WrapDecl> = rules
            .declarations(dom)
            .iter()
            .filter(|(selector, _)| matches_or_false(dom, c, selector))
            .map(|(_, decl)| *decl)
            .collect();
        if let Some(style) = dom.attr(c, "style") {
            decls.extend(wrap_decls(&style));
        }
        match winning_decl(&decls).map(|d| d.wrap) {
            Some(Wrap::Pretty) => return true,
            Some(Wrap::Other) => return false,
            Some(Wrap::Inherit) | None => {}
        }
    }
    false
}

/// What a `text-wrap` or `text-wrap-style` value asks for: `pretty` (`wrap
/// pretty` and `pretty!important` do), the ancestor's choice (`inherit`,
/// `unset`), or another wrap.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Wrap {
    Pretty,
    Inherit,
    Other,
}

/// One declaration: its value and whether it is `!important`.
#[derive(Debug, Clone, Copy)]
struct WrapDecl {
    wrap: Wrap,
    important: bool,
}

fn wrap_decl(value: &str) -> WrapDecl {
    let mut parts = value.split('!');
    let tokens: Vec<&str> = parts.next().unwrap_or("").split_whitespace().collect();
    let has = |word: &str| tokens.iter().any(|t| t.eq_ignore_ascii_case(word));
    let wrap = if has("pretty") {
        Wrap::Pretty
    } else if has("inherit") || has("unset") {
        Wrap::Inherit
    } else {
        Wrap::Other
    };
    WrapDecl { wrap, important: parts.any(|t| t.trim().eq_ignore_ascii_case("important")) }
}

/// The `text-wrap` declarations of one declaration list (a `style`
/// attribute), in order, comments removed first so a commented-out one does
/// not count.
fn wrap_decls(declarations: &str) -> Vec<WrapDecl> {
    let text = CSS_COMMENT_RE.replace_all(declarations, "");
    PRETTY_WRAP_RE.captures_iter(&text).map(|c| wrap_decl(&c[1])).collect()
}

/// The declaration that wins among those reaching one element: the last
/// `!important` one, else the last.
fn winning_decl(decls: &[WrapDecl]) -> Option<WrapDecl> {
    decls.iter().rev().find(|d| d.important).or(decls.last()).copied()
}

/// The `text-wrap` declarations of the page's `<style>` rules with the
/// selector of each, in source order, read once per scan and only when a
/// straggler candidate first asks in a browser that dropped `pretty`. Each
/// declaration's rule is the one [`enclosing_css_selector`] names: a rule
/// under a grouping at-rule counts (its condition is not evaluated), a rule
/// nested in a style rule does not.
#[derive(Debug, Default)]
pub struct TextWrapRules(std::cell::OnceCell<Vec<(String, WrapDecl)>>);

impl TextWrapRules {
    fn declarations(&self, dom: &dyn Dom) -> &[(String, WrapDecl)] {
        self.0.get_or_init(|| {
            dom.query_all(None, "style")
                .unwrap_or_default()
                .into_iter()
                .flat_map(|style| text_wrap_rules(&dom.text_content(style)))
                .collect()
        })
    }
}

/// Every `text-wrap` declaration in `css` with its rule's selector, comments
/// removed first so a commented-out declaration names no rule.
fn text_wrap_rules(css: &str) -> Vec<(String, WrapDecl)> {
    let css = CSS_COMMENT_RE.replace_all(css, "");
    PRETTY_WRAP_RE
        .captures_iter(&css)
        .filter_map(|c| {
            let value = c.get(1).unwrap();
            Some((enclosing_css_selector(&css, value.start())?, wrap_decl(value.as_str())))
        })
        .collect()
}

/// Whether the author already set where `el`'s lines end, or set them not to
/// wrap at all. The style reads come first; the tree walks after.
fn breaks_are_authored(dom: &dyn Dom, el: ElId) -> bool {
    let white_space = dom.style(el, "whiteSpace");
    white_space.starts_with("pre")
        || white_space == "nowrap"
        || !holds_only_phrasing(dom, el)
        || phrasing_holds_break(dom, el)
        || is_visually_hidden(dom, el)
}

/// Whether all of `el`'s rendered text is set in `el`'s own face and size,
/// with no box inline among it: an `<img>`, an icon `<svg>`, an
/// `inline-block` badge, or a `<code>` run in another face widens a line
/// without the characters to match, and the share of the characters each
/// line holds can no longer be read off its width.
fn sets_one_face(dom: &dyn Dom, el: ElId) -> bool {
    let family = dom.style(el, "fontFamily");
    let size = dom.style(el, "fontSize");
    fn walk(dom: &dyn Dom, el: ElId, family: &str, size: &str) -> bool {
        dom.children(el).into_iter().all(|c| {
            renders_no_text(dom, c)
                || tag_lower(dom, c) == "br"
                || (!is_atomic_inline(dom, c)
                    && dom.style(c, "fontFamily") == family
                    && dom.style(c, "fontSize") == size
                    && walk(dom, c, family, size))
        })
    }
    walk(dom, el, &family, &size)
}

/// The text `el` sets on its lines, in document order: the text nodes under
/// it, skipping every descendant that renders no text, as
/// `Dom::text_line_rects` skips them. A `display: none` span or an inline
/// `<script>` after the last word is on no line.
fn push_rendered_text(dom: &dyn Dom, el: ElId, out: &mut String) {
    for child in dom.child_nodes(el) {
        match child {
            DomChild::Text(text) => out.push_str(&text),
            DomChild::Element(c) => {
                if !renders_no_text(dom, c) {
                    push_rendered_text(dom, c, out);
                }
            }
        }
    }
}

/// Whether `el`'s lines run past a box that clips them: a `-webkit-line-clamp`
/// box (vercel.com's `p.line-clamp-2`, impeccable.style's release summaries)
/// or one whose `overflow` clips on y, on `el` or within
/// [`CLIP_SEARCH_DEPTH`] ancestors. Chromium lays out the lines a clamp
/// hides below the box, and `Dom::text_line_rects` still returns them, so
/// the last line measured is not the last line shown. A line whose middle
/// lies below a clamp's content edge, or below an overflow clip's padding
/// edge, is hidden. Clips that hide nothing
/// leave the lines as they are.
fn lines_run_past_a_clip(dom: &dyn Dom, el: ElId, lines: &[super::dom::Rect]) -> bool {
    let Some(lowest) = lines.iter().map(|r| r.top + r.height / 2.0).reduce(f64::max) else {
        return false;
    };
    let mut cur = Some(el);
    for _ in 0..=CLIP_SEARCH_DEPTH {
        let Some(c) = cur else { break };
        let clamp = crate::checks::text_rules::is_line_clamp(&dom.style(c, "display"), &dom.style(c, "webkitLineClamp"));
        let clips = |k: &str| matches!(dom.style(c, k).as_str(), "hidden" | "clip");
        if clamp || clips("overflowY") || clips("overflow") {
            let r = dom.rect(c);
            let px = |k: &str| {
                let v = js::parse_float(&dom.style(c, k));
                if v.is_finite() { v } else { 0.0 }
            };
            // A clamp hides the lines past its count, so its content edge is
            // the last line shown; overflow clips at the padding edge, and
            // text set in the padding (a caption on a padding-hack ratio
            // card) is in view.
            let padding = if clamp { px("paddingBottom") } else { 0.0 };
            let bottom = r.bottom - px("borderBottomWidth") - padding;
            if bottom.is_finite() && lowest > bottom {
                return true;
            }
        }
        cur = dom.parent(c);
    }
    false
}

/// Whether any of the text `el` sets on its lines does not paint: text in a
/// box whose computed `visibility` is `hidden` or `collapse`. Such text still
/// takes its room on a line box, so `Dom::text_line_rects` measures it and
/// `words` reads it, and the rules would judge a line, or name a word, the
/// visitor never sees. `visibility` inherits, so each box's own computed
/// value is the one its text paints with; a child set `visible` again shows.
fn sets_unpainted_text(dom: &dyn Dom, el: ElId) -> bool {
    let hidden = matches!(js::to_lower_case(&dom.style(el, "visibility")).as_str(), "hidden" | "collapse");
    dom.child_nodes(el).into_iter().any(|child| match child {
        DomChild::Text(text) => hidden && !text.trim().is_empty(),
        DomChild::Element(c) => !renders_no_text(dom, c) && sets_unpainted_text(dom, c),
    })
}

/// The words of `el`'s rendered text. Soft hyphens and zero-width spaces
/// paint nothing unless the line breaks at them, so they are dropped:
/// `re&shy;turn.` is the word "return.".
fn words(dom: &dyn Dom, el: ElId) -> Vec<String> {
    let mut text = String::new();
    push_rendered_text(dom, el, &mut text);
    text.split_whitespace()
        .map(|w| w.chars().filter(|c| !matches!(c, '\u{AD}' | '\u{200B}')).collect::<String>())
        .filter(|w| !w.is_empty())
        .collect()
}

/// Whether two rects sit on one row: they overlap by more than half the
/// shorter one's height, the test `merge_text_rects_into_lines` joins
/// fragments into a line by.
fn share_a_row(a: Rect, b: Rect) -> bool {
    let overlap = a.bottom.min(b.bottom) - a.top.max(b.top);
    let shorter = a.height.min(b.height);
    shorter > 0.0 && overlap > shorter / 2.0
}

/// Characters per pixel of `el`'s lines: the rendered characters
/// (`rendered_text_len`, the count `line-length` divides) over the summed
/// line widths. One face at one size advances the same on every line.
fn chars_per_px(dom: &dyn Dom, el: ElId, widths: &[f64]) -> Option<f64> {
    let total: f64 = widths.iter().sum();
    (total > 0.0).then(|| rendered_text_len(dom, el) as f64 / total)
}

/// `straggler`: one word alone on the last line of a multi-line paragraph.
///
/// The lines and the last two words are both measured: the last word is
/// alone when the word before it ended on another row. A count of the
/// characters on the last line could not say so: narrow letters fit two
/// words in the room the estimate gave one.
fn check_straggler(dom: &dyn Dom, el: ElId, rules: &TextWrapRules) -> Option<RuleHit> {
    if wraps_with(dom, el, "pretty") || breaks_are_authored(dom, el) {
        return None;
    }
    let widths = line_widths(dom, el)?;
    if widths.len() < 2 || (widths.len() <= BALANCE_MAX_LINES && wraps_with(dom, el, "balance")) {
        return None;
    }
    let widest = widths.iter().copied().fold(0.0, js::math_max);
    let last = *widths.last()?;
    if last > widest * STRAGGLER_MAX_FILL {
        return None;
    }
    let words = words(dom, el);
    if words.len() < MIN_WORDS
        || is_cjk_text(&words.join(" "))
        || !sets_one_face(dom, el)
        || sets_unpainted_text(dom, el)
    {
        return None;
    }
    let chars_per_px = chars_per_px(dom, el, &widths)?;
    if widest * chars_per_px < STRAGGLER_MIN_COLUMN_CHARS {
        return None;
    }
    let [before, last_word] = dom.last_word_rects(el)?;
    if share_a_row(before, last_word) {
        return None;
    }
    if pretty_wrap_dropped(dom, el, rules) {
        return None;
    }
    let word = &words[words.len() - 1];
    Some(RuleHit::new(
        "straggler",
        format!(
            "\"{}\" alone on the last of {} lines ({}% of the measure)",
            word.replace('"', "'"),
            widths.len(),
            number_to_string(math_round(last / widest * 100.0))
        ),
    ))
}

/// `unbalanced-heading`: a heading of two or three lines whose last line is
/// far shorter than the line above it.
fn check_unbalanced_heading(dom: &dyn Dom, el: ElId) -> Option<RuleHit> {
    if wraps_with(dom, el, "balance") || breaks_are_authored(dom, el) {
        return None;
    }
    let widths = line_widths(dom, el)?;
    if widths.len() < 2 || widths.len() > HEADING_MAX_LINES {
        return None;
    }
    let tail = widths[widths.len() - 1];
    let above = widths[widths.len() - 2];
    if tail >= above * HEADING_MIN_TAIL_RATIO || words(dom, el).len() < MIN_WORDS || sets_unpainted_text(dom, el) {
        return None;
    }
    // A heading with mixed faces gives no character count to trust, and is
    // read without the narrow-column gate rather than guessed at.
    if sets_one_face(dom, el) {
        let widest = widths.iter().copied().fold(0.0, js::math_max);
        if widest * chars_per_px(dom, el, &widths)? < HEADING_MIN_COLUMN_CHARS {
            return None;
        }
    }
    Some(RuleHit::new(
        "unbalanced-heading",
        format!(
            "last of {} lines is {}% as wide as the line above",
            widths.len(),
            number_to_string(math_round(tail / above * 100.0))
        ),
    ))
}

/// The line-break rules for one element.
pub fn check_element_line_breaks_dom(dom: &dyn Dom, el: ElId) -> Vec<RuleHit> {
    check_element_line_breaks_dom_with(dom, el, &TextWrapRules::default())
}

/// [`check_element_line_breaks_dom`] sharing one page's [`TextWrapRules`]
/// across its elements.
pub fn check_element_line_breaks_dom_with(dom: &dyn Dom, el: ElId, rules: &TextWrapRules) -> Vec<RuleHit> {
    let tag = tag_lower(dom, el);
    let hit = if is_heading_tag(&tag) {
        check_unbalanced_heading(dom, el)
    } else if STRAGGLER_TAGS.contains(&tag.as_str()) {
        check_straggler(dom, el, rules)
    } else {
        None
    };
    hit.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browser::fake_dom::FakeDom;

    const PROSE: &str = "Line breaks decide how a block of text sits on the page, and one \
                         word alone on the last line leaves a hole under the text.";

    fn block(d: &mut FakeDom, body: ElId, tag: &str, text: &str, lines: &[f64]) -> ElId {
        let el = d.add(Some(body), tag);
        d.add_text(el, text);
        d.set_styles(el, &[("fontSize", "16px"), ("display", "block"), ("whiteSpace", "normal")]);
        let rects: Vec<(f64, f64, f64, f64)> =
            lines.iter().enumerate().map(|(i, w)| (0.0, 100.0 + 24.0 * i as f64, *w, 19.0)).collect();
        d.set_text_lines(el, &rects);
        // The last word alone: the word before it ends the line above.
        if let [.., (_, above, w_above, _), (_, y, w, h)] = rects[..] {
            d.set_last_words(el, (w_above - 40.0, above, 40.0, h), (0.0, y, w, h));
        }
        el
    }

    fn inline(d: &mut FakeDom, parent: ElId, tag: &str, text: &str, styles: &[(&str, &str)]) -> ElId {
        let c = d.add(Some(parent), tag);
        d.add_text(c, text);
        d.set_styles(c, &[("fontSize", "16px"), ("display", "inline")]);
        d.set_styles(c, styles);
        c
    }

    fn ids(d: &FakeDom, el: ElId) -> Vec<String> {
        check_element_line_breaks_dom(d, el).into_iter().map(|h| h.id).collect()
    }

    /// The case the rule exists for: the last word of a paragraph wrapped
    /// onto a line of its own. The snippet names the word so a reader can
    /// find it.
    #[test]
    fn one_word_on_the_last_line_is_a_straggler() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        // 122 characters: two full 560px lines and "text." in 40px.
        let p = block(&mut d, body, "p", PROSE, &[560.0, 560.0, 40.0]);
        let hits = check_element_line_breaks_dom(&d, p);
        assert_eq!(hits.len(), 1, "{hits:?}");
        assert_eq!(hits[0].id, "straggler");
        assert_eq!(hits[0].snippet, "\"text.\" alone on the last of 3 lines (7% of the measure)");
    }

    /// vercel.com's template cards: `-webkit-line-clamp: 2` on a paragraph
    /// whose third line Chromium lays out below the box. The visitor reads
    /// two lines ending in an ellipsis, not a lone last word. Twin: the same
    /// paragraph unclamped, and a clamp that hides nothing, still report.
    #[test]
    fn lines_a_clamp_hides_are_not_judged() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let clamped = block(&mut d, body, "p", PROSE, &[560.0, 560.0, 40.0]);
        d.set_styles(clamped, &[("display", "-webkit-box"), ("webkitLineClamp", "2"), ("overflow", "hidden")]);
        d.set_rect(clamped, 0.0, 100.0, 600.0, 48.0);
        assert!(ids(&d, clamped).is_empty());
        // In a clipping wrapper two levels up.
        let card = d.add(Some(body), "div");
        d.set_styles(card, &[("overflowY", "hidden"), ("paddingBottom", "0px"), ("borderBottomWidth", "0px")]);
        d.set_rect(card, 0.0, 100.0, 600.0, 48.0);
        let inner = d.add(Some(card), "div");
        let wrapped = block(&mut d, inner, "p", PROSE, &[560.0, 560.0, 40.0]);
        assert!(ids(&d, wrapped).is_empty());

        let free = block(&mut d, body, "p", PROSE, &[560.0, 560.0, 40.0]);
        d.set_rect(free, 0.0, 100.0, 600.0, 72.0);
        assert_eq!(ids(&d, free), vec!["straggler"]);
        let roomy = block(&mut d, body, "p", PROSE, &[560.0, 560.0, 40.0]);
        d.set_styles(roomy, &[("display", "-webkit-box"), ("webkitLineClamp", "3"), ("overflow", "hidden")]);
        d.set_rect(roomy, 0.0, 100.0, 600.0, 72.0);
        assert_eq!(ids(&d, roomy), vec!["straggler"], "a clamp of three shows all three lines");
    }

    /// A soft hyphen paints nothing, so the snippet names the word a reader
    /// sees.
    #[test]
    fn the_snippet_names_the_word_without_its_soft_hyphen() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let text = PROSE.replace("text.", "re\u{AD}turn.");
        let p = block(&mut d, body, "p", &text, &[560.0, 560.0, 50.0]);
        let hits = check_element_line_breaks_dom(&d, p);
        assert_eq!(hits.len(), 1, "{hits:?}");
        assert!(hits[0].snippet.starts_with("\"return.\" alone"), "{}", hits[0].snippet);
    }

    /// Two words on the last line is what `text-wrap: pretty` leaves when it
    /// pulls a word down, so charging it would flag the fixed paragraph.
    #[test]
    fn two_words_on_the_last_line_are_not_a_straggler() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let p = block(&mut d, body, "p", PROSE, &[560.0, 510.0, 80.0]);
        d.set_last_words(p, (0.0, 148.0, 38.0, 19.0), (42.0, 148.0, 38.0, 19.0));
        assert!(ids(&d, p).is_empty());
    }

    /// Issue #1073: in 16px Arial at 711px, "it fills." set on the last
    /// line in 6% of the measure, which a count of its characters read as
    /// "fills." alone. Measured, the two words share the row.
    #[test]
    fn narrow_letters_on_a_short_last_line_are_two_words() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let text = PROSE.replace("under the text.", "under the line it fills.");
        let p = block(&mut d, body, "p", &text, &[700.0, 42.0]);
        d.set_last_words(p, (0.0, 124.0, 9.0, 19.0), (13.0, 124.0, 29.0, 19.0));
        assert!(ids(&d, p).is_empty());
    }

    /// A word hyphenated across the last break ends on the last line, its
    /// tail alone there; its last rect is the one the rule reads.
    #[test]
    fn a_word_hyphenated_onto_the_last_line_is_a_straggler() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let text = PROSE.replace("text.", "re\u{AD}turn.");
        let p = block(&mut d, body, "p", &text, &[560.0, 560.0, 30.0]);
        // "the" ends line two; "re-" ends it too, and "turn." starts line three.
        d.set_last_words(p, (500.0, 124.0, 24.0, 19.0), (0.0, 148.0, 30.0, 19.0));
        assert_eq!(ids(&d, p), ["straggler"]);
    }

    /// A DOM that did not measure the last two words gets no finding: the
    /// rule does not fall back on guessing where they broke.
    #[test]
    fn no_last_word_rects_no_finding() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let p = block(&mut d, body, "p", PROSE, &[560.0, 560.0, 40.0]);
        d.el_mut(p).last_word_rects = None;
        assert!(ids(&d, p).is_empty());
    }

    /// The author chose the wrap: `pretty` or `balance`, computed as
    /// `text-wrap-style`, or as the `text-wrap` longhand of an older Chrome.
    #[test]
    fn an_authored_wrap_stands_the_rule_down() {
        for (prop, value) in [("textWrapStyle", "pretty"), ("textWrapStyle", "balance"), ("textWrap", "pretty")] {
            let mut d = FakeDom::new();
            let (_h, body) = d.with_page();
            let p = block(&mut d, body, "p", PROSE, &[560.0, 560.0, 40.0]);
            d.set_style(p, prop, value);
            assert!(ids(&d, p).is_empty(), "{prop}: {value}");
        }
    }

    /// A long last word that fills a good part of its line is not a hole,
    /// and a column too narrow to set two words a line cannot avoid one.
    #[test]
    fn a_full_last_line_and_a_narrow_column_pass() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let long = block(
            &mut d,
            body,
            "p",
            "Every product page now ships with automatic internationalization",
            &[420.0, 230.0],
        );
        assert!(ids(&d, long).is_empty(), "long last word");
        let narrow = block(&mut d, body, "li", "Settings and account preferences", &[150.0, 100.0, 30.0]);
        assert!(ids(&d, narrow).is_empty(), "narrow column");
    }

    /// A `<br>` sets where the line ends: a sign-off, an address.
    #[test]
    fn a_break_the_author_wrote_is_not_a_straggler() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let p = block(&mut d, body, "p", PROSE, &[560.0, 560.0, 40.0]);
        d.add(Some(p), "br");
        assert!(ids(&d, p).is_empty());
    }

    /// A DOM that cannot say where the lines are gets no finding.
    #[test]
    fn no_line_rects_no_finding() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let p = block(&mut d, body, "p", PROSE, &[560.0, 560.0, 40.0]);
        d.el_mut(p).text_line_rects = None;
        assert!(ids(&d, p).is_empty());
    }

    /// A two-line heading with one word under a full line reads as a
    /// leftover; `balance` sets the two lines near even.
    #[test]
    fn a_short_last_heading_line_is_unbalanced() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let h = block(&mut d, body, "h2", "Design that holds up under real content and real people", &[856.0, 110.0]);
        let hits = check_element_line_breaks_dom(&d, h);
        assert_eq!(hits.len(), 1, "{hits:?}");
        assert_eq!(hits[0].id, "unbalanced-heading");
        assert_eq!(hits[0].snippet, "last of 2 lines is 13% as wide as the line above");

        d.set_style(h, "textWrapStyle", "balance");
        assert!(ids(&d, h).is_empty(), "balanced");
    }

    /// `pretty` does not even out a heading's lines, and it inherits: set on
    /// `body` for the prose, it computes as `pretty` on every heading. So it
    /// leaves the heading rule on; only `balance` stands it down.
    #[test]
    fn a_pretty_heading_is_still_unbalanced() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let h = block(&mut d, body, "h2", "Design that holds up under real content and real people", &[856.0, 110.0]);
        d.set_style(h, "textWrapStyle", "pretty");
        assert_eq!(ids(&d, h), ["unbalanced-heading"]);
    }

    /// In a multi-column paragraph the lines come back top to bottom across
    /// the columns, so the lowest line need not be the last one in reading
    /// order. Here the short line in the second column sorts last, but the
    /// rule cannot tell that from a straggler it read in text order, so it
    /// stays quiet rather than judge the wrong line.
    #[test]
    fn a_paragraph_set_in_columns_is_not_judged() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let text = format!("{PROSE} {PROSE}");
        let p = block(&mut d, body, "p", &text, &[]);
        d.set_text_lines(
            p,
            &[
                (0.0, 100.0, 400.0, 19.0),
                (440.0, 100.0, 400.0, 19.0),
                (0.0, 124.0, 400.0, 19.0),
                (440.0, 124.0, 400.0, 19.0),
                (0.0, 148.0, 400.0, 19.0),
                (440.0, 148.0, 40.0, 19.0),
            ],
        );
        assert!(ids(&d, p).is_empty());
    }

    /// Near-even lines, a one-line heading, and a long statement set as a
    /// heading all pass.
    #[test]
    fn even_single_and_long_headings_pass() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let even = block(&mut d, body, "h2", "Design that holds up under real content", &[513.0, 454.0]);
        assert!(ids(&d, even).is_empty(), "even");
        let one = block(&mut d, body, "h2", "Design that holds up", &[400.0]);
        assert!(ids(&d, one).is_empty(), "one line");
        let four = block(&mut d, body, "h2", PROSE, &[600.0, 600.0, 600.0, 60.0]);
        assert!(ids(&d, four).is_empty(), "four lines");
    }

    /// A heading built from block children (a title over a subtitle) breaks
    /// where its blocks do, not where the wrap put it.
    #[test]
    fn a_heading_of_stacked_blocks_passes() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let h = block(&mut d, body, "h1", "", &[700.0, 90.0]);
        let top = d.add(Some(h), "span");
        d.add_text(top, "Design that holds up under real content");
        d.set_style(top, "display", "block");
        let sub = d.add(Some(h), "span");
        d.add_text(sub, "today");
        d.set_style(sub, "display", "block");
        assert!(ids(&d, h).is_empty());
    }

    /// Text on no line is not the last word: a `display: none` span after
    /// the paragraph's last word must not be named, nor counted against the
    /// line widths.
    #[test]
    fn hidden_text_is_neither_the_word_nor_counted() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let p = block(&mut d, body, "p", PROSE, &[560.0, 560.0, 40.0]);
        inline(&mut d, p, "span", " Read the full typography guide", &[("display", "none")]);
        let hits = check_element_line_breaks_dom(&d, p);
        assert_eq!(hits.len(), 1, "{hits:?}");
        assert!(hits[0].snippet.starts_with("\"text.\" alone"), "{}", hits[0].snippet);
    }

    /// Text in a `visibility: hidden` box keeps its room on the line, so
    /// the last line may hold only words nobody sees. Neither rule judges
    /// such a block; a child set `visible` again paints and is read as before.
    #[test]
    fn invisible_text_on_the_lines_stands_both_rules_down() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let p = block(&mut d, body, "p", PROSE, &[560.0, 560.0, 40.0]);
        inline(&mut d, p, "span", " more", &[("visibility", "hidden")]);
        assert!(ids(&d, p).is_empty(), "hidden tail");

        let collapsed = block(&mut d, body, "p", PROSE, &[560.0, 560.0, 40.0]);
        inline(&mut d, collapsed, "span", " more", &[("visibility", "collapse")]);
        assert!(ids(&d, collapsed).is_empty(), "collapsed tail");

        let shown = block(&mut d, body, "p", PROSE, &[560.0, 560.0, 40.0]);
        let wrap = inline(&mut d, shown, "span", "", &[("visibility", "hidden")]);
        inline(&mut d, wrap, "span", " more", &[("visibility", "visible")]);
        let hits = check_element_line_breaks_dom(&d, shown);
        assert_eq!(hits.len(), 1, "visible again: {hits:?}");
        assert!(hits[0].snippet.starts_with("\"more\" alone"), "{}", hits[0].snippet);

        let h = block(&mut d, body, "h2", "Design that holds up under real content and real", &[856.0, 110.0]);
        inline(&mut d, h, "span", " people", &[("visibility", "hidden")]);
        assert!(ids(&d, h).is_empty(), "hidden heading tail");
    }

    /// An inline image or a run in another face widens a line without the
    /// characters to match, so the one-word estimate has nothing to stand
    /// on. Same-face phrasing (a link) is read as before.
    #[test]
    fn mixed_faces_and_inline_boxes_stand_the_straggler_rule_down() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let link = block(&mut d, body, "p", PROSE, &[560.0, 560.0, 40.0]);
        inline(&mut d, link, "a", "", &[]);
        assert_eq!(ids(&d, link), vec!["straggler"], "same-face link");

        let icon = block(&mut d, body, "p", PROSE, &[560.0, 560.0, 40.0]);
        inline(&mut d, icon, "img", "", &[]);
        assert!(ids(&d, icon).is_empty(), "inline image");

        let code = block(&mut d, body, "p", PROSE, &[560.0, 560.0, 40.0]);
        inline(&mut d, code, "code", "", &[("fontFamily", "monospace")]);
        assert!(ids(&d, code).is_empty(), "another face");
    }

    /// A word holding a double quote keeps the contract's convention for
    /// quoted snippet text: written as `'`.
    #[test]
    fn a_quote_in_the_word_is_written_as_an_apostrophe() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let text = PROSE.replace("text.", "\"done.\"");
        let p = block(&mut d, body, "p", &text, &[560.0, 560.0, 45.0]);
        let hits = check_element_line_breaks_dom(&d, p);
        assert_eq!(hits.len(), 1, "{hits:?}");
        assert!(hits[0].snippet.starts_with("\"'done.'\" alone"), "{}", hits[0].snippet);
    }

    /// `balance` cannot move a word in a two-word heading, so advising it
    /// would be noise; nor can it even out a column a few words wide.
    #[test]
    fn short_and_narrow_headings_pass() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let two = block(&mut d, body, "h3", "Documentation hub", &[300.0, 60.0]);
        assert!(ids(&d, two).is_empty(), "two words");
        let narrow = block(&mut d, body, "h3", "Account settings page", &[120.0, 30.0]);
        assert!(ids(&d, narrow).is_empty(), "narrow column");
    }
    /// Chromium balances six lines at most; a longer paragraph set
    /// `text-wrap: balance` keeps the default wrap and its straggler.
    #[test]
    fn balance_past_six_lines_does_not_stand_the_rule_down() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let text = [PROSE; 3].join(" ");
        let p = block(&mut d, body, "p", &text, &[560.0, 560.0, 560.0, 560.0, 560.0, 560.0, 560.0, 40.0]);
        d.set_style(p, "textWrapStyle", "balance");
        assert_eq!(ids(&d, p), vec!["straggler"]);
    }

    /// Firefox drops `text-wrap: pretty` at parse time, so the computed style
    /// reads `auto` and only the raw text still holds it (#1136). With the
    /// page flag false, the `style` attribute of the element or an ancestor
    /// and a matching `<style>` rule (also under a conditional group) stand
    /// the finding down.
    #[test]
    fn a_pretty_the_browser_dropped_stands_straggler_down() {
        let build = |setup: &dyn Fn(&mut FakeDom, ElId, ElId, ElId)| {
            let mut d = FakeDom::new();
            let (html, body) = d.with_page();
            d.text_wrap_pretty_supported = Some(false);
            let div = d.add(Some(body), "div");
            let p = block(&mut d, div, "p", PROSE, &[560.0, 560.0, 40.0]);
            assert_eq!(ids(&d, p), ["straggler"]);
            setup(&mut d, html, div, p);
            ids(&d, p)
        };
        assert!(build(&|d, _, _, p| {
            d.set_attr(p, "style", "width: 39.5ch; text-wrap: pretty");
        })
        .is_empty());
        assert!(build(&|d, _, div, _| {
            d.set_attr(div, "style", "text-wrap: pretty");
        })
        .is_empty());
        assert!(build(&|d, html, _, p| {
            let style = d.add(Some(html), "style");
            d.add_text(style, ".lede { text-wrap: pretty }");
            d.add_selector(p, ".lede");
        })
        .is_empty());
        assert!(build(&|d, html, _, p| {
            let style = d.add(Some(html), "style");
            d.add_text(style, "@media (min-width: 40em) { p.copy { text-wrap: wrap pretty !important; } }");
            d.add_selector(p, "p.copy");
        })
        .is_empty());
    }

    /// A rule that does not reach the paragraph, a `pretty` the author
    /// commented out or wrote over, an explicit reset on the paragraph under
    /// an ancestor's `pretty`, or a browser that applies `pretty` (or a
    /// capture that never asked) leaves the finding alone.
    #[test]
    fn a_pretty_elsewhere_or_in_a_browser_that_applies_it_still_flags() {
        for flag in [Some(false), None, Some(true)] {
            let mut d = FakeDom::new();
            let (html, body) = d.with_page();
            d.text_wrap_pretty_supported = flag;
            let style = d.add(Some(html), "style");
            d.add_text(style, ".pull-quote { text-wrap: pretty } p!! { text-wrap: pretty }");
            let p = block(&mut d, body, "p", PROSE, &[560.0, 560.0, 40.0]);
            assert_eq!(ids(&d, p), ["straggler"], "{flag:?}");
            if flag != Some(false) {
                d.set_attr(p, "style", "text-wrap: pretty");
                assert_eq!(ids(&d, p), ["straggler"], "{flag:?}");
            }
        }
        let mut d = FakeDom::new();
        let (html, body) = d.with_page();
        d.text_wrap_pretty_supported = Some(false);
        let p = block(&mut d, body, "p", PROSE, &[560.0, 560.0, 40.0]);
        for style in ["/* text-wrap: pretty */", "text-wrap: pretty; text-wrap: auto"] {
            d.set_attr(p, "style", style);
            assert_eq!(ids(&d, p), ["straggler"], "{style}");
        }
        // `body { text-wrap: pretty }` with the paragraph reset inline.
        let sheet = d.add(Some(html), "style");
        d.add_text(sheet, "body { text-wrap: pretty }");
        d.set_attr(p, "style", "text-wrap: auto");
        assert_eq!(ids(&d, p), ["straggler"]);
        // The reset in a later rule of the paragraph's own.
        d.set_attr(p, "style", "");
        d.add_text(sheet, " p { text-wrap-style: auto }");
        assert_eq!(ids(&d, p), ["straggler"]);
        // An `!important` pretty outlives a later reset.
        d.set_attr(p, "style", "text-wrap: pretty !important; text-wrap: auto");
        assert!(ids(&d, p).is_empty());
        // `inherit` hands the decision to an ancestor that declares nothing.
        d.add_text(sheet, " body { text-wrap: auto }");
        d.set_attr(p, "style", "text-wrap: inherit");
        assert_eq!(ids(&d, p), ["straggler"]);
    }

    /// `body { text-wrap: pretty }` reaches a paragraph that says `inherit`
    /// or `unset`, inline or in a rule of its own: the author kept the
    /// ancestor's choice, so the finding stands down.
    #[test]
    fn an_inherited_pretty_stands_straggler_down() {
        for own in ["text-wrap: inherit", "text-wrap-style: unset"] {
            let mut d = FakeDom::new();
            let (html, body) = d.with_page();
            d.text_wrap_pretty_supported = Some(false);
            let sheet = d.add(Some(html), "style");
            d.add_text(sheet, "body { text-wrap: pretty }");
            let p = block(&mut d, body, "p", PROSE, &[560.0, 560.0, 40.0]);
            d.set_attr(p, "style", own);
            assert!(ids(&d, p).is_empty(), "{own}");
            d.set_attr(p, "style", "");
            d.add_text(sheet, &format!(" p {{ {own} }}"));
            assert!(ids(&d, p).is_empty(), "{own}");
        }
    }

    /// Minified CSS writes `pretty!important`, a comment may hold a dead
    /// declaration, a custom property may wear the name, and each live
    /// declaration names its own rule: under a grouping at-rule, not nested
    /// in a style rule.
    #[test]
    fn text_wrap_rules_reads_rules_not_substrings() {
        let css = r#".a { color: red; /* text-wrap: pretty */ } /* p { text-wrap: pretty } */ @font-face { font-family: x } @supports (display: grid) { .b, .c { text-wrap: pretty } } .d { text-wrap: balance } p{text-wrap:pretty!important} .e { content: "\""; } .f { text-wrap: pretty; & p { color: red } } .g { .x { text-wrap: pretty } } :root { --text-wrap: pretty }"#;
        let rules = text_wrap_rules(css);
        let rules: Vec<(&str, Wrap, bool)> = rules.iter().map(|(sel, d)| (sel.as_str(), d.wrap, d.important)).collect();
        assert_eq!(
            rules,
            [(".b, .c", Wrap::Pretty, false), (".d", Wrap::Other, false), ("p", Wrap::Pretty, true), (".f", Wrap::Pretty, false)]
        );
    }
}
