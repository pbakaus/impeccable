//! `side-tab` on a status row or cell: a coloured stripe down one side of a
//! table row or cell, drawn as an inset box-shadow (`inset 3px 0 0 red`) or
//! a side border (`border-left: 3px solid red`).
//!
//! The card scans in `css_scan` skip every selector with a table tag and
//! report a stripe only on a card rounded away from it, so a stripe marking
//! a broken or new row went unreported. A row or cell is never a rounded
//! card, so neither gate fits it. It reports here instead when the rule is
//! about the row's state (an `is-*` / `has-*` class, a BEM modifier, a
//! `data-*` attribute) or paints nothing but the stripe. A selection or
//! hover indicator (`:hover`, `.is-selected`, `[aria-current]`) stays silent,
//! as it does on a card.
//!
//! Colours read through `var()`: the rule's own sheet first, then whatever
//! tokens the caller collected across the project, then a token name that
//! says the colour (`--danger`, `--accent-red`). A token that resolves
//! neutral or transparent, or does not resolve and names no colour, is not
//! a stripe.

use crate::checks::css_scan::{
    collect_css_custom_props, css_length_to_px, selector_is_state_indicator, CustomProps, DeclMap,
    PatternFinding, CSS_RULE_BLOCK_SOURCE,
};
use crate::checks::measures::resolve_var_refs;
use crate::checks::rules::{extract_shadow_lengths, find_shadow_color};
use crate::color::{parse_any_color, rgb_to_oklch_lc, Rgba};
use crate::js::{self, number_to_string};
use crate::js_ext_a::split_commas_outside_parens;
use once_cell::sync::Lazy;
use regex::Regex;

macro_rules! re {
    ($name:ident, $pat:expr) => {
        static $name: Lazy<Regex> = Lazy::new(|| Regex::new(&$pat).expect(stringify!($name)));
    };
}

re!(RULE_RE, CSS_RULE_BLOCK_SOURCE.to_string());
re!(COMMENT_RE, r"(?s)/\*.*?\*/".to_string());
re!(
    ROW_TAG_RE,
    r"(?i)(?:^|[^-_A-Za-z0-9.#\[:])(?:tr|td|th)(?:$|[^-_A-Za-z0-9])".to_string()
);
re!(
    ROW_ROLE_RE,
    r#"(?i)\[role\s*=\s*["']?(?:row|cell|gridcell|rowheader)["']?\s*\]"#.to_string()
);
re!(CLASS_RE, r"\.([-_A-Za-z0-9]+)".to_string());
re!(
    PSEUDO_ELEMENT_RE,
    r"(?i)::|:(?:before|after|first-line|first-letter)(?:$|[^-_A-Za-z0-9])".to_string()
);
re!(IMPORTANT_RE, r"(?i)\s*!\s*important\s*$".to_string());
re!(
    STATUS_MARKER_RE,
    r"(?i)\.(?:is|has)-[-_A-Za-z0-9]|\.[A-Za-z0-9_-]+--[A-Za-z0-9]|\[\s*(?:data-[-_A-Za-z0-9]+|aria-invalid)"
        .to_string()
);
// A `data-*` attribute that names a selection (`[data-state=selected]`,
// Radix and shadcn tables) marks the chosen row, not its status.
re!(
    SELECTION_ATTR_RE,
    r#"(?i)\[\s*data-[-_A-Za-z0-9]+\s*[*^$|~]?=\s*["']?(?:selected|active|current|checked)(?:["'\s\]]|$)"#.to_string()
);
re!(INSET_WORD_RE, r"(?i)\binset\b".to_string());
re!(
    VAR_NAME_RE,
    r"(?i)var\(\s*(--[-_A-Za-z0-9]+)\s*(?:,[^)]*)?\)".to_string()
);
// A token named for a colour or a status reads as that colour when no
// declaration of it is in reach.
re!(
    COLOUR_TOKEN_NAME_RE,
    format!(
        "(?i)(?:^|-)(?:{})(?:-|$)",
        [
            "accent", "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal",
            "cyan", "blue", "indigo", "violet", "purple", "magenta", "pink", "rose", "coral",
            "crimson", "scarlet", "danger", "error", "warning", "warn", "success", "critical",
            "negative", "positive", "alert",
        ]
        .join("|")
    )
);
re!(
    NO_PAINT_RE,
    r"(?i)^(?:none|transparent|inherit|initial|unset|revert|currentcolor)$".to_string()
);
re!(
    RESET_RE,
    r"(?i)^(?:none|transparent|initial|unset|0|0px)$".to_string()
);
re!(
    BORDER_STYLE_NONE_RE,
    r"(?i)^(?:none|hidden)$".to_string()
);
re!(
    BORDER_STYLE_RE,
    r"(?i)^(?:solid|dashed|dotted|double|groove|ridge|inset|outset)$".to_string()
);

/// Stripe thickness, in px, read as a row or cell marker.
const MIN_PX: f64 = 2.0;
const MAX_PX: f64 = 6.0;

/// The border properties that set one or more sides, and the sides each
/// sets (0 top, 1 right, 2 bottom, 3 left; logical sides read left to right).
const BORDER_FAMILIES: &[(&str, &[usize])] = &[
    ("border", &[0, 1, 2, 3]),
    ("border-top", &[0]),
    ("border-right", &[1]),
    ("border-bottom", &[2]),
    ("border-left", &[3]),
    ("border-inline", &[3, 1]),
    ("border-block", &[0, 2]),
    ("border-inline-start", &[3]),
    ("border-inline-end", &[1]),
    ("border-block-start", &[0]),
    ("border-block-end", &[2]),
];

/// Whether a selector's subject (the compound after its last combinator) is
/// a table row or cell: a `tr` / `td` / `th`, an ARIA row or cell, or a
/// class named for one (`.row`, `.data-cell`, `.table__row`). A selector
/// list is one when any of its selectors is. What a functional pseudo-class
/// names (`:not(.row)`, `:has(td)`) is not the subject.
pub fn is_row_or_cell_selector(selector: &str) -> bool {
    split_commas_outside_parens(selector).into_iter().any(|part| part_is_row_or_cell(js::trim(part)))
}

/// One selector of a list whose subject is a row or cell. A pseudo-element
/// (`td::before`) is a box of its own, not the cell.
fn part_is_row_or_cell(part: &str) -> bool {
    let subject = without_arguments(subject_compound(part));
    if PSEUDO_ELEMENT_RE.is_match(&subject) {
        return false;
    }
    ROW_TAG_RE.is_match(&subject)
        || ROW_ROLE_RE.is_match(&subject)
        || CLASS_RE.captures_iter(&subject).any(|c| class_names_a_row(&c[1]))
}

/// Whether a class names a row, not a cell (`.row`, `.table__row`): what a
/// cell's ancestors are walked up to.
pub fn class_names_only_a_row(class: &str) -> bool {
    class_names(class, &["row"])
}

/// Whether a class names a row or cell: a `row` / `cell` / `gridcell`
/// segment that is not a layout utility's (`flex-row`, `grid-row`,
/// `row-span-2`, `row-gap-4`, `row-cols-3`).
fn class_names_a_row(class: &str) -> bool {
    class_names(class, &["row", "cell", "gridcell"])
}

fn class_names(class: &str, names: &[&str]) -> bool {
    let segments: Vec<String> = class
        .split(|c| c == '-' || c == '_')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_ascii_lowercase())
        .collect();
    segments.iter().enumerate().any(|(i, seg)| {
        names.contains(&seg.as_str())
            && !(i > 0 && matches!(segments[i - 1].as_str(), "flex" | "grid" | "inline"))
            && !segments.get(i + 1).is_some_and(|next| {
                matches!(next.as_str(), "span" | "start" | "end" | "gap" | "reverse" | "auto" | "cols")
            })
    })
}

/// Whether a `data-state` / `data-status` value names a selection rather
/// than a status.
pub fn is_selection_state_value(value: &str) -> bool {
    matches!(js::to_lower_case(js::trim(value)).as_str(), "selected" | "active" | "current" | "checked")
}

/// Whether a selector's subject is a table or ARIA row or cell by tag or
/// role, which is a row whatever its corners.
fn part_is_table_or_aria_row(part: &str) -> bool {
    let subject = without_arguments(subject_compound(part));
    ROW_TAG_RE.is_match(&subject) || ROW_ROLE_RE.is_match(&subject)
}

/// The selector with every parenthesised argument dropped.
fn without_arguments(selector: &str) -> String {
    let mut out = String::with_capacity(selector.len());
    let mut depth = 0i32;
    for c in selector.chars() {
        match c {
            '(' => depth += 1,
            ')' if depth > 0 => depth -= 1,
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    out
}

/// Whether a selector styles a state of the row rather than every row: an
/// `is-*` / `has-*` class, a BEM modifier, a `data-*` attribute or
/// `[aria-invalid]` anywhere in it.
pub fn selector_has_status_marker(selector: &str) -> bool {
    STATUS_MARKER_RE.is_match(selector)
}

fn subject_compound(selector: &str) -> &str {
    let b = selector.as_bytes();
    let mut depth = 0i32;
    let mut p = b.len();
    while p > 0 {
        match b[p - 1] {
            b')' | b']' => depth += 1,
            b'(' | b'[' => depth -= 1,
            b' ' | b'\t' | b'\n' | b'\r' | b'>' | b'+' | b'~' if depth <= 0 => break,
            _ => {}
        }
        p -= 1;
    }
    &selector[p..]
}

/// Whether a declaration paints something of its own beside the stripe. A
/// reset (`background: none`, `border: 0`) paints nothing.
fn paints(prop: &str, value: &str) -> bool {
    if RESET_RE.is_match(js::trim(value)) {
        return false;
    }
    (prop.starts_with("background") && prop != "background-clip")
        || (prop.starts_with("border")
            && !matches!(prop, "border-collapse" | "border-spacing")
            && !prop.contains("radius"))
        || prop.starts_with("outline")
        || prop.starts_with("text-decoration")
        || matches!(prop, "color" | "opacity" | "filter" | "fill" | "stroke")
        || prop == "box-shadow"
}

/// What a colour value paints: `Some(true)` an accent, `Some(false)` a
/// neutral or nothing, `None` unknown (an unresolved token with no colour in
/// its name).
fn accent_colour(value: &str, lookup: &dyn Fn(&str) -> Option<String>) -> Option<bool> {
    let resolved = resolve_var_refs(value, &|name: &str| lookup(name), 0);
    let resolved = js::trim(&resolved);
    if resolved.is_empty() || NO_PAINT_RE.is_match(resolved) {
        return Some(false);
    }
    if let Some(caps) = VAR_NAME_RE.captures(resolved) {
        return COLOUR_TOKEN_NAME_RE.is_match(&caps[1]).then_some(true);
    }
    let colour = parse_any_color(Some(resolved))
        .or_else(|| find_shadow_color(resolved).and_then(|c| c.color));
    Some(colour.is_some_and(|c| is_accent(&c)))
}

/// OKLCH chroma a row stripe needs: a status colour (red, green, amber, a
/// brand blue) sits well above it, a slate divider (`#2e3d54`, about 0.04)
/// below, though its channels spread past the card scans' 30.
pub const MIN_ROW_STRIPE_CHROMA: f64 = 0.07;

/// Whether a colour reads as an accent on a row: visible, and coloured
/// rather than a tinted grey.
pub fn is_row_stripe_accent(c: &Rgba) -> bool {
    c.alpha_or_one() >= 0.1
        && js::math_max3(c.r, c.g, c.b) - js::math_min3(c.r, c.g, c.b) >= 30.0
        && rgb_to_oklch_lc(c).1 >= MIN_ROW_STRIPE_CHROMA
}

fn is_accent(c: &Rgba) -> bool {
    is_row_stripe_accent(c)
}

fn in_band(px: f64) -> bool {
    (MIN_PX..=MAX_PX).contains(&px)
}

/// An inset box-shadow layer that is a stripe down the left or right edge:
/// `(thickness, edge)`.
fn inset_stripe(
    value: &str,
    lookup: &dyn Fn(&str) -> Option<String>,
) -> Option<(f64, &'static str)> {
    for layer in split_commas_outside_parens(value) {
        let layer = js::trim(layer);
        if !INSET_WORD_RE.is_match(layer) {
            continue;
        }
        let layer = resolve_var_refs(layer, &|name: &str| lookup(name), 0);
        let (colour, lengths) = match VAR_NAME_RE.find(&layer) {
            Some(var) => (
                accent_colour(var.as_str(), lookup),
                extract_shadow_lengths(&layer, Some((var.start(), var.end()))),
            ),
            None => match find_shadow_color(&layer) {
                Some(info) => (
                    Some(info.color.is_some_and(|c| is_accent(&c))),
                    extract_shadow_lengths(&layer, Some((info.start, info.end))),
                ),
                None => continue,
            },
        };
        if colour != Some(true) || lengths.len() < 2 {
            continue;
        }
        let at = |i: usize| lengths.get(i).copied().filter(|v| v.is_finite()).unwrap_or(0.0);
        let (x, y, blur, spread) = (at(0), at(1), at(2), at(3));
        if y != 0.0 || blur != 0.0 || spread != 0.0 || !in_band(x.abs()) {
            continue;
        }
        return Some((x.abs(), if x > 0.0 { "left" } else { "right" }));
    }
    None
}

/// One side's border as the rule leaves it.
#[derive(Clone)]
struct BorderSide {
    width: f64,
    styled: bool,
    colour: String,
    /// Whether an `!important` declaration set the width, style or colour:
    /// a later declaration without it does not change that part.
    important: [bool; 3],
    /// The single-side property that last set it (`border-left`), for the
    /// finding's wording.
    named: Option<&'static str>,
}

impl BorderSide {
    /// The initial border: medium, no style, the text colour.
    fn initial() -> Self {
        BorderSide {
            width: 3.0,
            styled: false,
            colour: "currentcolor".to_string(),
            important: [false; 3],
            named: None,
        }
    }
    /// Sets the width (0), style (1) or colour (2) when a declaration of
    /// this priority wins over the one that set it last.
    fn set(&mut self, part: usize, important: bool, apply: impl FnOnce(&mut Self)) -> bool {
        if self.important[part] && !important {
            return false;
        }
        apply(self);
        self.important[part] = important;
        true
    }
    fn visible(&self) -> bool {
        self.styled
            && self.width > 0.0
            && !matches!(js::to_lower_case(&self.colour).as_str(), "transparent" | "none")
    }
}

/// A border width: a length, `0`, or a keyword.
fn border_width_px(token: &str) -> Option<f64> {
    match js::to_lower_case(token).as_str() {
        "0" => Some(0.0),
        "thin" => Some(1.0),
        "medium" => Some(3.0),
        "thick" => Some(5.0),
        _ => css_length_to_px(token),
    }
}

/// The value a box shorthand (`border-width: 0 0 0 3px`) gives one side.
fn box_value<'a>(values: &[&'a str], family_sides: &[usize], side: usize) -> Option<&'a str> {
    let n = values.len();
    if n == 0 {
        return None;
    }
    if family_sides.len() == 4 {
        let i = match (n, side) {
            (1, _) => 0,
            (2, 0 | 2) | (3, 0) => 0,
            (2, _) | (3, 1 | 3) | (4, 1) => 1,
            (3, 2) | (4, 2) => 2,
            (4, 3) => 3,
            _ => 0,
        };
        return values.get(i).copied();
    }
    let at = family_sides.iter().position(|s| *s == side)?;
    values.get(at.min(n - 1)).copied()
}

/// A rule's declarations as its own cascade leaves them: a later
/// declaration wins unless an earlier one is `!important`.
fn cascade_decl_block(block: &str) -> DeclMap {
    let mut decls = DeclMap::new();
    let mut important: Vec<String> = Vec::new();
    for part in block.split(';') {
        let Some((prop, value)) = part.split_once(':') else { continue };
        let prop = js::to_lower_case(js::trim(prop));
        let priority = IMPORTANT_RE.is_match(js::trim(value));
        let value = IMPORTANT_RE.replace(js::trim(value), "").into_owned();
        if prop.is_empty() || value.is_empty() || (!priority && important.contains(&prop)) {
            continue;
        }
        if priority {
            important.push(prop.clone());
        }
        decls.set(&prop, value);
    }
    decls
}

/// A side border that is a stripe: `(property, thickness, edge, alone)`,
/// `alone` when no other side is drawn. `block` is the rule's declarations
/// as written: a later declaration wins unless an earlier one is
/// `!important`, so a shared `border-style: none` after the side border
/// hides it, and a reset before it does not. A box drawn top and bottom too
/// is a frame.
fn border_stripe(
    block: &str,
    lookup: &dyn Fn(&str) -> Option<String>,
) -> Option<(&'static str, f64, &'static str, bool)> {
    let mut sides = [BorderSide::initial(), BorderSide::initial(), BorderSide::initial(), BorderSide::initial()];
    for part in block.split(';') {
        let Some((prop, value)) = part.split_once(':') else { continue };
        let prop = js::to_lower_case(js::trim(prop));
        let Some(&(family, family_sides)) = BORDER_FAMILIES.iter().find(|(f, _)| {
            prop.strip_prefix(f).is_some_and(|rest| matches!(rest, "" | "-width" | "-style" | "-color"))
        }) else {
            continue;
        };
        let important = IMPORTANT_RE.is_match(js::trim(value));
        let value = IMPORTANT_RE.replace(js::trim(value), "").into_owned();
        let value = resolve_var_refs(&value, &|name: &str| lookup(name), 0);
        let tokens = split_ws_outside_parens(js::trim(&value));
        let single = family_sides.len() == 1;
        for &side in family_sides {
            let s = &mut sides[side];
            let set_any = match &prop[family.len()..] {
                "" => {
                    // A shorthand resets each part it does not name.
                    let mut next = BorderSide::initial();
                    for &token in &tokens {
                        if BORDER_STYLE_RE.is_match(token) {
                            next.styled = true;
                        } else if BORDER_STYLE_NONE_RE.is_match(token) {
                            next.styled = false;
                        } else if let Some(px) = border_width_px(token) {
                            next.width = px;
                        } else {
                            next.colour = token.to_string();
                        }
                    }
                    let width = s.set(0, important, |s| s.width = next.width);
                    let style = s.set(1, important, |s| s.styled = next.styled);
                    let colour = s.set(2, important, |s| s.colour = next.colour);
                    width || style || colour
                }
                rest => {
                    let Some(v) = box_value(&tokens, family_sides, side) else { continue };
                    match rest {
                        "-width" => s.set(0, important, |s| s.width = border_width_px(v).unwrap_or(s.width)),
                        "-style" => s.set(1, important, |s| s.styled = BORDER_STYLE_RE.is_match(v)),
                        _ => s.set(2, important, |s| s.colour = v.to_string()),
                    }
                }
            };
            if !set_any {
                continue;
            }
            if single {
                s.named = Some(family);
            } else if prop[family.len()..].is_empty() {
                s.named = None;
            }
        }
    }
    if sides[0].visible() && sides[2].visible() {
        return None;
    }
    for (side, edge, fallback) in [(3, "left", "border-left"), (1, "right", "border-right")] {
        let s = &sides[side];
        if s.visible() && in_band(s.width) && accent_colour(&s.colour, lookup) == Some(true) {
            let alone = (0..4).all(|other| other == side || !sides[other].visible());
            return Some((s.named.unwrap_or(fallback), s.width, edge, alone));
        }
    }
    None
}

/// Whether a `border-radius` value rounds anything: every radius `0` is
/// square, anything else (or unreadable) is rounded.
fn rounds(value: &str) -> bool {
    !value
        .split(|c: char| c.is_whitespace() || c == '/')
        .filter(|t| !t.is_empty())
        .all(|t| matches!(t, "0" | "0%") || css_length_to_px(t) == Some(0.0))
}

fn split_ws_outside_parens(value: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut depth = 0i32;
    let mut start = None;
    for (i, c) in value.char_indices() {
        match c {
            '(' => depth += 1,
            ')' => depth -= 1,
            _ => {}
        }
        if c.is_whitespace() && depth <= 0 {
            if let Some(s) = start.take() {
                out.push(&value[s..i]);
            }
        } else if start.is_none() {
            start = Some(i);
        }
    }
    if let Some(s) = start {
        out.push(&value[s..]);
    }
    out
}

/// Every rule in `content` that draws a side stripe on a status row or cell.
/// `tokens` are custom properties declared elsewhere in the project; the
/// sheet's own declarations win over them. `index` is the byte offset of the
/// rule's selector in `content`.
pub fn scan_css_text_for_row_stripe(content: &str, tokens: Option<&CustomProps>) -> Vec<PatternFinding> {
    if !content.contains("inset") && !content.contains("border-") {
        return Vec::new();
    }
    // Comments blanked byte for byte, so offsets index `content`.
    let text = COMMENT_RE.replace_all(content, |m: &regex::Captures| {
        m[0].bytes().map(|b| if b == b'\n' { '\n' } else { ' ' }).collect::<String>()
    });
    let own = collect_css_custom_props(&text);
    let lookup = |name: &str| -> Option<String> {
        own.get(name).or_else(|| tokens.and_then(|t| t.get(name))).cloned()
    };
    let mut findings = Vec::new();
    for m in RULE_RE.captures_iter(&text) {
        let raw = m.get(1).unwrap();
        let selector = js::trim(raw.as_str());
        if selector.is_empty() || selector.starts_with('@') {
            continue;
        }
        // Each selector of a list on its own: a hover branch beside a
        // status branch leaves the status branch.
        let kept: Vec<&str> = split_commas_outside_parens(selector)
            .into_iter()
            .map(js::trim)
            .filter(|part| {
                part_is_row_or_cell(part) && !selector_is_state_indicator(part) && !SELECTION_ATTR_RE.is_match(part)
            })
            .collect();
        if kept.is_empty() {
            continue;
        }
        let decls = cascade_decl_block(&m[2]);
        if decls
            .get("width")
            .and_then(|w| css_length_to_px(&resolve_var_refs(w, &lookup, 0)))
            .is_some_and(|w| w <= 40.0)
        {
            continue;
        }
        // A rounded row named only by class is a card, and the card scans
        // read it; a table or ARIA row or cell stays a row.
        let kept: Vec<&str> = if decls.iter().any(|(p, v)| p.contains("radius") && rounds(js::trim(v))) {
            kept.into_iter().filter(|part| part_is_table_or_aria_row(part)).collect()
        } else {
            kept
        };
        if kept.is_empty() {
            continue;
        }
        // The stripe, and whether the rule paints nothing else.
        let (detail, stripe_only) = if let Some((px, edge)) = decls
            .get("box-shadow")
            .and_then(|v| inset_stripe(v, &lookup))
        {
            let only = decls.iter().all(|(p, v)| !paints(p, v) || p == "box-shadow" || p.starts_with("box-shadow-"));
            (format!("inset box-shadow {}px stripe on a row or cell ({edge} edge)", number_to_string(px)), only)
        } else if let Some((prop, px, edge, alone)) = border_stripe(&m[2], &lookup) {
            // Every side was resolved: a border declaration is part of the
            // stripe when no other side is drawn.
            let only = alone && decls.iter().all(|(p, v)| !paints(p, v) || p.starts_with("border"));
            (format!("{prop} {}px stripe on a row or cell ({edge} edge)", number_to_string(px)), only)
        } else {
            continue;
        };
        // A rule that paints more than the stripe reports for the branches
        // about a state only.
        let kept: Vec<&str> = kept.into_iter().filter(|part| stripe_only || selector_has_status_marker(part)).collect();
        if kept.is_empty() {
            continue;
        }
        let selector = collapse(&kept.join(", "));
        let snippet = format!("{selector} — {detail}");
        let leading = raw.as_str().len() - js::trim_start(raw.as_str()).len();
        findings.push(PatternFinding {
            id: "side-tab".to_string(),
            snippet,
            selector: Some(selector),
            index: Some(raw.start() + leading),
            severity: None,
        });
    }
    findings
}

fn collapse(selector: &str) -> String {
    selector.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snippets(css: &str) -> Vec<String> {
        scan_css_text_for_row_stripe(css, None).into_iter().map(|f| f.snippet).collect()
    }

    #[test]
    fn a_stripe_on_a_status_row_or_cell_is_a_side_tab() {
        for css in [
            "tr.is-broken > td:first-child { box-shadow: inset 3px 0 0 #d0342c; }",
            ".cell { box-shadow: inset 3px 0 0 red; }",
            "tr[data-state=failed] td:first-child { border-left: 3px solid #d0342c; }",
            ".grid [role=row].has-error { box-shadow: inset -4px 0 0 oklch(63% .23 27); }",
            ".table__row--new { border-inline-start: 2px solid #16a34a; padding: 4px; }",
            ":root { --mark: #d0342c; } tr.is-x td:first-child { box-shadow: inset 3px 0 0 var(--mark); }",
            "tr.is-x td { box-shadow: inset 3px 0 0 var(--color-danger); }",
            // A reset beside the stripe paints nothing of its own.
            "td { box-shadow: inset 3px 0 0 #d0342c; background: none; border: 0; }",
            // A shared style reset before the side border does not hide it.
            "td.is-x { border-style: none; border-left: 3px solid #d0342c; }",
            ".row:is(.x) { box-shadow: inset 3px 0 0 red; }",
            // A priority marker, a shared colour, a zero reset, a square radius.
            "td.is-x { border-left: 3px solid #d0342c !important; }",
            "td.is-x { border-color: #d0342c; border-left-width: 3px; border-left-style: solid; }",
            "td.is-x { border: 0 solid; border-left: 3px solid #d0342c; }",
            "td.is-x { box-shadow: inset 3px 0 0 #d0342c; border-radius: 0; }",
            // A hover branch beside a status branch leaves the status branch.
            "tr.is-error td, tr:hover td { box-shadow: inset 3px 0 0 red; }",
            // An important side border outlasts a later shared reset.
            "td.is-x { border-left: 3px solid #d0342c !important; border-style: none; }",
            "td.is-x { box-shadow: inset 3px 0 0 #d0342c !important; box-shadow: none; }",
            // A shared colour paints only the side the stripe draws.
            ".cell { border-color: #d0342c; border-left-width: 3px; border-left-style: solid; }",
            // A plain branch beside a status branch leaves the status branch.
            "tr.is-error td, td.amount { box-shadow: inset 3px 0 0 red; background: #fff; }",
            // A table or ARIA cell is a row whatever its corners.
            "td.is-error { box-shadow: inset 3px 0 0 red; border-radius: 4px; }",
            ".grid [role=row].has-error { border-left: 3px solid #d0342c; border-radius: 6px; }",
        ] {
            assert_eq!(snippets(css).len(), 1, "{css}");
        }
        assert_eq!(
            snippets("tr.is-broken > td:first-child { box-shadow: inset 3px 0 0 #d0342c; }"),
            vec!["tr.is-broken > td:first-child — inset box-shadow 3px stripe on a row or cell (left edge)"]
        );
        assert_eq!(
            scan_css_text_for_row_stripe("tr.is-error td, tr:hover td { box-shadow: inset 3px 0 0 red; }", None)[0]
                .selector
                .as_deref(),
            Some("tr.is-error td")
        );
        assert_eq!(
            scan_css_text_for_row_stripe("tr.is-error td, td.amount { box-shadow: inset 3px 0 0 red; background: #fff; }", None)[0]
                .selector
                .as_deref(),
            Some("tr.is-error td")
        );
    }

    #[test]
    fn rows_and_cells_that_are_not_a_side_tab_stay_silent() {
        for css in [
            // Selection and hover indicators.
            "tr.is-selected td:first-child { box-shadow: inset 3px 0 0 #2563eb; }",
            "tr:hover td:first-child { box-shadow: inset 3px 0 0 #2563eb; }",
            "tr[aria-current] td { box-shadow: inset 3px 0 0 #2563eb; }",
            "tr[data-state=\"selected\"] td { box-shadow: inset 3px 0 0 #2563eb; }",
            "[role=row][data-state='active'] { box-shadow: inset 3px 0 0 #2563eb; }",
            // Neutral, transparent, faint or unresolved-and-unnamed colours.
            "tr.is-x td { box-shadow: inset 3px 0 0 #e5e7eb; }",
            ".vital-cell { border-left: 2px solid #2e3d54; padding-left: 18px; }",
            "tr.is-x td { box-shadow: inset 3px 0 0 transparent; }",
            "tr.is-x td { box-shadow: inset 3px 0 0 rgba(220, 38, 38, .05); }",
            "tr.is-x td { box-shadow: inset 3px 0 0 var(--line); }",
            ":root { --line: #ddd; } tr.is-x td { box-shadow: inset 3px 0 0 var(--line); }",
            // A divider, a sticky-column shadow, a header underline, a glow.
            "td + td { box-shadow: inset 1px 0 0 #d0342c; }",
            "td.is-sticky { box-shadow: inset -8px 0 8px -8px rgba(0,0,0,.2); }",
            "th.is-sorted { box-shadow: inset 0 -3px 0 #2563eb; }",
            "tr.is-x td { box-shadow: inset 3px 0 6px #d0342c; }",
            // A plain cell that paints more than the stripe, a frame all round,
            // a table, a card.
            "td { box-shadow: inset 3px 0 0 #d0342c; background: #fff; }",
            "td.is-x { border: 3px solid #d0342c; }",
            "table.is-x { box-shadow: inset 3px 0 0 #d0342c; }",
            ".card.is-x { box-shadow: inset 3px 0 0 #d0342c; }",
            // A rounded row-like card is the card scans' to read.
            ".row-card.is-x { box-shadow: inset 3px 0 0 #d0342c; border-radius: 8px; }",
            // A thick band is not a stripe.
            "tr.is-x td { border-left: 12px solid #d0342c; }",
            "/* tr.is-x td { box-shadow: inset 3px 0 0 #d0342c; } */",
            // A row named only inside a functional pseudo-class.
            ".panel:not(.row) { box-shadow: inset 3px 0 0 red; }",
            ".pane:has(.row) { box-shadow: inset 3px 0 0 red; }",
            ".pane:has(> td) { box-shadow: inset 3px 0 0 red; }",
            // Layout utilities named for a row are not rows.
            ".flex-row { box-shadow: inset 3px 0 0 red; }",
            ".grid-row.is-x { box-shadow: inset 3px 0 0 red; }",
            ".row-span-2 { border-left: 3px solid red; }",
            // A shared border-style after the side border hides it.
            "td.is-x { border-left: 3px solid #d0342c; border-style: none; }",
            "td.is-x { border-left-width: 3px; border-left-color: #d0342c; }",
            // An important shared reset outlasts a later side border.
            "td.is-x { border-style: none !important; border-left: 3px solid #d0342c; }",
            "td.is-x { border-left-style: none !important; border-left: 3px solid #d0342c; }",
            // An important `none` outlasts a later shadow, an important
            // background a later reset.
            "td.is-x { box-shadow: none !important; box-shadow: inset 3px 0 0 #d0342c; }",
            "td { box-shadow: inset 3px 0 0 #d0342c; background: #fff !important; background: none; }",
            // A plain cell edged on the other side too paints more than the stripe.
            ".cell { border-left: 3px solid #d0342c; border-right: 1px solid #ccc; }",
            "td { border-left: 3px solid #d0342c; border-inline-end: 1px solid #ccc; }",
            // A frame drawn top and bottom too.
            "td.is-x { border-width: 1px; border-style: solid; border-color: #ccc; border-left: 3px solid #d0342c; }",
            // A pseudo-element is a box of its own.
            "td.is-x::before { content: ''; width: 100px; border-left: 3px solid #d0342c; }",
            "td.is-x:after { content: ''; width: 100px; box-shadow: inset 3px 0 0 #d0342c; }",
        ] {
            assert_eq!(snippets(css), Vec::<String>::new(), "{css}");
        }
    }

    #[test]
    fn project_tokens_resolve_a_colour_the_sheet_does_not_declare() {
        let css = "tr.is-x td:first-child { box-shadow: inset 3px 0 0 var(--pr-mark); }";
        assert!(scan_css_text_for_row_stripe(css, None).is_empty());
        let mut tokens = CustomProps::new();
        tokens.set("--pr-mark", "oklch(63% .23 27)".to_string());
        assert_eq!(scan_css_text_for_row_stripe(css, Some(&tokens)).len(), 1);
        tokens.set("--pr-line", "#e5e7eb".to_string());
        let neutral = "tr.is-x td { box-shadow: inset 3px 0 0 var(--pr-line); }";
        assert!(scan_css_text_for_row_stripe(neutral, Some(&tokens)).is_empty());
        // The sheet's own declaration wins over the project's.
        let own = format!(":root {{ --pr-mark: #ccc; }} {css}");
        assert!(scan_css_text_for_row_stripe(&own, Some(&tokens)).is_empty());
    }
}
