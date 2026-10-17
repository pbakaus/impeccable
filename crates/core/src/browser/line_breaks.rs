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
//! otherwise silence every heading on the page.
//!
//! Both are advisory. An uneven break can be the design: a headline that
//! lands on one word for weight, a poster line, a pull quote.

use super::dom::{renders_no_text, tag_lower, Dom, DomChild, ElId};
use super::quality::{is_atomic_inline, is_visually_hidden, rendered_text_len, COMBINING_OR_FORMAT_RE};
use super::text_geometry::{holds_only_phrasing, phrasing_holds_break};
use crate::checks::rules::{is_heading_tag, RuleHit};
use crate::checks::text_rules::is_cjk_text;
use crate::js::{self, math_round, number_to_string};

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

/// The characters of `word` that take up room on a line, counted as
/// `rendered_text_len` counts them: one per character, combining marks and
/// format characters left out. An emoji is one, not two UTF-16 units.
fn advancing_len(word: &str) -> f64 {
    let mut buf = [0u8; 4];
    word.chars().filter(|c| !COMBINING_OR_FORMAT_RE.is_match(c.encode_utf8(&mut buf))).count() as f64
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
/// The lines are measured; the words on them are not. The characters divide
/// between the lines in proportion to their widths, as `line-length` divides
/// them, and the last line holds one word when its share of the characters
/// is nearer the last word's length than the last two words'.
fn check_straggler(dom: &dyn Dom, el: ElId) -> Option<RuleHit> {
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
    if words.len() < MIN_WORDS || is_cjk_text(&words.join(" ")) || !sets_one_face(dom, el) {
        return None;
    }
    let chars_per_px = chars_per_px(dom, el, &widths)?;
    if widest * chars_per_px < STRAGGLER_MIN_COLUMN_CHARS {
        return None;
    }
    let word = &words[words.len() - 1];
    let one = advancing_len(word);
    let two = one + 1.0 + advancing_len(&words[words.len() - 2]);
    if last * chars_per_px >= (one + two) / 2.0 {
        return None;
    }
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
    if tail >= above * HEADING_MIN_TAIL_RATIO || words(dom, el).len() < MIN_WORDS {
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
    let tag = tag_lower(dom, el);
    let hit = if is_heading_tag(&tag) {
        check_unbalanced_heading(dom, el)
    } else if STRAGGLER_TAGS.contains(&tag.as_str()) {
        check_straggler(dom, el)
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

    /// The word is counted the way the line is: an emoji advances once, not
    /// as its two UTF-16 units, so a short word plus an emoji tail is two
    /// words and not one long one.
    #[test]
    fn the_word_and_the_line_are_counted_alike() {
        assert_eq!(advancing_len("go\u{1F680}"), 3.0);
        assert_eq!(advancing_len("e\u{301}te\u{301}"), 3.0);
    }
}


