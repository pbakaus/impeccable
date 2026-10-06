//! Cascade priority, specificity, the specified-declaration store, inline
//! `style=""` parsing, and the stylesheet rule collector.
//!
//! JS: css-cascade.mjs#compareStaticPriority, #staticSpecificity,
//! #applyStaticDeclaration, #parseStaticStyleAttribute,
//! #collectStaticCssRules
//!
//! ## css-tree behaviors `collect_static_css_rules` reproduces
//!
//! The JS hands the stylesheet to css-tree 3.2.1 and reads back
//! `csstree.generate(rule.prelude)` and `csstree.generate(decl.value)`. The
//! port in [`super::csstree`] re-implements the exact subset so the rule list
//! is byte-equal. Behaviors that had to be reproduced:
//!
//! - **Tolerant parsing with Raw fallback.** A rule prelude that fails the
//!   selector grammar becomes `Raw` text up to the `{` (so `} .b{...}` after
//!   a stray brace yields the selector `} .b`); a declaration whose value
//!   fails becomes a Raw *value* (`Raw` value text is emitted verbatim,
//!   e.g. `url(x y.png)`, `@x`, `1..2`, `progid:...`); a declaration that
//!   fails entirely (`b:c !important d`, `color:red !important !important`,
//!   `--y` without colon, nested `.c{d:e}`) becomes a Raw *block child*, which
//!   the JS skips (`child.type !== 'Declaration'`). Recovery consumes tokens
//!   with css-tree's balance table (`skipUntilBalanced`), so a stray `;`
//!   inside parens or a `{...}` block does not end the raw span.
//! - **Selector normalization.** Preludes are regenerated: whitespace around
//!   combinators and commas is dropped (`a > b , c` -> `a>b,c`), a
//!   descendant combinator becomes a single space, `:not( .x , .y )` ->
//!   `:not(.x,.y)`, attribute selectors lose inner spaces and re-quote their
//!   value with double quotes (`[ data-x = 'y' i ]` -> `[data-x="y"i]`), an
//!   `An+B` argument is canonicalized (`2n + 1` -> `2n+1`). Comments inside
//!   selectors vanish. Case is preserved.
//! - **Value normalization** (`parseValue: true`). Values are re-tokenized
//!   and re-emitted with a space only where two tokens would otherwise merge
//!   (css-tree's "safe" `token-before` table): `rgb( 1 , 2 , 3 )` ->
//!   `rgb(1,2,3)`, `a , b` -> `a,b`, `x  y` -> `x y`, `1 / 2` -> `1/2`,
//!   `-1px +2px` -> `-1px+2px`, `1 -2` -> `1-2` but `1 - 2` stays (an
//!   operator keeps the spaces around it), `url(foo.png) no-repeat` ->
//!   `url(foo.png)no-repeat`, `1.2.3` -> `1.2 .3`. Strings are decoded and
//!   re-encoded with double quotes and CSSOM escaping (`'}'` -> `"}"`,
//!   `"\201C"` -> `"\u{201C}"`); `url("x y.png")` -> `url(x\ y.png)`,
//!   `URL(x.png)` -> `url(x.png)`; `var( --x , red )` -> `var(--x, red )`
//!   (the fallback is a raw span). Comments inside values vanish.
//! - **Custom properties** (`parseCustomProperty: false`) keep their raw text
//!   including surrounding whitespace, which the JS then trims.
//! - **`!important`** parses as `true`; another ident (`!ie`) is kept as a
//!   string; the JS coerces both with `!!`. `! important` with a space is
//!   accepted.
//! - **At-rules.** Only `@media`, `@supports`, `@layer` (named or anonymous,
//!   nested to any depth, in any order) are descended; `@keyframes`,
//!   `@font-face`, `@page`, `@container`, `@import` and unknown at-rules are
//!   skipped along with everything inside them. Nested style rules inside a
//!   style rule's block (`a { &:hover {...} }`) are not collected: the JS
//!   only walks top-level and at-rule-nested `Rule` nodes and only reads
//!   `Declaration` children.
//! - **Empty / whitespace-only stylesheets, CDO/CDC (`<!--` `-->`), and
//!   `/*! */` comments** contribute nothing.
//! - Selectors are split on top-level commas of the *generated* prelude
//!   with `splitCssList` (attribute values with commas stay intact) and each
//!   gets its own rule with the same `order`; empty selectors are dropped.
//! - Two css-tree details are intentionally simplified because they cannot
//!   change the output here: at-rule preludes are always consumed as Raw
//!   (see `parser.rs`), and the tokenizer's balance table is computed on a
//!   fresh buffer (css-tree reuses a typed array across parses, which can
//!   only differ for a stray top-level `)`/`]` after an earlier, longer
//!   parse in the same process).

use super::csstree::{self, Important, Node};
use super::shorthand::{
    background_longhands, expand_static_box_values, expand_static_declaration, Expanded,
};
use super::values::split_css_tokens;
use impeccable_common::jsp;
use impeccable_core::js;
use indexmap::IndexMap;
use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::HashMap;
use std::hash::Hash;

/// The cascade metadata carried by a specified declaration
/// (`{ important, specificity, order, inline }`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeclMeta {
    pub important: bool,
    pub specificity: [u32; 3],
    pub order: i64,
    pub inline: bool,
}

/// A winning declaration in the specified store: `{ ...meta, prop, value }`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpecifiedDecl {
    pub meta: DeclMeta,
    pub prop: String,
    pub value: String,
}

/// JS: css-cascade.mjs#compareStaticPriority(a, b)
/// True when `b` should replace the existing `a` (or there is no `a`).
pub fn compare_static_priority(a: Option<&DeclMeta>, b: &DeclMeta) -> bool {
    let Some(a) = a else {
        return true;
    };
    if b.important != a.important {
        return b.important;
    }
    if b.inline != a.inline {
        return b.inline;
    }
    for i in 0..3 {
        if b.specificity[i] != a.specificity[i] {
            return b.specificity[i] > a.specificity[i];
        }
    }
    b.order >= a.order
}

static WHERE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r":where\([^)]*\)").expect("WHERE_RE"));
static ID_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"#[0-9A-Za-z_-]+").expect("ID_RE"));
// JS `:(?!:)[\w-]+`: the lookahead is implied because `[\w-]` excludes `:`.
static CLASS_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\.[0-9A-Za-z_-]+|\[[^\]]+\]|:[0-9A-Za-z_-]+(?:\([^)]*\))?").expect("CLASS_RE")
});
static CLASS_STRIP_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\.[0-9A-Za-z_-]+|\[[^\]]+\]|:{1,2}[0-9A-Za-z_-]+(?:\([^)]*\))?")
        .expect("CLASS_STRIP_RE")
});
static PUNCT_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"[*>+~(),]").expect("PUNCT_RE"));
static TYPE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?-u:\b)[a-zA-Z][0-9A-Za-z_-]*(?-u:\b)").expect("TYPE_RE"));
static BORDER_SIDE_STYLE_PROP_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^border-(top|right|bottom|left)-style$").expect("BORDER_SIDE_STYLE_PROP_RE")
});
static BORDER_SIDE_SHORTHAND_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^border-(top|right|bottom|left)$").expect("BORDER_SIDE_SHORTHAND_RE")
});
static BORDER_STYLE_VALUE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^(?:none|hidden|solid|dashed|dotted|double|groove|ridge|inset|outset)$")
        .expect("BORDER_STYLE_VALUE_RE")
});

fn internal_border_style_expansion(prop: &str, value: &str) -> Vec<(String, String)> {
    let prop = js::to_lower_case(prop);
    let value = js::trim(value);
    let side_names = [
        "borderTopStyle",
        "borderRightStyle",
        "borderBottomStyle",
        "borderLeftStyle",
    ];
    if prop == "border-style" {
        let [top, right, bottom, left] = expand_static_box_values(&split_css_tokens(value));
        return side_names
            .into_iter()
            .zip([top, right, bottom, left])
            .map(|(name, value)| (name.to_string(), value))
            .collect();
    }
    if let Some(captures) = BORDER_SIDE_STYLE_PROP_RE.captures(&prop) {
        let index = match &captures[1] {
            "top" => 0,
            "right" => 1,
            "bottom" => 2,
            _ => 3,
        };
        return vec![(side_names[index].to_string(), value.to_string())];
    }

    let side = if prop == "border" {
        None
    } else if let Some(captures) = BORDER_SIDE_SHORTHAND_RE.captures(&prop) {
        Some(match &captures[1] {
            "top" => 0,
            "right" => 1,
            "bottom" => 2,
            _ => 3,
        })
    } else {
        return Vec::new();
    };
    let tokens = split_css_tokens(value);
    let style = tokens
        .iter()
        .find(|token| BORDER_STYLE_VALUE_RE.is_match(token))
        .or_else(|| tokens.iter().find(|token| token.to_ascii_lowercase().contains("var(")));
    let Some(style) = style else {
        return Vec::new();
    };
    match side {
        Some(index) => vec![(side_names[index].to_string(), style.clone())],
        None => side_names
            .into_iter()
            .map(|name| (name.to_string(), style.clone()))
            .collect(),
    }
}

/// JS: css-cascade.mjs#staticSpecificity(selector) -> [ids, classes, types]
pub fn static_specificity(selector: &str) -> [u32; 3] {
    let no_where = WHERE_RE.replace_all(selector, "");
    let ids = ID_RE.find_iter(&no_where).count() as u32;
    let classes = CLASS_RE.find_iter(&no_where).count() as u32;
    let stripped = ID_RE.replace_all(&no_where, " ");
    let stripped = CLASS_STRIP_RE.replace_all(&stripped, " ");
    let stripped = PUNCT_RE.replace_all(&stripped, " ");
    let types = TYPE_RE.find_iter(&stripped).count() as u32;
    [ids, classes, types]
}

/// The JS `specified` map: node -> (expanded prop -> winning declaration).
/// Generic over the node key so the DOM engine can key it by node id.
#[derive(Debug, Clone)]
pub struct SpecifiedStore<K: Hash + Eq> {
    map: HashMap<K, IndexMap<String, SpecifiedDecl>>,
}

impl<K: Hash + Eq> Default for SpecifiedStore<K> {
    fn default() -> Self {
        SpecifiedStore {
            map: HashMap::new(),
        }
    }
}

impl<K: Hash + Eq> SpecifiedStore<K> {
    pub fn new() -> Self {
        Self::default()
    }
    /// JS `specified.get(node)`: the per-property winners in insertion order.
    pub fn get(&self, node: &K) -> Option<&IndexMap<String, SpecifiedDecl>> {
        self.map.get(node)
    }
    pub fn get_mut(&mut self, node: &K) -> Option<&mut IndexMap<String, SpecifiedDecl>> {
        self.map.get_mut(node)
    }
    pub fn contains(&self, node: &K) -> bool {
        self.map.contains_key(node)
    }
    pub fn len(&self) -> usize {
        self.map.len()
    }
    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }
    pub fn iter(&self) -> impl Iterator<Item = (&K, &IndexMap<String, SpecifiedDecl>)> {
        self.map.iter()
    }
}

/// The alignment values in a `place-*` shorthand, one per axis. An overflow
/// keyword (`safe`, `unsafe`) belongs to the position after it and a
/// `first`/`last` to the `baseline` after it, so `safe center` is one value
/// and, alone, sets both axes.
fn place_alignment_components(tokens: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut pending: Option<String> = None;
    for token in tokens {
        let lower = js::to_lower_case(&token);
        if matches!(lower.as_str(), "safe" | "unsafe" | "first" | "last") {
            pending = Some(match pending.take() {
                Some(p) => format!("{p} {token}"),
                None => token,
            });
            continue;
        }
        out.push(match pending.take() {
            Some(p) => format!("{p} {token}"),
            None => token,
        });
    }
    if let Some(p) = pending {
        out.push(p);
    }
    out
}

#[cfg(test)]
mod place_alignment_tests {
    use super::*;

    fn comps(v: &str) -> Vec<String> {
        place_alignment_components(split_css_tokens(v))
    }

    #[test]
    fn overflow_and_baseline_keywords_join_their_value() {
        assert_eq!(comps("safe center"), vec!["safe center"]);
        assert_eq!(comps("unsafe end safe start"), vec!["unsafe end", "safe start"]);
        assert_eq!(comps("first baseline center"), vec!["first baseline", "center"]);
        assert_eq!(comps("center start"), vec!["center", "start"]);
    }
}

/// Properties the static adapters need that are not in the frozen
/// `expandStaticDeclaration` allowlist: layout for the stripe-child adapter,
/// `text-indent` for the sampled-contrast path. Applied here so the recorded
/// vectors stay byte-equal.
fn extra_specified_expansions(prop: &str, value: &str) -> Vec<Expanded> {
    let p = js::to_lower_case(prop);
    let v = js::trim(value);
    if v.is_empty() {
        return Vec::new();
    }
    match p.as_str() {
        "flex-direction" => vec![("flexDirection".into(), v.to_string())],
        "align-items" => vec![("alignItems".into(), v.to_string())],
        "align-self" => vec![("alignSelf".into(), v.to_string())],
        "justify-content" => vec![("justifyContent".into(), v.to_string())],
        "justify-items" => vec![("justifyItems".into(), v.to_string())],
        // How image-replacement text leaves its box (#560).
        "text-indent" => vec![("textIndent".into(), v.to_string())],
        // `var()` and CSS-wide keywords resolve later, per longhand; the
        // stripe adapter picks the keyword out of the resolved list.
        "flex-flow" | "place-items" | "place-self"
            if js::to_lower_case(v).contains("var(")
                || matches!(
                    js::to_lower_case(v).as_str(),
                    "inherit" | "initial" | "unset" | "revert" | "revert-layer"
                ) =>
        {
            let longhand = match p.as_str() {
                "flex-flow" => "flexDirection",
                "place-items" => "alignItems",
                _ => "alignSelf",
            };
            let mut out: Vec<Expanded> = vec![(longhand.into(), v.to_string())];
            // `place-items` sets both axes; a single var() answers for both.
            if p == "place-items" {
                out.push(("justifyItems".into(), v.to_string()));
            }
            out
        }
        // Shorthands reset what they omit: `flex-flow: wrap` is a row.
        "flex-flow" => {
            let direction = split_css_tokens(v)
                .into_iter()
                .find(|t| {
                    matches!(
                        js::to_lower_case(t).as_str(),
                        "row" | "row-reverse" | "column" | "column-reverse"
                    )
                })
                .unwrap_or_else(|| "row".to_string());
            vec![("flexDirection".into(), direction)]
        }
        // `place-items: <align> [<justify>]`, one value setting both.
        "place-items" => {
            let tokens = place_alignment_components(split_css_tokens(v));
            match tokens.first() {
                Some(align) => {
                    let justify = tokens.get(1).unwrap_or(align).clone();
                    vec![("alignItems".into(), align.clone()), ("justifyItems".into(), justify)]
                }
                None => Vec::new(),
            }
        }
        "place-content" => {
            let tokens = split_css_tokens(v);
            match tokens.get(1).or(tokens.first()) {
                Some(justify) => vec![("justifyContent".into(), justify.clone())],
                None => Vec::new(),
            }
        }
        "place-self" => split_css_tokens(v)
            .into_iter()
            .next()
            .map(|t| vec![("alignSelf".into(), t)])
            .unwrap_or_default(),
        "inset" => {
            let vals = expand_static_box_values(&split_css_tokens(v));
            vec![
                ("top".into(), vals[0].clone()),
                ("right".into(), vals[1].clone()),
                ("bottom".into(), vals[2].clone()),
                ("left".into(), vals[3].clone()),
            ]
        }
        _ => Vec::new(),
    }
}

/// JS: css-cascade.mjs#applyStaticDeclaration(specified, node, prop, value, meta)
pub fn apply_static_declaration<K: Hash + Eq>(
    specified: &mut SpecifiedStore<K>,
    node: K,
    prop: &str,
    value: &str,
    meta: &DeclMeta,
) {
    let map = specified.map.entry(node).or_default();
    let mut expanded = expand_static_declaration(prop, value);
    expanded.extend(expand_border_radius_corners(prop, value));
    expanded.extend(internal_border_style_expansion(prop, value));
    expanded.extend(extra_specified_expansions(prop, value));
    expanded.extend(background_longhands(prop, value));
    for (expanded_prop, expanded_value) in expanded {
        let existing = map.get(&expanded_prop).map(|d| &d.meta);
        if compare_static_priority(existing, meta) {
            let next = SpecifiedDecl {
                meta: meta.clone(),
                prop: expanded_prop.clone(),
                value: expanded_value,
            };
            map.insert(expanded_prop, next);
        }
    }
}

/// The corner longhands a `border-radius` shorthand sets, entered into the
/// specified store beside the shorthand itself (which the recorded
/// `expandStaticDeclaration` still returns alone). Carrying the shorthand's
/// cascade metadata onto each corner is what lets a later
/// `border-top-right-radius: 0` win that corner and a later shorthand reset
/// it. A value built from `var()` cannot be split before it resolves, so each
/// corner carries the whole value, and `resolve_border_radius_corners` picks
/// the corner's own position once the value has resolved.
fn expand_border_radius_corners(prop: &str, value: &str) -> Vec<(String, String)> {
    const CORNERS: [&str; 4] = [
        "borderTopLeftRadius",
        "borderTopRightRadius",
        "borderBottomRightRadius",
        "borderBottomLeftRadius",
    ];
    if js::to_lower_case(prop) != "border-radius" {
        return Vec::new();
    }
    let v = js::trim(value);
    if v.is_empty() {
        return Vec::new();
    }
    let horizontal = v.split('/').next().unwrap_or("");
    let tokens = super::values::split_css_tokens(horizontal);
    if tokens.is_empty() || v.contains("var(") {
        return CORNERS
            .iter()
            .map(|c| (c.to_string(), v.to_string()))
            .collect();
    }
    let vals = super::shorthand::expand_static_box_values(&tokens);
    CORNERS
        .iter()
        .zip(vals)
        .map(|(c, val)| (c.to_string(), val))
        .collect()
}

/// One declaration from a `style=""` attribute.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StyleAttrDecl {
    pub prop: String,
    pub value: String,
    pub important: bool,
    pub order: i64,
}

static IMPORTANT_TAIL_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(r"(?i)!important{ws}*$", ws = js::WS)).expect("IMPORTANT_TAIL_RE")
});
static IMPORTANT_STRIP_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(r"(?i){ws}*!important{ws}*$", ws = js::WS)).expect("IMPORTANT_STRIP_RE")
});

/// JS: css-cascade.mjs#parseStaticStyleAttribute(styleText, orderBase = 0)
pub fn parse_static_style_attribute(style_text: &str, order_base: i64) -> Vec<StyleAttrDecl> {
    let mut decls: Vec<StyleAttrDecl> = Vec::new();
    for part in style_text.split(';') {
        let Some(idx) = part.find(':') else {
            continue;
        };
        if idx == 0 {
            continue;
        }
        let prop = js::trim(&part[..idx]).to_string();
        let mut value = js::trim(&part[idx + 1..]).to_string();
        let important = IMPORTANT_TAIL_RE.is_match(&value);
        value = js::trim(&IMPORTANT_STRIP_RE.replace(&value, "")).to_string();
        let order = order_base + decls.len() as i64;
        decls.push(StyleAttrDecl {
            prop,
            value,
            important,
            order,
        });
    }
    decls
}

/// A declaration inside a collected rule.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuleDecl {
    pub prop: String,
    pub value: String,
    pub important: bool,
}

/// One entry of `collectStaticCssRules`' output.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CssRule {
    pub selector: String,
    pub declarations: Vec<RuleDecl>,
    pub specificity: [u32; 3],
    pub order: i64,
    pub is_hover: bool,
    /// The state-stripped selector for :hover rules (`None` when the rule
    /// is not a hover rule or the stripped selector is unusable).
    pub match_selector: Option<String>,
}

static HOVER_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i):hover(?-u:\b)").expect("HOVER_RE"));
static TRAILING_COMBINATOR_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(r"[>+~]{ws}*$", ws = js::WS)).expect("TRAILING_COMBINATOR_RE")
});

fn is_combinator_or_ws(c: char) -> bool {
    js::is_js_whitespace(c) || c == '>' || c == '+' || c == '~'
}

/// JS `matchSelector.replace(/(^|[\s>+~])(?=$|[\s>+~])/g, '$1*')`, done by
/// hand because the regex crate has no lookahead. Walks the string the way
/// a global replace does: at each position try `^` (only at 0), then one
/// combinator/whitespace char; the lookahead requires end-of-string or a
/// combinator/whitespace char right after group 1. An empty match inserts
/// `*` and advances one char; a one-char match appends `*` after it.
fn star_empty_compounds(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    let n = chars.len();
    let mut out = String::new();
    let mut pos = 0usize;
    let look = |at: usize| -> bool { at >= n || is_combinator_or_ws(chars[at]) };
    while pos <= n {
        if pos == 0 && look(0) {
            // `^` alternative: empty match, replacement is `*`.
            out.push('*');
            if n == 0 {
                break;
            }
            out.push(chars[0]);
            pos = 1;
            continue;
        }
        if pos < n && is_combinator_or_ws(chars[pos]) && look(pos + 1) {
            out.push(chars[pos]);
            out.push('*');
            pos += 1;
            continue;
        }
        if pos < n {
            out.push(chars[pos]);
        }
        pos += 1;
    }
    out
}

/// JS: css-cascade.mjs#collectStaticCssRules(cssText, csstree)
pub fn collect_static_css_rules(css_text: &str) -> Vec<CssRule> {
    collect_static_css_rules_from(css_text, 0, None)
}

/// `collect_static_css_rules` for one stretch of a page's CSS: `order_start`
/// continues the cascade order of the stretches before it, and `url_base`,
/// set for a stylesheet linked from another directory, resolves that sheet's
/// relative `url()`s against the sheet (see [`UrlBase`]).
pub fn collect_static_css_rules_from(
    css_text: &str,
    order_start: i64,
    url_base: Option<&UrlBase>,
) -> Vec<CssRule> {
    let mut rules: Vec<CssRule> = Vec::new();
    let ast = match csstree::parse_stylesheet(css_text) {
        Ok(ast) => ast,
        Err(_) => return rules,
    };
    let mut order: i64 = order_start;
    let Node::StyleSheet { children } = &ast else {
        return rules;
    };
    walk_list(children, &[], &mut rules, &mut order, url_base);
    rules
}

static URL_SCHEME_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^[A-Za-z][A-Za-z0-9+.-]*:").expect("URL_SCHEME_RE"));

/// Where a linked stylesheet lives relative to the page that links it. A
/// relative `url()` in a stylesheet is relative to the sheet, while the
/// cascade keeps one computed style per element with no memory of which
/// sheet a value came from, so the url is restated relative to the page as
/// its declaration is read: on the parsed `Url` node, where css-tree has
/// already decoded it, never on the stylesheet text. The path math is POSIX
/// on both directories, since a CSS url is POSIX on every OS.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UrlBase {
    sheet_dir: String,
    page_dir: String,
}

impl UrlBase {
    pub fn new(sheet_dir: &str, page_dir: &str) -> Self {
        UrlBase {
            sheet_dir: jsp::to_posix(sheet_dir),
            page_dir: jsp::to_posix(page_dir),
        }
    }

    /// `url` restated relative to the page, or `None` when it already means
    /// the same thing from both directories: root-relative, remote, `data:`,
    /// a fragment, or empty.
    fn rebase(&self, url: &str) -> Option<String> {
        let target = js::trim(url);
        if target.is_empty()
            || target.starts_with('#')
            || target.starts_with('/')
            || URL_SCHEME_RE.is_match(target)
        {
            return None;
        }
        let cut = target.find(['?', '#']).unwrap_or(target.len());
        let (path, suffix) = target.split_at(cut);
        let absolute = jsp::posix::resolve("/", &[&self.sheet_dir, path]);
        let relative = jsp::posix::relative("/", &self.page_dir, &absolute);
        if relative.is_empty() || relative == path {
            return None;
        }
        Some(format!("{relative}{suffix}"))
    }
}

/// `node` with every `Url` beneath it rebased, or `None` when nothing in it
/// changes, so the common declaration is generated without a copy. A custom
/// property's value is `Raw` to the stylesheet parse; one that mentions a
/// url is read as a value first, so `--hero: url(../img/hero.jpg)` follows
/// its sheet like any other declaration.
fn rebase_urls(node: &Node, base: &UrlBase) -> Option<Node> {
    let children_of = |children: &[Node]| -> Option<Vec<Node>> {
        let mut out: Option<Vec<Node>> = None;
        for (i, child) in children.iter().enumerate() {
            if let Some(rebased) = rebase_urls(child, base) {
                out.get_or_insert_with(|| children.to_vec())[i] = rebased;
            }
        }
        out
    };
    match node {
        Node::Url { value } => base.rebase(value).map(|value| Node::Url { value }),
        Node::Raw { value } => {
            let mentions_url = value
                .as_bytes()
                .windows(4)
                .any(|window| window.eq_ignore_ascii_case(b"url("));
            if !mentions_url {
                return None;
            }
            rebase_urls(&csstree::parse_value(value).ok()?, base)
        }
        Node::Value { children } => children_of(children).map(|children| Node::Value { children }),
        Node::Parentheses { children } => {
            children_of(children).map(|children| Node::Parentheses { children })
        }
        Node::Brackets { children } => {
            children_of(children).map(|children| Node::Brackets { children })
        }
        Node::Function { name, children } => children_of(children).map(|children| Node::Function {
            name: name.clone(),
            children,
        }),
        _ => None,
    }
}

fn walk_list(
    list: &[Node],
    at_rule_stack: &[String],
    rules: &mut Vec<CssRule>,
    order: &mut i64,
    url_base: Option<&UrlBase>,
) {
    for node in list {
        match node {
            Node::Rule { prelude, block } => {
                if at_rule_stack
                    .iter()
                    .any(|name| js::to_lower_case(name).ends_with("keyframes"))
                {
                    continue;
                }
                let selector_text = csstree::generate(prelude);
                let selector_text = js::trim(&selector_text);
                let mut declarations: Vec<RuleDecl> = Vec::new();
                if let Node::Block { children } = &**block {
                    for child in children {
                        if let Node::Declaration {
                            important,
                            property,
                            value,
                        } = child
                        {
                            let rebased = url_base.and_then(|base| rebase_urls(value, base));
                            let generated = csstree::generate(rebased.as_ref().unwrap_or(value));
                            declarations.push(RuleDecl {
                                prop: property.clone(),
                                value: js::trim(&generated).to_string(),
                                important: matches!(
                                    important,
                                    Important::Yes | Important::Other(_)
                                ),
                            });
                        }
                    }
                }
                for selector in super::values::split_css_list(selector_text) {
                    if selector.is_empty() {
                        continue;
                    }
                    // :hover rules can't be matched statically as-is (no
                    // interaction state), but they carry real cascade weight
                    // while hovered. Tag them and record a state-stripped
                    // selector so the hover pass can find their targets;
                    // specificity stays computed from the ORIGINAL selector
                    // (per CSS, :hover counts as a class).
                    let is_hover = HOVER_RE.is_match(&selector);
                    let mut match_selector: Option<String> = None;
                    if is_hover {
                        let stripped = HOVER_RE.replace_all(&selector, "");
                        let stripped = js::trim(&stripped).to_string();
                        if stripped.is_empty() || TRAILING_COMBINATOR_RE.is_match(&stripped) {
                            match_selector = None;
                        } else {
                            match_selector = Some(star_empty_compounds(&stripped));
                        }
                    }
                    let specificity = static_specificity(&selector);
                    rules.push(CssRule {
                        selector,
                        declarations: declarations.clone(),
                        specificity,
                        order: *order,
                        is_hover,
                        match_selector,
                    });
                    *order += 1;
                }
            }
            Node::Atrule {
                name,
                block: Some(block),
                ..
            } => {
                let lower = js::to_lower_case(name);
                if lower == "media" || lower == "supports" || lower == "layer" {
                    if let Node::Block { children } = &**block {
                        let mut stack: Vec<String> = at_rule_stack.to_vec();
                        stack.push(lower);
                        walk_list(children, &stack, rules, order, url_base);
                    }
                }
            }
            _ => {}
        }
    }
}
