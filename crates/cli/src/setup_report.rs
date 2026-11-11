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
    let _ = spawn_worker(&mut cmd);
}

#[cfg(not(windows))]
fn spawn_worker(cmd: &mut Command) -> std::io::Result<std::process::Child> {
    cmd.spawn()
}

#[cfg(windows)]
fn spawn_worker(cmd: &mut Command) -> std::io::Result<std::process::Child> {
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
            return Err(std::io::Error::last_os_error());
        }
    }
    cmd.spawn()
}

pub fn run(io: &Io) -> i32 {
    let Some(attempt) = impeccable_account::setup::begin(io) else {
        return 0;
    };
    let Ok(exe) = std::env::current_exe() else {
        return 0;
    };
    let mut cmd = Command::new(exe);
    cmd.args(["agents", "list"])
        .current_dir(&io.cwd)
        .envs(&io.env);
    let Some(inventory) = inventory(cmd, io, std::time::Duration::from_secs(5)) else {
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
    attempt.report(io, &inventory["result"], crate::VERSION, &skills);
    0
}

/// Inventory probes may invoke harness CLIs. Bound the whole process tree,
/// with file-backed output so an inherited pipe cannot hold the worker open.
fn inventory(mut cmd: Command, io: &Io, timeout: std::time::Duration) -> Option<Value> {
    use std::io::{Read, Seek, SeekFrom};
    let home = impeccable_account::config::impeccable_home(&io.env)?;
    let path = home.join(format!(
        "setup-inventory-{}-{}.json",
        std::process::id(),
        impeccable_account::oauth::random_b64(12)
    ));
    struct Remove(std::path::PathBuf);
    impl Drop for Remove {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }
    let mut options = std::fs::OpenOptions::new();
    options.read(true).write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&path).ok()?;
    let _remove = Remove(path);
    cmd.stdin(Stdio::null())
        .stdout(file.try_clone().ok()?)
        .stderr(Stdio::null());
    impeccable_common::proc::detach(&mut cmd);
    let mut child = spawn_worker(&mut cmd).ok()?;
    let end = std::time::Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(Some(_)) => return None,
            Err(_) => {
                kill_inventory(&mut child);
                return None;
            }
            Ok(None) if std::time::Instant::now() < end => {
                std::thread::sleep(std::time::Duration::from_millis(10))
            }
            Ok(None) => {
                kill_inventory(&mut child);
                return None;
            }
        }
    }
    file.seek(SeekFrom::Start(0)).ok()?;
    let mut bytes = Vec::new();
    file.take(1024 * 1024 + 1).read_to_end(&mut bytes).ok()?;
    if bytes.len() > 1024 * 1024 {
        return None;
    }
    serde_json::from_slice(&bytes).ok()
}

fn kill_inventory(child: &mut std::process::Child) {
    #[cfg(unix)]
    unsafe {
        // Inventory starts its own session: include any hung MCP descendants.
        libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
    #[cfg(windows)]
    {
        let exe = std::env::var_os("SystemRoot")
            .map(|r| std::path::PathBuf::from(r).join("System32/taskkill.exe"))
            .unwrap_or_else(|| "taskkill.exe".into());
        let mut cmd = Command::new(exe);
        cmd.args(["/PID", &child.id().to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        impeccable_common::proc::hide_window(&mut cmd);
        if let Ok(mut killer) = cmd.spawn() {
            let end = std::time::Instant::now() + std::time::Duration::from_secs(2);
            while matches!(killer.try_wait(), Ok(None)) && std::time::Instant::now() < end {
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            let _ = killer.kill();
            let _ = killer.wait();
        }
    }
    if child.kill().is_ok() {
        let _ = child.wait();
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    #[test]
    fn inventory_deadline_kills_a_hung_probe_and_its_descendants() {
        let home = std::env::temp_dir().join(format!(
            "impeccable-inventory-deadline-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&home).unwrap();
        let sentinel = home.join("probe-finished");
        let _ = std::fs::remove_file(&sentinel);
        let env = std::collections::HashMap::from([(
            "IMPECCABLE_HOME".into(),
            home.to_string_lossy().into_owned(),
        )]);
        let (io, _) = Io::captured("", home.clone(), env);
        let mut command = Command::new("sh");
        command
            .args(["-c", "(sleep 1; touch \"$1\") & wait", "sh"])
            .arg(&sentinel);
        let start = std::time::Instant::now();
        assert!(inventory(command, &io, std::time::Duration::from_millis(100)).is_none());
        assert!(start.elapsed() < std::time::Duration::from_secs(1));
        std::thread::sleep(std::time::Duration::from_millis(1200));
        assert!(
            !sentinel.exists(),
            "a harness descendant survived the inventory deadline"
        );
        assert_eq!(
            std::fs::read_dir(&home).unwrap().count(),
            0,
            "temporary inventory output was removed"
        );
        let _ = std::fs::remove_dir(home);
    }
}
