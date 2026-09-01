//! JS: skill/scripts/lib/font-index.mjs
//!
//! The fingerprint index of the Google Fonts catalog that font-match `--rank`
//! uses as its candidate generator, plus the pack/unpack helpers. Pure over the
//! index JSON and a comp fingerprint. No CLI, no font files.

use crate::font_fingerprint::{distance, stats, FeatureVec, Fingerprint, FEATURES};
use crate::jsnum::round;
use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::HashMap;

pub const ROUTE_CAP_PX: f64 = 22.0;
pub const MIN_RANK_CAP_PX: f64 = 10.0;
pub const CATEGORIES: [&str; 5] = ["sans", "serif", "display", "handwriting", "mono"];
pub const GROSS_FEATURES: [&str; 6] =
    ["advance", "advTall", "advX", "densTall", "densX", "stemW"];

const NULL_TOKEN: &str = "___";
const MAX_Q: i64 = 36 * 36 * 36 - 1; // 46655

/// JS: INDEX_SIZES = [48, 14, '48c'].
pub fn index_sizes() -> Vec<SizeKey> {
    vec![SizeKey::Num(48.0), SizeKey::Num(14.0), SizeKey::Caps]
}

/// The features the index stores (weight>0 or a gross feature), in FEATURES order.
pub static INDEX_FEATURES: Lazy<Vec<String>> = Lazy::new(|| {
    FEATURES
        .iter()
        .filter(|k| {
            let weighted = matches!(stats(k), Some((_, w)) if w > 0.0);
            weighted || GROSS_FEATURES.contains(&k.as_str())
        })
        .cloned()
        .collect()
});

/// JS: the NON_TEXT_FAMILY regex (barcodes, dingbats, effect faces, ...).
pub static NON_TEXT_FAMILY: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)barcode|^redacted|^flow (block|circular|rounded)|dings|symbols|^bungee (hairline|outline|shade|spice)|^rubik (80s|beastly|broken|bubbles|burned|dirt|distressed|doodle|gemstones|glitch|iso|lines|marker|maze|microbe|moonrocks|pixels|puddles|scribble|spray|storm|vinyl|wet)|^(nabla|honk|kablammo|sixtyfour|workbench|codystar|rock 3d|zen dots|ballet|butcherman|creepster|eater|faster one|frijole|nosifer|metal mania|miltonian)",
    )
    .unwrap()
});

/// An index size bucket: a numeric cap height or the all-caps 48 (`48c`).
#[derive(Clone, PartialEq, Debug)]
pub enum SizeKey {
    Num(f64),
    Caps,
}

impl SizeKey {
    /// The map key used for an entry's fp (JS object key form).
    pub fn key(&self) -> String {
        match self {
            SizeKey::Num(n) => crate::jsnum::to_fixed(*n, 0),
            SizeKey::Caps => "48c".to_string(),
        }
    }
}

fn to_base36_padded(mut n: i64) -> String {
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if n == 0 {
        return "000".to_string();
    }
    let mut buf = Vec::new();
    while n > 0 {
        buf.push(DIGITS[(n % 36) as usize]);
        n /= 36;
    }
    buf.reverse();
    let mut s = String::from_utf8(buf).unwrap();
    while s.len() < 3 {
        s.insert(0, '0');
    }
    s
}

/// JS: packVector(fp, features=INDEX_FEATURES).
pub fn pack_vector(get: &dyn Fn(&str) -> Option<f64>, features: &[String]) -> String {
    let mut out = String::new();
    for k in features {
        match get(k) {
            Some(v) if v.is_finite() => {
                let q = (round(v * 1000.0) as i64).clamp(0, MAX_Q);
                out.push_str(&to_base36_padded(q));
            }
            _ => out.push_str(NULL_TOKEN),
        }
    }
    out
}

/// JS: unpackVector(s, features=INDEX_FEATURES).
pub fn unpack_vector(s: &str, features: &[String]) -> FeatureVec {
    let mut fv = FeatureVec::empty();
    let bytes = s.as_bytes();
    for (i, k) in features.iter().enumerate() {
        let start = i * 3;
        let t = if start + 3 <= bytes.len() {
            &s[start..start + 3]
        } else {
            ""
        };
        let v = if t == NULL_TOKEN || t.len() < 3 {
            None
        } else {
            i64::from_str_radix(t, 36).ok().map(|n| n as f64 / 1000.0)
        };
        fv.set(k, v);
    }
    fv
}

/// One catalog face: name, weight, category, and its per-size fingerprints.
pub struct Entry {
    pub family: String,
    pub weight: f64,
    pub category: String,
    pub variable: bool,
    pub fp: HashMap<String, Option<FeatureVec>>,
}

/// The decoded index (JS: loadFontIndex return).
pub struct FontIndex {
    pub schema: i64,
    pub text: String,
    pub sizes: Vec<SizeKey>,
    pub features: Vec<String>,
    pub entries: Vec<Entry>,
}

/// JS: loadFontIndex(file). None when the file is missing.
pub fn load_font_index(path: &std::path::Path) -> Option<FontIndex> {
    let raw = std::fs::read_to_string(path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let features: Vec<String> = v
        .get("features")
        .and_then(|f| f.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
        .unwrap_or_else(|| INDEX_FEATURES.clone());
    let cats: Vec<String> = v
        .get("categories")
        .and_then(|c| c.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
        .unwrap_or_else(|| CATEGORIES.iter().map(|s| s.to_string()).collect());
    let sizes: Vec<SizeKey> = v
        .get("sizes")
        .and_then(|s| s.as_array())
        .map(|a| {
            a.iter()
                .map(|x| {
                    if let Some(n) = x.as_f64() {
                        SizeKey::Num(n)
                    } else {
                        SizeKey::Caps
                    }
                })
                .collect()
        })
        .unwrap_or_else(index_sizes);
    let schema = v.get("schema").and_then(|s| s.as_i64()).unwrap_or(0);
    let text = v.get("text").and_then(|t| t.as_str()).unwrap_or("").to_string();
    let mut entries = Vec::new();
    if let Some(arr) = v.get("entries").and_then(|e| e.as_array()) {
        for e in arr {
            let e = match e.as_array() {
                Some(a) => a,
                None => continue,
            };
            let family = e.first().and_then(|x| x.as_str()).unwrap_or("").to_string();
            let weight = e.get(1).and_then(|x| x.as_f64()).unwrap_or(0.0);
            let cat_idx = e.get(2).and_then(|x| x.as_i64()).unwrap_or(0);
            let category = cats
                .get(cat_idx as usize)
                .cloned()
                .unwrap_or_else(|| cat_idx.to_string());
            let variable = e.get(3).and_then(|x| x.as_i64()).map(|n| n != 0).unwrap_or(false)
                || e.get(3).and_then(|x| x.as_bool()).unwrap_or(false);
            let mut fp: HashMap<String, Option<FeatureVec>> = HashMap::new();
            for (i, sz) in sizes.iter().enumerate() {
                let packed = e.get(4 + i).and_then(|x| x.as_str());
                let val = match packed {
                    Some(s) if !s.is_empty() => Some(unpack_vector(s, &features)),
                    _ => None,
                };
                fp.insert(sz.key(), val);
            }
            entries.push(Entry { family, weight, category, variable, fp });
        }
    }
    Some(FontIndex { schema, text, sizes, features, entries })
}

/// JS: routeSize(capHeightPx, sizes, {allCaps}).
pub fn route_size(cap_height_px: f64, sizes: &[SizeKey], all_caps: bool) -> SizeKey {
    let mut numeric: Vec<f64> =
        sizes.iter().filter_map(|s| if let SizeKey::Num(n) = s { Some(*n) } else { None }).collect();
    numeric.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let has_caps = sizes.iter().any(|s| matches!(s, SizeKey::Caps));
    if all_caps && cap_height_px >= ROUTE_CAP_PX && has_caps {
        return SizeKey::Caps;
    }
    if cap_height_px < ROUTE_CAP_PX {
        SizeKey::Num(numeric[0])
    } else {
        SizeKey::Num(numeric[numeric.len() - 1])
    }
}

/// A ranked candidate (JS: candidatesFromIndex entry).
pub struct Candidate {
    pub family: String,
    pub weight: f64,
    pub category: String,
    pub variable: bool,
    pub d: f64,
    pub size: SizeKey,
}

pub struct CandOpts {
    pub n: usize,
    pub category: Option<String>,
    pub per_family: usize,
    pub include_non_text: bool,
}

impl Default for CandOpts {
    fn default() -> Self {
        CandOpts { n: 25, category: None, per_family: 2, include_non_text: false }
    }
}

/// JS: candidatesFromIndex(fp, index, opts).
pub fn candidates_from_index(fp: &Fingerprint, index: &FontIndex, opts: &CandOpts) -> Vec<Candidate> {
    let size = route_size(fp.cap_height_px, &index.sizes, fp.all_caps);
    let size_key = size.key();
    let want_cat: Option<Vec<String>> = opts.category.as_ref().map(|c| {
        c.split(',').map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty()).collect()
    });
    let mut scored: Vec<Candidate> = Vec::new();
    for e in &index.entries {
        if let Some(wc) = &want_cat {
            if !wc.contains(&e.category) {
                continue;
            }
        }
        if !opts.include_non_text && NON_TEXT_FAMILY.is_match(&e.family) {
            continue;
        }
        let v = match e.fp.get(&size_key).and_then(|o| o.as_ref()) {
            Some(v) => v,
            None => continue,
        };
        let d = distance(&|k| fp.get(k), &|k| v.get(k));
        if !d.is_finite() {
            continue;
        }
        scored.push(Candidate {
            family: e.family.clone(),
            weight: e.weight,
            category: e.category.clone(),
            variable: e.variable,
            d,
            size: size.clone(),
        });
    }
    scored.sort_by(|a, b| a.d.partial_cmp(&b.d).unwrap());
    let mut per_fam: HashMap<String, usize> = HashMap::new();
    let mut out: Vec<Candidate> = Vec::new();
    for s in scored {
        let c = per_fam.entry(s.family.clone()).or_insert(0);
        if *c >= opts.per_family {
            continue;
        }
        *c += 1;
        out.push(s);
        if out.len() >= opts.n {
            break;
        }
    }
    out
}
