//! GitHub Actions workflow commands for `impeccable detect --github`.
//!
//! One annotation per finding, on stdout. Encoding follows
//! https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions
//! : `%`, `\r`, `\n` in every value; `:` and `,` also in parameter values.

use std::path::{Path, PathBuf};

use impeccable_core::findings::Finding;
use impeccable_core::js::number_to_string;

pub const GITHUB_JSON_CONFLICT: &str = "Error: --github cannot be used with --json\n";
pub const GITHUB_LIST_RULES_CONFLICT: &str =
    "Error: --github annotates scan findings and cannot be used with --list-rules\n";

/// `%` first so a later replacement is not itself percent-encoded.
pub fn escape_data(value: &str) -> String {
    value
        .replace('%', "%25")
        .replace('\r', "%0D")
        .replace('\n', "%0A")
}

pub fn escape_property(value: &str) -> String {
    escape_data(value).replace(':', "%3A").replace(',', "%2C")
}

fn is_advisory(finding: &Finding) -> bool {
    finding.advisory == Some(true) || finding.severity == "advisory"
}

fn workflow_command(finding: &Finding) -> &'static str {
    if is_advisory(finding) {
        "notice"
    } else if finding.severity == "error" {
        "error"
    } else {
        "warning"
    }
}

fn strip_root(path: &Path, root: &Path) -> Option<String> {
    path.strip_prefix(root).ok().and_then(|rel| {
        if rel.as_os_str().is_empty() {
            None
        } else {
            Some(rel.to_string_lossy().replace('\\', "/"))
        }
    })
}

/// Path GitHub should annotate: relative to `GITHUB_WORKSPACE` when that is
/// a prefix, else relative to cwd. URLs and empty paths stay as given.
pub fn annotation_file(file: &str, cwd: &str, workspace: Option<&str>) -> String {
    if file.is_empty() || file.contains("://") {
        return file.replace('\\', "/");
    }
    let file_path = Path::new(file);
    let abs: PathBuf = if file_path.is_absolute() {
        file_path.to_path_buf()
    } else {
        Path::new(cwd).join(file_path)
    };
    if let Some(ws) = workspace.filter(|s| !s.is_empty()) {
        if let Some(rel) = strip_root(&abs, Path::new(ws)) {
            return rel;
        }
    }
    if let Some(rel) = strip_root(&abs, Path::new(cwd)) {
        return rel;
    }
    file.replace('\\', "/")
}

fn annotation_line(line: f64) -> Option<String> {
    if line == 0.0 || !line.is_finite() {
        None
    } else {
        Some(number_to_string(line))
    }
}

fn annotation_message(finding: &Finding) -> String {
    let mut msg = format!("[{}]", finding.antipattern);
    if !finding.snippet.is_empty() {
        msg.push(' ');
        msg.push_str(&finding.snippet);
    }
    if !finding.description.is_empty() {
        msg.push('\n');
        msg.push_str(&finding.description);
    }
    msg
}

pub fn format_annotation(finding: &Finding, cwd: &str, workspace: Option<&str>) -> String {
    let command = workflow_command(finding);
    let mut props: Vec<String> = Vec::new();
    let file = annotation_file(&finding.file, cwd, workspace);
    if !file.is_empty() {
        props.push(format!("file={}", escape_property(&file)));
    }
    if let Some(line) = annotation_line(finding.line) {
        props.push(format!("line={}", escape_property(&line)));
    }
    if !finding.name.is_empty() {
        props.push(format!("title={}", escape_property(&finding.name)));
    }
    let value = escape_data(&annotation_message(finding));
    if props.is_empty() {
        format!("::{command}::{value}")
    } else {
        format!("::{command} {}::{value}", props.join(","))
    }
}

/// One workflow command per finding, in scan order. Empty when there are
/// none. Always a trailing newline when there is at least one annotation.
pub fn format_github_annotations(
    findings: &[Finding],
    cwd: &str,
    workspace: Option<&str>,
) -> String {
    let mut out = String::new();
    for finding in findings {
        out.push_str(&format_annotation(finding, cwd, workspace));
        out.push('\n');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use impeccable_core::findings::finding;

    #[test]
    fn data_encodes_percent_and_newlines_but_keeps_colon_comma() {
        assert_eq!(escape_data("a%b\nc,d:e\r"), "a%25b%0Ac,d:e%0D");
    }

    #[test]
    fn properties_also_encode_colon_and_comma() {
        assert_eq!(escape_property("C:\\x,y"), "C%3A\\x%2Cy");
        assert_eq!(escape_property("a%b"), "a%25b");
    }

    #[test]
    fn percent_is_encoded_before_other_escapes() {
        assert_eq!(escape_data("%0A"), "%250A");
        assert_eq!(escape_property("%3A"), "%253A");
    }

    #[test]
    fn warning_omits_line_zero_and_relativizes_to_cwd() {
        let f = finding("side-tab", "/repo/src/card.html", "border-left: 4px", 0.0);
        let line = format_annotation(&f, "/repo", None);
        assert!(line.starts_with("::warning file=src/card.html,title=Side-tab accent border::"));
        assert!(!line.contains("line="));
        assert!(line.contains("[side-tab] border-left: 4px%0A"));
        assert!(line.contains("Thick colored border"));
    }

    #[test]
    fn warning_includes_a_real_line() {
        let f = finding("side-tab", "card.html", "snip", 12.0);
        let line = format_annotation(&f, "/repo", None);
        assert!(line.contains("file=card.html"));
        assert!(line.contains("line=12"));
        assert!(line.starts_with("::warning "));
    }

    #[test]
    fn nan_and_infinite_lines_are_omitted() {
        let mut f = finding("side-tab", "a.html", "s", 1.0);
        f.line = f64::NAN;
        assert!(!format_annotation(&f, "/x", None).contains("line="));
        f.line = f64::INFINITY;
        assert!(!format_annotation(&f, "/x", None).contains("line="));
    }

    #[test]
    fn advisory_is_a_notice_and_error_is_an_error() {
        let adv = finding("em-dash-overuse", "copy.html", "—", 3.0);
        assert!(format_annotation(&adv, "/x", None).starts_with("::notice "));
        let err = finding("script-error", "app.js", "TypeError: x", 8.0);
        assert!(format_annotation(&err, "/x", None).starts_with("::error "));
    }

    #[test]
    fn github_workspace_wins_over_cwd() {
        let f = finding("side-tab", "/ws/packages/web/src/card.html", "snip", 2.0);
        let line = format_annotation(&f, "/ws/packages/web", Some("/ws"));
        assert!(line.contains("file=packages/web/src/card.html"));
        assert!(!line.contains("file=/ws/"));
    }

    #[test]
    fn relative_file_joins_cwd_before_stripping_workspace() {
        let f = finding("side-tab", "src/card.html", "snip", 1.0);
        let line = format_annotation(&f, "/ws/packages/web", Some("/ws"));
        assert!(line.contains("file=packages/web/src/card.html"));
    }

    #[test]
    fn urls_are_not_rewritten() {
        let f = finding("side-tab", "https://example.com/x", "snip", 1.0);
        let line = format_annotation(&f, "/repo", Some("/repo"));
        assert!(line.contains("file=https%3A//example.com/x"));
    }

    #[test]
    fn title_and_file_escape_colon_and_comma() {
        let mut f = finding("side-tab", "src/a,b.html", "k:v,w", 1.0);
        f.name = "A, B: C".into();
        let line = format_annotation(&f, "/repo", None);
        assert!(line.contains("file=src/a%2Cb.html"));
        assert!(line.contains("title=A%2C B%3A C"));
        // The message keeps colon and comma; only percent-encodes newlines.
        assert!(line.contains("[side-tab] k:v,w%0A"));
    }

    #[test]
    fn catalog_is_one_line_per_finding_in_order() {
        let findings = vec![
            finding("side-tab", "a.html", "one", 1.0),
            finding("em-dash-overuse", "a.html", "two", 2.0),
        ];
        let text = format_github_annotations(&findings, "/x", None);
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].starts_with("::warning "));
        assert!(lines[1].starts_with("::notice "));
        assert!(text.ends_with('\n'));
        assert_eq!(format_github_annotations(&[], "/x", None), "");
    }
}
