//! JS: live/frameworks/static-html.mjs + vite-generic.mjs. Both take the
//! generic tag strategy; static-html is the terminal fallback.

use super::detect_utils::{file_exists, find_config_file, has_any_dependency};
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{json, Value};

static VITE_CONFIG_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^vite\.config\.(?:js|mjs|cjs|ts|mts|cts)$").unwrap());

/// JS: detectViteProject(cwd)
pub fn detect_vite_project(cwd: &str) -> Option<Value> {
    if let Some(cf) = find_config_file(cwd, &VITE_CONFIG_RE) {
        return Some(json!({ "configFile": cf, "via": "config" }));
    }
    if has_any_dependency(cwd, &["vite"]) {
        return Some(json!({ "configFile": null, "via": "package" }));
    }
    if file_exists(cwd, "index.html") && file_exists(cwd, "package.json") {
        return Some(json!({ "configFile": null, "via": "zero-config" }));
    }
    None
}

/// JS: staticHtml.detect()
pub fn detect_static_html() -> Option<Value> {
    Some(json!({ "via": "fallback" }))
}
