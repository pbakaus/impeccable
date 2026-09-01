//! Selector engine for the static DOM: the `selectors` crate parser and
//! matcher over the html5ever tree, configured to observe css-select's
//! pseudo-class surface (what the JS engine sees through `css-select`):
//!
//! - tree-structural pseudos (`:root`, `:empty`, `:first-child`, `:nth-*`,
//!   `:not`, `:is`/`:where`/`:matches`, `:has`, `:scope`) parse natively;
//! - `:hover` / `:active` / `:visited` parse and never match (css-select's
//!   `dynamicStatePseudo` with no adapter hook is `falseFunc`);
//! - css-select's alias pseudos (`:link`, `:any-link`, `:disabled`,
//!   `:enabled`, `:checked`, `:required`, `:optional`, `:read-only`,
//!   `:read-write`, `:selected`, `:checkbox`, `:file`, `:password`,
//!   `:radio`, `:reset`, `:image`, `:submit`, `:parent`, `:header`,
//!   `:button`, `:input`, `:text`) match through the alias selector text;
//! - `:contains()` / `:icontains()` / `:lang()` are supported;
//! - anything else (`:focus`, `:target`, `::before`, `::placeholder`, ...)
//!   is a parse error, exactly where css-select throws, so the callers skip
//!   the rule the same way `try { selectAll } catch {}` does in JS.
//!
//! Selector parse errors are recorded by the callers (see
//! `StaticDocument::unsupported_selectors`) for the parity report.

use cssparser::{match_ignore_ascii_case, CowRcStr, Parser as CssParser, SourceLocation, ToCss};
use ego_tree::NodeRef;
use html5ever::Namespace;
use scraper::selector::{CssLocalName, CssString};
use scraper::Node;
use selectors::attr::{AttrSelectorOperation, CaseSensitivity, NamespaceConstraint};
use selectors::bloom::BloomFilter;
use selectors::context::MatchingContext;
use selectors::parser::{
    self, NonTSPseudoClass as NonTSPseudoClassTrait, ParseRelative,
    PseudoElement as PseudoElementTrait, SelectorList, SelectorParseErrorKind,
};
use selectors::{matching, Element, OpaqueElement};
use std::cell::RefCell;
use std::collections::HashMap;
use std::fmt;

/// The `SelectorImpl` of the static engine.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Impl;

impl parser::SelectorImpl for Impl {
    type AttrValue = CssString;
    type Identifier = CssLocalName;
    type LocalName = CssLocalName;
    type NamespacePrefix = CssLocalName;
    type NamespaceUrl = Namespace;
    type BorrowedNamespaceUrl = Namespace;
    type BorrowedLocalName = CssLocalName;
    type NonTSPseudoClass = PseudoClass;
    type PseudoElement = PseudoElement;
    type ExtraMatchingData<'a> = ();
}

/// css-select's `textControl` alias fragment.
const TEXT_CONTROL: &str = "input:is([type=text i],[type=search i],[type=url i],[type=tel i],[type=email i],[type=password i],[type=date i],[type=month i],[type=week i],[type=time i],[type=datetime-local i],[type=number i])";

/// css-select `aliases` (pseudo-selectors/aliases.js), name -> selector.
/// `:text`'s `[type!='']` (a css-what extension) is spelled as the
/// equivalent `[type=""]`.
fn alias_selector(name: &str) -> Option<String> {
    let s = match name {
        "any-link" => ":is(a, area, link)[href]".to_string(),
        "link" => ":any-link:not(:visited)".to_string(),
        "disabled" => ":is(:is(button, input, select, textarea, optgroup, option)[disabled], optgroup[disabled] > option, fieldset[disabled]:not(fieldset[disabled] legend:first-of-type *))".to_string(),
        "enabled" => ":is(button, input, select, textarea, optgroup, option, fieldset):not(:disabled)".to_string(),
        "checked" => ":is(:is(input[type=radio], input[type=checkbox])[checked], :selected)".to_string(),
        "required" => ":is(input, select, textarea)[required]".to_string(),
        "optional" => ":is(input, select, textarea):not([required])".to_string(),
        "read-only" => format!("[readonly]:is(textarea, {TEXT_CONTROL})"),
        "read-write" => format!(":not([readonly]):is(textarea, {TEXT_CONTROL})"),
        "selected" => "option:is([selected], select:not([multiple]):not(:has(> option[selected])) > :first-of-type)".to_string(),
        "checkbox" => "[type=checkbox]".to_string(),
        "file" => "[type=file]".to_string(),
        "password" => "[type=password]".to_string(),
        "radio" => "[type=radio]".to_string(),
        "reset" => "[type=reset]".to_string(),
        "image" => "[type=image]".to_string(),
        "submit" => "[type=submit]".to_string(),
        "parent" => ":not(:empty)".to_string(),
        "header" => ":is(h1, h2, h3, h4, h5, h6)".to_string(),
        "button" => ":is(button, input[type=button])".to_string(),
        "input" => ":is(input, textarea, select, button)".to_string(),
        "text" => "input:is([type=\"\"], [type=text])".to_string(),
        _ => return None,
    };
    Some(s)
}

/// Non-tree-structural pseudo-classes css-select understands.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PseudoClass {
    /// `:hover` / `:active` / `:visited`: parse, never match.
    Dynamic(&'static str),
    /// A css-select alias, matched through its selector text.
    Alias(&'static str),
    Contains(String),
    IContains(String),
    Lang(String),
}

impl NonTSPseudoClassTrait for PseudoClass {
    type Impl = Impl;
    fn is_active_or_hover(&self) -> bool {
        matches!(
            self,
            PseudoClass::Dynamic("hover") | PseudoClass::Dynamic("active")
        )
    }
    fn is_user_action_state(&self) -> bool {
        matches!(self, PseudoClass::Dynamic(_))
    }
}

impl ToCss for PseudoClass {
    fn to_css<W: fmt::Write>(&self, dest: &mut W) -> fmt::Result {
        match self {
            PseudoClass::Dynamic(n) | PseudoClass::Alias(n) => write!(dest, ":{}", n),
            PseudoClass::Contains(s) => write!(dest, ":contains({})", s),
            PseudoClass::IContains(s) => write!(dest, ":icontains({})", s),
            PseudoClass::Lang(s) => write!(dest, ":lang({})", s),
        }
    }
}

/// Pseudo-elements are never parsed (css-select throws on them).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PseudoElement {}

impl PseudoElementTrait for PseudoElement {
    type Impl = Impl;
}

impl ToCss for PseudoElement {
    fn to_css<W: fmt::Write>(&self, dest: &mut W) -> fmt::Result {
        dest.write_str("")
    }
}

const ALIAS_NAMES: &[&str] = &[
    "any-link",
    "link",
    "disabled",
    "enabled",
    "checked",
    "required",
    "optional",
    "read-only",
    "read-write",
    "selected",
    "checkbox",
    "file",
    "password",
    "radio",
    "reset",
    "image",
    "submit",
    "parent",
    "header",
    "button",
    "input",
    "text",
];

struct SelParser;

impl<'i> parser::Parser<'i> for SelParser {
    type Impl = Impl;
    type Error = SelectorParseErrorKind<'i>;

    fn parse_is_and_where(&self) -> bool {
        true
    }
    fn parse_has(&self) -> bool {
        true
    }
    fn is_is_alias(&self, name: &str) -> bool {
        name.eq_ignore_ascii_case("matches")
    }
    /// css-select throws on any invalid selector inside `:is()` / `:has()`.
    fn allow_forgiving_selectors(&self) -> bool {
        false
    }

    fn parse_non_ts_pseudo_class(
        &self,
        location: SourceLocation,
        name: CowRcStr<'i>,
    ) -> Result<PseudoClass, cssparser::ParseError<'i, Self::Error>> {
        let lower = name.to_ascii_lowercase();
        match lower.as_str() {
            "hover" => return Ok(PseudoClass::Dynamic("hover")),
            "active" => return Ok(PseudoClass::Dynamic("active")),
            "visited" => return Ok(PseudoClass::Dynamic("visited")),
            _ => {}
        }
        if let Some(n) = ALIAS_NAMES.iter().find(|n| **n == lower) {
            return Ok(PseudoClass::Alias(n));
        }
        Err(
            location.new_custom_error(SelectorParseErrorKind::UnsupportedPseudoClassOrElement(
                name,
            )),
        )
    }

    fn parse_non_ts_functional_pseudo_class<'t>(
        &self,
        name: CowRcStr<'i>,
        parser: &mut CssParser<'i, 't>,
        _after_part: bool,
    ) -> Result<PseudoClass, cssparser::ParseError<'i, Self::Error>> {
        match_ignore_ascii_case! { &name,
            "contains" | "icontains" => {
                let start = parser.position();
                while parser.next_including_whitespace().is_ok() {}
                let raw = parser.slice_from(start).trim();
                // css-what strips one layer of matching quotes.
                let text = if raw.len() >= 2
                    && ((raw.starts_with('"') && raw.ends_with('"'))
                        || (raw.starts_with('\'') && raw.ends_with('\'')))
                {
                    raw[1..raw.len() - 1].to_string()
                } else {
                    raw.to_string()
                };
                if name.eq_ignore_ascii_case("contains") {
                    return Ok(PseudoClass::Contains(text));
                }
                return Ok(PseudoClass::IContains(text.to_lowercase()));
            },
            "lang" => {
                let lang = parser.expect_ident_or_string()?.as_ref().to_owned();
                return Ok(PseudoClass::Lang(lang));
            },
            _ => {}
        }
        Err(
            parser.new_custom_error(SelectorParseErrorKind::UnsupportedPseudoClassOrElement(
                name,
            )),
        )
    }
}

/// A parsed selector list.
#[derive(Debug, Clone)]
pub struct Selector {
    list: SelectorList<Impl>,
}

/// A selector that css-select would refuse to compile.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SelectorError(pub String);

impl fmt::Display for SelectorError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "unsupported selector: {}", self.0)
    }
}

impl std::error::Error for SelectorError {}

impl Selector {
    /// Parse a selector group; `Err` where css-select would throw.
    pub fn parse(text: &str) -> Result<Selector, SelectorError> {
        let mut input = cssparser::ParserInput::new(text);
        let mut p = CssParser::new(&mut input);
        SelectorList::parse(&SelParser, &mut p, ParseRelative::No)
            .map(|list| Selector { list })
            .map_err(|_| SelectorError(text.to_string()))
    }

    /// Whether `el` matches any selector in the group.
    pub fn matches(&self, el: &El<'_>) -> bool {
        let mut caches = matching::SelectorCaches::default();
        let mut ctx = MatchingContext::new(
            matching::MatchingMode::Normal,
            None,
            &mut caches,
            matching::QuirksMode::NoQuirks,
            matching::NeedsSelectorFlags::No,
            matching::MatchingForInvalidation::No,
        );
        matching::matches_selector_list(&self.list, el, &mut ctx)
    }
}

thread_local! {
    static ALIAS_CACHE: RefCell<HashMap<&'static str, Option<Selector>>> = RefCell::new(HashMap::new());
}

fn with_alias<R>(name: &'static str, f: impl FnOnce(Option<&Selector>) -> R) -> R {
    ALIAS_CACHE.with(|cache| {
        let mut cache = cache.borrow_mut();
        let entry = cache
            .entry(name)
            .or_insert_with(|| alias_selector(name).and_then(|s| Selector::parse(&s).ok()));
        // Clone out so a nested alias lookup can borrow the cache again.
        let sel = entry.clone();
        drop(cache);
        f(sel.as_ref())
    })
}

/// An element handle for selector matching: any element node of the tree.
#[derive(Clone, Copy)]
pub struct El<'a>(pub NodeRef<'a, Node>);

impl fmt::Debug for El<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "El({:?})", self.0.value())
    }
}

impl<'a> El<'a> {
    fn elem(&self) -> &'a scraper::node::Element {
        // Only constructed for element nodes.
        self.0
            .value()
            .as_element()
            .expect("El wraps an element node")
    }

    /// domutils `getText`: text of all descendants (`<br>` reads as `\n`).
    fn get_text(&self) -> String {
        let mut s = String::new();
        for n in self.0.descendants().skip(1) {
            match n.value() {
                Node::Text(t) => s.push_str(&t.text),
                Node::Element(e) if e.name.local.as_ref() == "br" => s.push('\n'),
                _ => {}
            }
        }
        s
    }
}

impl<'a> Element for El<'a> {
    type Impl = Impl;

    fn opaque(&self) -> OpaqueElement {
        OpaqueElement::new(self.0.value())
    }

    fn parent_element(&self) -> Option<Self> {
        self.0.parent().filter(|p| p.value().is_element()).map(El)
    }

    fn parent_node_is_shadow_root(&self) -> bool {
        false
    }

    fn containing_shadow_host(&self) -> Option<Self> {
        None
    }

    fn is_pseudo_element(&self) -> bool {
        false
    }

    fn prev_sibling_element(&self) -> Option<Self> {
        self.0
            .prev_siblings()
            .find(|s| s.value().is_element())
            .map(El)
    }

    fn next_sibling_element(&self) -> Option<Self> {
        self.0
            .next_siblings()
            .find(|s| s.value().is_element())
            .map(El)
    }

    fn first_element_child(&self) -> Option<Self> {
        self.0.children().find(|c| c.value().is_element()).map(El)
    }

    /// Always true: css-select over htmlparser2 has one namespace and
    /// lower-cased tag names, so type and attribute selectors compare in
    /// lower case for SVG content too.
    fn is_html_element_in_html_document(&self) -> bool {
        true
    }

    /// ASCII case-insensitive: htmlparser2 lower-cases every tag name
    /// (`lowerCaseTags`), html5ever keeps SVG names such as `linearGradient`.
    fn has_local_name(&self, name: &CssLocalName) -> bool {
        self.elem().name.local.eq_ignore_ascii_case(&name.0)
    }

    fn has_namespace(&self, namespace: &Namespace) -> bool {
        &self.elem().name.ns == namespace
    }

    fn is_same_type(&self, other: &Self) -> bool {
        self.elem().name == other.elem().name
    }

    fn attr_matches(
        &self,
        ns: &NamespaceConstraint<&Namespace>,
        local_name: &CssLocalName,
        operation: &AttrSelectorOperation<&CssString>,
    ) -> bool {
        self.elem().attrs.iter().any(|(key, value)| {
            !matches!(*ns, NamespaceConstraint::Specific(url) if *url != key.ns)
                && local_name.0 == key.local
                && operation.eval_str(value)
        })
    }

    fn match_non_ts_pseudo_class(
        &self,
        pc: &PseudoClass,
        _context: &mut MatchingContext<'_, Self::Impl>,
    ) -> bool {
        match pc {
            PseudoClass::Dynamic(_) => false,
            PseudoClass::Alias(name) => with_alias(name, |sel| match sel {
                Some(sel) => sel.matches(self),
                None => false,
            }),
            PseudoClass::Contains(text) => self.get_text().contains(text.as_str()),
            PseudoClass::IContains(text) => self.get_text().to_lowercase().contains(text.as_str()),
            PseudoClass::Lang(code) => {
                // css-select `lang`: walk up to the nearest `lang` attribute
                // and compare language ranges (case-insensitive, `*`
                // wildcards). Simplified to prefix matching on subtags.
                let want = code.to_ascii_lowercase();
                let mut cur = Some(*self);
                while let Some(el) = cur {
                    if let Some(v) = el.elem().attr("lang") {
                        let have = v.to_ascii_lowercase();
                        if want.is_empty() {
                            return have.is_empty();
                        }
                        if want == "*" {
                            return !have.is_empty();
                        }
                        return have == want || have.starts_with(&format!("{}-", want));
                    }
                    cur = el.parent_element();
                }
                false
            }
        }
    }

    fn match_pseudo_element(
        &self,
        _pe: &PseudoElement,
        _context: &mut MatchingContext<Self::Impl>,
    ) -> bool {
        false
    }

    fn is_link(&self) -> bool {
        false
    }

    fn is_html_slot_element(&self) -> bool {
        false
    }

    fn has_id(&self, id: &CssLocalName, case_sensitivity: CaseSensitivity) -> bool {
        match self.elem().id() {
            Some(val) => case_sensitivity.eq(id.0.as_bytes(), val.as_bytes()),
            None => false,
        }
    }

    fn has_class(&self, name: &CssLocalName, case_sensitivity: CaseSensitivity) -> bool {
        self.elem().has_class(&name.0, case_sensitivity)
    }

    fn has_custom_state(&self, _name: &CssLocalName) -> bool {
        false
    }

    fn imported_part(&self, _: &CssLocalName) -> Option<CssLocalName> {
        None
    }

    fn is_part(&self, _name: &CssLocalName) -> bool {
        false
    }

    /// css-select `:empty`: no element children and only whitespace text
    /// (` \t\r\n`).
    fn is_empty(&self) -> bool {
        self.0.children().all(|c| match c.value() {
            Node::Element(_) => false,
            Node::Text(t) => t
                .text
                .chars()
                .all(|ch| matches!(ch, ' ' | '\t' | '\r' | '\n')),
            _ => true,
        })
    }

    /// css-select `:root`: the parent is not an element.
    fn is_root(&self) -> bool {
        self.0.parent().is_some_and(|p| !p.value().is_element())
    }

    fn apply_selector_flags(&self, _flags: matching::ElementSelectorFlags) {}

    fn add_element_unique_hashes(&self, _filter: &mut BloomFilter) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use scraper::Html;

    fn first<'a>(html: &'a Html, tag: &str) -> El<'a> {
        let node = html
            .tree
            .root()
            .descendants()
            .find(|n| {
                n.value()
                    .as_element()
                    .is_some_and(|e| e.name.local.as_ref() == tag)
            })
            .unwrap();
        El(node)
    }

    #[test]
    fn pseudo_surface() {
        assert!(Selector::parse("a:hover").is_ok());
        assert!(Selector::parse("a:focus").is_err());
        assert!(Selector::parse("a::before").is_err());
        assert!(Selector::parse("input:disabled").is_ok());
        assert!(Selector::parse(":is(a, :focus)").is_err());
        assert!(Selector::parse("[class*=\"badge\" i]").is_ok());
        assert!(Selector::parse("li:not(:last-child)").is_ok());
        assert!(Selector::parse(":matches(a, b)").is_ok());
        assert!(Selector::parse("p:contains(hello world)").is_ok());
    }

    #[test]
    fn matches_dom() {
        let html = Html::parse_document(
            "<html><body><input type=text disabled><a href=x>y</a><p>hello world</p></body></html>",
        );
        let input = first(&html, "input");
        assert!(Selector::parse(":disabled").unwrap().matches(&input));
        assert!(!Selector::parse(":enabled").unwrap().matches(&input));
        assert!(Selector::parse("input:not(:hover)")
            .unwrap()
            .matches(&input));
        assert!(!Selector::parse("input:hover").unwrap().matches(&input));
        let a = first(&html, "a");
        assert!(Selector::parse(":link").unwrap().matches(&a));
        assert!(Selector::parse("a:any-link").unwrap().matches(&a));
        let p = first(&html, "p");
        assert!(Selector::parse("p:contains(\"lo wo\")")
            .unwrap()
            .matches(&p));
        assert!(Selector::parse("p:icontains(HELLO)").unwrap().matches(&p));
        assert!(Selector::parse("html:root")
            .unwrap()
            .matches(&first(&html, "html")));
        assert!(!Selector::parse(":root").unwrap().matches(&p));
        assert!(Selector::parse("body > p").unwrap().matches(&p));
        assert!(Selector::parse("body:has(> p)")
            .unwrap()
            .matches(&first(&html, "body")));
    }
}
