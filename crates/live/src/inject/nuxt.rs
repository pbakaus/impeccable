//! JS: live/frameworks/nuxt.mjs. Nuxt auto-discovers client plugins, so Live
//! writes one marked `.client.ts` plugin on start and removes it on stop.

use super::detect_utils::find_config_file;
use super::tag_strategy::build_live_script_src;
use crate::util::{dir_entry_count, exists, jsp, safe_read, write_file};
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{json, Value};

pub const NUXT_PLUGIN_MARKER: &str = "impeccable-live-nuxt-plugin";
pub const NUXT_PLUGIN_NAME: &str = "impeccable-live.client.ts";

static NUXT_CONFIG_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^nuxt\.config\.(?:js|mjs|cjs|ts|mts|cts)$").unwrap());
static SRC_DIR_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"\bsrcDir\s*:\s*(['"])([^'"]+)(['"])"#).unwrap());

/// The Nuxt project descriptor.
#[derive(Debug, Clone)]
pub struct NuxtProject {
    pub config_file: String,
    pub app_dir: String,
    pub plugin_file: String,
}

/// JS: detectNuxtProject(cwd)
pub fn detect_nuxt_project(cwd: &str) -> Option<NuxtProject> {
    let config_file = find_config_file(cwd, &NUXT_CONFIG_RE)?;
    let config = safe_read(&jsp::join(&[cwd, &config_file])).unwrap_or_default();
    let mut app_dir = String::new();
    let literal = SRC_DIR_RE
        .captures_iter(&config)
        .find(|c| c.get(1).map(|q| q.as_str()) == c.get(3).map(|q| q.as_str()));
    if let Some(m) = literal {
        let raw = m.get(2).map(|v| v.as_str()).unwrap_or("");
        let mut candidate = raw.replace('\\', "/");
        if let Some(rest) = candidate.strip_prefix("./") {
            candidate = rest.to_string();
        }
        let candidate = candidate.trim_end_matches('/').to_string();
        let normalized = jsp::normalize(&candidate);
        if normalized != ".." && !normalized.starts_with("../") && !jsp::is_absolute(&normalized) {
            app_dir = if normalized == "." {
                String::new()
            } else {
                normalized
            };
        }
    } else if exists(&jsp::join(&[cwd, "app", "app.vue"]))
        || exists(&jsp::join(&[cwd, "app", "pages"]))
    {
        app_dir = "app".to_string();
    }
    let plugin_file: Vec<&str> = [app_dir.as_str(), "plugins", NUXT_PLUGIN_NAME]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect();
    Some(NuxtProject {
        config_file,
        app_dir: app_dir.clone(),
        plugin_file: plugin_file.join("/"),
    })
}

/// JS: buildNuxtPlugin(port, token)
pub fn build_nuxt_plugin(port: i64, token: Option<&str>) -> String {
    format!(
        "/* {m} */
const liveSrc = '{src}';
const liveSelector = 'script[data-impeccable-live-nuxt]';

export default defineNuxtPlugin(() => {{
  if (!import.meta.dev || typeof document === 'undefined') return;

  const expectedSrc = new URL(liveSrc, window.location.href).href;
  let script = document.querySelector(liveSelector);
  if (script?.src === expectedSrc) return;
  script?.remove();

  script = document.createElement('script');
  script.src = liveSrc;
  script.async = true;
  script.dataset.impeccableLiveNuxt = '';
  document.head.appendChild(script);

  import.meta.hot?.dispose(() => {{
    if (script?.isConnected) script.remove();
  }});
}});
/* /{m} */
",
        m = NUXT_PLUGIN_MARKER,
        src = build_live_script_src(port, token)
    )
}

/// JS: applyNuxtLiveAdapter({ cwd, port, token, project })
pub fn apply_nuxt_live_adapter(
    cwd: &str,
    port: i64,
    token: Option<&str>,
    project: &NuxtProject,
) -> Value {
    let abs = jsp::join(&[cwd, &project.plugin_file]);
    let existing = if exists(&abs) { safe_read(&abs) } else { None };
    if let Some(ex) = &existing {
        if !ex.contains(NUXT_PLUGIN_MARKER) {
            return json!({
                "file": project.plugin_file,
                "error": "nuxt_plugin_conflict",
                "hint": format!("{} already exists and is not managed by Impeccable Live", project.plugin_file),
            });
        }
    }
    let content = build_nuxt_plugin(port, token);
    let _ = std::fs::create_dir_all(jsp::dirname(&abs));
    let changed = existing.as_deref() != Some(content.as_str());
    if changed {
        let _ = write_file(&abs, &content);
    }
    json!({ "file": project.plugin_file, "inserted": true, "changed": changed, "devOnly": true })
}

/// JS: removeNuxtLiveAdapter({ cwd, project })
pub fn remove_nuxt_live_adapter(cwd: &str, project: &NuxtProject) -> Value {
    let abs = jsp::join(&[cwd, &project.plugin_file]);
    if !exists(&abs) {
        return json!({ "file": project.plugin_file, "removed": false, "note": "no adapter present" });
    }
    let content = safe_read(&abs).unwrap_or_default();
    if !content.contains(NUXT_PLUGIN_MARKER) {
        return json!({
            "file": project.plugin_file,
            "removed": false,
            "error": "nuxt_plugin_conflict",
            "hint": format!("{} is not managed by Impeccable Live", project.plugin_file),
        });
    }
    let _ = std::fs::remove_file(&abs);
    let plugin_dir = jsp::dirname(&abs);
    if dir_entry_count(&plugin_dir) == Some(0) {
        let _ = std::fs::remove_dir(&plugin_dir);
    }
    json!({ "file": project.plugin_file, "removed": true })
}

/// JS: nuxt.inject.artifacts({ project })
pub fn nuxt_artifacts(project: &NuxtProject) -> Vec<Value> {
    if project.plugin_file.is_empty() {
        return vec![];
    }
    let prune_to = jsp::dirname(&jsp::dirname(&project.plugin_file));
    vec![json!({
        "kind": "created",
        "path": project.plugin_file,
        "marker": NUXT_PLUGIN_MARKER,
        "pruneTo": prune_to,
    })]
}
