//! Detection coverage for env-relocated global harness dirs: `$DSH_HOME`
//! (DeepSeek Harness) must be detected even when `~/.dsh` itself does not
//! exist, and must be ignored when it points outside home. A project
//! `.replit` file labels the shared `.agents` detection as Replit Agent.

use std::collections::HashMap;

use impeccable_skills::providers::{Scope, Sys};
use impeccable_common::jsp;

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

fn sys_with(home: &str, extra: &[(&str, &str)]) -> Sys {
    let mut env: HashMap<String, String> = HashMap::new();
    env.insert("HOME".into(), home.to_string());
    env.insert("USERPROFILE".into(), home.to_string());
    for (k, v) in extra {
        env.insert((*k).to_string(), (*v).to_string());
    }
    Sys::new(env, home.to_string())
}

fn dsh_detections(sys: &Sys, root: &str) -> Vec<String> {
    sys.collect_install_detections(root)
        .into_iter()
        .filter(|d| d.provider == ".dsh" && d.scope == Scope::User)
        .map(|d| d.found_path)
        .collect()
}

#[test]
fn dsh_home_only_setup_is_detected() {
    let home = temp_root("dsh-home-detect");
    let project = temp_root("dsh-home-project");
    let dsh_home = jsp::join(&[&home, "custom-dsh"]);
    std::fs::create_dir_all(&dsh_home).unwrap();
    let sys = sys_with(&home, &[("DSH_HOME", &dsh_home)]);

    let found = dsh_detections(&sys, &project);
    assert_eq!(found, vec![dsh_home.clone()]);
}

#[test]
fn default_dot_dsh_is_detected_without_env() {
    let home = temp_root("dsh-default-detect");
    let project = temp_root("dsh-default-project");
    std::fs::create_dir_all(jsp::join(&[&home, ".dsh"])).unwrap();
    let sys = sys_with(&home, &[]);

    let found = dsh_detections(&sys, &project);
    assert_eq!(found, vec![jsp::join(&[&home, ".dsh"])]);
}

#[test]
fn dsh_home_outside_home_falls_back_to_dot_dsh() {
    let home = temp_root("dsh-outside-detect");
    let project = temp_root("dsh-outside-project");
    let outside = temp_root("dsh-outside-elsewhere");
    std::fs::create_dir_all(&outside).unwrap();
    let sys = sys_with(&home, &[("DSH_HOME", &outside)]);

    // No ~/.dsh and the env override is refused: not detected.
    assert!(dsh_detections(&sys, &project).is_empty());

    // With ~/.dsh present the fallback detects the default location.
    std::fs::create_dir_all(jsp::join(&[&home, ".dsh"])).unwrap();
    let found = dsh_detections(&sys, &project);
    assert_eq!(found, vec![jsp::join(&[&home, ".dsh"])]);
}

#[test]
fn devin_config_dir_only_setup_is_detected() {
    let home = temp_root("devin-config-detect");
    let project = temp_root("devin-config-project");
    let devin_dir = jsp::join(&[&home, ".config", "devin"]);
    std::fs::create_dir_all(&devin_dir).unwrap();
    let sys = sys_with(&home, &[]);

    let found: Vec<String> = sys
        .collect_install_detections(&project)
        .into_iter()
        .filter(|d| d.provider == ".devin" && d.scope == Scope::User)
        .map(|d| d.found_path)
        .collect();
    assert_eq!(found, vec![devin_dir]);
}

#[test]
fn opencode_config_dir_only_setup_is_detected() {
    let home = temp_root("opencode-config-detect");
    let project = temp_root("opencode-config-project");
    let opencode_dir = jsp::join(&[&home, ".config", "opencode"]);
    std::fs::create_dir_all(&opencode_dir).unwrap();
    let sys = sys_with(&home, &[]);

    let found: Vec<String> = sys
        .collect_install_detections(&project)
        .into_iter()
        .filter(|d| d.provider == ".opencode" && d.scope == Scope::User)
        .map(|d| d.found_path)
        .collect();
    assert_eq!(found, vec![opencode_dir]);
}

fn agents_project_detections(sys: &Sys, root: &str) -> Vec<impeccable_skills::providers::Detection> {
    sys.collect_install_detections(root)
        .into_iter()
        .filter(|d| d.provider == ".agents" && d.scope == Scope::Project)
        .collect()
}

#[test]
fn replit_file_alone_detects_agents_as_replit() {
    let home = temp_root("replit-alone-home");
    let project = temp_root("replit-alone-project");
    std::fs::write(jsp::join(&[&project, ".replit"]), "run = \"npm start\"\n").unwrap();
    let found = agents_project_detections(&sys_with(&home, &[]), &project);

    assert_eq!(found.len(), 1);
    assert_eq!(found[0].harness, "replit");
    assert_eq!(found[0].label(), "Replit Agent");
    assert_eq!(found[0].found_path, jsp::join(&[&project, ".replit"]));
    assert!(!found[0].has_real_skills);
}

#[test]
fn replit_file_claims_the_agents_dir_detection() {
    let home = temp_root("replit-agents-home");
    let project = temp_root("replit-agents-project");
    std::fs::write(jsp::join(&[&project, ".replit"]), "").unwrap();
    let skill_dir = jsp::join(&[&project, ".agents", "skills", "impeccable"]);
    std::fs::create_dir_all(&skill_dir).unwrap();
    std::fs::write(jsp::join(&[&skill_dir, "SKILL.md"]), "---\nname: impeccable\n---\n").unwrap();
    let found = agents_project_detections(&sys_with(&home, &[]), &project);

    assert_eq!(found.len(), 1);
    assert_eq!(found[0].label(), "Replit Agent");
    assert!(found[0].has_real_skills);
    assert!(!found.iter().any(|d| d.harness == "codex"));
}

#[test]
fn agents_dir_without_replit_stays_codex() {
    let home = temp_root("codex-agents-home");
    let project = temp_root("codex-agents-project");
    let sys = sys_with(&home, &[]);
    assert!(agents_project_detections(&sys, &project).is_empty());

    std::fs::create_dir_all(jsp::join(&[&project, ".agents"])).unwrap();
    let found = agents_project_detections(&sys, &project);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].label(), "Codex CLI");
    assert_eq!(found[0].found_path, jsp::join(&[&project, ".agents"]));
}

#[test]
fn replit_project_with_codex_user_hint_keeps_both_and_preselects_replit() {
    let home = temp_root("replit-codex-home");
    let project = jsp::join(&[&home, "workspace"]);
    std::fs::create_dir_all(jsp::join(&[&home, ".codex"])).unwrap();
    std::fs::create_dir_all(&project).unwrap();
    std::fs::write(jsp::join(&[&project, ".replit"]), "").unwrap();
    let detections = sys_with(&home, &[]).collect_install_detections(&project);

    let agents: Vec<(Scope, &str)> = detections
        .iter()
        .filter(|d| d.provider == ".agents")
        .map(|d| (d.scope, d.label()))
        .collect();
    assert_eq!(agents, vec![(Scope::Project, "Replit Agent"), (Scope::User, "Codex CLI")]);
    let defaults = impeccable_skills::providers::default_detections(&detections);
    assert_eq!(defaults.iter().map(|d| d.harness).collect::<Vec<_>>(), vec!["replit"]);
}
