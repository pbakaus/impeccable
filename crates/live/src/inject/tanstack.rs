//! JS: live/tanstack-adapter.mjs + live/frameworks/tanstack-start.mjs. A
//! dev-only managed component under `src/impeccable/` mounted from the root
//! route file.

use super::detect_utils::{file_exists, has_any_dependency};
use super::sveltekit::prune_empty_dir;
use super::tag_strategy::build_live_script_src;
use crate::util::{exists, jsp, safe_read, write_file};
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{json, Value};

pub const TANSTACK_MARKER_OPEN: &str = "{/* impeccable-live-tanstack-start */}";
pub const TANSTACK_MARKER_CLOSE: &str = "{/* impeccable-live-tanstack-end */}";
pub const TANSTACK_COMPONENT_DIR: &str = "src/impeccable";
pub const TANSTACK_COMPONENT_BASENAME: &str = "ImpeccableLiveRoot";

const ROOT_ROUTE_CANDIDATES: [&str; 6] = [
    "src/routes/__root.tsx",
    "src/routes/__root.jsx",
    "src/routes/__root.ts",
    "src/routes/__root.js",
    "app/routes/__root.tsx",
    "app/routes/__root.jsx",
];

const START_PACKAGES: [&str; 3] = [
    "@tanstack/react-start",
    "@tanstack/solid-start",
    "@tanstack/start",
];

#[derive(Debug, Clone)]
pub struct TanStackProject {
    pub root_route: String,
    pub component_file: String,
    pub component_import: String,
    pub ext: String,
}

/// JS: detectTanStackStartProject(cwd)
pub fn detect_tanstack_start_project(cwd: &str) -> Option<TanStackProject> {
    if !file_exists(cwd, "package.json") || !has_any_dependency(cwd, &START_PACKAGES) {
        return None;
    }
    let root_route = ROOT_ROUTE_CANDIDATES
        .iter()
        .find(|r| file_exists(cwd, r))?
        .to_string();
    let ext = jsp::extname(&root_route);
    let component_ext = if ext == ".jsx" || ext == ".js" {
        ".jsx"
    } else {
        ".tsx"
    };
    let component_file = format!(
        "{}/{}{}",
        TANSTACK_COMPONENT_DIR, TANSTACK_COMPONENT_BASENAME, component_ext
    );
    let component_import = relative_import_specifier(&root_route, &component_file);
    Some(TanStackProject {
        root_route,
        component_file,
        component_import,
        ext,
    })
}

/// JS: applyTanStackLiveAdapter({ cwd, port, token, project })
pub fn apply_tanstack_live_adapter(
    cwd: &str,
    port: i64,
    token: Option<&str>,
    project: &TanStackProject,
) -> Value {
    let component_abs = jsp::join(&[cwd, &project.component_file]);
    let component_body = build_tanstack_live_root_component(port, token);
    let component_existed = exists(&component_abs);
    if component_existed && !is_managed_component(&safe_read(&component_abs).unwrap_or_default()) {
        return json!({
            "file": project.component_file,
            "error": "tanstack_component_conflict",
            "hint": format!("{} already exists and is not managed by Impeccable Live", project.component_file),
        });
    }
    let _ = write_file(&component_abs, &component_body);
    let root_abs = jsp::join(&[cwd, &project.root_route]);
    let before = safe_read(&root_abs).unwrap_or_default();
    let after = patch_tanstack_root(&before, &project.component_import);
    let changed = after != before;
    if changed {
        let _ = write_file(&root_abs, &after);
    }
    json!({
        "file": project.root_route,
        "adapter": "tanstack-start",
        "inserted": changed || !component_existed,
        "componentFile": project.component_file,
        "devOnly": true,
    })
}

/// JS: removeTanStackLiveAdapter({ cwd, project })
pub fn remove_tanstack_live_adapter(cwd: &str, project: &TanStackProject) -> Value {
    let mut removed = false;
    let root_abs = jsp::join(&[cwd, &project.root_route]);
    if exists(&root_abs) {
        let before = safe_read(&root_abs).unwrap_or_default();
        let after = unpatch_tanstack_root(&before);
        if after != before {
            let _ = write_file(&root_abs, &after);
            removed = true;
        }
    }
    let component_abs = jsp::join(&[cwd, &project.component_file]);
    if exists(&component_abs) {
        let _ = std::fs::remove_file(&component_abs);
        removed = true;
    }
    prune_empty_dir(&jsp::dirname(&component_abs), &jsp::join(&[cwd, "src"]));
    json!({
        "file": project.root_route,
        "adapter": "tanstack-start",
        "removed": removed,
        "componentFile": project.component_file,
    })
}

static SCRIPTS_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"<Scripts\b").unwrap());
static IMPORT_LINE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)^import\b[^\n]*\n").unwrap());
static MANAGED_IMPORT_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?m)^import ImpeccableLiveRoot from '[^']*';[ \t]*\r?\n").unwrap());

/// JS: patchTanStackRoot(content, componentImport)
pub fn patch_tanstack_root(content: &str, component_import: &str) -> String {
    let mut out = content.to_string();
    let import_statement = format!("import ImpeccableLiveRoot from '{}';", component_import);
    if !out.contains(&import_statement) {
        out = insert_after_last_import(&out, &import_statement);
    }
    if !out.contains(TANSTACK_MARKER_OPEN) {
        let block = format!(
            "{}\n        <ImpeccableLiveRoot />\n        {}\n        ",
            TANSTACK_MARKER_OPEN, TANSTACK_MARKER_CLOSE
        );
        if let Some(m) = SCRIPTS_RE.find(&out) {
            let idx = m.start();
            out = format!("{}{}{}", &out[..idx], block, &out[idx..]);
        } else if let Some(idx) = out.rfind("</body>") {
            out = format!("{}{}{}", &out[..idx], block, &out[idx..]);
        }
    }
    out
}

/// JS: unpatchTanStackRoot(content)
pub fn unpatch_tanstack_root(content: &str) -> String {
    let block_re = Regex::new(&format!(
        "{}\\s*<ImpeccableLiveRoot\\s*/>\\s*{}\\r?\\n?[ \\t]*",
        crate::util::escape_regex(TANSTACK_MARKER_OPEN),
        crate::util::escape_regex(TANSTACK_MARKER_CLOSE)
    ))
    .unwrap();
    let out = block_re.replace_all(content, "").into_owned();
    MANAGED_IMPORT_RE.replace_all(&out, "").into_owned()
}

/// JS: buildTanStackLiveRootComponent(port, token)
pub fn build_tanstack_live_root_component(port: i64, token: Option<&str>) -> String {
    format!(
        "/* impeccable-live-tanstack-start */
import {{ useEffect }} from 'react';

const LIVE_SRC = '{src}';
const LIVE_SELECTOR = 'script[data-impeccable-live-tanstack]';

// Dev-only mount for Impeccable Live. TanStack Start server-renders the root
// document, so this appends the live-mode bundle from the client after
// hydration (mirrors the Nuxt/SvelteKit adapters). Renders nothing on the
// server, so there is no hydration mismatch.
export default function ImpeccableLiveRoot() {{
  useEffect(() => {{
    if (typeof document === 'undefined') return;
    const expected = new URL(LIVE_SRC, window.location.href).href;
    let script = document.querySelector(LIVE_SELECTOR);
    if (script && script.src === expected) return;
    if (script) script.remove();

    script = document.createElement('script');
    script.src = LIVE_SRC;
    script.async = true;
    script.setAttribute('data-impeccable-live-tanstack', '');
    script.setAttribute('data-impeccable-live-script', 'true');
    document.head.appendChild(script);

    return () => {{
      if (script && script.isConnected) script.remove();
    }};
  }}, []);

  return null;
}}
",
        src = build_live_script_src(port, token)
    )
}

fn is_managed_component(content: &str) -> bool {
    content.contains("impeccable-live-tanstack")
}

static EXT_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\.(tsx|ts|jsx|js)$").unwrap());

fn relative_import_specifier(from_file: &str, to_file: &str) -> String {
    let rel = jsp::posix::relative(
        "/",
        &jsp::posix::dirname(&jsp::to_posix(from_file)),
        &jsp::to_posix(to_file),
    );
    let rel = EXT_RE.replace(&rel, "").into_owned();
    if rel.starts_with('.') {
        rel
    } else {
        format!("./{}", rel)
    }
}

fn insert_after_last_import(content: &str, import_statement: &str) -> String {
    let mut last_end: Option<usize> = None;
    for m in IMPORT_LINE_RE.find_iter(content) {
        last_end = Some(m.end());
    }
    match last_end {
        None => format!("{}\n{}", import_statement, content),
        Some(end) => format!(
            "{}{}\n{}",
            &content[..end],
            import_statement,
            &content[end..]
        ),
    }
}

/// JS: tanstackStart.inject.artifacts({ project })
pub fn tanstack_artifacts(project: &TanStackProject) -> Vec<Value> {
    vec![
        json!({ "kind": "created", "path": project.component_file, "marker": "impeccable-live-tanstack", "pruneTo": "src" }),
        json!({ "kind": "patched", "path": project.root_route, "patch": "tanstack-root", "markers": [TANSTACK_MARKER_OPEN] }),
    ]
}
