//! JS: live/project-ignores.mjs — project detector waivers for the live
//! overlay (issue #639, hardened in the PR #645 follow-up). One place
//! decides what the /live.js prelude serializes as
//! `window.__IMPECCABLE_PROJECT_IGNORES__`:
//!
//!   ignoreRules   detector.ignoreRules, unioned across every live root.
//!   ignoreValues  detector.ignoreValues entries ({rule, value, files?}),
//!                 deduped across roots; createdAt/reason stay local.
//!   ignoreFiles   detector.ignoreFiles globs, unioned across roots, so a
//!                 wholly waived page scans to zero findings in the overlay
//!                 just as it reports nothing through the CLI and the hook.
//!   roots         served-root prefixes derived from the inject config's own
//!                 `files` globs. Never derived from the ignore globs: one
//!                 entry scoped to prototype/library/** would lend
//!                 prototype/library/ as a candidate prefix to every page,
//!                 and that rule would suppress site-wide (issue #639).
//!   pageFiles     the inject config's `files` expanded to real project
//!                 files, so the browser can resolve a URL to the one file
//!                 it actually serves instead of trying every root (PR #645
//!                 review: with src/ and public/ both served, /foo.html must
//!                 not borrow src/foo.html's waivers while actually serving
//!                 public/foo.html).
//!
//! Config is read from every root the live session spans: the appRoot the
//! server chdir'd onto, plus contextRoot and repoRoot when they differ. The
//! edit hook keys the same config at the session cwd, and `impeccable
//! detect` reads it from its invocation cwd, so reading only the appRoot
//! silently dropped every waiver in exactly the monorepo layouts the roots
//! manifest exists for. Reading is additive across roots, matching
//! readConfig's own union of config.json and config.local.json.
//!
//! In a monorepo, roots and pageFiles are serialized repo-relative (the
//! appRoot's path inside the repo is prefixed), so waivers spelled from
//! either root match through the resolver's suffix expansion.

use crate::config::{resolve_files, LiveConfig};
use crate::paths::resolve_live_config_path;
use crate::util::{jsp, safe_read, Env};
use serde_json::{Map, Value};

/// Serializing thousands of page identities into every /live.js response
/// helps nobody; past this cap pageFiles is omitted and the resolver falls
/// back to the served-root common ancestor, which is correct, just less
/// precise about cross-root duplicates.
const PAGE_FILES_CAP: usize = 500;

/// JS: collectProjectDetectorIgnores({ appRoot, contextRoot, repoRoot,
/// scriptsDir }). `cwd` stands in for process.cwd() when no root is given.
pub fn collect_project_detector_ignores(
    cwd: &str,
    env: &Env,
    app_root: Option<&str>,
    context_root: Option<&str>,
    repo_root: Option<&str>,
) -> Value {
    let mut config_roots: Vec<String> = Vec::new();
    for dir in [app_root, context_root, repo_root].into_iter().flatten() {
        if dir.is_empty() {
            continue;
        }
        let resolved = jsp::resolve(cwd, &[dir]);
        if !config_roots.contains(&resolved) {
            config_roots.push(resolved);
        }
    }
    if config_roots.is_empty() {
        config_roots.push(cwd.to_string());
    }

    let mut ignore_rules: Vec<String> = Vec::new();
    let mut ignore_files: Vec<String> = Vec::new();
    let mut value_keys: Vec<String> = Vec::new();
    let mut value_entries: Vec<Value> = Vec::new();
    for dir in &config_roots {
        // readConfig merges config.json with the gitignored
        // config.local.json and type-checks both, exactly as the edit hook
        // reads the same pair.
        let config = impeccable_hook::hook_lib::read_config(dir);
        for rule in &config.ignore_rules {
            if !impeccable_core::js::trim(rule).is_empty() && !ignore_rules.contains(rule) {
                ignore_rules.push(rule.clone());
            }
        }
        for glob in &config.ignore_files {
            if !impeccable_core::js::trim(glob).is_empty() && !ignore_files.contains(glob) {
                ignore_files.push(glob.clone());
            }
        }
        for entry in &config.ignore_values {
            // readConfig already normalized rule/value and folded `file`
            // into `files`; serve only what the browser matches on.
            let mut serialized = Map::new();
            serialized.insert("rule".into(), Value::String(entry.rule.clone()));
            serialized.insert("value".into(), Value::String(entry.value.clone()));
            let files: Vec<String> = entry.files.clone().unwrap_or_default();
            if !files.is_empty() {
                serialized.insert(
                    "files".into(),
                    Value::Array(files.iter().map(|f| Value::String(f.clone())).collect()),
                );
            }
            let mut sorted = files.clone();
            sorted.sort();
            let key = serde_json::to_string(&Value::Array(vec![
                Value::String(entry.rule.clone()),
                Value::String(entry.value.clone()),
                Value::Array(sorted.into_iter().map(Value::String).collect()),
            ]))
            .unwrap_or_default();
            if !value_keys.contains(&key) {
                value_keys.push(key);
                value_entries.push(Value::Object(serialized));
            }
        }
    }

    let (roots, page_files) = read_live_served_pages(cwd, env, &config_roots[0], repo_root);
    let mut out = Map::new();
    out.insert(
        "ignoreRules".into(),
        Value::Array(ignore_rules.into_iter().map(Value::String).collect()),
    );
    out.insert("ignoreValues".into(), Value::Array(value_entries));
    out.insert(
        "ignoreFiles".into(),
        Value::Array(ignore_files.into_iter().map(Value::String).collect()),
    );
    out.insert("roots".into(), Value::Array(roots.into_iter().map(Value::String).collect()));
    out.insert(
        "pageFiles".into(),
        Value::Array(page_files.into_iter().map(Value::String).collect()),
    );
    Value::Object(out)
}

/// JS: project-ignores.mjs#readLiveServedPages
fn read_live_served_pages(
    cwd: &str,
    env: &Env,
    app_root: &str,
    repo_root: Option<&str>,
) -> (Vec<String>, Vec<String>) {
    let config_path = resolve_live_config_path(app_root, env);
    let live: Value = match safe_read(&config_path).and_then(|t| serde_json::from_str(&t).ok()) {
        Some(v) => v,
        // No readable inject config: the browser matches URL paths as-is.
        None => return (Vec::new(), Vec::new()),
    };
    let files: Vec<String> = live
        .get("files")
        .and_then(|f| f.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(String::from)
                .collect()
        })
        .unwrap_or_default();

    // A monorepo appRoot serializes identities repo-relative, so waivers
    // spelled from either root match through the resolver's suffix
    // expansion.
    let mut prefix = String::new();
    if let Some(rr) = repo_root.filter(|r| !r.is_empty()) {
        let rel = jsp::to_posix(&jsp::relative(cwd, &jsp::resolve(cwd, &[rr]), &jsp::resolve(cwd, &[app_root])));
        if !rel.is_empty() && !rel.starts_with("..") && !jsp::is_absolute(&rel) {
            prefix = format!("{}/", rel);
        }
    }

    let mut roots: Vec<String> = Vec::new();
    for glob in &files {
        let wildcard_at = glob.find(|c| matches!(c, '*' | '?' | '{'));
        let head = match wildcard_at {
            Some(i) => &glob[..i],
            None => glob.as_str(),
        };
        let root = match head.rfind('/') {
            Some(cut) => format!("{}{}", prefix, &head[..cut + 1]),
            None => prefix.clone(),
        };
        if !roots.contains(&root) {
            roots.push(root);
        }
    }

    let mut with_files = live.clone();
    if let Some(o) = with_files.as_object_mut() {
        o.insert(
            "files".into(),
            Value::Array(files.iter().map(|f| Value::String(f.clone())).collect()),
        );
    }
    let mut page_files: Vec<String> = resolve_files(app_root, &LiveConfig { raw: with_files })
        .into_iter()
        .filter(|rel| {
            // resolveFiles passes literal entries through even when they do
            // not exist; a missing file is nobody's identity.
            std::path::Path::new(&jsp::join(&[app_root, rel])).is_file()
        })
        .map(|rel| format!("{}{}", prefix, rel))
        .collect();
    if page_files.len() > PAGE_FILES_CAP {
        page_files = Vec::new();
    }

    (roots, page_files)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // Mirrors tests/live-project-ignores.test.mjs (public repo main,
    // 152d6940).

    struct Tmp(std::path::PathBuf);
    impl Tmp {
        fn new() -> Tmp {
            let base = std::env::temp_dir().join(format!(
                "impeccable-project-ignores-{}-{:?}",
                std::process::id(),
                std::thread::current().id()
            ));
            let _ = std::fs::remove_dir_all(&base);
            std::fs::create_dir_all(&base).unwrap();
            Tmp(std::fs::canonicalize(&base).unwrap())
        }
        fn path(&self) -> String {
            self.0.to_string_lossy().into_owned()
        }
        fn write(&self, rel: &str, content: &str) {
            let p = self.0.join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, content).unwrap();
        }
    }
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn detector_config(detector: Value) -> String {
        serde_json::to_string(&json!({ "detector": detector })).unwrap()
    }

    fn live_config(files: Value) -> String {
        serde_json::to_string(&json!({
            "files": files, "insertBefore": "</body>", "commentSyntax": "html"
        }))
        .unwrap()
    }

    fn collect(app: &str, repo: Option<&str>) -> Value {
        collect_project_detector_ignores("/", &Env::new(), Some(app), None, repo)
    }

    fn strs(v: &Value, key: &str) -> Vec<String> {
        let mut out: Vec<String> = v[key]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| x.as_str().unwrap().to_string())
            .collect();
        out.sort();
        out
    }

    #[test]
    fn collects_waivers_roots_and_page_files_from_a_single_root() {
        let app = Tmp::new();
        app.write("package.json", "{\"name\":\"single\",\"private\":true}\n");
        app.write(
            ".impeccable/config.json",
            &detector_config(json!({
                "ignoreRules": ["ai-color-palette"],
                "ignoreFiles": ["prototype/legacy/**"],
                "ignoreValues": [
                    { "rule": "gradient-text", "value": "*", "files": ["prototype/library/**"], "reason": "stays local" }
                ]
            })),
        );
        app.write(".impeccable/live/config.json", &live_config(json!(["prototype/index.html", "prototype/library/buttons.html"])));
        app.write("prototype/index.html", "<html></html>");
        app.write("prototype/library/buttons.html", "<html></html>");

        let out = collect(&app.path(), None);
        assert_eq!(out["ignoreRules"], json!(["ai-color-palette"]));
        assert_eq!(out["ignoreFiles"], json!(["prototype/legacy/**"]));
        // createdAt/reason stay local; only rule/value/files ride to the browser.
        assert_eq!(
            out["ignoreValues"],
            json!([{ "rule": "gradient-text", "value": "*", "files": ["prototype/library/**"] }])
        );
        assert_eq!(strs(&out, "roots"), vec!["prototype/", "prototype/library/"]);
        assert_eq!(strs(&out, "pageFiles"), vec!["prototype/index.html", "prototype/library/buttons.html"]);
    }

    #[test]
    fn reads_waivers_keyed_at_the_repo_root() {
        let repo = Tmp::new();
        let app = format!("{}/site", repo.path());
        std::fs::create_dir_all(repo.0.join(".git")).unwrap();
        repo.write("site/package.json", "{\"name\":\"site\",\"private\":true}\n");
        repo.write(
            ".impeccable/config.json",
            &detector_config(json!({
                "ignoreRules": ["ai-color-palette"],
                "ignoreValues": [{ "rule": "overused-font", "value": "space grotesk" }]
            })),
        );
        repo.write("site/.impeccable/live/config.json", &live_config(json!(["prototype/index.html"])));
        repo.write("site/prototype/index.html", "<html></html>");

        let out = collect(&app, Some(&repo.path()));
        assert_eq!(out["ignoreRules"], json!(["ai-color-palette"]));
        assert_eq!(out["ignoreValues"], json!([{ "rule": "overused-font", "value": "space grotesk" }]));
        // Identities serialize repo-relative so waivers spelled from either
        // root match through the resolver's suffix expansion.
        assert_eq!(out["roots"], json!(["site/prototype/"]));
        assert_eq!(out["pageFiles"], json!(["site/prototype/index.html"]));
    }

    #[test]
    fn unions_configs_across_roots_and_dedupes_value_entries() {
        let repo = Tmp::new();
        let app = format!("{}/site", repo.path());
        std::fs::create_dir_all(repo.0.join(".git")).unwrap();
        repo.write("site/package.json", "{\"name\":\"site\",\"private\":true}\n");
        repo.write(
            ".impeccable/config.json",
            &detector_config(json!({
                "ignoreRules": ["ai-color-palette"],
                "ignoreValues": [{ "rule": "overused-font", "value": "space grotesk" }]
            })),
        );
        repo.write(
            "site/.impeccable/config.json",
            &detector_config(json!({
                "ignoreRules": ["gradient-text", "ai-color-palette"],
                "ignoreValues": [{ "rule": "overused-font", "value": "space grotesk" }]
            })),
        );
        repo.write("site/.impeccable/live/config.json", &live_config(json!(["prototype/index.html"])));
        repo.write("site/prototype/index.html", "<html></html>");

        let out = collect(&app, Some(&repo.path()));
        assert_eq!(strs(&out, "ignoreRules"), vec!["ai-color-palette", "gradient-text"]);
        assert_eq!(out["ignoreValues"], json!([{ "rule": "overused-font", "value": "space grotesk" }]));
    }

    #[test]
    fn expands_globs_and_drops_missing_literals() {
        let app = Tmp::new();
        app.write("package.json", "{\"name\":\"globs\",\"private\":true}\n");
        app.write(
            ".impeccable/live/config.json",
            &live_config(json!(["prototype/**/*.html", "prototype/not-created-yet.html"])),
        );
        app.write("prototype/index.html", "<html></html>");
        app.write("prototype/library/buttons.html", "<html></html>");

        let out = collect(&app.path(), None);
        assert_eq!(strs(&out, "pageFiles"), vec!["prototype/index.html", "prototype/library/buttons.html"]);
        assert_eq!(strs(&out, "roots"), vec!["prototype/"]);
    }

    #[test]
    fn degrades_to_empty_arrays_when_nothing_is_configured() {
        let app = Tmp::new();
        app.write("package.json", "{\"name\":\"bare\",\"private\":true}\n");
        let out = collect(&app.path(), None);
        assert_eq!(
            out,
            json!({ "ignoreRules": [], "ignoreValues": [], "ignoreFiles": [], "roots": [], "pageFiles": [] })
        );
    }

    #[test]
    fn survives_a_malformed_detector_config() {
        let app = Tmp::new();
        app.write("package.json", "{\"name\":\"broken\",\"private\":true}\n");
        app.write(
            ".impeccable/config.json",
            "{\"detector\":{\"ignoreRules\":\"foo\",\"ignoreValues\":[null,7],\"ignoreFiles\":{}}}",
        );
        app.write(".impeccable/live/config.json", &live_config(json!(["prototype/index.html"])));
        app.write("prototype/index.html", "<html></html>");

        let out = collect(&app.path(), None);
        assert_eq!(out["ignoreRules"], json!([]));
        assert_eq!(out["ignoreValues"], json!([]));
        assert_eq!(out["ignoreFiles"], json!([]));
        assert_eq!(out["pageFiles"], json!(["prototype/index.html"]));
    }
}
