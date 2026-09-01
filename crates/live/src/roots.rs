//! JS: live/roots.mjs (resolution half). Root resolution for a live session:
//! appRoot / repoRoot / contextRoot resolved once, persisted by the boot, and
//! re-entered by every helper through `enter_live_root`.

use crate::manifests::{read_manifest_at, read_pointer_entries, RootsManifest};
use crate::server;
use crate::util::{
    exists, inside_or_equal, is_dir, jsp, kill0, read_dir_names_raw, read_dir_raw, read_json,
    rel_fwd, Env,
};
use impeccable_common::Io;
use impeccable_context::context::resolve_project_root;
use impeccable_context::target_args::TargetOptions;
use impeccable_context::util::homedir;

pub const PRODUCT_NAMES: [&str; 3] = ["PRODUCT.md", "Product.md", "product.md"];
pub const DESIGN_NAMES: [&str; 3] = ["DESIGN.md", "Design.md", "design.md"];
const CONTEXT_FALLBACK_DIRS: [&str; 2] = [".agents/context", "docs"];

pub const DEV_CONFIG_MARKERS: &[&str] = &[
    "vite.config.js",
    "vite.config.ts",
    "vite.config.mjs",
    "vite.config.mts",
    "vite.config.cjs",
    "svelte.config.js",
    "svelte.config.mjs",
    "svelte.config.ts",
    "next.config.js",
    "next.config.mjs",
    "next.config.ts",
    "astro.config.mjs",
    "astro.config.js",
    "astro.config.ts",
    "astro.config.cjs",
    "nuxt.config.ts",
    "nuxt.config.js",
    "nuxt.config.mjs",
    "remix.config.js",
    "react-router.config.ts",
    "angular.json",
    "webpack.config.js",
    "webpack.config.ts",
];

const CANDIDATE_SCAN_IGNORED: &[&str] = &[
    "node_modules",
    ".git",
    "dist",
    "build",
    "coverage",
    "vendor",
    "vendors",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".astro",
    ".turbo",
    ".cache",
    ".vercel",
];
const CANDIDATE_SCAN_DEPTH: usize = 2;

fn first_existing(dir: &str, names: &[&str]) -> Option<String> {
    for name in names {
        let abs = jsp::join(&[dir, name]);
        if exists(&abs) {
            return Some(abs);
        }
    }
    None
}

/// JS: hasDevConfig(dir)
pub fn has_dev_config(dir: &str) -> bool {
    if DEV_CONFIG_MARKERS
        .iter()
        .any(|name| exists(&jsp::join(&[dir, name])))
    {
        return true;
    }
    exists(&jsp::join(&[dir, "index.html"])) && exists(&jsp::join(&[dir, "package.json"]))
}

/// JS: isAppRoot(dir)
pub fn is_app_root(dir: &str) -> bool {
    has_dev_config(dir) || exists(&jsp::join(&[dir, ".impeccable", "live", "config.json"]))
}

/// JS: findContextFile(dir, names)
pub fn find_context_file(dir: &str, names: &[&str]) -> Option<String> {
    if let Some(direct) = first_existing(dir, names) {
        return Some(direct);
    }
    for rel in CONTEXT_FALLBACK_DIRS {
        if let Some(nested) = first_existing(&jsp::join(&[dir, rel]), names) {
            return Some(nested);
        }
    }
    None
}

/// JS: findGitRoot(startDir)
pub fn find_git_root(start_dir: &str, env: &Env) -> Option<String> {
    let mut dir = jsp::resolve(start_dir, &[]);
    let home = jsp::resolve(&homedir(env), &[]);
    loop {
        if dir == home {
            return None;
        }
        if exists(&jsp::join(&[&dir, ".git"])) {
            return Some(dir);
        }
        let parent = jsp::dirname(&dir);
        if parent == dir {
            return None;
        }
        dir = parent;
    }
}

/// JS: walkUp(startDir, upperBound, visit)
fn walk_up<T>(
    start_dir: &str,
    upper_bound: &str,
    env: &Env,
    mut visit: impl FnMut(&str) -> Option<T>,
) -> Option<T> {
    let mut dir = jsp::resolve(start_dir, &[]);
    let stop = jsp::resolve(upper_bound, &[]);
    let home = jsp::resolve(&homedir(env), &[]);
    loop {
        if dir == home {
            return None;
        }
        if let Some(hit) = visit(&dir) {
            return Some(hit);
        }
        if dir == stop {
            return None;
        }
        let parent = jsp::dirname(&dir);
        if parent == dir {
            return None;
        }
        dir = parent;
    }
}

/// JS: discoverAppCandidates(rootDir, depth)
pub fn discover_app_candidates(root_dir: &str, depth: usize) -> Vec<String> {
    let mut found: Vec<String> = Vec::new();
    fn scan(dir: &str, remaining: usize, found: &mut Vec<String>) {
        let Some(entries) = read_dir_raw(dir) else {
            return;
        };
        for entry in entries {
            if !entry.is_dir {
                continue;
            }
            if entry.name.starts_with('.') || CANDIDATE_SCAN_IGNORED.contains(&entry.name.as_str())
            {
                continue;
            }
            let abs = jsp::join(&[dir, &entry.name]);
            if is_app_root(&abs) {
                found.push(abs);
                continue;
            }
            if remaining > 1 {
                scan(&abs, remaining - 1, found);
            }
        }
    }
    scan(&jsp::resolve(root_dir, &[]), depth, &mut found);
    found.sort();
    found
}

/// JS: `{ name, path }` selection candidates.
#[derive(Debug, Clone, serde::Serialize)]
pub struct SelectionCandidate {
    pub name: String,
    pub path: String,
}

pub enum RootsResult {
    Manifest(RootsManifest),
    Selection(Vec<SelectionCandidate>),
}

/// JS: resolveRoots({ cwd, targetPath })
pub fn resolve_roots(cwd: &str, target_path: Option<&str>, env: &Env) -> RootsResult {
    let abs_cwd = jsp::resolve(cwd, &[]);
    let abs_target: Option<String> = target_path.map(|t| {
        if jsp::is_absolute(t) {
            t.to_string()
        } else {
            jsp::resolve(&abs_cwd, &[t])
        }
    });
    let target_dir = match &abs_target {
        Some(t) => {
            if is_dir(t) {
                t.clone()
            } else {
                jsp::dirname(t)
            }
        }
        None => abs_cwd.clone(),
    };

    let target_git_root = find_git_root(&target_dir, env);
    let cwd_git_root = if target_git_root.is_some() {
        None
    } else {
        find_git_root(&abs_cwd, env)
    };
    let repo_root: Option<String> = target_git_root.or_else(|| match cwd_git_root {
        Some(r) if inside_or_equal(&target_dir, &r) => Some(r),
        _ => None,
    });
    let upper_bound = repo_root.clone().unwrap_or_else(|| target_dir.clone());

    let legacy_root = resolve_project_root(
        &abs_cwd,
        &TargetOptions {
            target_path: abs_target.clone(),
        },
        env,
    );
    let marker_bound = if abs_target.is_some()
        && inside_or_equal(&target_dir, &legacy_root)
        && inside_or_equal(&legacy_root, &upper_bound)
    {
        legacy_root.clone()
    } else {
        upper_bound.clone()
    };

    let mut app_root = walk_up(&target_dir, &marker_bound, env, |dir| {
        if is_app_root(dir) {
            Some(dir.to_string())
        } else {
            None
        }
    });
    let mut resolved_from: Option<String> = app_root.as_ref().map(|_| match &abs_target {
        Some(t) => {
            let rel = jsp::relative("/", &abs_cwd, t);
            format!("target:{}", if rel.is_empty() { "." } else { &rel })
        }
        None => "cwd".to_string(),
    });

    if app_root.is_none() && abs_target.is_none() {
        let candidates = discover_app_candidates(&abs_cwd, CANDIDATE_SCAN_DEPTH);
        if candidates.len() == 1 {
            app_root = Some(candidates[0].clone());
            resolved_from = Some(format!(
                "candidate:{}",
                jsp::relative("/", &abs_cwd, &candidates[0])
            ));
        } else if candidates.len() > 1 {
            return RootsResult::Selection(
                candidates
                    .iter()
                    .map(|abs| SelectionCandidate {
                        name: jsp::basename(abs),
                        path: rel_fwd(&abs_cwd, abs),
                    })
                    .collect(),
            );
        }
    }

    let app_root = match app_root {
        Some(r) => r,
        None => {
            resolved_from = Some("fallback".to_string());
            if inside_or_equal(&target_dir, &legacy_root) {
                legacy_root.clone()
            } else {
                target_dir.clone()
            }
        }
    };

    let effective_repo_root = match &repo_root {
        Some(r) if inside_or_equal(&app_root, r) => r.clone(),
        _ => app_root.clone(),
    };

    let product_path = walk_up(&app_root, &effective_repo_root, env, |dir| {
        find_context_file(dir, &PRODUCT_NAMES)
    });
    let design_path = walk_up(&app_root, &effective_repo_root, env, |dir| {
        find_context_file(dir, &DESIGN_NAMES)
    });
    let context_root = product_path
        .as_deref()
        .map(jsp::dirname)
        .or_else(|| design_path.as_deref().map(jsp::dirname));

    RootsResult::Manifest(RootsManifest {
        version: crate::manifests::ROOTS_MANIFEST_VERSION,
        session_root: jsp::join(&[&app_root, ".impeccable", "live"]),
        app_root,
        repo_root: effective_repo_root,
        context_root,
        product_path,
        design_path,
        resolved_from,
    })
}

/// JS: hasLiveServer(appRoot). The identity probe (authenticated `/status`)
/// runs natively (see `server::probe_status`) instead of via `node -e`.
fn has_live_server(app_root: &str) -> bool {
    let Some(info) = read_json(&jsp::join(&[
        app_root,
        ".impeccable",
        "live",
        "server.json",
    ])) else {
        return false;
    };
    let Some(pid) = info.get("pid").and_then(|p| p.as_i64()) else {
        return false;
    };
    if !matches!(info.get("pid"), Some(serde_json::Value::Number(_))) {
        return false;
    }
    let port = crate::util::js_number(info.get("port"));
    let token = info.get("token").and_then(|t| t.as_str());
    match kill0(pid) {
        Ok(()) => {}
        Err("EPERM") => {}
        Err(_) => return false,
    }
    match (port, token) {
        (Some(p), Some(t)) if p.fract() == 0.0 && p > 0.0 => {
            server::probe_status(p as u16, t, 1200)
        }
        _ => false,
    }
}

const TERMINAL_SESSION_PHASES: [&str; 2] = ["completed", "discarded"];

/// JS: hasActiveDurableSession(appRoot)
fn has_active_durable_session(app_root: &str) -> bool {
    let dir = jsp::join(&[app_root, ".impeccable", "live", "sessions"]);
    let Some(entries) = read_dir_names_raw(&dir) else {
        return false;
    };
    for name in entries {
        if !name.ends_with(".snapshot.json") {
            continue;
        }
        if let Some(snap) = read_json(&jsp::join(&[&dir, &name])) {
            if let Some(phase) = snap.get("phase").and_then(|p| p.as_str()) {
                if !phase.is_empty() && !TERMINAL_SESSION_PHASES.contains(&phase) {
                    return true;
                }
            }
        }
    }
    false
}

pub struct LiveRootsResolution {
    pub manifest: Option<RootsManifest>,
    pub selection: Option<Vec<SelectionCandidate>>,
    pub source: &'static str,
}

/// JS: resolveLiveRoots(cwd, { targetPath }). Writes the multi-app warning
/// to `io.stderr`.
pub fn resolve_live_roots(
    cwd: &str,
    target_path: Option<&str>,
    io: &mut Io,
) -> LiveRootsResolution {
    let abs_cwd = jsp::resolve(cwd, &[]);
    let env = io.env.clone();
    if target_path.is_none() {
        let bound = find_git_root(&abs_cwd, &env).unwrap_or_else(|| abs_cwd.clone());
        if let Some(persisted) = walk_up(&abs_cwd, &bound, &env, read_manifest_at) {
            return LiveRootsResolution {
                manifest: Some(persisted),
                selection: None,
                source: "persisted",
            };
        }
        if let Some(git_root) = find_git_root(&abs_cwd, &env) {
            let candidates: Vec<RootsManifest> = read_pointer_entries(&git_root)
                .iter()
                .filter_map(|e| read_manifest_at(&e.app_root))
                .collect();
            if !candidates.is_empty() {
                let live_apps: Vec<RootsManifest> = candidates
                    .iter()
                    .filter(|m| has_live_server(&m.app_root))
                    .cloned()
                    .collect();
                let recovering: Vec<RootsManifest> = if !live_apps.is_empty() {
                    live_apps
                } else {
                    candidates
                        .iter()
                        .filter(|m| has_active_durable_session(&m.app_root))
                        .cloned()
                        .collect()
                };
                let tier = if !recovering.is_empty() {
                    recovering
                } else {
                    candidates
                };
                if tier.len() > 1 {
                    let chosen = &tier[0].app_root;
                    let others: Vec<&str> = tier[1..].iter().map(|m| m.app_root.as_str()).collect();
                    io.err(&format!(
                        "[impeccable live] Multiple apps in this repo have live state; using {}. Other candidate(s): {}. Run from the app directory (or pass --target) to address a specific app.\n",
                        chosen,
                        others.join(", ")
                    ));
                }
                return LiveRootsResolution {
                    manifest: Some(tier[0].clone()),
                    selection: None,
                    source: "pointer",
                };
            }
        }
    }
    match resolve_roots(&abs_cwd, target_path, &env) {
        RootsResult::Selection(c) => LiveRootsResolution {
            manifest: None,
            selection: Some(c),
            source: "fresh",
        },
        RootsResult::Manifest(m) => LiveRootsResolution {
            manifest: Some(m),
            selection: None,
            source: "fresh",
        },
    }
}

pub const TARGET_ARG_ERROR: &str =
    "--target requires a path value (use --target <path> or --target=<path>)";

/// JS: consumeTargetArg(argv). Removes the pair from `argv`.
pub fn consume_target_arg(argv: &mut Vec<String>) -> Result<Option<String>, String> {
    let mut i = 0;
    while i < argv.len() {
        let arg = argv[i].clone();
        if arg == "--target" {
            let value = argv.get(i + 1).cloned();
            match value {
                Some(v) if !v.is_empty() && !v.starts_with("--") => {
                    argv.drain(i..i + 2);
                    return Ok(Some(v));
                }
                _ => return Err(TARGET_ARG_ERROR.to_string()),
            }
        }
        if let Some(v) = arg.strip_prefix("--target=") {
            if v.is_empty() {
                return Err(TARGET_ARG_ERROR.to_string());
            }
            let v = v.to_string();
            argv.remove(i);
            return Ok(Some(v));
        }
        i += 1;
    }
    Ok(None)
}

/// JS: enterLiveRoot(cwd). Consumes `--target` from `args`, resolves the
/// governing roots, and moves `io.cwd` onto the appRoot. `Err(code)` means
/// the process must exit with that code (the message is already on stderr);
/// `Ok(None)` is the selection-ambiguity case (stay put).
pub fn enter_live_root(args: &mut Vec<String>, io: &mut Io) -> Result<Option<RootsManifest>, i32> {
    let target = match consume_target_arg(args) {
        Ok(t) => t,
        Err(msg) => {
            io.err(&format!("[impeccable live] {}\n", msg));
            return Err(1);
        }
    };
    let cwd = io.cwd.to_string_lossy().into_owned();
    let resolved = resolve_live_roots(&cwd, target.as_deref(), io);
    let Some(manifest) = resolved.manifest else {
        return Ok(None);
    };
    let app_root = manifest.app_root.clone();
    if jsp::resolve(&cwd, &[]) != jsp::resolve(&app_root, &[]) {
        if !is_dir(&app_root) {
            io.err(&format!(
                "[impeccable live] resolved app root does not exist: {} (stale roots manifest? re-run the live boot, or pass --target <path>)\n",
                app_root
            ));
            return Err(1);
        }
        io.cwd = std::path::PathBuf::from(&app_root);
    }
    Ok(Some(manifest))
}
