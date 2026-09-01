//! JS: live-inject.mjs `ensureLiveGitIgnores` / `resolveIgnoreTarget`: the
//! marker-delimited ignore block written to `.git/info/exclude` (or
//! `.gitignore` outside git).

use crate::util::{exists, is_dir, is_file, jsp, rel_fwd, safe_read, write_file};
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{json, Value};

pub const IGNORE_MARKER_OPEN: &str = "# impeccable-live-ignore-start";
pub const IGNORE_MARKER_CLOSE: &str = "# impeccable-live-ignore-end";

/// JS: LIVE_IGNORE_PATTERNS (order matters: it is the written order).
pub const LIVE_IGNORE_PATTERNS: [&str; 30] = [
    ".impeccable/hook.cache.json",
    ".impeccable/hook.pending.json",
    ".impeccable/config.local.json",
    ".impeccable/live/server.json",
    ".impeccable/live/roots.json",
    ".impeccable/live/app-root.json",
    ".impeccable/live/inject-journal.json",
    ".impeccable/live/sessions/",
    ".impeccable/live/previews/",
    ".impeccable/live/annotations/",
    ".impeccable/live/artifacts/",
    ".impeccable/live/accept-receipts/",
    ".impeccable/live/locks/",
    ".impeccable/live/cache/",
    ".impeccable/live/manual-edit-apply-transaction.json",
    ".impeccable/live/manual-edit-events.jsonl",
    ".impeccable/live/manual-edit-evidence/",
    ".impeccable/live/pending-manual-edits.json",
    ".impeccable/live/deferred-svelte-component-accepts.json",
    ".impeccable-live.json",
    ".impeccable-live/",
    "app/.impeccable-live/",
    "src/.impeccable-live/",
    "node_modules/.impeccable-live/",
    "src/lib/impeccable/ImpeccableLiveRoot.svelte",
    "src/lib/impeccable/__runtime.js",
    "src/lib/impeccable/[0-9a-f]*/",
    "plugins/impeccable-live.client.ts",
    "app/plugins/impeccable-live.client.ts",
    "src/plugins/impeccable-live.client.ts",
];

/// The `gitIgnore` result object.
#[derive(Debug, Clone)]
pub struct GitIgnoreResult {
    pub file: String,
    pub mode: &'static str,
    pub changed: bool,
    pub patterns: Vec<String>,
}

impl GitIgnoreResult {
    pub fn to_value(&self) -> Value {
        json!({ "file": self.file, "mode": self.mode, "changed": self.changed, "patterns": self.patterns })
    }
}

fn dedupe(extra: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for p in LIVE_IGNORE_PATTERNS
        .iter()
        .map(|s| s.to_string())
        .chain(extra.iter().cloned())
    {
        if !out.contains(&p) {
            out.push(p);
        }
    }
    out
}

static MARKER_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        "{}[\\s\\S]*?{}",
        crate::util::escape_regex(IGNORE_MARKER_OPEN),
        crate::util::escape_regex(IGNORE_MARKER_CLOSE)
    ))
    .unwrap()
});

/// JS: ensureLiveGitIgnores(cwd, extraPatterns)
pub fn ensure_live_git_ignores(cwd: &str, extra: &[String]) -> GitIgnoreResult {
    let (target_path, mode) = resolve_ignore_target(cwd);
    let existing = if exists(&target_path) {
        safe_read(&target_path).unwrap_or_default()
    } else {
        String::new()
    };
    let patterns = dedupe(extra);
    let mut block_lines: Vec<&str> = vec![IGNORE_MARKER_OPEN];
    block_lines.extend(patterns.iter().map(|s| s.as_str()));
    block_lines.push(IGNORE_MARKER_CLOSE);
    let block = block_lines.join("\n");

    let updated = if MARKER_RE.is_match(&existing) {
        MARKER_RE
            .replacen(&existing, 1, block.as_str())
            .into_owned()
    } else {
        let prefix = if existing.is_empty() {
            String::new()
        } else if existing.ends_with('\n') {
            existing.clone()
        } else {
            format!("{}\n", existing)
        };
        let gap = if prefix.ends_with("\n\n") || prefix.is_empty() {
            ""
        } else {
            "\n"
        };
        format!("{}{}{}\n", prefix, gap, block)
    };

    let changed = updated != existing;
    if changed {
        let _ = write_file(&target_path, &updated);
    }
    GitIgnoreResult {
        file: rel_fwd(cwd, &target_path),
        mode,
        changed,
        patterns,
    }
}

/// JS: resolveIgnoreTarget(cwd)
pub fn resolve_ignore_target(cwd: &str) -> (String, &'static str) {
    if let Some(p) = resolve_git_info_exclude_path(cwd) {
        return (p, "git-info-exclude");
    }
    (jsp::join(&[cwd, ".gitignore"]), "gitignore")
}

static GITDIR_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)^gitdir:\s*(.+)$").unwrap());

/// JS: resolveGitInfoExcludePath(cwd)
pub fn resolve_git_info_exclude_path(cwd: &str) -> Option<String> {
    let dot_git = jsp::join(&[cwd, ".git"]);
    if !exists(&dot_git) {
        return None;
    }
    if is_dir(&dot_git) {
        return Some(jsp::join(&[&dot_git, "info", "exclude"]));
    }
    if !is_file(&dot_git) {
        return None;
    }
    let body = safe_read(&dot_git)?;
    let body = impeccable_context::util::js_trim(&body);
    let m = GITDIR_RE.captures(body)?;
    let git_dir_raw = m.get(1)?.as_str();
    let git_dir = if jsp::is_absolute(git_dir_raw) {
        git_dir_raw.to_string()
    } else {
        jsp::resolve(cwd, &[git_dir_raw])
    };
    Some(jsp::join(&[&git_dir, "info", "exclude"]))
}
