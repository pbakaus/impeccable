//! The headless-browser side of `impeccable font-match`, wired over
//! `crates/browser`'s CDP client. This is the one piece the open
//! `impeccable-comp-verbs` crate cannot do on its own; it is injected as a
//! `FontRenderer` so the browser (and its `core` dependency) stays out of that
//! crate. Ported from `font-match.mjs` `renderCandidates` / `renderProofSheet`,
//! which drove Playwright/Puppeteer; here the same steps run over CDP against a
//! discovered Chrome (the browser the URL engine already uses).

use std::collections::HashMap;
use std::time::Duration;

use base64::Engine as _;
use impeccable_browser::cdp::{default_chrome_args, Browser, EvalOutcome, Page, Viewport};
use impeccable_browser::discovery;
use impeccable_comp::font_fingerprint::{fingerprint, FpOpts};
use impeccable_comp::png_io;
use impeccable_comp::raster::Image;
use impeccable_comp_verbs::font_match::{FontRenderer, RankCandidate, RenderedCandidate};

const NAV_TIMEOUT: Duration = Duration::from_secs(30);

/// A renderer that discovers and drives an installed Chrome over CDP.
pub struct CdpFontRenderer {
    env: HashMap<String, String>,
}

impl CdpFontRenderer {
    pub fn from_process_env() -> Self {
        CdpFontRenderer { env: std::env::vars().collect() }
    }

    fn launch(&self) -> Option<Browser> {
        let exe = discovery::find_browser(&self.env).ok()?;
        // JS launchArgs: `process.env.CI ? ['--no-sandbox','--disable-setuid-sandbox'] : []`.
        let mut user_args: Vec<String> = Vec::new();
        if self.env.get("CI").map(|v| !v.is_empty()).unwrap_or(false) {
            user_args.push("--no-sandbox".into());
            user_args.push("--disable-setuid-sandbox".into());
        }
        let dangerous = self.env.get("PUPPETEER_DANGEROUS_NO_SANDBOX").map(String::as_str) == Some("true");
        let _ = default_chrome_args(&user_args, dangerous); // parity: same flag set the URL engine uses
        Browser::launch(&exe, &user_args, dangerous).ok()
    }
}

fn b64(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn data_url(html: &str) -> String {
    format!("data:text/html;base64,{}", b64(html.as_bytes()))
}

/// encodeURIComponent(fam).replace(/%20/g,'+') for the Google Fonts css2 URL.
fn encode_family(fam: &str) -> String {
    let mut out = String::new();
    for ch in fam.chars() {
        if ch == ' ' {
            out.push('+');
        } else if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | '!' | '~' | '*' | '\'' | '(' | ')') {
            out.push(ch);
        } else {
            let mut buf = [0u8; 4];
            for byte in ch.encode_utf8(&mut buf).bytes() {
                out.push_str(&format!("%{byte:02X}"));
            }
        }
    }
    out
}

fn wfmt(w: f64) -> String {
    (w as i64).to_string()
}

fn js_string(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| "\"\"".to_string())
}

fn links_html(candidates: &[RankCandidate]) -> String {
    candidates
        .iter()
        .map(|c| {
            format!(
                "<link rel=\"stylesheet\" href=\"https://fonts.googleapis.com/css2?family={}:wght@{}&display=block\">",
                encode_family(&c.family),
                wfmt(c.weight)
            )
        })
        .collect()
}

fn eval_bool(page: &mut Page<'_>, expr: &str) -> bool {
    match page.evaluate(expr) {
        Ok(EvalOutcome::Value(v)) => v.as_bool().unwrap_or(false),
        _ => false,
    }
}

fn eval_value(page: &mut Page<'_>, expr: &str) -> Option<serde_json::Value> {
    match page.evaluate(expr) {
        Ok(EvalOutcome::Value(v)) => Some(v),
        _ => None,
    }
}

impl FontRenderer for CdpFontRenderer {
    fn render_candidates(
        &mut self,
        candidates: &[RankCandidate],
        text: &str,
        target_cap_px: f64,
        transform: &str,
    ) -> Option<Vec<RenderedCandidate>> {
        let mut browser = self.launch()?;
        let links = links_html(candidates);
        let html = format!(
            "<!doctype html><html><head><meta charset=\"utf-8\">{links}<style>body{{margin:0;background:#fff}}div.s{{position:absolute;left:0;top:0;white-space:nowrap;color:#000;line-height:1;padding:8px;text-transform:{transform}}}</style></head><body></body></html>"
        );
        let size0 = 12f64.max((target_cap_px * 1.4).round());
        let mut results: Vec<RenderedCandidate> = Vec::new();
        let outcome = (|| -> Option<()> {
            let mut page = browser.new_page().ok()?;
            page.set_viewport(Viewport { width: 1600, height: 400 }).ok()?;
            page.goto(&data_url(&html), "load", NAV_TIMEOUT).ok()?;
            std::thread::sleep(Duration::from_millis(800));
            for c in candidates {
                let mut size = size0;
                let mut fp = None;
                let mut ok = true;
                for pass in 0..2 {
                    let div = format!(
                        "<div class=\"s\" style=\"font-family:'{}',sans-serif;font-weight:{};font-size:{}px\">{}</div>",
                        c.family,
                        wfmt(c.weight),
                        size as i64,
                        text
                    );
                    let set = format!("(() => {{ document.body.innerHTML = {}; }})()", js_string(&div));
                    let _ = page.evaluate(&set);
                    // Loaded means a real face of this family covers the weight.
                    let check = format!(
                        "(async () => {{ const f = {{ family: {}, weight: {} }}; const faces = await document.fonts.load(f.weight + \" 32px '\" + f.family + \"'\"); await document.fonts.ready; const covers = (face) => {{ const w = String(face.weight || '400').split(/\\s+/).map(Number); const lo = w[0], hi = w[1] ?? w[0]; return f.weight >= lo - 50 && f.weight <= hi + 50; }}; return faces.some((face) => face.family.replace(/[\"']/g, '') === f.family && face.status === 'loaded' && covers(face)); }})()",
                        js_string(&c.family),
                        wfmt(c.weight)
                    );
                    let loaded = eval_bool(&mut page, &check);
                    std::thread::sleep(Duration::from_millis(100));
                    if !loaded {
                        ok = false;
                    }
                    let box_v = eval_value(&mut page, "(() => { const r = document.querySelector('div.s').getBoundingClientRect(); return { w: Math.ceil(r.width) + 8, h: Math.ceil(r.height) + 8 }; })()");
                    let (bw, bh) = box_v
                        .as_ref()
                        .map(|v| (v.get("w").and_then(|x| x.as_f64()).unwrap_or(0.0), v.get("h").and_then(|x| x.as_f64()).unwrap_or(0.0)))
                        .unwrap_or((0.0, 0.0));
                    let clip_w = 1600f64.min(bw);
                    let clip_h = 400f64.min(bh);
                    let shot = page.screenshot_clip(0.0, 0.0, clip_w, clip_h).ok()?;
                    let png = base64::engine::general_purpose::STANDARD.decode(shot.as_bytes()).ok()?;
                    fp = png_io::decode_png(&png).ok().and_then(|d| fingerprint(&d.image, &FpOpts::default()));
                    if fp.is_none() || pass == 1 {
                        break;
                    }
                    let cap = fp.as_ref().unwrap().cap_height_px;
                    size = 8f64.max((size * (target_cap_px / cap)).round());
                }
                results.push(RenderedCandidate {
                    family: c.family.clone(),
                    weight: c.weight,
                    loaded: ok,
                    font_size_px: size as i64,
                    fp,
                });
            }
            page.close();
            Some(())
        })();
        browser.close();
        outcome.map(|_| results)
    }

    fn render_proof_sheet(
        &mut self,
        comp_crop: &Image,
        top: &[RenderedCandidate],
        text: &str,
        _cap_px: f64,
        transform: &str,
    ) -> Option<Vec<u8>> {
        let comp_png = png_io::encode_png(comp_crop, &[]).ok()?;
        let comp_b64 = b64(&comp_png);
        let links: String = top
            .iter()
            .map(|c| {
                format!(
                    "<link rel=\"stylesheet\" href=\"https://fonts.googleapis.com/css2?family={}:wght@{}&display=block\">",
                    encode_family(&c.family),
                    wfmt(c.weight)
                )
            })
            .collect();
        let rows: String = top
            .iter()
            .map(|c| {
                format!(
                    "<div class=\"row\"><div class=\"lab\">{} {} · {}px</div><div class=\"s\" style=\"font-family:'{}';font-weight:{};font-size:{}px;text-transform:{}\">{}</div></div>",
                    &c.family,
                    wfmt(c.weight),
                    c.font_size_px,
                    c.family,
                    wfmt(c.weight),
                    c.font_size_px,
                    transform,
                    text
                )
            })
            .collect();
        let html = format!(
            "<!doctype html><html><head><meta charset=\"utf-8\">{links}<style>body{{margin:0;background:#fff;padding:12px;font-family:system-ui}}img{{display:block;max-width:100%}}.lab{{font:12px system-ui;color:#666;margin:10px 0 2px}}.s{{white-space:nowrap;line-height:1.05;color:#111}}</style></head><body><div class=\"lab\">COMP</div><img src=\"data:image/png;base64,{comp_b64}\">{rows}</body></html>"
        );
        let mut browser = self.launch()?;
        let vw = 1600u32.min(600u32.max(comp_crop.width as u32 + 24));
        let outcome = (|| -> Option<Vec<u8>> {
            let mut page = browser.new_page().ok()?;
            page.set_viewport(Viewport { width: vw, height: 200 }).ok()?;
            page.goto(&data_url(&html), "load", NAV_TIMEOUT).ok()?;
            let _ = page.evaluate("(async () => { await document.fonts.ready; })()");
            std::thread::sleep(Duration::from_millis(600));
            let size = eval_value(&mut page, "(() => ({ w: Math.ceil(document.documentElement.scrollWidth), h: Math.ceil(document.documentElement.scrollHeight) }))()");
            let (w, h) = size
                .as_ref()
                .map(|v| (v.get("w").and_then(|x| x.as_f64()).unwrap_or(vw as f64), v.get("h").and_then(|x| x.as_f64()).unwrap_or(200.0)))
                .unwrap_or((vw as f64, 200.0));
            let shot = page.screenshot_clip(0.0, 0.0, w, h).ok()?;
            let png = base64::engine::general_purpose::STANDARD.decode(shot.as_bytes()).ok()?;
            page.close();
            Some(png)
        })();
        browser.close();
        outcome
    }
}
