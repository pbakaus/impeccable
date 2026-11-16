//! Origin and vendor decisions in the URL engine, over
//! `tests/fixtures/antipatterns/`, rendered by an installed browser. Skips
//! cleanly when there is none.
//!
//! - `ai-color-palette-brand-hue.html` / `-headings-only.html`: a purple
//!   heading in the hue of the page's nav bar is the brand colour and does not
//!   report; the same headings on a page with no brand surface in that hue
//!   do; a gradient reports on both (r3-23-ai-color-palette-brand-hue).
//! - `script-error-ad-tech.html`: an error an ad-tech script threw, or the
//!   removed Topics API rejected, names the vendor and reports as advisory;
//!   the site's own error stays an error, even after three ad-tech errors,
//!   because the two are capped separately (r3-31-script-error-ad-tech).
//! - `third-party-widgets.html`: findings on Taboola's cards and on Swiper's
//!   slide elements name the vendor and keep their severity; the site's own
//!   markup, inside a slide or not, is not tagged
//!   (r4-p24-third-party-widget-markup).
//! - `flat-type-hierarchy-weight.html` / `-weight-flat.html`: a flat ramp
//!   whose headings are set two weight steps heavier than the body reports as
//!   advisory; one step heavier stays a warning
//!   (r4-p23-flat-type-hierarchy-commerce).
//! - `ai-color-palette-category-colours.html`: a violet, purple or cyan that
//!   is one of six or more hues its role carries is a category colour and
//!   does not report; a lone one does, and so do six tiles of which five sit
//!   inside the violet and cyan bands (r5-p28-ai-color-palette-category-colours).
//! - `ai-color-palette.html`: the cyan band is hue 170 to 197 with a
//!   saturation floor; a teal-to-cyan ramp and a cyan-950 panel report,
//!   emerald, sky and a grayed teal do not (r6-t7-cyan-band).
//! - `skipped-heading-footer.html`: a skip into the footer does not report; a
//!   skip in the content and one between two later footer headings do
//!   (r5-p29-skipped-heading-footer-titles).
//! - A page scanned with a DESIGN.md that declares a purple reports
//!   none of ai-color-palette's purple forms.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::rc::Rc;

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

fn selector(f: &Finding) -> &str {
    f.extras.get("selector").and_then(|s| s.as_str()).unwrap_or("")
}

fn third_party(f: &Finding) -> Option<&str> {
    f.extras.get("thirdParty").and_then(|s| s.as_str())
}

#[test]
fn purple_headings_in_the_brand_hue_do_not_report() {
    let Some(engine) = engine() else { return };
    let port = serve();

    let brand = scan(&engine, port, "ai-color-palette-brand-hue.html");
    let palette: Vec<&str> = of(&brand, "ai-color-palette").iter().map(|f| f.snippet.as_str()).collect();
    assert_eq!(palette, vec!["Purple/violet gradient background"], "{palette:?}");

    let headings_only = scan(&engine, port, "ai-color-palette-brand-hue-headings-only.html");
    let mut palette: Vec<&str> = of(&headings_only, "ai-color-palette").iter().map(|f| f.snippet.as_str()).collect();
    palette.sort();
    assert_eq!(
        palette,
        vec![
            "Purple/violet gradient background",
            "Purple/violet text (#5c2d91) on heading",
            "Purple/violet text (#6a35a6) on heading",
        ]
    );
}

#[test]
fn cyan_band_skips_emerald_sky_and_grayed_teal() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let findings = scan(&engine, port, "ai-color-palette.html");
    let palette: Vec<(&str, &str)> = of(&findings, "ai-color-palette")
        .iter()
        .map(|f| (f.snippet.as_str(), selector(f)))
        .collect();
    for flag in ["teal-cta", "cyan-950-panel", "teal-half-fade-cta"] {
        assert!(palette.iter().any(|(_, sel)| sel.contains(flag)), "{flag}: {palette:#?}");
    }
    for pass in ["emerald-cta", "sky-cta", "grayed-teal-cta", "flat-fade-teal-cta"] {
        assert!(!palette.iter().any(|(_, sel)| sel.contains(pass)), "{pass}: {palette:#?}");
    }
}

#[test]
fn category_colours_do_not_report() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let findings = scan(&engine, port, "ai-color-palette-category-colours.html");
    let mut palette: Vec<(&str, &str)> = of(&findings, "ai-color-palette")
        .iter()
        .map(|f| (f.snippet.as_str(), selector(f)))
        .collect();
    palette.sort();
    let snippets: Vec<&str> = palette.iter().map(|(s, _)| *s).collect();
    assert_eq!(
        snippets,
        vec![
            // The cyan and teal swatches. The sky swatch (hue 199 to 200) is
            // outside the cyan band (r6-t7-cyan-band).
            "Cyan gradient background",
            "Cyan gradient background",
            // The page-level stylesheet form is not about one element and
            // keeps reporting.
            "Purple/violet accent colors detected",
            "Purple/violet gradient background",
            "Purple/violet gradient background",
            "Purple/violet gradient background",
            "Purple/violet gradient background",
            "Purple/violet text (#7c3aed) on heading",
        ],
        "{palette:#?}"
    );
    // Nothing in the category headings or the category tiles reports.
    assert!(
        !palette.iter().any(|(_, sel)| sel.contains("section-title") || sel.contains("div.tile")),
        "{palette:#?}"
    );
}

#[test]
fn a_skip_into_the_footer_does_not_report() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let findings = scan(&engine, port, "skipped-heading-footer.html");
    let skips: Vec<&str> = of(&findings, "skipped-heading").iter().map(|f| f.snippet.as_str()).collect();
    assert_eq!(
        skips,
        vec![
            "<h2> \"Should flag\" followed by <h4> \"Jet fuel grades\" (missing h3)",
            "<h4> \"Company\" followed by <h6> \"Legal small print\" (missing h5)",
        ]
    );
}

#[test]
fn ad_tech_script_errors_are_advisory_and_name_the_vendor() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let findings = scan(&engine, port, "script-error-ad-tech.html");
    let errors = of(&findings, "script-error");
    // Three ad-tech errors arrive ahead of the site's own; a fourth, after
    // it, is past the ad-tech cap. The counted error still reports.
    assert_eq!(errors.len(), 4, "{errors:#?}");
    assert!(!errors.iter().any(|f| f.snippet.contains("slot render failed")), "{errors:#?}");
    let prebid = errors.iter().find(|f| f.snippet.contains("bidder timeout")).expect("Prebid error");
    assert_eq!(prebid.severity, "advisory");
    assert_eq!(third_party(prebid), Some("Prebid"));

    let own = errors.iter().find(|f| f.snippet.contains("cart is undefined")).expect("own error");
    assert_eq!(own.severity, "error");
    assert_eq!(third_party(own), None);
    assert!(!own.snippet.contains("third-party"), "{}", own.snippet);

    let anymind = errors.iter().find(|f| f.snippet.contains("anymind360.com")).expect("AnyMind error");
    assert_eq!(anymind.severity, "advisory");
    assert_eq!(anymind.advisory, Some(true));
    assert_eq!(third_party(anymind), Some("AnyMind"));
    assert!(anymind.snippet.ends_with(" (third-party: AnyMind)"), "{}", anymind.snippet);

    let topics = errors.iter().find(|f| f.snippet.contains("browsingTopics")).expect("Topics rejection");
    assert_eq!(topics.severity, "advisory");
    assert_eq!(third_party(topics), Some("ad tech"));
    assert!(topics.snippet.starts_with("Uncaught (in promise) NotSupportedError: "), "{}", topics.snippet);
}

#[test]
fn widget_vendor_findings_name_the_vendor_and_keep_their_severity() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let findings = scan(&engine, port, "third-party-widgets.html");

    let text = of(&findings, "undersized-ui-text");
    assert_eq!(text.len(), 2, "{text:#?}");
    let taboola = text.iter().find(|f| selector(f).contains("trc_spotlight_item")).expect("Taboola button");
    assert_eq!(taboola.severity, "warning");
    assert_eq!(third_party(taboola), Some("Taboola"));
    assert_eq!(
        taboola.snippet,
        "10px functional text \"Learn More\" (below 11px floor) (third-party: Taboola)"
    );
    let own = text.iter().find(|f| selector(f).contains("div.card")).expect("site button");
    assert_eq!(third_party(own), None);
    assert_eq!(own.snippet, "10px functional text \"Learn More\" (below 11px floor)");

    let easings = of(&findings, "bounce-easing");
    let slide = easings.iter().find(|f| selector(f).contains("swiper-slide")).expect("Swiper slide");
    assert_eq!(third_party(slide), Some("Swiper"));
    assert_eq!(slide.snippet, "cubic-bezier(0.34, 1.56, 0.64, 1) (third-party: Swiper)");
    assert_eq!(slide.severity, "advisory", "bounce-easing is advisory already");
    let copy = easings.iter().find(|f| selector(f).contains("slide-copy")).expect("site copy in a slide");
    assert_eq!(third_party(copy), None);
}

#[test]
fn a_flat_ramp_separated_by_weight_is_advisory() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let bold = scan(&engine, port, "flat-type-hierarchy-weight.html");
    let flat = of(&bold, "flat-type-hierarchy");
    assert_eq!(flat.len(), 1, "{flat:#?}");
    assert_eq!(flat[0].severity, "advisory");
    assert!(flat[0].snippet.ends_with("; weight separates headings from body text)"), "{}", flat[0].snippet);

    let medium = scan(&engine, port, "flat-type-hierarchy-weight-flat.html");
    let flat = of(&medium, "flat-type-hierarchy");
    assert_eq!(flat.len(), 1, "{flat:#?}");
    assert_eq!(flat[0].severity, "warning");
    assert!(!flat[0].snippet.contains("weight separates"), "{}", flat[0].snippet);
}

#[test]
fn a_design_md_purple_switches_the_purple_forms_off() {
    let Some(engine) = engine() else { return };
    // Served over HTTP like the other cases: a `file://` URL built from a
    // canonicalized Windows path (`\\?\C:\...`) is not a URL Chrome navigates to.
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/ai-color-palette-brand-hue-headings-only.html");
    let scan_with = |primary: &str| {
        let fm: serde_json::Map<String, serde_json::Value> = serde_json::from_value(serde_json::json!({
            "colors": { "primary": primary }
        }))
        .unwrap();
        let ds = impeccable_detect::design_system::normalize_design_system(Some(&fm), None, Some("DESIGN.md"), None, false);
        let options = ScanOptions {
            design_system: Some(Rc::new(ds)),
            ..ScanOptions::default()
        };
        let findings = engine.detect_url(&url, &options).expect("scan");
        let mut palette: Vec<String> = findings
            .iter()
            .filter(|f| f.antipattern == "ai-color-palette")
            .map(|f| f.snippet.clone())
            .collect();
        palette.sort();
        palette
    };
    assert!(scan_with("#5c2d91").is_empty());
    assert_eq!(scan_with("#1a4d8f").len(), 3);
}
