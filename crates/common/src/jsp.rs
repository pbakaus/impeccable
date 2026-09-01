//! Node `path` semantics on plain strings. The JS scripts lean on
//! `path.resolve` / `path.relative` normalization everywhere their output is
//! built, so every path that reaches stdout goes through these instead of
//! `std::path`.
//!
//! Node picks `path.win32` on Windows and `path.posix` everywhere else; the
//! top-level functions here do the same via `cfg!(windows)`. Both flavours are
//! also reachable explicitly as [`posix`] and [`win32`] for the places the JS
//! spelled out (`path.posix.normalize`, `path.posix.dirname`).
//!
//! `resolve` and `relative` take an explicit `cwd` where Node reads
//! `process.cwd()`. Callers that only ever pass absolute paths may hand in
//! `"/"`; on Windows a bare `/` resolves to the root of the current drive
//! exactly as Node's `path.win32.resolve('/')` does when the cwd is unknown.

/// `path.sep`: `\` on Windows, `/` elsewhere.
pub const SEP: &str = if cfg!(windows) { "\\" } else { "/" };

/// `path.sep` as a char.
pub const SEP_CHAR: char = if cfg!(windows) { '\\' } else { '/' };

/// JS: `p.split(path.sep).join('/')`. The scripts do this wherever a path is
/// displayed, matched against a glob, or written into a manifest another
/// platform may read. Identity on posix.
pub fn to_posix(p: &str) -> String {
    if cfg!(windows) {
        p.replace('\\', "/")
    } else {
        p.to_string()
    }
}

/// `path.isAbsolute`
pub fn is_absolute(p: &str) -> bool {
    if cfg!(windows) {
        win32::is_absolute(p)
    } else {
        posix::is_absolute(p)
    }
}

/// `path.normalize`
pub fn normalize(p: &str) -> String {
    if cfg!(windows) {
        win32::normalize(p)
    } else {
        posix::normalize(p)
    }
}

/// `path.join`
pub fn join(parts: &[&str]) -> String {
    if cfg!(windows) {
        win32::join(parts)
    } else {
        posix::join(parts)
    }
}

/// `path.resolve(...segments)` with `cwd` standing in for `process.cwd()`.
pub fn resolve(cwd: &str, parts: &[&str]) -> String {
    if cfg!(windows) {
        win32::resolve(cwd, parts)
    } else {
        posix::resolve(cwd, parts)
    }
}

/// `path.relative(from, to)` with `cwd` standing in for `process.cwd()`.
pub fn relative(cwd: &str, from: &str, to: &str) -> String {
    if cfg!(windows) {
        win32::relative(cwd, from, to)
    } else {
        posix::relative(cwd, from, to)
    }
}

/// `path.dirname`
pub fn dirname(p: &str) -> String {
    if cfg!(windows) {
        win32::dirname(p)
    } else {
        posix::dirname(p)
    }
}

/// `path.basename(p)`
pub fn basename(p: &str) -> String {
    if cfg!(windows) {
        win32::basename(p)
    } else {
        posix::basename(p)
    }
}

/// `path.basename(p, ext)`
pub fn basename_ext(p: &str, ext: &str) -> String {
    if cfg!(windows) {
        win32::basename_ext(p, ext)
    } else {
        posix::basename_ext(p, ext)
    }
}

/// `path.extname`
pub fn extname(p: &str) -> String {
    if cfg!(windows) {
        win32::extname(p)
    } else {
        posix::extname(p)
    }
}

/// Node's `normalizeString`: split on separators, drop empty and `.`
/// segments, fold `..` (kept only when `allow_above_root`).
fn normalize_segments(p: &str, allow_above_root: bool, is_sep: fn(u8) -> bool) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for seg in p.split(|c: char| c.is_ascii() && is_sep(c as u8)) {
        if seg.is_empty() || seg == "." {
            continue;
        }
        if seg == ".." {
            if let Some(last) = out.last() {
                if last != ".." {
                    out.pop();
                    continue;
                }
            }
            if allow_above_root {
                out.push("..".to_string());
            }
            continue;
        }
        out.push(seg.to_string());
    }
    out
}

/// `path.posix`. Separators are `/`.
pub mod posix {
    fn is_sep(c: u8) -> bool {
        c == b'/'
    }

    /// JS: path.posix.isAbsolute
    pub fn is_absolute(p: &str) -> bool {
        p.starts_with('/')
    }

    /// JS: path.posix.normalize
    pub fn normalize(p: &str) -> String {
        if p.is_empty() {
            return ".".to_string();
        }
        let absolute = is_absolute(p);
        let trailing = p.ends_with('/');
        let segs = super::normalize_segments(p, !absolute, is_sep);
        let mut s = segs.join("/");
        if s.is_empty() && !absolute {
            s = ".".to_string();
        }
        if trailing && !s.is_empty() && s != "." {
            s.push('/');
        } else if trailing && s == "." {
            s = "./".to_string();
        }
        if absolute {
            format!("/{}", s.trim_start_matches('/'))
        } else {
            s
        }
    }

    /// JS: path.posix.join
    pub fn join(parts: &[&str]) -> String {
        let joined: Vec<&str> = parts.iter().copied().filter(|p| !p.is_empty()).collect();
        if joined.is_empty() {
            return ".".to_string();
        }
        normalize(&joined.join("/"))
    }

    /// JS: path.posix.resolve(cwd, ...segments) with an explicit cwd.
    pub fn resolve(cwd: &str, parts: &[&str]) -> String {
        let mut resolved = String::new();
        let mut abs = false;
        for p in parts.iter().rev() {
            if p.is_empty() {
                continue;
            }
            resolved = format!("{}/{}", p, resolved);
            if is_absolute(p) {
                abs = true;
                break;
            }
        }
        if !abs {
            resolved = format!("{}/{}", cwd, resolved);
        }
        let segs = super::normalize_segments(&resolved, false, is_sep);
        format!("/{}", segs.join("/"))
    }

    /// JS: path.posix.relative(from, to)
    pub fn relative(cwd: &str, from: &str, to: &str) -> String {
        let from = resolve(cwd, &[from]);
        let to = resolve(cwd, &[to]);
        if from == to {
            return String::new();
        }
        let f: Vec<&str> = from.split('/').filter(|s| !s.is_empty()).collect();
        let t: Vec<&str> = to.split('/').filter(|s| !s.is_empty()).collect();
        let mut i = 0;
        while i < f.len() && i < t.len() && f[i] == t[i] {
            i += 1;
        }
        let mut out: Vec<&str> = Vec::new();
        for _ in i..f.len() {
            out.push("..");
        }
        for seg in &t[i..] {
            out.push(seg);
        }
        out.join("/")
    }

    /// JS: path.posix.dirname
    pub fn dirname(p: &str) -> String {
        if p.is_empty() {
            return ".".to_string();
        }
        let has_root = p.starts_with('/');
        let bytes = p.as_bytes();
        let mut end: isize = -1;
        let mut matched_slash = true;
        let mut i = bytes.len() as isize - 1;
        while i >= 1 {
            if bytes[i as usize] == b'/' {
                if !matched_slash {
                    end = i;
                    break;
                }
            } else {
                matched_slash = false;
            }
            i -= 1;
        }
        if end == -1 {
            return if has_root {
                "/".to_string()
            } else {
                ".".to_string()
            };
        }
        if has_root && end == 1 {
            return "//".to_string();
        }
        p[..end as usize].to_string()
    }

    /// JS: path.posix.basename (no ext)
    pub fn basename(p: &str) -> String {
        let trimmed = p.trim_end_matches('/');
        if trimmed.is_empty() {
            return String::new();
        }
        match trimmed.rfind('/') {
            Some(i) => trimmed[i + 1..].to_string(),
            None => trimmed.to_string(),
        }
    }

    /// JS: path.posix.basename(p, ext)
    pub fn basename_ext(p: &str, ext: &str) -> String {
        let b = basename(p);
        if !ext.is_empty() && b.len() > ext.len() && b.ends_with(ext) {
            b[..b.len() - ext.len()].to_string()
        } else {
            b
        }
    }

    /// JS: path.posix.extname
    pub fn extname(p: &str) -> String {
        let b = basename(p);
        // JS: leading dot without another dot => ''
        match b.rfind('.') {
            Some(0) | None => String::new(),
            Some(i) => {
                if i == b.len() - 1 {
                    ".".to_string()
                } else {
                    b[i..].to_string()
                }
            }
        }
    }
}

/// `path.win32`. Separators are `\` and `/`; output uses `\`. Drive
/// (`C:`) and UNC (`\\server\share`) devices are preserved; comparisons in
/// `relative` are case-insensitive, as Node's are.
pub mod win32 {
    fn is_sep(c: u8) -> bool {
        c == b'/' || c == b'\\'
    }

    fn is_drive_letter(c: u8) -> bool {
        c.is_ascii_alphabetic()
    }

    fn byte(p: &[u8], i: usize) -> u8 {
        p.get(i).copied().unwrap_or(0)
    }

    /// Parsed root of a win32 path: where the tail starts, the device
    /// (`C:` or `\\server\share`) if any, and whether the path is rooted.
    struct Root {
        root_end: usize,
        device: Option<String>,
        is_absolute: bool,
    }

    /// Node's root parsing as `resolve` does it (a UNC whose second part
    /// runs to the end still counts as a device).
    fn parse_root(p: &str) -> Root {
        let b = p.as_bytes();
        let len = b.len();
        let mut root = Root {
            root_end: 0,
            device: None,
            is_absolute: false,
        };
        if len == 0 {
            return root;
        }
        if is_sep(b[0]) {
            root.is_absolute = true;
            if is_sep(byte(b, 1)) {
                let mut j = 2;
                let mut last = j;
                while j < len && !is_sep(b[j]) {
                    j += 1;
                }
                if j < len && j != last {
                    let first_part = &p[last..j];
                    last = j;
                    while j < len && is_sep(b[j]) {
                        j += 1;
                    }
                    if j < len && j != last {
                        last = j;
                        while j < len && !is_sep(b[j]) {
                            j += 1;
                        }
                        if j == len || j != last {
                            root.device = Some(format!("\\\\{}\\{}", first_part, &p[last..j]));
                            root.root_end = j;
                        }
                    }
                }
            } else {
                root.root_end = 1;
            }
        } else if is_drive_letter(b[0]) && byte(b, 1) == b':' {
            root.device = Some(p[..2].to_string());
            root.root_end = 2;
            if len > 2 && is_sep(b[2]) {
                root.is_absolute = true;
                root.root_end = 3;
            }
        }
        root
    }

    /// JS: path.win32.isAbsolute
    pub fn is_absolute(p: &str) -> bool {
        let b = p.as_bytes();
        if b.is_empty() {
            return false;
        }
        is_sep(b[0]) || (b.len() > 2 && is_drive_letter(b[0]) && b[1] == b':' && is_sep(b[2]))
    }

    /// JS: path.win32.normalize
    pub fn normalize(p: &str) -> String {
        let b = p.as_bytes();
        let len = b.len();
        if len == 0 {
            return ".".to_string();
        }
        let mut root_end = 0usize;
        let mut device: Option<String> = None;
        let mut absolute = false;
        if is_sep(b[0]) {
            absolute = true;
            if is_sep(byte(b, 1)) {
                let mut j = 2;
                let mut last = j;
                while j < len && !is_sep(b[j]) {
                    j += 1;
                }
                if j < len && j != last {
                    let first_part = &p[last..j];
                    last = j;
                    while j < len && is_sep(b[j]) {
                        j += 1;
                    }
                    if j < len && j != last {
                        last = j;
                        while j < len && !is_sep(b[j]) {
                            j += 1;
                        }
                        if j == len {
                            // A UNC root only: return it with a trailing sep.
                            return format!("\\\\{}\\{}\\", first_part, &p[last..]);
                        }
                        if j != last {
                            device = Some(format!("\\\\{}\\{}", first_part, &p[last..j]));
                            root_end = j;
                        }
                    }
                }
            } else {
                root_end = 1;
            }
        } else if is_drive_letter(b[0]) && byte(b, 1) == b':' {
            device = Some(p[..2].to_string());
            root_end = 2;
            if len > 2 && is_sep(b[2]) {
                absolute = true;
                root_end = 3;
            }
        }
        let mut tail = if root_end < len {
            super::normalize_segments(&p[root_end..], !absolute, is_sep).join("\\")
        } else {
            String::new()
        };
        if tail.is_empty() && !absolute {
            tail = ".".to_string();
        }
        if !tail.is_empty() && is_sep(b[len - 1]) {
            tail.push('\\');
        }
        match device {
            None => {
                if absolute {
                    format!("\\{}", tail)
                } else {
                    tail
                }
            }
            Some(d) => {
                if absolute {
                    format!("{}\\{}", d, tail)
                } else {
                    format!("{}{}", d, tail)
                }
            }
        }
    }

    /// JS: path.win32.join
    pub fn join(parts: &[&str]) -> String {
        let mut joined: Option<String> = None;
        let mut first_part: &str = "";
        for arg in parts {
            if arg.is_empty() {
                continue;
            }
            match joined.as_mut() {
                None => {
                    joined = Some(arg.to_string());
                    first_part = arg;
                }
                Some(j) => {
                    j.push('\\');
                    j.push_str(arg);
                }
            }
        }
        let mut joined = match joined {
            None => return ".".to_string(),
            Some(j) => j,
        };
        // Make sure the joined path does not start with two slashes unless
        // the first part was a UNC root, because normalize() would mistake it
        // for one.
        let mut needs_replace = true;
        let mut slash_count = 0usize;
        let fb = first_part.as_bytes();
        if is_sep(fb[0]) {
            slash_count += 1;
            let first_len = fb.len();
            if first_len > 1 && is_sep(fb[1]) {
                slash_count += 1;
                if first_len > 2 {
                    if is_sep(fb[2]) {
                        slash_count += 1;
                    } else {
                        needs_replace = false;
                    }
                }
            }
        }
        if needs_replace {
            let jb = joined.as_bytes();
            while slash_count < jb.len() && is_sep(jb[slash_count]) {
                slash_count += 1;
            }
            if slash_count >= 2 {
                joined = format!("\\{}", &joined[slash_count..]);
            }
        }
        normalize(&joined)
    }

    /// JS: path.win32.resolve(...segments) with `cwd` standing in for
    /// `process.cwd()`. Node also consults the per-drive `=C:` environment
    /// entries for a drive-relative segment on another drive; that lookup is
    /// replaced by the drive root, which is what Node falls back to.
    pub fn resolve(cwd: &str, parts: &[&str]) -> String {
        let mut resolved_device = String::new();
        let mut resolved_tail = String::new();
        let mut resolved_absolute = false;
        let n = parts.len() as isize;
        let mut i = n - 1;
        while i >= -1 {
            let owned: String;
            let path: &str = if i >= 0 {
                parts[i as usize]
            } else if resolved_device.is_empty() {
                cwd
            } else {
                // Drive-relative: Node reads process.env['=' + device] or
                // process.cwd(); if that is on another drive it uses the
                // drive root.
                let cb = cwd.as_bytes();
                if !cwd
                    .get(..2)
                    .map(|s| s.eq_ignore_ascii_case(&resolved_device))
                    .unwrap_or(false)
                    && byte(cb, 2) == b'\\'
                {
                    owned = format!("{}\\", resolved_device);
                    &owned
                } else if cwd
                    .get(..2)
                    .map(|s| s.eq_ignore_ascii_case(&resolved_device))
                    .unwrap_or(false)
                {
                    cwd
                } else {
                    owned = format!("{}\\", resolved_device);
                    &owned
                }
            };
            i -= 1;
            if path.is_empty() {
                continue;
            }
            let root = parse_root(path);
            if let Some(device) = root.device.as_deref() {
                if !resolved_device.is_empty() {
                    if !device.eq_ignore_ascii_case(&resolved_device) {
                        // Different drive: skip.
                        continue;
                    }
                } else {
                    resolved_device = device.to_string();
                }
            }
            if resolved_absolute {
                if !resolved_device.is_empty() {
                    break;
                }
            } else {
                resolved_tail = format!("{}\\{}", &path[root.root_end..], resolved_tail);
                resolved_absolute = root.is_absolute;
                if root.is_absolute && !resolved_device.is_empty() {
                    break;
                }
            }
        }
        let tail = super::normalize_segments(&resolved_tail, !resolved_absolute, is_sep).join("\\");
        if resolved_absolute {
            format!("{}\\{}", resolved_device, tail)
        } else {
            let s = format!("{}{}", resolved_device, tail);
            if s.is_empty() {
                ".".to_string()
            } else {
                s
            }
        }
    }

    /// JS: path.win32.relative(from, to)
    pub fn relative(cwd: &str, from: &str, to: &str) -> String {
        if from == to {
            return String::new();
        }
        let from_orig = resolve(cwd, &[from]);
        let to_orig = resolve(cwd, &[to]);
        if from_orig == to_orig {
            return String::new();
        }
        let from_l = from_orig.to_lowercase();
        let to_l = to_orig.to_lowercase();
        if from_l == to_l {
            return String::new();
        }
        let fb = from_l.as_bytes();
        let tb = to_l.as_bytes();
        let ob = to_orig.as_bytes();

        let mut from_start = 0usize;
        while from_start < fb.len() && fb[from_start] == b'\\' {
            from_start += 1;
        }
        let mut from_end = fb.len();
        while from_end > from_start + 1 && fb[from_end - 1] == b'\\' {
            from_end -= 1;
        }
        let from_len = from_end - from_start;

        let mut to_start = 0usize;
        while to_start < tb.len() && tb[to_start] == b'\\' {
            to_start += 1;
        }
        let mut to_end = tb.len();
        while to_end > to_start + 1 && tb[to_end - 1] == b'\\' {
            to_end -= 1;
        }
        let to_len = to_end - to_start;

        let length = from_len.min(to_len);
        let mut last_common_sep: isize = -1;
        let mut i = 0usize;
        while i < length {
            let fc = fb[from_start + i];
            if fc != tb[to_start + i] {
                break;
            } else if fc == b'\\' {
                last_common_sep = i as isize;
            }
            i += 1;
        }
        if i != length {
            if last_common_sep == -1 {
                return to_orig;
            }
        } else {
            if to_len > length {
                if tb[to_start + i] == b'\\' {
                    return String::from_utf8_lossy(&ob[to_start + i + 1..]).into_owned();
                }
                if i == 2 {
                    return String::from_utf8_lossy(&ob[to_start + i..]).into_owned();
                }
            }
            if from_len > length {
                if fb[from_start + i] == b'\\' {
                    last_common_sep = i as isize;
                } else if i == 2 {
                    last_common_sep = 3;
                }
            }
            if last_common_sep == -1 {
                last_common_sep = 0;
            }
        }
        let mut out = String::new();
        let mut k = from_start + last_common_sep as usize + 1;
        while k <= from_end {
            if k == from_end || fb[k] == b'\\' {
                out.push_str(if out.is_empty() { ".." } else { "\\.." });
            }
            k += 1;
        }
        let mut to_start = to_start + last_common_sep as usize;
        if !out.is_empty() {
            out.push_str(&String::from_utf8_lossy(&ob[to_start..to_end]));
            return out;
        }
        if ob[to_start] == b'\\' {
            to_start += 1;
        }
        String::from_utf8_lossy(&ob[to_start..to_end]).into_owned()
    }

    /// JS: path.win32.dirname
    pub fn dirname(p: &str) -> String {
        let b = p.as_bytes();
        let len = b.len();
        if len == 0 {
            return ".".to_string();
        }
        let mut root_end: isize = -1;
        let mut offset = 0usize;
        let c0 = b[0];
        if len == 1 {
            return if is_sep(c0) {
                p.to_string()
            } else {
                ".".to_string()
            };
        }
        if is_sep(c0) {
            root_end = 1;
            offset = 1;
            if is_sep(b[1]) {
                let mut j = 2;
                let mut last = j;
                while j < len && !is_sep(b[j]) {
                    j += 1;
                }
                if j < len && j != last {
                    last = j;
                    while j < len && is_sep(b[j]) {
                        j += 1;
                    }
                    if j < len && j != last {
                        last = j;
                        while j < len && !is_sep(b[j]) {
                            j += 1;
                        }
                        if j == len {
                            return p.to_string();
                        }
                        if j != last {
                            root_end = (j + 1) as isize;
                            offset = j + 1;
                        }
                    }
                }
            }
        } else if is_drive_letter(c0) && b[1] == b':' {
            root_end = if len > 2 && is_sep(b[2]) { 3 } else { 2 };
            offset = root_end as usize;
        }
        let mut end: isize = -1;
        let mut matched_slash = true;
        let mut i = len as isize - 1;
        while i >= offset as isize {
            if is_sep(b[i as usize]) {
                if !matched_slash {
                    end = i;
                    break;
                }
            } else {
                matched_slash = false;
            }
            i -= 1;
        }
        if end == -1 {
            if root_end == -1 {
                return ".".to_string();
            }
            end = root_end;
        }
        p[..end as usize].to_string()
    }

    /// JS: path.win32.basename(p)
    pub fn basename(p: &str) -> String {
        basename_ext(p, "")
    }

    /// JS: path.win32.basename(p, suffix)
    pub fn basename_ext(p: &str, suffix: &str) -> String {
        let b = p.as_bytes();
        let len = b.len();
        let mut start = 0usize;
        let mut end: isize = -1;
        let mut matched_slash = true;
        // A drive letter prefix so the following separator is not mistaken
        // for an extra separator at the end of the path.
        if len >= 2 && is_drive_letter(b[0]) && b[1] == b':' {
            start = 2;
        }
        if !suffix.is_empty() && suffix.len() <= len {
            if suffix == p {
                return String::new();
            }
            let sb = suffix.as_bytes();
            let mut ext_idx: isize = sb.len() as isize - 1;
            let mut first_non_slash_end: isize = -1;
            let mut i = len as isize - 1;
            while i >= start as isize {
                let code = b[i as usize];
                if is_sep(code) {
                    if !matched_slash {
                        start = i as usize + 1;
                        break;
                    }
                } else {
                    if first_non_slash_end == -1 {
                        matched_slash = false;
                        first_non_slash_end = i + 1;
                    }
                    if ext_idx >= 0 {
                        if code == sb[ext_idx as usize] {
                            ext_idx -= 1;
                            if ext_idx == -1 {
                                end = i;
                            }
                        } else {
                            ext_idx = -1;
                            end = first_non_slash_end;
                        }
                    }
                }
                i -= 1;
            }
            if start as isize == end {
                end = first_non_slash_end;
            } else if end == -1 {
                end = len as isize;
            }
            return String::from_utf8_lossy(&b[start..end as usize]).into_owned();
        }
        let mut i = len as isize - 1;
        while i >= start as isize {
            if is_sep(b[i as usize]) {
                if !matched_slash {
                    start = i as usize + 1;
                    break;
                }
            } else if end == -1 {
                matched_slash = false;
                end = i + 1;
            }
            i -= 1;
        }
        if end == -1 {
            return String::new();
        }
        String::from_utf8_lossy(&b[start..end as usize]).into_owned()
    }

    /// JS: path.win32.extname
    pub fn extname(p: &str) -> String {
        let b = p.as_bytes();
        let len = b.len();
        let mut start = 0usize;
        let mut start_dot: isize = -1;
        let mut start_part = 0usize;
        let mut end: isize = -1;
        let mut matched_slash = true;
        // 0: nothing seen yet, 1: a non-dot after the dot, -1: chars before
        let mut pre_dot_state: i32 = 0;
        if len >= 2 && b[1] == b':' && is_drive_letter(b[0]) {
            start = 2;
            start_part = 2;
        }
        let mut i = len as isize - 1;
        while i >= start as isize {
            let code = b[i as usize];
            if is_sep(code) {
                if !matched_slash {
                    start_part = i as usize + 1;
                    break;
                }
                i -= 1;
                continue;
            }
            if end == -1 {
                matched_slash = false;
                end = i + 1;
            }
            if code == b'.' {
                if start_dot == -1 {
                    start_dot = i;
                } else if pre_dot_state != 1 {
                    pre_dot_state = 1;
                }
            } else if start_dot != -1 {
                pre_dot_state = -1;
            }
            i -= 1;
        }
        if start_dot == -1
            || end == -1
            || pre_dot_state == 0
            || (pre_dot_state == 1 && start_dot == end - 1 && start_dot == start_part as isize + 1)
        {
            return String::new();
        }
        String::from_utf8_lossy(&b[start_dot as usize..end as usize]).into_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn posix_basics() {
        use super::posix::*;
        assert_eq!(resolve("/a/b", &["c"]), "/a/b/c");
        assert_eq!(resolve("/a/b", &["../c"]), "/a/c");
        assert_eq!(resolve("/a/b", &["/x/y/", "z"]), "/x/y/z");
        assert_eq!(relative("/", "/a/b", "/a/c/d"), "../c/d");
        assert_eq!(relative("/", "/a/b", "/a/b"), "");
        assert_eq!(dirname("/a/b"), "/a");
        assert_eq!(dirname("/a"), "/");
        assert_eq!(dirname("a"), ".");
        assert_eq!(dirname("/a/b/"), "/a");
        assert_eq!(basename("/a/b.md"), "b.md");
        assert_eq!(basename("/a/b/"), "b");
        assert_eq!(basename_ext("/a/b.md", ".md"), "b");
        assert_eq!(extname("x.tar.gz"), ".gz");
        assert_eq!(extname(".bashrc"), "");
        assert_eq!(extname("a."), ".");
        assert_eq!(join(&["/a", "b", "../c"]), "/a/c");
        assert_eq!(join(&["a", ""]), "a");
        assert_eq!(normalize("./"), "./");
        assert_eq!(normalize("../a/./b/.."), "../a");
        assert_eq!(normalize("/a//b/../c/"), "/a/c/");
    }

    // Expected values below are `node -p "path.win32.X(...)"` output.
    #[test]
    fn win32_is_absolute() {
        use super::win32::is_absolute;
        assert!(is_absolute("C:\\foo"));
        assert!(is_absolute("C:/foo"));
        assert!(is_absolute("\\\\server\\share"));
        assert!(is_absolute("/foo"));
        assert!(is_absolute("\\foo"));
        assert!(!is_absolute("C:foo"));
        assert!(!is_absolute("foo"));
        assert!(!is_absolute(""));
        assert!(!is_absolute("C:"));
    }

    #[test]
    fn win32_normalize() {
        use super::win32::normalize;
        assert_eq!(normalize("C:/foo//bar/../baz/"), "C:\\foo\\baz\\");
        assert_eq!(normalize("C:\\foo\\..\\..\\bar"), "C:\\bar");
        assert_eq!(normalize("foo/../../bar"), "..\\bar");
        assert_eq!(normalize("./"), ".\\");
        assert_eq!(normalize(""), ".");
        assert_eq!(normalize("C:"), "C:.");
        assert_eq!(normalize("C:foo/bar"), "C:foo\\bar");
        assert_eq!(normalize("\\\\server\\share"), "\\\\server\\share\\");
        assert_eq!(
            normalize("\\\\server\\share\\a\\..\\b"),
            "\\\\server\\share\\b"
        );
        assert_eq!(normalize("/foo/bar"), "\\foo\\bar");
        assert_eq!(normalize("\\\\\\foo"), "\\foo");
    }

    #[test]
    fn win32_join() {
        use super::win32::join;
        assert_eq!(join(&["C:\\a", "b", "..\\c"]), "C:\\a\\c");
        assert_eq!(join(&["a", ""]), "a");
        assert_eq!(join(&[]), ".");
        assert_eq!(join(&["", ""]), ".");
        assert_eq!(join(&["/a", "b"]), "\\a\\b");
        assert_eq!(join(&["//server", "share", "x"]), "\\\\server\\share\\x");
        assert_eq!(join(&["\\\\", "a", "b"]), "\\a\\b");
        assert_eq!(join(&["C:", "foo"]), "C:\\foo");
        assert_eq!(join(&["C:/", "foo/"]), "C:\\foo\\");
    }

    #[test]
    fn win32_resolve() {
        use super::win32::resolve;
        assert_eq!(resolve("C:\\Users\\me", &["c"]), "C:\\Users\\me\\c");
        assert_eq!(resolve("C:\\Users\\me", &["..\\c"]), "C:\\Users\\c");
        assert_eq!(
            resolve("C:\\Users\\me", &["D:\\x\\y\\", "z"]),
            "D:\\x\\y\\z"
        );
        assert_eq!(resolve("C:\\Users\\me", &["/x/y"]), "C:\\x\\y");
        assert_eq!(resolve("C:\\Users\\me", &["C:foo"]), "C:\\Users\\me\\foo");
        assert_eq!(resolve("C:\\Users\\me", &["D:foo"]), "D:\\foo");
        assert_eq!(resolve("C:\\Users\\me", &[]), "C:\\Users\\me");
        assert_eq!(resolve("C:\\Users\\me", &["", ""]), "C:\\Users\\me");
        assert_eq!(
            resolve("C:\\Users\\me", &["\\\\srv\\share\\a", "..\\b"]),
            "\\\\srv\\share\\b"
        );
        assert_eq!(resolve("C:\\Users\\me", &["a", "D:\\b", "c"]), "D:\\b\\c");
        assert_eq!(
            resolve("C:\\Users\\me", &["a/b/", "../c"]),
            "C:\\Users\\me\\a\\c"
        );
        // A "/" cwd (callers that only pass absolute paths) resolves to the
        // drive-less root, as Node does without a cwd for that device.
        assert_eq!(resolve("/", &["C:\\a\\b"]), "C:\\a\\b");
        assert_eq!(resolve("/", &["a"]), "\\a");
    }

    #[test]
    fn win32_relative() {
        use super::win32::relative;
        let cwd = "C:\\w";
        assert_eq!(relative(cwd, "C:\\a\\b", "C:\\a\\c\\d"), "..\\c\\d");
        assert_eq!(relative(cwd, "C:\\a\\b", "C:\\a\\b"), "");
        assert_eq!(relative(cwd, "C:\\a\\b", "c:\\A\\B\\"), "");
        assert_eq!(relative(cwd, "C:\\a", "C:\\a\\b\\c"), "b\\c");
        assert_eq!(relative(cwd, "C:\\a\\b\\c", "C:\\a"), "..\\..");
        assert_eq!(relative(cwd, "C:\\a\\b", "D:\\a\\b"), "D:\\a\\b");
        assert_eq!(relative(cwd, "C:\\", "C:\\foo"), "foo");
        assert_eq!(relative(cwd, "C:\\foo", "C:\\"), "..");
        assert_eq!(relative(cwd, "C:\\a\\bb", "C:\\a\\b"), "..\\b");
        assert_eq!(relative(cwd, "C:\\a\\b", "C:\\a\\bb"), "..\\bb");
        assert_eq!(relative(cwd, "x", "x\\y"), "y");
        assert_eq!(relative(cwd, "C:\\a\\b", "C:\\a\\b\\c\\d"), "c\\d");
        assert_eq!(
            relative(cwd, "\\\\srv\\share\\a", "\\\\srv\\share\\b"),
            "..\\b"
        );
        assert_eq!(
            relative(cwd, "C:\\w\\src", "C:\\w\\src\\App.tsx"),
            "App.tsx"
        );
    }

    #[test]
    fn win32_dirname() {
        use super::win32::dirname;
        assert_eq!(dirname("C:\\a\\b"), "C:\\a");
        assert_eq!(dirname("C:\\a"), "C:\\");
        assert_eq!(dirname("C:\\"), "C:\\");
        assert_eq!(dirname("C:"), "C:");
        assert_eq!(dirname("C:foo"), "C:");
        assert_eq!(dirname("a"), ".");
        assert_eq!(dirname("a\\b\\"), "a");
        assert_eq!(dirname("/a/b"), "/a");
        assert_eq!(dirname("\\a"), "\\");
        assert_eq!(dirname("\\\\srv\\share\\a\\b"), "\\\\srv\\share\\a");
        assert_eq!(dirname("\\\\srv\\share\\a"), "\\\\srv\\share\\");
        assert_eq!(dirname("\\\\srv\\share"), "\\\\srv\\share");
        assert_eq!(dirname(""), ".");
        assert_eq!(dirname("\\"), "\\");
    }

    #[test]
    fn win32_basename() {
        use super::win32::{basename, basename_ext};
        assert_eq!(basename("C:\\a\\b.md"), "b.md");
        assert_eq!(basename("C:\\a\\b\\"), "b");
        assert_eq!(basename("C:\\"), "");
        assert_eq!(basename("C:foo"), "foo");
        assert_eq!(basename("C:"), "");
        assert_eq!(basename("a/b/c.txt"), "c.txt");
        assert_eq!(basename(""), "");
        assert_eq!(basename_ext("C:\\a\\b.md", ".md"), "b");
        assert_eq!(basename_ext("C:\\a\\b.md", ".txt"), "b.md");
        assert_eq!(basename_ext("C:\\a\\.md", ".md"), ".md");
        assert_eq!(basename_ext("b.md", "b.md"), "");
        assert_eq!(basename_ext("C:\\a\\b.md\\", ".md"), "b");
        assert_eq!(basename_ext("aaa", "a"), "aa");
    }

    #[test]
    fn win32_extname() {
        use super::win32::extname;
        assert_eq!(extname("C:\\a\\x.tar.gz"), ".gz");
        assert_eq!(extname("C:\\a\\.bashrc"), "");
        assert_eq!(extname("C:\\a\\a."), ".");
        assert_eq!(extname("C:.bashrc"), "");
        assert_eq!(extname("C:x.md"), ".md");
        assert_eq!(extname("a/b.c/d"), "");
        assert_eq!(extname("a\\b\\"), "");
        assert_eq!(extname(".."), "");
        assert_eq!(extname("..a"), ".a");
        assert_eq!(extname("a..b"), ".b");
    }

    #[test]
    fn dispatch_matches_platform() {
        if cfg!(windows) {
            assert_eq!(SEP, "\\");
            assert_eq!(join(&["a", "b"]), "a\\b");
            assert_eq!(to_posix("a\\b"), "a/b");
        } else {
            assert_eq!(SEP, "/");
            assert_eq!(join(&["a", "b"]), "a/b");
            assert_eq!(to_posix("a\\b"), "a\\b");
        }
    }
}
