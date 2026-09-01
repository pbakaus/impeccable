//! JS: skill/scripts/lib/raster.mjs
//!
//! Small RGBA raster toolkit: create, crop, resize (area-averaging down,
//! bilinear up), composite, fills, rectangles, and a 5x7 bitmap-font label.
//! An image is `{ width, height, data }` with RGBA8 data.

use crate::jsnum::{round, u8w};

/// RGBA8 raster. `data.len() == width * height * 4`.
#[derive(Clone, Debug)]
pub struct Image {
    pub width: usize,
    pub height: usize,
    pub data: Vec<u8>,
}

impl Image {
    #[inline]
    pub fn new(width: usize, height: usize) -> Self {
        Image { width, height, data: vec![0u8; width * height * 4] }
    }
}

/// JS: createImage(width, height, fill=[0,0,0,0]).
pub fn create_image(width: usize, height: usize, fill: [u8; 4]) -> Image {
    let mut img = Image::new(width, height);
    if fill[0] != 0 || fill[1] != 0 || fill[2] != 0 || fill[3] != 0 {
        let mut i = 0;
        while i < img.data.len() {
            img.data[i] = fill[0];
            img.data[i + 1] = fill[1];
            img.data[i + 2] = fill[2];
            img.data[i + 3] = fill[3];
            i += 4;
        }
    }
    img
}

pub struct Rect {
    pub x: usize,
    pub y: usize,
    pub w: usize,
    pub h: usize,
}

/// JS: clampRect. Rounds then clamps to image bounds; returns a non-negative box.
pub fn clamp_rect(img: &Image, x: f64, y: f64, w: f64, h: f64) -> Rect {
    let iw = img.width as f64;
    let ih = img.height as f64;
    let x0 = 0f64.max(iw.min(round(x)));
    let y0 = 0f64.max(ih.min(round(y)));
    let x1 = x0.max(iw.min(round(x + w)));
    let y1 = y0.max(ih.min(round(y + h)));
    Rect { x: x0 as usize, y: y0 as usize, w: (x1 - x0) as usize, h: (y1 - y0) as usize }
}

/// JS: crop(img, x, y, w, h).
pub fn crop(img: &Image, x: f64, y: f64, w: f64, h: f64) -> Image {
    let r = clamp_rect(img, x, y, w, h);
    let mut out = Image::new(r.w.max(1), r.h.max(1));
    for yy in 0..r.h {
        let src = ((r.y + yy) * img.width + r.x) * 4;
        let dst = yy * out.width * 4;
        out.data[dst..dst + r.w * 4].copy_from_slice(&img.data[src..src + r.w * 4]);
    }
    out
}

/// JS: resize(img, width, height). Area averaging shrinking, bilinear growing.
pub fn resize(img: &Image, width: f64, height: f64) -> Image {
    let width = (1f64.max(round(width))) as usize;
    let height = (1f64.max(round(height))) as usize;
    if width == img.width && height == img.height {
        return img.clone();
    }
    let mut out = Image::new(width, height);
    let sx = img.width as f64 / width as f64;
    let sy = img.height as f64 / height as f64;
    if sx >= 1.0 && sy >= 1.0 {
        for y in 0..height {
            let y0 = (y as f64 * sy).floor() as usize;
            let y1 = (img.height).min((y0 + 1).max(((y + 1) as f64 * sy).floor() as usize));
            for x in 0..width {
                let x0 = (x as f64 * sx).floor() as usize;
                let x1 = (img.width).min((x0 + 1).max(((x + 1) as f64 * sx).floor() as usize));
                let (mut r, mut g, mut b, mut a) = (0f64, 0f64, 0f64, 0f64);
                let mut n = 0f64;
                for yy in y0..y1 {
                    let mut p = (yy * img.width + x0) * 4;
                    for _xx in x0..x1 {
                        r += img.data[p] as f64;
                        g += img.data[p + 1] as f64;
                        b += img.data[p + 2] as f64;
                        a += img.data[p + 3] as f64;
                        n += 1.0;
                        p += 4;
                    }
                }
                let o = (y * width + x) * 4;
                out.data[o] = u8w(r / n);
                out.data[o + 1] = u8w(g / n);
                out.data[o + 2] = u8w(b / n);
                out.data[o + 3] = u8w(a / n);
            }
        }
        return out;
    }
    for y in 0..height {
        let fy = ((img.height - 1) as f64).min((y as f64 + 0.5) * sy - 0.5);
        let y0 = 0f64.max(fy.floor()) as usize;
        let y1 = (img.height - 1).min(y0 + 1);
        let wy = fy - y0 as f64;
        for x in 0..width {
            let fx = ((img.width - 1) as f64).min((x as f64 + 0.5) * sx - 0.5);
            let x0 = 0f64.max(fx.floor()) as usize;
            let x1 = (img.width - 1).min(x0 + 1);
            let wx = fx - x0 as f64;
            let o = (y * width + x) * 4;
            for c in 0..4 {
                let p00 = img.data[(y0 * img.width + x0) * 4 + c] as f64;
                let p10 = img.data[(y0 * img.width + x1) * 4 + c] as f64;
                let p01 = img.data[(y1 * img.width + x0) * 4 + c] as f64;
                let p11 = img.data[(y1 * img.width + x1) * 4 + c] as f64;
                let v = (p00 * (1.0 - wx) + p10 * wx) * (1.0 - wy)
                    + (p01 * (1.0 - wx) + p11 * wx) * wy;
                out.data[o + c] = u8w(v);
            }
        }
    }
    out
}

/// JS: fit(img, maxW, maxH, allowUpscale=false).
pub fn fit(img: &Image, max_w: f64, max_h: f64, allow_upscale: bool) -> Image {
    let s = (max_w / img.width as f64).min(max_h / img.height as f64);
    if s >= 1.0 && !allow_upscale {
        return img.clone();
    }
    resize(img, img.width as f64 * s, img.height as f64 * s)
}

/// JS: blit(dst, src, x, y). Alpha-composite src onto dst.
pub fn blit(dst: &mut Image, src: &Image, x: f64, y: f64) {
    let x = round(x) as i64;
    let y = round(y) as i64;
    for yy in 0..src.height as i64 {
        let dy = y + yy;
        if dy < 0 || dy >= dst.height as i64 {
            continue;
        }
        for xx in 0..src.width as i64 {
            let dx = x + xx;
            if dx < 0 || dx >= dst.width as i64 {
                continue;
            }
            let s = ((yy as usize) * src.width + xx as usize) * 4;
            let d = ((dy as usize) * dst.width + dx as usize) * 4;
            let a = src.data[s + 3] as f64 / 255.0;
            if a >= 1.0 {
                dst.data[d] = src.data[s];
                dst.data[d + 1] = src.data[s + 1];
                dst.data[d + 2] = src.data[s + 2];
                dst.data[d + 3] = 255;
                continue;
            }
            if a <= 0.0 {
                continue;
            }
            let da = dst.data[d + 3] as f64 / 255.0;
            let oa = a + da * (1.0 - a);
            for c in 0..3 {
                let v = (src.data[s + c] as f64 * a + dst.data[d + c] as f64 * da * (1.0 - a))
                    / if oa != 0.0 { oa } else { 1.0 };
                dst.data[d + c] = u8w(v);
            }
            dst.data[d + 3] = u8w(oa * 255.0);
        }
    }
}

/// JS: fillRect(img, x, y, w, h, rgba). rgba is [r,g,b] or [r,g,b,a].
pub fn fill_rect(img: &mut Image, x: f64, y: f64, w: f64, h: f64, rgba: [f64; 4]) {
    let r = clamp_rect(img, x, y, w, h);
    let a = rgba[3] / 255.0;
    for yy in r.y..r.y + r.h {
        for xx in r.x..r.x + r.w {
            let o = (yy * img.width + xx) * 4;
            if a >= 1.0 {
                img.data[o] = u8w(rgba[0]);
                img.data[o + 1] = u8w(rgba[1]);
                img.data[o + 2] = u8w(rgba[2]);
                img.data[o + 3] = 255;
            } else {
                for c in 0..3 {
                    img.data[o + c] = u8w(rgba[c] * a + img.data[o + c] as f64 * (1.0 - a));
                }
                img.data[o + 3] = u8w((img.data[o + 3] as f64).max(a * 255.0));
            }
        }
    }
}

/// A [r,g,b] fill (alpha defaults to 255, as JS `rgba[3] ?? 255`).
#[inline]
pub fn rgb(c: [u8; 3]) -> [f64; 4] {
    [c[0] as f64, c[1] as f64, c[2] as f64, 255.0]
}

/// JS: strokeRect(img, x, y, w, h, rgba, thickness=2).
pub fn stroke_rect(img: &mut Image, x: f64, y: f64, w: f64, h: f64, rgba: [f64; 4], thickness: f64) {
    fill_rect(img, x, y, w, thickness, rgba);
    fill_rect(img, x, y + h - thickness, w, thickness, rgba);
    fill_rect(img, x, y, thickness, h, rgba);
    fill_rect(img, x + w - thickness, y, thickness, h, rgba);
}

/// JS: textWidth(text, scale=2).
pub fn text_width(text: &str, scale: f64) -> f64 {
    text.chars().count() as f64 * 6.0 * scale
}

/// JS: drawText(img, text, x, y, rgba, scale=2). Uppercases; unknown -> '?'.
pub fn draw_text(img: &mut Image, text: &str, x: f64, y: f64, rgba: [f64; 4], scale: f64) -> f64 {
    let mut cx = round(x);
    for ch in text.to_uppercase().chars() {
        let g = glyph(ch);
        for r in 0..7usize {
            let row = g[r].as_bytes();
            for c in 0..5usize {
                if row[c] == b'1' {
                    fill_rect(img, cx + c as f64 * scale, y + r as f64 * scale, scale, scale, rgba);
                }
            }
        }
        cx += 6.0 * scale;
    }
    cx - x
}

pub struct LabelSize {
    pub w: f64,
    pub h: f64,
}

/// JS: drawLabel(img, text, x, y, {fg, bg, scale, pad}).
pub fn draw_label(
    img: &mut Image,
    text: &str,
    x: f64,
    y: f64,
    fg: [f64; 4],
    bg: [f64; 4],
    scale: f64,
    pad: f64,
) -> LabelSize {
    let w = text_width(text, scale) + pad * 2.0;
    let h = 7.0 * scale + pad * 2.0;
    fill_rect(img, x, y, w, h, bg);
    draw_text(img, text, x + pad, y + pad, fg, scale);
    LabelSize { w, h }
}

/// The 5x7 bitmap font. Unknown chars fall back to '?', as in the JS.
fn glyph(ch: char) -> &'static [&'static str; 7] {
    match ch {
        'A' => &["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
        'B' => &["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
        'C' => &["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
        'D' => &["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
        'E' => &["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
        'F' => &["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
        'G' => &["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
        'H' => &["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
        'I' => &["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
        'J' => &["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
        'K' => &["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
        'L' => &["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
        'M' => &["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
        'N' => &["10001", "10001", "11001", "10101", "10011", "10001", "10001"],
        'O' => &["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
        'P' => &["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
        'Q' => &["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
        'R' => &["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
        'S' => &["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
        'T' => &["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
        'U' => &["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
        'V' => &["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
        'W' => &["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
        'X' => &["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
        'Y' => &["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
        'Z' => &["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
        '0' => &["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
        '1' => &["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
        '2' => &["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
        '3' => &["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
        '4' => &["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
        '5' => &["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
        '6' => &["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
        '7' => &["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
        '8' => &["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
        '9' => &["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
        ' ' => &["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
        '.' => &["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
        ':' => &["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
        '-' => &["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
        '/' => &["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
        '%' => &["11001", "11010", "00010", "00100", "01000", "01011", "10011"],
        '(' => &["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
        ')' => &["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
        '#' => &["01010", "01010", "11111", "01010", "11111", "01010", "01010"],
        '_' => &["00000", "00000", "00000", "00000", "00000", "00000", "11111"],
        '?' => &["01110", "10001", "00001", "00010", "00100", "00000", "00100"],
        '=' => &["00000", "00000", "11111", "00000", "11111", "00000", "00000"],
        '+' => &["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
        ',' => &["00000", "00000", "00000", "00000", "01100", "00100", "01000"],
        _ => &["01110", "10001", "00001", "00010", "00100", "00000", "00100"], // '?'
    }
}
