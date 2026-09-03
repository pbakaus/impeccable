//! Port of `tests/copy-provider-commands.test.js` (upstream 9736a9f6, #483):
//! the OpenCode command bridge the installer writes, and the command
//! awareness `isUpToDate` gained so a drifted or missing bridge is not
//! reported as current.

use std::collections::HashMap;

use impeccable_skills::bundle::{copy_provider_commands, is_up_to_date};
use impeccable_skills::providers::{Scope, Sys};

fn temp_root(name: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("impeccable-{name}-{}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("temp root");
    dir.canonicalize().unwrap().to_string_lossy().into_owned()
}

fn write(path: &str, content: &str) {
    let p = std::path::Path::new(path);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, content).unwrap();
}

fn exists(path: &str) -> bool {
    std::path::Path::new(path).exists()
}

fn sys_with(home: &str, extra: &[(&str, &str)]) -> Sys {
    let mut env: HashMap<String, String> = HashMap::new();
    env.insert("HOME".into(), home.to_string());
    env.insert("USERPROFILE".into(), home.to_string());
    for (k, v) in extra {
        env.insert((*k).to_string(), (*v).to_string());
    }
    Sys::new(env, home.to_string())
}

/// JS: setupBundleWithCommand(bundleDir, providerName, commandNames)
fn bundle_with_commands(bundle: &str, provider: &str, names: &[&str]) {
    for name in names {
        write(
            &format!("{bundle}/{provider}/commands/{name}.md"),
            &format!("description: Impeccable {name} bridge\nagent: build\nsubtask: true\n\nbody {name}\n"),
        );
    }
}

fn bundle_with_skill(bundle: &str, provider: &str, body: &str) {
    write(&format!("{bundle}/{provider}/skills/impeccable/SKILL.md"), body);
}

#[test]
fn writes_commands_to_project_config_dir_by_default() {
    let root = temp_root("cmd-project");
    let bundle = format!("{root}/bundle");
    let project = format!("{root}/project");
    std::fs::create_dir_all(&project).unwrap();
    bundle_with_commands(&bundle, ".opencode", &["impeccable"]);
    let sys = sys_with(&root, &[]);

    let written = copy_provider_commands(&sys, &bundle, &project, &["opencode"], Some(Scope::Project));
    assert_eq!(written, 1);
    let dest = format!("{project}/.opencode/commands/impeccable.md");
    assert!(exists(&dest));
    assert!(std::fs::read_to_string(&dest).unwrap().contains("impeccable bridge"));
}

#[test]
fn user_scope_resolves_the_config_dir_opencode_scans() {
    // Default: <home>/.config/opencode/commands.
    let root = temp_root("cmd-user");
    let bundle = format!("{root}/bundle");
    let home = format!("{root}/home");
    std::fs::create_dir_all(&home).unwrap();
    bundle_with_commands(&bundle, ".opencode", &["impeccable"]);
    let sys = sys_with(&home, &[]);
    assert_eq!(
        copy_provider_commands(&sys, &bundle, &home, &["opencode"], Some(Scope::User)),
        1
    );
    assert!(exists(&format!("{home}/.config/opencode/commands/impeccable.md")));

    // OPENCODE_CONFIG_DIR wins, and the default location stays untouched.
    let root = temp_root("cmd-user-env");
    let bundle = format!("{root}/bundle");
    let home = format!("{root}/home");
    let custom = format!("{root}/custom");
    std::fs::create_dir_all(&home).unwrap();
    std::fs::create_dir_all(&custom).unwrap();
    bundle_with_commands(&bundle, ".opencode", &["impeccable"]);
    let sys = sys_with(&home, &[("OPENCODE_CONFIG_DIR", &custom)]);
    assert_eq!(
        copy_provider_commands(&sys, &bundle, &home, &["opencode"], Some(Scope::User)),
        1
    );
    assert!(exists(&format!("{custom}/commands/impeccable.md")));
    assert!(!exists(&format!("{home}/.config/opencode/commands")));

    // XDG_CONFIG_HOME/opencode when OPENCODE_CONFIG_DIR is unset.
    let root = temp_root("cmd-user-xdg");
    let bundle = format!("{root}/bundle");
    let home = format!("{root}/home");
    let xdg = format!("{root}/xdg");
    std::fs::create_dir_all(&home).unwrap();
    std::fs::create_dir_all(&xdg).unwrap();
    bundle_with_commands(&bundle, ".opencode", &["impeccable"]);
    let sys = sys_with(&home, &[("XDG_CONFIG_HOME", &xdg)]);
    assert_eq!(
        copy_provider_commands(&sys, &bundle, &home, &["opencode"], Some(Scope::User)),
        1
    );
    assert!(exists(&format!("{xdg}/opencode/commands/impeccable.md")));
}

#[test]
fn migrates_legacy_global_commands_without_disturbing_siblings() {
    let root = temp_root("cmd-migrate");
    let bundle = format!("{root}/bundle");
    let home = format!("{root}/home");
    bundle_with_commands(&bundle, ".opencode", &["impeccable"]);
    write(&format!("{home}/.opencode/commands/impeccable.md"), "stale\n");
    write(&format!("{home}/.opencode/commands/mine.md"), "keep me\n");
    let sys = sys_with(&home, &[]);

    assert_eq!(
        copy_provider_commands(&sys, &bundle, &home, &["opencode"], Some(Scope::User)),
        1
    );
    assert!(exists(&format!("{home}/.config/opencode/commands/impeccable.md")));
    // The stranded copy loses only what was just written.
    assert!(!exists(&format!("{home}/.opencode/commands/impeccable.md")));
    assert!(exists(&format!("{home}/.opencode/commands/mine.md")));
}

#[test]
fn a_home_rooted_git_repo_is_a_project_install_and_is_left_alone() {
    let root = temp_root("cmd-git");
    let bundle = format!("{root}/bundle");
    let home = format!("{root}/home");
    bundle_with_commands(&bundle, ".opencode", &["impeccable"]);
    write(&format!("{home}/.opencode/commands/impeccable.md"), "project copy\n");
    std::fs::create_dir_all(format!("{home}/.git")).unwrap();
    let sys = sys_with(&home, &[]);

    copy_provider_commands(&sys, &bundle, &home, &["opencode"], Some(Scope::User));
    assert!(exists(&format!("{home}/.opencode/commands/impeccable.md")));
}

#[test]
fn a_provider_without_a_commands_dir_writes_nothing() {
    let root = temp_root("cmd-none");
    let bundle = format!("{root}/bundle");
    let project = format!("{root}/project");
    std::fs::create_dir_all(&project).unwrap();
    bundle_with_skill(&bundle, ".claude", "---\nname: impeccable\n---\n");
    let sys = sys_with(&root, &[]);
    assert_eq!(
        copy_provider_commands(&sys, &bundle, &project, &["claude"], Some(Scope::Project)),
        0
    );
    assert!(!exists(&format!("{project}/.claude/commands")));
}

#[test]
fn is_up_to_date_tracks_the_command_bridge() {
    let root = temp_root("cmd-fresh");
    let bundle = format!("{root}/bundle");
    let project = format!("{root}/project");
    let skill = "---\nname: impeccable\nversion: 1.0.0\n---\n";
    bundle_with_skill(&bundle, ".opencode", skill);
    bundle_with_commands(&bundle, ".opencode", &["impeccable"]);
    write(&format!("{project}/.opencode/skills/impeccable/SKILL.md"), skill);
    let sys = sys_with(&root, &[]);

    // Skills match but the bridge is missing.
    assert!(!is_up_to_date(&sys, &project, &[".opencode"], &bundle, Some(Scope::Project), Some(Scope::Project)).unwrap());

    // Bridge in place and identical.
    copy_provider_commands(&sys, &bundle, &project, &["opencode"], Some(Scope::Project));
    assert!(is_up_to_date(&sys, &project, &[".opencode"], &bundle, Some(Scope::Project), Some(Scope::Project)).unwrap());

    // Drifted content is not current.
    write(&format!("{project}/.opencode/commands/impeccable.md"), "drifted\n");
    assert!(!is_up_to_date(&sys, &project, &[".opencode"], &bundle, Some(Scope::Project), Some(Scope::Project)).unwrap());

    // A local-only command (a pinned shortcut) does not affect freshness.
    copy_provider_commands(&sys, &bundle, &project, &["opencode"], Some(Scope::Project));
    write(&format!("{project}/.opencode/commands/impeccable-polish.md"), "pinned\n");
    assert!(is_up_to_date(&sys, &project, &[".opencode"], &bundle, Some(Scope::Project), Some(Scope::Project)).unwrap());
}
