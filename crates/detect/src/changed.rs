//! `impeccable detect --changed`: the UI files git reports as changed in the
//! working tree, so an agent with no design hook can run the detector over
//! its own work without listing the files from memory.
//!
//! The set is what a directory scan of cwd would walk (scannable extensions,
//! `detector.extensions`, the walker's skipped directories), narrowed to
//! tracked files modified against HEAD (staged or unstaged) and untracked
//! files git does not ignore, minus generated paths. Paths come back relative
//! to cwd, so the scan reports them as if they had been typed.

use std::process::{Command, Stdio};

use crate::config::ExtensionEntry;
use crate::file_system::{
    has_scannable_extension_with, is_generated_path, HIDDEN_SOURCE_DIRS, SKIP_DIRS,
};
use crate::jsp;

/// Not inside a git work tree, or git could not run.
pub const NOT_A_REPO: &str = "Error: --changed reads the changed files from git, and this directory is not inside a git work tree. Pass the files or directories to scan instead.\n";

/// The exit status for [`NOT_A_REPO`]: an operational failure, like a target that cannot be read. Exit 2 stays reserved for findings.
pub const NOT_A_REPO_EXIT: i32 = 1;

fn git(cwd: &str, args: &[&str]) -> Option<Vec<u8>> {
    let mut cmd = Command::new("git");
    cmd.arg("--no-optional-locks")
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    impeccable_common::proc::hide_window(&mut cmd);
    let out = cmd.output().ok()?;
    out.status.success().then_some(out.stdout)
}

/// The changed UI files under `cwd`, relative to it, sorted by path.
/// `None` when `cwd` is not inside a git work tree.
pub fn changed_ui_files(cwd: &str, extensions: &[ExtensionEntry]) -> Option<Vec<String>> {
    // `--show-prefix` is cwd's path inside the work tree ("" at the top,
    // "apps/web/" below it); it fails outside one and inside `.git`.
    let prefix = git(cwd, &["rev-parse", "--is-inside-work-tree", "--show-prefix"])?;
    let prefix = String::from_utf8_lossy(&prefix).into_owned();
    let mut lines = prefix.lines();
    if lines.next() != Some("true") {
        return None;
    }
    let prefix = lines.next().unwrap_or("").to_string();
    // Porcelain paths are relative to the work tree root whatever cwd is; the
    // `.` pathspec keeps the listing to cwd's subtree.
    let status = git(
        cwd,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."],
    )?;
    let status = String::from_utf8_lossy(&status).into_owned();
    let mut fields = status.split('\0');
    let mut out: Vec<String> = Vec::new();
    while let Some(entry) = fields.next() {
        if entry.len() < 4 {
            continue;
        }
        let (code, path) = entry.split_at(3);
        let code = code.as_bytes();
        // A rename or copy carries its source path as the next field; the
        // entry's own path is the new one.
        if matches!(code[0], b'R' | b'C') || matches!(code[1], b'R' | b'C') {
            fields.next();
        }
        let Some(rel) = path.strip_prefix(prefix.as_str()) else {
            continue;
        };
        if keep(rel, cwd, extensions) && !out.iter().any(|p| p == rel) {
            out.push(rel.to_string());
        }
    }
    // Porcelain lists tracked changes before untracked files; one path
    // order reads better and matches a directory walk.
    out.sort();
    Some(out)
}

/// Whether a directory scan of cwd would scan `rel`, it is not a generated
/// path, and it is a regular file on disk (which drops deletions, modified
/// submodules and nested repositories without decoding status letters).
fn keep(rel: &str, cwd: &str, extensions: &[ExtensionEntry]) -> bool {
    let parts: Vec<&str> = rel.split('/').collect();
    let Some((name, dirs)) = parts.split_last() else {
        return false;
    };
    let skipped_dir = dirs.iter().any(|d| {
        SKIP_DIRS.contains(d) || (d.starts_with('.') && !HIDDEN_SOURCE_DIRS.contains(d))
    });
    if skipped_dir || !has_scannable_extension_with(name, extensions) {
        return false;
    }
    // Leading slash so a directory name only matches inside cwd, never in
    // the path above it.
    if is_generated_path(&format!("/{rel}")) {
        return false;
    }
    std::fs::metadata(jsp::resolve(cwd, &[rel]))
        .map(|m| m.is_file())
        .unwrap_or(false)
}
