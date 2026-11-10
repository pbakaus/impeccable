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
    spawn_worker(&mut cmd);
}

#[cfg(not(windows))]
fn spawn_worker(cmd: &mut Command) {
    let _ = cmd.spawn();
}

#[cfg(windows)]
fn spawn_worker(cmd: &mut Command) {
    use std::ffi::c_void;
    use std::os::windows::io::AsRawHandle;
    #[link(name = "kernel32")]
    extern "system" {
        fn GetHandleInformation(handle: *mut c_void, flags: *mut u32) -> i32;
        fn SetHandleInformation(handle: *mut c_void, mask: u32, flags: u32) -> i32;
    }
    const INHERIT: u32 = 1;
    struct Restore(Vec<(*mut c_void, u32)>);
    impl Drop for Restore {
        fn drop(&mut self) {
            for &(handle, flags) in &self.0 {
                // SAFETY: borrowed standard handles remain owned by this process.
                unsafe {
                    SetHandleInformation(handle, INHERIT, flags & INHERIT);
                }
            }
        }
    }
    // Windows inherits *all* inheritable handles, including the command's
    // original output pipes even with Stdio::null configured for the child.
    // Such a pipe would hold the caller's output() open until the upload ends.
    // Temporarily remove inheritance from those originals; the worker gets
    // only its new null handles. Restore the flags on every exit path.
    let mut restore = Restore(Vec::new());
    for handle in [
        std::io::stdin().as_raw_handle(),
        std::io::stdout().as_raw_handle(),
        std::io::stderr().as_raw_handle(),
    ] {
        let mut flags = 0;
        // SAFETY: these are borrowed OS standard handles, never closed here.
        if unsafe { GetHandleInformation(handle, &mut flags) } == 0 {
            continue;
        }
        if flags & INHERIT == 0 {
            continue;
        }
        restore.0.push((handle, flags));
        if unsafe { SetHandleInformation(handle, INHERIT, 0) } == 0 {
            return;
        }
    }
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
