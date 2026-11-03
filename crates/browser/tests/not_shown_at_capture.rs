//! Text that is not presented at capture, against an installed browser.
//! Skips cleanly when there is none.
//!
//! Each should-pass case in `not-shown-at-capture.html` sits beside a
//! should-flag twin that differs in the one fact the engine reads; the base
//! engine (dad8dbb3) reports every should-pass case under the rule named
//! here too.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};

use impeccable_browser::BrowserEngine;
use impeccable_detect::engines::{ScanOptions, UrlEngine};

const FIXTURE: &str = "not-shown-at-capture.html";

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
fn text_not_presented_at_capture_is_not_scored() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/{FIXTURE}");
    let findings = engine.detect_url(&url, &ScanOptions::default()).expect("scan");
    let flagged: Vec<(String, String)> = findings
        .iter()
        .map(|f| {
            (
                f.antipattern.clone(),
                f.extras.get("selector").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            )
        })
        .collect();
    let on = |rule: &str, selector: &str| flagged.iter().any(|(r, s)| r == rule && s == selector);

    for want in [
        ("low-contrast", "#flag-inert-section"),
        ("low-contrast", "#flag-open-dialog"),
        ("low-contrast", "#flag-glass-copy"),
        ("low-contrast", "#flag-card-text"),
        ("undersized-ui-text", "#flag-shown-crumb"),
        ("text-occlusion", "#flag-rain"),
        ("low-contrast", "#flag-ticker-chip"),
        // The first review's probes.
        ("low-contrast", "#flag-inert-dialog"),
        ("low-contrast", "#flag-glass-heading"),
        ("low-contrast", "#flag-wide-headline"),
        ("undersized-ui-text", "#flag-bar-crumb"),
    ] {
        assert!(on(want.0, want.1), "missing {want:?} in {flagged:#?}");
    }
    // The covering cards are themselves a collision: text-occlusion reports
    // the text under them, and that is not what these cases pin.
    for gone in [
        ("low-contrast", "#pass-drawer-link"),
        ("text-occlusion", "#pass-drawer-link"),
        ("low-contrast", "#pass-glass-copy"),
        ("low-contrast", "#pass-card-text"),
        ("undersized-ui-text", "#pass-covered-crumb"),
        ("text-occlusion", "#pass-rain"),
        ("low-contrast", "#pass-ticker-chip"),
    ] {
        assert!(!on(gone.0, gone.1), "unexpected {gone:?} in {flagged:#?}");
    }
}
