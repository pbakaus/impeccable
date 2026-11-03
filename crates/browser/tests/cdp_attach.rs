//! `impeccable detect --cdp`: attach to a browser someone else runs, scan one
//! of its pages as it stands, and leave everything as found.
//!
//! Each test launches the engine's own headless Chrome (which listens on a
//! DevTools port, as a desktop app started with `--remote-debugging-port`
//! does), opens the fixture app in it as an outside client would, seeds some
//! state, then attaches through [`impeccable_browser::attach::detect_cdp`]
//! like the CLI. The checks read the page back over a raw CDP connection, in
//! the page's own world: same document (no navigation, no reload), same
//! scroll positions, no node or global the scan added, no user activation
//! granted, and the browser and both pages still alive.
//!
//! The fixture replaces the built-ins a capture uses (`Map`, `Array.from`),
//! so the scan must reach the page through its isolated world, and one copy
//! of it runs under a strict meta CSP (scripts and styles from its own
//! origin only).
//!
//! Skips cleanly with no installed browser.

#[path = "support/http.rs"]
mod http;

use std::collections::HashMap;
use std::net::TcpStream;
use std::time::{Duration, Instant};

use impeccable_browser::{attach, cdp::Browser, discovery};
use impeccable_detect::cdp_endpoint::CdpEndpoint;
use impeccable_detect::engines::ScanOptions;
use serde_json::{json, Value};
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{Message, WebSocket};

const PAGE: &str = r##"<!doctype html>
<html lang="en"><head><meta charset="utf-8">
CSP
<title>Fixture App</title>
<link rel="stylesheet" href="/app.css">
<script src="/app.js"></script>
</head><body>
<main>
  <h1>Inbox</h1>
  <p class="tiny">Fine print set far too small for anyone to read comfortably.</p>
  <p class="faint">Faint grey copy on white that fails contrast for body text.</p>
  <div id="list">LIST<div class="vector-panel"><svg viewBox="0 0 420 96" aria-hidden="true"><rect width="420" height="96" fill="#f5f2ea"/></svg><p>Archived threads on pale artwork</p></div></div>
  <div class="spacer"></div>
  <div class="vector-panel"><svg viewBox="0 0 420 96" aria-hidden="true"><rect width="420" height="96" fill="#f5f2ea"/></svg><p>Office hours on pale artwork</p></div>
</main>
</body></html>
"##;

const CSS: &str = "body { margin: 0; font: 16px/1.5 Georgia, serif; color: #222; background: #fff; }
main { padding: 24px; }
.tiny { font-size: 8px; }
.faint { color: #d4d4d4; }
#list { height: 160px; overflow: auto; border: 1px solid #ccc; }
#list p { margin: 0; padding: 8px; }
.spacer { height: 2400px; }
/* Text over inline vector artwork: the element pass cannot read the paint
   under it, so the pixel pass measures it, once inside the list's scroller
   and once below the window's fold. */
.vector-panel { position: relative; isolation: isolate; width: 420px; height: 96px; margin: 24px 0 0; background: #1d2330 url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'><rect width='16' height='16' fill='%231d2330'/><circle cx='8' cy='8' r='3' fill='%23262d3b'/></svg>\") repeat; }
.vector-panel svg { position: absolute; left: 0; top: 0; z-index: 0; display: block; width: 420px; height: 96px; }
.vector-panel p { position: relative; z-index: 1; margin: 0; padding: 24px; width: 372px; font-size: 16px; line-height: 1.6; color: #fdfdfd; }
";

/// Counts loads (a reload would show), notes when the pixel pass's hide
/// style arrives (so a test knows the pass ran before it checks the style
/// is gone), and breaks the built-ins a capture in the page's own world
/// would use.
const JS: &str = "sessionStorage.loads = String(Number(sessionStorage.loads || 0) + 1);
new MutationObserver((records) => {
  for (const r of records) for (const n of r.addedNodes) {
    if (n.id === 'impeccable-visual-contrast-hide-style') document.documentElement.dataset.sawHideStyle = 'yes';
  }
}).observe(document.documentElement, { childList: true, subtree: true });
window.Map = function BrokenMap() { throw new Error('page Map'); };
Array.from = function () { return []; };
";

fn list_html() -> String {
    (1..=40).map(|i| format!("<p>Message {i}</p>")).collect()
}

/// The strict policy: scripts and styles from the page's own origin only,
/// so neither an inline script nor an inline style element the scan adds
/// can run or apply.
const STRICT_CSP: &str = r#"<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'">"#;

/// The fixture at `/` with no policy, so the pixel pass's hide style
/// applies, and at `/strict` under [`STRICT_CSP`].
fn serve_app() -> String {
    let open = PAGE.replace("LIST", &list_html()).replace("CSP\n", "");
    let strict = PAGE.replace("LIST", &list_html()).replace("CSP", STRICT_CSP);
    http::serve(move |path| match path {
        "/" => Some(("text/html; charset=utf-8", open.clone().into_bytes())),
        "/strict" => Some(("text/html; charset=utf-8", strict.clone().into_bytes())),
        "/app.css" => Some(("text/css", CSS.as_bytes().to_vec())),
        "/app.js" => Some(("text/javascript", JS.as_bytes().to_vec())),
        _ => None,
    })
}

fn launch() -> Option<Browser> {
    let env: HashMap<String, String> = std::env::vars().collect();
    let Ok(exe) = discovery::find_browser(&env) else {
        eprintln!("skip: no installed browser found");
        return None;
    };
    match Browser::launch(&exe, &[], false) {
        Ok(b) => Some(b),
        Err(e) => {
            eprintln!("skip: could not launch browser: {}", e.message);
            None
        }
    }
}

fn port_of(browser: &Browser) -> u16 {
    let rest = browser.ws_url().strip_prefix("ws://127.0.0.1:").expect("ws url");
    rest.split('/').next().unwrap().parse().unwrap()
}

fn endpoint(port: u16) -> CdpEndpoint {
    CdpEndpoint { host: "127.0.0.1".into(), port, browser_path: None, page_id: None }
}

/// A plain CDP client: the test plays the app (and its owner), not the engine.
struct Raw {
    ws: WebSocket<MaybeTlsStream<TcpStream>>,
    next: u64,
}

impl Raw {
    fn connect(ws_url: &str) -> Raw {
        let (ws, _) = tungstenite::connect(ws_url).expect("raw connect");
        if let MaybeTlsStream::Plain(s) = ws.get_ref() {
            s.set_read_timeout(Some(Duration::from_secs(30))).unwrap();
        }
        Raw { ws, next: 0 }
    }

    fn call(&mut self, session: Option<&str>, method: &str, params: Value) -> Value {
        self.try_call(session, method, params).unwrap_or_else(|e| panic!("{method}: {e}"))
    }

    fn try_call(&mut self, session: Option<&str>, method: &str, params: Value) -> Result<Value, Value> {
        self.next += 1;
        let id = self.next;
        let mut msg = json!({ "id": id, "method": method, "params": params });
        if let Some(s) = session {
            msg["sessionId"] = json!(s);
        }
        self.ws.send(Message::Text(msg.to_string().into())).unwrap();
        loop {
            let Message::Text(text) = self.ws.read().expect("raw read") else { continue };
            let v: Value = serde_json::from_str(&text).unwrap();
            if v.get("id").and_then(Value::as_u64) == Some(id) {
                return match v.get("error") {
                    Some(e) => Err(e.clone()),
                    None => Ok(v["result"].clone()),
                };
            }
        }
    }

    /// Evaluate in the page's own world, without a user gesture.
    fn eval(&mut self, target: &str, expression: &str) -> Value {
        self.try_eval(target, expression).unwrap_or_else(|e| panic!("page threw: {e}"))
    }

    /// [`Raw::eval`], with a page exception or a lost context as an error.
    fn try_eval(&mut self, target: &str, expression: &str) -> Result<Value, Value> {
        let session = self.call(None, "Target.attachToTarget", json!({ "targetId": target, "flatten": true }));
        let session = session["sessionId"].as_str().unwrap().to_string();
        let out = self.try_call(
            Some(&session),
            "Runtime.evaluate",
            json!({ "expression": expression, "returnByValue": true, "awaitPromise": true }),
        );
        self.call(None, "Target.detachFromTarget", json!({ "sessionId": session }));
        let out = out?;
        match out.get("exceptionDetails") {
            Some(e) => Err(e.clone()),
            None => Ok(out["result"]["value"].clone()),
        }
    }

    fn pages(&mut self) -> Vec<Value> {
        let all = self.call(None, "Target.getTargets", json!({}));
        all["targetInfos"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|t| t["type"] == "page")
            .cloned()
            .collect()
    }

    /// Open `url` in a new tab and wait until it has loaded. The tab starts
    /// on `about:blank`, which is already `complete`, so the wait also
    /// checks that the fixture is the document.
    fn open(&mut self, url: &str, background: bool) -> String {
        let created = self.call(None, "Target.createTarget", json!({ "url": url, "background": background }));
        let target = created["targetId"].as_str().unwrap().to_string();
        let started = Instant::now();
        let loaded = format!("location.href === {} && document.readyState === 'complete' && !!document.getElementById('list')", json!(url));
        while self.try_eval(&target, &loaded).ok() != Some(json!(true)) {
            assert!(started.elapsed() < Duration::from_secs(30), "page never loaded");
            std::thread::sleep(Duration::from_millis(100));
        }
        target
    }
}

/// What the checks compare before and after the scan, all read in the
/// page's own world.
const STATE_JS: &str = r#"(() => {
  const list = document.getElementById('list');
  return {
    href: location.href,
    loads: sessionStorage.loads,
    navigations: performance.getEntriesByType('navigation').length,
    scroll: [window.scrollX, window.scrollY],
    list: list.scrollTop,
    nodes: document.getElementsByTagName('*').length,
    injected: document.querySelectorAll('#impeccable-visual-contrast-hide-style, [data-impeccable-visual-contrast-target], [data-impeccable-bgclip-text], style:not([data-app])').length,
    globals: Object.getOwnPropertyNames(window).filter(k => /^__imp/i.test(k)),
    activated: navigator.userActivation ? navigator.userActivation.hasBeenActive : false,
    width: window.innerWidth,
    height: window.innerHeight,
    dpr: window.devicePixelRatio,
  };
})()"#;

const SEED_JS: &str =
    "(() => { document.getElementById('list').scrollTop = 137; window.scrollTo(0, 411); return [window.scrollY, document.getElementById('list').scrollTop]; })()";

/// Two muted videos fed from a canvas (no codec needed): `#app-paused`,
/// which the app paused before the scan, and `#playing`.
const MEDIA_JS: &str = r#"(async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 32; canvas.height = 32;
  const ctx = canvas.getContext('2d');
  let n = 0;
  setInterval(() => { ctx.fillStyle = n++ % 2 ? '#123' : '#456'; ctx.fillRect(0, 0, 32, 32); }, 50);
  const make = (id) => {
    const v = document.createElement('video');
    v.id = id; v.muted = true; v.width = 32; v.height = 32;
    v.srcObject = canvas.captureStream(20);
    document.querySelector('main').prepend(v);
    return v;
  };
  const paused = make('app-paused');
  const playing = make('playing');
  await paused.play(); await playing.play();
  paused.pause();
  playing.addEventListener('pause', () => { document.documentElement.dataset.sawPause = 'yes'; });
  return [paused.paused, playing.paused];
})()"#;

const MEDIA_STATE_JS: &str =
    "[document.getElementById('app-paused').paused, document.getElementById('playing').paused]";

fn ids(findings: &[impeccable_core::findings::Finding]) -> Vec<&str> {
    findings.iter().map(|f| f.antipattern.as_str()).collect()
}

#[test]
fn attaches_scans_and_leaves_the_page_as_found() {
    let Some(browser) = launch() else { return };
    let port = port_of(&browser);
    let origin = serve_app();
    let url = format!("{origin}/");
    let mut raw = Raw::connect(browser.ws_url());
    let target = raw.open(&url, false);
    assert_eq!(raw.eval(&target, MEDIA_JS), json!([true, false]));
    assert_eq!(raw.eval(&target, SEED_JS), json!([411, 137]));
    let before = raw.eval(&target, STATE_JS);
    assert_eq!(before["globals"], json!([]));

    // The launch's own about:blank tab is open too, so a bare --cdp is
    // ambiguous and names both pages.
    let ambiguous = attach::detect_cdp(&endpoint(port), None, &ScanOptions::default()).unwrap_err();
    assert!(ambiguous.message.starts_with(&format!("2 pages are open on 127.0.0.1:{port}. Rerun with --target")), "{}", ambiguous.message);
    assert!(ambiguous.message.contains(&format!("\n  {url}  \"Fixture App\"  (id {target})")), "{}", ambiguous.message);
    assert!(ambiguous.message.contains("\n  about:blank"), "{}", ambiguous.message);
    let none = attach::detect_cdp(&endpoint(port), Some("billing"), &ScanOptions::default()).unwrap_err();
    assert!(none.message.contains("has a URL or title containing \"billing\""), "{}", none.message);

    let scan = attach::detect_cdp(&endpoint(port), Some("fixture app"), &ScanOptions::default())
        .unwrap_or_else(|e| panic!("scan failed: {}", e.message));
    let found = ids(&scan.findings);
    assert!(found.contains(&"tiny-text"), "{found:?}");
    assert!(found.contains(&"low-contrast"), "{found:?}");
    assert!(scan.findings.iter().all(|f| f.file == url), "every finding names the page");
    // The pixel pass read the text inside the list's scroller, which it had
    // to scroll into view: an attached page is read as it is on screen.
    assert!(
        scan.findings.iter().any(|f| f.snippet.starts_with("pixel contrast ")
            && f.extras.get("selector").and_then(Value::as_str) == Some("#list > div.vector-panel > p")),
        "{found:?}"
    );
    assert!(scan.notes.is_empty(), "{:?}", scan.notes);

    // Picking by id, as the listing offers, works too.
    let by_id = attach::detect_cdp(&endpoint(port), Some(&target), &ScanOptions::default()).unwrap();
    assert_eq!(ids(&by_id.findings), found);

    let after = raw.eval(&target, STATE_JS);
    assert_eq!(after, before, "the page is as the scan found it");
    // The pixel pass ran (it added its hide style, and paused the playing
    // video), and its style is gone. The video it paused plays again; the
    // one the app had paused stays paused.
    assert_eq!(raw.eval(&target, "document.documentElement.dataset.sawHideStyle"), json!("yes"));
    assert_eq!(raw.eval(&target, "document.documentElement.dataset.sawPause"), json!("yes"));
    assert_eq!(raw.eval(&target, MEDIA_STATE_JS), json!([true, false]));
    let pages: Vec<String> = raw.pages().iter().map(|p| p["targetId"].as_str().unwrap().to_string()).collect();
    assert_eq!(pages.len(), 2, "no page opened or closed: {pages:?}");
    assert!(pages.contains(&target));
    let version = raw.call(None, "Browser.getVersion", json!({}));
    assert!(version["product"].as_str().is_some_and(|p| !p.is_empty()), "browser still answers");
    browser.close();
}

/// An attached scan reports the rules a URL scan of the same page reports:
/// the attach mode runs the same passes.
#[test]
fn an_attached_scan_reports_what_a_url_scan_reports() {
    let Some(browser) = launch() else { return };
    let port = port_of(&browser);
    let origin = serve_app();
    let url = format!("{origin}/");
    let mut raw = Raw::connect(browser.ws_url());
    raw.open(&url, false);
    let attached = attach::detect_cdp(&endpoint(port), Some(&origin), &ScanOptions::default()).unwrap();
    browser.close();
    let engine = impeccable_browser::BrowserEngine::from_process_env();
    let options = ScanOptions { viewport: None, ..ScanOptions::default() };
    let loaded = impeccable_detect::engines::UrlEngine::detect_url_scan(&engine, &url, &options).unwrap();
    // The launch's headless window is smaller than a URL scan's 1280x800,
    // so compare the rules, not the geometry each one quotes.
    let mut a = ids(&attached.findings);
    let mut b = ids(&loaded.findings);
    a.sort();
    a.dedup();
    b.sort();
    b.dedup();
    assert_eq!(a, b);
}

/// A tab in the background is hidden: no frames, timers a second late. The
/// scan still finishes, in about the time a visible one takes, skips the
/// screenshot reads, and still leaves the page as found. This one also runs under the strict CSP, which
/// the capture is not subject to.
#[test]
fn a_hidden_page_still_scans() {
    let Some(browser) = launch() else { return };
    let port = port_of(&browser);
    let origin = serve_app();
    let url = format!("{origin}/strict");
    let mut raw = Raw::connect(browser.ws_url());
    let target = raw.open(&url, true);
    assert_eq!(raw.eval(&target, "document.visibilityState"), json!("hidden"));
    assert_eq!(raw.eval(&target, SEED_JS), json!([411, 137]));
    let before = raw.eval(&target, STATE_JS);
    let started = Instant::now();
    let scan = attach::detect_cdp(&endpoint(port), Some("fixture"), &ScanOptions::default())
        .unwrap_or_else(|e| panic!("scan failed: {}", e.message));
    let took = started.elapsed();
    assert!(took < Duration::from_secs(60), "hidden scan took {took:?}");
    assert!(ids(&scan.findings).contains(&"tiny-text"), "{:?}", ids(&scan.findings));
    // A hidden page paints no frames, and on Linux a screenshot of it waits
    // for one forever: the pixel pass skips it and says so.
    assert!(!scan.findings.iter().any(|f| f.snippet.starts_with("pixel contrast ")));
    assert_eq!(
        scan.notes,
        vec![format!("Capture note: {url} was hidden (minimized, or a background tab or window), so the pixel pass read nothing there. Bring it on screen, focused or not, and scan again for those contrast verdicts.")]
    );
    assert_eq!(raw.eval(&target, STATE_JS), before);
    assert_eq!(raw.eval(&target, "document.visibilityState"), json!("hidden"));
    browser.close();
}

/// An evaluation that outlives its protocol timeout keeps running in the
/// page. Restoring cancels the scan's waits first, so a pass still running
/// there stops at its next wait instead of scrolling the restored page.
#[test]
fn work_left_running_stops_when_the_page_is_restored() {
    let Some(browser) = launch() else { return };
    let origin = serve_app();
    let url = format!("{origin}/");
    let mut raw = Raw::connect(browser.ws_url());
    let target = raw.open(&url, false);
    assert_eq!(raw.eval(&target, SEED_JS), json!([411, 137]));

    let mut attached = Browser::connect(browser.ws_url()).expect("connect");
    let mut page = attached.attach_page(&target).expect("attach");
    page.evaluate_value(attach::PREPARE_JS).expect("prepare");
    // A sweep the client stopped waiting for: it scrolls on every wait.
    page.evaluate_value(
        "(() => { (async () => { for (let y = 0; y < 5000; y += 40) { window.scrollTo({ top: y, behavior: 'instant' }); await new Promise(r => setTimeout(r, 20)); } })(); return true; })()",
    )
    .expect("start sweep");
    std::thread::sleep(Duration::from_millis(150));
    assert_ne!(raw.eval(&target, "window.scrollY"), json!(411), "the sweep is running");
    let restored = page.evaluate_value(attach::RESTORE_JS).expect("restore");
    assert_eq!(restored["restored"], json!(true));
    page.close();
    attached.close();
    std::thread::sleep(Duration::from_millis(400));
    assert_eq!(raw.eval(&target, "[window.scrollY, document.getElementById('list').scrollTop]"), json!([411, 137]));
    browser.close();
}

#[test]
fn a_port_that_is_not_devtools_is_refused() {
    let origin = serve_app();
    let port: u16 = origin.rsplit(':').next().unwrap().parse().unwrap();
    let err = attach::detect_cdp(&endpoint(port), None, &ScanOptions::default()).unwrap_err();
    assert!(
        err.message.starts_with(&format!("127.0.0.1:{port} answered, but not as a DevTools endpoint (GET /json/version: HTTP 404)")),
        "{}",
        err.message
    );
    assert!(err.message.contains("--remote-debugging-port"), "{}", err.message);
}
