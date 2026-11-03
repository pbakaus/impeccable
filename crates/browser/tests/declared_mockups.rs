//! Round 13, decision 1, on the URL engine over `declared-mockups.html`,
//! rendered by an installed browser. Skips cleanly when there is none.
//!
//! A product mockup the page declares is not content (`inert` or
//! `aria-hidden="true"` on a frame-sized box drawing an interface) reports
//! no `low-contrast`, `nested-cards`, `tiny-text` or `undersized-ui-text`,
//! and its headings leave the outline.
//! A live demo with nothing hidden, an aria-hidden copy beside its shown
//! original, a hidden badge too small for a frame, a hidden box with two
//! runs of text, an inert dialog, split-text lines under a labelled host, a
//! resting carousel slide beside a current one with a state class, a band
//! beside a screen-reader copy of its words, a hidden list of links and an
//! inert form step keep their findings, and so does a hidden box whose
//! third run of text does not render. The pixel pass takes no candidate
//! inside a declared mockup. A box labelled as a screenshot reports as
//! advisory from both passes (taste call r13-t5), and never hides the
//! page's own text in the same colours.

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

/// `(rule, snippet, selector, severity)` for every finding on one fixture,
/// or `None` when no browser is installed.
fn scan(fixture: &str) -> Option<Vec<(String, String, String, String)>> {
    let env: HashMap<String, String> = std::env::vars().collect();
    if impeccable_browser::discovery::find_browser(&env).is_err() {
        eprintln!("skip: no installed browser found");
        return None;
    }
    let engine = BrowserEngine::new(env);
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/{fixture}");
    let findings = engine.detect_url(&url, &ScanOptions::default()).expect("scan");
    Some(
        findings
            .iter()
            .map(|f| {
                let selector =
                    f.extras.get("selector").and_then(|s| s.as_str()).unwrap_or("").to_string();
                assert_eq!(f.advisory == Some(true), f.severity == "advisory", "{f:?}");
                (f.antipattern.clone(), f.snippet.clone(), selector, f.severity.clone())
            })
            .collect(),
    )
}

type Row = (String, String, String, String);

/// The severities of every `rule` finding whose selector names `class`.
fn on<'a>(findings: &'a [Row], rule: &str, class: &str) -> Vec<&'a str> {
    findings
        .iter()
        .filter(|f| f.0 == rule && f.2.contains(class))
        .map(|f| f.3.as_str())
        .collect()
}

#[test]
fn declared_mockups_report_nothing() {
    let Some(f) = scan("declared-mockups.html") else { return };
    for id in ["#pass-hidden", "#pass-inert"] {
        for rule in ["low-contrast", "nested-cards"] {
            assert!(on(&f, rule, id).is_empty(), "{rule} {id}: {f:#?}");
        }
    }
    for rule in ["tiny-text", "undersized-ui-text"] {
        assert!(on(&f, rule, "#pass-inert").is_empty(), "{rule}: {f:#?}");
        assert!(!on(&f, rule, "#fail-live").is_empty(), "{rule} in the live demo: {f:#?}");
    }
    // The pixel pass takes no candidate in a declared mockup, inert or
    // aria-hidden: pale labels over a raster ground report nothing.
    for id in ["#pass-pixel-inert", "#pass-pixel-hidden"] {
        assert!(on(&f, "low-contrast", id).is_empty(), "{id}: {f:#?}");
    }
    let skips: Vec<&Row> = f.iter().filter(|r| r.0 == "skipped-heading").collect();
    assert!(
        skips.iter().all(|r| !r.1.contains("Hidden window heading")),
        "a heading in a declared mockup leaves the outline: {skips:#?}"
    );
    assert!(
        skips.iter().any(|r| r.1.contains("Live demo heading")),
        "a heading in a live demo stays in it: {skips:#?}"
    );
}

#[test]
fn guarded_hidden_boxes_keep_their_findings() {
    let Some(f) = scan("declared-mockups.html") else { return };
    // (nested-cards never reads a dialog's first card as nested, hidden or
    // not, so the dialog row is held to low-contrast alone.)
    for id in ["#fail-live-inner", "#fail-copy-inner", "#fail-two-runs-inner", "#fail-unrendered-runs-inner"] {
        assert_eq!(on(&f, "nested-cards", id), ["warning"], "nested-cards {id}: {f:#?}");
    }
    for id in [
        "#fail-live",
        "#fail-copy",
        "#fail-badge",
        "#fail-two-runs",
        // Two drawn runs and three under `display: none` are two runs.
        "#fail-unrendered-runs",
        "#fail-dialog",
        // The page's own text after a labelled screenshot in its colours.
        "#fail-after-shot",
        // Pale labels over a raster ground, read from the pixels.
        "#fail-pixel-live",
        "#fail-carousel-rest",
        "#fail-rail",
        // The split lines, the stats band and the form step print no id of
        // their own; their selectors name these parts.
        "div.line",
        "div.stat",
        "label:nth-of-type",
    ] {
        let sev = on(&f, "low-contrast", id);
        assert!(!sev.is_empty() && sev.iter().all(|s| *s == "warning"), "low-contrast {id}: {f:#?}");
    }
}

#[test]
fn a_labelled_screenshot_is_advisory() {
    let Some(f) = scan("declared-mockups.html") else { return };
    assert_eq!(on(&f, "nested-cards", "#adv-screenshot-inner"), ["advisory"], "{f:#?}");
    // From the element pass and from the pixels alike.
    for id in ["#adv-screenshot", "#adv-pixel-shot"] {
        let sev = on(&f, "low-contrast", id);
        assert!(!sev.is_empty() && sev.iter().all(|s| *s == "advisory"), "{id}: {f:#?}");
    }
}
