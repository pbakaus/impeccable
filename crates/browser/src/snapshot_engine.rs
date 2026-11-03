//! Snapshot + native scan for the URL engine (triage D2).
//!
//! Instead of injecting the WebAssembly detector bundle and running the rules
//! inside the page (which needed `Page.setBypassCSP` so the page's CSP would
//! not refuse `WebAssembly.Module`), URL mode now injects only the plain-JS
//! snapshot producer (`browser-bundle/15-snapshot.js`), captures the page as
//! JSON, and runs the exact same rule core natively in this process over
//! [`SnapshotDom`] — the probe the Chrome extension already proved
//! (WASM-BUNDLE.md in the detector repo, "The snapshot route"). No WebAssembly is compiled
//! next to the page, so a strict-CSP site is scanned without bypassing CSP and
//! its blocked inline scripts stay blocked (the scan is passive again).
//!
//! Two things a snapshot cannot answer up front are supplied over CDP, exactly
//! as the extension's content script supplies them to its offscreen core:
//!
//! - **hit tests** (`elementFromPoint` / `elementsFromPoint`): a rule records a
//!   miss, [`resolve_needs`] answers the points from the live page and re-runs
//!   to a fixpoint (the text-occlusion grid converges in two rounds).
//! - **visual-contrast IO** (image loads, canvas pixel reads): the visual pass
//!   ([`analyze_visual_contrast`], a port of `browser-bundle/35-visual.js`
//!   `createVisualContrast(...).analyzeVisualContrast`) runs its decisions in
//!   the core natively and its reads (`__impIO.loadImage` / `readPixel` from
//!   `15-snapshot.js`'s `visualIO`) over CDP.
//!
//! The findings are identical to the in-page bundle's; the differential
//! (`crates/browser/tests/differential.rs`) is the gate.

use impeccable_core::browser::snapshot::{Facts, ScrollShown, SnapshotDom};
use impeccable_core::browser::visual::{self, CssPlan, Prepared, StackNode};
use impeccable_core::browser::{BrowserConfig, ElId};
use impeccable_core::color::Rgba;
use serde_json::{json, Value};

use crate::cdp::{CdpError, CdpResult, Page, NATIVES_JS};

/// `browser-bundle/15-snapshot.js` — the page-measurement producer. It defines
/// `const __impeccableSnapshot = {...}` plus its helpers; [`ensure_snapshot_js`]
/// wraps it so it installs `window.__impeccableSnapshot` once per page.
const SNAPSHOT_JS: &str = include_str!("../../../browser-bundle/15-snapshot.js");

/// Install `window.__impeccableSnapshot` from [`SNAPSHOT_JS`] (idempotent).
/// [`NATIVES_JS`] goes first in the same function, so the producer reaches
/// the built-ins the new-document prelude stashed before the page's scripts
/// ran, not whatever the page left on `window` (a site's own global `Map`).
pub fn ensure_snapshot_js(page: &mut Page<'_>) -> CdpResult<()> {
    let expr = format!(
        "(function(){{ if (window.__impeccableSnapshot) return true;\n{NATIVES_JS}\n{SNAPSHOT_JS}\nwindow.__impeccableSnapshot = __impeccableSnapshot; return true; }})()"
    );
    page.evaluate_value(&expr)?;
    Ok(())
}

/// `__impeccableSnapshot.capture()` in the page: serialize the current DOM,
/// keep the capture (`window.__impCap`) and its visual IO (`window.__impIO`)
/// alive for hit-test answering and pixel reads, and hand the JSON back to be
/// parsed into a [`SnapshotDom`]. Every re-capture (after a scroll) replaces
/// the page-side capture/IO; ids are assigned in document order and so stay
/// stable across scrolls (the DOM is unchanged), which is why an earlier
/// snapshot's ids keep matching the page's current `__impCap`.
pub fn capture_snapshot(page: &mut Page<'_>) -> CdpResult<SnapshotDom> {
    parse_snapshot(&capture_snapshot_json(page)?)
}

/// [`capture_snapshot`] without the parse: the capture's JSON exactly as the
/// page produced it, which is what a replay loads.
pub fn capture_snapshot_json(page: &mut Page<'_>) -> CdpResult<String> {
    // The page-side default cap (48 MiB) exists for the extension's message
    // channel. Over CDP the websocket accepts 256 MiB (`cdp.rs`), so a URL scan
    // allows a capture up to 200 MiB: large commerce pages serialize to 70+ MiB
    // (cvs.com, 2026-09) and used to fail the scan outright.
    let expr = "(function(){ const s = window.__impeccableSnapshot; const c = s.capture({ maxBytes: 200 * 1024 * 1024 }); if (c.error) return { error: c.error }; window.__impCap = c; window.__impIO = s.visualIO(c); return { json: c.json }; })()";
    let out = page.evaluate_value(expr)?;
    if let Some(err) = out.get("error").and_then(Value::as_str) {
        return Err(CdpError::new(format!("snapshot capture failed: {err}")));
    }
    out.get("json")
        .and_then(Value::as_str)
        .map(String::from)
        .ok_or_else(|| CdpError::new("snapshot capture returned no json"))
}

/// Answer [`SnapshotDom::take_scroll_probes`]: scroll the page to each box
/// (its centre to the viewport's centre; for a box inside a `position:
/// sticky` stage, through the stage's scroll range in half-viewport steps),
/// wait a few frames, and read whether it is still at opacity 0.02 or less or
/// `visibility: hidden | collapse`. The page is scrolled back to the top and
/// given the same 700ms the reveal sweep gives it before anything reads it
/// again. Boxes the page no longer holds are left unanswered. The whole
/// probe stops after [`SCROLL_PROBE_BUDGET_MS`], and boxes it did not reach
/// are left unanswered too, so they count as hidden.
pub fn probe_shown_on_scroll(page: &mut Page<'_>, ids: &[ElId]) -> CdpResult<Vec<ScrollShown>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let expr = format!(
        r#"(async (ids, budget) => {{
  const cap = window.__impCap;
  const out = [];
  if (!cap || !cap.elements) return out;
  const started = performance.now();
  const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 60)));
  const shown = (el) => {{
    const cs = getComputedStyle(el);
    return parseFloat(cs.opacity) > 0.02 && cs.visibility !== 'hidden' && cs.visibility !== 'collapse';
  }};
  const docTop = (el) => el.getBoundingClientRect().top + window.scrollY;
  for (const id of ids) {{
    if (performance.now() - started > budget) break;
    const el = cap.elements[id];
    if (!el || !el.isConnected) continue;
    const vh = window.innerHeight;
    let stage = null;
    for (let a = el; a && a !== document.body; a = a.parentElement) {{
      if (getComputedStyle(a).position === 'sticky') {{ stage = a; break; }}
    }}
    const stops = [];
    if (stage && stage.parentElement) {{
      const host = stage.parentElement;
      const from = docTop(host) - vh / 2;
      const to = docTop(host) + host.getBoundingClientRect().height - vh / 2;
      for (let y = from; y <= to && stops.length < 12; y += Math.max(100, vh / 2)) stops.push(y);
    }}
    const r = el.getBoundingClientRect();
    stops.push(docTop(el) + r.height / 2 - vh / 2);
    let seen = false;
    for (const y of stops) {{
      window.scrollTo({{ top: Math.max(0, y), left: 0, behavior: 'instant' }});
      for (let i = 0; i < 4 && !seen; i++) {{ await frame(); seen = shown(el); }}
      if (seen) break;
    }}
    out.push({{ el: id, shown: seen }});
  }}
  window.scrollTo({{ top: 0, left: 0, behavior: 'instant' }});
  await new Promise(r => setTimeout(r, 700));
  return out;
}})({ids}, {budget})"#,
        ids = serde_json::to_string(ids).unwrap_or_else(|_| "[]".into()),
        budget = SCROLL_PROBE_BUDGET_MS,
    );
    let out = page.evaluate_value(&expr)?;
    Ok(serde_json::from_value(out).unwrap_or_default())
}

/// The time the scroll probe ([`probe_shown_on_scroll`]) may spend before
/// it stops asking. Each box takes about a quarter of a second, a sticky
/// stage up to three seconds.
pub const SCROLL_PROBE_BUDGET_MS: u64 = 5000;

/// Parse a capture's JSON into a [`SnapshotDom`].
pub fn parse_snapshot(json: &str) -> CdpResult<SnapshotDom> {
    SnapshotDom::from_json(json).map_err(|e| CdpError::new(format!("snapshot parse: {e}")))
}

/// Re-measure only the scroll-dependent geometry (`getBoundingClientRect`,
/// direct-text rect, `scrollX`/`scrollY`) of the already-captured page and
/// patch it onto a clone of `base`. A `scrollIntoView` moves the page but
/// leaves the DOM tree, attributes, computed styles, media, and keyframes
/// unchanged, and those are the only snapshot fields the visual path reads that
/// are *not* viewport-relative — so this reproduces a full re-capture's effect
/// on the visual pass at a fraction of the cost (no `getComputedStyle` sweep,
/// an ~80 KB payload instead of ~1.2 MB). Ids are document-order and so still
/// index the same elements; the page-side `__impCap` / `__impIO` (also
/// document-order) stay valid for hit-test answering and pixel reads.
pub fn recapture_geometry(page: &mut Page<'_>, base: &SnapshotDom) -> CdpResult<SnapshotDom> {
    // Direct-text rect inlined from 15-snapshot.js `__snapDirectTextRect` so no
    // change to the shared snapshot bundle is needed.
    let expr = r#"(function () {
  const cap = window.__impCap;
  if (!cap || !cap.elements) return null;
  const els = cap.elements;
  const dtr = (node) => {
    const rects = [];
    for (const child of node.childNodes) {
      if (child.nodeType !== 3 || !(child.textContent || '').trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(child);
      for (const rect of range.getClientRects()) {
        if (rect.width >= 1 && rect.height >= 1) rects.push(rect);
      }
      if (range.detach) range.detach();
    }
    if (rects.length === 0) return null;
    const left = Math.min(...rects.map(r => r.left));
    const top = Math.min(...rects.map(r => r.top));
    const right = Math.max(...rects.map(r => r.right));
    const bottom = Math.max(...rects.map(r => r.bottom));
    return [left, top, right - left, bottom - top];
  };
  const rects = new Array(els.length - 1);
  const dtrs = new Array(els.length - 1);
  for (let id = 1; id < els.length; id++) {
    const el = els[id];
    rects[id - 1] = (el && typeof el.getBoundingClientRect === 'function')
      ? (r => [r.x, r.y, r.width, r.height])(el.getBoundingClientRect()) : null;
    dtrs[id - 1] = el ? dtr(el) : null;
  }
  return { scrollX: window.scrollX, scrollY: window.scrollY, rects, dtrs };
})()"#;
    let out = page.evaluate_value(expr)?;
    let mut snap = base.snap.clone();
    if out.is_object() {
        snap.scroll_x = out.get("scrollX").and_then(Value::as_f64).unwrap_or(snap.scroll_x);
        snap.scroll_y = out.get("scrollY").and_then(Value::as_f64).unwrap_or(snap.scroll_y);
        let rects = out.get("rects").and_then(Value::as_array);
        let dtrs = out.get("dtrs").and_then(Value::as_array);
        let rect4 = |v: Option<&Value>| -> Option<[f64; 4]> {
            let a = v?.as_array()?;
            if a.len() < 4 {
                return None;
            }
            Some([a[0].as_f64()?, a[1].as_f64()?, a[2].as_f64()?, a[3].as_f64()?])
        };
        for (i, node) in snap.els.iter_mut().enumerate() {
            if let Some(rects) = rects {
                if let Some(cell) = rects.get(i) {
                    node.rect = rect4(Some(cell));
                }
            }
            if let Some(dtrs) = dtrs {
                if let Some(cell) = dtrs.get(i) {
                    node.direct_text_rect = rect4(Some(cell));
                }
            }
        }
    }
    Ok(SnapshotDom::new(snap))
}

/// Answer the hit-test points a run recorded (`__impeccableSnapshot.answer`
/// over the live page and the held capture).
fn answer_needs(page: &mut Page<'_>, hit_tests: &[[f64; 2]]) -> CdpResult<Facts> {
    if hit_tests.is_empty() {
        return Ok(Facts::default());
    }
    let hits = serde_json::to_string(hit_tests).unwrap_or_else(|_| "[]".into());
    let expr = format!(
        "(function(){{ return window.__impeccableSnapshot.answer({{ hitTests: {hits} }}, window.__impCap); }})()"
    );
    let out = page.evaluate_value(&expr)?;
    Ok(serde_json::from_value(out).unwrap_or_default())
}

/// Run `f` over the snapshot, and while it recorded hit-test misses, answer
/// them from the live page and re-run — the offscreen `core()` fixpoint
/// (60-offscreen.js). Deterministic runs converge in one or two rounds; the
/// cap only guards against a page that refuses to answer.
pub fn resolve_needs<T>(
    dom: &SnapshotDom,
    page: &mut Page<'_>,
    f: impl Fn(&SnapshotDom) -> T,
) -> CdpResult<T> {
    resolve_needs_recording(dom, page, f, None)
}

/// [`resolve_needs`], appending every answered hit test to `record` so the
/// run can be replayed over the same capture without the page.
pub fn resolve_needs_recording<T>(
    dom: &SnapshotDom,
    page: &mut Page<'_>,
    f: impl Fn(&SnapshotDom) -> T,
    mut record: Option<&mut Facts>,
) -> CdpResult<T> {
    let mut out = f(dom);
    let mut rounds = 0;
    while dom.has_needs() && rounds < 12 {
        let needs = dom.take_needs();
        let facts = answer_needs(page, &needs.hit_tests)?;
        dom.add_facts(&facts);
        if let Some(record) = record.as_deref_mut() {
            record.hits.extend(facts.hits.iter().cloned());
        }
        out = f(dom);
        rounds += 1;
    }
    // Drain anything still pending so a later stage starts clean.
    let _ = dom.take_needs();
    Ok(out)
}

/// The design-system config the browser rules read, built the way
/// `configure-pure-detect` fed `window.__IMPECCABLE_CONFIG__` to the bundle,
/// plus the rule pack the caller installed (`None` in the `impeccable`
/// binary) and the rules the caller leaves out of the report
/// ([`BrowserConfig::unreported_rules`]).
pub fn browser_config(
    design_system: Value,
    rule_pack: Option<&'static dyn impeccable_core::rule_pack::RulePack>,
    unreported_rules: &[String],
) -> BrowserConfig {
    BrowserConfig {
        extension_mode: false,
        disabled_rules: Vec::new(),
        disabled_values: Vec::new(),
        skip_scan: false,
        design_system: if design_system.is_null() {
            None
        } else {
            Some(design_system)
        },
        line_length_max: None,
        unreported_rules: unreported_rules.to_vec(),
        rule_pack,
    }
}

// ─── the visual-contrast pass (port of 35-visual.js) ───────────────────────

/// A loaded image the page holds for pixel reads.
struct LoadedImage {
    /// The `ref` the page's `readPixel` maps back to the drawable (`{ url }`).
    reference: Value,
    w: f64,
    h: f64,
}

/// `IO.loadImage(src)` in the page (the visual IO's image cache persists on
/// `window.__impIO`).
fn load_image(page: &mut Page<'_>, src: &str) -> CdpResult<Option<LoadedImage>> {
    let expr = format!(
        "(async () => {{ return await window.__impIO.loadImage({}); }})()",
        json!(src)
    );
    let out = page.evaluate_value(&expr)?;
    if out.is_null() {
        return Ok(None);
    }
    let reference = out.get("ref").cloned().unwrap_or(Value::Null);
    let w = out.get("w").and_then(Value::as_f64).unwrap_or(0.0);
    let h = out.get("h").and_then(Value::as_f64).unwrap_or(0.0);
    Ok(Some(LoadedImage { reference, w, h }))
}

/// `IO.readPixel(ref, plan, px, py)` in the page. `reference` is a snapshot id
/// (a page drawable) or a `loadImage` ref (`{ url }`).
fn read_pixel(
    page: &mut Page<'_>,
    reference: &Value,
    plan: &Value,
    px: f64,
    py: f64,
) -> CdpResult<Value> {
    let expr = format!(
        "(async () => {{ return await window.__impIO.readPixel({}, {}, {}, {}); }})()",
        reference,
        plan,
        json!(px),
        json!(py)
    );
    page.evaluate_value(&expr)
}

fn live_scroll(page: &mut Page<'_>) -> CdpResult<(f64, f64)> {
    let out = page.evaluate_value("({ x: window.scrollX, y: window.scrollY })")?;
    Ok((
        out.get("x").and_then(Value::as_f64).unwrap_or(0.0),
        out.get("y").and_then(Value::as_f64).unwrap_or(0.0),
    ))
}

fn scroll_to(page: &mut Page<'_>, x: f64, y: f64) -> CdpResult<()> {
    let expr = format!("(function(){{ window.scrollTo({}, {}); }})()", json!(x), json!(y));
    page.evaluate_value(&expr)?;
    Ok(())
}

fn scroll_into_view(page: &mut Page<'_>, candidate: &Value) -> CdpResult<bool> {
    let selector = candidate.get("selector").and_then(Value::as_str).unwrap_or("");
    let identity = candidate.get("match").cloned().unwrap_or(Value::Null);
    // Every ancestor's offset is kept before the scroll, so an element scroller
    // it moves (a page that scrolls inside its body or an app shell's main) can
    // be put back: `window.scrollTo` never reaches those.
    let expr = format!(
        "(function(){{ const el = ({})({}, {}); if (!el || typeof el.scrollIntoView !== 'function') return false; const saved = window.__impeccableVisualScrollSaved || (window.__impeccableVisualScrollSaved = new Map()); const up = n => n.assignedSlot || n.parentElement || (n.parentNode && n.parentNode.host) || null; for (let p = up(el); p; p = up(p)) {{ if (!saved.has(p)) saved.set(p, [p.scrollTop, p.scrollLeft]); }} el.scrollIntoView({{ block: 'center', inline: 'nearest', behavior: 'instant' }}); return true; }})()",
        crate::screenshot_contrast::PICK_CANDIDATE_JS,
        json!(selector),
        identity
    );
    Ok(page.evaluate_value(&expr)?.as_bool() == Some(true))
}

/// Put back the element offsets [`scroll_into_view`] moved. Returns whether
/// any element had moved.
fn restore_element_scroll(page: &mut Page<'_>) -> CdpResult<bool> {
    let out = page.evaluate_value(
        "(function(){ const saved = window.__impeccableVisualScrollSaved; window.__impeccableVisualScrollSaved = undefined; if (!saved) return false; let moved = false; for (const [p, [t, l]] of saved) { if (p.scrollTop !== t || p.scrollLeft !== l) { p.scrollTo({ top: t, left: l, behavior: 'instant' }); moved = true; } } return moved; })()",
    )?;
    Ok(out.as_bool() == Some(true))
}

fn wait_for_paint(page: &mut Page<'_>) -> CdpResult<()> {
    page.evaluate_value(
        "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(0))))",
    )?;
    Ok(())
}

fn media(dom: &SnapshotDom, el: ElId) -> impeccable_core::browser::snapshot::MediaInfo {
    dom.snap
        .get(el)
        .and_then(|n| n.media.clone())
        .unwrap_or_default()
}

/// `IO.intrinsicImg` over the snapshot (`naturalWidth || videoWidth || width`).
fn intrinsic_img(dom: &SnapshotDom, el: ElId) -> (f64, f64) {
    let m = media(dom, el);
    (
        first_nonzero(&[m.nw, m.vw, m.w]),
        first_nonzero(&[m.nh, m.vh, m.h]),
    )
}

/// `IO.intrinsicRaster` over the snapshot (`width || videoWidth`).
fn intrinsic_raster(dom: &SnapshotDom, el: ElId) -> (f64, f64) {
    let m = media(dom, el);
    (first_nonzero(&[m.w, m.vw]), first_nonzero(&[m.h, m.vh]))
}

fn img_src(dom: &SnapshotDom, el: ElId) -> String {
    let m = media(dom, el);
    if !m.cur.is_empty() {
        m.cur
    } else {
        m.src
    }
}

/// JS `a || b || 0` over the media numbers (0/NaN are falsy).
fn first_nonzero(vals: &[f64]) -> f64 {
    for &v in vals {
        if v != 0.0 && !v.is_nan() {
            return v;
        }
    }
    0.0
}

fn is_sampled(sample: &Value) -> bool {
    sample.get("status").and_then(Value::as_str) == Some("sampled")
}

fn sample_reason(sample: &Value) -> String {
    sample
        .get("reason")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

/// Port of `sampleDrawablePixel`: the raster plan and pixel address come from
/// the core, the read from the page.
fn sample_drawable_pixel(
    page: &mut Page<'_>,
    reference: &Value,
    intrinsic: (f64, f64),
    source_x: f64,
    source_y: f64,
) -> CdpResult<Value> {
    let plan = visual::raster_plan(intrinsic.0, intrinsic.1);
    let (rpx, rpy) = visual::raster_pixel(&plan, source_x, source_y);
    let plan_json = serde_json::to_value(plan).unwrap_or(Value::Null);
    let read = read_pixel(page, reference, &plan_json, rpx, rpy)?;
    if read.get("noContext").and_then(Value::as_bool) == Some(true) {
        return Ok(visual::raster_no_context_sample());
    }
    if let Some(err) = read.get("error") {
        let reason = visual::raster_error_reason(err.as_str().unwrap_or(""));
        return Ok(visual::raster_failure_sample(&reason));
    }
    let d = read.get("data").and_then(Value::as_array);
    let ch = |i: usize| -> f64 {
        d.and_then(|a| a.get(i))
            .and_then(Value::as_f64)
            .unwrap_or(0.0)
    };
    Ok(visual::pixel_sample(ch(0), ch(1), ch(2), ch(3)))
}

/// Port of `sampleImageElement`.
fn sample_image_element(
    page: &mut Page<'_>,
    dom: &SnapshotDom,
    node: ElId,
    px: f64,
    py: f64,
) -> CdpResult<Value> {
    let intrinsic = intrinsic_img(dom, node);
    let (painted, source) = match visual::img_source_point(dom, node, intrinsic.0, intrinsic.1, px, py) {
        Err(sample) => return Ok(sample),
        Ok(v) => v,
    };
    let node_ref = json!(node);
    let sample = sample_drawable_pixel(page, &node_ref, intrinsic, source.0, source.1)?;
    let finished = visual::img_finish(sample.clone());
    if is_sampled(&finished) {
        return Ok(finished);
    }
    let src = img_src(dom, node);
    if !src.is_empty() {
        if let Some(loaded) = load_image(page, &src)? {
            if let Some(point) = visual::img_loaded_source_point(&painted, loaded.w, loaded.h, px, py) {
                let pixel = sample_drawable_pixel(
                    page,
                    &loaded.reference,
                    (loaded.w, loaded.h),
                    point.0,
                    point.1,
                )?;
                let loaded_sample = visual::img_finish(pixel);
                if is_sampled(&loaded_sample) {
                    return Ok(loaded_sample);
                }
            }
        }
    }
    Ok(sample)
}

/// Port of `sampleCssBackground`. `el` is the candidate whose text is being
/// sampled, which decides whether an image is under that text at all.
#[allow(clippy::too_many_arguments)]
fn sample_css_background(
    page: &mut Page<'_>,
    dom: &SnapshotDom,
    node: ElId,
    el: ElId,
    px: f64,
    py: f64,
    text_color: &Rgba,
) -> CdpResult<Value> {
    match visual::css_plan(dom, node, Some(text_color)) {
        CssPlan::Sample { sample } => Ok(sample),
        CssPlan::Url { url, size, position } => {
            let Some(img) = load_image(page, &url)? else {
                return Ok(visual::css_url_no_image(dom, node, el, &size, &position));
            };
            match visual::css_url_source_point(dom, node, el, img.w, img.h, &size, &position, px, py) {
                Err(sample) => Ok(sample),
                Ok(source) => {
                    let pixel = sample_drawable_pixel(
                        page,
                        &img.reference,
                        (img.w, img.h),
                        source.0,
                        source.1,
                    )?;
                    Ok(visual::css_url_finish(dom, node, pixel))
                }
            }
        }
    }
}

/// Port of `analyzeVisualContrastCandidate` over one snapshot.
fn analyze_candidate(
    page: &mut Page<'_>,
    dom: &SnapshotDom,
    candidate: &Value,
) -> CdpResult<Value> {
    let prepared = resolve_needs(dom, page, |d| visual::prepare_analysis(d, candidate))?;
    let (el, points, text_color) = match prepared {
        Prepared::Early { early } => return Ok(early),
        Prepared::Ready { el, points, text_color } => (el, points, text_color),
    };
    let mut samples: Vec<Value> = Vec::with_capacity(points.len());
    for point in &points {
        let px = point.get("x").and_then(Value::as_f64).unwrap_or(0.0);
        let py = point.get("y").and_then(Value::as_f64).unwrap_or(0.0);
        samples.push(sample_background(page, dom, el, px, py, &text_color)?);
    }
    Ok(visual::finish_analysis(candidate, &text_color, &samples, points.len()))
}

/// The stack walk with the candidate's text color carried explicitly (the css
/// leaf needs it for gradient contrast picking / alpha compositing).
fn sample_background(
    page: &mut Page<'_>,
    dom: &SnapshotDom,
    el: ElId,
    px: f64,
    py: f64,
    text_color: &Rgba,
) -> CdpResult<Value> {
    sample_background_impl(page, dom, el, px, py, 0.0, text_color)
}

fn sample_background_impl(
    page: &mut Page<'_>,
    dom: &SnapshotDom,
    el: ElId,
    px: f64,
    py: f64,
    depth: f64,
    text_color: &Rgba,
) -> CdpResult<Value> {
    let walk = resolve_needs(dom, page, |d| visual::stack_nodes(d, el, px, py, depth))?;
    let nodes = match walk {
        Err(unresolved) => return Ok(unresolved),
        Ok(nodes) => nodes,
    };
    let mut unresolved: Vec<String> = Vec::new();
    // Translucent surfaces the walk passed through, topmost first. The walk
    // keeps descending the same stack for the opaque ground under them: a
    // surface's own parent sits below siblings that paint over it, so
    // restarting the walk there would skip whatever those paint.
    let mut pending: Vec<Value> = Vec::new();
    for StackNode { el: node, kind } in nodes {
        let sample = match kind.as_str() {
            "img" => visual::media_sample(dom, node, el, sample_image_element(page, dom, node, px, py)?),
            "raster" => {
                let intrinsic = intrinsic_raster(dom, node);
                match visual::raster_source_point(dom, node, intrinsic.0, intrinsic.1, px, py) {
                    Some(source) => {
                        let node_ref = json!(node);
                        let pixel =
                            sample_drawable_pixel(page, &node_ref, intrinsic, source.0, source.1)?;
                        visual::media_sample(dom, node, el, visual::raster_finish(dom, node, pixel))
                    }
                    // Outside the drawable: nothing sampled, nothing to say.
                    None => continue,
                }
            }
            // Paint this walk cannot read (vector artwork).
            "unreadable" => visual::unreadable_stack_sample(dom, node),
            _ => sample_css_background(page, dom, node, el, px, py, text_color)?,
        };
        if is_sampled(&sample) {
            if visual::sample_is_opaque(&sample) {
                return Ok(visual::composite_stack(&pending, &sample));
            }
            pending.push(sample);
            continue;
        }
        unresolved.push(sample_reason(&sample));
        if visual::sample_ends_walk(&sample) {
            break;
        }
    }
    Ok(visual::unresolved_from_reasons(&unresolved))
}

/// Port of `analyzeVisualContrast`: candidates from the core, one analysis per
/// candidate, with the `scrollOffscreen` restore/retry the URL engine uses.
/// `base` is the scroll-0 snapshot; a retry scrolls the element into view and
/// re-captures, then restores.
pub fn analyze_visual_contrast(
    page: &mut Page<'_>,
    base: &SnapshotDom,
    max_candidates: f64,
    max_routed: f64,
    scroll_offscreen: bool,
) -> CdpResult<Vec<Value>> {
    let options = json!({ "maxCandidates": max_candidates, "maxRoutedCandidates": max_routed });
    let candidates = resolve_needs(base, page, |d| {
        visual::collect_visual_contrast_candidates(d, &options)
    })?;
    let mut results: Vec<Value> = Vec::with_capacity(candidates.len());
    let restore = live_scroll(page)?;
    // Set once a retry scrolled, so a page that never retried pays nothing.
    let mut retried = false;
    for candidate in &candidates {
        if scroll_offscreen {
            // Back to the scroll the base snapshot measured, element scrollers
            // included, before the next candidate reads the live page with the
            // base geometry.
            let element_moved = retried && restore_element_scroll(page)?;
            retried = false;
            let now = live_scroll(page)?;
            if now != restore {
                scroll_to(page, restore.0, restore.1)?;
                wait_for_paint(page)?;
            } else if element_moved {
                wait_for_paint(page)?;
            }
        }
        let mut result = analyze_candidate(page, base, candidate)?;
        if scroll_offscreen && visual::needs_scroll_retry(&result) {
            if scroll_into_view(page, candidate)? {
                retried = true;
                wait_for_paint(page)?;
                // Only geometry changed (the page scrolled); patch it onto the
                // base snapshot rather than re-capturing the whole page.
                let scrolled = recapture_geometry(page, base)?;
                result = analyze_candidate(page, &scrolled, candidate)?;
            }
        }
        results.push(result);
    }
    if scroll_offscreen {
        let element_moved = retried && restore_element_scroll(page)?;
        let now = live_scroll(page)?;
        if now != restore {
            scroll_to(page, restore.0, restore.1)?;
        } else if element_moved {
            wait_for_paint(page)?;
        }
    }
    Ok(results)
}
