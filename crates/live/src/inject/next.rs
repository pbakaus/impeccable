//! JS: live/frameworks/nextjs.mjs. Tag strategy; the entry exists so the
//! registry can name the project.

use super::detect_utils::{file_exists, find_config_file, has_any_dependency};
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{json, Value};

static NEXT_CONFIG_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^next\.config\.(?:js|mjs|cjs|ts|mts|cts)$").unwrap());

const ROUTER_ENTRY_CANDIDATES: &[&str] = &[
    "app/layout.tsx",
    "app/layout.jsx",
    "app/layout.ts",
    "app/layout.js",
    "src/app/layout.tsx",
    "src/app/layout.jsx",
    "src/app/layout.ts",
    "src/app/layout.js",
    "pages/_app.tsx",
    "pages/_app.jsx",
    "pages/_app.ts",
    "pages/_app.js",
    "pages/_document.tsx",
    "pages/_document.jsx",
    "src/pages/_app.tsx",
    "src/pages/_app.jsx",
];

/// JS: detectNextProject(cwd)
pub fn detect_next_project(cwd: &str) -> Option<Value> {
    if let Some(cf) = find_config_file(cwd, &NEXT_CONFIG_RE) {
        return Some(json!({ "configFile": cf, "via": "config" }));
    }
    if has_any_dependency(cwd, &["next"]) {
        return Some(json!({ "configFile": null, "via": "package" }));
    }
    if let Some(entry) = ROUTER_ENTRY_CANDIDATES
        .iter()
        .find(|rel| file_exists(cwd, rel))
    {
        return Some(json!({ "configFile": null, "via": "router-entry", "entry": entry }));
    }
    None
}
