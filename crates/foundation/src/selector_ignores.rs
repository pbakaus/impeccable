//! Component-level opt-outs: one `{ rule, selector }` pair waives a rule for
//! every element the selector matches, and for that element's subtree.
//!
//! This is the declared twin of the `data-impeccable-ignore` attribute. The
//! attribute waives the element that carries it; a selector ignore waives
//! every instance of a component from one line of project config, so an
//! author with eleven copies of the same 10px label writes one entry instead
//! of eleven attributes.
//!
//! The engines do not drop what a selector ignore covers. They stamp the
//! finding with the selector that waived it (`Finding.ignoredBy` /
//! `BrowserFinding.ignoredBy`), and the config layer that owns the ignore
//! list drops and counts them, so "silenced" stays countable.

use serde::{Deserialize, Serialize};

/// One `detector.ignoreSelectors` entry, reduced to what an engine needs.
/// `rule` is a lowercased rule id or `*` (every rule); `selector` is a CSS
/// selector matched against the finding's element and its ancestors.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct SelectorIgnore {
    pub rule: String,
    pub selector: String,
}

impl SelectorIgnore {
    /// Normalizing constructor: the rule is trimmed and lowercased the way
    /// `data-impeccable-ignore` tokens are, the selector keeps its case
    /// (`.ksTag` and `.kstag` are different classes) and only loses
    /// surrounding whitespace.
    pub fn new(rule: impl AsRef<str>, selector: impl AsRef<str>) -> Self {
        SelectorIgnore {
            rule: crate::js::to_lower_case(crate::js::trim(rule.as_ref())),
            selector: crate::js::trim(selector.as_ref()).to_string(),
        }
    }

    /// Usable only with both halves present. An entry with an empty selector
    /// would waive everything, which is what `ignoreRules` is for.
    pub fn is_valid(&self) -> bool {
        !self.rule.is_empty() && !self.selector.is_empty()
    }

    /// `*` covers every rule, exactly as it does in the attribute.
    pub fn covers_rule(&self, rule_id: &str) -> bool {
        if !self.is_valid() {
            return false;
        }
        self.rule == "*" || self.rule == crate::js::to_lower_case(crate::js::trim(rule_id))
    }
}

/// The first entry that waives `rule_id` for an element, where `closest`
/// answers the DOM's `element.closest(selector) !== null` (self or ancestor).
/// Returns the selector that waived it, which is what the finding carries.
pub fn waiving_selector<'a>(
    entries: &'a [SelectorIgnore],
    rule_id: &str,
    mut closest: impl FnMut(&str) -> bool,
) -> Option<&'a str> {
    entries
        .iter()
        .find(|e| e.covers_rule(rule_id) && closest(&e.selector))
        .map(|e| e.selector.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_rule_and_selector() {
        let e = SelectorIgnore::new("  Undersized-UI-Text ", "  .ks-tag ");
        assert_eq!(e.rule, "undersized-ui-text");
        assert_eq!(e.selector, ".ks-tag");
        assert!(e.is_valid());
    }

    #[test]
    fn half_an_entry_is_not_an_entry() {
        assert!(!SelectorIgnore::new("", ".ks-tag").is_valid());
        assert!(!SelectorIgnore::new("side-tab", "   ").is_valid());
        assert!(!SelectorIgnore::new("", ".ks-tag").covers_rule("side-tab"));
    }

    #[test]
    fn star_covers_every_rule() {
        let e = SelectorIgnore::new("*", ".demo");
        assert!(e.covers_rule("side-tab"));
        assert!(e.covers_rule("UNDERSIZED-UI-TEXT"));
    }

    #[test]
    fn waiving_selector_picks_the_first_match() {
        let entries = vec![
            SelectorIgnore::new("side-tab", ".nope"),
            SelectorIgnore::new("undersized-ui-text", ".ks-tag"),
            SelectorIgnore::new("undersized-ui-text", ".also"),
        ];
        let hit = waiving_selector(&entries, "undersized-ui-text", |s| s != ".nope");
        assert_eq!(hit, Some(".ks-tag"));
        assert_eq!(waiving_selector(&entries, "glow-effect", |_| true), None);
        assert_eq!(
            waiving_selector(&entries, "undersized-ui-text", |_| false),
            None
        );
    }
}
