//! Structure read from computed boxes instead of class names and fixed
//! ceilings, over `tests/fixtures/antipatterns/`, rendered by an installed
//! browser. Skips cleanly when there is none. The file scan has no layout, so
//! several pass cases here are reported by it and recorded in its goldens.
//!
//! - `nested-cards.html`: a card paints an edge on three sides or a fill that
//!   differs from its surface, and is rounded or shadowed; dividers, pills,
//!   one-line eyebrows, a card's own header band and a lip shadow are not cards.
//!   An inner card shows a border or casts a shadow (r4-p16), and figures,
//!   output blocks, players and a dialog's panels are not inner cards when
//!   they are the box's main child (r4-p17).
//! - `clipped-overflow-container.html`: track words read past BEM separators
//!   and camelCase, and on the positioned child itself.
//! - `buried-raster.html`: SVG sources, icon-sized boxes, blurred placeholders
//!   and crossfade frames are state layers.
//! - `gray-on-color.html`: the colour bar scales with luminance, and a state
//!   variant is not the resting fill.
//! - `footnote-markers.html`: links inside `sup` and `sub` are markers.
//! - `flat-type-hierarchy-h1-tie.html`, `oversized-h1-rendered.html`,
//!   `first-viewport-column-overflow-outline.html`,
//!   `first-viewport-column-overflow-tabs.html`: the page-level misreads.
//! - `gpt-thin-border-wide-shadow.html`: negative spread and halo visibility.
//! - `em-dash-pricing-matrix.html`, `em-dash-prose-with-matrix.html`: lone
//!   dashes in cells are not prose.
//! - `icon-tile-stack.html`, `kicker-above-heading.html`,
//!   `numbered-section-labels.html`: the label collectors climb wrappers, read
//!   the type off the text-bearing child, and scale their ceilings.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};

use impeccable_browser::BrowserEngine;
use impeccable_detect::engines::{ScanOptions, UrlEngine};

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/antipatterns")
}

fn serve() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            std::thread::spawn(move || handle(stream));
        }
    });
    port
}

fn handle(mut stream: TcpStream) {
    let mut buf = [0u8; 8192];
    let n = stream.read(&mut buf).unwrap_or(0);
    let request = String::from_utf8_lossy(&buf[..n]);
    let rel = request
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .unwrap_or("/")
        .trim_start_matches('/')
        .to_string();
    let (status, body) = match std::fs::read(fixtures_dir().join(&rel)) {
        Ok(body) if !rel.contains("..") => ("200 OK", body),
        _ => ("404 Not Found", b"missing".to_vec()),
    };
    let head = format!(
        "HTTP/1.0 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(&body);
    let _ = stream.flush();
}

/// `(antipattern, snippet, selector)` for every finding on one fixture, or
/// `None` when no browser is installed.
fn scan(fixture: &str) -> Option<Vec<(String, String, String)>> {
    let env: HashMap<String, String> = std::env::vars().collect();
    if impeccable_browser::discovery::find_browser(&env).is_err() {
        eprintln!("skip: no installed browser found");
        return None;
    }
    let engine = BrowserEngine::new(env);
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/{fixture}");
    let findings = engine.detect_url(&url, &ScanOptions::default()).expect("scan");
    Some(
        findings
            .iter()
            .map(|f| {
                let selector = f
                    .extras
                    .get("selector")
                    .and_then(|s| s.as_str())
                    .unwrap_or("")
                    .to_string();
                (f.antipattern.clone(), f.snippet.clone(), selector)
            })
            .collect(),
    )
}

fn of_rule<'a>(findings: &'a [(String, String, String)], rule: &str) -> Vec<(&'a str, &'a str)> {
    findings
        .iter()
        .filter(|(id, _, _)| id == rule)
        .map(|(_, s, sel)| (s.as_str(), sel.as_str()))
        .collect()
}

fn assert_marks(findings: &[(String, String, String)], rule: &str, flag: &[&str], pass: &[&str]) {
    let hits = of_rule(findings, rule);
    for want in flag {
        assert!(
            hits.iter().any(|(s, sel)| s.contains(want) || sel.contains(want)),
            "{rule}: expected {want} to flag, got {hits:?}"
        );
    }
    for unwanted in pass {
        assert!(
            !hits.iter().any(|(s, sel)| s.contains(unwanted) || sel.contains(unwanted)),
            "{rule}: {unwanted} flagged in {hits:?}"
        );
    }
}

#[test]
fn nested_cards_read_the_computed_box() {
    let Some(findings) = scan("nested-cards.html") else {
        return;
    };
    assert_marks(
        &findings,
        "nested-cards",
        &[
            "#flag-outlined-inner",
            "#flag-raised-inner",
            "#flag-tint-shadow-inner",
            "#flag-controls-inner",
            "#flag-icon-inner",
            "#flag-mono-page-inner",
            // r4-p17: embedded content that is not the box's main child, and
            // a card nested further inside a dialog's panel.
            "#flag-hidden-audio-inner",
            "#flag-avatar-video-inner",
            "#flag-promo-player-inner",
            "#flag-illustration-inner",
            "#flag-dialog-nested-inner",
            "#flag-mono-button-inner",
            // observations-1006 row 19: two links are not a strip.
            "#flag-two-links-inner",
        ],
        &[
            "#pass-band-inner",
            "#pass-strip-inner",
            "#pass-pill-inner",
            "#pass-eyebrow-inner",
            "#pass-header-band",
            "#pass-field-box",
            "#pass-media-frame",
            "#pass-mark-inline",
            "#pass-lip-inner",
            // r4-p16: a fill with no border and no shadow.
            "#pass-tint-inner",
            // r4-p17: embedded content, and a dialog's panels.
            "#pass-figure-inner",
            "#pass-canvas-inner",
            "#pass-output-inner",
            "#pass-player-inner",
            "#pass-dialog-inner",
            "#flag-dialog-group",
            // observations-1006 row 19: a row of three links, and a tab
            // spanning a clipped column in the card's corner.
            "#pass-link-strip-inner",
            "#pass-corner-tab-inner",
        ],
    );
}

/// observations-1010 row 7 (swapno.in): the page wrapper is the page, not
/// an outer card; a centred panel narrower than the viewport is one.
#[test]
fn nested_cards_skip_the_page_frame() {
    let Some(findings) = scan("nested-cards-page-frame.html") else {
        return;
    };
    assert_marks(&findings, "nested-cards", &["#flag-panel-card"], &["#pass-frame-card"]);
}

#[test]
fn clipped_overflow_reads_track_words_past_bem_and_camel_case() {
    let Some(findings) = scan("clipped-overflow-container.html") else {
        return;
    };
    assert_marks(
        &findings,
        "clipped-overflow-container",
        &["flag-bem-tooltip", "flag-overflow-hidden", "flag-native-dialog"],
        &["pass-bem-marquee", "hotStuffBox", "pass-camel-host", "pass-nested-deck", "pass-closed-dialog", "pass-modal-dialog"],
    );
}

#[test]
fn buried_raster_skips_state_layers() {
    let Some(findings) = scan("buried-raster.html") else {
        return;
    };
    assert_marks(
        &findings,
        "buried-raster",
        &["#flag-buried-texture", "ghost-img"],
        &[
            "#pass-svg-state-icon",
            "#pass-svg-copy-button",
            "#pass-png-icon",
            "#pass-blurred-placeholder",
            "#pass-crossfade-frame",
        ],
    );
}

#[test]
fn gray_on_color_scales_its_bar_with_luminance() {
    let Some(findings) = scan("gray-on-color.html") else {
        return;
    };
    assert_marks(
        &findings,
        "gray-on-color",
        &["#flag-gray-on-navy", "#flag-gray-on-teal", "#flag-gray-on-dark-navy", "#flag-tailwind-classes"],
        &["#pass-gray-on-near-black-navy", "#pass-off-white-on-navy", "#pass-off-white-on-teal", "#pass-hover-variant"],
    );
}

#[test]
fn undersized_ui_text_skips_links_inside_markers() {
    let Some(findings) = scan("footnote-markers.html") else {
        return;
    };
    assert_marks(
        &findings,
        "undersized-ui-text",
        &["#flag-tiny-nav-link"],
        &["#pass-footnote-link", "#pass-sub-link", "#pass-em-sup-link"],
    );
}

#[test]
fn page_level_misreads_stay_silent() {
    for (fixture, rule) in [
        ("flat-type-hierarchy-h1-tie.html", "flat-type-hierarchy"),
        ("flat-type-hierarchy-dropped-role.html", "flat-type-hierarchy"),
        ("flat-type-hierarchy-h1-label.html", "flat-type-hierarchy"),
        ("oversized-h1-rendered.html", "oversized-h1"),
        ("first-viewport-column-overflow-outline.html", "first-viewport-column-overflow"),
        ("first-viewport-column-overflow-tabs.html", "first-viewport-column-overflow"),
        ("first-viewport-column-overflow-clipped.html", "first-viewport-column-overflow"),
        ("em-dash-pricing-matrix.html", "em-dash-overuse"),
        ("em-dash-list-separators.html", "em-dash-overuse"),
        ("em-dash-paired-dash.html", "em-dash-overuse"),
        ("skipped-heading-hidden-panel.html", "skipped-heading"),
    ] {
        let Some(findings) = scan(fixture) else {
            return;
        };
        let hits = of_rule(&findings, rule);
        assert!(hits.is_empty(), "{fixture}: {rule} reported {hits:?}");
    }
    // The twins still report.
    for (fixture, rule) in [
        ("flat-type-hierarchy.html", "flat-type-hierarchy"),
        ("flat-type-hierarchy-dropped-flat.html", "flat-type-hierarchy"),
        ("oversized-h1-browser.html", "oversized-h1"),
        ("first-viewport-column-overflow.html", "first-viewport-column-overflow"),
        ("em-dash-prose-with-matrix.html", "em-dash-overuse"),
        ("em-dash-prose-list.html", "em-dash-overuse"),
        ("em-dash-prose-bullets.html", "em-dash-overuse"),
        ("skipped-heading-sr-only.html", "skipped-heading"),
    ] {
        let Some(findings) = scan(fixture) else {
            return;
        };
        let hits = of_rule(&findings, rule);
        assert!(!hits.is_empty(), "{fixture}: expected {rule}, got {findings:?}");
    }
}

#[test]
fn gpt_border_shadow_measures_spread_and_visibility() {
    let Some(findings) = scan("gpt-thin-border-wide-shadow.html") else {
        return;
    };
    assert_marks(
        &findings,
        "gpt-thin-border-wide-shadow",
        &["flag-row-first", "flag-offset-second"],
        &["pass-spread-first", "pass-spread-third", "pass-dark-first", "pass-dark-third"],
    );
    // The per-article panels carry no id or unique class, so their selectors
    // are paths; the three of the flag column report at the halo's own blur.
    let panels: Vec<_> = of_rule(&findings, "gpt-thin-border-wide-shadow")
        .into_iter()
        .filter(|(_, sel)| sel.contains("figure.card.panel"))
        .collect();
    assert_eq!(panels.len(), 3, "{panels:?}");
    assert!(panels.iter().all(|(s, _)| s.contains("60px shadow blur")), "{panels:?}");
}

#[test]
fn label_collectors_climb_and_scale() {
    let Some(findings) = scan("icon-tile-stack.html") else {
        return;
    };
    assert_marks(
        &findings,
        "icon-tile-stack",
        &[
            "Lightning Fast",
            "Tinted Tile",
            "Ring Tile",
            "Framer Card Heading",
            "Contents Wrapped Tile",
            "Emoji In A Span",
        ],
        &["Far From The Tile", "Sarah Chen", "Inline Side By Side", "Word In A Span", "Hidden Emoji In A Span"],
    );

    let Some(findings) = scan("kicker-above-heading.html") else {
        return;
    };
    assert_marks(
        &findings,
        "kicker-above-heading",
        &[
            "A Single Kicker Still Flags",
            "Relative Kicker Ceiling",
            "Eyebrow In A Framer Wrapper",
            "Section Title In A Panel",
            "Display Title In A Band",
            "Plain Label Over A Large Card Title",
            "Pill In Flow Over A Large Card Title",
            "Absolute Eyebrow In A Card",
        ],
        &[
            "Label Too Large For Its Heading",
            "Untracked Caps Label",
            "Press Card Source",
            "Badge On A Pricing Card",
        ],
    );

    let Some(findings) = scan("numbered-section-labels.html") else {
        return;
    };
    assert_marks(
        &findings,
        "numbered-section-labels",
        &["Alpha ships first", "Instant deployment", "Omega grows larger", "Xi connects", "Omicron remembers"],
        &["Nu sits too close in size", "Epsilon reads large", "Lambda sits in a card", "Pi keeps its card", "Rho sits in a linked card", "Sigma sits in a drawn wrapper", "Tau ranks first", "Upsilon ranks second"],
    );
}
