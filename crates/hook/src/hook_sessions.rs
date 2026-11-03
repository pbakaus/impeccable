//! Which project roots a session's per-edit pass wrote a hook cache in, so
//! the Stop pass can find them from a session cwd above the projects (#1101).
//!
//! The per-edit pass keys its cache to the edited file's nearest project root.
//! A Stop event names no file, and walking up from the session cwd misses a
//! project below it: a session started in `~/code` that edits `~/code/app`.
//! So the first time a session writes a root's cache, the per-edit pass also
//! records that root here:
//!
//! `~/.impeccable/hook-sessions/<sha256(session id)>/<sha256(root)>`
//!
//! The file holds the root path. One file per (session, root) means writers
//! never read-modify-write a shared list, so parallel first edits each land
//! once (`create_new`, and losing that race is success). The Stop pass lists
//! the session's dir and keeps an entry only when its content hashes back to
//! its name, which drops partial writes and anything that is not ours.
//!
//! The directories get the same checks as the claim dirs (`hook_claim`): a
//! real directory, not a symlink, owned by the current user with no group or
//! other write bit on Unix, created 0700 one level at a time. Every failure
//! fails open: nothing is recorded, and Stop falls back to the walk up.
//!
//! Cost per edit: two hashes and one `lstat` once the root is recorded. The
//! first edit of a root in a session adds a few `lstat`s, a `create_dir` and
//! a `create_new`. A new session's first record sweeps session dirs untouched
//! for [`EXPIRE_SECONDS`]: it reads the root once, looks at no more than
//! [`SWEEP_SCAN_LIMIT`] entries and removes no more than
//! [`SWEEP_REMOVE_LIMIT`] dirs. It removes only `<64 hex>` dirs, and in them
//! only `<64 hex>` regular files, then the dir if that left it empty.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use crate::hook_claim::{private_file_mode, ensure_safe_dir, is_claim_name, is_safe_dir, safe_user_dir, sha256_hex, user_dir};
use crate::hook_lib::Runtime;

const OVERRIDE_ENV: &str = "IMPECCABLE_HOOK_SESSION_DIR";
const DIR_NAME: &str = "hook-sessions";

/// A session dir no edit has added a root to for this long is removed. A
/// live session can run for days, so this is generous; a session past it
/// that edits a new root records again, and Stop's walk up still runs.
pub const EXPIRE_SECONDS: u64 = 30 * 24 * 60 * 60;
/// Entries one sweep looks at, and session dirs one sweep removes.
pub const SWEEP_SCAN_LIMIT: usize = 256;
pub const SWEEP_REMOVE_LIMIT: usize = 16;
/// Roots one Stop pass reads from the index.
pub const MAX_ROOTS: usize = 16;
/// A recorded path longer than this is not ours.
const MAX_ENTRY_BYTES: u64 = 4096;

fn index_dir(rt: &Runtime) -> Option<PathBuf> {
    user_dir(rt, OVERRIDE_ENV, DIR_NAME)
}

/// Records that `session`'s per-edit pass wrote the hook cache under `root`.
/// A no-op once recorded, and on any failure.
pub fn record_root(rt: &Runtime, session: &str, root: &str) {
    if session.is_empty() || root.is_empty() || !Path::new(root).is_absolute() {
        return;
    }
    let Some(base) = index_dir(rt) else { return };
    let session_name = sha256_hex(session);
    let file = base.join(&session_name).join(sha256_hex(root));
    // Recorded on an earlier edit: the common case, one lstat.
    if std::fs::symlink_metadata(&file).is_ok() {
        return;
    }
    let Some(base) = safe_user_dir(base) else { return };
    let dir = base.join(&session_name);
    let Some(created) = ensure_safe_dir(&dir) else { return };
    if created {
        sweep_expired(&base, &session_name);
    }
    // `create_new` is O_CREAT|O_EXCL: it never follows a symlink at the path,
    // and a parallel first edit that got there first has already recorded it.
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create_new(true);
    private_file_mode(&mut opts);
    if let Ok(mut f) = opts.open(&file) {
        if f.write_all(root.as_bytes()).is_err() {
            // Ours, and unreadable as a record: remove it so the next edit retries.
            drop(f);
            let _ = std::fs::remove_file(&file);
        }
    }
}

/// The roots recorded for `session`, sorted, at most [`MAX_ROOTS`]. Empty
/// when there is no index, or it is not a safe directory.
pub fn recorded_roots(rt: &Runtime, session: &str) -> Vec<String> {
    if session.is_empty() {
        return vec![];
    }
    let Some(base) = index_dir(rt) else { return vec![] };
    let dir = base.join(sha256_hex(session));
    for d in [&base, &dir] {
        match std::fs::symlink_metadata(d) {
            Ok(meta) if is_safe_dir(&meta) => {}
            _ => return vec![],
        }
    }
    let Ok(entries) = std::fs::read_dir(&dir) else { return vec![] };
    let mut roots: Vec<String> = Vec::new();
    for entry in entries.flatten().take(SWEEP_SCAN_LIMIT) {
        let name = entry.file_name();
        let Some(name) = name.to_str().filter(|n| is_claim_name(n)) else { continue };
        // `DirEntry::file_type` does not follow symlinks.
        if !entry.file_type().is_ok_and(|t| t.is_file()) {
            continue;
        }
        let Some(root) = read_entry(&entry.path()) else { continue };
        // A root that is gone (a deleted project, a test's temp dir) never
        // takes one of the [`MAX_ROOTS`] places.
        if sha256_hex(&root) == name && Path::new(&root).is_absolute() && Path::new(&root).is_dir() && !roots.contains(&root) {
            roots.push(root);
        }
    }
    roots.sort();
    roots.truncate(MAX_ROOTS);
    roots
}

fn read_entry(path: &Path) -> Option<String> {
    let f = std::fs::File::open(path).ok()?;
    let mut buf = String::new();
    f.take(MAX_ENTRY_BYTES + 1).read_to_string(&mut buf).ok()?;
    (!buf.is_empty() && buf.len() as u64 <= MAX_ENTRY_BYTES).then_some(buf)
}

/// Removes session dirs whose mtime is older than [`EXPIRE_SECONDS`]. Runs
/// only when this invocation created a session dir, so it is paid once per
/// session. Only safe `<64 hex>` dirs are touched, and in them only
/// `<64 hex>` regular files; a dir holding anything else is left in place.
fn sweep_expired(base: &Path, keep: &str) {
    let Some(cutoff) = SystemTime::now().checked_sub(Duration::from_secs(EXPIRE_SECONDS)) else { return };
    let Ok(entries) = std::fs::read_dir(base) else { return };
    let mut removed = 0usize;
    for entry in entries.flatten().take(SWEEP_SCAN_LIMIT) {
        if removed >= SWEEP_REMOVE_LIMIT {
            break;
        }
        let name = entry.file_name();
        let Some(name) = name.to_str().filter(|n| is_claim_name(n) && *n != keep) else { continue };
        let dir = base.join(name);
        let Ok(meta) = std::fs::symlink_metadata(&dir) else { continue };
        if !is_safe_dir(&meta) || meta.modified().map_or(true, |m| m > cutoff) {
            continue;
        }
        let Ok(files) = std::fs::read_dir(&dir) else { continue };
        for file in files.flatten().take(SWEEP_SCAN_LIMIT) {
            let ok_name = file.file_name().to_str().is_some_and(is_claim_name);
            if ok_name && file.file_type().is_ok_and(|t| t.is_file()) {
                let _ = std::fs::remove_file(file.path());
            }
        }
        if std::fs::remove_dir(&dir).is_ok() {
            removed += 1;
        }
    }
}
