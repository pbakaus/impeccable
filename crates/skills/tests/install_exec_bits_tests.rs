//! Regression: `impeccable install` from a staged zip must produce an
//! executable launcher and engine binary (rollout review B2: zip extraction
//! and the dir copy dropped file modes, so every hook and Setup call died
//! with "Permission denied", exit 126).

#![cfg(unix)]

use std::collections::HashMap;
use std::io::Write as _;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;

use impeccable_common::Io;
use impeccable_skills::engine_binary::platform_tag;

fn temp_root(name: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("impeccable-{name}-{}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("temp root");
    dir.to_string_lossy().into_owned()
}

fn mode_of(path: &str) -> u32 {
    std::fs::metadata(path).expect(path).permissions().mode()
}

/// Build a universal-bundle-shaped zip. The launcher entry deliberately
/// carries a zeroed unix mode (what a zip built without unix modes looks
/// like) to exercise the extractor's 0755 default; the engine binary entry
/// carries 0755 to exercise mode preservation.
fn stage_bundle_zip(path: &str, os: &str, arch: &str) {
    let file = std::fs::File::create(path).expect("zip file");
    let mut zip = zip::ZipWriter::new(file);
    let plain = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Stored);
    let modeless = plain.unix_permissions(0);
    let exec = plain.unix_permissions(0o755);

    zip.start_file(".claude/skills/impeccable/SKILL.md", plain).unwrap();
    zip.write_all(b"---\nname: impeccable\n---\n# impeccable\n").unwrap();
    zip.start_file(".claude/skills/impeccable/scripts/impeccable", modeless).unwrap();
    zip.write_all(b"#!/bin/sh\nexit 0\n").unwrap();
    zip.start_file(".claude/skills/impeccable/scripts/impeccable.cmd", plain).unwrap();
    zip.write_all(b"@echo off\r\n").unwrap();
    zip.start_file(".claude/skills/impeccable/scripts/VERSION", plain).unwrap();
    zip.write_all(b"9.9.9-exec-test\n").unwrap();
    // A staged engine binary: its presence keeps install_engine_binaries off
    // the network, and its exec bit must survive extraction + copy.
    zip.start_file(
        format!(".claude/skills/impeccable/scripts/bin/{os}-{arch}/impeccable"),
        exec,
    )
    .unwrap();
    zip.write_all(b"#!/bin/sh\nexit 0\n").unwrap();
    zip.finish().unwrap();
}

#[test]
fn install_from_staged_zip_yields_executable_launcher_and_binary() {
    let Some((os, arch)) = platform_tag() else { return };
    let root = temp_root("exec-bits");
    let project = format!("{root}/project");
    let home = format!("{root}/home");
    let tmp = format!("{root}/tmp");
    for d in [&project, &home, &tmp] {
        std::fs::create_dir_all(d).unwrap();
    }
    std::fs::create_dir_all(format!("{project}/.git")).unwrap();
    let zip_path = format!("{root}/bundle.zip");
    stage_bundle_zip(&zip_path, os, arch);

    let mut env: HashMap<String, String> = HashMap::new();
    env.insert("HOME".into(), home.clone());
    env.insert("TMPDIR".into(), tmp.clone());
    env.insert("IMPECCABLE_BUNDLE_PATH".into(), zip_path.clone());
    let (mut io, captured) = Io::captured("", PathBuf::from(&project), env);
    let code = impeccable_skills::run(
        &[
            "install".into(),
            "-y".into(),
            "--providers=claude".into(),
            "--scope=project".into(),
            "--no-hooks".into(),
        ],
        &mut io,
    );
    let stdout = String::from_utf8_lossy(&captured.stdout.borrow()).into_owned();
    let stderr = String::from_utf8_lossy(&captured.stderr.borrow()).into_owned();
    assert_eq!(code, 0, "install failed.\nstdout:\n{stdout}\nstderr:\n{stderr}");

    let launcher = format!("{project}/.claude/skills/impeccable/scripts/impeccable");
    let binary = format!("{project}/.claude/skills/impeccable/scripts/bin/{os}-{arch}/impeccable");
    assert!(
        mode_of(&launcher) & 0o111 != 0,
        "installed launcher is not executable: mode {:o}",
        mode_of(&launcher)
    );
    assert!(
        mode_of(&binary) & 0o111 != 0,
        "installed engine binary is not executable: mode {:o}",
        mode_of(&binary)
    );
    // The non-executable payload files stay non-executable.
    let skill_md = format!("{project}/.claude/skills/impeccable/SKILL.md");
    assert_eq!(mode_of(&skill_md) & 0o111, 0, "SKILL.md gained an exec bit");

    std::fs::remove_dir_all(&root).ok();
}

/// The extractor itself must already produce the right modes (before the
/// belt-and-suspenders chmod that install/update/link add on top): stored
/// modes are honored, and a mode-less launcher / bin entry defaults to 0755.
#[test]
fn extract_zip_applies_modes_and_launcher_default() {
    let Some((os, arch)) = platform_tag() else { return };
    let root = temp_root("extract-modes");
    let zip_path = format!("{root}/bundle.zip");
    stage_bundle_zip(&zip_path, os, arch);
    let out = format!("{root}/out");
    let bytes = std::fs::read(&zip_path).unwrap();
    impeccable_skills::bundle::extract_zip(&bytes, &out, &root).expect("extract");

    let launcher = format!("{out}/.claude/skills/impeccable/scripts/impeccable");
    let binary = format!("{out}/.claude/skills/impeccable/scripts/bin/{os}-{arch}/impeccable");
    let skill_md = format!("{out}/.claude/skills/impeccable/SKILL.md");
    assert!(mode_of(&launcher) & 0o111 != 0, "mode-less launcher entry did not default to executable");
    assert!(mode_of(&binary) & 0o111 != 0, "0755 zip mode was not applied to the engine binary");
    assert_eq!(mode_of(&skill_md) & 0o111, 0, "SKILL.md gained an exec bit");

    std::fs::remove_dir_all(&root).ok();
}
