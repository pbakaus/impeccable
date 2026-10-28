//! Round 7's recall fixes and gates in the URL engine, over
//! `tests/fixtures/antipatterns/` and `tests/fixtures/validity/`, rendered by
//! an installed browser. Skips cleanly when there is none.
//!
//! - `prose-div.html`: prose a CMS writes straight into a div is measured by
//!   line-length and body-text-viewport-edge; a flex row, preformatted text
//!   and a link's label are not.
//! - `label-collectors.html`: a chip's text span sets its type beside an
//!   icon, the hero eyebrow's tracking floor is 0.08em, and an article taller
//!   than two viewports is not a card.
//! - `eyebrow-hand-off.html`: a dated meta line is not a hero eyebrow under
//!   the fixed tracking floor, and a small-caps kicker the hero rule does not
//!   read stays a kicker.
//! - `icon-tile-card-title.html`: a bold div title anchors the tile rule.
//! - `small-text-labels.html`: tiny-text and wide-tracking leave typed-caps
//!   labels, terminal commands and link labels alone; a 9px line is scored
//!   for contrast.
//! - `paint-that-shows.html`: ai-color-palette, gradient-text,
//!   gpt-thin-border-wide-shadow and dark-glow measure what paints.
//! - `script-error-benign-races.html`: Vector's pixel and an interrupted
//!   `play()` report as advisory; an aborted fetch stays an error.
//! - `third-party-widgets-carousels.html`, `script-error-ad-tech-hosts.html`:
//!   run 28's vendors are named.
//! - `validity/press-and-hold.html`: a bot manager's challenge sheet over a
//!   rendered page is refused as a challenge.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};

use impeccable_browser::BrowserEngine;
use impeccable_core::findings::Finding;
use impeccable_detect::engines::{ScanOptions, UrlEngine};

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures")
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
    let url = format!("http://127.0.0.1:{port}/antipatterns/{fixture}");
    engine.detect_url(&url, &ScanOptions::default()).expect("scan")
}

fn selector(f: &Finding) -> &str {
    f.extras.get("selector").and_then(|s| s.as_str()).unwrap_or("")
}

fn third_party(f: &Finding) -> Option<&str> {
    f.extras.get("thirdParty").and_then(|s| s.as_str())
}

/// The findings of `rule` whose selector names `id`.
fn on<'a>(findings: &'a [Finding], rule: &str, id: &str) -> Vec<&'a Finding> {
    findings
        .iter()
        .filter(|f| f.antipattern == rule && selector(f).contains(id))
        .collect()
}

fn of<'a>(findings: &'a [Finding], rule: &str) -> Vec<&'a Finding> {
    findings.iter().filter(|f| f.antipattern == rule).collect()
}

#[test]
fn prose_written_into_a_div_is_measured() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let f = scan(&engine, port, "prose-div.html");
    let line = on(&f, "line-length", "#flag-cms-body");
    assert_eq!(line.len(), 1, "{f:#?}");
    let edge = on(&f, "body-text-viewport-edge", "#flag-cms-body");
    assert_eq!(edge.len(), 1, "{f:#?}");
    assert!(edge[0].snippet.starts_with("<div> with "), "{}", edge[0].snippet);
    for id in ["#pass-flex-row", "#pass-code-block", "#pass-link-body"] {
        assert!(on(&f, "line-length", id).is_empty(), "{id}: {f:#?}");
        assert!(on(&f, "body-text-viewport-edge", id).is_empty(), "{id}: {f:#?}");
    }
}

#[test]
fn label_collectors_read_the_text_that_sets_the_label() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let f = scan(&engine, port, "label-collectors.html");
    let hero: Vec<&str> = of(&f, "hero-eyebrow-chip").iter().map(|h| h.snippet.as_str()).collect();
    assert!(
        hero.iter().any(|s| s.contains("\"U.S.-Based Independent Broker\"")),
        "chip beside an icon: {hero:?}"
    );
    assert!(
        hero.iter().any(|s| s.contains("\"Utah-based commercial insurance agency\"")),
        "tracking-widest chip: {hero:?}"
    );
    assert!(!hero.iter().any(|s| s.contains("Plainly set")), "{hero:?}");
    assert!(!hero.iter().any(|s| s.contains("North")), "{hero:?}");
    let kickers: Vec<&str> = of(&f, "kicker-above-heading").iter().map(|h| h.snippet.as_str()).collect();
    assert!(kickers.iter().any(|s| s.contains("\"On the roadmap\"")), "{kickers:?}");
    // The hero rule took the tracked chips; the kicker rule does not repeat them.
    assert!(!kickers.iter().any(|s| s.contains("Broker") || s.contains("Utah")), "{kickers:?}");
    let numbered: Vec<&str> = of(&f, "numbered-section-labels").iter().map(|h| h.snippet.as_str()).collect();
    assert!(numbered.iter().any(|s| s.contains("\"Say who you want\"")), "{numbered:?}");
    assert!(!numbered.iter().any(|s| s.contains("numbered card") || s.contains("numbers itself")), "{numbered:?}");
}

#[test]
fn the_eyebrow_hand_off_keeps_dated_meta_and_small_caps_straight() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let f = scan(&engine, port, "eyebrow-hand-off.html");
    let hero: Vec<&str> = of(&f, "hero-eyebrow-chip").iter().map(|h| h.snippet.as_str()).collect();
    assert!(hero.iter().any(|s| s.contains("\"Now in public beta\"")), "{hero:?}");
    // A dated line and a <time> over a post's h1 are its meta, not an eyebrow.
    assert!(!hero.iter().any(|s| s.contains("September") || s.contains("Sep 2")), "{hero:?}");
    // The hero rule does not read small-caps as caps, so the kicker keeps it.
    let kickers: Vec<&str> = of(&f, "kicker-above-heading").iter().map(|h| h.snippet.as_str()).collect();
    assert!(kickers.iter().any(|s| s.contains("\"new in version four\"")), "{kickers:?}");
    assert!(!kickers.iter().any(|s| s.contains("public beta")), "{kickers:?}");
    for id in ["#pass-dated-meta", "#pass-time-meta"] {
        assert!(on(&f, "kicker-above-heading", id).is_empty(), "{id}: {f:#?}");
    }
}

#[test]
fn a_bold_div_title_anchors_an_icon_tile() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let f = scan(&engine, port, "icon-tile-card-title.html");
    let tiles: Vec<&str> = of(&f, "icon-tile-stack").iter().map(|h| h.snippet.as_str()).collect();
    assert_eq!(tiles, vec!["48x48px icon tile above div \"Global Hotkey Overlay\""], "{f:#?}");
}

#[test]
fn small_labels_are_not_body_text_and_a_short_line_is_scored() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let f = scan(&engine, port, "small-text-labels.html");
    assert_eq!(on(&f, "tiny-text", "#flag-tiny-prose").len(), 1, "{f:#?}");
    assert_eq!(on(&f, "wide-tracking", "#flag-tracked-prose").len(), 1, "{f:#?}");
    assert_eq!(on(&f, "low-contrast", "#flag-nine-pixel-line").len(), 1, "{f:#?}");
    for id in ["#pass-typed-caps-meta", "#pass-terminal-command"] {
        assert!(on(&f, "tiny-text", id).is_empty(), "{id}: {f:#?}");
    }
    for id in ["#pass-typed-caps-eyebrow", "#pass-link-label"] {
        assert!(on(&f, "wide-tracking", id).is_empty(), "{id}: {f:#?}");
    }
}

#[test]
fn colour_and_effect_tells_measure_what_paints() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let f = scan(&engine, port, "paint-that-shows.html");
    let palette = |id: &str| -> Vec<String> {
        on(&f, "ai-color-palette", id).iter().map(|h| h.snippet.clone()).collect()
    };
    assert_eq!(palette("#flag-cyan-ramp"), vec!["Cyan gradient background"], "{f:#?}");
    assert!(palette("#pass-hover-wipe").is_empty(), "{f:#?}");
    // One report per element: the computed form speaks for the class form.
    assert_eq!(palette("#flag-purple-once"), vec!["Purple/violet gradient background"], "{f:#?}");
    // A gradient clipped to the text is gradient-text's.
    assert_eq!(on(&f, "gradient-text", "#flag-clipped-violet").len(), 1, "{f:#?}");
    assert!(palette("#flag-clipped-violet").is_empty(), "{f:#?}");
    assert!(on(&f, "gradient-text", "#pass-watermark").is_empty(), "{f:#?}");
    assert!(on(&f, "gradient-text", "#pass-closed-menu").is_empty(), "{f:#?}");
    let halos = of(&f, "gpt-thin-border-wide-shadow");
    assert!(halos.iter().any(|h| selector(h).contains("#flag-paper-card")), "{halos:#?}");
    assert!(!halos.iter().any(|h| selector(h).contains("glass")), "{halos:#?}");
    assert_eq!(on(&f, "dark-glow", "#flag-neon-glow").len(), 1, "{f:#?}");
    assert!(on(&f, "dark-glow", "#pass-shadow-lg").is_empty(), "{f:#?}");
}

#[test]
fn run_28_widget_vendors_are_named() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let f = scan(&engine, port, "third-party-widgets-carousels.html");
    let tagged = |rule: &str, id: &str| -> Option<String> {
        on(&f, rule, id).first().and_then(|h| third_party(h).map(String::from))
    };
    // Slick's list and SuperSlide's tempWrap are carousel windows: the slide
    // parked past them is not a clipping fault, so there is nothing to tag.
    assert!(on(&f, "clipped-overflow-container", "#pass-slick-list").is_empty(), "{f:#?}");
    assert_eq!(tagged("low-contrast", "#flag-slick-dot").as_deref(), Some("Slick"), "{f:#?}");
    assert!(on(&f, "clipped-overflow-container", "#pass-superslide-wrap").is_empty(), "{f:#?}");
    assert_eq!(tagged("low-contrast", "#flag-marquee-quote").as_deref(), Some("react-fast-marquee"), "{f:#?}");
    assert_eq!(tagged("bounce-easing", "#flag-kaltura-area").as_deref(), Some("Kaltura"), "{f:#?}");
    let own = on(&f, "low-contrast", "#flag-own-button");
    assert_eq!(own.len(), 1, "{f:#?}");
    assert_eq!(third_party(own[0]), None);
}

#[test]
fn run_28_ad_tech_hosts_are_advisory() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let f = scan(&engine, port, "script-error-ad-tech-hosts.html");
    let errors = of(&f, "script-error");
    let vendor = |needle: &str| errors.iter().find(|e| e.snippet.contains(needle)).copied();
    for (needle, name) in [("nagich.co.il", "Nagich"), ("reportingjs", "Chase Reporting"), ("_prebidjs", "Prebid")] {
        let e = vendor(needle).unwrap_or_else(|| panic!("{needle}: {errors:#?}"));
        assert_eq!(e.severity, "advisory", "{needle}");
        assert_eq!(third_party(e), Some(name), "{needle}");
    }
    let own = vendor("offer is undefined").expect("the site's own error");
    assert_eq!(own.severity, "error");
    assert_eq!(third_party(own), None);
}

/// Round 13 row 19: Vector's visitor-identity pixel on mercury.com, and a
/// hover preview's `play()` interrupted by `pause()` on rauno.me.
#[test]
fn round_13_benign_races_are_advisory() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let f = scan(&engine, port, "script-error-benign-races.html");
    let errors = of(&f, "script-error");
    let find = |needle: &str| {
        errors
            .iter()
            .find(|e| e.snippet.contains(needle))
            .copied()
            .unwrap_or_else(|| panic!("{needle}: {errors:#?}"))
    };
    let vector = find("No visitor ID available");
    assert_eq!(vector.severity, "advisory");
    assert_eq!(third_party(vector), Some("Vector"));
    let play = find("The play() request was interrupted");
    assert_eq!(play.severity, "advisory");
    assert_eq!(third_party(play), None);
    for needle in ["The user aborted a request", "cart is undefined"] {
        let e = find(needle);
        assert_eq!(e.severity, "error", "{needle}");
        assert_eq!(third_party(e), None, "{needle}");
    }
}

#[test]
fn a_press_and_hold_sheet_over_the_page_is_a_challenge() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let options = ScanOptions::default();
    let open = format!("http://127.0.0.1:{port}/validity/press-and-hold.html");
    let err = engine.detect_url(&open, &options).expect_err("the sheet stands in front of the page");
    assert!(err.message.contains("bot challenge"), "{}", err.message);
    assert!(err.message.contains("overlay human-press-and-hold"), "{}", err.message);
    let closed = format!("http://127.0.0.1:{port}/validity/press-and-hold-closed.html");
    engine.detect_url(&closed, &options).expect("a closed sheet leaves the page");
    let faded = format!("http://127.0.0.1:{port}/validity/press-and-hold-faded.html");
    engine.detect_url(&faded, &options).expect("a sheet inside a faded wrapper leaves the page");
}
