use impeccable_html::{detect_html_source, DetectHtmlOptions};
use std::path::Path;

#[test]
fn shadow_list_fixture_has_only_four_valid_advisories() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/hard-offset-shadow/lists.html");
    let html = std::fs::read_to_string(&path).unwrap();
    let findings = detect_html_source(&html, &path, &DetectHtmlOptions::default());
    let hits: Vec<_> = findings.iter().filter(|f| f.antipattern == "hard-offset-shadow").collect();
    assert_eq!(hits.len(), 4, "{hits:#?}");
    assert!(hits.iter().all(|f| f.advisory == Some(true) && f.severity == "advisory"));
}

#[test]
fn invalid_shadow_lists_do_not_report_valid_looking_layers() {
    for invalid in ["0 0 -1px black", "4px black", "4px 4px red blue", "none", ""] {
        for shadow in [
            format!("{invalid}, 4px 4px black"),
            format!("4px 4px black, {invalid}"),
        ] {
            let html = format!("<div style='width:220px;height:96px;box-shadow:{shadow}'>Invalid shadow</div>");
            let findings = detect_html_source(&html, Path::new("/tmp/invalid-shadow.html"), &DetectHtmlOptions::default());
            assert!(!findings.iter().any(|f| f.antipattern == "hard-offset-shadow"), "{shadow}: {findings:#?}");
        }
    }
}

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

#[test]
fn named_and_functional_colors_survive_the_static_cascade() {
    for (shadow, expected) in [
        ("4px 4px red", 1),
        ("gray -4px 4px", 1),
        ("4px 4px rebeccapurple", 1),
        ("4px 4px hwb(0 0% 0%)", 1),
        ("4px 4px color(srgb 1 0 0)", 1),
        ("4px 4px color-mix(in srgb, rgb(255, 0, 0) 50%, blue)", 1),
        ("4px 4px hwb(0 0% 0% / 10%)", 0),
        ("4px 4px transparent", 0),
        ("inset 4px 4px red", 0),
    ] {
        let html = format!("<style>.card {{ width:220px; height:96px; box-shadow:{shadow}; }}</style><div class=card>Color regression</div>");
        let findings = detect_html_source(
            &html,
            Path::new("/tmp/shadow-colors.html"),
            &DetectHtmlOptions::default(),
        );
        let hits: Vec<_> = findings
            .iter()
            .filter(|f| f.antipattern == "hard-offset-shadow")
            .collect();
        assert_eq!(hits.len(), expected, "{shadow}: {hits:#?}");
        assert!(hits
            .iter()
            .all(|f| f.advisory == Some(true) && f.severity == "advisory"));
    }
}

#[test]
fn color_fixture_has_six_advisories_and_no_control_findings() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/hard-offset-shadow/colors.html");
    let html = std::fs::read_to_string(&path).unwrap();
    let findings = detect_html_source(&html, &path, &DetectHtmlOptions::default());
    let hits: Vec<_> = findings
        .iter()
        .filter(|f| f.antipattern == "hard-offset-shadow")
        .collect();
    assert_eq!(hits.len(), 6, "{hits:#?}");
    for paint in [
        "4px 4px red",
        "gray -4px 4px",
        "hwb(0 0% 0%/50%)",
        "color-mix(",
        "4px 4px 0 black",
        "0em black",
    ] {
        assert!(
            hits.iter().any(|f| f.snippet.contains(paint)),
            "{paint}: {hits:#?}"
        );
    }
}
