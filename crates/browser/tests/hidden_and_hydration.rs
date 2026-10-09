//! Closed interface and recoverable hydration errors in the URL engine, over
//! `tests/fixtures/antipatterns/`, rendered by an installed browser. Skips
//! cleanly when there is none.
//!
//! - `content-hidden-at-rest.html` / `content-hidden-closed-interface.html`:
//!   text in closed nav flyouts, an inert mega-menu, an off-canvas drawer, a
//!   closed dialog, a hidden layer fixed over the whole viewport, unselected
//!   tab panels and collapsed accordion sections is
//!   left out of the hidden share; sections staged for a reveal that never ran
//!   still count (r5-p5-content-hidden-closed-navigation).
//! - `script-error-hydration.html`: React's recoverable hydration errors
//!   report as advisory; another React invariant and the site's own error
//!   stay errors (r5-p13-script-error-hydration).

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};

use impeccable_browser::BrowserEngine;
use impeccable_core::findings::Finding;
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

fn scan(engine: &BrowserEngine, port: u16, fixture: &str) -> Vec<Finding> {
    let url = format!("http://127.0.0.1:{port}/{fixture}");
    engine.detect_url(&url, &ScanOptions::default()).expect("scan")
}

fn of<'a>(findings: &'a [Finding], rule: &str) -> Vec<&'a Finding> {
    findings.iter().filter(|f| f.antipattern == rule).collect()
}

#[test]
fn closed_interface_is_left_out_of_the_hidden_share() {
    let Some(engine) = engine() else { return };
    let port = serve();

    // Only closed interface is invisible: no finding.
    let closed = scan(&engine, port, "content-hidden-closed-interface.html");
    let hidden = of(&closed, "content-hidden-at-rest");
    assert!(hidden.is_empty(), "{hidden:#?}");

    // The same closed interface beside three stalled reveals and a tab panel
    // its tab marks selected whose reveal failed: one finding, counting that
    // text alone and quoting it.
    let stalled = scan(&engine, port, "content-hidden-at-rest.html");
    let hidden: Vec<&str> = of(&stalled, "content-hidden-at-rest").iter().map(|f| f.snippet.as_str()).collect();
    assert_eq!(
        hidden,
        vec!["52% of page text (629 of 1216 chars) stays at opacity 0 / visibility hidden after reveal handlers ran (e.g. \"Hours of work, done in minutes\")"]
    );
}

#[test]
fn recoverable_hydration_errors_are_advisory_and_other_errors_fail() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let findings = scan(&engine, port, "script-error-hydration.html");
    let errors = of(&findings, "script-error");
    assert_eq!(errors.len(), 4, "{errors:#?}");
    let severity = |needle: &str| {
        let f = errors.iter().find(|f| f.snippet.contains(needle)).unwrap_or_else(|| panic!("no {needle}: {errors:#?}"));
        (f.severity.as_str(), f.advisory)
    };
    assert_eq!(severity("Minified React error #418: Hydration failed"), ("advisory", Some(true)));
    assert_eq!(severity("Minified React error #423: There was an error while hydrating."), ("advisory", Some(true)));
    assert_eq!(severity("Minified React error #185: Maximum update depth exceeded."), ("error", None));
    assert_eq!(severity("evo.article is not a function"), ("error", None));
}
