//! `line-length` counts the characters that reached the rendered lines, on
//! `line-length-text-count.html`, against an installed browser. Skips cleanly
//! when there is none.
//!
//! The rule divides an element's characters among its line rects. Counted
//! from `textContent`, a paragraph with an inline `<style>` child, deep
//! source indentation or a script written with combining marks was charged
//! with characters that are on no line, and a comfortable measure read as a
//! long column.

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

#[test]
fn line_length_counts_the_characters_on_the_lines() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let mut found: Vec<String> = findings(&engine, port, "line-length-text-count.html", "line-length")
        .into_iter()
        .map(|(snippet, _)| snippet)
        .collect();
    found.sort();
    // The two wide columns with a style child and with source indentation
    // read the same 141 characters a plain wide column does, and the
    // `pre-wrap` column, whose runs of spaces are on the line, reads 146.
    // The four comfortable measures (a style child, a hidden child and a
    // script, deep indentation, Devanagari) are absent: counted from
    // `textContent` they read 221, 222, 147 and 109, and the two wide
    // columns 156 and 164.
    assert_eq!(
        found,
        vec![
            "~141 chars on 3 of 3 rendered lines (aim for <80)".to_string(),
            "~141 chars on 3 of 3 rendered lines (aim for <80)".to_string(),
            "~146 chars on 2 of 3 rendered lines (aim for <80)".to_string(),
        ]
    );
}
