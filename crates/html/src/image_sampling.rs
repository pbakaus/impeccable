//! The pixels behind image-backed text for the static engine (#560). A
//! `url()` resolves to bytes from a local file relative to the page (a
//! stylesheet linked from another directory has its urls restated relative
//! to the page as its rules are read, see `cascade::UrlBase`) or from a
//! base64 data URI, never from the network. The pure-Rust decoders turn them
//! into the 36 grid samples the verdict reads, and nothing larger is kept.
//!
//! Two callers with different budgets share this module. `detect` decodes:
//! it locates each distinct url of a document once, decodes it once per
//! process, and writes what it sampled to a persistent cache under the
//! user's `.impeccable` directory, one small file per image, keyed by the
//! file's path with its size and modification time inside. The edit hook
//! never decodes: it stats the file, reads that entry, and takes the verdict
//! from it; an image `detect` has not sampled yet stays silent, as every
//! image did before this path existed. Anything unreadable, remote,
//! oversized, or undecodable is `None`, and the caller keeps today's skip.

use crate::background::{ImageLayer, LevelCache};
use crate::cascade::resolve_css_path_exact;
use crate::dom::StaticDocument;
use base64::Engine;
use ego_tree::NodeId;
use image::GenericImageView;
use impeccable_core::checks::sampled_contrast::grid_points;
use impeccable_core::color::Rgba;
pub use crate::image_url::{ground_label, layer_url};
use crate::image_url::{is_data_uri, percent_decoded_path};
pub use impeccable_detect::engines::ImageSamples;
use std::collections::HashSet;
use std::borrow::Cow;
use std::cell::RefCell;
use std::collections::HashMap;
use std::io::{BufRead, Cursor, Read, Seek};
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::time::UNIX_EPOCH;

/// Files above this are not read: a hero is a few megabytes.
const MAX_FILE_BYTES: u64 = 24 * 1024 * 1024;
/// The base64 payload length that decodes to [`MAX_FILE_BYTES`], so a data
/// URI is refused before its payload is copied or decoded.
const MAX_DATA_URI_CHARS: usize = (MAX_FILE_BYTES as usize / 3) * 4 + 4;
const MAX_IMAGE_SIDE: u32 = 8192;
/// Pixels an image may hold before it is decoded. `image`'s own allocation
/// limit binds PNG and GIF buffers only, so the budget is checked against
/// the header for every format: 24 megapixels is 72 MiB of RGB.
const MAX_PIXELS: u64 = 24_000_000;
/// The decoders' own allocation limit, where they honor one.
const MAX_DECODE_BYTES: u64 = 128 * 1024 * 1024;
/// Sample sets kept for the process; the cache is cleared when full.
const CACHE_ENTRIES: usize = 256;
/// The persistent cache's format; an entry of another version reads as
/// absent, so an older engine's samples are never taken for this one's.
const CACHE_VERSION: u32 = 1;
/// The grid the samples were taken on, [`grid_points`]'s side.
const GRID: usize = 6;
/// The box averaged around each grid point: one fortieth of the shorter
/// side, between one and 32 pixels, so a 12 megapixel photo costs about
/// 36 x 32 x 32 pixel reads, microseconds, and a tiny image reads its
/// exact pixels.
const BOX_DIVISOR: u32 = 40;
const BOX_MAX: u32 = 32;

/// The environment variable that moves the persistent cache, for tests and
/// for a user who keeps caches elsewhere.
pub const SAMPLE_CACHE_ENV: &str = "IMPECCABLE_SAMPLE_CACHE";

/// What the verdict reads of an image: its intrinsic size and one color per
/// grid point, row-major over [`grid_points`], each the alpha-weighted mean
/// of a small box around the point, held at the precision the cache keeps
/// (see `quantized`), so a warm scan scores exactly what the cold one did.
#[derive(Debug, Clone, PartialEq)]
pub struct Samples {
    pub width: u32,
    pub height: u32,
    pub points: Vec<Rgba>,
}

/// An image the engine can read: where its bytes are and its intrinsic
/// size, known from the header alone (or from the cache entry, in hook
/// mode). The size is what `background-size: auto` paints, and it decides
/// whether the layer is decoration before any pixel is decoded.
pub struct ImageSource {
    /// Names these exact bytes in the process-wide sample cache.
    key: String,
    /// The persistent cache file for this image, when there is a cache.
    cache_file: Option<PathBuf>,
    /// The file to read, or `None` for a data URI.
    path: Option<String>,
    /// A file's size and modification time, what the cache entry has to
    /// match before it is taken for the file.
    stat: Option<(u64, u128)>,
    pub width: u32,
    pub height: u32,
    /// Samples the persistent cache already held when the source was
    /// located, or that this process decoded for it (`store`), so no byte
    /// is read for them.
    cached: RefCell<Option<Option<Rc<Samples>>>>,
}

impl ImageSource {
    pub fn key(&self) -> &str {
        &self.key
    }
}

thread_local! {
    /// Samples by [`ImageSource::key`], a failed decode included.
    static SAMPLES: RefCell<HashMap<String, Option<Rc<Samples>>>> = RefCell::new(HashMap::new());
}

fn remember(key: &str, value: Option<Rc<Samples>>) {
    SAMPLES.with(|c| {
        let mut cache = c.borrow_mut();
        if cache.len() >= CACHE_ENTRIES {
            cache.clear();
        }
        cache.insert(key.to_string(), value);
    });
}

fn remembered(key: &str) -> Option<Option<Rc<Samples>>> {
    SAMPLES.with(|c| c.borrow().get(key).cloned())
}

/// Locates and samples the `url()` grounds of one document, relative to the
/// document's directory.
pub struct ImageSampler {
    base: String,
    mode: ImageSamples,
    /// The persistent cache directory, `None` when none can be found (no
    /// home directory) or the caller turned it off.
    cache_dir: Option<PathBuf>,
    levels: LevelCache,
    /// The source behind each image-painting element and behind each
    /// distinct url of this document, misses included: a page's text
    /// elements share their ancestors, and its cards share their images.
    /// Neither outlives the document, so a file that appears between two
    /// scans is found by the second.
    by_node: RefCell<HashMap<NodeId, Option<Rc<ImageSource>>>>,
    by_url: RefCell<HashMap<String, Option<Rc<ImageSource>>>>,
}

impl ImageSampler {
    /// `cache_dir` is the persistent cache to use; `None` resolves the
    /// default ([`SAMPLE_CACHE_ENV`], else `<home>/.impeccable/sample-cache`).
    pub fn new(html_dir: &str, mode: ImageSamples, cache_dir: Option<&Path>) -> Self {
        ImageSampler {
            base: html_dir.to_string(),
            mode,
            cache_dir: cache_dir.map(Path::to_path_buf).or_else(default_cache_dir),
            levels: LevelCache::default(),
            by_node: RefCell::new(HashMap::new()),
            by_url: RefCell::new(HashMap::new()),
        }
    }

    pub fn levels(&self) -> &LevelCache {
        &self.levels
    }

    pub fn mode(&self) -> ImageSamples {
        self.mode
    }

    /// The image behind an element's `url()` layer, or `None` when it cannot
    /// be read here: a remote URL, a missing or oversized file, a format the
    /// decoders do not cover (SVG), a text data URI, or, in hook mode, an
    /// image the cache has no entry for.
    pub fn source(
        &self,
        doc: &StaticDocument,
        node: NodeId,
        layer: &ImageLayer,
    ) -> Option<Rc<ImageSource>> {
        if let Some(hit) = self.by_node.borrow().get(&node) {
            return hit.clone();
        }
        let found = self.find_source(&layer_url(doc, node, layer));
        self.by_node.borrow_mut().insert(node, found.clone());
        found
    }

    /// Whether the samples of a source are already at hand, in the
    /// persistent cache or in this process, so no decode is owed.
    pub fn has_samples(&self, source: &ImageSource) -> bool {
        source.cached.borrow().is_some() || remembered(&source.key).is_some()
    }

    /// The grid samples of a source: from the persistent cache, from this
    /// process, or, when the sampler decodes, from the bytes themselves,
    /// which are then written to the cache for the next process and the
    /// next hook run. In hook mode an image with no entry is `None`.
    pub fn samples(
        &self,
        doc: &StaticDocument,
        node: NodeId,
        layer: &ImageLayer,
        source: &ImageSource,
    ) -> Option<Rc<Samples>> {
        if let Some(cached) = source.cached.borrow().as_ref() {
            return cached.clone();
        }
        if let Some(hit) = remembered(&source.key) {
            return hit;
        }
        if self.mode == ImageSamples::CacheOnly {
            return None;
        }
        let bytes = source_bytes(source, &layer_url(doc, node, layer))?;
        let value = decode_samples(&bytes).map(Rc::new);
        self.store(source, value.clone());
        value
    }

    /// Keep what a decode said about a source's bytes, a failure included:
    /// on the source itself, so the page that located it never decodes it
    /// twice however many images it names (the process cache below is
    /// capped and cleared when full), for this process, and in the
    /// persistent cache. A read that fails says nothing about the bytes
    /// and is never stored.
    pub fn store(&self, source: &ImageSource, value: Option<Rc<Samples>>) {
        *source.cached.borrow_mut() = Some(value.clone());
        remember(&source.key, value.clone());
        if let Some(file) = &source.cache_file {
            write_entry(file, source, value.as_deref());
        }
    }

    /// Decode the page's distinct images that the color rule would sample,
    /// in parallel, before the rules run: the cold cost of a page with
    /// several photos falls from their sum to about the slowest one. Only
    /// an image the gates up to the decode let through (text the color rule
    /// measures, over a `url()` ground that is not decoration) and that no
    /// cache holds is decoded, on at most four threads, each of which reads
    /// its own files,
    /// so no more than four images' bytes are in memory at once however
    /// many a page names; a hook, which never decodes, skips this. The
    /// in-page parallelism does not reach across the files of a directory
    /// scan, which the persistent cache covers on repeat runs.
    pub fn decode_ahead(&self, doc: &StaticDocument) {
        if self.mode != ImageSamples::Decode {
            return;
        }
        let mut sources: Vec<Rc<ImageSource>> = Vec::new();
        let mut jobs: Vec<DecodeJob> = Vec::new();
        let mut seen: HashSet<String> = HashSet::new();
        for el in doc.query_selector_all("*") {
            if !crate::adapters::text_may_be_sampled(&el) {
                continue;
            }
            let Some((ground, source)) = crate::adapters::sampled_ground(&el, self) else {
                continue;
            };
            if !seen.insert(source.key.clone()) || self.has_samples(&source) {
                continue;
            }
            let job = match &source.path {
                Some(path) => DecodeJob::File(path.clone()),
                None => DecodeJob::Data(layer_url(doc, ground.node, &ground.layer).trim().to_string()),
            };
            sources.push(source);
            jobs.push(job);
        }
        if jobs.len() < 2 {
            // One image decodes where it is needed.
            return;
        }
        let threads = std::thread::available_parallelism()
            .map_or(2, |n| n.get())
            .clamp(1, 4)
            .min(jobs.len());
        let per = jobs.len().div_ceil(threads);
        let results: Vec<Option<Option<Samples>>> = std::thread::scope(|scope| {
            let handles: Vec<_> = jobs
                .chunks(per)
                .map(|chunk| scope.spawn(move || chunk.iter().map(DecodeJob::run).collect::<Vec<_>>()))
                .collect();
            handles
                .into_iter()
                .flat_map(|h| h.join().unwrap_or_default())
                .collect()
        });
        for (source, result) in sources.iter().zip(results) {
            // A read that failed says nothing about the bytes and is not
            // stored; the rules will ask again.
            if let Some(samples) = result {
                self.store(source, samples.map(Rc::new));
            }
        }
    }

    fn find_source(&self, url: &str) -> Option<Rc<ImageSource>> {
        let url = url.trim();
        if url.is_empty() {
            return None;
        }
        let data = is_data_uri(url);
        if data {
            // Refused before anything is allocated: a project file can carry
            // any size of data URI.
            if url.len() > MAX_DATA_URI_CHARS + 256 {
                return None;
            }
        } else if url.starts_with("//") || url.contains("://") {
            return None;
        }
        // A data URI is known by its content, a file url by how it is
        // written, so one that does not resolve costs its directory walk
        // once per document, not once per element.
        let lookup: Cow<str> = if data {
            Cow::Owned(data_uri_key(url))
        } else {
            Cow::Borrowed(url)
        };
        if let Some(hit) = self.by_url.borrow().get(lookup.as_ref()) {
            return hit.clone();
        }
        let found = if data {
            self.data_source(url, &lookup)
        } else {
            self.file_source(url)
        }
        .map(Rc::new);
        self.by_url
            .borrow_mut()
            .insert(lookup.into_owned(), found.clone());
        found
    }

    fn data_source(&self, url: &str, key: &str) -> Option<ImageSource> {
        let cache_file = self
            .cache_dir
            .as_ref()
            .map(|dir| dir.join(format!("{}.json", fnv64(key.as_bytes()))));
        let entry = cache_file.as_deref().and_then(|f| read_entry(f, None));
        // An entry carries the size and the samples, so neither mode
        // decodes the payload of an image the cache holds. Without one,
        // `detect` reads the size from the decoded payload's header (the
        // pixels decode where they are needed) and the hook has nothing.
        if let Some(entry) = entry {
            return Some(ImageSource {
                key: key.to_string(),
                cache_file,
                path: None,
                stat: None,
                width: entry.width,
                height: entry.height,
                cached: RefCell::new(Some(entry.samples.map(Rc::new))),
            });
        }
        if self.mode == ImageSamples::CacheOnly {
            return None;
        }
        let (width, height) = dimensions(Cursor::new(data_uri_bytes(url)?))?;
        Some(ImageSource {
            key: key.to_string(),
            cache_file,
            path: None,
            stat: None,
            width,
            height,
            cached: RefCell::new(None),
        })
    }

    fn file_source(&self, url: &str) -> Option<ImageSource> {
        // The query and fragment are cut from the url as written, before the
        // escapes are decoded, so a `#` or `?` an escape spells is part of
        // the file name and the resolver has nothing left to cut.
        let path = resolve_css_path_exact(&self.base, &percent_decoded_path(url));
        let meta = std::fs::metadata(&path).ok()?;
        if !meta.is_file() || meta.len() > MAX_FILE_BYTES {
            return None;
        }
        // The caches outlive this document, so the key carries what changes
        // when the file does.
        let modified = meta
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |since| since.as_nanos());
        let stat = (meta.len(), modified);
        let key = format!("{path}\u{0}{}\u{0}{modified}", meta.len());
        let cache_file = self
            .cache_dir
            .as_ref()
            .map(|dir| dir.join(format!("{}.json", fnv64(path.as_bytes()))));
        let entry = cache_file.as_deref().and_then(|f| read_entry(f, Some(stat)));
        if self.mode == ImageSamples::CacheOnly {
            // The file is never opened here: a stat and the entry decide.
            let entry = entry?;
            return Some(ImageSource {
                key,
                cache_file,
                path: Some(path),
                stat: Some(stat),
                width: entry.width,
                height: entry.height,
                cached: RefCell::new(Some(entry.samples.map(Rc::new))),
            });
        }
        let file = std::io::BufReader::new(std::fs::File::open(&path).ok()?);
        let (width, height) = dimensions(file)?;
        Some(ImageSource {
            key,
            cache_file,
            path: Some(path),
            stat: Some(stat),
            width,
            height,
            cached: RefCell::new(entry.map(|e| e.samples.map(Rc::new))),
        })
    }
}

/// One image of [`ImageSampler::decode_ahead`]: where its bytes come from,
/// read inside the worker that decodes it.
enum DecodeJob {
    File(String),
    Data(String),
}

impl DecodeJob {
    /// `None` when the bytes could not be read, `Some(None)` when they do
    /// not decode.
    fn run(&self) -> Option<Option<Samples>> {
        let bytes = match self {
            DecodeJob::File(path) => read_bounded(path)?,
            DecodeJob::Data(url) => data_uri_bytes(url)?,
        };
        Some(decode_samples(&bytes))
    }
}

/// `<home>/.impeccable/sample-cache`, or [`SAMPLE_CACHE_ENV`] when set.
/// `None` without a home directory: the engine then samples without a
/// persistent cache, and the hook stays silent on every image.
fn default_cache_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os(SAMPLE_CACHE_ENV).filter(|v| !v.is_empty()) {
        return Some(PathBuf::from(dir));
    }
    let (first, second) = if cfg!(windows) {
        ("USERPROFILE", "HOME")
    } else {
        ("HOME", "USERPROFILE")
    };
    let home = std::env::var_os(first)
        .or_else(|| std::env::var_os(second))
        .filter(|v| !v.is_empty())?;
    Some(PathBuf::from(home).join(".impeccable").join("sample-cache"))
}

/// FNV-1a over `bytes`, as hex: a stable file name for a path or a data
/// URI's key, the same in every process and every build.
fn fnv64(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        hash ^= u64::from(*b);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// One persistent cache entry: the file it was taken from (size and
/// modification time, absent for a data URI), the intrinsic size, and the
/// samples, `None` when the bytes did not decode.
struct CacheEntry {
    width: u32,
    height: u32,
    samples: Option<Samples>,
}

/// The entry in `file` for an image with this `stat`, or `None` when there
/// is no entry, it is of another version or grid, or it was taken from
/// other bytes. A ~250-byte read.
fn read_entry(file: &Path, stat: Option<(u64, u128)>) -> Option<CacheEntry> {
    let text = std::fs::read_to_string(file).ok()?;
    let json: serde_json::Value = serde_json::from_str(&text).ok()?;
    if json.get("v")?.as_u64()? != u64::from(CACHE_VERSION)
        || json.get("grid")?.as_u64()? != GRID as u64
    {
        return None;
    }
    if let Some((len, mtime)) = stat {
        if json.get("len")?.as_u64()? != len
            || json.get("mtime")?.as_str()? != mtime.to_string()
        {
            return None;
        }
    }
    let width = u32::try_from(json.get("w")?.as_u64()?).ok()?;
    let height = u32::try_from(json.get("h")?.as_u64()?).ok()?;
    if json.get("undecodable").and_then(|v| v.as_bool()) == Some(true) {
        return Some(CacheEntry {
            width,
            height,
            samples: None,
        });
    }
    let raw = base64::engine::general_purpose::STANDARD
        .decode(json.get("samples")?.as_str()?)
        .ok()?;
    if raw.len() != GRID * GRID * 4 {
        return None;
    }
    let points = raw
        .chunks_exact(4)
        .map(|p| Rgba::new(p[0] as f64, p[1] as f64, p[2] as f64, p[3] as f64 / 255.0))
        .collect();
    Some(CacheEntry {
        width,
        height,
        samples: Some(Samples {
            width,
            height,
            points,
        }),
    })
}

/// Write what a decode said about a source, atomically (a temp file
/// renamed into place), so a hook reading the entry at the same moment
/// sees the old entry or the new one, never half of one. Every failure is
/// silent: the cache is a speed-up, not a record.
fn write_entry(file: &Path, source: &ImageSource, samples: Option<&Samples>) {
    let Some(dir) = file.parent() else { return };
    if std::fs::create_dir_all(dir).is_err() {
        return;
    }
    let mut json = serde_json::Map::new();
    json.insert("v".into(), CACHE_VERSION.into());
    json.insert("grid".into(), (GRID as u64).into());
    if let Some((len, mtime)) = source.stat {
        json.insert("len".into(), len.into());
        json.insert("mtime".into(), mtime.to_string().into());
    }
    json.insert("w".into(), source.width.into());
    json.insert("h".into(), source.height.into());
    match samples {
        Some(s) => {
            let mut raw = Vec::with_capacity(s.points.len() * 4);
            for p in &s.points {
                raw.extend_from_slice(&[
                    p.r.round() as u8,
                    p.g.round() as u8,
                    p.b.round() as u8,
                    (p.alpha_or_one() * 255.0).round() as u8,
                ]);
            }
            json.insert(
                "samples".into(),
                base64::engine::general_purpose::STANDARD.encode(raw).into(),
            );
        }
        None => {
            json.insert("undecodable".into(), true.into());
        }
    }
    let text = serde_json::Value::Object(json).to_string();
    let tmp = dir.join(format!(
        ".{}.{}.tmp",
        file.file_name().and_then(|n| n.to_str()).unwrap_or("entry"),
        std::process::id()
    ));
    if std::fs::write(&tmp, text).is_ok() && std::fs::rename(&tmp, file).is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
}

/// The cache key of a data URI: its length and a hash of every byte, so two
/// images never share a key by differing only where a sample did not look.
/// It is computed once per image element per document (the sampler
/// remembers the element), which is one pass over a multi-megabyte inlined
/// image, and the cache never holds a copy.
fn data_uri_key(url: &str) -> String {
    format!("data:{}:{}", url.len(), fnv64(url.as_bytes()))
}

fn source_bytes(source: &ImageSource, url: &str) -> Option<Vec<u8>> {
    match &source.path {
        Some(path) => read_bounded(path),
        None => data_uri_bytes(url.trim()),
    }
}

/// The file's bytes, refused past [`MAX_FILE_BYTES`] whatever its size was
/// when the header was read.
fn read_bounded(path: &str) -> Option<Vec<u8>> {
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .ok()?
        .take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    (bytes.len() as u64 <= MAX_FILE_BYTES).then_some(bytes)
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

/// An image's size from its header, when it is one the engine will decode:
/// no pixel is read here.
fn dimensions<R: BufRead + Seek>(reader: R) -> Option<(u32, u32)> {
    let (width, height) = image::ImageReader::new(reader)
        .with_guessed_format()
        .ok()?
        .into_dimensions()
        .ok()?;
    let readable = width > 0
        && height > 0
        && width <= MAX_IMAGE_SIDE
        && height <= MAX_IMAGE_SIDE
        && u64::from(width) * u64::from(height) <= MAX_PIXELS;
    readable.then_some((width, height))
}

/// Whether a JPEG's scan data runs to its end. The decoder fills a scan cut
/// short with gray and reports no error, so a truncated file would get a
/// verdict from invented pixels. Entropy-coded data never holds `FF DA`
/// (start of scan) or `FF D9` (end of image), so one pass over the markers
/// is exact: the last end-of-image marker has to come after the last start
/// of scan. A trailer after the end marker (some cameras append one) is
/// fine, and a thumbnail's own end marker inside the header does not count.
fn jpeg_complete(bytes: &[u8]) -> bool {
    let mut last_sos: Option<usize> = None;
    let mut last_eoi: Option<usize> = None;
    for (i, pair) in bytes.windows(2).enumerate() {
        match pair {
            [0xFF, 0xDA] => last_sos = Some(i),
            [0xFF, 0xD9] => last_eoi = Some(i),
            _ => {}
        }
    }
    matches!((last_sos, last_eoi), (Some(sos), Some(eoi)) if eoi > sos)
}

/// The grid samples of these bytes, or `None` when they do not decode: a
/// header past the budget, a decoder error, or a JPEG cut short. The full
/// decode is read at 36 points and dropped; nothing is resized.
pub fn decode_samples(bytes: &[u8]) -> Option<Samples> {
    // The budget is checked on the bytes being decoded, whatever a header
    // said earlier, and the decoders get their own limits besides.
    dimensions(Cursor::new(bytes))?;
    if bytes.starts_with(&[0xFF, 0xD8]) && !jpeg_complete(bytes) {
        return None;
    }
    let mut reader = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .ok()?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_IMAGE_SIDE);
    limits.max_image_height = Some(MAX_IMAGE_SIDE);
    limits.max_alloc = Some(MAX_DECODE_BYTES);
    reader.limits(limits);
    let decoded = reader.decode().ok()?;
    Some(sample_grid(&decoded))
}

/// One alpha-weighted mean per grid cell, over a small box around the
/// cell's center that stays inside the cell.
fn sample_grid(img: &image::DynamicImage) -> Samples {
    let (width, height) = img.dimensions();
    let (w, h) = (width as usize, height as usize);
    let side = (width.min(height) / BOX_DIVISOR).clamp(1, BOX_MAX) as usize;
    let half = side / 2;
    let points = grid_points(w, h)
        .into_iter()
        .enumerate()
        .map(|(i, (cx, cy))| {
            let (gx, gy) = (i % GRID, i / GRID);
            // The cell's own bounds, so a box never straddles a seam.
            let x0 = (gx * w / GRID).max(cx.saturating_sub(half));
            let y0 = (gy * h / GRID).max(cy.saturating_sub(half));
            let x1 = ((gx + 1) * w / GRID).min(cx + half + 1).max(x0 + 1).min(w);
            let y1 = ((gy + 1) * h / GRID).min(cy + half + 1).max(y0 + 1).min(h);
            let (mut r, mut g, mut b, mut a, mut n) = (0.0f64, 0.0f64, 0.0f64, 0.0f64, 0.0f64);
            for y in y0..y1 {
                for x in x0..x1 {
                    let p = img.get_pixel(x as u32, y as u32).0;
                    let alpha = f64::from(p[3]) / 255.0;
                    r += f64::from(p[0]) * alpha;
                    g += f64::from(p[1]) * alpha;
                    b += f64::from(p[2]) * alpha;
                    a += alpha;
                    n += 1.0;
                }
            }
            if a > 0.0 {
                quantized(r / a, g / a, b / a, a / n)
            } else {
                Rgba::new(0.0, 0.0, 0.0, 0.0)
            }
        })
        .collect();
    Samples {
        width,
        height,
        points,
    }
}

/// A sample at the precision the cache entry holds it: whole channel values
/// and an alpha in 255ths. `write_entry` stores exactly these, so a verdict
/// near a cutoff is the same whether the samples came from the decode or
/// from the entry.
fn quantized(r: f64, g: f64, b: f64, alpha: f64) -> Rgba {
    Rgba::new(
        r.round(),
        g.round(),
        b.round(),
        (alpha * 255.0).round() / 255.0,
    )
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

    fn jpeg_bytes(width: u32, height: u32, rgb: [u8; 3]) -> Vec<u8> {
        let img = image::RgbImage::from_pixel(width, height, image::Rgb(rgb));
        let mut out = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(img)
            .write_to(&mut out, image::ImageFormat::Jpeg)
            .unwrap();
        out.into_inner()
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "impeccable-sampler-{name}-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sampler(base: &Path, mode: ImageSamples, cache: &Path) -> ImageSampler {
        ImageSampler::new(&base.to_string_lossy(), mode, Some(cache))
    }

    #[test]
    fn a_stored_result_stays_on_its_source_when_the_process_cache_clears() {
        let dir = temp_dir("stays-on-source");
        std::fs::write(dir.join("a.png"), png_bytes(16, 16, [250, 250, 250, 255])).unwrap();
        let cache = dir.join("cache");
        let sampler = sampler(&dir, ImageSamples::Decode, &cache);
        let source = sampler.find_source("a.png").expect("source");
        let value = decode_samples(&std::fs::read(dir.join("a.png")).unwrap()).map(Rc::new);
        sampler.store(&source, value.clone());
        // The page's other images push the process cache past its cap.
        for i in 0..=CACHE_ENTRIES {
            remember(&format!("evict-{i}"), None);
        }
        assert!(remembered(&source.key).is_none(), "the process cache was cleared");
        assert_eq!(
            source.cached.borrow().as_ref().map(|v| v.is_some()),
            Some(true),
            "the source keeps what was decoded for it"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn samples_of(sampler: &ImageSampler, url: &str) -> Option<Rc<Samples>> {
        let source = sampler.find_source(url)?;
        if let Some(cached) = source.cached.borrow().as_ref() {
            return cached.clone();
        }
        if let Some(hit) = remembered(&source.key) {
            return hit;
        }
        if sampler.mode == ImageSamples::CacheOnly {
            return None;
        }
        let value = decode_samples(&source_bytes(&source, url)?).map(Rc::new);
        sampler.store(&source, value.clone());
        value
    }

    #[test]
    fn data_uri_decodes_and_labels() {
        let bytes = png_bytes(8, 8, [240, 236, 228, 255]);
        let uri = format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(&bytes)
        );
        let cache = temp_dir("data");
        let sampler = sampler(Path::new("/nonexistent"), ImageSamples::Decode, &cache);
        let source = sampler
            .find_source(&uri)
            .expect("png data uri has a header");
        assert_eq!((source.width, source.height), (8, 8));
        let samples = samples_of(&sampler, &uri).expect("png data uri decodes");
        assert_eq!((samples.width, samples.height), (8, 8));
        assert_eq!(samples.points.len(), GRID * GRID);
        assert_eq!(samples.points[21].r, 240.0);
        assert_eq!(ground_label(&uri), "data:image/png");
        assert!(sampler
            .find_source("data:image/svg+xml;utf8,<svg/>")
            .is_none());
        assert!(sampler
            .find_source("https://example.com/hero.jpg")
            .is_none());
        assert!(sampler.find_source("//cdn.example.com/hero.jpg").is_none());
        assert_eq!(ground_label("img/hero.jpg?v=3"), "hero.jpg");
        // A url that opens with a multibyte character is a local path, not
        // a panic.
        assert!(!is_data_uri("dat\u{20ac}"));
        assert!(sampler.find_source("abcd\u{20ac}.png").is_none());
        assert_eq!(ground_label("abcd\u{20ac}.png"), "abcd\u{20ac}.png");
        // A payload past the byte budget is refused before it is decoded.
        let huge = format!(
            "data:image/png;base64,{}",
            "A".repeat(MAX_DATA_URI_CHARS + 1)
        );
        assert!(sampler.find_source(&huge).is_none());
        // The hook takes the data URI's samples from the cache without
        // decoding its payload, and has nothing for one it has not seen.
        let hook = super::ImageSampler::new("/nonexistent", ImageSamples::CacheOnly, Some(&cache));
        let cached = samples_of(&hook, &uri).expect("cached data uri");
        assert_eq!(cached.points[21].r, 240.0);
        let other = format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(png_bytes(8, 8, [1, 2, 3, 255]))
        );
        assert!(hook.find_source(&other).is_none());
        std::fs::remove_dir_all(&cache).ok();
    }

    #[test]
    fn a_data_uri_key_covers_every_byte() {
        let head = "data:image/png;base64,";
        let a = format!("{head}{}", "A".repeat(60_000));
        // One byte anywhere changes the key, wherever it sits.
        for at in [head.len(), 2_148, 30_000, a.len() - 1] {
            let mut b = a.clone().into_bytes();
            b[at] = b'B';
            assert_ne!(
                data_uri_key(&a),
                data_uri_key(&String::from_utf8(b).unwrap())
            );
        }
        assert_ne!(data_uri_key(&a), data_uri_key(&format!("{a}A")));
        assert_eq!(data_uri_key(&a), data_uri_key(&a.clone()));
    }

    #[test]
    fn files_resolve_against_the_page_dir_and_are_cached_for_the_hook() {
        let dir = temp_dir("files");
        let cache = dir.join("cache");
        std::fs::create_dir_all(dir.join("img")).unwrap();
        std::fs::write(
            dir.join("img").join("wide.png"),
            png_bytes(1280, 320, [20, 20, 20, 255]),
        )
        .unwrap();
        let detect = sampler(&dir, ImageSamples::Decode, &cache);
        assert!(detect.find_source("wide.png").is_none());
        let source = detect
            .find_source("img/wide.png")
            .expect("resolves against the page dir");
        // The intrinsic size comes from the header; the samples read the
        // full decode, nothing is resized.
        assert_eq!((source.width, source.height), (1280, 320));
        let samples = samples_of(&detect, "img/wide.png").unwrap();
        assert_eq!((samples.width, samples.height), (1280, 320));
        assert_eq!(samples.points[35].g, 20.0);
        assert!(Rc::ptr_eq(
            &samples,
            &samples_of(&detect, "img/wide.png").unwrap()
        ));
        // A miss is remembered for the document, so the walk runs once, and
        // forgotten with it: the next scan finds a file that has appeared.
        std::fs::write(dir.join("wide.png"), png_bytes(4, 4, [0, 0, 0, 255])).unwrap();
        assert!(detect.find_source("wide.png").is_none());
        let next = sampler(&dir, ImageSamples::Decode, &cache);
        assert!(next.find_source("wide.png").is_some());

        // The hook never opens the image: it takes the entry `detect` wrote.
        // The file's bytes are swapped for text under the same size and
        // modification time, and the hook still answers from the entry.
        let hook = sampler(&dir, ImageSamples::CacheOnly, &cache);
        let for_hook = hook.find_source("img/wide.png").expect("the cache has the entry");
        assert_eq!((for_hook.width, for_hook.height), (1280, 320));
        assert_eq!(samples_of(&hook, "img/wide.png").unwrap().points[0].g, 20.0);
        let meta = std::fs::metadata(dir.join("img/wide.png")).unwrap();
        let fake = vec![b'x'; meta.len() as usize];
        std::fs::write(dir.join("img/wide.png"), &fake).unwrap();
        filetime_set(&dir.join("img/wide.png"), meta.modified().unwrap());
        let hook = sampler(&dir, ImageSamples::CacheOnly, &cache);
        assert_eq!(
            samples_of(&hook, "img/wide.png").unwrap().points[0].g,
            20.0,
            "the body was never read"
        );
        // An image with no entry stays silent in the hook, and is not opened.
        assert!(hook.find_source("wide.png").is_none());
        // A changed file misses its entry: `detect` decodes it again (and
        // finds text, which does not decode: a negative entry).
        std::fs::write(dir.join("img").join("wide.png"), png_bytes(64, 32, [200, 200, 200, 255])).unwrap();
        let changed = samples_of(&sampler(&dir, ImageSamples::Decode, &cache), "img/wide.png").unwrap();
        assert_eq!((changed.width, changed.points[0].g), (64, 200.0));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_cache_gives_back_what_the_cold_scan_scored() {
        let dir = temp_dir("precision");
        let cache = dir.join("cache");
        // A ramp with translucent rows: every cell's mean is fractional
        // before it is quantized.
        let img = image::RgbaImage::from_fn(96, 64, |x, y| {
            let alpha = if y % 3 == 0 { 90 } else { 255 };
            image::Rgba([(x * 2) as u8, (y * 3) as u8, ((x + y) % 7 * 30) as u8, alpha])
        });
        let mut out = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut out, image::ImageFormat::Png)
            .unwrap();
        std::fs::write(dir.join("ramp.png"), out.into_inner()).unwrap();
        let cold = samples_of(&sampler(&dir, ImageSamples::Decode, &cache), "ramp.png").unwrap();
        assert!(cold.points.iter().any(|p| p.alpha_or_one() < 1.0));
        assert!(cold.points.iter().all(|p| p.r.fract() == 0.0 && p.g.fract() == 0.0));
        // The hook reads the entry; the verdict it scores is the same one.
        let warm = samples_of(&sampler(&dir, ImageSamples::CacheOnly, &cache), "ramp.png").unwrap();
        assert_eq!(*cold, *warm);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_cached_data_uri_is_not_decoded_again() {
        let bytes = png_bytes(8, 8, [240, 236, 228, 255]);
        let uri = format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(&bytes)
        );
        let cache = temp_dir("data-cached");
        let first = sampler(Path::new("/nonexistent"), ImageSamples::Decode, &cache);
        assert_eq!(samples_of(&first, &uri).unwrap().points[21].r, 240.0);
        // The entry rewritten with another size and sentinel samples: a
        // second `detect` scan answers from the entry, size and samples
        // alike, and never decodes the payload.
        let file = std::fs::read_dir(&cache).unwrap().next().unwrap().unwrap().path();
        let mut json: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        json["w"] = 5.into();
        json["h"] = 3.into();
        json["samples"] = serde_json::Value::String(
            base64::engine::general_purpose::STANDARD.encode(vec![7u8; GRID * GRID * 4]),
        );
        std::fs::write(&file, json.to_string()).unwrap();
        let second = sampler(Path::new("/nonexistent"), ImageSamples::Decode, &cache);
        let source = second.find_source(&uri).expect("the entry answers");
        assert_eq!((source.width, source.height), (5, 3));
        assert_eq!(samples_of(&second, &uri).unwrap().points[21].r, 7.0);
        std::fs::remove_dir_all(&cache).ok();
    }

    fn filetime_set(path: &Path, to: std::time::SystemTime) {
        let file = std::fs::OpenOptions::new().write(true).open(path).unwrap();
        file.set_modified(to).unwrap();
    }

    #[test]
    fn samples_average_a_box_inside_each_cell() {
        // Left half dark, right half light: every sample in the first three
        // columns is dark and in the last three light, with no seam mixed in.
        let mut img = image::RgbaImage::from_pixel(600, 300, image::Rgba([240, 240, 240, 255]));
        for y in 0..300 {
            for x in 0..300 {
                img.put_pixel(x, y, image::Rgba([20, 20, 20, 255]));
            }
        }
        let samples = sample_grid(&image::DynamicImage::ImageRgba8(img));
        for (i, p) in samples.points.iter().enumerate() {
            let expected = if i % GRID < 3 { 20.0 } else { 240.0 };
            assert_eq!(p.r, expected, "sample {i}");
        }
        // Alpha-weighted: a transparent pixel contributes no color, an
        // opaque one its own, and the mean alpha is the sample's. The box
        // is 15 px here (600 / 40), so nine opaque pixels at the first
        // cell's center sit among transparent ones.
        let mut img = image::RgbaImage::from_pixel(600, 600, image::Rgba([0, 0, 0, 0]));
        for y in 49..52 {
            for x in 49..52 {
                img.put_pixel(x, y, image::Rgba([200, 100, 0, 255]));
            }
        }
        let samples = sample_grid(&image::DynamicImage::ImageRgba8(img));
        assert_eq!(samples.points[0].r, 200.0);
        assert_eq!(samples.points[0].g, 100.0);
        // Nine of 225 is 0.04, held in 255ths as 10/255 (`quantized`).
        assert_eq!(samples.points[0].alpha_or_one(), 10.0 / 255.0);
        assert_eq!(samples.points[35].alpha_or_one(), 0.0);
        // A tiny image reads its exact pixels: the box is one pixel.
        let mut img = image::RgbaImage::from_pixel(12, 12, image::Rgba([0, 0, 0, 255]));
        img.put_pixel(1, 1, image::Rgba([255, 255, 255, 255]));
        let samples = sample_grid(&image::DynamicImage::ImageRgba8(img));
        assert_eq!(samples.points[0].r, 255.0);
        assert_eq!(samples.points[1].r, 0.0);
    }

    #[test]
    fn a_jpeg_cut_short_does_not_decode() {
        let full = jpeg_bytes(400, 300, [200, 200, 200]);
        assert!(jpeg_complete(&full));
        let samples = decode_samples(&full).expect("a whole jpeg decodes");
        assert!((samples.points[0].r - 200.0).abs() < 3.0);
        let cut = &full[..full.len() / 3];
        assert!(!jpeg_complete(cut));
        assert!(decode_samples(cut).is_none());
        // A trailer after the end marker is still a complete scan; an end
        // marker before the scan (a thumbnail's) is not one.
        let mut trailer = full.clone();
        trailer.extend_from_slice(b"camera trailer");
        assert!(jpeg_complete(&trailer));
        let mut early = vec![0xFF, 0xD8, 0xFF, 0xD9];
        early.extend_from_slice(cut);
        assert!(!jpeg_complete(&early));
    }

    #[test]
    fn an_image_past_the_pixel_budget_is_refused_from_its_header() {
        // 6000 x 6000 is 36 megapixels: over the budget, and never decoded.
        let big = png_bytes(6000, 6000, [0, 0, 0, 255]);
        assert!(dimensions(Cursor::new(&big)).is_none());
        // The same budget holds at the decode itself, whatever a header
        // said when the source was located.
        assert!(decode_samples(&big).is_none());
        let ok = png_bytes(4000, 3000, [0, 0, 0, 255]);
        assert_eq!(dimensions(Cursor::new(&ok)), Some((4000, 3000)));
    }

    #[test]
    fn a_cache_entry_of_another_version_or_grid_reads_as_absent() {
        let dir = temp_dir("entry");
        let file = dir.join("e.json");
        std::fs::write(&file, r#"{"v":99,"grid":6,"w":8,"h":8,"undecodable":true}"#).unwrap();
        assert!(read_entry(&file, None).is_none());
        std::fs::write(&file, r#"{"v":1,"grid":8,"w":8,"h":8,"undecodable":true}"#).unwrap();
        assert!(read_entry(&file, None).is_none());
        std::fs::write(&file, r#"{"v":1,"grid":6,"len":5,"mtime":"7","w":8,"h":8,"undecodable":true}"#).unwrap();
        assert!(read_entry(&file, Some((5, 8))).is_none());
        let entry = read_entry(&file, Some((5, 7))).expect("matching stat");
        assert!(entry.samples.is_none());
        assert_eq!((entry.width, entry.height), (8, 8));
        std::fs::remove_dir_all(&dir).ok();
    }
}
