use impeccable_html::{detect_html_source, DetectHtmlOptions};
use std::path::Path;

#[test]
fn hard_offset_shadow_fixture_is_advisory_and_respects_waivers() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/antipatterns/hard-offset-shadow.html");
    let html = std::fs::read_to_string(&path).unwrap();
    let findings = detect_html_source(&html, &path, &DetectHtmlOptions::default());
    let hits: Vec<_> = findings
        .iter()
        .filter(|f| f.antipattern == "hard-offset-shadow")
        .collect();
    assert_eq!(hits.len(), 4, "{hits:#?}");
    assert!(hits
        .iter()
        .all(|f| f.severity == "advisory" && f.advisory == Some(true)));
}

#[test]
fn scoped_and_comment_waivers_preserve_intentional_shadows() {
    for body in [
        "<section data-impeccable-ignore=hard-offset-shadow><div style='box-shadow:4px 4px #333'>Intentional</div></section>",
        "<!-- impeccable-disable hard-offset-shadow --><div style='box-shadow:4px 4px #333'>Intentional</div>",
        "<div style='display:none'><div style='box-shadow:4px 4px #333'>Hidden</div></div>",
        "<div style='opacity:0'><div style='box-shadow:4px 4px #333'>Invisible</div></div>",
    ] {
        let findings = detect_html_source(body, Path::new("/tmp/hard-shadow.html"), &DetectHtmlOptions::default());
        assert!(!findings.iter().any(|f| f.antipattern == "hard-offset-shadow"), "{findings:#?}");
    }
}
