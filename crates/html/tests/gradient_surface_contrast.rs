//! How the static engine resolves the surface and the ink of a piece of
//! text for low-contrast: translucent fills, gradient tiles that cover no
//! glyph, the gradient named as the source, and the ink's alpha and the
//! opacity of the boxes around it blended before scoring.

use impeccable_html::{detect_html_source, DetectHtmlOptions};
use std::path::Path;

fn repo_root() -> std::path::PathBuf {
    std::env::var("IMPECCABLE_PUBLIC_REPO")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."))
}

fn low_contrast_snippets(html: &str, path: &Path) -> Vec<String> {
    detect_html_source(html, path, &DetectHtmlOptions::default())
        .into_iter()
        .filter(|f| f.antipattern == "low-contrast")
        .map(|f| f.snippet)
        .collect()
}

fn fixture_snippets() -> Vec<String> {
    let fixture = repo_root().join("tests/fixtures/antipatterns/gradient-surface-contrast.html");
    assert!(fixture.is_file(), "missing fixture at {}", fixture.display());
    let html = std::fs::read_to_string(&fixture).unwrap();
    low_contrast_snippets(&html, &fixture)
}

#[test]
fn fixture_flags_every_should_flag_case() {
    let snippets = fixture_snippets();
    for (case, expected) in [
        ("label on the light band of its gradient", "text #fffdf7 on #fde68a (gradient on a.band-button)"),
        ("copy on a gradient too light everywhere", "text #d1d5dc on #e5e7eb (gradient on div.pale-panel)"),
        ("link filled by a covering gradient", "text #d4d4d8 on #e4e4e7 (gradient on a.fill-link)"),
        ("label on a faint orange tint", "text #ea580d on #fdeee7"),
        ("span at half opacity", "text #b5b9c0 on #ffffff"),
        ("copy in a translucent ink", "text #acaeb3 on #ffffff"),
        ("copy inside a faded wrapper", "text #9399a1 on #ffffff"),
        ("amber tile", "text #fdfdfd on #fbbf24 (gradient on div.feature-tile)"),
        ("lime tile beside it, same class", "text #fdfdfd on #a3e635 (gradient on div.feature-tile)"),
        ("copy running to the light end of a banner", "text #e0e0e1 on #ffffff (gradient on div.edge-banner)"),
    ] {
        assert!(
            snippets.iter().any(|s| s.ends_with(expected)),
            "{case} should flag as `{expected}`, got {snippets:?}"
        );
    }
}

#[test]
fn one_text_colour_reports_once_per_gradient_box_not_per_label() {
    let snippets = fixture_snippets();
    // Two links on one header: one report.
    let header: Vec<&String> = snippets.iter().filter(|s| s.contains("#cbd5e0")).collect();
    assert_eq!(header.len(), 1, "{snippets:?}");
    // The second link wears the same pair and is counted (r14-t2).
    assert!(header[0].ends_with("(gradient on nav.pale-header) (and 1 more)"), "{header:?}");
    // Amber and lime tiles share `div.feature-tile`: two reports. The navy
    // tile beside them passes.
    let tiles = snippets.iter().filter(|s| s.contains("text #fdfdfd")).count();
    assert_eq!(tiles, 2, "{snippets:?}");
}

#[test]
fn identical_tiles_on_one_gradient_stay_one_report() {
    // Separate boxes whose snippet is the same colour pair on the same label
    // are reported once, as before the per-box key, and the report counts
    // the other two (r14-t2).
    let html = r#"<!DOCTYPE html>
<html><head><style>
body { background: #ffffff; }
.tile { width: 56px; height: 56px; background: linear-gradient(135deg, #fbbf24, #f59e0b); }
.tile span { color: #ffffff; font-size: 24px; font-weight: 700; }
.lime { background: linear-gradient(135deg, #a3e635, #84cc16); }
</style></head>
<body>
<div class="tile"><span>A</span></div>
<div class="tile"><span>B</span></div>
<div class="tile"><span>C</span></div>
<div class="tile lime"><span>D</span></div>
</body></html>
"#;
    let snippets = low_contrast_snippets(html, Path::new("/tmp/tiles.html"));
    assert_eq!(
        snippets,
        vec![
            "1.7:1 (need 3:1) — text #ffffff on #fbbf24 (gradient on div.tile) (and 2 more)".to_string(),
            "1.5:1 (need 3:1) — text #ffffff on #a3e635 (gradient on div.tile)".to_string(),
        ],
        "{snippets:?}"
    );
}

#[test]
fn fixture_passes_every_should_pass_case_the_static_engine_can_read() {
    let snippets = fixture_snippets();
    for (case, color) in [
        ("link with a full-width gradient underline", "#1e293b"),
        ("dark label on a faint dark tint", "#0f172b"),
        ("span at nine tenths opacity", "#111828"),
        ("copy in a nearly opaque ink", "#111827"),
        // The cascade carries no `background-size` longhand, so the collapsed
        // underline is read as a gradient in the text's own colour, and a
        // stop in exactly that colour is a surface the text does not sit on.
        ("link with a collapsed gradient underline", "#0f172a"),
    ] {
        assert!(
            !snippets.iter().any(|s| s.contains(color)),
            "{case} ({color}) should not flag, got {snippets:?}"
        );
    }
    // No layout: the gradient is scored at its worst stop, as it always was.
    for (case, color) in [
        ("label on the dark band of its gradient", "#fffdf8"),
        ("pill far from a radial glow", "#475569"),
    ] {
        assert!(
            snippets.iter().any(|s| s.contains(color)),
            "{case} ({color}) keeps the worst-stop verdict here, got {snippets:?}"
        );
    }
}

#[test]
fn the_shared_walk_still_skips_faint_fills_for_other_rules() {
    // The contrast walk composites a 10% tint; the glow and hover checks
    // keep the walk they had, which the oracle pins.
    let html = r#"<!DOCTYPE html>
<html><head><style>
body { background: #ffffff; }
.chip { background: rgba(0, 0, 0, 0.1); color: #767676; font-size: 14px; padding: 4px; }
</style></head>
<body><span class="chip">Chip</span></body></html>
"#;
    let snippets = low_contrast_snippets(html, Path::new("/tmp/tint.html"));
    assert!(snippets.iter().any(|s| s.ends_with("text #767676 on #e6e6e6")), "{snippets:?}");
}

#[test]
fn a_faded_box_with_its_own_fill_fades_that_fill_too() {
    // A dark card at half opacity over white: the card reads mid-grey, and
    // white copy on it is scored against that grey, not against black.
    let html = r#"<!DOCTYPE html>
<html><head><style>
body { background: #ffffff; }
.card { opacity: 0.5; background: rgba(0, 0, 0, 0.9); padding: 12px; }
.copy { color: #ffffff; font-size: 14px; }
</style></head>
<body><div class="card"><p class="copy">Copy on a faded dark card</p></div></body></html>
"#;
    let snippets = low_contrast_snippets(html, Path::new("/tmp/faded-card.html"));
    assert!(snippets.iter().any(|s| s.ends_with("text #ffffff on #8c8c8c")), "{snippets:?}");
}
