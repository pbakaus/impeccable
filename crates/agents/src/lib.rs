//! User-scoped integration management for Claude Code and Codex.
//!
//! The JSON protocol is deliberately resource-oriented. Each request acts on
//! one (owner, harness, account root) installation.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{self, Read, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, Instant},
};

const REQUEST_VERSION: u32 = 1;
const RESPONSE_VERSION: u32 = 1;
const JOURNAL_VERSION: u32 = 2;

mod cli;
mod fs_writer;
mod mcp;
mod render;
mod resources;
mod targets;
pub use cli::run;
#[cfg(test)]
use cli::validate;
use fs_writer::{canonical_target, failpoint, safe_delete, safe_write};
#[cfg(test)]
use fs_writer::{validate_file, TEST_FAILPOINT};
use mcp::{mcp_config, mcp_get, mcp_resource_id, preflight_mcp, sync_mcp};
use render::render;
use resources::{apply, hex, installation_id, undo};
use targets::{plan, status, targets};

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Spec {
    pub version: u32,
    pub owner: String,
    pub harness: String,
    pub root: PathBuf,
    #[serde(default)]
    pub hooks: Vec<Hook>,
    #[serde(default)]
    pub mcp_servers: Vec<McpServer>,
    /// Codex only: `default_tools_approval_mode` on an existing `[mcp_servers.<server>]`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mcp_approvals: Vec<McpApproval>,
    pub instruction: Option<String>,
}
#[derive(Debug, Deserialize, Serialize, Clone, PartialEq, Eq)]
pub struct McpApproval {
    pub server: String,
    pub mode: String,
}
#[derive(Debug, Deserialize, Serialize, Clone, PartialEq)]
pub struct Hook {
    pub event: String,
    #[serde(default)]
    pub matcher: Option<String>,
    pub command: String,
    /// Seconds before the harness stops the command.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout: Option<u64>,
    /// Claude Code only: run in the background.
    #[serde(default, rename = "async", skip_serializing_if = "Option::is_none")]
    pub run_async: Option<bool>,
    /// Claude Code only: a background hook that exits 2 wakes the session.
    #[serde(
        default,
        rename = "asyncRewake",
        skip_serializing_if = "Option::is_none"
    )]
    pub async_rewake: Option<bool>,
}
impl Hook {
    /// The entry both Claude Code and Codex read under `hooks.<event>`:
    /// `{"matcher"?, "hooks":[{"type":"command","command",options…}]}`. Unset
    /// fields are omitted, never written as null.
    pub(crate) fn entry(&self) -> Value {
        let mut command = serde_json::Map::new();
        command.insert("type".into(), json!("command"));
        command.insert("command".into(), json!(self.command));
        for (key, value) in [
            ("timeout", self.timeout.map(|t| json!(t))),
            ("async", self.run_async.map(|a| json!(a))),
            ("asyncRewake", self.async_rewake.map(|a| json!(a))),
        ] {
            if let Some(value) = value {
                command.insert(key.into(), value);
            }
        }
        let mut entry = serde_json::Map::new();
        if let Some(matcher) = &self.matcher {
            entry.insert("matcher".into(), json!(matcher));
        }
        entry.insert("hooks".into(), json!([command]));
        Value::Object(entry)
    }
}
#[derive(Debug, Deserialize, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpServer {
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: std::collections::BTreeMap<String, String>,
}

#[derive(Debug, Serialize)]
struct ErrorBody {
    code: &'static str,
    message: String,
}

/// CLI entrypoint: `agents <verb> --spec <file|-> --json`.
fn ioerr(e: io::Error) -> (&'static str, String, i32) {
    ("io_error", e.to_string(), 1)
}
struct LockGuard {
    file: fs::File,
    #[cfg(not(unix))]
    path: PathBuf,
}
#[cfg(unix)]
impl Drop for LockGuard {
    fn drop(&mut self) {
        use std::os::unix::io::AsRawFd;
        extern "C" {
            fn flock(fd: i32, operation: i32) -> i32;
        }
        unsafe {
            let _ = flock(self.file.as_raw_fd(), 8);
        }
    }
}
#[cfg(not(unix))]
impl Drop for LockGuard {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}
fn acquire_lock(path: &Path, timeout: Duration) -> Result<LockGuard, (&'static str, String, i32)> {
    let start = Instant::now();
    #[cfg(unix)]
    {
        use std::os::unix::{fs::OpenOptionsExt, io::AsRawFd};
        let file = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .open(path)
            .map_err(ioerr)?;
        secure_lock_file(path, &file)?;
        loop {
            extern "C" {
                fn flock(fd: i32, operation: i32) -> i32;
            }
            let rc = unsafe { flock(file.as_raw_fd(), 2 | 4) };
            if rc == 0 {
                return Ok(LockGuard { file });
            }
            let e = io::Error::last_os_error();
            if e.kind() != io::ErrorKind::WouldBlock {
                return Err(ioerr(e));
            }
            if start.elapsed() >= timeout {
                return Err((
                    "lock_timeout",
                    "Timed out waiting for agents lock".into(),
                    3,
                ));
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }
    #[cfg(not(unix))]
    {
        loop {
            match fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(path)
            {
                Ok(file) => {
                    return Ok(LockGuard {
                        file,
                        path: path.to_path_buf(),
                    });
                }
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists && start.elapsed() < timeout => {
                    std::thread::sleep(Duration::from_millis(50))
                }
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {
                    return Err((
                        "lock_timeout",
                        "Timed out waiting for agents lock".into(),
                        3,
                    ));
                }
                Err(e) => return Err(ioerr(e)),
            }
        }
    }
}
#[derive(Serialize, Deserialize, Clone, Debug)]
struct Journal {
    version: u32,
    spec: Spec,
    snapshots: Vec<Snapshot>,
    #[serde(default)]
    resources: Vec<ResourceRecord>,
}
#[derive(Serialize, Deserialize, Clone, Debug)]
struct ResourceRecord {
    resource_id: String,
    kind: String,
    path: PathBuf,
    state: ResourceState,
    original_value: Option<Value>,
    last_written_value: Value,
    claims: Vec<InstallClaim>,
}
#[derive(Serialize, Deserialize, Clone, Debug)]
struct Snapshot {
    #[serde(default)]
    resource_id: String,
    #[serde(default)]
    kind: String,
    #[serde(default)]
    state: ResourceState,
    path: PathBuf,
    before: Option<Vec<u8>>,
    #[serde(default)]
    original_value: Option<Vec<u8>>,
    #[serde(default)]
    last_written_value: Vec<u8>,
    written_hash: String,
    #[serde(default)]
    claims: Vec<InstallClaim>,
    #[serde(default = "default_true")]
    pure_install: bool,
}
fn default_true() -> bool {
    true
}
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
enum ResourceState {
    #[default]
    Created,
    Preexisting,
    Conflict,
}
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
struct InstallClaim {
    owner: String,
    harness: String,
    account_root: PathBuf,
}
fn installation_claim(s: &Spec) -> InstallClaim {
    InstallClaim {
        owner: s.owner.clone(),
        harness: s.harness.clone(),
        account_root: s.root.clone(),
    }
}
fn read_journal(path: &Path) -> Result<Option<Journal>, (&'static str, String, i32)> {
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(path).map_err(ioerr)?;
    let header: Value = serde_json::from_slice(&bytes)
        .map_err(|_| ("invalid_journal", "Journal is invalid".into(), 4))?;
    if header
        .get("version")
        .and_then(Value::as_u64)
        .is_some_and(|v| v > JOURNAL_VERSION as u64)
    {
        return Err((
            "newer_journal",
            "Journal was written by a newer engine".into(),
            4,
        ));
    }
    let j: Journal = serde_json::from_slice(&bytes)
        .map_err(|_| ("invalid_journal", "Journal is invalid".into(), 4))?;
    Ok(Some(j))
}
fn write_journal(path: &Path, j: &Journal) -> Result<(), (&'static str, String, i32)> {
    private_atomic_write(path, &serde_json::to_vec(j).unwrap())
}
#[derive(Serialize, Deserialize)]
struct PendingTransaction {
    version: u32,
    journal_path: PathBuf,
    prior_journal: Option<Vec<u8>>,
    desired_spec: Spec,
    prior_spec: Option<Spec>,
    targets: Vec<PendingTarget>,
}
#[derive(Serialize, Deserialize)]
struct PendingTarget {
    path: PathBuf,
    before: Option<Vec<u8>>,
    after: Option<Vec<u8>>,
}
fn persist_pending(
    path: &Path,
    tx: &PendingTransaction,
) -> Result<(), (&'static str, String, i32)> {
    private_atomic_write(path, &serde_json::to_vec(tx).unwrap())
}
fn recover(home: &Path, id: &str) -> Result<Value, (&'static str, String, i32)> {
    let pending = home.join(format!("{id}.pending.json"));
    if !pending.exists() {
        return Ok(json!({"installation":id,"state":"clean","transactions":[]}));
    }
    let bytes = fs::read(&pending).map_err(ioerr)?;
    let header: Value = serde_json::from_slice(&bytes).map_err(|_| {
        (
            "invalid_journal",
            "Pending transaction is invalid".into(),
            4,
        )
    })?;
    if header
        .get("version")
        .and_then(Value::as_u64)
        .is_some_and(|v| v > JOURNAL_VERSION as u64)
    {
        return Err((
            "newer_journal",
            "Pending transaction uses a newer format".into(),
            4,
        ));
    }
    let tx: PendingTransaction = serde_json::from_slice(&bytes).map_err(|_| {
        (
            "invalid_journal",
            "Pending transaction is invalid".into(),
            4,
        )
    })?;
    let mut conflicts = Vec::new();
    for target in tx.targets.iter().rev() {
        let current = fs::read(&target.path).ok();
        if current == target.after {
            if let Some(before) = &target.before {
                safe_write(&target.path, current.as_deref(), before)?;
            } else {
                safe_delete(&target.path, current.as_deref())?;
            }
        } else if current != target.before {
            conflicts.push(target.path.clone())
        }
    }
    if !conflicts.is_empty() {
        return Ok(json!({"installation":id,"state":"conflict","conflicts":conflicts}));
    }
    let rollback = tx.prior_spec.clone().unwrap_or_else(|| Spec {
        mcp_servers: vec![],
        ..tx.desired_spec.clone()
    });
    let mcp_conflicts = sync_mcp(&rollback, Some(&tx.desired_spec), home)?;
    if !mcp_conflicts.is_empty() {
        return Ok(json!({"installation":id,"state":"conflict","conflicts":mcp_conflicts}));
    }
    if let Some(before) = tx.prior_journal {
        atomic_bytes(&tx.journal_path, &before)?
    } else {
        let _ = fs::remove_file(tx.journal_path);
    }
    fs::remove_file(pending).map_err(ioerr)?;
    Ok(json!({"installation":id,"state":"rolled-back","transactions":tx.targets.len()}))
}
fn atomic_bytes(path: &Path, bytes: &[u8]) -> Result<(), (&'static str, String, i32)> {
    private_atomic_write(path, bytes)
}
fn private_atomic_write(path: &Path, bytes: &[u8]) -> Result<(), (&'static str, String, i32)> {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    let parent = path
        .parent()
        .ok_or_else(|| ("unsafe_target", "File has no parent".into(), 4))?;
    let tmp = loop {
        let t = parent.join(format!(
            ".agents-state-{}-{}.tmp",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let mut o = fs::OpenOptions::new();
        o.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            o.mode(0o600);
        }
        match o.open(&t) {
            Ok(mut f) => {
                f.write_all(bytes).map_err(ioerr)?;
                f.sync_all().map_err(ioerr)?;
                drop(f);
                break t;
            }
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(ioerr(e)),
        }
    };
    if let Err(e) = failpoint("state_temp_synced") {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    if let Err(e) = failpoint("state_before_rename") {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    fs::rename(&tmp, path).map_err(ioerr)?;
    failpoint("state_after_rename")?;
    fs_writer::sync_dir(parent)?;
    failpoint("state_directory_synced")?;
    if fs::read(path).map_err(ioerr)? != bytes {
        return Err((
            "concurrent_change",
            "Agent state verification failed after write".into(),
            4,
        ));
    }
    failpoint("state_verified")
}
fn ensure_private_home(path: &Path) -> Result<(), (&'static str, String, i32)> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder
        .create(path)
        .or_else(|error| {
            if error.kind() == io::ErrorKind::AlreadyExists {
                Ok(())
            } else {
                Err(error)
            }
        })
        .map_err(ioerr)?;
    let link_metadata = fs::symlink_metadata(path).map_err(ioerr)?;
    if !link_metadata.file_type().is_dir() {
        return Err((
            "unsafe_target",
            "Agent state path must be a real directory".into(),
            4,
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        if link_metadata.uid() != fs_writer::libc_uid() {
            return Err((
                "unsafe_target",
                "Agent state directory is not owned by current user".into(),
                4,
            ));
        }
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(ioerr)?;
    }
    Ok(())
}
fn secure_lock_file(path: &Path, file: &fs::File) -> Result<(), (&'static str, String, i32)> {
    let link_metadata = fs::symlink_metadata(path).map_err(ioerr)?;
    if !link_metadata.file_type().is_file() {
        return Err((
            "unsafe_target",
            "Agent lock must be a regular file".into(),
            4,
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        if link_metadata.uid() != fs_writer::libc_uid() {
            return Err((
                "unsafe_target",
                "Agent lock is not owned by current user".into(),
                4,
            ));
        }
        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(ioerr)?;
    }
    let _ = file;
    Ok(())
}
#[cfg(test)]
mod tests;
