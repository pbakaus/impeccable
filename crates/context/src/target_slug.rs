//! JS: lib/target-slug.mjs

use crate::jsp;
use crate::util::js_trim;

const SLUG_MAX: usize = 50;

/// JS: slugFromTarget(resolved, { cwd })
pub fn slug_from_target(resolved: Option<&str>, cwd: &str) -> Option<String> {
    let resolved = resolved?;
    let trimmed = js_trim(resolved);
    if trimmed.is_empty() {
        return None;
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        let (host, pathname) = parse_url_host_path(trimmed)?;
        return kebab(&format!("{}{}", host, pathname));
    }
    let abs = if jsp::is_absolute(trimmed) { trimmed.to_string() } else { jsp::resolve(cwd, &[trimmed]) };
    let mut rel = jsp::relative(cwd, cwd, &abs);
    if rel.starts_with("..") || jsp::is_absolute(&rel) {
        rel = jsp::basename(&abs);
    }
    if rel.is_empty() || rel == "." {
        return None;
    }
    kebab(&rel)
}

/// Minimal WHATWG URL parse for http(s): returns (hostname lowercased, pathname).
/// Returns None when `new URL()` would throw.
pub fn parse_url_host_path(s: &str) -> Option<(String, String)> {
    let u = crate::url::parse(s)?;
    Some((u.hostname, u.pathname))
}

/// JS: kebab(value)
pub fn kebab(value: &str) -> Option<String> {
    let lower = value.to_lowercase();
    // replace runs of / \ . with '-'
    let mut s = String::with_capacity(lower.len());
    let mut in_sep = false;
    for c in lower.chars() {
        if c == '/' || c == '\\' || c == '.' {
            if !in_sep {
                s.push('-');
                in_sep = true;
            }
        } else {
            in_sep = false;
            s.push(c);
        }
    }
    // replace runs of [^a-z0-9-] with '-'
    let mut t = String::with_capacity(s.len());
    let mut in_bad = false;
    for c in s.chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' {
            in_bad = false;
            t.push(c);
        } else if !in_bad {
            t.push('-');
            in_bad = true;
        }
    }
    // collapse -+
    let mut u = String::with_capacity(t.len());
    let mut in_dash = false;
    for c in t.chars() {
        if c == '-' {
            if !in_dash {
                u.push('-');
                in_dash = true;
            }
        } else {
            in_dash = false;
            u.push(c);
        }
    }
    // strip leading/trailing '-' (JS: /^-|-$/g -> one at each end; after collapse there is at most one)
    let u = u.strip_prefix('-').unwrap_or(&u).to_string();
    let u = u.strip_suffix('-').unwrap_or(&u).to_string();
    if u.is_empty() {
        return None;
    }
    if u.len() <= SLUG_MAX {
        Some(u)
    } else {
        let tail = &u[u.len() - SLUG_MAX..];
        Some(tail.strip_prefix('-').unwrap_or(tail).to_string())
    }
}
