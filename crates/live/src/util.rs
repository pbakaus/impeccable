//! Small helpers the live modules share on top of `impeccable_context::{jsp,
//! util}`: raw-order readdir, a pid liveness probe, JS `Date.parse` for ISO
//! stamps, base64, sha256, `encodeURIComponent`.

pub use impeccable_context::jsp;
pub use impeccable_context::util::{
    exists, is_dir, is_file, iso_now, json_compact, json_pretty, now_ms, safe_read, Env,
};
use serde_json::{Map, Value};

/// A directory entry as `readdirSync(dir, { withFileTypes: true })` reports
/// it: a symlink is neither a directory nor a file.
pub struct RawDirEntry {
    pub name: String,
    pub is_dir: bool,
    pub is_file: bool,
    pub is_symlink: bool,
}

/// `readdirSync(dir, { withFileTypes: true })` in the order the OS returns
/// entries. Node does not sort, and several live outputs (glob expansion,
/// the drift scan) depend on that order, so callers that want sorted output
/// sort explicitly.
pub fn read_dir_raw(dir: &str) -> Option<Vec<RawDirEntry>> {
    let rd = std::fs::read_dir(dir).ok()?;
    let mut out = Vec::new();
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let ft = e.file_type().ok();
        let (is_dir, is_file, is_symlink) = match ft {
            Some(t) if t.is_symlink() => (false, false, true),
            Some(t) => (t.is_dir(), t.is_file(), false),
            None => (false, false, false),
        };
        out.push(RawDirEntry {
            name,
            is_dir,
            is_file,
            is_symlink,
        });
    }
    Some(out)
}

/// `readdirSync(dir)` names, OS order.
pub fn read_dir_names_raw(dir: &str) -> Option<Vec<String>> {
    read_dir_raw(dir).map(|v| v.into_iter().map(|e| e.name).collect())
}

/// `fs.readdirSync(dir).length` or None when unreadable.
pub fn dir_entry_count(dir: &str) -> Option<usize> {
    std::fs::read_dir(dir).ok().map(|rd| rd.count())
}

/// `process.kill(pid, 0)`: `Ok(())` when the signal could be sent, otherwise
/// the errno name (`ESRCH`, `EPERM`, ...). Shared with the other crates.
pub use impeccable_common::proc::{kill0, pid_reachable};

/// `Date.parse(s)` for the ISO 8601 forms these scripts write
/// (`YYYY-MM-DDTHH:MM:SS(.sss)Z`, an optional `±HH:MM` offset, or a bare
/// date). Anything else is NaN (`None`).
pub fn date_parse_ms(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    let num = |from: usize, len: usize| -> Option<i64> {
        if b.len() < from + len {
            return None;
        }
        let mut v: i64 = 0;
        for &c in &b[from..from + len] {
            if !c.is_ascii_digit() {
                return None;
            }
            v = v * 10 + (c - b'0') as i64;
        }
        Some(v)
    };
    let y = num(0, 4)?;
    if b.get(4) != Some(&b'-') {
        return None;
    }
    let mo = num(5, 2)?;
    if b.get(7) != Some(&b'-') {
        return None;
    }
    let d = num(8, 2)?;
    let (mut h, mut mi, mut sec, mut ms) = (0i64, 0i64, 0i64, 0i64);
    let mut offset_min = 0i64;
    let mut i = 10;
    if b.len() > 10 {
        if b[10] != b'T' && b[10] != b' ' {
            return None;
        }
        h = num(11, 2)?;
        if b.get(13) != Some(&b':') {
            return None;
        }
        mi = num(14, 2)?;
        i = 16;
        if b.get(16) == Some(&b':') {
            sec = num(17, 2)?;
            i = 19;
            if b.get(19) == Some(&b'.') {
                let mut j = 20;
                let mut frac = String::new();
                while j < b.len() && b[j].is_ascii_digit() {
                    frac.push(b[j] as char);
                    j += 1;
                }
                if frac.is_empty() {
                    return None;
                }
                let mut f3 = frac.clone();
                f3.truncate(3);
                while f3.len() < 3 {
                    f3.push('0');
                }
                ms = f3.parse().ok()?;
                i = j;
            }
        }
        if i < b.len() {
            match b[i] {
                b'Z' => {
                    i += 1;
                }
                b'+' | b'-' => {
                    let sign = if b[i] == b'-' { -1 } else { 1 };
                    let oh = num(i + 1, 2)?;
                    if b.get(i + 3) != Some(&b':') {
                        return None;
                    }
                    let om = num(i + 4, 2)?;
                    offset_min = sign * (oh * 60 + om);
                    i += 6;
                }
                _ => return None,
            }
        }
        // JS treats a date-time string without an offset as local time; the
        // stamps this code base writes always carry `Z`.
    }
    if i != b.len() {
        return None;
    }
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 24 || mi > 59 || sec > 59 {
        return None;
    }
    let days = days_from_civil(y, mo as u32, d as u32);
    Some(((days * 86400 + h * 3600 + mi * 60 + sec) * 1000 + ms) - offset_min * 60_000)
}

fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u64;
    let mp = if m > 2 { m - 3 } else { m + 9 } as u64;
    let doy = (153 * mp + 2) / 5 + d as u64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe as i64 - 719468
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// `Buffer.from(s, 'utf-8').toString('base64')`
pub fn base64_encode(input: &[u8]) -> String {
    let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(B64[((n >> 18) & 63) as usize] as char);
        out.push(B64[((n >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(B64[((n >> 6) & 63) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(B64[(n & 63) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

/// `Buffer.from(s, 'base64').toString('utf-8')`: Node is lenient (skips
/// non-alphabet bytes, stops at the first `=`).
pub fn base64_decode(input: &str) -> Vec<u8> {
    let mut out = Vec::new();
    let mut acc: u32 = 0;
    let mut bits = 0;
    for c in input.bytes() {
        if c == b'=' {
            break;
        }
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            _ => continue,
        } as u32;
        acc = (acc << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((acc >> bits) & 0xff) as u8);
        }
    }
    out
}

/// hex sha256 of a string.
pub fn sha256_hex(input: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(input.as_bytes());
    let out = h.finalize();
    let mut s = String::with_capacity(64);
    for b in out {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

/// JS `encodeURIComponent`.
pub fn encode_uri_component(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        let keep = b.is_ascii_alphanumeric()
            || matches!(
                b,
                b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')'
            );
        if keep {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}

/// JS `RegExp` escaping (`/[.*+?^${}()|[\]\\]/g`).
pub fn escape_regex(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        if ".*+?^${}()|[]\\".contains(c) {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// `path.relative(a, b).split(path.sep).join('/')` (posix: no change).
pub fn rel_fwd(from: &str, to: &str) -> String {
    jsp::to_posix(&jsp::relative("/", from, to))
}

/// `insideOrEqual` as roots.mjs defines it.
pub fn inside_or_equal(candidate: &str, root: &str) -> bool {
    let rel = jsp::relative("/", root, candidate);
    rel.is_empty() || (!rel.starts_with("..") && !jsp::is_absolute(&rel))
}

/// journal.mjs `insideProject`: strictly inside (not equal).
pub fn inside_project(cwd: &str, abs: &str) -> bool {
    let rel = jsp::relative("/", cwd, abs);
    !rel.is_empty() && !rel.starts_with("..") && !jsp::is_absolute(&rel)
}

/// `path.posix.normalize`
pub fn posix_normalize(p: &str) -> String {
    jsp::posix::normalize(p)
}

pub fn write_file(path: &str, content: &str) -> std::io::Result<()> {
    if let Some(parent) = std::path::Path::new(path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(path, content)
}

pub fn write_file_no_mkdir(path: &str, content: &str) -> std::io::Result<()> {
    std::fs::write(path, content)
}

pub fn read_json(path: &str) -> Option<Value> {
    let text = safe_read(path)?;
    serde_json::from_str::<Value>(&text).ok()
}

pub fn obj() -> Map<String, Value> {
    Map::new()
}

/// `console.log(x)`: x + '\n' on stdout.
pub fn println(io: &mut impeccable_common::Io, s: &str) {
    io.out(s);
    io.out("\n");
}

pub fn eprintln(io: &mut impeccable_common::Io, s: &str) {
    io.err(s);
    io.err("\n");
}

/// A JS number for a serde Value: integral values print without `.0`.
pub fn js_num(v: f64) -> Value {
    impeccable_context::util::js_num(v)
}

/// JS `Number(x)` over a JSON value: numbers pass, numeric strings parse,
/// null → 0, booleans → 0/1, anything else NaN (`None`).
pub fn js_number(v: Option<&Value>) -> Option<f64> {
    match v {
        None => None,
        Some(Value::Null) => Some(0.0),
        Some(Value::Bool(b)) => Some(if *b { 1.0 } else { 0.0 }),
        Some(Value::Number(n)) => n.as_f64(),
        Some(Value::String(s)) => {
            let n = impeccable_core::js::string_to_number(s);
            if n.is_nan() {
                None
            } else {
                Some(n)
            }
        }
        Some(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dates() {
        assert_eq!(
            date_parse_ms("2026-08-01T10:01:00.000Z"),
            Some(1785578460000)
        );
        assert_eq!(
            date_parse_ms("2026-08-01T00:00:00.000Z"),
            Some(1785542400000)
        );
        assert_eq!(date_parse_ms("nope"), None);
    }
    #[test]
    fn b64() {
        assert_eq!(
            base64_encode(b"default-src 'self'"),
            "ZGVmYXVsdC1zcmMgJ3NlbGYn"
        );
        assert_eq!(
            base64_decode("ZGVmYXVsdC1zcmMgJ3NlbGYn"),
            b"default-src 'self'"
        );
    }
}
