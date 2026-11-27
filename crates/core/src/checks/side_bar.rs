//! `side-tab` on an inline side: a bar down the left or right edge of a box.
//!
//! A side bar is any of
//! - a border on one inline side only (`border-left`, `border-right`,
//!   `border-inline-start`, `border-inline-end`), the other sides drawing
//!   nothing or a thinner hairline;
//! - an inset box-shadow offset along x alone, with no blur and no spread
//!   (`inset 3px 0 0 c`, `inset -3px 0 0 c`);
//! - an absolutely positioned `::before` / `::after` at most
//!   [`SIDE_BAR_MAX_PX`] wide, against the left or right edge, spanning the
//!   box's height.
//!
//! It is `side-tab` only on a rounded box, at any width ([`side_bar_stands`]):
//! a bar on a square box is fine, whatever its width. The state a selector
//! styles (hover, pressed, selected, current) and the bar's colour (neutral,
//! the text colour, a token that does not resolve) do not matter. What is not
//! a side bar at all stays out: a border drawn on every side, the grid lines
//! of a table, whose rows and cells [`crate::checks::row_stripe`] reads, a
//! focus outline, and a circle, whose one-sided border is an arc.
//!
//! Top and bottom bands keep their own, older gate (a band on a card rounded
//! away from it), read by [`crate::checks::rules::check_borders`] and the
//! two recorded CSS-text scans in [`crate::checks::css_scan`]. Those recorded
//! producers are pinned by the frozen call vectors, so the engines take only
//! their top and bottom findings ([`is_inline_side_tab`] says which to drop)
//! and read left and right through this module.

use crate::checks::css_scan::{
    collect_css_custom_props, css_length_to_px, is_zero_offset, parse_css_decl_block, resolve_var_refs,
    CustomProps, DeclMap, PatternFinding, CSS_RULE_BLOCK_SOURCE,
};
use crate::checks::row_stripe::{self, is_row_or_cell_part, is_table_or_aria_row_part};
use crate::checks::rules::{
    check_borders, extract_shadow_lengths, find_shadow_color, is_circle, BorderOpts, Corners,
    RuleHit, Sides,
};
use crate::color::parse_any_color;
use crate::js::{self, number_to_string};
use crate::js_ext_a::{advance_utf16, split_commas_outside_parens, utf16_index};
use once_cell::sync::Lazy;
use regex::Regex;

macro_rules! re {
    ($name:ident, $pat:expr) => {
        static $name: Lazy<Regex> = Lazy::new(|| Regex::new(&$pat).expect(stringify!($name)));
    };
}

/// A side this wide reads as a bar beside hairlines ([`is_bar_beside`]).
pub const SIDE_BAR_MIN_PX: f64 = 2.0;
/// The widest inset shadow or pseudo-element that reads as a bar rather than
/// a panel.
pub const SIDE_BAR_MAX_PX: f64 = 12.0;

/// Tags a side bar is never read on: a table's parts (their borders are grid
/// lines, and a status stripe on a row or cell is [`crate::checks::row_stripe`]'s),
/// a rule, and the elements that render no box.
const SIDE_BAR_EXEMPT_TAGS: &[&str] = &[
    "html", "head", "body", "script", "style", "link", "meta", "title", "br", "hr", "table",
    "thead", "tbody", "tfoot", "tr", "td", "th", "col", "colgroup",
];

/// Whether a bar `thickness` px wide is `side-tab` on a box that is or is not
/// `rounded`: only a rounded box carries one (Paul, 17 Nov 2026).
pub fn side_bar_stands(thickness: f64, rounded: bool) -> bool {
    rounded && thickness >= 1.0
}

/// Whether a side bar finding's selector styles a state (`:hover`,
/// `:focus-within`): its own rule may round the box only in that state, so
/// the engines that read the box at rest ask the rule as well.
pub fn is_state_side_bar(finding: &PatternFinding) -> bool {
    finding.selector.as_deref().is_some_and(|s| without_state_pseudos(s) != s)
}

/// Whether an element's `style` attribute squares every corner a state
/// rule might round: its radius declarations, by property name, win over
/// the rule's, and a corner they leave alone or cannot resolve may still
/// round on hover.
pub fn inline_style_squares_box(style: Option<&str>) -> bool {
    let mut corners = crate::checks::rules::DeclaredCorners::default();
    corners.set_all(Some(Corners { top_left: 1.0, top_right: 1.0, bottom_right: 1.0, bottom_left: 1.0 }));
    let decls: Vec<(String, &str)> = style
        .unwrap_or("")
        .split(';')
        .filter_map(|d| d.split_once(':'))
        .map(|(p, v)| (js::trim(p).to_ascii_lowercase(), js::trim(v)))
        .filter(|(p, _)| crate::checks::rules::is_radius_property(p))
        .collect();
    // Normal declarations first, then `!important` ones, each in source order.
    for important in [false, true] {
        for (prop, value) in decls.iter().filter(|(_, v)| is_important_value(v) == important) {
            corners.apply(prop, value, NOMINAL_INLINE_WIDTH_PX);
        }
    }
    corners.squares_all()
}

/// Whether a declaration value carries `!important`, with any white space
/// after the `!`.
fn is_important_value(value: &str) -> bool {
    value.rsplit_once('!').is_some_and(|(_, rest)| js::trim(rest).eq_ignore_ascii_case("important"))
}

/// The width a percentage radius in a `style` attribute is read against.
const NOMINAL_INLINE_WIDTH_PX: f64 = 400.0;

/// Whether a side `px` wide is a bar beside other sides at most `other` px:
/// drawn alone, or 2px or more beside hairlines or sides at most half its
/// width. Equal sides are a frame.
pub fn is_bar_beside(px: f64, other: f64) -> bool {
    other == 0.0 || (px >= SIDE_BAR_MIN_PX && (other <= 1.0 || px >= other * 2.0))
}

/// Whether corners round the box at all: any radius known to be above zero.
/// Corners the caller could not read (`None`: a radius that does not
/// resolve, a stylesheet the engine could not load) are not known to round
/// it, so a hairline there stays silent.
pub fn corners_round(corners: Option<&Corners>) -> bool {
    corners.map_or(false, |c| {
        [c.top_left, c.top_right, c.bottom_right, c.bottom_left].iter().any(|r| *r > 0.0)
    })
}

/// Whether a tag can carry a side bar.
pub fn side_bar_tag(tag: &str) -> bool {
    !SIDE_BAR_EXEMPT_TAGS.contains(&tag)
}

/// Whether a `side-tab` finding from one of the recorded producers sits on
/// the left or right: its border snippet (`border-left: 4px ...`) or its
/// stripe edge (`(left)`, `(right: 0)`). The engines drop these and read the
/// inline sides through this module.
pub fn is_inline_side_tab(id: &str, snippet: &str) -> bool {
    re!(EDGE_RE, r"\((?:left|right)(?:: 0)?\)$".to_string());
    id == "side-tab"
        && (snippet.starts_with("border-left") || snippet.starts_with("border-right") || EDGE_RE.is_match(snippet))
}

/// The bar's thickness in px, read off a [`scan_css_text_for_side_bars`]
/// snippet (`.x — inset box-shadow 2px stripe (left)`).
pub fn side_bar_thickness(snippet: &str) -> Option<f64> {
    re!(PX_RE, r" — (?:inset box-shadow|absolute|border-[a-z-]+) ([0-9.]+)px ".to_string());
    PX_RE.captures(snippet).and_then(|c| c[1].parse().ok())
}

/// The selector with every interaction state taken out (`:hover`, `:focus`,
/// `:focus-visible`, `:focus-within`, `:active`, `:checked`, `:target`): the
/// elements a bar in that state paints on, whatever state they are in at
/// capture.
pub fn without_state_pseudos(selector: &str) -> String {
    re!(
        STATE_RE,
        r"(?i):(?:hover|focus-visible|focus-within|focus|active|checked|target)(?:$|[^-_A-Za-z0-9(])".to_string()
    );
    // A state inside a functional pseudo-class (`:not(:focus)`) is part of
    // what the selector asks of the box and stays.
    let depth_at = |text: &str, at: usize| {
        text[..at].chars().fold(0i32, |d, c| match c {
            '(' => d + 1,
            ')' => d - 1,
            _ => d,
        })
    };
    let mut out = selector.to_string();
    let mut from = 0;
    while let Some((start, end)) = STATE_RE.find_at(&out, from).map(|m| {
        (m.start(), m.end() - usize::from(m.as_str().ends_with(|c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '_')))
    }) {
        if depth_at(&out, start) > 0 {
            from = end;
            continue;
        }
        out.replace_range(start..end, "");
        from = start;
    }
    out
}

/// [`check_borders`] with its left and right findings replaced by the side
/// bar reading: what the static and browser engines report for an element's
/// own borders. `colors` are the computed border colours; a side whose colour
/// is transparent draws nothing.
pub fn check_borders_with_side_bars(
    tag: &str,
    widths: &Sides<f64>,
    colors: &Sides<Option<&str>>,
    radius: f64,
    opts: &BorderOpts,
) -> Vec<RuleHit> {
    let mut hits = check_borders(tag, widths, colors, radius, opts);
    hits.retain(|h| !is_inline_side_tab(&h.id, &h.snippet));
    if !side_bar_tag(tag) || is_circle(opts) {
        return hits;
    }
    let visible = |i: usize| {
        widths.get(i) > 0.0
            && colors
                .get(i)
                .map_or(true, |c| parse_any_color(Some(c)).map_or(true, |c| c.alpha_or_one() >= 0.1))
    };
    // A transparent side beside a drawn one is a CSS triangle (a caret, an
    // arrow), not a bar.
    if (0..4).any(|j| widths.get(j) > 0.0 && !visible(j)) {
        return hits;
    }
    let rounded = corners_round(opts.corners.as_ref());
    for (i, side) in [(1usize, "right"), (3, "left")] {
        if !visible(i) {
            continue;
        }
        let w = widths.get(i);
        let max_other = (0..4)
            .filter(|&j| j != i && visible(j))
            .map(|j| widths.get(j))
            .fold(0.0f64, f64::max);
        let bar = is_bar_beside(w, max_other);
        if !bar || !side_bar_stands(w, rounded) {
            continue;
        }
        // The wording the borders check used: the leading radius when it has
        // one, and for a thin bar on a box rounded elsewhere the smaller of
        // the corners away from it.
        let r = match opts.corners.as_ref() {
            _ if radius > 0.0 => radius,
            Some(c) if rounded && w < 3.0 => {
                let (a, b) = c.away_from(i);
                if a.min(b) > 0.0 {
                    a.min(b)
                } else {
                    [c.top_left, c.top_right, c.bottom_right, c.bottom_left].into_iter().fold(0.0f64, f64::max)
                }
            }
            _ => 0.0,
        };
        let w_s = number_to_string(w);
        hits.push(RuleHit::new(
            "side-tab",
            if r > 0.0 {
                format!("border-{side}: {w_s}px + border-radius: {}px", number_to_string(r))
            } else {
                format!("border-{side}: {w_s}px")
            },
        ));
    }
    hits
}

re!(RULE_RE, CSS_RULE_BLOCK_SOURCE.to_string());
re!(COMMENT_RE, r"(?s)/\*.*?\*/".to_string());
re!(INSET_RE, r"(?i)\binset\b".to_string());
re!(PSEUDO_RE, r"(?i)::?(?:before|after)\b".to_string());
re!(HR_RE, r"(?i)(?:^|[\s>+~,(])hr(?:$|[\s.#:\[>+~,)])".to_string());
re!(
    NO_PAINT_RE,
    r"(?i)^(?:none|transparent|initial|unset|revert)$".to_string()
);
re!(URL_RE, r#"(?i)url\((?:"[^"]*"|'[^']*'|[^)]*)\)"#.to_string());
re!(VAR_RE, r"(?i)var\(\s*--[-_A-Za-z0-9]+\s*(?:,[^)]*)?\)".to_string());
re!(FULL_PCT_RE, r"^100(?:\.0*)?%$".to_string());

/// Whether a colour value paints: anything but a no-paint keyword or a
/// colour under 10% alpha. A token that does not resolve, the text colour
/// and a name the parser does not know all paint.
fn colour_paints(value: &str) -> bool {
    let v = js::trim(value);
    if v.is_empty() || NO_PAINT_RE.is_match(v) {
        return false;
    }
    parse_any_color(Some(v)).map_or(true, |c| c.alpha_or_one() >= 0.1)
}

/// An inset shadow layer that is a bar down the left or right edge:
/// `(thickness, edge)`.
fn inset_bar(value: &str) -> Option<(f64, &'static str)> {
    let mut best: Option<(f64, &'static str)> = None;
    for layer in split_commas_outside_parens(value) {
        let layer = js::trim(layer);
        if !INSET_RE.is_match(layer) {
            continue;
        }
        if layer.split_whitespace().any(|t| NO_PAINT_RE.is_match(t)) {
            continue;
        }
        let (paints, span) = match VAR_RE.find(layer) {
            Some(var) => (true, Some((var.start(), var.end()))),
            None => match find_shadow_color(layer) {
                Some(info) => (
                    info.color.map_or(true, |c| c.alpha_or_one() >= 0.1)
                        && !NO_PAINT_RE.is_match(&layer[info.start..info.end]),
                    Some((info.start, info.end)),
                ),
                // No colour: the shadow takes the text colour.
                None => (true, None),
            },
        };
        let lengths = extract_shadow_lengths(layer, span);
        if !paints || lengths.len() < 2 {
            continue;
        }
        let at = |i: usize| lengths.get(i).copied().filter(|v| v.is_finite()).unwrap_or(0.0);
        let (x, y, blur, spread) = (at(0), at(1), at(2), at(3));
        if y != 0.0 || blur != 0.0 || spread != 0.0 || !(1.0..=SIDE_BAR_MAX_PX).contains(&x.abs()) {
            continue;
        }
        if best.map_or(true, |(px, _)| x.abs() > px) {
            best = Some((x.abs(), if x > 0.0 { "left" } else { "right" }));
        }
    }
    best
}

/// The four insets a pseudo-element declares, `[top, right, bottom, left]`,
/// from the longhands, the `inset` shorthand and the logical forms.
fn insets(decls: &DeclMap) -> [Option<String>; 4] {
    let get = |p: &str| decls.get(p).map(|s| s.to_string());
    let mut out = [get("top"), get("right"), get("bottom"), get("left")];
    let mut fill = |i: usize, v: &str| {
        if out[i].is_none() {
            out[i] = Some(v.to_string());
        }
    };
    if let Some(v) = decls.get("inset") {
        let p: Vec<&str> = v.split_whitespace().collect();
        let (t, r, b, l) = match p.len() {
            0 => ("", "", "", ""),
            1 => (p[0], p[0], p[0], p[0]),
            2 => (p[0], p[1], p[0], p[1]),
            3 => (p[0], p[1], p[2], p[1]),
            _ => (p[0], p[1], p[2], p[3]),
        };
        for (i, v) in [t, r, b, l].into_iter().enumerate() {
            fill(i, v);
        }
    }
    if let Some(v) = decls.get("inset-block") {
        let p: Vec<&str> = v.split_whitespace().collect();
        if let Some(first) = p.first() {
            fill(0, first);
            fill(2, p.get(1).unwrap_or(first));
        }
    }
    if let Some(v) = decls.get("inset-inline") {
        let p: Vec<&str> = v.split_whitespace().collect();
        if let Some(first) = p.first() {
            fill(3, first);
            fill(1, p.get(1).unwrap_or(first));
        }
    }
    for (prop, i) in [
        ("inset-block-start", 0),
        ("inset-block-end", 2),
        ("inset-inline-start", 3),
        ("inset-inline-end", 1),
    ] {
        if let Some(v) = decls.get(prop) {
            fill(i, v);
        }
    }
    out
}

/// A `::before` / `::after` rule that paints a bar down the left or right
/// edge of its host: `(thickness, edge)`.
fn pseudo_bar(decls: &DeclMap, props: &CustomProps) -> Option<(f64, &'static str)> {
    let resolve = |v: &str| resolve_var_refs(v, props);
    if !matches!(decls.get("position").map(|s| s.as_str()), Some("absolute" | "fixed")) {
        return None;
    }
    let width = decls.get("width").or_else(|| decls.get("inline-size"))?;
    let thickness = css_length_to_px(&resolve(width))?;
    if !(1.0..=SIDE_BAR_MAX_PX).contains(&thickness) {
        return None;
    }
    let [top, right, bottom, left] = insets(decls).map(|v| v.map(|v| resolve(&v)));
    let height = decls.get("height").or_else(|| decls.get("block-size")).map(|v| resolve(v));
    let near = |v: &Option<String>| v.as_deref().and_then(css_length_to_px).is_some_and(|px| (0.0..=20.0).contains(&px));
    let full_height = (is_zero_offset(top.as_deref()) && is_zero_offset(bottom.as_deref()))
        || height.as_deref().is_some_and(|h| FULL_PCT_RE.is_match(js::trim(h)))
        || (near(&top) && near(&bottom));
    if !full_height {
        return None;
    }
    let edge = if is_zero_offset(left.as_deref()) {
        "left"
    } else if is_zero_offset(right.as_deref()) {
        "right"
    } else {
        return None;
    };
    let paint = decls
        .get("background-color")
        .or_else(|| decls.get("background"))
        .map(|v| resolve(v))
        .unwrap_or_default();
    let paint = js::trim(&paint);
    // A picture with no colour beside it is an image, not a bar.
    let image_only = URL_RE.is_match(paint)
        && !URL_RE
            .replace_all(paint, " ")
            .split(|c: char| c.is_whitespace() || c == ',' || c == '/')
            .any(|t| !t.is_empty() && (parse_any_color(Some(t)).is_some() || t.contains("var(")));
    if image_only || !colour_paints(paint) {
        return None;
    }
    Some((thickness, edge))
}

/// Every rule in a stylesheet's text that paints a side bar with an inset
/// box-shadow or a pseudo-element, whatever state its selector styles and
/// whatever its colour. The finding's `index` is the selector's byte offset
/// in `content`. A bar under [`SIDE_BAR_MIN_PX`] is reported too: whether
/// its box is rounded is the caller's to read, against the elements the rule
/// paints or the host rules of the text ([`side_bar_thickness`] reads the
/// width back). A rule for a table's row or cell is
/// [`crate::checks::row_stripe`]'s, unless the rule rounds it (a row named
/// only by class that is rounded is a card).
pub fn scan_css_text_for_side_bars(content: &str) -> Vec<PatternFinding> {
    scan_css_text_for_side_bars_with(content, false)
}

/// [`scan_css_text_for_side_bars`], and with `state_borders` the side borders
/// of rules for a hover or focus state too (`.it:hover { border-left: 2px
/// solid }`): an engine reading borders off the element at rest never sees
/// them. The text engine reads every border declaration on its own.
pub fn scan_css_text_for_side_bars_with(content: &str, state_borders: bool) -> Vec<PatternFinding> {
    if !content.contains("inset") && !content.contains("before") && !content.contains("after") && !(state_borders && content.contains("border")) {
        return Vec::new();
    }
    // Comments blanked UTF-16 unit for unit, newlines kept, so a selector's
    // offset maps back onto `content`.
    let text = COMMENT_RE.replace_all(content, |m: &regex::Captures| {
        m[0].chars()
            .flat_map(|c| std::iter::repeat(if c == '\n' { '\n' } else { ' ' }).take(if c == '\n' { 1 } else { c.len_utf16() }))
            .collect::<String>()
    });
    let props = collect_css_custom_props(&text);
    let mut findings: Vec<PatternFinding> = Vec::new();
    // Each selector's bar, by its index in `findings` and its thickness: a
    // thicker bar for the same selector replaces a thinner one.
    let mut seen: Vec<(String, usize, f64)> = Vec::new();
    for m in RULE_RE.captures_iter(&text) {
        let raw = m.get(1).unwrap();
        let selector = js::trim(raw.as_str());
        if selector.is_empty() || selector.starts_with('@') || HR_RE.is_match(selector) {
            continue;
        }
        let decls = parse_css_decl_block(&m[2]);
        let rounds = decls.iter().any(|(p, v)| p.ends_with("radius") && !matches!(js::trim(v), "0" | "0px" | "0%"));
        let parts: Vec<&str> = split_commas_outside_parens(selector)
            .into_iter()
            .map(js::trim)
            .filter(|part| !is_table_or_aria_row_part(part) && (rounds || !is_row_or_cell_part(part)))
            .collect();
        if parts.is_empty() {
            continue;
        }
        let pseudo = PSEUDO_RE.is_match(selector);
        let bar = if pseudo {
            pseudo_bar(&decls, &props).map(|(px, edge)| {
                format!("absolute {}px pseudo-element stripe ({edge}: 0)", number_to_string(px))
            })
        } else {
            // The bar is the box itself when the box is this narrow.
            let narrow = decls
                .get("width")
                .or_else(|| decls.get("inline-size"))
                .and_then(|w| css_length_to_px(&resolve_var_refs(w, &props)))
                .is_some_and(|w| w <= 40.0);
            decls
                .get("box-shadow")
                .filter(|_| !narrow)
                .and_then(|v| inset_bar(&resolve_var_refs(v, &props)))
                .map(|(px, edge)| format!("inset box-shadow {}px stripe ({edge})", number_to_string(px)))
                .or_else(|| {
                    let state = state_borders && without_state_pseudos(selector) != selector;
                    let lookup = |name: &str| props.get(name).cloned();
                    // The first side that stands as a bar: a right bar
                    // stays a bar beside a thinner left border.
                    state
                        .then(|| row_stripe::border_stripes_in(&m[2], &lookup, 1.0..=f64::MAX))
                        .into_iter()
                        .flatten()
                        .find(|&(_, px, _, other)| is_bar_beside(px, other))
                        .map(|(prop, px, edge, _)| format!("{prop} {}px stripe ({edge})", number_to_string(px)))
                })
        };
        let Some(detail) = bar else { continue };
        let thickness = side_bar_thickness(&format!(" — {detail}")).unwrap_or(0.0);
        let selector = parts.join(", ");
        let selector = selector.split_whitespace().collect::<Vec<_>>().join(" ");
        let leading = raw.as_str().len() - js::trim_start(raw.as_str()).len();
        let index = advance_utf16(content, 0, utf16_index(&text, raw.start() + leading));
        if !selector.contains('&') {
            if let Some(&(_, at, px)) = seen.iter().find(|(s, _, _)| *s == selector) {
                // The thicker bar replaces the thinner one, its rule's
                // position with it.
                if thickness > px {
                    findings[at].snippet = format!("{selector} — {detail}");
                    findings[at].index = Some(index);
                    if let Some(entry) = seen.iter_mut().find(|(s, _, _)| *s == selector) {
                        entry.2 = thickness;
                    }
                }
                continue;
            }
            seen.push((selector.clone(), findings.len(), thickness));
        }
        findings.push(PatternFinding {
            id: "side-tab".to_string(),
            snippet: format!("{selector} — {detail}"),
            selector: Some(selector),
            index: Some(index),
            severity: None,
        });
    }
    findings
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snippets(css: &str) -> Vec<String> {
        scan_css_text_for_side_bars(css).into_iter().map(|f| f.snippet).collect()
    }

    #[test]
    fn every_inline_bar_form_is_read_whatever_its_state_or_colour() {
        let pressed = ".it { border: 0; border-radius: 6px; } \
            .it[aria-pressed='true'] { background: var(--surface-inset); box-shadow: inset 2px 0 0 var(--text); }";
        assert_eq!(snippets(pressed), vec![".it[aria-pressed='true'] — inset box-shadow 2px stripe (left)"]);
        for css in [
            ".it:hover { box-shadow: inset 3px 0 0 #2563eb; }",
            ".it.is-selected { box-shadow: inset -3px 0 0 #ccc; }",
            ".it:not(.x) { box-shadow: inset 1px 0 0 currentColor; }",
            ".it[aria-current=page] { box-shadow: inset 2px 0 0; }",
            ".it::before { content: ''; position: absolute; top: 0; bottom: 0; left: 0; width: 2px; background: var(--text); }",
            ".it::after { content: ''; position: absolute; inset: 0 0 0 auto; width: 3px; background: #111; }",
            ".it::before { content: ''; position: absolute; inset-block: 0; inset-inline-start: 0; width: 4px; background: red; }",
            ".it::before { content: ''; position: absolute; left: 0; height: 100%; width: 2px; background: gray; }",
        ] {
            assert_eq!(snippets(css).len(), 1, "{css}");
        }
        assert_eq!(side_bar_thickness(&snippets(pressed)[0]), Some(2.0));
    }

    #[test]
    fn what_is_not_a_side_bar_stays_out() {
        for css in [
            // Blurred, spread, vertical, transparent, faint, too wide.
            ".a { box-shadow: inset 3px 0 6px #000; }",
            ".a { box-shadow: inset 3px 0 0 2px #000; }",
            ".a { box-shadow: inset 0 -2px 0 #000; }",
            ".a { box-shadow: inset 3px 0 0 transparent; }",
            ".a { box-shadow: inset 3px 0 0 rgba(0,0,0,.05); }",
            ".a { box-shadow: inset 16px 0 0 #000; }",
            // A box this narrow is the bar itself.
            ".a { width: 4px; box-shadow: inset 2px 0 0 #000; }",
            // Table parts are the row scan's; a rule is no box.
            "td + td { box-shadow: inset 2px 0 0 #000; }",
            "hr { box-shadow: inset 2px 0 0 #000; }",
            // A pseudo-element that does not span the height, sits off the
            // edge, is not positioned, paints nothing or a picture.
            ".a::before { content: ''; position: absolute; top: 40%; left: 0; width: 2px; height: 8px; background: red; }",
            ".a::before { content: ''; position: absolute; top: 0; bottom: 0; left: 12px; width: 2px; background: red; }",
            ".a::before { content: ''; top: 0; bottom: 0; left: 0; width: 2px; background: red; }",
            ".a::before { content: ''; position: absolute; top: 0; bottom: 0; left: 0; width: 2px; background: transparent; }",
            ".a::before { content: ''; position: absolute; top: 0; bottom: 0; left: 0; width: 2px; background: url(x.png); }",
            "/* .a { box-shadow: inset 3px 0 0 red; } */",
        ] {
            assert_eq!(snippets(css), Vec::<String>::new(), "{css}");
        }
        // A rounded box named for a row is a card; a square one is the row scan's.
        assert_eq!(snippets(".row-card { box-shadow: inset 2px 0 0 red; border-radius: 8px; }").len(), 1);
        assert!(snippets(".row-card { box-shadow: inset 2px 0 0 red; }").is_empty());
    }

    #[test]
    fn review_round_one() {
        // A thicker bar later in the sheet, or in a later layer, is the one
        // read for its selector.
        assert_eq!(
            snippets(".x { box-shadow: inset 1px 0 0 #ddd; } .x { box-shadow: inset 4px 0 0 red; }"),
            vec![".x — inset box-shadow 4px stripe (left)"]
        );
        assert_eq!(
            snippets(".x { box-shadow: inset 1px 0 0 #ddd, inset 4px 0 0 red; }"),
            vec![".x — inset box-shadow 4px stripe (left)"]
        );
        // A state inside a functional pseudo-class stays.
        assert_eq!(without_state_pseudos(".it:not(:focus)"), ".it:not(:focus)");
        assert_eq!(without_state_pseudos(".it:hover:not(:focus)"), ".it:not(:focus)");
        // A side border in a hover state, for an engine that reads borders
        // at rest; not in the plain scan, where the border matchers read it.
        let hover = ".it:hover { border-left: 2px solid #ddd; }";
        assert!(snippets(hover).is_empty());
        let with: Vec<String> = scan_css_text_for_side_bars_with(hover, true).into_iter().map(|f| f.snippet).collect();
        assert_eq!(with, vec![".it:hover — border-left 2px stripe (left)"]);
        assert_eq!(side_bar_thickness(&with[0]), Some(2.0));
        assert!(scan_css_text_for_side_bars_with(".it { border-left: 2px solid #ddd; }", true).is_empty());
    }

    #[test]
    fn review_round_two() {
        // The replacing bar carries its own rule's position.
        let css = ".x { box-shadow: inset 1px 0 0 #ddd; }\n.x { box-shadow: inset 4px 0 0 red; }";
        let found = scan_css_text_for_side_bars(css);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].index, Some(css.find(".x { box-shadow: inset 4px").unwrap()));
        // Equal borders on both inline sides in a hover state are a frame.
        assert!(scan_css_text_for_side_bars_with(".it:hover { border-left: 2px solid #ddd; border-right: 2px solid #ddd; }", true).is_empty());
        assert_eq!(scan_css_text_for_side_bars_with(".it:hover { border-left: 4px solid #ddd; border-right: 1px solid #ddd; }", true).len(), 1);
    }

    #[test]
    fn a_state_bar_on_the_right_beside_a_thinner_left_border() {
        // The left side fails against the right; the right is the bar.
        let found = scan_css_text_for_side_bars_with(".it:hover { border-left: 2px solid #ddd; border-right: 4px solid #ddd; }", true);
        let snippets: Vec<&str> = found.iter().map(|f| f.snippet.as_str()).collect();
        assert_eq!(snippets, vec![".it:hover — border-right 4px stripe (right)"]);
    }

    #[test]
    fn an_inline_style_squares_the_box_only_by_its_radius_declarations() {
        assert!(inline_style_squares_box(Some("border-radius: 0")));
        assert!(inline_style_squares_box(Some("color: red; BORDER-RADIUS:0px")));
        assert!(!inline_style_squares_box(Some("--radius: 8px")));
        assert!(!inline_style_squares_box(Some("border-top-left-radius: 0")));
        assert!(!inline_style_squares_box(Some("border-radius: var(--r)")));
        assert!(!inline_style_squares_box(None));
        assert!(inline_style_squares_box(Some("border-radius:0!important;border-radius:8px")));
        assert!(!inline_style_squares_box(Some("border-radius:0;border-radius:8px")));
        assert!(inline_style_squares_box(Some("border-radius:8px!important;border-radius:0! important")));
        assert!(!inline_style_squares_box(Some("border-radius:0 ! IMPORTANT;border-radius:8px !important")));
    }

    #[test]
    fn a_bar_stands_on_a_rounded_box_at_any_width_and_never_on_a_square_one() {
        assert!(!side_bar_stands(6.0, false));
        assert!(side_bar_stands(1.0, true));
        assert!(!side_bar_stands(1.0, false));
        assert!(!side_bar_stands(0.5, true));
    }

    #[test]
    fn element_borders_report_every_inline_bar() {
        let opts = |r: f64| BorderOpts {
            corners: Some(Corners { top_left: r, top_right: r, bottom_right: r, bottom_left: r }),
            ..Default::default()
        };
        let sides = |l: f64, rest: f64| Sides { top: rest, right: rest, bottom: rest, left: l };
        let colours = |l: &'static str| Sides { top: Some("rgb(0, 0, 0)"), right: Some("rgb(0, 0, 0)"), bottom: Some("rgb(0, 0, 0)"), left: Some(l) };
        let ids = |tag: &str, w: Sides<f64>, c: Sides<Option<&str>>, r: f64| {
            check_borders_with_side_bars(tag, &w, &c, r, &opts(r)).into_iter().map(|h| h.snippet).collect::<Vec<_>>()
        };
        let grey = colours("rgb(209, 213, 219)");
        // A neutral bar on a rounded button; a hairline on a rounded box.
        assert_eq!(ids("a", sides(3.0, 1.0), grey, 6.0), vec!["border-left: 3px + border-radius: 6px"]);
        assert_eq!(ids("div", sides(1.0, 0.0), grey, 6.0), vec!["border-left: 1px + border-radius: 6px"]);
        // Any bar on a square box, a full border, a table cell, an
        // invisible side, a circle.
        assert!(ids("button", sides(4.0, 0.0), grey, 0.0).is_empty());
        assert!(ids("div", sides(1.0, 0.0), grey, 0.0).is_empty());
        assert!(ids("div", sides(2.0, 2.0), grey, 6.0).is_empty());
        assert!(ids("td", sides(3.0, 0.0), grey, 0.0).is_empty());
        assert!(ids("div", sides(3.0, 0.0), colours("rgba(0, 0, 0, 0)"), 6.0).is_empty());
        // A caret drawn with transparent sides.
        let caret = Sides { top: 6.0, right: 0.0, bottom: 6.0, left: 6.0 };
        let caret_colours = Sides { top: Some("rgba(0, 0, 0, 0)"), right: Some("rgba(0, 0, 0, 0)"), bottom: Some("rgba(0, 0, 0, 0)"), left: Some("rgb(51, 51, 51)") };
        assert!(check_borders_with_side_bars("span", &caret, &caret_colours, 0.0, &opts(0.0)).is_empty());
        assert_eq!(without_state_pseudos(".a:hover .b:focus-within, .c:not(:focus)"), ".a .b, .c:not(:focus)");
        let mut ring = opts(20.0);
        ring.box_size = Some([40.0, 40.0]);
        assert!(check_borders_with_side_bars("div", &sides(3.0, 0.0), &grey, 20.0, &ring).is_empty());
    }
}
