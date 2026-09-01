//! A CSS selector engine over a page snapshot, tuned to what Chrome's
//! `querySelector` / `matches` / `closest` accept and match, so the rules
//! (which pass their selectors verbatim, see `dom.rs`) see the same answers
//! whether the probe is the live DOM or a [`super::snapshot::Snapshot`].
//!
//! The parser and matcher are the `selectors` crate (Servo / Firefox's
//! engine); this module supplies the `SelectorImpl` (atoms, the
//! non-tree-structural pseudo-class surface, the pseudo-element surface) and
//! the `Element` view over snapshot nodes. Where `crates/html/src/select.rs`
//! deliberately observes css-select (the JS *static* engine), this one
//! observes the browser:
//!
//! - unknown pseudo-classes and pseudo-elements are parse errors (Chrome
//!   throws `SyntaxError`; the rules read that as [`SelectorError`]);
//! - known pseudo-elements parse and never match in `matches`/`querySelector`;
//! - `::-webkit-*` pseudo-elements parse (Chrome accepts unknown vendor ones);
//! - user-action and form-state pseudo-classes (`:hover`, `:checked`,
//!   `:disabled`, ...) match through the state list the snapshot recorded for
//!   the element (`captureStates` in `browser-bundle/15-snapshot.js`);
//!   `:link` / `:any-link` come from tag + `href`; `:visited` never matches
//!   (Chrome hides it from scripts too);
//! - type and attribute-name matching is ASCII-case-insensitive for HTML
//!   elements and case-sensitive for SVG/MathML, as in an HTML document;
//! - id and class matching follows the document's quirks mode.

use cssparser::{CowRcStr, Parser as CssParser, SourceLocation, ToCss};
use precomputed_hash::PrecomputedHash;
use selectors::attr::{AttrSelectorOperation, CaseSensitivity, NamespaceConstraint};
use selectors::bloom::BloomFilter;
use selectors::context::{
    MatchingContext, MatchingMode, NeedsSelectorFlags, QuirksMode, SelectorCaches,
};
use selectors::matching::{self, MatchingForInvalidation};
use selectors::parser::{
    self, NonTSPseudoClass as NonTSPseudoClassTrait, ParseRelative,
    PseudoElement as PseudoElementTrait, SelectorList, SelectorParseErrorKind,
};
use selectors::{Element, OpaqueElement};
use std::fmt;

use super::snapshot::{Snapshot, NS_XHTML};

/// A string atom for the selector types (attribute values, identifiers,
/// local names, namespaces).
#[derive(Debug, Clone, PartialEq, Eq, Default, Hash)]
pub struct Atom(pub String);

impl<'a> From<&'a str> for Atom {
    fn from(s: &'a str) -> Self {
        Atom(s.to_string())
    }
}
impl AsRef<str> for Atom {
    fn as_ref(&self) -> &str {
        &self.0
    }
}
impl ToCss for Atom {
    fn to_css<W: fmt::Write>(&self, dest: &mut W) -> fmt::Result {
        cssparser::serialize_identifier(&self.0, dest)
    }
}
impl PrecomputedHash for Atom {
    fn precomputed_hash(&self) -> u32 {
        // FNV-1a over the bytes; only used for bloom filtering, which we
        // opt out of anyway.
        let mut h: u32 = 0x811c_9dc5;
        for b in self.0.bytes() {
            h ^= b as u32;
            h = h.wrapping_mul(0x0100_0193);
        }
        h
    }
}

/// Attribute values serialize as strings.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct AttrValue(pub String);
impl<'a> From<&'a str> for AttrValue {
    fn from(s: &'a str) -> Self {
        AttrValue(s.to_string())
    }
}
impl AsRef<str> for AttrValue {
    fn as_ref(&self) -> &str {
        &self.0
    }
}
impl ToCss for AttrValue {
    fn to_css<W: fmt::Write>(&self, dest: &mut W) -> fmt::Result {
        cssparser::serialize_string(&self.0, dest)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Impl;

impl parser::SelectorImpl for Impl {
    type ExtraMatchingData<'a> = ();
    type AttrValue = AttrValue;
    type Identifier = Atom;
    type LocalName = Atom;
    type NamespaceUrl = Atom;
    type NamespacePrefix = Atom;
    type BorrowedNamespaceUrl = Atom;
    type BorrowedLocalName = Atom;
    type NonTSPseudoClass = PseudoClass;
    type PseudoElement = PseudoElement;
}

/// The non-tree-structural pseudo-classes Chrome parses. `State(name)`
/// matches when the snapshot recorded that state for the element;
/// `Derived(name)` is computed from tag/attributes; `Never` parses and never
/// matches (`:visited` and the pseudo-classes whose truth a snapshot cannot
/// carry).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PseudoClass {
    State(&'static str),
    Derived(&'static str),
    Never(&'static str),
    Lang(String),
    Dir(String),
    CustomState(String),
}

impl NonTSPseudoClassTrait for PseudoClass {
    type Impl = Impl;
    fn is_active_or_hover(&self) -> bool {
        matches!(
            self,
            PseudoClass::State("hover") | PseudoClass::State("active")
        )
    }
    fn is_user_action_state(&self) -> bool {
        matches!(
            self,
            PseudoClass::State("hover")
                | PseudoClass::State("active")
                | PseudoClass::State("focus")
                | PseudoClass::State("focus-within")
                | PseudoClass::State("focus-visible")
        )
    }
}

impl ToCss for PseudoClass {
    fn to_css<W: fmt::Write>(&self, dest: &mut W) -> fmt::Result {
        match self {
            PseudoClass::State(n) | PseudoClass::Derived(n) | PseudoClass::Never(n) => {
                write!(dest, ":{}", n)
            }
            PseudoClass::Lang(s) => write!(dest, ":lang({})", s),
            PseudoClass::Dir(s) => write!(dest, ":dir({})", s),
            PseudoClass::CustomState(s) => write!(dest, ":state({})", s),
        }
    }
}

/// Pseudo-classes whose truth the snapshot records per element
/// (`el.matches(':<name>')` at capture time). Keep in sync with
/// `STATE_PSEUDOS` in `browser-bundle/15-snapshot.js`.
pub const STATE_PSEUDOS: &[&str] = &[
    "hover",
    "active",
    "focus",
    "focus-within",
    "focus-visible",
    "target",
    "target-within",
    "checked",
    "indeterminate",
    "disabled",
    "required",
    "invalid",
    "user-invalid",
    "user-valid",
    "in-range",
    "out-of-range",
    "placeholder-shown",
    "default",
    "open",
    "autofill",
    "-webkit-autofill",
    "popover-open",
    "modal",
    "fullscreen",
    "-webkit-full-screen",
    "picture-in-picture",
    "playing",
    "buffering",
    "seeking",
    "muted",
    "volume-locked",
];

/// Complements of recorded states, computed in Rust from tag + recorded
/// states so the snapshot only carries the (rare) positive side.
const DERIVED_PSEUDOS: &[&str] = &[
    "defined",
    "enabled",
    "optional",
    "valid",
    "read-only",
    "read-write",
    "link",
    "any-link",
    "paused",
    "closed",
];

/// Parse-only: Chrome accepts these but a snapshot has no truth for them.
const NEVER_PSEUDOS: &[&str] = &[
    "visited",
    "local-link",
    "current",
    "past",
    "future",
    "host",
    "scope-context",
    "-webkit-any-link",
    "xr-overlay",
];

/// The pseudo-elements Chrome parses.
const PSEUDO_ELEMENTS: &[&str] = &[
    "before",
    "after",
    "first-line",
    "first-letter",
    "selection",
    "placeholder",
    "marker",
    "backdrop",
    "file-selector-button",
    "cue",
    "spelling-error",
    "grammar-error",
    "target-text",
    "details-content",
    "search-text",
    "scroll-marker",
    "scroll-marker-group",
    "scroll-button",
    "column",
    "checkmark",
    "picker-icon",
    "view-transition",
    "view-transition-group",
    "view-transition-image-pair",
    "view-transition-old",
    "view-transition-new",
];

/// A pseudo-element: parsed, never matched (Chrome's `matches` /
/// `querySelector` never match pseudo-elements).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PseudoElement(pub String);

impl PseudoElementTrait for PseudoElement {
    type Impl = Impl;
}

impl ToCss for PseudoElement {
    fn to_css<W: fmt::Write>(&self, dest: &mut W) -> fmt::Result {
        write!(dest, "::{}", self.0)
    }
}

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
    fn parse_nth_child_of(&self) -> bool {
        true
    }
    fn parse_part(&self) -> bool {
        true
    }
    fn parse_slotted(&self) -> bool {
        true
    }
    fn parse_host(&self) -> bool {
        true
    }
    fn is_is_alias(&self, name: &str) -> bool {
        name.eq_ignore_ascii_case("-webkit-any")
    }
    /// Chrome: `:is()` / `:where()` / `:has()` (since 105 for :is/:where; :has
    /// is unforgiving) — the crate applies forgiveness only to :is/:where.
    fn allow_forgiving_selectors(&self) -> bool {
        true
    }

    fn parse_non_ts_pseudo_class(
        &self,
        location: SourceLocation,
        name: CowRcStr<'i>,
    ) -> Result<PseudoClass, cssparser::ParseError<'i, Self::Error>> {
        let lower = name.to_ascii_lowercase();
        if let Some(n) = STATE_PSEUDOS.iter().find(|n| **n == lower) {
            return Ok(PseudoClass::State(n));
        }
        if let Some(n) = DERIVED_PSEUDOS.iter().find(|n| **n == lower) {
            return Ok(PseudoClass::Derived(n));
        }
        if let Some(n) = NEVER_PSEUDOS.iter().find(|n| **n == lower) {
            return Ok(PseudoClass::Never(n));
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
        let lower = name.to_ascii_lowercase();
        match lower.as_str() {
            "lang" => {
                // Chrome accepts a comma-separated list of ranges.
                let mut langs = Vec::new();
                loop {
                    let v = parser.expect_ident_or_string()?.as_ref().to_owned();
                    langs.push(v);
                    if parser.try_parse(|p| p.expect_comma()).is_err() {
                        break;
                    }
                }
                Ok(PseudoClass::Lang(langs.join(",")))
            }
            "dir" => {
                let v = parser.expect_ident()?.as_ref().to_ascii_lowercase();
                Ok(PseudoClass::Dir(v))
            }
            "state" => {
                let v = parser.expect_ident()?.as_ref().to_owned();
                Ok(PseudoClass::CustomState(v))
            }
            "host-context" | "-webkit-any" => {
                // Consume the argument; never matches outside shadow trees.
                while parser.next_including_whitespace().is_ok() {}
                Ok(PseudoClass::Never("host-context"))
            }
            _ => Err(parser.new_custom_error(
                SelectorParseErrorKind::UnsupportedPseudoClassOrElement(name),
            )),
        }
    }

    fn parse_pseudo_element(
        &self,
        location: SourceLocation,
        name: CowRcStr<'i>,
    ) -> Result<PseudoElement, cssparser::ParseError<'i, Self::Error>> {
        let lower = name.to_ascii_lowercase();
        if PSEUDO_ELEMENTS.contains(&lower.as_str()) || lower.starts_with("-webkit-") {
            return Ok(PseudoElement(lower));
        }
        Err(
            location.new_custom_error(SelectorParseErrorKind::UnsupportedPseudoClassOrElement(
                name,
            )),
        )
    }

    fn parse_functional_pseudo_element<'t>(
        &self,
        name: CowRcStr<'i>,
        parser: &mut CssParser<'i, 't>,
    ) -> Result<PseudoElement, cssparser::ParseError<'i, Self::Error>> {
        let lower = name.to_ascii_lowercase();
        match lower.as_str() {
            "highlight"
            | "part"
            | "cue"
            | "cue-region"
            | "view-transition-group"
            | "view-transition-image-pair"
            | "view-transition-old"
            | "view-transition-new"
            | "slotted"
            | "picker" => {
                while parser.next_including_whitespace().is_ok() {}
                Ok(PseudoElement(lower))
            }
            _ => Err(parser.new_custom_error(
                SelectorParseErrorKind::UnsupportedPseudoClassOrElement(name),
            )),
        }
    }

    fn default_namespace(&self) -> Option<Atom> {
        None
    }
    /// No `@namespace` in a selector API call: any prefix is a SyntaxError,
    /// except the universal `*|`.
    fn namespace_for_prefix(&self, _prefix: &Atom) -> Option<Atom> {
        None
    }
}

/// A parsed selector list.
#[derive(Debug, Clone)]
pub struct Selector {
    list: SelectorList<Impl>,
}

impl Selector {
    /// Parse a selector list; `Err(())` where Chrome would throw `SyntaxError`.
    pub fn parse(text: &str) -> Result<Selector, ()> {
        let mut input = cssparser::ParserInput::new(text);
        let mut p = CssParser::new(&mut input);
        SelectorList::parse(&SelParser, &mut p, ParseRelative::No)
            .map(|list| Selector { list })
            .map_err(|_| ())
    }

    /// Whether `el` matches any selector in the list. `scope` is the
    /// element `:scope` refers to (the `el.querySelectorAll` root), if any;
    /// with `None`, `:scope` is the document root.
    pub fn matches(&self, snap: &Snapshot, el: u32, scope: Option<u32>) -> bool {
        let mut caches = SelectorCaches::default();
        let quirks = if snap.quirks {
            QuirksMode::Quirks
        } else {
            QuirksMode::NoQuirks
        };
        let mut ctx = MatchingContext::new(
            MatchingMode::Normal,
            None,
            &mut caches,
            quirks,
            NeedsSelectorFlags::No,
            MatchingForInvalidation::No,
        );
        let scope_el = scope.map(|id| SnapEl { snap, id });
        ctx.scope_element = scope_el.as_ref().map(|e| e.opaque());
        let e = SnapEl { snap, id: el };
        matching::matches_selector_list(&self.list, &e, &mut ctx)
    }
}

/// An element of the snapshot as the `selectors` crate sees it.
#[derive(Clone, Copy)]
pub struct SnapEl<'a> {
    pub snap: &'a Snapshot,
    pub id: u32,
}

impl fmt::Debug for SnapEl<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "SnapEl({})", self.id)
    }
}

impl<'a> SnapEl<'a> {
    fn node(&self) -> &'a super::snapshot::SnapNode {
        self.snap.node(self.id)
    }
    fn is_html(&self) -> bool {
        self.snap.ns_uri(self.id) == NS_XHTML
    }
    fn has_state(&self, name: &str) -> bool {
        self.node().states.iter().any(|s| s == name)
    }
    fn tag_lower(&self) -> String {
        self.node().tag.to_ascii_lowercase()
    }
    fn is_form_control(&self) -> bool {
        matches!(
            self.tag_lower().as_str(),
            "button" | "input" | "select" | "textarea" | "optgroup" | "option" | "fieldset"
        ) && self.is_html()
    }
    fn is_disabled(&self) -> bool {
        self.has_state("disabled")
    }
    fn is_read_write(&self) -> bool {
        // Chrome: text-ish inputs and textareas without readonly/disabled,
        // plus editing hosts.
        if self.node().content_editable {
            return true;
        }
        if !self.is_html() {
            return false;
        }
        let tag = self.tag_lower();
        let readonly = self.snap.attr(self.id, "readonly").is_some();
        if readonly || self.is_disabled() {
            return false;
        }
        match tag.as_str() {
            "textarea" => true,
            "input" => {
                let ty = self
                    .snap
                    .attr(self.id, "type")
                    .map(|t| t.to_ascii_lowercase())
                    .unwrap_or_default();
                matches!(
                    ty.as_str(),
                    "" | "text"
                        | "search"
                        | "url"
                        | "tel"
                        | "email"
                        | "password"
                        | "date"
                        | "month"
                        | "week"
                        | "time"
                        | "datetime-local"
                        | "number"
                )
            }
            _ => false,
        }
    }
    fn derived(&self, name: &str) -> bool {
        match name {
            // The capture records the (rare) complement as `undefined`.
            "defined" => !self.has_state("undefined"),
            "enabled" => self.is_form_control() && !self.is_disabled(),
            "optional" => {
                self.is_html()
                    && matches!(self.tag_lower().as_str(), "input" | "select" | "textarea")
                    && !self.has_state("required")
            }
            "valid" => {
                self.is_html()
                    && matches!(
                        self.tag_lower().as_str(),
                        "input" | "select" | "textarea" | "form" | "fieldset"
                    )
                    && !self.has_state("invalid")
            }
            "read-write" => self.is_read_write(),
            "read-only" => !self.is_read_write(),
            "link" | "any-link" => self.is_link(),
            "paused" => {
                self.is_html()
                    && matches!(self.tag_lower().as_str(), "video" | "audio")
                    && !self.has_state("playing")
            }
            "closed" => {
                self.is_html()
                    && matches!(self.tag_lower().as_str(), "details" | "dialog" | "select")
                    && !self.has_state("open")
            }
            _ => false,
        }
    }
    fn lang(&self) -> Option<String> {
        let mut cur = Some(*self);
        while let Some(el) = cur {
            if let Some(v) = el.snap.attr(el.id, "lang") {
                return Some(v);
            }
            if el.is_html() {
                if let Some(v) = el.snap.attr(el.id, "xml:lang") {
                    return Some(v);
                }
            }
            cur = el.parent_element();
        }
        None
    }
}

impl<'a> Element for SnapEl<'a> {
    type Impl = Impl;

    fn opaque(&self) -> OpaqueElement {
        OpaqueElement::new(self.node())
    }
    fn parent_element(&self) -> Option<Self> {
        self.node().parent.map(|id| SnapEl {
            snap: self.snap,
            id,
        })
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
        self.snap
            .previous_element_sibling(self.id)
            .map(|id| SnapEl {
                snap: self.snap,
                id,
            })
    }
    fn next_sibling_element(&self) -> Option<Self> {
        self.snap.next_element_sibling(self.id).map(|id| SnapEl {
            snap: self.snap,
            id,
        })
    }
    fn first_element_child(&self) -> Option<Self> {
        self.node().children.first().map(|id| SnapEl {
            snap: self.snap,
            id: *id,
        })
    }
    fn is_html_element_in_html_document(&self) -> bool {
        self.is_html()
    }
    /// The crate passes the lowercase name for HTML elements (see
    /// `is_html_element_in_html_document`) and the original otherwise; the
    /// snapshot keeps `tagName` (uppercase for HTML, as-is for SVG), so
    /// compare case-insensitively for HTML and exactly for the rest.
    fn has_local_name(&self, name: &Atom) -> bool {
        if self.is_html() {
            self.node().tag.eq_ignore_ascii_case(&name.0)
        } else {
            self.node().tag == name.0
        }
    }
    fn has_namespace(&self, ns: &Atom) -> bool {
        self.snap.ns_uri(self.id) == ns.0
    }
    fn is_same_type(&self, other: &Self) -> bool {
        self.node().tag == other.node().tag
            && self.snap.ns_uri(self.id) == other.snap.ns_uri(other.id)
    }
    fn attr_matches(
        &self,
        ns: &NamespaceConstraint<&Atom>,
        local_name: &Atom,
        operation: &AttrSelectorOperation<&AttrValue>,
    ) -> bool {
        // Attributes in the snapshot carry no namespace (getAttribute
        // names); a specific non-empty namespace constraint cannot match.
        if let NamespaceConstraint::Specific(url) = ns {
            if !url.0.is_empty() {
                return false;
            }
        }
        let html = self.is_html();
        self.node().attrs.iter().any(|(k, v)| {
            let name_ok = if html {
                k.eq_ignore_ascii_case(&local_name.0)
            } else {
                k == &local_name.0
            };
            name_ok && operation.eval_str(v)
        })
    }
    fn match_non_ts_pseudo_class(
        &self,
        pc: &PseudoClass,
        _context: &mut MatchingContext<'_, Self::Impl>,
    ) -> bool {
        match pc {
            PseudoClass::State(name) => self.has_state(name),
            PseudoClass::Derived(name) => self.derived(name),
            PseudoClass::Never(_) => false,
            PseudoClass::Lang(ranges) => {
                let Some(have) = self.lang() else {
                    return false;
                };
                let have = have.to_ascii_lowercase();
                ranges.split(',').any(|want| {
                    let want = want.trim().to_ascii_lowercase();
                    if want == "*" {
                        return !have.is_empty();
                    }
                    if want.is_empty() {
                        return have.is_empty();
                    }
                    // Extended filtering, simplified: prefix on subtag boundary,
                    // with `*-` wildcards accepted only as a leading subtag.
                    let want = want.strip_prefix("*-").unwrap_or(&want);
                    have == want
                        || have.starts_with(&format!("{}-", want))
                        || have.contains(&format!("-{}-", want))
                        || have.ends_with(&format!("-{}", want))
                })
            }
            PseudoClass::Dir(dir) => {
                // Snapshot records the resolved direction as a state
                // (`dir-ltr` / `dir-rtl`) when the capture asked for it.
                self.has_state(&format!("dir-{}", dir))
            }
            PseudoClass::CustomState(_) => false,
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
        self.is_html()
            && matches!(self.tag_lower().as_str(), "a" | "area" | "link")
            && self.snap.attr(self.id, "href").is_some()
    }
    fn is_html_slot_element(&self) -> bool {
        self.is_html() && self.tag_lower() == "slot"
    }
    fn has_id(&self, id: &Atom, case_sensitivity: CaseSensitivity) -> bool {
        match self.snap.attr(self.id, "id") {
            Some(v) => case_sensitivity.eq(id.0.as_bytes(), v.as_bytes()),
            None => false,
        }
    }
    fn has_class(&self, name: &Atom, case_sensitivity: CaseSensitivity) -> bool {
        match self.snap.attr(self.id, "class") {
            Some(v) => v
                .split(|c: char| matches!(c, ' ' | '\t' | '\n' | '\x0C' | '\r'))
                .any(|c| !c.is_empty() && case_sensitivity.eq(name.0.as_bytes(), c.as_bytes())),
            None => false,
        }
    }
    fn has_custom_state(&self, _name: &Atom) -> bool {
        false
    }
    fn imported_part(&self, _: &Atom) -> Option<Atom> {
        None
    }
    fn is_part(&self, _name: &Atom) -> bool {
        false
    }
    /// `:empty`: no element or non-empty... per spec, no children other than
    /// comments/PIs; Chrome: text nodes of any content make it non-empty
    /// (even whitespace).
    fn is_empty(&self) -> bool {
        self.node().child_nodes.iter().all(|n| match n {
            super::snapshot::ChildNode::El(_) => false,
            super::snapshot::ChildNode::Text(t) => t.is_empty(),
            super::snapshot::ChildNode::CData(v) => v.iter().all(|t| t.is_empty()),
        })
    }
    fn is_root(&self) -> bool {
        self.node().parent.is_none() && Some(self.id) == self.snap.document_element
    }
    fn apply_selector_flags(&self, _flags: matching::ElementSelectorFlags) {}
    fn add_element_unique_hashes(&self, _filter: &mut BloomFilter) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_surface_matches_chrome() {
        assert!(Selector::parse("a:hover").is_ok());
        assert!(Selector::parse("a:focus").is_ok());
        assert!(Selector::parse("a::before").is_ok());
        assert!(Selector::parse("a::-webkit-scrollbar").is_ok());
        assert!(Selector::parse("a::foo").is_err());
        assert!(Selector::parse("a:contains(x)").is_err());
        assert!(Selector::parse("input:disabled").is_ok());
        assert!(Selector::parse(":scope > p.lead").is_ok());
        assert!(Selector::parse("[class*=\"badge\" i]").is_ok());
        assert!(Selector::parse("li:not(:last-child)").is_ok());
        assert!(Selector::parse("div:has(> img)").is_ok());
        assert!(Selector::parse(".x)").is_err());
        assert!(Selector::parse("").is_err());
        assert!(Selector::parse("svg|rect").is_err());
        assert!(Selector::parse("h1, h2, [role=\"heading\"]").is_ok());
        assert!(Selector::parse("[tabindex]:not([tabindex=\"-1\"])").is_ok());
        assert!(Selector::parse("div:nth-of-type(2) > span:nth-child(3)").is_ok());
        assert!(Selector::parse("#\\31 23").is_ok());
        assert!(Selector::parse(":lang(en, fr)").is_ok());
        assert!(Selector::parse("a:visited").is_ok());
        assert!(Selector::parse(":is(a, :nope)").is_ok(), "forgiving :is");
        assert!(Selector::parse(":not(:nope)").is_err());
    }
}
