//! Small JS-semantics helpers shared by the detect crate's modules: regex
//! fragments that reproduce JS classes on the `regex` crate, file helpers
//! that swallow errors the way the JS `try { } catch { }` blocks do, and JSON
//! coercions.

use serde_json::Value;

/// JS `\d` (ASCII digits only).
pub const D: &str = "[0-9]";
/// JS `\w` (ASCII word characters only).
pub const W: &str = "[A-Za-z0-9_]";
/// JS `\b` (ASCII word boundary).
pub const B: &str = r"(?-u:\b)";
/// JS `[\s\S]`.
pub const ANY: &str = "(?s:.)";
/// JS `.` (no line terminators: LF, CR, LS, PS).
pub const DOT: &str = "[^\n\r\\x{2028}\\x{2029}]";
/// JS `\s`.
pub const WS: &str = impeccable_core::js::WS;
/// JS `\s` class body (for splicing into a bracket expression).
pub const WS_CHARS: &str = impeccable_core::js::WS_CHARS;
/// JS `\S`.
pub const NWS: &str = r"[^\t\n\x0B\x0C\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]";

macro_rules! re {
    ($name:ident, $pat:expr) => {
        static $name: once_cell::sync::Lazy<regex::Regex> =
            once_cell::sync::Lazy::new(|| regex::Regex::new(&$pat).expect(stringify!($name)));
    };
}
pub(crate) use re;

/// `fs.existsSync(p)`.
pub fn exists(p: &str) -> bool {
    std::path::Path::new(p).exists()
}

/// `fs.statSync(p).isDirectory()` (false when the stat fails).
pub fn is_dir(p: &str) -> bool {
    std::fs::metadata(p).map(|m| m.is_dir()).unwrap_or(false)
}

/// `fs.readFileSync(p, 'utf-8')` (None on any error). Invalid UTF-8 is
/// decoded lossily, which is what Node's utf-8 decoder does with U+FFFD.
pub fn read_text(p: &str) -> Option<String> {
    let bytes = std::fs::read(p).ok()?;
    Some(decode_utf8(&bytes))
}

/// Node `Buffer.toString('utf-8')`: lossy decode, BOM kept (Node keeps it).
pub fn decode_utf8(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

/// `JSON.parse(fs.readFileSync(p))` or None.
pub fn read_json(p: &str) -> Option<Value> {
    let text = read_text(p)?;
    serde_json::from_str(&text).ok()
}

/// JS `String(value)` for a JSON value (arrays join by comma, objects
/// become `[object Object]`).
pub fn js_string(v: &Value) -> String {
    match v {
        Value::Null => "null".to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => impeccable_core::js::number_to_string(n.as_f64().unwrap_or(f64::NAN)),
        Value::String(s) => s.clone(),
        Value::Array(items) => items.iter().map(js_string).collect::<Vec<_>>().join(","),
        Value::Object(_) => "[object Object]".to_string(),
    }
}

/// `value && typeof value === 'object' && !Array.isArray(value)`.
pub fn as_plain_object(v: Option<&Value>) -> Option<&serde_json::Map<String, Value>> {
    match v {
        Some(Value::Object(m)) => Some(m),
        _ => None,
    }
}

/// JS `String.prototype.split('\n')` on a `&str`.
pub fn split_lines(s: &str) -> Vec<&str> {
    s.split('\n').collect()
}

/// `text.slice(0, index).split('\n').length` for a byte offset.
pub fn line_of_offset(text: &str, index: usize) -> usize {
    let idx = index.min(text.len());
    text.as_bytes()[..idx]
        .iter()
        .filter(|b| **b == b'\n')
        .count()
        + 1
}
