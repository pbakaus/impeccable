//! Hook manifest rewriting (JS: tests/skills-cli.test.js "copyProviderHooks:
//! hook command path resolution (#399)", "hook manifest merge helpers"), in
//! the launcher generation.

use impeccable_skills::hook_manifest::*;
use impeccable_skills::providers::Sys;
use serde_json::{json, Value};
use std::collections::HashMap;

fn claude_bundle_manifest() -> Value {
    json!({
        "description": "fresh claude hook",
        "hooks": {
            "PostToolUse": [{ "matcher": "Edit", "hooks": [{ "type": "command", "command": "node \".claude/skills/impeccable/scripts/hook.mjs\"" }] }],
            "Stop": [{ "hooks": [{ "type": "command", "command": "[ ! -f \"${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/impeccable\" ] || \"${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/impeccable\" hook", "timeout": 30 }] }]
        }
    })
}

fn commands(v: &Value) -> Vec<String> {
    let mut out = Vec::new();
    fn walk(v: &Value, out: &mut Vec<String>) {
        match v {
            Value::Object(o) => {
                for (k, c) in o {
                    if (k == "command" || k == "commandWindows") && c.is_string() {
                        out.push(format!("{k}={}", c.as_str().unwrap()));
                    } else {
                        walk(c, out);
                    }
                }
            }
            Value::Array(a) => a.iter().for_each(|c| walk(c, out)),
            _ => {}
        }
    }
    walk(v, &mut out);
    out
}

#[test]
fn project_scope_keeps_claude_project_dir_token_and_guard() {
    let out = rewrite_hook_commands_for_platform(&claude_bundle_manifest(), ".claude", "/proj", false, false);
    let cmds = commands(&out);
    assert_eq!(cmds.len(), 2);
    for c in &cmds {
        assert_eq!(
            c,
            "command=[ ! -f \"${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/impeccable\" ] || \"${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/impeccable\" hook"
        );
        assert!(!c.contains("/proj"));
        assert!(!c.contains("|| true"));
        assert!(!c.contains("node "));
    }
    // What we write is what every reader recognizes as ours.
    assert!(value_has_impeccable_hook_marker(&out));
    // Old-generation input is recognized too (that is how it got rewritten).
    assert!(value_has_impeccable_hook_marker(&claude_bundle_manifest()));
}

#[test]
fn absolute_path_is_single_quoted_and_inert_under_sh() {
    let root = "/tmp/imp-hook-$(touch pwned)-x";
    let out = rewrite_hook_commands_for_platform(&claude_bundle_manifest(), ".claude", root, true, false);
    for c in commands(&out) {
        let expected_path = format!("{root}/.claude/skills/impeccable/scripts/impeccable");
        assert_eq!(c, format!("command=[ ! -f '{expected_path}' ] || '{expected_path}' hook"));
        assert!(!c.contains("${CLAUDE_PROJECT_DIR}"));
        assert!(!c.contains(&format!("\"{root}")));
    }
    // A single quote inside the path gets the '\'' escape.
    assert_eq!(sh_single_quote("/it's/here"), "'/it'\\''s/here'");
    #[cfg(unix)]
    {
        let dir = std::env::temp_dir().join(format!("imp-guard-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        for c in commands(&out) {
            let cmd = c.trim_start_matches("command=");
            let status = std::process::Command::new("/bin/sh").arg("-c").arg(cmd).current_dir(&dir).status().unwrap();
            assert!(status.success());
        }
        assert!(!dir.join("pwned").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[test]
fn windows_form_keeps_double_quoted_absolute_path() {
    let root = "/home/u";
    let out = rewrite_hook_commands_for_platform(&claude_bundle_manifest(), ".claude", root, true, true);
    for c in commands(&out) {
        let p = format!("{root}/.claude/skills/impeccable/scripts/impeccable");
        assert_eq!(c, format!("command=[ ! -f \"{p}\" ] || \"{p}\" hook"));
        assert!(!c.contains(&format!("'{p}")));
    }
}

#[test]
fn codex_gets_command_windows_sibling_pointing_at_cmd_shim() {
    let bundle = json!({
        "hooks": { "PostToolUse": [{ "matcher": "apply_patch", "hooks": [{ "type": "command", "command": "node \".codex/skills/impeccable/scripts/hook.mjs\"", "timeout": 5 }] }] }
    });
    let out = rewrite_hook_commands_for_platform(&bundle, ".agents", "/proj", false, false);
    let entry = &out["hooks"]["PostToolUse"][0]["hooks"][0];
    assert_eq!(
        entry["command"],
        "[ ! -f \".agents/skills/impeccable/scripts/impeccable\" ] || \".agents/skills/impeccable/scripts/impeccable\" hook"
    );
    assert_eq!(
        entry["commandWindows"],
        "if exist \".agents/skills/impeccable/scripts/impeccable.cmd\" (\".agents/skills/impeccable/scripts/impeccable.cmd\" hook & exit /b)"
    );
    // JS key order: existing keys, then the appended commandWindows.
    let keys: Vec<&String> = entry.as_object().unwrap().keys().collect();
    assert_eq!(keys, ["type", "command", "timeout", "commandWindows"]);
    // Windows host: Codex keeps the POSIX command; the sibling handles cmd.exe.
    let win = rewrite_hook_commands_for_platform(&bundle, ".agents", "/proj", false, true);
    assert_eq!(win["hooks"]["PostToolUse"][0]["hooks"][0]["command"], entry["command"]);
    assert!(value_has_impeccable_hook_marker(&out));
}

#[test]
fn cursor_runs_hook_before_edit() {
    let bundle = json!({ "version": 1, "hooks": { "preToolUse": [{ "command": "node \".cursor/skills/impeccable/scripts/hook-before-edit.mjs\"", "timeout": 5 }] } });
    let out = rewrite_hook_commands_for_platform(&bundle, ".cursor", "/proj", false, false);
    assert_eq!(
        out["hooks"]["preToolUse"][0]["command"],
        "[ ! -f \".cursor/skills/impeccable/scripts/impeccable\" ] || \".cursor/skills/impeccable/scripts/impeccable\" hook-before-edit"
    );
    assert!(out["hooks"]["preToolUse"][0].get("commandWindows").is_none());
}

#[test]
fn github_manifests_pass_through_and_grok_is_rewritten() {
    // .github stays untouched: its committed manifest carries a portable
    // `$(git rev-parse ...)` command that must never become machine-local.
    let bundle = json!({ "version": 1, "hooks": { "postToolUse": [{ "type": "command", "bash": "[ ! -f \"$(git rev-parse --show-toplevel)/.github/skills/impeccable/scripts/impeccable\" ] || \"$(git rev-parse --show-toplevel)/.github/skills/impeccable/scripts/impeccable\" hook" }] } });
    assert_eq!(rewrite_hook_commands_for_platform(&bundle, ".github", "/proj", true, false), bundle);
    assert!(value_has_impeccable_hook_marker(&bundle));
    // .grok is rewritten like the other command-hook providers (upstream
    // 49571365, #642): a global install must not leave the bundled
    // project-relative path behind.
    let grok = json!({ "hooks": { "PostToolUse": [{ "matcher": "Edit|Write|MultiEdit", "hooks": [{ "type": "command", "command": "node \".grok/skills/impeccable/scripts/hook.mjs\"" }] }] } });
    let rel = rewrite_hook_commands_for_platform(&grok, ".grok", "/proj", false, false);
    assert_eq!(
        rel["hooks"]["PostToolUse"][0]["hooks"][0]["command"],
        "[ ! -f \".grok/skills/impeccable/scripts/impeccable\" ] || \".grok/skills/impeccable/scripts/impeccable\" hook"
    );
    let abs = rewrite_hook_commands_for_platform(&grok, ".grok", "/home/u", true, false);
    assert_eq!(
        abs["hooks"]["PostToolUse"][0]["hooks"][0]["command"],
        "[ ! -f '/home/u/.grok/skills/impeccable/scripts/impeccable' ] || '/home/u/.grok/skills/impeccable/scripts/impeccable' hook"
    );
    // Grok is not Codex: no commandWindows sibling is added.
    assert!(rel["hooks"]["PostToolUse"][0]["hooks"][0].get("commandWindows").is_none());
}

#[test]
fn merge_refreshes_ours_and_preserves_third_party_hooks() {
    let existing = json!({
        "permissions": { "allow": ["x"] },
        "description": "old",
        "hooks": {
            "PostToolUse": [
                { "matcher": "Bash", "hooks": [{ "type": "command", "command": "echo hi" }] },
                { "matcher": "Edit", "hooks": [{ "type": "command", "command": "[ ! -f \"${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/hook.mjs\" ] || node \"${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/hook.mjs\"" }] }
            ],
            "Stop": [{ "hooks": [{ "type": "command", "command": "\".claude/skills/impeccable/scripts/impeccable\" hook" }] }]
        }
    });
    let fresh = rewrite_hook_commands_for_platform(&claude_bundle_manifest(), ".claude", "/proj", false, false);
    let merged = merge_hook_manifests(&existing, &fresh);
    let keys: Vec<&String> = merged.as_object().unwrap().keys().collect();
    assert_eq!(keys, ["permissions", "description", "hooks"]);
    assert_eq!(merged["description"], "fresh claude hook");
    let post = merged["hooks"]["PostToolUse"].as_array().unwrap();
    assert_eq!(post.len(), 2);
    assert_eq!(post[0]["matcher"], "Bash");
    assert!(post[1]["hooks"][0]["command"].as_str().unwrap().contains("scripts/impeccable\" hook"));
    let stop = merged["hooks"]["Stop"].as_array().unwrap();
    assert_eq!(stop.len(), 1);
    assert!(stop[0]["hooks"][0]["command"].as_str().unwrap().starts_with("[ ! -f "));
}

#[test]
fn prune_removes_only_ours_and_drops_empty_scaffolding() {
    let dir = std::env::temp_dir().join(format!("imp-prune-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("settings.local.json");
    let p = path.to_string_lossy().to_string();
    std::fs::write(&path, serde_json::to_string_pretty(&json!({
        "other": 1,
        "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "\".claude/skills/impeccable/scripts/impeccable\" hook" }] }] }
    })).unwrap()).unwrap();
    assert!(file_has_impeccable_hook_marker(&p));
    assert!(prune_impeccable_hook_from_manifest(&p).unwrap());
    let after: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(after, json!({ "other": 1 }));
    assert!(!prune_impeccable_hook_from_manifest(&p).unwrap());
    // A permissions entry naming the hook path is not a hook.
    std::fs::write(&path, r#"{"permissions":{"allow":["Bash(.claude/skills/impeccable/scripts/impeccable hook)"]}}"#).unwrap();
    assert!(!file_has_impeccable_hook_marker(&p));
    let _ = std::fs::remove_dir_all(&dir);
}

// ─── E8: stale-hook self-heal on upgrade ─────────────────────────────────────

fn write(path: &str, content: &str) {
    let p = std::path::Path::new(path);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, content).unwrap();
}

fn read(path: &str) -> String {
    std::fs::read_to_string(path).unwrap_or_else(|e| panic!("read {path}: {e}"))
}

fn tmp_dir(name: &str) -> std::path::PathBuf {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("imp-{name}-{}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn sys_with_home(home: &str) -> Sys {
    let mut env = HashMap::new();
    env.insert("HOME".to_string(), home.to_string());
    Sys::new(env, home.to_string())
}

#[test]
fn manifest_has_stale_hook_distinguishes_generations() {
    let dir = tmp_dir("stale-detect");
    let stale = dir.join("stale.json");
    std::fs::write(&stale, serde_json::to_string_pretty(&json!({
        "hooks": { "PostToolUse": [{ "matcher": "Edit", "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/hook.mjs\"" }] }] }
    })).unwrap()).unwrap();
    assert!(manifest_has_stale_hook(&stale.to_string_lossy()));

    let launcher = dir.join("launcher.json");
    std::fs::write(&launcher, serde_json::to_string_pretty(&json!({
        "hooks": { "PostToolUse": [{ "matcher": "Edit", "hooks": [{ "type": "command", "command": "\".claude/skills/impeccable/scripts/impeccable\" hook" }] }] }
    })).unwrap()).unwrap();
    assert!(!manifest_has_stale_hook(&launcher.to_string_lossy()));

    // A manifest that already names the launcher alongside a legacy sibling is
    // repaired, not stale.
    let mixed = dir.join("mixed.json");
    std::fs::write(&mixed, serde_json::to_string_pretty(&json!({
        "hooks": {
            "PostToolUse": [{ "hooks": [{ "type": "command", "command": "\".claude/skills/impeccable/scripts/impeccable\" hook" }] }],
            "Stop": [{ "hooks": [{ "type": "command", "command": "node .claude/skills/impeccable/scripts/hook.mjs" }] }]
        }
    })).unwrap()).unwrap();
    assert!(!manifest_has_stale_hook(&mixed.to_string_lossy()));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn repair_rewrites_stale_mjs_manifest_to_launcher_form() {
    let home = tmp_dir("repair-home");
    let home = home.to_string_lossy().to_string();
    let proj = tmp_dir("repair-proj");
    let proj = proj.to_string_lossy().to_string();
    let sys = sys_with_home(&home);

    // A v3-era Claude manifest naming the retired `.mjs` script, plus a
    // non-Impeccable hook that must be preserved untouched.
    let manifest = format!("{proj}/.claude/settings.local.json");
    write(&manifest, &serde_json::to_string_pretty(&json!({
        "other": true,
        "hooks": {
            "PostToolUse": [
                { "matcher": "Bash", "hooks": [{ "type": "command", "command": "echo keep-me" }] },
                { "matcher": "Edit", "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/hook.mjs\"" }] }
            ]
        }
    })).unwrap());

    let repaired = repair_stale_hook_manifests(&sys, &proj, &[".claude"], None).unwrap();
    assert_eq!(repaired, [".claude"]);

    let after: Value = serde_json::from_str(&read(&manifest)).unwrap();
    assert_eq!(after["other"], json!(true));
    let post = after["hooks"]["PostToolUse"].as_array().unwrap();
    assert_eq!(post[0]["hooks"][0]["command"], "echo keep-me");
    let repaired_cmd = post[1]["hooks"][0]["command"].as_str().unwrap();
    assert_eq!(
        repaired_cmd,
        "[ ! -f \"${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/impeccable\" ] || \"${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/impeccable\" hook"
    );
    assert!(!repaired_cmd.contains("hook.mjs"));
    assert!(!repaired_cmd.contains("node "));

    // Idempotent: a second pass sees a launcher-form manifest and changes nothing.
    let before = read(&manifest);
    let repaired2 = repair_stale_hook_manifests(&sys, &proj, &[".claude"], None).unwrap();
    assert!(repaired2.is_empty());
    assert_eq!(read(&manifest), before);

    let _ = std::fs::remove_dir_all(&proj);
    let _ = std::fs::remove_dir_all(&home);
}

#[test]
fn repair_leaves_dirs_without_an_impeccable_marker_alone() {
    let home = tmp_dir("repair2-home");
    let home = home.to_string_lossy().to_string();
    let proj = tmp_dir("repair2-proj");
    let proj = proj.to_string_lossy().to_string();
    let sys = sys_with_home(&home);

    // A manifest with only a foreign hook: repair must never add ours.
    let manifest = format!("{proj}/.claude/settings.local.json");
    write(&manifest, &serde_json::to_string_pretty(&json!({
        "hooks": { "PostToolUse": [{ "hooks": [{ "type": "command", "command": "echo unrelated" }] }] }
    })).unwrap());
    let before = read(&manifest);
    let repaired = repair_stale_hook_manifests(&sys, &proj, &[".claude"], None).unwrap();
    assert!(repaired.is_empty());
    assert_eq!(read(&manifest), before);
    let _ = std::fs::remove_dir_all(&proj);
    let _ = std::fs::remove_dir_all(&home);
}

#[test]
fn hook_artifacts_map_providers_to_manifest_files() {
    let dests = expected_hook_dests("/p", &[".claude", ".agents", ".cursor", ".github", ".grok", ".gemini"]);
    assert_eq!(dests, [
        "/p/.claude/settings.local.json",
        "/p/.codex/hooks.json",
        "/p/.cursor/hooks.json",
        "/p/.github/hooks/impeccable.json",
        "/p/.grok/hooks/impeccable.json",
    ]);
    let a = hook_artifacts_for_provider("/b", "/p", ".claude");
    assert_eq!(a[0].src, "/b/.claude/settings.json");
    assert_eq!(a[0].dest, "/p/.claude/settings.local.json");
    assert_eq!(a[0].shared_dest.as_deref(), Some("/p/.claude/settings.json"));
    let c = hook_artifacts_for_provider("/b", "/p", ".agents");
    assert_eq!(c[0].src, "/b/.codex/hooks.json");
    assert_eq!(c[0].dest, "/p/.codex/hooks.json");
    assert!(c[0].shared_dest.is_none());
}
