//! JS: generate-image.mjs -> `impeccable generate-image`

use crate::jsp;
use crate::util::{iso_now, json_pretty, node_read_error, utf16_len, Env};
use impeccable_common::Io;
use serde_json::{Map, Value};
use std::io::Write;

pub const DEFAULT_MODEL: &str = "gpt-image-2.5-flare";

fn arg(args: &[String], name: &str) -> Option<String> {
    let i = args.iter().position(|a| a == &format!("--{}", name))?;
    let v = args.get(i + 1)?;
    if !v.is_empty() && !v.starts_with("--") {
        Some(v.clone())
    } else {
        None
    }
}

fn hash32(s: &str) -> u32 {
    let mut h: u32 = 0x811c9dc5;
    for cu in s.encode_utf16() {
        h ^= cu as u32;
        h = h.wrapping_mul(0x01000193);
    }
    h
}

fn hsl_to_rgb(h_deg: f64, s: f64, l: f64) -> [u8; 3] {
    let h = ((h_deg % 360.0) + 360.0) % 360.0 / 360.0;
    let q = if l < 0.5 { l * (1.0 + s) } else { l + s - l * s };
    let p = 2.0 * l - q;
    let hue = |t: f64| -> f64 {
        let mut tt = t;
        if tt < 0.0 {
            tt += 1.0;
        }
        if tt > 1.0 {
            tt -= 1.0;
        }
        if tt < 1.0 / 6.0 {
            return p + (q - p) * 6.0 * tt;
        }
        if tt < 1.0 / 2.0 {
            return q;
        }
        if tt < 2.0 / 3.0 {
            return p + (q - p) * (2.0 / 3.0 - tt) * 6.0;
        }
        p
    };
    let round = |c: f64| -> u8 { js_round(c * 255.0) as u8 };
    [round(hue(h + 1.0 / 3.0)), round(hue(h)), round(hue(h - 1.0 / 3.0))]
}

/// Math.round: half up toward +inf
fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}

fn to_hex(c: [u8; 3]) -> String {
    format!("#{:02x}{:02x}{:02x}", c[0], c[1], c[2])
}

fn palette(prompt: &str) -> Vec<[u8; 3]> {
    let h = hash32(prompt);
    let base = (h % 360) as f64;
    let bands = 2 + ((h >> 9) % 2) as usize;
    let spread = (40 + (h >> 3) % 120) as f64;
    let mut out = Vec::new();
    for i in 0..bands {
        let hue = base + i as f64 * spread;
        let light = 0.32 + ((h >> (i * 5)) % 40) as f64 / 100.0;
        out.push(hsl_to_rgb(hue, 0.55, light));
    }
    out
}

fn collapse_ws(s: &str) -> String {
    // .replace(/\s+/g, ' ').trim()
    let mut out = String::new();
    let mut in_ws = false;
    for c in s.chars() {
        if c.is_whitespace() || c == '\u{FEFF}' {
            if !in_ws {
                out.push(' ');
                in_ws = true;
            }
        } else {
            in_ws = false;
            out.push(c);
        }
    }
    crate::util::js_trim(&out).to_string()
}

fn num(v: f64) -> String {
    crate::util::js_number_to_string(v)
}

fn svg_fake(prompt: &str, w: f64, h: f64) -> String {
    let colors: Vec<String> = palette(prompt).into_iter().map(to_hex).collect();
    let n = colors.len();
    let stops: String = colors
        .iter()
        .enumerate()
        .map(|(i, c)| format!("<stop offset=\"{}%\" stop-color=\"{}\"/>", num(js_round(i as f64 / (n as f64 - 1.0) * 100.0)), c))
        .collect();
    let per_line = (12.0f64).max((w / 26.0).floor()) as usize;
    let words: Vec<&str> = {
        let collapsed = collapse_ws(prompt);
        // split(' ') on the collapsed string; leak for lifetime simplicity
        Box::leak(collapsed.into_boxed_str()).split(' ').collect()
    };
    let mut lines: Vec<String> = Vec::new();
    let mut cur = String::new();
    for word in words {
        let candidate = crate::util::js_trim(&format!("{} {}", cur, word)).to_string();
        if utf16_len(&candidate) > per_line {
            if !cur.is_empty() {
                lines.push(cur.clone());
            }
            cur = word.to_string();
        } else {
            cur = candidate;
        }
        if lines.len() >= 10 {
            break;
        }
    }
    if !cur.is_empty() && lines.len() < 11 {
        lines.push(cur);
    }
    let escape = |s: &str| s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
    let font_size = js_round(w / 24.0);
    let start_y = h / 2.0 - ((lines.len() as f64 - 1.0) * font_size * 1.3) / 2.0;
    let text: String = lines
        .iter()
        .enumerate()
        .map(|(i, line)| {
            format!(
                "<text x=\"{}\" y=\"{}\" font-family=\"Helvetica, Arial, sans-serif\" font-size=\"{}\" fill=\"#ffffff\" text-anchor=\"middle\" dominant-baseline=\"middle\">{}</text>",
                num(w / 2.0),
                num(js_round(start_y + i as f64 * font_size * 1.3)),
                num(font_size),
                escape(line)
            )
        })
        .collect();
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{w}\" height=\"{h}\" viewBox=\"0 0 {w} {h}\">\n  <defs><linearGradient id=\"g\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\">{stops}</linearGradient></defs>\n  <rect width=\"{w}\" height=\"{h}\" fill=\"url(#g)\"/>\n  <rect x=\"0\" y=\"0\" width=\"{w}\" height=\"{h}\" fill=\"#000000\" fill-opacity=\"0.22\"/>\n  {text}\n  <rect x=\"{x1}\" y=\"{y1}\" width=\"{bw}\" height=\"{bh}\" fill=\"#000000\" fill-opacity=\"0.55\"/>\n  <text x=\"{tx}\" y=\"{ty}\" font-family=\"Helvetica, Arial, sans-serif\" font-size=\"{fs}\" letter-spacing=\"2\" fill=\"#ffffff\" text-anchor=\"middle\" dominant-baseline=\"middle\">SYNTHETIC COMP</text>\n</svg>\n",
        w = num(w),
        h = num(h),
        stops = stops,
        text = text,
        x1 = num(w - js_round(w / 4.2)),
        y1 = num(h - js_round(h / 16.0)),
        bw = num(js_round(w / 4.2)),
        bh = num(js_round(h / 16.0)),
        tx = num(w - js_round(w / 8.4)),
        ty = num(h - js_round(h / 32.0)),
        fs = num(js_round(w / 60.0)),
    )
}

fn crc32(data: &[u8]) -> u32 {
    let mut c = 0xffffffffu32;
    for b in data {
        c ^= *b as u32;
        for _ in 0..8 {
            c = if c & 1 == 1 { 0xedb88320 ^ (c >> 1) } else { c >> 1 };
        }
    }
    c ^ 0xffffffff
}

fn png_chunk(ty: &[u8], data: &[u8]) -> Vec<u8> {
    let mut body = ty.to_vec();
    body.extend_from_slice(data);
    let mut out = Vec::new();
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    out.extend_from_slice(&body);
    out.extend_from_slice(&crc32(&body).to_be_bytes());
    out
}

fn png_fake(prompt: &str, w: usize, h: usize) -> Vec<u8> {
    png_fake_background(prompt, w, h, false)
}

fn png_fake_background(prompt: &str, w: usize, h: usize, transparent: bool) -> Vec<u8> {
    let colors = palette(prompt);
    let band_h = (h as f64 / colors.len() as f64).ceil() as usize;
    let channels = if transparent { 4 } else { 3 };
    let stride = w * channels;
    let mut raw = vec![0u8; h * (stride + 1)];
    for y in 0..h {
        let row = y * (stride + 1);
        raw[row] = 0;
        let idx = (colors.len() - 1).min(if band_h == 0 { 0 } else { y / band_h });
        let [r, g, b] = colors[idx];
        for x in 0..w {
            let p = row + 1 + x * channels;
            raw[p] = r;
            raw[p + 1] = g;
            raw[p + 2] = b;
            if transparent {
                raw[p + 3] = if x < w / 8 || x >= w - w / 8 || y < h / 8 || y >= h - h / 8 {
                    0
                } else {
                    255
                };
            }
        }
    }
    let mut ihdr = vec![0u8; 13];
    ihdr[..4].copy_from_slice(&(w as u32).to_be_bytes());
    ihdr[4..8].copy_from_slice(&(h as u32).to_be_bytes());
    ihdr[8] = 8;
    ihdr[9] = if transparent { 6 } else { 2 };
    let mut enc = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::new(9));
    let _ = enc.write_all(&raw);
    let idat = enc.finish().unwrap_or_default();
    let mut text = b"Comment".to_vec();
    text.push(0);
    // latin1: chars > 0xff become their low byte in Node's 'latin1' encoding
    for c in format!("SYNTHETIC COMP: {}", collapse_ws(prompt)).encode_utf16() {
        text.push((c & 0xff) as u8);
    }
    let mut out = vec![0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    out.extend(png_chunk(b"IHDR", &ihdr));
    out.extend(png_chunk(b"tEXt", &text));
    out.extend(png_chunk(b"IDAT", &idat));
    out.extend(png_chunk(b"IEND", &[]));
    out
}

fn parse_size(s: &str) -> (usize, usize) {
    if let Some((a, b)) = s.split_once('x') {
        if !a.is_empty() && !b.is_empty() && a.chars().all(|c| c.is_ascii_digit()) && b.chars().all(|c| c.is_ascii_digit()) {
            return (a.parse().unwrap_or(1536), b.parse().unwrap_or(1024));
        }
    }
    (1536, 1024)
}

/// How long one `--ref <url>` download may take, connect to last byte.
const REF_DOWNLOAD_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

/// The largest reference image a URL may hand back.
const MAX_IMAGE_BYTES: u64 = 30 * 1024 * 1024;

/// Whether a `--ref` value (or a card image) is a URL rather than a path.
pub(crate) fn is_url(s: &str) -> bool {
    s.starts_with("https://") || s.starts_with("http://")
}

/// The URL without its query and fragment.
fn url_path(url: &str) -> &str {
    let end = url.find(['?', '#']).unwrap_or(url.len());
    &url[..end]
}

fn sniffed_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else {
        None
    }
}

/// Downloads one png, webp, or jpeg image. The bytes' signature decides the
/// type and is required: a `200` HTML page behind a `.webp` URL or an image
/// Content-Type (a soft 404, an auth wall, a proxy interstitial) is refused
/// rather than uploaded or kept as an image. `redirects` is how many the
/// request may follow. The error is a short reason with no OS-specific text;
/// the caller names the URL.
pub(crate) fn fetch_image(url: &str, timeout: std::time::Duration, redirects: u32) -> Result<(Vec<u8>, &'static str), String> {
    use std::io::Read;
    let agent = crate::http::agent_builder(url).timeout_connect(timeout).timeout(timeout).redirects(redirects).build();
    let response = match agent.get(url).call() {
        Ok(r) => r,
        Err(ureq::Error::Status(code, _)) => return Err(format!("HTTP {}", code)),
        Err(_) => return Err("the request failed".into()),
    };
    if !(200..300).contains(&response.status()) {
        return Err(format!("HTTP {}", response.status()));
    }
    let mut bytes = Vec::new();
    if response.into_reader().take(MAX_IMAGE_BYTES + 1).read_to_end(&mut bytes).is_err() {
        return Err("the response was cut short".into());
    }
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err("the image is larger than 30 MB".into());
    }
    if bytes.is_empty() {
        return Err("the response was empty".into());
    }
    sniffed_type(&bytes).map(|t| (bytes, t)).ok_or_else(|| "the response is not a png, webp, or jpeg image".into())
}

/// The multipart file name for a URL ref: its last path segment.
fn url_file_name(url: &str) -> String {
    let rest = url_path(url).split_once("://").map(|(_, r)| r).unwrap_or("");
    let segment = rest.split_once('/').map(|(_, p)| p.rsplit('/').next().unwrap_or("")).unwrap_or("");
    let name: String = segment.chars().filter(|c| !c.is_control() && *c != '"' && *c != '\\').collect();
    if name.is_empty() { "ref".to_string() } else { name }
}

pub fn run(args: &[String], io: &mut Io) -> i32 {
    let api_base = api_base(&io.env);
    run_with_api_base(args, io, &api_base)
}

/// OPENAI_BASE_URL is the variable the OpenAI SDKs read for a proxy or compatible endpoint, with
/// the same meaning: the base that `/images/...` hangs off, `/v1` included.
fn api_base(env: &Env) -> String {
    env.get("OPENAI_BASE_URL")
        .map(|b| b.trim().trim_end_matches('/').to_string())
        .filter(|b| !b.is_empty())
        .unwrap_or_else(|| "https://api.openai.com/v1".into())
}

fn run_with_api_base(args: &[String], io: &mut Io, api_base: &str) -> i32 {
    let background = arg(args, "background");
    if args.iter().any(|a| a == "--background") && !matches!(background.as_deref(), Some("transparent" | "opaque" | "auto")) {
        io.err("generate-image: --background must be transparent, opaque, or auto.\n");
        return 1;
    }
    let transparent = background.as_deref() == Some("transparent");
    if background.is_some() && arg(args, "out").is_some_and(|out| !out.to_ascii_lowercase().ends_with(".png")) {
        io.err("generate-image: --background requires a .png --out path.\n");
        return 1;
    }
    let cwd = io.cwd.to_string_lossy().into_owned();
    let env: Env = io.env.clone();
    let abs = |p: &str| jsp::resolve(&cwd, &[p]);
    let read_prompt_file = |io: &mut Io, pf: &str| -> Result<String, i32> {
        match std::fs::read(abs(pf)) {
            Ok(b) => Ok(String::from_utf8_lossy(&b).into_owned()),
            Err(e) => {
                io.err(&format!("Error: {}\n", node_read_error(pf, &e)));
                Err(1)
            }
        }
    };
    if env.get("IMPECCABLE_IMAGE_GEN_FAKE").map(|v| !v.is_empty()).unwrap_or(false) {
        let prompt = match arg(args, "prompt-file") {
            Some(pf) => match read_prompt_file(io, &pf) {
                Ok(p) => Some(p),
                Err(c) => return c,
            },
            None => arg(args, "prompt"),
        };
        let out = arg(args, "out");
        let (Some(prompt), Some(out)) = (prompt.filter(|p| !p.is_empty()), out) else {
            io.err("generate-image: --prompt (or --prompt-file) and --out are required.\n");
            return 1;
        };
        let (w, h) = parse_size(&arg(args, "size").unwrap_or_else(|| "1536x1024".into()));
        let bytes = if out.ends_with(".svg") {
            svg_fake(&prompt, w as f64, h as f64).into_bytes()
        } else if transparent {
            png_fake_background(&prompt, w, h, true)
        } else {
            png_fake(&prompt, w, h)
        };
        if let Err(e) = std::fs::write(abs(&out), bytes) {
            io.err(&format!("Error: {}\n", node_read_error(&out, &e)));
            return 1;
        }
        io.out(&format!("IMAGE: {} ({}x{}, fake synthetic comp, $0.00, no API call)\n", out, w, h));
        note_generated_slot(io, &out);
        return 0;
    }
    let Some(key) = env.get("OPENAI_API_KEY").filter(|k| !k.is_empty()).cloned() else {
        io.err("generate-image: OPENAI_API_KEY is not set; use the harness-native image tool instead.\n");
        return 1;
    };
    let prompt = match arg(args, "prompt-file") {
        Some(pf) => match read_prompt_file(io, &pf) {
            Ok(p) => Some(p),
            Err(c) => return c,
        },
        None => arg(args, "prompt"),
    };
    let out = arg(args, "out");
    let (Some(prompt), Some(out)) = (prompt.filter(|p| !p.is_empty()), out) else {
        io.err("generate-image: --prompt (or --prompt-file) and --out are required.\n");
        return 1;
    };
    let size = arg(args, "size").unwrap_or_else(|| "1536x1024".into());
    let quality = arg(args, "quality").unwrap_or_else(|| "medium".into());
    let model = arg(args, "model").unwrap_or_else(|| DEFAULT_MODEL.into());
    let mut refs: Vec<String> = Vec::new();
    for i in 0..args.len() {
        if args[i] == "--ref" {
            if let Some(n) = args.get(i + 1) {
                if !n.is_empty() && !n.starts_with("--") {
                    refs.push(n.clone());
                }
            }
        }
    }
    let agent = crate::http::agent_builder(api_base).build();
    let response = if !refs.is_empty() {
        let boundary = format!("----impeccable{:x}", crate::util::now_ms() as u64);
        let mut body: Vec<u8> = Vec::new();
        let mut field = |name: &str, value: &str| {
            body.extend_from_slice(format!("--{}\r\nContent-Disposition: form-data; name=\"{}\"\r\n\r\n{}\r\n", boundary, name, value).as_bytes());
        };
        field("model", &model);
        field("prompt", &prompt);
        field("size", &size);
        field("quality", &quality);
        field("n", "1");
        if let Some(background) = &background {
            field("background", background);
            field("output_format", "png");
        }
        for r in &refs {
            // A URL ref (a catalog world's card image, say) is downloaded
            // and attached like a file; nothing is written when one fails.
            let (bytes, ty, filename) = if is_url(r) {
                match fetch_image(r, REF_DOWNLOAD_TIMEOUT, 5) {
                    Ok((bytes, ty)) => (bytes, ty, url_file_name(r)),
                    Err(reason) => {
                        io.err(&format!("generate-image: could not download --ref {}: {}; nothing was generated.\n", r, reason));
                        return 1;
                    }
                }
            } else {
                let bytes = match std::fs::read(abs(r)) {
                    Ok(b) => b,
                    Err(e) => {
                        io.err(&format!("Error: {}\n", node_read_error(r, &e)));
                        return 1;
                    }
                };
                let ty = if r.ends_with(".png") {
                    "image/png"
                } else if r.ends_with(".webp") {
                    "image/webp"
                } else {
                    "image/jpeg"
                };
                (bytes, ty, r.rsplit('/').next().unwrap_or(r).to_string())
            };
            body.extend_from_slice(
                format!("--{}\r\nContent-Disposition: form-data; name=\"image[]\"; filename=\"{}\"\r\nContent-Type: {}\r\n\r\n", boundary, filename, ty).as_bytes(),
            );
            body.extend_from_slice(&bytes);
            body.extend_from_slice(b"\r\n");
        }
        body.extend_from_slice(format!("--{}--\r\n", boundary).as_bytes());
        agent
            .post(&format!("{api_base}/images/edits"))
            .set("Authorization", &format!("Bearer {}", key))
            .set("Content-Type", &format!("multipart/form-data; boundary={}", boundary))
            .send_bytes(&body)
    } else {
        let mut m = Map::new();
        m.insert("model".into(), Value::String(model.clone()));
        m.insert("prompt".into(), Value::String(prompt.clone()));
        m.insert("size".into(), Value::String(size.clone()));
        m.insert("quality".into(), Value::String(quality.clone()));
        m.insert("n".into(), Value::from(1));
        if let Some(background) = &background {
            m.insert("background".into(), Value::String(background.clone()));
            m.insert("output_format".into(), Value::String("png".into()));
        }
        agent
            .post(&format!("{api_base}/images/generations"))
            .set("Authorization", &format!("Bearer {}", key))
            .set("content-type", "application/json")
            .send_string(&serde_json::to_string(&Value::Object(m)).unwrap())
    };
    let (status, text) = match response {
        Ok(r) => {
            let st = r.status();
            (st, r.into_string().unwrap_or_default())
        }
        Err(ureq::Error::Status(code, r)) => (code, r.into_string().unwrap_or_default()),
        Err(e) => {
            io.err(&format!("TypeError: fetch failed: {}\n", e));
            return 1;
        }
    };
    if !(200..300).contains(&status) {
        let snippet: String = text.chars().take(300).collect();
        io.err(&format!("generate-image: API error {}: {}\n", status, snippet));
        return 1;
    }
    let json: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    let b64 = json.get("data").and_then(|d| d.get(0)).and_then(|d| d.get("b64_json")).and_then(|b| b.as_str()).filter(|s| !s.is_empty());
    let Some(b64) = b64 else {
        io.err("generate-image: no image in response\n");
        return 1;
    };
    let bytes = base64_decode(b64);
    let _ = std::fs::write(abs(&out), bytes);
    // best-effort embed + sidecar
    // JS-PARITY: generate-image.mjs#676 reports whether the embed actually
    // succeeded. The install-path-with-spaces half of #676 is a JS-only
    // subprocess concern (fileURLToPath vs URL.pathname); the engine embeds
    // in-process, so only the success tracking and message carry over here.
    let embedded;
    {
        let mut sub_io = Io::captured("", io.cwd.clone(), io.env.clone()).0;
        let ret = crate::embed_prompt::run(&[out.clone(), "--prompt".to_string(), prompt.clone()], &mut sub_io);
        embedded = ret == 0;
        if !embedded {
            io.err("generate-image: failed to embed prompt in the image\n");
        }
        let mut m = Map::new();
        m.insert("prompt".into(), Value::String(prompt.clone()));
        m.insert("createdAt".into(), Value::String(iso_now()));
        m.insert("tool".into(), Value::String("impeccable generate-image".into()));
        m.insert("model".into(), Value::String(model.clone()));
        if let Some(background) = &background {
            m.insert("background".into(), Value::String(background.clone()));
            m.insert("outputFormat".into(), Value::String("png".into()));
        }
        if !refs.is_empty() {
            m.insert("refs".into(), Value::Array(refs.iter().cloned().map(Value::String).collect()));
        }
        let _ = std::fs::write(abs(&format!("{}.json", out)), json_pretty(&Value::Object(m)));
    }
    note_generated_slot(io, &out);
    io.out(&format!(
        "IMAGE: {} ({}, {}, {}, billed to your OpenAI key); {} at {}.json\n",
        out,
        size,
        quality,
        model,
        if embedded { "prompt embedded + sidecar" } else { "sidecar" },
        out
    ));
    0
}

/// A written image that fills a decision page's declared slot counts as that
/// hand's comp even when its bytes match what sat there before (the same
/// prompt regenerates the same bytes). A failed record is reported, not fatal:
/// the image itself was written.
fn note_generated_slot(io: &mut Io, out: &str) {
    let cwd = io.cwd.to_string_lossy().into_owned();
    if let Err(e) = crate::serve_question::record_generated(&cwd, out) {
        io.err(&format!("generate-image: could not mark {} as generated for its decision page ({}); a --wait may report it stale\n", out, e));
    }
}

fn base64_decode(s: &str) -> Vec<u8> {
    let table = |c: u8| -> Option<u32> {
        match c {
            b'A'..=b'Z' => Some((c - b'A') as u32),
            b'a'..=b'z' => Some((c - b'a' + 26) as u32),
            b'0'..=b'9' => Some((c - b'0' + 52) as u32),
            b'+' | b'-' => Some(62),
            b'/' | b'_' => Some(63),
            _ => None,
        }
    };
    let mut out = Vec::new();
    let mut acc: u32 = 0;
    let mut bits = 0;
    for b in s.bytes() {
        let Some(v) = table(b) else { continue };
        acc = (acc << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((acc >> bits) & 0xff) as u8);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn round_trip(edit: bool, override_model: Option<&str>, background: Option<&str>) {
        let _proxy_lock = crate::http::PROXY_ENV_LOCK.lock().unwrap();
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let api_base = format!("http://{}", server.server_addr());
        let temp = std::env::temp_dir().join(format!("impeccable-image-{}-{}", std::process::id(), server.server_addr().to_ip().unwrap().port()));
        std::fs::create_dir_all(&temp).unwrap();
        std::fs::write(temp.join("ref.png"), png_fake("reference", 16, 16)).unwrap();
        let handle = std::thread::spawn(move || {
            let mut request = server.recv_timeout(Duration::from_secs(10)).unwrap().expect("image request");
            let path = request.url().to_string();
            let content_type = request.headers().iter().find(|h| h.field.equiv("Content-Type")).unwrap().value.to_string();
            let mut body = String::new();
            // Multipart carries binary PNG bytes; preserve ASCII fields for inspection.
            let mut bytes = Vec::new();
            request.as_reader().read_to_end(&mut bytes).unwrap();
            body.push_str(&String::from_utf8_lossy(&bytes));
            request.respond(tiny_http::Response::from_string(r#"{"data":[{"b64_json":"iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAYAAAD5PA/NAAAAGklEQVR4nGP4////f7mAigYGBgaG/////wMAUdQJXhk2RAEAAAAASUVORK5CYII="}]}"#)).unwrap();
            (path, content_type, body)
        });
        let env = Env::from([("OPENAI_API_KEY".into(), "test-key".into())]);
        let (mut io, captured) = Io::captured("", temp.clone(), env);
        let mut args: Vec<String> = ["--prompt", "Comp regression", "--out", "comp.png", "--quality", "high"].iter().map(|s| s.to_string()).collect();
        if edit {
            args.extend(["--ref".into(), "ref.png".into()]);
        }
        if let Some(model) = override_model {
            args.extend(["--model".into(), model.into()]);
        }
        if let Some(background) = background {
            args.extend(["--background".into(), background.into()]);
        }
        let exit = run_with_api_base(&args, &mut io, &api_base);
        let (path, content_type, body) = handle.join().unwrap();
        let sidecar: Value = serde_json::from_slice(&std::fs::read(temp.join("comp.png.json")).unwrap()).unwrap();
        let image = std::fs::read(temp.join("comp.png")).unwrap();
        std::fs::remove_dir_all(&temp).unwrap();
        assert_eq!(exit, 0);
        let model = override_model.unwrap_or("gpt-image-2.5-flare");
        if edit {
            assert_eq!(path, "/images/edits");
            assert!(content_type.starts_with("multipart/form-data; boundary="));
            assert!(body.contains(&format!("name=\"model\"\r\n\r\n{model}\r\n")));
            assert!(body.contains("name=\"image[]\"; filename=\"ref.png\""));
            assert_eq!(sidecar["refs"], serde_json::json!(["ref.png"]));
            if let Some(background) = background {
                assert!(body.contains(&format!("name=\"background\"\r\n\r\n{background}\r\n")));
                assert!(body.contains("name=\"output_format\"\r\n\r\npng\r\n"));
            } else {
                assert!(!body.contains("name=\"background\""));
            }
        } else {
            assert_eq!(path, "/images/generations");
            assert_eq!(content_type, "application/json");
            let body: Value = serde_json::from_str(&body).unwrap();
            let mut expected = serde_json::json!({"model": model, "prompt": "Comp regression", "size": "1536x1024", "quality": "high", "n": 1});
            if let Some(background) = background {
                expected["background"] = background.into();
                expected["output_format"] = "png".into();
            }
            assert_eq!(body, expected);
        }
        if let Some(background) = background {
            assert_eq!(sidecar["background"], background);
            assert_eq!(sidecar["outputFormat"], "png");
        } else {
            assert!(sidecar.get("background").is_none());
        }
        // The server's PNG contains clear, partial, near-opaque and opaque pixels.
        // Embedding may add metadata before IEND, but must preserve all image chunks.
        let original = base64_decode("iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAYAAAD5PA/NAAAAGklEQVR4nGP4////f7mAigYGBgaG/////wMAUdQJXhk2RAEAAAAASUVORK5CYII=");
        assert!(image.starts_with(&original[..original.len() - 12]));
        assert_eq!(sidecar["model"], model);
        assert_eq!(sidecar["prompt"], "Comp regression");
        assert!(image.starts_with(b"\x89PNG\r\n\x1a\n"));
        let stdout = String::from_utf8(captured.stdout.borrow().clone()).unwrap();
        assert!(stdout.contains(&format!("{model}, billed to your OpenAI key")));
        assert!(stdout.contains("prompt embedded + sidecar"));
    }

    /// Serves `GET` requests from `routes` (path -> status, content type,
    /// body) and answers one `POST` with a generated image; returns every
    /// request it saw as (method, path, body).
    fn serve(server: tiny_http::Server, routes: Vec<(&'static str, u16, &'static str, Vec<u8>)>, requests: usize) -> std::thread::JoinHandle<Vec<(String, String, String)>> {
        std::thread::spawn(move || {
            let mut seen = Vec::new();
            while seen.len() < requests {
                let Some(mut request) = server.recv_timeout(Duration::from_secs(10)).unwrap() else { break };
                let mut bytes = Vec::new();
                request.as_reader().read_to_end(&mut bytes).unwrap();
                let (method, path) = (request.method().to_string(), request.url().to_string());
                seen.push((method.clone(), path.clone(), String::from_utf8_lossy(&bytes).into_owned()));
                if method == "POST" {
                    request.respond(tiny_http::Response::from_string(r#"{"data":[{"b64_json":"iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAYAAAD5PA/NAAAAGklEQVR4nGP4////f7mAigYGBgaG/////wMAUdQJXhk2RAEAAAAASUVORK5CYII="}]}"#)).unwrap();
                } else if let Some((_, status, ty, body)) = routes.iter().find(|r| r.0 == path) {
                    let mut response = tiny_http::Response::from_data(body.clone()).with_status_code(*status);
                    if !ty.is_empty() {
                        response = response.with_header(tiny_http::Header::from_bytes(&b"Content-Type"[..], ty.as_bytes()).unwrap());
                    }
                    request.respond(response).unwrap();
                } else {
                    request.respond(tiny_http::Response::from_string("not found").with_status_code(404)).unwrap();
                }
            }
            seen
        })
    }

    fn temp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("impeccable-image-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn url_refs_are_downloaded_attached_and_recorded_as_urls() {
        let _proxy_lock = crate::http::PROXY_ENV_LOCK.lock().unwrap();
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let base = format!("http://{}", server.server_addr());
        let dir = temp("url-ref");
        std::fs::write(dir.join("local.png"), png_fake("local", 8, 8)).unwrap();
        let webp = [&b"RIFF\x10\0\0\0WEBPVP8 "[..], &[0u8; 8][..]].concat();
        let handle = serve(
            server,
            vec![
                // The bytes decide the type, whatever the header and the
                // URL's extension say (or do not say).
                ("/cards/world.webp?v=2", 200, "image/webp; charset=binary", webp),
                ("/cards/world-hero.png", 200, "application/octet-stream", png_fake("hero", 8, 8)),
                ("/cards/blob", 200, "", vec![0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]),
                ("/cards/mislabeled.webp", 200, "image/webp", png_fake("mislabeled", 8, 8)),
            ],
            5,
        );
        let (board, hero, blob, mislabeled) = (format!("{base}/cards/world.webp?v=2"), format!("{base}/cards/world-hero.png"), format!("{base}/cards/blob"), format!("{base}/cards/mislabeled.webp"));
        let env = Env::from([("OPENAI_API_KEY".into(), "test-key".into())]);
        let (mut io, captured) = Io::captured("", dir.clone(), env);
        let args: Vec<String> = ["--prompt", "Comp with cards", "--out", "comp.png", "--ref", &board, "--ref", "local.png", "--ref", &hero, "--ref", &blob, "--ref", &mislabeled].iter().map(|s| s.to_string()).collect();
        let exit = run_with_api_base(&args, &mut io, &base);
        let seen = handle.join().unwrap();
        let stderr = String::from_utf8(captured.stderr.borrow().clone()).unwrap();
        assert_eq!(exit, 0, "{stderr}");
        let paths: Vec<(&str, &str)> = seen.iter().map(|r| (r.0.as_str(), r.1.as_str())).collect();
        assert_eq!(paths, vec![("GET", "/cards/world.webp?v=2"), ("GET", "/cards/world-hero.png"), ("GET", "/cards/blob"), ("GET", "/cards/mislabeled.webp"), ("POST", "/images/edits")]);
        let body = &seen[4].2;
        assert!(body.contains("name=\"image[]\"; filename=\"world.webp\"\r\nContent-Type: image/webp\r\n\r\nRIFF"), "{body}");
        assert!(body.contains("name=\"image[]\"; filename=\"local.png\"\r\nContent-Type: image/png\r\n"), "{body}");
        assert!(body.contains("name=\"image[]\"; filename=\"world-hero.png\"\r\nContent-Type: image/png\r\n"), "{body}");
        assert!(body.contains("name=\"image[]\"; filename=\"blob\"\r\nContent-Type: image/jpeg\r\n"), "{body}");
        assert!(body.contains("name=\"image[]\"; filename=\"mislabeled.webp\"\r\nContent-Type: image/png\r\n"), "{body}");
        // The sidecar records each ref as it was given: the URL itself.
        let sidecar: Value = serde_json::from_slice(&std::fs::read(dir.join("comp.png.json")).unwrap()).unwrap();
        assert_eq!(sidecar["refs"], serde_json::json!([board, "local.png", hero, blob, mislabeled]));
        assert!(dir.join("comp.png").exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_failed_url_ref_names_the_url_and_writes_nothing() {
        let _proxy_lock = crate::http::PROXY_ENV_LOCK.lock().unwrap();
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let base = format!("http://{}", server.server_addr());
        let dir = temp("url-ref-fail");
        let handle = serve(server, vec![("/cards/page.html", 200, "text/html", b"<html>blocked</html>".to_vec()), ("/cards/world.webp", 200, "image/webp", b"<html>sign in</html>".to_vec())], 3);
        let run_ref = |url: &str| {
            let env = Env::from([("OPENAI_API_KEY".into(), "test-key".into())]);
            let (mut io, captured) = Io::captured("", dir.clone(), env);
            let args: Vec<String> = ["--prompt", "p", "--out", "comp.png", "--ref", url].iter().map(|s| s.to_string()).collect();
            let exit = run_with_api_base(&args, &mut io, &base);
            let err = String::from_utf8(captured.stderr.borrow().clone()).unwrap();
            let out = String::from_utf8(captured.stdout.borrow().clone()).unwrap();
            (exit, err, out)
        };
        // A missing image, then a page that is not an image.
        let missing = format!("{base}/cards/gone.webp");
        let (exit, err, out) = run_ref(&missing);
        assert_eq!((exit, out.as_str()), (1, ""));
        assert_eq!(err, format!("generate-image: could not download --ref {missing}: HTTP 404; nothing was generated.\n"));
        let page = format!("{base}/cards/page.html");
        let (exit, err, _) = run_ref(&page);
        assert_eq!(exit, 1);
        assert_eq!(err, format!("generate-image: could not download --ref {page}: the response is not a png, webp, or jpeg image; nothing was generated.\n"));
        // A 200 page behind an image URL and an image Content-Type is still not an image.
        let wall = format!("{base}/cards/world.webp");
        let (exit, err, _) = run_ref(&wall);
        assert_eq!(exit, 1);
        assert_eq!(err, format!("generate-image: could not download --ref {wall}: the response is not a png, webp, or jpeg image; nothing was generated.\n"));
        // Only the three downloads reached the server: no generation request.
        let seen = handle.join().unwrap();
        assert!(seen.iter().all(|r| r.0 == "GET"), "{seen:?}");
        // An unreachable host reads the same on every OS.
        let (exit, err, _) = run_ref("http://127.0.0.1:9/ref.png");
        assert_eq!(exit, 1);
        assert_eq!(err, "generate-image: could not download --ref http://127.0.0.1:9/ref.png: the request failed; nothing was generated.\n");
        assert!(!dir.join("comp.png").exists() && !dir.join("comp.png.json").exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn fake_mode_never_requests_a_url_ref() {
        let _proxy_lock = crate::http::PROXY_ENV_LOCK.lock().unwrap();
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let url = format!("http://{}/cards/world.webp", server.server_addr());
        let dir = temp("url-ref-fake");
        let env = Env::from([("IMPECCABLE_IMAGE_GEN_FAKE".into(), "1".into()), ("OPENAI_API_KEY".into(), "test-key".into())]);
        let (mut io, captured) = Io::captured("", dir.clone(), env);
        let args: Vec<String> = ["--prompt", "p", "--out", "comp.png", "--ref", &url].iter().map(|s| s.to_string()).collect();
        assert_eq!(run(&args, &mut io), 0);
        assert!(String::from_utf8(captured.stdout.borrow().clone()).unwrap().contains("fake synthetic comp"));
        assert!(server.recv_timeout(Duration::from_millis(300)).unwrap().is_none());
        assert!(dir.join("comp.png").exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn url_file_names_and_types() {
        assert_eq!(url_file_name("https://x.test/cards/a-hero.webp?v=1#f"), "a-hero.webp");
        assert_eq!(url_file_name("https://x.test/"), "ref");
        assert_eq!(url_file_name("https://x.test"), "ref");
        assert_eq!(sniffed_type(b"<html>"), None);
        assert_eq!(sniffed_type(b"RIFF\x10\0\0\0WEBPVP8 "), Some("image/webp"));
        assert!(is_url("http://a") && is_url("https://a") && !is_url("refs/a.png") && !is_url("ftp://a"));
    }

    #[test]
    fn generation_uses_image_25_and_records_model() {
        round_trip(false, None, None);
    }

    #[test]
    fn reference_edit_uses_image_25_and_records_model() {
        round_trip(true, None, None);
    }

    #[test]
    fn generation_accepts_model_override() {
        round_trip(false, Some("gpt-image-2"), None);
    }

    #[test]
    fn reference_edit_accepts_sunburst_override() {
        round_trip(true, Some("gpt-image-2.5-sunburst"), None);
    }

    #[test]
    fn transparent_generation_preserves_alpha_and_provenance() {
        round_trip(false, None, Some("transparent"));
    }

    #[test]
    fn transparent_edit_preserves_alpha_and_provenance() {
        round_trip(true, Some("gpt-image-2.5-sunburst"), Some("transparent"));
    }

    #[test]
    fn opaque_background_is_explicit() {
        round_trip(false, None, Some("opaque"));
    }

    #[test]
    fn fake_cutout_has_real_alpha_and_default_fake_stays_rgb() {
        use std::io::Read;
        let png = png_fake_background("cutout", 16, 16, true);
        assert_eq!(png[25], 6); // RGBA
        assert_eq!(png_fake("comp", 16, 16)[25], 2); // RGB, legacy fake output
        let mut offset = 8;
        let mut raw = Vec::new();
        while offset + 12 <= png.len() {
            let size = u32::from_be_bytes(png[offset..offset + 4].try_into().unwrap()) as usize;
            if &png[offset + 4..offset + 8] == b"IDAT" {
                flate2::read::ZlibDecoder::new(&png[offset + 8..offset + 8 + size])
                    .read_to_end(&mut raw)
                    .unwrap();
            }
            offset += size + 12;
        }
        assert_eq!(raw[4], 0); // transparent corner
        assert_eq!(raw[8 * (16 * 4 + 1) + 1 + 8 * 4 + 3], 255); // opaque subject
    }

    #[test]
    fn api_base_reads_openai_base_url() {
        let env = |v: &str| Env::from([("OPENAI_BASE_URL".into(), v.into())]);
        assert_eq!(api_base(&Env::new()), "https://api.openai.com/v1");
        assert_eq!(api_base(&env("")), "https://api.openai.com/v1");
        assert_eq!(api_base(&env("  ")), "https://api.openai.com/v1");
        assert_eq!(api_base(&env("http://127.0.0.1:8790/openai/v1/")), "http://127.0.0.1:8790/openai/v1");
        assert_eq!(api_base(&env("https://proxy.example/v1")), "https://proxy.example/v1");
    }

    #[test]
    fn invalid_background_requests_fail_before_network_or_output() {
        for flags in [
            vec!["--background"],
            vec!["--background", "white"],
            vec!["--background", "transparent", "--out", "cutout.jpg"],
            vec!["--background", "opaque", "--out", "hero.webp"],
            vec!["--background", "auto", "--out", "hero.svg"],
        ] {
            let (mut io, captured) = Io::captured("", std::env::temp_dir(), Env::new());
            let args = flags.iter().map(|s| s.to_string()).collect::<Vec<_>>();
            assert_eq!(run(&args, &mut io), 1);
            let stderr = String::from_utf8(captured.stderr.borrow().clone()).unwrap();
            assert!(stderr.contains("--background"), "{stderr}");
            assert!(!stderr.contains("OPENAI_API_KEY"));
        }
    }
}
