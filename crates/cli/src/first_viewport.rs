//! `impeccable first-viewport <url> --thesis <selector> --action <selector>`:
//! the build's own first-viewport check, run before the finish review.
//!
//! At each viewport (390x844 and 1440x900 unless `--viewport WxH` names
//! others) it loads the page and measures three things the reviewer would
//! otherwise send back:
//! - how much of the thesis (the elements matching `--thesis`, which the
//!   direction contract's FIRST VIEWPORT names) shows in the first viewport,
//!   after clipping by every scrolling or clipping ancestor; under half fails;
//! - whether the primary action (`--action`) sits wholly inside it;
//! - the longest stretch of the full page with nothing on it; more than 0.6
//!   of the viewport's height fails.
//!
//! It prints one line per measure and exits 1 when any fails.

use std::time::Duration;

use impeccable_browser::cdp::{default_chrome_args, Browser, EvalOutcome, Page, Viewport};
use impeccable_browser::{discovery, fullpage};
use impeccable_common::Io;
use serde_json::Value;

const NAV_TIMEOUT: Duration = Duration::from_secs(30);
/// The share of the thesis that has to show in the first viewport.
const THESIS_MIN_SHARE: f64 = 0.5;
/// The longest empty stretch allowed, as a share of the viewport's height.
const BLANK_MAX_SHARE: f64 = 0.6;
/// Full-page captures stop here.
const MAX_CAPTURE_HEIGHT: f64 = 20000.0;

const USAGE: &str = "Usage: impeccable first-viewport <url> --thesis <selector> --action <selector> [--viewport WxH ...]\n";

/// Each selector's share of its painted area inside the first viewport, and
/// whether its box sits wholly inside it, clipped by every ancestor that
/// clips (a scroller shows only its own box).
const MEASURE_JS: &str = r#"((selectors) => {
  window.scrollTo(0, 0);
  const vw = innerWidth, vh = innerHeight;
  const clip = (r, c) => ({ l: Math.max(r.l, c.l), t: Math.max(r.t, c.t), r: Math.min(r.r, c.r), b: Math.min(r.b, c.b) });
  const area = (r) => Math.max(0, r.r - r.l) * Math.max(0, r.b - r.t);
  // Hidden by visibility, opacity or display shows nothing, whatever its box.
  // A face turned away under `backface-visibility: hidden` (the back of a
  // card that flips) is not on screen either: compose the transforms from
  // the root and read where the face's normal points (m33 < 0 is away).
  const facesAway = (el) => {
    const chain = [];
    for (let n = el; n instanceof Element; n = n.parentElement) chain.unshift(n);
    let m = new DOMMatrix();
    for (const n of chain) {
      const cs = getComputedStyle(n);
      if (cs.transform && cs.transform !== 'none') m = m.multiply(new DOMMatrix(cs.transform));
      if (m.m33 < 0 && cs.backfaceVisibility === 'hidden') return true;
    }
    return false;
  };
  // An element's box as it can show: cut by every ancestor that clips. For
  // media rows only, a box the height of the viewport (an app shell, a
  // scrolling or clipped body) does not cut, since the full-page capture
  // unrolls its scroller; the thesis and action keep every clip.
  const pageScroller = (a) => a.clientHeight >= innerHeight * 0.9;
  const shownBox = (el, forMedia = false) => {
    const b = el.getBoundingClientRect();
    let box = { l: b.left, t: b.top, r: b.right, b: b.bottom };
    for (let a = el.parentElement; a; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if ((cs.overflowX !== 'visible' || cs.overflowY !== 'visible') && !(forMedia && pageScroller(a))) {
        const ab = a.getBoundingClientRect();
        box = clip(box, { l: ab.left, t: ab.top, r: ab.right, b: ab.bottom });
      }
    }
    return { whole: { l: b.left, t: b.top, r: b.right, b: b.bottom }, box };
  };
  const seen = (el) => el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, opacityProperty: true, visibilityProperty: true }) && !facesAway(el);
  const out = {};
  // Drawn and embedded media, in document rows: a sparse drawing or a lazy
  // image's reserved box is content, not an empty stretch.
  out.media = [...document.querySelectorAll('img, svg, canvas, video, picture, iframe, object, embed')]
    .filter((el) => !(el instanceof SVGElement && el.ownerSVGElement) && seen(el))
    .map((el) => shownBox(el, true).box)
    .filter((r) => r.r > r.l && r.b > r.t)
    .map((r) => [Math.max(0, Math.floor(r.t + scrollY)), Math.ceil(r.b + scrollY)]);
  for (const [key, sel] of Object.entries(selectors)) {
    if (!sel) continue;
    let els = [];
    try { els = [...document.querySelectorAll(sel)]; } catch (e) { out[key] = { error: 'not a valid selector' }; continue; }
    let total = 0, shown = 0, inside = els.length > 0;
    for (const el of els) {
      if (!seen(el)) continue;
      const { whole: b0, box } = shownBox(el);
      const b = { top: b0.t, left: b0.l, bottom: b0.b, right: b0.r };
      const whole = area(b0);
      if (whole === 0) continue;
      const visible = clip(box, { l: 0, t: 0, r: vw, b: vh });
      // A thesis that scrolls inside itself shows only its own box of the
      // whole: five plates in a row that shows two and a half show half.
      const own = getComputedStyle(el);
      const sx = own.overflowX !== 'visible' && el.scrollWidth > el.clientWidth ? el.clientWidth / el.scrollWidth : 1;
      const sy = own.overflowY !== 'visible' && el.scrollHeight > el.clientHeight ? el.clientHeight / el.scrollHeight : 1;
      total += whole;
      shown += area(visible) * sx * sy;
      if (b.top < 0 || b.left < 0 || b.bottom > vh || b.right > vw || area(visible) < whole - 1) inside = false;
    }
    out[key] = { matched: els.length, share: total ? shown / total : 0, inside: total > 0 && inside };
  }
  return out;
})"#;

fn launch(io: &Io) -> Result<Browser, String> {
    let exe = discovery::find_browser(&io.env)?;
    let mut user_args: Vec<String> = Vec::new();
    if io.env.get("CI").map(|v| !v.is_empty()).unwrap_or(false) {
        user_args.push("--no-sandbox".into());
        user_args.push("--disable-setuid-sandbox".into());
    }
    let dangerous = io.env.get("PUPPETEER_DANGEROUS_NO_SANDBOX").map(String::as_str) == Some("true");
    let _ = default_chrome_args(&user_args, dangerous);
    Browser::launch(&exe, &user_args, dangerous).map_err(|e| e.message)
}

/// A `file://` URL for an absolute path, on Windows too (without the `\\?\\`
/// prefix `canonicalize` adds there).
fn file_url(path: &std::path::Path) -> String {
    let shown = path.display().to_string();
    let plain = std::path::PathBuf::from(shown.strip_prefix(r"\\?\").unwrap_or(&shown));
    url::Url::from_file_path(&plain).map(|u| u.to_string()).unwrap_or_else(|_| format!("file://{shown}"))
}

fn parse_viewport(s: &str) -> Option<Viewport> {
    let (w, h) = s.split_once('x')?;
    Some(Viewport { width: w.trim().parse().ok()?, height: h.trim().parse().ok()? })
}

fn js_string(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| "\"\"".into())
}

/// One viewport's lines and whether any failed.
fn check(page: &mut Page<'_>, url: &str, vp: Viewport, thesis: Option<&str>, action: Option<&str>) -> Result<(Vec<String>, bool), String> {
    page.set_viewport(vp).map_err(|e| e.message)?;
    page.goto(url, "load", NAV_TIMEOUT).map_err(|e| e.message)?;
    // Lazy images below the fold would capture as blank boxes: load them all.
    let _ = page.evaluate(
        "(async () => { for (const i of document.querySelectorAll('img[loading=lazy]')) i.loading = 'eager'; \
         await Promise.all([...document.images].map((i) => i.complete ? null : new Promise((r) => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); setTimeout(r, 5000); }))); \
         await document.fonts.ready; await new Promise((r) => setTimeout(r, 400)); })()",
    );
    let label = format!("{}x{}", vp.width, vp.height);
    let mut lines = Vec::new();
    let mut failed = false;
    let selectors = format!(
        "{MEASURE_JS}({{thesis: {}, action: {}}})",
        js_string(thesis.unwrap_or("")),
        js_string(action.unwrap_or(""))
    );
    let measured = match page.evaluate(&selectors) {
        Ok(EvalOutcome::Value(v)) => v,
        _ => Value::Null,
    };
    for (key, sel, what) in [("thesis", thesis, "thesis"), ("action", action, "primary action")] {
        let Some(sel) = sel else { continue };
        let m = &measured[key];
        let matched = m["matched"].as_u64().unwrap_or(0);
        let line = if m.get("error").is_some() || matched == 0 {
            failed = true;
            format!("{label}  FAIL  {what} {sel}: matches nothing on the page")
        } else if key == "thesis" {
            let share = m["share"].as_f64().unwrap_or(0.0);
            let ok = share >= THESIS_MIN_SHARE;
            failed |= !ok;
            format!(
                "{label}  {}  {what} {sel}: {:.0}% shows in the first viewport{}",
                if ok { "ok  " } else { "FAIL" },
                share * 100.0,
                if ok { String::new() } else { format!(" (needs {:.0}%)", THESIS_MIN_SHARE * 100.0) }
            )
        } else {
            let ok = m["inside"].as_bool().unwrap_or(false);
            failed |= !ok;
            format!(
                "{label}  {}  {what} {sel}: {}",
                if ok { "ok  " } else { "FAIL" },
                if ok { "wholly inside the first viewport" } else { "not wholly inside the first viewport" }
            )
        };
        lines.push(line);
    }
    let shot = fullpage::capture_full_page(page, MAX_CAPTURE_HEIGHT, 90).map_err(|e| e.message)?;
    let img = fullpage::decode_jpeg(&shot.jpeg_base64).ok_or("the full-page capture did not decode")?;
    let media: Vec<(u32, u32)> = measured["media"]
        .as_array()
        .map(|rows| {
            rows.iter()
                .filter_map(|r| Some((r[0].as_f64()? as u32, r[1].as_f64()? as u32)))
                .collect()
        })
        .unwrap_or_default();
    let (start, len) = fullpage::longest_empty_band(&img, &media);
    let limit = (vp.height as f64 * BLANK_MAX_SHARE).round() as u32;
    let ok = len <= limit;
    failed |= !ok;
    lines.push(format!(
        "{label}  {}  longest empty stretch: {len}px at y {start} of {}px{}",
        if ok { "ok  " } else { "FAIL" },
        img.height(),
        if ok { String::new() } else { format!(" (at most {limit}px, 0.6 of the viewport)") }
    ));
    Ok((lines, failed))
}

pub fn run(rest: &[String], io: &mut Io) -> i32 {
    let mut url: Option<String> = None;
    let mut thesis: Option<String> = None;
    let mut action: Option<String> = None;
    let mut viewports: Vec<Viewport> = Vec::new();
    let mut it = rest.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--thesis" => thesis = it.next().cloned(),
            "--action" => action = it.next().cloned(),
            "--viewport" => match it.next().and_then(|v| parse_viewport(v)) {
                Some(v) => viewports.push(v),
                None => {
                    io.err("--viewport takes WIDTHxHEIGHT, e.g. 390x844\n");
                    return 2;
                }
            },
            "--help" | "-h" => {
                io.out(USAGE);
                return 0;
            }
            v if !v.starts_with("--") && url.is_none() => url = Some(v.to_string()),
            v => {
                io.err(&format!("Unknown argument: {v}\n{USAGE}"));
                return 2;
            }
        }
    }
    let (Some(url), Some(thesis), Some(action)) = (
        url,
        thesis.filter(|s| !s.trim().is_empty()),
        action.filter(|s| !s.trim().is_empty()),
    ) else {
        io.err(USAGE);
        return 2;
    };
    let url = if url.contains("://") {
        url
    } else {
        let path = io.cwd.join(&url);
        match path.canonicalize() {
            Ok(p) => file_url(&p),
            Err(_) => {
                io.err(&format!("No page at {url}\n"));
                return 2;
            }
        }
    };
    if viewports.is_empty() {
        viewports = vec![Viewport { width: 390, height: 844 }, Viewport { width: 1440, height: 900 }];
    }
    let mut browser = match launch(io) {
        Ok(b) => b,
        Err(e) => {
            io.err(&format!("first-viewport needs a Chrome or Chromium: {e}\n"));
            return 2;
        }
    };
    let mut any_failed = false;
    let mut out = String::new();
    for vp in viewports {
        let result = match browser.new_page() {
            Ok(mut page) => {
                let r = check(&mut page, &url, vp, Some(&thesis), Some(&action));
                page.close();
                r
            }
            Err(e) => Err(e.message),
        };
        match result {
            Ok((lines, failed)) => {
                any_failed |= failed;
                for l in lines {
                    out.push_str(&l);
                    out.push('\n');
                }
            }
            Err(e) => {
                any_failed = true;
                out.push_str(&format!("{}x{}  FAIL  the page did not load: {e}\n", vp.width, vp.height));
            }
        }
    }
    browser.close();
    io.out(&out);
    if any_failed { 1 } else { 0 }
}
