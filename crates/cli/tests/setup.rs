#[path = "../../account/tests/support/fake.rs"]
mod fake;
use fake::{browser, Fake};
use std::{
    collections::HashMap,
    path::Path,
    process::{Command, Stdio},
    time::Duration,
};

fn cmd(env: &HashMap<String, String>, args: &[&str]) -> Command {
    let mut c = Command::new(env!("CARGO_BIN_EXE_impeccable"));
    c.args(args)
        .env_clear()
        .envs(env)
        .current_dir(Path::new(&env["IMPECCABLE_HOME"]))
        .stdin(Stdio::null());
    c
}
fn signed_in(name: &str) -> (Fake, HashMap<String, String>) {
    let f = Fake::start();
    f.knobs.lock().unwrap().setup = true;
    let env = f.env(name);
    impeccable_account::login(&env, &mut |u| browser(u), Duration::from_secs(10)).unwrap();
    (f, env)
}
#[test]
fn normal_commands_schedule_silent_reports_and_hooks_never_do() {
    let (f, env) = signed_in("setup-cli-hooks");
    for args in [vec!["engine-probe"], vec!["hook-before-edit"], vec!["hook"]] {
        cmd(&env, &args).output().unwrap();
    }
    assert_eq!(f.hits("/cli/v1/setup/reports"), 0);
    let out = cmd(&env, &["doctor", "--json"]).output().unwrap();
    f.wait_for_hits("/cli/v1/setup/reports", 1);
    assert!(!String::from_utf8_lossy(&out.stderr).contains("Setup"));
    cmd(&env, &["doctor", "--json"]).output().unwrap();
    assert_eq!(f.hits("/cli/v1/setup/reports"), 1);
    assert!(cmd(&env, &["setup", "forget"])
        .output()
        .unwrap()
        .status
        .success());
    cmd(&env, &["doctor", "--json"]).output().unwrap();
    assert_eq!(f.hits("/cli/v1/setup/reports"), 1);
}
#[test]
fn network_wait_is_detached_and_offline_forget_never_claims_deletion() {
    let (f, env) = signed_in("setup-cli-detached");
    let gate = f.hold("/cli/v1/setup/reports");
    let start = std::time::Instant::now();
    cmd(&env, &["doctor", "--json"]).output().unwrap();
    assert!(start.elapsed() < Duration::from_secs(3));
    f.wait_for_hits("/cli/v1/setup/reports", 1);
    gate.open();
    // The next explicit command may race the worker's last write. Wait for
    // the worker to finish by retrying the local off operation, bounded.
    let until = std::time::Instant::now() + Duration::from_secs(5);
    loop {
        if cmd(&env, &["setup", "off"])
            .output()
            .unwrap()
            .status
            .success()
        {
            break;
        }
        assert!(std::time::Instant::now() < until);
        std::thread::yield_now();
    }
    f.knobs.lock().unwrap().setup = false;
    let out = cmd(&env, &["setup", "forget"]).output().unwrap();
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("couldn't be confirmed"));
    assert!(
        String::from_utf8_lossy(&cmd(&env, &["setup"]).output().unwrap().stdout).contains("off")
    );
}
