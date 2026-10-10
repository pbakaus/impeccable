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
    let findings = engine
        .detect_url(&url, &ScanOptions::default())
        .expect("scan");
    Some(
        findings
            .iter()
            .map(|f| {
                let selector = f
                    .extras
                    .get("selector")
                    .and_then(|s| s.as_str())
                    .unwrap_or("")
                    .to_string();
                assert_eq!(f.advisory == Some(true), f.severity == "advisory", "{f:?}");
                (
                    f.antipattern.clone(),
                    f.snippet.clone(),
                    selector,
                    f.severity.clone(),
                )
            })
            .collect(),
    )
}

#[test]
fn hard_offset_shadow_matches_static_fixture_in_browser() {
    let Some(rows) = scan("hard-offset-shadow.html") else {
        return;
    };
    let hits: Vec<_> = rows
        .iter()
        .filter(|f| f.0 == "hard-offset-shadow")
        .collect();
    assert_eq!(hits.len(), 4, "{hits:#?}");
    for i in 0..4 {
        assert!(
            hits.iter()
                .any(|f| f.2.contains(&format!("#flag-{i}")) && f.3 == "advisory"),
            "{hits:#?}"
        );
    }
}
