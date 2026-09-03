//! The text engine's half of the rule-pack extension point: the pack's
//! `check_text` hook runs on every scanned source file after the built-in
//! matchers, its findings are waivable with `impeccable-disable`, and a run
//! with no pack is identical to the built-in output.

use impeccable_core::findings::{finding_for, Finding};
use impeccable_core::registry::Antipattern;
use impeccable_core::rule_pack::RulePack;
use impeccable_detect::detect_text::{detect_text, TextOptions};

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
    fn check_text(&self, content: &str, file_path: &str, ext: &str) -> Vec<Finding> {
        // `ext` proves the hook is told what kind of file this is.
        assert!(ext.is_empty() || ext.starts_with('.'), "ext = {ext:?}");
        content
            .split('\n')
            .enumerate()
            .filter(|(_, line)| line.contains(MARKER))
            .map(|(i, line)| finding_for(&ROWS[0], file_path, line.trim(), (i + 1) as f64))
            .collect()
    }
}

/// A file with one built-in finding (the CSS-in-JS side stripe on line 2) and
/// one line for the pack.
const SOURCE: &str = "const Card = styled.div`\n  border-left: 4px solid red;\n`;\nexport const copy = \"TODO(pack) write the real headline\";\n";

fn scan(rule_pack: Option<&'static dyn RulePack>) -> Vec<Finding> {
    detect_text(
        SOURCE,
        "/app/Card.tsx",
        &TextOptions {
            inline_ignores: true,
            rule_pack,
            ..Default::default()
        },
    )
}

#[test]
fn text_hook_fires_and_no_pack_is_unchanged() {
    let built_in = scan(None);
    assert!(
        !built_in.is_empty(),
        "the fixture must trip a built-in rule"
    );
    assert!(built_in
        .iter()
        .all(|f| !f.antipattern.starts_with("testpack/")));

    impeccable_core::rule_pack::install(&PACK);
    let with_pack = scan(Some(&PACK));

    // Built-in findings come first, unchanged, in the same order.
    assert_eq!(&with_pack[..built_in.len()], &built_in[..]);

    let extra = &with_pack[built_in.len()..];
    assert_eq!(extra.len(), 1);
    assert_eq!(extra[0].antipattern, "testpack/todo-marker");
    assert_eq!(extra[0].name, "Unfinished copy marker");
    assert_eq!(extra[0].severity, "warning");
    assert_eq!(extra[0].category.as_deref(), Some("quality"));
    assert_eq!(extra[0].file, "/app/Card.tsx");
    assert_eq!(extra[0].line, 4.0);
    assert_eq!(
        extra[0].snippet,
        "export const copy = \"TODO(pack) write the real headline\";"
    );

    // The pack's rows serialize like built-in rows.
    let json = serde_json::to_string(&extra[0]).unwrap();
    assert!(
        json.starts_with("{\"antipattern\":\"testpack/todo-marker\""),
        "{json}"
    );
}

#[test]
fn pack_findings_are_waivable_inline() {
    impeccable_core::rule_pack::install(&PACK);
    let source = format!(
        "// impeccable-disable-next-line testpack/todo-marker\nconst copy = \"{MARKER} later\";\n"
    );
    let waived = detect_text(
        &source,
        "/app/copy.ts",
        &TextOptions {
            inline_ignores: true,
            rule_pack: Some(&PACK),
            ..Default::default()
        },
    );
    assert!(waived.is_empty(), "{waived:?}");

    let unwaived = detect_text(
        &source,
        "/app/copy.ts",
        &TextOptions {
            inline_ignores: false,
            rule_pack: Some(&PACK),
            ..Default::default()
        },
    );
    assert_eq!(unwaived.len(), 1);
    assert_eq!(unwaived[0].antipattern, "testpack/todo-marker");
}
