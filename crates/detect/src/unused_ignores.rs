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
use impeccable_core::registry::{get_antipattern, ANTIPATTERNS};

use crate::design_system::DesignSystem;
use crate::detect_text::{regex_engine_rule_ids, should_run_page_analyzers};

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

/// Which engine scanned a file, as far as judging its waivers needs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScanEngine {
    /// The regex engine (CSS, JSX, TSX, Vue, Svelte, stdin, ...).
    /// `page_analyzers` is whether its page analyzers ran on the file
    /// ([`should_run_page_analyzers`]).
    Regex { page_analyzers: bool },
    /// The static HTML engine, which runs the element and page rules.
    Html,
}

impl ScanEngine {
    /// The engine [`detect_text`](crate::detect_text::detect_text) is for
    /// `content` at `file_path`.
    pub fn regex_for(content: &str, file_path: &str) -> Self {
        ScanEngine::Regex {
            page_analyzers: should_run_page_analyzers(content, file_path),
        }
    }
}

/// Whether a waiver naming `rule` can be judged on this run.
///
/// Only a rule that could have produced a finding here can be called
/// unused. That rules out these cases a report would get wrong:
///
/// - ids no loaded rule answers to. A comment such as
///   `impeccable-disable overused-font because brand` parses `because` and
///   `brand` as ids, and prose that merely quotes a directive parses the
///   words after it. Telling a user to delete those is noise.
/// - built-in rules the engine that scanned the file never runs. The regex
///   engine cannot report `low-contrast` or `tiny-text`, so a CSS or TSX
///   scan says nothing about a waiver naming them
///   ([`regex_engine_rule_ids`]).
/// - design-system rules the loaded design system cannot drive: none loaded
///   (`--no-design-system`, `designSystem.enabled: false`, or no DESIGN.md),
///   or a DESIGN.md that declares no fonts, colors, radii or fixed font
///   sizes for the matching `design-system-*` check.
///
/// Rule-pack ids are judged as before: the pack decides what its hooks run.
/// `*` is always judged: it answers to every rule that ran.
pub fn rule_can_fire(rule: &str, engine: ScanEngine, design_system: Option<&DesignSystem>) -> bool {
    if rule == "*" {
        return true;
    }
    if get_antipattern(rule).is_none() {
        return false;
    }
    if rule.starts_with("design-system-") {
        let Some(ds) = design_system.filter(|ds| ds.present) else {
            return false;
        };
        return match rule {
            "design-system-font" => ds.has_fonts,
            "design-system-color" => ds.has_colors,
            "design-system-radius" => ds.has_radii,
            "design-system-font-size" => ds.has_font_sizes,
            _ => true,
        };
    }
    match engine {
        ScanEngine::Html => true,
        ScanEngine::Regex { page_analyzers } => {
            !is_built_in(rule) || regex_engine_rule_ids(page_analyzers).contains(&rule)
        }
    }
}

fn is_built_in(rule: &str) -> bool {
    ANTIPATTERNS.iter().any(|ap| ap.id == rule)
}

/// Drop what the file's waivers would drop, then append an `unused-ignore`
/// finding for each rule that waived nothing and could have fired on this
/// run ([`rule_can_fire`]). `findings` must be the raw engine output, before
/// inline ignores.
pub fn merge_unused_ignores(
    file: &str,
    findings: Vec<Finding>,
    content: &str,
    engine: ScanEngine,
    design_system: Option<&DesignSystem>,
) -> Vec<Finding> {
    let (mut findings, unused) = apply_inline_ignores_reporting_unused(findings, Some(content));
    findings.extend(
        unused
            .into_iter()
            .filter(|unused| rule_can_fire(&unused.rule, engine, design_system))
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

    const CSS: ScanEngine = ScanEngine::Regex {
        page_analyzers: false,
    };
    const PAGE: ScanEngine = ScanEngine::Regex {
        page_analyzers: true,
    };

    fn design_system(fonts: bool, colors: bool) -> DesignSystem {
        DesignSystem {
            present: true,
            has_fonts: fonts,
            has_colors: colors,
            ..Default::default()
        }
    }

    #[test]
    fn merge_drops_the_live_waiver_and_reports_the_stale_rule() {
        let content = ".brand { font-family: Inter } /* impeccable-disable-line overused-font, bounce-easing */\n";
        let raw = vec![finding(
            "overused-font",
            "brand.css",
            "font-family: Inter",
            1.0,
        )];
        let merged = merge_unused_ignores("brand.css", raw, content, CSS, None);
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
        let merged = merge_unused_ignores("page.html", raw, content, ScanEngine::Html, None);
        assert!(merged.is_empty());
    }

    #[test]
    fn words_that_are_not_rule_ids_are_never_reported() {
        let content = "/* impeccable-disable overused-font because brand */\n.a { color: red }\n";
        let merged = merge_unused_ignores("a.css", Vec::new(), content, CSS, None);
        let snippets: Vec<&str> = merged.iter().map(|f| f.snippet.as_str()).collect();
        assert_eq!(snippets, vec!["impeccable-disable overused-font"]);
    }

    #[test]
    fn design_system_waivers_wait_for_a_loaded_design_system() {
        let content = "<p>x</p> <!-- impeccable-disable-line design-system-font -->\n";
        let html = ScanEngine::Html;
        assert!(merge_unused_ignores("p.html", Vec::new(), content, html, None).is_empty());
        let ds = design_system(true, true);
        let merged = merge_unused_ignores("p.html", Vec::new(), content, html, Some(&ds));
        assert_eq!(merged.len(), 1);
        assert_eq!(
            merged[0].snippet,
            "impeccable-disable-line design-system-font"
        );
    }

    #[test]
    fn a_design_system_without_fonts_leaves_font_waivers_alone() {
        let content =
            "/* impeccable-disable design-system-font, design-system-color */\n.a { margin: 0 }\n";
        let colors_only = design_system(false, true);
        let merged = merge_unused_ignores("a.css", Vec::new(), content, CSS, Some(&colors_only));
        let snippets: Vec<&str> = merged.iter().map(|f| f.snippet.as_str()).collect();
        assert_eq!(snippets, vec!["impeccable-disable design-system-color"]);
        // A design system that did not load is the same as none.
        let absent = DesignSystem {
            present: false,
            ..design_system(true, true)
        };
        assert!(merge_unused_ignores("a.css", Vec::new(), content, CSS, Some(&absent)).is_empty());
    }

    #[test]
    fn a_regex_scan_leaves_element_rule_waivers_alone() {
        let content =
            "/* impeccable-disable low-contrast, tiny-text, bounce-easing */\n.a { margin: 0 }\n";
        let merged = merge_unused_ignores("a.css", Vec::new(), content, CSS, None);
        let snippets: Vec<&str> = merged.iter().map(|f| f.snippet.as_str()).collect();
        assert_eq!(snippets, vec!["impeccable-disable bounce-easing"]);
        // The HTML engine runs the element rules, so there they are judged.
        let merged = merge_unused_ignores("a.html", Vec::new(), content, ScanEngine::Html, None);
        assert_eq!(merged.len(), 3);
    }

    #[test]
    fn page_analyzer_waivers_are_judged_only_where_the_analyzers_ran() {
        assert!(!rule_can_fire("em-dash-overuse", CSS, None));
        assert!(rule_can_fire("em-dash-overuse", PAGE, None));
        assert!(rule_can_fire("bounce-easing", CSS, None));
        assert!(rule_can_fire("side-tab", CSS, None));
        assert!(rule_can_fire("codex-grid-background", CSS, None));
        let full = "<!doctype html><html><body><p>x</p></body></html>\n";
        assert_eq!(ScanEngine::regex_for(full, "page.vue"), PAGE);
        assert_eq!(ScanEngine::regex_for(full, "page.tsx"), CSS);
        assert_eq!(ScanEngine::regex_for(".a{}", "a.css"), CSS);
    }

    #[test]
    fn rule_can_fire_knows_catalog_ids_and_star() {
        let ds = design_system(true, true);
        assert!(rule_can_fire("*", CSS, None));
        assert!(rule_can_fire("overused-font", CSS, None));
        assert!(!rule_can_fire("because", ScanEngine::Html, Some(&ds)));
        assert!(!rule_can_fire(
            "design-system-color",
            ScanEngine::Html,
            None
        ));
        assert!(rule_can_fire(
            "design-system-color",
            ScanEngine::Html,
            Some(&ds)
        ));
        assert!(!rule_can_fire("low-contrast", CSS, None));
        assert!(!rule_can_fire("tiny-text", PAGE, None));
        assert!(rule_can_fire("low-contrast", ScanEngine::Html, None));
    }

    /// Every id the regex engine is said to run is a catalog rule, and every
    /// rule it reports on its own fixtures is one it is said to run, so a new
    /// matcher cannot leave its waivers unjudged without a test failing.
    #[test]
    fn regex_engine_rule_ids_cover_what_the_engine_reports() {
        let ids = regex_engine_rule_ids(true);
        for id in &ids {
            assert!(is_built_in(id), "{id} is not a catalog rule");
        }
        for id in regex_engine_rule_ids(false) {
            assert!(ids.contains(&id));
        }
        assert!(!ids.contains(&"low-contrast") && !ids.contains(&"tiny-text"));
    }
}
