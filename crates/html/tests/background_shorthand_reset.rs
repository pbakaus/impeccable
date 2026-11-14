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
    // The four should-flag rows, and nothing else: no stale #111111 or
    // #151515, and no hover verdict on the two image swaps.
    let expected = [
        "text #3a3a3a on #222222",
        "text #404040 on #2a2a2a",
        "text #404040 on #2b2b2b",
        "text #ffffff on #ffffff",
    ];
    assert_eq!(snippets.len(), expected.len(), "{snippets:#?}");
    for want in expected {
        assert!(
            snippets.iter().any(|s| s.ends_with(want)),
            "{want}: {snippets:#?}"
        );
    }
    assert_eq!(
        snippets.iter().filter(|s| s.contains(":hover")).count(),
        1,
        "{snippets:#?}"
    );
}

#[test]
fn reset_runs_beside_the_recorded_expansion() {
    let transparent = vec![(
        "backgroundColor".to_string(),
        "rgba(0, 0, 0, 0)".to_string(),
        true,
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
    // currentColor is a color the recorded color reader does not know: it is
    // kept for the background reader, not reset.
    let current = vec![(
        "backgroundColor".to_string(),
        "currentColor".to_string(),
        false,
    )];
    for value in [
        "url(clear.svg) currentColor",
        "url(a.png), no-repeat url(b.png) CurrentColor",
        "currentColor",
    ] {
        assert_eq!(
            expand_background_color_reset("background", value),
            current,
            "{value}"
        );
    }
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

#[test]
fn an_important_resting_image_still_paints_under_a_hover_swap() {
    // The hover shorthand's implied reset beats the resting color, but its
    // image loses to the resting `!important` one, which still paints.
    let findings = scan(
        r#"<!DOCTYPE html><html><head><style>
.card { background-color: #111111; background-image: url(dark.png) !important; color: #ffffff; font-size: 16px; padding: 12px 16px; }
.card:hover { background: url(other.png); }
</style></head><body style="background:#ffffff"><div class="card">Cancel the trial now</div></body></html>"#,
    );
    assert!(
        findings.iter().all(|f| !f.snippet.contains(":hover")),
        "{findings:#?}"
    );
}

#[test]
fn a_hover_image_from_a_custom_property_still_paints() {
    // The winning hover image is `var(--photo)`; resolved, it is a url(), so
    // the implied transparent reset is not the hover surface.
    let findings = scan(
        r#"<!DOCTYPE html><html><head><style>
:root { --photo: url(dark.png); }
.card { background-color: #111111; color: #ffffff; font-size: 16px; padding: 12px 16px; }
.card:hover { background: url(other.png); background-image: var(--photo); }
</style></head><body style="background:#ffffff"><div class="card">Cancel the trial now</div></body></html>"#,
    );
    assert!(
        findings.iter().all(|f| !f.snippet.contains(":hover")),
        "{findings:#?}"
    );
}

#[test]
fn a_hover_rule_that_sets_custom_properties_is_not_scored_for_the_reset() {
    // Deliberate limit: `--photo: none` on hover does remove the image, but a
    // hover rule that sets custom properties is not followed statically, so
    // its implied reset is never scored (a missed finding, never a false one).
    let findings = scan(
        r#"<!DOCTYPE html><html><head><style>
.card { --photo: url(dark.png); background-color: #111111; color: #ffffff; font-size: 16px; padding: 12px 16px; }
.card:hover { --photo: none; background: url(other.png); background-image: var(--photo); }
</style></head><body style="background:#ffffff"><div class="card">Cancel the trial now</div></body></html>"#,
    );
    assert!(findings.iter().all(|f| !f.snippet.contains(":hover")), "{findings:#?}");
}

#[test]
fn hover_custom_properties_resolve_regardless_of_declaration_order() {
    // `--photo` names `--base`, which hover also changes to a url(): the
    // dark image paints, whatever order the two are declared in.
    let findings = scan(
        r#"<!DOCTYPE html><html><head><style>
.card { --base: none; background-color: #111111; color: #ffffff; font-size: 16px; padding: 12px 16px; }
.card:hover { --photo: var(--base); --base: url(dark.png); background: url(other.png); background-image: var(--photo); }
</style></head><body style="background:#ffffff"><div class="card">Cancel the trial now</div></body></html>"#,
    );
    assert!(
        findings.iter().all(|f| !f.snippet.contains(":hover")),
        "{findings:#?}"
    );
}

#[test]
fn a_hover_custom_property_set_to_inherit_takes_the_parents_value() {
    let findings = scan(
        r#"<!DOCTYPE html><html><head><style>
.wrap { --photo: url(dark.png); }
.card { background-color: #111111; background-image: url(rest.png); color: #ffffff; font-size: 16px; padding: 12px 16px; }
.card:hover { --photo: inherit; background: url(other.png); background-image: var(--photo); }
</style></head><body style="background:#ffffff"><div class="wrap"><div class="card">Cancel the trial now</div></div></body></html>"#,
    );
    assert!(
        findings.iter().all(|f| !f.snippet.contains(":hover")),
        "{findings:#?}"
    );
}

#[test]
fn self_referencing_hover_custom_properties_stay_bounded() {
    // Review: `--x: var(--x) var(--x)` used to expand without bound. A
    // reference cycle is invalid, so the scan finishes at once.
    let started = std::time::Instant::now();
    let findings = scan(
        r#"<!DOCTYPE html><html><head><style>
.card { background-color: #111111; color: #ffffff; font-size: 16px; padding: 12px 16px; }
.card:hover { --x: var(--x) var(--x); --a: var(--b) var(--b); --b: var(--a) var(--a); background: url(photo.png); }
</style></head><body style="background:#ffffff"><div class="card">Cancel the trial now</div></body></html>"#,
    );
    assert!(started.elapsed() < std::time::Duration::from_secs(5));
    assert!(findings.iter().all(|f| !f.snippet.contains(":hover")), "{findings:#?}");
}

#[test]
fn a_hover_custom_property_set_to_unset_takes_the_parents_value() {
    let findings = scan(
        r#"<!DOCTYPE html><html><head><style>
.wrap { --photo: url(dark.png); }
.card { background-color: #111111; background-image: url(rest.png); color: #ffffff; font-size: 16px; padding: 12px 16px; }
.card:hover { --photo: unset; background: url(other.png); background-image: var(--photo); }
</style></head><body style="background:#ffffff"><div class="wrap"><div class="card">Cancel the trial now</div></div></body></html>"#,
    );
    assert!(findings.iter().all(|f| !f.snippet.contains(":hover")), "{findings:#?}");
}

#[test]
fn cyclic_hover_custom_properties_with_a_fallback_image_are_not_scored() {
    let findings = scan(
        r#"<!DOCTYPE html><html><head><style>
.card { background-color: #111111; color: #ffffff; font-size: 16px; padding: 12px 16px; }
.card:hover { --photo: var(--photo); background: url(other.png); background-image: var(--photo, url(dark.png)); }
</style></head><body style="background:#ffffff"><div class="card">Cancel the trial now</div></body></html>"#,
    );
    assert!(findings.iter().all(|f| !f.snippet.contains(":hover")), "{findings:#?}");
}

#[test]
fn a_long_hover_custom_property_chain_is_cheap() {
    let mut chain = String::new();
    for i in 0..5000 {
        chain.push_str(&format!("--a{i:05}: var(--a{:05}); ", i + 1));
    }
    let html = format!(
        r#"<!DOCTYPE html><html><head><style>
.card {{ background-color: #111111; color: #ffffff; font-size: 16px; padding: 12px 16px; }}
.card:hover {{ background: url(photo.png); {chain} }}
</style></head><body style="background:#ffffff"><div class="card">Cancel the trial now</div></body></html>"#
    );
    let started = std::time::Instant::now();
    let _ = scan(&html);
    assert!(started.elapsed() < std::time::Duration::from_secs(10));
}

#[test]
fn a_hover_reset_with_no_image_left_still_counts() {
    // The hover image loses to a resting `!important` `none`: nothing
    // paints, so the implied transparent reset is the hover surface.
    let findings = scan(
        r#"<!DOCTYPE html><html><head><style>
.card { background-color: #111111; background-image: none !important; color: #ffffff; font-size: 16px; padding: 12px 16px; }
.card:hover { background: url(other.png); }
</style></head><body style="background:#ffffff"><div class="card">Cancel the trial now</div></body></html>"#,
    );
    assert!(
        findings.iter().any(|f| f.snippet.contains(":hover")),
        "{findings:#?}"
    );
}

#[test]
fn a_current_color_shorthand_fills_with_the_box_color() {
    let findings = scan(
        r#"<!DOCTYPE html><html><head><style>
body { background: #ffffff; }
.panel { width: 400px; height: 80px; background-color: #ffffff; }
.panel { color: #2b2b2b; background: url(clear.svg) no-repeat currentColor; }
.panel p { color: #404040; font-size: 16px; }
</style></head><body><div class="panel"><p>Dim ink on its box's own color</p></div></body></html>"#,
    );
    assert!(
        findings
            .iter()
            .any(|f| f.snippet.ends_with("text #404040 on #2b2b2b")),
        "{findings:#?}"
    );
}

#[test]
fn a_color_only_hover_over_a_resting_image_is_not_scored() {
    // The resting shorthand paints an image and resets the fill to
    // transparent; a hover that changes only the text color still sits on
    // that image, which a static read cannot sample.
    let findings = scan(
        r#"<!DOCTYPE html><html><head><style>
.card { background: url(photo.jpg) center / cover; color: #ffffff; font-size: 16px; padding: 12px 16px; }
.card:hover { color: #fafafa; }
</style></head><body style="background:#ffffff"><div class="card">Cancel the trial now</div></body></html>"#,
    );
    assert!(
        findings.iter().all(|f| !f.snippet.contains(":hover")),
        "{findings:#?}"
    );
}

#[test]
fn a_hover_that_removes_the_image_is_scored_on_the_page() {
    // The hover drops the resting image, so the light hover text sits on the
    // white page again and is a real hover failure.
    let findings = scan(
        r#"<!DOCTYPE html><html><head><style>
.card { background: url(photo.jpg) center / cover; color: #ffffff; font-size: 16px; padding: 12px 16px; }
.card:hover { background: none; color: #fafafa; }
</style></head><body style="background:#ffffff"><div class="card">Cancel the trial now</div></body></html>"#,
    );
    assert!(
        findings.iter().any(|f| f.snippet.contains(":hover")),
        "{findings:#?}"
    );
}

#[test]
fn an_underline_gradient_does_not_hide_a_hover_failure() {
    // A 2px gradient underline cannot cover the text, so the hover color is
    // still read against the white page, as the resting check reads it.
    let findings = scan(
        r#"<!DOCTYPE html><html><head><style>
div.link { background: linear-gradient(#000, #000) no-repeat 0 100% / 100% 2px; color: #222222; font-size: 16px; }
div.link:hover { color: #fafafa; }
</style></head><body style="background:#ffffff"><div class="link">Read the full report</div></body></html>"#,
    );
    assert!(
        findings.iter().any(|f| f.snippet.contains(":hover")),
        "{findings:#?}"
    );
}


#[test]
fn a_full_gradient_under_an_underline_still_hides_the_page() {
    // The 2px underline is the first layer, but a full dark gradient paints
    // beneath it, so the light hover text is not scored against the white
    // page.
    let findings = scan(
        r#"<!DOCTYPE html><html><head><style>
div.link { background: linear-gradient(#000, #000) no-repeat 0 100% / 100% 2px, linear-gradient(#111, #111); color: #eeeeee; font-size: 16px; }
div.link:hover { color: #fafafa; }
</style></head><body style="background:#ffffff"><div class="link">Read the full report</div></body></html>"#,
    );
    assert!(
        !findings.iter().any(|f| f.snippet.contains(":hover")),
        "{findings:#?}"
    );
}

#[test]
fn a_hover_image_shorthand_clears_the_resting_fill() {
    // `:hover { background: url(...) }` clears the white fill and paints an
    // image this engine cannot read, so the hover pairing is not scored
    // against the white fill the shorthand removed.
    let findings = scan(
        r#"<!DOCTYPE html><html><head><style>
div.card { background: #ffffff; color: #222222; font-size: 16px; }
div.card:hover { background: url(photo.jpg); color: #fafafa; }
</style></head><body style="background:#ffffff"><div class="card">Read the full report</div></body></html>"#,
    );
    assert!(
        !findings.iter().any(|f| f.snippet.contains(":hover")),
        "{findings:#?}"
    );
}

#[test]
fn a_hover_that_only_removes_the_image_is_scored() {
    // The resting text sits on an image; the hover removes it without
    // touching any color, so the light text now sits on the white page.
    let findings = scan(
        r#"<!DOCTYPE html><html><head><style>
div.card { background: url(photo.jpg); color: #fafafa; font-size: 16px; }
div.card:hover { background: none; }
</style></head><body style="background:#ffffff"><div class="card">Read the full report</div></body></html>"#,
    );
    assert!(
        findings.iter().any(|f| f.snippet.contains(":hover")),
        "{findings:#?}"
    );
}
