//! #1235: a harness the user picks interactively is installed even when
//! another harness already has Impeccable. Detected only stays quiet about
//! a harness the user did not name.

use std::collections::HashMap;
use std::path::PathBuf;

use impeccable_common::Io;

const SKILL: &str = "---\nname: impeccable\nversion: 9.9.9-local\n---\n\nPicker fixture.\n";

struct Fixture {
    root: String,
    project: String,
    home: String,
    env: HashMap<String, String>,
}

fn temp_root(name: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("impeccable-{name}-{}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("temp root");
    let real = dir.canonicalize().unwrap().to_string_lossy().into_owned();
    real.strip_prefix(r"\\?\").map(str::to_string).unwrap_or(real)
}

fn write(path: &str, content: &str) {
    let p = std::path::Path::new(path);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, content).unwrap();
}

/// A project with a `.git` dir, an empty home, and a bundle with Claude, Codex and Cursor variants.
fn fixture(name: &str) -> Fixture {
    let root = temp_root(name);
    let (project, home, bundle) = (format!("{root}/project"), format!("{root}/home"), format!("{root}/bundle"));
    std::fs::create_dir_all(format!("{project}/.git")).unwrap();
    std::fs::create_dir_all(&home).unwrap();
    for provider in [".claude", ".agents", ".cursor"] {
        write(&format!("{bundle}/{provider}/skills/impeccable/SKILL.md"), SKILL);
    }
    let mut env = HashMap::new();
    // A fixture home has to name both or the verb writes into the real profile.
    env.insert("HOME".to_string(), home.clone());
    env.insert("USERPROFILE".to_string(), home.clone());
    env.insert("TMPDIR".to_string(), root.clone());
    env.insert("TEMP".to_string(), root.clone());
    env.insert("IMPECCABLE_BUNDLE_PATH".to_string(), bundle);
    Fixture { root, project, home, env }
}

fn seed_install(base: &str, provider: &str) {
    write(&format!("{base}/{provider}/skills/impeccable/SKILL.md"), SKILL);
}

/// Runs `install --no-hooks` with `stdin` as the piped (non-TTY) prompt answers.
fn run_install(fx: &Fixture, stdin: &str) -> (i32, String) {
    let argv = vec!["install".to_string(), "--no-hooks".to_string()];
    let (mut io, captured) = Io::captured(stdin, PathBuf::from(&fx.project), fx.env.clone());
    let code = impeccable_skills::run(&argv, &mut io);
    drop(io);
    let stdout = String::from_utf8_lossy(&captured.stdout.borrow()).into_owned();
    (code, stdout)
}

fn exists(path: &str) -> bool {
    std::path::Path::new(path).exists()
}

#[test]
fn customize_installs_a_picked_provider_when_another_is_installed() {
    let fx = fixture("picker-customize");
    seed_install(&fx.project, ".claude");
    let (code, stdout) = run_install(&fx, "customize\ncodex\nproject\n");
    assert_eq!(code, 0, "{stdout}");
    assert!(!stdout.contains("Skills are up to date"), "{stdout}");
    assert!(exists(&format!("{}/.agents/skills/impeccable/SKILL.md", fx.project)), "{stdout}");
    std::fs::remove_dir_all(&fx.root).ok();
}

#[test]
fn customize_mixed_selection_installs_the_missing_provider() {
    let fx = fixture("picker-mixed");
    seed_install(&fx.project, ".claude");
    let (code, stdout) = run_install(&fx, "customize\nclaude,codex\nproject\n");
    assert_eq!(code, 0, "{stdout}");
    assert!(stdout.contains("Installed impeccable into: .agents (project)"), "{stdout}");
    assert!(exists(&format!("{}/.agents/skills/impeccable/SKILL.md", fx.project)), "{stdout}");
    std::fs::remove_dir_all(&fx.root).ok();
}

#[test]
fn direct_picker_installs_a_picked_provider_when_another_is_installed() {
    let fx = fixture("picker-direct");
    seed_install(&fx.home, ".agents");
    let (code, stdout) = run_install(&fx, "claude\nglobal\n");
    assert_eq!(code, 0, "{stdout}");
    assert!(exists(&format!("{}/.claude/skills/impeccable/SKILL.md", fx.home)), "{stdout}");
    std::fs::remove_dir_all(&fx.root).ok();
}

#[test]
fn detected_only_leaves_a_detected_provider_without_an_install_alone() {
    let fx = fixture("picker-detected");
    seed_install(&fx.project, ".claude");
    std::fs::create_dir_all(format!("{}/.cursor", fx.project)).unwrap();
    let (code, stdout) = run_install(&fx, "detected\nproject\n");
    assert_eq!(code, 0, "{stdout}");
    assert!(stdout.contains("Skills are up to date"), "{stdout}");
    assert!(!exists(&format!("{}/.cursor/skills/impeccable", fx.project)), "{stdout}");
    std::fs::remove_dir_all(&fx.root).ok();
}
