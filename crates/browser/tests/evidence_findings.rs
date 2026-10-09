//! Findings whose evidence a corpus judge could not trust, over
//! `tests/fixtures/antipatterns/`, rendered by an installed browser. Skips
//! cleanly when there is none.
//!
//! - `visual-contrast.html`: the pixel pass reads glyph cores, so a readable
//!   date through an opacity stack passes, a faded one still fails, and no
//!   snippet prints a verdict above its own median.
//! - `script-error.html`: every script error reads `Uncaught <Type>: ...`, a
//!   thrown object names its properties, and every error names where it was
//!   thrown, `<anonymous>` for code with no script URL; a caught error reports
//!   nothing.
//! - `script-error-twins.html`: a throw reported both synchronously and as an
//!   unhandled rejection reports once, from the same origin and from another.
//! - `low-contrast-near-threshold.html`: a ratio just under its bar prints
//!   under the bar, never as the bar itself.
//! - `text-overflow.html`: an ellipsis, a line clamp and an inline run inside
//!   an ellipsizing row are truncations, not spills; a clipped line with no
//!   marker, and truncation classes on an inline span, still report, cut by
//!   the flag column's clip; a spill into the next stat, one off the side
//!   of the window and ones under a positioned image or filled box report;
//!   spills into free space or under a hairline do not.

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
    // `script-error-twins.html` loads this from `localhost` while it sits on
    // 127.0.0.1, so the script is from another origin and the browser hands
    // over only the text of what it throws. No CORS header, no fixture file.
    let (status, content_type, body) = if rel == "vendor/redefine-src.js" {
        ("200 OK", "text/javascript", VENDOR_TWIN_SCRIPT.as_bytes().to_vec())
    } else {
        match std::fs::read(fixtures_dir().join(&rel)) {
            Ok(body) if !rel.contains("..") => ("200 OK", "text/html; charset=utf-8", body),
            _ => ("404 Not Found", "text/html; charset=utf-8", b"missing".to_vec()),
        }
    };
    let head = format!(
        "HTTP/1.0 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(&body);
    let _ = stream.flush();
}

/// `(antipattern, snippet, selector)` for every finding on one fixture, or
/// `None` when no browser is installed.
fn scan(fixture: &str) -> Option<Vec<(String, String, String)>> {
    let env: HashMap<String, String> = std::env::vars().collect();
    if impeccable_browser::discovery::find_browser(&env).is_err() {
        eprintln!("skip: no installed browser found");
        return None;
    }
    let engine = BrowserEngine::new(env);
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/{fixture}");
    let findings = engine.detect_url(&url, &ScanOptions::default()).expect("scan");
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
                (f.antipattern.clone(), f.snippet.clone(), selector)
            })
            .collect(),
    )
}

/// `pixel contrast X:1 median Y:1 ...` into `(X, Y)`.
fn pixel_pair(snippet: &str) -> Option<(f64, f64)> {
    let rest = snippet.strip_prefix("pixel contrast ")?;
    let (verdict, rest) = rest.split_once(":1 median ")?;
    let (median, _) = rest.split_once(":1")?;
    Some((verdict.parse().ok()?, median.parse().ok()?))
}

#[test]
fn pixel_contrast_reads_glyph_cores() {
    let Some(findings) = scan("visual-contrast.html") else {
        return;
    };
    let low: Vec<&str> = findings
        .iter()
        .filter(|(id, _, _)| id == "low-contrast")
        .map(|(_, s, _)| s.as_str())
        .collect();
    for snippet in &low {
        if let Some((verdict, median)) = pixel_pair(snippet) {
            assert!(verdict <= median, "verdict above its median: {snippet}");
        }
    }
    // The element pass folds the stack's opacity into the ink
    // (`corpus/fix-gradient-surface`), so the faded date reports there at the
    // glyph-core ratio, 2.6:1, and the pixel pass has nothing left to add.
    // Either path counts; what must hold is that it flags and the readable
    // date does not.
    let low_with_selector: Vec<(&str, &str)> = findings
        .iter()
        .filter(|(id, _, _)| id == "low-contrast")
        .map(|(_, s, sel)| (s.as_str(), sel.as_str()))
        .collect();
    assert!(
        low_with_selector.iter().any(|(s, sel)| {
            s.contains("\"Faded date through a heavy opacity stack\"") || sel.contains("fade-heavy")
        }),
        "expected the faded date to flag, got {low_with_selector:?}"
    );
    assert!(
        !low_with_selector.iter().any(|(s, sel)| {
            s.contains("Readable date through a light opacity stack") || sel.contains("fade-light")
        }),
        "the readable date flagged: {low_with_selector:?}"
    );
}

/// What `script-error-twins.html` loads from another origin: one function
/// that throws synchronously and again inside a promise.
const VENDOR_TWIN_SCRIPT: &str = "function redefineSrc() { const el = {}; Object.defineProperty(el, 'src', { value: 1 }); Object.defineProperty(el, 'src', { value: 2 }); }\nPromise.resolve().then(redefineSrc);\nredefineSrc();\n";

fn script_errors(findings: &[(String, String, String)]) -> Vec<&str> {
    findings
        .iter()
        .filter(|(id, _, _)| id == "script-error")
        .map(|(_, s, _)| s.as_str())
        .collect()
}

#[test]
fn script_errors_name_the_thrown_value_and_where_it_was_thrown() {
    let Some(findings) = scan("script-error.html") else {
        return;
    };
    let errors = script_errors(&findings);
    assert!(
        errors.iter().any(|s| s.starts_with(
            "Uncaught Object {code: \"E_CONSENT\", message: \"consent config missing\"} (at loadConsentConfig, http://127.0.0.1:"
        ) && s.contains("/script-error.html:")),
        "expected the thrown object with its source, got {errors:?}"
    );
    assert!(
        errors.iter().any(|s| s.starts_with("Uncaught SyntaxError: ") && s.contains("/script-error.html:")),
        "expected the syntax error, typed, got {errors:?}"
    );
    // Code with no script URL names V8's `<anonymous>` script, and its type.
    assert!(
        errors.iter().any(|s| s.starts_with("Uncaught ReferenceError: missingAnalyticsQueue is not defined (at ")
            && s.contains("<anonymous>:")),
        "expected the anonymous script's error with its source, got {errors:?}"
    );
    for snippet in &errors {
        assert!(snippet.starts_with("Uncaught "), "script error without its marker: {snippet}");
        assert!(snippet.contains(" (at "), "script error without a source: {snippet}");
    }
    assert!(
        !errors.iter().any(|s| s.contains("handled quietly")),
        "a caught error reported: {errors:?}"
    );
}

#[test]
fn one_throw_reported_sync_and_in_promise_reports_once() {
    let Some(findings) = scan("script-error-twins.html") else {
        return;
    };
    let errors = script_errors(&findings);
    // The same-origin pair arrives with an exception object to read.
    let href: Vec<&&str> = errors.iter().filter(|s| s.contains("Cannot redefine property: href")).collect();
    assert_eq!(href.len(), 1, "expected one report of the same-origin pair, got {errors:?}");
    assert!(
        href[0].starts_with("Uncaught TypeError: Cannot redefine property: href (at redefineHref, http://127.0.0.1:"),
        "expected the first report's text and source, got {errors:?}"
    );
    // The cross-origin pair arrives as CDP's text alone, which used to report twice.
    let src: Vec<&&str> = errors.iter().filter(|s| s.contains("Cannot redefine property: src")).collect();
    assert_eq!(src.len(), 1, "expected one report of the cross-origin pair, got {errors:?}");
    assert!(
        src[0].starts_with("Uncaught TypeError: Cannot redefine property: src (at redefineSrc, http://localhost:"),
        "expected the first report's text and source, got {errors:?}"
    );
    // A different rejection still reports on its own, under the cap.
    assert!(
        errors.iter().any(|s| s.starts_with("Uncaught (in promise) RangeError: storage quota exceeded")),
        "expected the separate rejection, got {errors:?}"
    );
    assert!(
        !errors.iter().any(|s| s.contains("handled rejection")),
        "a handled rejection reported: {errors:?}"
    );
    assert_eq!(errors.len(), 3, "{errors:?}");
}

#[test]
fn a_production_react_invariant_reads_as_its_message() {
    let Some(findings) = scan("script-error-react.html") else {
        return;
    };
    let errors = script_errors(&findings);
    // A number the table knows: the message in place of the boilerplate, the
    // number kept, the source after it.
    assert!(
        errors.iter().any(|s| s.starts_with(
            "Uncaught Error: Minified React error #418: Hydration failed because the initial UI does not match what was rendered on the server. (at hydrateApp, http://127.0.0.1:"
        )),
        "expected the decoded invariant with its source, got {errors:?}"
    );
    // A number it does not know, and text that is not an invariant, as before.
    assert!(
        errors.iter().any(|s| s.starts_with(
            "Uncaught Error: Minified React error #9999; visit https://react.dev/errors/9999 for the full message"
        )),
        "expected the unknown invariant undecoded, got {errors:?}"
    );
    assert!(
        errors.iter().any(|s| s.starts_with("Uncaught Error: Order #418 failed to sync (at syncOrder, ")),
        "expected the plain error untouched, got {errors:?}"
    );
    assert_eq!(errors.len(), 3, "{errors:?}");
}

#[test]
fn contrast_just_under_the_bar_prints_under_the_bar() {
    let Some(findings) = scan("low-contrast-near-threshold.html") else {
        return;
    };
    let low: Vec<&str> = findings
        .iter()
        .filter(|(id, _, _)| id == "low-contrast")
        .map(|(_, s, _)| s.as_str())
        .collect();
    for expected in [
        "4.49:1 (need 4.5:1) — text #777777 on #070707",
        "2.99:1 (need 3:1) — text #595959 on #000000",
        "4.49:1 (need 4.5:1) — text #7b7b7b on #101010",
    ] {
        assert!(low.iter().any(|s| s.starts_with(expected)), "expected {expected}, got {low:?}");
    }
    for snippet in &low {
        for bar in ["4.50:1 (need 4.5:1)", "4.5:1 (need 4.5:1)", "3.00:1 (need 3:1)", "3.0:1 (need 3:1)"] {
            assert!(!snippet.contains(bar), "a failing ratio printed as the bar: {snippet}");
        }
        for readable in ["#767676", "#5a5a5a", "#787878"] {
            assert!(!snippet.contains(readable), "a readable pair flagged: {snippet}");
        }
    }
}

#[test]
fn text_overflow_skips_marked_truncation_and_keeps_real_spills() {
    let Some(findings) = scan("text-overflow.html") else {
        return;
    };
    let overflow: Vec<(&str, &str)> = findings
        .iter()
        .filter(|(id, _, _)| id == "text-overflow")
        .map(|(_, s, sel)| (s.as_str(), sel.as_str()))
        .collect();
    for flag in [
        "flag-nowrap",
        "flag-longword",
        "flag-inline-spill",
        "flag-hidden-no-marker",
        "flag-inline-truncate",
        // A page wrapper at `overflow-x: hidden` scrolls only on y.
        "flag-in-x-hidden-wrapper",
        // Generated content no text rect covers: the spill stands.
        "flag-pseudo-suffix",
        // A spill into the next stat, and one off the side of the window.
        "flag-stat-collides",
        "flag-viewport-edge",
        // A spill under a positioned image, and under a filled box.
        "flag-under-positioned-image",
        "flag-under-positioned-box",
        // An icon link whose label starts inside its y clip.
        "flag-icon-label-crosses-clip",
        // The same at `overflow: clip` with a clip margin the label paints in.
        "flag-icon-label-in-clip-margin",
    ] {
        assert!(
            overflow.iter().any(|(s, sel)| s.contains(flag) || sel.contains(flag)),
            "expected {flag} to flag, got {overflow:?}"
        );
    }
    let stray: Vec<&(&str, &str)> = overflow
        .iter()
        .filter(|(s, sel)| s.contains("pass-") || sel.contains("pass-") || sel.contains("ellipsis"))
        .collect();
    assert!(stray.is_empty(), "should-pass boxes flagged: {stray:?}");
    assert_eq!(overflow.len(), 13, "{overflow:?}");
}
