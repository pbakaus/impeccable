//! JS: lib/target-slug.mjs

use crate::jsp;
use crate::util::js_trim;
use sha2::{Digest, Sha256};

const SLUG_MAX: usize = 50;
const SLUG_HASH_LEN: usize = 8;

/// JS: slugFromTarget(resolved, { cwd })
pub fn slug_from_target(resolved: Option<&str>, cwd: &str) -> Option<String> {
    slug_from_target_using(resolved, cwd, kebab)
}

/// Compatibility key used by releases that truncated normalized targets to
/// their last 50 characters without a hash suffix.
pub(crate) fn legacy_slug_from_target(resolved: Option<&str>, cwd: &str) -> Option<String> {
    slug_from_target_using(resolved, cwd, legacy_kebab)
}

fn slug_from_target_using(
    resolved: Option<&str>,
    cwd: &str,
    slugger: fn(&str) -> Option<String>,
) -> Option<String> {
    let resolved = resolved?;
    let trimmed = js_trim(resolved);
    if trimmed.is_empty() {
        return None;
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        let (host, pathname) = parse_url_host_path(trimmed)?;
        return slugger(&format!("{}{}", host, pathname));
    }
    let abs = if jsp::is_absolute(trimmed) { trimmed.to_string() } else { jsp::resolve(cwd, &[trimmed]) };
    let mut rel = jsp::relative(cwd, cwd, &abs);
    if rel.starts_with("..") || jsp::is_absolute(&rel) {
        rel = jsp::basename(&abs);
    }
    if rel.is_empty() || rel == "." {
        return None;
    }
    slugger(&rel)
}

/// Minimal WHATWG URL parse for http(s): returns (hostname lowercased, pathname).
/// Returns None when `new URL()` would throw.
pub fn parse_url_host_path(s: &str) -> Option<(String, String)> {
    let u = crate::url::parse(s)?;
    Some((u.hostname, u.pathname))
}

/// JS: kebab(value)
pub fn kebab(value: &str) -> Option<String> {
    let u = normalized_kebab(value)?;
    if u.len() <= SLUG_MAX {
        Some(u)
    } else {
        let digest = Sha256::digest(u.as_bytes());
        let hash = format!("{digest:x}");
        let tail_len = SLUG_MAX - SLUG_HASH_LEN - 1;
        let tail = &u[u.len() - tail_len..];
        let tail = tail.strip_prefix('-').unwrap_or(tail);
        Some(format!("{tail}-{}", &hash[..SLUG_HASH_LEN]))
    }
}

fn legacy_kebab(value: &str) -> Option<String> {
    let u = normalized_kebab(value)?;
    if u.len() <= SLUG_MAX {
        Some(u)
    } else {
        let tail = &u[u.len() - SLUG_MAX..];
        Some(tail.strip_prefix('-').unwrap_or(tail).to_string())
    }
}

fn normalized_kebab(value: &str) -> Option<String> {
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
    (!u.is_empty()).then_some(u)
}

#[cfg(test)]
mod tests {
    use super::{kebab, legacy_kebab, SLUG_MAX};

    #[test]
    fn truncated_slugs_keep_distinct_full_inputs_distinct() {
        let suffix = "a".repeat(SLUG_MAX);
        let alpha = kebab(&format!("alpha-prefix-{suffix}")).unwrap();
        let beta = kebab(&format!("beta-prefix-{suffix}")).unwrap();

        assert_ne!(alpha, beta);
        assert!(alpha.len() <= SLUG_MAX);
        assert!(beta.len() <= SLUG_MAX);
        assert_eq!(alpha, kebab(&format!("alpha-prefix-{suffix}")).unwrap());
    }

    #[test]
    fn non_truncated_slugs_are_unchanged() {
        assert_eq!(kebab("Button.Primary"), Some("button-primary".to_string()));
        assert_eq!(kebab(&"a".repeat(SLUG_MAX)), Some("a".repeat(SLUG_MAX)));
    }

    #[test]
    fn legacy_kebab_preserves_the_previous_truncation_key() {
        let value = "a-very-long-directory-structure-with-many-segments-component-name.tsx";
        assert_eq!(
            legacy_kebab(value),
            Some("ry-structure-with-many-segments-component-name-tsx".to_string())
        );
    }
}
