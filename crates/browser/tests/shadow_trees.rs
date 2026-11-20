//! Open shadow trees in the URL engine's capture and full-page screenshot,
//! rendered by an installed browser. Skips cleanly when there is none.
//!
//! - Shadow trees are extra to the element budget: a page whose light DOM
//!   fits still captures, and a tree that would cross the budget is left out.
//! - A running animation inside a shadow tree is recorded on its element,
//!   and so are its `:disabled` and `:checked` states.
//! - An app shell that scrolls a frame inside a shadow root is captured by
//!   scrolling that frame.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::Duration;

use impeccable_browser::{
    cdp::Browser, detect_url_evidence, discovery, fullpage, snapshot_engine, BrowserEngine,
    EvidenceRequest,
};
use impeccable_detect::engines::ScanOptions;
use base64::Engine as _;
use serde_json::Value;

fn serve(body: &'static str) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            std::thread::spawn(move || handle(stream, body));
        }
    });
    port
}

fn handle(mut stream: TcpStream, body: &str) {
    let mut buf = [0u8; 8192];
    let _ = stream.read(&mut buf);
    let head = format!(
        "HTTP/1.0 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body.as_bytes());
    let _ = stream.flush();
}

fn browser() -> Option<Browser> {
    let env: HashMap<String, String> = std::env::vars().collect();
    let Ok(exe) = discovery::find_browser(&env) else {
        eprintln!("skip: no installed browser found");
        return None;
    };
    Browser::launch(&exe, &[], false)
        .map_err(|e| eprintln!("skip: could not launch browser: {}", e.message))
        .ok()
}

const BUDGET_PAGE: &str = r#"<!doctype html><html><body>
<div id="light"></div>
<div id="host"></div>
<script>
  const light = document.getElementById('light');
  for (let i = 0; i < 40; i++) light.appendChild(document.createElement('p'));
  const root = document.getElementById('host').attachShadow({ mode: 'open' });
  for (let i = 0; i < 100; i++) root.appendChild(document.createElement('span'));
  const anim = document.createElement('div');
  anim.id = 'fading';
  anim.textContent = 'Fading in';
  document.body.appendChild(document.createElement('section')).attachShadow({ mode: 'open' }).appendChild(anim);
  anim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 60000 });
</script>
</body></html>"#;

#[test]
fn shadow_trees_never_push_a_page_past_the_element_budget() {
    let Some(mut browser) = browser() else { return };
    let port = serve(BUDGET_PAGE);
    let mut page = browser.new_page().unwrap();
    page.goto(&format!("http://127.0.0.1:{port}/"), "load", Duration::from_secs(15))
        .unwrap();
    snapshot_engine::ensure_snapshot_js(&mut page).unwrap();
    let out = page
        .evaluate_value(
            "(() => { const c = window.__impeccableSnapshot.capture({ maxElements: 100 }); if (c.error) return { error: c.error }; const s = JSON.parse(c.json); return { count: s.els.length, tags: s.els.map(e => e.t) }; })()",
        )
        .unwrap();
    assert!(out.get("error").is_none(), "{out}");
    let tags: Vec<&str> = out["tags"].as_array().unwrap().iter().filter_map(Value::as_str).collect();
    assert_eq!(tags.iter().filter(|t| **t == "P").count(), 40, "{tags:?}");
    // The 100-span tree would cross the budget, so it is left out whole.
    assert_eq!(tags.iter().filter(|t| **t == "SPAN").count(), 0, "{tags:?}");
    assert!(tags.len() < 100, "{}", tags.len());

    // With room for every tree, the running animation inside the second
    // shadow root is recorded on its element.
    let out = page
        .evaluate_value(
            "(() => { const c = window.__impeccableSnapshot.capture({}); if (c.error) return { error: c.error }; const s = JSON.parse(c.json); return { anim: s.anim === true, fading: s.els.filter(e => e.t === 'DIV' && Array.isArray(e.an)).map(e => e.an) }; })()",
        )
        .unwrap();
    assert!(out.get("error").is_none(), "{out}");
    assert_eq!(out["anim"], Value::Bool(true), "{out}");
    let fading = out["fading"].as_array().unwrap();
    assert!(
        fading.iter().any(|an| an.as_array().unwrap().iter().any(|p| p == "opacity")),
        "the shadow-tree animation was not recorded: {out}"
    );
    page.close();
    browser.close();
}

const SHADOW_STATES_PAGE: &str = r#"<!doctype html><html><body>
<button id="light-button" disabled>Light</button>
<div id="host"></div>
<script>
  const outer = document.getElementById('host').attachShadow({ mode: 'open' });
  outer.innerHTML = '<button disabled>Shadow</button><input type="checkbox" checked><section></section>';
  const inner = outer.querySelector('section').attachShadow({ mode: 'open' });
  inner.innerHTML = '<input type="radio" checked disabled>';
</script>
</body></html>"#;

/// review of #942: `:disabled` and `:checked` states inside open shadow
/// trees, nested ones included, are recorded like light-DOM states.
#[test]
fn pseudo_class_states_inside_shadow_trees_are_recorded() {
    let Some(mut browser) = browser() else { return };
    let port = serve(SHADOW_STATES_PAGE);
    let mut page = browser.new_page().unwrap();
    page.goto(&format!("http://127.0.0.1:{port}/"), "load", Duration::from_secs(15))
        .unwrap();
    snapshot_engine::ensure_snapshot_js(&mut page).unwrap();
    let out = page
        .evaluate_value(
            "(() => { const c = window.__impeccableSnapshot.capture({}); if (c.error) return { error: c.error }; const s = JSON.parse(c.json); return s.els.filter(e => e.t === 'BUTTON' || e.t === 'INPUT').map(e => [e.t, e.st || []]); })()",
        )
        .unwrap();
    assert!(out.get("error").is_none(), "{out}");
    let rows: Vec<(String, Vec<String>)> = serde_json::from_value(out.clone()).unwrap();
    let has = |tag: &str, state: &str| rows.iter().filter(|(t, st)| t == tag && st.iter().any(|s| s == state)).count();
    assert_eq!(has("BUTTON", "disabled"), 2, "{out}");
    assert_eq!(has("INPUT", "checked"), 2, "{out}");
    assert_eq!(has("INPUT", "disabled"), 1, "{out}");
    page.close();
    browser.close();
}

/// The in-page probe the live overlay's rule core reads the page through.
const PROBE_JS: &str = include_str!("../../../browser-bundle/10-probe.js");

const SHADOW_DECK_PAGE: &str = r#"<!doctype html><html><body>
<deck-carousel id="deck"></deck-carousel>
<div id="plain"><p>Light</p></div>
<script>
  const root = document.getElementById('deck').attachShadow({ mode: 'open' });
  root.innerHTML = '<style>.track{display:flex}</style><div class="track"><h3>Slide one</h3></div>';
  document.getElementById('plain').attachShadow({ mode: 'closed' }).innerHTML = '<p>Closed</p>';
</script>
</body></html>"#;

/// review of #948: the live page's probe lists the top-level elements of an
/// open shadow tree, so heading-rhythm does not read a shadow-DOM carousel
/// as an empty spacer in live and extension scans. A closed tree lists none.
#[test]
fn the_page_probe_lists_open_shadow_children() {
    let Some(mut browser) = browser() else { return };
    let port = serve(SHADOW_DECK_PAGE);
    let mut page = browser.new_page().unwrap();
    page.goto(&format!("http://127.0.0.1:{port}/"), "load", Duration::from_secs(15))
        .unwrap();
    let script = format!(
        "(() => {{ {PROBE_JS}\n const kids = id => __impeccableDom.shadow_children(__intern(document.getElementById(id))).map(h => __el(h).tagName); return {{ deck: kids('deck'), plain: kids('plain') }}; }})()"
    );
    let out = page.evaluate_value(&script).unwrap();
    assert_eq!(out["deck"], serde_json::json!(["STYLE", "DIV"]), "{out}");
    assert_eq!(out["plain"], serde_json::json!([]), "{out}");
    page.close();
    browser.close();
}

const SHADOW_SHELL_PAGE: &str = r#"<!doctype html><html><head><style>
html, body { margin: 0; height: 100%; overflow: hidden; }
app-shell { display: block; height: 100%; }
</style></head><body>
<app-shell></app-shell>
<script>
  const root = document.querySelector('app-shell').attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    .frame { height: 100vh; overflow: auto; }
    .row { height: 400px; display: flex; align-items: center; padding: 0 40px; font: 32px sans-serif; }
    .row:nth-child(odd) { background: #1d4ed8; color: #fff; }
    .row:nth-child(even) { background: #f59e0b; color: #111; }
  </style><div class="frame">${Array.from({ length: 12 }, (_, i) => `<div class="row">Row ${i + 1}</div>`).join('')}</div>`;
</script>
</body></html>"#;

#[test]
fn a_shadow_root_scroll_frame_is_captured_by_scrolling_the_frame() {
    let env: HashMap<String, String> = std::env::vars().collect();
    if discovery::find_browser(&env).is_err() {
        eprintln!("skip: no installed browser found");
        return;
    }
    let port = serve(SHADOW_SHELL_PAGE);
    let engine = BrowserEngine::new(env);
    let mut browser = engine.launch().expect("launch");
    let options = ScanOptions { viewport: Some((1280, 800)), ..Default::default() };
    let (_, evidence) = detect_url_evidence(
        &mut browser,
        &format!("http://127.0.0.1:{port}/"),
        &options,
        "load",
        100,
        &EvidenceRequest::default(),
    )
    .expect("evidence scan");
    browser.close();
    let shot = evidence.screenshot.as_ref().expect("screenshot");
    assert_eq!(shot.method, fullpage::method::STITCHED);
    // Twelve 400px rows: the frame's whole height, not one viewport.
    assert!(shot.height >= 4800.0, "{}", shot.height);
}

const FIXED_SHADOW_SHELL_PAGE: &str = r#"<!doctype html><html><head><style>
html, body { margin: 0; height: 100%; overflow: hidden; }
app-shell { position: fixed; inset: 0; display: block; }
</style></head><body>
<app-shell></app-shell>
<chat-widget></chat-widget>
<script>
  const root = document.querySelector('app-shell').attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    .frame { height: 100vh; overflow: auto; }
    .row { height: 400px; display: flex; align-items: center; padding: 0 40px; font: 32px sans-serif; }
    .row:nth-child(odd) { background: #1d4ed8; color: #fff; }
    .row:nth-child(even) { background: #f59e0b; color: #111; }
  </style><div class="frame">${Array.from({ length: 12 }, (_, i) => `<div class="row">Row ${i + 1}</div>`).join('')}</div>`;
  document.querySelector('chat-widget').attachShadow({ mode: 'open' }).innerHTML =
    '<div style="position:fixed;right:24px;bottom:24px;width:160px;height:160px;background:#16a34a;z-index:10"></div>';
</script>
</body></html>"#;

#[test]
fn a_fixed_shadow_shell_keeps_its_frame_and_drops_repeated_shadow_chrome() {
    let env: HashMap<String, String> = std::env::vars().collect();
    if discovery::find_browser(&env).is_err() {
        eprintln!("skip: no installed browser found");
        return;
    }
    let port = serve(FIXED_SHADOW_SHELL_PAGE);
    let engine = BrowserEngine::new(env);
    let mut browser = engine.launch().expect("launch");
    let options = ScanOptions { viewport: Some((1280, 800)), ..Default::default() };
    let (_, evidence) = detect_url_evidence(
        &mut browser,
        &format!("http://127.0.0.1:{port}/"),
        &options,
        "load",
        100,
        &EvidenceRequest::default(),
    )
    .expect("evidence scan");
    browser.close();
    let shot = evidence.screenshot.as_ref().expect("screenshot");
    assert_eq!(shot.method, fullpage::method::STITCHED);
    let bytes = base64::engine::general_purpose::STANDARD.decode(&shot.jpeg_base64).expect("base64");
    let img = image::load_from_memory_with_format(&bytes, image::ImageFormat::Jpeg).expect("jpeg").to_rgb8();
    // The fixed host holds the frame being scrolled, so later tiles keep it.
    let (_, blank) = fullpage::longest_uniform_band(&img);
    assert!(blank < 800, "a blank band of {blank} rows");
    // The widget in a shadow root paints once, in the first viewport.
    let green = |y0: u32, y1: u32| {
        (y0..y1.min(img.height()))
            .flat_map(|y| (0..img.width()).map(move |x| (x, y)))
            .filter(|&(x, y)| {
                let p = img.get_pixel(x, y).0;
                p[1] > 120 && p[0] < 60 && p[2] < 110
            })
            .count()
    };
    assert!(green(0, 800) > 5000, "the widget is missing from the first viewport");
    assert_eq!(green(800, img.height()), 0, "the widget repeats below the first viewport");
}

const TRANSLATED_FIXED_PAGE: &str = r#"<!doctype html><html><head><style>
html, body { margin: 0; height: 100%; overflow: hidden; }
.frame { position: fixed; inset: 0; overflow: auto; }
.row { height: 400px; display: flex; align-items: center; padding: 0 40px; font: 32px sans-serif; }
.row:nth-child(odd) { background: #1d4ed8; color: #fff; }
.row:nth-child(even) { background: #f59e0b; color: #111; }
.shifted { translate: 0px 0px; }
.pinned { position: fixed; top: 1600px; left: 40px; width: 200px; height: 200px; background: #16a34a; }
</style></head><body>
<div class="frame"><div class="shifted"><div class="pinned"></div>
<div class="row">Row 1</div><div class="row">Row 2</div><div class="row">Row 3</div><div class="row">Row 4</div>
<div class="row">Row 5</div><div class="row">Row 6</div><div class="row">Row 7</div><div class="row">Row 8</div>
<div class="row">Row 9</div><div class="row">Row 10</div><div class="row">Row 11</div><div class="row">Row 12</div>
</div></div>
</body></html>"#;

/// A fixed box under an ancestor with `translate` is laid out against that
/// ancestor and scrolls with the page, so the tiles keep it.
#[test]
fn a_fixed_box_under_a_translated_ancestor_scrolls_with_the_page() {
    let env: HashMap<String, String> = std::env::vars().collect();
    if discovery::find_browser(&env).is_err() {
        eprintln!("skip: no installed browser found");
        return;
    }
    let port = serve(TRANSLATED_FIXED_PAGE);
    let engine = BrowserEngine::new(env);
    let mut browser = engine.launch().expect("launch");
    let options = ScanOptions { viewport: Some((1280, 800)), ..Default::default() };
    let (_, evidence) = detect_url_evidence(
        &mut browser,
        &format!("http://127.0.0.1:{port}/"),
        &options,
        "load",
        100,
        &EvidenceRequest::default(),
    )
    .expect("evidence scan");
    browser.close();
    let shot = evidence.screenshot.as_ref().expect("screenshot");
    assert_eq!(shot.method, fullpage::method::STITCHED);
    let bytes = base64::engine::general_purpose::STANDARD.decode(&shot.jpeg_base64).expect("base64");
    let img = image::load_from_memory_with_format(&bytes, image::ImageFormat::Jpeg).expect("jpeg").to_rgb8();
    let green = (1600..1800u32.min(img.height()))
        .flat_map(|y| (40..240u32).map(move |x| (x, y)))
        .filter(|&(x, y)| {
            let p = img.get_pixel(x, y).0;
            p[1] > 120 && p[0] < 60 && p[2] < 110
        })
        .count();
    assert!(green > 20000, "the box under the translated ancestor is blank: {green}");
}

const SHADOW_FINDINGS_PAGE: &str = r#"<!doctype html><html><head><style>
body { margin: 0; padding: 32px; font: 16px/1.6 system-ui, sans-serif; background: #fff; color: #1a1a1a; }
</style></head><body>
<h1>Network panel</h1>
<topo-card></topo-card>
<p style="margin-top:300px"><span class="lbl">Port 1 up 12 Mb/s</span></p>
<script>
  customElements.define('topo-card', class extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' }).innerHTML =
        '<style>.lbl{font-size:9.9px;color:#7b8a8e;background:#5b6b70;padding:2px}</style><span class="lbl">Port 2 down 12 Mb/s</span>';
    }
  });
</script>
</body></html>"#;

/// #1360: the only defect on the page sits in an open shadow root, and the
/// finding names it through its host. The evidence step measures the shadow
/// span, not the readable light-DOM `span.lbl` below it.
#[test]
fn findings_inside_an_open_shadow_root_are_reported_through_their_host() {
    let env: HashMap<String, String> = std::env::vars().collect();
    if discovery::find_browser(&env).is_err() {
        eprintln!("skip: no installed browser found");
        return;
    }
    let port = serve(SHADOW_FINDINGS_PAGE);
    let engine = BrowserEngine::new(env);
    let mut browser = engine.launch().expect("launch");
    let options = ScanOptions { viewport: Some((1280, 800)), ..Default::default() };
    let request = EvidenceRequest::default();
    let (findings, evidence) =
        detect_url_evidence(&mut browser, &format!("http://127.0.0.1:{port}/"), &options, "load", 100, &request)
            .expect("evidence scan");
    browser.close();
    for rule in ["low-contrast", "undersized-ui-text"] {
        let found = findings.iter().find(|f| f.antipattern == rule);
        let selector = found.and_then(|f| f.extras.get("selector")).and_then(Value::as_str);
        assert_eq!(selector, Some("topo-card >>> span.lbl"), "{rule}: {findings:?}");
    }
    let rect = evidence.element_rects.get("topo-card >>> span.lbl").and_then(Value::as_array).expect("measured");
    assert!(rect[1].as_f64().unwrap() < 300.0, "measured the light twin: {rect:?}");
}

const SHADOW_PICTURE_PAGE: &str = r##"<!doctype html><html><head><style>
body { margin: 0; padding: 32px; font: 16px/1.6 system-ui, sans-serif; background: #fff; color: #1a1a1a; }
</style></head><body>
<h1>Network panel</h1>
<photo-card></photo-card>
<script>
  const img = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="80"><rect width="400" height="80" fill="#6b6b6b"/></svg>');
  customElements.define('photo-card', class extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' }).innerHTML =
        '<style>.hero{padding:24px;width:400px;background:url(' + JSON.stringify(img) + ') center/cover} .hero span{font-size:20px;color:#808080}</style><div class="hero"><span>Port 4 offline since noon</span></div>';
    }
  });
</script>
</body></html>"##;

/// #1360: the pixel pass hides a shadow target's glyphs too (a document
/// style does not reach into its shadow root), so text over a picture in a
/// component gets a verdict from the pixels.
#[test]
fn the_pixel_pass_reads_text_inside_an_open_shadow_root() {
    let env: HashMap<String, String> = std::env::vars().collect();
    if discovery::find_browser(&env).is_err() {
        eprintln!("skip: no installed browser found");
        return;
    }
    let port = serve(SHADOW_PICTURE_PAGE);
    let engine = BrowserEngine::new(env);
    let mut browser = engine.launch().expect("launch");
    let options = ScanOptions { viewport: Some((1280, 800)), ..Default::default() };
    let request = EvidenceRequest { screenshot: false, ..Default::default() };
    let (findings, _) =
        detect_url_evidence(&mut browser, &format!("http://127.0.0.1:{port}/"), &options, "load", 100, &request)
            .expect("evidence scan");
    browser.close();
    let pixel = findings.iter().find(|f| {
        f.antipattern == "low-contrast"
            && f.snippet.starts_with("pixel contrast")
            && f.extras.get("selector").and_then(Value::as_str) == Some("photo-card >>> span")
    });
    assert!(pixel.is_some(), "{findings:#?}");
}
