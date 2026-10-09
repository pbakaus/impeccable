//! impeccable-browser: the URL engine of `impeccable detect`, ported from
//! `cli/engine/engines/browser/detect-url.mjs` (+ `engines/visual/
//! screenshot-contrast.mjs`). Instead of puppeteer it discovers an installed
//! Chromium-based browser ([`discovery`]), drives it over CDP ([`cdp`]) with
//! puppeteer's launch flags and page setup, and — since triage D2 — injects
//! only the plain-JS snapshot producer, runs the rule core natively over
//! [`impeccable_core::browser::snapshot::SnapshotDom`] ([`snapshot_engine`]),
//! and maps the findings into [`Finding`]s exactly as `detectUrl` does. No
//! WebAssembly runs next to the page, so the scan no longer needs
//! `Page.setBypassCSP` and a strict-CSP site is scanned passively (see
//! WASM-BUNDLE.md in the detector repo).
//!
//! Wired into `impeccable detect` through [`impeccable_detect::UrlEngine`]:
//! a single URL uses `detect_url` (`waitUntil: 'networkidle0'`, `settleMs:
//! 0`); several URLs share one browser through [`SharedBrowser`]
//! (`createBrowserDetector()`: `waitUntil: 'load'`, `settleMs: 100`).
//!
//! Before any rule runs, the loaded page is classified ([`validity`]): a bot
//! challenge, an HTTP error page, or a page that is only a consent wall is
//! refused with an error instead of being scanned and reported clean. Then
//! the banners of known consent managers are hidden ([`consent`]), and so are
//! known product tours, builder badges and preloaders still covering the page
//! ([`overlays`]), so every pass and the screenshot see the page a visitor
//! sees once they dismiss them.
//!
//! Two entry points serve measurement work rather than the CLI.
//! [`detect_url_evidence`] runs the same scan and also returns what a
//! reviewer needs to check the findings (the captures and hit-test answers,
//! element rects, a screenshot). [`replay_url_scan`] re-runs the deterministic
//! passes over a recorded capture with no browser, so a rule change can be
//! measured against saved pages.

pub mod cdp;
pub mod consent;
pub mod overlays;
pub mod response_capture;
pub mod html_snapshot;
pub mod discovery;
pub mod fullpage;
pub mod screenshot_contrast;
pub mod snapshot_engine;
pub mod validity;

use std::cell::RefCell;
use std::collections::HashMap;
use std::time::{Duration, Instant};

use impeccable_core::browser::driver::{collect_browser_findings, serialize_findings};
use impeccable_core::browser::dom::{Dom, ElId};
use impeccable_core::browser::page_checks::measure_hidden_text_dom;
use impeccable_core::browser::snapshot::{Facts, SnapshotDom};
use impeccable_core::checks::measures::{check_content_hidden_at_rest, ContentHiddenInput};
use impeccable_core::findings::{try_finding, Finding};
use impeccable_detect::design_system::DesignSystem;
use impeccable_detect::engines::{EngineError, ScanOptions, SharedBrowser, UrlEngine, UrlScan};
use impeccable_detect::profiler::{DetectorProfile, ProfileMeta};
use serde_json::{json, Map, Value};

use cdp::{Browser, CdpError, Page, Viewport};
use consent::ConsentReport;
use overlays::OverlayReport;
pub use fullpage::ElementShot;
use validity::{DocumentResponse, PageProbe, PageValidity};

/// puppeteer's default `page.goto` timeout the JS passes explicitly.
const NAVIGATION_TIMEOUT: Duration = Duration::from_millis(30000);

/// The browser engine. Holds the process environment it reads for browser
/// discovery (`IMPECCABLE_BROWSER`, `PUPPETEER_EXECUTABLE_PATH`,
/// `CHROME_PATH`, standard locations), sandbox flags (`CI`,
/// `PUPPETEER_DANGEROUS_NO_SANDBOX`), and `HOME`/`PATH` for the search.
pub struct BrowserEngine {
    env: HashMap<String, String>,
}

impl BrowserEngine {
    pub fn new(env: HashMap<String, String>) -> Self {
        BrowserEngine { env }
    }

    /// An engine reading the real process environment.
    pub fn from_process_env() -> Self {
        BrowserEngine::new(impeccable_common::process_env())
    }

    /// JS `launchArgs = process.env.CI ? ['--no-sandbox','--disable-setuid-sandbox'] : []`.
    fn launch_args(&self) -> Vec<String> {
        match self.env.get("CI") {
            Some(v) if !v.is_empty() => vec![
                "--no-sandbox".to_string(),
                "--disable-setuid-sandbox".to_string(),
            ],
            _ => Vec::new(),
        }
    }

    fn dangerous_no_sandbox(&self) -> bool {
        self.env
            .get("PUPPETEER_DANGEROUS_NO_SANDBOX")
            .map(String::as_str)
            == Some("true")
    }

    /// `launchBrowser()`: discover, then launch headless.
    pub fn launch(&self) -> Result<Browser, EngineError> {
        let exe = discovery::find_browser(&self.env).map_err(EngineError::new)?;
        Browser::launch(&exe, &self.launch_args(), self.dangerous_no_sandbox())
            .map_err(|e| EngineError::new(e.message))
    }
}

impl UrlEngine for BrowserEngine {
    fn detect_url(&self, url: &str, options: &ScanOptions) -> Result<Vec<Finding>, EngineError> {
        Ok(self.detect_url_scan(url, options)?.findings)
    }

    fn detect_url_scan(&self, url: &str, options: &ScanOptions) -> Result<UrlScan, EngineError> {
        detect_url_impl(self, url, options, "networkidle0", 0, None)
    }

    fn open_shared(&self) -> Option<Box<dyn SharedBrowser + '_>> {
        Some(Box::new(SharedBrowserHandle {
            engine: self,
            browser: RefCell::new(None),
            launch_error: RefCell::new(None),
        }))
    }
}

/// `createBrowserDetector()`: one browser for many URLs, a fresh page per
/// URL. The browser launches lazily on the first scan; a launch failure is
/// remembered and reported for every URL (the JS throws once before the
/// loop and exits 1; the detect seam has no fatal path for `open_shared`,
/// so the failure surfaces per URL as `Error: ...` instead).
pub struct SharedBrowserHandle<'a> {
    engine: &'a BrowserEngine,
    browser: RefCell<Option<Browser>>,
    launch_error: RefCell<Option<String>>,
}

impl SharedBrowser for SharedBrowserHandle<'_> {
    fn detect_url(&self, url: &str, options: &ScanOptions) -> Result<Vec<Finding>, EngineError> {
        Ok(self.detect_url_scan(url, options)?.findings)
    }

    fn detect_url_scan(&self, url: &str, options: &ScanOptions) -> Result<UrlScan, EngineError> {
        if let Some(msg) = self.launch_error.borrow().as_ref() {
            return Err(EngineError::new(msg.clone()));
        }
        if self.browser.borrow().is_none() {
            match self.engine.launch() {
                Ok(b) => *self.browser.borrow_mut() = Some(b),
                Err(e) => {
                    *self.launch_error.borrow_mut() = Some(e.message.clone());
                    return Err(e);
                }
            }
        }
        let mut guard = self.browser.borrow_mut();
        let Some(browser) = guard.as_mut() else {
            return Err(EngineError::new(discovery::NOT_FOUND_MESSAGE));
        };
        detect_url_impl(self.engine, url, options, "load", 100, Some(browser))
    }

    fn close(&self) {
        if let Some(b) = self.browser.borrow_mut().take() {
            b.close();
        }
    }

    fn ensure_launched(&self) -> Result<(), EngineError> {
        if let Some(msg) = self.launch_error.borrow().as_ref() {
            return Err(EngineError::new(msg.clone()));
        }
        if self.browser.borrow().is_some() {
            return Ok(());
        }
        match self.engine.launch() {
            Ok(b) => {
                *self.browser.borrow_mut() = Some(b);
                Ok(())
            }
            Err(e) => {
                *self.launch_error.borrow_mut() = Some(e.message.clone());
                Err(e)
            }
        }
    }
}

/// JS detect-url.mjs `credentials` from `splitScanUrl`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScanCredentials {
    pub username: String,
    pub password: String,
}

/// JS `decodeUrlComponent`: `decodeURIComponent` with a fall-through to the
/// raw value when decoding fails.
// JS-PARITY: decodeURIComponent throws on a malformed escape and the JS
// returns the raw value; percent_decode leaves malformed escapes literal,
// which yields the same string for the common cases.
fn decode_url_component(value: &str) -> String {
    match percent_encoding::percent_decode_str(value).decode_utf8() {
        Ok(s) => s.into_owned(),
        Err(_) => value.to_string(),
    }
}

/// JS detect-url.mjs#splitScanUrl(url): strip basic-auth userinfo from the
/// scan target (so it never reaches goto targets or finding output) and hand
/// back http/https credentials separately (issue #657).
pub fn split_scan_url(url: &str) -> (String, Option<ScanCredentials>) {
    let Ok(mut parsed) = url::Url::parse(url) else {
        return (url.to_string(), None);
    };
    if parsed.username().is_empty() && parsed.password().unwrap_or("").is_empty() {
        return (url.to_string(), None);
    }
    let credentials = match parsed.scheme() {
        "http" | "https" => Some(ScanCredentials {
            username: decode_url_component(parsed.username()),
            password: decode_url_component(parsed.password().unwrap_or("")),
        }),
        _ => None,
    };
    let _ = parsed.set_username("");
    let _ = parsed.set_password(None);
    (parsed.as_str().to_string(), credentials)
}

/// `serializeDesignSystemForBrowser(designSystem)`.
pub fn serialize_design_system_for_browser(ds: Option<&DesignSystem>) -> Value {
    let Some(ds) = ds else { return Value::Null };
    if !ds.present {
        return Value::Null;
    }
    let colors: Vec<Value> = ds
        .allowed_color_keys
        .iter()
        .map(|(_, entry)| &entry.color)
        .filter(|c| c.r.is_finite() && c.g.is_finite() && c.b.is_finite())
        .map(|c| json!({ "r": c.r, "g": c.g, "b": c.b }))
        .collect();
    let radii: Vec<Value> = ds
        .allowed_radii
        .iter()
        .map(|r| r.px)
        .filter(|px| px.is_finite())
        .map(|px| json!(px))
        .collect();
    json!({
        "present": true,
        "hasFonts": ds.has_fonts,
        "allowedFonts": ds.allowed_fonts,
        "hasColors": ds.has_colors,
        "allowedColors": colors,
        "hasRadii": ds.has_radii,
        "allowedRadii": radii,
        "hasPillRadius": ds.has_pill_radius,
        "declaredSelectors": ds.declared_selectors,
    })
}

/// The pass that produced a finding, as [`Evidence::origins`] names it.
pub mod origin {
    /// The deterministic rule pass over the post-reveal capture. Replayable.
    pub const SCAN: &str = "scan";
    /// `content-hidden-at-rest`, over the post-reveal capture. Replayable.
    pub const CONTENT_HIDDEN: &str = "content-hidden";
    /// Uncaught page errors. Recorded, not replayable.
    pub const SCRIPT_ERROR: &str = "script-error";
    /// The visual-contrast pass (image and pixel reads), and the rule pass's
    /// `low-contrast` verdicts on text it hands to that pass
    /// (`visual::routed_reason`), which the pixels replace where they give a
    /// verdict and which stand, as advisory, where they do not. Recorded,
    /// not replayable.
    pub const VISUAL_CONTRAST: &str = "visual-contrast";
}

/// A pre-registry finding as `detectUrl` accumulates them.
struct RawResult {
    id: String,
    snippet: String,
    ignore_value: String,
    severity: String,
    /// The flagged element's selector, when the pass names an element.
    selector: Option<String>,
    origin: &'static str,
    /// The flagged element in the scan's capture, when the pass knows it. A
    /// generated selector names one element unless the page repeats an id,
    /// and the evidence resolves the selector to this element (see
    /// [`scan_identities`]).
    scan_el: Option<ElId>,
    /// The third-party vendor the finding belongs to (see
    /// [`impeccable_core::third_party`]); its message already names it.
    third_party: Option<String>,
    /// For a page-level finding, where the evidence step found the element
    /// that carries its declaration ([`Evidence::page_anchors`]).
    anchor: Option<Value>,
}

impl RawResult {
    fn new(origin: &'static str, id: String, snippet: String) -> RawResult {
        RawResult {
            id,
            snippet,
            ignore_value: String::new(),
            severity: String::new(),
            selector: None,
            origin,
            scan_el: None,
            third_party: None,
            anchor: None,
        }
    }
}

/// What [`detect_url_evidence`] records next to the findings.
#[derive(Debug, Default)]
pub struct Evidence {
    /// The main document's final HTTP response, when one was seen.
    pub response: Option<DocumentResponse>,
    /// The in-page probe the validity gate ran.
    pub probe: Option<PageProbe>,
    /// The validity verdict. A blocked page has no captures and no findings.
    pub validity: Option<PageValidity>,
    /// The post-reveal capture's JSON, which every deterministic pass ran over.
    pub scan_snapshot: Option<String>,
    /// Every hit test answered for that capture, by all of its passes, and
    /// the scroll probe's answers ([`Facts::shown_on_scroll`]).
    pub scan_facts: Facts,
    /// Notes about the capture rather than the page, which report no
    /// finding and block nothing: a slider that never started, whose text
    /// `content-hidden-at-rest` left out. The CLI prints the same lines
    /// after its findings in text mode.
    pub capture_notes: Vec<String>,
    /// Unset: the passes share one capture, so there is no second one to
    /// record. A recording made before they shared it carries its separate
    /// post-reveal capture here, and [`replay_url_scan`] still reads it.
    pub reveal_snapshot: Option<String>,
    /// Every hit test answered for [`Evidence::reveal_snapshot`].
    pub reveal_facts: Facts,
    /// Parallel to the findings: which pass produced each (see [`origin`]).
    pub origins: Vec<&'static str>,
    /// Document-coordinate `[x, y, width, height]` of each flagged selector,
    /// measured after the scan, so they match [`Evidence::screenshot`].
    pub element_rects: Map<String, Value>,
    /// Per flagged selector, measured after the scan: `{ tag, text, html,
    /// styles }` (text and html truncated; a fixed set of computed styles).
    pub element_details: Map<String, Value>,
    /// Flagged selectors whose element the evidence step found nowhere: the
    /// scan's element has left the document and the selector matches
    /// nothing. The finding was true of a state the page has left (an intro
    /// screen, a toast), so it has no rect, no details and no crop.
    pub transient: Vec<String>,
    /// Flagged selectors whose element sat more than a viewport width from
    /// where the scan's capture had it, and was still there after the
    /// evidence step measured it again for up to [`DRIFT_REMEASURE`] (a
    /// carousel that autoplayed on, a layout that shifted for good):
    /// `{ scan: [x, y, width, height], measured: [x, y, width, height] }`,
    /// document coordinates. [`Evidence::element_rects`] keeps the measured
    /// rect, which matches the screenshot; the element there is the scan's,
    /// not the state it was scored in.
    pub element_drift: Map<String, Value>,
    /// Parallel to the findings: for a page-level finding (on `body` or
    /// `html`) whose declaration a painted element carries (a radial-gradient
    /// halo or a glow, its `var()` resolved), that element measured after the
    /// scan, `{ rect: [x, y, width, height], tag, id, class }`; `null`
    /// otherwise. See [`impeccable_core::browser::driver::page_form_anchor`].
    pub page_anchors: Vec<Value>,
    pub screenshot: Option<Screenshot>,
    /// Why no screenshot was taken, when one was requested and failed.
    pub screenshot_error: Option<String>,
    /// A viewport shot per flagged selector whose rect falls outside
    /// [`Evidence::screenshot`] (past its cut or its right edge), taken with
    /// the element scrolled into view. See [`fullpage`].
    pub element_shots: Vec<ElementShot>,
    /// The consent managers the scan hid ([`consent`]), with the selectors
    /// that matched and the scroll locks undone. `None` when hiding was off
    /// ([`ScanOptions::keep_consent_banners`]) or the page was blocked.
    pub consent: Option<ConsentReport>,
    /// The product tours, builder badges and preloaders the scan hid
    /// ([`overlays`]), the selectors that matched, what was undone, and how
    /// long the scan waited for a preloader. `None` when hiding was off
    /// ([`ScanOptions::keep_overlays`]) or the page was blocked.
    pub overlays: Option<OverlayReport>,
}

/// A full-page screenshot taken after the scan. Its pixels line up with
/// [`Evidence::element_rects`].
#[derive(Debug, Clone)]
pub struct Screenshot {
    pub jpeg_base64: String,
    /// CSS pixels (the scan uses a device scale factor of 1). The document's
    /// scroll width, at least the viewport's.
    pub width: f64,
    pub height: f64,
    /// The page's height, with an inner page scroller unrolled; larger than
    /// `height` when the capture was cut.
    pub document_height: f64,
    /// How it was captured, one of [`fullpage::method`].
    pub method: &'static str,
    /// The document x of the image's left edge, in CSS pixels: an element
    /// rect's image x is its `x` minus this (its y needs no shift). 0 for most
    /// pages. Negative when the document scrolls from the right (a
    /// right-to-left page wider than the viewport), whose overflow lies at
    /// negative document x: the image starts at the left edge of that
    /// overflow, or, when [`fullpage::MAX_SCREENSHOT_WIDTH`] cuts it, as far
    /// left as keeps the viewport in the image.
    pub origin_x: f64,
}

/// What [`detect_url_evidence`] should capture beyond the findings.
#[derive(Debug, Clone)]
pub struct EvidenceRequest {
    pub screenshot: bool,
    /// Cut the screenshot at this height (CSS pixels).
    pub max_screenshot_height: f64,
    pub jpeg_quality: u32,
}

impl Default for EvidenceRequest {
    fn default() -> Self {
        EvidenceRequest {
            screenshot: true,
            max_screenshot_height: 12000.0,
            jpeg_quality: 82,
        }
    }
}

fn cdp_err(e: CdpError) -> EngineError {
    EngineError::new(e.message)
}

/// Time a step and record it on the profile (`profileStep` / `profileStepAsync`).
fn step<T>(
    profile: Option<&DetectorProfile>,
    phase: &str,
    rule_id: &str,
    target: &str,
    f: impl FnOnce() -> T,
) -> T {
    let Some(profile) = profile else { return f() };
    let started = Instant::now();
    let out = f();
    let ms = started.elapsed().as_secs_f64() * 1000.0;
    profile.record(
        ProfileMeta {
            engine: "browser",
            phase,
            rule_id,
            target,
        },
        ms,
        0,
        vec![],
    );
    out
}

/// `profileFindingsAsync`: like [`step`] but records finding count and ids
/// (only when the callback succeeded, as a throwing JS callback records
/// nothing).
fn step_findings<E>(
    profile: Option<&DetectorProfile>,
    phase: &str,
    rule_id: &str,
    target: &str,
    f: impl FnOnce() -> Result<Vec<RawResult>, E>,
) -> Result<Vec<RawResult>, E> {
    let Some(profile) = profile else { return f() };
    let started = Instant::now();
    let out = f()?;
    let ms = started.elapsed().as_secs_f64() * 1000.0;
    let ids = impeccable_detect::profiler::extract_finding_ids(out.iter().map(|r| r.id.as_str()));
    profile.record(
        ProfileMeta {
            engine: "browser",
            phase,
            rule_id,
            target,
        },
        ms,
        out.len(),
        ids,
    );
    Ok(out)
}

fn js_str(v: Option<&Value>) -> String {
    match v {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Null) | None => String::new(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Number(n)) => {
            impeccable_core::js::number_to_string(n.as_f64().unwrap_or(f64::NAN))
        }
        Some(other) => other.to_string(),
    }
}

/// JS `x || ''` on a JSON value.
fn js_str_or_empty(v: Option<&Value>) -> String {
    match v {
        Some(Value::Bool(false)) | Some(Value::Null) | None => String::new(),
        Some(Value::Number(n)) if n.as_f64() == Some(0.0) => String::new(),
        other => js_str(other),
    }
}

/// A non-empty `selector` field.
fn selector_of(v: &Value) -> Option<String> {
    v.get("selector")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(String::from)
}

/// `detectUrl(url, options)` with the wait/settle defaults the caller picks
/// and an optional shared browser (`options.browser`).
fn detect_url_impl(
    engine: &BrowserEngine,
    url: &str,
    options: &ScanOptions,
    wait_until: &str,
    settle_ms: u64,
    external: Option<&mut Browser>,
) -> Result<UrlScan, EngineError> {
    // JS `const { href: url, credentials } = splitScanUrl(rawUrl)` (issue #657):
    // everything below (goto, profile targets, finding output) sees the
    // redacted href only.
    let (url, credentials) = split_scan_url(url);
    let url = url.as_str();
    let credentials = credentials.as_ref();
    let profile = options.profile.as_deref();
    let owns_browser = external.is_none();
    let mut owned: Option<Browser> = None;
    let browser: &mut Browser = match external {
        Some(b) => b,
        None => {
            // import-puppeteer ↔ browser discovery; read-browser-script ↔ the
            // embedded bundle (recorded for profile parity, both instant).
            let exe = step(profile, "setup", "import-puppeteer", url, || {
                discovery::find_browser(&engine.env)
            })
            .map_err(EngineError::new)?;
            step(profile, "setup", "read-browser-script", url, || ());
            let launched = step(profile, "load", "launch-browser", url, || {
                Browser::launch(&exe, &engine.launch_args(), engine.dangerous_no_sandbox())
            })
            .map_err(cdp_err)?;
            owned.insert(launched)
        }
    };

    let mut consent = ConsentReport::default();
    let mut capture_notes = Vec::new();
    let mut overlays = OverlayReport::default();
    let scanned = scan_on_browser(
        browser,
        url,
        credentials,
        options,
        wait_until,
        settle_ms,
        profile,
        None,
        &mut consent,
        &mut capture_notes,
        &mut overlays,
    );
    // finally: close page (inside scan_page) and the browser when owned.
    if owns_browser {
        if let Some(b) = owned.take() {
            step(profile, "load", "close-browser", url, || b.close());
        }
    }
    let (mut findings, _) = results_to_findings(url, scanned?, options.design_system.as_deref())?;
    let mut notes = Vec::new();
    if !consent.hidden.is_empty() {
        let names = json!(consent.hidden);
        for f in findings.iter_mut() {
            f.extras.insert("consentHidden".into(), names.clone());
        }
        notes.push(consent_note(url, &consent.hidden));
    }
    if !overlays.hidden.is_empty() {
        let hidden = overlays.hidden_value();
        for f in findings.iter_mut() {
            f.extras.insert("overlaysHidden".into(), hidden.clone());
        }
        notes.push(overlay_note(url, &overlays));
    }
    notes.extend(capture_notes);
    Ok(UrlScan { findings, notes })
}

/// The text-mode note for a scan that hid consent banners.
fn consent_note(url: &str, hidden: &[String]) -> String {
    let (names, noun) = match hidden {
        [one] => (one.clone(), "banner"),
        [rest @ .., last] => (format!("{} and {last}", rest.join(", ")), "banners"),
        [] => (String::new(), "banner"),
    };
    format!("Hid the {names} consent {noun} on {url} before scanning. Pass --no-consent-hiding to scan it.")
}

/// The text-mode note for a scan that hid tours, badges or preloaders.
fn overlay_note(url: &str, report: &OverlayReport) -> String {
    let parts: Vec<String> = report
        .hidden
        .iter()
        .map(|h| match h.kind.as_str() {
            "tour" => format!("the {} tour", h.name),
            "badge" => format!("the {} badge", h.name),
            "preloader" => format!("the preloader {}", h.name),
            other => format!("the {other} {}", h.name),
        })
        .collect();
    let list = match parts.as_slice() {
        [one] => one.clone(),
        [rest @ .., last] => format!("{} and {last}", rest.join(", ")),
        [] => String::new(),
    };
    format!("Hid {list} on {url} before scanning. Pass --no-overlay-hiding to scan it.")
}

/// Run the URL engine's scan on a browser the caller owns and also return
/// the [`Evidence`] a reviewer needs to check each finding. The findings are
/// the ones `impeccable detect --json <url>` prints for the same page and
/// wait strategy. A blocked page returns no findings and an `Ok` with
/// [`Evidence::validity`] set, instead of the CLI's error.
pub fn detect_url_evidence(
    browser: &mut Browser,
    url: &str,
    options: &ScanOptions,
    wait_until: &str,
    settle_ms: u64,
    request: &EvidenceRequest,
) -> Result<(Vec<Finding>, Evidence), EngineError> {
    let (url, credentials) = split_scan_url(url);
    let mut evidence = Evidence::default();
    let mut consent = ConsentReport::default();
    let mut capture_notes = Vec::new();
    let mut overlays = OverlayReport::default();
    let results = scan_on_browser(
        browser,
        &url,
        credentials.as_ref(),
        options,
        wait_until,
        settle_ms,
        options.profile.as_deref(),
        Some((&mut evidence, request)),
        &mut consent,
        &mut capture_notes,
        &mut overlays,
    );
    evidence.capture_notes = capture_notes;
    let blocked = evidence.validity.as_ref().is_some_and(PageValidity::is_blocked);
    if !options.keep_consent_banners && !blocked {
        evidence.consent = Some(consent);
    }
    if !options.keep_overlays && !blocked {
        evidence.overlays = Some(overlays);
    }
    let results = results?;
    let (findings, origins, anchors) = results_to_findings_with(&url, results, options.design_system.as_deref())?;
    evidence.origins = origins;
    evidence.page_anchors = anchors;
    Ok((findings, evidence))
}

/// The outcome of [`replay_url_scan`].
#[derive(Debug)]
pub struct ReplayOutcome {
    /// Findings from the replayable passes ([`origin::SCAN`],
    /// [`origin::CONTENT_HIDDEN`]), in the order a live scan emits them.
    pub findings: Vec<Finding>,
    /// Hit tests the rules asked for that the recording cannot answer. Zero
    /// for an unchanged engine; a rule change that probes new points reports
    /// them here, and its findings for those points are an undercount.
    pub unanswered_hit_tests: usize,
    /// The capture notes the live scan of this capture printed
    /// ([`Evidence::capture_notes`]).
    pub capture_notes: Vec<String>,
}

/// Re-run the deterministic passes over a recorded capture, with no browser.
/// Both passes read the post-reveal capture, as the live scan does: that is
/// `reveal` when the recording kept it separately (a recording made before the
/// passes shared one capture), otherwise `scan_snapshot` itself, which
/// [`Evidence::scan_snapshot`] now records post-reveal.
///
/// Replaying a separate pair is an undercount: the recorded `reveal` facts
/// answer only the hit tests the hidden-text measure asked for, so the rule
/// pass's own points come back in [`ReplayOutcome::unanswered_hit_tests`].
pub fn replay_url_scan(
    url: &str,
    scan_snapshot: &str,
    scan_facts: &Facts,
    reveal: Option<(&str, &Facts)>,
    options: &ScanOptions,
) -> Result<ReplayOutcome, EngineError> {
    let config = snapshot_engine::browser_config(
        serialize_design_system_for_browser(options.design_system.as_deref()),
        options.rule_pack,
    );
    let (snapshot, facts) = reveal.unwrap_or((scan_snapshot, scan_facts));
    let dom = snapshot_engine::parse_snapshot(snapshot).map_err(cdp_err)?;
    dom.add_facts(facts);
    let collected = collect_browser_findings(&dom, &config);
    let handed = handed_over(&dom, &collected.groups);
    let mut unanswered = dom.take_needs().hit_tests.len();
    let groups = serialize_findings(&dom, &collected.groups);
    let mut results = results_from_groups(groups.as_array().map(Vec::as_slice).unwrap_or(&[]));
    // The verdicts the live scan hands to the pixels are reported under the
    // visual-contrast origin, which a replay does not reproduce.
    hand_over(&mut results, &handed);
    results.retain(|r| r.origin == origin::SCAN);
    let measured = measure_hidden_text_dom(&dom);
    unanswered += dom.take_needs().hit_tests.len();
    // A recording made before the scroll probe answers none of its
    // questions, and those boxes count as hidden, as they did when recorded.
    let _ = dom.take_scroll_probes();
    let capture_notes: Vec<String> =
        unstarted_slider_note(url, measured.unstarted_slider_chars, &measured.unstarted_slider_samples)
            .into_iter()
            .collect();
    results.extend(content_hidden_results(
        measured.total_chars,
        measured.hidden_chars,
        measured.hidden_samples,
    ));
    let (findings, _) = results_to_findings(url, results, options.design_system.as_deref())?;
    Ok(ReplayOutcome {
        findings,
        unanswered_hit_tests: unanswered,
        capture_notes,
    })
}

/// Map raw results onto registry findings, returning each one's origin
/// alongside. A design system that declares a purple switches the purple
/// forms of ai-color-palette off (see
/// [`impeccable_detect::design_system::drop_declared_purple_findings`]).
fn results_to_findings(
    url: &str,
    results: Vec<RawResult>,
    design_system: Option<&DesignSystem>,
) -> Result<(Vec<Finding>, Vec<&'static str>), EngineError> {
    results_to_findings_with(url, results, design_system).map(|(f, o, _)| (f, o))
}

/// [`results_to_findings`], also returning each kept finding's
/// [`Evidence::page_anchors`] entry.
fn results_to_findings_with(
    url: &str,
    results: Vec<RawResult>,
    design_system: Option<&DesignSystem>,
) -> Result<(Vec<Finding>, Vec<&'static str>, Vec<Value>), EngineError> {
    let purple_off = design_system
        .filter(|ds| ds.present)
        .and_then(|ds| ds.declared_purple())
        .is_some();
    let mut findings = Vec::with_capacity(results.len());
    let mut origins = Vec::with_capacity(results.len());
    let mut anchors = Vec::with_capacity(results.len());
    for r in results {
        if purple_off && impeccable_core::checks::rules::is_purple_palette_finding(&r.id, &r.snippet) {
            continue;
        }
        let Some(mut item) = try_finding(&r.id, url, &r.snippet, 0.0) else {
            // JS: `finding()` dereferences an unknown registry entry.
            return Err(EngineError::new(
                "Cannot read properties of undefined (reading 'name')",
            ));
        };
        if !r.ignore_value.is_empty() {
            item.extras
                .insert("ignoreValue".into(), Value::String(r.ignore_value));
        }
        if let Some(selector) = r.selector {
            item.extras.insert("selector".into(), Value::String(selector));
        }
        if let Some(vendor) = r.third_party {
            item.extras.insert("thirdParty".into(), Value::String(vendor));
        }
        if !r.severity.is_empty() && r.severity != item.severity {
            item.severity = r.severity;
        }
        impeccable_core::findings::derive_advisory_flag(&mut item);
        findings.push(item);
        origins.push(r.origin);
        anchors.push(r.anchor.unwrap_or(Value::Null));
    }
    Ok((findings, origins, anchors))
}

/// Flatten `serialize_findings` groups into raw results, each carrying its
/// group's selector.
fn results_from_groups(groups: &[Value]) -> Vec<RawResult> {
    let mut out = Vec::new();
    for group in groups {
        let Some(findings) = group.get("findings").and_then(Value::as_array) else {
            continue;
        };
        let selector = selector_of(group);
        for f in findings {
            out.push(RawResult {
                id: js_str(f.get("type")),
                snippet: js_str(f.get("detail")),
                ignore_value: js_str_or_empty(f.get("ignoreValue")),
                severity: js_str_or_empty(f.get("severity")),
                selector: selector.clone(),
                origin: origin::SCAN,
                scan_el: None,
                third_party: f
                    .get("thirdParty")
                    .and_then(Value::as_str)
                    .map(String::from),
                anchor: None,
            });
        }
    }
    out
}

/// Per result of `results_from_groups(serialize_findings(dom, groups))`, in
/// order: whether it is a `low-contrast` verdict on text the element pass
/// hands to the pixels ([`impeccable_core::browser::visual::routed_reason`]).
/// The live scan lets a pixel verdict replace such a verdict, so it is the
/// visual-contrast pass's to report, and a replay leaves it out.
fn handed_over(dom: &SnapshotDom, groups: &[impeccable_core::browser::FindingGroup]) -> Vec<bool> {
    let mut out = Vec::new();
    for g in groups {
        let mut routed: Option<bool> = None;
        for f in &g.findings {
            let handed = f.type_ == "low-contrast"
                && *routed.get_or_insert_with(|| {
                    impeccable_core::browser::visual::routed_reason(dom, g.el).is_some()
                });
            out.push(handed);
        }
    }
    out
}

/// Move the verdicts [`handed_over`] marks to [`origin::VISUAL_CONTRAST`].
/// Results that do not line up with the marks (never expected) stay in the
/// scan origin, the same way live and in a replay.
fn hand_over(results: &mut [RawResult], handed: &[bool]) {
    if handed.len() != results.len() {
        return;
    }
    for (r, handed) in results.iter_mut().zip(handed) {
        if *handed {
            r.origin = origin::VISUAL_CONTRAST;
        }
    }
}

/// Settle the element pass's `low-contrast` verdicts on text it handed to
/// the pixels ([`hand_over`]), once the visual-contrast pass has run.
///
/// Where the pixels gave a verdict, pass or fail, theirs replaces the element
/// pass's (`superseded`). Where they gave none (the routed budget was spent,
/// the read was refused for a blocked reason, the candidate never reached a
/// slot, the two shots differed), the element pass's verdict stands, but as
/// advisory: it was computed from styles over paint the walk could not read,
/// and the check meant to confirm it never ran (corpus decision
/// r6-t5-unread-pixel-verdicts). Its text is unchanged. Only the verdicts
/// `hand_over` moved to the visual-contrast origin are touched: the scan
/// origin is what a replay reproduces, and a replay has no pixels.
///
/// A selector that names several elements (a repeated id) is told apart by
/// its match (`[n, count]`): `match_of` gives a result's, and a pixel verdict
/// on one copy leaves the verdict on another standing.
fn settle_handed_over(
    results: &mut Vec<RawResult>,
    superseded: &[CandidateKey],
    match_of: impl Fn(&RawResult) -> Option<Value>,
) {
    let handed = |r: &RawResult| r.origin == origin::VISUAL_CONTRAST && r.id == "low-contrast";
    if !superseded.is_empty() {
        results.retain(|r| {
            !(handed(r)
                && r.selector.as_deref().is_some_and(|s| {
                    let m = match_of(r);
                    superseded.iter().any(|k| k.names(s, m.as_ref()))
                }))
        });
    }
    for r in results.iter_mut().filter(|r| handed(r)) {
        r.severity = impeccable_core::checks::rules::ADVISORY_SEVERITY.to_string();
    }
}

/// The least text an unstarted slider holds before the scan says so: the
/// hidden-character floor `content-hidden-at-rest` reports from.
const UNSTARTED_SLIDER_NOTE_CHARS: f64 = 150.0;

/// The capture note for text `content-hidden-at-rest` left out because the
/// slider holding it never started (corpus decision
/// r6-t6-hidden-scroll-linked). Not a finding: the page may not have
/// finished loading when it was captured, which is a fact about the scan.
/// `None` below [`UNSTARTED_SLIDER_NOTE_CHARS`].
fn unstarted_slider_note(url: &str, chars: f64, samples: &[String]) -> Option<String> {
    if chars < UNSTARTED_SLIDER_NOTE_CHARS {
        return None;
    }
    let sample = samples.first().map(|s| format!(", e.g. \"{s}\"")).unwrap_or_default();
    Some(format!(
        "Capture note: {} chars of text on {url} sit in sliders that never started (every slide hidden{sample}), so content-hidden-at-rest left them out. The page may not have finished loading; scan it again to check that text.",
        impeccable_core::js::number_to_string(chars)
    ))
}

fn content_hidden_results(
    total_chars: f64,
    hidden_chars: f64,
    hidden_samples: Vec<String>,
) -> Vec<RawResult> {
    let input = ContentHiddenInput {
        total_chars,
        hidden_chars,
        hidden_samples,
    };
    check_content_hidden_at_rest(&input)
        .into_iter()
        .map(|f| RawResult::new(origin::CONTENT_HIDDEN, f.id, f.snippet))
        .collect()
}

/// A new page on `browser`, scanned, then closed.
#[allow(clippy::too_many_arguments)]
fn scan_on_browser(
    browser: &mut Browser,
    url: &str,
    credentials: Option<&ScanCredentials>,
    options: &ScanOptions,
    wait_until: &str,
    settle_ms: u64,
    profile: Option<&DetectorProfile>,
    evidence: Option<(&mut Evidence, &EvidenceRequest)>,
    consent: &mut ConsentReport,
    notes: &mut Vec<String>,
    overlays: &mut OverlayReport,
) -> Result<Vec<RawResult>, EngineError> {
    let (vw, vh) = options.viewport.unwrap_or((1280, 800));
    let viewport = Viewport {
        width: vw,
        height: vh,
    };
    let page = step(profile, "load", "new-page", url, || browser.new_page()).map_err(cdp_err);
    match page {
        Ok(page) => scan_page(
            page, url, credentials, options, wait_until, settle_ms, viewport, profile, evidence, consent, notes,
            overlays,
        ),
        Err(e) => Err(e),
    }
}

/// Everything between `newPage` and the `finally` that closes the page.
#[allow(clippy::too_many_arguments)]
fn scan_page(
    mut page: Page<'_>,
    url: &str,
    credentials: Option<&ScanCredentials>,
    options: &ScanOptions,
    wait_until: &str,
    settle_ms: u64,
    viewport: Viewport,
    profile: Option<&DetectorProfile>,
    evidence: Option<(&mut Evidence, &EvidenceRequest)>,
    consent: &mut ConsentReport,
    notes: &mut Vec<String>,
    overlays: &mut OverlayReport,
) -> Result<Vec<RawResult>, EngineError> {
    let outcome = scan_page_inner(
        &mut page,
        url,
        credentials,
        options,
        wait_until,
        settle_ms,
        viewport,
        profile,
        evidence,
        consent,
        notes,
        overlays,
    );
    step(profile, "load", "close-page", url, || page.close());
    outcome
}

/// Probe the loaded page and classify it. A probe that fails because the page
/// navigated underneath it (a challenge redirecting on its own) is retried
/// once after a short wait.
fn check_validity(
    page: &mut Page<'_>,
    consent_wall: bool,
) -> Result<(Option<DocumentResponse>, PageProbe, PageValidity), CdpError> {
    let js = validity::probe_js();
    let raw = match page.evaluate_value(&js) {
        Ok(v) => v,
        Err(_) => {
            std::thread::sleep(Duration::from_millis(1000));
            page.evaluate_value(&js)?
        }
    };
    let probe = PageProbe::from_value(&raw);
    let response = page
        .main_document_response()
        .and_then(|r| DocumentResponse::from_cdp(&r));
    let verdict = validity::classify_with(response.as_ref(), &probe, consent_wall);
    Ok((response, probe, verdict))
}

/// What a late consent pass ([`late_consent_pass`]) found.
enum LateConsent {
    /// The page is a consent wall now, with the probe it was read from.
    Wall(PageProbe, PageValidity),
    /// It is not; `changed` is whether the hide step altered the page.
    Clear { changed: bool },
}

/// The consent-wall check and the hide step for a manager that arrived after
/// the load-time validity check, in one evaluation: discovery,
/// classification and hiding read the same page, so a manager inserted in
/// between can never be hidden without being asked whether it is a wall.
/// The hide step runs either way (a wall is refused, so what it hid does not
/// matter); the verdict is read in Rust off the probe it returns. A failed
/// evaluation falls back to the hide step alone, which is best-effort as
/// before.
fn late_consent_pass(page: &mut Page<'_>, consent: &mut ConsentReport) -> LateConsent {
    // The earlier passes' rules are on: a root that was an empty stub then
    // is hidden by them now, though it holds the wall. The probe reads the
    // page with them off, in one task, so nothing paints in between.
    // The same goes for the inline hides those passes stamped on a manager
    // whose own inline `!important` outranked the rules, while they are still
    // theirs ([`consent::STAMP_IS_OURS_JS`]): a manager that has since set its
    // own display (closing its dialog) keeps what it set. The probe only runs
    // when a manager's root is in the page, since it is a wall check.
    let roots: Vec<&str> = consent::CONSENT_MANAGERS.iter().flat_map(|m| m.roots.iter().copied()).collect();
    let expr = format!(
        "(() => {{ const roots = {roots}; let any = false; for (const sel of roots) {{ try {{ if (document.querySelector(sel)) {{ any = true; break; }} }} catch (e) {{}} }} let probe = null; if (any) {{ try {{ probe = (() => {{ const s = document.getElementById({id}); const marked = Array.from(document.querySelectorAll('[' + {mark} + ']')).filter({ours}); const put = marked.map(el => {{ let prev = ['', '']; try {{ prev = JSON.parse(el.getAttribute({mark})); }} catch (e) {{}} if (prev[0]) el.style.setProperty('display', prev[0], prev[1]); else el.style.removeProperty('display'); return el; }}); if (s) s.disabled = true; try {{ return {probe}; }} finally {{ if (s) s.disabled = false; for (const el of put) el.style.setProperty('display', 'none', 'important'); }} }})(); }} catch (e) {{ probe = null; }} }} const hide = {hide}; return {{ probe, hide }}; }})()",
        roots = serde_json::json!(roots),
        id = serde_json::json!(consent::HIDE_STYLE_ID),
        mark = serde_json::json!(consent::INLINE_HIDE_MARK),
        ours = consent::STAMP_IS_OURS_JS,
        probe = validity::probe_js(),
        hide = consent::hide_js(),
    );
    let raw = match page.evaluate_value(&expr) {
        Ok(v) => v,
        Err(_) => return LateConsent::Clear { changed: hide_consent_banners(page, consent) },
    };
    let hide = raw.get("hide").cloned().unwrap_or(Value::Null);
    consent.merge(&hide);
    let changed = hide.get("changed").and_then(Value::as_bool).unwrap_or(false);
    if let Some(probe) = raw.get("probe").filter(|p| p.is_object()).map(PageProbe::from_value) {
        if !probe.consent.is_empty() {
            let verdict = validity::classify_with(None, &probe, true);
            if matches!(verdict, PageValidity::Blocked { kind: validity::BlockKind::ConsentWall, .. }) {
                return LateConsent::Wall(probe, verdict);
            }
        }
    }
    LateConsent::Clear { changed }
}

/// The refusal for a page [`late_consent_pass`] found to be a consent wall:
/// the error a plain scan returns, or, for an evidence scan, the probe and
/// verdict recorded beside an empty finding list.
fn refuse_late_wall(
    page: &mut Page<'_>,
    evidence: Option<(&mut Evidence, &EvidenceRequest)>,
    probe: PageProbe,
    verdict: PageValidity,
) -> Result<Vec<RawResult>, EngineError> {
    let message = verdict.error_message().unwrap_or_default();
    match evidence {
        None => Err(EngineError::new(message)),
        Some((ev, request)) => {
            ev.probe = Some(probe);
            ev.validity = Some(verdict);
            let _ = capture_post_scan(page, ev, request, &[], &Map::new(), &Map::new(), &[]);
            Ok(Vec::new())
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn scan_page_inner(
    page: &mut Page<'_>,
    url: &str,
    credentials: Option<&ScanCredentials>,
    options: &ScanOptions,
    wait_until: &str,
    settle_ms: u64,
    viewport: Viewport,
    profile: Option<&DetectorProfile>,
    mut evidence: Option<(&mut Evidence, &EvidenceRequest)>,
    consent: &mut ConsentReport,
    notes: &mut Vec<String>,
    overlays: &mut OverlayReport,
) -> Result<Vec<RawResult>, EngineError> {
    step(profile, "load", "set-viewport", url, || {
        page.set_viewport(viewport)
    })
    .map_err(cdp_err)?;
    // JS `await applyOriginScopedAuth(page, url, credentials)` (issue #657).
    if let Some(creds) = credentials {
        page.apply_origin_scoped_auth(url, &creds.username, &creds.password)
            .map_err(cdp_err)?;
    }
    let goto_rule = format!("goto:{wait_until}");
    step(profile, "load", &goto_rule, url, || {
        page.goto(url, wait_until, NAVIGATION_TIMEOUT)
    })
    .map_err(cdp_err)?;
    if settle_ms > 0 {
        step(profile, "load", "settle", url, || {
            std::thread::sleep(Duration::from_millis(settle_ms))
        });
    }

    // A challenge or error page is not the site: refuse to report on it. Nor
    // is a consent wall, unless the scan keeps the banners: then the banner
    // is what the caller asked to read.
    let hide_consent = !options.keep_consent_banners;
    let (response, probe, verdict) =
        step(profile, "load", "validity", url, || check_validity(page, hide_consent)).map_err(cdp_err)?;
    let blocked = verdict.error_message();
    if let Some((ev, _)) = evidence.as_mut() {
        ev.response = response;
        ev.probe = Some(probe);
        ev.validity = Some(verdict);
    }
    if let Some(message) = blocked {
        return match evidence {
            None => Err(EngineError::new(message)),
            Some((ev, request)) => {
                let _ = capture_post_scan(page, ev, request, &[], &Map::new(), &Map::new(), &[]);
                Ok(Vec::new())
            }
        };
    }

    // Hide known consent managers' banners and backdrops, and undo the scroll
    // lock they applied, before anything is swept or measured. Never a click
    // and never a consent choice: an injected style paints the page without
    // the manager's layer. The validity probe above ran first, so a page that
    // is only a consent wall was refused rather than scanned empty. Every hide
    // pass is best-effort: a failed one leaves the banner showing, the way a
    // scan with `--no-consent-hiding` reads the page.
    if hide_consent {
        step(profile, "load", "hide-consent", url, || hide_consent_banners(page, consent));
    }
    // Then tours and preloaders ([`overlays`]), the same way. A preloader
    // still covering the page gets a bounded wait to go on its own first.
    let hide_overlays = !options.keep_overlays;
    if hide_overlays {
        overlays.waited_ms = step(profile, "load", "wait-preloader", url, || wait_for_preloaders(page));
        step(profile, "load", "hide-overlays", url, || hide_page_overlays(page, overlays));
    }

    // Inject the plain-JS snapshot producer (no WebAssembly runs in the page).
    step(profile, "scan", "inject-snapshot-script", url, || {
        snapshot_engine::ensure_snapshot_js(page)
    })
    .map_err(cdp_err)?;

    let config = snapshot_engine::browser_config(
        serialize_design_system_for_browser(options.design_system.as_deref()),
        options.rule_pack,
    );

    // Reveal sweep before anything is measured: scroll the page top to bottom
    // and back, so scroll-reveal content is at the opacity a visitor sees it at
    // rather than the 0 it sits at until its section is reached. The element
    // checks skip an element at effective opacity <= 0.02, so a capture taken
    // before the sweep hides whole pages of text from the rule pass.
    step(profile, "scan", "reveal-sweep", url, || reveal_sweep(page)).map_err(cdp_err)?;

    // A manager that injects its banner late (after load, or on the first
    // scroll) is hidden here, before the capture every pass reads. A late
    // banner can be the whole page, so the consent-wall gate runs again
    // first: hiding a wall would leave nothing to read and report it clean.
    if hide_consent {
        if let LateConsent::Wall(probe, verdict) =
            step(profile, "scan", "hide-consent", url, || late_consent_pass(page, consent))
        {
            return refuse_late_wall(page, evidence, probe, verdict);
        }
    }
    if hide_overlays {
        step(profile, "scan", "hide-overlays", url, || hide_page_overlays(page, overlays));
    }

    // The one capture every pass below reads: the rule pass, the hidden-text
    // measure, and the visual pass share this DOM, so a hit test any of them
    // answers is answered for all three. The sweep leaves the page revealed and
    // scrolled to the top, which is the scroll-0 snapshot the in-page path
    // measured and analyzed.
    let mut base_json = snapshot_engine::capture_snapshot_json(page).map_err(cdp_err)?;
    // A banner that arrived around the capture is hidden, and the page
    // captured again, so the capture, the live hit tests and the pixel reads
    // all see the page without it.
    let consent_changed = hide_consent
        && match step(profile, "scan", "hide-consent", url, || late_consent_pass(page, consent)) {
            LateConsent::Wall(probe, verdict) => return refuse_late_wall(page, evidence, probe, verdict),
            LateConsent::Clear { changed } => changed,
        };
    let overlays_changed =
        hide_overlays && step(profile, "scan", "hide-overlays", url, || hide_page_overlays(page, overlays));
    if consent_changed || overlays_changed {
        base_json = snapshot_engine::capture_snapshot_json(page).map_err(cdp_err)?;
    }
    let base = snapshot_engine::parse_snapshot(&base_json).map_err(cdp_err)?;
    if let Some((ev, _)) = evidence.as_mut() {
        ev.scan_snapshot = Some(base_json);
    }

    // Deterministic pass: run the rule core natively over the snapshot
    // (hit-test misses answered to a fixpoint). serialize_findings reproduces
    // the same per-finding fields (type/detail/ignoreValue/severity) and order
    // the in-page bundle's `impeccableDetect({ serialize: true })` produced; the
    // group selectors feed the visual pass below.
    let mut serialized_groups: Vec<Value> = Vec::new();
    let mut results = step_findings(profile, "scan", "browser-scan", url, || {
        let facts = evidence.as_mut().map(|(ev, _)| &mut ev.scan_facts);
        // Which verdicts the element pass hands to the pixels is decided here,
        // inside the recorded rounds, so a replay reads it off the same
        // capture and the same hit-test answers.
        let (collected, handed) = snapshot_engine::resolve_needs_recording(
            &base,
            page,
            |d| {
                let collected = collect_browser_findings(d, &config);
                let handed = handed_over(d, &collected.groups);
                (collected, handed)
            },
            facts,
        )
        .map_err(cdp_err)?;
        serialized_groups = serialize_findings(&base, &collected.groups)
            .as_array()
            .cloned()
            .unwrap_or_default();
        let mut results = results_from_groups(&serialized_groups);
        hand_over(&mut results, &handed);
        // One serialized group per finding group, one result per finding, in
        // order. Anything else leaves the elements unset, and the evidence
        // resolves those selectors as before.
        let counts = collected.groups.iter().map(|g| g.findings.len()).sum::<usize>();
        if counts == results.len() {
            let els = collected
                .groups
                .iter()
                .flat_map(|g| std::iter::repeat(g.el).take(g.findings.len()));
            for (r, el) in results.iter_mut().zip(els) {
                r.scan_el = Some(el);
            }
        }
        Ok::<_, EngineError>(results)
    })?;

    // content-hidden-at-rest: what is still hidden once the reveal handlers
    // have run, measured over the same post-reveal capture.
    let mut unstarted: Option<(f64, Vec<String>)> = None;
    let mut probed = false;
    let hidden = step_findings(profile, "scan", "content-hidden-at-rest", url, || {
        let mut facts = evidence.as_mut().map(|(ev, _)| &mut ev.scan_facts);
        let _ = base.take_scroll_probes();
        let mut measured = snapshot_engine::resolve_needs_recording(
            &base,
            page,
            |d| measure_hidden_text_dom(d),
            facts.as_deref_mut(),
        )
        .map_err(cdp_err)?;
        // The boxes a share that would report asked about: scroll to each
        // and look, then measure again with the answers (recorded, so a
        // replay of this capture reads them). A second round answers the
        // boxes held at 0 inside a box the first round saw shown.
        for _round in 0..2 {
            let probes = base.take_scroll_probes();
            if probes.is_empty() {
                break;
            }
            probed = true;
            let answers = step(profile, "scan", "scroll-probe", url, || {
                snapshot_engine::probe_shown_on_scroll(page, &probes)
            })
            .map_err(cdp_err)?;
            let answered = Facts { shown_on_scroll: answers, ..Facts::default() };
            base.add_facts(&answered);
            if let Some(record) = facts.as_deref_mut() {
                record.shown_on_scroll.extend(answered.shown_on_scroll.iter().copied());
            }
            measured = snapshot_engine::resolve_needs_recording(
                &base,
                page,
                |d| measure_hidden_text_dom(d),
                facts.as_deref_mut(),
            )
            .map_err(cdp_err)?;
        }
        let _ = base.take_scroll_probes();
        if measured.unstarted_slider_chars > 0.0 {
            unstarted = Some((measured.unstarted_slider_chars, measured.unstarted_slider_samples.clone()));
        }
        Ok::<_, EngineError>(content_hidden_results(
            measured.total_chars,
            measured.hidden_chars,
            measured.hidden_samples,
        ))
    })?;
    results.extend(hidden);
    // The scroll probe scrolled the page after every pre-capture pass, and a
    // manager or a tour that injects on scroll would now sit over the page
    // for the pixel pass's hit tests and shots. The late consent check and
    // the hide steps run once more; the capture the rule pass read predates
    // them, so it stands.
    if probed {
        if hide_consent {
            if let LateConsent::Wall(probe, verdict) =
                step(profile, "scan", "hide-consent", url, || late_consent_pass(page, consent))
            {
                return refuse_late_wall(page, evidence, probe, verdict);
            }
        }
        if hide_overlays {
            step(profile, "scan", "hide-overlays", url, || hide_page_overlays(page, overlays));
        }
    }
    if let Some(note) = unstarted.and_then(|(chars, samples)| unstarted_slider_note(url, chars, &samples)) {
        notes.push(note);
    }

    results.extend(capped_script_errors(
        page.page_errors().iter().map(|e| (e.message.as_str(), e.source.as_deref())),
    ));

    let analyses = step(profile, "visual-contrast", "browser-analyze", url, || {
        snapshot_engine::analyze_visual_contrast(
            page,
            &base,
            VISUAL_CONTRAST_MAX_CANDIDATES,
            VISUAL_CONTRAST_MAX_ROUTED,
            true,
        )
    })
    .map_err(cdp_err)?;
    let (mut visual, superseded) =
        run_visual_contrast_fallback(page, &analyses, &serialized_groups, viewport, profile, url)?;
    settle_handed_over(&mut results, &superseded, |r| {
        repeated_match(&base, r.selector.as_deref()?, r.scan_el?)
    });
    for r in visual.iter_mut() {
        tag_widget_vendor(&base, r);
    }
    if evidence.is_some() {
        for r in visual.iter_mut() {
            r.scan_el = r.selector.as_deref().and_then(|s| visual_scan_element(&base, s, &analyses));
        }
    }
    results.extend(visual);

    if let Some((ev, request)) = evidence {
        // And once more before the screenshot, so the crops match the capture.
        if hide_consent {
            let _ = hide_consent_banners(page, consent);
        }
        if hide_overlays {
            let _ = hide_page_overlays(page, overlays);
        }
        let mut selectors: Vec<String> = Vec::new();
        for r in &results {
            if let Some(s) = &r.selector {
                if !selectors.contains(s) {
                    selectors.push(s.clone());
                }
            }
        }
        // A result whose pass named no element (the visual pass on a
        // selector with no id) is bound to the selector's one match in the
        // capture, which is the element the pass measured.
        for r in results.iter_mut().filter(|r| r.scan_el.is_none()) {
            r.scan_el = r.selector.as_deref().and_then(|s| sole_match(&base, s));
        }
        let identities = scan_identities(&base, &results);
        let nodes = scan_nodes(&base, &results);
        let anchors: Vec<Option<ElId>> = results
            .iter()
            .map(|r| {
                let page_level = matches!(r.selector.as_deref(), Some("body") | Some("html") | None);
                (page_level && r.origin == origin::SCAN)
                    .then(|| impeccable_core::browser::driver::page_form_anchor(&base, &r.id, &r.snippet))
                    .flatten()
            })
            .collect();
        let measured = capture_post_scan(page, ev, request, &selectors, &identities, &nodes, &anchors);
        for (r, anchor) in results.iter_mut().zip(measured) {
            r.anchor = anchor;
        }
    }
    Ok(results)
}

/// The visual-contrast pass's candidates per scan: text whose reasons say
/// the element pass's colours may not describe what paints, in document
/// order.
const VISUAL_CONTRAST_MAX_CANDIDATES: f64 = 12.0;

/// And a second budget, after those, for text the element pass hands over
/// instead of scoring (`visual::routed_reason`): text over paint the contrast
/// walk never read, links and spans among it, and outlined text. Each one
/// costs a pair of clipped screenshots; the first budget is unchanged, so a
/// page with nothing to hand over is measured exactly as before.
const VISUAL_CONTRAST_MAX_ROUTED: f64 = 12.0;

/// The pixel reads the visual pass makes only because the element pass
/// handed the text over (a candidate of the second budget, or one of the
/// first whose element verdict would have kept it from the pixels) stop once
/// they have spent this long, or once this many in a row gave no verdict (a
/// page whose carousels repaint every box between the two shots, at about a
/// second a read on lpga.or.jp). What they leave unread keeps the element
/// pass's verdict, as advisory ([`settle_handed_over`]). A page whose reads are quick (about
/// 150ms each) spends under two seconds on all twelve.
const ROUTED_PIXEL_BUDGET: std::time::Duration = std::time::Duration::from_secs(4);
const ROUTED_PIXEL_MISSES: usize = 4;
/// A read that gave no verdict counts toward [`ROUTED_PIXEL_MISSES`] only
/// when its screenshots were taken.
const ROUTED_PIXEL_SLOW_MISS: std::time::Duration = std::time::Duration::from_millis(50);

/// At most this many counted script errors per scan, and separately at
/// most this many ad-tech ones and this many recoverable hydration ones.
const SCRIPT_ERROR_CAP: usize = 3;

/// The page's deduped errors as `script-error` results, in arrival order.
/// The cap applies to counted errors, advisory ad-tech errors and advisory
/// hydration errors separately, after classifying, so advisory errors never
/// take the slots a first-party error needs: three failing ad scripts, or a
/// hydration chain, ahead of a broken app bundle still report the bundle as
/// an error.
fn capped_script_errors<'a>(errors: impl IntoIterator<Item = (&'a str, Option<&'a str>)>) -> Vec<RawResult> {
    let (mut counted, mut ad_tech, mut hydration) = (0usize, 0usize, 0usize);
    let mut out = Vec::new();
    for (message, source) in errors {
        let r = script_error_result(message, source);
        let slot = if r.third_party.is_some() {
            &mut ad_tech
        } else if r.severity == "advisory" {
            &mut hydration
        } else {
            &mut counted
        };
        if *slot < SCRIPT_ERROR_CAP {
            *slot += 1;
            out.push(r);
        }
    }
    out
}

/// One uncaught page error as a `script-error` result. The message alone
/// rarely says which script failed (`Uncaught [object Object]`, a minified
/// React invariant), so the finding names where it was thrown. An error an
/// ad-tech script threw, or an ad API rejected, names the vendor and reports
/// as advisory: the page renders fine and the fix is the vendor's (corpus
/// decision r3-31-script-error-ad-tech). One of React's recoverable
/// hydration errors reports as advisory with its text unchanged: React
/// renders the page again on the client and the page shows complete (corpus
/// decision r5-p13-script-error-hydration).
fn script_error_result(message: &str, source: Option<&str>) -> RawResult {
    let snippet = match source {
        Some(source) => format!("{message} ({source})"),
        None => message.to_string(),
    };
    match impeccable_core::third_party::ad_tech_vendor(message, source) {
        Some(vendor) => RawResult {
            severity: "advisory".to_string(),
            third_party: Some(vendor.to_string()),
            ..RawResult::new(
                origin::SCRIPT_ERROR,
                "script-error".to_string(),
                impeccable_core::third_party::tag_detail(&snippet, vendor),
            )
        },
        None if impeccable_core::script_errors::react_recoverable_hydration_error(message).is_some() => RawResult {
            severity: "advisory".to_string(),
            ..RawResult::new(origin::SCRIPT_ERROR, "script-error".to_string(), snippet)
        },
        None => RawResult::new(origin::SCRIPT_ERROR, "script-error".to_string(), snippet),
    }
}

/// Tag a visual-contrast result on a known widget vendor's markup the way
/// `serialize_findings` tags the rule pass's: the vendor at the end of the
/// message and on the finding. The selector's first match in the scan's
/// capture decides.
fn tag_widget_vendor(dom: &SnapshotDom, r: &mut RawResult) {
    if r.third_party.is_some() {
        return;
    }
    let Some(selector) = r.selector.as_deref() else { return };
    let Ok(Some(el)) = dom.query_one(None, selector) else { return };
    if let Some(vendor) = impeccable_core::third_party::widget_vendor(dom, el) {
        r.snippet = impeccable_core::third_party::tag_detail(&r.snippet, vendor);
        r.third_party = Some(vendor.to_string());
    }
}

/// Per flagged selector the scan's capture matched on more than one element,
/// `[n, count]`: the flagged element is the `n`th of `count` matches, in
/// document order. A generated selector names one element unless an id
/// anchors it and the page repeats that id (a search box rendered once per
/// breakpoint), and then `querySelector` returns the first copy, which can be
/// a collapsed duplicate the scan never scored. The evidence takes the `n`th
/// match while the page still has `count` of them, and `querySelector`'s
/// answer otherwise. The first result naming a selector decides, as it does
/// for [`Evidence::element_rects`]; a selector matched once, or a result with
/// no known element, is left out.
fn scan_identities(dom: &SnapshotDom, results: &[RawResult]) -> Map<String, Value> {
    let mut out = Map::new();
    let mut seen: Vec<&str> = Vec::new();
    for r in results {
        let Some(selector) = r.selector.as_deref() else { continue };
        if seen.contains(&selector) {
            continue;
        }
        seen.push(selector);
        // Without an id the generator checks that its selector is unique.
        if !selector.contains('#') {
            continue;
        }
        let Some(el) = r.scan_el else { continue };
        let Ok(matches) = dom.query_all(None, selector) else { continue };
        if matches.len() < 2 {
            continue;
        }
        if let Some(n) = matches.iter().position(|m| *m == el) {
            out.insert(selector.to_string(), json!([n, matches.len()]));
        }
    }
    out
}

/// The one element `selector` matches in `dom`, if it matches exactly one.
fn sole_match(dom: &SnapshotDom, selector: &str) -> Option<ElId> {
    match dom.query_all(None, selector).ok()?.as_slice() {
        [el] => Some(*el),
        _ => None,
    }
}

/// Per flagged selector whose element the scan knows, `[id, x, y, width,
/// height]`: the element's id in the scan's capture, which the evidence step
/// resolves before the selector ([`fullpage::RESOLVE_FLAGGED_JS`]), and its
/// document rect there, against which the evidence step measures drift. The
/// first result naming a selector decides, as for [`scan_identities`].
fn scan_nodes(dom: &SnapshotDom, results: &[RawResult]) -> Map<String, Value> {
    let mut out = Map::new();
    let (sx, sy) = (dom.scroll_x(), dom.scroll_y());
    for r in results {
        let Some(selector) = r.selector.as_deref() else { continue };
        if out.contains_key(selector) {
            continue;
        }
        if let Some(el) = r.scan_el {
            let b = dom.rect(el);
            out.insert(selector.to_string(), json!([el, b.left + sx, b.top + sy, b.width, b.height]));
        }
    }
    out
}

/// How long the evidence step keeps measuring an element that sits more than
/// a viewport width from where the scan's capture had it, waiting for it to
/// come back (a carousel cycling round), and how often it looks.
pub const DRIFT_REMEASURE: Duration = Duration::from_millis(1500);
const DRIFT_POLL: Duration = Duration::from_millis(250);

/// The element a visual-contrast result on `selector` was measured on: the
/// match whose box gives the clip of every analysis on that selector (the
/// collector's `clip`, from the capture's rect and scroll). `None` when no
/// single match gives them all, and for a selector with no id, which names
/// one element.
fn visual_scan_element(dom: &SnapshotDom, selector: &str, analyses: &[Value]) -> Option<ElId> {
    if !selector.contains('#') {
        return None;
    }
    let matches = dom.query_all(None, selector).ok()?;
    if matches.len() < 2 {
        return matches.first().copied();
    }
    let (sx, sy) = (dom.scroll_x(), dom.scroll_y());
    let clip_of = |el: ElId| {
        let r = dom.rect(el);
        [
            (r.left + sx - 2.0).floor().max(0.0),
            (r.top + sy - 2.0).floor().max(0.0),
            (r.width + 4.0).ceil().max(1.0),
            (r.height + 4.0).ceil().max(1.0),
        ]
    };
    let mut found: Option<ElId> = None;
    for analysis in analyses
        .iter()
        .filter(|a| a.get("selector").and_then(Value::as_str) == Some(selector))
    {
        let clip = analysis.get("clip")?;
        let num = |k: &str| clip.get(k).and_then(Value::as_f64);
        let want = [num("x")?, num("y")?, num("width")?, num("height")?];
        let hits: Vec<ElId> = matches.iter().copied().filter(|el| clip_of(*el) == want).collect();
        match (hits.as_slice(), found) {
            ([el], None) => found = Some(*el),
            ([el], Some(f)) if *el == f => {}
            _ => return None,
        }
    }
    found
}

/// Element rects, the screenshot and the element shots, after every pass has
/// run, so a live scan and an evidence scan drive the page identically up to
/// here. Failures are recorded on the evidence, never raised: the findings
/// stand without them.
///
/// Each flagged selector is measured on the element the scan flagged while
/// that element is still in the document (`nodes`), and on the selector's
/// match otherwise ([`fullpage::RESOLVE_FLAGGED_JS`]). One found nowhere is
/// [`Evidence::transient`]. One that sits more than a viewport width from
/// where the scan's capture had it is measured again until it comes back or
/// [`DRIFT_REMEASURE`] runs out, and recorded in [`Evidence::element_drift`]
/// if it does not. Returns, parallel to `anchors` (an element of the scan's
/// capture per result, or none), each anchor's [`Evidence::page_anchors`]
/// entry.
fn capture_post_scan(
    page: &mut Page<'_>,
    ev: &mut Evidence,
    request: &EvidenceRequest,
    selectors: &[String],
    identities: &Map<String, Value>,
    nodes: &Map<String, Value>,
    anchors: &[Option<ElId>],
) -> Vec<Option<Value>> {
    let mut anchored: Vec<Option<Value>> = vec![None; anchors.len()];
    if !selectors.is_empty() || anchors.iter().any(Option::is_some) {
        let anchor_ids: Vec<Value> = anchors.iter().map(|a| a.map_or(Value::Null, |id| json!(id))).collect();
        let expr = format!(
            r#"(() => {{
  const props = ['display', 'position', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-transform', 'text-align', 'color', 'background-color', 'background-image', 'border', 'border-radius', 'box-shadow', 'padding', 'margin', 'width', 'height', 'max-width', 'opacity'];
  const resolve = {resolve};
  const identities = {ids};
  const nodes = {nodes};
  const rects = {{}};
  const details = {{}};
  const missing = [];
  const drifted = [];
  const vw = window.innerWidth || 0;
  for (const s of {sels}) {{
    try {{
      const n = nodes[s];
      const el = resolve(s, identities[s], n ? n[0] : null);
      if (!el) {{ missing.push(s); continue; }}
      const r = el.getBoundingClientRect();
      const rect = [r.x + window.scrollX, r.y + window.scrollY, r.width, r.height];
      rects[s] = rect;
      if (n && vw > 0 && Math.max(Math.abs(rect[0] - n[1]), Math.abs(rect[1] - n[2])) > vw) drifted.push(s);
      const cs = getComputedStyle(el);
      const styles = {{}};
      for (const p of props) styles[p] = cs.getPropertyValue(p);
      details[s] = {{
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300),
        html: (el.outerHTML || '').slice(0, 1500),
        styles,
      }};
    }} catch (e) {{}}
  }}
  const cap = window.__impCap;
  const anchors = {anchors}.map(id => {{
    try {{
      const el = id && cap && cap.elements ? cap.elements[id] : null;
      if (!el || !el.isConnected) return null;
      const r = el.getBoundingClientRect();
      if (!(r.width >= 1 && r.height >= 1)) return null;
      return {{
        rect: [r.x + window.scrollX, r.y + window.scrollY, r.width, r.height],
        tag: el.tagName.toLowerCase(),
        id: el.id || '',
        class: typeof el.className === 'string' ? el.className : (el.getAttribute('class') || ''),
      }};
    }} catch (e) {{ return null; }}
  }});
  return {{ rects, details, missing, drifted, anchors }};
}})()"#,
            sels = json!(selectors),
            resolve = fullpage::RESOLVE_FLAGGED_JS,
            ids = Value::Object(identities.clone()),
            nodes = Value::Object(nodes.clone()),
            anchors = Value::Array(anchor_ids),
        );
        if let Ok(v) = page.evaluate_value(&expr) {
            if let Some(Value::Object(m)) = v.get("rects") {
                ev.element_rects = m.clone();
            }
            if let Some(Value::Object(m)) = v.get("details") {
                ev.element_details = m.clone();
            }
            let strs = |k: &str| -> Vec<String> {
                v.get(k)
                    .and_then(Value::as_array)
                    .map(|a| a.iter().filter_map(Value::as_str).map(String::from).collect())
                    .unwrap_or_default()
            };
            ev.transient = strs("missing");
            let drifted = strs("drifted");
            if !drifted.is_empty() {
                remeasure_drifted(page, ev, drifted, identities, nodes);
            }
            if let Some(Value::Array(a)) = v.get("anchors") {
                for (slot, value) in anchored.iter_mut().zip(a) {
                    *slot = Some(value.clone()).filter(|v| !v.is_null());
                }
            }
        }
    }
    if !request.screenshot {
        return anchored;
    }
    match fullpage::capture_full_page(page, request.max_screenshot_height, request.jpeg_quality) {
        Ok(shot) => {
            ev.element_shots = fullpage::capture_element_shots(
                page,
                &ev.element_rects,
                identities,
                nodes,
                shot.origin_x,
                shot.width,
                shot.height,
                request.jpeg_quality,
            );
            ev.screenshot = Some(shot);
        }
        Err(e) => ev.screenshot_error = Some(e.message),
    }
    anchored
}

/// Measure the `drifted` selectors again every [`DRIFT_POLL`] until each is
/// back within a viewport width of where the scan's capture had it, or
/// [`DRIFT_REMEASURE`] runs out. Every measure replaces the rect, so the rect
/// is the latest one before the screenshot that follows; one that never came
/// back is recorded in [`Evidence::element_drift`] with its rect in the
/// capture, and one that left the page during the wait joins
/// [`Evidence::transient`] with no rect. Best-effort: a failed measurement
/// ends the wait.
fn remeasure_drifted(
    page: &mut Page<'_>,
    ev: &mut Evidence,
    mut drifted: Vec<String>,
    identities: &Map<String, Value>,
    nodes: &Map<String, Value>,
) {
    let started = Instant::now();
    while !drifted.is_empty() && started.elapsed() < DRIFT_REMEASURE {
        std::thread::sleep(DRIFT_POLL);
        let expr = format!(
            r#"(() => {{
  const resolve = {resolve};
  const identities = {ids};
  const nodes = {nodes};
  const vw = window.innerWidth || 0;
  const rects = {{}};
  const back = [];
  const gone = [];
  for (const s of {sels}) {{
    try {{
      const n = nodes[s];
      const el = resolve(s, identities[s], n ? n[0] : null);
      if (!el) gone.push(s);
      if (!el || !n) continue;
      const r = el.getBoundingClientRect();
      const rect = [r.x + window.scrollX, r.y + window.scrollY, r.width, r.height];
      rects[s] = rect;
      if (Math.max(Math.abs(rect[0] - n[1]), Math.abs(rect[1] - n[2])) <= vw) back.push(s);
    }} catch (e) {{}}
  }}
  return {{ rects, back, gone }};
}})()"#,
            resolve = fullpage::RESOLVE_FLAGGED_JS,
            ids = Value::Object(identities.clone()),
            nodes = Value::Object(nodes.clone()),
            sels = json!(drifted),
        );
        let Ok(v) = page.evaluate_value(&expr) else { break };
        if let Some(Value::Object(rects)) = v.get("rects") {
            for (selector, rect) in rects {
                ev.element_rects.insert(selector.clone(), rect.clone());
            }
        }
        for selector in v.get("back").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str) {
            drifted.retain(|s| s != selector);
        }
        // One that left the page while it was away has no box in the
        // screenshot that follows: its earlier rect and details go, and it
        // is transient like one the first measure did not find.
        for selector in v.get("gone").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str) {
            drifted.retain(|s| s != selector);
            ev.element_rects.remove(selector);
            ev.element_details.remove(selector);
            if !ev.transient.iter().any(|s| s == selector) {
                ev.transient.push(selector.to_string());
            }
        }
    }
    for selector in drifted {
        let scan = nodes.get(&selector).and_then(Value::as_array).map(|n| Value::Array(n[1..].to_vec()));
        let measured = ev.element_rects.get(&selector).cloned();
        if let (Some(scan), Some(measured)) = (scan, measured) {
            ev.element_drift.insert(selector, json!({ "scan": scan, "measured": measured }));
        }
    }
}

/// Run the consent hide step ([`consent::hide_js`]) and fold what it hid into
/// `report`. Idempotent; each run also catches a banner injected since the
/// last. Best-effort: a failed evaluation hides nothing and is not an error.
/// Returns whether this run changed the page.
fn hide_consent_banners(page: &mut Page<'_>, report: &mut ConsentReport) -> bool {
    match page.evaluate_value(&consent::hide_js()) {
        Ok(v) => {
            report.merge(&v);
            v.get("changed").and_then(Value::as_bool).unwrap_or(false)
        }
        Err(_) => false,
    }
}

/// Run the overlay hide step ([`overlays::hide_js`]) and fold what it hid
/// into `report`. Idempotent and best-effort, like [`hide_consent_banners`].
/// Returns whether this run changed the page.
fn hide_page_overlays(page: &mut Page<'_>, report: &mut OverlayReport) -> bool {
    match page.evaluate_value(&overlays::hide_js()) {
        Ok(v) => {
            report.merge(&v);
            v.get("changed").and_then(Value::as_bool).unwrap_or(false)
        }
        Err(_) => false,
    }
}

/// Wait up to [`overlays::PRELOADER_WAIT_MS`] for every preloader covering
/// the page to go on its own. Returns how long it waited: 0 when none was
/// covering the page, the full budget when one is still there (the hide step
/// then hides it). A failed probe ends the wait.
fn wait_for_preloaders(page: &mut Page<'_>) -> u64 {
    let js = overlays::preloader_probe_js();
    let started = Instant::now();
    let budget = Duration::from_millis(overlays::PRELOADER_WAIT_MS);
    let mut waited = false;
    loop {
        let covering = matches!(page.evaluate_value(&js), Ok(Value::Array(a)) if !a.is_empty());
        if !covering || started.elapsed() >= budget {
            return if waited { started.elapsed().as_millis() as u64 } else { 0 };
        }
        std::thread::sleep(Duration::from_millis(overlays::PRELOADER_POLL_MS));
        waited = true;
    }
}

/// The `measureContentHiddenAfterReveal` reveal sweep: scroll the page top to
/// bottom (revealing lazy / on-scroll content), then back to the top and
/// settle. The hidden-text measure then runs natively over a fresh capture.
fn reveal_sweep(page: &mut Page<'_>) -> Result<(), CdpError> {
    page.evaluate_value(
        r#"(async () => {
    const step = Math.max(200, Math.floor(window.innerHeight * 0.7));
    const max = Math.max(
      document.documentElement.scrollHeight || 0,
      document.body?.scrollHeight || 0,
    );
    for (let y = 0; y <= max; y += step) {
      window.scrollTo({ top: y, left: 0, behavior: 'instant' });
      await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 40)));
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    await new Promise(resolve => setTimeout(resolve, 700));
  })()"#,
    )?;
    Ok(())
}

/// A visual-contrast candidate's identity: its selector, and its match
/// (`[n, count]`) when the selector named several elements in the capture (a
/// repeated id), so copies sharing a selector are not taken for one another.
#[derive(Debug, Clone, PartialEq)]
struct CandidateKey {
    selector: String,
    matched: Option<Value>,
}

impl CandidateKey {
    /// A candidate's or an analysis's key; `None` without a selector.
    fn of(v: &Value) -> Option<CandidateKey> {
        Some(CandidateKey {
            selector: selector_of(v)?,
            matched: v.get("match").filter(|m| m.is_array()).cloned(),
        })
    }

    /// Whether this key names `selector` at `matched`. Without a match on
    /// either side (a selector that named one element), the selector decides.
    fn names(&self, selector: &str, matched: Option<&Value>) -> bool {
        self.selector == selector
            && match (&self.matched, matched) {
                (Some(a), Some(b)) => a == b,
                _ => true,
            }
    }

    fn names_value(&self, v: &Value) -> bool {
        selector_of(v).is_some_and(|s| self.names(&s, v.get("match").filter(|m| m.is_array())))
    }
}

/// The match [`impeccable_core::browser::visual`] records for a candidate on
/// `el` (`[n, count]` among the capture's matches of `selector`), for a
/// selector anchored on an id that names several elements; `None` otherwise.
fn repeated_match(dom: &dyn Dom, selector: &str, el: ElId) -> Option<Value> {
    if !selector.contains('#') {
        return None;
    }
    let matches = dom.query_all(None, selector).ok()?;
    if matches.len() < 2 {
        return None;
    }
    let n = matches.iter().position(|m| *m == el)?;
    Some(json!([n, matches.len()]))
}

/// The findings the analytic and canvas analyses give, and the routed
/// selectors whose element verdict they replace. A selector the element pass
/// already reported keeps that report, except where the element pass handed
/// the text over (`routed`): there an analysis that resolved it (`pass` or
/// `fail`) has read what the walk could not, so its verdict replaces the
/// element pass's, a `fail` with its own finding and a `pass` with none.
fn analysis_findings(
    browser_analyses: &[Value],
    existing_low_contrast: &[String],
    routed: &[CandidateKey],
) -> (Vec<RawResult>, Vec<CandidateKey>) {
    let is_routed = |v: &Value| routed.iter().any(|k| k.names_value(v));
    let findings = browser_analyses
        .iter()
        .filter(|r| {
            let sel = r.get("selector").and_then(Value::as_str);
            truthy(r.get("finding"))
                && (is_routed(r) || !existing_low_contrast.iter().any(|s| Some(s.as_str()) == sel))
        })
        .filter_map(|r| r.get("finding").map(|f| (f, selector_of(r))))
        .map(|(f, selector)| RawResult {
            selector,
            severity: js_str(f.get("severity")),
            ..RawResult::new(origin::VISUAL_CONTRAST, js_str(f.get("id")), js_str(f.get("snippet")))
        })
        .collect();
    let mut superseded: Vec<CandidateKey> = Vec::new();
    for r in browser_analyses {
        let resolved = matches!(r.get("status").and_then(Value::as_str), Some("fail") | Some("pass"));
        if let Some(key) = CandidateKey::of(r).filter(|_| resolved && is_routed(r)) {
            if !superseded.contains(&key) {
                superseded.push(key);
            }
        }
    }
    (findings, superseded)
}

/// `runVisualContrastFallback(page, serializedGroups, options, profile,
/// target)`: the JS post-processing of the analytic/canvas analyses
/// (`analyzeVisualContrast`, computed natively in [`snapshot_engine`]) plus the
/// screenshot pixel fallback for candidates the analyses left unresolved.
fn run_visual_contrast_fallback(
    page: &mut Page<'_>,
    browser_analyses: &[Value],
    serialized_groups: &[Value],
    viewport: Viewport,
    profile: Option<&DetectorProfile>,
    target: &str,
) -> Result<(Vec<RawResult>, Vec<CandidateKey>), EngineError> {
    // Text the element pass hands over rather than scores (see
    // `visual::routed_reason`): its element verdict does not keep the pixels
    // from reading it, and the pixels' verdict replaces that one.
    let routed: Vec<CandidateKey> = browser_analyses
        .iter()
        .filter(|a| a.get("routed").is_some_and(|r| !r.is_null()))
        .filter_map(CandidateKey::of)
        .collect();
    let is_routed = |v: &Value| routed.iter().any(|k| k.names_value(v));
    let existing_low_contrast: Vec<String> = serialized_groups
        .iter()
        .filter(|g| {
            g.get("findings")
                .and_then(Value::as_array)
                .map(|fs| {
                    fs.iter()
                        .any(|f| f.get("type").and_then(Value::as_str) == Some("low-contrast"))
                })
                .unwrap_or(false)
        })
        .filter_map(|g| g.get("selector").and_then(Value::as_str))
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect();

    let (mut findings, mut superseded) =
        analysis_findings(browser_analyses, &existing_low_contrast, &routed);

    // JS `candidates = browserAnalyses.length ? browserAnalyses : collect(...)`.
    // An analysis is the candidate spread with its result, so the analyses are
    // the candidate list; when there are none, there are none to collect.
    let candidates: &[Value] = browser_analyses;

    let browser_resolved: Vec<CandidateKey> = browser_analyses
        .iter()
        .filter(|r| {
            matches!(
                r.get("status").and_then(Value::as_str),
                Some("fail") | Some("pass")
            )
        })
        .filter_map(CandidateKey::of)
        .collect();
    let filtered: Vec<&Value> = candidates
        .iter()
        .filter(|c| {
            let sel = c.get("selector").and_then(Value::as_str);
            (!existing_low_contrast
                .iter()
                .any(|s| Some(s.as_str()) == sel)
                || is_routed(c))
                && !browser_resolved.iter().any(|k| k.names_value(c))
        })
        .collect();
    // Where a clip's x 0 sits: the left edge of a right-to-left page's
    // overflow, asked once for every candidate.
    let origin_x = if filtered.is_empty() { 0.0 } else { screenshot_contrast::scroll_origin_x(page) };
    if !filtered.is_empty() {
        // The pixel pass reads one box twice, once with the text painted and
        // once without. A frame that advances between the two shots turns
        // every pixel in the box into a difference, and the pass would rather
        // say nothing than measure that. Playing media is the one moving thing
        // a scan can hold still without changing what the page shows: a paused
        // video still paints the frame the visitor is looking at.
        let _ = page.evaluate(
            "document.querySelectorAll('video').forEach(v => { try { v.pause(); } catch (e) {} })",
        );
    }
    let mut routed_spent = std::time::Duration::ZERO;
    let mut routed_misses = 0usize;
    let mut pixel_pairs: Vec<String> = Vec::new();
    for candidate in filtered {
        let sel = candidate.get("selector").and_then(Value::as_str);
        // A read the first budget's rules would not have made.
        let extra = is_routed(candidate)
            && (candidate.get("reasons").and_then(Value::as_array).is_some_and(|rs| {
                rs.iter().any(|r| matches!(r.as_str(), Some("unread layer") | Some("text outline")))
            }) || existing_low_contrast.iter().any(|s| Some(s.as_str()) == sel));
        if extra && (routed_spent >= ROUTED_PIXEL_BUDGET || routed_misses >= ROUTED_PIXEL_MISSES) {
            continue;
        }
        let started = std::time::Instant::now();
        let mut measured = false;
        let result = step_findings(profile, "visual-contrast", "pixel-diff", target, || {
            let m = screenshot_contrast::measure_visual_contrast_candidate(
                page,
                candidate,
                viewport.width as f64,
                origin_x,
            )
            .map_err(cdp_err)?;
            measured = m.measured;
            Ok::<_, EngineError>(
                m.finding
                    .map(|f| {
                        vec![RawResult {
                            selector: selector_of(candidate),
                            severity: f.severity.unwrap_or_default(),
                            ..RawResult::new(origin::VISUAL_CONTRAST, f.id.to_string(), f.snippet)
                        }]
                    })
                    .unwrap_or_default(),
            )
        })?;
        if extra {
            let spent = started.elapsed();
            routed_spent += spent;
            // A read refused before its screenshots costs nothing and says
            // nothing about the page.
            if measured {
                routed_misses = 0;
            } else if spent >= ROUTED_PIXEL_SLOW_MISS {
                routed_misses += 1;
            }
        }
        if measured && is_routed(candidate) {
            if let Some(key) = CandidateKey::of(candidate) {
                superseded.push(key);
            }
        }
        let routed_candidate = is_routed(candidate);
        findings.extend(
            result
                .into_iter()
                .filter(|f| {
                    keep_pixel_finding(&mut pixel_pairs, candidate, routed_candidate, &f.severity, &f.snippet)
                }),
        );
    }
    Ok((findings, superseded))
}

/// The colour pair a pixel-pass finding reports: the candidate's ink, its
/// severity and the snippet without the text it quotes, so the ratio, the
/// bar and the reasons. An advisory read on decorative text (an avatar
/// initial) does not claim the pair for counted text wearing it.
fn pixel_pair_key(candidate: &Value, severity: &str, snippet: &str) -> String {
    let text = candidate.get("text").and_then(Value::as_str).unwrap_or("");
    let bare = if text.is_empty() {
        snippet
    } else {
        snippet.strip_suffix(&format!(" \"{text}\"")).unwrap_or(snippet)
    };
    let ink = candidate.get("textColor").map(Value::to_string).unwrap_or_default();
    format!("{ink}\u{1f}{severity}\u{1f}{bare}")
}

/// Whether a pixel-pass finding reports, given the pairs the page's pixel
/// findings already reported (`seen`, which this extends). Text the element
/// pass hands over reports a pair once per page, as the element pass does:
/// auction.co.kr's five header links each sit on a divider sprite, each was
/// routed to the pixels, and each printed the same 4.48:1 for the same ink.
/// A first-budget finding always reports, and claims its pair.
fn keep_pixel_finding(seen: &mut Vec<String>, candidate: &Value, routed: bool, severity: &str, snippet: &str) -> bool {
    let key = pixel_pair_key(candidate, severity, snippet);
    if seen.contains(&key) {
        return !routed;
    }
    seen.push(key);
    true
}

fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().map(|f| f != 0.0 && !f.is_nan()).unwrap_or(false),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_routed_pixel_pair_reports_once_per_page() {
        let link = |text: &str| json!({"selector": "a", "text": text, "textColor": {"r": 51.0, "g": 51.0, "b": 51.0, "a": 1.0}});
        let snippet = |text: &str| {
            format!("pixel contrast 4.48:1 median 4.48:1 (need 4.5:1) on image background, unread layer \"{text}\"")
        };
        let mut seen = Vec::new();
        assert!(keep_pixel_finding(&mut seen, &link("로그인"), true, "warning", &snippet("로그인")));
        assert!(!keep_pixel_finding(&mut seen, &link("회원가입"), true, "warning", &snippet("회원가입")));
        // Another ratio, or another ink, is another pair.
        let other = "pixel contrast 3.9:1 median 3.9:1 (need 4.5:1) on image background, unread layer \"고객센터\"";
        assert!(keep_pixel_finding(&mut seen, &link("고객센터"), true, "warning", other));
        let red = json!({"selector": "a", "text": "장바구니", "textColor": {"r": 200.0, "g": 0.0, "b": 0.0, "a": 1.0}});
        assert!(keep_pixel_finding(&mut seen, &red, true, "warning", &snippet("장바구니")));
        // The first budget always reports.
        assert!(keep_pixel_finding(&mut seen, &link("마이페이지"), false, "warning", &snippet("마이페이지")));
        // An advisory read on decorative text does not claim the pair for
        // counted text wearing it (an avatar initial and a digit beside it).
        assert!(keep_pixel_finding(&mut seen, &link("S"), true, "advisory", &snippet("S")));
        assert!(!keep_pixel_finding(&mut seen, &link("T"), true, "advisory", &snippet("T")));
    }

    #[test]
    fn a_resolved_analysis_replaces_a_routed_element_verdict() {
        let analyses = vec![
            // Routed (the walk never read the photo) and resolved as a fail.
            json!({"selector": "#photo-copy", "routed": "unread layer", "status": "fail",
                   "finding": {"id": "low-contrast", "snippet": "browser contrast 1.2:1", "severity": "warning"}}),
            // Routed and resolved as a pass: no finding of its own.
            json!({"selector": "#photo-ok", "routed": "unread layer", "status": "pass"}),
            // Not routed, already reported by the element pass: that stays.
            json!({"selector": "#plain", "status": "fail",
                   "finding": {"id": "low-contrast", "snippet": "browser contrast 2.0:1", "severity": "warning"}}),
            // Routed but unresolved: the pixel pass decides.
            json!({"selector": "#vector", "routed": "unread layer", "status": "unresolved"}),
        ];
        let existing: Vec<String> = ["#photo-copy", "#photo-ok", "#plain", "#vector"].iter().map(|s| s.to_string()).collect();
        let routed: Vec<CandidateKey> = analyses.iter().filter(|a| a.get("routed").is_some()).filter_map(CandidateKey::of).collect();
        let (findings, superseded) = analysis_findings(&analyses, &existing, &routed);
        let sels: Vec<&str> = findings.iter().filter_map(|f| f.selector.as_deref()).collect();
        assert_eq!(sels, vec!["#photo-copy"]);
        let superseded: Vec<&str> = superseded.iter().map(|k| k.selector.as_str()).collect();
        assert_eq!(superseded, vec!["#photo-copy", "#photo-ok"]);
    }

    /// Two copies of a repeated id are two candidates: the copy an analysis
    /// resolved is superseded, its unresolved twin stays routed to the
    /// pixels, and the element pass's verdict on the twin stands.
    #[test]
    fn copies_of_a_repeated_id_are_settled_apart() {
        let analyses = vec![
            json!({"selector": "#hero > p", "match": [0, 2], "routed": "unread layer", "status": "pass"}),
            json!({"selector": "#hero > p", "match": [1, 2], "routed": "unread layer", "status": "unresolved"}),
        ];
        let existing = vec!["#hero > p".to_string()];
        let routed: Vec<CandidateKey> = analyses.iter().filter_map(CandidateKey::of).collect();
        let (_, superseded) = analysis_findings(&analyses, &existing, &routed);
        assert_eq!(superseded, vec![CandidateKey { selector: "#hero > p".into(), matched: Some(json!([0, 2])) }]);
        // The unresolved copy is not taken for the resolved one.
        assert!(!superseded[0].names_value(&analyses[1]));
        assert!(superseded[0].names_value(&analyses[0]));
        // A selector that named one element has no match, and the selector decides.
        let single = CandidateKey::of(&json!({"selector": "#solo"})).unwrap();
        assert!(single.names("#solo", Some(&json!([1, 2]))));

        let verdict = |n: u64| RawResult {
            selector: Some("#hero > p".into()),
            ..RawResult::new(origin::VISUAL_CONTRAST, "low-contrast".into(), format!("copy {n}"))
        };
        let mut results = vec![verdict(0), verdict(1)];
        let copy_of = |r: &RawResult| r.snippet.strip_prefix("copy ").and_then(|n| n.parse::<u64>().ok());
        settle_handed_over(&mut results, &superseded, |r| copy_of(r).map(|n| json!([n, 2])));
        let left: Vec<(&str, &str)> = results.iter().map(|r| (r.snippet.as_str(), r.severity.as_str())).collect();
        assert_eq!(left, vec![("copy 1", "advisory")]);
    }

    #[test]
    fn ad_tech_errors_never_take_a_counted_errors_slot() {
        let prebid = |n: u32| (format!("Uncaught Error: bid {n}"), Some(format!("at https://example.com/prebid/prebid-p{n}.js:1:1")));
        let mut errors: Vec<(String, Option<String>)> = (1..=4).map(prebid).collect();
        errors.push(("Uncaught TypeError: cart is undefined".to_string(), Some("at https://example.com/js/app.js:1:1".to_string())));
        for n in 1..=4 {
            errors.push((format!("Uncaught Error: first-party {n}"), None));
        }
        let results = capped_script_errors(errors.iter().map(|(m, s)| (m.as_str(), s.as_deref())));
        let summary: Vec<(bool, &str)> =
            results.iter().map(|r| (r.severity == "advisory", r.snippet.as_str())).collect();
        assert_eq!(summary.len(), 6, "{summary:?}");
        // Three ad-tech errors, in arrival order; the fourth is capped.
        assert!(summary[..3].iter().all(|(advisory, s)| *advisory && s.contains("(third-party: Prebid)")));
        // The first-party error after them still reports, counted, and the
        // counted cap stops at three of its own.
        assert_eq!(summary[3], (false, "Uncaught TypeError: cart is undefined (at https://example.com/js/app.js:1:1)"));
        assert_eq!(summary[4], (false, "Uncaught Error: first-party 1"));
        assert_eq!(summary[5], (false, "Uncaught Error: first-party 2"));
    }

    /// r6-t5-unread-pixel-verdicts: a handed-over verdict the pixels read is
    /// replaced; one they did not read stands as advisory, text unchanged;
    /// nothing else moves.
    #[test]
    fn unread_handed_over_verdicts_are_advisory() {
        let result = |origin: &'static str, id: &str, sel: &str, severity: &str| RawResult {
            selector: Some(sel.to_string()),
            severity: severity.to_string(),
            ..RawResult::new(origin, id.to_string(), format!("{id} on {sel}"))
        };
        let mut results = vec![
            result(origin::VISUAL_CONTRAST, "low-contrast", "#read", ""),
            result(origin::VISUAL_CONTRAST, "low-contrast", "#unread", ""),
            result(origin::SCAN, "low-contrast", "#scored", ""),
            result(origin::SCAN, "tiny-text", "#unread", ""),
        ];
        settle_handed_over(&mut results, &[CandidateKey { selector: "#read".into(), matched: None }], |_| None);
        let summary: Vec<(&str, &str, &str)> =
            results.iter().map(|r| (r.origin, r.snippet.as_str(), r.severity.as_str())).collect();
        assert_eq!(
            summary,
            vec![
                (origin::VISUAL_CONTRAST, "low-contrast on #unread", "advisory"),
                (origin::SCAN, "low-contrast on #scored", ""),
                (origin::SCAN, "tiny-text on #unread", ""),
            ]
        );
        let (findings, _) = results_to_findings("https://example.com/", results, None).unwrap();
        assert_eq!((findings[0].severity.as_str(), findings[0].advisory), ("advisory", Some(true)));
        assert_ne!(findings[1].severity, "advisory");
    }

    #[test]
    fn design_system_serialization_shape() {
        assert!(serialize_design_system_for_browser(None).is_null());
        let ds = DesignSystem::default();
        assert!(serialize_design_system_for_browser(Some(&ds)).is_null());
    }

    #[test]
    fn group_findings_carry_the_group_selector() {
        let groups = vec![json!({
            "selector": "main > h1",
            "findings": [
                { "type": "tight-leading", "detail": "line-height 1.15x (need >=1.3)", "ignoreValue": "", "severity": "warning" },
            ],
        })];
        let (findings, origins) =
            results_to_findings("https://example.com/", results_from_groups(&groups), None).unwrap();
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].extras.get("selector"), Some(&json!("main > h1")));
        assert_eq!(origins, vec![origin::SCAN]);
        let text = serde_json::to_string(&findings[0]).unwrap();
        assert!(text.ends_with(r#""line":0,"snippet":"line-height 1.15x (need >=1.3)","selector":"main > h1"}"#));
    }

    /// A vendor the serialized group names travels onto the finding, after
    /// its selector.
    #[test]
    fn group_findings_carry_their_vendor() {
        let groups = vec![json!({
            "selector": "div.videoCube > button",
            "findings": [
                { "type": "undersized-ui-text", "detail": "10px functional text \"Learn More\" (below 11px floor) (third-party: Taboola)", "ignoreValue": "", "severity": "warning", "thirdParty": "Taboola" },
            ],
        })];
        let (findings, _) =
            results_to_findings("https://example.com/", results_from_groups(&groups), None).unwrap();
        assert_eq!(findings[0].severity, "warning");
        let text = serde_json::to_string(&findings[0]).unwrap();
        assert!(text.ends_with(r#"(third-party: Taboola)","selector":"div.videoCube > button","thirdParty":"Taboola"}"#), "{text}");
    }

    /// r3-31-script-error-ad-tech: an ad-tech error is advisory and names its
    /// vendor; anything else is the rule's error.
    #[test]
    fn ad_tech_script_errors_are_advisory() {
        let r = script_error_result(
            "Uncaught TypeError: a.__fbeventsModules[e] is not a function",
            Some("at a.getFbeventsModules, https://connect.facebook.net/signals/config/1:20:4472"),
        );
        let (findings, _) = results_to_findings("https://example.com/", vec![r], None).unwrap();
        let f = &findings[0];
        assert_eq!((f.severity.as_str(), f.advisory), ("advisory", Some(true)));
        assert_eq!(
            f.snippet,
            "Uncaught TypeError: a.__fbeventsModules[e] is not a function (at a.getFbeventsModules, https://connect.facebook.net/signals/config/1:20:4472) (third-party: Meta Pixel)"
        );
        assert_eq!(f.extras.get("thirdParty"), Some(&json!("Meta Pixel")));

        let r = script_error_result("Uncaught TypeError: cart is undefined", Some("at renderCart, https://shop.example/app.js:1:1"));
        let (findings, _) = results_to_findings("https://example.com/", vec![r], None).unwrap();
        assert_eq!((findings[0].severity.as_str(), findings[0].advisory), ("error", None));
        assert!(findings[0].extras.get("thirdParty").is_none());
    }

    /// r5-p13-script-error-hydration: React's recoverable hydration errors
    /// are advisory, text unchanged; other React invariants and first-party
    /// errors stay the rule's error, and the chain takes no counted slot.
    #[test]
    fn recoverable_hydration_errors_are_advisory() {
        let src = Some("at rK, https://www.example.com/_next/static/chunks/app.js:1:46331");
        let chain = [
            "Uncaught Error: Minified React error #418: Hydration failed because the initial UI does not match what was rendered on the server.",
            "Uncaught Error: Minified React error #423: There was an error while hydrating. Because the error happened outside of a Suspense boundary, the entire root will switch to client rendering.",
            "Uncaught Error: Minified React error #425: Text content does not match server-rendered HTML.",
            "Uncaught Error: Minified React error #422: There was an error while hydrating this Suspense boundary. Switched to client rendering.",
        ];
        let own = [
            "Uncaught Error: Minified React error #185: Maximum update depth exceeded.",
            "Uncaught TypeError: $.evo.article is not a function",
            "Uncaught TypeError: $.evo.io is not a function",
            "Uncaught TypeError: cart is undefined",
        ];
        let results = capped_script_errors(chain.iter().chain(own.iter()).map(|m| (*m, src)));
        let (findings, _) = results_to_findings("https://example.com/", results, None).unwrap();
        let summary: Vec<(&str, Option<bool>, &str)> =
            findings.iter().map(|f| (f.severity.as_str(), f.advisory, f.snippet.as_str())).collect();
        // Three of the four hydration errors (their own cap), then three of
        // the four counted ones.
        assert_eq!(summary.len(), 6, "{summary:#?}");
        for (i, message) in chain[..3].iter().enumerate() {
            assert_eq!(summary[i], ("advisory", Some(true), format!("{message} ({})", src.unwrap()).as_str()));
            assert!(findings[i].extras.get("thirdParty").is_none());
        }
        for (i, message) in own[..3].iter().enumerate() {
            assert_eq!(summary[3 + i], ("error", None, format!("{message} ({})", src.unwrap()).as_str()));
        }
    }

    /// A design system that declares a purple drops the purple forms of
    /// ai-color-palette from a URL scan and keeps the evidence origins in step.
    #[test]
    fn a_declared_purple_drops_the_purple_forms() {
        let fm: Map<String, Value> = serde_json::from_value(json!({ "colors": { "primary": "#6d28d9" } })).unwrap();
        let ds = impeccable_detect::design_system::normalize_design_system(Some(&fm), None, None, None, false);
        let results = vec![
            RawResult::new(origin::SCAN, "ai-color-palette".into(), "Purple/violet gradient background".into()),
            RawResult::new(origin::SCAN, "ai-color-palette".into(), "Cyan gradient background".into()),
            RawResult::new(origin::SCRIPT_ERROR, "script-error".into(), "Uncaught Error: x".into()),
        ];
        let (findings, origins) = results_to_findings("file:///p/index.html", results, Some(&ds)).unwrap();
        let snippets: Vec<&str> = findings.iter().map(|f| f.snippet.as_str()).collect();
        assert_eq!(snippets, vec!["Cyan gradient background", "Uncaught Error: x"]);
        assert_eq!(origins, vec![origin::SCAN, origin::SCRIPT_ERROR]);
    }

    // Expected values come from tests/detect-url-launch.test.mjs (issue #657).
    #[test]
    fn split_scan_url_matches_js() {
        let creds = |u: &str, p: &str| {
            Some(ScanCredentials {
                username: u.to_string(),
                password: p.to_string(),
            })
        };
        assert_eq!(
            split_scan_url("https://user:pass@example.com"),
            ("https://example.com/".to_string(), creds("user", "pass"))
        );
        assert_eq!(
            split_scan_url("https://user:p%40ss@example.com/path?q=1"),
            (
                "https://example.com/path?q=1".to_string(),
                creds("user", "p@ss")
            )
        );
        assert_eq!(
            split_scan_url("https://user@example.com"),
            ("https://example.com/".to_string(), creds("user", ""))
        );
        assert_eq!(
            split_scan_url("http://:secret@host.com/"),
            ("http://host.com/".to_string(), creds("", "secret"))
        );
        assert_eq!(
            split_scan_url("https://example.com"),
            ("https://example.com".to_string(), None)
        );
        assert_eq!(
            split_scan_url("https://example.com/path?email=a@b.com"),
            ("https://example.com/path?email=a@b.com".to_string(), None)
        );
        assert_eq!(
            split_scan_url("https://user:pass@[::1]:8080/x"),
            ("https://[::1]:8080/x".to_string(), creds("user", "pass"))
        );
        assert_eq!(
            split_scan_url("file:///tmp/a.html"),
            ("file:///tmp/a.html".to_string(), None)
        );
        assert_eq!(
            split_scan_url("not a url"),
            ("not a url".to_string(), None)
        );
    }
}
