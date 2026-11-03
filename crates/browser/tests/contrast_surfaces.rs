//! Contrast surfaces the URL engine used to read wrong (corpus
//! observations-1006, branch 4), over
//! `tests/fixtures/antipatterns/contrast-surfaces.html`, rendered by an
//! installed browser. Skips cleanly when there is none.

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
fn contrast_surfaces_report_only_the_should_flag_twins() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/contrast-surfaces.html");
    let findings = engine.detect_url(&url, &ScanOptions::default()).expect("scan");
    let of = |rule: &str| -> Vec<String> {
        let mut v: Vec<String> = findings
            .iter()
            .filter(|f| f.antipattern == rule)
            .map(|f| f.extras.get("selector").and_then(|v| v.as_str()).unwrap_or("").to_string())
            .collect();
        v.sort();
        v
    };
    assert_eq!(
        of("low-contrast"),
        [
            "#flag-dim-heading-with-gradient-word",
            "#flag-heading-on-a-pale-tiled-section",
            "#flag-pale-gradient-tagline",
        ],
        "{findings:#?}"
    );
    assert_eq!(of("dark-glow"), ["#flag-cyan-glow-on-band", "#flag-maroon-shadow-on-band"], "{findings:#?}");
    let tagline = findings
        .iter()
        .find(|f| f.extras.get("selector").and_then(|v| v.as_str()) == Some("#flag-pale-gradient-tagline") && f.antipattern == "low-contrast")
        .expect("tagline");
    assert!(tagline.snippet.contains("gradient text, best stop #a78bfa on #f4f1ff"), "{}", tagline.snippet);
}
