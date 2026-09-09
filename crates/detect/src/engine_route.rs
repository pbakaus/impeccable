//! Shared HTML-vs-text engine routing for `detect` and the design hook.
//!
//! `impeccable detect` used to route on last-segment `extname` against
//! `.html`/`.htm` only. The hook already suffix-matched `detector.extensions`.
//! This module is the one map both sides consult so a `.vue`, `.blade.php`,
//! or configured `.html.erb` file gets the same engine either way.

use impeccable_core::js;
use impeccable_core::js_ext_b::utf16_len;
use serde_json::Value;

use crate::jsp;

/// Built-in suffixes that emit markup and therefore run the DOM engine.
/// Multi-part suffixes (`.blade.php`) match via [`str::ends_with`] on the
/// basename, not last-segment `extname`.
pub const HTML_ENGINE_EXTENSIONS: &[&str] = &[
    ".html",
    ".htm",
    ".vue",
    ".svelte",
    ".astro",
    ".blade.php",
];

/// One `detector.extensions` entry after `normalizeExtensionEntries`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExtensionEntry {
    pub ext: String,
    pub engine: String,
}

/// JS: template-extensions.mjs#normalizeExtensionEntries
pub fn normalize_extension_entries(entries: &[Value]) -> Vec<ExtensionEntry> {
    let mut out = Vec::new();
    for entry in entries {
        let (raw, is_string, engine_text) = match entry {
            Value::String(s) => (Some(s.as_str()), true, false),
            Value::Object(o) => (
                match o.get("ext") {
                    Some(Value::String(s)) => Some(s.as_str()),
                    _ => None,
                },
                false,
                o.get("engine") == Some(&Value::String("text".to_string())),
            ),
            _ => (None, false, false),
        };
        let Some(raw) = raw else { continue };
        let mut ext = js::to_lower_case(js::trim(raw));
        if ext.is_empty() {
            continue;
        }
        if !ext.starts_with('.') {
            ext = format!(".{ext}");
        }
        let engine = if !is_string && engine_text {
            "text"
        } else {
            "html"
        };
        out.push(ExtensionEntry {
            ext,
            engine: engine.to_string(),
        });
    }
    out
}

/// JS: template-extensions.mjs#mergeExtensions
pub fn merge_extensions(existing: &[ExtensionEntry], incoming: &[Value]) -> Vec<ExtensionEntry> {
    let mut map: Vec<(String, ExtensionEntry)> = Vec::new();
    for e in existing {
        upsert_ext(&mut map, e.ext.clone(), e.clone());
    }
    for e in normalize_extension_entries(incoming) {
        upsert_ext(&mut map, e.ext.clone(), e);
    }
    map.into_iter().map(|(_, e)| e).collect()
}

fn upsert_ext(map: &mut Vec<(String, ExtensionEntry)>, key: String, val: ExtensionEntry) {
    if let Some(slot) = map.iter_mut().find(|(k, _)| *k == key) {
        slot.1 = val;
    } else {
        map.push((key, val));
    }
}

fn suffix_matches(name: &str, ext: &str) -> bool {
    utf16_len(name) > utf16_len(ext) && name.ends_with(ext)
}

/// JS: template-extensions.mjs#matchConfiguredExtension. Longest matching
/// suffix wins. The basename must be strictly longer than the suffix so a
/// file named `.php` is not treated as a template.
pub fn match_configured_extension<'a>(
    file_path: &str,
    extensions: &'a [ExtensionEntry],
) -> Option<&'a ExtensionEntry> {
    if extensions.is_empty() {
        return None;
    }
    let name = js::to_lower_case(&jsp::basename(file_path));
    if name.is_empty() {
        return None;
    }
    let mut best: Option<&ExtensionEntry> = None;
    for entry in extensions {
        if suffix_matches(&name, &entry.ext)
            && best
                .map(|b| utf16_len(&entry.ext) > utf16_len(&b.ext))
                .unwrap_or(true)
        {
            best = Some(entry);
        }
    }
    best
}

/// Longest built-in [`HTML_ENGINE_EXTENSIONS`] suffix on `file_path`, if any.
pub fn match_html_engine_extension(file_path: &str) -> Option<&'static str> {
    let name = js::to_lower_case(&jsp::basename(file_path));
    if name.is_empty() {
        return None;
    }
    let mut best: Option<&'static str> = None;
    for ext in HTML_ENGINE_EXTENSIONS {
        if suffix_matches(&name, ext)
            && best
                .map(|b| utf16_len(ext) > utf16_len(b))
                .unwrap_or(true)
        {
            best = Some(*ext);
        }
    }
    best
}

/// Whether `file_path` should run the DOM/HTML engine.
///
/// Configured `detector.extensions` are authoritative on equal-or-longer
/// suffix length (so `{ext:".vue", engine:"text"}` can opt a built-in out).
/// A longer built-in suffix still wins over a shorter configured one
/// (`page.blade.php` stays HTML even if `.php` is configured as `text`).
pub fn uses_html_engine(file_path: &str, configured: &[ExtensionEntry]) -> bool {
    let configured_match = match_configured_extension(file_path, configured);
    let builtin = match_html_engine_extension(file_path);
    match (configured_match, builtin) {
        (Some(c), Some(b)) => {
            if utf16_len(&c.ext) >= utf16_len(b) {
                c.engine == "html"
            } else {
                true
            }
        }
        (Some(c), None) => c.engine == "html",
        (None, Some(_)) => true,
        (None, None) => false,
    }
}

/// Label written to hook audit `ext` and useful in tests: configured suffix,
/// else the built-in HTML-engine suffix, else last-segment `extname`.
pub fn extension_label(file_path: &str, configured: &[ExtensionEntry]) -> String {
    if let Some(c) = match_configured_extension(file_path, configured) {
        return c.ext.clone();
    }
    if let Some(ext) = match_html_engine_extension(file_path) {
        return ext.to_string();
    }
    js::to_lower_case(&jsp::extname(file_path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn builtin_markup_is_html_without_config() {
        for path in [
            "/x/page.html",
            "/x/page.HTM",
            "/x/Card.vue",
            "/x/Widget.svelte",
            "/x/index.astro",
            "/x/show.blade.php",
            "/x/SHOW.BLADE.PHP",
        ] {
            assert!(
                uses_html_engine(path, &[]),
                "{path} should be DOM-routed with no config"
            );
        }
        assert!(!uses_html_engine("/x/page.css", &[]));
        assert!(!uses_html_engine("/x/page.tsx", &[]));
        assert!(!uses_html_engine("/x/page.php", &[]));
        assert!(!uses_html_engine("/x/page.html.erb", &[]));
    }

    #[test]
    fn multipart_suffix_not_last_segment_extname() {
        assert_eq!(
            match_html_engine_extension("views/show.blade.php"),
            Some(".blade.php")
        );
        assert!(match_html_engine_extension("views/show.php").is_none());
        assert!(match_html_engine_extension(".blade.php").is_none());
    }

    #[test]
    fn configured_html_erb_is_dom() {
        let exts = normalize_extension_entries(&[json!({"ext": ".html.erb", "engine": "html"})]);
        assert!(uses_html_engine("/x/page.html.erb", &exts));
        assert_eq!(
            match_configured_extension("/x/SHOW.HTML.ERB", &exts)
                .unwrap()
                .engine,
            "html"
        );
        assert!(!uses_html_engine("/x/page.erb", &exts));
    }

    #[test]
    fn configured_override_is_authoritative_on_equal_length() {
        let exts = normalize_extension_entries(&[json!({"ext": ".vue", "engine": "text"})]);
        assert!(!uses_html_engine("/x/Card.vue", &exts));
        assert!(uses_html_engine("/x/page.html", &exts));
    }

    #[test]
    fn longest_suffix_wins_builtin_over_shorter_configured() {
        let exts = normalize_extension_entries(&[json!({"ext": ".php", "engine": "text"})]);
        assert!(
            uses_html_engine("/x/show.blade.php", &exts),
            ".blade.php is longer than configured .php"
        );
        assert!(!uses_html_engine("/x/a.php", &exts));
    }

    #[test]
    fn longest_configured_suffix_wins() {
        let exts = normalize_extension_entries(&[
            json!(".php"),
            json!({"ext": "blade.php", "engine": "html"}),
            json!({"ext": ".HTML.erb", "engine": "text"}),
        ]);
        assert_eq!(
            match_configured_extension("/x/show.blade.php", &exts)
                .unwrap()
                .ext,
            ".blade.php"
        );
        assert_eq!(
            match_configured_extension("/x/SHOW.HTML.ERB", &exts)
                .unwrap()
                .engine,
            "text"
        );
        assert_eq!(
            match_configured_extension("/x/a.php", &exts).unwrap().ext,
            ".php"
        );
    }
}
