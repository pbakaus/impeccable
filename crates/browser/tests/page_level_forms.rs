//! The stylesheet-text forms of gradient-text, bounce-easing, dark-glow,
//! radial-halo and marquee in the URL engine, against an
//! installed browser. Skips cleanly when there is none.
//!
//! One declaration reports once. The element forms read computed styles off
//! every element, so a page form on body stands only where no element form
//! speaks for the declaration; "dark page" is read off the painted root; a
//! glow has to lift the surface it lands on; a property token has to be a
//! name of its own; a marquee strip and the clone that loops with it are one
//! report.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};

use impeccable_browser::BrowserEngine;
use impeccable_detect::engines::{ScanOptions, UrlEngine};

const RULES: &[&str] = &[
    "gradient-text",
    "bounce-easing",
    "dark-glow",
    "radial-halo",
    "marquee",
];

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

/// `(rule, snippet)` for every finding of the five rules, sorted.
fn scan(engine: &BrowserEngine, port: u16, fixture: &str) -> Vec<(String, String)> {
    let url = format!("http://127.0.0.1:{port}/{fixture}");
    let findings = engine.detect_url(&url, &ScanOptions::default()).expect("scan");
    let mut out: Vec<(String, String)> = findings
        .iter()
        .filter(|f| RULES.contains(&f.antipattern.as_str()))
        .map(|f| (f.antipattern.clone(), f.snippet.clone()))
        .collect();
    out.sort();
    out
}

fn pairs(expected: &[(&str, &str)]) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = expected
        .iter()
        .map(|(r, s)| (r.to_string(), s.to_string()))
        .collect();
    out.sort();
    out
}

#[test]
fn each_declaration_reports_once_where_it_paints() {
    let Some(engine) = engine() else { return };
    let port = serve();

    // Light root. The base engine (5ce750e5) reports twelve findings here:
    // gradient text four times (the class and stylesheet forms on the
    // heading and on body), the easing twice, the avatar glow, a body glow
    // from the `--bprogress-box-shadow` token (#2299dd), the halo "on dark
    // page", and only the ticker's clone, because the original's travel sits
    // inside `calc()`.
    assert_eq!(
        scan(&engine, port, "page-level-forms.html"),
        pairs(&[
            ("gradient-text", "background-clip: text + gradient"),
            ("bounce-easing", "cubic-bezier(0.34, 1.56, 0.64, 1)"),
            ("dark-glow", "Zero-offset box-shadow glow (#f59e0b)"),
            (
                "marquee",
                ".ticker-track--original — infinite horizontal loop animation \"ticker-move\""
            ),
        ])
    );

    // Dark root: the pseudo-element glow and the halo stand on body, and the
    // tokens paint nothing. The base engine reports the two tokens instead
    // (#ec4899 and #fdba74).
    assert_eq!(
        scan(&engine, port, "page-level-forms-dark.html"),
        pairs(&[
            ("dark-glow", "Zero-offset box-shadow glow (#22c55e)"),
            ("radial-halo", "radial-gradient halo (#8fd8f2 → transparent) on dark page"),
        ])
    );

    // The white canvas (observations-1010 row 4): html and body paint
    // nothing, so a dark player box is not a dark page, and the glow in a
    // template no element computes does not report. The base engine
    // reports it "on dark page". A script's string is not markup.
    assert_eq!(scan(&engine, port, "page-level-forms-white-canvas.html"), pairs(&[]));
    // The twins: the same page whose ground something else paints dark.
    for twin in [
        "page-level-forms-dark-root.html",
        "page-level-forms-dark-contents.html",
        "page-level-forms-dark-pseudo.html",
        "page-level-forms-dark-meta.html",
    ] {
        assert_eq!(
            scan(&engine, port, twin),
            pairs(&[("dark-glow", "Colored box-shadow glow (#667eea) on dark page")]),
            "{twin}"
        );
    }
}
