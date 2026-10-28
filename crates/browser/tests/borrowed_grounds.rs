//! How the URL engine reads the grounds of
//! `tests/fixtures/antipatterns/low-contrast-borrowed-grounds.html`, against
//! an installed browser (observations-1010 rows 8 and 10, taste call
//! r14-t3). Skips cleanly when there is none.
//!
//! - A light dialog title over a translucent panel reads on the sibling
//!   scrim under it, and passes; on a bare panel it fails.
//! - A sweep face parked off its button, or hidden, is not the label's
//!   ground; in place it is, and so is a chip moved, turned, skewed or
//!   scaled but still under its label.
//! - A sparse dot grid over a fill is texture; opaque stripes, a pinhole
//!   mesh and a dense halftone are surfaces.
//! - A hover underline parked at zero size is no ground for the element pass
//!   or the pixels; drawn over the box it is.
//! - A faint word set aside from reading is advisory; the same word not set
//!   aside, shown above 1.5:1 at 0.4, part of the sr-only heading, or under
//!   a wrapper that passes clicks, keeps its warning.
//!
//! The assertions name cases and severities, never a measured colour, so
//! they hold whatever fonts the host has.

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
    // Serve fixtures only: no path that climbs out of the directory.
    let name = path.trim_start_matches('/');
    let read = if name.split('/').any(|part| part == ".." || part.is_empty()) {
        Err(std::io::Error::from(std::io::ErrorKind::NotFound))
    } else {
        std::fs::read(fixtures_dir().join(name))
    };
    let (status, body) = match read {
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

/// `(rule, selector, snippet, severity)` for every finding of a scan.
fn scan(engine: &BrowserEngine, fixture: &str) -> Vec<(String, String, String, String)> {
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/{fixture}");
    engine
        .detect_url(&url, &ScanOptions::default())
        .expect("scan")
        .iter()
        .map(|f| {
            (
                f.antipattern.clone(),
                f.extras.get("selector").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                f.snippet.clone(),
                f.severity.clone(),
            )
        })
        .collect()
}

#[test]
fn grounds_borrowed_from_scrims_sweeps_textures_underlines_and_ghost_words() {
    let Some(engine) = engine() else { return };
    let flagged = scan(&engine, "low-contrast-borrowed-grounds.html");
    let low = |selector: &str| {
        flagged
            .iter()
            .filter(|(r, s, ..)| r == "low-contrast" && s == selector)
            .map(|(_, _, snippet, severity)| (snippet.as_str(), severity.as_str()))
            .collect::<Vec<_>>()
    };
    for selector in [
        "#flag-light-title-on-bare-panel",
        "#flag-dark-label-on-sweep-in-place",
        "#flag-grey-on-stripes",
        "#flag-ink-on-drawn-underline",
        "#flag-faint-word-not-set-aside",
        "#flag-dark-word-not-set-aside",
        "#flag-word-shown-at-forty",
        "#flag-dark-label-on-centred-chip",
        "#flag-dark-label-on-turned-chip",
        "#flag-dark-label-on-skewed-chip",
        "#flag-dark-label-on-scaled-chip",
        "#flag-dark-copy-on-pinhole-mesh",
        "#flag-grey-copy-on-dense-halftone",
        "#flag-ghost-of-hidden-heading",
        "#flag-word-in-click-through-wrapper",
    ] {
        let hits = low(selector);
        assert!(!hits.is_empty(), "missing low-contrast on {selector} in {flagged:#?}");
        assert!(hits.iter().all(|(_, severity)| *severity != "advisory"), "{selector}: {hits:?}");
    }
    for selector in ["#advisory-faint-word-aria-hidden", "#advisory-dark-word-behind-slide"] {
        let hits = low(selector);
        assert!(!hits.is_empty(), "missing low-contrast on {selector} in {flagged:#?}");
        assert!(hits.iter().all(|(_, severity)| *severity == "advisory"), "{selector}: {hits:?}");
    }
    for selector in [
        "#pass-light-title-on-scrimmed-panel",
        "#pass-dark-label-over-parked-sweep",
        "#pass-dark-label-over-hidden-sweep",
        "#pass-grey-on-dotted-ground",
        "#pass-ink-over-parked-underline",
    ] {
        assert!(low(selector).is_empty(), "low-contrast on {selector} in {flagged:#?}");
    }
}
