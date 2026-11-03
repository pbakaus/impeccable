//! observations-1006 branch 3 over its fixtures, rendered by an installed
//! browser. Skips cleanly when there is none.
//!
//! - `ai-color-palette-code-tokens.html`: highlighted code tokens supply no
//!   tell hue; the neon lines in the should-flag column still report.
//! - `kicker-above-heading-beside.html`: a label in a column beside its
//!   heading, and a caption below it in the next column, are not kickers.
//! - `nested-cards-composer.html`: a composer around a textarea is a field.
//! - `undersized-ui-text-class-parts.html`: furniture classes are read by
//!   part, so `px-stage-compact` and `instagram-feed` are not furniture.

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

fn scan(page: &str) -> Option<Vec<impeccable_core::findings::Finding>> {
    let env: HashMap<String, String> = std::env::vars().collect();
    if impeccable_browser::discovery::find_browser(&env).is_err() {
        eprintln!("skip: no installed browser found");
        return None;
    }
    let engine = BrowserEngine::new(env);
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/{page}");
    Some(engine.detect_url(&url, &ScanOptions::default()).expect("scan"))
}

fn selector(f: &impeccable_core::findings::Finding) -> String {
    f.extras.get("selector").and_then(|s| s.as_str()).unwrap_or("").to_string()
}

#[test]
fn code_tokens_supply_no_tell_hue() {
    let Some(findings) = scan("ai-color-palette-code-tokens.html") else { return };
    let palette: Vec<String> = findings
        .iter()
        .filter(|f| f.antipattern == "ai-color-palette")
        .map(selector)
        .collect();
    assert!(palette.iter().any(|s| s.contains("flag-mono")), "{palette:?}");
    assert!(palette.iter().any(|s| s.contains("flag-cyan")), "{palette:?}");
    assert!(palette.iter().any(|s| s.contains("flag-pre") && !s.contains("flag-preline")), "{palette:?}");
    assert!(palette.iter().any(|s| s.contains("flag-preline")), "{palette:?}");
    assert!(!palette.iter().any(|s| s.contains("pass-code")), "{palette:?}");
}

#[test]
fn a_label_beside_its_heading_is_not_a_kicker() {
    let Some(findings) = scan("kicker-above-heading-beside.html") else { return };
    let kickers: Vec<&str> = findings
        .iter()
        .filter(|f| f.antipattern == "kicker-above-heading")
        .map(|f| f.snippet.as_str())
        .collect();
    assert_eq!(kickers.len(), 1, "{kickers:?}");
    assert!(kickers[0].contains("\"Runs\""), "{kickers:?}");
}

#[test]
fn a_composer_is_a_field_not_a_card() {
    let Some(findings) = scan("nested-cards-composer.html") else { return };
    let cards: Vec<String> = findings
        .iter()
        .filter(|f| f.antipattern == "nested-cards")
        .map(selector)
        .collect();
    for flagged in ["flag-composer", "flag-plan", "flag-tile"] {
        assert!(cards.iter().any(|s| s.contains(flagged)), "{flagged}: {cards:?}");
    }
    assert!(!cards.iter().any(|s| s.contains("pass-composer")), "{cards:?}");
}

#[test]
fn furniture_classes_are_read_by_part() {
    let Some(findings) = scan("undersized-ui-text-class-parts.html") else { return };
    let undersized: Vec<&str> = findings
        .iter()
        .filter(|f| f.antipattern == "undersized-ui-text")
        .map(|f| f.snippet.as_str())
        .collect();
    for flagged in ["Design systems", "The tunnel for", "Privacy policy"] {
        assert!(undersized.iter().any(|s| s.contains(flagged)), "{flagged}: {undersized:?}");
    }
    for passed in ["nodejs-typescript", "Photos from our"] {
        assert!(!undersized.iter().any(|s| s.contains(passed)), "{passed}: {undersized:?}");
    }
}
