//! Process helpers the JS got from Node for free and that differ per OS:
//! `process.kill(pid, 0)` liveness, `process.kill(pid)`, `spawn(...,
//! { detached: true })`, and `process.on('SIGINT' | 'SIGTERM')`.
//!
//! Unix uses libc; Windows declares the handful of kernel32 entry points it
//! needs directly so no windows-sys dependency is pulled into every crate.

use std::process::Command;
use std::sync::atomic::AtomicBool;

/// `process.kill(pid, 0)`: `Ok(())` when the process exists and can be
/// signalled, otherwise the errno name Node would report (`ESRCH` when there
/// is no such process, `EPERM` when it exists but is not ours, `EINVAL`
/// otherwise). Callers that only ask "is it alive?" should use
/// [`pid_reachable`].
pub fn kill0(pid: i64) -> Result<(), &'static str> {
    if pid <= 0 || pid > i32::MAX as i64 {
        return Err("ESRCH");
    }
    #[cfg(unix)]
    {
        let rc = unsafe { libc::kill(pid as libc::pid_t, 0) };
        if rc == 0 {
            return Ok(());
        }
        match std::io::Error::last_os_error().raw_os_error() {
            Some(libc::EPERM) => Err("EPERM"),
            Some(libc::ESRCH) => Err("ESRCH"),
            _ => Err("EINVAL"),
        }
    }
    #[cfg(windows)]
    {
        // libuv's uv_kill(pid, 0): OpenProcess + GetExitCodeProcess, alive
        // only while the exit code is STILL_ACTIVE. Access denied maps to
        // EPERM (the process exists), everything else to ESRCH.
        use win::*;
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid as u32);
            if h.is_null() {
                return match GetLastError() {
                    ERROR_ACCESS_DENIED => Err("EPERM"),
                    _ => Err("ESRCH"),
                };
            }
            let mut code: u32 = 0;
            let ok = GetExitCodeProcess(h, &mut code);
            CloseHandle(h);
            if ok != 0 && code == STILL_ACTIVE {
                Ok(())
            } else {
                Err("ESRCH")
            }
        }
    }
    #[cfg(not(any(unix, windows)))]
    {
        Err("ESRCH")
    }
}

/// `isLiveServerPidReachable(pid)` and friends: alive unless ESRCH (an EPERM
/// process is somebody else's, but it is there).
pub fn pid_reachable(pid: i64) -> bool {
    match kill0(pid) {
        Ok(()) => true,
        Err(code) => code != "ESRCH",
    }
}

/// `process.kill(pid)` (SIGTERM). On Windows Node terminates the process
/// outright; so does this. Errors are ignored, as every JS call site wraps
/// the call in `try {} catch {}`.
pub fn terminate(pid: i64) {
    if pid <= 0 || pid > i32::MAX as i64 {
        return;
    }
    #[cfg(unix)]
    unsafe {
        libc::kill(pid as libc::pid_t, libc::SIGTERM);
    }
    #[cfg(windows)]
    unsafe {
        use win::*;
        let h = OpenProcess(PROCESS_TERMINATE, 0, pid as u32);
        if !h.is_null() {
            TerminateProcess(h, 1);
            CloseHandle(h);
        }
    }
}

/// `spawn(cmd, args, { detached: true })` + `child.unref()`: the child
/// survives us. Unix: `setsid()` (its own session, so a terminal SIGHUP or a
/// harness killing our process group does not take it down). Windows:
/// `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP`, which is what libuv sets for
/// `detached` and also means the child gets no console window of its own.
pub fn detach(cmd: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // SAFETY: setsid is async-signal-safe and touches no shared state.
        unsafe {
            cmd.pre_exec(|| {
                libc::setsid();
                Ok(())
            });
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(win::DETACHED_PROCESS | win::CREATE_NEW_PROCESS_GROUP);
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = cmd;
    }
}

/// `spawn(cmd, args, { windowsHide: true })` for short-lived helpers
/// (`node --check`, `where`, `git`): on Windows a GUI-launched parent would
/// otherwise flash a console window per child. No effect elsewhere.
pub fn hide_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(win::CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = cmd;
    }
}

/// `process.on('SIGINT', h); process.on('SIGTERM', h)` where the handler
/// only flips a flag the main loop polls. Unix installs signal handlers (and
/// ignores SIGPIPE, so a client that vanished mid-write does not kill a
/// server). Windows registers a console control handler: Ctrl-C, Ctrl-Break,
/// and console close all set the flag, matching what Node surfaces as
/// SIGINT / SIGBREAK / SIGHUP there. Only one flag can be registered per
/// process; later calls replace the earlier one.
pub fn on_interrupt(flag: &'static AtomicBool) {
    FLAG.store(
        flag as *const AtomicBool as *mut AtomicBool,
        std::sync::atomic::Ordering::SeqCst,
    );
    #[cfg(unix)]
    unsafe {
        libc::signal(
            libc::SIGINT,
            unix_on_signal as *const () as libc::sighandler_t,
        );
        libc::signal(
            libc::SIGTERM,
            unix_on_signal as *const () as libc::sighandler_t,
        );
        libc::signal(libc::SIGPIPE, libc::SIG_IGN);
    }
    #[cfg(windows)]
    unsafe {
        win::SetConsoleCtrlHandler(Some(win_ctrl_handler), 1);
    }
}

static FLAG: std::sync::atomic::AtomicPtr<AtomicBool> =
    std::sync::atomic::AtomicPtr::new(std::ptr::null_mut());

fn set_flag() {
    let p = FLAG.load(std::sync::atomic::Ordering::SeqCst);
    if !p.is_null() {
        // SAFETY: the pointer came from a `&'static AtomicBool`.
        unsafe { (*p).store(true, std::sync::atomic::Ordering::SeqCst) };
    }
}

#[cfg(unix)]
extern "C" fn unix_on_signal(_sig: libc::c_int) {
    set_flag();
}

#[cfg(windows)]
unsafe extern "system" fn win_ctrl_handler(_ctrl_type: u32) -> i32 {
    set_flag();
    // Handled: keep the process alive so the main loop can shut down
    // cleanly (Node's SIGINT listener has the same effect).
    1
}

/// `SIGINT`/`SIGTERM` names for a child's exit signal. Windows children have
/// no signal; the JS saw `null` there and so does the caller.
pub fn signal_name(sig: i32) -> String {
    #[cfg(unix)]
    {
        match sig {
            libc::SIGINT => "SIGINT".into(),
            libc::SIGTERM => "SIGTERM".into(),
            libc::SIGKILL => "SIGKILL".into(),
            libc::SIGHUP => "SIGHUP".into(),
            libc::SIGABRT => "SIGABRT".into(),
            libc::SIGSEGV => "SIGSEGV".into(),
            libc::SIGPIPE => "SIGPIPE".into(),
            _ => format!("SIG{}", sig),
        }
    }
    #[cfg(not(unix))]
    {
        format!("SIG{}", sig)
    }
}

/// The name Node's `child_process` resolves for a bare command on this OS:
/// `node` is `node.exe` on Windows, and a `spawn('sh')` there would fail, so
/// [`shell`] hands back `cmd.exe /d /s /c` the way `spawn(..., { shell: true })`
/// does.
pub fn node_exe() -> &'static str {
    if cfg!(windows) {
        "node.exe"
    } else {
        "node"
    }
}

/// `spawnSync(script, { shell: true })`: `/bin/sh -c <script>` on unix,
/// `%ComSpec% /d /s /c "<script>"` on Windows (Node's own choice of shell
/// and flags for the `shell: true` option).
pub fn shell(script: &str, comspec: Option<&str>) -> Command {
    if cfg!(windows) {
        let mut c = Command::new(comspec.unwrap_or("cmd.exe"));
        // Node passes the whole `/d /s /c "script"` as one command line so
        // cmd.exe's own quoting rules apply; `raw_arg` does the same.
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            c.raw_arg(format!("/d /s /c \"{}\"", script));
        }
        #[cfg(not(windows))]
        {
            c.args(["/d", "/s", "/c", script]);
        }
        c
    } else {
        let mut c = Command::new("/bin/sh");
        c.arg("-c").arg(script);
        c
    }
}

/// `which <tool>` / `where <tool>` (Node scripts pick by platform): does the
/// probe exit 0? Windows `where` is a console tool, so hide its window.
pub fn tool_on_path(tool: &str) -> bool {
    let probe = if cfg!(windows) { "where" } else { "which" };
    let mut cmd = Command::new(probe);
    cmd.arg(tool)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    hide_window(&mut cmd);
    cmd.status().map(|s| s.success()).unwrap_or(false)
}

#[cfg(windows)]
mod win {
    #![allow(non_snake_case, non_camel_case_types, clippy::upper_case_acronyms)]
    pub type HANDLE = *mut core::ffi::c_void;
    pub const PROCESS_TERMINATE: u32 = 0x0001;
    pub const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    pub const STILL_ACTIVE: u32 = 259;
    pub const ERROR_ACCESS_DENIED: u32 = 5;
    pub const DETACHED_PROCESS: u32 = 0x0000_0008;
    pub const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    pub type PHANDLER_ROUTINE = Option<unsafe extern "system" fn(ctrl_type: u32) -> i32>;
    #[link(name = "kernel32")]
    extern "system" {
        pub fn OpenProcess(desired_access: u32, inherit: i32, pid: u32) -> HANDLE;
        pub fn GetExitCodeProcess(h: HANDLE, code: *mut u32) -> i32;
        pub fn TerminateProcess(h: HANDLE, exit_code: u32) -> i32;
        pub fn CloseHandle(h: HANDLE) -> i32;
        pub fn GetLastError() -> u32;
        pub fn SetConsoleCtrlHandler(handler: PHANDLER_ROUTINE, add: i32) -> i32;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn own_pid_is_alive_and_bogus_pid_is_not() {
        assert_eq!(kill0(std::process::id() as i64), Ok(()));
        assert!(pid_reachable(std::process::id() as i64));
        assert_eq!(kill0(0), Err("ESRCH"));
        assert_eq!(kill0(-1), Err("ESRCH"));
        assert_eq!(kill0(i64::MAX), Err("ESRCH"));
    }

    #[test]
    fn shell_runs_a_script() {
        let out = shell("echo hi", None).output().expect("shell spawns");
        assert!(String::from_utf8_lossy(&out.stdout)
            .trim_end()
            .ends_with("hi"));
    }

    #[test]
    fn detached_child_spawns() {
        let mut cmd = Command::new(if cfg!(windows) { "cmd.exe" } else { "true" });
        if cfg!(windows) {
            cmd.args(["/c", "exit 0"]);
        }
        cmd.stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        detach(&mut cmd);
        let mut child = cmd.spawn().expect("detached spawn");
        let _ = child.wait();
    }
}
