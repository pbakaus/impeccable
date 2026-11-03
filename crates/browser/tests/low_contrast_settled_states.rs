//! `low-contrast` at the state a visitor meets, over
//! `tests/fixtures/antipatterns/low-contrast-settled-states.html`, rendered
//! by an installed browser. Skips cleanly when there is none.

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
fn contrast_is_read_at_the_state_a_visitor_meets() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/low-contrast-settled-states.html");
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
    eprintln!("{low:#?}");
    let severity = |id: &str| low.iter().find(|(s, ..)| s.contains(id)).map(|(_, sev, _)| *sev);
    assert_eq!(severity("flag-cta-waiting-out-its-entrance"), Some("warning"), "{low:#?}");
    assert_eq!(severity("flag-white-link-on-white-card"), Some("warning"), "{low:#?}");
    assert!(severity("flag-row-in-a-paused-breath").is_some(), "{low:#?}");
    assert_eq!(severity("flag-footer-slogan"), Some("warning"), "{low:#?}");
    assert_eq!(severity("advisory-footer-wordmark"), Some("advisory"), "{low:#?}");
    assert!(!low.iter().any(|(s, ..)| s.contains("pass-")), "{low:#?}");
}
