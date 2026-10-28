//! Layers the contrast walk never reads, and occlusion answers the capture
//! disagrees with, against an installed browser. Skips cleanly when there is
//! none.
//!
//! - low-contrast does not score text a layer covers at capture (a fixed
//!   banner, a photo avatar), and prints no verdict where paint the walk never
//!   read lies under the text (a photo, a dark gradient layer, an SVG circle).
//!   Part of a run under a layer, a detached panel in the named colour, a
//!   faint wash, and texture over a section's own fill (a dot grid, a grain
//!   tile) keep their verdict, and a link colour covered once reports on its
//!   first uncovered copy. A CTA under the banner and a hero title over a photo
//!   laid on its section's own fill are not scored.
//! - text-occlusion does not count a box the page answered with where the
//!   capture did not put it.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};

use impeccable_browser::BrowserEngine;
use impeccable_detect::engines::{ScanOptions, UrlEngine};

const FIXTURE: &str = "covered-text-contrast.html";

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
        .to_string();
    let body = std::fs::read(fixtures_dir().join(path.trim_start_matches('/'))).unwrap_or_default();
    let head = format!(
        "HTTP/1.0 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(&body);
}

fn engine() -> Option<BrowserEngine> {
    let env: HashMap<String, String> = std::env::vars().collect();
    if impeccable_browser::discovery::find_browser(&env).is_err() {
        eprintln!("skip: no installed browser found");
        return None;
    }
    Some(BrowserEngine::new(env))
}

#[test]
fn covered_text_and_unread_surfaces_are_not_scored() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/{FIXTURE}");
    let findings = engine.detect_url(&url, &ScanOptions::default()).expect("scan");
    let flagged: Vec<(String, String, String)> = findings
        .iter()
        .map(|f| {
            (
                f.antipattern.clone(),
                f.extras
                    .get("selector")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                f.snippet.clone(),
            )
        })
        .collect();
    let has = |rule: &str, selector: &str| flagged.iter().any(|(r, s, _)| r == rule && s == selector);

    // The four copies set in #aaaaaa on white are one colour pair, reported
    // once by the first and counted (r14-t2): the half-covered, white-panel
    // and wash copies are the three more, and no pass case wearing the pair
    // joins them.
    assert!(
        flagged.iter().any(|(r, s, snippet)| r == "low-contrast"
            && s == "#flag-visible-copy"
            && snippet.ends_with("text #aaaaaa on #ffffff (and 3 more)")),
        "{flagged:#?}"
    );
    for (rule, selector) in [
        ("low-contrast", "#flag-dot-grid-copy"),
        ("low-contrast", "#flag-grain-copy"),
        ("low-contrast", "#flag-uncovered-link"),
        ("text-occlusion", "#flag-covered-caption"),
    ] {
        assert!(has(rule, selector), "missing {rule} on {selector} in {flagged:#?}");
    }
    for (rule, selector) in [
        ("low-contrast", "#pass-banner-copy"),
        ("low-contrast", "#pass-covered-link"),
        ("low-contrast", "#pass-avatar-initial"),
        ("low-contrast", "#pass-photo-copy"),
        ("low-contrast", "#pass-dark-layer-copy"),
        ("low-contrast", "#pass-circle-initial"),
        ("low-contrast", "#pass-covered-cta"),
        ("low-contrast", "#pass-hero-photo-title"),
        ("text-occlusion", "#pass-advancing-caption"),
    ] {
        assert!(!has(rule, selector), "{rule} on {selector} was flagged in {flagged:#?}");
    }
}
