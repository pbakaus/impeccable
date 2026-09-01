//! Provider identity and skill-directory resolution for the binary.
//!
//! The JS scripts learn their provider at build time (`lib/provider.mjs`,
//! rewritten per harness) and find `../reference/` and `../SKILL.md` relative
//! to their own file. One binary serves every harness, so both are resolved
//! at run time:
//!
//! - **Skill dir**: `IMPECCABLE_SKILL_DIR` when set; otherwise walk up from the
//!   executable's path (the binary ships at `<skill>/scripts/bin/<target>/` or
//!   is launched via `<skill>/scripts/impeccable`) until a directory holding
//!   `reference/ios.md` is found. `None` when neither works (source checkouts
//!   running `target/debug/impeccable` need the env var).
//! - **Provider id**: `IMPECCABLE_PROVIDER_ID` when set; otherwise derived from
//!   the skill dir's harness folder (`<root>/.codex/skills/impeccable` ->
//!   `codex`); otherwise `source`, exactly what the JS reads in a source
//!   checkout. The command prefix is `$` for `codex`, `/` for everything else.
//! - **Self command**: the text a directive prints where the JS printed
//!   `node <scripts>/<script>.mjs`. `IMPECCABLE_SELF` when set (the launcher
//!   exports it), else the executable path. Printed as `<self> <verb>`.

use crate::jsp;
use crate::util::Env;

pub const SOURCE_PROVIDER: &str = "source";

pub struct Provider {
    pub id: String,
    pub command_prefix: String,
    /// `<prefix>impeccable`
    pub command: String,
    pub skill_dir: Option<String>,
    /// How to spell this binary in printed commands.
    pub self_cmd: String,
}

fn exe_path() -> Option<String> {
    let exe = std::env::current_exe().ok()?;
    Some(exe.to_string_lossy().into_owned())
}

fn find_skill_dir_from(start: &str) -> Option<String> {
    let mut dir = start.to_string();
    loop {
        if crate::util::exists(&jsp::join(&[&dir, "reference", "ios.md"])) {
            return Some(dir);
        }
        let parent = jsp::dirname(&dir);
        if parent == dir {
            return None;
        }
        dir = parent;
    }
}

fn provider_from_skill_dir(skill_dir: &str) -> Option<&'static str> {
    // <root>/<harness>/skills/impeccable
    let skills = jsp::dirname(skill_dir);
    if jsp::basename(&skills) != "skills" {
        return None;
    }
    let harness = jsp::basename(&jsp::dirname(&skills));
    Some(match harness.as_str() {
        ".claude" => "claude-code",
        ".cursor" => "cursor",
        ".gemini" => "gemini",
        ".codex" => "codex",
        ".agents" => "agents",
        ".github" => "github",
        ".kiro" => "kiro",
        ".opencode" => "opencode",
        ".pi" => "pi",
        ".qoder" => "qoder",
        ".trae" => "trae",
        ".trae-cn" => "trae-cn",
        ".rovodev" => "rovo-dev",
        ".vibe" => "vibe",
        ".grok" => "grok",
        ".agent" => "antigravity",
        ".hermes" => "hermes",
        _ => return None,
    })
}

pub fn detect(env: &Env, cwd: &str) -> Provider {
    let skill_dir = match env.get("IMPECCABLE_SKILL_DIR").filter(|v| !v.trim().is_empty()) {
        Some(v) => Some(jsp::resolve(cwd, &[v.trim()])),
        None => exe_path().and_then(|p| find_skill_dir_from(&jsp::dirname(&p))),
    };
    let id = match env.get("IMPECCABLE_PROVIDER_ID").filter(|v| !v.trim().is_empty()) {
        Some(v) => v.trim().to_string(),
        None => skill_dir
            .as_deref()
            .and_then(provider_from_skill_dir)
            .unwrap_or(SOURCE_PROVIDER)
            .to_string(),
    };
    let command_prefix = if id == "codex" { "$" } else { "/" }.to_string();
    let command = format!("{}impeccable", command_prefix);
    let self_cmd = match env.get("IMPECCABLE_SELF").filter(|v| !v.trim().is_empty()) {
        Some(v) => v.trim().to_string(),
        None => exe_path().unwrap_or_else(|| "impeccable".to_string()),
    };
    Provider { id, command_prefix, command, skill_dir, self_cmd }
}

impl Provider {
    /// `<skill>/reference/<name>.md`
    pub fn reference_path(&self, name: &str) -> Option<String> {
        self.skill_dir.as_ref().map(|d| jsp::join(&[d, "reference", &format!("{}.md", name)]))
    }
    /// `<skill>/SKILL.md`
    pub fn skill_md_path(&self) -> Option<String> {
        self.skill_dir.as_ref().map(|d| jsp::join(&[d, "SKILL.md"]))
    }
    /// The command a directive should print for a sibling verb, in place of
    /// `node <scripts>/<verb>.mjs`.
    pub fn verb_cmd(&self, verb: &str) -> String {
        format!("{} {}", self.self_cmd, verb)
    }
}
