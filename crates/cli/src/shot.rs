//! `impeccable shot <page> [--viewport WxH[,WxH...]] [--full] [--out <dir>]`:
//! a look at a local page or URL at the sizes it ships at.
//!
//! One PNG per viewport (1440x900 and 390x844 unless `--viewport` names
//! others), named `<W>x<H>.png`, or `<W>x<H>-full.png` for the whole page with
//! `--full`. They go to `--out`, else `.impeccable/shots/` (ignored by git),
//! and each run overwrites the last. It prints one path per line and exits 1
//! when no browser is found or a viewport fails to load, 2 on bad arguments.

use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::Engine;
use impeccable_browser::cdp::{Browser, Viewport};
use impeccable_browser::fullpage;
use impeccable_common::Io;

use crate::first_viewport::{file_url, full_page_png, launch, parse_viewport, settle};

const USAGE: &str = "Usage: impeccable shot <page or url> [--viewport WxH[,WxH...]] [--full] [--out <dir>]\n";
const NAV_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_CAPTURE_HEIGHT: f64 = 20000.0;

fn capture(browser: &mut Browser, url: &str, vp: Viewport, full: bool) -> Result<Vec<u8>, String> {
    let mut page = browser.new_page().map_err(|e| e.message)?;
    let result = (|| {
        page.set_viewport(vp).map_err(|e| e.message)?;
        page.goto(url, "load", NAV_TIMEOUT).map_err(|e| e.message)?;
        settle(&mut page);
        if full {
            let shot = fullpage::capture_full_page(&mut page, MAX_CAPTURE_HEIGHT, 90).map_err(|e| e.message)?;
            let img = fullpage::decode_jpeg(&shot.jpeg_base64).ok_or("the full-page capture did not decode")?;
            full_page_png(img.width(), img.height(), img.as_raw())
        } else {
            let _ = page.evaluate("window.scrollTo({ left: 0, top: 0, behavior: 'instant' })");
            let data = page.screenshot_viewport().map_err(|e| e.message)?;
            base64::engine::general_purpose::STANDARD.decode(data).map_err(|e| e.to_string())
        }
    })();
    page.close();
    result
}

/// The path as the caller can use it: relative to the working directory when
/// it sits inside it.
fn shown(path: &Path, cwd: &Path) -> String {
    path.strip_prefix(cwd).unwrap_or(path).display().to_string()
}

pub fn run(rest: &[String], io: &mut Io) -> i32 {
    let mut page: Option<String> = None;
    let mut viewports: Vec<Viewport> = Vec::new();
    let mut full = false;
    let mut out: Option<String> = None;
    let mut it = rest.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--full" => full = true,
            "--out" => match it.next() {
                Some(dir) if !dir.trim().is_empty() && !dir.starts_with("--") => out = Some(dir.clone()),
                _ => {
                    io.err(USAGE);
                    return 2;
                }
            },
            "--viewport" => {
                let parsed: Option<Vec<Viewport>> =
                    it.next().map(|v| v.split(',').map(parse_viewport).collect()).unwrap_or(None);
                match parsed {
                    Some(v) if v.iter().all(|vp| vp.width > 0 && vp.height > 0) => viewports.extend(v),
                    _ => {
                        io.err("--viewport takes WIDTHxHEIGHT, comma-separated for several, e.g. 1440x900,390x844\n");
                        return 2;
                    }
                }
            }
            "--help" | "-h" => {
                io.out(USAGE);
                return 0;
            }
            v if !v.starts_with("--") && page.is_none() => page = Some(v.to_string()),
            v => {
                io.err(&format!("Unknown argument: {v}\n{USAGE}"));
                return 2;
            }
        }
    }
    let Some(page) = page else {
        io.err(USAGE);
        return 2;
    };
    let url = if page.contains("://") {
        page
    } else {
        match io.cwd.join(&page).canonicalize() {
            Ok(p) => file_url(&p),
            Err(_) => {
                io.err(&format!("No page at {page}\n"));
                return 2;
            }
        }
    };
    if viewports.is_empty() {
        viewports = vec![Viewport { width: 1440, height: 900 }, Viewport { width: 390, height: 844 }];
    }
    let mut browser = match launch(io) {
        Ok(b) => b,
        Err(e) => {
            io.err(&format!("shot needs Chrome or Chromium and found none: {e}\n"));
            return 1;
        }
    };
    let dir: PathBuf = match &out {
        Some(o) => io.cwd.join(o),
        None => {
            let d = io.cwd.join(".impeccable").join("shots");
            impeccable_common::git::ensure_dir_ignored(&d.to_string_lossy(), &["*"]);
            d
        }
    };
    if let Err(e) = std::fs::create_dir_all(&dir) {
        browser.close();
        io.err(&format!("Could not create {}: {e}\n", dir.display()));
        return 1;
    }
    let mut code = 0;
    for vp in viewports {
        let name = format!("{}x{}{}.png", vp.width, vp.height, if full { "-full" } else { "" });
        let path = dir.join(name);
        match capture(&mut browser, &url, vp, full).and_then(|png| std::fs::write(&path, png).map_err(|e| e.to_string())) {
            Ok(()) => io.out(&format!("{}\n", shown(&path, &io.cwd))),
            Err(e) => {
                code = 1;
                io.err(&format!("{}x{}: the page did not load: {e}\n", vp.width, vp.height));
            }
        }
    }
    browser.close();
    code
}
