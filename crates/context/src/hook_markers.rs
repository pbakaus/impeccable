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

/// True when `command` invokes an Impeccable hook in either generation's spelling.
pub fn is_impeccable_hook_command(command: &str) -> bool {
    LEGACY_HOOK_SCRIPT_MARKERS.iter().any(|m| command.contains(m)) || LAUNCHER_HOOK_MARKER.is_match(command)
}

/// True when `command` invokes an Impeccable hook in the launcher generation
/// only (any hook verb). Tells a repaired manifest from a stale `.mjs`-only
/// one: install/update use this to decide which manifests still need
/// migrating to the launcher form.
pub fn is_launcher_hook_command(command: &str) -> bool {
    LAUNCHER_HOOK_MARKER.is_match(command)
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
    command.contains("skills/impeccable/scripts/hook.mjs")
        || command.contains("skills/impeccable/scripts/hook-before-edit.mjs")
        || LAUNCHER_DESIGN_HOOK.is_match(command)
}

/// True when `command` runs the design hook (`hook` / `hook-before-edit`) in
/// the launcher spelling only. `context`'s automatic-hook scan uses this, not
/// `is_design_hook_command`: a manifest that still names only the JS-era
/// `.mjs` path is a stale pre-launcher install whose script no longer exists,
/// so the hook is dead and `MANUAL_DETECTOR_REQUIRED` must fire until an
/// install/update repairs it.
pub fn is_launcher_design_hook_command(command: &str) -> bool {
    LAUNCHER_DESIGN_HOOK.is_match(command)
}

/// The shell token that names the hook program inside `command`, for
/// existence checks: the `.mjs` script path in the JS form, the launcher
/// path in the binary form. `None` when the command carries no marker or
/// the token cannot be isolated (a `'\''` escape sequence, for instance).
pub fn hook_program_token(command: &str) -> Option<String> {
    if !is_design_hook_command(command) {
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
    if let Some(m) = QUOTED.captures(command) {
        return Some(m[1].to_string());
    }
    if command.contains("'\\''") {
        return None;
    }
    if let Some(m) = SINGLE.captures(command) {
        return Some(m[1].to_string());
    }
    BARE.captures(command).map(|m| m[1].to_string())
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
}
