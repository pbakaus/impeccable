//! Round 13's small defects, over `tests/fixtures/antipatterns/`, rendered by
//! an installed browser. Skips cleanly when there is none. Text that has to
//! break the same way on every host is set in `ch` of a monospace face.
//!
//! - `tight-leading-lead-and-caps.html`: short lead text at 20px or more and
//!   labels in capitals keep their leading (r13-t3); four lines of lead text,
//!   lead text set solid, 19px copy, lower-case labels, a paragraph in
//!   capitals and capitals set under solid do not.
//! - `gradient-text-states.html`: a running shimmer is not gradient text, a
//!   one-colour sheen is advisory (r13-t6), a two-colour ramp, a paused
//!   shimmer and a sweeping rainbow with transparent glyphs report.
//! - `line-length-nested-list.html`: a list item heading a nested list is
//!   not charged with the list's lines.
//! - `buried-raster-tracking-pixel.html`: a 0x0 beacon is not a buried
//!   image; a faint photo is.
//! - `straggler-clamped.html`: lines a clamp hides leave the last line
//!   unjudged; a caption in an overflow box's padding is still judged.
//! - `cramped-padding-dividers.html`: text under a lone divider is measured
//!   to its glyphs; a scroller cuts the line that meets its bottom edge.
//! - `low-contrast-covered-and-masked.html`: a caption under a higher panel
//!   below the fold, and a label in a mask's faded band, are not painted.

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

fn scan(fixture: &str) -> Option<Vec<Finding>> {
    let env: HashMap<String, String> = std::env::vars().collect();
    if impeccable_browser::discovery::find_browser(&env).is_err() {
        eprintln!("skip: no installed browser found");
        return None;
    }
    let engine = BrowserEngine::new(env);
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/{fixture}");
    Some(engine.detect_url(&url, &ScanOptions::default()).expect("scan"))
}

fn selector(f: &Finding) -> &str {
    f.extras.get("selector").and_then(|s| s.as_str()).unwrap_or("")
}

/// The findings of `rule` whose selector names `id`.
fn on<'a>(findings: &'a [Finding], rule: &str, id: &str) -> Vec<&'a Finding> {
    findings
        .iter()
        .filter(|f| f.antipattern == rule && selector(f).contains(id))
        .collect()
}

/// Every element whose id starts `flag-` reports `rule` and every `pass-`
/// one does not.
fn columns(findings: &[Finding], rule: &str, flag: &[&str], pass: &[&str]) {
    for id in flag {
        assert!(!on(findings, rule, id).is_empty(), "{rule}: expected #{id} to flag, got {findings:#?}");
    }
    for id in pass {
        assert!(on(findings, rule, id).is_empty(), "{rule}: #{id} should pass: {:#?}", on(findings, rule, id));
    }
}

#[test]
fn lead_text_and_capitals_keep_their_leading() {
    let Some(f) = scan("tight-leading-lead-and-caps.html") else { return };
    columns(
        &f,
        "tight-leading",
        &[
            "flag-long-lead",
            "flag-solid-lead",
            "flag-body-19",
            "flag-lower-label",
            "flag-caps-paragraph",
            "flag-caps-overlap",
        ],
        &["pass-short-lead", "pass-caps-label"],
    );
}

#[test]
fn a_shimmer_is_not_gradient_text_and_a_sheen_is_advisory() {
    let Some(f) = scan("gradient-text-states.html") else { return };
    columns(
        &f,
        "gradient-text",
        &["flag-ramp", "flag-rainbow-fallback", "flag-paused-shimmer", "flag-sheen-advisory"],
        &["pass-shimmer"],
    );
    assert_eq!(on(&f, "gradient-text", "flag-rainbow-fallback")[0].severity, "warning");
    assert_eq!(on(&f, "gradient-text", "flag-ramp")[0].severity, "warning");
    assert_eq!(on(&f, "gradient-text", "flag-sheen-advisory")[0].severity, "advisory");
}

#[test]
fn a_list_item_is_not_charged_with_its_nested_list() {
    let Some(f) = scan("line-length-nested-list.html") else { return };
    columns(&f, "line-length", &["flag-long-item"], &["pass-heading-item"]);
}

#[test]
fn a_tracking_pixel_is_not_a_buried_raster() {
    let Some(f) = scan("buried-raster-tracking-pixel.html") else { return };
    columns(&f, "buried-raster", &["flag-faint-photo"], &["pass-beacon"]);
}

#[test]
fn lines_a_clamp_hides_leave_the_last_line_unjudged() {
    let Some(f) = scan("straggler-clamped.html") else { return };
    columns(
        &f,
        "straggler",
        &["flag-unclamped", "flag-marker-last", "flag-in-ratio-padding"],
        &["pass-clamped"],
    );
}

#[test]
fn dividers_and_scroll_edges_are_not_cramped() {
    let Some(f) = scan("cramped-padding-dividers.html") else { return };
    columns(
        &f,
        "cramped-padding",
        &["flag-framed-item", "flag-feed-ends"],
        &["pass-divided-item", "pass-feed-runs-on"],
    );
}

#[test]
fn text_under_a_higher_panel_or_a_mask_fade_is_not_scored() {
    let Some(f) = scan("low-contrast-covered-and-masked.html") else { return };
    columns(
        &f,
        "low-contrast",
        &["flag-active-caption", "flag-clear-label"],
        &["pass-hidden-caption", "pass-faded-label"],
    );
}
