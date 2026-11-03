//! `impeccable detect --cdp`: scan a page of a Chromium-based app that is
//! already running (Electron, NW.js, CEF, WebView2) through its DevTools
//! endpoint, with the URL scan's passes and output.
//!
//! The session does not own anything it touches. It never launches or closes
//! the browser, never navigates, reloads or resizes, and changes no
//! emulation. What the scan does change it puts back, on success and on
//! error ([`RESTORE_JS`]): scroll positions (the window and every scroller,
//! open shadow roots included), the videos the pixel pass paused, and the
//! style element and marker attributes that pass adds. Restoring first
//! cancels the scan's waits, so page-side work an evaluation left running
//! (one that outlived its protocol timeout) cannot move the page again. Consent and overlay hiding stay off:
//! the person seeded the state they want reviewed, and hiding part of it
//! would change what they see.
//!
//! Every evaluation runs in an isolated world ([`Browser::attach_page`]), so
//! the app's scripts never see the scan's globals, and the capture reads the
//! untouched built-ins whatever the app did to its own (#1011 without the
//! new-document prelude a URL scan relies on). That world has the timer
//! shim [`PREPARE_JS`] installs: a window hidden behind others or minimized
//! pauses `requestAnimationFrame` and throttles timers to a second or more,
//! which would stall every wait the passes make. Runtime.evaluate is not
//! subject to the page's Content-Security-Policy, so the capture works under
//! a strict CSP; a `style-src` without `'unsafe-inline'` still blocks the
//! pixel pass's hide style, as it does in a URL scan, and the pass then
//! reports no pixel verdicts.

use std::io::{Read, Write};
use std::net::ToSocketAddrs;
use std::time::Duration;

use impeccable_detect::cdp_endpoint::{is_loopback_host, CdpEndpoint};
use impeccable_detect::engines::{EngineError, ScanOptions, UrlScan};
use serde_json::Value;

use crate::cdp::{connect_tcp, Browser, Page, Viewport};
use crate::consent::ConsentReport;
use crate::overlays::OverlayReport;

const HTTP_TIMEOUT: Duration = Duration::from_secs(5);

/// One page the browser reports (`Target.getTargets`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PageTarget {
    pub id: String,
    pub url: String,
    pub title: String,
}

/// The pages a person can mean: `page` targets other than DevTools windows.
pub fn page_targets(targets: &[Value]) -> Vec<PageTarget> {
    targets
        .iter()
        .filter(|t| t.get("type").and_then(Value::as_str) == Some("page"))
        .map(|t| {
            let s = |k: &str| t.get(k).and_then(Value::as_str).unwrap_or("").to_string();
            PageTarget { id: s("targetId"), url: s("url"), title: s("title") }
        })
        .filter(|t| !t.url.starts_with("devtools://"))
        .collect()
}

/// Pick the page to scan: the one `page_id` names (a page's `ws://` URL), else
/// the one whose URL or title contains `filter` (case-insensitive) or whose
/// id it is, else the only page. Anything else is an error that lists the
/// candidates, so the caller can rerun with `--target`.
pub fn pick_target(
    pages: &[PageTarget],
    filter: Option<&str>,
    page_id: Option<&str>,
    authority: &str,
) -> Result<PageTarget, String> {
    if let Some(id) = page_id {
        return pages
            .iter()
            .find(|p| p.id.eq_ignore_ascii_case(id))
            .cloned()
            .ok_or_else(|| format!("no page with id {id} is open on {authority}.{}", listing(pages)));
    }
    if pages.is_empty() {
        return Err(format!("no pages are open on {authority} to scan."));
    }
    let matched: Vec<&PageTarget> = match filter {
        Some(f) => {
            let needle = f.to_lowercase();
            pages
                .iter()
                .filter(|p| {
                    p.url.to_lowercase().contains(&needle)
                        || p.title.to_lowercase().contains(&needle)
                        || p.id.eq_ignore_ascii_case(f)
                })
                .collect()
        }
        None => pages.iter().collect(),
    };
    match (matched.as_slice(), filter) {
        ([one], _) => Ok((*one).clone()),
        ([], Some(f)) => Err(format!(
            "no page on {authority} has a URL or title containing \"{f}\".{}",
            listing(pages)
        )),
        (many, Some(f)) => Err(format!(
            "{} pages on {authority} match \"{f}\". Rerun with a --target that names one of them (a longer part of its URL or title, or its id):{}",
            many.len(),
            listing_of(many)
        )),
        (many, None) => Err(format!(
            "{} pages are open on {authority}. Rerun with --target and part of the URL or title of the one to scan (or its id):{}",
            many.len(),
            listing_of(many)
        )),
    }
}

fn listing(pages: &[PageTarget]) -> String {
    if pages.is_empty() {
        return " No pages are open.".to_string();
    }
    format!(" Open pages:{}", listing_of(&pages.iter().collect::<Vec<_>>()))
}

fn listing_of(pages: &[&PageTarget]) -> String {
    pages
        .iter()
        .map(|p| {
            let title = if p.title.is_empty() { String::new() } else { format!("  \"{}\"", p.title) };
            format!("\n  {}{title}  (id {})", if p.url.is_empty() { "(no URL)" } else { &p.url }, p.id)
        })
        .collect()
}

/// The hint every failure to reach the endpoint ends with.
fn launch_hint(port: u16) -> String {
    format!(
        "Start the app with --remote-debugging-port={port} (Electron, NW.js, CEF; for WebView2 set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port={port}), then run this again."
    )
}

/// Refuse a host that resolves to anything but loopback. The CLI already
/// checked the spelling; this checks where `localhost` actually points.
fn ensure_loopback(endpoint: &CdpEndpoint) -> Result<(), String> {
    if !is_loopback_host(&endpoint.host) {
        return Err(format!("--cdp only attaches to this machine, not {}", endpoint.host));
    }
    if let Ok(addrs) = endpoint.authority().to_socket_addrs() {
        if let Some(addr) = addrs.into_iter().find(|a| !a.ip().is_loopback()) {
            return Err(format!(
                "{} resolves to {}, which is not this machine; --cdp only attaches to a loopback address",
                endpoint.host,
                addr.ip()
            ));
        }
    }
    Ok(())
}

/// A tiny HTTP/1.1 GET for the DevTools discovery endpoints. Returns the
/// body of a 200 response.
fn http_get(authority: &str, path: &str) -> std::io::Result<(u16, String)> {
    let mut stream = connect_tcp(authority, HTTP_TIMEOUT)?;
    stream.set_read_timeout(Some(HTTP_TIMEOUT))?;
    stream.set_write_timeout(Some(HTTP_TIMEOUT))?;
    write!(
        stream,
        "GET {path} HTTP/1.1\r\nHost: {authority}\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
    )?;
    let mut buf: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 16 * 1024];
    let mut body_at: Option<usize> = None;
    let mut length: Option<usize> = None;
    loop {
        let n = match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) if buf.is_empty() => return Err(e),
            Err(_) => break,
        };
        buf.extend_from_slice(&chunk[..n]);
        if body_at.is_none() {
            if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                body_at = Some(i + 4);
                let head = String::from_utf8_lossy(&buf[..i]).to_ascii_lowercase();
                length = head
                    .lines()
                    .find_map(|l| l.strip_prefix("content-length:"))
                    .and_then(|v| v.trim().parse().ok());
            }
        }
        if let (Some(at), Some(len)) = (body_at, length) {
            if buf.len() >= at + len {
                break;
            }
        }
        if buf.len() > 16 * 1024 * 1024 {
            break;
        }
    }
    let at = body_at.ok_or_else(|| std::io::Error::other("no HTTP response"))?;
    let head = String::from_utf8_lossy(&buf[..at]);
    let status = head
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse::<u16>().ok())
        .ok_or_else(|| std::io::Error::other("no HTTP status"))?;
    let end = length.map_or(buf.len(), |l| (at + l).min(buf.len()));
    Ok((status, String::from_utf8_lossy(&buf[at..end]).into_owned()))
}

/// The browser's DevTools websocket, dialled at the endpoint the person gave
/// (the host `/json/version` writes into its URL is ignored, so a report of
/// `0.0.0.0` or a hostname never moves the connection off loopback).
pub fn browser_ws_url(endpoint: &CdpEndpoint) -> Result<String, String> {
    let authority = endpoint.authority();
    if let Some(path) = &endpoint.browser_path {
        return Ok(format!("ws://{authority}{path}"));
    }
    let (status, body) = http_get(&authority, "/json/version").map_err(|e| {
        format!("could not reach a DevTools endpoint at {authority} ({e}). {}", launch_hint(endpoint.port))
    })?;
    let not_devtools = || {
        format!(
            "{authority} answered, but not as a DevTools endpoint (GET /json/version: {}). {}",
            if status == 200 { "no webSocketDebuggerUrl".to_string() } else { format!("HTTP {status}") },
            launch_hint(endpoint.port)
        )
    };
    if status != 200 {
        return Err(not_devtools());
    }
    let ws = serde_json::from_str::<Value>(&body)
        .ok()
        .and_then(|v| v.get("webSocketDebuggerUrl").and_then(Value::as_str).map(String::from))
        .ok_or_else(not_devtools)?;
    let path = ws
        .strip_prefix("ws://")
        .or_else(|| ws.strip_prefix("wss://"))
        .and_then(|rest| rest.find('/').map(|i| rest[i..].to_string()))
        .filter(|p| p.starts_with("/devtools/browser/"))
        .ok_or_else(not_devtools)?;
    Ok(format!("ws://{authority}{path}"))
}

/// The scan's timer shim and the state it will put back, in the isolated
/// world, before any pass runs.
///
/// - `setTimeout` and `clearTimeout`: while the document is hidden, a wait is
///   a run of message tasks that ends when its time is up, since timers in a
///   hidden page fire a second or more late (and once a minute after five
///   minutes hidden). Visible, they are the native ones.
/// - `requestAnimationFrame` fires on the next frame or after 100ms,
///   whichever comes first, so a frame wait never hangs on a window that
///   paints no frames.
/// - Once [`RESTORE_JS`] sets `__impeccableAttachCancelled`, neither calls
///   anything back, so an async pass still running page-side stops at its
///   next wait instead of scrolling the restored page.
///
/// The page's own globals are untouched: these are the isolated world's.
pub const PREPARE_JS: &str = r#"(() => {
  const g = globalThis;
  if (!g.__impeccableAttachShim) {
    const nativeSetTimeout = g.setTimeout.bind(g);
    const nativeClearTimeout = g.clearTimeout.bind(g);
    const nativeRaf = g.requestAnimationFrame.bind(g);
    const live = new Map();
    let next = 0;
    const spin = (id, ms, run) => {
      const end = performance.now() + ms;
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        if (!live.has(id)) { channel.port1.close(); return; }
        const left = end - performance.now();
        if (left <= 0) {
          live.delete(id);
          channel.port1.close();
          run();
        } else if (document.visibilityState !== 'hidden') {
          // Shown again: the native timer is prompt for the rest.
          channel.port1.close();
          live.set(id, nativeSetTimeout(() => { live.delete(id); run(); }, left));
        } else {
          channel.port2.postMessage(0);
        }
      };
      channel.port2.postMessage(0);
    };
    g.setTimeout = (cb, ms, ...args) => {
      const id = ++next;
      const wait = Math.max(0, Number(ms) || 0);
      const run = () => { if (!g.__impeccableAttachCancelled && typeof cb === 'function') cb(...args); };
      if (document.visibilityState === 'hidden') {
        live.set(id, null);
        spin(id, wait, run);
      } else {
        live.set(id, nativeSetTimeout(() => { live.delete(id); run(); }, wait));
      }
      return id;
    };
    g.clearTimeout = (id) => {
      const handle = live.get(id);
      live.delete(id);
      if (handle != null) nativeClearTimeout(handle);
    };
    g.requestAnimationFrame = (cb) => {
      let done = false;
      const fire = () => { if (!done) { done = true; if (!g.__impeccableAttachCancelled) cb(performance.now()); } };
      nativeRaf(fire);
      g.setTimeout(fire, 100);
      return 0;
    };
    g.__impeccableAttachShim = true;
  }
  const scrolled = [];
  const walk = (root) => {
    for (const el of root.querySelectorAll('*')) {
      if (el.scrollTop || el.scrollLeft) scrolled.push([el, el.scrollTop, el.scrollLeft]);
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(document);
  g.__impeccableAttachCancelled = false;
  g.__impeccableAttach = {
    x: window.scrollX,
    y: window.scrollY,
    scrolled,
    hideStyle: !!document.getElementById('impeccable-visual-contrast-hide-style'),
  };
  return { hidden: document.visibilityState === 'hidden', scrollers: scrolled.length };
})()"#;

/// Put back what [`PREPARE_JS`] recorded: first cancel the scan's waits,
/// then every scroller at its old position (a scroller the scan moved off 0
/// back to 0), the window last, the videos the pixel pass paused
/// (`__impeccablePausedMedia`) playing again unless they have ended, and the
/// pixel pass's style element and marker attributes gone. Then the scan's
/// own globals go, so the isolated world holds no references to the page's
/// elements.
pub const RESTORE_JS: &str = r#"(() => {
  const g = globalThis;
  g.__impeccableAttachCancelled = true;
  const saved = g.__impeccableAttach;
  const out = { restored: false };
  if (saved) {
    const was = new Map(saved.scrolled.map(([el, top, left]) => [el, [top, left]]));
    const put = (el, top, left) => {
      if (el.scrollTop !== top || el.scrollLeft !== left) {
        try { el.scrollTo({ top, left, behavior: 'instant' }); } catch (e) {}
      }
    };
    const walk = (root) => {
      for (const el of root.querySelectorAll('*')) {
        const old = was.get(el);
        if (old) put(el, old[0], old[1]);
        else if (el.scrollTop || el.scrollLeft) put(el, 0, 0);
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(document);
    window.scrollTo({ left: saved.x, top: saved.y, behavior: 'instant' });
    for (const m of g.__impeccablePausedMedia || []) {
      if (!m.paused || m.ended || !m.isConnected) continue;
      try { const p = m.play(); if (p && typeof p.catch === 'function') p.catch(() => {}); } catch (e) {}
    }
    if (!saved.hideStyle) {
      const style = document.getElementById('impeccable-visual-contrast-hide-style');
      if (style) style.remove();
    }
    out.restored = true;
    out.scroll = [window.scrollX, window.scrollY];
    out.wanted = [saved.x, saved.y];
  }
  for (const el of document.querySelectorAll('[data-impeccable-visual-contrast-target], [data-impeccable-bgclip-text]')) {
    el.removeAttribute('data-impeccable-visual-contrast-target');
    el.removeAttribute('data-impeccable-bgclip-text');
  }
  for (const key of ['__impeccableSnapshot', '__impCap', '__impIO', '__impeccableContrastRestore', '__impeccableVisualScrollSaved', '__impeccablePausedMedia', '__impeccableAttach']) {
    try { delete g[key]; } catch (e) {}
  }
  return out;
})()"#;

/// `impeccable detect --cdp`: attach, scan the chosen page as it stands, put
/// it back, detach.
pub fn detect_cdp(
    endpoint: &CdpEndpoint,
    filter: Option<&str>,
    options: &ScanOptions,
) -> Result<UrlScan, EngineError> {
    ensure_loopback(endpoint).map_err(EngineError::new)?;
    let ws = browser_ws_url(endpoint).map_err(EngineError::new)?;
    let mut browser = Browser::connect(&ws).map_err(|e| {
        EngineError::new(format!("{}. {}", e.message, launch_hint(endpoint.port)))
    })?;
    let outcome = browser
        .targets()
        .map_err(super::cdp_err)
        .and_then(|targets| {
            pick_target(&page_targets(&targets), filter, endpoint.page_id.as_deref(), &endpoint.authority())
                .map_err(EngineError::new)
        })
        .and_then(|target| scan_target(&mut browser, &target, options));
    browser.close();
    outcome
}

fn scan_target(browser: &mut Browser, target: &PageTarget, options: &ScanOptions) -> Result<UrlScan, EngineError> {
    let mut page = browser.attach_page(&target.id).map_err(super::cdp_err)?;
    let url = if target.url.is_empty() { format!("cdp-target:{}", target.id) } else { target.url.clone() };
    let scanned = page
        .evaluate_value(PREPARE_JS)
        .map_err(super::cdp_err)
        .and_then(|_| scan_attached(&mut page, &url, options));
    let restored = page.evaluate_value(RESTORE_JS);
    page.close();
    let scan = scanned?;
    // Leaving the page as found is part of the contract: a scan that could
    // not put it back fails, so automation sees it.
    let restored_ok = restored.as_ref().is_ok_and(|v| v.get("restored").and_then(Value::as_bool) == Some(true));
    if !restored_ok {
        let why = match restored {
            Err(e) => e.message,
            Ok(_) => "the recorded state was gone".to_string(),
        };
        return Err(EngineError::new(format!(
            "scanned {url} but could not put it back as it was ({why}); check its scroll position and any video it was playing."
        )));
    }
    Ok(scan)
}

/// [`super::scan_loaded`] over an attached page: its own viewport, consent and
/// overlay hiding off.
fn scan_attached(page: &mut Page<'_>, url: &str, options: &ScanOptions) -> Result<UrlScan, EngineError> {
    let (_, (width, height)) = page.viewport_metrics().map_err(super::cdp_err)?;
    let viewport = Viewport { width: width.round().max(1.0) as u32, height: height.round().max(1.0) as u32 };
    let options = ScanOptions { keep_consent_banners: true, keep_overlays: true, ..options.clone() };
    let mut consent = ConsentReport::default();
    let mut overlays = OverlayReport::default();
    let mut notes = Vec::new();
    let results = super::scan_loaded(
        page,
        url,
        &options,
        viewport,
        options.profile.as_deref(),
        None,
        &mut consent,
        &mut notes,
        &mut overlays,
    )?;
    let (findings, _) = super::results_to_findings(url, results, options.design_system.as_deref())?;
    Ok(UrlScan { findings, notes })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(id: &str, url: &str, title: &str) -> PageTarget {
        PageTarget { id: id.into(), url: url.into(), title: title.into() }
    }

    #[test]
    fn only_pages_that_are_not_devtools_are_candidates() {
        let targets = serde_json::json!([
            { "targetId": "A", "type": "page", "url": "http://127.0.0.1:5173/", "title": "App" },
            { "targetId": "B", "type": "page", "url": "devtools://devtools/bundled/inspector.html", "title": "DevTools" },
            { "targetId": "C", "type": "service_worker", "url": "http://127.0.0.1:5173/sw.js", "title": "" },
            { "targetId": "D", "type": "iframe", "url": "https://ads.example/", "title": "" },
        ]);
        let pages = page_targets(targets.as_array().unwrap());
        assert_eq!(pages, vec![page("A", "http://127.0.0.1:5173/", "App")]);
        assert_eq!(pick_target(&pages, None, None, "127.0.0.1:9222").unwrap().id, "A");
    }

    #[test]
    fn several_pages_need_a_target() {
        let pages = vec![page("A1", "app://main/index.html", "Inbox"), page("B2", "app://main/settings.html", "Settings")];
        let err = pick_target(&pages, None, None, "127.0.0.1:9222").unwrap_err();
        assert!(err.starts_with("2 pages are open on 127.0.0.1:9222. Rerun with --target"), "{err}");
        assert!(err.contains("\n  app://main/index.html  \"Inbox\"  (id A1)"), "{err}");
        assert!(err.contains("\n  app://main/settings.html  \"Settings\"  (id B2)"), "{err}");
        assert_eq!(pick_target(&pages, Some("settings"), None, "x").unwrap().id, "B2");
        assert_eq!(pick_target(&pages, Some("INBOX"), None, "x").unwrap().id, "A1");
        assert_eq!(pick_target(&pages, Some("b2"), None, "x").unwrap().id, "B2");
        let none = pick_target(&pages, Some("billing"), None, "127.0.0.1:9222").unwrap_err();
        assert!(none.starts_with("no page on 127.0.0.1:9222 has a URL or title containing \"billing\". Open pages:"), "{none}");
        let many = pick_target(&pages, Some("app://main"), None, "127.0.0.1:9222").unwrap_err();
        assert!(many.starts_with("2 pages on 127.0.0.1:9222 match \"app://main\""), "{many}");
        assert_eq!(pick_target(&pages, Some("ignored"), Some("a1"), "x").unwrap().id, "A1");
        assert!(pick_target(&[], None, None, "h:1").unwrap_err().starts_with("no pages are open on h:1"));
    }

    #[test]
    fn a_browser_websocket_url_is_dialled_as_given() {
        let endpoint = CdpEndpoint {
            host: "127.0.0.1".into(),
            port: 9222,
            browser_path: Some("/devtools/browser/abc".into()),
            page_id: None,
        };
        assert_eq!(browser_ws_url(&endpoint).unwrap(), "ws://127.0.0.1:9222/devtools/browser/abc");
    }
}
