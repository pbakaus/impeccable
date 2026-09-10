//! The pixels behind image-backed text for the static engine (#560). A
//! `url()` resolves to bytes from a local file relative to the page (linked
//! stylesheets have their urls rewritten to page-relative form when they are
//! inlined, see `rewrite_sheet_urls`) or from a base64 data URI, never from
//! the network; the pure-Rust decoders turn them into a raster no larger than
//! the browser overlay's 640px canvas; and the raster is cached for the rest
//! of the process, so a directory scan decodes each hero once. Anything
//! unreadable, remote, oversized, or undecodable is `None`, and the caller
//! keeps today's skip. The same byte budget bounds a file on disk and a data
//! URI's payload, checked before anything is copied or decoded.

use crate::cascade::resolve_linked_css_path;
use base64::Engine;
use impeccable_common::jsp;
use impeccable_core::color::Rgba;
use std::borrow::Cow;
use std::cell::RefCell;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::io::Cursor;
use std::rc::Rc;

/// The browser overlay draws to a canvas no larger than this on a side.
const MAX_RASTER_SIDE: u32 = 640;
/// Files above this are not read: a hero is a few megabytes, and the hook
/// runs on every edit.
const MAX_FILE_BYTES: u64 = 24 * 1024 * 1024;
/// The base64 payload length that decodes to [`MAX_FILE_BYTES`], so a data
/// URI is refused before its payload is copied or decoded.
const MAX_DATA_URI_CHARS: usize = (MAX_FILE_BYTES as usize / 3) * 4 + 4;
const MAX_IMAGE_SIDE: u32 = 8192;
const MAX_DECODE_BYTES: u64 = 128 * 1024 * 1024;
/// Decoded rasters kept per process; the map is cleared when full.
const CACHE_ENTRIES: usize = 24;

/// A decoded image, RGBA8, at most [`MAX_RASTER_SIDE`] on a side.
pub struct Raster {
    pub width: u32,
    pub height: u32,
    /// The size before the downscale: what `background-size: auto` paints.
    pub intrinsic_width: u32,
    pub intrinsic_height: u32,
    rgba: Vec<u8>,
}

impl Raster {
    pub fn pixel(&self, x: usize, y: usize) -> Rgba {
        let i = (y.min(self.height as usize - 1) * self.width as usize
            + x.min(self.width as usize - 1))
            * 4;
        let p = &self.rgba[i..i + 4];
        Rgba::new(p[0] as f64, p[1] as f64, p[2] as f64, p[3] as f64 / 255.0)
    }
}

thread_local! {
    static RASTERS: RefCell<HashMap<String, Option<Rc<Raster>>>> = RefCell::new(HashMap::new());
}

/// Resolves and decodes the `url()` grounds of one document, relative to
/// the document's directory. A url from a linked stylesheet reaches the
/// cascade already rewritten to page-relative form.
pub struct ImageSampler {
    base: String,
}

impl ImageSampler {
    pub fn new(html_dir: &str) -> Self {
        ImageSampler {
            base: html_dir.to_string(),
        }
    }

    /// The raster behind a `url()` argument, or `None` when it cannot be
    /// read here: a remote URL, a missing or oversized file, a format the
    /// decoders do not cover (SVG), or an `svg`/text data URI.
    pub fn load(&self, url: &str) -> Option<Rc<Raster>> {
        let url = url.trim();
        if url.is_empty() {
            return None;
        }
        let key = if is_data_uri(url) {
            // Refused before anything is allocated: a project file can carry
            // any size of data URI, and the hook scans on every edit.
            if url.len() > MAX_DATA_URI_CHARS + 256 {
                return None;
            }
            data_uri_key(url)
        } else {
            self.resolve_file(url)?
        };
        if let Some(hit) = RASTERS.with(|c| c.borrow().get(&key).cloned()) {
            return hit;
        }
        let bytes = if is_data_uri(url) {
            data_uri_bytes(url)
        } else {
            read_bounded(&key)
        };
        let raster = bytes.and_then(|b| decode(&b)).map(Rc::new);
        RASTERS.with(|c| {
            let mut cache = c.borrow_mut();
            if cache.len() >= CACHE_ENTRIES {
                cache.clear();
            }
            cache.insert(key, raster.clone());
        });
        raster
    }

    fn resolve_file(&self, url: &str) -> Option<String> {
        if url.starts_with("//") || url.contains("://") {
            return None;
        }
        let path = resolve_linked_css_path(&self.base, url);
        std::fs::metadata(&path)
            .map(|m| m.is_file())
            .unwrap_or(false)
            .then_some(path)
    }
}

fn is_data_uri(url: &str) -> bool {
    url.len() > 5 && url[..5].eq_ignore_ascii_case("data:")
}

/// The cache key of a data URI: its length and a hash, so the cache never
/// holds a copy of the URI itself.
fn data_uri_key(url: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    url.hash(&mut hasher);
    format!("data:{}:{:016x}", url.len(), hasher.finish())
}

/// The name a finding gives the image: the file name, or `data:<mime>`.
pub fn ground_label(url: &str) -> String {
    let url = url.trim();
    if is_data_uri(url) {
        let header = url[5..].split(',').next().unwrap_or("");
        let mime = header
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        return if mime.is_empty() {
            "data:image".into()
        } else {
            format!("data:{mime}")
        };
    }
    let stripped = url.split(['?', '#']).next().unwrap_or("");
    jsp::basename(stripped)
}

fn data_uri_bytes(url: &str) -> Option<Vec<u8>> {
    let (header, payload) = url[5..].split_once(',')?;
    if !header
        .split(';')
        .any(|p| p.trim().eq_ignore_ascii_case("base64"))
    {
        return None;
    }
    if payload.len() > MAX_DATA_URI_CHARS {
        return None;
    }
    let compact: Cow<str> = if payload.chars().any(char::is_whitespace) {
        Cow::Owned(payload.chars().filter(|c| !c.is_whitespace()).collect())
    } else {
        Cow::Borrowed(payload)
    };
    base64::engine::general_purpose::STANDARD
        .decode(compact.as_ref())
        .or_else(|_| base64::engine::general_purpose::STANDARD_NO_PAD.decode(compact.as_ref()))
        .ok()
}

fn read_bounded(path: &str) -> Option<Vec<u8>> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > MAX_FILE_BYTES {
        return None;
    }
    std::fs::read(path).ok()
}

fn decode(bytes: &[u8]) -> Option<Raster> {
    let mut reader = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .ok()?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_IMAGE_SIDE);
    limits.max_image_height = Some(MAX_IMAGE_SIDE);
    limits.max_alloc = Some(MAX_DECODE_BYTES);
    reader.limits(limits);
    let decoded = reader.decode().ok()?;
    let (intrinsic_width, intrinsic_height) = (decoded.width(), decoded.height());
    if intrinsic_width == 0 || intrinsic_height == 0 {
        return None;
    }
    // `thumbnail` also upscales, so only images past the budget go through it.
    let scaled = if intrinsic_width.max(intrinsic_height) > MAX_RASTER_SIDE {
        decoded.thumbnail(MAX_RASTER_SIDE, MAX_RASTER_SIDE)
    } else {
        decoded
    };
    let rgba = scaled.to_rgba8();
    Some(Raster {
        width: rgba.width(),
        height: rgba.height(),
        intrinsic_width,
        intrinsic_height,
        rgba: rgba.into_raw(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png_bytes(width: u32, height: u32, rgba: [u8; 4]) -> Vec<u8> {
        let img = image::RgbaImage::from_pixel(width, height, image::Rgba(rgba));
        let mut out = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut out, image::ImageFormat::Png)
            .unwrap();
        out.into_inner()
    }

    #[test]
    fn data_uri_decodes_and_labels() {
        let bytes = png_bytes(8, 8, [240, 236, 228, 255]);
        let uri = format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(&bytes)
        );
        let sampler = ImageSampler::new("/nonexistent");
        let raster = sampler.load(&uri).expect("png data uri decodes");
        assert_eq!((raster.width, raster.height), (8, 8));
        assert_eq!(raster.pixel(3, 3).r, 240.0);
        assert_eq!(ground_label(&uri), "data:image/png");
        assert!(sampler.load("data:image/svg+xml;utf8,<svg/>").is_none());
        assert!(sampler.load("https://example.com/hero.jpg").is_none());
        assert!(sampler.load("//cdn.example.com/hero.jpg").is_none());
        assert_eq!(ground_label("img/hero.jpg?v=3"), "hero.jpg");
        // A payload past the byte budget is refused before it is decoded.
        let huge = format!(
            "data:image/png;base64,{}",
            "A".repeat(MAX_DATA_URI_CHARS + 1)
        );
        assert!(sampler.load(&huge).is_none());
        assert_ne!(data_uri_key(&uri), data_uri_key(&huge));
    }

    #[test]
    fn files_resolve_against_the_page_dir_and_downscale() {
        let dir = std::env::temp_dir().join(format!("impeccable-sampler-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("img")).unwrap();
        std::fs::write(
            dir.join("img").join("wide.png"),
            png_bytes(1280, 320, [20, 20, 20, 255]),
        )
        .unwrap();
        let sampler = ImageSampler::new(&dir.to_string_lossy());
        assert!(sampler.load("wide.png").is_none());
        let raster = sampler
            .load("img/wide.png")
            .expect("resolves against the page dir");
        assert_eq!((raster.width, raster.height), (640, 160));
        assert_eq!(
            (raster.intrinsic_width, raster.intrinsic_height),
            (1280, 320)
        );
        assert_eq!(raster.pixel(639, 159).g, 20.0);
        // The second load is the cached raster.
        assert!(Rc::ptr_eq(&raster, &sampler.load("img/wide.png").unwrap()));
        std::fs::remove_dir_all(&dir).ok();
    }
}
