//! The `detect` feature's exports, exercised natively (a `#[wasm_bindgen]`
//! function is a plain Rust function off the wasm target): the JSON shapes,
//! the options object, and a rule pack installed through `set_rule_pack`.

use impeccable_core::findings::{finding_for, Finding};
use impeccable_core::registry::Antipattern;
use impeccable_core::rule_pack::RulePack;
use impeccable_wasm::exports_detect::{detect_html_source_json, detect_text_json};
use serde_json::Value;

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
            .filter(|(_, line)| line.contains("TODO(pack)"))
            .map(|(i, line)| finding_for(&ROWS[0], file_path, line.trim(), (i + 1) as f64))
            .collect()
    }
}

const SOURCE: &str = ".card { border-left: 4px solid #6366f1; }\n";
const PAGE: &str = "<!DOCTYPE html>\n<html><head><title>t</title><style>\n.card { border-left: 4px solid #6366f1; }\n</style></head>\n<body><div class=\"card\">A card</div></body></html>\n";

fn ids(json: &str) -> Vec<String> {
    serde_json::from_str::<Vec<Value>>(json)
        .expect("findings JSON")
        .into_iter()
        .map(|f| f["antipattern"].as_str().unwrap_or_default().to_string())
        .collect()
}

#[test]
fn text_export_shape() {
    let json = detect_text_json(SOURCE, "src/Card.css", "{}");
    let findings: Vec<Value> = serde_json::from_str(&json).unwrap();
    assert!(!findings.is_empty());
    let first = &findings[0];
    for key in [
        "antipattern",
        "name",
        "description",
        "severity",
        "category",
        "file",
        "line",
        "snippet",
    ] {
        assert!(first.get(key).is_some(), "missing {key} in {first}");
    }
    assert_eq!(first["file"], "src/Card.css");
    // Bad options JSON falls back to the defaults instead of failing.
    assert_eq!(
        ids(&detect_text_json(SOURCE, "src/Card.css", "not json")),
        ids(&json)
    );
    assert_eq!(
        ids(&detect_text_json(SOURCE, "src/Card.css", "")),
        ids(&json)
    );
}

#[test]
fn html_export_shape() {
    let json = detect_html_source_json(PAGE, "index.html", "{}");
    let findings: Vec<Value> = serde_json::from_str(&json).unwrap();
    assert!(!findings.is_empty(), "{json}");
    assert_eq!(findings[0]["file"], "index.html");
}

#[test]
fn inline_ignores_option() {
    let waived =
        ".card { /* impeccable-disable-line side-tab */ border-left: 4px solid #6366f1; }\n";
    assert!(ids(&detect_text_json(waived, "a.css", "{}")).is_empty());
    assert!(!ids(&detect_text_json(
        waived,
        "a.css",
        "{\"inlineIgnores\":false}"
    ))
    .is_empty());
}

#[test]
fn design_system_option_is_the_design_md_inputs() {
    let source = "h1 { font-family: 'Comic Sans MS'; }\n";
    let options = serde_json::json!({
        "designSystem": {
            "frontmatter": { "typography": { "display": { "fontFamily": "Fraunces, serif" } } }
        }
    })
    .to_string();
    let with_ds = ids(&detect_text_json(source, "a.css", &options));
    assert!(
        with_ds.iter().any(|id| id == "design-system-font"),
        "{with_ds:?}"
    );
    assert!(!ids(&detect_text_json(source, "a.css", "{}"))
        .iter()
        .any(|id| id == "design-system-font"));
}

#[test]
fn installed_pack_reaches_the_exports() {
    let source = format!("{SOURCE}/* TODO(pack) real palette */\n");
    assert!(!ids(&detect_text_json(&source, "a.css", "{}"))
        .iter()
        .any(|id| id.starts_with("testpack/")));

    impeccable_wasm::set_rule_pack(&PACK);
    let with_pack = ids(&detect_text_json(&source, "a.css", "{}"));
    assert!(
        with_pack.iter().any(|id| id == "testpack/todo-marker"),
        "{with_pack:?}"
    );

    // The registry export carries the pack's row after the built-ins.
    let rows: Vec<Value> = serde_json::from_str(&impeccable_wasm::antipatterns_json()).unwrap();
    assert_eq!(rows[0]["id"], "side-tab");
    assert_eq!(rows[rows.len() - 1]["id"], "testpack/todo-marker");
}
