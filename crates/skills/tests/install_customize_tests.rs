//! Customize must install a harness the user names even when another harness
//! already has Impeccable (#1235). Piped answers are the non-TTY form of the
//! same Customize branch the radio menu takes; both set `explicit` so missing
//! targets are detected the way `--providers` is.

use std::collections::HashMap;
use std::path::PathBuf;

use impeccable_common::Io;

struct Fx {
    root: String,
    project: String,
    env: HashMap<String, String>,
}

impl Drop for Fx {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.root).ok();
    }
}

struct Run {
    code: i32,
    stdout: String,
    stderr: String,
}

fn write(path: &str, body: &str) {
    let p = std::path::Path::new(path);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

/// Project already has Claude. The local bundle can install Codex (`.agents`).
fn fixture(name: &str) -> Fx {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let root = std::env::temp_dir().join(format!("impeccable-{name}-{}-{nanos}", std::process::id())).to_string_lossy().into_owned();
    let project = format!("{root}/project");
    let home = format!("{root}/home");
    let tmp = format!("{root}/tmp");
    let bundle = format!("{root}/bundle");
    for dir in [&project, &home, &tmp] {
        std::fs::create_dir_all(dir).unwrap();
    }
    std::fs::create_dir_all(format!("{project}/.git")).unwrap();
    write(
        &format!("{project}/.claude/skills/impeccable/SKILL.md"),
        "---\nname: impeccable\nversion: 4.8.0\n---\nclaude-already-installed\n",
    );
    write(
        &format!("{bundle}/.agents/skills/impeccable/SKILL.md"),
        "---\nname: impeccable\nversion: 4.8.0\n---\ncodex-from-customize\n",
    );
    let env = [
        ("HOME", home.as_str()),
        ("USERPROFILE", home.as_str()),
        ("TMPDIR", tmp.as_str()),
        ("TEMP", tmp.as_str()),
        ("IMPECCABLE_BUNDLE_PATH", bundle.as_str()),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .collect();
    Fx { root, project, env }
}

fn install(fx: &Fx, stdin: &str) -> Run {
    let (mut io, captured) = Io::captured(stdin, PathBuf::from(&fx.project), fx.env.clone());
    let args: Vec<String> = ["install", "--no-hooks"].map(String::from).into();
    let code = impeccable_skills::run(&args, &mut io);
    drop(io);
    let stdout = String::from_utf8_lossy(&captured.stdout.borrow()).into_owned();
    let stderr = String::from_utf8_lossy(&captured.stderr.borrow()).into_owned();
    Run { code, stdout, stderr }
}

fn agents_skill(fx: &Fx) -> String {
    format!("{}/.agents/skills/impeccable/SKILL.md", fx.project)
}

fn claude_skill(fx: &Fx) -> String {
    format!("{}/.claude/skills/impeccable/SKILL.md", fx.project)
}

/// The reported case: Customize, then Codex only, while Claude is installed.
#[test]
fn customize_installs_a_selected_provider_another_already_has() {
    let fx = fixture("customize-codex-only");
    let run = install(&fx, "customize\ncodex\nproject\n");
    assert_eq!(run.code, 0, "stdout:\n{}\nstderr:\n{}", run.stdout, run.stderr);
    assert!(
        run.stdout.contains("Installed impeccable into: .agents (project)"),
        "stdout:\n{}\nstderr:\n{}",
        run.stdout,
        run.stderr
    );
    assert!(!run.stdout.contains("Skills are up to date"), "stdout:\n{}", run.stdout);
    let installed = std::fs::read_to_string(agents_skill(&fx)).unwrap_or_else(|e| panic!("codex skill missing: {e}\nstdout:\n{}", run.stdout));
    assert!(installed.contains("codex-from-customize"), "{installed}");
    let claude = std::fs::read_to_string(claude_skill(&fx)).unwrap();
    assert!(claude.contains("claude-already-installed"), "{claude}");
}

/// Customize that keeps the installed harness and adds another: the missing
/// one is copied from inside the already-installed branch.
#[test]
fn customize_installs_only_the_missing_provider_from_a_mixed_selection() {
    let fx = fixture("customize-mixed");
    let run = install(&fx, "customize\nclaude,codex\nproject\n");
    assert_eq!(run.code, 0, "stdout:\n{}\nstderr:\n{}", run.stdout, run.stderr);
    assert!(run.stdout.contains("Impeccable skills are already installed (found in .claude/)."), "stdout:\n{}", run.stdout);
    assert!(
        run.stdout.contains("Installed impeccable into: .agents (project)"),
        "stdout:\n{}\nstderr:\n{}",
        run.stdout,
        run.stderr
    );
    assert!(!run.stdout.contains("Skills are up to date"), "stdout:\n{}", run.stdout);
    let installed = std::fs::read_to_string(agents_skill(&fx)).unwrap_or_else(|e| panic!("codex skill missing: {e}\nstdout:\n{}", run.stdout));
    assert!(installed.contains("codex-from-customize"), "{installed}");
    let claude = std::fs::read_to_string(claude_skill(&fx)).unwrap();
    assert!(claude.contains("claude-already-installed"), "{claude}");
}
