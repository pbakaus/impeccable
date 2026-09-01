//! JS: live/browser-script-parts.mjs plus the files the server serves. The
//! browser scripts are embedded at build time straight from `skill/scripts/`,
//! the one copy the build also ships to every provider, so the binary and the
//! installed skill can never disagree. The `/detect.js` fallback is the closed
//! in-page bundle, which `crates/core/build.rs` resolves beside the detector
//! archive rather than tracking here. When a skill directory with the part
//! files is available (`IMPECCABLE_SKILL_DIR`), the parts are re-read from disk
//! on every request like the JS, so edits land on the next tab reload.

use crate::util::{exists, jsp, safe_read, Env};
use crate::vocabulary::{live_commands, live_ui_surfaces, LIVE_CHROME_MOUNT_CONTRACT};
use serde_json::{json, Value};

pub const LIVE_BROWSER_SESSION_JS: &str = include_str!("../../../skill/scripts/live-browser-session.js");
pub const LIVE_BROWSER_DOM_JS: &str = include_str!("../../../skill/scripts/live-browser-dom.js");
pub const LIVE_BROWSER_IGNORES_JS: &str = include_str!("../../../skill/scripts/live-browser-ignores.js");
pub const LIVE_BROWSER_JS: &str = include_str!("../../../skill/scripts/live-browser.js");
pub const MODERN_SCREENSHOT_JS: &[u8] = include_bytes!("../../../skill/scripts/modern-screenshot.umd.js");
pub use impeccable_core::browser::IN_PAGE_BUNDLE_JS as DETECT_BROWSER_JS;

/// JS: LIVE_BROWSER_SCRIPT_PARTS, in order: (name, file, embedded source).
pub const LIVE_BROWSER_SCRIPT_PARTS: [(&str, &str, &str); 4] = [
    (
        "session-state",
        "live-browser-session.js",
        LIVE_BROWSER_SESSION_JS,
    ),
    ("dom-helpers", "live-browser-dom.js", LIVE_BROWSER_DOM_JS),
    (
        "project-ignores",
        "live-browser-ignores.js",
        LIVE_BROWSER_IGNORES_JS,
    ),
    ("browser-ui", "live-browser.js", LIVE_BROWSER_JS),
];

/// The scripts dir the JS resolved parts against, when a skill dir is known.
pub fn scripts_dir(env: &Env, cwd: &str) -> Option<String> {
    impeccable_context::provider::detect(env, cwd)
        .skill_dir
        .map(|d| jsp::join(&[&d, "scripts"]))
}

/// JS: readLiveBrowserScriptParts(parts): the three sources, disk first when
/// every part file exists under the skill's scripts dir, else embedded.
pub fn read_live_browser_script_parts(
    scripts_dir: Option<&str>,
) -> Result<Vec<(&'static str, &'static str, String)>, String> {
    if let Some(dir) = scripts_dir {
        let all_present = LIVE_BROWSER_SCRIPT_PARTS
            .iter()
            .all(|(_, file, _)| exists(&jsp::join(&[dir, file])));
        if all_present {
            let mut out = Vec::new();
            for (name, file, _) in LIVE_BROWSER_SCRIPT_PARTS.iter() {
                let path = jsp::join(&[dir, file]);
                match std::fs::read(&path) {
                    Ok(bytes) => {
                        out.push((*name, *file, String::from_utf8_lossy(&bytes).into_owned()))
                    }
                    Err(e) => {
                        return Err(impeccable_context::util::node_read_error(&path, &e));
                    }
                }
            }
            return Ok(out);
        }
    }
    Ok(LIVE_BROWSER_SCRIPT_PARTS
        .iter()
        .map(|(n, f, s)| (*n, *f, (*s).to_string()))
        .collect())
}

/// JS: assembleLiveBrowserScript({ token, port, vocabulary, commandPrefix,
/// appRoot, parts })
pub fn assemble_live_browser_script(
    token: &str,
    port: i64,
    command_prefix: &str,
    app_root: &str,
    parts: &[(&str, &str, String)],
    project_ignores: &Value,
) -> String {
    let mut out = String::new();
    out.push_str(&format!("window.__IMPECCABLE_TOKEN__ = '{}';\n", token));
    out.push_str(&format!("window.__IMPECCABLE_PORT__ = {};\n", port));
    out.push_str(&format!(
        "window.__IMPECCABLE_APP_ROOT__ = {};\n",
        serde_json::to_string(&Value::String(app_root.to_string())).unwrap_or_default()
    ));
    out.push_str(&format!(
        "window.__IMPECCABLE_COMMAND_PREFIX__ = {};\n",
        serde_json::to_string(&Value::String(command_prefix.to_string())).unwrap_or_default()
    ));
    out.push_str(&format!(
        "window.__IMPECCABLE_VOCAB__ = {};\n",
        serde_json::to_string(&live_commands()).unwrap_or_default()
    ));
    out.push_str(&format!(
        "window.__IMPECCABLE_LIVE_UI_SURFACES__ = {};\n",
        serde_json::to_string(&live_ui_surfaces()).unwrap_or_default()
    ));
    out.push_str(&format!(
        "window.__IMPECCABLE_LIVE_MOUNT_CONTRACT__ = {};\n",
        serde_json::to_string(&json!(LIVE_CHROME_MOUNT_CONTRACT)).unwrap_or_default()
    ));
    // Project detector waivers ({ ignoreRules, ignoreValues, ignoreFiles,
    // roots, pageFiles }), read from .impeccable config by the live server.
    // live-browser-ignores.js resolves them against the page when a detect
    // scan starts, so the overlay filters the same findings the CLI and the
    // edit hook do (issue #639).
    out.push_str(&format!(
        "window.__IMPECCABLE_PROJECT_IGNORES__ = {};\n",
        serde_json::to_string(project_ignores).unwrap_or_default()
    ));
    let body: Vec<String> = parts
        .iter()
        .map(|(name, file, source)| {
            format!(
                "// --- impeccable live script part: {} ({}) ---\n{}",
                name, file, source
            )
        })
        .collect();
    out.push_str(&body.join("\n"));
    out
}

/// JS: the detector lookup in loadBrowserScripts(): the skill-bundled
/// detector, then the source/npm locations, then the embedded copy.
pub fn load_detect_script(env: &Env, cwd: &str) -> String {
    let mut candidates: Vec<String> = Vec::new();
    if let Some(dir) = scripts_dir(env, cwd) {
        candidates.push(jsp::join(&[
            &dir,
            "detector",
            "detect-antipatterns-browser.js",
        ]));
        candidates.push(jsp::join(&[
            &dir,
            "..",
            "..",
            "cli",
            "engine",
            "detect-antipatterns-browser.js",
        ]));
        candidates.push(jsp::join(&[
            &dir,
            "..",
            "..",
            "..",
            "..",
            "cli",
            "engine",
            "detect-antipatterns-browser.js",
        ]));
    }
    candidates.push(jsp::join(&[
        cwd,
        "node_modules",
        "impeccable",
        "cli",
        "engine",
        "detect-antipatterns-browser.js",
    ]));
    for c in candidates {
        if let Some(text) = safe_read(&c) {
            return text;
        }
    }
    DETECT_BROWSER_JS.to_string()
}
