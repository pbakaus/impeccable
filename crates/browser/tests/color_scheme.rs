//! A URL scan renders the light colour scheme whatever the host prefers
//! (#1620), against an installed browser. Skips cleanly when there is none.

#[path = "support/http.rs"]
mod http;

use std::collections::HashMap;

use impeccable_browser::{detect_url_evidence, EvidenceRequest};
use impeccable_detect::engines::ScanOptions;

const PAGE: &str = r#"<!doctype html><html><head><style>
body { color: #222; background: #fff; font: 16px/1.5 sans-serif; }
@media (prefers-color-scheme: dark) { .note { color: #d1d5c3; } }
</style></head><body>
<h1>Release notes</h1>
<p id="note" class="note">This release fixes how the scanner reads pages on a dark host.</p>
</body></html>"#;

#[test]
fn a_dark_host_scan_still_renders_the_light_scheme() {
    let env: HashMap<String, String> = std::env::vars().collect();
    let Ok(exe) = impeccable_browser::discovery::find_browser(&env) else {
        eprintln!("skip: no installed browser found");
        return;
    };
    let mut browser = match impeccable_browser::cdp::Browser::launch(&exe, &["--force-dark-mode".to_string()], false) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("skip: could not launch browser: {}", e.message);
            return;
        }
    };
    let mut probe = browser.new_page().expect("new page");
    let dark = probe.evaluate_value("matchMedia('(prefers-color-scheme: dark)').matches").expect("probe");
    probe.close();
    if dark.as_bool() != Some(true) {
        eprintln!("skip: --force-dark-mode did not make this browser prefer dark");
        browser.close();
        return;
    }
    let origin = http::serve(|p| (p == "/").then(|| ("text/html; charset=utf-8", PAGE.as_bytes().to_vec())));
    let (findings, _) =
        detect_url_evidence(&mut browser, &format!("{origin}/"), &ScanOptions::default(), "load", 100, &EvidenceRequest::default())
            .expect("scan");
    browser.close();
    assert!(findings.iter().all(|f| f.antipattern != "low-contrast"), "{findings:#?}");
}
