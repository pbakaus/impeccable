use impeccable_html::{detect_html_source, DetectHtmlOptions};

/// Rule ids the static engine reports for a page linking `vendor/lib.css`,
/// with that sheet waived or not.
fn ids(waive_sheet: bool) -> Vec<String> {
    let dir = std::env::temp_dir().join(format!(
        "impeccable-ignored-sheet-{}-{waive_sheet}",
        std::process::id()
    ));
    std::fs::create_dir_all(dir.join("vendor")).unwrap();
    std::fs::write(
        dir.join("vendor/lib.css"),
        ".unused-text { background-image: linear-gradient(90deg, #f00, #00f); background-clip: text; -webkit-background-clip: text; color: transparent; }\n\
         .pale { color: #ccc; background: #fff; }\n",
    )
    .unwrap();
    let html = r#"<!doctype html><html lang="en"><head><meta charset="utf-8"><title>mock</title>
<link rel="stylesheet" href="vendor/lib.css"></head>
<body><main><h1>Mock</h1><p class="pale">Pale body copy on white</p></main></body></html>"#;
    let ignored = |path: &str| path.replace('\\', "/").ends_with("vendor/lib.css");
    let options = DetectHtmlOptions {
        ignored_linked_stylesheet: waive_sheet.then_some(&ignored as &dyn Fn(&str) -> bool),
        ..Default::default()
    };
    let ids = detect_html_source(html, &dir.join("index.html"), &options)
        .into_iter()
        .map(|f| f.antipattern)
        .collect();
    let _ = std::fs::remove_dir_all(&dir);
    ids
}

#[test]
fn a_waived_sheet_leaves_the_pattern_scan_but_still_styles_the_page() {
    let kept = ids(false);
    assert!(kept.iter().any(|id| id == "gradient-text"), "{kept:?}");
    assert!(kept.iter().any(|id| id == "low-contrast"), "{kept:?}");

    let waived = ids(true);
    assert!(!waived.iter().any(|id| id == "gradient-text"), "{waived:?}");
    assert!(waived.iter().any(|id| id == "low-contrast"), "{waived:?}");
}
