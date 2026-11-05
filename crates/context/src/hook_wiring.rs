//! Current hook entries shared by status, context and hooks on.
use serde_json::{Map, Value};
const TIMEOUT_SECONDS: i64 = 5;
const STATUS_MESSAGE: &str = "Checking UI changes";
const STOP_TIMEOUT_SECONDS: i64 = 30;
const STOP_STATUS_MESSAGE: &str = "Design deep pass";
fn obj(pairs: Vec<(&str, Value)>) -> Value {
    let mut m = Map::new();
    for (k, v) in pairs {
        m.insert(k.to_string(), v);
    }
    Value::Object(m)
}

fn command_hook(command: &str, timeout: i64, status: &str) -> Value {
    obj(vec![
        ("type", Value::from("command")),
        ("command", Value::from(command)),
        ("timeout", Value::from(timeout)),
        ("statusMessage", Value::from(status)),
    ])
}

/// A command hook with the `commandWindows` sibling Codex 0.146.0+ selects
/// on Windows (`command_windows.unwrap_or(command)`), pointing at the
/// launcher's `.cmd` shim so the same `.codex/hooks.json` runs on every OS.
fn command_hook_with_windows(command: &str, windows: &str, timeout: i64, status: &str) -> Value {
    obj(vec![
        ("type", Value::from("command")),
        ("command", Value::from(command)),
        ("commandWindows", Value::from(windows)),
        ("timeout", Value::from(timeout)),
        ("statusMessage", Value::from(status)),
    ])
}

/// JS: stopManifestEntry(command)
fn stop_manifest_entry(command: &str) -> Value {
    obj(vec![(
        "hooks",
        Value::Array(vec![command_hook(
            command,
            STOP_TIMEOUT_SECONDS,
            STOP_STATUS_MESSAGE,
        )]),
    )])
}

fn stop_manifest_entry_with_windows(command: &str, windows: &str) -> Value {
    obj(vec![(
        "hooks",
        Value::Array(vec![command_hook_with_windows(
            command,
            windows,
            STOP_TIMEOUT_SECONDS,
            STOP_STATUS_MESSAGE,
        )]),
    )])
}

/// The launcher paths the manifests invoke, per harness. Project-relative
/// (or `${CLAUDE_PROJECT_DIR}` / repo-root anchored) so a committed manifest
/// resolves on every teammate's checkout.
const CLAUDE_HOOK_COMMAND: &str = "\"${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/impeccable\" hook";
const AGENTS_HOOK_COMMAND: &str = "\".agents/skills/impeccable/scripts/impeccable\" hook";
const CURSOR_HOOK_COMMAND: &str = "\".cursor/skills/impeccable/scripts/impeccable\" hook";
const GITHUB_HOOK_COMMAND: &str = "\"$(git rev-parse --show-toplevel)/.github/skills/impeccable/scripts/impeccable\" hook";

pub struct ManifestTarget {
    pub provider: &'static str,
    pub skill_rel: &'static str,
    pub dest_rel: &'static str,
    pub shared_dest_rel: Option<&'static str>,
    pub manifest: fn() -> Value,
    /// The manifest is the user's whole settings file (model, auth, MCP), so
    /// an unreadable one is skipped instead of backed up and replaced.
    pub user_settings: bool,
}

pub fn claude_manifest_for_command(cmd: &str) -> Value {
    obj(vec![
        (
            "description",
            // JS: Claude Code folded multi-edit behavior into Edit; the manifest
            // tracks the current Edit and Write tools (upstream 7d5c60d2).
            Value::from("Impeccable design detector: immediate-tier checks after Edit/Write on UI files, full-rule deep pass on Stop."),
        ),
        (
            "hooks",
            obj(vec![
                (
                    "PostToolUse",
                    Value::Array(vec![obj(vec![
                        ("matcher", Value::from("Edit|Write")),
                        ("hooks", Value::Array(vec![command_hook(cmd, TIMEOUT_SECONDS, STATUS_MESSAGE)])),
                    ])]),
                ),
                ("Stop", Value::Array(vec![stop_manifest_entry(cmd)])),
            ]),
        ),
    ])
}

fn claude_manifest() -> Value {
    claude_manifest_for_command(CLAUDE_HOOK_COMMAND)
}

fn grok_manifest() -> Value {
    let mut manifest = claude_manifest_for_command("\".grok/skills/impeccable/scripts/impeccable\" hook");
    manifest["hooks"]["PostToolUse"][0]["matcher"] = Value::from("Edit|Write|MultiEdit");
    manifest
}

fn agents_manifest() -> Value {
    let cmd = AGENTS_HOOK_COMMAND;
    let win = &crate::hook_markers::windows_launcher_hook_command(".agents/skills/impeccable/scripts/impeccable", "hook");
    obj(vec![(
        "hooks",
        obj(vec![
            (
                "PostToolUse",
                Value::Array(vec![obj(vec![
                    ("matcher", Value::from("Edit|Write|apply_patch")),
                    (
                        "hooks",
                        Value::Array(vec![command_hook_with_windows(cmd, win, TIMEOUT_SECONDS, STATUS_MESSAGE)]),
                    ),
                ])]),
            ),
            ("Stop", Value::Array(vec![stop_manifest_entry_with_windows(cmd, win)])),
        ]),
    )])
}

/// Cursor runs the post-edit design hook like the other harnesses (the
/// before-edit gate is retired). `merge_hook_manifests` strips Impeccable
/// entries from every event, so `on` also drops a leftover `preToolUse`
/// gate entry while writing this one.
fn cursor_manifest() -> Value {
    crate::hook_markers::cursor_hook_manifest(CURSOR_HOOK_COMMAND, TIMEOUT_SECONDS)
}

fn github_manifest() -> Value {
    obj(vec![
        ("version", Value::from(1)),
        (
            "hooks",
            obj(vec![(
                "postToolUse",
                Value::Array(vec![obj(vec![
                    ("type", Value::from("command")),
                    ("matcher", Value::from("edit|create|apply_patch")),
                    (
                        "bash",
                        Value::from(GITHUB_HOOK_COMMAND),
                    ),
                    ("timeoutSec", Value::from(TIMEOUT_SECONDS)),
                ])]),
            )]),
        ),
    ])
}

/// Gemini runs hooks through `bash -c` (PowerShell on Windows) after
/// substituting `$GEMINI_PROJECT_DIR` with a shell-escaped path, so the POSIX
/// token stays bare; PowerShell reads the env var. Timeouts are milliseconds.
/// No per-edit detector: BeforeTool carries the session id into
/// `build-phase` shell calls, AfterAgent runs the build-completion check.
const GEMINI_HOOK_COMMAND: &str = "$GEMINI_PROJECT_DIR/.gemini/skills/impeccable/scripts/impeccable hook";
const GEMINI_HOOK_COMMAND_WINDOWS: &str = "& \"$env:GEMINI_PROJECT_DIR/.gemini/skills/impeccable/scripts/impeccable.cmd\" hook";

fn gemini_manifest() -> Value {
    let cmd = if cfg!(windows) { GEMINI_HOOK_COMMAND_WINDOWS } else { GEMINI_HOOK_COMMAND };
    let hook = |name: &str, timeout: i64| obj(vec![
        ("name", Value::from(name)),
        ("type", Value::from("command")),
        ("command", Value::from(cmd)),
        ("timeout", Value::from(timeout)),
    ]);
    obj(vec![(
        "hooks",
        obj(vec![
            ("BeforeTool", Value::Array(vec![obj(vec![
                ("matcher", Value::from("^run_shell_command$")),
                ("hooks", Value::Array(vec![hook("impeccable-session", 5000)])),
            ])])),
            ("AfterAgent", Value::Array(vec![obj(vec![
                ("hooks", Value::Array(vec![hook("impeccable-completion", 30000)])),
            ])])),
        ]),
    )])
}

pub const HOOK_MANIFEST_TARGETS: &[ManifestTarget] = &[
    ManifestTarget {
        provider: ".claude",
        skill_rel: ".claude/skills/impeccable",
        dest_rel: ".claude/settings.local.json",
        shared_dest_rel: Some(".claude/settings.json"),
        manifest: claude_manifest,
        user_settings: false,
    },
    ManifestTarget {
        provider: ".agents",
        skill_rel: ".agents/skills/impeccable",
        dest_rel: ".codex/hooks.json",
        shared_dest_rel: None,
        manifest: agents_manifest,
        user_settings: false,
    },
    ManifestTarget {
        provider: ".cursor",
        skill_rel: ".cursor/skills/impeccable",
        dest_rel: ".cursor/hooks.json",
        shared_dest_rel: None,
        manifest: cursor_manifest,
        user_settings: false,
    },
    ManifestTarget {
        provider: ".github",
        skill_rel: ".github/skills/impeccable",
        dest_rel: ".github/hooks/impeccable.json",
        shared_dest_rel: None,
        manifest: github_manifest,
        user_settings: false,
    },
    ManifestTarget {
        provider: ".grok",
        skill_rel: ".grok/skills/impeccable",
        dest_rel: ".grok/hooks/impeccable.json",
        shared_dest_rel: None,
        manifest: grok_manifest,
        user_settings: false,
    },
    ManifestTarget {
        provider: ".gemini",
        skill_rel: ".gemini/skills/impeccable",
        dest_rel: ".gemini/settings.json",
        shared_dest_rel: None,
        manifest: gemini_manifest,
        user_settings: true,
    },
];


/// Require every current event/entry, while allowing unrelated settings and hooks.
/// Launcher roots and existence guards vary between project/user installations.
pub fn manifest_is_wired(path: &str, expected: &Value) -> bool {
    std::fs::read_to_string(path).ok()
        .and_then(|s| crate::hook_markers::parse_manifest_jsonc(&s))
        .is_some_and(|(actual, _)| contains_entries(&actual, expected))
}

fn contains_entries(actual: &Value, expected: &Value) -> bool {
    match expected {
        Value::Object(fields) => fields.iter().filter(|(k, _)| !matches!(k.as_str(),
            "description" | "timeout" | "timeoutSec" | "statusMessage")).all(|(k, v)| {
            actual.get(k).is_some_and(|a| {
                if matches!(k.as_str(), "command" | "commandWindows" | "bash") {
                    let verb = |s: &str| {
                        ["hook-stop", "hook-before-edit", "hook-after-edit", "hook-probe", "hook"]
                            .into_iter().find(|verb| s.contains(&format!(" {verb}"))
                                && ( *verb != "hook" || !s.contains(" hook-")))
                    };
                    a.as_str().zip(v.as_str()).is_some_and(|(a, v)|
                        crate::hook_markers::is_launcher_hook_command(a) && verb(a) == verb(v))
                } else if k == "matcher" {
                    a == v || a.as_str().zip(v.as_str()).is_some_and(|(a, v)|
                        v.split('|').all(|tool| a.split('|').any(|candidate| candidate == tool)))
                } else {
                    contains_entries(a, v)
                }
            })
        }),
        Value::Array(entries) => actual.as_array().is_some_and(|a|
            entries.iter().all(|e| a.iter().any(|v| contains_entries(v, e)))),
        _ => actual == expected,
    }
}
