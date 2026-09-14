use impeccable_detect::detect_text::{detect_text, TextOptions};
use impeccable_detect::engines::{HtmlEngine, ScanOptions};
use impeccable_html::StaticHtmlEngine;
use std::path::Path;

#[test]
fn templates_preserve_text_findings_and_clean_utility_components() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/antipatterns");
    for name in [
        "astro-inset-shadow-stripe.astro",
        "pseudo-stripe.vue",
        "vue-should-flag.vue",
        "svelte-should-flag.svelte",
        "vue-should-pass.vue",
        "svelte-should-pass.svelte",
    ] {
        let path = root.join(name);
        let path = path.to_str().unwrap();
        let source = std::fs::read_to_string(path).unwrap();
        let text = detect_text(&source, path, &TextOptions::default());
        let actual = StaticHtmlEngine::default()
            .detect_html(path, &ScanOptions::default(), &mut std::io::sink())
            .unwrap();
        for finding in &text {
            assert!(actual.contains(finding), "{name} lost {finding:?}");
        }
        if name.contains("should-pass") {
            assert!(actual.is_empty(), "{name}: {actual:?}");
        }
        assert!(
            !actual
                .iter()
                .any(|f| f.antipattern == "low-contrast" && f.snippet.contains("1.0:1")),
            "{name}: {actual:?}"
        );
    }
}

fn scan(source: &str, path: &str) -> Vec<impeccable_core::findings::Finding> {
    StaticHtmlEngine::default()
        .detect_html_source(
            source,
            path,
            &ScanOptions {
                inline_ignores: true,
                ..Default::default()
            },
            &mut std::io::sink(),
        )
        .unwrap()
}

#[test]
fn nested_scss_keeps_text_coverage() {
    let source = "<template><div class=\"card\">Card</div></template>\n<style lang=\"scss\">\n.card {\n .title { border-left: 4px solid #6366f1; }\n}\n</style>";
    let expected = detect_text(
        source,
        "Card.vue",
        &TextOptions {
            inline_ignores: true,
            ..Default::default()
        },
    );
    assert!(!expected.is_empty());
    assert_eq!(scan(source, "Card.vue"), expected);
}

#[test]
fn dom_only_findings_have_distinct_source_lines() {
    let source = "<a style=\"color:#ccc;background:#fff\">low contrast</a>\n<a style=\"color:#ccc;background:#fff\">low contrast</a>";
    for path in [
        "Page.vue",
        "Page.svelte",
        "Page.astro",
        "page.blade.php",
        "page.html.erb",
    ] {
        let findings = scan(source, path);
        let lines: Vec<_> = findings
            .iter()
            .filter(|f| f.antipattern == "low-contrast")
            .map(|f| f.line)
            .collect();
        assert_eq!(lines, vec![1.0, 2.0], "{path}: {findings:?}");
    }
}

#[test]
fn full_page_copy_analyzers_cover_multipart_templates() {
    let source = "<!doctype html><html><body><p>Unlock your potential. Seamlessly leverage cutting-edge solutions. Empower your journey with game-changing innovation. Revolutionize your workflow with next-generation technology.</p></body></html>";
    let html = scan(source, "page.html");
    assert!(
        html.iter().any(|f| f.antipattern == "marketing-buzzword"),
        "{html:?}"
    );
    for path in ["page.blade.php", "page.html.erb"] {
        assert!(
            scan(source, path)
                .iter()
                .any(|f| f.antipattern == "marketing-buzzword"),
            "{path}"
        );
    }
}

#[test]
fn inline_waivers_apply_to_dom_additions() {
    let source = "<!-- impeccable-disable-next-line low-contrast: intentional test -->\n<a style=\"color:#ccc;background:#fff\">low contrast</a>";
    assert!(!scan(source, "Card.vue")
        .iter()
        .any(|f| f.antipattern == "low-contrast"));
}
