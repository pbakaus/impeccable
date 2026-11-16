//! Registering the browser relay with Chrome (REN-2053): the launcher and each present browser's host manifest.
#![cfg(unix)]
use impeccable_mcp::host_setup::{register, HOST_NAME};
use serde_json::Value;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;

fn temp(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("imp-hostsetup-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn chrome_root(user: &Path) -> PathBuf {
    if cfg!(target_os = "macos") { user.join("Library/Application Support/Google/Chrome") } else { user.join(".config/google-chrome") }
}

/// A fake engine at `<home>/bin/<v>/impeccable` that prints its version and arguments. `stamp`: "ok", "none",
/// "size" (a stamp whose size differs) or "older" (the binary is newer than its stamp).
fn engine(home: &Path, v: &str, stamp: &str) {
    let dir = home.join("bin").join(v);
    std::fs::create_dir_all(&dir).unwrap();
    let bin = dir.join("impeccable");
    let body = format!("#!/bin/sh\necho \"{v} $*\"\n");
    let verified = dir.join("impeccable.verified");
    let size = if stamp == "size" { body.len() + 1 } else { body.len() };
    if stamp == "older" {
        std::fs::write(&verified, format!("abc {size}\n")).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(1100));
    }
    std::fs::write(&bin, &body).unwrap();
    std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
    if stamp == "ok" || stamp == "size" {
        std::thread::sleep(std::time::Duration::from_millis(1100));
        std::fs::write(&verified, format!("abc {size}\n")).unwrap();
    }
}

// Catches a manifest Chrome can't use (wrong path, origin or name), a manifest written where no browser is, another
// program's host of the same name overwritten, and lines printed when nothing changed.
#[test]
fn registers_with_present_browsers_and_leaves_anothers_host_alone() {
    let user = temp("reg");
    let home = user.join(".impeccable");
    std::fs::create_dir_all(chrome_root(&user)).unwrap();
    let lines = register(&user, &home);
    assert_eq!(lines.len(), 1, "{lines:?}");
    assert!(lines[0].contains("Chrome"));
    let manifest: Value = serde_json::from_str(&std::fs::read_to_string(chrome_root(&user).join(format!("NativeMessagingHosts/{HOST_NAME}.json"))).unwrap()).unwrap();
    assert_eq!(manifest["path"], home.join("browser/host").to_string_lossy().as_ref());
    assert_eq!(manifest["allowed_origins"][0], "chrome-extension://bdkgmiklpdmaojlpflclinlofgjfpabf/");
    assert_eq!(manifest["type"], "stdio");
    let mode = std::fs::metadata(home.join("browser/host")).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o700);
    // Nothing for a browser that isn't there; nothing printed the second time.
    let other = if cfg!(target_os = "macos") { user.join("Library/Application Support/Chromium") } else { user.join(".config/chromium") };
    assert!(!other.exists());
    assert!(register(&user, &home).is_empty());

    // Another program's host of the same name stays as it was.
    let edge = if cfg!(target_os = "macos") { user.join("Library/Application Support/Microsoft Edge") } else { user.join(".config/microsoft-edge") };
    let theirs = edge.join(format!("NativeMessagingHosts/{HOST_NAME}.json"));
    std::fs::create_dir_all(theirs.parent().unwrap()).unwrap();
    std::fs::write(&theirs, r#"{"path":"/elsewhere","allowed_origins":["chrome-extension://x/"]}"#).unwrap();
    let lines = register(&user, &home);
    assert!(lines.iter().any(|l| l.contains("left it as it is")), "{lines:?}");
    assert!(std::fs::read_to_string(&theirs).unwrap().contains("/elsewhere"));
    let _ = std::fs::remove_dir_all(user);
}

// Catches the launcher running an engine that isn't verified (no stamp, a size that differs, a binary newer than its
// stamp), picking versions by text instead of number, losing its arguments, and failing without saying why.
#[test]
fn the_launcher_runs_the_newest_verified_engine() {
    let user = temp("launch");
    let home = user.join(".impeccable");
    register(&user, &home);
    let run = |args: &[&str]| Command::new(home.join("browser/host")).args(args).env_clear().output().unwrap();

    let none = run(&["x"]);
    assert_eq!(none.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&none.stderr).contains("no verified engine"));

    engine(&home, "1.9.0", "ok");
    engine(&home, "1.10.0", "ok"); // numerically newest verified; text order would pick 1.9.0
    engine(&home, "1.11.0", "none");
    engine(&home, "1.12.0", "size");
    engine(&home, "1.13.0", "older");
    let out = run(&["chrome-extension://abc/", "two"]);
    assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "1.10.0 chrome-extension://abc/ two");
    let _ = std::fs::remove_dir_all(user);
}
