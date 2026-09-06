//! Detection coverage for env-relocated global harness dirs: `$DSH_HOME`
//! (DeepSeek Harness) must be detected even when `~/.dsh` itself does not
//! exist, and must be ignored when it points outside home.

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
