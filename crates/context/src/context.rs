//! JS: context.mjs (resolution + loadContext). The CLI lives in context_cli.rs.

use crate::jsp;
use crate::surface_briefs::resolve_surface_brief;
use crate::target_args::{has_target_option, TargetOptions};
use crate::util::{
    exists, homedir, is_dir, js_trim, read_dir_entries, read_json, safe_read, utf16_len, Env,
};
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::Value;
use std::collections::BTreeMap;

pub const PRODUCT_NAMES: [&str; 3] = ["PRODUCT.md", "Product.md", "product.md"];
pub const DESIGN_NAMES: [&str; 3] = ["DESIGN.md", "Design.md", "design.md"];
pub const FALLBACK_DIRS: [&str; 2] = [".agents/context", "docs"];
pub const MONOREPO_MARKER_FILES: [&str; 4] = ["pnpm-workspace.yaml", "turbo.json", "nx.json", "lerna.json"];
pub const MONOREPO_FALLBACK_PROJECT_DIRS: [&str; 2] = ["apps", "packages"];
pub const WORKSPACE_DISCOVERY_IGNORED_DIRS: [&str; 12] = [
    "node_modules", ".git", "dist", "build", ".next", ".nuxt", ".svelte-kit", ".turbo", ".cache", "coverage",
    "vendor", "vendors",
];
const VISUAL_SOURCE_DIRS: [&str; 7] = ["src", "app", "pages", "components", "site", "public", "styles"];
const STYLE_EXTENSIONS: [&str; 5] = [".css", ".scss", ".sass", ".less", ".styl"];
const UI_EXTENSIONS: [&str; 7] = [".html", ".htm", ".jsx", ".tsx", ".vue", ".svelte", ".astro"];
const VISUAL_SCAN_FILE_LIMIT: usize = 250;
const VISUAL_SCAN_DEPTH_LIMIT: usize = 4;

pub fn all_context_names() -> Vec<&'static str> {
    let mut v: Vec<&str> = PRODUCT_NAMES.to_vec();
    v.extend(DESIGN_NAMES.iter());
    v
}

pub fn first_existing(dir: &str, names: &[&str]) -> Option<String> {
    for n in names {
        let abs = jsp::join(&[dir, n]);
        if exists(&abs) {
            return Some(abs);
        }
    }
    None
}

#[derive(Debug, Clone)]
pub struct Project {
    pub target_dir: String,
    pub project_root: String,
    pub repo_root: String,
    pub is_monorepo: bool,
}

#[derive(Debug, Clone)]
pub struct Resolved {
    pub context_dir: String,
    pub product_path: Option<String>,
    pub design_path: Option<String>,
    pub project_root: String,
    pub repo_root: String,
    pub is_monorepo: bool,
    pub target_dir: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct BriefSummary {
    pub slug: Option<String>,
    pub path: String,
    #[serde(rename = "primaryTarget")]
    pub primary_target: Option<String>,
    #[serde(rename = "relatedTargets")]
    pub related_targets: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct Ctx {
    pub has_product: bool,
    pub product: Option<String>,
    pub product_path: Option<String>,
    pub has_design: bool,
    pub design: Option<String>,
    pub design_path: Option<String>,
    pub context_dir: String,
    pub product_context_dir: Option<String>,
    pub design_context_dir: Option<String>,
    pub has_surface_brief: bool,
    pub surface_brief: Option<String>,
    pub surface_brief_path: Option<String>,
    pub surface_brief_reason: &'static str,
    pub surface_brief_candidates: Vec<BriefSummary>,
    pub has_visual_implementation: bool,
    pub platform: Option<String>,
    pub project_root: String,
    pub repo_root: String,
    pub is_monorepo: bool,
}

pub fn resolve_context_dir(cwd: &str, options: &TargetOptions, env: &Env) -> String {
    resolve_context(cwd, options, env).context_dir
}

/// JS: loadContext(cwd, options)
pub fn load_context(cwd: &str, options: &TargetOptions, env: &Env) -> Ctx {
    let resolved = resolve_context(cwd, options, env);
    let abs_cwd = jsp::resolve(cwd, &[]);
    let product = resolved.product_path.as_deref().and_then(safe_read);
    let design = resolved.design_path.as_deref().and_then(safe_read);
    let platform = extract_platform(product.as_deref());
    let target = if has_target_option(options) { options.target_path.as_deref() } else { None };
    let sr = resolve_surface_brief(&resolved.project_root, target);
    let brief = sr.brief.clone();
    Ctx {
        has_product: product.as_deref().map(|p| !p.is_empty()).unwrap_or(false),
        product_path: resolved.product_path.as_deref().map(|p| jsp::relative(&abs_cwd, &abs_cwd, p)),
        has_design: design.as_deref().map(|d| !d.is_empty()).unwrap_or(false),
        design_path: resolved.design_path.as_deref().map(|p| jsp::relative(&abs_cwd, &abs_cwd, p)),
        context_dir: resolved.context_dir.clone(),
        product_context_dir: resolved.product_path.as_deref().map(jsp::dirname),
        design_context_dir: resolved.design_path.as_deref().map(jsp::dirname),
        has_surface_brief: brief.is_some(),
        surface_brief: brief.as_ref().map(|b| b.text.clone()),
        surface_brief_path: brief.as_ref().and_then(|b| b.path.as_deref()).map(|p| jsp::relative(&abs_cwd, &abs_cwd, p)),
        surface_brief_reason: sr.reason,
        surface_brief_candidates: sr
            .candidates
            .iter()
            .map(|b| BriefSummary {
                slug: b.slug.clone(),
                path: jsp::relative(&abs_cwd, &abs_cwd, b.path.as_deref().unwrap_or("")),
                primary_target: b.primary_target.clone(),
                related_targets: b.related_targets.clone(),
            })
            .collect(),
        has_visual_implementation: has_visual_implementation(&resolved.project_root),
        platform,
        project_root: resolved.project_root,
        repo_root: resolved.repo_root,
        is_monorepo: resolved.is_monorepo,
        product,
        design,
    }
}

/// JS: resolveContext
pub fn resolve_context(cwd: &str, options: &TargetOptions, env: &Env) -> Resolved {
    let abs_cwd = jsp::resolve(cwd, &[]);
    let project = resolve_project(&abs_cwd, options, env);
    let project_context_dir = resolve_local_context_dir(&project.project_root);
    let root_context_dir = if project.repo_root != project.project_root {
        resolve_local_context_dir(&project.repo_root)
    } else {
        None
    };
    let mut product_path = project_context_dir
        .as_deref()
        .and_then(|d| first_existing(d, &PRODUCT_NAMES))
        .or_else(|| root_context_dir.as_deref().and_then(|d| first_existing(d, &PRODUCT_NAMES)));
    let mut design_path = project_context_dir
        .as_deref()
        .and_then(|d| first_existing(d, &DESIGN_NAMES))
        .or_else(|| root_context_dir.as_deref().and_then(|d| first_existing(d, &DESIGN_NAMES)));
    let mut env_context_dir: Option<String> = None;
    if product_path.is_none() && design_path.is_none() {
        env_context_dir = resolve_env_context_dir(&abs_cwd, env);
        if let Some(d) = &env_context_dir {
            product_path = first_existing(d, &PRODUCT_NAMES);
            design_path = first_existing(d, &DESIGN_NAMES);
        }
    }
    let context_dir = if let Some(p) = &product_path {
        jsp::dirname(p)
    } else if let Some(d) = &design_path {
        jsp::dirname(d)
    } else {
        env_context_dir.clone().unwrap_or_else(|| project.project_root.clone())
    };
    Resolved {
        context_dir,
        product_path,
        design_path,
        project_root: project.project_root,
        repo_root: project.repo_root,
        is_monorepo: project.is_monorepo,
        target_dir: project.target_dir,
    }
}

pub fn resolve_project_root(cwd: &str, options: &TargetOptions, env: &Env) -> String {
    resolve_project(cwd, options, env).project_root
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct TargetCandidate {
    pub name: String,
    pub path: String,
    #[serde(rename = "targetExample")]
    pub target_example: String,
    #[serde(rename = "productStatus")]
    pub product_status: &'static str,
    #[serde(rename = "productPath")]
    pub product_path: Option<String>,
    #[serde(rename = "designStatus")]
    pub design_status: &'static str,
    #[serde(rename = "designPath")]
    pub design_path: Option<String>,
}

pub struct TargetSelection {
    pub project_root: String,
    pub repo_root: String,
    pub target_candidates: Vec<TargetCandidate>,
}

/// JS: resolveTargetSelection
pub fn resolve_target_selection(cwd: &str, options: &TargetOptions, env: &Env) -> Option<TargetSelection> {
    if has_target_option(options) {
        return None;
    }
    let project = resolve_project(cwd, &TargetOptions::default(), env);
    if !project.is_monorepo || jsp::resolve(&project.project_root, &[]) != jsp::resolve(&project.repo_root, &[]) {
        return None;
    }
    let cands = discover_target_candidates(&project.repo_root, env);
    if cands.is_empty() {
        return None;
    }
    Some(TargetSelection { project_root: project.project_root, repo_root: project.repo_root, target_candidates: cands })
}

/// JS: resolveProject
pub fn resolve_project(cwd: &str, options: &TargetOptions, env: &Env) -> Project {
    let abs_cwd = jsp::resolve(cwd, &[]);
    let target_dir = resolve_target_dir(&abs_cwd, options);
    // #710: an explicit target inside its own git repository resolves against
    // that repository, so caller context never leaks across the boundary.
    let has_explicit_target = has_target_option(options) && target_dir != abs_cwd;
    let target_git_root = if has_explicit_target {
        find_git_boundary_root(&target_dir, env)
    } else {
        None
    };
    let mut repo_root = find_monorepo_root(&target_dir, env);
    if repo_root.is_none() {
        if let Some(tgr) = target_git_root.as_deref() {
            let cwd_git_root = find_git_boundary_root(&abs_cwd, env);
            if Some(tgr) != cwd_git_root.as_deref() {
                return Project {
                    project_root: nearest_target_context_root(tgr, &target_dir)
                        .unwrap_or_else(|| tgr.to_string()),
                    repo_root: tgr.to_string(),
                    is_monorepo: false,
                    target_dir,
                };
            }
        }
    }
    if repo_root.is_none() && target_dir != abs_cwd {
        if let Some(cwd_root) = find_monorepo_root(&abs_cwd, env) {
            if is_path_inside(&target_dir, &cwd_root) {
                repo_root = Some(cwd_root);
            }
        }
    }
    if repo_root.is_none() {
        let target_is_external = has_target_option(options)
            && target_dir != abs_cwd
            && !is_path_inside(&target_dir, &abs_cwd);
        if target_is_external {
            let target_repo_root = target_git_root.unwrap_or_else(|| target_dir.clone());
            return Project {
                project_root: nearest_target_context_root(&target_repo_root, &target_dir)
                    .unwrap_or_else(|| target_repo_root.clone()),
                repo_root: target_repo_root,
                is_monorepo: false,
                target_dir,
            };
        }
    }
    match repo_root {
        None => Project {
            project_root: nearest_target_context_root(&abs_cwd, &target_dir).unwrap_or_else(|| abs_cwd.clone()),
            repo_root: abs_cwd,
            is_monorepo: false,
            target_dir,
        },
        Some(root) => Project {
            project_root: resolve_workspace_project_root(&root, &target_dir).unwrap_or_else(|| root.clone()),
            repo_root: root,
            is_monorepo: true,
            target_dir,
        },
    }
}

/// JS: context.mjs#findGitBoundaryRoot
pub fn find_git_boundary_root(start_dir: &str, env: &Env) -> Option<String> {
    let mut dir = jsp::resolve(start_dir, &[]);
    let home = jsp::resolve(&homedir(env), &[]);
    loop {
        if dir == home {
            return None;
        }
        if has_git_boundary(&dir) {
            return Some(dir);
        }
        let parent = jsp::dirname(&dir);
        if parent == dir {
            return None;
        }
        dir = parent;
    }
}

/// JS: context.mjs#hasGitBoundary
pub fn has_git_boundary(dir: &str) -> bool {
    exists(&jsp::join(&[dir, ".git"]))
}

pub fn is_path_inside(candidate: &str, root: &str) -> bool {
    let rel = jsp::relative("/", root, candidate);
    !rel.is_empty() && !rel.starts_with("..") && !jsp::is_absolute(&rel)
}

pub fn is_path_inside_or_equal(candidate: &str, root: &str) -> bool {
    jsp::resolve(candidate, &[]) == jsp::resolve(root, &[]) || is_path_inside(candidate, root)
}

fn resolve_local_context_dir(root: &str) -> Option<String> {
    let names = all_context_names();
    if first_existing(root, &names).is_some() {
        return Some(root.to_string());
    }
    for rel in FALLBACK_DIRS {
        let c = jsp::resolve(root, &[rel]);
        if first_existing(&c, &names).is_some() {
            return Some(c);
        }
    }
    None
}

fn resolve_env_context_dir(cwd: &str, env: &Env) -> Option<String> {
    let v = env.get("IMPECCABLE_CONTEXT_DIR")?;
    let t = js_trim(v);
    if t.is_empty() {
        return None;
    }
    Some(if jsp::is_absolute(t) { t.to_string() } else { jsp::resolve(cwd, &[t]) })
}

/// JS: context.mjs#resolveTargetPath. A bare workspace name (or a
/// single-segment path a caller already absolutized against cwd) that does
/// not exist resolves to the one workspace candidate with that name (#706).
pub fn resolve_target_path(cwd: &str, target_path: &str, env: &Env) -> String {
    let abs = if jsp::is_absolute(target_path) {
        target_path.to_string()
    } else {
        jsp::resolve(cwd, &[target_path])
    };
    if exists(&abs) {
        return abs;
    }
    find_unique_bare_target(cwd, target_path, env).unwrap_or(abs)
}

/// JS: context.mjs#findUniqueBareTarget
fn find_unique_bare_target(cwd: &str, target_path: &str, env: &Env) -> Option<String> {
    let abs_cwd = jsp::resolve(cwd, &[]);
    let abs = if jsp::is_absolute(target_path) {
        target_path.to_string()
    } else {
        jsp::resolve(&abs_cwd, &[target_path])
    };
    let rel = jsp::relative(&abs_cwd, &abs_cwd, &abs);
    if rel.is_empty() || rel.starts_with("..") || jsp::is_absolute(&rel) {
        return None;
    }
    let segments: Vec<&str> = rel.split(jsp::SEP).filter(|s| !s.is_empty()).collect();
    if segments.len() != 1 {
        return None;
    }
    let name = segments[0];
    let repo_root = find_monorepo_root(&abs_cwd, env)?;
    let matches: Vec<TargetCandidate> = discover_target_candidates(&repo_root, env)
        .into_iter()
        .filter(|c| c.name == name)
        .collect();
    if matches.len() != 1 {
        return None;
    }
    Some(jsp::resolve(&repo_root, &[&matches[0].path]))
}

fn resolve_target_dir(cwd: &str, options: &TargetOptions) -> String {
    let Some(tp) = options.target_path.as_deref() else { return cwd.to_string() };
    if js_trim(tp).is_empty() {
        return cwd.to_string();
    }
    let abs = if jsp::is_absolute(tp) { tp.to_string() } else { jsp::resolve(cwd, &[tp]) };
    match std::fs::metadata(&abs) {
        Ok(md) => {
            if md.is_dir() {
                abs
            } else {
                jsp::dirname(&abs)
            }
        }
        Err(_) => {
            if !jsp::extname(&abs).is_empty() {
                jsp::dirname(&abs)
            } else {
                abs
            }
        }
    }
}

fn find_monorepo_root(start: &str, env: &Env) -> Option<String> {
    let mut dir = jsp::resolve(start, &[]);
    let home = jsp::resolve(&homedir(env), &[]);
    loop {
        if dir == home {
            return None;
        }
        if is_monorepo_root(&dir) {
            return Some(dir);
        }
        if has_git_boundary(&dir) {
            return None;
        }
        let parent = jsp::dirname(&dir);
        if parent == dir {
            return None;
        }
        dir = parent;
    }
}

fn is_monorepo_root(dir: &str) -> bool {
    if read_project_patterns(dir).iter().any(|p| !normalize_workspace_pattern(p).starts_with('!')) {
        return true;
    }
    if !MONOREPO_MARKER_FILES.iter().any(|f| exists(&jsp::join(&[dir, f]))) {
        return false;
    }
    has_fallback_workspace_children(dir)
}

fn has_fallback_workspace_children(dir: &str) -> bool {
    for name in MONOREPO_FALLBACK_PROJECT_DIRS {
        let base = jsp::join(&[dir, name]);
        let Some(entries) = read_dir_entries(&base) else { continue };
        if entries.iter().any(|e| e.is_dir && !is_ignored_workspace_discovery_dir(&e.name)) {
            return true;
        }
    }
    false
}

pub fn is_ignored_workspace_discovery_dir(name: &str) -> bool {
    name.starts_with('.') || WORKSPACE_DISCOVERY_IGNORED_DIRS.contains(&name)
}

/// JS: discoverTargetCandidates
pub fn discover_target_candidates(repo_root: &str, env: &Env) -> Vec<TargetCandidate> {
    // Map preserving insertion order; JS Map.set on an existing key keeps position.
    let mut order: Vec<String> = Vec::new();
    let mut roots: BTreeMap<String, String> = BTreeMap::new();
    let mut set = |rel: String, root: String| {
        if !roots.contains_key(&rel) {
            order.push(rel.clone());
        }
        roots.insert(rel, root);
    };
    let groups = read_project_pattern_groups(repo_root);
    for patterns in &groups {
        for pattern in patterns {
            for root in discover_roots_for_pattern(repo_root, pattern) {
                let rel = jsp::to_posix(&jsp::relative("/", repo_root, &root));
                set(rel, root);
            }
        }
    }
    if MONOREPO_MARKER_FILES.iter().any(|f| exists(&jsp::join(&[repo_root, f]))) {
        for name in MONOREPO_FALLBACK_PROJECT_DIRS {
            let base = jsp::join(&[repo_root, name]);
            let Some(entries) = read_dir_entries(&base) else { continue };
            for e in entries {
                if !e.is_dir || is_ignored_workspace_discovery_dir(&e.name) {
                    continue;
                }
                let root = jsp::join(&[&base, &e.name]);
                let rel = jsp::to_posix(&jsp::relative("/", repo_root, &root));
                set(rel, root);
            }
        }
    }
    let mut entries: Vec<(String, String)> = order
        .into_iter()
        .filter(|rel| !rel.is_empty() && !rel.starts_with(".."))
        .filter(|rel| is_selectable_candidate(repo_root, rel, &groups))
        .map(|rel| {
            let root = roots.get(&rel).cloned().unwrap();
            (rel, root)
        })
        .collect();
    entries.sort_by(|a, b| locale_compare(&a.0, &b.0));
    entries
        .into_iter()
        .map(|(rel, root)| {
            let target_example = find_target_example(repo_root, &root);
            let ctx = resolve_context(repo_root, &TargetOptions { target_path: Some(target_example.clone()) }, env);
            TargetCandidate {
                name: jsp::basename(&root),
                path: rel,
                target_example,
                product_status: context_source_status(ctx.product_path.as_deref(), repo_root, &root),
                product_path: context_source_path(ctx.product_path.as_deref(), repo_root),
                design_status: context_source_status(ctx.design_path.as_deref(), repo_root, &root),
                design_path: context_source_path(ctx.design_path.as_deref(), repo_root),
            }
        })
        .collect()
}

/// Approximation of `String.prototype.localeCompare` (ICU root collation) for
/// the ASCII path names workspaces use: compare case-insensitively with
/// punctuation weighted below alphanumerics, then tie-break by the raw bytes.
pub fn locale_compare(a: &str, b: &str) -> std::cmp::Ordering {
    fn key(c: char) -> (u8, u32) {
        if c.is_ascii_alphanumeric() {
            (2, c.to_ascii_lowercase() as u32)
        } else if c.is_ascii_digit() {
            (2, c as u32)
        } else {
            (1, c as u32)
        }
    }
    let ka: Vec<(u8, u32)> = a.chars().map(key).collect();
    let kb: Vec<(u8, u32)> = b.chars().map(key).collect();
    ka.cmp(&kb).then_with(|| {
        // lowercase before uppercase at the tertiary level
        let la: Vec<u8> = a.chars().map(|c| if c.is_ascii_uppercase() { 1 } else { 0 }).collect();
        let lb: Vec<u8> = b.chars().map(|c| if c.is_ascii_uppercase() { 1 } else { 0 }).collect();
        la.cmp(&lb)
    })
}

fn context_source_status(file_path: Option<&str>, repo_root: &str, project_root: &str) -> &'static str {
    let Some(fp) = file_path else { return "missing" };
    let abs = jsp::resolve(fp, &[]);
    let abs_project = jsp::resolve(project_root, &[]);
    let abs_repo = jsp::resolve(repo_root, &[]);
    if is_path_inside_or_equal(&abs, &abs_project) {
        return if jsp::dirname(&abs) == abs_project { "child" } else { "fallback" };
    }
    if abs_project != abs_repo && is_path_inside_or_equal(&abs, &abs_repo) {
        return "inherited";
    }
    "fallback"
}

fn context_source_path(file_path: Option<&str>, repo_root: &str) -> Option<String> {
    let fp = file_path?;
    let rel = jsp::relative("/", repo_root, fp);
    if !rel.is_empty() && !rel.starts_with("..") && !jsp::is_absolute(&rel) {
        Some(jsp::to_posix(&rel))
    } else {
        Some(fp.to_string())
    }
}

fn discover_roots_for_pattern(repo_root: &str, raw: &str) -> Vec<String> {
    let pattern = normalize_workspace_pattern(raw);
    if pattern.is_empty() || pattern.starts_with('!') {
        return vec![];
    }
    let segments: Vec<&str> = pattern.split('/').filter(|s| !s.is_empty()).collect();
    if segments.is_empty() {
        return vec![];
    }
    let first_glob = segments.iter().position(|s| s.contains('*'));
    let literal_prefix: Vec<&str> = match first_glob {
        None => segments.clone(),
        Some(i) => segments[..i].to_vec(),
    };
    let mut parts: Vec<&str> = vec![repo_root];
    parts.extend(literal_prefix.iter());
    let base = jsp::join(&parts);
    if !exists(&base) {
        return vec![];
    }
    if segments.contains(&"**") {
        let mut package_roots: Vec<String> = Vec::new();
        walk_dirs(&base, &mut |dir| {
            if dir != base && is_candidate_project_root(dir) {
                package_roots.push(dir.to_string());
            }
        });
        if !package_roots.is_empty() {
            return package_roots;
        }
        return direct_child_dirs(&base);
    }
    expand_simple_pattern(repo_root, &segments, 0, repo_root)
}

fn expand_simple_pattern(repo_root: &str, segs: &[&str], index: usize, current: &str) -> Vec<String> {
    if index >= segs.len() {
        return if exists(current) { vec![current.to_string()] } else { vec![] };
    }
    let seg = segs[index];
    if !seg.contains('*') {
        return expand_simple_pattern(repo_root, segs, index + 1, &jsp::join(&[current, seg]));
    }
    let Some(entries) = read_dir_entries(current) else { return vec![] };
    let mut roots = Vec::new();
    for e in entries {
        if !e.is_dir || is_ignored_workspace_discovery_dir(&e.name) {
            continue;
        }
        if !segment_matches(seg, &e.name) {
            continue;
        }
        roots.extend(expand_simple_pattern(repo_root, segs, index + 1, &jsp::join(&[current, &e.name])));
    }
    roots
}

fn direct_child_dirs(dir: &str) -> Vec<String> {
    match read_dir_entries(dir) {
        Some(entries) => entries
            .into_iter()
            .filter(|e| e.is_dir && !is_ignored_workspace_discovery_dir(&e.name))
            .map(|e| jsp::join(&[dir, &e.name]))
            .collect(),
        None => vec![],
    }
}

fn walk_dirs(root: &str, visit: &mut dyn FnMut(&str)) {
    let Some(entries) = read_dir_entries(root) else { return };
    for e in entries {
        if !e.is_dir || is_ignored_workspace_discovery_dir(&e.name) {
            continue;
        }
        let dir = jsp::join(&[root, &e.name]);
        visit(&dir);
        walk_dirs(&dir, visit);
    }
}

fn is_candidate_project_root(dir: &str) -> bool {
    exists(&jsp::join(&[dir, "package.json"]))
        || first_existing(dir, &all_context_names()).is_some()
        || exists(&jsp::join(&[dir, "src"]))
        || exists(&jsp::join(&[dir, "app"]))
        || exists(&jsp::join(&[dir, "pages"]))
        || exists(&jsp::join(&[dir, "public"]))
}

fn find_target_example(repo_root: &str, project_root: &str) -> String {
    const EXAMPLES: [&str; 9] = [
        "src/App.jsx",
        "src/App.tsx",
        "src/main.jsx",
        "src/main.tsx",
        "src/index.jsx",
        "src/index.ts",
        "app/page.tsx",
        "pages/index.tsx",
        "public/index.html",
    ];
    for rel in EXAMPLES {
        let abs = jsp::join(&[project_root, rel]);
        if exists(&abs) {
            return jsp::to_posix(&jsp::relative("/", repo_root, &abs));
        }
    }
    jsp::to_posix(&jsp::relative("/", repo_root, project_root))
}

fn resolve_workspace_project_root(repo_root: &str, target_dir: &str) -> Option<String> {
    let rel = jsp::relative("/", repo_root, target_dir);
    if rel.is_empty() || rel.starts_with("..") || jsp::is_absolute(&rel) {
        return Some(repo_root.to_string());
    }
    let rel_segments: Vec<&str> = rel.split(jsp::SEP_CHAR).filter(|s| !s.is_empty()).collect();
    for patterns in read_project_pattern_groups(repo_root) {
        if is_excluded_by_workspace_pattern(&rel_segments, &patterns) {
            return Some(repo_root.to_string());
        }
        for pattern in &patterns {
            if let Some(pr) = project_root_from_workspace_pattern(repo_root, &rel_segments, pattern) {
                return Some(pr);
            }
        }
    }
    if rel_segments.len() >= 2 && MONOREPO_FALLBACK_PROJECT_DIRS.contains(&rel_segments[0]) {
        return Some(jsp::join(&[repo_root, rel_segments[0], rel_segments[1]]));
    }
    if let Some(n) = nearest_project_like_root(repo_root, target_dir) {
        return Some(n);
    }
    Some(repo_root.to_string())
}

fn is_selectable_candidate(repo_root: &str, rel: &str, groups: &[Vec<String>]) -> bool {
    let rel_segments: Vec<&str> = rel.split('/').filter(|s| !s.is_empty()).collect();
    let impeccable = &groups[0];
    let package = &groups[1];
    if is_excluded_by_workspace_pattern(&rel_segments, impeccable) {
        return false;
    }
    for pattern in impeccable {
        if let Some(boundary) = project_root_from_workspace_pattern(repo_root, &rel_segments, pattern) {
            let mut parts = vec![repo_root];
            parts.extend(rel_segments.iter());
            return jsp::resolve(&boundary, &[]) == jsp::resolve(&jsp::join(&parts), &[]);
        }
    }
    !is_excluded_by_workspace_pattern(&rel_segments, package)
}

fn is_excluded_by_workspace_pattern(rel_segments: &[&str], patterns: &[String]) -> bool {
    patterns.iter().any(|raw| {
        let p = normalize_workspace_pattern(raw);
        if !p.starts_with('!') {
            return false;
        }
        workspace_pattern_matches_rel(&p[1..], rel_segments)
    })
}

fn nearest_target_context_root(abs_cwd: &str, target_dir: &str) -> Option<String> {
    if !is_path_inside(target_dir, abs_cwd) {
        return None;
    }
    let root_fallbacks: Vec<String> = FALLBACK_DIRS.iter().map(|r| jsp::resolve(abs_cwd, &[r])).collect();
    let mut dir = jsp::resolve(target_dir, &[]);
    while !dir.is_empty() && dir != abs_cwd {
        if !root_fallbacks.contains(&dir) && resolve_local_context_dir(&dir).is_some() {
            return Some(dir);
        }
        let parent = jsp::dirname(&dir);
        if parent == dir {
            break;
        }
        dir = parent;
    }
    None
}

fn nearest_project_like_root(repo_root: &str, target_dir: &str) -> Option<String> {
    let mut dir = jsp::resolve(target_dir, &[]);
    let stop = jsp::resolve(repo_root, &[]);
    while !dir.is_empty() && dir != stop {
        if first_existing(&dir, &all_context_names()).is_some() || exists(&jsp::join(&[&dir, "package.json"])) {
            return Some(dir);
        }
        let parent = jsp::dirname(&dir);
        if parent == dir {
            break;
        }
        dir = parent;
    }
    None
}

fn nearest_package_root_between(repo_root: &str, target_dir: &str, stop_dir: &str) -> Option<String> {
    let mut dir = jsp::resolve(target_dir, &[]);
    let stop = jsp::resolve(stop_dir, &[]);
    let root = jsp::resolve(repo_root, &[]);
    while !dir.is_empty() && dir != stop && is_path_inside_or_equal(&dir, &root) {
        if exists(&jsp::join(&[&dir, "package.json"])) {
            return Some(dir);
        }
        let parent = jsp::dirname(&dir);
        if parent == dir {
            break;
        }
        dir = parent;
    }
    None
}

fn workspace_pattern_matches_rel(pattern: &str, rel_segments: &[&str]) -> bool {
    let norm = normalize_workspace_pattern(pattern);
    let segs: Vec<&str> = norm.split('/').filter(|s| !s.is_empty()).collect();
    if segs.is_empty() {
        return false;
    }
    if segs.contains(&"**") {
        let first_glob = segs.iter().position(|s| s.contains('*'));
        let prefix: Vec<&str> = match first_glob {
            None => segs.clone(),
            Some(i) => segs[..i].to_vec(),
        };
        if rel_segments.len() < prefix.len() + 1 {
            return false;
        }
        for (i, p) in prefix.iter().enumerate() {
            if !segment_matches(p, rel_segments[i]) {
                return false;
            }
        }
        return true;
    }
    if rel_segments.len() < segs.len() {
        return false;
    }
    for (i, p) in segs.iter().enumerate() {
        if !segment_matches(p, rel_segments[i]) {
            return false;
        }
    }
    true
}

/// JS: readProjectPatternGroups -> [impeccablePatterns, packagePatterns]
pub fn read_project_pattern_groups(repo_root: &str) -> Vec<Vec<String>> {
    let mut package: Vec<String> = Vec::new();
    package.extend(read_package_workspaces(repo_root));
    package.extend(read_pnpm_workspaces(repo_root));
    package.extend(read_lerna_workspaces(repo_root));
    let package: Vec<String> = package.into_iter().filter(|p| !p.is_empty()).collect();
    vec![read_impeccable_project_roots(repo_root), package]
}

fn read_project_patterns(repo_root: &str) -> Vec<String> {
    read_project_pattern_groups(repo_root).into_iter().flatten().collect()
}

/// JS: readImpeccableProjectRoots
pub fn read_impeccable_project_roots(repo_root: &str) -> Vec<String> {
    let mut patterns = Vec::new();
    for name in ["config.json", "config.local.json"] {
        let Some(cfg) = read_json(&jsp::join(&[repo_root, ".impeccable", name])) else { continue };
        let Some(arr) = cfg.get("projectRoots").and_then(|v| v.as_array()) else { continue };
        for entry in arr {
            if let Some(s) = entry.as_str() {
                let t = js_trim(s);
                if !t.is_empty() {
                    patterns.push(t.to_string());
                }
            }
        }
    }
    patterns
}

/// JS array-of-strings coercion for workspace patterns: non-string entries
/// become `String(x)` in JS when normalized; keep strings, stringify others.
fn value_strings(v: &Value) -> Vec<String> {
    match v.as_array() {
        Some(a) => a
            .iter()
            .map(|e| match e {
                Value::String(s) => s.clone(),
                Value::Null => "null".to_string(),
                other => other.to_string(),
            })
            .collect(),
        None => vec![],
    }
}

fn read_package_workspaces(repo_root: &str) -> Vec<String> {
    let Some(pkg) = read_json(&jsp::join(&[repo_root, "package.json"])) else { return vec![] };
    let Some(ws) = pkg.get("workspaces") else { return vec![] };
    if ws.is_array() {
        return value_strings(ws);
    }
    if let Some(p) = ws.get("packages") {
        if p.is_array() {
            return value_strings(p);
        }
    }
    vec![]
}

fn read_lerna_workspaces(repo_root: &str) -> Vec<String> {
    let Some(lerna) = read_json(&jsp::join(&[repo_root, "lerna.json"])) else { return vec![] };
    match lerna.get("packages") {
        Some(p) if p.is_array() => value_strings(p),
        _ => vec![],
    }
}

static PACKAGES_FLOW_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^packages:\s*\[(.*)\]\s*$").unwrap());
static PACKAGES_BLOCK_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^packages:\s*$").unwrap());
static YAML_KEY_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^[A-Za-z0-9_-]+:\s*").unwrap());
static YAML_ITEM_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^-\s*(.+)$").unwrap());

fn read_pnpm_workspaces(repo_root: &str) -> Vec<String> {
    let Some(body) = safe_read(&jsp::join(&[repo_root, "pnpm-workspace.yaml"])) else { return vec![] };
    let mut patterns = Vec::new();
    let mut in_packages = false;
    for line in body.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        let stripped = strip_yaml_inline_comment(line);
        let trimmed = js_trim(&stripped);
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some(m) = PACKAGES_FLOW_RE.captures(trimmed) {
            patterns.extend(parse_yaml_flow_list(&m[1]));
            in_packages = false;
            continue;
        }
        if PACKAGES_BLOCK_RE.is_match(trimmed) {
            in_packages = true;
            continue;
        }
        if in_packages && YAML_KEY_RE.is_match(trimmed) {
            break;
        }
        if in_packages {
            if let Some(m) = YAML_ITEM_RE.captures(trimmed) {
                patterns.push(unquote_yaml_value(&m[1]));
            }
        }
    }
    patterns
}

fn strip_yaml_inline_comment(line: &str) -> String {
    let chars: Vec<char> = line.chars().collect();
    let mut quote: Option<char> = None;
    for i in 0..chars.len() {
        let ch = chars[i];
        if (ch == '"' || ch == '\'') && (i == 0 || chars[i - 1] != '\\') {
            quote = if quote == Some(ch) { None } else { quote.or(Some(ch)) };
            continue;
        }
        if ch == '#' && quote.is_none() {
            return chars[..i].iter().collect();
        }
    }
    line.to_string()
}

fn parse_yaml_flow_list(body: &str) -> Vec<String> {
    let chars: Vec<char> = body.chars().collect();
    let mut items = Vec::new();
    let mut quote: Option<char> = None;
    let mut current = String::new();
    for i in 0..chars.len() {
        let ch = chars[i];
        if (ch == '"' || ch == '\'') && (i == 0 || chars[i - 1] != '\\') {
            quote = if quote == Some(ch) { None } else { quote.or(Some(ch)) };
            current.push(ch);
            continue;
        }
        if ch == ',' && quote.is_none() {
            let v = unquote_yaml_value(&current);
            if !v.is_empty() {
                items.push(v);
            }
            current.clear();
            continue;
        }
        current.push(ch);
    }
    let v = unquote_yaml_value(&current);
    if !v.is_empty() {
        items.push(v);
    }
    items
}

fn unquote_yaml_value(v: &str) -> String {
    let t = js_trim(v);
    strip_one_quote_each_end(t)
}

/// JS: .replace(/^['"]|['"]$/g, '')
pub fn strip_one_quote_each_end(t: &str) -> String {
    let mut s = t;
    if s.starts_with('\'') || s.starts_with('"') {
        s = &s[1..];
    }
    if s.ends_with('\'') || s.ends_with('"') {
        s = &s[..s.len() - 1];
    }
    s.to_string()
}

fn project_root_from_workspace_pattern(repo_root: &str, rel_segments: &[&str], raw: &str) -> Option<String> {
    let pattern = normalize_workspace_pattern(raw);
    if pattern.is_empty() || pattern.starts_with('!') {
        return None;
    }
    let segs: Vec<&str> = pattern.split('/').filter(|s| !s.is_empty()).collect();
    if segs.is_empty() {
        return None;
    }
    if segs.contains(&"**") {
        return project_root_from_double_star_pattern(repo_root, rel_segments, &segs);
    }
    if rel_segments.len() < segs.len() {
        return None;
    }
    for (i, p) in segs.iter().enumerate() {
        if !segment_matches(p, rel_segments[i]) {
            return None;
        }
    }
    let mut parts = vec![repo_root];
    parts.extend(rel_segments[..segs.len()].iter());
    Some(jsp::join(&parts))
}

fn project_root_from_double_star_pattern(repo_root: &str, rel_segments: &[&str], segs: &[&str]) -> Option<String> {
    let first_glob = segs.iter().position(|s| s.contains('*'));
    let prefix: Vec<&str> = match first_glob {
        None => segs.to_vec(),
        Some(i) => segs[..i].to_vec(),
    };
    if rel_segments.len() < prefix.len() + 1 {
        return None;
    }
    for (i, p) in prefix.iter().enumerate() {
        if !segment_matches(p, rel_segments[i]) {
            return None;
        }
    }
    let mut pp = vec![repo_root];
    pp.extend(prefix.iter());
    let prefix_dir = jsp::join(&pp);
    let mut tp = vec![repo_root];
    tp.extend(rel_segments.iter());
    let target_dir = jsp::join(&tp);
    if let Some(pr) = nearest_package_root_between(repo_root, &target_dir, &prefix_dir) {
        return Some(pr);
    }
    let mut rp = vec![repo_root];
    rp.extend(rel_segments[..prefix.len() + 1].iter());
    Some(jsp::join(&rp))
}

pub fn normalize_workspace_pattern(p: &str) -> String {
    let t = js_trim(p);
    let s = strip_one_quote_each_end(t);
    let s = s.strip_prefix("./").unwrap_or(&s).to_string();
    s.trim_end_matches('/').to_string()
}

fn segment_matches(pattern_segment: &str, rel_segment: &str) -> bool {
    if pattern_segment == "*" {
        return true;
    }
    if !pattern_segment.contains('*') {
        return pattern_segment == rel_segment;
    }
    let mut re = String::from("^");
    for c in pattern_segment.chars() {
        if c == '*' {
            re.push_str("[^/]*");
        } else {
            re.push_str(&regex::escape(&c.to_string()));
        }
    }
    re.push('$');
    Regex::new(&re).map(|r| r.is_match(rel_segment)).unwrap_or(false)
}

// ─── extractSectionValue / extractPlatform ─────────────────────────────────

/// JS: extractSectionValue(product, heading)
pub fn extract_section_value(product: Option<&str>, heading: &str) -> Option<String> {
    let product = product?;
    if product.is_empty() {
        return None;
    }
    let heading_re = Regex::new(&format!(r"(?i)^##\s+{}\s*$", regex::escape(heading))).ok()?;
    let lines: Vec<&str> = product.split('\n').collect();
    for i in 0..lines.len() {
        if heading_re.is_match(js_trim(lines[i])) {
            for j in i + 1..lines.len() {
                let next = js_trim(lines[j]);
                if is_heading_line(next) {
                    return None;
                }
                if !next.is_empty() {
                    return Some(next.to_string());
                }
            }
        }
    }
    None
}

fn is_heading_line(s: &str) -> bool {
    // /^#{1,6}\s/
    let hashes = s.chars().take_while(|c| *c == '#').count();
    if hashes == 0 || hashes > 6 {
        return false;
    }
    s[hashes..].chars().next().map(|c| c.is_whitespace()).unwrap_or(false)
}

/// JS: extractPlatform
pub fn extract_platform(product: Option<&str>) -> Option<String> {
    let value = extract_section_value(product, "Platform").unwrap_or_default().to_lowercase();
    if value.is_empty() {
        return None;
    }
    if matches!(value.as_str(), "web" | "ios" | "android" | "adaptive") {
        return Some(value);
    }
    let tokens: Vec<&str> = value
        .split(|c: char| c.is_whitespace() || c == ',' || c == '+' || c == '&' || c == '/')
        .filter(|t| !t.is_empty() && *t != "and")
        .collect();
    if tokens.len() >= 2
        && tokens.iter().all(|t| *t == "ios" || *t == "android")
        && tokens.contains(&"ios")
        && tokens.contains(&"android")
    {
        return Some("adaptive".to_string());
    }
    None
}

// ─── hasVisualImplementation ───────────────────────────────────────────────

static RE_BLOCK_COMMENT: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?s)/\*.*?\*/").unwrap());
static RE_HTML_COMMENT: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?s)<!--.*?-->").unwrap());
static RE_LINE_COMMENT: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)^\s*//.*$").unwrap());
static RE_CUSTOM_PROP: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)--[a-z0-9_-]+\s*:").unwrap());
static RE_VISUAL_DECL: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)(?-u:\b)(?:color|background(?:-color)?|border(?:-color)?|font-family)\s*:").unwrap());
static RE_TOKEN_NAME: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?-u:\b)(?:tokens?|theme|design-system)(?-u:\b)").unwrap());
static RE_STYLE_LINK: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)<style(?-u:\b)|<link[^>]+stylesheet").unwrap());
static RE_CLASS_ATTR: Lazy<Regex> = Lazy::new(|| Regex::new("(?i)class(?:Name)?\\s*=\\s*[\"'`]([^\"'`]+)[\"'`]").unwrap());
static RE_STYLED: Lazy<Regex> = Lazy::new(|| Regex::new("(?i)class(?:Name)?\\s*=|style\\s*=|styled\\(|css`").unwrap());
static RE_MIN: Lazy<Regex> = Lazy::new(|| Regex::new(r"\.min\.[a-z]+$").unwrap());

fn js_slice_utf16(s: &str, n: usize) -> &str {
    let mut units = 0;
    for (i, c) in s.char_indices() {
        let l = c.len_utf16();
        if units + l > n {
            return &s[..i];
        }
        units += l;
    }
    s
}

/// JS: hasVisualImplementation(projectRoot)
pub fn has_visual_implementation(project_root: &str) -> bool {
    if project_root.is_empty() {
        return false;
    }
    let root = jsp::resolve(project_root, &[]);
    let mut queue: std::collections::VecDeque<(String, usize)> = std::collections::VecDeque::new();
    for rel in VISUAL_SOURCE_DIRS {
        let dir = jsp::join(&[&root, rel]);
        if exists(&dir) {
            queue.push_back((dir, 0));
        }
    }
    let mut scanned: usize = 0;
    let mut styled: usize = 0;

    let inspect = |file_path: &str, scanned: &mut usize, styled: &mut usize| -> bool {
        let ext = jsp::extname(file_path).to_lowercase();
        let is_style = STYLE_EXTENSIONS.contains(&ext.as_str());
        let is_ui = UI_EXTENSIONS.contains(&ext.as_str());
        if !is_style && !is_ui {
            return false;
        }
        let base = jsp::basename(file_path).to_lowercase();
        if RE_MIN.is_match(&base) {
            return false;
        }
        let n = *scanned;
        *scanned += 1;
        if n >= VISUAL_SCAN_FILE_LIMIT {
            return false;
        }
        let Some(raw) = safe_read(file_path) else { return false };
        let body = js_slice_utf16(&raw, 64 * 1024);
        let e1 = RE_BLOCK_COMMENT.replace_all(body, "");
        let e2 = RE_HTML_COMMENT.replace_all(&e1, "");
        let evidence = RE_LINE_COMMENT.replace_all(&e2, "").into_owned();
        let ev_len = utf16_len(&evidence);
        if is_style {
            let custom = RE_CUSTOM_PROP.find_iter(&evidence).count();
            let visual = RE_VISUAL_DECL.find_iter(&evidence).count();
            if RE_TOKEN_NAME.is_match(&base) && utf16_len(js_trim(&evidence)) > 80 {
                return true;
            }
            if custom >= 3 || visual >= 5 {
                return true;
            }
        }
        let is_html = ext == ".html" || ext == ".htm";
        if is_html && ev_len > 600 && RE_STYLE_LINK.is_match(&evidence) {
            return true;
        }
        if !is_html && ev_len > 300 {
            let custom = RE_CUSTOM_PROP.find_iter(&evidence).count();
            let visual = RE_VISUAL_DECL.find_iter(&evidence).count();
            let class_tokens: usize = RE_CLASS_ATTR
                .captures_iter(&evidence)
                .map(|m| {
                    let t = js_trim(&m[1]);
                    // ''.split(/\s+/) -> [''] (length 1)
                    if t.is_empty() {
                        1
                    } else {
                        t.split(|c: char| c.is_whitespace()).filter(|s| !s.is_empty()).count()
                    }
                })
                .sum();
            if (custom >= 3 && visual >= 3) || visual >= 5 || class_tokens >= 12 {
                return true;
            }
        }
        if !is_html && ev_len > 300 && RE_STYLED.is_match(&evidence) {
            *styled += 1;
            if *styled >= 3 {
                return true;
            }
        }
        false
    };

    if let Some(entries) = read_dir_entries(&root) {
        for e in entries {
            if e.is_file && inspect(&jsp::join(&[&root, &e.name]), &mut scanned, &mut styled) {
                return true;
            }
        }
    }
    while let Some((dir, depth)) = queue.pop_front() {
        if scanned >= VISUAL_SCAN_FILE_LIMIT {
            break;
        }
        let Some(entries) = read_dir_entries(&dir) else { continue };
        for e in entries {
            if e.is_dir {
                if depth >= VISUAL_SCAN_DEPTH_LIMIT
                    || e.name.starts_with('.')
                    || WORKSPACE_DISCOVERY_IGNORED_DIRS.contains(&e.name.as_str())
                {
                    continue;
                }
                queue.push_back((jsp::join(&[&dir, &e.name]), depth + 1));
            } else if e.is_file && inspect(&jsp::join(&[&dir, &e.name]), &mut scanned, &mut styled) {
                return true;
            }
            if scanned >= VISUAL_SCAN_FILE_LIMIT {
                break;
            }
        }
    }
    let _ = is_dir;
    styled >= 3
}
