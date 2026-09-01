//! Shared helpers for the comp-fidelity verb orchestrators: JS-faithful arg
//! parsing, number-to-JSON, `toFixed`, ISO timestamps, and small fs helpers.

use impeccable_comp::jsnum;
use serde_json::Value;

/// `arg('name')`: the token after `--name`, unless it is another flag.
pub fn arg<'a>(argv: &'a [String], name: &str) -> Option<&'a str> {
    let needle = format!("--{name}");
    let i = argv.iter().position(|a| a == &needle)?;
    match argv.get(i + 1) {
        Some(v) if !v.starts_with("--") => Some(v.as_str()),
        _ => None,
    }
}

/// `arg('name', fallback)`.
pub fn arg_or<'a>(argv: &'a [String], name: &str, fallback: &'a str) -> &'a str {
    arg(argv, name).unwrap_or(fallback)
}

/// `flag('name')`: `--name` is present anywhere in argv.
pub fn flag(argv: &[String], name: &str) -> bool {
    let needle = format!("--{name}");
    argv.iter().any(|a| a == &needle)
}

/// JS `Number(str)` / `parseFloat` returning a fallback on non-finite parse.
pub fn parse_f64(s: &str, fallback: f64) -> f64 {
    // JS parseFloat: leading numeric prefix. jsnum has parse_float? use trim+parse.
    let t = s.trim();
    match t.parse::<f64>() {
        Ok(v) => v,
        Err(_) => {
            // JS parseFloat scans a leading numeric prefix.
            let mut end = 0;
            let bytes = t.as_bytes();
            let mut seen_dot = false;
            let mut seen_e = false;
            for (i, &b) in bytes.iter().enumerate() {
                let ok = b.is_ascii_digit()
                    || (b == b'-' && i == 0)
                    || (b == b'+' && i == 0)
                    || (b == b'.' && !seen_dot)
                    || ((b == b'e' || b == b'E') && !seen_e && i > 0);
                if b == b'.' {
                    seen_dot = true;
                }
                if b == b'e' || b == b'E' {
                    seen_e = true;
                }
                if ok {
                    end = i + 1;
                } else {
                    break;
                }
            }
            t[..end].parse::<f64>().unwrap_or(fallback)
        }
    }
}

/// `JSON.stringify`-faithful numeric value: an integral, finite f64 becomes a
/// JSON integer (no trailing `.0`), a fractional one a float, a non-finite one
/// `null` (JS `JSON.stringify(NaN|Infinity) === "null"`).
pub fn num(v: f64) -> Value {
    if !v.is_finite() {
        return Value::Null;
    }
    if v.fract() == 0.0 && v.abs() < 9.007_199_254_740_992e15 {
        return Value::Number((v as i64).into());
    }
    match serde_json::Number::from_f64(v) {
        Some(n) => Value::Number(n),
        None => Value::Null,
    }
}

/// `Math.round(v * 10000) / 10000`, as a JSON number.
pub fn r4(v: f64) -> Value {
    num(jsnum::round_fixed(v, 4))
}

/// The rounded f64 behind [`r4`], for arithmetic that then feeds another calc.
pub fn r4f(v: f64) -> f64 {
    jsnum::round_fixed(v, 4)
}

/// `v.toFixed(digits)`.
pub fn to_fixed(v: f64, digits: usize) -> String {
    jsnum::to_fixed(v, digits)
}

/// `Math.round(v)`.
pub fn round(v: f64) -> f64 {
    jsnum::round(v)
}

/// `str.padEnd(n)` (space pad on the right, no truncation).
pub fn pad_end(s: &str, n: usize) -> String {
    if s.chars().count() >= n {
        s.to_string()
    } else {
        format!("{s}{}", " ".repeat(n - s.chars().count()))
    }
}

/// `str.padStart(n)` (space pad on the left, no truncation).
pub fn pad_start(s: &str, n: usize) -> String {
    if s.chars().count() >= n {
        s.to_string()
    } else {
        format!("{}{s}", " ".repeat(n - s.chars().count()))
    }
}

/// `new Date().toISOString()`.
pub fn iso_now() -> String {
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    iso_from_ms(ms)
}

fn iso_from_ms(ms: i64) -> String {
    let secs = ms.div_euclid(1000);
    let millis = ms.rem_euclid(1000);
    let days = secs.div_euclid(86400);
    let sod = secs.rem_euclid(86400);
    let (y, m, d) = civil_from_days(days);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{millis:03}Z",
        sod / 3600,
        (sod % 3600) / 60,
        sod % 60
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

/// A JSON value interpolated the way JS does in a template literal (`${v}`):
/// numbers bare (integers without `.0`), strings raw, null as `null`.
pub fn fmt_value(v: &Value) -> String {
    match v {
        Value::Number(n) => n.to_string(),
        Value::String(s) => s.clone(),
        Value::Bool(b) => b.to_string(),
        Value::Null => "null".to_string(),
        other => other.to_string(),
    }
}

/// `JSON.stringify(value, null, 2)` plus JS's leading-`\n`-free, no-trailing
/// behavior. serde_json's pretty printer matches JS 2-space indentation.
pub fn json_pretty(value: &Value) -> String {
    serde_json::to_string_pretty(value).unwrap_or_default()
}
