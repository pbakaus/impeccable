//! Hook manifests written by install / update: which bundle manifest goes
//! where per provider, how the bundled command is rewritten for the actual
//! install target, and the merge / prune / marker helpers. JS: skills.mjs
//! `PROVIDER_HOOK_ARTIFACTS` .. `copyProviderHooks`.
//!
//! Where the JS wrote `[ ! -f "<skill>/scripts/hook.mjs" ] || node
//! "<skill>/scripts/hook.mjs"` (and a `node -e` guard on Windows), the binary
//! writes the launcher form `[ ! -f "<skill>/scripts/impeccable" ] ||
//! "<skill>/scripts/impeccable" hook` (Cursor included, on `postToolUse`), the
//! shape the public build's `transformers/hooks.js` puts in the bundle; the
//! Codex `commandWindows` sibling and a Windows Grok `command` run
//! `impeccable.cmd` behind `cmd /c if exist`.
//! `impeccable hooks on` (`impeccable_hook::admin`) writes the same launcher
//! invocation for a project install (no existence guard on the POSIX `command`). Recognition of an
//! Impeccable-owned entry (either the JS `.mjs` generation or the launcher
//! generation) is shared with the hook crate, `context`, and `doctor` through
//! `impeccable_context::hook_markers::is_impeccable_hook_command`, so the two
//! writers and the three readers can never disagree on what counts as ours.

use impeccable_context::hermes;
use impeccable_context::hook_markers::{cursor_hook_manifest, cursor_manifest_has_retired_gate, is_impeccable_hook_command, is_launcher_hook_command, parse_manifest_jsonc, windows_launcher_hook_command};
use serde_json::{Map, Value};

use crate::providers::Sys;
use crate::util::{self, jsp};

pub struct HookArtifactSpec {
    pub source_provider: &'static str,
    pub rel: &'static str,
    pub dest_provider: &'static str,
    pub dest_rel: Option<&'static str>,
}

/// JS: PROVIDER_HOOK_ARTIFACTS[provider]
pub fn provider_hook_artifacts(provider: &str) -> &'static [HookArtifactSpec] {
    match provider {
        ".claude" => &[HookArtifactSpec { source_provider: ".claude", rel: "settings.json", dest_provider: ".claude", dest_rel: Some("settings.local.json") }],
        ".gemini" => &[HookArtifactSpec { source_provider: ".gemini", rel: "settings.json", dest_provider: ".gemini", dest_rel: None }],
        ".cursor" => &[HookArtifactSpec { source_provider: ".cursor", rel: "hooks.json", dest_provider: ".cursor", dest_rel: None }],
        ".agents" => &[HookArtifactSpec { source_provider: ".codex", rel: "hooks.json", dest_provider: ".codex", dest_rel: None }],
        ".github" => &[HookArtifactSpec { source_provider: ".github", rel: "hooks/impeccable.json", dest_provider: ".github", dest_rel: None }],
        ".grok" => &[HookArtifactSpec { source_provider: ".grok", rel: "hooks/impeccable.json", dest_provider: ".grok", dest_rel: None }],
        _ => &[],
    }
}

pub struct HookArtifact {
    pub src: String,
    pub dest: String,
    pub shared_dest: Option<String>,
}

/// JS: hookArtifactsForProvider(bundleDir, root, provider)
pub fn hook_artifacts_for_provider(bundle_dir: &str, root: &str, provider: &str) -> Vec<HookArtifact> {
    provider_hook_artifacts(provider)
        .iter()
        .map(|spec| {
            let write_rel = spec.dest_rel.unwrap_or(spec.rel);
            HookArtifact {
                src: jsp::join(&[bundle_dir, spec.source_provider, spec.rel]),
                dest: jsp::join(&[root, spec.dest_provider, write_rel]),
                shared_dest: if write_rel != spec.rel {
                    Some(jsp::join(&[root, spec.dest_provider, spec.rel]))
                } else {
                    None
                },
            }
        })
        .collect()
}

fn hook_artifacts_for_install(bundle_dir: &str, root: &str, provider: &str, user_scope: bool) -> Vec<HookArtifact> {
    if provider == ".claude" && user_scope {
        return vec![HookArtifact {
            src: jsp::join(&[bundle_dir, ".claude", "settings.json"]),
            dest: jsp::join(&[root, ".claude", "settings.json"]),
            shared_dest: None,
        }];
    }
    hook_artifacts_for_provider(bundle_dir, root, provider)
}

/// JS: expectedHookDests(root, providers)
pub fn expected_hook_dests(root: &str, providers: &[&str]) -> Vec<String> {
    providers
        .iter()
        .flat_map(|p| {
            provider_hook_artifacts(p)
                .iter()
                .map(|spec| jsp::join(&[root, spec.dest_provider, spec.dest_rel.unwrap_or(spec.rel)]))
        })
        .collect()
}

/// The hook verb the launcher runs for a provider. Every harness runs the
/// post-edit `hook` verb; Cursor used to run `hook-before-edit` on
/// `preToolUse`, and `migrate_cursor_gate` moves those manifests over.
pub fn hook_verb(_provider: &str) -> &'static str {
    "hook"
}

/// Moves a Cursor manifest off the retired `preToolUse` before-edit gate:
/// drops Impeccable entries from every event (other tools' hooks stay) and
/// adds the post-edit `postToolUse` entry, its command rewritten for the
/// install. A manifest without the gate is returned unchanged, so this is
/// safe to run after any write.
pub fn migrate_cursor_gate(value: &Value, skill_root: &str, absolute: bool) -> Value {
    if !cursor_manifest_has_retired_gate(value) {
        return value.clone();
    }
    // Any launcher-form command carries the marker the rewrite replaces.
    let template = cursor_hook_manifest("\".cursor/skills/impeccable/scripts/impeccable\" hook", CURSOR_TIMEOUT_SECONDS);
    let fresh = rewrite_hook_commands_for_skill_root(&template, ".cursor", skill_root, absolute);
    merge_hook_manifests(value, &fresh)
}

/// Cursor's per-edit hook timeout, in seconds (the bundle's TIMEOUT_SECONDS).
const CURSOR_TIMEOUT_SECONDS: i64 = 5;

/// JS: hookScriptRelPathForProvider(provider), for the launcher: the
/// project-relative launcher path (Claude keeps its `${CLAUDE_PROJECT_DIR}`
/// token).
pub fn launcher_rel_path(provider: &str) -> String {
    let rel = format!("{provider}/skills/impeccable/scripts/impeccable");
    if provider == ".claude" {
        format!("${{CLAUDE_PROJECT_DIR}}/{rel}")
    } else if provider == ".gemini" {
        format!("$GEMINI_PROJECT_DIR/{rel}")
    } else {
        rel
    }
}

/// JS: hookScriptPathForProvider(skillRoot, provider), for the launcher.
/// `.github` stays `None`: its committed, team-shared manifest carries a
/// portable command form (`$(git rev-parse --show-toplevel)/...`) that must
/// not be rewritten to a machine-local path. `.grok` is rewritten like the
/// others (upstream 49571365, #642): its bundled manifest is
/// project-relative, so a global install must point it at the global skill
/// path or the hook command targets a file that does not exist.
pub fn launcher_path(skill_root: &str, provider: &str) -> Option<String> {
    match provider {
        ".cursor" | ".claude" | ".agents" | ".grok" | ".gemini" => {
            Some(jsp::join(&[skill_root, provider, "skills", "impeccable", "scripts", "impeccable"]))
        }
        _ => None,
    }
}

/// JS: shSingleQuote(value)
pub fn sh_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

/// `JSON.stringify(string)`
pub fn json_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_default()
}

/// One pre-quoted launcher path per target shell (JS: `quotedPath`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QuotedPath {
    pub posix: String,
    /// Double-quoted (cmd.exe treats `'` as literal, issue #533).
    pub win32: String,
    /// Unquoted, for the forms that do their own quoting.
    pub raw: String,
}

/// JS: the `quotedPath` computed in rewriteHookCommandsForSkillRoot: the
/// absolute install path gets real single-quote escaping (issue #476); the
/// relative form is a per-provider constant and stays double-quoted so
/// Claude's `${CLAUDE_PROJECT_DIR}` keeps expanding at hook time.
pub fn quoted_launcher_path(skill_root: &str, provider: &str, absolute: bool) -> Option<QuotedPath> {
    let abs = launcher_path(skill_root, provider)?;
    let path = if absolute { abs } else { launcher_rel_path(provider) };
    Some(QuotedPath {
        posix: if absolute { sh_single_quote(&path) } else { json_string(&path) },
        win32: json_string(&path),
        raw: path,
    })
}

/// GitHub Copilot hook manifests are project files even for a user-scoped
/// skill install. Keep their normal project command untouched, but point a
/// global install at the user's actual install root. On Windows, Git Bash's
/// `$HOME` may differ from the `USERPROFILE` directory used by `os.homedir()`,
/// so write that resolved root with Bash-compatible forward slashes.
fn quoted_github_user_launcher(skill_root: &str, win32: bool) -> QuotedPath {
    let path = if win32 {
        jsp::win32::join(&[skill_root, ".github", "skills", "impeccable", "scripts", "impeccable"])
            .replace('\\', "/")
    } else {
        "$HOME/.github/skills/impeccable/scripts/impeccable".to_string()
    };
    QuotedPath {
        posix: if win32 { sh_single_quote(&path) } else { json_string(&path) },
        win32: json_string(&path),
        raw: path,
    }
}

/// JS: guardHookCommand(quotedPath, provider), launcher edition, in the
/// shape the public build's `transformers/hooks.js` `guardedLauncher` emits:
/// `[ ! -f X ] || X <verb>` (not `|| true`, so the launcher's exit code, and
/// Claude's exit-2 blocking signal, still reach the agent). `.agents` (Codex)
/// keeps the POSIX form unconditionally: its Windows consumers read the
/// `commandWindows` sibling instead. Other providers installed on Windows keep
/// the double-quoted path (cmd.exe treats `'` as literal, issue #533); the JS
/// `node -e` existence wrapper has no launcher equivalent, so the POSIX guard
/// stands there too (Claude Code on Windows runs hooks through Git Bash).
/// Grok is another exception: it has no per-OS field and runs `command` in the
/// session shell (PowerShell by default on Windows), so a Windows Grok install
/// takes the `windows_hook_command` form.
pub fn hook_command(quoted: &QuotedPath, provider: &str, win32: bool) -> String {
    let verb = hook_verb(provider);
    let q = match (provider, win32) {
        (".gemini", _) => return gemini_hook_command(quoted, verb, win32),
        (".grok", true) => return windows_hook_command(quoted, provider),
        (".agents", _) | (".github", _) | (_, false) => &quoted.posix,
        (_, true) => &quoted.win32,
    };
    format!("[ ! -f {q} ] || {q} {verb}")
}

/// Gemini CLI runs a hook through `bash -c` on POSIX and PowerShell on
/// Windows, and has no per-OS command field, so a Windows install writes a
/// PowerShell guard around the `.cmd` shim. Gemini also substitutes
/// `$GEMINI_PROJECT_DIR` in the command text with an already shell-escaped
/// path before the shell sees it, so the POSIX relative form leaves the token
/// bare (double quotes would keep the escaping as literal characters), and
/// the PowerShell form reads `$env:GEMINI_PROJECT_DIR`, which that
/// substitution does not touch.
fn gemini_hook_command(quoted: &QuotedPath, verb: &str, win32: bool) -> String {
    let path = quoted.raw.clone();
    let relative = path.starts_with("$GEMINI_PROJECT_DIR");
    if !win32 {
        let q = if relative { path } else { quoted.posix.clone() };
        return format!("[ ! -f {q} ] || {q} {verb}");
    }
    let cmd = format!("{path}.cmd");
    let q = if relative {
        format!("\"{}\"", cmd.replacen("$GEMINI_PROJECT_DIR", "$env:GEMINI_PROJECT_DIR", 1))
    } else {
        format!("'{}'", cmd.replace('\'', "''"))
    };
    format!("if (Test-Path -LiteralPath {q}) {{ & {q} {verb} }}")
}

/// JS: windowsHookCommand(quotedPath), launcher edition (`transformers/hooks.js`
/// `windowsLauncherCommand`): `windows_launcher_hook_command` over this
/// install's launcher path.
pub fn windows_hook_command(quoted: &QuotedPath, provider: &str) -> String {
    windows_launcher_hook_command(&quoted.raw, hook_verb(provider))
}

/// JS: rewriteHookCommandsForSkillRoot(value, provider, {skillRoot, absolute})
pub fn rewrite_hook_commands_for_skill_root(value: &Value, provider: &str, skill_root: &str, absolute: bool) -> Value {
    let quoted = if provider == ".github" && absolute {
        Some(quoted_github_user_launcher(skill_root, cfg!(windows)))
    } else {
        quoted_launcher_path(skill_root, provider, absolute)
    };
    let Some(quoted) = quoted else {
        return value.clone();
    };
    rewrite_value(value, provider, &quoted, cfg!(windows))
}

/// `rewrite_hook_commands_for_skill_root` with the platform made explicit
/// (tests drive the Windows form from any host).
pub fn rewrite_hook_commands_for_platform(value: &Value, provider: &str, skill_root: &str, absolute: bool, win32: bool) -> Value {
    let quoted = if provider == ".github" && absolute {
        Some(quoted_github_user_launcher(skill_root, win32))
    } else {
        quoted_launcher_path(skill_root, provider, absolute)
    };
    let Some(quoted) = quoted else {
        return value.clone();
    };
    rewrite_value(value, provider, &quoted, win32)
}

fn rewrite_value(value: &Value, provider: &str, quoted: &QuotedPath, win32: bool) -> Value {
    match value {
        Value::String(_) => {
            // JS: the string arm goes through valueHasImpeccableHookMarker,
            // so the separator normalization applies here too.
            if !value_has_impeccable_hook_marker(value) {
                return value.clone();
            }
            Value::String(hook_command(quoted, provider, win32))
        }
        Value::Array(items) => Value::Array(items.iter().map(|v| rewrite_value(v, provider, quoted, win32)).collect()),
        Value::Object(map) => {
            let mut next = Map::new();
            for (k, v) in map {
                next.insert(k.clone(), rewrite_value(v, provider, quoted, win32));
            }
            if provider == ".agents" {
                if let Some(cmd @ Value::String(_)) = map.get("command") {
                    if value_has_impeccable_hook_marker(cmd) {
                        next.insert("commandWindows".to_string(), Value::String(windows_hook_command(quoted, provider)));
                    }
                }
            }
            Value::Object(next)
        }
        _ => value.clone(),
    }
}

/// JS: valueHasImpeccableHookMarker(value).
pub fn value_has_impeccable_hook_marker(value: &Value) -> bool {
    match value {
        Value::String(s) => is_impeccable_hook_command(s),
        Value::Array(a) => a.iter().any(value_has_impeccable_hook_marker),
        Value::Object(o) => o.values().any(value_has_impeccable_hook_marker),
        _ => false,
    }
}

/// True when `value` names an Impeccable hook in the launcher generation.
pub fn value_has_launcher_hook_marker(value: &Value) -> bool {
    match value {
        Value::String(s) => is_launcher_hook_command(s),
        Value::Array(a) => a.iter().any(value_has_launcher_hook_marker),
        Value::Object(o) => o.values().any(value_has_launcher_hook_marker),
        _ => false,
    }
}

/// True when a manifest's `hooks` subtree carries an Impeccable hook only in
/// the JS-era `.mjs` spelling (no launcher marker): a pre-launcher install
/// whose hook script no longer exists after the skill update, so the hook is
/// dead and the manifest must be rewritten to the launcher form.
pub fn manifest_has_stale_hook(file: &str) -> bool {
    if !util::exists(file) {
        return false;
    }
    let Ok(text) = util::read_text(file) else { return false };
    let Ok(Value::Object(map)) = serde_json::from_str::<Value>(&text) else { return false };
    match map.get("hooks") {
        Some(h @ (Value::Object(_) | Value::Array(_))) => value_has_impeccable_hook_marker(h) && !value_has_launcher_hook_marker(h),
        _ => false,
    }
}

/// True when a Cursor manifest on disk still runs the retired `preToolUse`
/// before-edit gate (either generation's spelling).
pub fn manifest_has_retired_cursor_gate(file: &str) -> bool {
    if !util::exists(file) {
        return false;
    }
    let Ok(text) = util::read_text(file) else { return false };
    let Ok(parsed) = serde_json::from_str::<Value>(&text) else { return false };
    cursor_manifest_has_retired_gate(&parsed)
}

/// JS: fileHasImpeccableHookMarker(file): parse and scan only the `hooks`
/// subtree.
pub fn file_has_impeccable_hook_marker(file: &str) -> bool {
    let Some((Value::Object(map), _)) = read_manifest(file) else { return false };
    match map.get("hooks") {
        Some(h @ (Value::Object(_) | Value::Array(_))) => value_has_impeccable_hook_marker(h),
        _ => false,
    }
}

/// A manifest on disk, parsed with comments tolerated (Gemini's
/// `settings.json` allows them). The flag says comments were dropped, so a
/// rewrite must keep a `.bak` of the original.
fn read_manifest(file: &str) -> Option<(Value, bool)> {
    if !util::exists(file) {
        return None;
    }
    parse_manifest_jsonc(&util::read_text(file).ok()?)
}

/// Before rewriting a manifest whose comments the JSON writer cannot keep,
/// save the original beside it.
fn backup_commented(path: &str, had_comments: bool) -> Result<(), String> {
    if had_comments {
        util::write_bytes(&format!("{path}.bak"), &util::read_bytes(path)?)?;
    }
    Ok(())
}

/// A provider whose hook manifest is the user's whole settings file (model,
/// auth, MCP servers), so an unreadable one is never replaced wholesale.
fn manifest_is_user_settings(provider: &str, user_scope: bool) -> bool {
    provider == ".gemini" || (provider == ".claude" && user_scope)
}

/// JS: hookInstalledForProvider(root, provider). `.hermes`' hook is the
/// plugin under Hermes' home, not a manifest under `root`.
pub fn hook_installed_for_provider(sys: &Sys, root: &str, provider: &str) -> bool {
    if provider == ".hermes" {
        return hermes_plugin_installed(sys);
    }
    let artifacts = provider_hook_artifacts(provider);
    if artifacts.is_empty() {
        return true;
    }
    artifacts.iter().all(|spec| {
        let write_rel = spec.dest_rel.unwrap_or(spec.rel);
        if file_has_impeccable_hook_marker(&jsp::join(&[root, spec.dest_provider, write_rel])) {
            return true;
        }
        write_rel != spec.rel && file_has_impeccable_hook_marker(&jsp::join(&[root, spec.dest_provider, spec.rel]))
    })
}

/// User-scoped Claude hooks are loaded only from `settings.json`; the
/// project-only `settings.local.json` path must not satisfy a global install.
/// For that file, "installed" means current (`user_claude_hook_is_current`),
/// not merely marked: a legacy `hook.mjs` entry or one naming a launcher that
/// no longer exists must be rewritten, not counted.
///
/// A user-scope Copilot install counts the project manifest only when it does
/// not name the project's skill, or that skill is there: an older global
/// install wrote the portable `$(git rev-parse ...)/.github/skills/...` form
/// into a project with no Copilot skill of its own, a hook that never fires
/// (#1098), so a repeat install must rewrite it rather than count it.
pub fn hook_installed_for_provider_at_scope(sys: &Sys, root: &str, provider: &str, user_scope: bool) -> bool {
    if user_scope && provider == ".claude" {
        return user_claude_hook_is_current(root);
    }
    if user_scope && provider == ".github" && github_manifest_names_missing_project_skill(root) {
        return false;
    }
    hook_installed_for_provider(sys, root, provider)
}

/// The portable prefix of a project Copilot hook command.
const GITHUB_PORTABLE_PREFIX: &str = "$(git rev-parse --show-toplevel)/.github/skills/impeccable/scripts/impeccable";

/// True when the project carries its own Copilot skill launcher.
fn github_project_skill_exists(project_root: &str) -> bool {
    util::exists(&jsp::join(&[project_root, ".github", "skills", "impeccable", "scripts", "impeccable"]))
}

/// True when `root` is a project (not the home dir) that ships its own
/// Copilot skill: its committed manifest keeps the portable command.
fn github_keeps_portable_form(sys: &Sys, root: &str) -> bool {
    !sys.is_home_dir(root) && github_project_skill_exists(root)
}

/// True when `<root>/.github/hooks/impeccable.json` runs an Impeccable hook in
/// the portable project form while `<root>` has no Copilot skill to run.
fn github_manifest_names_missing_project_skill(root: &str) -> bool {
    if github_project_skill_exists(root) {
        return false;
    }
    let Some((Value::Object(map), _)) = read_manifest(&jsp::join(&[root, ".github", "hooks", "impeccable.json"])) else {
        return false;
    };
    let Some(hooks @ (Value::Object(_) | Value::Array(_))) = map.get("hooks") else { return false };
    let mut commands = Vec::new();
    collect_impeccable_hook_commands(hooks, &mut commands);
    commands.iter().any(|c| c.contains(GITHUB_PORTABLE_PREFIX))
}

/// The command a user-scope install writes into `<home>/.claude/settings.json`:
/// the guarded absolute launcher under `<home>/.claude/skills/impeccable`.
pub fn user_claude_hook_command(home_root: &str, win32: bool) -> Option<String> {
    let quoted = quoted_launcher_path(home_root, ".claude", true)?;
    Some(hook_command(&quoted, ".claude", win32))
}

fn collect_impeccable_hook_commands<'a>(value: &'a Value, out: &mut Vec<&'a str>) {
    match value {
        Value::String(s) if is_impeccable_hook_command(s) => out.push(s),
        Value::Array(a) => a.iter().for_each(|v| collect_impeccable_hook_commands(v, out)),
        Value::Object(o) => o.values().for_each(|v| collect_impeccable_hook_commands(v, out)),
        _ => {}
    }
}

/// True only when `<home>/.claude/settings.json` parses, its launcher exists,
/// and every Impeccable hook command in it is exactly the form this engine
/// writes for a user-scope install. An Impeccable marker alone is not enough:
/// a legacy `node .../hook.mjs` entry, or one naming a launcher that is gone,
/// is a dead hook, and counting it would skip the rewrite and let the
/// duplicate-hook cleanup delete the project hook that still works.
pub fn user_claude_hook_is_current(home_root: &str) -> bool {
    user_claude_hook_is_current_for(home_root, cfg!(windows))
}

/// `user_claude_hook_is_current` with the platform made explicit.
pub fn user_claude_hook_is_current_for(home_root: &str, win32: bool) -> bool {
    let Some(expected) = user_claude_hook_command(home_root, win32) else { return false };
    let Some(launcher) = launcher_path(home_root, ".claude") else { return false };
    if !util::exists(&launcher) {
        return false;
    }
    let Some((Value::Object(map), _)) = read_manifest(&jsp::join(&[home_root, ".claude", "settings.json"])) else {
        return false;
    };
    let Some(hooks @ (Value::Object(_) | Value::Array(_))) = map.get("hooks") else { return false };
    let mut commands = Vec::new();
    collect_impeccable_hook_commands(hooks, &mut commands);
    !commands.is_empty() && commands.iter().all(|c| *c == expected)
}

fn marker_in(entry: &Map<String, Value>, key: &str) -> bool {
    entry.get(key).map(value_has_impeccable_hook_marker).unwrap_or(false)
}

/// JS: stripImpeccableHookEntry(entry)
fn strip_impeccable_hook_entry(entry: &Value) -> Option<Value> {
    let Value::Object(e) = entry else {
        return Some(entry.clone());
    };
    if marker_in(e, "command")
        || marker_in(e, "commandWindows")
        || marker_in(e, "args")
        || marker_in(e, "bash")
        || marker_in(e, "powershell")
    {
        return None;
    }
    let Some(Value::Array(hooks)) = e.get("hooks") else {
        return Some(entry.clone());
    };
    let stripped: Vec<Value> = hooks.iter().filter_map(strip_impeccable_hook_entry).collect();
    if stripped.is_empty() && hooks.iter().any(value_has_impeccable_hook_marker) {
        return None;
    }
    let mut next = e.clone();
    next.insert("hooks".to_string(), Value::Array(stripped));
    Some(Value::Object(next))
}

/// JS: stripImpeccableHookEntries(entries)
pub fn strip_impeccable_hook_entries(entries: Option<&Value>) -> Vec<Value> {
    match entries {
        Some(Value::Array(a)) => a.iter().filter_map(strip_impeccable_hook_entry).collect(),
        _ => Vec::new(),
    }
}

/// JS: pruneImpeccableHookFromManifest(manifestPath). Returns true if it
/// changed anything.
pub fn prune_impeccable_hook_from_manifest(manifest_path: &str) -> Result<bool, String> {
    if !file_has_impeccable_hook_marker(manifest_path) {
        return Ok(false);
    }
    let Some((Value::Object(parsed), had_comments)) = read_manifest(manifest_path) else { return Ok(false) };
    let existing_hooks: Map<String, Value> = match parsed.get("hooks") {
        Some(Value::Object(h)) => h.clone(),
        _ => Map::new(),
    };
    let mut cleaned = Map::new();
    for (event, entries) in &existing_hooks {
        let kept = strip_impeccable_hook_entries(Some(entries));
        if !kept.is_empty() {
            cleaned.insert(event.clone(), Value::Array(kept));
        }
    }
    let mut next = parsed.clone();
    if !cleaned.is_empty() {
        next.insert("hooks".to_string(), Value::Object(cleaned));
    } else {
        next.shift_remove("hooks");
        next.shift_remove("description");
        next.shift_remove("version");
    }
    backup_commented(manifest_path, had_comments)?;
    if next.is_empty() {
        util::rm_rf(manifest_path);
    } else {
        util::write_bytes(manifest_path, format!("{}\n", util::json_pretty(&Value::Object(next))).as_bytes())?;
    }
    Ok(true)
}

fn as_object(v: Option<&Value>) -> Map<String, Value> {
    match v {
        Some(Value::Object(o)) => o.clone(),
        _ => Map::new(),
    }
}

/// JS: mergeHookManifests(existing, fresh)
pub fn merge_hook_manifests(existing: &Value, fresh: &Value) -> Value {
    let existing_object = as_object(Some(existing));
    let fresh_object = as_object(Some(fresh));
    let existing_hooks = as_object(existing_object.get("hooks"));
    let fresh_hooks = as_object(fresh_object.get("hooks"));

    let mut merged = existing_object.clone();
    merged.insert("hooks".to_string(), Value::Object(Map::new()));
    if let Some(v) = fresh_object.get("version") {
        merged.insert("version".to_string(), v.clone());
    }
    if let Some(d) = fresh_object.get("description") {
        merged.insert("description".to_string(), d.clone());
    }

    let mut events: Vec<String> = existing_hooks.keys().cloned().collect();
    for k in fresh_hooks.keys() {
        if !events.contains(k) {
            events.push(k.clone());
        }
    }
    let mut hooks = Map::new();
    for event in events {
        let mut entries = strip_impeccable_hook_entries(existing_hooks.get(&event));
        if let Some(Value::Array(added)) = fresh_hooks.get(&event) {
            entries.extend(added.iter().cloned());
        }
        if !entries.is_empty() {
            hooks.insert(event, Value::Array(entries));
        }
    }
    merged.insert("hooks".to_string(), Value::Object(hooks));
    Value::Object(merged)
}

/// JS: readJsonFile(filePath, description)
fn read_json_file(path: &str, description: &str) -> Result<Value, String> {
    let text = util::read_text(path).map_err(|e| format!("{description} is not valid JSON: {path}. {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("{description} is not valid JSON: {path}. {}", json_parse_message(&e)))
}

/// Node's `JSON.parse` message shape is not reproducible; report serde's.
fn json_parse_message(e: &serde_json::Error) -> String {
    e.to_string()
}

/// JS: copyProviderHooks(bundleDir, root, providers, {force, skillRoot}).
/// Returns the manifest paths written (deduplicated, in write order).
pub fn copy_provider_hooks(sys: &crate::providers::Sys, bundle_dir: &str, root: &str, providers: &[&'static str], force: bool, skill_root: Option<&str>, project_root: Option<&str>) -> Result<Vec<String>, String> {
    let skill_root = skill_root.unwrap_or(root);
    let user_scope = sys.is_home_dir(skill_root);
    let mut written: Vec<String> = Vec::new();
    for provider in providers {
        if *provider == ".hermes" {
            let dest = hermes_plugin_dir(sys);
            if copy_hermes_plugin(sys, bundle_dir)? && !written.contains(&dest) {
                written.push(dest);
            }
            continue;
        }
        let manifest_root = if user_scope && *provider == ".claude" { skill_root } else { root };
        for artifact in hook_artifacts_for_install(bundle_dir, manifest_root, provider, user_scope) {
            if !util::exists(&artifact.src) {
                continue;
            }
            if let Some(shared) = &artifact.shared_dest {
                if file_has_impeccable_hook_marker(shared) {
                    prune_impeccable_hook_from_manifest(&artifact.dest)?;
                    continue;
                }
            }
            let fresh_manifest = read_json_file(&artifact.src, "Bundled hook manifest")?;
            // A project that ships its own Copilot skill keeps the portable,
            // team-committed command even when the user installs globally.
            let absolute = (skill_root != root || sys.is_home_dir(root))
                && !(*provider == ".github" && github_keeps_portable_form(sys, root));
            let fresh = rewrite_hook_commands_for_skill_root(&fresh_manifest, provider, skill_root, absolute);
            let mut next = fresh.clone();
            if util::exists(&artifact.dest) {
                match read_manifest(&artifact.dest) {
                    Some((existing, had_comments)) => {
                        backup_commented(&artifact.dest, had_comments)?;
                        next = merge_hook_manifests(&existing, &fresh);
                    }
                    None if manifest_is_user_settings(provider, user_scope) => {
                        return Err(format!("Existing settings file is not valid JSON: {}. It holds your other settings too, so it is never replaced; fix it and re-run.", artifact.dest));
                    }
                    None => {
                        if !force {
                            return Err(format!("Existing hook manifest is not valid JSON: {}. Re-run with --force to replace it.", artifact.dest));
                        }
                        util::write_bytes(&format!("{}.bak", artifact.dest), &util::read_bytes(&artifact.dest)?)?;
                        next = fresh;
                    }
                }
            }
            if *provider == ".cursor" {
                // An older bundle can still carry the retired `preToolUse`
                // gate; the verb rewrite above would point it at `hook`, which
                // must run after the edit, not before it.
                next = migrate_cursor_gate(&next, skill_root, absolute);
            }
            util::mkdir_p(&jsp::dirname(&artifact.dest))?;
            // Atomic: in user scope this is the user's whole Claude settings file.
            impeccable_common::fsx::write_atomic(&artifact.dest, format!("{}\n", util::json_pretty(&next)).as_bytes()).map_err(|e| util::node_error("open", &artifact.dest, &e))?;
            if !written.contains(&artifact.dest) {
                written.push(artifact.dest.clone());
            }
        }
        if user_scope && *provider == ".claude" {
            prune_duplicate_claude_hooks(sys, skill_root, project_root.unwrap_or(root))?;
        }
    }
    Ok(written)
}

/// The Hermes gateway loads plugins from its home dir, not from a project,
/// so project and global installs alike copy the bundled plugin to `<hermes home>/plugins/`
/// (#1178), overwriting a partial or stale copy. A bundle without the plugin
/// is skipped like a bundle without a provider's manifest; a bundle with half
/// of it is broken and fails. Returns whether the plugin was written.
fn copy_hermes_plugin(sys: &Sys, bundle_dir: &str) -> Result<bool, String> {
    let src = jsp::join(&[bundle_dir, ".hermes", "plugins", hermes::PLUGIN_NAME]);
    if !util::exists(&src) {
        return Ok(false);
    }
    for file in hermes::PLUGIN_FILES {
        if !util::exists(&jsp::join(&[&src, file])) {
            return Err(format!("Bundled Hermes plugin is missing {file}: {src}"));
        }
    }
    let dest = hermes_plugin_dir(sys);
    util::mkdir_p(&dest)?;
    for file in hermes::PLUGIN_FILES {
        util::write_bytes(&jsp::join(&[&dest, file]), &util::read_bytes(&jsp::join(&[&src, file]))?)?;
    }
    Ok(true)
}

fn hermes_plugin_dir(sys: &Sys) -> String {
    hermes::plugin_dir(&hermes::hermes_global_home(&sys.env, &sys.cwd, &sys.home))
}

/// Both plugin files are present under Hermes' home.
pub fn hermes_plugin_installed(sys: &Sys) -> bool {
    let dir = hermes_plugin_dir(sys);
    hermes::PLUGIN_FILES.iter().all(|f| util::exists(&jsp::join(&[&dir, f])))
}

/// Installed and listed under `plugins.enabled` in Hermes' config.yaml.
pub fn hermes_plugin_enabled(sys: &Sys) -> bool {
    hermes::plugin_enabled(&hermes::hermes_global_home(&sys.env, &sys.cwd, &sys.home))
}

/// Once a user-scope Claude hook is in `<home>/.claude/settings.json`, the
/// Impeccable entries in `settings.local.json` (the home one Claude never
/// loads, and the project's gitignored one) only make the hook fire twice.
/// Prunes them, and only when the user hook is confirmed current: a legacy or
/// dangling user entry does not count. Runs after a fresh hook write and on a
/// repeat install whose user hook is already current.
pub fn prune_duplicate_claude_hooks(sys: &crate::providers::Sys, home_root: &str, project_root: &str) -> Result<(), String> {
    if !user_claude_hook_is_current(home_root) {
        return Ok(());
    }
    prune_impeccable_hook_from_manifest(&jsp::join(&[home_root, ".claude", "settings.local.json"]))?;
    if !sys.is_home_dir(project_root) {
        prune_impeccable_hook_from_manifest(&jsp::join(&[project_root, ".claude", "settings.local.json"]))?;
    }
    Ok(())
}

/// Self-heal for the v3 -> launcher upgrade (triage E8): a present provider
/// dir whose hook manifest still names `node .../hook.mjs` points at a script
/// the launcher-era skill no longer ships, so the editor fires a dead command
/// on every edit and `context` would otherwise still count the stale marker as
/// an active hook. Rewrite each such manifest's command strings to the
/// launcher form this engine writes, in place, without touching non-Impeccable
/// entries. Runs regardless of hook consent — it repairs an already-installed
/// hook, it does not add one (a dir with no Impeccable marker is left alone).
/// Idempotent: a manifest already in the launcher form is not stale and is
/// skipped. `.github` (and any provider with no rewritable launcher path)
/// carries a portable, team-committed command form that must not be pinned to
/// a machine-local path here; its migration rides the bundle-merge path in
/// `copy_provider_hooks` instead. A Cursor manifest that still runs the retired
/// `preToolUse` before-edit gate is migrated here too (`migrate_cursor_gate`),
/// in either spelling, so an update moves it to the post-edit hook whether or
/// not the user re-consents to hooks. Returns the providers whose manifest
/// changed.
pub fn repair_stale_hook_manifests(sys: &Sys, root: &str, providers: &[&'static str], skill_root: Option<&str>) -> Result<Vec<&'static str>, String> {
    let skill_root = skill_root.unwrap_or(root);
    let absolute = skill_root != root || sys.is_home_dir(root);
    let mut repaired: Vec<&'static str> = Vec::new();
    for provider in providers {
        if launcher_path(skill_root, provider).is_none() {
            continue;
        }
        let mut changed = false;
        for spec in provider_hook_artifacts(provider) {
            let write_rel = spec.dest_rel.unwrap_or(spec.rel);
            let mut rels: Vec<&str> = vec![write_rel];
            if write_rel != spec.rel {
                rels.push(spec.rel);
            }
            for rel in rels {
                let path = jsp::join(&[root, spec.dest_provider, rel]);
                let cursor_gate = *provider == ".cursor" && manifest_has_retired_cursor_gate(&path);
                if !cursor_gate && !manifest_has_stale_hook(&path) {
                    continue;
                }
                let Ok(text) = util::read_text(&path) else { continue };
                let Ok(parsed) = serde_json::from_str::<Value>(&text) else { continue };
                let rewritten = if cursor_gate {
                    migrate_cursor_gate(&parsed, skill_root, absolute)
                } else {
                    rewrite_hook_commands_for_skill_root(&parsed, provider, skill_root, absolute)
                };
                if rewritten != parsed {
                    util::write_bytes(&path, format!("{}\n", util::json_pretty(&rewritten)).as_bytes())?;
                    changed = true;
                }
            }
        }
        if changed && !repaired.contains(provider) {
            repaired.push(*provider);
        }
    }
    Ok(repaired)
}

/// JS: HOOK_EXPLAINER
pub const HOOK_EXPLAINER: &str = "\nImpeccable can install a design hook for this project. It checks UI files\nafter your agent edits them and feeds the findings back to the agent, so\ndesign slop gets caught as you build. Change it later with\n/impeccable hooks on|off.\n";

/// JS: impeccable-config.mjs#setHookConsent(root, value)
pub fn set_hook_consent(root: &str, value: &str) -> Result<String, String> {
    let file_path = impeccable_detect::config::get_local_config_path(root);
    let existing: Map<String, Value> = util::read_text(&file_path)
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| match v {
            Value::Object(o) => Some(o),
            _ => None,
        })
        .unwrap_or_default();
    let mut hook = match existing.get("hook") {
        Some(Value::Object(h)) => h.clone(),
        _ => Map::new(),
    };
    hook.insert("consent".to_string(), Value::String(value.to_string()));
    let mut next = existing;
    next.insert("hook".to_string(), Value::Object(hook));
    util::mkdir_p(&jsp::dirname(&file_path))?;
    util::write_bytes(&file_path, format!("{}\n", util::json_pretty(&Value::Object(next))).as_bytes())?;
    impeccable_detect::config::ensure_config_git_exclude(root);
    Ok(file_path)
}

/// JS: impeccable-config.mjs#getHookConsent(root)
pub fn get_hook_consent(root: &str) -> Option<String> {
    impeccable_detect::config::get_hook_consent(root)
}
