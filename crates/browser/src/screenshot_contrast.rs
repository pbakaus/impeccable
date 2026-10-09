//! Port of `cli/engine/engines/visual/screenshot-contrast.mjs`: the pixel
//! fallback for text over visual backgrounds. Two clipped screenshots (text
//! visible, text hidden) are diffed; the JS does the diff on an in-page
//! canvas, this port decodes the PNGs with the `png` crate and runs the same
//! arithmetic (channel-delta gate ≥ 10, `toFixed(1)` in the snippet). Which of
//! the changed pixels answer for the text, and when the set answers nothing,
//! are decisions in `impeccable_core::browser::visual`.

use base64::Engine as _;
use impeccable_core::browser::visual::{
    self, GlyphPixel, PixelContrastOutcome, GLYPH_MIN_PIXELS,
};
use impeccable_core::js::{math_max, number_to_string};
use serde_json::{json, Value};

use crate::cdp::{CdpResult, Page};

/// JS `sanitizeScreenshotClip(clip, viewport)`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Clip {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

fn num(v: Option<&Value>) -> f64 {
    // JS `clip.x || 0`: null/undefined/NaN → 0.
    match v {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0),
        Some(Value::Bool(true)) => 1.0,
        Some(Value::String(s)) => {
            let n = impeccable_core::js::string_to_number(s);
            if n.is_nan() {
                0.0
            } else {
                n
            }
        }
        _ => 0.0,
    }
}

/// JS: screenshot-contrast.mjs#sanitizeScreenshotClip
pub fn sanitize_screenshot_clip(clip: Option<&Value>, viewport_width: Option<f64>) -> Option<Clip> {
    let clip = clip?;
    if clip.is_null() || !clip.is_object() {
        return None;
    }
    let x = math_max(0.0, num(clip.get("x")).floor());
    let y = math_max(0.0, num(clip.get("y")).floor());
    let vw = match viewport_width {
        Some(w) if w != 0.0 => w,
        _ => 1600.0,
    };
    let width = f64::min(
        math_max(1.0, num(clip.get("width")).ceil()),
        math_max(1.0, vw),
    );
    let height = f64::min(math_max(1.0, num(clip.get("height")).ceil()), 320.0);
    if width < 1.0 || height < 1.0 {
        return None;
    }
    Some(Clip {
        x,
        y,
        width,
        height,
    })
}

/// The `compareScreenshotContrast` result.
#[derive(Debug, Clone, PartialEq)]
pub struct ContrastMetrics {
    pub glyph_pixels: usize,
    pub strongest_delta: f64,
    pub outcome: PixelContrastOutcome,
}

fn decode_png_rgba(base64_data: &str) -> Option<(u32, u32, Vec<u8>)> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_data.as_bytes())
        .ok()?;
    let decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    let mut reader = decoder.read_info().ok()?;
    let mut buf = vec![0u8; reader.output_buffer_size()?];
    let info = reader.next_frame(&mut buf).ok()?;
    let (w, h) = (info.width, info.height);
    let bit_depth = info.bit_depth;
    let bytes_per_sample = match bit_depth {
        png::BitDepth::Sixteen => 2,
        _ => 1,
    };
    let channels = match info.color_type {
        png::ColorType::Grayscale => 1,
        png::ColorType::GrayscaleAlpha => 2,
        png::ColorType::Rgb => 3,
        png::ColorType::Rgba => 4,
        png::ColorType::Indexed => return None,
    };
    let stride = info.line_size;
    let mut out = Vec::with_capacity((w * h * 4) as usize);
    for row in 0..h as usize {
        let line = &buf[row * stride..row * stride + (w as usize) * channels * bytes_per_sample];
        for px in 0..w as usize {
            let sample = |c: usize| -> u8 {
                let i = (px * channels + c) * bytes_per_sample;
                line[i]
            };
            let (r, g, b, a) = match channels {
                1 => (sample(0), sample(0), sample(0), 255),
                2 => (sample(0), sample(0), sample(0), sample(1)),
                3 => (sample(0), sample(1), sample(2), 255),
                _ => (sample(0), sample(1), sample(2), sample(3)),
            };
            out.extend_from_slice(&[r, g, b, a]);
        }
    }
    Some((w, h, out))
}

fn luminance(r: f64, g: f64, b: f64) -> f64 {
    let convert = |c: f64| {
        let v = c / 255.0;
        if v <= 0.03928 {
            v / 12.92
        } else {
            impeccable_core::js::math_pow((v + 0.055) / 1.055, 2.4)
        }
    };
    0.2126 * convert(r) + 0.7152 * convert(g) + 0.0722 * convert(b)
}

fn ratio(a: (f64, f64, f64), b: (f64, f64, f64)) -> f64 {
    let l1 = luminance(a.0, a.1, a.2);
    let l2 = luminance(b.0, b.1, b.2);
    (f64::max(l1, l2) + 0.05) / (f64::min(l1, l2) + 0.05)
}

/// JS: screenshot-contrast.mjs#compareScreenshotContrast (canvas diff, done
/// on decoded PNG bytes). `None` when either image is empty / undecodable
/// (the JS rejects the promise on a decode failure, which surfaces as an
/// engine error; a Rust `None` here maps to the same abort by the caller).
pub fn compare_screenshot_contrast(
    before_base64: &str,
    after_base64: &str,
    candidate: &Value,
) -> Result<Option<ContrastMetrics>, String> {
    let before = decode_png_rgba(before_base64).ok_or("Could not decode contrast screenshot")?;
    let after = decode_png_rgba(after_base64).ok_or("Could not decode contrast screenshot")?;
    let width = before.0.min(after.0) as usize;
    let height = before.1.min(after.1) as usize;
    if width < 1 || height < 1 {
        return Ok(None);
    }
    let bw = before.0 as usize;
    let aw = after.0 as usize;
    let css_text_color = {
        let prefer = candidate
            .get("preferRenderedForeground")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        match candidate.get("textColor") {
            Some(tc) if !tc.is_null() && !prefer => {
                Some((num(tc.get("r")), num(tc.get("g")), num(tc.get("b"))))
            }
            _ => None,
        }
    };
    let mut pixels: Vec<GlyphPixel> = Vec::new();
    let mut strongest_delta = 0.0f64;
    // The box the text did not touch: the surface beside the glyphs, which is
    // what the surface under them should look like.
    let mut surround_sum = 0.0f64;
    let mut surround_count = 0usize;
    for y in 0..height {
        for x in 0..width {
            let bi = (y * bw + x) * 4;
            let ai = (y * aw + x) * 4;
            let bp = &before.2[bi..bi + 4];
            let ap = &after.2[ai..ai + 4];
            let delta = (bp[0] as f64 - ap[0] as f64).abs()
                + (bp[1] as f64 - ap[1] as f64).abs()
                + (bp[2] as f64 - ap[2] as f64).abs()
                + (bp[3] as f64 - ap[3] as f64).abs();
            strongest_delta = f64::max(strongest_delta, delta);
            if delta < 10.0 {
                // Every sixteenth of them is plenty for a mean, and the box
                // can be half a million pixels.
                if x % 4 == 0 && y % 4 == 0 {
                    surround_sum += luminance(ap[0] as f64, ap[1] as f64, ap[2] as f64);
                    surround_count += 1;
                }
                continue;
            }
            let painted = (bp[0] as f64, bp[1] as f64, bp[2] as f64);
            let fg = css_text_color.unwrap_or(painted);
            let bg = (ap[0] as f64, ap[1] as f64, ap[2] as f64);
            let ground = luminance(bg.0, bg.1, bg.2);
            pixels.push(GlyphPixel {
                delta,
                ratio: ratio(fg, bg),
                ground,
                darkened: luminance(painted.0, painted.1, painted.2) < ground,
                off_color: css_text_color.is_some_and(|css| {
                    !visual::painted_is_text_color(
                        [painted.0, painted.1, painted.2],
                        [css.0, css.1, css.2],
                        [bg.0, bg.1, bg.2],
                    )
                }),
            });
        }
    }
    let surround = (surround_count >= GLYPH_MIN_PIXELS)
        .then(|| surround_sum / surround_count as f64);
    Ok(Some(ContrastMetrics {
        glyph_pixels: pixels.len(),
        strongest_delta,
        outcome: visual::pixel_contrast_verdict(&pixels, width * height, surround),
    }))
}

/// A `{ id, snippet }` pair as `captureVisualContrastCandidate` returns.
pub struct RawFinding {
    pub id: &'static str,
    pub snippet: String,
    /// The per-finding severity, `advisory` for decorative text or a
    /// verdict just under its bar
    /// ([`impeccable_core::browser::visual::visual_contrast_severity`]).
    pub severity: Option<String>,
}

fn js_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => number_to_string(n.as_f64().unwrap_or(f64::NAN)),
        other => other.to_string(),
    }
}

/// JS: screenshot-contrast.mjs#captureVisualContrastCandidate. `viewport`
/// is the scan viewport (its width caps the clip).
pub fn capture_visual_contrast_candidate(
    page: &mut Page<'_>,
    candidate: &Value,
    viewport_width: f64,
) -> CdpResult<Option<RawFinding>> {
    let origin_x = scroll_origin_x(page);
    Ok(measure_visual_contrast_candidate(page, candidate, viewport_width, origin_x)?.finding)
}

/// The furthest left the document scrolls, in document coordinates: 0, or
/// negative on a page that scrolls from the right (a right-to-left page wider
/// than the viewport keeps its overflow at negative x). A beyond-viewport
/// clip's x 0 is that edge, so a candidate's document x moves right by the
/// overflow's width. Asked the way the full-page screenshot asks it
/// (`crate::fullpage`), by scrolling there and straight back in one task.
pub fn scroll_origin_x(page: &mut Page<'_>) -> f64 {
    page.evaluate_value(SCROLL_ORIGIN_JS)
        .ok()
        .and_then(|v| v.as_f64())
        .filter(|x| x.is_finite())
        .map_or(0.0, |x| x.min(0.0))
}

const SCROLL_ORIGIN_JS: &str = r#"(() => {
  const se = document.scrollingElement || document.documentElement;
  if (!se || se.scrollWidth <= se.clientWidth + 1) return 0;
  const sx = window.scrollX;
  const sy = window.scrollY;
  window.scrollTo({ left: -se.scrollWidth, top: sy, behavior: 'instant' });
  const origin = Math.min(0, window.scrollX);
  if (window.scrollX !== sx) window.scrollTo({ left: sx, top: sy, behavior: 'instant' });
  return origin;
})()"#;

/// The candidate's clip in document coordinates. The collector clamps a
/// clip's x at 0, which on a page that scrolls from the right cuts every
/// candidate in the overflow left of the viewport to the same x: there the
/// box the collector measured is read again, live, for its own x. That box
/// is the union of the element's own text lines (the capture's direct text
/// rect), or its border box when it has none, so x, width and height still
/// describe one box.
fn document_clip(page: &mut Page<'_>, candidate: &Value, origin_x: f64) -> Option<Value> {
    let clip = candidate.get("clip")?;
    if !(origin_x < 0.0) || !clip.is_object() || num(clip.get("x")) > 0.0 {
        return Some(clip.clone());
    }
    let selector = candidate.get("selector").and_then(Value::as_str).filter(|s| !s.is_empty());
    let left = selector.and_then(|selector| {
        page.evaluate_value(&format!(
            "({LIVE_TEXT_LEFT_JS})(({PICK_CANDIDATE_JS})({}, {}))",
            json!(selector),
            candidate.get("match").cloned().unwrap_or(Value::Null)
        ))
        .ok()?
        .as_f64()
        .filter(|x| x.is_finite())
    });
    let mut clip = clip.clone();
    if let (Some(left), Some(obj)) = (left, clip.as_object_mut()) {
        obj.insert("x".into(), json!((left - 2.0).floor()));
    }
    Some(clip)
}

/// `el => x`: the document x of the left edge of an element's own text lines
/// (its direct text nodes, as the capture's direct text rect reads them), or
/// of its border box when it has none; `null` without an element.
const LIVE_TEXT_LEFT_JS: &str = r#"(el => {
  if (!el) return null;
  let left = Infinity;
  for (const child of el.childNodes) {
    if (child.nodeType !== 3 || !(child.textContent || '').trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(child);
    for (const r of range.getClientRects()) if (r.width >= 1 && r.height >= 1) left = Math.min(left, r.left);
  }
  if (!Number.isFinite(left)) left = el.getBoundingClientRect().left;
  return left + window.scrollX;
})"#;

/// A candidate's document clip as a `Page.captureScreenshot` clip, whose x 0
/// is the left edge of what the document scrolls ([`scroll_origin_x`]).
fn capture_clip(clip: Option<&Value>, origin_x: f64) -> Option<Value> {
    let mut clip = clip?.clone();
    if origin_x < 0.0 {
        if let Some(obj) = clip.as_object_mut() {
            let x = num(obj.get("x"));
            obj.insert("x".into(), json!(x - origin_x));
        }
    }
    Some(clip)
}

/// What the pixel pass made of one candidate: its finding, if the text
/// failed, and whether the pixels gave a verdict at all, pass or fail. The
/// URL engine replaces the element pass's verdict on text it hands over only
/// where they did.
#[derive(Default)]
pub struct PixelMeasure {
    pub finding: Option<RawFinding>,
    pub measured: bool,
}

pub fn measure_visual_contrast_candidate(
    page: &mut Page<'_>,
    candidate: &Value,
    viewport_width: f64,
    origin_x: f64,
) -> CdpResult<PixelMeasure> {
    let reasons: Vec<String> = candidate
        .get("reasons")
        .and_then(Value::as_array)
        .map(|arr| arr.iter().map(js_string).collect())
        .unwrap_or_default();
    // Refused before the screenshots: the pixels would not answer for this
    // text, and a clipped capture pair is the expensive part of the pass.
    if visual::pixel_contrast_blocked(&reasons).is_some() {
        return Ok(PixelMeasure::default());
    }
    let Some(clip) = sanitize_screenshot_clip(
        capture_clip(document_clip(page, candidate, origin_x).as_ref(), origin_x).as_ref(),
        Some(viewport_width),
    ) else {
        return Ok(PixelMeasure::default());
    };
    // A candidate past the document's content box (text inside an element the
    // page scrolls instead of its document) paints nothing in a beyond-viewport
    // capture, so both shots would read blank. Scroll it into view, read its
    // pixels there, and put the scroll back.
    let brought = bring_into_view(page, candidate, &clip, viewport_width, origin_x);
    let (candidate, clip) = match &brought {
        Some((moved, moved_clip)) => (moved, *moved_clip),
        None => (candidate, clip),
    };
    let outcome = measure_candidate(page, candidate, &reasons, clip);
    if brought.is_some() {
        let _ = page.evaluate(RESTORE_SCROLL_JS);
    }
    outcome
}

/// `(selector, match) => element`: the element a candidate names. `match` is
/// the candidate's `[n, count]` when its selector matched several elements
/// (a repeated id), and then the `n`th match is the one, while the page still
/// has `count` of them; `querySelector`'s first match would be a copy the
/// candidate never came from. `null` for an invalid selector or no match.
pub(crate) const PICK_CANDIDATE_JS: &str = r#"((selector, match) => {
  let matches;
  try {
    matches = document.querySelectorAll(selector);
  } catch (e) {
    return null;
  }
  if (Array.isArray(match) && matches.length === match[1] && matches[match[0]]) return matches[match[0]];
  return matches[0] || null;
})"#;

const BRING_INTO_VIEW_JS: &str = r#"(async (el) => {
  if (!el) return null;
  const saved = [];
  // Ancestors through slots and shadow roots, so a shadow frame the scroll
  // moves is put back too.
  const up = n => n.assignedSlot || n.parentElement || (n.parentNode && n.parentNode.host) || null;
  for (let p = up(el); p; p = up(p)) saved.push([p, p.scrollTop, p.scrollLeft]);
  const sx = window.scrollX;
  const sy = window.scrollY;
  el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  const moved = window.scrollX !== sx || window.scrollY !== sy
    || saved.some(([p, t, l]) => p.scrollTop !== t || p.scrollLeft !== l);
  if (!moved) return { moved: false };
  window.__impeccableContrastRestore = () => {
    for (const [p, t, l] of saved) {
      if (p.scrollTop !== t || p.scrollLeft !== l) p.scrollTo({ top: t, left: l, behavior: 'instant' });
    }
    window.scrollTo({ left: sx, top: sy, behavior: 'instant' });
  };
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const r = el.getBoundingClientRect();
  return { moved: true, x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height };
})"#;

const RESTORE_SCROLL_JS: &str = "(() => { const restore = window.__impeccableContrastRestore; delete window.__impeccableContrastRestore; if (restore) restore(); })()";

/// Whether a clip reaches where a beyond-viewport capture paints nothing:
/// below the document's content box (allowing the 2px pad and the rounding a
/// candidate clip carries) or starting right of it. `content` is
/// `Page.getLayoutMetrics().cssContentSize`.
pub fn clip_beyond_content(clip: &Clip, content: (f64, f64)) -> bool {
    let (width, height) = content;
    if !(width.is_finite() && height.is_finite() && width > 0.0 && height > 0.0) {
        return false;
    }
    clip.y + clip.height > height + 4.0 || clip.x >= width
}

/// For a clip past the content box, scroll its element into view and return
/// the candidate with the clip measured there. `None` leaves the page as it
/// was: nothing moved, or nothing to move.
fn bring_into_view(
    page: &mut Page<'_>,
    candidate: &Value,
    clip: &Clip,
    viewport_width: f64,
    origin_x: f64,
) -> Option<(Value, Clip)> {
    let content = page.content_size().ok()?;
    if !clip_beyond_content(clip, content) {
        return None;
    }
    let selector = candidate
        .get("selector")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())?;
    let v = page
        .evaluate_value(&format!(
            "({BRING_INTO_VIEW_JS})(({PICK_CANDIDATE_JS})({}, {}))",
            json!(selector),
            candidate.get("match").cloned().unwrap_or(Value::Null)
        ))
        .ok()?;
    if v.get("moved").and_then(Value::as_bool) != Some(true) {
        return None;
    }
    let n = |key: &str| v.get(key).and_then(Value::as_f64).filter(|f| f.is_finite());
    let live = match (n("x"), n("y"), n("width"), n("height")) {
        (Some(x), Some(y), Some(w), Some(h)) => json!({
            "x": (x - 2.0).floor(),
            "y": math_max(0.0, (y - 2.0).floor()),
            "width": math_max(1.0, (w + 4.0).ceil()),
            "height": math_max(1.0, (h + 4.0).ceil()),
        }),
        _ => Value::Null,
    };
    let Some(moved_clip) = sanitize_screenshot_clip(capture_clip(Some(&live), origin_x).as_ref(), Some(viewport_width)) else {
        let _ = page.evaluate(RESTORE_SCROLL_JS);
        return None;
    };
    let mut moved = candidate.clone();
    moved["clip"] = live;
    Some((moved, moved_clip))
}

/// The pixel pair for one candidate at `clip`: text painted, then hidden.
fn measure_candidate(
    page: &mut Page<'_>,
    candidate: &Value,
    reasons: &[String],
    clip: Clip,
) -> CdpResult<PixelMeasure> {
    let before = page.screenshot_clip(clip.x, clip.y, clip.width, clip.height)?;
    let token = format!(
        "impeccable-contrast-{}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0),
        rand_token()
    );
    let selector = candidate
        .get("selector")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let bgclip = candidate
        .get("backgroundClipText")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let apply_expr = format!(
        r#"(({{ selector, match, token, backgroundClipText }}) => {{
    const el = ({PICK_CANDIDATE_JS})(selector, match);
    if (!el) return false;
    let style = document.getElementById('impeccable-visual-contrast-hide-style');
    if (!style) {{
      style = document.createElement('style');
      style.id = 'impeccable-visual-contrast-hide-style';
      style.textContent = [
        '[data-impeccable-visual-contrast-target] {{',
        '  color: transparent !important;',
        '  -webkit-text-fill-color: transparent !important;',
        '  text-shadow: none !important;',
        '  -webkit-text-stroke-color: transparent !important;',
        '}}',
        'text[data-impeccable-visual-contrast-target], tspan[data-impeccable-visual-contrast-target] {{',
        '  fill: transparent !important;',
        '  stroke: transparent !important;',
        '}}',
        '[data-impeccable-visual-contrast-target][data-impeccable-bgclip-text="true"] {{',
        '  background-image: none !important;',
        '}}',
      ].join('\n');
      document.head.appendChild(style);
    }}
    el.setAttribute('data-impeccable-visual-contrast-target', token);
    if (backgroundClipText) el.setAttribute('data-impeccable-bgclip-text', 'true');
    return true;
  }})({})"#,
        json!({ "selector": selector, "match": candidate.get("match").cloned().unwrap_or(Value::Null), "token": token, "backgroundClipText": bgclip })
    );
    let applied = page.evaluate_value(&apply_expr)?;
    if applied.as_bool() != Some(true) {
        return Ok(PixelMeasure::default());
    }
    let after = page.screenshot_clip(clip.x, clip.y, clip.width, clip.height);
    // finally: remove the marker attributes (errors swallowed).
    let cleanup_expr = format!(
        r#"(({{ token }}) => {{
      for (const el of document.querySelectorAll('[data-impeccable-visual-contrast-target]')) {{
        if (el.getAttribute('data-impeccable-visual-contrast-target') !== token) continue;
        el.removeAttribute('data-impeccable-visual-contrast-target');
        el.removeAttribute('data-impeccable-bgclip-text');
      }}
    }})({})"#,
        json!({ "token": token })
    );
    let _ = page.evaluate(&cleanup_expr);
    let after = after?;
    let metrics = compare_screenshot_contrast(&before, &after, candidate)
        .map_err(crate::cdp::CdpError::new)?;
    let Some(metrics) = metrics else {
        return Ok(PixelMeasure::default());
    };
    let PixelContrastOutcome::Verdict {
        measured, median, ..
    } = metrics.outcome
    else {
        return Ok(PixelMeasure::default());
    };
    if !measured.is_finite() || metrics.glyph_pixels < GLYPH_MIN_PIXELS {
        return Ok(PixelMeasure::default());
    }
    let threshold = num(candidate.get("threshold"));
    if measured >= threshold {
        return Ok(PixelMeasure { finding: None, measured: true });
    }
    let text_label = match candidate.get("text") {
        Some(Value::String(t)) if !t.is_empty() => format!(" \"{t}\""),
        Some(v) if !v.is_null() && !matches!(v, Value::String(_)) && truthy(v) => {
            format!(" \"{}\"", js_string(v))
        }
        _ => String::new(),
    };
    let joined = reasons
        .iter()
        .take(3)
        .cloned()
        .collect::<Vec<_>>()
        .join(", ");
    let reason_label = if joined.is_empty() {
        "visual background".to_string()
    } else {
        joined
    };
    Ok(PixelMeasure { measured: true, finding: Some(RawFinding {
        id: "low-contrast",
        severity: impeccable_core::browser::visual::visual_contrast_severity(
            candidate, measured, threshold,
        ),
        snippet: pixel_contrast_snippet(
            measured,
            median,
            candidate.get("threshold").unwrap_or(&Value::Null),
            &reason_label,
            &text_label,
        ),
    }) })
}

/// The pixel pass's snippet. The verdict and the median print against the
/// threshold ([`impeccable_core::color::ratio_label`]), so a verdict just
/// under the bar never reads as the bar itself.
pub(crate) fn pixel_contrast_snippet(
    measured: f64,
    median: f64,
    threshold: &Value,
    reason_label: &str,
    text_label: &str,
) -> String {
    let bar = num(Some(threshold));
    format!(
        "pixel contrast {}:1 median {}:1 (need {}:1) on {}{}",
        impeccable_core::color::ratio_label(measured, bar),
        impeccable_core::color::ratio_label(median, bar),
        js_string(threshold),
        reason_label,
        text_label
    )
}

fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().map(|f| f != 0.0 && !f.is_nan()).unwrap_or(false),
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}

/// `Math.random().toString(36).slice(2)`-shaped token; only uniqueness matters.
fn rand_token() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mut x =
        (nanos as u64) ^ (std::process::id() as u64).rotate_left(32) ^ 0x9E37_79B9_7F4A_7C15;
    let mut out = String::new();
    for _ in 0..10 {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        out.push(std::char::from_digit((x % 36) as u32, 36).unwrap_or('0'));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use impeccable_core::js::to_fixed;

    /// A slotted element scrolls inside its host's shadow frame: bringing it
    /// into view records that frame, and the restore puts it back.
    #[test]
    fn a_shadow_frame_the_scroll_moves_is_put_back() {
        let env: std::collections::HashMap<String, String> = std::env::vars().collect();
        let Ok(exe) = crate::discovery::find_browser(&env) else { return };
        let Ok(mut browser) = crate::cdp::Browser::launch(&exe, &[], false) else { return };
        let mut page = browser.new_page().unwrap();
        page.goto("about:blank", "load", std::time::Duration::from_secs(15)).unwrap();
        let setup = r#"(() => {
  document.body.innerHTML = '<x-frame><p id="deep">Deep copy</p></x-frame>';
  document.querySelector('x-frame').attachShadow({ mode: 'open' }).innerHTML =
    '<div id="frame" style="height:300px;overflow:auto"><div style="height:3000px"></div><slot></slot></div>';
  return true;
})()"#;
        page.evaluate_value(setup).unwrap();
        let moved = page
            .evaluate_value(&format!("({BRING_INTO_VIEW_JS})(document.getElementById('deep'))"))
            .unwrap();
        assert_eq!(moved.get("moved").and_then(Value::as_bool), Some(true), "{moved}");
        let frame = "document.querySelector('x-frame').shadowRoot.getElementById('frame').scrollTop";
        assert!(page.evaluate_value(frame).unwrap().as_f64().unwrap() > 0.0);
        page.evaluate_value(RESTORE_SCROLL_JS).unwrap();
        assert_eq!(page.evaluate_value(frame).unwrap().as_f64(), Some(0.0));
        page.close();
        browser.close();
    }

    #[test]
    fn pixel_snippet_never_prints_a_failing_verdict_as_the_bar() {
        assert_eq!(
            pixel_contrast_snippet(4.4983, 4.62, &json!(4.5), "solid-background", " \"Plans\""),
            "pixel contrast 4.49:1 median 4.6:1 (need 4.5:1) on solid-background \"Plans\""
        );
        assert_eq!(
            pixel_contrast_snippet(2.998, 2.998, &json!(3), "visual background", ""),
            "pixel contrast 2.99:1 median 2.99:1 (need 3:1) on visual background"
        );
        assert_eq!(
            pixel_contrast_snippet(3.46, 3.9, &json!(4.5), "image", ""),
            "pixel contrast 3.5:1 median 3.9:1 (need 4.5:1) on image"
        );
    }

    #[test]
    fn sanitize_clip_matches_js() {
        let clip = json!({ "x": -3.2, "y": 10.7, "width": 2000, "height": 900 });
        let c = sanitize_screenshot_clip(Some(&clip), Some(1280.0)).unwrap();
        assert_eq!(
            c,
            Clip {
                x: 0.0,
                y: 10.0,
                width: 1280.0,
                height: 320.0
            }
        );
        let c = sanitize_screenshot_clip(Some(&json!({})), None).unwrap();
        assert_eq!(c.width, 1.0);
        assert!(sanitize_screenshot_clip(None, None).is_none());
        assert!(sanitize_screenshot_clip(Some(&Value::Null), None).is_none());
    }

    #[test]
    fn a_right_to_left_overflow_moves_the_clip() {
        let clip = json!({ "x": -40.0, "y": 300.0, "width": 200.0, "height": 24.0 });
        // A page that scrolls from the left keeps the document x.
        assert_eq!(capture_clip(Some(&clip), 0.0), Some(clip.clone()));
        // 321px of overflow left of the viewport: document x -40 is clip x 281.
        let c = sanitize_screenshot_clip(capture_clip(Some(&clip), -321.0).as_ref(), Some(390.0)).unwrap();
        assert_eq!((c.x, c.y), (281.0, 300.0));
        assert_eq!(capture_clip(None, -321.0), None);
    }

    #[test]
    fn clips_past_the_content_box_are_brought_into_view() {
        let clip = |x: f64, y: f64, width: f64, height: f64| Clip { x, y, width, height };
        // A body scroller: the document is one 844px viewport tall.
        assert!(clip_beyond_content(&clip(42.0, 2709.0, 357.0, 47.0), (390.0, 844.0)));
        // Text at the document's foot, the clip's pad and rounding included.
        assert!(!clip_beyond_content(&clip(40.0, 3380.0, 200.0, 24.0), (1280.0, 3401.0)));
        assert!(!clip_beyond_content(&clip(40.0, 300.0, 200.0, 24.0), (1280.0, 3401.0)));
        // Starting past the right edge.
        assert!(clip_beyond_content(&clip(1400.0, 300.0, 200.0, 24.0), (1280.0, 3401.0)));
        // Straddling the right edge still paints.
        assert!(!clip_beyond_content(&clip(1200.0, 300.0, 200.0, 24.0), (1280.0, 3401.0)));
        // No usable content size: leave the clip as it is.
        assert!(!clip_beyond_content(&clip(0.0, 5000.0, 10.0, 10.0), (0.0, 0.0)));
        assert!(!clip_beyond_content(&clip(0.0, 5000.0, 10.0, 10.0), (f64::NAN, 800.0)));
    }

    fn png_base64(w: u32, h: u32, rgba: &[u8]) -> String {
        let mut bytes = Vec::new();
        {
            let mut enc = png::Encoder::new(&mut bytes, w, h);
            enc.set_color(png::ColorType::Rgba);
            enc.set_depth(png::BitDepth::Eight);
            let mut writer = enc.write_header().unwrap();
            writer.write_image_data(rgba).unwrap();
        }
        base64::engine::general_purpose::STANDARD.encode(bytes)
    }

    fn measured(m: &ContrastMetrics) -> Option<f64> {
        match m.outcome {
            PixelContrastOutcome::Verdict { measured, .. } => Some(measured),
            PixelContrastOutcome::Unresolved(_) => None,
        }
    }

    #[test]
    fn compare_counts_glyph_pixels_and_ratios() {
        // 8x8: before has 10 dark pixels on white; after is all white.
        let mut before = vec![255u8; 8 * 8 * 4];
        for i in 0..10 {
            before[i * 4] = 20;
            before[i * 4 + 1] = 20;
            before[i * 4 + 2] = 20;
        }
        let after = vec![255u8; 8 * 8 * 4];
        let cand = json!({ "textColor": { "r": 20, "g": 20, "b": 20 }, "preferRenderedForeground": false });
        let m = compare_screenshot_contrast(
            &png_base64(8, 8, &before),
            &png_base64(8, 8, &after),
            &cand,
        )
        .unwrap()
        .unwrap();
        assert_eq!(m.glyph_pixels, 10);
        assert!(measured(&m).unwrap() > 15.0);
        // Fewer than 8 glyph pixels → no verdict.
        let mut few = vec![255u8; 8 * 8 * 4];
        few[0] = 0;
        let m =
            compare_screenshot_contrast(&png_base64(8, 8, &few), &png_base64(8, 8, &after), &cand)
                .unwrap()
                .unwrap();
        assert_eq!(m.glyph_pixels, 1);
        assert_eq!(
            m.outcome,
            PixelContrastOutcome::Unresolved("too few glyph pixels")
        );
    }

    #[test]
    fn antialiased_edges_do_not_set_the_verdict() {
        // A dark glyph on white: 12 fully painted pixels and 20 edge pixels at
        // a tenth of the coverage. The edges read near 1:1; the verdict must
        // come from the painted ones.
        let mut before = vec![255u8; 16 * 16 * 4];
        for i in 0..12 {
            for c in 0..3 {
                before[i * 4 + c] = 20;
            }
        }
        for i in 12..32 {
            for c in 0..3 {
                before[i * 4 + c] = 232;
            }
        }
        let after = vec![255u8; 16 * 16 * 4];
        // preferRenderedForeground: the painted pixel is the foreground, which
        // is what makes an edge pixel measure as background over background.
        let cand = json!({ "preferRenderedForeground": true, "textColor": Value::Null });
        let m = compare_screenshot_contrast(
            &png_base64(16, 16, &before),
            &png_base64(16, 16, &after),
            &cand,
        )
        .unwrap()
        .unwrap();
        assert_eq!(m.glyph_pixels, 32);
        assert!(measured(&m).unwrap() > 15.0, "{:?}", m.outcome);
    }

    #[test]
    fn partly_covered_pixels_do_not_set_the_verdict_or_the_median() {
        // 12 glyph cores (#141414 on white, 18.4:1) and 30 pixels four fifths
        // covered (#434343, 9.9:1). The partly covered ones clear three
        // quarters of the strongest change, so they used to outvote the cores
        // for the verdict, while the median came from yet another set.
        let mut before = vec![255u8; 16 * 16 * 4];
        for i in 0..12 {
            for c in 0..3 {
                before[i * 4 + c] = 20;
            }
        }
        for i in 12..42 {
            for c in 0..3 {
                before[i * 4 + c] = 67;
            }
        }
        let after = vec![255u8; 16 * 16 * 4];
        let cand = json!({ "preferRenderedForeground": true, "textColor": Value::Null });
        let m = compare_screenshot_contrast(
            &png_base64(16, 16, &before),
            &png_base64(16, 16, &after),
            &cand,
        )
        .unwrap()
        .unwrap();
        match m.outcome {
            PixelContrastOutcome::Verdict { measured, median, core_pixels } => {
                assert_eq!(core_pixels, 12);
                assert!(measured > 15.0, "{measured}");
                assert!(measured <= median, "{measured} above {median}");
                assert_eq!(to_fixed(measured, 1), to_fixed(median, 1));
            }
            other => panic!("{other:?}"),
        }
    }
}
