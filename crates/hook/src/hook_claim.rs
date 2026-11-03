//! One scan per edit event, however many Impeccable hooks fire for it.
//!
//! A harness runs every hook entry it loads, so the same edit can reach the
//! `hook` verb more than once: a home manifest and a project manifest
//! (`~/.cursor/hooks.json` next to `.cursor/hooks.json`, the same for Codex),
//! a plugin's hooks next to a project hook, or a sub-project's hook next to
//! its parent's. Each copy would scan the file and hand the agent the same
//! findings again.
//!
//! The harnesses that serve the per-edit hook name each tool call: Claude
//! Code, Codex and Cursor put a `tool_use_id` on every post-tool event, and
//! every hook of that event receives the same one. The first invocation
//! atomically creates a claim file named by the hash of that identity; a
//! later invocation that finds the claim exits without scanning. An event
//! without a tool-call id is never claimed, so a harness that does not name
//! its calls keeps today's behavior rather than risk dropping a real second
//! edit.
//!
//! Claims live in a per-user directory, `~/.impeccable/hook-claims`, never in
//! the shared temp dir. Before anything is created there or removed from it,
//! the root and each bucket must be a real directory (not a symlink) that,
//! on Unix, the current user owns with no group or other write bit. The sweep
//! of old buckets is not recursive: it removes only `<digits>/` dirs, and in
//! them only `<64 hex>` regular files, then the dir itself if that left it
//! empty. Symlinks are never followed.
//!
//! Cost: one hash, a few `lstat`s, one `create_dir` and one `create_new` per
//! edit, plus a `read_dir` of the claim root (a handful of bucket dirs) when
//! a new ten-minute bucket starts. No directory walk.
//!
//! Every failure fails open: if the claim cannot be made or checked, or a
//! directory is not safe, the scan runs and nothing is deleted.

use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

use crate::hook_lib::Runtime;

/// Width of one claim bucket. Duplicate invocations of one event arrive within
/// the hook timeout (seconds), so a claim is checked in its own bucket and the
/// one before it, and buckets older than that are removed.
const BUCKET_SECONDS: u64 = 600;

/// The payload keys that carry a tool-call id, in the spellings the served
/// harnesses use.
const TOOL_CALL_ID_KEYS: &[&str] = &["tool_use_id", "toolUseId", "tool_call_id", "toolCallId"];

/// The session the call belongs to: Claude Code and Codex send `session_id`,
/// Cursor `conversation_id` (and `session_id`).
const SESSION_KEYS: &[&str] = &["session_id", "sessionId", "conversation_id"];

/// What happened to the claim for this invocation.
#[derive(Debug, PartialEq, Eq)]
pub enum Claim {
    /// This invocation owns the event, or the event has no identity, or the
    /// claim failed: scan.
    Scan,
    /// Another invocation already claimed this event: skip the scan.
    Duplicate,
}

fn non_empty_str<'a>(event: &'a Map<String, Value>, keys: &[&str]) -> Option<&'a str> {
    keys.iter().find_map(|k| event.get(*k).and_then(Value::as_str).filter(|s| !s.is_empty()))
}

/// The claim key for an event, or `None` when the payload names no tool call.
/// The project root and the scan targets are part of it, so two projects (or
/// two test fixtures) that happen to reuse an id never collide.
pub fn event_key(event: &Map<String, Value>, project_cwd: &str, files: &[String]) -> Option<String> {
    let call = non_empty_str(event, TOOL_CALL_ID_KEYS)?;
    let session = non_empty_str(event, SESSION_KEYS).unwrap_or("");
    let mut files: Vec<&str> = files.iter().map(String::as_str).collect();
    files.sort_unstable();
    let mut h = Sha256::new();
    for part in [session, call, project_cwd] {
        h.update(part.as_bytes());
        h.update([0u8]);
    }
    for f in files {
        h.update(f.as_bytes());
        h.update([0u8]);
    }
    Some(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// `IMPECCABLE_HOOK_CLAIM_DIR`, else `<home>/.impeccable/hook-claims`, with
/// home read from the hook's own environment (`HOME`, then `USERPROFILE`;
/// the other way round on Windows). `None` without a home: no claim.
fn claim_root(rt: &Runtime) -> Option<PathBuf> {
    user_dir(rt, "IMPECCABLE_HOOK_CLAIM_DIR", "hook-claims")
}

/// `$<override_env>` when set, else `<home>/.impeccable/<name>`, with home
/// read from the hook's own environment (`HOME`, then `USERPROFILE`; the
/// other way round on Windows). `None` without a home.
pub(crate) fn user_dir(rt: &Runtime, override_env: &str, name: &str) -> Option<PathBuf> {
    if let Some(dir) = rt.env(override_env).filter(|s| !s.is_empty()) {
        return Some(PathBuf::from(dir));
    }
    let order: [&str; 2] = if cfg!(windows) { ["USERPROFILE", "HOME"] } else { ["HOME", "USERPROFILE"] };
    let home = order.iter().find_map(|k| rt.env(k).filter(|s| !s.is_empty()))?;
    Some(Path::new(home).join(".impeccable").join(name))
}

/// Lowercase hex SHA-256 of `s`: a 64-character name that is safe on every
/// file system.
pub(crate) fn sha256_hex(s: &str) -> String {
    Sha256::digest(s.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

fn now_bucket() -> Option<u64> {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).ok()?.as_secs();
    Some(secs / BUCKET_SECONDS)
}

/// The current effective user, for the ownership check.
#[cfg(unix)]
fn current_uid() -> u32 {
    // SAFETY: geteuid has no preconditions and cannot fail.
    unsafe { libc::geteuid() }
}

/// A directory this invocation may create in and delete from: a real
/// directory (the metadata is `lstat`'s, so a symlink is never one), and on
/// Unix owned by the current user with no group or other write bit.
pub(crate) fn is_safe_dir(meta: &std::fs::Metadata) -> bool {
    if !meta.file_type().is_dir() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if meta.uid() != current_uid() || meta.mode() & 0o022 != 0 {
            return false;
        }
    }
    true
}

/// Creates one directory level, private to the user on Unix. Not recursive.
pub(crate) fn create_private_dir(path: &Path) -> std::io::Result<()> {
    let mut b = std::fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        b.mode(0o700);
    }
    b.create(path)
}

/// Makes a file `opts` creates private to the user on Unix.
pub(crate) fn private_file_mode(opts: &mut std::fs::OpenOptions) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    #[cfg(not(unix))]
    let _ = opts;
}

/// `Some(created)` when `path` is (now) a safe directory, `None` when it is
/// missing and could not be made, or is unsafe.
pub(crate) fn ensure_safe_dir(path: &Path) -> Option<bool> {
    let created = match create_private_dir(path) {
        Ok(()) => true,
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => false,
        Err(_) => return None,
    };
    let meta = std::fs::symlink_metadata(path).ok()?;
    is_safe_dir(&meta).then_some(created)
}

/// The claim root, created when missing (with its `.impeccable` parent, a
/// plain user dir) and checked; `None` when it is unusable or unsafe.
fn safe_root(rt: &Runtime) -> Option<PathBuf> {
    safe_user_dir(claim_root(rt)?)
}

/// `root`, created when missing (with its `.impeccable` parent, a plain user
/// dir) and checked; `None` when it is unusable or unsafe.
pub(crate) fn safe_user_dir(root: PathBuf) -> Option<PathBuf> {
    if std::fs::symlink_metadata(&root).is_err() {
        if let Some(parent) = root.parent() {
            // Two hooks of one first edit race to make it: losing that race
            // is fine, any other failure is not.
            match create_private_dir(parent) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(_) => return None,
            }
        }
    }
    ensure_safe_dir(&root)?;
    Some(root)
}

fn is_bucket_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 20 && name.bytes().all(|b| b.is_ascii_digit())
}

pub(crate) fn is_claim_name(name: &str) -> bool {
    name.len() == 64 && name.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// Removes buckets older than the previous one. Runs only when this
/// invocation created the current bucket, so it is paid once per bucket.
/// Only safe `<digits>` dirs are touched, and in them only `<64 hex>` regular
/// files; a bucket holding anything else is left in place.
fn sweep_old_buckets(root: &Path, bucket: u64) {
    let Ok(entries) = std::fs::read_dir(root) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str().filter(|n| is_bucket_name(n)) else { continue };
        let Ok(n) = name.parse::<u64>() else { continue };
        if n + 1 >= bucket {
            continue;
        }
        let dir = entry.path();
        let Ok(meta) = std::fs::symlink_metadata(&dir) else { continue };
        if !is_safe_dir(&meta) {
            continue;
        }
        let Ok(claims) = std::fs::read_dir(&dir) else { continue };
        for claim in claims.flatten() {
            let ok_name = claim.file_name().to_str().is_some_and(is_claim_name);
            let is_file = claim.file_type().is_ok_and(|t| t.is_file());
            if ok_name && is_file {
                let _ = std::fs::remove_file(claim.path());
            }
        }
        let _ = std::fs::remove_dir(&dir);
    }
}

/// True when `dir/key` exists as a claim file in a safe bucket.
fn holds_claim(dir: &Path, key: &str) -> bool {
    let Ok(meta) = std::fs::symlink_metadata(dir) else { return false };
    is_safe_dir(&meta) && std::fs::symlink_metadata(dir.join(key)).is_ok_and(|m| m.file_type().is_file())
}

/// Claims `key` for this invocation. `Duplicate` only when another
/// invocation provably holds it; every error, and every unsafe directory, is
/// `Scan`.
pub fn claim_key(rt: &Runtime, key: &str) -> Claim {
    if !is_claim_name(key) {
        return Claim::Scan;
    }
    let Some(bucket) = now_bucket() else { return Claim::Scan };
    let Some(root) = safe_root(rt) else { return Claim::Scan };
    if bucket > 0 && holds_claim(&root.join((bucket - 1).to_string()), key) {
        return Claim::Duplicate;
    }
    let dir = root.join(bucket.to_string());
    let Some(created) = ensure_safe_dir(&dir) else { return Claim::Scan };
    if created {
        sweep_old_buckets(&root, bucket);
    }
    // `create_new` is O_CREAT|O_EXCL: it never follows a symlink at the path.
    match std::fs::OpenOptions::new().write(true).create_new(true).open(dir.join(key)) {
        Ok(_) => Claim::Scan,
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Claim::Duplicate,
        Err(_) => Claim::Scan,
    }
}

/// Claims the event this invocation is about to scan.
pub fn claim_event(rt: &Runtime, event: &Map<String, Value>, project_cwd: &str, files: &[String]) -> Claim {
    match event_key(event, project_cwd, files) {
        Some(key) => claim_key(rt, &key),
        None => Claim::Scan,
    }
}
