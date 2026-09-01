//! Port of `cli/engine/findings.mjs`: the finding object every engine emits.

use crate::inline_ignores::IgnorableFinding;
use crate::registry::{get_ap, Antipattern};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// A detector finding, serialized in the exact JS key order:
/// `antipattern, name, description, severity, category, file, line, snippet`
/// then `advisory` (only when true), then any extra keys a caller spread in
/// (`ignoreValue`, ...).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Finding {
    pub antipattern: String,
    pub name: String,
    pub description: String,
    pub severity: String,
    /// JS `ap.category || null`.
    pub category: Option<String>,
    pub file: String,
    #[serde(with = "crate::js::json_number")]
    pub line: f64,
    pub snippet: String,
    /// JS `advisory: true`, stamped only for advisory rules.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub advisory: Option<bool>,
    /// Extra keys spread onto the finding by callers, in insertion order.
    #[serde(flatten)]
    pub extras: Map<String, Value>,
}

impl IgnorableFinding for Finding {
    fn antipattern(&self) -> Option<&str> {
        Some(&self.antipattern)
    }
    fn line_number(&self) -> f64 {
        self.line
    }
}

/// JS `finding(id, filePath, snippet, line = 0)` for a rule already resolved
/// from the registry.
pub fn finding_for(ap: &Antipattern, file_path: &str, snippet: &str, line: f64) -> Finding {
    Finding {
        antipattern: ap.id.to_string(),
        name: ap.name.to_string(),
        description: ap.description.to_string(),
        severity: ap.severity.unwrap_or("warning").to_string(),
        category: Some(ap.category.to_string()),
        file: file_path.to_string(),
        line,
        snippet: snippet.to_string(),
        advisory: if ap.advisory { Some(true) } else { None },
        extras: Map::new(),
    }
}

/// JS `finding(id, filePath, snippet, line = 0)`. Returns `None` for an id
/// that is not in the registry (where the JS would throw a TypeError).
pub fn try_finding(id: &str, file_path: &str, snippet: &str, line: f64) -> Option<Finding> {
    get_ap(id).map(|ap| finding_for(ap, file_path, snippet, line))
}

/// JS `finding(id, filePath, snippet, line = 0)`.
///
/// # Panics
/// When `id` is not a registered rule, mirroring the JS `TypeError` on
/// `ap.name`; rule ids are program constants, never user input.
pub fn finding(id: &str, file_path: &str, snippet: &str, line: f64) -> Finding {
    try_finding(id, file_path, snippet, line)
        .unwrap_or_else(|| panic!("finding(): unknown antipattern id {id:?}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shape_and_order() {
        let f = finding("side-tab", "a.html", "snip", 0.0);
        let json = serde_json::to_string(&f).unwrap();
        assert!(json.starts_with(
            r#"{"antipattern":"side-tab","name":"Side-tab accent border","description":"#
        ));
        assert!(json.contains(
            r#""severity":"warning","category":"slop","file":"a.html","line":0,"snippet":"snip"}"#
        ));
        assert!(!json.contains("advisory"));
        let mut adv = finding("em-dash-overuse", "a.html", "s", 3.0);
        adv.extras
            .insert("ignoreValue".into(), Value::String("x".into()));
        let json = serde_json::to_string(&adv).unwrap();
        assert!(json.ends_with(r#""snippet":"s","advisory":true,"ignoreValue":"x"}"#));
        assert_eq!(finding("script-error", "f", "s", 0.0).severity, "error");
        assert!(try_finding("nope", "f", "s", 0.0).is_none());
    }
}
