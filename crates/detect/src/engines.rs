//! The two engine seams `impeccable detect` calls into but does not own:
//! the static HTML engine (crates/html) and the browser/URL engine
//! (crates/browser). `detect` never depends on those crates; the `cli` binary
//! wires concrete engines in through `Engines`.

use std::rc::Rc;

use impeccable_core::findings::Finding;
use impeccable_core::rule_pack::RulePack;

use crate::design_system::DesignSystem;
use crate::profiler::DetectorProfile;

/// The per-target scan options `detectCli` builds (`baseScanOptions` plus the
/// target's own design system).
#[derive(Clone, Default)]
pub struct ScanOptions {
    /// JS `options.inlineIgnores` (false under `--no-config` / `--no-inline-ignores`).
    pub inline_ignores: bool,
    /// JS `options.designSystem` (only when a DESIGN.md governs the target).
    pub design_system: Option<Rc<DesignSystem>>,
    /// JS `options.viewport` (browser scans only).
    pub viewport: Option<(u32, u32)>,
    /// JS `options.profile` (library callers only; no CLI flag).
    pub profile: Option<Rc<DetectorProfile>>,
    /// The installed rule pack (`impeccable_core::rule_pack`), passed through
    /// to the text engine and on to the HTML engine. `None` in the `impeccable`
    /// binary, which ships the built-in rules only.
    pub rule_pack: Option<&'static dyn RulePack>,
    /// URL scans only: leave known consent managers' banners on the page
    /// (`--no-consent-hiding`). By default the browser engine hides them
    /// before the rule pass.
    pub keep_consent_banners: bool,
    /// URL scans only: leave product tours, site-builder badges and
    /// preloaders on the page (`--no-overlay-hiding`). By default the browser
    /// engine waits briefly for a preloader and hides what is left, and hides
    /// known tours and badges, before the rule pass.
    pub keep_overlays: bool,
    /// URL scans only: rules whose findings the CLI removes after the scan
    /// (`ignoreRules`, and every rule outside the requested `--scope`s). The
    /// browser engine reports them as before; it only stops letting one of
    /// them stand in for another rule's finding (vanishing ink).
    pub unreported_rules: Vec<String>,
    /// Whether `detector.ignoreFiles` waives a linked stylesheet (given its
    /// absolute path). The static HTML engine still reads it for the cascade
    /// but leaves it out of the page-level pattern scan.
    pub ignored_linked_stylesheet: Option<Rc<dyn Fn(&str) -> bool>>,
}

/// A URL scan's findings plus the notes the CLI prints about how the page
/// was scanned (a consent banner or a preloader the engine hid, say).
#[derive(Debug, Default)]
pub struct UrlScan {
    pub findings: Vec<Finding>,
    pub notes: Vec<String>,
}

/// An error an engine raises; `detectCli` reports it the way the JS surfaces
/// an uncaught exception (`cli.js` catch: `console.error(message)`, exit 1)
/// or, for URL scans, `Error: ${message}` and continues.
#[derive(Debug, Clone, PartialEq)]
pub struct EngineError {
    pub message: String,
}

impl EngineError {
    pub fn new(message: impl Into<String>) -> Self {
        EngineError {
            message: message.into(),
        }
    }
}

/// The static HTML engine (`cli/engine/engines/static-html/detect-html.mjs`
/// `detectHtml(filePath, options)`). Implemented by crates/html.
pub trait HtmlEngine {
    /// Scan one `.html` / `.htm` file. Any stderr the engine writes (the JS
    /// DEGRADED notice) goes through `stderr`.
    fn detect_html(
        &self,
        path: &str,
        options: &ScanOptions,
        stderr: &mut dyn std::io::Write,
    ) -> Result<Vec<Finding>, EngineError>;
}

/// The browser engine (`cli/engine/engines/browser/detect-url.mjs`
/// `detectUrl(url, options)` and `createBrowserDetector()`). Implemented by
/// crates/browser.
pub trait UrlEngine {
    /// A single-URL scan (`detectUrl`: `waitUntil: 'networkidle0'`, `settleMs: 0`).
    fn detect_url(&self, url: &str, options: &ScanOptions) -> Result<Vec<Finding>, EngineError>;
    /// [`UrlEngine::detect_url`] plus notes for the text output. Engines with
    /// nothing to say keep the default.
    fn detect_url_scan(&self, url: &str, options: &ScanOptions) -> Result<UrlScan, EngineError> {
        Ok(UrlScan { findings: self.detect_url(url, options)?, notes: Vec::new() })
    }
    /// A shared-browser session for multi-URL scans (`createBrowserDetector()`:
    /// `waitUntil: 'load'`, `settleMs: 100`). Return `None` when the engine has
    /// no shared mode; `detect_url` is used per target instead.
    fn open_shared(&self) -> Option<Box<dyn SharedBrowser + '_>> {
        None
    }
    /// `--cdp`: scan a page of an app that is already running, through its
    /// DevTools endpoint, with the same passes and output as a URL scan. The
    /// engine attaches without launching, navigating, resizing or closing
    /// anything, and leaves the page as it found it. `target` is the
    /// `--target` substring of the page's URL or title.
    fn detect_cdp_scan(
        &self,
        _endpoint: &crate::cdp_endpoint::CdpEndpoint,
        _target: Option<&str>,
        _options: &ScanOptions,
    ) -> Result<UrlScan, EngineError> {
        Err(EngineError::new("this build cannot attach to a running app (--cdp)"))
    }
}

/// A `createBrowserDetector()` handle: `detectUrl` per target, `close()` at the end.
pub trait SharedBrowser {
    fn detect_url(&self, url: &str, options: &ScanOptions) -> Result<Vec<Finding>, EngineError>;
    /// [`SharedBrowser::detect_url`] plus notes, as [`UrlEngine::detect_url_scan`].
    fn detect_url_scan(&self, url: &str, options: &ScanOptions) -> Result<UrlScan, EngineError> {
        Ok(UrlScan { findings: self.detect_url(url, options)?, notes: Vec::new() })
    }
    fn close(&self);
    /// The eager half of `createBrowserDetector()`: bring the browser up now,
    /// so a launch failure is reported once before the loop and every URL
    /// target is skipped, exactly as the JS `await createBrowserDetector()`
    /// throw does (#711). Engines with nothing to launch keep the default.
    fn ensure_launched(&self) -> Result<(), EngineError> {
        Ok(())
    }
}

/// The engines available to one `detect` run.
pub struct Engines<'a> {
    pub html: &'a dyn HtmlEngine,
    pub url: Option<&'a dyn UrlEngine>,
}

/// Fallback for a build that does not link crates/html (the `cli` binary
/// registers `impeccable_html::StaticHtmlEngine`). The JS only degrades to the regex
/// engine when its parser *modules* fail to import (an install problem, never
/// the case for a compiled binary), so a missing engine here is an internal
/// error: `detectCli` prints the message and exits 1, mirroring an uncaught
/// exception in the JS.
pub struct MissingHtmlEngine;

impl HtmlEngine for MissingHtmlEngine {
    fn detect_html(
        &self,
        _path: &str,
        _options: &ScanOptions,
        _stderr: &mut dyn std::io::Write,
    ) -> Result<Vec<Finding>, EngineError> {
        Err(EngineError::new(
            "impeccable detect: static HTML engine is not linked into this build",
        ))
    }
}

/// Placeholder until crates/browser lands: reports what the JS reports when
/// puppeteer is missing.
pub struct MissingUrlEngine;

impl UrlEngine for MissingUrlEngine {
    fn detect_url(&self, _url: &str, _options: &ScanOptions) -> Result<Vec<Finding>, EngineError> {
        Err(EngineError::new(
            "puppeteer is required for URL scanning. Install: npm install puppeteer",
        ))
    }
}
