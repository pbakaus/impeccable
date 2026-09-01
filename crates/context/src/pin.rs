//! JS: pin.mjs -> `impeccable pin <pin|unpin> <command>`

use crate::jsp;
use crate::util::{exists, read_json, safe_read};
use impeccable_common::Io;

/// Bundled copy of `skill/scripts/command-metadata.json` (build-time copy;
/// keep in sync with the public repo).
pub const COMMAND_METADATA_JSON: &str = include_str!("command-metadata.json");

const HARNESS_DIRS: [&str; 17] = [
    ".claude", ".cursor", ".gemini", ".codex", ".agents", ".agent", ".github", ".grok", ".hermes", ".trae", ".trae-cn",
    ".pi", ".opencode", ".kiro", ".rovodev", ".vibe", ".qoder",
];
const CODEX_HARNESSES: [&str; 2] = [".codex", ".agents"];
pub const VALID_COMMANDS: [&str; 23] = [
    "craft", "init", "extract", "document", "shape", "critique", "audit", "polish", "bolder", "quieter", "distill",
    "harden", "onboard", "live", "animate", "colorize", "typeset", "layout", "delight", "overdrive", "clarify",
    "adapt", "optimize",
];
const PIN_MARKER: &str = "<!-- impeccable-pinned-skill -->";

fn find_project_root(start: &str) -> String {
    let mut dir = jsp::resolve(start, &[]);
    while dir != "/" {
        if exists(&jsp::join(&[&dir, "package.json"]))
            || exists(&jsp::join(&[&dir, ".git"]))
            || exists(&jsp::join(&[&dir, "skills-lock.json"]))
        {
            return dir;
        }
        let parent = jsp::resolve(&dir, &[".."]);
        if parent == dir {
            break;
        }
        dir = parent;
    }
    jsp::resolve(start, &[])
}

fn find_harness_dirs(project_root: &str) -> Vec<String> {
    let mut dirs = Vec::new();
    for h in HARNESS_DIRS {
        let skills = jsp::join(&[project_root, h, "skills"]);
        if exists(&jsp::join(&[&skills, "impeccable"])) || exists(&jsp::join(&[&skills, "i-impeccable"])) {
            dirs.push(skills);
        }
    }
    dirs
}

fn command_prefix_for(skills_dir: &str) -> &'static str {
    let harness = jsp::basename(&jsp::dirname(skills_dir));
    if CODEX_HARNESSES.contains(&harness.as_str()) {
        "$"
    } else {
        "/"
    }
}

fn generate_pinned_skill(command: &str, metadata: &serde_json::Value, prefix: &str, is_codex: bool) -> String {
    let entry = metadata.get(command);
    let desc = entry
        .and_then(|e| e.get("description"))
        .and_then(|d| d.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("Shortcut for {}impeccable {}.", prefix, command));
    let hint = entry
        .and_then(|e| e.get("argumentHint"))
        .and_then(|d| d.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("[target]");
    let provider_fm = if is_codex {
        format!("metadata:\n  argument-hint: \"{}\"", hint)
    } else {
        format!("argument-hint: \"{}\"\nuser-invocable: true", hint)
    };
    format!(
        "---\nname: {command}\ndescription: \"{desc}\"\n{provider_fm}\n---\n\n{marker}\n\nThis is a pinned shortcut for `{prefix}impeccable {command}`.\n\nInvoke {prefix}impeccable {command}, passing along any arguments provided here, and follow its instructions.\n",
        command = command,
        desc = desc,
        provider_fm = provider_fm,
        marker = PIN_MARKER,
        prefix = prefix
    )
}

fn load_metadata(io: &Io) -> serde_json::Value {
    // Prefer a sibling command-metadata.json in the skill dir when present
    // (an installed skill may be newer than the embedded copy).
    let cwd = io.cwd.to_string_lossy().into_owned();
    let provider = crate::provider::detect(&io.env, &cwd);
    if let Some(dir) = &provider.skill_dir {
        let p = jsp::join(&[dir, "scripts", "command-metadata.json"]);
        if let Some(v) = read_json(&p) {
            return v;
        }
    }
    serde_json::from_str(COMMAND_METADATA_JSON).unwrap_or(serde_json::Value::Object(Default::default()))
}

pub fn run(args: &[String], io: &mut Io) -> i32 {
    let action = args.first().cloned();
    let command = args.get(1).cloned();
    let (Some(action), Some(command)) = (action.filter(|a| !a.is_empty()), command.filter(|c| !c.is_empty())) else {
        io.out("Usage: impeccable pin <pin|unpin> <command>\n");
        io.out(&format!("\nAvailable commands: {}\n", VALID_COMMANDS.join(", ")));
        return 1;
    };
    if action != "pin" && action != "unpin" {
        io.err(&format!("Unknown action: {}. Use 'pin' or 'unpin'.\n", action));
        return 1;
    }
    if !VALID_COMMANDS.contains(&command.as_str()) {
        io.err(&format!("Unknown command: {}\n", command));
        io.err(&format!("Available commands: {}\n", VALID_COMMANDS.join(", ")));
        return 1;
    }
    let cwd = io.cwd.to_string_lossy().into_owned();
    let root = find_project_root(&cwd);
    if action == "pin" {
        let metadata = load_metadata(io);
        let harness_dirs = find_harness_dirs(&root);
        if harness_dirs.is_empty() {
            io.out("No harness directories with impeccable installed found.\n");
            return 0;
        }
        let mut created = 0;
        for skills_dir in &harness_dirs {
            let prefix = command_prefix_for(skills_dir);
            let content = generate_pinned_skill(&command, &metadata, prefix, prefix == "$");
            let skill_dir = jsp::join(&[skills_dir, &command]);
            if exists(&skill_dir) {
                let md = jsp::join(&[&skill_dir, "SKILL.md"]);
                if exists(&md) {
                    let existing = safe_read(&md).unwrap_or_default();
                    if !existing.contains(PIN_MARKER) {
                        io.out(&format!("  SKIP: {} (non-pinned skill already exists)\n", skill_dir));
                        continue;
                    }
                }
            }
            let _ = std::fs::create_dir_all(&skill_dir);
            let _ = std::fs::write(jsp::join(&[&skill_dir, "SKILL.md"]), content);
            io.out(&format!("  + {}\n", skill_dir));
            created += 1;
        }
        if created > 0 {
            io.out(&format!("\nPinned '{}' as a standalone shortcut in {} location(s).\n", command, created));
            io.out("Use the pinned command directly in each harness.\n");
        }
    } else {
        let harness_dirs = find_harness_dirs(&root);
        let mut removed = 0;
        for skills_dir in &harness_dirs {
            let skill_dir = jsp::join(&[skills_dir, &command]);
            if !exists(&skill_dir) {
                continue;
            }
            let md = jsp::join(&[&skill_dir, "SKILL.md"]);
            if !exists(&md) {
                continue;
            }
            let content = safe_read(&md).unwrap_or_default();
            if !content.contains(PIN_MARKER) {
                io.out(&format!("  SKIP: {} (not a pinned skill)\n", skill_dir));
                continue;
            }
            let _ = std::fs::remove_dir_all(&skill_dir);
            io.out(&format!("  - {}\n", skill_dir));
            removed += 1;
        }
        if removed > 0 {
            io.out(&format!("\nUnpinned '{}' from {} location(s).\n", command, removed));
            io.out(&format!("Use Impeccable's '{}' workflow directly to access it.\n", command));
        } else {
            io.out(&format!("No pinned '{}' shortcut found.\n", command));
        }
    }
    0
}
