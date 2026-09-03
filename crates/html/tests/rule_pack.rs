//! The static HTML engine's half of the rule-pack extension point: the
//! document hook runs on the parsed page after every built-in pass, the
//! engine-wide text hook covers HTML files when no document hook is set, and
//! a run with no pack is identical to the built-in output.

use impeccable_core::findings::{finding_for, Finding};
use impeccable_core::registry::Antipattern;
use impeccable_core::rule_pack::RulePack;
use impeccable_html::dom::StaticDocument;
use impeccable_html::{detect_html_source, DetectHtmlOptions, StaticRulePack};
use std::path::Path;

const MARKER: &str = "TODO(pack)";

static ROWS: &[Antipattern] = &[Antipattern {
    id: "testpack/todo-marker",
    category: "quality",
    scopes: None,
    severity: Some("warning"),
    advisory: false,
    name: "Unfinished copy marker",
    description: "Text still carries a TODO marker from drafting.",
    skill_section: None,
    skill_guideline: None,
}];

#[derive(Debug)]
struct TestPack;
static PACK: TestPack = TestPack;

impl RulePack for TestPack {
    fn registry(&self) -> &'static [Antipattern] {
        ROWS
    }
    fn check_text(&self, content: &str, file_path: &str, _ext: &str) -> Vec<Finding> {
        content
            .split('\n')
            .enumerate()
            .filter(|(_, line)| line.contains(MARKER))
            .map(|(i, line)| finding_for(&ROWS[0], file_path, line.trim(), (i + 1) as f64))
            .collect()
    }
}

impl StaticRulePack for TestPack {
    fn check_document(&self, doc: &StaticDocument, file_path: &str) -> Vec<Finding> {
        doc.query_selector_all("*")
            .into_iter()
            .filter(|el| el.direct_text().contains(MARKER))
            .map(|el| {
                finding_for(
                    &ROWS[0],
                    file_path,
                    &format!("<{}> {}", el.tag_lower(), el.direct_text().trim()),
                    0.0,
                )
            })
            .collect()
    }
}

/// A full page with one built-in finding (the side-tab stripe) plus a line
/// the pack is about.
const PAGE: &str = r#"<!DOCTYPE html>
<html><head><title>t</title><style>
.card { border-left: 4px solid #6366f1; background: #fff; }
</style></head>
<body>
<div class="card">A card</div>
<p>TODO(pack) write the real headline</p>
</body></html>
"#;

fn scan(options: &DetectHtmlOptions<'_>) -> Vec<Finding> {
    detect_html_source(PAGE, Path::new("/app/index.html"), options)
}

#[test]
fn document_hook_fires_and_no_pack_is_unchanged() {
    let built_in = scan(&DetectHtmlOptions::default());
    assert!(
        !built_in.is_empty(),
        "the fixture must trip a built-in rule"
    );

    impeccable_core::rule_pack::install(&PACK);
    let with_pack = scan(&DetectHtmlOptions {
        static_rule_pack: Some(&PACK),
        rule_pack: Some(&PACK),
        ..Default::default()
    });

    // Built-in findings come first, unchanged, in the same order.
    assert_eq!(&with_pack[..built_in.len()], &built_in[..]);

    // Exactly one pack finding: the document hook wins over the text hook, so
    // a pack that implements both does not report the same file twice.
    let extra = &with_pack[built_in.len()..];
    assert_eq!(extra.len(), 1);
    assert_eq!(extra[0].antipattern, "testpack/todo-marker");
    assert_eq!(extra[0].snippet, "<p> TODO(pack) write the real headline");
    assert_eq!(extra[0].line, 0.0);
}

#[test]
fn text_hook_covers_html_when_no_document_hook_is_set() {
    impeccable_core::rule_pack::install(&PACK);
    let with_text_only = scan(&DetectHtmlOptions {
        rule_pack: Some(&PACK),
        ..Default::default()
    });
    let pack_findings: Vec<&Finding> = with_text_only
        .iter()
        .filter(|f| f.antipattern.starts_with("testpack/"))
        .collect();
    assert_eq!(pack_findings.len(), 1);
    // The text hook reports the source line, not the element.
    assert_eq!(pack_findings[0].line, 7.0);
    assert_eq!(
        pack_findings[0].snippet,
        "<p>TODO(pack) write the real headline</p>"
    );
}

#[test]
fn pack_findings_are_waivable_inline() {
    impeccable_core::rule_pack::install(&PACK);
    let page = PAGE.replace(
        "<body>",
        "<body>\n<!-- impeccable-disable testpack/todo-marker -->",
    );
    let findings = detect_html_source(
        &page,
        Path::new("/app/index.html"),
        &DetectHtmlOptions {
            static_rule_pack: Some(&PACK),
            ..Default::default()
        },
    );
    assert!(findings
        .iter()
        .all(|f| !f.antipattern.starts_with("testpack/")));
}
