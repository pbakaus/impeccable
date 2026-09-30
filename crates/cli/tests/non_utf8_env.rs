#![cfg(unix)]

use std::ffi::OsString;
use std::os::unix::ffi::OsStringExt;
use std::path::PathBuf;
use std::process::Command;

fn command_with_non_utf8_env() -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_impeccable"));
    command.env("ABBR_TIPS_PROMPT", OsString::from_vec(vec![0xff]));
    command
}

#[test]
fn context_ignores_non_utf8_environment_values() {
    let output = command_with_non_utf8_env()
        .arg("context")
        .output()
        .expect("run context");

    assert!(
        output.status.success(),
        "context failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn detect_ignores_non_utf8_environment_values() {
    let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/antipatterns/radial-spotlight-glow.html");
    let output = command_with_non_utf8_env()
        .args(["detect", "--json", "--scope", "layout"])
        .arg(fixture)
        .output()
        .expect("run detect");

    assert!(
        output.status.success(),
        "detect failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}
