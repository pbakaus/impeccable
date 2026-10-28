//! Which opacity the URL engine blends into the ink for low-contrast,
//! against an installed browser. Skips cleanly when there is none.
//!
//! A box faded at rest fades the glyphs and the faded colour is scored. A
//! box caught mid-reveal (blurred, sliding in from under 0.1 opacity, or
//! faded by an animation or transition running at capture) is scored at
//! the text's declared colour. The running animations reach the core
//! through the snapshot's `anim` / `an` facts, which only a browser records.

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

#[test]
fn the_url_engine_blends_only_the_opacity_at_rest() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/transient-opacity-contrast.html");
    let findings = engine.detect_url(&url, &ScanOptions::default()).expect("scan");
    let snippets: Vec<String> = findings
        .iter()
        .filter(|f| f.antipattern == "low-contrast")
        .map(|f| f.snippet.clone())
        .collect();

    for (case, expected) in [
        ("header in an accordion item faded at rest", "text #85888a on #ffffff"),
        ("card held faded with will-change", "text #94989c on #ffffff"),
        ("label faded with an opacity transition at rest", "text #a4a4aa on #ffffff"),
        ("faint word caught mid-reveal, at its declared colour", "text #b0b1b2 on #ffffff"),
    ] {
        assert!(
            snippets.iter().any(|s| s.contains(expected)),
            "{case} should flag as `{expected}`, got {snippets:?}"
        );
    }
    // The pass column: each case's declared colour passes, and none of them
    // is reported at a blended colour either. A blended snippet prints a
    // colour of its own, so the pass cases are counted by what is left.
    assert_eq!(
        snippets.len(),
        4,
        "only the four faded-at-rest cases should report, got {snippets:?}"
    );
}

/// Text faded by a box a visitor's action changes. A stepper's inactive
/// item beside the active one at 1, with an opacity transition, is dim at
/// rest and reports as advisory (r13-t1), as does a checkout stepper's next
/// step; links all faded alike, a tab with no transition, an inactive tab
/// button, a clickable option, a faint modifier, identical class lists, a
/// lone parked badge, parked nav links, an inline design token and a number
/// written inline keep their severity; a box a
/// script parked in its `style` attribute at the start of a reveal is not
/// at rest and passes at its declared colour.
#[test]
fn the_url_engine_demotes_a_state_and_skips_a_parked_reveal() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/low-contrast-resting-states.html");
    let findings = engine.detect_url(&url, &ScanOptions::default()).expect("scan");
    let contrast: Vec<(String, bool)> = findings
        .iter()
        .filter(|f| f.antipattern == "low-contrast")
        .map(|f| (f.snippet.clone(), f.advisory == Some(true)))
        .collect();

    for (case, expected, advisory) in [
        ("inactive stepper item beside the active one", "text #b3b4b6 on #ffffff", true),
        ("footer links all faded alike", "text #9a9c9e on #ffffff", false),
        ("inactive tab with no transition", "text #b3b5b6 on #ffffff", false),
        ("inactive tab button beside the selected one", "text #9fa2a4 on #ffffff", false),
        ("a number written inline", "text #d2d4d5 on #ffffff", false),
        ("a lone badge parked inline", "text #b4b5b5 on #ffffff", false),
        ("nav links parked inline alike", "text #aaabab on #ffffff", false),
        ("a design token written inline", "text #ababab on #ffffff", false),
        ("a faint modifier on the dimmed box", "text #ababac on #ffffff", false),
        ("a clickable plan option", "text #abacac on #ffffff", false),
        ("identical classes, one dimmed inline", "text #acacad on #ffffff", false),
        ("a checkout stepper's next step", "text #adadad on #ffffff", true),
        ("a stepper item whose active sibling is not shown", "text #c5c5c5 on #ffffff", false),
        ("disclosure summaries beside the open one", "text #b0b1b1 on #ffffff", false),
        ("unchecked menu checkbox items", "text #b1b1b1 on #ffffff", false),
        ("keys parked alike, the lit peer not shown", "text #dbdcdc on #ffffff", false),
    ] {
        assert!(
            contrast.iter().any(|(s, a)| s.contains(expected) && *a == advisory),
            "{case} should flag as `{expected}` (advisory {advisory}), got {contrast:?}"
        );
    }
    assert_eq!(
        contrast.len(),
        16,
        "the three parked reveals should not report, got {contrast:?}"
    );
}
