//! JS: lib/artifact-schema.mjs

use once_cell::sync::Lazy;
use regex::Regex;

pub const PRODUCT_SCHEMA_VERSION: i64 = 1;
pub const DESIGN_SIDECAR_SCHEMA_VERSION: i64 = 2;
pub const PRODUCT_V4_SECTIONS: [&str; 4] = ["Positioning", "Operating Context", "Evidence on Hand", "Product Principles"];
pub const PRODUCT_DEPRECATED_SECTIONS: [(&str, &str); 1] = [(
    "Register",
    "v4 replaced the brand/product register axis with the four visitor modes (Persuade, Operate, Read, Experience), which are chosen per surface and persisted in that surface's brief. Nothing reads `## Register` any more.",
)];

static PRODUCT_STAMP_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?im)^[ \t]*<!--[ \t]*impeccable:product-schema[ \t]+(\d+)[ \t]*-->[ \t]*$").unwrap());

pub fn product_stamp_line(version: i64) -> String {
    format!("<!-- impeccable:product-schema {} -->", version)
}

/// JS: readProductSchemaVersion
pub fn read_product_schema_version(markdown: &str) -> Option<i64> {
    let m = PRODUCT_STAMP_RE.captures(markdown)?;
    // parseInt of digits: may overflow -> JS gives a big float; treat as integer if parses
    m[1].parse::<i64>().ok()
}

/// JS: stampProductSchema
pub fn stamp_product_schema(markdown: &str, version: i64) -> String {
    let line = product_stamp_line(version);
    if PRODUCT_STAMP_RE.is_match(markdown) {
        // JS: replace first match only (no g flag)
        return PRODUCT_STAMP_RE.replacen(markdown, 1, line.as_str()).into_owned();
    }
    let mut lines: Vec<String> = markdown.split('\n').map(|s| s.to_string()).collect();
    let heading = lines.iter().position(|l| is_h1(l));
    match heading {
        None => format!("{}\n\n{}", line, markdown.trim_start_matches('\n')),
        Some(i) => {
            lines.insert(i + 1, String::new());
            lines.insert(i + 2, line);
            lines.join("\n")
        }
    }
}

fn is_h1(l: &str) -> bool {
    // /^#\s+\S/
    let Some(rest) = l.strip_prefix('#') else { return false };
    let trimmed = rest.trim_start_matches(|c: char| c.is_whitespace());
    trimmed.len() < rest.len() && !trimmed.is_empty()
}

/// JS: readSidecarSchemaVersion
pub fn read_sidecar_schema_version(sidecar: Option<&serde_json::Value>) -> Option<i64> {
    let v = sidecar?.as_object()?.get("schemaVersion")?;
    if let Some(i) = v.as_i64() {
        return Some(i);
    }
    if let Some(f) = v.as_f64() {
        if f.fract() == 0.0 && f.is_finite() {
            return Some(f as i64);
        }
    }
    None
}
