//! JS: live/source-lock.mjs. Per-source-file lock under
//! `<live>/locks/<sha256(abs)[:24]>.lock`, created `wx`, stale when its
//! owner pid is gone (or unreadable and older than 60 s), retried every
//! `retryMs` until `waitMs`, then `source_locked`.

use crate::paths::live_dir;
use crate::util::{jsp, now_ms, pid_reachable, sha256_hex, Env};
use serde_json::{json, Value};
use std::io::Write;

const UNREADABLE_LOCK_STALE_MS: f64 = 60_000.0;

/// A thrown lock error: `source_locked` (`code: 'SOURCE_LOCKED'`) on
/// contention, or the message of the fs error the JS would have rethrown.
#[derive(Debug)]
pub struct SourceLocked {
    pub message: String,
}

/// JS: sourceLockPath(file, cwd)
pub fn source_lock_path(file: &str, cwd: &str, env: &Env) -> String {
    let digest = sha256_hex(&jsp::resolve(cwd, &[file]));
    jsp::join(&[
        &live_dir(cwd, env),
        "locks",
        &format!("{}.lock", &digest[..24]),
    ])
}

fn read_lock(lock_path: &str) -> Option<Value> {
    let text = std::fs::read_to_string(lock_path).ok()?;
    serde_json::from_str(&text).ok()
}

/// JS: clearStaleLock(lockPath)
fn clear_stale_lock(lock_path: &str) {
    match read_lock(lock_path) {
        None => {
            if let Ok(meta) = std::fs::metadata(lock_path) {
                let mtime = meta
                    .modified()
                    .ok()
                    .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs_f64() * 1000.0)
                    .unwrap_or(0.0);
                if now_ms() - mtime > UNREADABLE_LOCK_STALE_MS {
                    let _ = std::fs::remove_file(lock_path);
                }
            }
        }
        Some(held) => {
            if let Some(pid) = held.get("pid").and_then(|p| p.as_f64()) {
                // JS: typeof held.pid === 'number' && isLiveServerPidReachable(pid)
                if pid_reachable(pid as i64) {
                    return;
                }
            }
            let _ = std::fs::remove_file(lock_path);
        }
    }
}

/// JS: releaseOwnLock(lockPath, token)
fn release_own_lock(lock_path: &str, token: &str) {
    if let Some(held) = read_lock(lock_path) {
        if held.get("token").and_then(|t| t.as_str()) != Some(token) {
            return;
        }
    }
    let _ = std::fs::remove_file(lock_path);
}

fn random_uuid() -> String {
    let t = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mut x = (t as u64) ^ ((std::process::id() as u64) << 32) ^ 0x9E37_79B9_7F4A_7C15;
    let mut words = [0u64; 2];
    for w in words.iter_mut() {
        x ^= x >> 33;
        x = x.wrapping_mul(0xff51_afd7_ed55_8ccd);
        x ^= x >> 33;
        x = x.wrapping_mul(0xc4ce_b9fe_1a85_ec53);
        x ^= x >> 33;
        *w = x;
        x = x.wrapping_add(0x9E37_79B9_7F4A_7C15);
    }
    let hi = words[0];
    let lo = words[1];
    format!(
        "{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
        (hi >> 32) as u32,
        ((hi >> 16) & 0xffff) as u16,
        (hi & 0xfff) as u16,
        (((lo >> 48) & 0x3fff) | 0x8000) as u16,
        lo & 0xffff_ffff_ffff
    )
}

/// JS: withSourceLockSync(file, owner, fn, { cwd, waitMs, retryMs })
pub fn with_source_lock<T>(
    file: &str,
    owner: &str,
    cwd: &str,
    env: &Env,
    wait_ms: f64,
    f: impl FnOnce() -> T,
) -> Result<T, SourceLocked> {
    let retry_ms: f64 = 5.0;
    let lock_path = source_lock_path(file, cwd, env);
    if let Some(parent) = std::path::Path::new(&lock_path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let deadline = now_ms() + wait_ms.max(0.0);
    let token = random_uuid();
    loop {
        clear_stale_lock(&lock_path);
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock_path)
        {
            Ok(mut fd) => {
                let payload = json!({
                    "owner": owner,
                    "token": token,
                    "pid": std::process::id(),
                    "at": now_ms() as i64,
                    "file": jsp::resolve(cwd, &[file]),
                });
                let _ = fd.write_all(format!("{}\n", payload).as_bytes());
                break;
            }
            Err(e) => {
                if e.kind() != std::io::ErrorKind::AlreadyExists {
                    // JS rethrows other errors as-is.
                    return Err(SourceLocked {
                        message: e.to_string(),
                    });
                }
                if now_ms() >= deadline {
                    return Err(SourceLocked {
                        message: "source_locked".to_string(),
                    });
                }
                let remaining = deadline - now_ms();
                let sleep = retry_ms.min(remaining).max(1.0);
                std::thread::sleep(std::time::Duration::from_millis(sleep as u64));
            }
        }
    }
    let out = f();
    release_own_lock(&lock_path, &token);
    Ok(out)
}
