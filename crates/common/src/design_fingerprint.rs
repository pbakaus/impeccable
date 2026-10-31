//! Shared DESIGN.md content fingerprint contract.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

/// Normalize CRLF only so a Git checkout's line-ending conversion is harmless.
/// Preserve lone CR, BOM, whitespace, Unicode bytes, and the final newline.
pub fn fingerprint(bytes: &[u8]) -> Value {
    let normalized: Vec<u8> = bytes
        .iter()
        .enumerate()
        .filter(|(i, b)| **b != b'\r' || bytes.get(i + 1) != Some(&b'\n'))
        .map(|(_, b)| *b)
        .collect();
    json!({"algorithm": "sha256", "normalization": "lf-v1", "digest": format!("{:x}", Sha256::digest(normalized))})
}

/// None means missing/unknown provenance, not evidence of stale content.
pub fn matches_source(stamp: Option<&Value>, bytes: &[u8]) -> Option<bool> {
    let stamp = stamp?;
    if stamp.get("algorithm")?.as_str()? != "sha256"
        || stamp.get("normalization")?.as_str()? != "lf-v1"
    {
        return None;
    }
    let digest = stamp.get("digest")?.as_str()?;
    if digest.len() != 64 || !digest.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    Some(digest.eq_ignore_ascii_case(fingerprint(bytes)["digest"].as_str().unwrap()))
}

