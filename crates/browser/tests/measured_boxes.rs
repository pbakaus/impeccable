//! Round 9, "measuring the right box", against an installed browser. Skips
//! cleanly when there is none.
//!
//! Each fixture pairs a box the engine misread on the corpus (observations-42
//! rows 5, 6 and 13) with the twin that still reports. What these rules read
//! is layout: line rects, the hit-test stack, the boxes a paint sits on. None
//! of that reaches the static engine.

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
    let path = request
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .unwrap_or("/")
        .split('?')
        .next()
        .unwrap_or("/")
        .to_string();
    let (status, body) = match std::fs::read(fixtures_dir().join(path.trim_start_matches('/'))) {
        Ok(body) => ("200 OK", body),
        Err(_) => ("404 Not Found", b"missing".to_vec()),
    };
    let head = format!(
        "HTTP/1.0 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(&body);
    let _ = stream.flush();
}

fn engine() -> Option<BrowserEngine> {
    let env: HashMap<String, String> = std::env::vars().collect();
    if impeccable_browser::discovery::find_browser(&env).is_err() {
        eprintln!("skip: no installed browser found");
        return None;
    }
    Some(BrowserEngine::new(env))
}

/// `(snippet, selector)` for each finding of `rule` on one fixture.
fn findings(engine: &BrowserEngine, port: u16, fixture: &str, rule: &str) -> Vec<(String, String)> {
    findings_at(engine, port, fixture, rule, None)
}

/// [`findings`] scanned at `viewport` (the engine's default when `None`).
fn findings_at(
    engine: &BrowserEngine,
    port: u16,
    fixture: &str,
    rule: &str,
    viewport: Option<(u32, u32)>,
) -> Vec<(String, String)> {
    let url = format!("http://127.0.0.1:{port}/{fixture}");
    let options = ScanOptions { viewport, ..Default::default() };
    engine
        .detect_url(&url, &options)
        .expect("scan")
        .into_iter()
        .filter(|f| f.antipattern == rule)
        .map(|f| {
            let selector = f.extras.get("selector").and_then(|s| s.as_str()).unwrap_or("").to_string();
            (f.snippet, selector)
        })
        .collect()
}

/// Every `flag` case is named by a finding's selector or snippet, and no
/// `pass` case is.
fn assert_cases(found: &[(String, String)], flag: &[&str], pass: &[&str], rule: &str) {
    for case in flag {
        assert!(
            found.iter().any(|(snippet, sel)| sel.contains(case) || snippet.contains(case)),
            "{rule}: `{case}` should flag, got {found:?}"
        );
    }
    for case in pass {
        assert!(
            !found.iter().any(|(snippet, sel)| sel.contains(case) || snippet.contains(case)),
            "{rule}: `{case}` should pass, got {found:?}"
        );
    }
}

#[test]
fn cramped_padding_measures_the_box_the_text_sits_in() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let found = findings(&engine, port, "cramped-padding-measured.html", "cramped-padding");
    assert_cases(
        &found,
        &["flag-tight-band", "flag-gradient-other", "flag-plain-card", "flag-thin-bar"],
        &["pass-wrapped-band", "pass-mark", "pass-gradient-same", "pass-photo-card", "pass-url-bar"],
        "cramped-padding",
    );
}

#[test]
fn text_occlusion_needs_text_under_the_cover() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let found = findings(&engine, port, "text-occlusion-shapes.html", "text-occlusion");
    assert_cases(
        &found,
        &["flag-inline-leak", "flag-under-sticker", "flag-small-box-card", "flag-deck-status"],
        &[
            "pass-inline-alone",
            "pass-past-the-words",
            "pass-arrow-card",
            "pass-prev-arrow-card",
            "pass-inline-no-overhang",
        ],
        "text-occlusion",
    );
    let deck = found.iter().find(|(_, sel)| sel.contains("flag-deck-status")).expect("deck");
    assert!(deck.0.contains("on an opaque layer (div.deck-card.deck-front"), "{deck:?}");
}

#[test]
fn a_link_menu_is_not_a_column_and_a_disabled_control_takes_no_verdict() {
    let Some(engine) = engine() else { return };
    let port = serve();
    // Two rows open the page side by side, each half the 1280px window: the
    // row of near-menus reports once, and the row of five menus not at all.
    let menu = findings_at(
        &engine,
        port,
        "first-viewport-column-overflow-menu.html",
        "first-viewport-column-overflow",
        Some((1280, 800)),
    );
    assert_cases(&menu, &["flag-near-menus"], &["pass-link-menus"], "first-viewport-column-overflow");
    assert_eq!(menu.len(), 1, "{menu:?}");
    let contrast = findings(&engine, port, "low-contrast-disabled-control.html", "low-contrast");
    assert_cases(
        &contrast,
        &["flag-enabled"],
        &[
            "pass-disabled",
            "pass-disabled-label",
            "pass-aria-disabled-link",
            "pass-aria-disabled-role",
            "pass-disabled-fieldset",
        ],
        "low-contrast",
    );
    // The five enabled controls wear one colour pair, so the first reports
    // it and counts the other four (r14-t2): the label, the link, the
    // `aria-disabled="false"` button and the button in an enabled fieldset.
    // No disabled control joins the count.
    assert_eq!(contrast.len(), 1, "{contrast:?}");
    assert!(contrast[0].0.ends_with("text #ffffff on #16a34a (and 4 more)"), "{contrast:?}");
}

#[test]
fn display_text_in_a_generic_box_is_not_body_copy() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let found = findings_at(
        &engine,
        port,
        "body-text-viewport-edge-display.html",
        "body-text-viewport-edge",
        Some((390, 844)),
    );
    assert_cases(
        &found,
        &["flag-body-copy", "flag-copy-18", "flag-lead-20", "flag-copy-23"],
        &[
            "pass-display-title",
            "pass-title-24",
            "pass-title-flow-root",
            "pass-hero-line",
            "pass-copy-with-gutter",
        ],
        "body-text-viewport-edge",
    );
    assert_eq!(found.len(), 4, "{found:?}");
}
