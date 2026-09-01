//! Hook manifests written by install / update: which bundle manifest goes
//! where per provider, how the bundled command is rewritten for the actual
//! install target, and the merge / prune / marker helpers. JS: skills.mjs
//! `PROVIDER_HOOK_ARTIFACTS` .. `copyProviderHooks`.
//!
//! Where the JS wrote `[ ! -f "<skill>/scripts/hook.mjs" ] || node
//! "<skill>/scripts/hook.mjs"` (and a `node -e` guard on Windows), the binary
//! writes the launcher form `[ ! -f "<skill>/scripts/impeccable" ] ||
//! "<skill>/scripts/impeccable" hook` (`hook-before-edit` for Cursor), the
//! shape the public build's `transformers/hooks.js` puts in the bundle; the
//! Codex `commandWindows` sibling runs `impeccable.cmd` behind `if exist`.
//! `impeccable hooks on` (`impeccable_hook::admin`) writes the same launcher
//! invocation for a project install (without the existence guard). Recognition of an
//! Impeccable-owned entry (either the JS `.mjs` generation or the launcher
//! generation) is shared with the hook crate, `context`, and `doctor` through
//! `impeccable_context::hook_markers::is_impeccable_hook_command`, so the two
//! writers and the three readers can never disagree on what counts as ours.

use impeccable_context::hook_markers::{is_impeccable_hook_command, is_launcher_hook_command};
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

/// The hook verb the launcher runs for a provider (JS: the `hook.mjs` /
/// `hook-before-edit.mjs` choice in hookScriptRelPathForProvider).
pub fn hook_verb(provider: &str) -> &'static str {
    if provider == ".cursor" {
        "hook-before-edit"
    } else {
        "hook"
    }
}

/// JS: hookScriptRelPathForProvider(provider), for the launcher: the
/// project-relative launcher path (Claude keeps its `${CLAUDE_PROJECT_DIR}`
/// token).
pub fn launcher_rel_path(provider: &str) -> String {
    let rel = format!("{provider}/skills/impeccable/scripts/impeccable");
    if provider == ".claude" {
        format!("${{CLAUDE_PROJECT_DIR}}/{rel}")
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
        ".cursor" | ".claude" | ".agents" | ".grok" => {
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
    /// The `.cmd` shim, double-quoted, for Codex's `commandWindows`.
    pub win32_cmd: String,
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
        win32_cmd: json_string(&format!("{path}.cmd")),
    })
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
pub fn hook_command(quoted: &QuotedPath, provider: &str, win32: bool) -> String {
    let verb = hook_verb(provider);
    let q = if provider != ".agents" && win32 { &quoted.win32 } else { &quoted.posix };
    format!("[ ! -f {q} ] || {q} {verb}")
}

/// JS: windowsHookCommand(quotedPath), launcher edition (`transformers/hooks.js`
/// `windowsLauncherCommand`): the `.cmd` shim behind a cmd.exe `if exist`
/// guard; `exit /b` forwards the launcher's errorlevel.
pub fn windows_hook_command(quoted: &QuotedPath, provider: &str) -> String {
    let q = &quoted.win32_cmd;
    format!("if exist {q} ({q} {} & exit /b)", hook_verb(provider))
}

/// JS: rewriteHookCommandsForSkillRoot(value, provider, {skillRoot, absolute})
pub fn rewrite_hook_commands_for_skill_root(value: &Value, provider: &str, skill_root: &str, absolute: bool) -> Value {
    let Some(quoted) = quoted_launcher_path(skill_root, provider, absolute) else {
        return value.clone();
    };
    rewrite_value(value, provider, &quoted, cfg!(windows))
}

/// `rewrite_hook_commands_for_skill_root` with the platform made explicit
/// (tests drive the Windows form from any host).
pub fn rewrite_hook_commands_for_platform(value: &Value, provider: &str, skill_root: &str, absolute: bool, win32: bool) -> Value {
    let Some(quoted) = quoted_launcher_path(skill_root, provider, absolute) else {
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

/// JS: valueHasImpeccableHookMarker(value). Command separators are
/// normalized to `/` first so a legacy Windows-path guard is still
/// recognized as ours and replaced instead of duplicated (upstream
/// 665c51b9, #604).
pub fn value_has_impeccable_hook_marker(value: &Value) -> bool {
    match value {
        Value::String(s) => is_impeccable_hook_command(&s.replace('\\', "/")),
        Value::Array(a) => a.iter().any(value_has_impeccable_hook_marker),
        Value::Object(o) => o.values().any(value_has_impeccable_hook_marker),
        _ => false,
    }
}

/// True when `value` names an Impeccable hook in the launcher generation.
/// Separators are normalized to `/` first, matching
/// `value_has_impeccable_hook_marker`, so a legacy Windows-path launcher
/// command is still recognized.
pub fn value_has_launcher_hook_marker(value: &Value) -> bool {
    match value {
        Value::String(s) => is_launcher_hook_command(&s.replace('\\', "/")),
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

/// JS: fileHasImpeccableHookMarker(file): parse and scan only the `hooks`
/// subtree.
pub fn file_has_impeccable_hook_marker(file: &str) -> bool {
    if !util::exists(file) {
        return false;
    }
    let Ok(text) = util::read_text(file) else { return false };
    let Ok(parsed) = serde_json::from_str::<Value>(&text) else { return false };
    let Value::Object(map) = parsed else { return false };
    match map.get("hooks") {
        Some(h @ (Value::Object(_) | Value::Array(_))) => value_has_impeccable_hook_marker(h),
        _ => false,
    }
}

/// JS: hookInstalledForProvider(root, provider)
pub fn hook_installed_for_provider(root: &str, provider: &str) -> bool {
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
    let Ok(text) = util::read_text(manifest_path) else { return Ok(false) };
    let Ok(Value::Object(parsed)) = serde_json::from_str::<Value>(&text) else { return Ok(false) };
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
/// Returns the providers whose manifest was written (deduplicated, in order).
pub fn copy_provider_hooks(sys: &crate::providers::Sys, bundle_dir: &str, root: &str, providers: &[&'static str], force: bool, skill_root: Option<&str>) -> Result<Vec<&'static str>, String> {
    let skill_root = skill_root.unwrap_or(root);
    let mut written: Vec<&'static str> = Vec::new();
    for provider in providers {
        for artifact in hook_artifacts_for_provider(bundle_dir, root, provider) {
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
            let absolute = skill_root != root || sys.is_home_dir(root);
            let fresh = rewrite_hook_commands_for_skill_root(&fresh_manifest, provider, skill_root, absolute);
            let mut next = fresh.clone();
            if util::exists(&artifact.dest) {
                let parsed = util::read_text(&artifact.dest)
                    .ok()
                    .and_then(|t| serde_json::from_str::<Value>(&t).ok());
                match parsed {
                    Some(existing) => next = merge_hook_manifests(&existing, &fresh),
                    None => {
                        if !force {
                            return Err(format!("Existing hook manifest is not valid JSON: {}. Re-run with --force to replace it.", artifact.dest));
                        }
                        util::write_bytes(&format!("{}.bak", artifact.dest), &util::read_bytes(&artifact.dest)?)?;
                        next = fresh;
                    }
                }
            }
            util::mkdir_p(&jsp::dirname(&artifact.dest))?;
            util::write_bytes(&artifact.dest, format!("{}\n", util::json_pretty(&next)).as_bytes())?;
            if !written.contains(provider) {
                written.push(provider);
            }
        }
    }
    Ok(written)
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
/// `copy_provider_hooks` instead. Returns the providers whose manifest changed.
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
                if !manifest_has_stale_hook(&path) {
                    continue;
                }
                let Ok(text) = util::read_text(&path) else { continue };
                let Ok(parsed) = serde_json::from_str::<Value>(&text) else { continue };
                let rewritten = rewrite_hook_commands_for_skill_root(&parsed, provider, skill_root, absolute);
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
pub const HOOK_EXPLAINER: &str = "\nImpeccable can install a design hook for this project. In Claude/Codex it\nchecks UI files after edits; in Cursor it checks proposed writes before they\nland and can block writes with detector findings. It feeds results back to\nyour agent so design slop gets caught as you build. Change it later with\n/impeccable hooks on|off.\n";

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
