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
//! - A click-to-enter splash is hidden (not clicked); an age gate on the
//!   same kind of layer stays.
//! - An intro named as one, with a gradient fill and a progress line, is
//!   waited for, and hidden once its budget runs out.
//! - An unnamed intro (aria-hidden, playing a finite animation) is waited
//!   for the same way; an aria-hidden layer with only an infinite animation,
//!   a wall with controls, a tap-to-start layer, and a fixed hero the page
//!   scrolls over (even one animating for 20s, which is not waited for) stay.

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
    ignored_linked_stylesheet: None,
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

/// A loader whose short message mentions entering but offers no way
/// through is still a loader: waited for, then hidden (review on #1106).
#[test]
fn a_stuck_preloader_that_mentions_entering_is_hidden() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/preloader-enter-text.html");
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

#[test]
fn a_click_to_enter_splash_is_hidden() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/splash.html");
    let mut browser = engine.launch().expect("launch");
    let (findings, evidence) =
        detect_url_evidence(&mut browser, &url, &ScanOptions::default(), "load", 100, &EvidenceRequest::default())
            .expect("scan");
    let (kept, _) = detect_url_evidence(&mut browser, &url, &KEEP, "load", 100, &EvidenceRequest::default()).expect("scan");
    browser.close();
    assert!(has(&flagged(&findings), "low-contrast", "#covered-copy"), "{findings:#?}");
    let report = evidence.overlays.as_ref().expect("overlay report");
    assert_eq!(report.hidden, vec![hidden("splash", "div.splash (\"Enter NoteForge \u{2192}\")")]);
    // Hidden at once: a splash is never waited for.
    assert_eq!(report.waited_ms, 0);
    assert!(!has(&flagged(&kept), "low-contrast", "#covered-copy"), "{kept:#?}");
}

#[test]
fn an_age_gate_stays() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/age-gate.html");
    let scan = engine.detect_url_scan(&url, &ScanOptions::default()).expect("scan");
    assert!(!has(&flagged(&scan.findings), "low-contrast", "#covered-copy"), "{:#?}", scan.findings);
    assert!(scan.findings.iter().all(|f| f.extras.get("overlaysHidden").is_none()));
}

#[test]
fn an_intro_that_ends_is_waited_for_and_nothing_hidden() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/intro-clears.html");
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
fn an_intro_that_never_ends_is_hidden_after_its_budget() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/intro-stuck.html");
    let mut browser = engine.launch().expect("launch");
    let (findings, evidence) =
        detect_url_evidence(&mut browser, &url, &ScanOptions::default(), "load", 100, &EvidenceRequest::default())
            .expect("scan");
    browser.close();
    assert!(has(&flagged(&findings), "low-contrast", "#covered-copy"), "{findings:#?}");
    let report = evidence.overlays.as_ref().expect("overlay report");
    assert_eq!(report.hidden, vec![hidden("intro", "div.cine-intro")]);
    assert!(report.waited_ms >= impeccable_browser::overlays::INTRO_WAIT_MS, "{}", report.waited_ms);
}

/// A named intro whose text is longer than a splash allows and mentions
/// entering is still an intro: waited for, then hidden.
#[test]
fn a_long_named_intro_that_says_enter_is_still_hidden() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/intro-enter-text.html");
    let mut browser = engine.launch().expect("launch");
    let (findings, evidence) =
        detect_url_evidence(&mut browser, &url, &ScanOptions::default(), "load", 100, &EvidenceRequest::default())
            .expect("scan");
    browser.close();
    assert!(has(&flagged(&findings), "low-contrast", "#covered-copy"), "{findings:#?}");
    let report = evidence.overlays.as_ref().expect("overlay report");
    assert_eq!(report.hidden, vec![hidden("intro", "div.cine-intro")]);
}

/// A long named layer that says enter and states an age is an age gate:
/// it stays.
#[test]
fn a_long_named_age_gate_stays() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/intro-age-gate.html");
    let mut browser = engine.launch().expect("launch");
    let (_, evidence) =
        detect_url_evidence(&mut browser, &url, &ScanOptions::default(), "load", 100, &EvidenceRequest::default())
            .expect("scan");
    browser.close();
    let report = evidence.overlays.as_ref().expect("overlay report");
    assert!(report.hidden.is_empty(), "{report:?}");
}

/// The review's probes: a one-screen site, a curtain hero with an Enter
/// link, and a fixed hero named intro are the page, not a layer in front of
/// it. Nothing is hidden and nothing is waited for.
#[test]
fn heroes_that_are_the_page_stay() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let mut browser = engine.launch().expect("launch");
    for page in ["stay-landing.html", "stay-curtain.html", "stay-intro-hero.html"] {
        let url = format!("http://127.0.0.1:{port}/{page}");
        let (findings, evidence) =
            detect_url_evidence(&mut browser, &url, &ScanOptions::default(), "load", 100, &EvidenceRequest::default())
                .expect("scan");
        assert!(has(&flagged(&findings), "low-contrast", "#own"), "{page}: {:#?}", flagged(&findings));
        let report = evidence.overlays.as_ref().expect("overlay report");
        assert!(report.hidden.is_empty(), "{page}: {report:?}");
        assert_eq!(report.waited_ms, 0, "{page}");
    }
    browser.close();
}

/// An intro no loader or intro word names (articulation-hub.vercel.app's
/// `div.spl`, corpus run 1010): aria-hidden, fixed over the page, opaque,
/// playing a finite animation. One the page's script removes after its
/// animation is waited for and nothing is hidden.
#[test]
fn an_unnamed_intro_that_ends_is_waited_for_and_nothing_hidden() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/intro-unnamed-clears.html");
    let mut browser = engine.launch().expect("launch");
    let (findings, evidence) =
        detect_url_evidence(&mut browser, &url, &ScanOptions::default(), "load", 100, &EvidenceRequest::default())
            .expect("scan");
    browser.close();
    assert!(has(&flagged(&findings), "low-contrast", "#covered-copy"), "{findings:#?}");
    let report = evidence.overlays.as_ref().expect("overlay report");
    assert!(report.hidden.is_empty(), "{report:?}");
    assert!(report.waited_ms > 0 && report.waited_ms < impeccable_browser::overlays::INTRO_WAIT_MS, "{}", report.waited_ms);
}

/// The same layer, never removed once its animation ends: waited for the
/// intro budget, then hidden and named by its first class.
#[test]
fn an_unnamed_intro_that_never_ends_is_hidden_after_its_budget() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/intro-unnamed-stuck.html");
    let mut browser = engine.launch().expect("launch");
    let (findings, evidence) =
        detect_url_evidence(&mut browser, &url, &ScanOptions::default(), "load", 100, &EvidenceRequest::default())
            .expect("scan");
    browser.close();
    assert!(has(&flagged(&findings), "low-contrast", "#covered-copy"), "{findings:#?}");
    let report = evidence.overlays.as_ref().expect("overlay report");
    assert_eq!(report.hidden, vec![hidden("intro", "div.spl")]);
    assert!(report.waited_ms >= impeccable_browser::overlays::INTRO_WAIT_MS, "{}", report.waited_ms);
}

/// Twins of the unnamed intro that stay: an aria-hidden layer whose only
/// animation is infinite (not waited for, so it cannot stall the scan), a
/// wall with a field and a button under a running finite animation (an
/// answer, not an intro), and a layer with its own `onclick` and
/// `cursor: pointer` that says "Tap anywhere to start" (a gate). Neither is waited for nor hidden, and the copy
/// under them is not scored.
#[test]
fn unnamed_layers_that_are_not_intros_stay() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let mut browser = engine.launch().expect("launch");
    for page in ["stay-unnamed-infinite.html", "stay-unnamed-modal.html", "stay-unnamed-tap.html"] {
        let url = format!("http://127.0.0.1:{port}/{page}");
        let (findings, evidence) =
            detect_url_evidence(&mut browser, &url, &ScanOptions::default(), "load", 100, &EvidenceRequest::default())
                .expect("scan");
        // The tap layer fades in from 0.6 opacity, so the copy under it may
        // score either way; what it pins is the wait and the hide.
        if page != "stay-unnamed-tap.html" {
            assert!(!has(&flagged(&findings), "low-contrast", "#covered-copy"), "{page}: {:#?}", flagged(&findings));
        }
        let report = evidence.overlays.as_ref().expect("overlay report");
        assert!(report.hidden.is_empty(), "{page}: {report:?}");
        assert_eq!(report.waited_ms, 0, "{page}");
    }
    browser.close();
}

/// A fixed aria-hidden hero that the content scrolls over, fading in: the
/// wait may count it while it animates, but nothing of a page is under it,
/// so it is the page and is never hidden.
#[test]
fn an_unnamed_fixed_hero_that_animates_stays() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/stay-unnamed-hero.html");
    let mut browser = engine.launch().expect("launch");
    let (_, evidence) =
        detect_url_evidence(&mut browser, &url, &ScanOptions::default(), "load", 100, &EvidenceRequest::default())
            .expect("scan");
    browser.close();
    let report = evidence.overlays.as_ref().expect("overlay report");
    assert!(report.hidden.is_empty(), "{report:?}");
    assert!(report.waited_ms < impeccable_browser::overlays::INTRO_WAIT_MS, "{}", report.waited_ms);
}

/// Review probe `hero-kenburns` (round 14): a fixed aria-hidden hero playing
/// a 20s finite zoom with the page scrolling over it from 100vh. While it
/// animates the wait drops only the outside-text minimum, not the hit test,
/// so nothing of a page under it means it is not waited for.
#[test]
fn an_unnamed_fixed_hero_with_a_long_animation_is_not_waited_for() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/stay-unnamed-hero-long.html");
    let mut browser = engine.launch().expect("launch");
    let (_, evidence) =
        detect_url_evidence(&mut browser, &url, &ScanOptions::default(), "load", 100, &EvidenceRequest::default())
            .expect("scan");
    browser.close();
    let report = evidence.overlays.as_ref().expect("overlay report");
    assert!(report.hidden.is_empty(), "{report:?}");
    assert!(report.waited_ms < 1000, "{}", report.waited_ms);
}

/// The unnamed intro over a sparse page (under 200 characters outside it,
/// as on articulation-hub.vercel.app's inner pages): while it animates the
/// wait drops only that minimum, so it is still waited for, and with too
/// little page to front it is never hidden.
#[test]
fn an_unnamed_intro_over_a_sparse_page_is_still_waited_for() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/intro-unnamed-sparse.html");
    let mut browser = engine.launch().expect("launch");
    let (_, evidence) =
        detect_url_evidence(&mut browser, &url, &ScanOptions::default(), "load", 100, &EvidenceRequest::default())
            .expect("scan");
    browser.close();
    let report = evidence.overlays.as_ref().expect("overlay report");
    assert!(report.hidden.is_empty(), "{report:?}");
    assert!(report.waited_ms > 0 && report.waited_ms < impeccable_browser::overlays::INTRO_WAIT_MS, "{}", report.waited_ms);
}
