//! Corpus round 11's deferred edge cases (#1076), over three fixtures in
//! `tests/fixtures/antipatterns/`, rendered by an installed browser. Skips
//! cleanly when there is none.

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

fn scan(engine: &BrowserEngine, port: u16, fixture: &str) -> Vec<impeccable_core::findings::Finding> {
    let url = format!("http://127.0.0.1:{port}/{fixture}");
    engine.detect_url(&url, &ScanOptions::default()).expect("scan")
}

fn selector(f: &impeccable_core::findings::Finding) -> &str {
    f.extras.get("selector").and_then(|v| v.as_str()).unwrap_or("")
}

/// A glow or halo inside an `@media` block no 1280px viewport matches, on
/// an element the page shows, hides nothing: the cyan candidates report.
#[test]
fn pattern_candidates_in_inactive_at_rules_are_passed_over() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let findings = scan(&engine, port, "pattern-walk-inactive-at-rules.html");
    let rows: Vec<(&str, &str, &str)> =
        findings.iter().map(|f| (f.antipattern.as_str(), selector(f), f.snippet.as_str())).collect();
    eprintln!("{rows:#?}");
    for rule in ["dark-glow", "radial-halo", "codex-grid-background"] {
        assert!(rows.iter().any(|(r, ..)| *r == rule), "{rule} reports: {rows:#?}");
    }
    assert!(!rows.iter().any(|(_, s, d)| s.contains("pass-") || d.contains("#ff00ff")), "{rows:#?}");
}

/// Code in a full-width page shell at `overflow: auto` that runs past the
/// screen edge is cut there; the same line in a 560px scroller is not.
#[test]
fn code_in_a_scrolling_page_shell_is_read() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let findings = scan(&engine, port, "text-overflow-code-page-shell.html");
    let rows: Vec<&str> = findings.iter().filter(|f| f.antipattern == "text-overflow").map(selector).collect();
    eprintln!("{rows:#?}");
    assert!(rows.iter().any(|s| s.contains("flag-code-in-a-scrolling-shell")), "{rows:#?}");
    assert!(!rows.iter().any(|s| s.contains("pass-")), "{rows:#?}");
}

/// The page's own part of the title, set huge and faint, is a heading to
/// read; the site's `og:site_name` set the same way is a wordmark.
#[test]
fn only_the_part_that_names_the_site_is_a_wordmark() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let findings = scan(&engine, port, "low-contrast-title-wordmark.html");
    let low: Vec<(&str, &str)> = findings
        .iter()
        .filter(|f| f.antipattern == "low-contrast")
        .map(|f| (selector(f), f.severity.as_str()))
        .collect();
    eprintln!("{low:#?}");
    let severity = |id: &str| low.iter().find(|(s, _)| s.contains(id)).map(|(_, sev)| *sev);
    assert_eq!(severity("flag-faint-page-name"), Some("warning"), "{low:#?}");
    assert_eq!(severity("advisory-faint-site-name"), Some("advisory"), "{low:#?}");
}

/// A label set at 1px under `scale: 16` draws 16px letters, so laid over a
/// caption it collides with it; the same label unscaled draws a dot.
#[test]
fn scaled_1px_text_is_read_at_its_drawn_size() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let findings = scan(&engine, port, "text-occlusion-scaled-1px.html");
    let rows: Vec<(&str, &str)> = findings
        .iter()
        .filter(|f| f.antipattern == "text-occlusion")
        .map(|f| (selector(f), f.snippet.as_str()))
        .collect();
    eprintln!("{rows:#?}");
    assert!(rows.iter().any(|(s, d)| s.contains("flag-") || d.contains("flag-")), "{rows:#?}");
    assert!(!rows.iter().any(|(s, d)| s.contains("pass-") || d.contains("pass-")), "{rows:#?}");
}
