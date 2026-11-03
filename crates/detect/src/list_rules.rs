//! `impeccable detect --list-rules`: every rule in the registry (`all_antipatterns()`, built-ins plus any installed rule pack), no scan.

use impeccable_core::registry::{all_antipatterns, Antipattern};
use serde_json::{json, Value};

/// Rules in registry order, optionally narrowed by `--scope` and
/// `--no-advisory` the same way a scan would drop them from the report.
pub fn collect_catalog_rules<'a>(
    scopes: &'a [String],
    no_advisory: bool,
) -> Vec<&'static Antipattern> {
    all_antipatterns()
        .filter(|rule| {
            if no_advisory && rule.severity == Some("advisory") {
                return false;
            }
            if scopes.is_empty() {
                return true;
            }
            rule.scopes
                .unwrap_or(&[])
                .iter()
                .any(|scope| scopes.iter().any(|wanted| wanted == scope))
        })
        .collect()
}

pub fn format_list_rules_ids(rules: &[&Antipattern]) -> String {
    let mut out = String::new();
    for rule in rules {
        out.push_str(rule.id);
        out.push('\n');
    }
    out
}

pub fn format_list_rules_text(rules: &[&Antipattern]) -> String {
    let mut groups: Vec<(&str, Vec<&Antipattern>)> = Vec::new();
    for rule in rules {
        if let Some((_, rows)) = groups
            .iter_mut()
            .find(|(category, _)| *category == rule.category)
        {
            rows.push(*rule);
        } else {
            groups.push((rule.category, vec![*rule]));
        }
    }
    let mut out = String::new();
    for (i, (category, rows)) in groups.iter().enumerate() {
        if i > 0 {
            out.push('\n');
        }
        out.push_str(category);
        out.push('\n');
        for (j, rule) in rows.iter().enumerate() {
            if j > 0 {
                out.push('\n');
            }
            let advisory = if rule.severity == Some("advisory") {
                "  (advisory)"
            } else {
                ""
            };
            out.push_str("  ");
            out.push_str(rule.id);
            out.push_str(advisory);
            out.push('\n');
            out.push_str("    ");
            out.push_str(rule.name);
            out.push('\n');
            out.push_str("    ");
            out.push_str(rule.description);
            out.push('\n');
        }
    }
    let n = rules.len();
    out.push_str(&format!("\n{} rule{}.\n", n, if n == 1 { "" } else { "s" }));
    out
}

pub fn format_list_rules_json(rules: &[&Antipattern]) -> String {
    let rows: Vec<Value> = rules
        .iter()
        .map(|rule| {
            let mut row = json!({
                "id": rule.id,
                "name": rule.name,
                "category": rule.category,
                "severity": rule.severity.unwrap_or("warning"),
                "scopes": rule.scopes.unwrap_or(&[]),
                "description": rule.description,
            });
            if rule.severity == Some("advisory") {
                row.as_object_mut()
                    .expect("object")
                    .insert("advisory".into(), Value::Bool(true));
            }
            row
        })
        .collect();
    serde_json::to_string_pretty(&Value::Array(rows)).unwrap_or_else(|_| "[]".into())
}

pub const LIST_RULES_SCAN_ERROR: &str =
    "Error: --list-rules prints the rule catalog and takes no file, URL, or --cdp scan\n";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_covers_every_registered_rule_in_registry_order() {
        let rules = collect_catalog_rules(&[], false);
        let all: Vec<_> = all_antipatterns().collect();
        assert_eq!(rules.len(), all.len());
        assert_eq!(rules[0].id, "side-tab");
        assert!(rules.iter().any(|r| r.id == "low-contrast"));
        assert!(rules.iter().any(|r| r.severity == Some("advisory")));
    }

    #[test]
    fn scope_keeps_only_rules_that_declare_it() {
        let rules = collect_catalog_rules(&["type".to_string()], false);
        assert!(rules.iter().any(|r| r.id == "overused-font"));
        assert!(rules
            .iter()
            .all(|r| r.scopes.unwrap_or(&[]).iter().any(|s| *s == "type")));
        assert!(!rules.iter().any(|r| r.id == "side-tab"));
        assert!(!rules.iter().any(|r| r.id == "nested-cards"));
    }

    #[test]
    fn no_advisory_drops_advisory_rows() {
        let rules = collect_catalog_rules(&[], true);
        assert!(!rules.is_empty());
        assert!(rules.iter().all(|r| r.severity != Some("advisory")));
        assert!(!rules.iter().any(|r| r.id == "bounce-easing"));
        assert!(rules.iter().any(|r| r.id == "side-tab"));
    }

    #[test]
    fn quiet_ids_are_one_per_line() {
        let rules = collect_catalog_rules(&[], false);
        let text = format_list_rules_ids(&rules);
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), rules.len());
        assert_eq!(lines[0], "side-tab");
        assert!(text.ends_with('\n'));
    }

    #[test]
    fn text_catalog_groups_by_category_and_marks_advisories() {
        let rules = collect_catalog_rules(&[], false);
        let text = format_list_rules_text(&rules);
        assert!(text.starts_with("slop\n"));
        assert!(text.contains("  side-tab\n    Side-tab accent border\n"));
        assert!(text.contains("  bounce-easing  (advisory)\n"));
        assert!(text.contains("  gpt-thin-border-wide-shadow  (advisory)\n"));
        assert!(text.contains("\nquality\n"));
        assert!(text.contains("  low-contrast\n"));
        assert_eq!(text.matches("\nslop\n").count(), 0);
        assert_eq!(text.matches("slop\n").count(), 1);
        assert!(text.ends_with(&format!("\n{} rules.\n", rules.len())));
    }

    #[test]
    fn json_catalog_is_an_array_of_rule_objects() {
        let rules = collect_catalog_rules(&[], false);
        let parsed: Value = serde_json::from_str(&format_list_rules_json(&rules)).unwrap();
        let arr = parsed.as_array().expect("array");
        assert_eq!(arr.len(), rules.len());
        assert_eq!(arr[0]["id"], "side-tab");
        assert_eq!(arr[0]["category"], "slop");
        assert_eq!(arr[0]["severity"], "warning");
        assert!(arr[0].get("advisory").is_none());
        let bounce = arr
            .iter()
            .find(|row| row["id"] == "bounce-easing")
            .expect("bounce-easing");
        assert_eq!(bounce["advisory"], true);
        assert_eq!(bounce["severity"], "advisory");
    }
}
