//! Text a visitor cannot see at capture, against an installed browser.
//! Skips cleanly when there is none.
//!
//! Each should-pass case in `not-visible-at-capture.html` sits beside a
//! should-flag twin that differs in the one fact the engine reads; the base
//! engine (786a7875) reports the should-pass cases too.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};

use impeccable_browser::BrowserEngine;
use impeccable_detect::engines::{ScanOptions, UrlEngine};

const FIXTURE: &str = "not-visible-at-capture.html";

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
fn text_a_visitor_cannot_see_at_capture_is_not_scored() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/{FIXTURE}");
    let findings = engine.detect_url(&url, &ScanOptions::default()).expect("scan");
    let flagged: Vec<(String, String, String)> = findings
        .iter()
        .map(|f| {
            (
                f.antipattern.clone(),
                f.extras.get("selector").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                f.snippet.clone(),
            )
        })
        .collect();
    let on = |rule: &str, selector: &str| flagged.iter().any(|(r, s, _)| r == rule && s == selector);
    let reports = |rule: &str, needle: &str| flagged.iter().any(|(r, _, snippet)| r == rule && snippet.contains(needle));

    for want in [
        ("text-occlusion", "#flag-curtain-link"),
        ("text-occlusion", "#flag-pe-label"),
        ("text-occlusion", "#flag-buried-header-link"),
        ("low-contrast", "#flag-placed-below"),
        ("body-text-viewport-edge", "#flag-sticky-copy"),
        ("undersized-ui-text", "#flag-2px-link"),
        ("low-contrast", "#flag-frame-badge"),
        ("low-contrast", "#flag-shown-placeholder"),
    ] {
        assert!(on(want.0, want.1), "missing {want:?} in {flagged:#?}");
    }
    // The shown labels report, and only they are counted.
    assert!(reports("numbered-section-labels", "Flag step one"), "{flagged:#?}");
    assert!(reports("numbered-section-labels", "(3 on page)"), "{flagged:#?}");
    assert!(!reports("numbered-section-labels", "Pass step"), "{flagged:#?}");

    let passed: Vec<&(String, String, String)> = flagged
        .iter()
        .filter(|(_, s, _)| s.starts_with("#pass-"))
        .collect();
    assert!(passed.is_empty(), "unexpected should-pass findings: {passed:#?}");
}
