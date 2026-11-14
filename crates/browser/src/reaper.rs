//! Reaps the browsers this process launched when it is ended by SIGINT or
//! SIGTERM (issue #1418).
//!
//! [`crate::cdp::Browser`]'s `Drop` kills Chrome and removes its profile, but
//! a signal's default action ends the process before any `Drop` runs, so an
//! interrupted URL scan left Chrome running under PID 1 with its
//! `impeccable_dev_chrome_profile-*` directory. Every launched browser is
//! recorded here; on the first launch a handler is installed for each of the two
//! signals that still has its default action (a verb that
//! called `impeccable_common::proc::on_interrupt` unwinds through `Drop` on
//! its own). The handler only writes the signal number to a pipe, which is
//! async-signal-safe; a thread reading that pipe kills each browser's process
//! group, removes its profile, restores the default action and re-raises the
//! signal, so the exit status is the one the signal would have given.
//!
//! Unix only: on Windows, Ctrl-C is a console event that already reaches
//! Chrome in the same console, and the signal path there is not covered.

use std::path::PathBuf;
use std::sync::Mutex;

static LAUNCHED: Mutex<Vec<(u32, PathBuf)>> = Mutex::new(Vec::new());

/// Record a browser this process launched (`pid` leads its own process
/// group) and make sure the signal path is armed.
pub(crate) fn register(pid: u32, user_data_dir: PathBuf) {
    if let Ok(mut list) = LAUNCHED.lock() {
        list.push((pid, user_data_dir));
    }
    #[cfg(unix)]
    unix::arm();
}

/// Forget a browser that was closed or dropped normally.
pub(crate) fn unregister(pid: u32) {
    if let Ok(mut list) = LAUNCHED.lock() {
        list.retain(|(p, _)| *p != pid);
    }
}

#[cfg(unix)]
mod unix {
    use super::LAUNCHED;
    use std::sync::atomic::{AtomicI32, Ordering};
    use std::sync::Once;

    static ARM: Once = Once::new();
    static WRITE_FD: AtomicI32 = AtomicI32::new(-1);

    extern "C" fn on_signal(sig: libc::c_int) {
        let fd = WRITE_FD.load(Ordering::SeqCst);
        if fd >= 0 {
            let byte = sig as u8;
            // SAFETY: write(2) is async-signal-safe; a full pipe drops the byte.
            unsafe { libc::write(fd, &byte as *const u8 as *const libc::c_void, 1) };
        }
    }

    /// Whether `sig` still has its default disposition.
    fn is_default(sig: libc::c_int) -> bool {
        // SAFETY: a query-only sigaction call with a zeroed out-parameter.
        unsafe {
            let mut old: libc::sigaction = std::mem::zeroed();
            libc::sigaction(sig, std::ptr::null(), &mut old) == 0 && old.sa_sigaction == libc::SIG_DFL
        }
    }

    pub(super) fn arm() {
        ARM.call_once(|| {
            // Arm each signal still at its default action. One a verb has
            // claimed is left to it; one inherited as ignored (a background
            // job's SIGINT) stays ignored.
            let signals: Vec<libc::c_int> = [libc::SIGINT, libc::SIGTERM].into_iter().filter(|s| is_default(*s)).collect();
            if signals.is_empty() {
                return;
            }
            let mut fds = [0 as libc::c_int; 2];
            // SAFETY: pipe(2) fills both descriptors on success.
            if unsafe { libc::pipe(fds.as_mut_ptr()) } != 0 {
                return;
            }
            let (read_fd, write_fd) = (fds[0], fds[1]);
            // SAFETY: the write end is never read; non-blocking keeps the
            // handler from stalling on a full pipe.
            unsafe {
                let flags = libc::fcntl(write_fd, libc::F_GETFL);
                libc::fcntl(write_fd, libc::F_SETFL, flags | libc::O_NONBLOCK);
            }
            WRITE_FD.store(write_fd, Ordering::SeqCst);
            let spawned = std::thread::Builder::new()
                .name("impeccable-browser-reaper".into())
                .spawn(move || {
                    let mut byte = 0u8;
                    loop {
                        // SAFETY: reads one byte into a local buffer.
                        let n = unsafe { libc::read(read_fd, &mut byte as *mut u8 as *mut libc::c_void, 1) };
                        if n == 1 {
                            break;
                        }
                        if n < 0 && std::io::Error::last_os_error().kind() == std::io::ErrorKind::Interrupted {
                            continue;
                        }
                        return;
                    }
                    reap_and_reraise(byte as libc::c_int);
                });
            if spawned.is_err() {
                return;
            }
            // SAFETY: `on_signal` only performs async-signal-safe work.
            for sig in signals {
                unsafe { libc::signal(sig, on_signal as *const () as libc::sighandler_t) };
            }
        });
    }

    fn reap_and_reraise(sig: libc::c_int) {
        let browsers = LAUNCHED.lock().map(|l| l.clone()).unwrap_or_default();
        for (pid, _) in &browsers {
            // SAFETY: signals the process group this browser leads.
            unsafe { libc::kill(-(*pid as libc::pid_t), libc::SIGKILL) };
        }
        for (pid, dir) in &browsers {
            // SAFETY: reaps the direct child so its profile files are closed.
            unsafe { libc::waitpid(*pid as libc::pid_t, std::ptr::null_mut(), 0) };
            let _ = std::fs::remove_dir_all(dir);
        }
        // SAFETY: restore the default action and deliver the signal again.
        unsafe {
            libc::signal(sig, libc::SIG_DFL);
            libc::raise(sig);
        }
        std::process::exit(128 + sig);
    }
}
