//! The validity gate, evidence scans, and replay, against an installed
//! browser. Skips cleanly when there is none.
//!
//! - A bot challenge or an HTTP error page is refused with an error by the
//!   CLI path and recorded (no findings, a screenshot) by the evidence path.
//! - An evidence scan reports the same findings as the CLI path, each named
//!   by its element.
//! - Replaying the recorded captures with no browser reproduces the
//!   deterministic passes' findings exactly, with no unanswered hit tests.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};

use impeccable_browser::{
    detect_url_evidence, origin, replay_url_scan, BrowserEngine, EvidenceRequest,
};
use impeccable_detect::engines::{ScanOptions, UrlEngine};

const CHALLENGE: &str = "<!doctype html><html><head><title>Human Verification</title></head><body><div id=\"captcha-container\">Please verify you are human.</div></body></html>";
const NOT_FOUND: &str = "<!doctype html><html><head><title>Not found</title></head><body><h1>Nothing here</h1></body></html>";

/// Fixtures that exercise the scan pass, hit tests (text-occlusion), and the
/// post-reveal content-hidden measure.
const REPLAY_FIXTURES: &[&str] = &[
    "should-flag.html",
    "text-occlusion.html",
    "reveal-working.html",
    "scroll-reveal.html",
    "typography-should-flag.html",
    "quality.html",
    "layout.html",
    // Hit tests over covered and layered text, and a page that moves between
    // the capture and the answers.
    "covered-text-contrast.html",
    // Closed disclosures, hidden panels and paused blinks, which the capture
    // records through checkVisibility and computed style.
    "painted-gate-coverage.html",
    // Copies part way past a carousel clip and the page edge, measured on
    // their text rects.
    "on-screen.html",
    "unread-surface-contrast.html",
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

fn respond(stream: &mut TcpStream, status: &str, extra_headers: &str, content_type: &str, body: &[u8]) {
    let head = format!(
        "HTTP/1.0 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\n{extra_headers}Connection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
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
    match path.as_str() {
        "/blocked" => respond(
            &mut stream,
            "405 Method Not Allowed",
            "x-amzn-waf-action: captcha\r\n",
            "text/html; charset=utf-8",
            CHALLENGE.as_bytes(),
        ),
        "/missing" => respond(&mut stream, "404 Not Found", "", "text/html; charset=utf-8", NOT_FOUND.as_bytes()),
        _ => {
            let rel = path.trim_start_matches('/');
            // `/evidence/<file>`: fixtures outside the rule fixtures, which
            // the oracle scans as a directory.
            let file = match rel.strip_prefix("evidence/") {
                Some(name) if !name.contains('/') && !name.contains("..") => {
                    fixtures_dir().join("../evidence").join(name)
                }
                _ => fixtures_dir().join(rel),
            };
            match std::fs::read(&file) {
                Ok(body) => {
                    let ct = if rel.ends_with(".css") { "text/css" } else { "text/html; charset=utf-8" };
                    respond(&mut stream, "200 OK", "", ct, &body)
                }
                Err(_) => respond(&mut stream, "404 Not Found", "", "text/plain", b"missing"),
            }
        }
    }
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
fn blocked_pages_are_refused_by_the_cli_path_and_recorded_by_evidence() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let options = ScanOptions::default();

    let blocked = format!("http://127.0.0.1:{port}/blocked");
    let err = engine.detect_url(&blocked, &options).expect_err("challenge page must not scan");
    assert!(err.message.contains("bot challenge"), "{}", err.message);
    assert!(err.message.contains("HTTP 405"), "{}", err.message);
    assert!(err.message.contains("x-amzn-waf-action: captcha"), "{}", err.message);

    let missing = format!("http://127.0.0.1:{port}/missing");
    let err = engine.detect_url(&missing, &options).expect_err("error page must not scan");
    assert!(err.message.contains("HTTP 404"), "{}", err.message);

    let mut browser = engine.launch().expect("launch");
    let (findings, evidence) =
        detect_url_evidence(&mut browser, &blocked, &options, "load", 100, &EvidenceRequest::default())
            .expect("evidence scan of a blocked page is Ok");
    browser.close();
    assert!(findings.is_empty());
    assert!(evidence.validity.as_ref().unwrap().is_blocked());
    assert_eq!(evidence.response.as_ref().unwrap().status, 405);
    assert!(evidence.scan_snapshot.is_none());
    assert!(evidence.screenshot.is_some(), "{:?}", evidence.screenshot_error);
}

/// The rule pass reads the page after the reveal sweep, so a section that is
/// still at opacity 0 when the page finishes loading is measured at the opacity
/// a visitor sees it at: its real faults are found, and the fade-in it uses to
/// get there is not itself reported as a fault.
#[test]
fn the_rule_pass_measures_the_revealed_page() {
    let Some(engine) = engine() else { return };
    if !fixtures_dir().join("scroll-reveal.html").exists() {
        eprintln!("skip: scroll-reveal.html not present");
        return;
    }
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/scroll-reveal.html");
    let findings = engine
        .detect_url(&url, &ScanOptions::default())
        .expect("scan");
    let flagged: Vec<(&str, &str)> = findings
        .iter()
        .map(|f| {
            (
                f.antipattern.as_str(),
                f.extras
                    .get("selector")
                    .and_then(|v| v.as_str())
                    .unwrap_or(""),
            )
        })
        .collect();

    // Inside the revealed column: faults only a post-reveal pass can measure.
    for want in [
        ("low-contrast", "#faint-copy"),
        ("tight-leading", "#cramped-copy"),
        ("undersized-ui-text", "#tiny-action"),
        // A raster the reveal never unburies stays a finding.
        ("buried-raster", "#buried-photo"),
    ] {
        assert!(flagged.contains(&want), "missing {want:?} in {flagged:?}");
    }
    // The fade-in the reveal runs on, and the column that is simply fine.
    for unwanted in ["#fade-photo", "#clean-copy", "#roomy-copy", "#clean-action"] {
        assert!(
            !flagged.iter().any(|(_, s)| *s == unwanted),
            "{unwanted} was flagged in {flagged:?}"
        );
    }
    // Everything reveals, so nothing is hidden at rest.
    assert!(
        !flagged.iter().any(|(id, _)| *id == "content-hidden-at-rest"),
        "{flagged:?}"
    );
}

/// Text and raster rules score only what is painted at capture: a collapsed
/// submenu, a scroller cell past its edge, a wrapper with no size, a faded
/// crossfade layer and an off-canvas panel carry the same measurements as
/// their visible twins and report nothing, while the twins report.
#[test]
fn the_rule_pass_skips_what_is_not_painted() {
    let Some(engine) = engine() else { return };
    if !fixtures_dir().join("painted-at-capture.html").exists() {
        eprintln!("skip: painted-at-capture.html not present");
        return;
    }
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/painted-at-capture.html");
    let findings = engine
        .detect_url(&url, &ScanOptions::default())
        .expect("scan");
    let flagged: Vec<(&str, &str)> = findings
        .iter()
        .map(|f| {
            (
                f.antipattern.as_str(),
                f.extras
                    .get("selector")
                    .and_then(|v| v.as_str())
                    .unwrap_or(""),
            )
        })
        .collect();

    for want in [
        ("undersized-ui-text", "#flag-submenu-link"),
        ("tight-leading", "#flag-submenu-copy"),
        ("low-contrast", "#flag-scroller-first"),
        ("tight-leading", "#flag-roomy-copy"),
        ("buried-raster", "#flag-buried-photo"),
        // An absolute popover escapes a clip below its containing block.
        ("undersized-ui-text", "#flag-popover-link"),
        // A transition utility alone does not make a buried image a state.
        ("buried-raster", "#flag-tw-buried-photo"),
        // Nor does a lazy-load marker on an image held at a faint value
        // other than 0: a fade starts from 0.
        ("buried-raster", "#flag-lazy-tw-buried-photo"),
        ("buried-raster", "#flag-lazy-fade-buried-photo"),
        // A fixed badge inside a containing block sits against it, not
        // against the viewport.
        ("undersized-ui-text", "#flag-cb-will-link"),
        ("undersized-ui-text", "#flag-cb-contain-link"),
        ("undersized-ui-text", "#flag-cb-translate-link"),
        ("undersized-ui-text", "#flag-cb-scale-link"),
        ("undersized-ui-text", "#flag-cb-rotate-link"),
        ("undersized-ui-text", "#flag-cb-perspective-link"),
        ("undersized-ui-text", "#flag-cb-backdrop-link"),
        // The visible twins of the leak cases below.
        ("undersized-ui-text", "#flag-sr-twin-copy"),
        ("low-contrast", "#flag-sr-twin-copy"),
        ("tight-leading", "#flag-open-copy"),
        ("bounce-easing", "#flag-open-tray"),
        ("clipped-overflow-container", "#flag-clip-menu-host"),
        // A fixed layer is clipped by a host that is its containing block.
        ("clipped-overflow-container", "#flag-clip-fixed-cb-host"),
        ("nested-cards", "#flag-nested-card"),
    ] {
        assert!(flagged.contains(&want), "missing {want:?} in {flagged:?}");
    }
    // The faint #bbbbbb copy is one colour pair, reported once by the first
    // scroller cell and counted (r14-t2). The three more are the crossfade
    // copy, the copy reached by scrolling the shell's main under a wrapper
    // that hides overflow, and the copy below a smooth-scroll frame's fold
    // (a viewport-tall frame that hides overflow is how such a library
    // scrolls the page). None of the unpainted pass cases wearing the pair
    // is counted.
    assert!(
        findings.iter().any(|f| f.antipattern == "low-contrast"
            && f.extras.get("selector").and_then(|v| v.as_str()) == Some("#flag-scroller-first")
            && f.snippet.ends_with("text #bbbbbb on #ffffff (and 3 more)")),
        "{flagged:?}"
    );
    for (rule, unwanted) in [
        // Screen-reader text inside a 1px box its clip removes.
        ("undersized-ui-text", "#pass-sr-copy"),
        ("undersized-ui-text", "#pass-sr-percentage"),
        ("low-contrast", "#pass-sr-copy"),
        ("low-contrast", "#pass-sr-percentage"),
        // A paragraph with no height that hides its overflow.
        ("tight-leading", "#pass-collapsed-copy"),
        // Motion on boxes that paint nothing.
        ("bounce-easing", "#pass-collapsed-tray"),
        ("bounce-easing", "#pass-hidden-volume"),
        ("bounce-easing", "#pass-parked-seek-bar"),
        // A menu that never renders, and a fixed layer the host cannot clip.
        ("clipped-overflow-container", "#pass-clip-hidden-menu-host"),
        ("clipped-overflow-container", "#pass-clip-fixed-host"),
        // Popup panels and a closed panel are not nested cards.
        ("nested-cards", "#pass-bem-dropdown"),
        ("nested-cards", "#pass-role-menu"),
        ("nested-cards", "#pass-role-listbox"),
        ("nested-cards", "#pass-hidden-card"),
    ] {
        assert!(
            !flagged.contains(&(rule, unwanted)),
            "{rule} on {unwanted} was flagged in {flagged:?}"
        );
    }
    for unwanted in [
        "#pass-submenu-link",
        "#pass-submenu-copy",
        "#pass-scroller-third",
        "#pass-zero-link",
        "#pass-zero-copy",
        "#pass-crossfade-poster",
        "#pass-crossfade-copy",
        "#pass-offcanvas-link",
        "#pass-frame-below",
        "#pass-lazy-photo",
        "#pass-video-poster",
        "#pass-parked-link",
    ] {
        assert!(
            !flagged.iter().any(|(_, s)| *s == unwanted),
            "{unwanted} was flagged in {flagged:?}"
        );
    }
}

#[test]
fn evidence_matches_the_cli_path_and_replay_matches_live() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let options = ScanOptions::default();
    let mut browser = engine.launch().expect("launch");

    for name in REPLAY_FIXTURES {
        if !fixtures_dir().join(name).exists() {
            eprintln!("skip fixture {name}: not present");
            continue;
        }
        let url = format!("http://127.0.0.1:{port}/{name}");
        let cli = engine.detect_url(&url, &options).expect("cli scan");
        let (live, evidence) =
            detect_url_evidence(&mut browser, &url, &options, "networkidle0", 0, &EvidenceRequest::default())
                .expect("evidence scan");

        let strip = |f: &impeccable_core::findings::Finding| {
            (f.antipattern.clone(), f.snippet.clone())
        };
        // The visual-contrast pass samples pixels, so compare the passes that
        // do not: everything but visual-contrast must match the CLI path.
        let non_visual = |fs: &[impeccable_core::findings::Finding], origins: Option<&[&str]>| -> Vec<(String, String)> {
            fs.iter()
                .enumerate()
                .filter(|(i, f)| match origins {
                    Some(o) => o[*i] != origin::VISUAL_CONTRAST,
                    None => f.antipattern != "low-contrast" || f.extras.get("selector").is_some(),
                })
                .map(|(_, f)| strip(f))
                .collect()
        };
        assert_eq!(evidence.origins.len(), live.len());
        let live_scan: Vec<(String, String)> = non_visual(&live, Some(&evidence.origins));
        let cli_all: Vec<(String, String)> = cli.iter().map(strip).collect();
        for item in &live_scan {
            assert!(cli_all.contains(item), "{name}: evidence finding {item:?} missing from the CLI path");
        }

        let scan_findings = live.iter().zip(&evidence.origins).filter(|(_, o)| **o == origin::SCAN);
        for (f, _) in scan_findings {
            assert!(f.extras.get("selector").is_some(), "{name}: {} has no selector", f.antipattern);
        }
        assert!(evidence.screenshot.is_some(), "{name}: {:?}", evidence.screenshot_error);
        if live.iter().any(|f| f.extras.get("selector").is_some()) {
            assert!(!evidence.element_rects.is_empty(), "{name}: no element rects");
        }

        let replay = replay_url_scan(
            &url,
            evidence.scan_snapshot.as_deref().expect("scan snapshot"),
            &evidence.scan_facts,
            evidence
                .reveal_snapshot
                .as_deref()
                .map(|s| (s, &evidence.reveal_facts)),
            &options,
        )
        .expect("replay");
        let replayable: Vec<&impeccable_core::findings::Finding> = live
            .iter()
            .zip(&evidence.origins)
            .filter(|(_, o)| **o == origin::SCAN || **o == origin::CONTENT_HIDDEN)
            .map(|(f, _)| f)
            .collect();
        let replayed: Vec<&impeccable_core::findings::Finding> = replay.findings.iter().collect();
        assert_eq!(replayed, replayable, "{name}: replay differs from the live scan");
        assert_eq!(replay.unanswered_hit_tests, 0, "{name}: unanswered hit tests");
    }
    browser.close();
}

#[test]
fn evidence_measures_the_element_the_scan_flagged_when_an_id_repeats() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let mut browser = engine.launch().expect("launch");
    let url = format!("http://127.0.0.1:{port}/evidence-duplicate-id.html");
    let (findings, evidence) = detect_url_evidence(
        &mut browser,
        &url,
        &ScanOptions::default(),
        "load",
        100,
        &EvidenceRequest::default(),
    )
    .expect("evidence scan");
    browser.close();
    let flagged: Vec<(&str, &str)> = findings
        .iter()
        .map(|f| {
            (
                f.antipattern.as_str(),
                f.extras.get("selector").and_then(|v| v.as_str()).unwrap_or(""),
            )
        })
        .collect();
    for selector in ["#dup-note", "#dup-first-note", "#solo-note"] {
        assert!(flagged.contains(&("low-contrast", selector)), "{selector} not flagged: {flagged:?}");
    }
    let rect = |s: &str| -> Vec<f64> {
        evidence
            .element_rects
            .get(s)
            .and_then(|v| v.as_array())
            .unwrap_or_else(|| panic!("no rect for {s}: {:?}", evidence.element_rects.keys()))
            .iter()
            .filter_map(|n| n.as_f64())
            .collect()
    };
    let text = |s: &str| evidence.element_details[s]["text"].as_str().unwrap_or("").to_string();

    // Should flag: the copy the scan scored sits below two collapsed copies
    // and a 320px spacer. `querySelector` would name the first collapsed copy.
    let dup = rect("#dup-note");
    assert!(dup[2] > 400.0 && dup[3] > 10.0 && dup[1] > 320.0, "{dup:?}");
    assert_eq!(text("#dup-note"), "Faint note, the copy a visitor sees.");
    // Should pass: the visible copy comes first, and a unique id.
    let first = rect("#dup-first-note");
    assert!(first[2] > 400.0 && first[1] < 200.0, "{first:?}");
    assert_eq!(text("#dup-first-note"), "Faint note, visible first copy.");
    assert!(rect("#solo-note")[2] > 400.0);
    assert_eq!(text("#solo-note"), "Faint note with an id of its own.");

    // The screenshot shows the flagged copy at its rect.
    use base64::Engine as _;
    let shot = evidence.screenshot.as_ref().expect("screenshot");
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&shot.jpeg_base64)
        .expect("base64");
    let img = image::load_from_memory_with_format(&bytes, image::ImageFormat::Jpeg)
        .expect("jpeg")
        .to_rgb8();
    let (mut lo, mut hi) = (255u8, 0u8);
    for y in dup[1] as u32..(dup[1] + dup[3]) as u32 {
        for x in dup[0] as u32..(dup[0] + dup[2]).min(img.width() as f64) as u32 {
            let p = img.get_pixel(x, y).0;
            let l = ((p[0] as u32 * 299 + p[1] as u32 * 587 + p[2] as u32 * 114) / 1000) as u8;
            lo = lo.min(l);
            hi = hi.max(l);
        }
    }
    assert!(hi.saturating_sub(lo) > 20, "the flagged copy is blank at its rect");
}

/// round 9: the evidence step measures the element the scan flagged, marks
/// one that left the page (at once, or while it was away) as transient, measures one that moved a viewport
/// width away again and records it if it stays away, and anchors a page-level
/// halo declared through `var()` on the element that paints it.
#[test]
fn evidence_follows_the_scanned_element_after_the_page_changes() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let mut browser = engine.launch().expect("launch");
    let url = format!("http://127.0.0.1:{port}/evidence-after-scan.html");
    let (findings, evidence) = detect_url_evidence(
        &mut browser,
        &url,
        &ScanOptions::default(),
        "load",
        100,
        &EvidenceRequest::default(),
    )
    .expect("evidence scan");
    browser.close();
    let selector = |class: &str| -> String {
        findings
            .iter()
            .filter(|f| f.antipattern == "low-contrast")
            .filter_map(|f| f.extras.get("selector").and_then(|v| v.as_str()))
            .find(|s| s.contains(class))
            .unwrap_or_else(|| panic!("{class} not flagged: {findings:#?}"))
            .to_string()
    };
    let rect = |s: &str| -> Vec<f64> {
        evidence.element_rects[s].as_array().unwrap().iter().filter_map(|n| n.as_f64()).collect()
    };

    // The paragraph the scan flagged, not the one the class moved to.
    let typing = selector("typing-note");
    assert_eq!(
        evidence.element_details[&typing]["text"].as_str(),
        Some("Faint note the scan flagged, first of two.")
    );

    // Gone: transient, with no rect.
    let toast = selector("toast-note");
    assert!(evidence.element_rects.get(&toast).is_none());

    // Away at the first measure and gone by a later one: transient too, and
    // the rect and details of the first measure do not outlive it.
    let vanish = selector("vanish-note");
    assert_eq!(evidence.transient, vec![toast.clone(), vanish.clone()]);
    assert!(evidence.element_rects.get(&vanish).is_none());
    assert!(evidence.element_details.get(&vanish).is_none());
    assert!(evidence.element_drift.get(&vanish).is_none());

    // Away for good: the measured rect stands and the drift is recorded.
    let slide = selector("slide-note");
    assert!(rect(&slide)[0] < -2000.0, "{:?}", rect(&slide));
    let drift = &evidence.element_drift[&slide];
    assert!(drift["scan"][0].as_f64().unwrap() > 0.0, "{drift}");
    assert!(drift["measured"][0].as_f64().unwrap() < -2000.0, "{drift}");

    // Away and back: measured again where the scan had it.
    let bounce = selector("bounce-note");
    assert!(rect(&bounce)[0] >= 0.0, "{:?}", rect(&bounce));
    assert!(evidence.element_drift.get(&bounce).is_none());
    assert_eq!(evidence.element_drift.len(), 1, "{:?}", evidence.element_drift);

    // The halo is reported on the page, and anchored on the orb.
    assert_eq!(evidence.page_anchors.len(), findings.len());
    let halo = findings
        .iter()
        .position(|f| f.antipattern == "radial-halo")
        .unwrap_or_else(|| panic!("no radial-halo: {findings:#?}"));
    assert_eq!(findings[halo].extras.get("selector").and_then(|v| v.as_str()), Some("body"));
    let anchor = &evidence.page_anchors[halo];
    assert_eq!(anchor["class"].as_str(), Some("orb"), "{anchor}");
    let r: Vec<f64> = anchor["rect"].as_array().unwrap().iter().filter_map(|n| n.as_f64()).collect();
    assert_eq!(r, vec![700.0, 300.0, 400.0, 400.0]);
    for (f, a) in findings.iter().zip(&evidence.page_anchors) {
        if f.antipattern != "radial-halo" {
            assert!(a.is_null(), "{f:?}: {a}");
        }
    }
}

/// round 14: a slide that steps on between the evidence measure and the
/// screenshot (gseek.kr, corpus run 1010) is measured again after the
/// screenshot, and its drift records where it went (`afterShot`) beside the
/// rect the crop was cut by. A note that stays put records nothing.
#[test]
fn evidence_notes_an_element_that_moved_during_the_screenshot() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let mut browser = engine.launch().expect("launch");
    let url = format!("http://127.0.0.1:{port}/evidence/shot-motion.html");
    let (findings, evidence) =
        detect_url_evidence(&mut browser, &url, &ScanOptions::default(), "load", 100, &EvidenceRequest::default())
            .expect("evidence scan");
    browser.close();
    let selector = |class: &str| -> String {
        findings
            .iter()
            .filter(|f| f.antipattern == "low-contrast")
            .filter_map(|f| f.extras.get("selector").and_then(|v| v.as_str()))
            .find(|s| s.contains(class))
            .unwrap_or_else(|| panic!("{class} not flagged: {findings:#?}"))
            .to_string()
    };
    let step = selector("step-note");
    let measured = evidence.element_rects[&step][0].as_f64().unwrap();
    let drift = &evidence.element_drift[&step];
    assert_eq!(drift["measured"][0].as_f64(), Some(measured), "{drift}");
    assert_eq!(drift["scan"][0], drift["measured"][0], "{drift}");
    assert!(drift["afterShot"][0].as_f64().unwrap() - measured > 260.0, "{drift}");
    assert!(evidence.element_drift.get(&selector("still-note")).is_none(), "{:?}", evidence.element_drift);
    assert_eq!(evidence.element_drift.len(), 1, "{:?}", evidence.element_drift);
}
