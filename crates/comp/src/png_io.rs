//! JS: skill/scripts/lib/png.mjs
//!
//! PNG decode/encode plus `loadRaster`. The JS hand-rolled a decoder/encoder
//! and shelled out to dwebp/sips/magick/convert for non-PNG formats; here the
//! `png` crate owns the codec and the `image` crate owns WebP/JPEG/GIF decode,
//! so nothing spawns a subprocess.
//!
//! `decode_png` yields RGBA8 identical to the JS decoder: every color type is
//! reduced to 8-bit RGBA (16-bit -> high byte, palette expanded, grayscale
//! broadcast to r=g=b, tRNS applied). Encoder byte-for-byte parity with JS
//! zlib is NOT a goal (a different deflate); the invariant is that decode after
//! encode round-trips the pixels, which the tests assert.

use crate::raster::Image;
use std::collections::HashMap;
use std::io::Cursor;

pub const SIGNATURE: [u8; 8] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/// JS: isPng(buf).
pub fn is_png(buf: &[u8]) -> bool {
    buf.len() > 8 && buf[..8] == SIGNATURE
}

/// A decoded raster plus any tEXt key/value pairs (JS: decodePng().text).
pub struct Decoded {
    pub image: Image,
    pub text: HashMap<String, String>,
}

/// JS: decodePng(buf) -> RGBA8.
pub fn decode_png(buf: &[u8]) -> Result<Decoded, String> {
    if !is_png(buf) {
        return Err("png: not a PNG (bad signature)".into());
    }
    let mut dec = png::Decoder::new(Cursor::new(buf));
    // EXPAND: palette -> RGB, sub-8-bit gray -> 8-bit, tRNS -> alpha.
    // STRIP_16: 16-bit -> 8-bit by keeping the high byte (JS reads line[i*2]).
    dec.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = dec.read_info().map_err(|e| format!("png: {e}"))?;
    let bufsize = reader.output_buffer_size().ok_or("png: image too large")?;
    let mut raw = vec![0u8; bufsize];
    let info = reader.next_frame(&mut raw).map_err(|e| format!("png: {e}"))?;
    let (w, h) = (info.width as usize, info.height as usize);
    raw.truncate(info.buffer_size());
    let data = to_rgba8(&raw, w, h, info.color_type);

    let mut text = HashMap::new();
    for c in &reader.info().uncompressed_latin1_text {
        text.entry(c.keyword.clone()).or_insert_with(|| c.text.clone());
    }
    Ok(Decoded { image: Image { width: w, height: h, data }, text })
}

fn to_rgba8(raw: &[u8], w: usize, h: usize, ct: png::ColorType) -> Vec<u8> {
    let n = w * h;
    let mut out = vec![0u8; n * 4];
    match ct {
        png::ColorType::Rgba => out.copy_from_slice(&raw[..n * 4]),
        png::ColorType::Rgb => {
            for i in 0..n {
                out[i * 4] = raw[i * 3];
                out[i * 4 + 1] = raw[i * 3 + 1];
                out[i * 4 + 2] = raw[i * 3 + 2];
                out[i * 4 + 3] = 255;
            }
        }
        png::ColorType::GrayscaleAlpha => {
            for i in 0..n {
                let v = raw[i * 2];
                out[i * 4] = v;
                out[i * 4 + 1] = v;
                out[i * 4 + 2] = v;
                out[i * 4 + 3] = raw[i * 2 + 1];
            }
        }
        png::ColorType::Grayscale => {
            for i in 0..n {
                let v = raw[i];
                out[i * 4] = v;
                out[i * 4 + 1] = v;
                out[i * 4 + 2] = v;
                out[i * 4 + 3] = 255;
            }
        }
        png::ColorType::Indexed => {
            // EXPAND removes Indexed; kept for completeness.
            for i in 0..n {
                let v = raw[i];
                out[i * 4] = v;
                out[i * 4 + 1] = v;
                out[i * 4 + 2] = v;
                out[i * 4 + 3] = 255;
            }
        }
    }
    out
}

/// JS: encodePng({width,height,data}, {text, level}). 8-bit RGBA out.
pub fn encode_png(img: &Image, text: &[(String, String)]) -> Result<Vec<u8>, String> {
    if img.data.len() != img.width * img.height * 4 {
        return Err(format!(
            "png: data length {} != {}x{}x4",
            img.data.len(),
            img.width,
            img.height
        ));
    }
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, img.width as u32, img.height as u32);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        for (k, v) in text {
            let _ = enc.add_text_chunk(k.clone(), v.clone());
        }
        let mut writer = enc.write_header().map_err(|e| format!("png: {e}"))?;
        writer.write_image_data(&img.data).map_err(|e| format!("png: {e}"))?;
    }
    Ok(out)
}

/// JS: loadRaster(file). PNG natively; WebP/JPEG/GIF through the `image` crate
/// (replacing the JS dwebp/sips/magick/convert shell-outs). Like the JS, a
/// converted source is cached as a sibling `<name>.png`; the returned path is
/// the PNG actually decoded. AVIF is deferred to step 2.
pub fn load_raster(file: &std::path::Path) -> Result<(Decoded, std::path::PathBuf), String> {
    let buf = std::fs::read(file).map_err(|e| format!("png: {file:?}: {e}"))?;
    if is_png(&buf) {
        return Ok((decode_png(&buf)?, file.to_path_buf()));
    }
    let cache = {
        let mut s = file.as_os_str().to_os_string();
        s.push(".png");
        std::path::PathBuf::from(s)
    };
    if cache.exists() {
        if let Ok(b) = std::fs::read(&cache) {
            if is_png(&b) {
                if let Ok(d) = decode_png(&b) {
                    return Ok((d, cache));
                }
            }
        }
    }
    // Decode the source with the `image` crate and materialize the PNG cache.
    let dyn_img = image::load_from_memory(&buf)
        .map_err(|e| format!("png: {file:?} is not a PNG and could not be decoded: {e}"))?;
    let rgba = dyn_img.to_rgba8();
    let (w, h) = (rgba.width() as usize, rgba.height() as usize);
    let img = Image { width: w, height: h, data: rgba.into_raw() };
    let bytes = encode_png(&img, &[])?;
    let _ = std::fs::write(&cache, &bytes);
    Ok((Decoded { image: img, text: HashMap::new() }, cache))
}

/// Decode a static review image from its pinned bytes, without consulting or
/// writing sibling conversion caches. Keep the original file as review evidence.
pub fn decode_review_image(bytes: &[u8]) -> Result<(Image, &'static str), String> {
    if is_png(bytes) {
        if bytes.len() < 24 { return Err("truncated PNG".into()); }
        let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
        let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
        if u64::from(width) * u64::from(height) > 32_000_000 { return Err("preview exceeds 32 megapixels".into()); }
        return Ok((decode_png(bytes)?.image, "PNG"));
    }
    let format = image::guess_format(bytes).map_err(|e| format!("unsupported review image: {e}"))?;
    let name = match format {
        image::ImageFormat::WebP => {
            let decoder = image::codecs::webp::WebPDecoder::new(std::io::Cursor::new(bytes)).map_err(|e| e.to_string())?;
            if decoder.has_animation() { return Err("animated WebP requires a static review state".into()); }
            "WebP"
        },
        image::ImageFormat::Jpeg => "JPEG",
        _ => return Err("review images must be static PNG, WebP or JPEG".into()),
    };
    let reader = image::ImageReader::with_format(std::io::Cursor::new(bytes), format);
    let (width, height) = reader.into_dimensions().map_err(|e| e.to_string())?;
    if u64::from(width) * u64::from(height) > 32_000_000 { return Err("preview exceeds 32 megapixels".into()); }
    let rgba = image::load_from_memory_with_format(bytes, format).map_err(|e| e.to_string())?.to_rgba8();
    Ok((Image {width: width as usize, height: height as usize, data: rgba.into_raw()}, name))
}

#[cfg(test)]
mod review_image_tests {
    use super::*;
    #[test]
    fn review_webp_and_jpeg_decode_original_bytes_and_keep_alpha() {
        let pixels = [25, 90, 65, 120, 200, 40, 35, 255];
        let mut webp = Vec::new();
        image::codecs::webp::WebPEncoder::new_lossless(&mut webp).encode(&pixels, 2, 1, image::ExtendedColorType::Rgba8).unwrap();
        let (decoded, format) = decode_review_image(&webp).unwrap();
        assert_eq!(format, "WebP"); assert_eq!(decoded.width, 2); assert_eq!(decoded.data, pixels);
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new(&mut jpeg).encode(&[25, 90, 65], 1, 1, image::ExtendedColorType::Rgb8).unwrap();
        let (decoded, format) = decode_review_image(&jpeg).unwrap();
        assert_eq!(format, "JPEG"); assert_eq!(decoded.data[3], 255);
        assert!(decode_review_image(b"not an image").is_err());
    }
}
