//! Round 8 text and CSS-text forms against an installed browser. Skips
//! cleanly when there is none.
//!
//! - `overused-font-share-{pass,flag}.html`: a face that sets under one
//!   character in twenty of the visible text is not reported as primary.
//! - `overused-font-never-loaded.html`: a face the browser never loaded is
//!   not reported as primary (taste call r12-t2).
//! - `side-tab-stylesheet-forms.html`: a pseudo-element stripe its host
//!   already reports is not reported again from the stylesheet, and a stripe
//!   drawn by an image alone is not reported.
//! - `marquee-ornament.html`: an infinite horizontal loop that moves nothing
//!   to read or look at is not a marquee; on a pseudo-element, the
//!   pseudo-element is what moves.
//! - `bounce-easing-pulse.html`: a bounce name whose keyframes only scale
//!   between nothing and full size is a pulse.

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

#[test]
fn overused_font_stands_down_for_a_face_that_sets_next_to_no_text() {
    let Some(engine) = engine() else { return };
    let port = serve();

    // Thirty two-digit numbers in Inter over eight Georgia paragraphs, and a
    // closed drawer of Inter copy: about 3% of the visible characters.
    let pass = findings(&engine, port, "overused-font-share-pass.html", "overused-font");
    assert_eq!(pass, vec![], "Inter sets next to none of the visible text");

    // Thirty word labels in Inter: about 11%, and the element share stands.
    let flag = findings(&engine, port, "overused-font-share-flag.html", "overused-font");
    assert_eq!(flag.len(), 1, "{flag:?}");
    assert_eq!(flag[0].0, "Primary font: inter (79% of text)", "{flag:?}");
}

/// Taste call r12-t2: the same thirty labels on a page whose only Recoleta
/// `@font-face` fails to load, and which no test host installs, set their
/// text in a fallback, so Recoleta is not reported as the page's face. `overused-font-share-flag.html`,
/// which loads its Inter, is the should-flag twin above.
#[test]
fn overused_font_stands_down_for_a_face_the_browser_never_loaded() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let pass = findings(&engine, port, "overused-font-never-loaded.html", "overused-font");
    assert_eq!(pass, vec![], "Recoleta never loaded");
}

fn snippets(engine: &BrowserEngine, port: u16, fixture: &str, rule: &str) -> Vec<String> {
    let mut out: Vec<String> = findings(engine, port, fixture, rule).into_iter().map(|(s, _)| s).collect();
    out.sort();
    out
}

#[test]
fn a_pseudo_stripe_reports_once_and_an_image_stripe_does_not() {
    let Some(engine) = engine() else { return };
    let port = serve();
    assert_eq!(
        snippets(&engine, port, "side-tab-stylesheet-forms.html", "side-tab"),
        vec![
            // The element form, once each: the stylesheet form of the same
            // stripe is dropped.
            "div.band.flag-band::after — absolute 3px pseudo-element stripe (bottom)",
            "div.card.flag-card::before — absolute 5px pseudo-element stripe (left)",
            "div.photo-rule-tinted.flag-tinted::after — absolute 10px pseudo-element stripe (bottom)",
        ],
        "`.photo-rule::after` paints an image and names no colour"
    );
}

#[test]
fn a_marquee_carries_something_to_read_or_look_at() {
    let Some(engine) = engine() else { return };
    let port = serve();
    assert_eq!(
        snippets(&engine, port, "marquee-ornament.html", "marquee"),
        vec![
            ".flag-logos — infinite horizontal loop animation \"fixture-crawl\"",
            ".flag-ticker::before — infinite horizontal loop animation \"fixture-flow\"",
            ".flag-words — infinite horizontal loop animation \"fixture-crawl\"",
        ],
        "the wave path, the highlight sweep and the pseudo-element sheen move nothing a visitor reads"
    );
}

#[test]
fn a_bounce_name_that_only_pulses_is_not_a_bounce() {
    let Some(engine) = engine() else { return };
    let port = serve();
    assert_eq!(
        snippets(&engine, port, "bounce-easing-pulse.html", "bounce-easing"),
        vec!["animation: fixture-bounce", "animation: fixture-bounce-in"],
        "the loader dots scale between nothing and their size"
    );
}
