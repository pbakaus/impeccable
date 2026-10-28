//! Known consent managers' banners are hidden before the rule pass, against
//! an installed browser. Skips cleanly when there is none.
//!
//! - A OneTrust-shaped banner over copy and a CTA with real contrast
//!   failures: with hiding (the default) the page copy and the CTA report and
//!   the banner's own text does not; with `keep_consent_banners` (the CLI's
//!   `--no-consent-hiding`, the engine's old behavior) the covered copy and
//!   CTA go unscored and the banner text reports.
//! - A Cookiebot-shaped modal injected late, on the first scroll, with an
//!   underlay and an inline scroll lock on `<body>`: caught by the hide pass
//!   after the reveal sweep, recorded in the evidence, and the lock undone.
//! - A cookie notice the site wrote itself (no vendor markup) is hidden, and
//!   so are a ktk.de-shaped lock's empty layer and the blur it put on the
//!   page; a newsletter or sign-in modal, a bar that only links a cookie
//!   policy, and a notice over a page too short to be more than it stay.
//! - Tarteaucitron's banner is hidden.
//! - A page that is only a consent wall is refused as one; with the banners
//!   kept it is scanned, since the banner is what that scan asked for.
//! - A short page under an ordinary banner (a sign-in form) is not a wall.
//! - An app shell's own body lock stays when a manager's backdrop shows.
//! - A wall that arrives after the load-time check, or renders its text in a
//!   shadow root, is still refused as one.
//! - A lock the site's own open modal holds stays.
//! - A wall that fills a root already in the page, or is drawn in a frame,
//!   is refused; a short page under a shadow-root banner, or one appended
//!   outside <body>, is scanned, as is a page whose late banner closed
//!   itself; a late banner on a root the first pass hid inline is reported.
//! - A form two web components down counts as the page; a late banner its
//!   manager closed by rewriting its style to the stamped
//!   `display: none !important` stays closed; dialogs a fixed layer parks
//!   past the viewport, or a collapsed wrapper clips away, are not showing,
//!   while a fixed bar a transformed ancestor holds below the fold is; and a
//!   banner that arrives during the scroll probe is hidden after it.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};

use impeccable_browser::{detect_url_evidence, BrowserEngine, EvidenceRequest};
use impeccable_core::findings::Finding;
use impeccable_detect::engines::{ScanOptions, UrlEngine};

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/consent")
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

const KEEP: ScanOptions = ScanOptions {
    inline_ignores: false,
    design_system: None,
    viewport: None,
    profile: None,
    rule_pack: None,
    keep_consent_banners: true,
    keep_overlays: false,
    unreported_rules: Vec::new(),
    image_samples: impeccable_detect::engines::ImageSamples::Decode,
    ignored_linked_stylesheet: None,
};

#[test]
fn a_onetrust_banner_is_hidden_and_the_page_under_it_scored() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/onetrust.html");

    let scan = engine.detect_url_scan(&url, &ScanOptions::default()).expect("scan");
    let hidden = flagged(&scan.findings);
    assert!(has(&hidden, "low-contrast", "#covered-copy"), "{hidden:#?}");
    assert!(has(&hidden, "low-contrast", "#covered-cta"), "{hidden:#?}");
    assert!(!has(&hidden, "low-contrast", "#onetrust-policy-text"), "{hidden:#?}");
    // Every finding names what was hidden, and the text output says so.
    for f in &scan.findings {
        assert_eq!(f.extras.get("consentHidden"), Some(&serde_json::json!(["OneTrust"])), "{f:?}");
    }
    assert_eq!(
        scan.notes,
        vec![format!(
            "Hid the OneTrust consent banner on {url} before scanning. Pass --no-consent-hiding to scan it."
        )]
    );

    // Opted out, the banner stays: what it covers is not scored, and its own
    // text is, the way the engine scanned before hiding existed.
    let kept = engine.detect_url_scan(&url, &KEEP).expect("scan");
    let shown = flagged(&kept.findings);
    assert!(!has(&shown, "low-contrast", "#covered-copy"), "{shown:#?}");
    assert!(!has(&shown, "low-contrast", "#covered-cta"), "{shown:#?}");
    assert!(has(&shown, "low-contrast", "#onetrust-policy-text"), "{shown:#?}");
    assert!(kept.findings.iter().all(|f| f.extras.get("consentHidden").is_none()));
    assert!(kept.notes.is_empty());
}

#[test]
fn a_late_cookiebot_modal_is_caught_and_its_scroll_lock_undone() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/cookiebot.html");
    let mut browser = engine.launch().expect("launch");
    let (findings, evidence) =
        detect_url_evidence(&mut browser, &url, &ScanOptions::default(), "load", 100, &EvidenceRequest::default())
            .expect("scan");
    let (kept, kept_evidence) =
        detect_url_evidence(&mut browser, &url, &KEEP, "load", 100, &EvidenceRequest::default()).expect("scan");
    browser.close();

    let hidden = flagged(&findings);
    assert!(has(&hidden, "low-contrast", "#covered-copy"), "{hidden:#?}");
    assert!(has(&hidden, "low-contrast", "#covered-cta"), "{hidden:#?}");
    assert!(!has(&hidden, "low-contrast", "#CybotCookiebotDialogBodyContentText"), "{hidden:#?}");
    let consent = evidence.consent.as_ref().expect("consent report");
    assert_eq!(consent.hidden, vec!["Cookiebot"]);
    assert_eq!(
        consent.matched,
        vec![(
            "Cookiebot".to_string(),
            vec!["#CybotCookiebotDialog".to_string(), "#CybotCookiebotDialogBodyUnderlay".to_string()]
        )]
    );
    assert_eq!(consent.unlocked, vec!["body style overflow"]);
    // The validity probe ran before the dialog arrived.
    assert!(evidence.probe.as_ref().unwrap().consent.is_empty());
    // The capture every pass read has the dialog hidden, and the evidence
    // path leaves the findings untagged so they replay equal.
    assert!(evidence.scan_snapshot.as_deref().unwrap().contains("impeccable-consent-hide"));
    assert!(findings.iter().all(|f| f.extras.get("consentHidden").is_none()));

    let shown = flagged(&kept);
    assert!(!has(&shown, "low-contrast", "#covered-copy"), "{shown:#?}");
    assert!(has(&shown, "low-contrast", "#CybotCookiebotDialogBodyContentText"), "{shown:#?}");
    assert!(kept_evidence.consent.is_none());
}

#[test]
fn a_cookie_notice_the_site_wrote_itself_is_hidden() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/site-notice.html");
    let scan = engine.detect_url_scan(&url, &ScanOptions::default()).expect("scan");
    let shown = flagged(&scan.findings);
    assert!(has(&shown, "low-contrast", "#covered-copy"), "{shown:#?}");
    assert!(!has(&shown, "low-contrast", "#notice-text"), "{shown:#?}");
    for f in &scan.findings {
        assert_eq!(f.extras.get("consentHidden"), Some(&serde_json::json!(["cookie notice"])), "{f:?}");
    }
    let mut browser = engine.launch().expect("launch");
    let (_, evidence) =
        detect_url_evidence(&mut browser, &url, &ScanOptions::default(), "load", 100, &EvidenceRequest::default())
            .expect("scan");
    let (kept, _) = detect_url_evidence(&mut browser, &url, &KEEP, "load", 100, &EvidenceRequest::default()).expect("scan");
    browser.close();
    let consent = evidence.consent.as_ref().expect("consent report");
    assert_eq!(consent.hidden, vec!["cookie notice"]);
    assert_eq!(consent.matched, vec![("cookie notice".to_string(), vec!["div#cookieBanner".to_string()])]);
    // Kept (--no-consent-hiding), the bar stays and its own text is scored.
    assert!(has(&flagged(&kept), "low-contrast", "#notice-text"), "{kept:#?}");
}

/// The same notice with its sentence in a `display: contents` span, which
/// has no box of its own: the text still renders, so it is still a notice.
#[test]
fn a_site_notice_whose_text_has_no_box_of_its_own_is_hidden() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/site-notice-contents.html");
    let mut browser = engine.launch().expect("launch");
    let (findings, evidence) =
        detect_url_evidence(&mut browser, &url, &ScanOptions::default(), "load", 100, &EvidenceRequest::default())
            .expect("scan");
    browser.close();
    assert!(has(&flagged(&findings), "low-contrast", "#covered-copy"), "{findings:#?}");
    let consent = evidence.consent.as_ref().expect("consent report");
    assert_eq!(consent.hidden, vec!["cookie notice"]);
}

/// The site's own notices that are not cookie notices, and one over a page
/// too short to be more than its notice, stay on the page.
#[test]
fn dialogs_that_are_not_cookie_notices_stay() {
    let Some(engine) = engine() else { return };
    let port = serve();
    for (page, own) in [
        ("site-notice-short.html", "#notice-text"),
        ("site-newsletter.html", "#modal-text"),
        ("site-login.html", "#modal-text"),
        ("site-policy-link.html", "#modal-text"),
    ] {
        let url = format!("http://127.0.0.1:{port}/{page}");
        let scan = engine.detect_url_scan(&url, &ScanOptions::default()).expect("scan");
        let shown = flagged(&scan.findings);
        assert!(has(&shown, "low-contrast", own), "{page}: {shown:#?}");
        assert!(scan.findings.iter().all(|f| f.extras.get("consentHidden").is_none()), "{page}");
        assert!(scan.notes.is_empty(), "{page}: {:?}", scan.notes);
    }
}

#[test]
fn a_cookie_lock_its_empty_layer_and_the_blur_go() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/site-lock-blur.html");
    let mut browser = engine.launch().expect("launch");
    let (findings, evidence) =
        detect_url_evidence(&mut browser, &url, &ScanOptions::default(), "load", 100, &EvidenceRequest::default())
            .expect("scan");
    browser.close();
    let shown = flagged(&findings);
    assert!(has(&shown, "low-contrast", "#covered-copy"), "{shown:#?}");
    assert!(!has(&shown, "low-contrast", "#notice-text"), "{shown:#?}");
    let consent = evidence.consent.as_ref().expect("consent report");
    assert_eq!(consent.matched, vec![("cookie notice".to_string(), vec!["div#block".to_string()])]);
    assert_eq!(consent.unlocked, vec!["filter div#page"]);
    let snap = evidence.scan_snapshot.as_deref().unwrap();
    assert!(snap.contains("lock div#block"), "the empty lock layer is marked hidden");
}

#[test]
fn a_tarteaucitron_banner_is_hidden() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/tarteaucitron.html");
    let scan = engine.detect_url_scan(&url, &ScanOptions::default()).expect("scan");
    let shown = flagged(&scan.findings);
    assert!(has(&shown, "low-contrast", "#covered-copy"), "{shown:#?}");
    assert!(!has(&shown, "low-contrast", "#tarteaucitronDisclaimerAlert"), "{shown:#?}");
    for f in &scan.findings {
        assert_eq!(f.extras.get("consentHidden"), Some(&serde_json::json!(["Tarteaucitron"])), "{f:?}");
    }
}

#[test]
fn a_page_that_is_only_a_consent_wall_is_refused() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/wall.html");
    let err = engine.detect_url(&url, &ScanOptions::default()).expect_err("a consent wall must not scan");
    assert!(err.message.starts_with("the page is a consent wall, not the site (consent manager OneTrust, "), "{}", err.message);
    // With the banners kept, the gate is off and the dialog is what is read.
    engine.detect_url(&url, &KEEP).expect("a kept consent wall scans");
    let mut browser = engine.launch().expect("launch");
    let (findings, evidence) =
        detect_url_evidence(&mut browser, &url, &ScanOptions::default(), "load", 100, &EvidenceRequest::default())
            .expect("evidence scan of a consent wall is Ok");
    browser.close();
    assert!(findings.is_empty());
    assert_eq!(evidence.validity.as_ref().unwrap().to_value()["status"], "consent-wall");
    assert_eq!(evidence.probe.as_ref().unwrap().consent, vec!["OneTrust"]);
    assert!(evidence.consent.is_none());
}

#[test]
fn a_short_page_under_a_banner_is_scanned_not_refused() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/short-page.html");
    let scan = engine.detect_url_scan(&url, &ScanOptions::default()).expect("a sign-in page is a page");
    let found = flagged(&scan.findings);
    assert!(has(&found, "low-contrast", "#hint"), "{found:#?}");
    assert!(!has(&found, "low-contrast", "#onetrust-policy-text"), "{found:#?}");
    let kept = engine.detect_url_scan(&url, &KEEP).expect("kept, it scans too");
    let found = flagged(&kept.findings);
    assert!(has(&found, "low-contrast", "#onetrust-policy-text"), "{found:#?}");
}

#[test]
fn an_app_shells_own_body_lock_stays() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/app-shell.html");
    let mut browser = engine.launch().expect("launch");
    let (_, evidence) =
        detect_url_evidence(&mut browser, &url, &ScanOptions::default(), "load", 100, &EvidenceRequest::default())
            .expect("scan");
    browser.close();
    let consent = evidence.consent.as_ref().expect("consent report");
    assert_eq!(consent.hidden, vec!["OneTrust"]);
    // The backdrop was showing, so only the app-shell check kept the lock.
    assert!(consent.matched[0].1.iter().any(|s| s == ".onetrust-pc-dark-filter"), "{:?}", consent.matched);
    assert!(consent.unlocked.is_empty(), "{:?}", consent.unlocked);
    let snapshot = evidence.scan_snapshot.as_deref().unwrap();
    assert!(snapshot.contains("overflow: hidden"), "the body keeps its own lock");
}

#[test]
fn a_consentmanager_box_in_a_shadow_root_is_hidden() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/consentmanager.html");
    let scan = engine.detect_url_scan(&url, &ScanOptions::default()).expect("scan");
    let found = flagged(&scan.findings);
    assert!(has(&found, "low-contrast", "#covered-copy"), "{found:#?}");
    assert!(has(&found, "low-contrast", "#covered-cta"), "{found:#?}");
    for f in &scan.findings {
        assert_eq!(f.extras.get("consentHidden"), Some(&serde_json::json!(["consentmanager"])), "{f:?}");
    }
    let kept = engine.detect_url_scan(&url, &KEEP).expect("scan");
    assert!(kept.findings.iter().all(|f| f.extras.get("consentHidden").is_none()));
    assert!(kept.notes.is_empty());
}

#[test]
fn borlabs_leaves_no_scroll_lock_and_no_aria_hidden_behind() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/borlabs.html");
    let mut browser = engine.launch().expect("launch");
    let (_, evidence) =
        detect_url_evidence(&mut browser, &url, &ScanOptions::default(), "load", 100, &EvidenceRequest::default())
            .expect("scan");
    browser.close();
    let consent = evidence.consent.as_ref().expect("consent report");
    assert_eq!(consent.hidden, vec!["Borlabs Cookie"]);
    assert_eq!(
        consent.matched[0].1,
        vec!["#BorlabsCookieBox", "#BorlabsCookieWidget", "#BorlabsDialogBackdrop"],
        "{:?}",
        consent.matched
    );
    assert_eq!(
        consent.unlocked,
        vec!["aria-hidden [data-borlabs-cookie-aria-hidden]", "body style overflow"]
    );
    let snapshot = evidence.scan_snapshot.as_deref().unwrap();
    // The wrapper Borlabs marked is back in the page; the site's own
    // aria-hidden icon keeps its attribute.
    assert!(!snapshot.contains(r#"["aria-hidden","true"],["data-borlabs-cookie-aria-hidden""#), "wrapper unhidden");
    assert!(snapshot.contains(r#"["id","site-icon"],["aria-hidden","true"]"#), "site icon keeps aria-hidden");
}

#[test]
fn a_wall_that_arrives_after_load_is_refused() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/late-wall.html");
    let err = engine.detect_url(&url, &ScanOptions::default()).expect_err("a late consent wall must not scan");
    assert!(err.message.starts_with("the page is a consent wall, not the site (consent manager OneTrust, "), "{}", err.message);
    let mut browser = engine.launch().expect("launch");
    let (findings, evidence) =
        detect_url_evidence(&mut browser, &url, &ScanOptions::default(), "load", 100, &EvidenceRequest::default())
            .expect("evidence scan of a consent wall is Ok");
    browser.close();
    assert!(findings.is_empty());
    assert_eq!(evidence.validity.as_ref().unwrap().to_value()["status"], "consent-wall");
}

#[test]
fn a_wall_rendered_in_a_shadow_root_is_refused() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/shadow-wall.html");
    let err = engine.detect_url(&url, &ScanOptions::default()).expect_err("a shadow-root consent wall must not scan");
    assert!(err.message.starts_with("the page is a consent wall, not the site (consent manager Usercentrics, "), "{}", err.message);
}

#[test]
fn a_wall_under_a_contents_wrapper_in_a_shadow_root_is_refused() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/shadow-contents-wall.html");
    let err = engine
        .detect_url(&url, &ScanOptions::default())
        .expect_err("a consent wall under a display: contents wrapper must not scan");
    assert!(err.message.starts_with("the page is a consent wall, not the site (consent manager Usercentrics, "), "{}", err.message);
}

#[test]
fn a_lock_the_sites_own_modal_holds_stays() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/site-modal.html");
    let mut browser = engine.launch().expect("launch");
    let (_, evidence) =
        detect_url_evidence(&mut browser, &url, &ScanOptions::default(), "load", 100, &EvidenceRequest::default())
            .expect("scan");
    browser.close();
    let consent = evidence.consent.as_ref().expect("consent report");
    assert_eq!(consent.hidden, vec!["Cookiebot"]);
    assert!(consent.unlocked.is_empty(), "{:?}", consent.unlocked);
}

#[test]
fn a_wall_that_fills_an_empty_root_after_load_is_refused() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/late-stub-wall.html");
    let err = engine.detect_url(&url, &ScanOptions::default()).expect_err("a late consent wall must not scan");
    assert!(err.message.starts_with("the page is a consent wall, not the site (consent manager Usercentrics, "), "{}", err.message);
}

#[test]
fn a_wall_on_a_root_the_first_pass_hid_inline_is_refused() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/late-inline-wall.html");
    let err = engine.detect_url(&url, &ScanOptions::default()).expect_err("a late consent wall must not scan");
    assert!(err.message.starts_with("the page is a consent wall, not the site (consent manager Usercentrics, "), "{}", err.message);
}

#[test]
fn a_wall_drawn_in_a_frame_is_refused() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/frame-wall.html");
    let err = engine.detect_url(&url, &ScanOptions::default()).expect_err("a framed consent wall must not scan");
    assert!(err.message.starts_with("the page is a consent wall, not the site (consent manager Sourcepoint, "), "{}", err.message);
}

#[test]
fn a_short_page_under_a_shadow_root_banner_is_scanned() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/shadow-short-page.html");
    let scan = engine.detect_url_scan(&url, &ScanOptions::default()).expect("a short page is a page");
    for f in &scan.findings {
        assert_eq!(f.extras.get("consentHidden"), Some(&serde_json::json!(["Usercentrics"])), "{f:?}");
    }
}

#[test]
fn a_short_page_under_a_banner_outside_body_is_scanned() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/html-root-banner.html");
    engine.detect_url_scan(&url, &ScanOptions::default()).expect("a short page is a page");
}

#[test]
fn a_late_banner_that_closed_itself_is_not_a_wall() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/late-closed-banner.html");
    engine.detect_url_scan(&url, &ScanOptions::default()).expect("a closed banner leaves the page");
}

#[test]
fn a_late_banner_on_a_root_hidden_inline_is_reported() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/late-inline-banner.html");
    let mut browser = engine.launch().expect("launch");
    let (_, evidence) =
        detect_url_evidence(&mut browser, &url, &ScanOptions::default(), "load", 100, &EvidenceRequest::default())
            .expect("scan");
    browser.close();
    assert_eq!(evidence.consent.as_ref().expect("consent report").hidden, vec!["Usercentrics"]);
}

#[test]
fn a_root_matched_by_two_selectors_is_counted_once() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/quantcast-short-page.html");
    engine.detect_url_scan(&url, &ScanOptions::default()).expect("a short page is a page");
}

#[test]
fn a_web_component_page_under_a_banner_is_scanned() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/shadow-app-page.html");
    engine
        .detect_url_scan(&url, &ScanOptions::default())
        .expect("text in the page's own shadow root is the page");
}

#[test]
fn a_wall_under_a_visibility_hidden_root_is_refused() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/hidden-host-wall.html");
    let err = engine.detect_url(&url, &ScanOptions::default()).expect_err("a visible dialog under a hidden root is a wall");
    assert!(err.message.starts_with("the page is a consent wall, not the site (consent manager OneTrust, "), "{}", err.message);
}

#[test]
fn a_web_component_form_under_a_banner_is_scanned() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/shadow-form-page.html");
    engine
        .detect_url_scan(&url, &ScanOptions::default())
        .expect("a form in the page's own shadow root is the page");
}

#[test]
fn a_frame_in_the_managers_shadow_root_is_a_wall() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/shadow-frame-wall.html");
    let err = engine.detect_url(&url, &ScanOptions::default()).expect_err("a framed consent wall must not scan");
    assert!(err.message.starts_with("the page is a consent wall, not the site (consent manager Sourcepoint, "), "{}", err.message);
}

#[test]
fn a_form_in_a_nested_web_component_under_a_banner_is_scanned() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/shadow-nested-form-page.html");
    engine
        .detect_url_scan(&url, &ScanOptions::default())
        .expect("a form two shadow roots down is the page");
}

#[test]
fn a_late_banner_closed_with_the_stamped_value_is_not_a_wall() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/late-closed-attr-banner.html");
    engine
        .detect_url_scan(&url, &ScanOptions::default())
        .expect("a banner its manager closed with display: none !important leaves the page");
}

#[test]
fn closed_dialogs_parked_offscreen_or_clipped_are_not_showing() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/parked-banner-page.html");
    let mut browser = engine.launch().expect("launch");
    let (_, evidence) =
        detect_url_evidence(&mut browser, &url, &ScanOptions::default(), "load", 100, &EvidenceRequest::default())
            .expect("a page whose consent dialogs are parked away is not a wall");
    browser.close();
    assert_eq!(evidence.validity.as_ref().unwrap().to_value()["status"], "ok");
    assert!(evidence.consent.as_ref().expect("consent report").hidden.is_empty());
}

#[test]
fn a_banner_the_scroll_probe_brings_in_is_hidden() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/after-scroll-probe-banner.html");
    let scan = engine.detect_url_scan(&url, &ScanOptions::default()).expect("scan");
    assert!(
        scan.notes.iter().any(|n| n.starts_with("Hid the OneTrust consent banner")),
        "{:?}",
        scan.notes
    );
}

#[test]
fn a_fixed_banner_a_transformed_ancestor_holds_is_showing() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/held-fixed-banner.html");
    let mut browser = engine.launch().expect("launch");
    let (_, evidence) =
        detect_url_evidence(&mut browser, &url, &ScanOptions::default(), "load", 100, &EvidenceRequest::default())
            .expect("scan");
    browser.close();
    assert_eq!(evidence.consent.as_ref().expect("consent report").hidden, vec!["OneTrust"]);
}

/// Tealium's prompt (telekom.de) and Transcend's banner in a shadow root on a
/// zero-size host (verizon.com) are hidden by their vendors' own ids.
#[test]
fn tealium_and_transcend_banners_are_hidden() {
    let Some(engine) = engine() else { return };
    let port = serve();
    for (page, name) in [("tealium.html", "Tealium"), ("transcend.html", "Transcend")] {
        let url = format!("http://127.0.0.1:{port}/{page}");
        let scan = engine.detect_url_scan(&url, &ScanOptions::default()).expect("scan");
        let found = flagged(&scan.findings);
        assert!(has(&found, "low-contrast", "#covered-copy"), "{page}: {found:#?}");
        assert!(has(&found, "low-contrast", "#covered-cta"), "{page}: {found:#?}");
        for f in &scan.findings {
            assert_eq!(f.extras.get("consentHidden"), Some(&serde_json::json!([name])), "{page}: {f:?}");
        }
        assert!(!has(&found, "low-contrast", "#utiqMessage"), "{page}: {found:#?}");
        let kept = engine.detect_url_scan(&url, &KEEP).expect("scan");
        assert!(kept.findings.iter().all(|f| f.extras.get("consentHidden").is_none()));
        assert!(kept.notes.is_empty());
        if page == "tealium.html" {
            // Kept, the prompt's own faint text is scored as the page's.
            assert!(has(&flagged(&kept.findings), "low-contrast", "#utiqMessage"), "{:#?}", kept.findings);
        }
    }
}

/// The review's probes (work/round12/harness-review.md): page parts that
/// mention cookies, or sit beside a real cookie bar, stay as they are.
#[test]
fn page_parts_that_look_like_a_notice_stay() {
    let Some(engine) = engine() else { return };
    let port = serve();
    for page in ["stay-announce.html", "stay-header.html", "stay-cart.html", "stay-gdpr-modal.html", "stay-hidden-policy.html"] {
        let url = format!("http://127.0.0.1:{port}/{page}");
        let scan = engine.detect_url_scan(&url, &ScanOptions::default()).expect("scan");
        assert!(has(&flagged(&scan.findings), "low-contrast", "#own"), "{page}: {:#?}", flagged(&scan.findings));
        assert!(scan.findings.iter().all(|f| f.extras.get("consentHidden").is_none()), "{page}");
    }
}

#[test]
fn a_notice_inside_a_header_or_a_stack_goes_alone() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let mut browser = engine.launch().expect("launch");
    for (page, notice) in [("header-strip.html", "div.cookie-strip"), ("bottom-stack.html", "div.cookies")] {
        let url = format!("http://127.0.0.1:{port}/{page}");
        let (findings, evidence) =
            detect_url_evidence(&mut browser, &url, &ScanOptions::default(), "load", 100, &EvidenceRequest::default())
                .expect("scan");
        assert!(has(&flagged(&findings), "low-contrast", "#own"), "{page}: {:#?}", flagged(&findings));
        let consent = evidence.consent.as_ref().expect("consent report");
        assert_eq!(consent.matched, vec![("cookie notice".to_string(), vec![notice.to_string()])], "{page}");
    }
    browser.close();
}

#[test]
fn backgrounds_and_blurs_beside_a_cookie_bar_stay() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let mut browser = engine.launch().expect("launch");
    for page in [
        "stay-bg-layer.html",
        "stay-bg-image.html",
        "stay-bg-canvas.html",
        "stay-blur-deco.html",
        "stay-blur-deco-absolute.html",
        "stay-blur-paywall.html",
    ] {
        let url = format!("http://127.0.0.1:{port}/{page}");
        let (findings, evidence) =
            detect_url_evidence(&mut browser, &url, &ScanOptions::default(), "load", 100, &EvidenceRequest::default())
                .expect("scan");
        let consent = evidence.consent.as_ref().expect("consent report");
        assert_eq!(consent.matched, vec![("cookie notice".to_string(), vec!["div.cookie-bar".to_string()])], "{page}");
        assert!(consent.unlocked.is_empty(), "{page}: {:?}", consent.unlocked);
        assert!(!evidence.scan_snapshot.as_deref().unwrap().contains("lock div.cookie-bar"), "{page}");
        // The light title on the dark image is not read against white (the
        // review's probe: hiding the background made it 1.1:1).
        if page == "stay-bg-image.html" {
            assert!(!has(&flagged(&findings), "low-contrast", "#night-title"), "{page}: {:#?}", flagged(&findings));
        }
    }
    browser.close();
}
