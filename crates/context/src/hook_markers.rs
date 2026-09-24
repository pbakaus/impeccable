//! How an Impeccable-owned hook command is recognized inside a harness
//! manifest. Two generations coexist in the wild:
//!
//! * the JS era, `node "<...>/skills/impeccable/scripts/hook.mjs"` (and the
//!   `hook-before-edit` / `hook-probe` / `hook-after-edit` / `hook-stop`
//!   siblings), and
//! * the binary era, `"<...>/skills/impeccable/scripts/impeccable" hook`
//!   (`impeccable.cmd` on Windows, `hook-before-edit` for Cursor).
//!
//! `impeccable hooks on` repairs the old form to the new one, so pruning and
//! merging must recognize both; `doctor` and `context`'s automatic-hook scan
//! must accept either as "installed".

use once_cell::sync::Lazy;
use regex::Regex;

/// The JS-era script markers, still recognized so old installs are pruned
/// and repaired rather than duplicated.
pub const LEGACY_HOOK_SCRIPT_MARKERS: &[&str] = &[
    "skills/impeccable/scripts/hook-probe.mjs",
    "skills/impeccable/scripts/hook.mjs",
    "skills/impeccable/scripts/hook-before-edit.mjs",
    "skills/impeccable/scripts/hook-after-edit.mjs",
    "skills/impeccable/scripts/hook-stop.mjs",
];

/// Matches the launcher path (`.../skills/impeccable/scripts/impeccable` or
/// `impeccable.cmd`), the closing quote if any, then the hook verb.
static LAUNCHER_HOOK_MARKER: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"skills/impeccable/scripts/impeccable(?:\.cmd|\.exe)?["']?\s+hook(?:-before-edit|-probe|-after-edit|-stop)?(?:\s|$|["'&|;)])"#).unwrap()
});

/// User-scope Windows commands embed a JSON-quoted path whose backslashes are
/// doubled in the command string (#784). #604's single `\`→`/` replace is not
/// enough: `\\` becomes `//`, which breaks `skills/impeccable` matching.
/// A leading `//` after a quote (or at the start of the string) is a UNC
/// prefix and stays two slashes, so doctor still probes `//server/share/...`.
fn normalize_hook_separators(command: &str) -> String {
    let mut out = String::with_capacity(command.len());
    let mut chars = command.chars().peekable();
    let mut prev: Option<char> = None;
    while let Some(ch) = chars.next() {
        if ch != '\\' && ch != '/' {
            out.push(ch);
            prev = Some(ch);
            continue;
        }
        let mut n = 1usize;
        while matches!(chars.peek(), Some('\\' | '/')) {
            chars.next();
            n += 1;
        }
        out.push('/');
        if n >= 2 && matches!(prev, None | Some('"' | '\'')) {
            out.push('/');
        }
        prev = Some('/');
    }
    out
}

/// True when `command` invokes an Impeccable hook in either generation's spelling.
pub fn is_impeccable_hook_command(command: &str) -> bool {
    let command = normalize_hook_separators(command);
    LEGACY_HOOK_SCRIPT_MARKERS.iter().any(|m| command.contains(m)) || LAUNCHER_HOOK_MARKER.is_match(&command)
}

/// True when `command` invokes an Impeccable hook in the launcher generation
/// only (any hook verb). Tells a repaired manifest from a stale `.mjs`-only
/// one: install/update use this to decide which manifests still need
/// migrating to the launcher form.
pub fn is_launcher_hook_command(command: &str) -> bool {
    LAUNCHER_HOOK_MARKER.is_match(&normalize_hook_separators(command))
}

/// The launcher-era markers `context` and `doctor` treat as the design hook
/// proper (the per-edit hook and Cursor's before-edit gate). Legacy siblings
/// like `hook-probe` are admin-only and do not count as an installed hook.
static LAUNCHER_DESIGN_HOOK: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"skills/impeccable/scripts/impeccable(?:\.cmd|\.exe)?["']?\s+hook(?:-before-edit)?(?:\s|$|["'&|;)])"#).unwrap()
});

/// True when `command` runs the design hook itself (`hook` or
/// `hook-before-edit`) in either spelling; the JS `context.mjs` scan and
/// `staleness-deep` HOOK_SCRIPT_MARKERS both meant exactly these two.
pub fn is_design_hook_command(command: &str) -> bool {
    let command = normalize_hook_separators(command);
    command.contains("skills/impeccable/scripts/hook.mjs")
        || command.contains("skills/impeccable/scripts/hook-before-edit.mjs")
        || LAUNCHER_DESIGN_HOOK.is_match(&command)
}

/// True when `command` runs the design hook (`hook` / `hook-before-edit`) in
/// the launcher spelling only. `context`'s automatic-hook scan uses this, not
/// `is_design_hook_command`: a manifest that still names only the JS-era
/// `.mjs` path is a stale pre-launcher install whose script no longer exists,
/// so the hook is dead and `MANUAL_DETECTOR_REQUIRED` must fire until an
/// install/update repairs it.
pub fn is_launcher_design_hook_command(command: &str) -> bool {
    LAUNCHER_DESIGN_HOOK.is_match(&normalize_hook_separators(command))
}

/// The shell token that names the hook program inside `command`, for
/// existence checks: the `.mjs` script path in the JS form, the launcher
/// path in the binary form. `None` when the command carries no marker or
/// the token cannot be isolated (a `'\''` escape sequence, for instance).
pub fn hook_program_token(command: &str) -> Option<String> {
    if command.contains("'\\''") {
        return None;
    }
    let command = normalize_hook_separators(command);
    if !is_design_hook_command(&command) {
        return None;
    }
    static QUOTED: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r#""([^"]*skills/impeccable/scripts/(?:hook(?:-before-edit)?\.mjs|impeccable(?:\.cmd|\.exe)?))""#).unwrap()
    });
    static SINGLE: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r"'([^']*skills/impeccable/scripts/(?:hook(?:-before-edit)?\.mjs|impeccable(?:\.cmd|\.exe)?))'").unwrap()
    });
    static BARE: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r#"([^\s"'|&;()]*skills/impeccable/scripts/(?:hook(?:-before-edit)?\.mjs|impeccable(?:\.cmd|\.exe)?))"#).unwrap()
    });
    if let Some(m) = QUOTED.captures(&command) {
        return Some(m[1].to_string());
    }
    if let Some(m) = SINGLE.captures(&command) {
        return Some(m[1].to_string());
    }
    BARE.captures(&command).map(|m| m[1].to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_legacy_script_forms() {
        assert!(is_impeccable_hook_command("node \"${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/hook.mjs\""));
        assert!(is_impeccable_hook_command("[ ! -f '/x/.cursor/skills/impeccable/scripts/hook-before-edit.mjs' ] || node '/x/.cursor/skills/impeccable/scripts/hook-before-edit.mjs'"));
        assert!(is_impeccable_hook_command("node .agents/skills/impeccable/scripts/hook-probe.mjs"));
        assert!(is_design_hook_command("node \".agents/skills/impeccable/scripts/hook.mjs\""));
        assert!(!is_design_hook_command("node .agents/skills/impeccable/scripts/hook-probe.mjs"));
    }

    #[test]
    fn recognizes_launcher_forms() {
        for cmd in [
            "\"${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/impeccable\" hook",
            "\".agents/skills/impeccable/scripts/impeccable\" hook",
            "\".agents/skills/impeccable/scripts/impeccable.cmd\" hook",
            "\".cursor/skills/impeccable/scripts/impeccable\" hook-before-edit",
            "\"$(git rev-parse --show-toplevel)/.github/skills/impeccable/scripts/impeccable\" hook",
            "[ ! -f '/x/.claude/skills/impeccable/scripts/impeccable' ] || '/x/.claude/skills/impeccable/scripts/impeccable' hook",
            "if exist \".agents/skills/impeccable/scripts/impeccable.cmd\" (\".agents/skills/impeccable/scripts/impeccable.cmd\" hook & exit /b)",
        ] {
            assert!(is_impeccable_hook_command(cmd), "{cmd}");
            assert!(is_design_hook_command(cmd), "{cmd}");
        }
    }

    #[test]
    fn launcher_recognizers_reject_stale_mjs() {
        // A stale `.mjs`-only manifest is still "ours" (so it is pruned and
        // repaired) but no longer counts as an active launcher hook.
        for cmd in [
            "node \".claude/skills/impeccable/scripts/hook.mjs\"",
            "[ ! -f '/x/.cursor/skills/impeccable/scripts/hook-before-edit.mjs' ] || node '/x/.cursor/skills/impeccable/scripts/hook-before-edit.mjs'",
        ] {
            assert!(is_impeccable_hook_command(cmd), "{cmd}");
            assert!(is_design_hook_command(cmd), "{cmd}");
            assert!(!is_launcher_hook_command(cmd), "{cmd}");
            assert!(!is_launcher_design_hook_command(cmd), "{cmd}");
        }
        // The launcher form counts as active exactly as before.
        for cmd in [
            "\".claude/skills/impeccable/scripts/impeccable\" hook",
            "'/x/.cursor/skills/impeccable/scripts/impeccable' hook-before-edit",
        ] {
            assert!(is_launcher_hook_command(cmd), "{cmd}");
            assert!(is_launcher_design_hook_command(cmd), "{cmd}");
        }
    }

    #[test]
    fn rejects_unrelated_commands() {
        for cmd in [
            "node \"${CLAUDE_PROJECT_DIR}/.claude/skills/other/scripts/hook.mjs\"",
            "\".claude/skills/impeccable/scripts/impeccable\" context",
            "impeccable hook",
            "echo skills/impeccable/scripts/impeccable-hook",
        ] {
            assert!(!is_impeccable_hook_command(cmd), "{cmd}");
        }
    }

    #[test]
    fn extracts_program_token() {
        assert_eq!(
            hook_program_token("node \"${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/hook.mjs\"").as_deref(),
            Some("${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/hook.mjs")
        );
        assert_eq!(
            hook_program_token("\"${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/impeccable\" hook").as_deref(),
            Some("${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/impeccable")
        );
        assert_eq!(
            hook_program_token("'/x/.cursor/skills/impeccable/scripts/impeccable' hook-before-edit").as_deref(),
            Some("/x/.cursor/skills/impeccable/scripts/impeccable")
        );
        assert_eq!(
            hook_program_token(".agents/skills/impeccable/scripts/impeccable hook").as_deref(),
            Some(".agents/skills/impeccable/scripts/impeccable")
        );
        assert_eq!(hook_program_token("'/x/it'\\''s/.claude/skills/impeccable/scripts/impeccable' hook"), None);
        assert_eq!(hook_program_token("echo hi"), None);
    }

    #[test]
    fn recognizes_json_escaped_windows_launcher_path() {
        let launcher = r"C:\Users\alice\.claude\skills\impeccable\scripts\impeccable";
        let quoted = serde_json::to_string(launcher).unwrap();
        let cmd = format!("[ ! -f {quoted} ] || {quoted} hook");
        assert!(is_impeccable_hook_command(&cmd), "{cmd}");
        assert!(is_launcher_hook_command(&cmd), "{cmd}");
        assert!(is_design_hook_command(&cmd), "{cmd}");
        assert_eq!(
            hook_program_token(&cmd).as_deref(),
            Some("C:/Users/alice/.claude/skills/impeccable/scripts/impeccable")
        );
    }

    #[test]
    fn recognizes_single_backslash_windows_path() {
        let cmd = r#"[ ! -f "C:\Users\alice\.claude\skills\impeccable\scripts\impeccable" ] || "C:\Users\alice\.claude\skills\impeccable\scripts\impeccable" hook"#;
        assert!(is_impeccable_hook_command(cmd), "{cmd}");
        assert!(is_launcher_hook_command(cmd), "{cmd}");
        assert!(is_design_hook_command(cmd), "{cmd}");
    }

    #[test]
    fn preserves_unc_prefix_in_program_token() {
        let launcher = r"\\server\share\.claude\skills\impeccable\scripts\impeccable";
        let quoted = serde_json::to_string(launcher).unwrap();
        let json_escaped = format!("[ ! -f {quoted} ] || {quoted} hook");
        assert!(is_impeccable_hook_command(&json_escaped), "{json_escaped}");
        assert_eq!(
            hook_program_token(&json_escaped).as_deref(),
            Some("//server/share/.claude/skills/impeccable/scripts/impeccable")
        );

        let single = r#"[ ! -f "\\server\share\.claude\skills\impeccable\scripts\impeccable" ] || "\\server\share\.claude\skills\impeccable\scripts\impeccable" hook"#;
        assert!(is_impeccable_hook_command(single), "{single}");
        assert_eq!(
            hook_program_token(single).as_deref(),
            Some("//server/share/.claude/skills/impeccable/scripts/impeccable")
        );
    }
}

/// Removes `//` and `/* */` comments outside JSON strings, the dialect
/// Gemini CLI reads its `settings.json` in (`strip-json-comments`). Returns
/// the stripped text and whether any comment was removed, so a writer that
/// cannot preserve comments knows to keep a backup.
pub fn strip_json_comments(text: &str) -> (String, bool) {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    let (mut in_string, mut escaped, mut stripped) = (false, false, false);
    while let Some(ch) = chars.next() {
        if in_string {
            out.push(ch);
            if escaped { escaped = false } else if ch == '\\' { escaped = true } else if ch == '"' { in_string = false }
            continue;
        }
        match (ch, chars.peek()) {
            ('"', _) => { in_string = true; out.push(ch); }
            ('/', Some('/')) => {
                stripped = true;
                while let Some(&c) = chars.peek() { if c == '\n' { break } chars.next(); }
            }
            ('/', Some('*')) => {
                stripped = true;
                chars.next();
                let mut prev = '\0';
                for c in chars.by_ref() { if prev == '*' && c == '/' { break } prev = c; }
                out.push(' ');
            }
            _ => out.push(ch),
        }
    }
    (out, stripped)
}

/// Parses a hook manifest that may carry comments. `None` when it is not JSON
/// even after the comments are removed.
pub fn parse_manifest_jsonc(text: &str) -> Option<(serde_json::Value, bool)> {
    let (stripped, had_comments) = strip_json_comments(text);
    serde_json::from_str(&stripped).ok().map(|v| (v, had_comments))
}

#[cfg(test)]
mod jsonc_tests {
    use super::*;

    #[test]
    fn strips_comments_outside_strings_only() {
        let (v, had) = parse_manifest_jsonc("{\n // a\n \"u\": \"http://x//y\", /* b */ \"s\": \"/* no */\\\"//\"\n}").unwrap();
        assert!(had);
        assert_eq!(v["u"], "http://x//y");
        assert_eq!(v["s"], "/* no */\"//");
        assert_eq!(parse_manifest_jsonc("{\"a\": 1}").unwrap().1, false);
        assert!(parse_manifest_jsonc("{ \"a\": ").is_none());
        assert_eq!(crate::context_cli::hook_manifests_for("gemini"), &[".gemini/settings.json"]);
    }
}
