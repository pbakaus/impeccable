//! Small helpers shared by every verb: JS-flavoured string/number semantics,
//! best-effort fs reads, JSON conveniences.

use serde_json::{Map, Value};
use std::collections::HashMap;
use std::path::Path;

pub type Env = HashMap<String, String>;

/// JS `String.prototype.trim()`: WhiteSpace + LineTerminator, incl. U+FEFF.
pub fn js_trim(s: &str) -> &str {
    s.trim_matches(|c: char| c.is_whitespace() || c == '\u{FEFF}')
}

/// JS `str.length` (UTF-16 code units).
pub fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

/// JS `Number.prototype.toFixed(digits)` (round-half-up on the exact decimal
/// expansion, which is what ties pick under "the larger n").
pub fn to_fixed(v: f64, digits: usize) -> String {
    if !v.is_finite() {
        return js_number_to_string(v);
    }
    if v.abs() >= 1e21 {
        return js_number_to_string(v);
    }
    let neg = v < 0.0 || (v == 0.0 && v.is_sign_negative() && false);
    let a = v.abs();
    // Exact decimal expansion (doubles have at most 1074 fractional digits).
    let exact = format!("{:.1100}", a);
    let (int_part, frac_part) = exact.split_once('.').unwrap();
    let mut int_digits: Vec<u8> = int_part.bytes().map(|b| b - b'0').collect();
    let frac: Vec<u8> = frac_part.bytes().map(|b| b - b'0').collect();
    let mut kept: Vec<u8> = frac[..digits].to_vec();
    let round_up = frac[digits] >= 5;
    if round_up {
        // propagate carry
        let mut carry = true;
        for d in kept.iter_mut().rev() {
            if !carry {
                break;
            }
            if *d == 9 {
                *d = 0;
            } else {
                *d += 1;
                carry = false;
            }
        }
        if carry {
            for d in int_digits.iter_mut().rev() {
                if !carry {
                    break;
                }
                if *d == 9 {
                    *d = 0;
                } else {
                    *d += 1;
                    carry = false;
                }
            }
            if carry {
                int_digits.insert(0, 1);
            }
        }
    }
    let mut s = String::new();
    let int_s: String = int_digits.iter().map(|d| (b'0' + d) as char).collect();
    let is_zero = int_digits.iter().all(|d| *d == 0) && kept.iter().all(|d| *d == 0);
    if neg && !is_zero {
        s.push('-');
    } else if neg && is_zero && v < 0.0 {
        // JS: (-0.0001).toFixed(2) === "-0.00"
        s.push('-');
    }
    s.push_str(&int_s);
    if digits > 0 {
        s.push('.');
        for d in kept {
            s.push((b'0' + d) as char);
        }
    }
    s
}

/// JS `Number.prototype.toString()` for the ranges these scripts hit
/// (integers, ordinary decimals). Uses Rust's shortest round-trip repr and
/// fixes the exponent thresholds JS applies.
pub fn js_number_to_string(v: f64) -> String {
    if v.is_nan() {
        return "NaN".into();
    }
    if v.is_infinite() {
        return if v > 0.0 { "Infinity".into() } else { "-Infinity".into() };
    }
    if v == 0.0 {
        return "0".into();
    }
    if v.fract() == 0.0 && v.abs() < 1e21 {
        return format!("{}", v as i128);
    }
    let a = v.abs();
    if a >= 1e-6 && a < 1e21 {
        let s = format!("{}", v);
        return s;
    }
    // exponent form: d.ddde±x
    let s = format!("{:e}", v);
    let (m, e) = s.split_once('e').unwrap();
    let e: i32 = e.parse().unwrap();
    format!("{}e{}{}", m, if e >= 0 { "+" } else { "-" }, e.abs())
}

/// A JS number as a JSON value: integral values print without `.0`.
pub fn js_num(v: f64) -> Value {
    if v.is_finite() && v.fract() == 0.0 && v.abs() < 9007199254740992.0 {
        Value::from(v as i64)
    } else if v.is_finite() {
        Value::from(v)
    } else {
        Value::Null
    }
}

pub fn exists(p: &str) -> bool {
    Path::new(p).exists()
}

pub fn is_dir(p: &str) -> bool {
    Path::new(p).is_dir()
}

pub fn is_file(p: &str) -> bool {
    Path::new(p).is_file()
}

/// `fs.readFileSync(p, 'utf-8')` or null.
pub fn safe_read(p: &str) -> Option<String> {
    std::fs::read(p).ok().map(|b| String::from_utf8_lossy(&b).into_owned())
}

/// `JSON.parse(fs.readFileSync(p))` or null.
pub fn read_json(p: &str) -> Option<Value> {
    let text = safe_read(p)?;
    serde_json::from_str::<Value>(&text).ok()
}

/// `readdirSync` names in directory order (Node returns them sorted by the
/// OS; on macOS/Linux this is not guaranteed sorted, so callers that sort do
/// so explicitly). We sort by byte order for determinism where JS output
/// depends on order without sorting.
pub fn read_dir_names(p: &str) -> Option<Vec<String>> {
    let rd = std::fs::read_dir(p).ok()?;
    let mut names: Vec<String> = rd
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    Some(names)
}

pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
    pub is_file: bool,
}

/// `readdirSync(p, { withFileTypes: true })`, sorted by name.
pub fn read_dir_entries(p: &str) -> Option<Vec<DirEntry>> {
    let rd = std::fs::read_dir(p).ok()?;
    let mut out: Vec<DirEntry> = rd
        .filter_map(|e| e.ok())
        .map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            // Node's Dirent reports the link type, not the target's; follow
            // symlinks like Node does when the entry is a symlink? Node's
            // withFileTypes reports isSymbolicLink() for links, so isDirectory()
            // is false for symlinked dirs. Mirror that.
            let ft = e.file_type().ok();
            let (is_dir, is_file) = match ft {
                Some(t) if t.is_symlink() => (false, false),
                Some(t) => (t.is_dir(), t.is_file()),
                None => (false, false),
            };
            DirEntry { name, is_dir, is_file }
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Some(out)
}

pub fn mtime_ms(p: &str) -> Option<f64> {
    let md = std::fs::metadata(p).ok()?;
    let t = md.modified().ok()?;
    let d = t.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some(d.as_secs_f64() * 1000.0)
}

pub fn now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

/// `new Date().toISOString()`
pub fn iso_now() -> String {
    iso_from_ms(now_ms())
}

pub fn iso_from_ms(ms: f64) -> String {
    let ms_i = ms.floor() as i64;
    let secs = ms_i.div_euclid(1000);
    let millis = ms_i.rem_euclid(1000);
    let days = secs.div_euclid(86400);
    let sod = secs.rem_euclid(86400);
    let (y, m, d) = civil_from_days(days);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        y,
        m,
        d,
        sod / 3600,
        (sod % 3600) / 60,
        sod % 60,
        millis
    )
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// `JSON.stringify(v, null, 2)`
pub fn json_pretty(v: &Value) -> String {
    serde_json::to_string_pretty(v).unwrap_or_else(|_| "null".into())
}

/// `JSON.stringify(v)`
pub fn json_compact(v: &Value) -> String {
    serde_json::to_string(v).unwrap_or_else(|_| "null".into())
}

pub fn obj() -> Map<String, Value> {
    Map::new()
}

pub fn opt_str(s: Option<&str>) -> Value {
    match s {
        Some(v) => Value::String(v.to_string()),
        None => Value::Null,
    }
}

pub fn opt_string(s: &Option<String>) -> Value {
    match s {
        Some(v) => Value::String(v.clone()),
        None => Value::Null,
    }
}

/// `os.homedir()` as Node computes it on posix: $HOME first.
pub fn homedir(env: &Env) -> String {
    if cfg!(windows) {
        // Node win32: USERPROFILE, then the process's own profile dir.
        if let Some(h) = env.get("USERPROFILE") {
            if !h.is_empty() {
                return h.clone();
            }
        }
        return std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\".to_string());
    }
    if let Some(h) = env.get("HOME") {
        if !h.is_empty() {
            return h.clone();
        }
    }
    if let Some(h) = env.get("USERPROFILE") {
        if !h.is_empty() {
            return h.clone();
        }
    }
    // Fallback: the process's real home.
    std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
}

pub fn env_nonempty<'a>(env: &'a Env, key: &str) -> Option<&'a str> {
    env.get(key).map(String::as_str).filter(|v| !v.is_empty())
}

/// hook-lib `truthy()`: /^(1|true|yes|on)$/i on the trimmed value.
pub fn truthy_env(env: &Env, key: &str) -> bool {
    match env.get(key) {
        Some(v) => matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"),
        None => false,
    }
}

/// Node's ENOENT-style error message for a failed read.
pub fn node_read_error(p: &str, err: &std::io::Error) -> String {
    match err.kind() {
        std::io::ErrorKind::NotFound => format!("ENOENT: no such file or directory, open '{}'", p),
        std::io::ErrorKind::PermissionDenied => format!("EACCES: permission denied, open '{}'", p),
        _ => {
            if err.raw_os_error() == Some(21) {
                format!("EISDIR: illegal operation on a directory, read")
            } else {
                format!("{}", err)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fixed() {
        assert_eq!(to_fixed(2.5, 0), "3");
        assert_eq!(to_fixed(0.1234, 3), "0.123");
        assert_eq!(to_fixed(1.0005, 3), "1.000"); // 1.0005 is below the tie in binary
        assert_eq!(to_fixed(22.5, 0), "23");
        assert_eq!(to_fixed(0.65, 3), "0.650");
        assert_eq!(to_fixed(359.99, 1), "360.0");
    }
    #[test]
    fn iso() {
        assert_eq!(iso_from_ms(0.0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso_from_ms(1778610600123.0), "2026-05-12T18:30:00.123Z");
    }
}
