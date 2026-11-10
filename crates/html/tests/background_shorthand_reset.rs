//! Issue #964: a `background` shorthand that names an image and no color
//! resets `background-color` to transparent, so a stale earlier fill is not
//! scored as the text's surface. Fixture:
//! `tests/fixtures/antipatterns/low-contrast-shorthand-reset.html`.

use impeccable_core::findings::Finding;
use impeccable_html::cascade::shorthand::{
    expand_background_color_reset, expand_static_declaration,
};
use impeccable_html::{detect_html_source, DetectHtmlOptions};
use std::path::{Path, PathBuf};

fn repo_root() -> PathBuf {
    std::env::var("IMPECCABLE_PUBLIC_REPO")
        .map(PathBuf::from)
        .unwrap_or_else(|_| Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."))
}

fn low_contrast(html: &str, path: &Path) -> Vec<Finding> {
    detect_html_source(html, path, &DetectHtmlOptions::default())
        .into_iter()
        .filter(|f| f.antipattern == "low-contrast")
        .collect()
}

fn scan(html: &str) -> Vec<Finding> {
    low_contrast(html, Path::new("/tmp/background-shorthand-reset.html"))
}

#[test]
fn fixture_scores_the_shorthand_color_and_not_the_stale_fill() {
    let path = repo_root().join("tests/fixtures/antipatterns/low-contrast-shorthand-reset.html");
    let html = std::fs::read_to_string(&path).expect("fixture");
    let findings = low_contrast(&html, &path);
    let snippets: Vec<&str> = findings.iter().map(|f| f.snippet.as_str()).collect();
    assert_eq!(snippets.len(), 1, "{snippets:#?}");
    assert!(
        snippets[0].ends_with("text #3a3a3a on #222222"),
        "{snippets:#?}"
    );
    assert!(
        snippets.iter().all(|s| !s.contains("#111111")),
        "{snippets:#?}"
    );
}

#[test]
fn reset_runs_beside_the_recorded_expansion() {
    let transparent = vec![(
        "backgroundColor".to_string(),
        "rgba(0, 0, 0, 0)".to_string(),
    )];
    for value in [
        "url(photo.jpg) center / cover no-repeat",
        "linear-gradient(180deg, #f5f5f5, #ececec)",
        "url(a.png), url(b.png)",
    ] {
        assert_eq!(
            expand_background_color_reset("background", value),
            transparent,
            "{value}"
        );
    }
    for value in [
        "#222 url(photo.jpg)",
        "url(photo.jpg) #111",
        "url(a.png), #0b0d10 url(b.png)",
        "var(--surface) url(photo.jpg)",
        "url(photo.jpg) center / var(--size)",
        "#111",
        "none",
    ] {
        assert!(
            expand_background_color_reset("background", value).is_empty(),
            "{value}"
        );
    }
    assert!(expand_background_color_reset("background-image", "url(photo.jpg)").is_empty());
    // The recorded expansion still returns the image alone.
    assert_eq!(
        expand_static_declaration("background", "url(photo.jpg)"),
        vec![("backgroundImage".to_string(), "url(photo.jpg)".to_string())]
    );
}

#[test]
fn a_later_background_color_still_wins_over_the_reset() {
    let findings = scan(
        r#"<!DOCTYPE html><html><head><style>
body { background: #ffffff; }
.panel { width: 400px; height: 80px; background: url(photo.jpg); }
.panel { background-color: #111111; }
.panel p { color: #1f1f1f; font-size: 16px; }
</style></head><body><div class="panel"><p>Dark ink on a dark fill under the photo</p></div></body></html>"#,
    );
    assert!(
        findings
            .iter()
            .any(|f| f.snippet.ends_with("text #1f1f1f on #111111")),
        "{findings:#?}"
    );
}

#[test]
fn a_hover_image_swap_is_not_a_hover_surface_change() {
    let findings = scan(
        r#"<!DOCTYPE html><html><head><style>
.card { background: #111111; color: #ffffff; font-size: 16px; padding: 12px 16px; }
.card:hover { background: url(photo.jpg) center / cover; }
</style></head><body style="background:#ffffff"><div class="card">Cancel the trial now</div></body></html>"#,
    );
    assert!(
        findings.iter().all(|f| !f.snippet.contains(":hover")),
        "{findings:#?}"
    );
}

#[test]
fn an_explicit_hover_transparent_still_counts() {
    let findings = scan(
        r#"<!DOCTYPE html><html><head><style>
.card { background: #111111; color: #ffffff; font-size: 16px; padding: 12px 16px; }
.card:hover { background-color: transparent; }
</style></head><body style="background:#ffffff"><div class="card">Cancel the trial now</div></body></html>"#,
    );
    assert!(
        findings.iter().any(|f| f.snippet.contains(":hover")),
        "{findings:#?}"
    );
}
