//! Product tours and preloaders are hidden before the rule pass, against an
//! installed browser. Skips cleanly when there is none.
//!
//! - A driver.js-shaped tour at load: with hiding (the default) the copy
//!   under its popover reports and the popover's own text does not, every
//!   finding carries `overlaysHidden`, and the body classes that took the page
//!   out of hit tests are removed; with `keep_overlays` (the CLI's
//!   `--no-overlay-hiding`) the tour stays and its popover text is scored.
//! - A preloader that never clears is waited for, then hidden and recorded,
//!   one that lets clicks pass through (`pointer-events: none`) included,
//!   and the scroll lock it kept on the page is undone, unless a modal of
//!   the site's own may hold it.
//! - A preloader that clears on its own is waited for and nothing is hidden.
//! - A routing gate on a full-screen opaque layer named like a loader stays:
//!   it holds controls, so it is not a preloader.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};

use impeccable_browser::overlays::HiddenOverlay;
use impeccable_browser::{detect_url_evidence, BrowserEngine, EvidenceRequest};
use impeccable_core::findings::Finding;
use impeccable_detect::engines::{ScanOptions, UrlEngine};

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/overlays")
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
        .to_string();
    // Only files in the fixture directory: no `..` segment, no absolute path.
    let rel = path.trim_start_matches('/');
    let body = if rel.split('/').any(|seg| seg == ".." || seg.contains('\\')) {
        Vec::new()
    } else {
        std::fs::read(fixtures_dir().join(rel)).unwrap_or_default()
    };
    let head = format!(
        "HTTP/1.0 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(&body);
}

fn engine() -> Option<BrowserEngine> {
    let env: HashMap<String, String> = std::env::vars().collect();
    if impeccable_browser::discovery::find_browser(&env).is_err() {
        eprintln!("skip: no installed browser found");
        return None;
    }
    Some(BrowserEngine::new(env))
}

fn flagged(findings: &[Finding]) -> Vec<(String, String)> {
    findings
        .iter()
        .map(|f| {
            (
                f.antipattern.clone(),
                f.extras.get("selector").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            )
        })
        .collect()
}

fn has(flagged: &[(String, String)], rule: &str, selector: &str) -> bool {
    flagged.iter().any(|(r, s)| r == rule && s == selector)
}

fn hidden(kind: &str, name: &str) -> HiddenOverlay {
    HiddenOverlay { kind: kind.into(), name: name.into() }
}

const KEEP: ScanOptions = ScanOptions {
    inline_ignores: false,
    design_system: None,
    viewport: None,
    profile: None,
    rule_pack: None,
    keep_consent_banners: false,
    keep_overlays: true,
    unreported_rules: Vec::new(),
    image_samples: impeccable_detect::engines::ImageSamples::Decode,
};

#[test]
fn a_driver_tour_is_hidden_and_the_page_under_it_scored() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/driver-tour.html");

    let scan = engine.detect_url_scan(&url, &ScanOptions::default()).expect("scan");
    let found = flagged(&scan.findings);
    assert!(has(&found, "low-contrast", "#covered-copy"), "{found:#?}");
    assert!(has(&found, "low-contrast", "#covered-cta"), "{found:#?}");
    assert!(!has(&found, "low-contrast", "#driver-popover-description"), "{found:#?}");
    for f in &scan.findings {
        assert_eq!(
            f.extras.get("overlaysHidden"),
            Some(&serde_json::json!([{ "kind": "tour", "name": "driver.js" }])),
            "{f:?}"
        );
        assert!(f.extras.get("consentHidden").is_none());
    }
    assert_eq!(
        scan.notes,
        vec![format!("Hid the driver.js tour on {url} before scanning. Pass --no-overlay-hiding to scan it.")]
    );

    let mut browser = engine.launch().expect("launch");
    let (_, evidence) =
        detect_url_evidence(&mut browser, &url, &ScanOptions::default(), "load", 100, &EvidenceRequest::default())
            .expect("scan");
    let (kept, kept_evidence) =
        detect_url_evidence(&mut browser, &url, &KEEP, "load", 100, &EvidenceRequest::default()).expect("scan");
    browser.close();
    let report = evidence.overlays.as_ref().expect("overlay report");
    assert_eq!(report.hidden, vec![hidden("tour", "driver.js")]);
    assert_eq!(
        report.matched,
        vec![("driver.js".to_string(), vec![".driver-popover".to_string(), "svg.driver-overlay".to_string()])]
    );
    assert_eq!(
        report.unlocked,
        vec![
            "body.driver-active",
            "body.driver-fade",
            "highlight .driver-active-element",
            "highlight .driver-no-interaction",
            "highlight aria"
        ]
    );
    assert_eq!(report.waited_ms, 0);
    let snapshot = evidence.scan_snapshot.as_deref().unwrap();
    assert!(snapshot.contains("impeccable-overlay-hide"));
    assert!(!snapshot.contains(r#"["aria-controls","driver-popover-content"]"#), "highlight aria removed");
    assert!(!snapshot.contains(r#"["class","driver-active driver-fade"]"#), "body classes removed");

    // Opted out, the tour stays and its popover is scored as the page.
    let shown = flagged(&kept);
    assert!(has(&shown, "low-contrast", "#driver-popover-description"), "{shown:#?}");
    assert!(kept_evidence.overlays.is_none());
}

#[test]
fn a_stuck_preloader_is_waited_for_then_hidden() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/preloader-stuck.html");
    let mut browser = engine.launch().expect("launch");
    let (findings, evidence) =
        detect_url_evidence(&mut browser, &url, &ScanOptions::default(), "load", 100, &EvidenceRequest::default())
            .expect("scan");
    let (kept, _) = detect_url_evidence(&mut browser, &url, &KEEP, "load", 100, &EvidenceRequest::default()).expect("scan");
    browser.close();
    let found = flagged(&findings);
    assert!(has(&found, "low-contrast", "#covered-copy"), "{found:#?}");
    let report = evidence.overlays.as_ref().expect("overlay report");
    assert_eq!(report.hidden, vec![hidden("preloader", "div#preloader")]);
    assert!(report.waited_ms >= impeccable_browser::overlays::PRELOADER_WAIT_MS, "{}", report.waited_ms);
    assert!(evidence.scan_snapshot.as_deref().unwrap().contains("data-impeccable-hidden"));
    // Kept, the white layer covers the copy and it is not scored.
    assert!(!has(&flagged(&kept), "low-contrast", "#covered-copy"), "{kept:#?}");
}

#[test]
fn a_stuck_preloader_clicks_pass_through_is_hidden_too() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/preloader-pass-through.html");
    let mut browser = engine.launch().expect("launch");
    let (findings, evidence) =
        detect_url_evidence(&mut browser, &url, &ScanOptions::default(), "load", 100, &EvidenceRequest::default())
            .expect("scan");
    browser.close();
    assert!(has(&flagged(&findings), "low-contrast", "#covered-copy"), "{findings:#?}");
    let report = evidence.overlays.as_ref().expect("overlay report");
    assert_eq!(report.hidden, vec![hidden("preloader", "div#preloader")]);
}

#[test]
fn a_stuck_preloaders_scroll_lock_is_undone() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/preloader-locked.html");
    let mut browser = engine.launch().expect("launch");
    let (_, evidence) =
        detect_url_evidence(&mut browser, &url, &ScanOptions::default(), "load", 100, &EvidenceRequest::default())
            .expect("scan");
    browser.close();
    let report = evidence.overlays.as_ref().expect("overlay report");
    assert_eq!(report.hidden, vec![hidden("preloader", "div#preloader")]);
    assert_eq!(report.unlocked, vec!["body.is-loading", "body style overflow"]);
}

#[test]
fn a_site_modals_scroll_lock_stays_when_a_preloader_is_hidden() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/preloader-locked-modal.html");
    let mut browser = engine.launch().expect("launch");
    let (_, evidence) =
        detect_url_evidence(&mut browser, &url, &ScanOptions::default(), "load", 100, &EvidenceRequest::default())
            .expect("scan");
    browser.close();
    let report = evidence.overlays.as_ref().expect("overlay report");
    assert_eq!(report.hidden, vec![hidden("preloader", "div#preloader")]);
    assert_eq!(report.unlocked, vec!["body.is-loading"]);
}

#[test]
fn a_preloader_that_clears_is_waited_for_and_nothing_hidden() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/preloader-clears.html");
    let mut browser = engine.launch().expect("launch");
    let (findings, evidence) =
        detect_url_evidence(&mut browser, &url, &ScanOptions::default(), "load", 100, &EvidenceRequest::default())
            .expect("scan");
    browser.close();
    assert!(has(&flagged(&findings), "low-contrast", "#covered-copy"), "{findings:#?}");
    let report = evidence.overlays.as_ref().expect("overlay report");
    assert!(report.hidden.is_empty(), "{report:?}");
    assert!(report.waited_ms > 0 && report.waited_ms < impeccable_browser::overlays::PRELOADER_WAIT_MS, "{}", report.waited_ms);
}

#[test]
fn a_routing_gate_named_like_a_loader_stays() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/gate.html");
    let scan = engine.detect_url_scan(&url, &ScanOptions::default()).expect("scan");
    let found = flagged(&scan.findings);
    assert!(has(&found, "low-contrast", "#gate-hint"), "{found:#?}");
    assert!(scan.findings.iter().all(|f| f.extras.get("overlaysHidden").is_none()));
    assert!(scan.notes.is_empty(), "{:?}", scan.notes);
}

#[test]
fn a_lovable_badge_is_hidden_and_the_copy_under_it_scored() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/lovable-badge.html");
    let scan = engine.detect_url_scan(&url, &ScanOptions::default()).expect("scan");
    let found = flagged(&scan.findings);
    assert!(has(&found, "low-contrast", "#covered-copy"), "{found:#?}");
    assert!(!found.iter().any(|(_, s)| s.contains("lovable-badge")), "{found:#?}");
    for f in &scan.findings {
        assert_eq!(
            f.extras.get("overlaysHidden"),
            Some(&serde_json::json!([{ "kind": "badge", "name": "Lovable" }])),
            "{f:?}"
        );
    }
    assert_eq!(
        scan.notes,
        vec![format!("Hid the Lovable badge on {url} before scanning. Pass --no-overlay-hiding to scan it.")]
    );

    let mut browser = engine.launch().expect("launch");
    let (_, evidence) =
        detect_url_evidence(&mut browser, &url, &ScanOptions::default(), "load", 100, &EvidenceRequest::default())
            .expect("scan");
    let (kept, _) = detect_url_evidence(&mut browser, &url, &KEEP, "load", 100, &EvidenceRequest::default()).expect("scan");
    browser.close();
    let report = evidence.overlays.as_ref().expect("overlay report");
    assert_eq!(report.hidden, vec![hidden("badge", "Lovable")]);
    assert_eq!(report.matched, vec![("Lovable".to_string(), vec!["#lovable-badge".to_string()])]);
    // Kept, the badge's own label is scored as the page's.
    let shown = flagged(&kept);
    assert!(shown.iter().any(|(_, s)| s.contains("lovable-badge")), "{shown:#?}");
}
