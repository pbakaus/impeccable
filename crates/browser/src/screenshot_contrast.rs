//! Port of `cli/engine/engines/visual/screenshot-contrast.mjs`: the pixel
//! fallback for text over visual backgrounds. Two clipped screenshots (text
//! visible, text hidden) are diffed; the JS does the diff on an in-page
//! canvas, this port decodes the PNGs with the `png` crate and runs the same
//! arithmetic (channel-delta gate ≥ 10, ≥ 8 glyph pixels, p10 / median over
//! sorted WCAG ratios, `toFixed(1)` in the snippet).

use base64::Engine as _;
use impeccable_core::js::{math_max, number_to_string, to_fixed};
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
    pub worst_ratio: Option<f64>,
    pub p10_ratio: Option<f64>,
    pub median_ratio: Option<f64>,
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
    let mut ratios: Vec<f64> = Vec::new();
    let mut glyph_pixels = 0usize;
    let mut strongest_delta = 0.0f64;
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
                continue;
            }
            glyph_pixels += 1;
            let fg = css_text_color.unwrap_or((bp[0] as f64, bp[1] as f64, bp[2] as f64));
            let bg = (ap[0] as f64, ap[1] as f64, ap[2] as f64);
            ratios.push(ratio(fg, bg));
        }
    }
    if ratios.len() < 8 {
        return Ok(Some(ContrastMetrics {
            glyph_pixels,
            strongest_delta,
            worst_ratio: None,
            p10_ratio: None,
            median_ratio: None,
        }));
    }
    ratios.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n = ratios.len();
    let pick =
        |pct: f64| ratios[usize::min(n - 1, ((pct / 100.0) * n as f64).floor().max(0.0) as usize)];
    Ok(Some(ContrastMetrics {
        glyph_pixels,
        strongest_delta,
        worst_ratio: Some(ratios[0]),
        p10_ratio: Some(pick(10.0)),
        median_ratio: Some(pick(50.0)),
    }))
}

/// A `{ id, snippet }` pair as `captureVisualContrastCandidate` returns.
pub struct RawFinding {
    pub id: &'static str,
    pub snippet: String,
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
    let Some(clip) = sanitize_screenshot_clip(candidate.get("clip"), Some(viewport_width)) else {
        return Ok(None);
    };
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
        r#"(({{ selector, token, backgroundClipText }}) => {{
    let el;
    try {{
      el = document.querySelector(selector);
    }} catch {{
      return false;
    }}
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
        json!({ "selector": selector, "token": token, "backgroundClipText": bgclip })
    );
    let applied = page.evaluate_value(&apply_expr)?;
    if applied.as_bool() != Some(true) {
        return Ok(None);
    }
    let after = page.screenshot_clip(clip.x, clip.y, clip.width, clip.height);
    // finally: remove the marker attributes (errors swallowed).
    let cleanup_expr = format!(
        r#"(({{ selector }}) => {{
      try {{
        const el = document.querySelector(selector);
        if (el) {{
          el.removeAttribute('data-impeccable-visual-contrast-target');
          el.removeAttribute('data-impeccable-bgclip-text');
        }}
      }} catch {{
      }}
    }})({})"#,
        json!({ "selector": selector })
    );
    let _ = page.evaluate(&cleanup_expr);
    let after = after?;
    let metrics = compare_screenshot_contrast(&before, &after, candidate)
        .map_err(crate::cdp::CdpError::new)?;
    let Some(metrics) = metrics else {
        return Ok(None);
    };
    let Some(p10) = metrics.p10_ratio else {
        return Ok(None);
    };
    if !p10.is_finite() || metrics.glyph_pixels < 8 {
        return Ok(None);
    }
    let threshold = num(candidate.get("threshold"));
    let measured = p10;
    if measured >= threshold {
        return Ok(None);
    }
    let text_label = match candidate.get("text") {
        Some(Value::String(t)) if !t.is_empty() => format!(" \"{t}\""),
        Some(v) if !v.is_null() && !matches!(v, Value::String(_)) && truthy(v) => {
            format!(" \"{}\"", js_string(v))
        }
        _ => String::new(),
    };
    let reasons: Vec<String> = candidate
        .get("reasons")
        .and_then(Value::as_array)
        .map(|arr| arr.iter().take(3).map(js_string).collect())
        .unwrap_or_default();
    let joined = reasons.join(", ");
    let reason_label = if joined.is_empty() {
        "visual background".to_string()
    } else {
        joined
    };
    let median = metrics.median_ratio.unwrap_or(f64::NAN);
    Ok(Some(RawFinding {
        id: "low-contrast",
        snippet: format!(
            "pixel contrast {}:1 median {}:1 (need {}:1) on {}{}",
            to_fixed(measured, 1),
            to_fixed(median, 1),
            js_string(candidate.get("threshold").unwrap_or(&Value::Null)),
            reason_label,
            text_label
        ),
    }))
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

    #[test]
    fn compare_counts_glyph_pixels_and_ratios() {
        // 4x4: before has 10 dark pixels on white; after is all white.
        let mut before = vec![255u8; 4 * 4 * 4];
        for i in 0..10 {
            before[i * 4] = 20;
            before[i * 4 + 1] = 20;
            before[i * 4 + 2] = 20;
        }
        let after = vec![255u8; 4 * 4 * 4];
        let cand = json!({ "textColor": { "r": 20, "g": 20, "b": 20 }, "preferRenderedForeground": false });
        let m = compare_screenshot_contrast(
            &png_base64(4, 4, &before),
            &png_base64(4, 4, &after),
            &cand,
        )
        .unwrap()
        .unwrap();
        assert_eq!(m.glyph_pixels, 10);
        assert!(m.p10_ratio.unwrap() > 15.0);
        // Fewer than 8 glyph pixels → null ratios.
        let mut few = vec![255u8; 4 * 4 * 4];
        few[0] = 0;
        let m =
            compare_screenshot_contrast(&png_base64(4, 4, &few), &png_base64(4, 4, &after), &cand)
                .unwrap()
                .unwrap();
        assert_eq!(m.glyph_pixels, 1);
        assert!(m.p10_ratio.is_none());
    }
}
