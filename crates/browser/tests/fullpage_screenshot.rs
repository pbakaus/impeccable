//! The full-page screenshot an evidence scan records, against an installed
//! browser and locally served fixtures. Skips cleanly when there is none.
//!
//! - A tall document paints to its foot, and a wide one to its right edge.
//! - A page whose body scrolls (the document is one viewport tall) is
//!   captured by scrolling the body, and the pixel contrast pass reads the
//!   text below its fold. A footer under a 100vh shell that scrolls its own
//!   frame follows the frame's content.
//! - Rows a feed renders only once they are scrolled to appear in the
//!   screenshot.
//! - An element past the screenshot cut gets a viewport shot of its own.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};

use base64::Engine as _;
use impeccable_browser::{
    detect_url_evidence, origin, BrowserEngine, Evidence, EvidenceRequest,
};
use impeccable_core::findings::Finding;
use impeccable_detect::engines::ScanOptions;

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/antipatterns")
}

fn serve() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            std::thread::spawn(move || handle(stream));
        }
    });
    port
}

fn handle(mut stream: TcpStream) {
    let mut buf = [0u8; 8192];
    let n = stream.read(&mut buf).unwrap_or(0);
    let request = String::from_utf8_lossy(&buf[..n]);
    let path = request
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .unwrap_or("/")
        .to_string();
    let file = fixtures_dir().join(path.trim_start_matches('/'));
    let (status, body) = if path == "/offset-scroller.html" {
        ("200 OK", OFFSET_SCROLLER_PAGE.as_bytes().to_vec())
    } else if path == "/margin-shell.html" {
        ("200 OK", MARGIN_SHELL_PAGE.as_bytes().to_vec())
    } else {
        match std::fs::read(&file) {
            Ok(body) => ("200 OK", body),
            Err(_) => ("404 Not Found", b"missing".to_vec()),
        }
    };
    let head = format!(
        "HTTP/1.0 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(&body);
    let _ = stream.flush();
}

fn engine() -> Option<BrowserEngine> {
    let env: HashMap<String, String> = std::env::vars().collect();
    if impeccable_browser::discovery::find_browser(&env).is_err() {
        eprintln!("skip: no installed browser found");
        return None;
    }
    Some(BrowserEngine::new(env))
}

fn scan(
    engine: &BrowserEngine,
    port: u16,
    fixture: &str,
    viewport: (u32, u32),
    request: &EvidenceRequest,
) -> Option<(Vec<Finding>, Evidence)> {
    if !fixtures_dir().join(fixture).exists() {
        eprintln!("skip: {fixture} not present");
        return None;
    }
    let options = ScanOptions {
        viewport: Some(viewport),
        ..Default::default()
    };
    let mut browser = engine.launch().expect("launch");
    let url = format!("http://127.0.0.1:{port}/{fixture}");
    let out = detect_url_evidence(&mut browser, &url, &options, "load", 100, request)
        .expect("evidence scan");
    browser.close();
    Some(out)
}

fn decode(jpeg_base64: &str) -> image::RgbImage {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(jpeg_base64)
        .expect("base64");
    image::load_from_memory_with_format(&bytes, image::ImageFormat::Jpeg)
        .expect("jpeg")
        .to_rgb8()
}

/// The luma spread inside `[x, y, w, h]`: text or a marker spreads wide,
/// a blank region reads about 0.
fn luma_spread(img: &image::RgbImage, rect: [f64; 4]) -> u8 {
    let x0 = rect[0].max(0.0) as u32;
    let y0 = rect[1].max(0.0) as u32;
    let x1 = ((rect[0] + rect[2]) as u32).min(img.width());
    let y1 = ((rect[1] + rect[3]) as u32).min(img.height());
    let (mut lo, mut hi) = (255u8, 0u8);
    for y in y0..y1 {
        for x in x0..x1 {
            let p = img.get_pixel(x, y).0;
            let l = ((p[0] as u32 * 299 + p[1] as u32 * 587 + p[2] as u32 * 114) / 1000) as u8;
            lo = lo.min(l);
            hi = hi.max(l);
        }
    }
    hi.saturating_sub(lo)
}

fn rect_of(evidence: &Evidence, selector: &str) -> [f64; 4] {
    let r = evidence
        .element_rects
        .get(selector)
        .and_then(|v| v.as_array())
        .unwrap_or_else(|| panic!("no rect for {selector}: {:?}", evidence.element_rects.keys()));
    let v: Vec<f64> = r.iter().filter_map(|n| n.as_f64()).collect();
    [v[0], v[1], v[2], v[3]]
}

fn flagged<'a>(findings: &'a [Finding], evidence: &'a Evidence) -> Vec<(&'a str, &'a str, &'a str)> {
    findings
        .iter()
        .zip(&evidence.origins)
        .map(|(f, o)| {
            (
                f.antipattern.as_str(),
                f.extras.get("selector").and_then(|v| v.as_str()).unwrap_or(""),
                *o,
            )
        })
        .collect()
}

#[test]
fn a_tall_page_paints_to_its_foot() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let Some((findings, evidence)) =
        scan(&engine, port, "fullpage-screenshot.html", (1280, 800), &EvidenceRequest::default())
    else {
        return;
    };
    let all = flagged(&findings, &evidence);
    assert!(all.contains(&("low-contrast", "#flag-foot-copy", origin::SCAN)), "{all:?}");
    assert!(!all.iter().any(|(_, s, _)| *s == "#pass-foot-copy"), "{all:?}");

    let shot = evidence.screenshot.as_ref().expect("screenshot");
    assert!(shot.document_height > 4000.0, "{}", shot.document_height);
    assert_eq!(shot.height, shot.document_height);
    let img = decode(&shot.jpeg_base64);
    assert_eq!(img.height() as f64, shot.height);
    let rect = rect_of(&evidence, "#flag-foot-copy");
    assert!(rect[1] > 4000.0, "{rect:?}");
    // The faint copy is light grey on white; its glyphs still spread.
    assert!(luma_spread(&img, rect) > 20, "the flagged copy is blank in the screenshot");
    // The green marker under it, in the should-pass column too.
    let marker = [rect[0], rect[1] + rect[3] + 16.0, 420.0, 40.0];
    assert!(luma_spread(&img, [20.0, marker[1], 900.0, 40.0]) > 60, "marker row is blank");
    assert!(evidence.element_shots.is_empty(), "{:?}", evidence.element_shots.len());
}

#[test]
fn a_wide_page_is_captured_to_its_right_edge() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let Some((_, evidence)) =
        scan(&engine, port, "fullpage-screenshot.html", (390, 844), &EvidenceRequest::default())
    else {
        return;
    };
    let shot = evidence.screenshot.as_ref().expect("screenshot");
    assert!(shot.width >= 900.0, "{}", shot.width);
    let img = decode(&shot.jpeg_base64);
    let rect = rect_of(&evidence, "#flag-foot-copy");
    // The should-pass column's ink copy, level with the flagged copy, past
    // the 390px viewport edge.
    assert!(
        luma_spread(&img, [480.0, rect[1], 420.0, rect[3]]) > 60,
        "the column past the viewport edge is blank"
    );
}

#[test]
fn a_body_scroller_page_is_captured_by_scrolling_the_body() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let Some((findings, evidence)) = scan(
        &engine,
        port,
        "fullpage-screenshot-scroller.html",
        (1280, 800),
        &EvidenceRequest::default(),
    ) else {
        return;
    };
    let all = flagged(&findings, &evidence);
    assert!(all.contains(&("low-contrast", "#flag-scroller-foot-copy", origin::SCAN)), "{all:?}");
    // Only the visual pass can measure white text on a photo, and the photo
    // sits below the body scroller's fold.
    assert!(
        all.contains(&("low-contrast", "#flag-scroller-photo-copy", origin::VISUAL_CONTRAST)),
        "{all:?}"
    );
    // The walk cannot read vector paint, so the verdict is the pixel pass's,
    // read with the body scrolled to the text.
    let pixel = findings
        .iter()
        .zip(&evidence.origins)
        .find(|(f, o)| {
            **o == origin::VISUAL_CONTRAST
                && f.extras.get("selector").and_then(|v| v.as_str()) == Some("#flag-scroller-vector-copy")
        })
        .unwrap_or_else(|| panic!("no pixel finding for the vector copy: {all:?}"));
    assert!(pixel.0.snippet.starts_with("pixel contrast "), "{}", pixel.0.snippet);
    for unwanted in [
        "#pass-scroller-photo-copy",
        "#pass-scroller-vector-copy",
        "#pass-scroller-foot-copy",
    ] {
        assert!(!all.iter().any(|(_, s, _)| *s == unwanted), "{unwanted} flagged: {all:?}");
    }

    let shot = evidence.screenshot.as_ref().expect("screenshot");
    assert!(shot.height > 4000.0, "{}", shot.height);
    let img = decode(&shot.jpeg_base64);
    // Every pass put the body back where it measured, so the rects are
    // document positions and match the screenshot.
    for selector in [
        "#flag-scroller-foot-copy",
        "#flag-scroller-photo-copy",
        "#flag-scroller-vector-copy",
    ] {
        let rect = rect_of(&evidence, selector);
        assert!(rect[1] > 2000.0, "{selector}: {rect:?}");
        assert!(luma_spread(&img, rect) > 10, "{selector} is blank in the screenshot");
    }
    let foot = rect_of(&evidence, "#flag-scroller-foot-copy");
    assert!(
        luma_spread(&img, [20.0, foot[1] + foot[3] + 16.0, 900.0, 40.0]) > 60,
        "marker row is blank"
    );
    // Viewport chrome paints once, in the first viewport, not on every tile:
    // the fixed badge, and the tooltip the page re-anchored on every scroll.
    // Counted in solid 4x4 blocks, not pixels: with subpixel text
    // antialiasing (ClearType on Windows, LCD filtering on Linux) a glyph's
    // coloured fringe can fall inside either colour range one pixel at a
    // time, and only a painted box fills a block.
    let blocks = |y0: u32, y1: u32, pick: &dyn Fn([u8; 3]) -> bool| {
        let y1 = y1.min(img.height());
        (y0..y1.saturating_sub(3))
            .step_by(4)
            .flat_map(|y| (0..img.width().saturating_sub(3)).step_by(4).map(move |x| (x, y)))
            .filter(|&(x, y)| (0..4).all(|dy| (0..4).all(|dx| pick(img.get_pixel(x + dx, y + dy).0))))
            .count()
    };
    let badge = |p: [u8; 3]| p[0] > 170 && p[1] < 70 && p[2] > 50 && p[2] < 140;
    let tip = |p: [u8; 3]| p[0] < 70 && p[1] > 110 && p[1] < 170 && p[2] > 170;
    assert!(blocks(0, 800, &badge) > 200, "the fixed badge is missing from the first viewport");
    assert_eq!(blocks(800, img.height(), &badge), 0, "the fixed badge repeats below the first viewport");
    assert!(blocks(0, 800, &tip) > 200, "the anchored tooltip is missing from the first viewport");
    assert_eq!(blocks(800, img.height(), &tip), 0, "the anchored tooltip repeats below the first viewport");
}

#[test]
fn a_fixed_scroll_frame_page_is_captured_by_scrolling_the_frame() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let Some((findings, evidence)) = scan(
        &engine,
        port,
        "fullpage-screenshot-frame.html",
        (1280, 800),
        &EvidenceRequest::default(),
    ) else {
        return;
    };
    let all = flagged(&findings, &evidence);
    assert!(all.contains(&("low-contrast", "#flag-frame-foot-copy", origin::SCAN)), "{all:?}");
    assert!(!all.iter().any(|(_, s, _)| *s == "#pass-frame-foot-copy"), "{all:?}");

    let shot = evidence.screenshot.as_ref().expect("screenshot");
    assert_eq!(shot.method, impeccable_browser::fullpage::method::STITCHED);
    assert!(shot.height > 3400.0, "{}", shot.height);
    let img = decode(&shot.jpeg_base64);
    let rect = rect_of(&evidence, "#flag-frame-foot-copy");
    assert!(rect[1] > 3000.0, "{rect:?}");
    assert!(luma_spread(&img, rect) > 20, "the flagged copy is blank in the screenshot");
    assert!(
        luma_spread(&img, [20.0, rect[1] + rect[3] + 16.0, 900.0, 40.0]) > 60,
        "marker row is blank"
    );
}

#[test]
fn rows_rendered_on_scroll_appear_in_the_screenshot() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let Some((_, evidence)) = scan(
        &engine,
        port,
        "fullpage-screenshot-virtual.html",
        (1280, 800),
        &EvidenceRequest::default(),
    ) else {
        return;
    };
    let shot = evidence.screenshot.as_ref().expect("screenshot");
    assert!(shot.height > 5000.0, "{}", shot.height);
    let img = decode(&shot.jpeg_base64);
    // A band of rows near the foot of both lists.
    for y in [2500.0, 4000.0, 5600.0] {
        assert!(
            luma_spread(&img, [20.0, y, 900.0, 180.0]) > 40,
            "rows near y {y} are blank in the screenshot"
        );
    }
}

#[test]
fn an_element_past_the_cut_gets_its_own_shot() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let request = EvidenceRequest {
        max_screenshot_height: 1500.0,
        ..EvidenceRequest::default()
    };
    let Some((_, evidence)) =
        scan(&engine, port, "fullpage-screenshot.html", (1280, 800), &request)
    else {
        return;
    };
    let shot = evidence.screenshot.as_ref().expect("screenshot");
    assert_eq!(shot.height, 1500.0);
    assert!(shot.document_height > 4000.0);
    let rect = rect_of(&evidence, "#flag-foot-copy");
    assert!(rect[1] > shot.height, "{rect:?}");

    let element = evidence
        .element_shots
        .iter()
        .find(|s| s.selector == "#flag-foot-copy")
        .expect("a viewport shot for the element past the cut");
    let img = decode(&element.jpeg_base64);
    assert_eq!(img.width() as f64, element.width);
    assert_eq!(img.height() as f64, element.height);
    let r = element.rect;
    assert!(r[1] >= 0.0 && r[1] + r[3] <= element.height, "{r:?}");
    assert!((r[2] - rect[2]).abs() < 1.0 && (r[3] - rect[3]).abs() < 1.0, "{r:?} vs {rect:?}");
    assert!(luma_spread(&img, r) > 20, "the element shot is blank at the element");
    // Nothing inside the cut gets a shot of its own.
    assert!(
        evidence.element_shots.iter().all(|s| {
            let r = rect_of(&evidence, &s.selector);
            r[1] >= shot.height || r[0] >= shot.width
        }),
        "a shot was taken for an element inside the screenshot"
    );
}

#[test]
fn a_right_to_left_page_records_where_its_screenshot_starts() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let Some((findings, evidence)) =
        scan(&engine, port, "fullpage-screenshot-rtl.html", (390, 844), &EvidenceRequest::default())
    else {
        return;
    };
    let all = flagged(&findings, &evidence);
    assert!(all.contains(&("low-contrast", "#flag-rtl-copy", origin::SCAN)), "{all:?}");
    assert!(!all.iter().any(|(_, s, _)| *s == "#pass-rtl-copy"), "{all:?}");

    // The body scrolls from the right, and the 900px grid overflows 510px
    // left of the viewport, at negative document x. The image starts there.
    let shot = evidence.screenshot.as_ref().expect("screenshot");
    assert!((shot.width - 900.0).abs() <= 16.0, "{}", shot.width);
    assert!((shot.origin_x - (390.0 - shot.width)).abs() <= 16.0, "{} {}", shot.origin_x, shot.width);
    let img = decode(&shot.jpeg_base64);
    assert_eq!(img.width() as f64, shot.width);
    let rect = rect_of(&evidence, "#flag-rtl-copy");
    assert!(rect[0] < 0.0 && rect[0] > -80.0, "{rect:?}");
    let image_x = rect[0] - shot.origin_x;
    assert!(
        luma_spread(&img, [image_x, rect[1], rect[2], rect[3]]) > 20,
        "the flagged copy is blank at its image position"
    );
    // The marker under the copy is green where the origin puts it; the rect's
    // x taken as image x lands on the other column's blue marker.
    let marker_y = (rect[1] + rect[3] + 42.0) as u32;
    let green = |p: [u8; 3]| p[1] > 90 && p[0] < 70 && p[2] < 110;
    let blue = |p: [u8; 3]| p[2] > 150 && p[0] < 90 && p[1] < 120;
    let at = |x: f64| img.get_pixel(x as u32, marker_y).0;
    assert!(green(at(image_x + 200.0)), "no green marker at the image position: {:?}", at(image_x + 200.0));
    assert!(blue(at(rect[0].max(0.0) + 200.0)), "the uncorrected position is not the other column: {:?}", at(rect[0].max(0.0) + 200.0));

    // Nothing overflows at desktop width, and a page that scrolls from the
    // left keeps its origin at 0 however wide it is.
    let Some((_, desktop)) =
        scan(&engine, port, "fullpage-screenshot-rtl.html", (1280, 800), &EvidenceRequest::default())
    else {
        return;
    };
    assert_eq!(desktop.screenshot.as_ref().expect("screenshot").origin_x, 0.0);
    let Some((_, wide)) =
        scan(&engine, port, "fullpage-screenshot.html", (390, 844), &EvidenceRequest::default())
    else {
        return;
    };
    let wide_shot = wide.screenshot.as_ref().expect("screenshot");
    assert!(wide_shot.width >= 900.0, "{}", wide_shot.width);
    assert_eq!(wide_shot.origin_x, 0.0);
}

/// A page whose inner scroller is already scrolled when it is measured (a
/// restored position), under a band that sits above the scroller. Served
/// inline: it holds no findings, so it stays out of the fixture sweeps.
const OFFSET_SCROLLER_PAGE: &str = r#"<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Offset scroller</title>
<style>
  html, body { height: 100%; margin: 0; overflow: hidden; background: #ffffff; }
  .band { height: 100px; background: #0a7d3b; }
  .frame { position: absolute; top: 100px; left: 0; right: 0; bottom: 0; overflow: auto; }
  .content { height: 3000px; background: #ffffff; }
</style></head>
<body>
  <div class="band"></div>
  <div class="frame" id="frame"><div class="content"></div></div>
  <script>document.getElementById('frame').scrollTop = 600;</script>
</body></html>"#;

#[test]
fn a_scroller_measured_mid_scroll_keeps_the_band_above_it() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let options = ScanOptions {
        viewport: Some((1280, 800)),
        ..Default::default()
    };
    let mut browser = engine.launch().expect("launch");
    let url = format!("http://127.0.0.1:{port}/offset-scroller.html");
    let (_, evidence) = detect_url_evidence(&mut browser, &url, &options, "load", 100, &EvidenceRequest::default())
        .expect("evidence scan");
    browser.close();
    let shot = evidence.screenshot.as_ref().expect("screenshot");
    assert_eq!(shot.method, impeccable_browser::fullpage::method::STITCHED);
    let img = decode(&shot.jpeg_base64);
    // The band is the image's first hundred rows, as the rects measured it.
    let p = img.get_pixel(40, 50).0;
    assert!(p[1] > 90 && p[0] < 60, "band rows are not where they were measured: {p:?}");
}

/// A 100vh app shell that scrolls its own frame inside the body's default
/// 8px margin, so the document is 16px taller than the viewport. Served
/// inline, like the offset scroller.
const MARGIN_SHELL_PAGE: &str = r#"<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Margin shell</title>
<style>
  body { background: #ffffff; }
  .shell { height: 100vh; overflow: auto; }
  .content { height: 3000px; background: #ffffff; }
  .marker { height: 60px; background: #0a7d3b; }
</style></head>
<body>
  <div class="shell"><div class="content"></div><div class="marker"></div><div style="height: 200px"></div></div>
</body></html>"#;

#[test]
fn a_shell_inside_a_body_margin_is_captured_by_scrolling_the_shell() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let options = ScanOptions {
        viewport: Some((1280, 800)),
        ..Default::default()
    };
    let mut browser = engine.launch().expect("launch");
    let url = format!("http://127.0.0.1:{port}/margin-shell.html");
    let (_, evidence) = detect_url_evidence(&mut browser, &url, &options, "load", 100, &EvidenceRequest::default())
        .expect("evidence scan");
    browser.close();
    let shot = evidence.screenshot.as_ref().expect("screenshot");
    assert_eq!(shot.method, impeccable_browser::fullpage::method::STITCHED);
    assert!(shot.height > 3000.0, "{}", shot.height);
    let img = decode(&shot.jpeg_base64);
    // The marker under the shell's 3000px of content, 8px down for the margin.
    let p = img.get_pixel(40, 8 + 3000 + 30).0;
    assert!(p[1] > 90 && p[0] < 60 && p[2] < 110, "the marker below the fold is missing: {p:?}");
}

/// A 100vh app shell that scrolls its own frame, with a footer below it, so
/// the document scrolls the footer's height: under a quarter viewport, so
/// the frame is captured, and the footer has to follow the frame's content.
/// Served inline, like the margin shell.
const SHELL_FOOTER_PAGE: &str = r#"<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Shell footer</title>
<style>
  body { margin: 0; background: #ffffff; }
  .shell { height: 100vh; overflow: auto; }
  .content { height: 3000px; background: #ffffff; }
  .footer { height: 150px; background: #0a7d3b; }
</style></head>
<body>
  <div class="shell"><div class="content"></div></div>
  <div class="footer"></div>
</body></html>"#;

#[test]
fn a_footer_under_a_scrolled_shell_reaches_the_screenshot() {
    let Some(engine) = engine() else { return };
    let port = serve_page(SHELL_FOOTER_PAGE);
    let options = ScanOptions {
        viewport: Some((1280, 800)),
        ..Default::default()
    };
    let mut browser = engine.launch().expect("launch");
    let url = format!("http://127.0.0.1:{port}/");
    let (_, evidence) = detect_url_evidence(&mut browser, &url, &options, "load", 100, &EvidenceRequest::default())
        .expect("evidence scan");
    browser.close();
    let shot = evidence.screenshot.as_ref().expect("screenshot");
    assert_eq!(shot.method, impeccable_browser::fullpage::method::STITCHED);
    assert!(shot.height >= 3140.0, "{}", shot.height);
    let img = decode(&shot.jpeg_base64);
    // The shell's content is white to its foot; the footer follows it.
    let p = img.get_pixel(40, 2900).0;
    assert!(p[0] > 200 && p[1] > 200, "the shell's content is not white: {p:?}");
    let p = img.get_pixel(40, 3075).0;
    assert!(p[1] > 90 && p[0] < 60 && p[2] < 110, "the footer below the shell is missing: {p:?}");
}

fn serve_page(body: &'static str) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        // One thread per connection, so an idle connection the browser opens
        // ahead of its request never holds up the one that asks.
        for mut stream in listener.incoming().flatten() {
            std::thread::spawn(move || {
                let mut buf = [0u8; 8192];
                let _ = stream.read(&mut buf);
                let head = format!(
                    "HTTP/1.0 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = stream.write_all(head.as_bytes());
                let _ = stream.write_all(body.as_bytes());
            });
        }
    });
    port
}

fn scan_page(
    engine: &BrowserEngine,
    body: &'static str,
    viewport: (u32, u32),
    request: &EvidenceRequest,
) -> (Vec<Finding>, Evidence) {
    let port = serve_page(body);
    let options = ScanOptions {
        viewport: Some(viewport),
        ..Default::default()
    };
    let mut browser = engine.launch().expect("launch");
    let url = format!("http://127.0.0.1:{port}/");
    let out = detect_url_evidence(&mut browser, &url, &options, "load", 100, request)
        .expect("evidence scan");
    browser.close();
    out
}

/// The share of the pixels inside `rect` that `is` matches.
fn share(img: &image::RgbImage, rect: [f64; 4], is: impl Fn([u8; 3]) -> bool) -> f64 {
    let x0 = rect[0].max(0.0) as u32;
    let y0 = rect[1].max(0.0) as u32;
    let x1 = ((rect[0] + rect[2]) as u32).min(img.width());
    let y1 = ((rect[1] + rect[3]) as u32).min(img.height());
    let (mut hit, mut all) = (0usize, 0usize);
    for y in y0..y1 {
        for x in x0..x1 {
            all += 1;
            if is(img.get_pixel(x, y).0) {
                hit += 1;
            }
        }
    }
    hit as f64 / all.max(1) as f64
}

/// A phone page with a fixed sheet over the lower two thirds of the
/// viewport (theguardian.com's support appeal, round 13 row 21), and small
/// print far past the screenshot's cut.
const COVER_SHEET_PAGE: &str = r#"<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Fixed sheet</title>
<style>
  body { margin: 0; background: #ffffff; color: #111111; font: 16px/1.5 Arial, sans-serif; }
  .spacer { height: 4000px; background: repeating-linear-gradient(45deg, #dfe6ee 0 12px, #c3cfdc 12px 24px); }
  .tiny { margin: 40px 20px; width: 300px; height: 60px; font-size: 9px; color: #222222; background: #ffffff; }
  .sheet { position: fixed; left: 0; right: 0; top: 30%; bottom: 0; z-index: 40; background: #d00000; color: #ffffff; }
</style></head><body>
<h1>A long read</h1>
<div class="spacer"></div>
<p class="tiny" id="under-sheet">Small print far down a long page, under the sheet when scrolled to.</p>
<div class="spacer" style="height: 1200px"></div>
<aside class="sheet"><p>Support our journalism</p></aside>
</body></html>"#;

/// The same small print over a fixed backdrop painted under the page.
const FIXED_BACKDROP_PAGE: &str = r#"<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Fixed backdrop</title>
<style>
  body { margin: 0; background: #ffffff; color: #111111; font: 16px/1.5 Arial, sans-serif; }
  .backdrop { position: fixed; inset: 0; z-index: -1; background: #2050c0; }
  .spacer { height: 4000px; }
  .tiny { margin: 40px 20px; width: 300px; height: 60px; font-size: 9px; color: #222222; }
</style></head><body>
<div class="backdrop"></div>
<h1>A long read</h1>
<div class="spacer"></div>
<p class="tiny" id="over-backdrop">Small print far down a long page, over the fixed backdrop.</p>
<div class="spacer" style="height: 1200px"></div>
</body></html>"#;

fn element_shot<'a>(evidence: &'a Evidence, selector: &str) -> &'a impeccable_browser::fullpage::ElementShot {
    evidence
        .element_shots
        .iter()
        .find(|s| s.selector == selector)
        .unwrap_or_else(|| panic!("no shot for {selector}: {:?}", evidence.element_rects.keys()))
}

#[test]
fn an_element_shot_hides_the_fixed_sheet_over_the_element() {
    let Some(engine) = engine() else { return };
    let request = EvidenceRequest {
        max_screenshot_height: 1500.0,
        ..EvidenceRequest::default()
    };
    let (findings, evidence) = scan_page(&engine, COVER_SHEET_PAGE, (390, 844), &request);
    let all = flagged(&findings, &evidence);
    assert!(all.iter().any(|(_, s, _)| *s == "#under-sheet"), "{all:?}");
    let shot = element_shot(&evidence, "#under-sheet");
    let img = decode(&shot.jpeg_base64);
    let red = share(&img, shot.rect, |p| p[0] > 170 && p[1] < 70 && p[2] < 70);
    assert!(red < 0.2, "the sheet covers the element in its shot: {red}");
    let white = share(&img, shot.rect, |p| p[0] > 230 && p[1] > 230 && p[2] > 230);
    assert!(white > 0.5, "the element's own white box is missing: {white}");
    assert_eq!(shot.hidden_covers, vec!["aside.sheet".to_string()]);
}

#[test]
fn an_element_shot_keeps_a_fixed_backdrop_under_the_element() {
    let Some(engine) = engine() else { return };
    let request = EvidenceRequest {
        max_screenshot_height: 1500.0,
        ..EvidenceRequest::default()
    };
    let (findings, evidence) = scan_page(&engine, FIXED_BACKDROP_PAGE, (390, 844), &request);
    let all = flagged(&findings, &evidence);
    assert!(all.iter().any(|(_, s, _)| *s == "#over-backdrop"), "{all:?}");
    let shot = element_shot(&evidence, "#over-backdrop");
    let img = decode(&shot.jpeg_base64);
    let blue = share(&img, shot.rect, |p| p[2] > 150 && p[0] < 80 && p[1] < 120);
    assert!(blue > 0.5, "the backdrop under the element was hidden: {blue}");
}

/// A page that relays itself for the capture and comes back (round 13 row
/// 23: developer.apple.com folds its navigator at the capture's 1x1 resize
/// and slides its column back over about 330ms). Chromium dispatches that
/// 1x1 resize on some pages and not on a minimal one, but the capture's
/// closing resize reaches every page: this one folds its column at any
/// resize and slides it back over 400ms, so the probe right after the
/// capture sees the column moving and then settling where it was. Its
/// section bar under a header that scrolls away sticks from the second tile
/// on, and a second bar further down sticks only on a later tile; the
/// stitched image shows each once, where it sits.
const RELAYOUT_PAGE: &str = r#"<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Relayout</title>
<style>
  body { margin: 0; background: #ffffff; }
  .main { margin-left: 400px; transition: margin-left 0.4s linear; }
  .folded .main { margin-left: 0; transition: none; }
  .block { width: 300px; height: 300px; background: #0a7d3b; }
  .row { height: 200px; background: #e8e8e8; margin-top: 20px; }
  .tall { height: 1500px; }
  .head { height: 60px; background: #ffffff; }
  .bar { position: sticky; top: 0; height: 50px; background: #d00000; }
  .later { position: sticky; top: 0; height: 50px; background: #0030d0; }
  .third { position: sticky; top: 64px; height: 50px; background: #8000c0; }
  .fourth { position: sticky; top: 0; height: 50px; background: #ff8c00; }
  .section { height: 4000px; }
</style></head><body>
<div class="head"></div><div class="bar"></div>
<div class="main"><div class="block"></div><div class="row"></div><div class="row"></div><div class="tall"></div></div>
<div class="section"><div class="later"></div><div style="height: 820px"></div><div class="third"></div></div>
<div style="height: 50px"></div><div class="section" style="height: 1000px"><div class="fourth"></div></div>
<script>
  addEventListener('resize', () => {
    document.body.classList.add('folded');
    requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove('folded')));
  });
</script>
</body></html>"#;

/// The twin: a column that never stops moving (a marquee on `margin-left`)
/// is in motion whatever the capture does, never settles back, and keeps its
/// beyond-viewport capture.
const TICKER_PAGE: &str = r#"<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Ticker</title>
<style>
  body { margin: 0; background: #ffffff; }
  .main { margin-left: 400px; animation: fold 0.7s linear infinite; }
  @keyframes fold { from { margin-left: 400px; } to { margin-left: 0px; } }
  .block { width: 300px; height: 300px; background: #0a7d3b; }
  .row { height: 200px; background: #e8e8e8; margin-top: 20px; }
  .tall { height: 6000px; }
</style></head><body>
<div class="main"><div class="block"></div><div class="row"></div><div class="row"></div><div class="tall"></div></div>
</body></html>"#;

/// The twin: a page that moves only by transform (a carousel) and answers no
/// resize keeps its beyond-viewport capture.
const SLIDING_PAGE: &str = r#"<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Sliding</title>
<style>
  body { margin: 0; background: #ffffff; }
  .main { margin-left: 400px; }
  .block { width: 300px; height: 300px; background: #0a7d3b; animation: slide 0.8s linear infinite alternate; }
  @keyframes slide { from { transform: translateX(0); } to { transform: translateX(200px); } }
  .row { height: 200px; background: #e8e8e8; margin-top: 20px; }
  .tall { height: 3000px; }
</style></head><body>
<div class="main"><div class="block"></div><div class="row"></div><div class="row"></div><div class="tall"></div></div>
</body></html>"#;

#[test]
fn a_page_that_relays_itself_for_the_capture_is_stitched() {
    let Some(engine) = engine() else { return };
    let (_, evidence) = scan_page(&engine, RELAYOUT_PAGE, (1280, 800), &EvidenceRequest::default());
    let shot = evidence.screenshot.as_ref().expect("screenshot");
    assert_eq!(shot.method, impeccable_browser::fullpage::method::STITCHED);
    assert_eq!(shot.height, shot.document_height);
    let img = decode(&shot.jpeg_base64);
    let green = |p: [u8; 3]| p[1] > 100 && p[0] < 40 && p[2] < 90;
    // The column is back at x 400 in every tile.
    assert!(share(&img, [420.0, 130.0, 260.0, 220.0], green) > 0.9, "the block is not at rest");
    assert!(share(&img, [20.0, 130.0, 360.0, 220.0], green) < 0.05, "the block is folded left");
    let red = |p: [u8; 3]| p[0] > 170 && p[1] < 70 && p[2] < 70;
    let blue = |p: [u8; 3]| p[2] > 150 && p[0] < 60 && p[1] < 90;
    assert!(share(&img, [0.0, 65.0, 1280.0, 40.0], red) > 0.9, "the bar is missing where it sits");
    let later_top = 60.0 + 50.0 + 300.0 + 2.0 * 220.0 + 1500.0;
    assert!(share(&img, [0.0, later_top + 5.0, 1280.0, 40.0], blue) > 0.9, "the later bar is missing where it sits");
    // A bar whose section starts 20px into a tile sticks at 64px there: that
    // tile is the only one that paints it, so it stays (it shows 44px low).
    let purple = |p: [u8; 3]| p[0] > 90 && p[0] < 170 && p[1] < 50 && p[2] > 150;
    let third_tile = 4.0 * 800.0;
    assert_eq!(later_top + 50.0 + 820.0, third_tile + 20.0);
    assert!(share(&img, [0.0, third_tile + 69.0, 1280.0, 40.0], purple) > 0.9, "the bar stuck on its own tile is missing");
    // A bar that sits at its offset only because its section starts on a
    // tile's top edge is in place there, not stuck, and stays.
    let orange = |p: [u8; 3]| p[0] > 220 && p[1] > 100 && p[1] < 180 && p[2] < 60;
    let fourth_top = later_top + 4000.0 + 50.0;
    assert_eq!(fourth_top, 8.0 * 800.0);
    assert!(share(&img, [0.0, fourth_top + 5.0, 1280.0, 40.0], orange) > 0.9, "the bar on a tile edge is missing");
    let tiles = (shot.height / 800.0).ceil() as usize;
    for tile in 1..tiles {
        let top = tile as f64 * 800.0;
        if (top - later_top).abs() < 60.0 || (top - fourth_top).abs() < 60.0 {
            continue;
        }
        let row = [0.0, top + 5.0, 1280.0, 40.0];
        assert!(share(&img, row, red) < 0.1, "the stuck bar repeats on tile {tile}");
        assert!(share(&img, row, blue) < 0.1, "the later bar repeats on tile {tile}");
        if top > third_tile {
            assert!(share(&img, [0.0, top + 69.0, 1280.0, 40.0], purple) < 0.1, "the third bar repeats on tile {tile}");
        }
    }
}

#[test]
fn a_page_that_never_stops_moving_keeps_its_beyond_viewport_capture() {
    let Some(engine) = engine() else { return };
    let (_, evidence) = scan_page(&engine, TICKER_PAGE, (1280, 800), &EvidenceRequest::default());
    let shot = evidence.screenshot.as_ref().expect("screenshot");
    assert_eq!(shot.method, impeccable_browser::fullpage::method::BEYOND_VIEWPORT);
}

#[test]
fn a_page_that_only_slides_keeps_its_beyond_viewport_capture() {
    let Some(engine) = engine() else { return };
    let (_, evidence) = scan_page(&engine, SLIDING_PAGE, (1280, 800), &EvidenceRequest::default());
    let shot = evidence.screenshot.as_ref().expect("screenshot");
    assert_eq!(shot.method, impeccable_browser::fullpage::method::BEYOND_VIEWPORT);
}

fn shot_of(engine: &BrowserEngine, page: &'static str, selector: &str) -> (image::RgbImage, impeccable_browser::fullpage::ElementShot) {
    let request = EvidenceRequest {
        max_screenshot_height: 1500.0,
        ..EvidenceRequest::default()
    };
    let (findings, evidence) = scan_page(engine, page, (390, 844), &request);
    let all = flagged(&findings, &evidence);
    assert!(all.iter().any(|(_, s, _)| *s == selector), "{all:?}");
    let shot = element_shot(&evidence, selector).clone();
    (decode(&shot.jpeg_base64), shot)
}

fn red(p: [u8; 3]) -> bool {
    p[0] > 170 && p[1] < 70 && p[2] < 70
}

fn blue(p: [u8; 3]) -> bool {
    p[2] > 150 && p[0] < 80 && p[1] < 120
}

/// Light small print in a content layer that takes no pointer events, over a
/// fixed backdrop the page lets take the pointer (a WebGL canvas behind
/// content). Made hit-testable for the walk, the element is listed above the
/// backdrop, so nothing covers it and the backdrop under it stays in its shot.
const POINTERLESS_OVER_BACKDROP_PAGE: &str = r#"<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Pointerless</title>
<style>
  body { margin: 0; color: #111111; font: 16px/1.5 Arial, sans-serif; }
  .backdrop { position: fixed; inset: 0; z-index: 0; background: #2050c0; }
  .wrap { position: relative; z-index: 1; pointer-events: none; }
  .spacer { height: 4000px; }
  .tiny { margin: 40px 20px; width: 300px; height: 60px; font-size: 9px; color: #eeeeee; }
</style></head><body>
<div class="backdrop"></div>
<div class="wrap"><h1>A long read</h1><div class="spacer"></div>
<p class="tiny" id="pointerless">Light small print in a layer that takes no pointer events.</p>
<div class="spacer" style="height: 1200px"></div></div>
</body></html>"#;

#[test]
fn an_element_shot_keeps_the_backdrop_under_an_element_the_hit_test_misses() {
    let Some(engine) = engine() else { return };
    let (img, shot) = shot_of(&engine, POINTERLESS_OVER_BACKDROP_PAGE, "#pointerless");
    let b = share(&img, shot.rect, blue);
    assert!(b > 0.5, "the backdrop under the element was hidden: {b}");
    assert!(shot.hidden_covers.is_empty(), "{:?}", shot.hidden_covers);
}

/// A card whose content takes no pointer events, so a link stretched over
/// the card gets them (theguardian.com's cards), under a fixed sheet. The
/// hit test never lists the content on its own, yet the sheet is over it.
const POINTERLESS_UNDER_SHEET_PAGE: &str = r#"<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Pointerless card</title>
<style>
  body { margin: 0; background: #ffffff; color: #111111; font: 16px/1.5 Arial, sans-serif; }
  .spacer { height: 4000px; }
  .card { position: relative; margin: 40px 20px; width: 300px; }
  .card .content { pointer-events: none; }
  .card a { position: absolute; inset: 0; z-index: 1; }
  .tiny { margin: 0; width: 300px; height: 60px; font-size: 9px; color: #222222; background: #ffffff; }
  .sheet { position: fixed; left: 0; right: 0; top: 30%; bottom: 0; z-index: 40; background: #d00000; color: #ffffff; }
</style></head><body>
<h1>A long read</h1>
<div class="spacer"></div>
<div class="card"><div class="content"><p class="tiny" id="card-print">Small print in a card a link covers.</p></div><a href="/story" aria-label="Read the story"></a></div>
<div class="spacer" style="height: 1200px"></div>
<aside class="sheet"><p>Support our journalism</p></aside>
</body></html>"#;

#[test]
fn an_element_shot_hides_the_fixed_sheet_over_content_the_hit_test_misses() {
    let Some(engine) = engine() else { return };
    let (img, shot) = shot_of(&engine, POINTERLESS_UNDER_SHEET_PAGE, "#card-print");
    let r = share(&img, shot.rect, red);
    assert!(r < 0.2, "the sheet covers the element in its shot: {r}");
    assert_eq!(shot.hidden_covers, vec!["aside.sheet".to_string()]);
}

/// A fixed box inside a transformed wrapper scrolls with the page: it is
/// content placed over the element, not chrome following the viewport.
const CONTAINED_FIXED_PAGE: &str = r#"<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Contained</title>
<style>
  body { margin: 0; background: #ffffff; color: #111111; font: 16px/1.5 Arial, sans-serif; }
  .wrap { position: relative; transform: translateZ(0); }
  .spacer { height: 4000px; }
  .tiny { margin: 40px 20px; width: 300px; height: 60px; font-size: 9px; color: #222222; background: #ffffff; }
  .card { position: fixed; left: 0; right: 0; top: 4000px; height: 200px; z-index: 40; background: #d00000; }
</style></head><body>
<div class="wrap"><h1>A long read</h1><div class="spacer"></div>
<p class="tiny" id="under-card">Small print under a card that scrolls with the page.</p>
<div class="spacer" style="height: 1200px"></div>
<div class="card"></div></div>
</body></html>"#;

#[test]
fn an_element_shot_keeps_a_fixed_box_that_scrolls_along() {
    let Some(engine) = engine() else { return };
    let (img, shot) = shot_of(&engine, CONTAINED_FIXED_PAGE, "#under-card");
    let r = share(&img, shot.rect, red);
    assert!(r > 0.8, "the card over the element was hidden: {r}");
    assert!(shot.hidden_covers.is_empty(), "{:?}", shot.hidden_covers);
}

/// Two flagged elements one viewport shows together, and a fixed bar over
/// the lower 15% of the viewport: the shot centred on the first leaves the
/// second under the bar, so the second gets a tile of its own with the bar
/// hidden instead of sharing the first one's.
const SHARED_TILE_PAGE: &str = r#"<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Shared tile</title>
<style>
  body { margin: 0; background: #ffffff; color: #111111; font: 16px/1.5 Arial, sans-serif; }
  .spacer { height: 4000px; }
  .tiny { margin: 0 20px; width: 300px; height: 60px; font-size: 9px; color: #222222; background: #ffffff; }
  .gap { height: 240px; }
  .bar { position: fixed; left: 0; right: 0; top: 85%; bottom: 0; z-index: 40; background: #d00000; }
</style></head><body>
<h1>A long read</h1><div class="spacer"></div>
<p class="tiny" id="a-clear">Small print the bar leaves clear.</p>
<div class="gap"></div>
<p class="tiny" id="b-under-bar">Small print the bar covers when the first is centred.</p>
<div class="spacer" style="height: 1200px"></div>
<div class="bar"></div>
</body></html>"#;

#[test]
fn a_shared_tile_serves_only_elements_no_shown_layer_covers() {
    let Some(engine) = engine() else { return };
    let request = EvidenceRequest {
        max_screenshot_height: 1500.0,
        ..EvidenceRequest::default()
    };
    let (_, evidence) = scan_page(&engine, SHARED_TILE_PAGE, (390, 844), &request);
    let a = element_shot(&evidence, "#a-clear");
    let b = element_shot(&evidence, "#b-under-bar");
    for shot in [a, b] {
        let img = decode(&shot.jpeg_base64);
        let r = share(&img, shot.rect, red);
        assert!(r < 0.2, "the bar covers {} in its shot: {r}", shot.selector);
    }
    assert!(a.hidden_covers.is_empty(), "{:?}", a.hidden_covers);
    assert_eq!(b.hidden_covers, vec!["div.bar".to_string()]);
    assert_ne!(a.jpeg_base64, b.jpeg_base64, "the second element reused the first one's tile");
}

/// An open modal dialog over the element: a visitor sees it, so the shot
/// keeps it.
const MODAL_PAGE: &str = r#"<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Modal</title>
<style>
  body { margin: 0; background: #ffffff; color: #111111; font: 16px/1.5 Arial, sans-serif; }
  .spacer { height: 4000px; }
  .tiny { margin: 40px 20px; width: 300px; height: 60px; font-size: 9px; color: #222222; background: #ffffff; }
  dialog { width: 100vw; height: 100vh; max-width: none; max-height: none; margin: 0; padding: 0; border: 0; background: #d00000; }
</style></head><body>
<h1>A long read</h1><div class="spacer"></div>
<p class="tiny" id="under-modal">Small print under an open modal.</p>
<div class="spacer" style="height: 1200px"></div>
<dialog id="modal"><p>Subscribe</p></dialog>
<script>document.getElementById('modal').showModal();</script>
</body></html>"#;

/// An `aria-modal` dialog laid out normally inside a fixed backdrop: the
/// backdrop is the fixed layer the walk meets, and it holds the modal.
const WRAPPED_MODAL_PAGE: &str = r#"<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Wrapped modal</title>
<style>
  body { margin: 0; background: #ffffff; color: #111111; font: 16px/1.5 Arial, sans-serif; }
  .spacer { height: 4000px; }
  .tiny { margin: 40px 20px; width: 300px; height: 60px; font-size: 9px; color: #222222; background: #ffffff; }
  .backdrop { position: fixed; inset: 0; z-index: 50; background: #d00000; }
  .panel { margin: 20px; height: 80px; background: #2050c0; }
</style></head><body>
<h1>A long read</h1><div class="spacer"></div>
<p class="tiny" id="under-wrapped-modal">Small print under an open modal.</p>
<div class="spacer" style="height: 1200px"></div>
<div class="backdrop"><div class="panel" role="dialog" aria-modal="true">Subscribe</div></div>
</body></html>"#;

#[test]
fn an_element_shot_keeps_a_modal_wrapped_in_a_fixed_backdrop() {
    let Some(engine) = engine() else { return };
    let request = EvidenceRequest {
        max_screenshot_height: 1500.0,
        ..EvidenceRequest::default()
    };
    let (_, evidence) = scan_page(&engine, WRAPPED_MODAL_PAGE, (390, 844), &request);
    let Some(shot) = evidence.element_shots.iter().find(|s| s.selector == "#under-wrapped-modal") else {
        return;
    };
    assert!(shot.hidden_covers.is_empty(), "{:?}", shot.hidden_covers);
    let img = decode(&shot.jpeg_base64);
    let r = share(&img, shot.rect, red);
    assert!(r > 0.8, "the modal's backdrop was hidden: {r}");
}

/// The twin: a fixed sheet holding a modal panel the page has not opened
/// (a cookie banner's preferences) is still a cover.
const SHEET_WITH_CLOSED_MODAL_PAGE: &str = r#"<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Closed modal</title>
<style>
  body { margin: 0; background: #ffffff; color: #111111; font: 16px/1.5 Arial, sans-serif; }
  .spacer { height: 4000px; }
  .tiny { margin: 40px 20px; width: 300px; height: 60px; font-size: 9px; color: #222222; background: #ffffff; }
  .sheet { position: fixed; left: 0; right: 0; top: 30%; bottom: 0; z-index: 40; background: #d00000; color: #ffffff; }
  .prefs { display: none; }
</style></head><body>
<h1>A long read</h1><div class="spacer"></div>
<p class="tiny" id="under-banner">Small print under a banner with a closed panel.</p>
<div class="spacer" style="height: 1200px"></div>
<aside class="sheet"><p>Cookies</p><div class="prefs" role="dialog" aria-modal="true">Preferences</div></aside>
</body></html>"#;

#[test]
fn an_element_shot_hides_a_sheet_whose_modal_is_closed() {
    let Some(engine) = engine() else { return };
    let (img, shot) = shot_of(&engine, SHEET_WITH_CLOSED_MODAL_PAGE, "#under-banner");
    let r = share(&img, shot.rect, red);
    assert!(r < 0.2, "the banner covers the element in its shot: {r}");
    assert_eq!(shot.hidden_covers, vec!["aside.sheet".to_string()]);
}

#[test]
fn an_element_shot_keeps_an_open_modal() {
    let Some(engine) = engine() else { return };
    let request = EvidenceRequest {
        max_screenshot_height: 1500.0,
        ..EvidenceRequest::default()
    };
    let (_, evidence) = scan_page(&engine, MODAL_PAGE, (390, 844), &request);
    let Some(shot) = evidence.element_shots.iter().find(|s| s.selector == "#under-modal") else {
        // The scan may report nothing under a modal; then there is no shot.
        return;
    };
    assert!(shot.hidden_covers.is_empty(), "{:?}", shot.hidden_covers);
    let img = decode(&shot.jpeg_base64);
    let r = share(&img, shot.rect, red);
    assert!(r > 0.8, "the open modal was hidden: {r}");
}
