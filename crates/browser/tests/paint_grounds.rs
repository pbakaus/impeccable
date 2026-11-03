//! How the URL engine reads the grounds of
//! `tests/fixtures/antipatterns/low-contrast-paint-grounds.html`, against an
//! installed browser (observations-craft-1009 rows 4 to 7). Skips cleanly
//! when there is none.
//!
//! - Two sheared pseudo halves paint one ground under text across their
//!   seam: white fails on the orange one, passes on the slate one.
//! - A hover face parked at `opacity: 0` is not the ground; shown, it is.
//! - Text clipped on every layer takes no verdict on its `color`, nor does
//!   a transparent-fill word in a clipped heading; pale stops on white fail.
//! - A run under a blended copy of itself is the pixels' to judge, and an
//!   opaque copy over another run is scored as itself.

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
fn grounds_painted_by_halves_faces_clips_and_echoes() {
    let Some(engine) = engine() else { return };
    let flagged = scan(&engine, "low-contrast-paint-grounds.html");
    let low = |selector: &str| {
        flagged
            .iter()
            .filter(|(r, s, ..)| r == "low-contrast" && s == selector)
            .map(|(_, _, snippet, severity)| (snippet.as_str(), severity.as_str()))
            .collect::<Vec<_>>()
    };
    // White across the orange seam is scored on the gradient the halves
    // paint, not on the white page under the section.
    let seam = low("#flag-white-across-orange-seam");
    assert_eq!(seam.len(), 1, "{flagged:#?}");
    assert!(seam[0].0.contains("text #ffffff on #f"), "{seam:?}");
    assert!(seam[0].0.contains("(layer on "), "{seam:?}");
    assert_ne!(seam[0].1, "advisory");
    // The shown face is the ground; the label fails on it.
    let face = low("#flag-label-on-shown-face");
    assert_eq!(face.len(), 1, "{flagged:#?}");
    assert!(face[0].0.contains("on #c8c8c8"), "{face:?}");
    // Pale stops clipped to the text on white fail by the best of them.
    assert_eq!(low("#flag-pale-stops-clipped-on-white").len(), 1, "{flagged:#?}");
    // The opaque copy over another run is scored as itself.
    let front = low("#flag-pale-green-opaque-copy");
    assert_eq!(front.len(), 1, "{flagged:#?}");
    assert!(front[0].0.contains("text #a9d46b on #ffffff"), "{front:?}");
    // A tint, a parked hover fill and a band skewed about its corner leave
    // the copy's failure standing (from the element pass or the pixels).
    for selector in [
        "#flag-grey-under-15-tint",
        "#flag-grey-under-12-tint",
        "#flag-grey-over-parked-fill",
        "#flag-pale-below-skewed-edge",
        "#flag-pale-on-top-white-face",
    ] {
        assert!(!low(selector).is_empty(), "missing low-contrast on {selector} in {flagged:#?}");
    }
    for selector in [
        "#pass-pale-on-skewed-band",
        "#pass-pale-on-top-dark-face",
        "#pass-white-across-slate-seam",
        "#pass-label-over-parked-face",
        "#pass-stat-clipped-on-two-layers",
        "#pass-word-in-clipped-title",
    ] {
        assert!(low(selector).is_empty(), "low-contrast on {selector} in {flagged:#?}");
    }
    // The green under a blended copy of itself is handed to the pixels: the
    // element pass's verdict on the green alone never stands as a counted
    // finding (the pixels replace it, or it stands as advisory).
    for (snippet, severity) in low("#handed-green-under-blended-copy") {
        assert!(
            !snippet.contains("text #81b81a on #ffffff") || severity == "advisory",
            "{snippet} ({severity})"
        );
    }
}
