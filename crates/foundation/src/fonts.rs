//! Port of `cli/engine/shared/fonts.mjs`.

use crate::js::{self, ci, WS_CHARS};
use once_cell::sync::Lazy;
use regex::Regex;

/// JS `GOOGLE_FONTS_URL_RE` = `/fonts\.googleapis\.com\/css2?\?[^"'\s)<>]*/gi`.
static GOOGLE_FONTS_URL_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        r#"{fonts}\.{googleapis}\.{com}/{css}2?\?[^"'{WSC})<>]*"#,
        fonts = ci("fonts"),
        googleapis = ci("googleapis"),
        com = ci("com"),
        css = ci("css"),
        WSC = WS_CHARS
    ))
    .unwrap()
});

/// JS `normalizeGoogleFontFamilyParam(value)`.
pub fn normalize_google_font_family_param(value: &str) -> Vec<String> {
    value
        .split('|')
        .map(|part| js::to_lower_case(js::trim(part.split(':').next().unwrap_or(""))))
        .filter(|s| !s.is_empty())
        .collect()
}

/// Percent-decode one application/x-www-form-urlencoded value the way
/// `URLSearchParams` does: `+` is a space, `%XX` is a byte, invalid UTF-8
/// becomes U+FFFD.
fn form_urldecode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        if b == b'+' {
            out.push(b' ');
            i += 1;
        } else if b == b'%' && i + 2 < bytes.len() {
            let h = &bytes[i + 1..i + 3];
            match std::str::from_utf8(h)
                .ok()
                .and_then(|hs| u8::from_str_radix(hs, 16).ok())
            {
                Some(v) if h.iter().all(|c| c.is_ascii_hexdigit()) => {
                    out.push(v);
                    i += 3;
                }
                _ => {
                    out.push(b'%');
                    i += 1;
                }
            }
        } else {
            out.push(b);
            i += 1;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// `new URLSearchParams(query).getAll('family')`.
fn get_all_family(query: &str) -> Vec<String> {
    let mut out = Vec::new();
    for pair in query.split('&') {
        if pair.is_empty() {
            continue;
        }
        let (name, value) = match pair.find('=') {
            Some(i) => (&pair[..i], &pair[i + 1..]),
            None => (pair, ""),
        };
        if form_urldecode(name) == "family" {
            out.push(form_urldecode(value));
        }
    }
    out
}

/// JS `extractGoogleFontFamilies(text)`.
pub fn extract_google_font_families(text: &str) -> Vec<String> {
    let mut families = Vec::new();
    if text.is_empty() {
        return families;
    }
    for m in GOOGLE_FONTS_URL_RE.find_iter(text) {
        let url = m.as_str();
        let Some(query_start) = url.find('?') else {
            continue;
        };
        let query = url[query_start + 1..].replace("&amp;", "&");
        for value in get_all_family(&query) {
            families.extend(normalize_google_font_family_param(&value));
        }
    }
    families
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_families() {
        let html = r#"<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&amp;family=Playfair+Display&display=swap" rel="stylesheet">"#;
        assert_eq!(
            extract_google_font_families(html),
            vec!["inter", "playfair display"]
        );
        let css = "@import url(https://fonts.googleapis.com/css?family=Roboto|Open+Sans:400,700);";
        assert_eq!(
            extract_google_font_families(css),
            vec!["roboto", "open sans"]
        );
        assert!(extract_google_font_families("").is_empty());
        assert_eq!(form_urldecode("a%20b%zz+c%E2%9C%93"), "a b%zz c\u{2713}");
    }
}
