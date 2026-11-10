//! Detached setup reporting worker. Only normal, explicit command entrypoints
//! schedule it; edit hooks and the worker itself cannot recurse.
use impeccable_common::Io;
use serde_json::{json, Value};
use std::process::{Command, Stdio};

pub fn schedule(io: &Io) {
    if !impeccable_account::setup::wanted(io) {
        return;
    }
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let mut cmd = Command::new(exe);
    cmd.arg("setup-report")
        .current_dir(&io.cwd)
        .envs(&io.env)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    impeccable_common::proc::detach(&mut cmd);
    let _ = cmd.spawn();
}

pub fn run(io: &Io) -> i32 {
    if !impeccable_account::setup::wanted(io) {
        return 0;
    }
    let (mut local, captured) = Io::captured("", io.cwd.clone(), io.env.clone());
    if impeccable_agents::run(&["list".into()], &mut local) != 0 {
        return 0;
    }
    let Ok(inventory) = serde_json::from_slice::<Value>(&captured.stdout.borrow()) else {
        return 0;
    };
    let mut skills = json!({});
    let home = impeccable_context::util::homedir(&io.env);
    for (h, dir) in [
        ("claude", ".claude"),
        ("codex", ".agents"),
        ("codex", ".codex"),
    ] {
        let mut env = io.env.clone();
        env.insert(
            "IMPECCABLE_SKILL_DIR".into(),
            format!("{home}/{dir}/skills/impeccable"),
        );
        if let Some(v) = impeccable_context::context_cli::installed_skill_version(
            &env,
            &io.cwd.to_string_lossy(),
        ) {
            skills[h] = v.into();
        }
    }
    let provider = impeccable_context::provider::detect(&io.env, &io.cwd.to_string_lossy());
    let harness = match provider.id.as_str() {
        "claude-code" => Some("claude"),
        "codex" | "agents" => Some("codex"),
        _ => None,
    };
    if let (Some(h), Some(v)) = (
        harness,
        impeccable_context::context_cli::installed_skill_version(
            &io.env,
            &io.cwd.to_string_lossy(),
        ),
    ) {
        skills[h] = v.into();
    }
    impeccable_account::setup::report(io, &inventory["result"], crate::VERSION, &skills);
    0
}
