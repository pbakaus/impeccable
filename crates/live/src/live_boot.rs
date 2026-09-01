//! JS: live.mjs -> `impeccable live` (boot). Resolve roots, gate on context,
//! persist the roots manifest, check config, start/reuse the helper server,
//! inject, scan for config drift, print the boot payload.

use crate::config::{glob_to_regex, resolve_files, LiveConfig};
use crate::instructions::boot_instructions;
use crate::live_target::resolve_live_target;
use crate::manifests::write_roots_manifest;
use crate::paths::read_live_server_info;
use crate::roots::{resolve_roots, RootsResult};
use crate::server;
use crate::util::{
    exists, is_dir, json_compact, json_pretty, jsp, pid_reachable, println, read_dir_raw, safe_read,
};
use impeccable_common::Io;
use impeccable_context::context::resolve_target_selection;
use impeccable_context::surface_briefs::resolve_surface_brief;
use serde_json::{json, Map, Value};

const HELP: &str = "Usage: impeccable live

Prepare everything for live variant mode in a single command:
  - Checks .impeccable/live/config.json (required, created once per project)
  - Starts (or reuses) the live server in the background
  - Injects the browser script tag
  - Reads PRODUCT.md / DESIGN.md for project context
  - Prepares the harness-native foreground/background poll loop
  - In monorepos, choose a child app first; --target <path> is the fallback/manual path

On success, prints a JSON blob with:
  { ok, serverPort, serverToken, pageFiles, projectRoot, repoRoot, targetPath, productPath, designPath }

On target_selection_required, prints:
  { ok: false, error: \"target_selection_required\", targetCandidates }

On config_missing, prints:
  { ok: false, error: \"config_missing\", configPath, hint }

The agent should then:
  1. If target_selection_required, ask which app to use and rerun from that child cwd
  2. If config_missing, create the config and re-run this script
  3. Optionally open the project's dev/preview URL in the browser (see reference/live.md—not serverPort)
  4. Enter the poll loop: impeccable live-poll";

fn rel_or_null(base: &str, p: Option<&str>) -> Value {
    match p {
        Some(p) => json!(jsp::relative("/", base, p)),
        None => Value::Null,
    }
}

/// JS: safeRead(p): file text or null (empty text is falsy in the gate).
fn read_nonempty(p: Option<&str>) -> Option<String> {
    p.and_then(safe_read)
}

pub fn run(args: &[String], io: &mut Io) -> i32 {
    let cwd = io.cwd.to_string_lossy().into_owned();
    let env = io.env.clone();
    let live_target = match resolve_live_target(&cwd, args, &env) {
        Ok(t) => t,
        Err(msg) => {
            io.err(&format!("{}\n", msg));
            return 1;
        }
    };
    if args.iter().any(|a| a == "--help" || a == "-h") {
        println(io, HELP);
        return 0;
    }

    if let Some(sel) =
        resolve_target_selection(&live_target.original_cwd, &live_target.target_options, &env)
    {
        let payload = json!({
            "ok": false,
            "error": "target_selection_required",
            "targetPath": null,
            "projectRoot": sel.project_root,
            "repoRoot": sel.repo_root,
            "targetCandidates": sel.target_candidates,
            "hint": "Ask the user which app Impeccable should use, then rerun live from that child app cwd. Use --target <path> only as a fallback or explicit path diagnostic.",
        });
        println(io, &json_pretty(&payload));
        return 0;
    }

    let roots = match resolve_roots(
        &live_target.original_cwd,
        live_target.absolute_target_path.as_deref(),
        &env,
    ) {
        RootsResult::Selection(candidates) => {
            let payload = json!({
                "ok": false,
                "error": "target_selection_required",
                "targetCandidates": candidates,
                "hint": "Several apps with a dev-server config exist. Ask the user which one to use, then rerun with --target <path into that app>.",
            });
            println(io, &json_pretty(&payload));
            return 0;
        }
        RootsResult::Manifest(m) => m,
    };
    let active_cwd = roots.app_root.clone();
    let output_target_path: Value = live_target
        .target_path
        .clone()
        .map(Value::String)
        .unwrap_or(Value::Null);

    let product = read_nonempty(roots.product_path.as_deref()).filter(|s| !s.is_empty());
    let design = read_nonempty(roots.design_path.as_deref()).filter(|s| !s.is_empty());
    let mut missing: Vec<&str> = Vec::new();
    if product.is_none() {
        missing.push("PRODUCT.md");
    }
    if design.is_none() {
        missing.push("DESIGN.md");
    }
    if !missing.is_empty() {
        let payload = json!({
            "ok": false,
            "error": "context_missing",
            "missing": missing,
            "nextCommand": if missing.contains(&"PRODUCT.md") { "init" } else { "document" },
            "targetPath": output_target_path,
            "projectRoot": roots.app_root,
            "repoRoot": roots.repo_root,
            "productPath": rel_or_null(&live_target.original_cwd, roots.product_path.as_deref()),
            "designPath": rel_or_null(&live_target.original_cwd, roots.design_path.as_deref()),
        });
        println(io, &json_pretty(&payload));
        return 0;
    }

    write_roots_manifest(&roots);

    // 1. Check config (in-process `live-inject --check` with cwd = appRoot).
    let check_out = run_inject(&["--check".to_string()], &active_cwd, io);
    let check_result: Option<Value> = serde_json::from_str(check_out.trim()).ok();
    let check_ok = check_result
        .as_ref()
        .and_then(|r| r.get("ok"))
        .map(crate::inject::detect_utils::truthy)
        .unwrap_or(false);
    if !check_ok {
        let mut out: Map<String, Value> = match check_result {
            Some(Value::Object(o)) => o,
            Some(other) => {
                // JS: `{ ...nonObject }` spreads nothing useful (a string spreads its chars).
                let mut m = Map::new();
                if let Value::String(s) = other {
                    for (i, c) in s.chars().enumerate() {
                        m.insert(i.to_string(), json!(c.to_string()));
                    }
                }
                m
            }
            None => {
                let mut m = Map::new();
                m.insert("ok".into(), json!(false));
                m.insert("error".into(), json!("check_failed"));
                m.insert("raw".into(), json!(check_out));
                m
            }
        };
        out.insert("targetPath".into(), output_target_path);
        out.insert("projectRoot".into(), json!(roots.app_root));
        out.insert("repoRoot".into(), json!(roots.repo_root));
        println(io, &json_compact(&Value::Object(out)));
        return 0;
    }
    let check_result = check_result.unwrap_or(Value::Null);

    // 2. Start (or reuse) the server.
    let Some(server_info) = ensure_server_running(&active_cwd, io) else {
        println(
            io,
            &json_compact(&json!({ "ok": false, "error": "server_start_failed" })),
        );
        return 1;
    };
    let port_str = match server_info.get("port") {
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::String(s)) => s.clone(),
        Some(other) => other.to_string(),
        None => "undefined".to_string(),
    };
    let token_str = match server_info.get("token") {
        Some(Value::String(s)) => s.clone(),
        Some(other) => other.to_string(),
        None => "undefined".to_string(),
    };

    // 3. Inject at the current port.
    let inject_out = run_inject(
        &[
            "--port".to_string(),
            port_str,
            "--token".to_string(),
            token_str,
        ],
        &active_cwd,
        io,
    );
    let inject_result: Option<Value> = serde_json::from_str(inject_out.trim()).ok();
    let inject_ok = inject_result
        .as_ref()
        .and_then(|r| r.get("ok"))
        .map(crate::inject::detect_utils::truthy)
        .unwrap_or(false);
    if !inject_ok {
        let payload = json!({
            "ok": false,
            "error": "inject_failed",
            "detail": inject_result.unwrap_or_else(|| json!(inject_out)),
            "serverPort": server_info.get("port").cloned().unwrap_or(Value::Null),
        });
        println(io, &json_compact(&payload));
        return 1;
    }

    // 4. Drift scan.
    let config = LiveConfig {
        raw: check_result.get("config").cloned().unwrap_or(Value::Null),
    };
    let resolved_files = resolve_files(&active_cwd, &config);
    let drift = scan_for_drift(&active_cwd, &resolved_files, &config);

    // 5. Surface brief.
    let mut surface_brief: Option<String> = None;
    let mut surface_brief_path: Option<String> = None;
    let mut brief_roots: Vec<String> = Vec::new();
    for dir in [
        Some(roots.app_root.clone()),
        roots.context_root.clone(),
        Some(roots.repo_root.clone()),
    ]
    .into_iter()
    .flatten()
    {
        if !brief_roots
            .iter()
            .any(|d| jsp::resolve(d, &[]) == jsp::resolve(&dir, &[]))
        {
            brief_roots.push(dir);
        }
    }
    for root in &brief_roots {
        let resolved = resolve_surface_brief(root, live_target.absolute_target_path.as_deref());
        let Some(brief) = resolved.brief else {
            continue;
        };
        surface_brief = Some(brief.text.clone());
        surface_brief_path = brief
            .path
            .as_deref()
            .map(|p| jsp::relative("/", &live_target.original_cwd, p));
        break;
    }
    let self_cmd = impeccable_context::provider::detect(&env, &cwd).self_cmd;
    let payload = json!({
        "ok": true,
        "serverPort": server_info.get("port").cloned().unwrap_or(Value::Null),
        "serverToken": server_info.get("token").cloned().unwrap_or(Value::Null),
        "pageFiles": resolved_files,
        "liveConfigPath": check_result.get("path").cloned().unwrap_or(Value::Null),
        "configDrift": drift,
        "targetPath": output_target_path,
        "projectRoot": roots.app_root,
        "repoRoot": roots.repo_root,
        "roots": roots.to_value(),
        "hasProduct": product.is_some(),
        "product": product,
        "productPath": rel_or_null(&live_target.original_cwd, roots.product_path.as_deref()),
        "hasDesign": design.is_some(),
        "design": design,
        "designPath": rel_or_null(&live_target.original_cwd, roots.design_path.as_deref()),
        "hasSurfaceBrief": surface_brief.is_some(),
        "surfaceBrief": surface_brief,
        "surfaceBriefPath": surface_brief_path,
        "_instructions": boot_instructions(&self_cmd),
    });
    println(io, &json_pretty(&payload));
    0
}

/// JS: runScript('live-inject.mjs', args, { cwd }): the inject verb run
/// in-process against `cwd`, its stdout returned (stderr discarded, like
/// `execFileSync` with a non-zero exit returning `err.stdout`).
fn run_inject(args: &[String], cwd: &str, io: &Io) -> String {
    let (mut child, captured) = Io::captured("", std::path::PathBuf::from(cwd), io.env.clone());
    let _ = crate::live_inject::run(args, &mut child);
    let bytes = captured.stdout.borrow().clone();
    String::from_utf8_lossy(&bytes).into_owned()
}

/// JS: ensureServerRunning(cwd): reuse a live `server.json` record, else
/// spawn `live-server --background` (part 3) and parse its output.
fn ensure_server_running(cwd: &str, io: &Io) -> Option<Value> {
    if let Some((info, _)) = read_live_server_info(cwd, &io.env) {
        if let Some(pid) = info.pid {
            if pid_reachable(pid) && crate::util::kill0(pid).is_ok() {
                return Some(info.raw);
            }
        }
    }
    server::spawn_detached(cwd, &io.env)
}

/// JS: scanForDrift(rootDir, resolvedFiles, config)
fn scan_for_drift(root_dir: &str, resolved_files: &[String], config: &LiveConfig) -> Value {
    const SCAN_ROOTS: [&str; 4] = ["public", "src", "app", "pages"];
    const IGNORE_DIRS: [&str; 12] = [
        "node_modules",
        ".git",
        ".next",
        ".nuxt",
        ".svelte-kit",
        ".astro",
        ".turbo",
        ".vercel",
        ".cache",
        "coverage",
        "dist",
        "build",
    ];
    let excludes: Vec<regex::Regex> = config.exclude().iter().map(|p| glob_to_regex(p)).collect();
    let mut orphans: Vec<String> = Vec::new();
    fn walk(
        dir: &str,
        rel_base: &str,
        resolved: &[String],
        excludes: &[regex::Regex],
        orphans: &mut Vec<String>,
    ) {
        let Some(entries) = read_dir_raw(dir) else {
            return;
        };
        for e in entries {
            let rel = if rel_base.is_empty() {
                e.name.clone()
            } else {
                format!("{}/{}", rel_base, e.name)
            };
            if e.is_dir {
                if IGNORE_DIRS.contains(&e.name.as_str()) || e.name.starts_with('.') {
                    continue;
                }
                walk(
                    &jsp::join(&[dir, &e.name]),
                    &rel,
                    resolved,
                    excludes,
                    orphans,
                );
            } else if e.is_file && e.name.ends_with(".html") {
                if resolved.iter().any(|f| jsp::to_posix(f) == rel) {
                    continue;
                }
                if excludes.iter().any(|re| re.is_match(&rel)) {
                    continue;
                }
                orphans.push(rel);
            }
        }
    }
    for root in SCAN_ROOTS {
        let abs = jsp::join(&[root_dir, root]);
        if exists(&abs) && is_dir(&abs) {
            walk(&abs, root, resolved_files, &excludes, &mut orphans);
        }
    }
    if orphans.is_empty() {
        return Value::Null;
    }
    let count = orphans.len();
    let capped: Vec<String> = orphans.into_iter().take(20).collect();
    json!({
        "orphans": capped,
        "orphanCount": count,
        "hint": format!("{} HTML file(s) exist but aren't in config.files. Consider adding them, or use a glob pattern like \"public/**/*.html\".", count),
    })
}
