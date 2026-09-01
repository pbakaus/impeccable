//! JS: live/frameworks/astro.mjs. Tag strategy with `is:inline` script attrs
//! and global-prefixed preview CSS.

use super::detect_utils::{find_config_file, has_any_dependency, literal_config_files};
use crate::config::LiveConfig;
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{json, Value};

static ASTRO_CONFIG_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^astro\.config\.(?:js|mjs|cjs|ts|mts|cts)$").unwrap());

/// JS: detectAstroProject(cwd, config)
pub fn detect_astro_project(cwd: &str, config: Option<&LiveConfig>) -> Option<Value> {
    if let Some(cf) = find_config_file(cwd, &ASTRO_CONFIG_RE) {
        return Some(json!({ "configFile": cf, "via": "config" }));
    }
    if has_any_dependency(cwd, &["astro"]) {
        return Some(json!({ "configFile": null, "via": "package" }));
    }
    if let Some(entry) = literal_config_files(cwd, config)
        .into_iter()
        .find(|r| r.ends_with(".astro"))
    {
        return Some(json!({ "configFile": null, "via": "config-files", "entry": entry }));
    }
    None
}
