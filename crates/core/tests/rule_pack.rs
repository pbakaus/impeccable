//! The browser half of the rule-pack extension point: a test pack's element
//! and page hooks fire in the driver's loop, its findings group and filter
//! like built-in ones, and a run with no pack installed is byte-identical to
//! what the built-ins produce on their own.

use impeccable_core::browser::fake_dom::FakeDom;
use impeccable_core::browser::{driver, BrowserConfig, BrowserFinding, ElFinding, ElId};
use impeccable_core::registry::Antipattern;
use impeccable_core::rule_pack::RulePack;

const MARKER: &str = "TODO(pack)";

static ROWS: &[Antipattern] = &[
    Antipattern {
        id: "testpack/todo-marker",
        category: "quality",
        scopes: None,
        severity: Some("warning"),
        name: "Unfinished copy marker",
        description: "Text still carries a TODO marker from drafting.",
        skill_section: None,
        skill_guideline: None,
    },
    Antipattern {
        id: "testpack/page-todo-marker",
        category: "quality",
        scopes: None,
        severity: Some("warning"),
        name: "Page ships an unfinished copy marker",
        description: "Somewhere on the page, text still carries a TODO marker.",
        skill_section: None,
        skill_guideline: None,
    },
];

#[derive(Debug)]
struct TestPack;

static PACK: TestPack = TestPack;

impl RulePack for TestPack {
    fn registry(&self) -> &'static [Antipattern] {
        ROWS
    }

    fn check_element_dom(
        &self,
        dom: &dyn impeccable_core::browser::Dom,
        el: ElId,
    ) -> Vec<BrowserFinding> {
        let text = dom.direct_text_nodes(el).concat();
        if text.contains(MARKER) {
            vec![BrowserFinding::new(
                "testpack/todo-marker",
                format!("<{}> {}", dom.tag_name(el).to_lowercase(), text.trim()),
            )]
        } else {
            Vec::new()
        }
    }

    fn check_page_dom(&self, dom: &dyn impeccable_core::browser::Dom) -> Vec<ElFinding> {
        let hit = dom
            .query_all(None, "*")
            .unwrap_or_default()
            .into_iter()
            .find(|el| dom.direct_text_nodes(*el).concat().contains(MARKER));
        match hit {
            Some(el) => vec![ElFinding {
                el: Some(el),
                finding: BrowserFinding::new(
                    "testpack/page-todo-marker",
                    "1 unfinished copy marker on the page",
                ),
            }],
            None => Vec::new(),
        }
    }
}

fn page() -> (FakeDom, ElId) {
    let mut dom = FakeDom::new();
    let (_html, body) = dom.with_page();
    let p = dom.add(Some(body), "p");
    dom.add_text(p, "TODO(pack) write the real headline");
    let ok = dom.add(Some(body), "p");
    dom.add_text(ok, "Shipping copy.");
    (dom, p)
}

fn findings_of(result: &driver::CollectResult, el: ElId) -> Vec<String> {
    result
        .groups
        .iter()
        .filter(|g| g.el == el)
        .flat_map(|g| g.findings.iter().map(|f| f.type_.clone()))
        .collect()
}

#[test]
fn element_and_page_hooks_fire_and_no_pack_is_unchanged() {
    let (dom, p) = page();

    let built_in = driver::collect_browser_findings(&dom, &BrowserConfig::default());
    assert!(
        !findings_of(&built_in, p)
            .iter()
            .any(|id| id.starts_with("testpack/")),
        "a pack that is not installed must not be consulted"
    );

    impeccable_core::rule_pack::install(&PACK);
    let with_pack = driver::collect_browser_findings(
        &dom,
        &BrowserConfig {
            rule_pack: Some(&PACK),
            ..Default::default()
        },
    );

    // The element hook fired, on the element that carries the marker only.
    let on_p = findings_of(&with_pack, p);
    assert!(
        on_p.contains(&"testpack/todo-marker".to_string()),
        "{on_p:?}"
    );
    let marker_hits: Vec<&str> = with_pack
        .groups
        .iter()
        .flat_map(|g| g.findings.iter())
        .filter(|f| f.type_ == "testpack/todo-marker")
        .map(|f| f.detail.as_str())
        .collect();
    assert_eq!(marker_hits, vec!["<p> TODO(pack) write the real headline"]);

    // The page hook fired, attributed to the element it named.
    assert!(findings_of(&with_pack, p).contains(&"testpack/page-todo-marker".to_string()));

    // Built-in findings are untouched: same elements in the same order with
    // the same rules, the pack's rows appended. A group the pack is alone in
    // is new, which is why empty remainders drop out of the comparison.
    let strip = |r: &driver::CollectResult| -> Vec<(ElId, Vec<String>)> {
        r.groups
            .iter()
            .map(|g| {
                let ids: Vec<String> = g
                    .findings
                    .iter()
                    .map(|f| f.type_.clone())
                    .filter(|id| !id.starts_with("testpack/"))
                    .collect();
                (g.el, ids)
            })
            .filter(|(_, ids)| !ids.is_empty())
            .collect()
    };
    assert_eq!(strip(&built_in), strip(&with_pack));
    assert_eq!(built_in.page_level, with_pack.page_level);

    // Pack rows resolve in the registry, so a serialized finding carries the
    // pack's name and description.
    let row = impeccable_core::registry::get_antipattern("testpack/todo-marker").unwrap();
    assert_eq!(row.name, "Unfinished copy marker");
}

#[test]
fn pack_findings_honor_the_disabled_rules_list() {
    let (dom, p) = page();
    impeccable_core::rule_pack::install(&PACK);
    let result = driver::collect_browser_findings(
        &dom,
        &BrowserConfig {
            rule_pack: Some(&PACK),
            extension_mode: true,
            disabled_rules: vec!["testpack/todo-marker".to_string()],
            ..Default::default()
        },
    );
    let on_p = findings_of(&result, p);
    assert!(
        !on_p.contains(&"testpack/todo-marker".to_string()),
        "{on_p:?}"
    );
    // The page rule is a different id and still reports.
    assert!(
        on_p.contains(&"testpack/page-todo-marker".to_string()),
        "{on_p:?}"
    );
}

#[test]
fn skip_scan_skips_the_pack_too() {
    let (dom, _p) = page();
    impeccable_core::rule_pack::install(&PACK);
    let result = driver::collect_browser_findings(
        &dom,
        &BrowserConfig {
            rule_pack: Some(&PACK),
            extension_mode: true,
            skip_scan: true,
            ..Default::default()
        },
    );
    assert!(result.groups.is_empty() && result.page_level.is_empty());
}
