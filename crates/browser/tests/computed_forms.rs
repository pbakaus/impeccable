//! Rules a rendered page answers differently from its markup, against an
//! installed browser. Skips cleanly when there is none.
//!
//! `computed-forms.html` holds a should-flag and a should-pass case for each:
//! a gray utility class whose computed ink is white (hse.de), capitals typed
//! into the markup that wrap (mialight.app), a cyan stop tied with a mint
//! green one (weborama.com), a stripe child on a square host and inside a
//! heading (lance.com.br), and a count beside an icon over a card photo
//! (gig-connect-six.vercel.app). None of the assertions depends on a font's
//! metrics: the tracked caption passes on one line or on two.
//!
//! `side-tab-status-rows.html` holds the side borders on a status row and
//! cell, which the stylesheet scans read and the browser reads off the
//! computed sides.

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

const FIXTURE: &str = "computed-forms.html";

#[test]
fn rendered_answers_drop_the_should_pass_cases() {
    let Some(engine) = engine() else { return };
    let port = serve();
    for (rule, flag, pass) in [
        ("gray-on-color", vec!["#flag-gray-class"], vec!["#pass-gray-class-white"]),
        ("wide-tracking", vec!["#flag-tracked-mixed"], vec!["#pass-tracked-caps"]),
        ("ai-color-palette", vec!["#flag-cyan-blue"], vec!["#pass-cyan-mint"]),
        ("side-tab", vec!["#flag-stripe-rounded"], vec!["#pass-stripe-square", "#pass-stripe-heading"]),
    ] {
        let found = findings(&engine, port, FIXTURE, rule);
        for selector in flag {
            assert!(found.iter().any(|(_, s)| s == selector), "{rule}: missing {selector} in {found:#?}");
        }
        for selector in pass {
            assert!(!found.iter().any(|(_, s)| s == selector), "{rule}: unexpected {selector} in {found:#?}");
        }
    }
    let mut labels: Vec<String> = findings(&engine, port, FIXTURE, "numbered-section-labels")
        .into_iter()
        .map(|(snippet, _)| snippet)
        .collect();
    labels.sort();
    assert_eq!(
        labels,
        vec![
            "tiny numbered label \"01\" beside h2 \"First section of the page\" (2 on page)",
            "tiny numbered label \"02\" beside h2 \"Second section of the page\" (2 on page)",
        ],
        "the capacity badges are not section numbers"
    );
}

#[test]
fn a_side_border_on_a_status_row_or_cell_is_a_side_tab() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let found = findings(&engine, port, "side-tab-status-rows.html", "side-tab");
    let snippets: Vec<&str> = found.iter().map(|(snippet, _)| snippet.as_str()).collect();
    for expected in [
        "border-left 3px stripe on a row or cell (left edge)",
        "border-left 2px stripe on a row or cell (left edge)",
    ] {
        assert!(snippets.iter().any(|s| s.contains(expected)), "missing {expected} in {snippets:#?}");
    }
    for silent in ["td.bounded", "is-void"] {
        assert!(!snippets.iter().any(|s| s.contains(silent)), "unexpected {silent} in {snippets:#?}");
    }
    assert_eq!(found.len(), 8, "{snippets:#?}");
}
