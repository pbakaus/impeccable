//! The persisted live manifests: `<appRoot>/.impeccable/live/roots.json`
//! (`RootsManifest`) and the repo pointer
//! `<repoRoot>/.impeccable/live/app-root.json`. JS: live/roots.mjs (the
//! read/write half).

use crate::util::{iso_now, json_pretty, jsp, read_json, write_file};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const ROOTS_MANIFEST_VERSION: i64 = 1;
pub const ROOTS_FILE: &str = "roots.json";
pub const POINTER_FILE: &str = "app-root.json";

/// JS: the object `resolveRoots` returns as `manifest` (field order is the
/// JSON order).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RootsManifest {
    pub version: i64,
    #[serde(rename = "appRoot")]
    pub app_root: String,
    #[serde(rename = "repoRoot")]
    pub repo_root: String,
    #[serde(rename = "contextRoot")]
    pub context_root: Option<String>,
    #[serde(rename = "sessionRoot")]
    pub session_root: String,
    #[serde(rename = "productPath")]
    pub product_path: Option<String>,
    #[serde(rename = "designPath")]
    pub design_path: Option<String>,
    #[serde(rename = "resolvedFrom")]
    pub resolved_from: Option<String>,
}

impl RootsManifest {
    pub fn to_value(&self) -> Value {
        serde_json::to_value(self).unwrap_or(Value::Null)
    }
}

/// JS: rootsFilePath(appRoot)
pub fn roots_file_path(app_root: &str) -> String {
    jsp::join(&[app_root, ".impeccable", "live", ROOTS_FILE])
}

/// JS: pointerFilePath(repoRoot)
pub fn pointer_file_path(repo_root: &str) -> String {
    jsp::join(&[repo_root, ".impeccable", "live", POINTER_FILE])
}

/// One entry of the v2 pointer file.
#[derive(Debug, Clone)]
pub struct PointerEntry {
    pub app_root: String,
    /// The entry verbatim (v1 entries carry only `appRoot`).
    pub raw: Value,
}

/// JS: readPointerEntries(repoRoot)
pub fn read_pointer_entries(repo_root: &str) -> Vec<PointerEntry> {
    let Some(raw) = read_json(&pointer_file_path(repo_root)) else {
        return vec![];
    };
    if let Some(arr) = raw.get("appRoots").and_then(|a| a.as_array()) {
        return arr
            .iter()
            .filter_map(|e| {
                let app_root = e.get("appRoot")?.as_str()?.to_string();
                Some(PointerEntry {
                    app_root,
                    raw: e.clone(),
                })
            })
            .collect();
    }
    if let Some(app_root) = raw.get("appRoot").and_then(|a| a.as_str()) {
        return vec![PointerEntry {
            app_root: app_root.to_string(),
            raw: json!({ "appRoot": app_root }),
        }];
    }
    vec![]
}

/// JS: writeRootsManifest(manifest). Returns the roots.json path.
pub fn write_roots_manifest(manifest: &RootsManifest) -> String {
    let file = roots_file_path(&manifest.app_root);
    let _ = write_file(&file, &json_pretty(&manifest.to_value()));
    if jsp::resolve(&manifest.repo_root, &[]) != jsp::resolve(&manifest.app_root, &[]) {
        let pointer = pointer_file_path(&manifest.repo_root);
        let mut entries: Vec<Value> = read_pointer_entries(&manifest.repo_root)
            .into_iter()
            .filter(|e| jsp::resolve(&e.app_root, &[]) != jsp::resolve(&manifest.app_root, &[]))
            .map(|e| e.raw)
            .collect();
        entries.insert(
            0,
            json!({ "appRoot": manifest.app_root, "bootedAt": iso_now() }),
        );
        let _ = write_file(
            &pointer,
            &serde_json::to_string(&json!({ "version": 2, "appRoots": entries }))
                .unwrap_or_default(),
        );
    }
    file
}

/// JS: readManifestAt(appRoot): the roots.json in `appRoot`, trusted only
/// when its `appRoot` resolves to that directory.
pub fn read_manifest_at(app_root: &str) -> Option<RootsManifest> {
    let raw = read_json(&roots_file_path(app_root))?;
    let claimed = raw.get("appRoot")?.as_str()?;
    if jsp::resolve(claimed, &[]) != jsp::resolve(app_root, &[]) {
        return None;
    }
    manifest_from_value(&raw)
}

/// A manifest from its JSON, tolerating missing optional fields the way the
/// JS reader (plain JSON.parse) does.
pub fn manifest_from_value(raw: &Value) -> Option<RootsManifest> {
    let app_root = raw.get("appRoot")?.as_str()?.to_string();
    let s = |k: &str| raw.get(k).and_then(|v| v.as_str()).map(String::from);
    Some(RootsManifest {
        version: raw
            .get("version")
            .and_then(|v| v.as_i64())
            .unwrap_or(ROOTS_MANIFEST_VERSION),
        repo_root: s("repoRoot").unwrap_or_else(|| app_root.clone()),
        context_root: s("contextRoot"),
        session_root: s("sessionRoot")
            .unwrap_or_else(|| jsp::join(&[&app_root, ".impeccable", "live"])),
        product_path: s("productPath"),
        design_path: s("designPath"),
        resolved_from: s("resolvedFrom"),
        app_root,
    })
}
