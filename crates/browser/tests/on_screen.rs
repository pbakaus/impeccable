//! What the text rules score of copies only partly on screen, over
//! `tests/fixtures/antipatterns/on-screen.html`, rendered by an installed
//! browser. Skips cleanly when there is none.
//!
//! A text measurement with less than a quarter of its width inside its clip
//! or on the page is not painted for the text rules; a box with no area shows
//! no text; the page's one report of a colour pair goes to a copy whose text
//! shows across its whole width; and heading-rhythm counts only headings a
//! visitor sees. None of that is visible to the static engine, which measures
//! no boxes.

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

fn assert_cases(found: &[(String, String)], flag: &[&str], pass: &[&str], rule: &str) {
    for case in flag {
        assert!(
            found.iter().any(|(_, sel)| sel.contains(case)),
            "{rule}: `{case}` should flag, got {found:?}"
        );
    }
    for case in pass {
        assert!(
            !found.iter().any(|(_, sel)| sel.contains(case)),
            "{rule}: `{case}` should pass, got {found:?}"
        );
    }
}

#[test]
fn text_rules_score_only_copies_a_reader_can_see() {
    let Some(engine) = engine() else { return };
    let port = serve();

    let contrast = findings(&engine, port, "on-screen.html", "low-contrast");
    assert_cases(
        &contrast,
        &[
            "#flag-slide-date",
            "#flag-whole-copy",
            "#flag-truncated-copy",
            "#flag-shell-cut",
            "#flag-shell-desktop",
        ],
        &[
            "#pass-parked-date",
            "#pass-edge-sliver",
            "#pass-cut-copy",
            "#pass-sliver-copy",
            "#pass-shell-track-sliver",
            // One colour pair, one report (r14-t2): the cut and half-off
            // dates wear the first slide date's pair and are counted there.
            "#flag-cut-date",
            "#flag-edge-half",
        ],
        "low-contrast",
    );
    assert_eq!(contrast.len(), 5, "only the flag cases: {contrast:?}");
    let snippet_on = |case: &str| contrast.iter().find(|(_, sel)| sel.contains(case)).map(|(s, _)| s.as_str()).unwrap_or("");
    // The slide date counts the cut date and the half-off date, and not the
    // parked slide or the sliver, which a reader does not see as text.
    assert!(snippet_on("#flag-slide-date").ends_with("(and 2 more)"), "{contrast:?}");
    // The whole word counts the cut copy it took the pair from.
    assert!(snippet_on("#flag-whole-copy").ends_with("(and 1 more)"), "{contrast:?}");

    let tiny = findings(&engine, port, "on-screen.html", "tiny-text");
    assert_cases(&tiny, &["#flag-zero-anchor"], &["#pass-zero-box"], "tiny-text");

    let rhythm = findings(&engine, port, "on-screen.html", "heading-rhythm");
    assert_eq!(rhythm.len(), 2, "the two crowded headings on screen: {rhythm:?}");
    assert!(
        rhythm
            .iter()
            .all(|(snippet, _)| snippet.ends_with("(2 headings on page)") && !snippet.contains("Pass Parked Slide")),
        "the parked slide's heading is neither reported nor counted: {rhythm:?}"
    );
}
