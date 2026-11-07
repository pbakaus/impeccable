//! Contrast scoring for links, spans and the other SAFE_TAGS elements that
//! paint their own text without painting their own surface.

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
    let fixture = repo_root().join("tests/fixtures/antipatterns/link-text-contrast.html");
    assert!(
        fixture.is_file(),
        "missing fixture at {}",
        fixture.display()
    );
    let html = std::fs::read_to_string(&fixture).unwrap();
    low_contrast_snippets(&html, &fixture)
}

#[test]
fn fixture_flags_every_should_flag_case() {
    let snippets = fixture_snippets();
    for (case, color) in [
        ("accent link", "#f37b2e"),
        ("footer imprint span", "#8a8a8a"),
        ("badge label in a filled anchor", "#ea580c"),
        ("list item", "#9b9b9b"),
        ("table cell", "#8d99a6"),
        ("ghost button", "#7c8494"),
        ("form label", "#949494"),
        ("paragraph with an inherited run", "#999999"),
        ("repeated nav link", "#888888"),
        ("link in a row a media query hides on phones", "#8e8e8e"),
        ("link on a white card over a hero photo", "#939393"),
        ("link on a white section with a texture tile", "#969696"),
        ("paragraph in a [hidden] panel author CSS reveals", "#8c8c8c"),
        ("link inside a <map>", "#919191"),
        ("link with its own external-link icon", "#979797"),
        ("link in a list item with an arrow bullet image", "#989898"),
    ] {
        assert!(
            snippets.iter().any(|s| s.contains(color)),
            "{case} ({color}) should flag, got {snippets:?}"
        );
    }
}

#[test]
fn fixture_passes_every_should_pass_case() {
    let snippets = fixture_snippets();
    for (case, color) in [
        ("readable blue link", "#0b4fbc"),
        ("large link above the large-text threshold", "#838383"),
        ("screen-reader-only text", "#b1b1b1"),
        ("icon glyph", "#b2b2b2"),
        ("link with no text of its own", "#b3b3b3"),
        ("emoji-only span", "#b4b4b4"),
        ("disabled control", "#b6b6b6"),
        ("link inside a <template>", "#b7b7b7"),
        ("link inside a [hidden] subtree", "#b8b8b8"),
        ("link inside a [hidden=until-found] subtree", "#b9b9b9"),
        ("link inside a <noscript>", "#bababa"),
        ("link inside a closed <details>", "#bbbbbb"),
        ("link fourteen levels inside a <template>", "#bcbcbc"),
        ("word spans of a gradient-clipped caption", "#fdfdfd"),
        ("span inside a gradient-clipped link", "#d1d5db"),
        ("link over a photo inside zero-height wrappers", "#f08a3c"),
        ("link over a later photo at z-index -1", "#f08b3d"),
        ("link in raised content over a later photo", "#f08c3e"),
        ("link over a photo drawn by ::before", "#f08d3f"),
    ] {
        assert!(
            !snippets.iter().any(|s| s.contains(color)),
            "{case} ({color}) should not flag, got {snippets:?}"
        );
    }
    // The paragraph is scored; the span repeating its colour is not.
    assert_eq!(
        snippets.iter().filter(|s| s.contains("#999999")).count(),
        1,
        "an inherited run must not repeat its paragraph's finding, {snippets:?}"
    );
    // Eight links, one colour, one finding.
    assert_eq!(
        snippets.iter().filter(|s| s.contains("#888888")).count(),
        1,
        "a repeated link colour must be reported once, {snippets:?}"
    );
    // Nothing but contrast findings, except the two gradient-clipped cases,
    // which `gradient-text` reports as that rule always has. The fixture is
    // otherwise a clean negative control for every other rule.
    let fixture = repo_root().join("tests/fixtures/antipatterns/link-text-contrast.html");
    let html = std::fs::read_to_string(&fixture).unwrap();
    let all = detect_html_source(&html, &fixture, &DetectHtmlOptions::default());
    let others: Vec<_> = all
        .iter()
        .filter(|f| f.antipattern != "low-contrast")
        .collect();
    assert_eq!(others.len(), 2, "{others:?}");
    assert!(
        others.iter().all(|f| f.antipattern == "gradient-text"),
        "{others:?}"
    );
}

#[test]
fn a_run_inside_a_gradient_clipped_parent_is_not_scored() {
    // The review's two repros. The clip sits on the parent, the words are in
    // spans, and the static cascade drops `-webkit-text-fill-color`, so the
    // span used to be scored on its declared colour against the stops:
    // `1.2:1, text #ffffff on #fde68a` and `3.1:1, text #d1d5db on #db2777`.
    let html = r#"<!DOCTYPE html>
<html><head><style>
body { background: #0b0b10; color: #f5f5f5; font-size: 16px; }
.wordsplit { background-image: linear-gradient(90deg, #fde68a, #fbcfe8); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: #ffffff; font-size: 18px; display: inline-block; }
.gradlink { background-image: linear-gradient(90deg, #7c3aed, #db2777); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: #d1d5db; font-size: 15px; display: inline-block; }
</style></head>
<body>
  <p class="wordsplit"><span>Split</span> <span>word</span> <span>gradient</span> <span>caption</span></p>
  <p><a href="/x" class="gradlink"><span>Learn more about it</span></a></p>
</body></html>
"#;
    let snippets = low_contrast_snippets(html, Path::new("/tmp/gradclip.html"));
    assert!(snippets.is_empty(), "{snippets:?}");

    // Control: the same spans with nothing clipped report against the stops,
    // so the silence above is the clip and not the colours.
    let unclipped = html
        .replace("-webkit-background-clip: text; background-clip: text;", "")
        .replace("-webkit-text-fill-color: transparent;", "");
    let snippets = low_contrast_snippets(&unclipped, Path::new("/tmp/gradclip-control.html"));
    assert!(
        snippets.iter().any(|s| s.contains("#ffffff on #fde68a")),
        "{snippets:?}"
    );

    // A box painted normally inside the clipped one is a real surface again.
    let html = r#"<!DOCTYPE html>
<html><head><style>
body { background: #ffffff; }
.clipped { background-image: linear-gradient(90deg, #7c3aed, #db2777); -webkit-background-clip: text; background-clip: text; color: #1f2937; }
.card { background: #ffffff; padding: 12px; }
.pale { color: #aaaaaa; font-size: 14px; }
</style></head>
<body><div class="clipped"><div class="card"><span class="pale">Card copy</span></div></div></body></html>
"#;
    let snippets = low_contrast_snippets(html, Path::new("/tmp/gradclip-card.html"));
    assert!(
        snippets.iter().any(|s| s.contains("#aaaaaa on #ffffff")),
        "{snippets:?}"
    );
}

#[test]
fn a_hidden_element_an_author_display_reveals_is_scored() {
    // The UA's `[hidden] { display: none }` is the weakest rule on the page.
    let html = r#"<!DOCTYPE html>
<html><head><style>
body { background: #ffffff; }
.reveal { display: block; }
.m4 { color: #9a9a9a; font-size: 14px; }
.m6 { color: #a1a1a1; font-size: 14px; }
.m7 { color: #a2a2a2; font-size: 14px; }
</style></head>
<body>
  <div hidden class="reveal"><p class="m4">Hidden attribute but author CSS shows this</p></div>
  <div hidden><p class="m6">Hidden with no author display</p></div>
  <div hidden="until-found" class="reveal"><p class="m7">Until found, which no display undoes</p></div>
</body></html>
"#;
    let snippets = low_contrast_snippets(html, Path::new("/tmp/reveal.html"));
    assert!(
        snippets.iter().any(|s| s.contains("#9a9a9a")),
        "{snippets:?}"
    );
    assert!(
        !snippets.iter().any(|s| s.contains("#a1a1a1") || s.contains("#a2a2a2")),
        "{snippets:?}"
    );
}

#[test]
fn a_closed_details_hides_everything_but_its_summary() {
    let page = |open: &str| {
        format!(
            r#"<!DOCTYPE html>
<html><head><style>
body {{ background: #ffffff; }}
.s {{ color: #a3a3a3; font-size: 14px; }}
.m5 {{ color: #9b9b9b; font-size: 14px; }}
</style></head>
<body><details{open}><summary><span class="s">More options</span></summary><div><a href="/x" class="m5">Link inside the details panel</a></div></details></body></html>
"#
        )
    };
    let closed = low_contrast_snippets(&page(""), Path::new("/tmp/details.html"));
    assert!(
        closed.iter().any(|s| s.contains("#a3a3a3")),
        "the summary is on screen: {closed:?}"
    );
    assert!(
        !closed.iter().any(|s| s.contains("#9b9b9b")),
        "the panel is not: {closed:?}"
    );
    let open = low_contrast_snippets(&page(" open"), Path::new("/tmp/details-open.html"));
    assert!(open.iter().any(|s| s.contains("#9b9b9b")), "{open:?}");
}

#[test]
fn a_map_renders_its_flow_content() {
    let html = r#"<!DOCTYPE html>
<html><head><style>
body { background: #ffffff; }
.maplink { color: #a4a4a4; font-size: 14px; }
</style></head>
<body><map name="nav"><a href="/a" class="maplink">Text link repeated from the image map</a></map></body></html>
"#;
    let snippets = low_contrast_snippets(html, Path::new("/tmp/map.html"));
    assert!(
        snippets.iter().any(|s| s.contains("#a4a4a4")),
        "{snippets:?}"
    );
}

#[test]
fn non_rendered_markup_hides_however_far_up_it_is_written() {
    let wrap = |open: &str, close: &str| {
        let depth = 20;
        format!(
            r#"<!DOCTYPE html>
<html><head><style>
body {{ background: #ffffff; }}
.pale {{ color: #a5a5a5; font-size: 14px; }}
</style></head>
<body>{open}{}<a class="pale" href="/deep">Deeply nested link</a>{}{close}</body></html>
"#,
            "<div>".repeat(depth),
            "</div>".repeat(depth)
        )
    };
    for (open, close) in [
        ("<template>", "</template>"),
        ("<div hidden>", "</div>"),
        ("<details><summary>More</summary>", "</details>"),
    ] {
        let snippets = low_contrast_snippets(&wrap(open, close), Path::new("/tmp/deep.html"));
        assert!(snippets.is_empty(), "{open}: {snippets:?}");
    }
    let snippets = low_contrast_snippets(&wrap("", ""), Path::new("/tmp/deep-control.html"));
    assert!(
        snippets.iter().any(|s| s.contains("#a5a5a5")),
        "{snippets:?}"
    );
}

#[test]
fn a_large_link_above_the_threshold_would_fail_at_body_size() {
    let html = r#"<!DOCTYPE html>
<html><head><style>
body { background: #ffffff; }
a.small { color: #838383; font-size: 14px; }
</style></head>
<body><a class="small" href="/plans">Compare the plans</a></body></html>
"#;
    let snippets = low_contrast_snippets(html, Path::new("/tmp/large-link.html"));
    assert!(
        snippets.iter().any(|s| s.contains("#838383")),
        "the fixture's large link passes on size, not on colour: {snippets:?}"
    );
}

#[test]
fn a_glyph_only_ancestor_does_not_silence_its_run() {
    // `<a><span>label</span> arrow</a>`: nothing scores the anchor, so the
    // span has to report its own colour.
    let html = r#"<!DOCTYPE html>
<html><head><style>
body { background: #ffffff; }
a.more { color: #949494; font-size: 14px; }
</style></head>
<body><a class="more" href="/x"><span>Read more about the service</span> &#8594;</a></body></html>
"#;
    let snippets = low_contrast_snippets(html, Path::new("/tmp/glyph.html"));
    assert_eq!(
        snippets.iter().filter(|s| s.contains("#949494")).count(),
        1,
        "{snippets:?}"
    );
}

#[test]
fn a_run_on_its_own_surface_keeps_its_own_verdict() {
    // White copy on a light section, repeated inside a green card: the
    // ancestor's verdict is against a different background, so the run is
    // scored where it stands.
    let html = r#"<!DOCTYPE html>
<html><head><style>
body { background: #ffffff; }
section { color: #ffffff; background: #1f2937; font-size: 14px; padding: 16px; }
div.card { background: #16a34a; padding: 12px; }
span.cta { font-size: 14px; }
</style></head>
<body><section>Try the demo<div class="card"><span class="cta">Book a slot</span></div></section></body></html>
"#;
    let snippets = low_contrast_snippets(html, Path::new("/tmp/surface.html"));
    assert!(
        snippets.iter().any(|s| s.contains("#ffffff on #16a34a")),
        "{snippets:?}"
    );
}

#[test]
fn a_disabled_control_is_not_scored() {
    let html = r#"<!DOCTYPE html>
<html><head><style>
body { background: #ffffff; }
button { color: #b0b0b0; background: transparent; border: 0; font-size: 14px; }
</style></head>
<body><button disabled>Generate</button><button aria-disabled="true">Export</button></body></html>
"#;
    let snippets = low_contrast_snippets(html, Path::new("/tmp/disabled.html"));
    assert!(snippets.is_empty(), "{snippets:?}");
}

#[test]
fn a_background_read_as_the_text_colour_is_not_a_report() {
    // The static engine resolves the label's background to the page's own
    // white because it cannot see the photo behind it. 1.0:1 with identical
    // hexes is a resolution artefact, not a finding.
    let html = r#"<!DOCTYPE html>
<html><head><style>
body { background: #ffffff; }
div.hero { background-image: url(/hero.jpg); padding: 40px; }
a.lang { color: #ffffff; font-size: 14px; }
</style></head>
<body><div class="hero"><a class="lang" href="/en">English</a></div></body></html>
"#;
    let snippets = low_contrast_snippets(html, Path::new("/tmp/hero.html"));
    assert!(snippets.is_empty(), "{snippets:?}");
}

#[test]
fn text_painted_in_its_own_background_is_the_cost_of_that_guard() {
    // The documented cost of the guard above: text genuinely set in its own
    // surface colour is invisible, and no path reports it. The paragraph used
    // to report, and so did every white heading over a photo the walk cannot
    // see. One shade off its surface still reports.
    let html = r#"<!DOCTYPE html>
<html><head><style>
body { background: #ffffff; }
a.ghost { color: #ffffff; font-size: 14px; }
p.ghost { color: #ffffff; font-size: 14px; }
p.near { color: #fdfdfd; font-size: 14px; }
</style></head>
<body><a class="ghost" href="/x">Invisible link</a><p class="ghost">Invisible paragraph</p><p class="near">Nearly invisible paragraph</p></body></html>
"#;
    let snippets = low_contrast_snippets(html, Path::new("/tmp/ghost.html"));
    assert_eq!(snippets.len(), 1, "only the near-white paragraph reports: {snippets:?}");
    assert!(snippets[0].contains("#fdfdfd on #ffffff"), "{snippets:?}");
}

#[test]
fn markup_the_browser_never_renders_is_not_scored() {
    // A browser lays out none of this at any viewport, so a browser scan
    // reports none of it. The static tree carries all of it: html5ever hands
    // template content back as ordinary descendants, and the static cascade
    // has no UA stylesheet to turn `hidden` into `display: none`.
    let html = r#"<!DOCTYPE html>
<html><head><style>
body { background: #ffffff; }
a.pale { color: #aaaaaa; font-size: 14px; }
</style></head>
<body>
  <template><div><a class="pale" href="/1">Unmounted card link</a></div></template>
  <div hidden><a class="pale" href="/2">Closed panel link</a></div>
  <div hidden="until-found"><a class="pale" href="/3">Findable panel link</a></div>
  <noscript><a class="pale" href="/4">No-script fallback link</a></noscript>
</body></html>
"#;
    let snippets = low_contrast_snippets(html, Path::new("/tmp/non-rendered.html"));
    assert!(snippets.is_empty(), "{snippets:?}");

    // The control: the same link outside all of it is still scored, so the
    // skip is about the markup around the element and nothing else.
    let rendered = r#"<!DOCTYPE html>
<html><head><style>
body { background: #ffffff; }
a.pale { color: #aaaaaa; font-size: 14px; }
</style></head>
<body><div><a class="pale" href="/1">Unmounted card link</a></div></body></html>
"#;
    let snippets = low_contrast_snippets(rendered, Path::new("/tmp/rendered.html"));
    assert!(
        snippets.iter().any(|s| s.contains("#aaaaaa")),
        "{snippets:?}"
    );
}

#[test]
fn inactive_mobile_media_does_not_hide_desktop_contrast_findings() {
    // Static scans use a 1280px-wide screen. The mobile-only display rule
    // does not apply, so both desktop links remain in the contrast pass.
    let html = r#"<!DOCTYPE html>
<html><head><style>
body { background: #ffffff; }
a.pale { color: #aaaaaa; font-size: 14px; }
a.paler { color: #bbbbbb; font-size: 14px; }
@media (max-width: 900px) { .desktop-only { display: none; } }
</style></head>
<body>
  <div class="desktop-only"><a class="pale" href="/1">Open the desktop dashboard</a></div>
  <div><a class="paler" href="/2">Open the mobile dashboard</a></div>
</body></html>
"#;
    let snippets = low_contrast_snippets(html, Path::new("/tmp/responsive.html"));
    assert_eq!(snippets.len(), 2, "{snippets:?}");

    // The same is true of an element that carries the declaration itself,
    // and of the `<p>` and `<div>` the tag gate never applied to.
    let html = r#"<!DOCTYPE html>
<html><head><style>
body { background: #ffffff; }
p.pale { color: #aaaaaa; font-size: 14px; }
@media (max-width: 900px) { p.pale { display: none; } }
</style></head>
<body><p class="pale">Muted desktop copy</p></body></html>
"#;
    let snippets = low_contrast_snippets(html, Path::new("/tmp/responsive-p.html"));
    assert_eq!(snippets.len(), 1, "{snippets:?}");
}

#[test]
fn an_inline_ignore_waives_its_own_link_and_not_the_page() {
    // The dedupe hands a colour pair to the first element that reports it.
    // A waived element reports nothing, so it cannot be that element: an
    // author silencing one link must not silence the fifty beside it.
    let html = r#"<!DOCTYPE html>
<html><head><style>
body { background: #ffffff; }
a.pale { color: #aaaaaa; font-size: 14px; }
</style></head>
<body>
  <a class="pale" href="/1" data-impeccable-ignore="low-contrast">Waived link</a>
  <a class="pale" href="/2">Reported link</a>
  <a class="pale" href="/3">Third link</a>
</body></html>
"#;
    let snippets = low_contrast_snippets(html, Path::new("/tmp/ignore.html"));
    assert_eq!(
        snippets.len(),
        1,
        "one report for the pair, and not on the waived link: {snippets:?}"
    );
    assert!(snippets[0].contains("#aaaaaa on #ffffff"), "{snippets:?}");
}

#[test]
fn non_rendered_markup_is_skipped_for_every_tag_the_colour_rule_walks() {
    // One model of rendered, not one per tag: the same skip covers the `<p>`
    // and `<div>` the tag gate never applied to.
    let html = r#"<!DOCTYPE html>
<html><head><style>
body { background: #ffffff; }
p.pale { color: #aaaaaa; font-size: 14px; }
</style></head>
<body><template><p class="pale">Unmounted paragraph copy</p></template></body></html>
"#;
    let snippets = low_contrast_snippets(html, Path::new("/tmp/non-rendered-p.html"));
    assert!(snippets.is_empty(), "{snippets:?}");
}

#[test]
fn a_run_that_sets_its_own_colour_is_scored() {
    let html = r#"<!DOCTYPE html>
<html><head><style>
body { background: #ffffff; }
p { color: #1f2937; font-size: 14px; }
span.pale { color: #a3a3a3; }
</style></head>
<body><p>Readable copy <span class="pale">with a pale run</span></p></body></html>
"#;
    let snippets = low_contrast_snippets(html, Path::new("/tmp/link-text-contrast.html"));
    assert!(
        snippets.iter().any(|s| s.contains("#a3a3a3")),
        "{snippets:?}"
    );
}

#[test]
fn a_styled_control_still_reports_its_surface_rules() {
    // The tag gate stays for everything but the contrast verdict: a span
    // with its own fill keeps the full check, gray-on-color included.
    let html = r#"<!DOCTYPE html>
<html><head><style>
body { background: #ffffff; }
span.chip { background: #b6322d; color: #5c5449; font-size: 14px; padding: 4px 8px; }
</style></head>
<body><span class="chip">Severity low</span></body></html>
"#;
    let findings = detect_html_source(
        html,
        Path::new("/tmp/chip.html"),
        &DetectHtmlOptions::default(),
    );
    let ids: Vec<&str> = findings.iter().map(|f| f.antipattern.as_str()).collect();
    assert!(ids.contains(&"low-contrast"), "{findings:?}");
    assert!(ids.contains(&"gray-on-color"), "{findings:?}");
}

/// A page of one hero: a positioned section, the content, and a photo, in
/// whatever markup `body` gives.
fn hero_page(css: &str, body: &str) -> Vec<String> {
    let html = format!(
        "<!doctype html><html><head><style>body {{ background: #ffffff; color: #111111; }} \
         .o {{ color: #f37b2e; font-size: 15px; }} {css}</style></head><body>{body}</body></html>"
    );
    low_contrast_snippets(&html, Path::new("hero.html"))
}

const PHOTO: &str = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10'%3E%3Crect width='10' height='10' fill='%23112233'/%3E%3C/svg%3E";

#[test]
fn a_stretched_photo_beside_the_content_is_under_the_text() {
    let css = ".hero { position: relative; height: 500px; } \
               .photo { position: absolute; inset: 0; width: 100%; height: 100%; } \
               .content { position: relative; padding: 200px 100px; }";
    // Zero-height wrappers around the photo.
    let wrapped = format!(
        "<section class=\"hero\"><div class=\"media\"><div class=\"frame\"><img class=\"photo\" src=\"{PHOTO}\"></div></div>\
         <div class=\"content\"><a class=\"o\" href=\"#\">Orange link over a wrapped photo</a></div></section>"
    );
    assert!(hero_page(css, &wrapped).is_empty(), "{:?}", hero_page(css, &wrapped));
    // The photo after the content, laid beneath it by z-index.
    let later = format!(
        "<section class=\"hero\"><div class=\"content\"><a class=\"o\" href=\"#\">Orange link over a later photo</a></div>\
         <img class=\"photo\" style=\"z-index: -1\" src=\"{PHOTO}\"></section>"
    );
    assert!(hero_page(css, &later).is_empty(), "{:?}", hero_page(css, &later));
    // Control: no photo, and the page's white is the surface.
    let bare = "<section class=\"hero\"><div class=\"content\"><a class=\"o\" href=\"#\">Orange link on the page</a></div></section>";
    assert!(
        hero_page(css, bare).iter().any(|s| s.contains("#f37b2e on #ffffff")),
        "{:?}",
        hero_page(css, bare)
    );
}

#[test]
fn a_photo_drawn_by_a_pseudo_element_is_under_the_text() {
    let css = ".hero { position: relative; height: 400px; } \
               .hero::before { content: \"\"; position: absolute; inset: 0; background: url(\"hero.jpg\") center / cover no-repeat; } \
               .content { position: relative; padding: 150px 100px; }";
    let body = "<section class=\"hero\"><div class=\"content\"><a class=\"o\" href=\"#\">Orange link over a pseudo photo</a></div></section>";
    assert!(hero_page(css, body).is_empty(), "{:?}", hero_page(css, body));
}

#[test]
fn a_photo_sized_to_part_of_its_block_is_not_under_the_whole_run() {
    // A half-width picture: the run straddles the photo and the page, and the
    // half on the page does fail. The browser path scores it the same way.
    let css = ".split { position: relative; height: 400px; } \
               .split picture { position: absolute; left: 0; top: 0; width: 50%; height: 100%; } \
               .content { position: relative; padding: 180px 0 0 400px; }";
    let body = format!(
        "<section class=\"split\"><picture><img src=\"{PHOTO}\"></picture>\
         <div class=\"content\"><a class=\"o\" href=\"#\">Orange link half over a picture</a></div></section>"
    );
    assert!(
        hero_page(css, &body).iter().any(|s| s.contains("#f37b2e on #ffffff")),
        "{:?}",
        hero_page(css, &body)
    );
}

#[test]
fn an_opaque_card_over_the_photo_is_still_the_surface() {
    let css = ".hero { position: relative; height: 500px; } \
               .photo { position: absolute; inset: 0; width: 100%; height: 100%; } \
               .card { position: absolute; left: 100px; top: 100px; width: 400px; padding: 30px; background: #ffffff; } \
               .glass { position: absolute; left: 600px; top: 100px; width: 400px; padding: 30px; background: rgba(255, 255, 255, 0.7); } \
               .g1 { color: #949494; font-size: 15px; } .g2 { color: #959595; font-size: 15px; }";
    let body = format!(
        "<section class=\"hero\"><img class=\"photo\" src=\"{PHOTO}\">\
         <div class=\"card\"><a class=\"g1\" href=\"#\">Opaque card link</a></div>\
         <div class=\"glass\"><a class=\"g2\" href=\"#\">Glass card link</a></div></section>"
    );
    let snippets = hero_page(css, &body);
    assert!(snippets.iter().any(|s| s.contains("#949494 on #ffffff")), "{snippets:?}");
    assert!(
        !snippets.iter().any(|s| s.contains("#959595")),
        "translucent glass over a photo is not a surface this can name, {snippets:?}"
    );
}

#[test]
fn an_icon_beside_the_text_does_not_hide_its_surface() {
    let icon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10'%3E%3Cpath d='M0 0h10v10'/%3E%3C/svg%3E";
    let css = format!(
        ".ext {{ color: #9f9f9f; font-size: 15px; padding-right: 18px; background: url(\"{icon}\") no-repeat right center; }} \
         ul.arrows li {{ padding-left: 14px; background: url(\"{icon}\") no-repeat 0 50%; }} \
         .m6 {{ color: #9e9e9e; font-size: 15px; }} \
         .photo-link {{ color: #9d9d9d; font-size: 15px; background: url(\"/photo.jpg\") no-repeat; }}"
    );
    let body = "<p><a class=\"ext\" href=\"#\">Grey external link with its own icon</a></p>\
                <ul class=\"arrows\"><li><a class=\"m6\" href=\"#\">Grey link in a list item with an arrow bullet</a></li></ul>\
                <p><a class=\"photo-link\" href=\"#\">Grey link over its own remote image</a></p>";
    let snippets = hero_page(&css, body);
    assert!(snippets.iter().any(|s| s.contains("#9f9f9f on #ffffff")), "{snippets:?}");
    assert!(snippets.iter().any(|s| s.contains("#9e9e9e on #ffffff")), "{snippets:?}");
    assert!(
        !snippets.iter().any(|s| s.contains("#9d9d9d")),
        "a remote image has no size this engine can read, {snippets:?}"
    );
}

#[test]
fn a_photo_stretched_over_another_section_is_not_under_the_text() {
    // The hero's photo fills the hero, which is positioned; the link sits in
    // the next section on the page's own white and is scored there.
    let css = ".hero { position: relative; height: 500px; } \
               .hero img { position: absolute; inset: 0; width: 100%; height: 100%; } \
               .plain { padding: 100px; } .lnk2 { color: #9c9c9c; font-size: 15px; }";
    let body = format!(
        "<section class=\"hero\"><img src=\"{PHOTO}\"></section>\
         <section class=\"plain\"><div><a class=\"lnk2\" href=\"#\">Control link on page white</a></div></section>"
    );
    assert!(
        hero_page(css, &body).iter().any(|s| s.contains("#9c9c9c on #ffffff")),
        "{:?}",
        hero_page(css, &body)
    );
}
