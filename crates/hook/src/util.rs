//! Small JS-semantics helpers for the hook crate: UTF-16 string measures,
//! ordered-JSON builders, and the fs wrappers whose JS originals swallow
//! errors.

use serde_json::{Map, Value};

pub use impeccable_context::util::{iso_now, now_ms, safe_read};
pub use impeccable_core::js_ext_b::utf16_len;
pub use impeccable_detect::jsp;

/// JS `str.slice(start, end)` in UTF-16 code units (non-negative bounds only).
pub fn slice_utf16(s: &str, start: usize, end: usize) -> String {
    if start >= end {
        return String::new();
    }
    let units: Vec<u16> = s.encode_utf16().skip(start).take(end - start).collect();
    String::from_utf16_lossy(&units)
}

/// JS `str.slice(0, end)`.
pub fn slice_prefix(s: &str, end: usize) -> String {
    slice_utf16(s, 0, end)
}

/// JS default `Array.prototype.sort()` comparator on strings: UTF-16 code
/// unit order.
pub fn js_str_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

/// `Date.now()` as an integer JSON number.
pub fn now_value() -> Value {
    Value::from(now_ms() as u64)
}

/// A string-valued JSON field, if it is a non-empty string (JS `typeof v ===
/// 'string' && v`).
pub fn str_field<'a>(map: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    match map.get(key) {
        Some(Value::String(s)) if !s.is_empty() => Some(s.as_str()),
        _ => None,
    }
}

/// `typeof v === 'string'` (empty allowed).
pub fn str_field_any<'a>(map: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    match map.get(key) {
        Some(Value::String(s)) => Some(s.as_str()),
        _ => None,
    }
}

/// A plain-object field (`v && typeof v === 'object' && !Array.isArray(v)`).
pub fn obj_field<'a>(map: &'a Map<String, Value>, key: &str) -> Option<&'a Map<String, Value>> {
    match map.get(key) {
        Some(Value::Object(o)) => Some(o),
        _ => None,
    }
}

/// JS truthiness of a JSON value.
pub fn truthy_value(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().map(|f| f != 0.0 && !f.is_nan()).unwrap_or(true),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

/// `String(v)` for a JSON value (JS coercion).
pub fn js_string(v: &Value) -> String {
    impeccable_detect::util::js_string(v)
}

/// `fs.existsSync`.
pub fn exists(p: &str) -> bool {
    std::path::Path::new(p).exists()
}

/// `JSON.parse(fs.readFileSync(p, 'utf-8'))` or `null` on any failure.
pub fn safe_read_json(p: &str) -> Option<Value> {
    let text = safe_read(p)?;
    serde_json::from_str(&text).ok()
}

/// `JSON.stringify(v)`.
pub fn json_compact(v: &Value) -> String {
    serde_json::to_string(v).unwrap_or_default()
}

/// `JSON.stringify(v, null, 2)`.
pub fn json_pretty(v: &Value) -> String {
    serde_json::to_string_pretty(v).unwrap_or_default()
}

/// Node's error message for a failed `fs.readFileSync(p, 'utf-8')`.
pub fn node_read_error(p: &str, err: &std::io::Error) -> String {
    use std::io::ErrorKind;
    match err.kind() {
        ErrorKind::NotFound => format!("ENOENT: no such file or directory, open '{p}'"),
        ErrorKind::PermissionDenied => format!("EACCES: permission denied, open '{p}'"),
        ErrorKind::IsADirectory => "EISDIR: illegal operation on a directory, read".to_string(),
        _ => {
            if std::path::Path::new(p).is_dir() {
                "EISDIR: illegal operation on a directory, read".to_string()
            } else {
                format!("{err}")
            }
        }
    }
}

/// `new Map()` insertion-ordered set semantics on a `Vec` (later `set`
/// replaces the value in place).
pub fn map_set<V>(map: &mut Vec<(String, V)>, key: String, value: V) {
    if let Some(slot) = map.iter_mut().find(|(k, _)| *k == key) {
        slot.1 = value;
    } else {
        map.push((key, value));
    }
}
