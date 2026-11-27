use impeccable_html::{detect_html_source, DetectHtmlOptions};
use std::path::Path;

fn contrast_count(css: &str) -> usize {
    let html = format!("<html><head><style>body{{color:#111;background:#fff;font:16px Georgia;margin:40px}}{css}</style></head><body><p>Readable paragraph text.</p></body></html>");
    detect_html_source(
        &html,
        Path::new("/tmp/media-environment.html"),
        &DetectHtmlOptions::default(),
    )
    .iter()
    .filter(|f| f.antipattern == "low-contrast")
    .count()
}

#[test]
fn dark_and_print_do_not_combine() {
    assert_eq!(contrast_count(":root{--ink:#111;--paper:#fff}@media screen and (prefers-color-scheme:dark){:root{--ink:#eee;--paper:#111}}body{color:var(--ink);background:var(--paper)}@media print{body{background:#fff}}"), 0);
}

#[test]
fn inactive_and_unknown_media_do_not_override_screen_styles() {
    for query in [
        "print",
        "speech",
        "(prefers-color-scheme: dark)",
        "(max-width: 1279px)",
        "(min-width: 1281px)",
        "(unknown-feature: yes)",
        "not (unknown-feature: yes)",
        "screen and (min-width: 9000px)",
    ] {
        assert_eq!(
            contrast_count(&format!("@media {query}{{body{{color:#eee}}}}")),
            0,
            "{query}"
        );
    }
}

#[test]
fn active_queries_still_report_real_contrast_errors() {
    for query in [
        "screen",
        "all",
        "only screen",
        "not print",
        "(prefers-color-scheme:light)",
        "(min-width:1280px)",
        "(max-width:1280px)",
        "(width:80em)",
        "(width >= 1280px)",
        "(1000px < width <= 1280px)",
        "print, screen",
        "(unknown-feature:yes), screen",
        "screen and ((min-width:1000px) or (max-width:100px))",
    ] {
        assert_eq!(
            contrast_count(&format!("@media {query}{{body{{color:#eee}}}}")),
            1,
            "{query}"
        );
    }
}

#[test]
fn empty_media_blocks_apply_in_an_active_stylesheet() {
    assert_eq!(contrast_count("@media{body{color:#eee}}"), 1);
    assert_eq!(contrast_count("@media /* all */ {body{color:#eee}}"), 1);
    assert_eq!(contrast_count("@media print{@media{body{color:#eee}}}"), 0);
}

#[test]
fn inactive_parent_stays_inactive_and_layer_contents_are_preserved() {
    assert_eq!(
        contrast_count("@media print{@media screen{body{color:#eee}}}"),
        0
    );
    assert_eq!(
        contrast_count("@layer theme{@media print{body{color:#eee}}}"),
        0
    );
    assert_eq!(
        contrast_count("@media screen{@layer theme{body{color:#eee}}}"),
        1
    );
}

#[test]
fn inactive_variables_do_not_reach_the_root_cascade() {
    assert_eq!(
        contrast_count(":root{--ink:#111}@media print{:root{--ink:#eee}}body{color:var(--ink)}"),
        0
    );
    assert_eq!(
        contrast_count("@media print{:root{--ink:#eee}}:root{--ink:#111}body{color:var(--ink)}"),
        0
    );
}

#[test]
fn media_attributes_on_inline_and_linked_stylesheets_are_respected() {
    let dir = std::env::temp_dir().join(format!("impeccable-media-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("print.css"), "body{color:#eee}").unwrap();
    let html = "<html><head><style>body{color:#111;background:#fff;font:16px Georgia}</style><style media='print'>body{color:#eee}</style><link rel='stylesheet' media='print' href='print.css'></head><body><p>Readable paragraph text.</p></body></html>";
    let findings = detect_html_source(html, &dir.join("index.html"), &DetectHtmlOptions::default());
    std::fs::remove_dir_all(dir).unwrap();
    assert!(
        !findings.iter().any(|f| f.antipattern == "low-contrast"),
        "{findings:?}"
    );
}

#[test]
fn matching_stylesheet_media_still_applies() {
    let html = "<html><head><style>body{color:#111;background:#fff;font:16px Georgia}</style><style media='screen and (min-width:1280px)'>body{color:#eee}</style></head><body><p>Unreadable paragraph text.</p></body></html>";
    let findings = detect_html_source(
        html,
        Path::new("/tmp/media-style.html"),
        &DetectHtmlOptions::default(),
    );
    assert_eq!(
        findings
            .iter()
            .filter(|f| f.antipattern == "low-contrast")
            .count(),
        1
    );
}

#[test]
fn shared_fixture_has_four_real_findings_and_no_inactive_findings() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/antipatterns/static-media-environment.html");
    let html = std::fs::read_to_string(&path).unwrap();
    let findings = detect_html_source(&html, &path, &DetectHtmlOptions::default());
    assert_eq!(
        findings
            .iter()
            .filter(|f| f.antipattern == "low-contrast")
            .count(),
        4,
        "{findings:?}"
    );
}

#[test]
fn negative_media_dimensions_keep_active_contrast_styles() {
    for query in [
        "(width > -1px)",
        "not (max-width: -1px)",
        "(height >= -1em)",
        "(-1rem < width <= 80rem)",
    ] {
        assert_eq!(
            contrast_count(&format!("@media {query}{{body{{color:#eee}}}}")),
            1,
            "{query}"
        );
    }
}

#[test]
fn an_unclosed_inactive_sheet_does_not_consume_the_next_sheet() {
    let html = "<html><head><style>body{color:#111;background:#fff;font:16px Georgia}</style><style>@media print { body { color:#111 }</style><style>body{color:#eee}</style></head><body><p>Active second sheet still applies.</p></body></html>";
    let findings = detect_html_source(
        html,
        Path::new("/tmp/media-sheet-boundary.html"),
        &DetectHtmlOptions::default(),
    );
    assert_eq!(
        findings
            .iter()
            .filter(|f| f.antipattern == "low-contrast")
            .count(),
        1
    );
}

#[test]
fn negative_dimension_fixture_reports_only_the_four_active_cases() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/antipatterns/negative-media-dimensions.html");
    let html = std::fs::read_to_string(&path).unwrap();
    let findings = detect_html_source(&html, &path, &DetectHtmlOptions::default());
    assert_eq!(
        findings
            .iter()
            .filter(|f| f.antipattern == "low-contrast")
            .count(),
        4,
        "{findings:?}"
    );
}

#[test]
fn boolean_discrete_features_keep_active_contrast_styles() {
    for query in [
        "(orientation)",
        "(prefers-color-scheme)",
        "screen and (orientation) and (prefers-color-scheme)",
    ] {
        assert_eq!(
            contrast_count(&format!("@media {query}{{body{{color:#eee}}}}")),
            1,
            "{query}"
        );
    }
    for query in [
        "not (orientation)",
        "not (prefers-color-scheme)",
        "(unsupported-feature)",
        "not (unsupported-feature)",
    ] {
        assert_eq!(
            contrast_count(&format!("@media {query}{{body{{color:#eee}}}}")),
            0,
            "{query}"
        );
    }
}

#[test]
fn browser_default_media_features_match_values_and_boolean_forms() {
    for (name, active, inactive, boolean) in [
        ("prefers-reduced-motion", "no-preference", "reduce", false),
        ("prefers-contrast", "no-preference", "more", false),
        ("hover", "hover", "none", true),
        ("any-hover", "hover", "none", true),
        ("pointer", "fine", "coarse", true),
        ("any-pointer", "fine", "none", true),
        ("forced-colors", "none", "active", false),
    ] {
        for (query, expected) in [
            (format!("({name}: {active})"), 1),
            (format!("not ({name}: {inactive})"), 1),
            (format!("({name}: {inactive})"), 0),
            (format!("not ({name}: {active})"), 0),
            (format!("({name})"), usize::from(boolean)),
            (format!("not ({name})"), usize::from(!boolean)),
            (format!("not ({name}: invalid)"), 0),
        ] {
            assert_eq!(
                contrast_count(&format!("@media {query}{{body{{color:#eee}}}}")),
                expected,
                "{query}"
            );
        }
    }
}

#[test]
fn linked_stylesheets_use_media_assigned_by_simple_onload_handlers() {
    let dir = std::env::temp_dir().join(format!("impeccable-media-onload-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("async.css"), "body{color:#eee}").unwrap();
    for (handler, expected) in [
        ("this.media='all'", 1),
        ("media='all'", 1),
        (" media = &quot;screen&quot;; ", 1),
        ("if(media!='all')media='all'", 1),
        (" if (media !== &quot;all&quot;) media = 'all'; ", 1),
        ("this.media=&quot;screen&quot;", 1),
        ("this.media=''", 1),
        ("this.onload=null;this.media='all'", 1),
        (" this.media = 'screen'; this.onload = null; ", 1),
        ("this.media='print'", 0),
        ("this.media='all';this.media='print'", 0),
        ("this.media='print';this.media='screen'", 1),
        ("this.title='all'", 0),
        ("console.log(`this.media='all'`)", 0),
        ("/* this.media='all' */", 0),
        ("if (false) this.media='all'", 0),
        ("if(media=='all')media='all'", 0),
        ("if(media!='print')media='all'", 0),
        ("if(media!='all')media='all';media='print'", 0),
        ("this.media=='all'", 0),
    ] {
        let html = format!("<html><head><style>body{{color:#111;background:#fff;font:16px Georgia}}</style><link rel='stylesheet' media='print' href='async.css' onload=\"{handler}\"></head><body><p>Async stylesheet text.</p></body></html>");
        let findings = detect_html_source(
            &html,
            &dir.join("index.html"),
            &DetectHtmlOptions::default(),
        );
        assert_eq!(
            findings
                .iter()
                .filter(|f| f.antipattern == "low-contrast")
                .count(),
            expected,
            "{handler}: {findings:?}"
        );
    }
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn browser_defaults_fixture_reports_active_rows_only() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/antipatterns/static-media-browser-defaults.html");
    let html = std::fs::read_to_string(&path).unwrap();
    let findings = detect_html_source(&html, &path, &DetectHtmlOptions::default());
    assert_eq!(
        findings
            .iter()
            .filter(|f| f.antipattern == "low-contrast")
            .count(),
        8,
        "{findings:?}"
    );
}

#[test]
fn hover_media_keeps_hover_contrast_rules() {
    assert_eq!(
        contrast_count("@media (hover: hover){p:hover{color:#eee}}"),
        1
    );
    assert_eq!(
        contrast_count("@media (hover: none){p:hover{color:#eee}}"),
        0
    );
}

#[test]
fn no_preference_keeps_recording_dot_animation() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/antipatterns/pulsing-dot.html");
    let html = std::fs::read_to_string(&path).unwrap();
    let findings = detect_html_source(&html, &path, &DetectHtmlOptions::default());
    assert!(
        findings
            .iter()
            .any(|f| f.antipattern == "pulsing-dot" && f.snippet.contains(".rec-mark")),
        "{findings:?}"
    );
}

#[test]
fn only_active_links_count_as_unread_stylesheets() {
    use impeccable_html::{cascade::has_unread_stylesheet, dom::StaticDocument};
    for href in ["missing.css", "https://example.invalid/theme.css"] {
        for (attributes, expected) in [
            ("media='print'", false),
            ("media='screen'", true),
            ("media='print' onload=\"this.media='all'\"", true),
            ("media='all' onload=\"this.media='print'\"", false),
        ] {
            let doc = StaticDocument::parse(&format!(
                "<link rel='stylesheet' href='{href}' {attributes}>"
            ));
            assert_eq!(
                has_unread_stylesheet(&doc, Path::new("/nonexistent/media-card")),
                expected,
                "{href} {attributes}"
            );
        }
    }
}
