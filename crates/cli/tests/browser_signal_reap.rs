//! Issue #1418: a URL scan ended by SIGTERM or SIGINT must not leave Chrome
//! or its temporary profile behind.
#![cfg(unix)]

use std::os::unix::process::ExitStatusExt;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

fn profiles(dir: &Path) -> Vec<std::path::PathBuf> {
    std::fs::read_dir(dir)
        .map(|it| {
            it.filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| {
                    p.file_name()
                        .and_then(|n| n.to_str())
                        .is_some_and(|n| n.starts_with("impeccable_dev_chrome_profile-"))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn helpers_alive(dir: &Path) -> usize {
    let out = Command::new("pgrep")
        .args(["-f", &dir.to_string_lossy()])
        .output()
        .expect("pgrep");
    String::from_utf8_lossy(&out.stdout).lines().count()
}

fn scan_then_signal(sig: libc::c_int) {
    // A server that accepts and never answers keeps the scan mid-navigation.
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let tmp = std::env::temp_dir().join(format!("impeccable-reap-{}-{sig}", std::process::id()));
    std::fs::create_dir_all(&tmp).unwrap();
    let mut child = Command::new(env!("CARGO_BIN_EXE_impeccable"))
        .args(["detect", &format!("http://127.0.0.1:{port}/")])
        .env("TMPDIR", format!("{}/", tmp.display()))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let started = Instant::now();
    while profiles(&tmp).is_empty() {
        assert!(started.elapsed() < Duration::from_secs(60), "the scan never launched a browser");
        std::thread::sleep(Duration::from_millis(100));
    }
    // Let Chrome start its helper processes.
    std::thread::sleep(Duration::from_secs(2));
    unsafe { libc::kill(child.id() as libc::pid_t, sig) };
    let status = child.wait().unwrap();
    assert_eq!(status.signal(), Some(sig), "{status:?}");
    std::thread::sleep(Duration::from_secs(1));
    let left = profiles(&tmp);
    let alive = helpers_alive(&tmp);
    let _ = std::fs::remove_dir_all(&tmp);
    drop(listener);
    assert!(left.is_empty(), "profiles left: {left:?}");
    assert_eq!(alive, 0, "browser processes left running");
}

#[test]
fn sigterm_reaps_the_browser_and_its_profile() {
    scan_then_signal(libc::SIGTERM);
}

#[test]
fn sigint_reaps_the_browser_and_its_profile() {
    scan_then_signal(libc::SIGINT);
}
