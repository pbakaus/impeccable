//! SARIF 2.1.0 for `impeccable detect --sarif`.
//!
//! One log on stdout. `driver.rules` lists every rule that produced a result,
//! in catalog order, with the same metadata `--list-rules` prints. A clean
//! scan still writes the log, with empty `results`, so code scanning can
//! close alerts from earlier commits.
//!
//! `invocations[0].executionSuccessful` is false when any target could not be
//! scanned (the run's exit 1), with an error notification saying the results
//! are partial. Such a log is not a clean scan, and an upload that trusted it
//! would close alerts for files that were never looked at.
//!
//! `partialFingerprints.primaryLocationLineHash` is left unset.
//! `github/codeql-action/upload-sarif` hashes the source line when it uploads;
//! a hash computed here would not match that one.

use std::collections::{HashMap, HashSet};

use impeccable_core::findings::Finding;
use impeccable_core::registry::Antipattern;
use serde_json::{json, Value};

use crate::github_annotations::{annotation_file, workflow_command};

pub const SARIF_JSON_CONFLICT: &str = "Error: --sarif cannot be used with --json\n";
pub const SARIF_GITHUB_CONFLICT: &str = "Error: --sarif cannot be used with --github\n";
pub const SARIF_LIST_RULES_CONFLICT: &str =
    "Error: --sarif writes a SARIF log of scan findings and cannot be used with --list-rules\n";

/// The schema this log declares. The OASIS errata copy, which is the document
/// `version` 2.1.0 was published with.
const SARIF_SCHEMA: &str =
    "https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json";

const INFORMATION_URI: &str = "https://impeccable.style";

/// GitHub code scanning resolves this base to the repository root.
const SRCROOT: &str = "%SRCROOT%";

/// The notification a run with an unscanned target carries.
pub const PARTIAL_SCAN_NOTE: &str = "One or more targets could not be scanned (see stderr). Results cover only the targets that were scanned, so this log must not be treated as a clean scan.";

/// One SARIF 2.1.0 log. Pretty-printed, no trailing newline (the caller adds it).
/// `execution_successful` is false when a target could not be scanned.
pub fn format_sarif(
    findings: &[Finding],
    catalog: &[&Antipattern],
    cwd: &str,
    workspace: Option<&str>,
    version: &str,
    execution_successful: bool,
) -> String {
    let mut rules: Vec<Value> = Vec::new();
    let mut index_of: HashMap<String, usize> = HashMap::new();
    let present: HashSet<&str> = findings.iter().map(|f| f.antipattern.as_str()).collect();
    for rule in catalog {
        if !present.contains(rule.id) || index_of.contains_key(rule.id) {
            continue;
        }
        index_of.insert(rule.id.to_string(), rules.len());
        rules.push(rule_descriptor(rule));
    }
    for finding in findings {
        if index_of.contains_key(&finding.antipattern) {
            continue;
        }
        index_of.insert(finding.antipattern.clone(), rules.len());
        rules.push(fallback_descriptor(finding));
    }
    let results: Vec<Value> = findings
        .iter()
        .map(|finding| result_object(finding, cwd, workspace, &index_of))
        .collect();
    let mut invocation = json!({ "executionSuccessful": execution_successful });
    if !execution_successful {
        invocation["toolExecutionNotifications"] = json!([{
            "level": "error",
            "message": { "text": PARTIAL_SCAN_NOTE },
        }]);
    }
    let log = json!({
        "$schema": SARIF_SCHEMA,
        "version": "2.1.0",
        "runs": [{
            "tool": {
                "driver": {
                    "name": "impeccable",
                    "version": version,
                    "informationUri": INFORMATION_URI,
                    "rules": rules,
                }
            },
            "invocations": [invocation],
            "results": results,
        }]
    });
    serde_json::to_string_pretty(&log).unwrap_or_else(|_| "{}".into())
}

fn rule_descriptor(rule: &Antipattern) -> Value {
    json!({
        "id": rule.id,
        "name": rule.name,
        "shortDescription": { "text": rule.name },
        "help": { "text": rule.description },
        "properties": { "category": rule.category },
    })
}

/// A finding whose id is not in the catalog still needs a rule, or code
/// scanning drops the result as an unknown rule.
fn fallback_descriptor(finding: &Finding) -> Value {
    let name = if finding.name.is_empty() {
        finding.antipattern.as_str()
    } else {
        finding.name.as_str()
    };
    let help = if finding.description.is_empty() {
        name
    } else {
        finding.description.as_str()
    };
    json!({
        "id": finding.antipattern,
        "name": name,
        "shortDescription": { "text": name },
        "help": { "text": help },
        "properties": { "category": finding.category.as_deref().unwrap_or("") },
    })
}

fn result_object(
    finding: &Finding,
    cwd: &str,
    workspace: Option<&str>,
    index_of: &HashMap<String, usize>,
) -> Value {
    let mut result = json!({
        "ruleId": finding.antipattern,
        "ruleIndex": index_of.get(&finding.antipattern).copied().unwrap_or(0),
        "level": level(finding),
        "message": { "text": message_text(finding) },
    });
    if let Some(location) = physical_location(finding, cwd, workspace) {
        result
            .as_object_mut()
            .expect("result object")
            .insert("locations".into(), json!([location]));
    }
    result
}

/// Same split as `--github` (`workflow_command`): advisory is a notice there
/// and a note here, `error` stays an error, everything else is a warning.
fn level(finding: &Finding) -> &'static str {
    match workflow_command(finding) {
        "notice" => "note",
        other => other,
    }
}

/// Snippet, then the rule description. Either one alone when the other is
/// empty. Code scanning shows this as the alert text.
fn message_text(finding: &Finding) -> String {
    match (finding.snippet.is_empty(), finding.description.is_empty()) {
        (false, false) => format!("{}\n{}", finding.snippet, finding.description),
        (false, true) => finding.snippet.clone(),
        (true, false) => finding.description.clone(),
        (true, true) => {
            if finding.name.is_empty() {
                if finding.antipattern.is_empty() {
                    "impeccable".to_string()
                } else {
                    finding.antipattern.clone()
                }
            } else {
                finding.name.clone()
            }
        }
    }
}

fn physical_location(finding: &Finding, cwd: &str, workspace: Option<&str>) -> Option<Value> {
    let raw = annotation_file(&finding.file, cwd, workspace);
    if raw.is_empty() {
        return None;
    }
    // A URL is already an absolute URI. SARIF forbids `uriBaseId` on one,
    // and the characters in it are the caller's, not a file path to escape.
    // A path that stayed absolute (a file outside the workspace and the cwd)
    // cannot sit under %SRCROOT%: it becomes a `file://` URI instead.
    let (uri, absolute_uri) = if raw.contains("://") {
        (raw, true)
    } else if let Some(path) = absolute_file_path(&raw) {
        (format!("file://{}", encode_uri_reference(&path)), true)
    } else {
        (encode_uri_reference(&raw), false)
    };
    let mut artifact = serde_json::Map::new();
    artifact.insert("uri".into(), Value::String(uri));
    if !absolute_uri {
        artifact.insert("uriBaseId".into(), Value::String(SRCROOT.into()));
    }
    let mut physical = serde_json::Map::new();
    physical.insert("artifactLocation".into(), Value::Object(artifact));
    if let Some(line) = start_line(finding.line) {
        physical.insert("region".into(), json!({ "startLine": line }));
    }
    Some(json!({ "physicalLocation": physical }))
}

/// `Some` with a `/`-rooted path when `path` is absolute: `/x/y` as is, and a
/// Windows drive path (`C:/x` or `C:\\x`) as `/C:/x`, the form a `file:` URI
/// takes.
fn absolute_file_path(path: &str) -> Option<String> {
    if path.starts_with('/') {
        return Some(path.to_string());
    }
    let bytes = path.as_bytes();
    if bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'/' || bytes[2] == b'\\')
    {
        return Some(format!("/{}", path.replace('\\', "/")));
    }
    None
}

/// `region.startLine` is omitted when the finding has no line. SARIF lines
/// are integers starting at 1.
fn start_line(line: f64) -> Option<u32> {
    if !line.is_finite() || line < 1.0 || line > u32::MAX as f64 {
        None
    } else {
        Some(line.floor() as u32)
    }
}

/// Percent-encode bytes that are not allowed in a URI path. Spaces and `#`
/// fail `format: uri-reference` and would be read as a fragment.
fn encode_uri_reference(path: &str) -> String {
    let mut out = String::new();
    for b in path.bytes() {
        if matches!(
            b,
            b'A'..=b'Z'
                | b'a'..=b'z'
                | b'0'..=b'9'
                | b'-'
                | b'.'
                | b'_'
                | b'~'
                | b'/'
                | b':'
                | b'@'
                | b'!'
                | b'$'
                | b'&'
                | b'\''
                | b'('
                | b')'
                | b'*'
                | b'+'
                | b','
                | b';'
                | b'='
        ) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use impeccable_core::findings::finding;
    use impeccable_core::registry::all_antipatterns;

    fn catalog() -> Vec<&'static Antipattern> {
        all_antipatterns().collect()
    }

    fn parse(findings: &[Finding], workspace: Option<&str>) -> Value {
        let text = format_sarif(findings, &catalog(), "/repo", workspace, "9.9.9", true);
        serde_json::from_str(&text).unwrap_or_else(|e| panic!("{e}\n{text}"))
    }

    fn result_at<'a>(log: &'a Value, i: usize) -> &'a Value {
        &log["runs"][0]["results"][i]
    }

    #[test]
    fn log_shape_levels_and_catalog_rules() {
        let findings = vec![
            finding("em-dash-overuse", "copy.html", "—", 3.0),
            finding("side-tab", "src/card.html", "border-left: 4px", 12.0),
            finding("script-error", "app.js", "TypeError: x", 8.0),
        ];
        let log = parse(&findings, None);
        assert_eq!(log["version"], "2.1.0");
        assert!(log["$schema"]
            .as_str()
            .unwrap()
            .contains("sarif-schema-2.1.0"));
        let driver = &log["runs"][0]["tool"]["driver"];
        assert_eq!(driver["name"], "impeccable");
        assert_eq!(driver["version"], "9.9.9");
        assert_eq!(driver["informationUri"], "https://impeccable.style");
        let rules = driver["rules"].as_array().unwrap();
        let ids: Vec<&str> = rules.iter().map(|r| r["id"].as_str().unwrap()).collect();
        // Catalog order, not finding order. side-tab is the first registered rule.
        assert_eq!(ids, ["side-tab", "em-dash-overuse", "script-error"]);
        let side = rules.iter().find(|r| r["id"] == "side-tab").unwrap();
        assert_eq!(side["name"], "Side-tab accent border");
        assert_eq!(side["shortDescription"]["text"], "Side-tab accent border");
        assert!(side["help"]["text"]
            .as_str()
            .unwrap()
            .contains("Thick colored border"));
        assert_eq!(side["properties"]["category"], "slop");
        assert!(rules.len() < catalog().len());

        let note = result_at(&log, 0);
        assert_eq!(note["ruleId"], "em-dash-overuse");
        assert_eq!(note["level"], "note");
        assert_eq!(
            note["ruleIndex"].as_u64().unwrap() as usize,
            ids.iter().position(|id| *id == "em-dash-overuse").unwrap()
        );
        let warning = result_at(&log, 1);
        assert_eq!(warning["level"], "warning");
        assert_eq!(warning["ruleId"], "side-tab");
        let message = warning["message"]["text"].as_str().unwrap();
        assert!(message.starts_with("border-left: 4px\n"), "{message}");
        assert!(message.contains("Thick colored border"), "{message}");
        let loc = &warning["locations"][0]["physicalLocation"];
        assert_eq!(loc["artifactLocation"]["uri"], "src/card.html");
        assert_eq!(loc["artifactLocation"]["uriBaseId"], "%SRCROOT%");
        assert_eq!(loc["region"]["startLine"], 12);
        assert_eq!(result_at(&log, 2)["level"], "error");
        let text = serde_json::to_string(&log).unwrap();
        assert!(!text.contains("partialFingerprints"));
    }

    #[test]
    fn clean_scan_is_a_log_with_empty_results() {
        let log = parse(&[], None);
        assert!(log["runs"][0]["results"].as_array().unwrap().is_empty());
        assert!(log["runs"][0]["tool"]["driver"]["rules"]
            .as_array()
            .unwrap()
            .is_empty());
        assert_eq!(log["runs"][0]["tool"]["driver"]["name"], "impeccable");
    }

    #[test]
    fn line_zero_nan_and_empty_file_omit_region_or_location() {
        let mut zero = finding("side-tab", "a.html", "snip", 0.0);
        let log = parse(&[zero.clone()], None);
        let phys = &result_at(&log, 0)["locations"][0]["physicalLocation"];
        assert!(phys.get("region").is_none(), "{phys}");
        zero.line = f64::NAN;
        let log = parse(&[zero.clone()], None);
        assert!(result_at(&log, 0)["locations"][0]["physicalLocation"]
            .get("region")
            .is_none());
        zero.line = f64::INFINITY;
        let log = parse(&[zero], None);
        assert!(result_at(&log, 0)["locations"][0]["physicalLocation"]
            .get("region")
            .is_none());
        let bare = finding("side-tab", "", "snip", 4.0);
        let log = parse(&[bare], None);
        assert!(result_at(&log, 0).get("locations").is_none());
    }

    #[test]
    fn workspace_relativizes_and_urls_stay_absolute() {
        let nested = finding("side-tab", "src/card.html", "snip", 2.0);
        let log = parse(&[nested], Some("/repo"));
        let art = &result_at(&log, 0)["locations"][0]["physicalLocation"]["artifactLocation"];
        assert_eq!(art["uri"], "src/card.html");
        let outside_cwd = finding("side-tab", "/ws/packages/web/src/card.html", "snip", 2.0);
        let text = format_sarif(
            &[outside_cwd],
            &catalog(),
            "/ws/packages/web",
            Some("/ws"),
            "1",
            true,
        );
        let log: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(
            result_at(&log, 0)["locations"][0]["physicalLocation"]["artifactLocation"]["uri"],
            "packages/web/src/card.html"
        );
        let url = finding("side-tab", "https://example.com/a?b=1", "snip", 1.0);
        let log = parse(&[url], Some("/repo"));
        let art = &result_at(&log, 0)["locations"][0]["physicalLocation"]["artifactLocation"];
        assert_eq!(art["uri"], "https://example.com/a?b=1");
        assert!(art.get("uriBaseId").is_none(), "{art}");
    }

    #[test]
    fn paths_encode_spaces_and_fragments() {
        let spaced = finding("side-tab", "my file#1.html", "snip", 1.0);
        let log = parse(&[spaced], None);
        assert_eq!(
            result_at(&log, 0)["locations"][0]["physicalLocation"]["artifactLocation"]["uri"],
            "my%20file%231.html"
        );
    }

    #[test]
    fn fractional_line_floors_to_an_integer() {
        let f = finding("side-tab", "a.html", "snip", 2.9);
        let log = parse(&[f], None);
        assert_eq!(
            result_at(&log, 0)["locations"][0]["physicalLocation"]["region"]["startLine"],
            2
        );
    }

    #[test]
    fn two_hits_of_one_rule_share_a_descriptor() {
        let findings = vec![
            finding("side-tab", "a.html", "one", 1.0),
            finding("side-tab", "b.html", "two", 2.0),
        ];
        let log = parse(&findings, None);
        assert_eq!(
            log["runs"][0]["tool"]["driver"]["rules"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(result_at(&log, 0)["ruleIndex"], 0);
        assert_eq!(result_at(&log, 1)["ruleIndex"], 0);
        assert_eq!(log["runs"][0]["results"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn a_rule_missing_from_the_catalog_still_gets_a_descriptor() {
        let custom = Finding {
            antipattern: "custom-pack-rule".into(),
            name: "Custom rule".into(),
            description: "Custom help.".into(),
            severity: "warning".into(),
            category: Some("pack".into()),
            file: "a.html".into(),
            line: 3.0,
            snippet: "snip".into(),
            advisory: None,
            extras: serde_json::Map::new(),
        };
        let log = parse(&[custom], None);
        let rule = &log["runs"][0]["tool"]["driver"]["rules"][0];
        assert_eq!(rule["id"], "custom-pack-rule");
        assert_eq!(rule["shortDescription"]["text"], "Custom rule");
        assert_eq!(rule["help"]["text"], "Custom help.");
        assert_eq!(rule["properties"]["category"], "pack");
        assert_eq!(result_at(&log, 0)["ruleIndex"], 0);
    }

    #[test]
    fn snippet_or_description_alone_is_the_message() {
        let mut only_snippet = finding("side-tab", "a.html", "snip", 1.0);
        only_snippet.description.clear();
        let log = parse(&[only_snippet], None);
        assert_eq!(result_at(&log, 0)["message"]["text"], "snip");
        let only_desc = finding("side-tab", "a.html", "", 1.0);
        let expected = only_desc.description.clone();
        let log = parse(&[only_desc], None);
        assert_eq!(result_at(&log, 0)["message"]["text"], expected);
    }

    #[test]
    fn a_path_outside_the_workspace_is_a_file_uri_without_srcroot() {
        let outside = finding("side-tab", "/elsewhere/my card.html", "snip", 1.0);
        let text = format_sarif(&[outside], &catalog(), "/repo", Some("/repo"), "1", true);
        let log: Value = serde_json::from_str(&text).unwrap();
        let art = &result_at(&log, 0)["locations"][0]["physicalLocation"]["artifactLocation"];
        assert_eq!(art["uri"], "file:///elsewhere/my%20card.html");
        assert!(art.get("uriBaseId").is_none(), "{art}");
        assert_eq!(
            absolute_file_path("C:\\work\\a.html").as_deref(),
            Some("/C:/work/a.html")
        );
        assert_eq!(absolute_file_path("src/a.html"), None);
    }

    #[test]
    fn invocation_reports_whether_every_target_was_scanned() {
        let log = parse(&[], None);
        let inv = &log["runs"][0]["invocations"][0];
        assert_eq!(inv["executionSuccessful"], true);
        assert!(inv.get("toolExecutionNotifications").is_none(), "{inv}");

        let text = format_sarif(&[], &catalog(), "/repo", None, "1", false);
        let log: Value = serde_json::from_str(&text).unwrap();
        let inv = &log["runs"][0]["invocations"][0];
        assert_eq!(inv["executionSuccessful"], false);
        assert_eq!(inv["toolExecutionNotifications"][0]["level"], "error");
        assert_eq!(
            inv["toolExecutionNotifications"][0]["message"]["text"],
            PARTIAL_SCAN_NOTE
        );
    }
}
