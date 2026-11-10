//! Corpus decision r6-t5-unread-pixel-verdicts in the URL engine, over
//! `tests/fixtures/antipatterns/low-contrast-unread-pixels.html`, rendered by
//! an installed browser. Skips cleanly when there is none.
//!
//! White copy over a dark photo the contrast walk cannot read is scored
//! against the grey fill under the photo and handed to the pixel pass. Where
//! the pixels read it, their verdict replaces the element pass's (the copy
//! passes); where they refuse to (a backdrop filter over the photo), the
//! element pass's ratio measured nothing and is dropped (round 13 decision
//! 2). Outlined copy under the same filter is handed over for its outline,
//! and where the pixels refuse it, its verdict stands as advisory with its
//! ratio.

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

fn engine() -> Option<BrowserEngine> {
    let env: HashMap<String, String> = std::env::vars().collect();
    if impeccable_browser::discovery::find_browser(&env).is_err() {
        eprintln!("skip: no installed browser found");
        return None;
    }
    Some(BrowserEngine::new(env))
}

#[test]
fn verdicts_the_pixels_could_not_read_are_advisory() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/low-contrast-unread-pixels.html");
    let findings = engine.detect_url(&url, &ScanOptions::default()).expect("scan");
    let low: Vec<(&str, &str, Option<bool>)> = findings
        .iter()
        .filter(|f| f.antipattern == "low-contrast")
        .map(|f| {
            (
                f.extras.get("selector").and_then(|v| v.as_str()).unwrap_or(""),
                f.severity.as_str(),
                f.advisory,
            )
        })
        .collect();
    assert_eq!(
        low,
        vec![
            ("#flag-outlined-copy-under-backdrop-filter", "advisory", Some(true)),
            ("#flag-white-under-light-wash", "advisory", Some(true)),
        ],
        "{findings:#?}"
    );
    let snippet = &findings
        .iter()
        .find(|f| f.antipattern == "low-contrast")
        .expect("finding")
        .snippet;
    // The outlined copy keeps the element pass's ratio; the plain copy over
    // the same photo, whose ratio measured nothing, reports nothing.
    assert!(snippet.contains(":1 (need 4.5:1) — text #ffffff on #"), "{snippet}");
}

/// smartbi.ca's backdrop: a fixed scrim over the whole page dims the teal
/// eyebrow and its ground alike, so the eyebrow's failing ratio is measured
/// through it and stands as advisory where the pixels give none.
#[test]
fn a_verdict_under_a_scrim_is_measured_through_it() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/low-contrast-unread-scrim.html");
    let findings = engine.detect_url(&url, &ScanOptions::default()).expect("scan");
    let low: Vec<(&str, &str, &str)> = findings
        .iter()
        .filter(|f| f.antipattern == "low-contrast")
        .map(|f| {
            (
                f.extras.get("selector").and_then(|v| v.as_str()).unwrap_or(""),
                f.severity.as_str(),
                f.snippet.as_str(),
            )
        })
        .collect();
    assert_eq!(low.len(), 1, "{findings:#?}");
    assert_eq!(low[0].0, "#flag-eyebrow-under-scrim");
    assert_eq!(low[0].1, "advisory");
    assert!(low[0].2.contains("text #4dc7cc on #ffffff"), "{}", low[0].2);
}
