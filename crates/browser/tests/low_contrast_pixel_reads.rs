//! The pixel pass over `tests/fixtures/antipatterns/low-contrast-pixel-reads.html`,
//! rendered by an installed browser. Skips cleanly when there is none.
//!
//! Two shapes it used to refuse are read: copy under a soft dark
//! `text-shadow` halo (the hide style kept the halo out of the second shot,
//! so most of the clip repainted and no verdict came back), and a link on a
//! glass panel whose own fill is at least 0.8 opaque under a backdrop
//! filter. Where the pixels fail them the finding is theirs; where they pass
//! (the same halo copy over a dark photo) the element pass's verdict is
//! replaced and nothing reports.

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
fn the_pixels_read_halos_and_near_opaque_glass() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/low-contrast-pixel-reads.html");
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
    let pixel = |id: &str| low.iter().any(|(s, sev, snip)| s.contains(id) && *sev != "advisory" && snip.starts_with("pixel contrast"));
    assert!(pixel("flag-halo-copy-on-pale-photo"), "{low:#?}");
    // Over a photo half pale and half dark only the pixels can say; they
    // read about 4.1:1, and before they refused the box nothing reported.
    assert!(pixel("flag-link-on-near-opaque-glass"), "{low:#?}");
    assert!(!low.iter().any(|(s, ..)| s.contains("pass-")), "{low:#?}");
}
