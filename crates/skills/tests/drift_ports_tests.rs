//! Ports of the upstream Aug 17-31 `tests/skills-cli.test.js` scenarios that
//! rode along with the drift fixes:
//!
//! * 5d932f9f (#479): safe mkdtemp staging + downloadFile error handling
//! * af2e8b3a: bundle downloads stream to disk (no in-memory buffering)
//! * 7b945856: Claude agent installation (.claude/agents)
//! * 16a218e6: home-scoped agent freshness in `check`
//! * d2a9efb9: inferred home-rooted updates keep agentScope 'user'
//! * 49571365 (#642): Grok project hooks rewritten to the global skill path
//! * 665c51b9 (#604): Windows hook migration dedupe (separator normalization)
//!
//! Where the JS asserted on `node ".../hook.mjs"` command forms, the
//! launcher-era engine writes `"<skill>/scripts/impeccable" hook`; those
//! assertions are adapted to the launcher form the bundle ships today.

use std::collections::HashMap;
use std::path::PathBuf;

use impeccable_common::{jsp, Io};
use impeccable_skills::bundle::{self, download_file_with, FetchResponse};
use impeccable_skills::hook_manifest::merge_hook_manifests;
use impeccable_skills::providers::{Scope, Sys};
use serde_json::{json, Value};

fn temp_root(name: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("impeccable-{name}-{}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("temp root");
    // Like Node's `realpathSync`: no `\\?\` verbatim prefix on Windows, so the
    // `/`-joined paths these tests build under this root still resolve (the
    // kernel takes a verbatim path literally and rejects a forward slash).
    let real = dir.canonicalize().unwrap().to_string_lossy().into_owned();
    real.strip_prefix(r"\\?\").map(str::to_string).unwrap_or(real)
}

fn write(path: &str, content: &str) {
    let p = std::path::Path::new(path);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, content).unwrap();
}

fn read(path: &str) -> String {
    std::fs::read_to_string(path).unwrap_or_else(|e| panic!("read {path}: {e}"))
}

/// JS: createFakeUniversalBundle(root, providers).
fn create_fake_universal_bundle(root: &str, providers: &[&str]) -> String {
    let bundle_root = format!("{root}/universal-bundle");
    for provider in providers {
        let skill_dir = format!("{bundle_root}/{provider}/skills/impeccable");
        write(
            &format!("{skill_dir}/SKILL.md"),
            &format!("---\nname: impeccable\nversion: 9.9.9-local\n---\n\nLocal deterministic bundle for {provider}.\n"),
        );
        write(&format!("{skill_dir}/scripts/context.mjs"), "console.log(\"local bundle context\");\n");
    }
    if providers.contains(&".claude") {
        write(
            &format!("{bundle_root}/.claude/settings.json"),
            &json!({
                "description": "fresh claude hook",
                "hooks": { "PostToolUse": [{ "matcher": "Edit", "hooks": [{ "type": "command", "command": "node \".claude/skills/impeccable/scripts/hook.mjs\"" }] }] },
            })
            .to_string(),
        );
        write(
            &format!("{bundle_root}/.claude/agents/impeccable-finish-reviewer.md"),
            "---\nname: impeccable-finish-reviewer\ndescription: Reviews a finished build.\n---\nClaude reviewer body.\n",
        );
    }
    if providers.contains(&".cursor") {
        write(
            &format!("{bundle_root}/.cursor/hooks.json"),
            &json!({
                "version": 1,
                "hooks": { "preToolUse": [{ "command": "node \".cursor/skills/impeccable/scripts/hook-before-edit.mjs\"" }] },
            })
            .to_string(),
        );
        write(
            &format!("{bundle_root}/.cursor/agents/impeccable-finish-reviewer.md"),
            "---\nname: impeccable-finish-reviewer\ndescription: Reviews a finished build.\nmodel: inherit\nreadonly: true\nis_background: false\n---\nCursor reviewer body.\n",
        );
    }
    if providers.contains(&".agents") {
        write(
            &format!("{bundle_root}/.codex/hooks.json"),
            &json!({
                "hooks": { "PostToolUse": [{ "matcher": "apply_patch", "hooks": [{ "type": "command", "command": "node \".codex/skills/impeccable/scripts/hook.mjs\"" }] }] },
            })
            .to_string(),
        );
    }
    if providers.contains(&".grok") {
        write(
            &format!("{bundle_root}/.grok/hooks/impeccable.json"),
            &json!({
                "hooks": { "PostToolUse": [{ "matcher": "Edit|Write|MultiEdit", "hooks": [{ "type": "command", "command": "node \".grok/skills/impeccable/scripts/hook.mjs\"" }] }] },
            })
            .to_string(),
        );
    }
    if providers.contains(&".github") {
        write(
            &format!("{bundle_root}/.github/agents/impeccable-finish-reviewer.agent.md"),
            "---\nname: impeccable-finish-reviewer\ndescription: Reviews a finished build.\n---\nCopilot reviewer body.\n",
        );
        write(
            &format!("{bundle_root}/.github/agents/impeccable-asset-producer.agent.md"),
            "---\nname: impeccable-asset-producer\ndescription: Produces assets.\n---\nCopilot producer body.\n",
        );
    }
    bundle_root
}

struct Run {
    stdout: String,
    stderr: String,
    code: i32,
}

fn run_cli(args: &[&str], cwd: &str, env: &HashMap<String, String>) -> Run {
    let argv: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    let (mut io, captured) = Io::captured("", PathBuf::from(cwd), env.clone());
    let code = impeccable_skills::run(&argv, &mut io);
    drop(io);
    let stdout = String::from_utf8_lossy(&captured.stdout.borrow()).into_owned();
    let stderr = String::from_utf8_lossy(&captured.stderr.borrow()).into_owned();
    Run { stdout, stderr, code }
}

fn base_env(home: &str, tmp: &str, bundle: &str) -> HashMap<String, String> {
    let mut env = HashMap::new();
    // `os.homedir()` reads USERPROFILE on Windows and HOME on posix, so a
    // fixture home has to name both or the verb writes into the real profile.
    env.insert("HOME".to_string(), home.to_string());
    env.insert("USERPROFILE".to_string(), home.to_string());
    env.insert("TMPDIR".to_string(), tmp.to_string());
    env.insert("TEMP".to_string(), tmp.to_string());
    env.insert("IMPECCABLE_BUNDLE_PATH".to_string(), bundle.to_string());
    env
}

fn sys_for(cwd: &str, env: &HashMap<String, String>) -> Sys {
    Sys::new(env.clone(), cwd.to_string())
}

// ─── downloadFile (#479) ─────────────────────────────────────────────────────

fn response(status: u16, location: Option<&str>, body: &str) -> FetchResponse {
    FetchResponse {
        status,
        location: location.map(str::to_string),
        body: Box::new(std::io::Cursor::new(body.as_bytes().to_vec())),
    }
}

#[test]
fn download_file_200_writes_body_to_dest_with_wx_flag() {
    let root = temp_root("dl-wx");
    let dest = format!("{root}/out.bin");
    let mut fetch = |_url: &str| Ok(response(200, None, "hello"));
    download_file_with("https://example.com/file", &dest, &mut fetch).unwrap();
    assert_eq!(read(&dest), "hello");
    // A second download onto the same dest fails (wx) and leaves the file.
    let err = download_file_with("https://example.com/file", &dest, &mut fetch).unwrap_err();
    assert!(err.contains("EEXIST"), "{err}");
    assert_eq!(read(&dest), "hello");
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn download_file_404_throws_and_dest_does_not_exist() {
    let root = temp_root("dl-404");
    let dest = format!("{root}/out.bin");
    let mut fetch = |_url: &str| Ok(response(404, None, "not found"));
    let err = download_file_with("https://example.com/missing", &dest, &mut fetch).unwrap_err();
    assert_eq!(err, "HTTP 404");
    assert!(!std::path::Path::new(&dest).exists());
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn download_file_redirect_302_to_200_follows_location() {
    let root = temp_root("dl-302");
    let dest = format!("{root}/out.bin");
    let mut calls = 0;
    let mut fetch = |url: &str| {
        calls += 1;
        if url == "https://example.com/start" {
            Ok(response(302, Some("https://example.com/final"), ""))
        } else {
            assert_eq!(url, "https://example.com/final");
            Ok(response(200, None, "final body"))
        }
    };
    download_file_with("https://example.com/start", &dest, &mut fetch).unwrap();
    assert_eq!(calls, 2);
    assert_eq!(read(&dest), "final body");
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn download_file_redirect_to_404_throws_and_dest_does_not_exist() {
    let root = temp_root("dl-302-404");
    let dest = format!("{root}/out.bin");
    let mut fetch = |url: &str| {
        if url.contains("/start") {
            Ok(response(302, Some("https://example.com/bad"), ""))
        } else {
            Ok(response(404, None, "error"))
        }
    };
    let err = download_file_with("https://example.com/start", &dest, &mut fetch).unwrap_err();
    assert_eq!(err, "HTTP 404");
    assert!(!std::path::Path::new(&dest).exists());
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn download_file_redirect_to_http_throws_non_https() {
    let root = temp_root("dl-http-redirect");
    let dest = format!("{root}/out.bin");
    let mut fetch = |_url: &str| Ok(response(302, Some("http://example.com/insecure"), ""));
    let err = download_file_with("https://example.com/start", &dest, &mut fetch).unwrap_err();
    assert_eq!(err, "Refusing non-HTTPS URL");
    assert!(!std::path::Path::new(&dest).exists());
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn download_file_relative_redirect_resolved_against_current_url() {
    let root = temp_root("dl-relative");
    let dest = format!("{root}/out.bin");
    let mut fetch = |url: &str| {
        if url == "https://example.com/api/start" {
            Ok(response(302, Some("/final"), ""))
        } else {
            assert_eq!(url, "https://example.com/final");
            Ok(response(200, None, "ok"))
        }
    };
    download_file_with("https://example.com/api/start", &dest, &mut fetch).unwrap();
    assert_eq!(read(&dest), "ok");
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn download_file_too_many_redirects() {
    let root = temp_root("dl-loop");
    let dest = format!("{root}/out.bin");
    let mut fetch = |_url: &str| Ok(response(302, Some("https://example.com/loop"), ""));
    let err = download_file_with("https://example.com/loop", &dest, &mut fetch).unwrap_err();
    assert_eq!(err, "Too many redirects");
    assert!(!std::path::Path::new(&dest).exists());
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn download_file_transport_error_leaves_dest_absent() {
    let root = temp_root("dl-err");
    let dest = format!("{root}/out.bin");
    let mut fetch = |_url: &str| Err("network down".to_string());
    let err = download_file_with("https://example.com/file", &dest, &mut fetch).unwrap_err();
    assert_eq!(err, "network down");
    assert!(!std::path::Path::new(&dest).exists());
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn download_file_http_initial_url_throws_without_calling_fetch() {
    let root = temp_root("dl-http");
    let dest = format!("{root}/out.bin");
    let mut called = false;
    let mut fetch = |_url: &str| {
        called = true;
        Ok(response(200, None, "x"))
    };
    let err = download_file_with("http://example.com/file", &dest, &mut fetch).unwrap_err();
    assert_eq!(err, "Refusing non-HTTPS URL");
    assert!(!called);
    assert!(!std::path::Path::new(&dest).exists());
    std::fs::remove_dir_all(&root).ok();
}

// ─── downloadAndExtractBundle: safe staging dir (#479) ───────────────────────

#[test]
fn local_bundle_uses_mkdtemp_staging_under_tmpdir() {
    let root = temp_root("staging");
    // The staging dir the bundle builds is joined with the host's path
    // semantics, so the tmpdir it is compared against is joined the same way.
    let tmp = jsp::join(&[&root, "tmp"]);
    std::fs::create_dir_all(&tmp).unwrap();
    let bundle_root = create_fake_universal_bundle(&root, &[".claude"]);
    let env = base_env(&root, &tmp, &bundle_root);
    let sys = sys_for(&root, &env);

    let staging = bundle::download_and_extract_bundle(&sys).unwrap();
    assert!(staging.starts_with(&tmp), "{staging} not under {tmp}");
    let basename = staging.rsplit(['/', '\\']).next().unwrap();
    assert!(basename.starts_with("impeccable-local-bundle-"), "{basename}");
    // Random mkdtemp suffix, not the old `-<pid>-<millis>` form.
    let suffix = &basename["impeccable-local-bundle-".len()..];
    assert!(
        !suffix.split('-').all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit())),
        "staging dir still uses the pid-timestamp form: {basename}"
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(&staging).unwrap().permissions().mode() & 0o777, 0o700);
    }
    assert!(std::path::Path::new(&format!("{staging}/.claude/skills/impeccable/SKILL.md")).exists());
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn local_bundle_failure_removes_the_staging_dir() {
    let root = temp_root("staging-fail");
    let tmp = format!("{root}/tmp");
    std::fs::create_dir_all(&tmp).unwrap();
    // A "zip" that is not a zip: extraction fails after staging is created.
    let bad_zip = format!("{root}/bundle.zip");
    write(&bad_zip, "this is not a zip archive");
    let env = base_env(&root, &tmp, &bad_zip);
    let sys = sys_for(&root, &env);

    assert!(bundle::download_and_extract_bundle(&sys).is_err());
    let leftovers: Vec<String> = std::fs::read_dir(&tmp)
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    assert!(leftovers.is_empty(), "staging not cleaned up: {leftovers:?}");
    std::fs::remove_dir_all(&root).ok();
}

// ─── copyProviderAgents: Claude subagents (7b945856) ─────────────────────────

#[test]
fn claude_project_and_user_scopes_use_claude_agents_dir() {
    let root = temp_root("agents-claude");
    let tmp = format!("{root}/project");
    let home = format!("{root}/home");
    std::fs::create_dir_all(&tmp).unwrap();
    std::fs::create_dir_all(&home).unwrap();
    let bundle_dir = create_fake_universal_bundle(&root, &[".claude"]);
    write(&format!("{home}/.claude/agents/impeccable-finish-reviewer.md"), "stale copy\n");

    let env: HashMap<String, String> = HashMap::from([
        ("HOME".to_string(), home.clone()),
        ("USERPROFILE".to_string(), home.clone()),
    ]);
    let sys = sys_for(&tmp, &env);
    let project_results =
        bundle::copy_provider_agents(&sys, &bundle_dir, &tmp, &[".claude"], Some(Scope::Project)).unwrap();
    let user_results =
        bundle::copy_provider_agents(&sys, &bundle_dir, &home, &[".claude"], Some(Scope::User)).unwrap();

    assert_eq!(project_results.len(), 1);
    assert!(project_results[0].shadowed.is_empty());
    assert_eq!(user_results.len(), 1);
    assert!(read(&format!("{tmp}/.claude/agents/impeccable-finish-reviewer.md")).contains("Claude reviewer body."));
    assert!(read(&format!("{home}/.claude/agents/impeccable-finish-reviewer.md")).contains("Claude reviewer body."));
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn claude_install_and_update_backfill_bundled_agents() {
    let root = temp_root("agents-claude-install");
    let tmp = format!("{root}/project");
    let home = format!("{root}/home");
    let tmpdir = format!("{root}/tmp");
    for d in [&tmp, &home, &tmpdir] {
        std::fs::create_dir_all(d).unwrap();
    }
    std::fs::create_dir_all(format!("{tmp}/.git")).unwrap();
    let bundle_root = create_fake_universal_bundle(&tmp, &[".claude"]);
    let env = base_env(&home, &tmpdir, &bundle_root);
    let agent_path = format!("{tmp}/.claude/agents/impeccable-finish-reviewer.md");

    let r = run_cli(&["install", "-y", "--no-hooks", "--providers=claude"], &tmp, &env);
    assert_eq!(r.code, 0, "{}\n{}", r.stdout, r.stderr);
    assert!(r.stdout.contains("Installed Claude Code agents into:"), "{}", r.stdout);
    assert!(std::path::Path::new(&agent_path).exists());

    std::fs::remove_file(&agent_path).unwrap();
    let r = run_cli(&["update", "-y", "--no-hooks"], &tmp, &env);
    assert_eq!(r.code, 0, "{}\n{}", r.stdout, r.stderr);
    assert!(r.stdout.contains("Updated"), "{}", r.stdout);
    assert!(r.stdout.contains("Installed Claude Code agents into:"), "{}", r.stdout);
    assert!(std::path::Path::new(&agent_path).exists());
    std::fs::remove_dir_all(&root).ok();
}

// ─── home-scoped agent freshness (16a218e6) ──────────────────────────────────

#[test]
fn check_accepts_current_copilot_user_agents_in_home_rooted_checkout() {
    let root = temp_root("agents-check-home");
    let home = format!("{root}/home");
    let tmpdir = format!("{root}/tmp");
    for d in [&home, &tmpdir] {
        std::fs::create_dir_all(d).unwrap();
    }
    std::fs::create_dir_all(format!("{home}/.git")).unwrap();
    let bundle_root = create_fake_universal_bundle(&home, &[".github"]);
    let env = base_env(&home, &tmpdir, &bundle_root);

    let r = run_cli(
        &["install", "-y", "--scope=global", "--no-hooks", "--providers=github"],
        &home,
        &env,
    );
    assert_eq!(r.code, 0, "{}\n{}", r.stdout, r.stderr);
    assert!(std::path::Path::new(&format!("{home}/.copilot/agents/impeccable-finish-reviewer.agent.md")).exists());
    assert!(!std::path::Path::new(&format!("{home}/.github/agents")).exists());

    let r = run_cli(&["check"], &home, &env);
    assert!(r.stdout.contains("Skills are up to date"), "{}\n{}", r.stdout, r.stderr);
    assert!(!r.stdout.contains("Updates available"), "{}", r.stdout);
    std::fs::remove_dir_all(&root).ok();
}

// ─── inferred agent update scope (d2a9efb9) ──────────────────────────────────

#[test]
fn inferred_home_rooted_updates_refresh_stale_or_missing_copilot_user_agents() {
    let root = temp_root("agents-update-home");
    let home = format!("{root}/home");
    let tmpdir = format!("{root}/tmp");
    for d in [&home, &tmpdir] {
        std::fs::create_dir_all(d).unwrap();
    }
    std::fs::create_dir_all(format!("{home}/.git")).unwrap();
    let bundle_root = create_fake_universal_bundle(&home, &[".github"]);
    let env = base_env(&home, &tmpdir, &bundle_root);
    let user_agent = format!("{home}/.copilot/agents/impeccable-finish-reviewer.agent.md");
    let project_agent = format!("{home}/.github/agents/impeccable-finish-reviewer.agent.md");

    let r = run_cli(
        &["install", "-y", "--scope=global", "--no-hooks", "--providers=github"],
        &home,
        &env,
    );
    assert_eq!(r.code, 0, "{}\n{}", r.stdout, r.stderr);
    write(&user_agent, "stale copy\n");

    let r = run_cli(&["update", "-y", "--no-hooks"], &home, &env);
    assert_eq!(r.code, 0, "{}\n{}", r.stdout, r.stderr);
    assert!(read(&user_agent).contains("Copilot reviewer body."));
    assert!(!std::path::Path::new(&project_agent).exists());

    std::fs::remove_file(&user_agent).unwrap();
    let r = run_cli(&["update", "-y", "--no-hooks"], &home, &env);
    assert_eq!(r.code, 0, "{}\n{}", r.stdout, r.stderr);
    assert!(read(&user_agent).contains("Copilot reviewer body."));
    assert!(!std::path::Path::new(&project_agent).exists());
    std::fs::remove_dir_all(&root).ok();
}

// ─── Grok project hooks on global installs (49571365, #642) ──────────────────

/// The launcher path the installer writes into a hook manifest, in the host's
/// path form and escaped the way it lands inside the JSON file (a Windows path
/// carries backslashes, which JSON doubles).
fn manifest_skill_path(home: &str, provider: &str) -> String {
    let p = jsp::join(&[home, provider, "skills", "impeccable", "scripts", "impeccable"]);
    let quoted = serde_json::to_string(&p).unwrap();
    quoted[1..quoted.len() - 1].to_string()
}

#[test]
fn global_install_rewrites_grok_project_hooks_to_the_global_skill_path() {
    let root = temp_root("grok-global");
    let tmp = format!("{root}/project");
    let home = format!("{root}/home");
    let tmpdir = format!("{root}/tmp");
    for d in [&tmp, &home, &tmpdir] {
        std::fs::create_dir_all(d).unwrap();
    }
    std::fs::create_dir_all(format!("{tmp}/.git")).unwrap();
    let bundle_root = create_fake_universal_bundle(&tmp, &[".claude", ".agents", ".cursor", ".grok"]);
    let env = base_env(&home, &tmpdir, &bundle_root);

    let r = run_cli(
        &["install", "-y", "--providers=claude,codex,cursor,grok", "--scope=global"],
        &tmp,
        &env,
    );
    assert_eq!(r.code, 0, "{}\n{}", r.stdout, r.stderr);
    assert!(
        r.stdout.contains("Installed impeccable into: .claude, .agents, .cursor, .grok (global)"),
        "{}",
        r.stdout
    );
    for provider in [".claude", ".agents", ".cursor", ".grok"] {
        assert!(std::path::Path::new(&format!("{home}/{provider}/skills/impeccable/SKILL.md")).exists());
        assert!(!std::path::Path::new(&format!("{tmp}/{provider}/skills/impeccable/SKILL.md")).exists());
    }
    // Launcher-era adaptation: the JS asserted the rewritten hook.mjs path;
    // the engine writes the launcher form pointing at the same global root.
    assert!(read(&format!("{tmp}/.claude/settings.local.json")).contains(&manifest_skill_path(&home, ".claude")));
    assert!(read(&format!("{tmp}/.codex/hooks.json")).contains(&manifest_skill_path(&home, ".agents")));
    assert!(read(&format!("{tmp}/.cursor/hooks.json")).contains(&manifest_skill_path(&home, ".cursor")));
    let grok_hooks = read(&format!("{tmp}/.grok/hooks/impeccable.json"));
    assert!(
        grok_hooks.contains(&manifest_skill_path(&home, ".grok")),
        "grok hook not rewritten to the global skill path: {grok_hooks}"
    );
    assert!(
        !grok_hooks.contains("\\\".grok/skills/impeccable/scripts/hook.mjs\\\"") && !grok_hooks.contains("hook.mjs"),
        "grok hook still points at the project-relative bundle command: {grok_hooks}"
    );
    std::fs::remove_dir_all(&root).ok();
}

// ─── Windows hook migration dedupe (665c51b9, #604) ──────────────────────────

#[test]
fn merge_hook_manifests_replaces_legacy_windows_path_claude_hooks() {
    let legacy_path = r"C:\Users\alice\.claude\skills\impeccable\scripts\hook.mjs";
    let legacy_command = format!("[ ! -f \"{legacy_path}\" ] || node \"{legacy_path}\"");
    let fresh_command = format!("node -e \"guard\" \"{legacy_path}\"");
    let merged = merge_hook_manifests(
        &json!({
            "hooks": {
                "PostToolUse": [{ "matcher": "Edit|Write|MultiEdit", "hooks": [
                    { "type": "command", "command": legacy_command },
                ] }],
                "Stop": [{ "hooks": [{ "type": "command", "command": legacy_command }] }],
            },
        }),
        &json!({
            "hooks": {
                "PostToolUse": [{ "matcher": "Edit|Write|MultiEdit", "hooks": [
                    { "type": "command", "command": fresh_command },
                ] }],
                "Stop": [{ "hooks": [{ "type": "command", "command": fresh_command }] }],
            },
        }),
    );

    let post = merged["hooks"]["PostToolUse"].as_array().unwrap();
    let stop = merged["hooks"]["Stop"].as_array().unwrap();
    assert_eq!(post.len(), 1, "legacy Windows guard duplicated: {post:?}");
    assert_eq!(stop.len(), 1, "legacy Windows guard duplicated: {stop:?}");
    assert_eq!(post[0]["hooks"][0]["command"], Value::String(fresh_command.clone()));
    assert_eq!(stop[0]["hooks"][0]["command"], Value::String(fresh_command));
}
