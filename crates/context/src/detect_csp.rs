//! JS: detect-csp.mjs -> `impeccable detect-csp`

use crate::jsp;
use crate::util::{exists, json_pretty, read_dir_entries};
use impeccable_common::Io;
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{Map, Value};

const SKIP_DIRS: [&str; 11] =
    ["node_modules", ".git", ".next", ".turbo", ".svelte-kit", ".nuxt", ".astro", "dist", "build", "out", ".vercel"];
const SCAN_EXTS: [&str; 8] = [".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".tsx", ".jsx"];
const LAYOUT_EXTS: [&str; 6] = [".tsx", ".jsx", ".astro", ".vue", ".svelte", ".html"];
const MAX_DEPTH: usize = 6;
const MAX_READ_BYTES: usize = 64 * 1024;

static MONOREPO_HELPER: Lazy<Vec<Regex>> = Lazy::new(|| {
    ["buildCSPConfig", "buildSecurityHeaders", "additionalScriptSrc", "additionalConnectSrc", "createBaseNextConfig"]
        .iter()
        .map(|w| Regex::new(&format!(r"(?-u:\b){}(?-u:\b)", w)).unwrap())
        .collect()
});
static SVELTEKIT: Lazy<Vec<Regex>> = Lazy::new(|| {
    [r"(?-u:\b)kit\s*:", r"(?-u:\b)csp\s*:", r"(?-u:\b)directives\s*:"].iter().map(|r| Regex::new(r).unwrap()).collect()
});
static NUXT_SECURITY: Lazy<Vec<Regex>> = Lazy::new(|| {
    [r#"['"]nuxt-security['"]"#, r"(?-u:\b)contentSecurityPolicy(?-u:\b)"].iter().map(|r| Regex::new(r).unwrap()).collect()
});
static INLINE_HEADER: Lazy<Vec<Regex>> = Lazy::new(|| {
    [r#"(?i)["']Content-Security-Policy["']"#, r"(?-u:\b)script-src(?-u:\b)", r"(?-u:\b)connect-src(?-u:\b)"]
        .iter()
        .map(|r| Regex::new(r).unwrap())
        .collect()
});
static MIDDLEWARE_HINT: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?i)headers\.set\(\s*["']Content-Security-Policy["']"#).unwrap());
static META_TAG_HINT: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?i)http-equiv\s*=\s*["']Content-Security-Policy["']"#).unwrap());
static MONOREPO_PATH: Lazy<Regex> = Lazy::new(|| Regex::new(r"packages/[^/]+/src/.*(config|next-config|security)").unwrap());
static CONFIG_PATH: Lazy<Regex> = Lazy::new(|| Regex::new(r"(^|/)(next|nuxt|vite|astro|svelte)\.config\.").unwrap());

struct Hits {
    append_arrays: Vec<String>,
    append_string: Vec<String>,
    middleware: Vec<String>,
    meta_tag: Vec<String>,
}

fn is_config(rel: &str, name: &str) -> bool {
    Regex::new(&format!(r"(^|/){}\.config\.", name)).map(|r| r.is_match(rel)).unwrap_or(false)
}

const NEXT_MIDDLEWARE_FILES: &[&str] = &["middleware.ts", "middleware.js", "middleware.mjs"];
const NEXT_PROXY_FILES: &[&str] = &["proxy.ts", "proxy.js", "proxy.mjs"];
const NEXT_CONFIG_FILES: &[&str] = &[
    "next.config.js",
    "next.config.mjs",
    "next.config.cjs",
    "next.config.ts",
    "next.config.mts",
    "next.config.cts",
];

/// JS: detect-csp.mjs#hasNextProjectMarker
fn has_next_project_marker(project_root: &str) -> bool {
    if NEXT_CONFIG_FILES.iter().any(|n| exists(&jsp::join(&[project_root, n]))) {
        return true;
    }
    if ["app", "pages", "src/app", "src/pages"]
        .iter()
        .any(|rel| exists(&jsp::join(&[project_root, rel])))
    {
        return true;
    }
    let Ok(raw) = std::fs::read_to_string(jsp::join(&[project_root, "package.json"])) else {
        return false;
    };
    let Ok(pkg) = serde_json::from_str::<Value>(&raw) else {
        return false;
    };
    ["dependencies", "devDependencies", "peerDependencies"]
        .iter()
        .any(|group| {
            pkg.get(*group)
                .and_then(|g| g.as_object())
                .is_some_and(|g| g.contains_key("next"))
        })
}

/// JS: detect-csp.mjs#isNextRequestHookFile
///
/// Next.js 16 recognizes `proxy` at the project root or in the optional `src/`
/// directory, alongside `app/` or `pages/`. The scan root is commonly a
/// monorepo, so that placement is also accepted relative to a nested directory
/// carrying a concrete Next.js project marker. A same-named helper elsewhere in
/// the tree is not the framework request hook.
fn is_next_request_hook_file(root: &str, abs_path: &str, rel_path: &str, base: &str) -> bool {
    if NEXT_MIDDLEWARE_FILES.contains(&base) {
        return true;
    }
    if !NEXT_PROXY_FILES.contains(&base) {
        return false;
    }
    let normalized = jsp::to_posix(rel_path).to_lowercase();
    if normalized == base || normalized == format!("src/{base}") {
        return true;
    }
    let hook_dir = jsp::dirname(abs_path);
    let project_root = if jsp::basename(&hook_dir).to_lowercase() == "src" {
        jsp::dirname(&hook_dir)
    } else {
        hook_dir
    };
    if jsp::resolve(&project_root, &[]) == jsp::resolve(root, &[]) {
        return true;
    }
    has_next_project_marker(&project_root)
}

fn visit(root: &str, abs: &str, rel: &str, body: &str, hits: &mut Hits) {
    let ext = jsp::extname(abs);
    let base = jsp::basename(abs).to_lowercase();
    let scan = SCAN_EXTS.contains(&ext.as_str());
    if scan && MONOREPO_PATH.is_match(rel) && MONOREPO_HELPER.iter().any(|r| r.is_match(body)) {
        hits.append_arrays.push(rel.to_string());
        return;
    }
    if scan && is_config(rel, "svelte") && SVELTEKIT.iter().all(|r| r.is_match(body)) {
        hits.append_arrays.push(rel.to_string());
        return;
    }
    if scan && is_config(rel, "nuxt") && NUXT_SECURITY.iter().all(|r| r.is_match(body)) {
        hits.append_arrays.push(rel.to_string());
        return;
    }
    if scan && CONFIG_PATH.is_match(rel) && INLINE_HEADER.iter().all(|r| r.is_match(body)) {
        hits.append_string.push(rel.to_string());
        return;
    }
    if is_next_request_hook_file(root, abs, rel, &base) && MIDDLEWARE_HINT.is_match(body) {
        hits.middleware.push(rel.to_string());
    }
    if LAYOUT_EXTS.contains(&ext.as_str()) && META_TAG_HINT.is_match(body) {
        hits.meta_tag.push(rel.to_string());
    }
}

fn walk(root: &str, dir: &str, depth: usize, hits: &mut Hits) {
    if depth > MAX_DEPTH {
        return;
    }
    let Some(entries) = read_dir_entries(dir) else { return };
    for e in entries {
        let abs = jsp::join(&[dir, &e.name]);
        if e.is_dir {
            if SKIP_DIRS.contains(&e.name.as_str()) {
                continue;
            }
            walk(root, &abs, depth + 1, hits);
            continue;
        }
        if !e.is_file {
            continue;
        }
        let ext = jsp::extname(&e.name);
        if !SCAN_EXTS.contains(&ext.as_str()) && !LAYOUT_EXTS.contains(&ext.as_str()) {
            continue;
        }
        let Ok(bytes) = std::fs::read(&abs) else { continue };
        let slice = if bytes.len() > MAX_READ_BYTES { &bytes[..MAX_READ_BYTES] } else { &bytes[..] };
        let body = String::from_utf8_lossy(slice);
        visit(root, &abs, &jsp::relative("/", root, &abs), &body, hits);
    }
}

pub fn detect_csp(cwd: &str) -> Value {
    let mut hits = Hits { append_arrays: vec![], append_string: vec![], middleware: vec![], meta_tag: vec![] };
    walk(cwd, cwd, 0, &mut hits);
    let (shape, signals): (Option<&str>, Vec<String>) = if !hits.append_arrays.is_empty() {
        (Some("append-arrays"), hits.append_arrays)
    } else if !hits.append_string.is_empty() {
        (Some("append-string"), hits.append_string)
    } else if !hits.middleware.is_empty() {
        (Some("middleware"), hits.middleware)
    } else if !hits.meta_tag.is_empty() {
        (Some("meta-tag"), hits.meta_tag)
    } else {
        (None, vec![])
    };
    let mut m = Map::new();
    m.insert("shape".into(), shape.map(|s| Value::String(s.to_string())).unwrap_or(Value::Null));
    m.insert("signals".into(), Value::Array(signals.into_iter().map(Value::String).collect()));
    Value::Object(m)
}

pub fn run(_args: &[String], io: &mut Io) -> i32 {
    let cwd = io.cwd.to_string_lossy().into_owned();
    let v = detect_csp(&cwd);
    io.out(&format!("{}\n", json_pretty(&v)));
    0
}
