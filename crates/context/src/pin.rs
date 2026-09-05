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
pub const VALID_COMMANDS: [&str; 24] = [
    "craft", "init", "extract", "document", "shape", "critique", "audit", "polish", "bolder", "quieter", "distill",
    "harden", "onboard", "live", "animate", "colorize", "typeset", "layout", "delight", "overdrive", "clarify",
    "adapt", "optimize", "generate",
];
const PIN_MARKER: &str = "<!-- impeccable-pinned-skill -->";
const OPENCODE_PIN_MARKER: &str = "<!-- impeccable-pinned-command -->";

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

// OpenCode 1.18.10 does not honor `user-invocable: true` on SKILL.md
// frontmatter (see docs/HARNESSES.md), so a pinned skill there shows up in
// `opencode debug skill` but never in the slash menu. The fix is a sibling
// `commands/impeccable-<cmd>.md` on the OpenCode command schema. The body
// loads the skill, runs the context verb, then reads the sub-command's
// reference file, so `/impeccable-<cmd>` runs the same workflow
// `/impeccable <cmd>` routes to.
//
// JS: pin.mjs#generatePinnedOpencodeCommand. The JS body says
// `node <skill-base-dir>/scripts/context.mjs`; the engine names its own
// command, as everywhere else the launcher replaced a script path.
fn generate_pinned_opencode_command(command: &str, metadata: &serde_json::Value) -> String {
    let desc = metadata
        .get(command)
        .and_then(|e| e.get("description"))
        .and_then(|d| d.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            format!("Impeccable sub-command shortcut; runs the {command} workflow via /impeccable.")
        });
    format!(
        "---\ndescription: \"{desc}\"\nagent: build\nsubtask: true\n---\n\n{marker}\n\nLoad the `impeccable` skill via the skill tool (name: \"impeccable\"), then run `<skill-base-dir>/scripts/impeccable context`, then load `<skill-base-dir>/reference/{command}.md` and follow it. `<skill-base-dir>` is the skill's base directory as reported by the skill tool response; substitute the actual absolute path before running or reading anything.\n\n$ARGUMENTS\n",
        desc = desc,
        marker = OPENCODE_PIN_MARKER,
        command = command
    )
}

/// JS: pin.mjs#opencodeUserConfigDir. Mirrors the CLI's precedence
/// (`OPENCODE_CONFIG_DIR` -> `XDG_CONFIG_HOME/opencode` -> `~/.config/opencode`).
fn opencode_user_config_dir(io: &Io) -> String {
    if let Some(v) = io.env.get("OPENCODE_CONFIG_DIR").filter(|v| !v.is_empty()) {
        return v.clone();
    }
    if let Some(v) = io.env.get("XDG_CONFIG_HOME").filter(|v| !v.is_empty()) {
        return jsp::join(&[v, "opencode"]);
    }
    jsp::join(&[&crate::util::homedir(&io.env), ".config", "opencode"])
}

/// JS: pin.mjs#findOpencodeCommandsDirs. The project-local dir when the
/// project has the skill, plus the user config dir when Impeccable is
/// installed globally. With `for_cleanup`, both are included even when the
/// skill is gone, so unpin can still reach a pin a removed install left
/// behind; removal stays safe because it is marker-guarded.
fn find_opencode_commands_dirs(project_root: &str, io: &Io, for_cleanup: bool) -> Vec<String> {
    let mut dirs: Vec<String> = Vec::new();
    let mut push = |dir: String| {
        let key = jsp::resolve(&dir, &[]);
        if !dirs.iter().any(|d| jsp::resolve(d, &[]) == key) {
            dirs.push(dir);
        }
    };
    if for_cleanup || exists(&jsp::join(&[project_root, ".opencode", "skills", "impeccable"])) {
        push(jsp::join(&[project_root, ".opencode", "commands"]));
    }
    let user_config = opencode_user_config_dir(io);
    if for_cleanup || exists(&jsp::join(&[&user_config, "skills", "impeccable"])) {
        push(jsp::join(&[&user_config, "commands"]));
    }
    dirs
}

/// JS: pin.mjs#writePinnedOpencodeCommand
fn write_pinned_opencode_command(
    commands_dir: &str,
    command: &str,
    metadata: &serde_json::Value,
    io: &mut Io,
) -> bool {
    let command_file = jsp::join(&[commands_dir, &format!("impeccable-{command}.md")]);
    if exists(&command_file) {
        let existing = safe_read(&command_file).unwrap_or_default();
        if !existing.contains(OPENCODE_PIN_MARKER) {
            io.out(&format!(
                "  SKIP: {} (non-pinned command already exists)\n",
                command_file
            ));
            return false;
        }
    } else {
        let _ = std::fs::create_dir_all(commands_dir);
    }
    let _ = std::fs::write(&command_file, generate_pinned_opencode_command(command, metadata));
    io.out(&format!("  + {}\n", command_file));
    true
}

/// JS: pin.mjs#removePinnedOpencodeCommand
fn remove_pinned_opencode_command(commands_dir: &str, command: &str, io: &mut Io) -> bool {
    let command_file = jsp::join(&[commands_dir, &format!("impeccable-{command}.md")]);
    if !exists(&command_file) {
        return false;
    }
    let content = safe_read(&command_file).unwrap_or_default();
    if !content.contains(OPENCODE_PIN_MARKER) {
        io.out(&format!("  SKIP: {} (not a pinned command)\n", command_file));
        return false;
    }
    let _ = std::fs::remove_file(&command_file);
    io.out(&format!("  - {}\n", command_file));
    true
}

/// JS `skillsDir.includes(`${sep}.opencode${sep}`)`.
fn is_opencode_skills_dir(skills_dir: &str) -> bool {
    skills_dir.contains(&format!("{sep}.opencode{sep}", sep = jsp::SEP))
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
        let opencode_commands_dirs = find_opencode_commands_dirs(&root, io, false);
        if harness_dirs.is_empty() && opencode_commands_dirs.is_empty() {
            io.out("No harness directories with impeccable installed found.\n");
            return 0;
        }
        let mut created = 0;
        // OpenCode is handled separately below because its shortcut format is
        // a slash command, not a SKILL.md. Excluding it from the skill loop
        // prevents a duplicate `.opencode/skills/<cmd>/SKILL.md` that OpenCode
        // would never surface as `/<cmd>`.
        for skills_dir in &harness_dirs {
            if is_opencode_skills_dir(skills_dir) {
                continue;
            }
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
        // OpenCode: a slash command bridge, not a skill shortcut. Covers both
        // project installs and user-scope (global config) installs.
        for commands_dir in &opencode_commands_dirs {
            if write_pinned_opencode_command(commands_dir, &command, &metadata, io) {
                created += 1;
            }
        }
        if created > 0 {
            io.out(&format!("\nPinned '{}' as a standalone shortcut in {} location(s).\n", command, created));
            io.out("Use the pinned command directly in each harness.\n");
        }
    } else {
        let harness_dirs = find_harness_dirs(&root);
        let mut removed = 0;
        // OpenCode has its own cleanup path below; skip the skill loop here so
        // a stray `.opencode/skills/<cmd>/SKILL.md` written by an older
        // Impeccable version is never silently dropped.
        for skills_dir in &harness_dirs {
            if is_opencode_skills_dir(skills_dir) {
                continue;
            }
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
        // OpenCode: remove the pinned command file if it is one of ours, in
        // every scope it could have been written to, even when the skill
        // itself is gone, since removal is marker-guarded.
        for commands_dir in find_opencode_commands_dirs(&root, io, true) {
            if remove_pinned_opencode_command(&commands_dir, &command, io) {
                removed += 1;
            }
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
