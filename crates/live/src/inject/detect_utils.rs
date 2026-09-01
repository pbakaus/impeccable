//! JS: live/frameworks/detect-utils.mjs. Cheap, failure-tolerant probes the
//! framework detectors share.

use crate::config::LiveConfig;
use crate::util::{exists, jsp, read_dir_raw, read_json};
use regex::Regex;
use serde_json::{Map, Value};

/// JS: readPackageDeps(cwd): dependencies + devDependencies + peerDependencies
/// merged (later wins), or empty.
pub fn read_package_deps(cwd: &str) -> Map<String, Value> {
    match read_json(&jsp::join(&[cwd, "package.json"])) {
        Some(pkg) => read_package_deps_from(&pkg),
        None => Map::new(),
    }
}

/// The merge step of `readPackageDeps` over an already-parsed package.json.
pub fn read_package_deps_from(pkg: &Value) -> Map<String, Value> {
    let mut out = Map::new();
    for key in ["dependencies", "devDependencies", "peerDependencies"] {
        if let Some(obj) = pkg.get(key).and_then(|v| v.as_object()) {
            for (k, v) in obj {
                out.insert(k.clone(), v.clone());
            }
        }
    }
    out
}

pub fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().map(|f| f != 0.0 && !f.is_nan()).unwrap_or(false),
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}

/// JS: hasAnyDependency(cwd, names)
pub fn has_any_dependency(cwd: &str, names: &[&str]) -> bool {
    let deps = read_package_deps(cwd);
    names
        .iter()
        .any(|n| deps.get(*n).map(truthy).unwrap_or(false))
}

/// JS: findConfigFile(cwd, re): first top-level FILE (readdir order) whose
/// name matches.
pub fn find_config_file(cwd: &str, re: &Regex) -> Option<String> {
    let entries = read_dir_raw(cwd)?;
    entries
        .into_iter()
        .find(|e| e.is_file && re.is_match(&e.name))
        .map(|e| e.name)
}

/// JS: fileExists(cwd, rel)
pub fn file_exists(cwd: &str, rel: &str) -> bool {
    exists(&jsp::join(&[cwd, rel]))
}

/// JS: firstExistingFile(cwd, candidates)
pub fn first_existing_file(cwd: &str, candidates: &[&str]) -> Option<String> {
    candidates
        .iter()
        .find(|c| file_exists(cwd, c))
        .map(|c| c.to_string())
}

/// JS: literalConfigFiles(cwd, config): non-glob `config.files` entries that
/// exist on disk.
pub fn literal_config_files(cwd: &str, config: Option<&LiveConfig>) -> Vec<String> {
    let mut out = Vec::new();
    let files = config.map(|c| c.files()).unwrap_or_default();
    for rel in files {
        if rel.contains('*') || rel.contains('?') {
            continue;
        }
        let normalized = jsp::to_posix(&rel);
        if file_exists(cwd, &normalized) {
            out.push(normalized);
        }
    }
    out
}
