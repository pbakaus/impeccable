//! Per-file glue for `impeccable detect --report-unused-ignores`.
//!
//! The engines run with inline ignores off, so their findings are the raw
//! set. This module applies the file's waivers itself, the same ones
//! `apply_inline_ignores` would apply, and from the same single parse appends
//! one primary finding per directive rule that waived nothing.
//!
//! `unused-ignore` is not a catalog rule. `--list-rules` does not show it,
//! and it has no category: it exists only as a finding this flag adds.

use impeccable_core::findings::Finding;
use impeccable_core::inline_ignores::{apply_inline_ignores_reporting_unused, UnusedDirective};
use impeccable_core::registry::get_antipattern;

/// Finding id for a waiver that matched nothing.
pub const UNUSED_IGNORE_ID: &str = "unused-ignore";

pub const UNUSED_IGNORE_NAME: &str = "Unused inline ignore";

/// `--report-unused-ignores` with `--no-inline-ignores` or `--no-config`.
pub const NEEDS_INLINE_IGNORES: &str =
    "Error: --report-unused-ignores needs inline ignores enabled\n";

/// `impeccable-<variant> <rule>`, the snippet a finding carries.
pub fn directive_snippet(variant: &str, rule: &str) -> String {
    format!("impeccable-{variant} {rule}")
}

fn description(variant: &str, rule: &str) -> String {
    let keyword = format!("impeccable-{variant}");
    let scope = match variant {
        "disable" => "in this file",
        "disable-line" => "on this line",
        "disable-next-line" => "on the next line",
        _ => "here",
    };
    if rule == "*" {
        format!(
            "This {keyword} waiver covers every rule but waived no finding {scope}. Delete it, or the next real finding {scope} is swallowed."
        )
    } else {
        format!(
            "This {keyword} waiver names {rule} but waived no finding {scope}. Delete it, or the next real {rule} finding {scope} is swallowed."
        )
    }
}

fn finding_for(file: &str, unused: &UnusedDirective) -> Finding {
    Finding {
        antipattern: UNUSED_IGNORE_ID.to_string(),
        name: UNUSED_IGNORE_NAME.to_string(),
        description: description(&unused.variant, &unused.rule),
        severity: "warning".to_string(),
        category: None,
        file: file.to_string(),
        line: unused.source_line as f64,
        snippet: directive_snippet(&unused.variant, &unused.rule),
        advisory: None,
        extras: Default::default(),
    }
}

/// Whether a waiver naming `rule` can be judged on this run.
///
/// Only a rule that could have produced a finding here can be called
/// unused. That rules out two cases a report would get wrong:
///
/// - ids no loaded rule answers to. A comment such as
///   `impeccable-disable overused-font because brand` parses `because` and
///   `brand` as ids, and prose that merely quotes a directive parses the
///   words after it. Telling a user to delete those is noise.
/// - design-system rules when this scan loaded no design system
///   (`--no-design-system`, `designSystem.enabled: false`, or no DESIGN.md).
///   They cannot fire, so their waivers would all look stale while the
///   project still needs them.
///
/// `*` is always judged: it answers to every rule that ran.
pub fn rule_can_fire(rule: &str, design_system_loaded: bool) -> bool {
    if rule == "*" {
        return true;
    }
    if get_antipattern(rule).is_none() {
        return false;
    }
    design_system_loaded || !rule.starts_with("design-system-")
}

/// Drop what the file's waivers would drop, then append an `unused-ignore`
/// finding for each rule that waived nothing and could have fired on this
/// run ([`rule_can_fire`]). `findings` must be the raw engine output, before
/// inline ignores.
pub fn merge_unused_ignores(
    file: &str,
    findings: Vec<Finding>,
    content: &str,
    design_system_loaded: bool,
) -> Vec<Finding> {
    let (mut findings, unused) = apply_inline_ignores_reporting_unused(findings, Some(content));
    findings.extend(
        unused
            .into_iter()
            .filter(|unused| rule_can_fire(&unused.rule, design_system_loaded))
            .map(|unused| finding_for(file, &unused)),
    );
    findings
}

/// Split `unused-ignore` findings out so a later `--scope` or `ignoreRules`
/// pass cannot drop them. They are not catalog rules, and the flag asked
/// for them. Order of each side is preserved.
pub fn partition_unused_ignores(findings: Vec<Finding>) -> (Vec<Finding>, Vec<Finding>) {
    let mut rest = Vec::new();
    let mut unused = Vec::new();
    for finding in findings {
        if finding.antipattern == UNUSED_IGNORE_ID {
            unused.push(finding);
        } else {
            rest.push(finding);
        }
    }
    (rest, unused)
}

#[cfg(test)]
mod tests {
    use super::*;
    use impeccable_core::findings::finding;

    #[test]
    fn merge_drops_the_live_waiver_and_reports_the_stale_rule() {
        let content = ".brand { font-family: Inter } /* impeccable-disable-line overused-font, bounce-easing */\n";
        let raw = vec![finding(
            "overused-font",
            "brand.css",
            "font-family: Inter",
            1.0,
        )];
        let merged = merge_unused_ignores("brand.css", raw, content, false);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].antipattern, UNUSED_IGNORE_ID);
        assert_eq!(merged[0].severity, "warning");
        assert!(merged[0].advisory.is_none());
        assert_eq!(merged[0].category, None);
        assert_eq!(merged[0].line, 1.0);
        assert_eq!(merged[0].snippet, "impeccable-disable-line bounce-easing");
        assert!(merged[0].description.contains("bounce-easing"));
        assert!(!merged[0].description.contains("overused-font"));
        let json = serde_json::to_string(&merged[0]).unwrap();
        assert!(json.contains("\"category\":null"));
        assert!(json.contains("\"severity\":\"warning\""));
    }

    #[test]
    fn a_star_that_waived_a_finding_stays_quiet() {
        let content = "<!-- impeccable-disable * -->\n<div></div>\n";
        let raw = vec![finding("side-tab", "page.html", "border-left", 0.0)];
        let merged = merge_unused_ignores("page.html", raw, content, false);
        assert!(merged.is_empty());
    }

    #[test]
    fn words_that_are_not_rule_ids_are_never_reported() {
        let content = "/* impeccable-disable overused-font because brand */\n.a { color: red }\n";
        let merged = merge_unused_ignores("a.css", Vec::new(), content, false);
        let snippets: Vec<&str> = merged.iter().map(|f| f.snippet.as_str()).collect();
        assert_eq!(snippets, vec!["impeccable-disable overused-font"]);
    }

    #[test]
    fn design_system_waivers_wait_for_a_loaded_design_system() {
        let content = "<p>x</p> <!-- impeccable-disable-line design-system-font -->\n";
        assert!(merge_unused_ignores("p.html", Vec::new(), content, false).is_empty());
        let merged = merge_unused_ignores("p.html", Vec::new(), content, true);
        assert_eq!(merged.len(), 1);
        assert_eq!(
            merged[0].snippet,
            "impeccable-disable-line design-system-font"
        );
    }

    #[test]
    fn rule_can_fire_knows_catalog_ids_and_star() {
        assert!(rule_can_fire("*", false));
        assert!(rule_can_fire("overused-font", false));
        assert!(!rule_can_fire("because", true));
        assert!(!rule_can_fire("design-system-color", false));
        assert!(rule_can_fire("design-system-color", true));
    }
}
