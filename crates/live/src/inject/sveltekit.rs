//! JS: live/sveltekit-adapter.mjs + live/frameworks/sveltekit.mjs. Mounts a
//! dev-only shadow host from `+layout.svelte` via a generated
//! `src/lib/impeccable/ImpeccableLiveRoot.svelte`; `src/app.html` stays
//! untouched.

use crate::config::LiveConfig;
use crate::util::{
    dir_entry_count, encode_uri_component, exists, jsp, read_json, safe_read, sha256_hex,
    write_file,
};
use once_cell::sync::Lazy;
use regex::{Regex, RegexBuilder};
use serde_json::{json, Value};

pub const SVELTE_LIVE_ROOT_COMPONENT: &str = "src/lib/impeccable/ImpeccableLiveRoot.svelte";
pub const SVELTE_LAYOUT_MARKER_OPEN: &str = "<!-- impeccable-live-svelte-start -->";
pub const SVELTE_LAYOUT_MARKER_CLOSE: &str = "<!-- impeccable-live-svelte-end -->";
pub const SVELTE_ROOT_IMPORT: &str =
    "import ImpeccableLiveRoot from '$lib/impeccable/ImpeccableLiveRoot.svelte';";

static SVELTE_ROOT_IMPORT_LINE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?m)^[ \t]*import ImpeccableLiveRoot from '\$lib/impeccable/ImpeccableLiveRoot\.svelte(?:\?[^']*)?';[ \t]*\r?\n?").unwrap()
});

/// JS: svelteRootImportLine(rev)
pub fn svelte_root_import_line(rev: Option<&str>) -> String {
    match rev {
        Some(r) if !r.is_empty() => format!("import ImpeccableLiveRoot from '$lib/impeccable/ImpeccableLiveRoot.svelte?impeccable-live={}';", r),
        _ => SVELTE_ROOT_IMPORT.to_string(),
    }
}

/// JS: svelteAdapterRev(token): sha256(token)[:8]
pub fn svelte_adapter_rev(token: Option<&str>) -> Option<String> {
    match token {
        Some(t) if !t.is_empty() => Some(sha256_hex(t)[..8].to_string()),
        _ => None,
    }
}

#[derive(Debug, Clone)]
pub struct SvelteKitProject {
    pub app_html: String,
    pub layout_file: String,
    pub root_component: &'static str,
}

/// JS: detectSvelteKitProject(cwd, config)
pub fn detect_sveltekit_project(
    cwd: &str,
    config: Option<&LiveConfig>,
) -> Option<SvelteKitProject> {
    let app_html = find_sveltekit_app_html(cwd, config)?;
    let abs = jsp::join(&[cwd, &app_html]);
    let has_markers =
        file_includes(&abs, "%sveltekit.body%") && file_includes(&abs, "%sveltekit.head%");
    if !has_markers {
        return None;
    }
    let has_svelte_config = [
        "svelte.config.js",
        "svelte.config.mjs",
        "svelte.config.cjs",
        "svelte.config.ts",
    ]
    .iter()
    .any(|f| exists(&jsp::join(&[cwd, f])));
    let has_kit = package_has_sveltekit(cwd);
    if !has_svelte_config && !has_kit {
        return None;
    }
    Some(SvelteKitProject {
        app_html,
        layout_file: find_sveltekit_layout(cwd),
        root_component: SVELTE_LIVE_ROOT_COMPONENT,
    })
}

/// JS: applySvelteKitLiveAdapter({ cwd, port, token, config })
pub fn apply_sveltekit_live_adapter(
    cwd: &str,
    port: i64,
    token: Option<&str>,
    config: Option<&LiveConfig>,
) -> Value {
    let Some(detected) = detect_sveltekit_project(cwd, config) else {
        return Value::Null;
    };
    ensure_svelte_live_root_component(cwd, port, token);
    let layout_rel = detected.layout_file.clone();
    let layout_abs = jsp::join(&[cwd, &layout_rel]);
    let _ = std::fs::create_dir_all(jsp::dirname(&layout_abs));
    let layout_existed = exists(&layout_abs);
    let before = if layout_existed {
        safe_read(&layout_abs).unwrap_or_default()
    } else {
        default_svelte_layout()
    };
    let after = patch_svelte_layout(&before, svelte_adapter_rev(token).as_deref());
    let _ = write_file(&layout_abs, &after);
    json!({
        "file": layout_rel,
        "adapter": "sveltekit",
        "inserted": after != before || !layout_existed,
        "appHtmlUntouched": true,
        "rootComponent": SVELTE_LIVE_ROOT_COMPONENT,
    })
}

/// JS: removeSvelteKitLiveAdapter({ cwd, config })
pub fn remove_sveltekit_live_adapter(cwd: &str, config: Option<&LiveConfig>) -> Value {
    let Some(detected) = detect_sveltekit_project(cwd, config) else {
        return Value::Null;
    };
    let layout_abs = jsp::join(&[cwd, &detected.layout_file]);
    let mut removed = false;
    if exists(&layout_abs) {
        let before = safe_read(&layout_abs).unwrap_or_default();
        let after = unpatch_svelte_layout(&before);
        if after != before {
            let _ = write_file(&layout_abs, &after);
            removed = true;
        }
    }
    let root_abs = jsp::join(&[cwd, SVELTE_LIVE_ROOT_COMPONENT]);
    if exists(&root_abs) {
        let _ = std::fs::remove_file(&root_abs);
        removed = true;
    }
    prune_empty_dir(&jsp::dirname(&root_abs), &jsp::join(&[cwd, "src"]));
    json!({
        "file": detected.layout_file,
        "adapter": "sveltekit",
        "removed": removed,
        "appHtmlUntouched": true,
        "rootComponent": SVELTE_LIVE_ROOT_COMPONENT,
    })
}

static SCRIPT_OPEN_RE: Lazy<Regex> = Lazy::new(|| {
    RegexBuilder::new(r"<script(?:\s[^>]*)?>")
        .case_insensitive(true)
        .build()
        .unwrap()
});
static RENDER_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\{@render\s+children(?:\?\.)?\(\)\s*\}").unwrap());
static SLOT_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"<slot\s*/?>").unwrap());
static TRAILING_WS_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\s*$").unwrap());
static EMPTY_SCRIPT_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"<script>\s*</script>[ \t]*\r?\n?").unwrap());
static MULTI_NL_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\n{3,}").unwrap());

/// JS: patchSvelteLayout(content, { rev })
pub fn patch_svelte_layout(content: &str, rev: Option<&str>) -> String {
    let mut out = content.to_string();
    let import_line = svelte_root_import_line(rev);
    if !out.contains(&import_line) {
        let mut replaced = false;
        // JS: replace ALL matches; the first is rewritten, later ones dropped.
        let mut result = String::new();
        let mut last = 0;
        for m in SVELTE_ROOT_IMPORT_LINE_RE.find_iter(&out) {
            result.push_str(&out[last..m.start()]);
            if !replaced {
                replaced = true;
                let line = m.as_str();
                let indent_len = line.len() - line.trim_start_matches([' ', '\t']).len();
                result.push_str(&line[..indent_len]);
                result.push_str(&import_line);
                result.push('\n');
            }
            last = m.end();
        }
        result.push_str(&out[last..]);
        out = result;
        if !replaced {
            if let Some(m) = SCRIPT_OPEN_RE.find(&out) {
                let insert_at = m.end();
                out = format!(
                    "{}\n  {}{}",
                    &out[..insert_at],
                    import_line,
                    &out[insert_at..]
                );
            } else {
                out = format!("<script>\n  {}\n</script>\n\n{}", import_line, out);
            }
        }
    }
    if !out.contains(SVELTE_LAYOUT_MARKER_OPEN) {
        let block = format!(
            "{}\n<ImpeccableLiveRoot />\n{}\n",
            SVELTE_LAYOUT_MARKER_OPEN, SVELTE_LAYOUT_MARKER_CLOSE
        );
        let m = RENDER_RE.find(&out).or_else(|| SLOT_RE.find(&out));
        if let Some(m) = m {
            let idx = m.start();
            out = format!("{}{}{}", &out[..idx], block, &out[idx..]);
        } else {
            // JS: out.replace(/\s*$/, '\n\n' + block)
            let m = TRAILING_WS_RE.find(&out).unwrap();
            out = format!("{}\n\n{}", &out[..m.start()], block);
        }
    }
    out
}

/// JS: unpatchSvelteLayout(content)
pub fn unpatch_svelte_layout(content: &str) -> String {
    let block_re = Regex::new(&format!(
        "([ \\t]*){}\\n<ImpeccableLiveRoot\\s*/>\\n{}\\n?",
        crate::util::escape_regex(SVELTE_LAYOUT_MARKER_OPEN),
        crate::util::escape_regex(SVELTE_LAYOUT_MARKER_CLOSE)
    ))
    .unwrap();
    let mut out = block_re.replace_all(content, "$1").into_owned();
    out = SVELTE_ROOT_IMPORT_LINE_RE
        .replace_all(&out, "")
        .into_owned();
    out = EMPTY_SCRIPT_RE.replace_all(&out, "").into_owned();
    MULTI_NL_RE.replace_all(&out, "\n\n").into_owned()
}

/// JS: ensureSvelteLiveRootComponent(cwd, port, token)
pub fn ensure_svelte_live_root_component(cwd: &str, port: i64, token: Option<&str>) -> String {
    let file = jsp::join(&[cwd, SVELTE_LIVE_ROOT_COMPONENT]);
    let _ = write_file(&file, &build_svelte_live_root_component(port, token));
    file
}

/// JS: buildSvelteLiveRootComponent(port, token)
pub fn build_svelte_live_root_component(port: i64, token: Option<&str>) -> String {
    let live_url = format!(
        "http://localhost:{}/live.js{}",
        port,
        match token {
            Some(t) if !t.is_empty() => format!("?token={}", encode_uri_component(t)),
            _ => String::new(),
        }
    );
    format!(
        "<script>
  import {{ onMount }} from 'svelte';

  const LIVE_URL = '{live_url}';
  const HOST_ID = 'impeccable-live-root';

  onMount(() => {{
    let host = document.querySelector('impeccable-live-root#' + HOST_ID) || document.getElementById(HOST_ID);
    if (!host) {{
      host = document.createElement('impeccable-live-root');
      host.id = HOST_ID;
      document.body.appendChild(host);
    }}

    host.dataset.impeccableLiveAdapter = 'sveltekit';
    host.style.setProperty('all', 'initial', 'important');
    host.style.setProperty('display', 'block', 'important');
    host.style.setProperty('position', 'fixed', 'important');
    host.style.setProperty('top', '0', 'important');
    host.style.setProperty('left', '0', 'important');
    host.style.setProperty('width', '0', 'important');
    host.style.setProperty('height', '0', 'important');
    host.style.setProperty('overflow', 'visible', 'important');
    host.style.setProperty('z-index', '2147483000', 'important');
    host.style.setProperty('pointer-events', 'none', 'important');

    const root = host.shadowRoot || host.attachShadow({{ mode: 'open' }});
    if (!root.querySelector('style[data-impeccable-live-reset]')) {{
      const reset = document.createElement('style');
      reset.dataset.impeccableLiveReset = 'true';
      reset.textContent = ':host, :host *, * {{ box-sizing: border-box; }}';
      root.appendChild(reset);
    }}

    window.__IMPECCABLE_LIVE_ADAPTER__ = 'sveltekit';
    window.__IMPECCABLE_LIVE_UI_ROOT__ = root;
    window.__IMPECCABLE_LIVE_CHROME_MOUNT__ = {{
      adapter: 'sveltekit',
      version: 1,
      host,
      root,
    }};

    const script = document.createElement('script');
    script.src = LIVE_URL;
    script.async = true;
    script.dataset.impeccableLiveScript = 'true';
    script.onerror = () => console.error(
      '[impeccable] live.js failed to load from ' + LIVE_URL
      + ' (helper down, or the token rotated while a stale adapter module was cached).'
      + ' Re-run the live boot, then reload this page.'
    );
    document.head.appendChild(script);

    return () => {{
      script.remove();
      if (window.__IMPECCABLE_LIVE_UI_ROOT__ === root) delete window.__IMPECCABLE_LIVE_UI_ROOT__;
      if (window.__IMPECCABLE_LIVE_CHROME_MOUNT__?.root === root) delete window.__IMPECCABLE_LIVE_CHROME_MOUNT__;
      if (window.__IMPECCABLE_LIVE_ADAPTER__ === 'sveltekit') delete window.__IMPECCABLE_LIVE_ADAPTER__;
    }};
  }});
</script>
"
    )
}

fn find_sveltekit_app_html(cwd: &str, config: Option<&LiveConfig>) -> Option<String> {
    let files: Vec<String> = match config {
        Some(c) if c.raw.get("files").map(|f| f.is_array()).unwrap_or(false) => c.files(),
        _ => vec!["src/app.html".to_string()],
    };
    for rel in files {
        if rel.contains('*') {
            continue;
        }
        let rel = jsp::to_posix(&rel);
        if !rel.ends_with("app.html") {
            continue;
        }
        if exists(&jsp::join(&[cwd, &rel])) {
            return Some(rel);
        }
    }
    let fallback = "src/app.html";
    if exists(&jsp::join(&[cwd, fallback])) {
        Some(fallback.to_string())
    } else {
        None
    }
}

fn find_sveltekit_layout(cwd: &str) -> String {
    for rel in [
        "src/routes/+layout.svelte",
        "src/routes/(app)/+layout.svelte",
    ] {
        if exists(&jsp::join(&[cwd, rel])) {
            return rel.to_string();
        }
    }
    "src/routes/+layout.svelte".to_string()
}

fn default_svelte_layout() -> String {
    "<script>\n  let { children } = $props();\n</script>\n\n{@render children?.()}\n".to_string()
}

fn package_has_sveltekit(cwd: &str) -> bool {
    let file = jsp::join(&[cwd, "package.json"]);
    if !exists(&file) {
        return false;
    }
    let Some(pkg) = read_json(&file) else {
        return false;
    };
    let deps = super::detect_utils::read_package_deps_from(&pkg);
    ["@sveltejs/kit", "@sveltejs/vite-plugin-svelte", "svelte"]
        .iter()
        .any(|k| {
            deps.get(*k)
                .map(super::detect_utils::truthy)
                .unwrap_or(false)
        })
}

fn file_includes(file: &str, text: &str) -> bool {
    safe_read(file).map(|c| c.contains(text)).unwrap_or(false)
}

/// JS: pruneEmptyDir(dir, stopDir) (sveltekit-adapter / tanstack-adapter
/// flavour: string-prefix bound).
pub fn prune_empty_dir(dir: &str, stop_dir: &str) {
    let mut current = dir.to_string();
    while current.starts_with(stop_dir) && current != stop_dir {
        match dir_entry_count(&current) {
            Some(0) => {
                if std::fs::remove_dir(&current).is_err() {
                    return;
                }
                current = jsp::dirname(&current);
            }
            _ => return,
        }
    }
}

/// JS: sveltekit.inject.artifacts({ project })
pub fn sveltekit_artifacts(project: &SvelteKitProject) -> Vec<Value> {
    vec![
        json!({ "kind": "created", "path": SVELTE_LIVE_ROOT_COMPONENT, "marker": "impeccable-live-root", "pruneTo": "src" }),
        json!({ "kind": "patched", "path": project.layout_file, "patch": "sveltekit-layout", "markers": [SVELTE_LAYOUT_MARKER_OPEN] }),
    ]
}
