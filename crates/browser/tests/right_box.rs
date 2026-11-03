//! Round 8, "measuring the right box", against an installed browser. Skips
//! cleanly when there is none.
//!
//! Each fixture pairs a misread the corpus judged absent (observations-35
//! rows 6, 7, 8, 12 and 15, and the side-tab recall bug of walkthroughs-35)
//! with the twin that still reports. Most of what these rules read is layout:
//! boxes, text rects, scroll widths, the hit-test stack. None of that reaches
//! the static engine.

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
    let url = format!("http://127.0.0.1:{port}/{fixture}");
    engine
        .detect_url(&url, &ScanOptions::default())
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
fn a_thin_stripe_is_read_against_the_far_corners() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let mut found = findings(&engine, port, "side-tab-far-corners.html", "side-tab");
    found.sort();
    assert_eq!(
        found,
        vec![
            ("border-left: 2px + border-radius: 12px".to_string(), "div.card.flag-left-far-rounded".to_string()),
            ("border-left: 2px + border-radius: 6px".to_string(), "div.card.flag-left-uneven-far".to_string()),
            ("border-left: 4px".to_string(), "div.card.flag-left-wide-far-rounded".to_string()),
            ("border-left: 4px + border-radius: 32px".to_string(), "div.flag-padded-pill".to_string()),
            ("border-right: 2px + border-radius: 12px".to_string(), "div.card.flag-right-far-rounded".to_string()),
        ]
    );
    // observations-1010 rows 6 and 17: an arc on a ring and a band on a
    // closed menu panel are not accents; the open panel is.
    let bands = findings(&engine, port, "side-tab-far-corners.html", "border-accent-on-rounded");
    assert_eq!(
        bands,
        vec![("border-top: 3px + border-radius: 4px".to_string(), "div.panel.flag-band-open-panel".to_string())]
    );
}

#[test]
fn a_clip_cuts_only_a_popover_layer_by_its_box() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let found = findings(&engine, port, "clipped-overflow-painted-box.html", "clipped-overflow-container");
    assert_cases(
        &found,
        &["flag-cuts-menu", "flag-cuts-tooltip"],
        &["pass-holds-wrapper", "pass-holds-scrolling-row"],
        "clipped-overflow-container",
    );
    assert_eq!(found.len(), 2, "{found:?}");
}

#[test]
fn a_heading_is_measured_past_spacer_wrappers_and_not_past_main() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let found = findings(&engine, port, "heading-rhythm-spacers.html", "heading-rhythm");
    assert_cases(
        &found,
        &["flag-crowded-one", "flag-crowded-two"],
        &["pass-under-wrapped-spacer", "pass-ends-main"],
        "heading-rhythm",
    );
    assert!(found.iter().all(|(snippet, _)| snippet.contains("8px above vs 40px below")), "{found:?}");
}

#[test]
fn a_truncated_line_and_a_running_track_meet_no_viewport_edge() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let found = findings(&engine, port, "body-text-viewport-edge-truncated.html", "body-text-viewport-edge");
    let (page, element): (Vec<_>, Vec<_>) = found.into_iter().partition(|(_, sel)| sel == "body");
    assert_cases(
        &element,
        &["flag-on-parked-track"],
        &["pass-truncated-line", "pass-on-running-track"],
        "body-text-viewport-edge",
    );
    assert!(element.iter().any(|(snippet, _)| snippet.contains("(right 7px)")), "{element:?}");
    // The unclipped line is the page's one overflow finding, and it counts
    // one block: the truncated line beside it is not past the page.
    assert_eq!(page.len(), 1, "{page:?}");
    assert!(page[0].0.contains("flag-unclipped-line") && page[0].0.contains("text in 1 block"), "{page:?}");
}

#[test]
fn text_buried_under_the_answering_layer_is_not_overlapped() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let found = findings(&engine, port, "text-occlusion-buried.html", "text-occlusion");
    assert_cases(
        &found,
        &["flag-under-headline"],
        &["pass-under-photo", "pass-under-own-container"],
        "text-occlusion",
    );
}

#[test]
fn table_cells_are_not_cards() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let found = findings(&engine, port, "edge-flush-cards-table.html", "edge-flush-cards");
    assert_cases(&found, &["flag-card-rail"], &["pass-data-table", "table", "pass-inset-rail"], "edge-flush-cards");
}

#[test]
fn slides_of_one_carousel_repeat_nothing() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let found = findings(&engine, port, "repeated-container-text-carousel.html", "repeated-container-text");
    assert_eq!(found.len(), 1, "{found:?}");
    assert!(found[0].0.starts_with("\"Servidor VPS\" rendered 3× in distinct spots"), "{found:?}");
}

#[test]
fn stacked_blocks_are_not_columns() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let stacked = findings(
        &engine,
        port,
        "first-viewport-column-overflow-stacked.html",
        "first-viewport-column-overflow",
    );
    assert!(stacked.is_empty(), "{stacked:?}");
    // The side-by-side twin still reports.
    let columns = findings(&engine, port, "first-viewport-column-overflow.html", "first-viewport-column-overflow");
    assert!(!columns.is_empty());
}

#[test]
fn a_composite_control_is_not_a_nested_card() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let found = findings(&engine, port, "nested-cards-controls.html", "nested-cards");
    assert_cases(
        &found,
        &["flag-plain-box"],
        &["pass-tablist", "pass-radiogroup", "pass-toolbar"],
        "nested-cards",
    );
}

#[test]
fn focusable_regions_and_code_runs_are_not_undersized_controls() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let found = findings(&engine, port, "undersized-ui-text-focus-and-code.html", "undersized-ui-text");
    assert_cases(
        &found,
        &["flag-focusable-control", "flag-mono-price", "flag-mono-count"],
        &["pass-json-key", "pass-json-pair", "pass-json-string", "pass-json-close", "pass-footer-skip-target"],
        "undersized-ui-text",
    );
}
