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
  - Checks .impeccable/live/config.json (with --auto-config, created for a plain HTML or Vite page without CSP)
  - Starts (or reuses) the live server in the background
  - Injects the browser script tag
  - Reads PRODUCT.md / DESIGN.md for project context
  - Prepares the harness-native foreground/background poll loop
  - In monorepos, choose a child app first; --target <path> is the fallback/manual path

On success, prints a JSON blob with:
  { ok, serverPort, serverToken, pageFiles, liveConfigPath, configDrift,
    projectRoot, repoRoot, targetPath, roots, hasProduct, product, productPath,
    hasDesign, design, designPath, hasSurfaceBrief, surfaceBrief, surfaceBriefPath, _instructions }
  Optional: configCreated (only when created), devUrl (--dev-url),
    pageUrls (--dev-url, no server or package.json: existing HTML file URLs),
    devCommand (--dev-url, no server: dev/start/serve script command),
    liveBarHidden (--no-live-bar), contextMissing and contextNote (--allow-missing-context)

On target_selection_required, prints:
  { ok: false, error: \"target_selection_required\", targetCandidates }

On config_missing, prints:
  { ok: false, error: \"config_missing\", path, targetPath, projectRoot, repoRoot }

The agent should then:
  1. If target_selection_required, ask which app to use and rerun from that child cwd
  2. If config_missing, create the config and re-run this script
  3. Optionally open the project's dev/preview URL in the browser (see reference/live.md; not serverPort)
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
        let mut payload = json!({
            "ok": false,
            "error": "target_selection_required",
            "targetPath": null,
            "projectRoot": sel.project_root,
            "repoRoot": sel.repo_root,
            "targetCandidates": sel.target_candidates,
            "hint": "Ask the user which app Impeccable should use, then rerun live from that child app cwd. Use --target <path> only as a fallback or explicit path diagnostic.",
        });
        if sel.skipped_non_ui > 0 {
            payload["skippedNonUiWorkspaces"] = json!(sel.skipped_non_ui);
        }
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
    // `--allow-missing-context`: a caller that would rather start from the
    // page than from an interview (the generate command) boots anyway; the
    // payload names what is missing so the agent extracts the identity
    // from the surface instead of running init or document mid-session.
    let allow_missing_context = args.iter().any(|a| a == "--allow-missing-context");
    if !missing.is_empty() && !allow_missing_context {
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
    // `--auto-config`: the common single-page case writes its own config (see
    // live_inject::auto_configure); a plain boot still reports config_missing.
    let mut check_args = vec!["--check".to_string()];
    if args.iter().any(|a| a == "--auto-config") {
        check_args.push("--auto-config".to_string());
    }
    let check_out = run_inject(&check_args, &active_cwd, io);
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
    // The generate lane's two opt-ins. Both are silent unless asked for, so
    // a plain boot's payload is unchanged: `--dev-url` probes which dev
    // server is serving this app right now (the page carrying our tag) and
    // reports `devUrl`; `--allow-missing-context` reports `contextMissing`
    // and a `contextNote` for the files it let the boot proceed without.
    let want_dev_url = args.iter().any(|a| a == "--dev-url");
    // `--no-live-bar`: the generate lane wants no bottom bar in any tab for
    // this helper's lifetime; tell the helper now, before any page connects.
    let no_live_bar = args.iter().any(|a| a == "--no-live-bar");
    let live_bar_hidden = if no_live_bar {
        let port = server_info.get("port").and_then(Value::as_u64).unwrap_or(0);
        let token = server_info.get("token").and_then(Value::as_str).unwrap_or("");
        request_live_bar_hidden(port, token)
    } else {
        false
    };
    let token_for_probe = match server_info.get("token") {
        Some(Value::String(s)) => s.clone(),
        _ => String::new(),
    };
    let dev_url = if !want_dev_url || token_for_probe.is_empty() {
        None
    } else {
        crate::dev_url::probe(
            &crate::dev_url::candidates(env.get("IMPECCABLE_DEV_URL_CANDIDATES").map(String::as_str)),
            &token_for_probe,
        )
    };
    let dev_command = if want_dev_url && dev_url.is_none() {
        dev_command(&roots.app_root, &roots.repo_root)
    } else {
        None
    };
    let page_urls = if want_dev_url && dev_url.is_none()
        && !exists(&jsp::join(&[&roots.app_root, "package.json"]))
    {
        page_urls(&roots.app_root, &resolved_files)
    } else {
        Vec::new()
    };
    let context_note = if missing.is_empty() {
        Value::Null
    } else {
        json!(format!(
            "Booted without {} (--allow-missing-context). Extract the identity from the picked element's computed styles, CSS custom properties, and sibling styling; do not run init or document during this session, and do not ask for them.",
            missing.join(" and ")
        ))
    };
    let mut payload = json!({
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
        "_instructions": boot_instructions(&self_cmd, dev_url.as_deref(), page_urls.first().map(String::as_str), dev_command.as_deref()),
    });
    if let Some(obj) = payload.as_object_mut() {
        if check_result.get("configCreated") == Some(&Value::Bool(true)) {
            obj.insert("configCreated".into(), json!(true));
        }
        if no_live_bar {
            obj.insert("liveBarHidden".into(), json!(live_bar_hidden));
        }
        if want_dev_url {
            obj.insert("devUrl".into(), dev_url.map(Value::String).unwrap_or(Value::Null));
        }
        if !page_urls.is_empty() {
            obj.insert("pageUrls".into(), json!(page_urls));
        }
        if let Some(command) = dev_command {
            obj.insert("devCommand".into(), json!(command));
        }
        if allow_missing_context {
            obj.insert("contextMissing".into(), json!(missing));
            obj.insert("contextNote".into(), context_note);
        }
    }
    println(io, &json_pretty(&payload));
    0
}

/// Only the app's own scripts can supply its startup command. Lockfiles may
/// live at the workspace root; prefer pnpm, then yarn, then bun across both roots.
fn dev_command(app_root: &str, repo_root: &str) -> Option<String> {
    let package: Value = serde_json::from_str(&safe_read(&jsp::join(&[app_root, "package.json"]))?).ok()?;
    let scripts = package.get("scripts")?.as_object()?;
    let script = ["dev", "start", "serve"].into_iter()
        .find(|name| scripts.get(*name).and_then(Value::as_str).is_some())?;
    let has_lock = |name| [app_root, repo_root].iter()
        .any(|root| std::path::Path::new(root).join(name).is_file());
    let runner = if has_lock("pnpm-lock.yaml") {
        "pnpm"
    } else if has_lock("yarn.lock") {
        "yarn"
    } else if has_lock("bun.lock") || has_lock("bun.lockb") {
        "bun run"
    } else {
        "npm run"
    };
    Some(format!("{} {}", runner, script))
}

/// Encode UTF-8 bytes, preserving only unreserved characters and path separators.
/// Canonical Windows paths may carry a verbatim prefix or a UNC host.
fn file_url(path: &str) -> String {
    let posix = path.replace('\\', "/");
    let posix = posix.strip_prefix("//?/").unwrap_or(&posix);
    let path = if let Some(unc) = posix.strip_prefix("UNC/") {
        format!("//{}", unc)
    } else {
        posix.to_string()
    };
    let mut encoded = String::new();
    for byte in path.bytes() {
        if byte.is_ascii_alphanumeric() || b"-._~/:".contains(&byte) {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{:02X}", byte));
        }
    }
    if encoded.starts_with("//") {
        format!("file:{}", encoded)
    } else if encoded.starts_with('/') {
        format!("file://{}", encoded)
    } else {
        format!("file:///{}", encoded)
    }
}

/// Resolved page names use POSIX separators, including on Windows. Verbatim
/// Windows roots require each component to be joined separately.
fn join_page_path(root: &std::path::Path, file: &str) -> std::path::PathBuf {
    // An absolute entry in the config's files is used as it stands.
    if std::path::Path::new(file).is_absolute() {
        return std::path::PathBuf::from(file);
    }
    let mut path = root.to_path_buf();
    for component in file.split('/') {
        path.push(component);
    }
    path
}

fn page_urls(app_root: &str, files: &[String]) -> Vec<String> {
    let Ok(root) = std::fs::canonicalize(app_root) else { return Vec::new() };
    files.iter().filter_map(|file| {
        let ext = std::path::Path::new(file).extension()?.to_str()?;
        if !ext.eq_ignore_ascii_case("html") && !ext.eq_ignore_ascii_case("htm") {
            return None;
        }
        let path = std::fs::canonicalize(join_page_path(&root, file)).ok()?;
        if !path.starts_with(&root) || !path.is_file() {
            return None;
        }
        Some(file_url(path.to_str()?))
    }).collect()
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
/// Ask the running helper to keep the overlay's global bar hidden for its
/// lifetime (`POST /live-bar`). True when the helper acknowledged.
fn request_live_bar_hidden(port: u64, token: &str) -> bool {
    if port == 0 || token.is_empty() {
        return false;
    }
    let agent = ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_millis(3000))
        .build();
    agent
        .post(&format!("http://127.0.0.1:{}/live-bar", port))
        .set("Content-Type", "application/json")
        .send_string(&json!({ "token": token, "hidden": true }).to_string())
        .map(|res| res.status() == 200)
        .unwrap_or(false)
}

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


#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT: AtomicUsize = AtomicUsize::new(0);
    const CONFIG: &str = r#"{"files":["index.html"],"insertBefore":"</body>","commentSyntax":"html","cspChecked":true}"#;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "impeccable-auto-config-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir(&root).unwrap();
            let f = Self(root);
            f.write("index.html", "<html><body>Hello</body></html>");
            // Reuse a record for this test process; no server is spawned or needed.
            f.write(".impeccable/live/server.json", &json!({
                "pid": std::process::id(), "port": 19876, "token": "fixture"
            }).to_string());
            f
        }
        fn write(&self, path: &str, text: &str) {
            let p = self.0.join(path);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, text).unwrap();
        }
        fn run(&self, verb: &str, args: &[&str], override_path: Option<&str>) -> (String, Value) {
            let mut env = crate::util::Env::new();
            env.insert("IMPECCABLE_DEV_URL_CANDIDATES".into(), "http://127.0.0.1:1".into());
            if let Some(p) = override_path {
                env.insert("IMPECCABLE_LIVE_CONFIG".into(), p.into());
            }
            let (mut io, captured) = Io::captured("", self.0.clone(), env);
            let args = args.iter().map(|s| s.to_string()).collect::<Vec<_>>();
            let code = if verb == "live" { run(&args, &mut io) } else {
                crate::live_inject::run(&args, &mut io)
            };
            assert_eq!(code, 0);
            let out = String::from_utf8(captured.stdout.borrow().clone()).unwrap();
            let value = serde_json::from_str(&out).unwrap();
            (out, value)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
    }

    #[test]
    fn dev_command_chooses_scripts_in_priority_order() {
        let f = Fixture::new();
        let root = f.0.to_str().unwrap();
        assert_eq!(dev_command(root, root), None);
        for (package, expected) in [
            (r#"{"scripts":{"serve":"serve","start":"start","dev":"dev"}}"#, Some("npm run dev")),
            (r#"{"scripts":{"serve":"serve","start":"start"}}"#, Some("npm run start")),
            (r#"{"scripts":{"serve":"serve"}}"#, Some("npm run serve")),
            (r#"{"scripts":{"build":"build"}}"#, None),
            (r#"{"name":"static"}"#, None),
            (r#"{"scripts":null}"#, None),
            ("invalid json", None),
        ] {
            f.write("package.json", package);
            assert_eq!(dev_command(root, root).as_deref(), expected);
        }
    }

    #[test]
    fn dev_command_detects_each_lockfile_at_app_or_repo_root() {
        for (lock, runner) in [
            ("pnpm-lock.yaml", "pnpm"), ("yarn.lock", "yarn"),
            ("bun.lock", "bun run"), ("bun.lockb", "bun run"),
            ("package-lock.json", "npm run"),
        ] {
            for lock_root in ["", "app/"] {
                let f = Fixture::new();
                f.write("app/package.json", r#"{"scripts":{"dev":"vite"}}"#);
                f.write(&format!("{}{}", lock_root, lock), "");
                assert_eq!(dev_command(f.0.join("app").to_str().unwrap(), f.0.to_str().unwrap()), Some(format!("{} dev", runner)));
            }
        }
        let f = Fixture::new();
        f.write("package.json", r#"{"scripts":{"dev":"repo-only"}}"#);
        f.write("app/package.json", r#"{"name":"static"}"#);
        assert_eq!(dev_command(f.0.join("app").to_str().unwrap(), f.0.to_str().unwrap()), None);
    }

    #[test]
    fn file_urls_encode_paths_and_windows_drives() {
        assert_eq!(file_url("/app with space/pages/about.html"), "file:///app%20with%20space/pages/about.html");
        assert_eq!(file_url("/app/a#b?c%é.html"), "file:///app/a%23b%3Fc%25%C3%A9.html");
        assert_eq!(file_url(r"C:\app with space\pages\about.html"), "file:///C:/app%20with%20space/pages/about.html");
        assert_eq!(file_url(r"\\?\C:\app\index.html"), "file:///C:/app/index.html");
        assert_eq!(file_url(r"\\?\UNC\host\share\index.html"), "file://host/share/index.html");
    }

    #[test]
    fn page_path_joins_posix_components() {
        let f = Fixture::new();
        // canonicalize supplies a verbatim root on Windows.
        let root = std::fs::canonicalize(&f.0).unwrap();
        let joined = join_page_path(&root, "pages/team/about.html");
        assert_eq!(joined, root.join("pages").join("team").join("about.html"));
        assert_eq!(
            joined.strip_prefix(&root).unwrap().components().collect::<Vec<_>>(),
            ["pages", "team", "about.html"].iter()
                .map(|part| std::path::Component::Normal(std::ffi::OsStr::new(part)))
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn page_urls_include_only_existing_html_files_under_app_root() {
        let f = Fixture::new();
        f.write("app/index with space.htm", "<body>Hi</body>");
        f.write("app/pages/about.html", "<body>About</body>");
        f.write("app/src/App.tsx", "export default null;");
        std::fs::create_dir(f.0.join("app/directory.html")).unwrap();
        f.write("app/abs.html", "<body>Abs</body>");
        f.write("outside.html", "<body>Out</body>");
        let root = f.0.join("app");
        // Absolute entries: one inside the app root is kept, one outside is dropped.
        let inside = root.join("abs.html").to_string_lossy().into_owned();
        let outside = f.0.join("outside.html").to_string_lossy().into_owned();
        let files = ["index with space.htm", "pages/about.html", "missing.html", "src/App.tsx", "directory.html", "../index.html", inside.as_str(), outside.as_str()]
            .map(String::from);
        let urls = page_urls(root.to_str().unwrap(), &files);
        let canonical = std::fs::canonicalize(&root).unwrap();
        assert_eq!(urls, vec![
            file_url(canonical.join("index with space.htm").to_str().unwrap()),
            file_url(canonical.join("pages").join("about.html").to_str().unwrap()),
            file_url(canonical.join("abs.html").to_str().unwrap()),
        ]);
        assert!(urls[0].ends_with("/index%20with%20space.htm"));
        assert!(urls[1].ends_with("/pages/about.html"));
    }

    #[test]
    fn boot_dev_url_fallback_fields_are_opt_in() {
        let f = Fixture::new();
        let (_, plain) = f.run("live", &["--allow-missing-context", "--auto-config"], None);
        for key in ["devUrl", "pageUrls", "devCommand"] {
            assert!(plain.get(key).is_none());
        }
        let (_, static_boot) = f.run("live", &["--allow-missing-context", "--dev-url"], None);
        assert_eq!(static_boot["devUrl"], Value::Null);
        let url = file_url(std::fs::canonicalize(f.0.join("index.html")).unwrap().to_str().unwrap());
        assert_eq!(static_boot["pageUrls"], json!([url]));
        assert!(static_boot["_instructions"].as_str().unwrap().contains(&url));
        assert!(static_boot.get("devCommand").is_none());
        f.write("package.json", r#"{"scripts":{"dev":"vite"}}"#);
        let (_, dev_boot) = f.run("live", &["--allow-missing-context", "--dev-url"], None);
        assert_eq!(dev_boot["devCommand"], "npm run dev");
        assert!(dev_boot.get("pageUrls").is_none());
        assert!(dev_boot["_instructions"].as_str().unwrap().contains("run this boot again"));
    }

    #[test]
    fn boot_package_without_startup_script_keeps_generic_instructions() {
        let f = Fixture::new();
        f.write("index.html", "<body><script type=\"module\" src=\"/src/main.jsx\"></script></body>");
        let (_, plain) = f.run("live", &["--allow-missing-context", "--auto-config"], None);
        for package in [
            r#"{"scripts":{"build":"vite build"}}"#,
            r#"{"name":"app"}"#,
            r#"{"scripts":{"dev":false,"start":null,"serve":42}}"#,
            "invalid json",
        ] {
            f.write("package.json", package);
            let (_, boot) = f.run("live", &["--allow-missing-context", "--dev-url"], None);
            assert_eq!(boot["ok"], true);
            assert_eq!(boot["devUrl"], Value::Null);
            assert!(boot.get("pageUrls").is_none(), "{}", package);
            assert!(boot.get("devCommand").is_none(), "{}", package);
            assert_eq!(boot["_instructions"], plain["_instructions"]);
        }
    }

    #[test]
    fn help_lists_dev_url_fallback_fields_on_separate_lines() {
        let optional = HELP.split("Optional:").nth(1).unwrap()
            .split("On target_selection_required").next().unwrap();
        assert!(optional.lines().any(|line| line.trim() ==
            "pageUrls (--dev-url, no server or package.json: existing HTML file URLs),"));
        assert!(optional.lines().any(|line| line.trim() ==
            "devCommand (--dev-url, no server: dev/start/serve script command),"));
    }

    #[test]
    fn without_the_flag_a_missing_config_is_reported_and_nothing_is_written() {
        let f = Fixture::new();
        let (_, boot) = f.run("live", &["--allow-missing-context"], None);
        assert_eq!(boot["error"], "config_missing");
        let (_, check) = f.run("check", &["--check"], None);
        assert_eq!(check["error"], "config_missing");
        assert!(!f.0.join(".impeccable/live/config.json").exists());
    }

    #[test]
    fn auto_config_static_boot_and_existing_config() {
        let f = Fixture::new();
        let (_, first) = f.run("live", &["--allow-missing-context", "--auto-config"], None);
        assert_eq!(first["ok"], true);
        assert_eq!(first["configCreated"], true);
        assert_eq!(first["pageFiles"], json!(["index.html"]));
        assert_eq!(std::fs::read_to_string(f.0.join(".impeccable/live/config.json")).unwrap(), CONFIG);
        assert!(std::fs::read_to_string(f.0.join("index.html")).unwrap().contains("live.js"));
        let (_, second) = f.run("live", &["--allow-missing-context", "--auto-config"], None);
        assert_eq!(second["ok"], true);
        assert!(second.get("configCreated").is_none());
    }

    #[test]
    fn auto_config_check_honours_override_and_vite() {
        for absolute in [false, true] {
            let f = Fixture::new();
            f.write("vite.config.js", "export default {}");
            let path = if absolute { f.0.join("custom/live.json").to_string_lossy().into_owned() }
                else { "custom/live.json".into() };
            let (_, first) = f.run("check", &["--check", "--auto-config"], Some(&path));
            assert_eq!(first["ok"], true);
            assert_eq!(first["configCreated"], true);
            assert_eq!(std::fs::read_to_string(f.0.join("custom/live.json")).unwrap(), CONFIG);
            assert!(!f.0.join(".impeccable/live/config.json").exists());
            let (_, second) = f.run("check", &["--check", "--auto-config"], Some(&path));
            assert!(second.get("configCreated").is_none());
        }
    }

    #[test]
    fn auto_config_target_uses_child_app() {
        let f = Fixture::new();
        f.write("child/vite.config.js", "export default {}");
        f.write("child/index.html", "<body>Child</body>");
        let (_, result) = f.run("check", &["--check", "--auto-config", "--target", "child"], Some("custom/config.json"));
        assert_eq!(result["ok"], true);
        assert_eq!(result["configCreated"], true);
        assert_eq!(std::fs::read_to_string(f.0.join("child/custom/config.json")).unwrap(), CONFIG);
        assert!(!f.0.join("custom/config.json").exists());
    }

    #[test]
    fn auto_config_refuses_uppercase_body_anchor() {
        let f = Fixture::new();
        let html = "<html><body>Hello</BODY></html>";
        f.write("index.html", html);
        let (_, check) = f.run("check", &["--check", "--auto-config"], None);
        assert_eq!(check["error"], "config_missing");
        assert!(check.get("configCreated").is_none());
        assert!(!f.0.join(".impeccable/live/config.json").exists());
        assert_eq!(std::fs::read_to_string(f.0.join("index.html")).unwrap(), html);
    }

    #[test]
    fn auto_config_refuses_missing_body_anchor() {
        let f = Fixture::new();
        let html = "<html><body>Hello</html>";
        f.write("index.html", html);
        let (_, check) = f.run("check", &["--check", "--auto-config"], None);
        assert_eq!(check["error"], "config_missing");
        assert!(check.get("configCreated").is_none());
        assert!(!f.0.join(".impeccable/live/config.json").exists());
        assert_eq!(std::fs::read_to_string(f.0.join("index.html")).unwrap(), html);
    }

    #[test]
    fn auto_config_refuses_csp_frameworks_and_missing_entry() {
        for marker in ["csp", "svelte.config.js", "nuxt.config.ts", "next.config.js", "astro.config.mjs", "tanstack", "missing"] {
            let f = Fixture::new();
            if marker == "csp" {
                f.write("index.html", "<meta http-equiv='Content-Security-Policy' content=\"script-src 'self'\"><body></body>");
            } else if marker == "missing" {
                std::fs::remove_file(f.0.join("index.html")).unwrap();
            } else if marker == "tanstack" {
                f.write("package.json", r#"{"dependencies":{"@tanstack/react-start":"1"}}"#);
                f.write("src/routes/__root.tsx", "export const Route = {};");
            } else {
                f.write(marker, "export default {}");
                if marker == "svelte.config.js" { f.write("src/app.html", "<body>%sveltekit.body%</body>"); }
            }
            // Joined part by part: the engine prints the platform's own separators.
            let path = f.0.join(".impeccable").join("live").join("config.json").to_string_lossy().into_owned();
            let (out, _) = f.run("check", &["--check", "--auto-config"], None);
            assert_eq!(out, format!("{}\n", json!({"ok":false,"error":"config_missing","path":path})), "{marker}");
            assert!(!std::path::Path::new(&path).exists());
            let (_, boot) = f.run("live", &["--allow-missing-context", "--auto-config"], None);
            assert_eq!(boot["error"], "config_missing", "{marker}");
            assert!(boot.get("configCreated").is_none());
        }
    }
}
