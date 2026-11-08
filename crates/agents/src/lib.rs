//! User-scoped integration management for Claude Code and Codex.
//!
//! The JSON protocol is deliberately resource-oriented. Each request acts on
//! one (owner, harness, account root) installation.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
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

mod fs_writer;
mod render;
#[cfg(test)]
use fs_writer::{TEST_FAILPOINT, validate_file};
use fs_writer::{canonical_target, failpoint, safe_delete, safe_write};
use render::render;

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
    pub instruction: Option<String>,
}
#[derive(Debug, Deserialize, Serialize, Clone, PartialEq)]
pub struct Hook {
    pub event: String,
    #[serde(default)]
    pub matcher: Option<String>,
    pub command: String,
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
pub fn run(args: &[String], io: &mut impeccable_common::Io) -> i32 {
    let Some(verb) = args.first().map(String::as_str) else {
        return fail(
            io,
            "invalid_request",
            "Expected capabilities, plan, apply, undo, status, or recover",
            2,
        );
    };
    if verb == "capabilities" {
        io.out(&json!({"schemaVersion":RESPONSE_VERSION,"requestVersion":REQUEST_VERSION,"journalVersion":JOURNAL_VERSION,"harnesses":["claude","codex"],"scopes":["user"],"verbs":["plan","apply","undo","status","recover"],"lockTimeoutSeconds":10}).to_string());
        return 0;
    }
    let Some(spec_path) = args
        .windows(2)
        .find(|w| w[0] == "--spec")
        .map(|w| w[1].as_str())
    else {
        return fail(io, "invalid_request", "--spec <file|-> is required", 2);
    };
    let mut raw = String::new();
    let read = if spec_path == "-" {
        std::io::stdin().read_to_string(&mut raw).map(|_| ())
    } else {
        fs::read_to_string(spec_path).map(|s| raw = s)
    };
    if read.is_err() {
        return fail(io, "invalid_request", "Unable to read request", 2);
    }
    let spec: Spec = match serde_json::from_str(&raw) {
        Ok(s) => s,
        Err(_) => return fail(io, "invalid_request", "Invalid request JSON", 2),
    };
    if let Err(msg) = validate(&spec) {
        return fail(io, "invalid_request", &msg, 2);
    }
    match operate(verb, &spec) {
        Ok(body) => {
            io.out(&json!({"schemaVersion":RESPONSE_VERSION,"ok":true,"result":body}).to_string());
            0
        }
        Err((code, msg, exit)) => fail(io, code, &msg, exit),
    }
}
fn fail(io: &mut impeccable_common::Io, code: &'static str, message: &str, exit: i32) -> i32 {
    io.out(&json!({"schemaVersion":RESPONSE_VERSION,"ok":false,"error":ErrorBody{code,message:message.to_owned()}}).to_string());
    exit
}
fn validate(s: &Spec) -> Result<(), String> {
    if s.version != REQUEST_VERSION {
        return Err("Unsupported request version".into());
    }
    if !(2..=32).contains(&s.owner.len())
        || !s.owner.as_bytes()[0].is_ascii_lowercase()
        || !s
            .owner
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    {
        return Err("Invalid owner id".into());
    }
    if !["claude", "codex"].contains(&s.harness.as_str()) {
        return Err("Only Claude Code and Codex user installations are supported".into());
    }
    if !s.root.is_absolute() {
        return Err("Account root must be an explicit absolute path".into());
    }
    if let Some(body) = &s.instruction {
        if body.contains("impeccable:") {
            return Err("Instruction body contains reserved marker syntax".into());
        }
    }
    for m in &s.mcp_servers {
        if m.name.is_empty() || m.name.contains(['/', '\\']) {
            return Err("Invalid MCP server name".into());
        }
    }
    Ok(())
}
fn operate(verb: &str, s: &Spec) -> Result<Value, (&'static str, String, i32)> {
    let home = std::env::var_os("IMPECCABLE_AGENTS_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".impeccable/agents")))
        .ok_or_else(|| ("io_error", "No home directory configured".into(), 1))?;
    ensure_private_home(&home)?;
    let lock = home.join("agents.lock");
    let _lock_guard = acquire_lock(&lock, Duration::from_secs(10))?;
    let id = format!(
        "{}-{}-{}",
        s.owner,
        s.harness,
        hex(&Sha256::digest(s.root.to_string_lossy().as_bytes())[..8])
    );
    let journal = home.join(format!("{id}.json"));
    let result = (|| {
        let prior = read_journal(&journal)?;
        match verb {
            "plan" => plan(s, prior.as_ref()),
            "status" => status(s, prior.as_ref()),
            "apply" => {
                let prior_bytes = fs::read(&journal).ok();
                let result = apply(s, prior.as_ref(), &home, &journal, prior_bytes)?;
                write_journal(&journal, &result)?;
                failpoint("journal_commit")?;
                let _ = fs::remove_file(home.join(format!("{id}.pending.json")));
                Ok(json!({"installation":id,"state":"applied"}))
            }
            "undo" => {
                let result = undo(s, prior.as_ref(), &home)?;
                if result["conflicts"]
                    .as_array()
                    .is_some_and(|a| !a.is_empty())
                {
                    let mut retained = prior.unwrap();
                    let paths = result["conflicts"].as_array().unwrap();
                    for resource in &mut retained.resources {
                        if paths.iter().any(|path| {
                            path.as_str()
                                .is_some_and(|path| resource.path == Path::new(path))
                        }) {
                            resource.state = ResourceState::Conflict;
                        }
                    }
                    write_journal(&journal, &retained)?;
                } else {
                    let _ = fs::remove_file(&journal);
                }
                Ok(result)
            }
            "recover" => recover(&home, &id),
            _ => Err(("invalid_request", "Unknown agents verb".into(), 2)),
        }
    })();
    result
}
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
    sync_mcp(&rollback, Some(&tx.desired_spec))?;
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
    fs::File::open(parent)
        .and_then(|d| d.sync_all())
        .map_err(ioerr)?;
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
fn targets(s: &Spec) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if !s.hooks.is_empty() {
        if s.harness == "claude" {
            out.push(s.root.join("settings.json"));
        } else {
            out.extend([s.root.join("hooks.json"), s.root.join("config.toml")]);
        }
    }
    if s.instruction.is_some() {
        out.push(s.root.join(if s.harness == "claude" {
            "CLAUDE.md"
        } else {
            "AGENTS.md"
        }));
    }
    out
}
fn plan(s: &Spec, j: Option<&Journal>) -> Result<Value, (&'static str, String, i32)> {
    let mut resources = Vec::new();
    for path in targets(s) {
        let before = fs::read(&path).ok();
        let _physical = canonical_target(&path)?;
        let after = render(s, &path, before.as_deref())?;
        let change = match (&before, after.as_slice()) {
            (None, b) if b.is_empty() => "unchanged",
            (None, _) => "create",
            (Some(b), a) if b == a => "unchanged",
            (Some(_), _) => "update",
        };
        let will_reformat = change == "update"
            && path
                .extension()
                .is_some_and(|extension| extension == "json")
            && before.as_deref().is_some_and(|bytes| {
                render::parse_unique_json(bytes)
                    .ok()
                    .and_then(|value| serde_json::to_vec_pretty(&value).ok())
                    .is_none_or(|mut canonical| {
                        canonical.push(b'\n');
                        canonical != bytes
                    })
            });
        resources.push(json!({"path":path,"change":change,"willReformat":will_reformat}));
    }
    let mut mcp_servers = Vec::new();
    for server in &s.mcp_servers {
        let already_claimed = j.is_some_and(|journal| {
            journal.resources.iter().any(|resource| {
                resource.kind == "mcp-server"
                    && resource
                        .last_written_value
                        .get("name")
                        .and_then(Value::as_str)
                        == Some(server.name.as_str())
            })
        });
        let occupied = !already_claimed && mcp_exists(s, &server.name)?;
        mcp_servers.push(json!({"name":server.name,"change":if occupied{"conflict"}else if already_claimed{"unchanged"}else{"create"}}));
    }
    Ok(
        json!({"installation":s.root,"resources":resources,"mcpServers":mcp_servers,"previouslyApplied":j.is_some()}),
    )
}
fn status(s: &Spec, j: Option<&Journal>) -> Result<Value, (&'static str, String, i32)> {
    let mut resources = Vec::new();
    if let Some(j) = j {
        for r in &j.resources {
            let matches = resource_matches(s, j, r)?;
            let state = if matches {
                format!("{:?}", r.state).to_lowercase()
            } else {
                "conflict".into()
            };
            resources.push(json!({"resourceId":r.resource_id,"kind":r.kind,"path":r.path,"state":state,"claims":r.claims}));
        }
    }
    Ok(
        json!({"installation":s.root,"installed":j.is_some(),"effective":if s.harness=="codex"&&s.root.join("AGENTS.override.md").exists(){false}else{true},"manualActions":if s.harness=="codex"&&!s.hooks.is_empty(){vec!["Approve hooks via /hooks","Trust this folder"]}else{vec![]},"resources":resources}),
    )
}
fn resource_matches(
    s: &Spec,
    journal: &Journal,
    resource: &ResourceRecord,
) -> Result<bool, (&'static str, String, i32)> {
    if resource.kind == "mcp-server" {
        let name = resource
            .last_written_value
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default();
        return mcp_exists(s, name);
    }
    let Some(bytes) = fs::read(&resource.path).ok() else {
        return Ok(false);
    };
    match resource.kind.as_str() {
        "hook" => {
            let Ok(document) = render::parse_unique_json(&bytes) else {
                return Ok(false);
            };
            let Some(root) = document.as_object() else {
                return Ok(false);
            };
            let hooks = if journal.spec.harness == "claude" {
                let Some(hooks) = root.get("hooks").and_then(Value::as_object) else {
                    return Ok(false);
                };
                hooks
            } else {
                root
            };
            for hook in &journal.spec.hooks {
                let entry = if journal.spec.harness == "claude" {
                    json!({"matcher":hook.matcher,"hooks":[{"type":"command","command":hook.command}]})
                } else {
                    json!({"command":hook.command})
                };
                if entry == resource.last_written_value
                    && hooks
                        .get(&hook.event)
                        .and_then(Value::as_array)
                        .is_some_and(|entries| entries.contains(&entry))
                {
                    return Ok(true);
                }
            }
            Ok(false)
        }
        "instruction-block" => {
            let Some(expected) = resource.last_written_value.as_str() else {
                return Ok(false);
            };
            let text = String::from_utf8_lossy(&bytes);
            let start = format!("<!-- impeccable:{} start -->", journal.spec.owner);
            let end = format!("<!-- impeccable:{} end -->", journal.spec.owner);
            let Some(body) = block_body(&text, &start, &end) else {
                return Ok(false);
            };
            Ok(body == expected)
        }
        "setting" => Ok(String::from_utf8_lossy(&bytes)
            .lines()
            .scan(false, |in_features, line| {
                let trimmed = line.trim();
                if trimmed.starts_with('[') && trimmed.ends_with(']') {
                    *in_features = trimmed == "[features]";
                }
                Some(*in_features && trimmed == "hooks = true")
            })
            .any(|is_enabled| is_enabled)),
        _ => Ok(journal
            .snapshots
            .iter()
            .find(|snapshot| snapshot.path == resource.path)
            .is_some_and(|snapshot| hex(&Sha256::digest(&bytes)) == snapshot.written_hash)),
    }
}
fn apply(
    s: &Spec,
    old: Option<&Journal>,
    home: &Path,
    journal_path: &Path,
    prior_journal: Option<Vec<u8>>,
) -> Result<Journal, (&'static str, String, i32)> {
    let mut snapshots = Vec::new();
    let mut writes = Vec::new();
    let desired_targets = targets(s);
    let mut touched = desired_targets.clone();
    if let Some(old) = old {
        for p in targets(&old.spec) {
            if !touched.contains(&p) {
                touched.push(p)
            }
        }
    }
    let mut touched_physical = Vec::new();
    for path in touched {
        let before = fs::read(&path).ok();
        let physical = canonical_target(&path)?;
        touched_physical.push(physical.clone());
        let mut base = before.clone();
        if let Some(old) = old {
            if targets(&old.spec).contains(&path) {
                let original = old
                    .snapshots
                    .iter()
                    .find(|x| x.path == physical)
                    .and_then(|x| x.before.as_deref());
                if let Some(updated) = render::remove_owned(
                    &old.spec,
                    &physical,
                    base.as_deref().unwrap_or_default(),
                    original,
                )? {
                    base = Some(updated);
                }
            }
        }
        let managed = desired_targets.contains(&path);
        let next = if managed {
            Some(render(s, &path, base.as_deref())?)
        } else {
            base
        };
        let next = if !managed
            && next.as_deref() == Some(b"")
            && old
                .and_then(|j| j.snapshots.iter().find(|x| x.path == physical))
                .is_some_and(|x| x.before.is_none())
        {
            None
        } else {
            next
        };
        if managed && before != next && has_peer_installation(home, &physical, s) {
            return Err((
                "shared_resource_conflict",
                format!(
                    "Conflicting desired values for shared resource {}",
                    physical.display()
                ),
                4,
            ));
        }
        if before != next {
            writes.push((path.clone(), next, managed));
        } else if managed {
            if let Some(mut claim) = find_resource_claim(home, &physical) {
                let id = installation_claim(s);
                if !claim.claims.contains(&id) {
                    claim.claims.push(id)
                }
                claim.pure_install = false;
                snapshots.push(claim);
            } else {
                let written = before.clone().unwrap_or_default();
                snapshots.push(Snapshot {
                    resource_id: format!("file:{}", physical.display()),
                    kind: "managed_file".into(),
                    state: ResourceState::Preexisting,
                    path: physical,
                    before: before.clone(),
                    original_value: before.clone(),
                    last_written_value: written.clone(),
                    written_hash: hex(&Sha256::digest(&written)),
                    claims: vec![installation_claim(s)],
                    pure_install: true,
                });
            }
        }
    }
    let pending_path = home.join(format!("{}.pending.json", installation_id(s)));
    let pending_targets = writes
        .iter()
        .map(|(p, after, _)| {
            Ok(PendingTarget {
                path: canonical_target(p)?,
                before: fs::read(p).ok(),
                after: after.clone(),
            })
        })
        .collect::<Result<Vec<_>, (&'static str, String, i32)>>()?;
    let mcp_change = old.map_or(!s.mcp_servers.is_empty(), |j| {
        j.spec.mcp_servers != s.mcp_servers
    });
    if !pending_targets.is_empty() || mcp_change {
        persist_pending(
            &pending_path,
            &PendingTransaction {
                version: JOURNAL_VERSION,
                journal_path: journal_path.to_path_buf(),
                prior_journal,
                desired_spec: s.clone(),
                prior_spec: old.map(|j| j.spec.clone()),
                targets: pending_targets,
            },
        )?;
        failpoint("journal_intent")?;
    }
    for (logical, next, managed) in writes {
        let before = fs::read(&logical).ok();
        let path = if let Some(next) = &next {
            safe_write(&logical, before.as_deref(), next)?
        } else {
            safe_delete(&logical, before.as_deref())?
        };
        let written = fs::read(&path).unwrap_or_default();
        if managed {
            let existing = old.and_then(|j| j.snapshots.iter().find(|x| x.path == path));
            let baseline = existing
                .map(|x| x.before.clone())
                .unwrap_or_else(|| before.clone());
            let mut claims = existing.map(|x| x.claims.clone()).unwrap_or_default();
            let claim = installation_claim(s);
            if !claims.contains(&claim) {
                claims.push(claim);
            }
            snapshots.push(Snapshot {
                resource_id: format!("file:{}", path.display()),
                kind: "managed_file".into(),
                state: ResourceState::Created,
                path,
                original_value: baseline.clone(),
                before: baseline,
                last_written_value: written.clone(),
                written_hash: hex(&Sha256::digest(&written)),
                claims,
                pure_install: existing.is_none(),
            });
        }
    }
    sync_mcp(s, old.map(|j| &j.spec))?;
    failpoint("mcp_synced")?;
    let _ = home;
    let mut all = old.map(|j| j.snapshots.clone()).unwrap_or_default();
    all.retain(|x| !touched_physical.contains(&x.path));
    for snap in snapshots {
        all.retain(|x| x.path != snap.path);
        all.push(snap)
    }
    let resources = build_resource_records(s, old, &all, home);
    Ok(Journal {
        version: JOURNAL_VERSION,
        spec: s.clone(),
        snapshots: all,
        resources,
    })
}
fn build_resource_records(
    s: &Spec,
    old: Option<&Journal>,
    snapshots: &[Snapshot],
    home: &Path,
) -> Vec<ResourceRecord> {
    let mut known = old.map(|j| j.resources.clone()).unwrap_or_default();
    if let Ok(entries) = fs::read_dir(home) {
        for e in entries.flatten() {
            let p = e.path();
            if p.extension().is_none_or(|x| x != "json")
                || p.file_name()
                    .is_some_and(|n| n.to_string_lossy().ends_with("pending.json"))
            {
                continue;
            }
            let Ok(bytes) = fs::read(p) else { continue };
            let Ok(j) = serde_json::from_slice::<Journal>(&bytes) else {
                continue;
            };
            for r in j.resources {
                if !known.iter().any(|x| x.resource_id == r.resource_id) {
                    known.push(r)
                }
            }
        }
    }
    let claim = installation_claim(s);
    let mut out = Vec::new();
    let mut add = |kind: &str, key: &str, path: &str, original: Option<Value>, last: Value| {
        let id = format!(
            "{}:{}:{}:{}",
            kind,
            s.harness,
            path,
            hex(&Sha256::digest(format!("{}:{key}", s.owner).as_bytes()))
        );
        let mut record = known
            .iter()
            .find(|r| r.resource_id == id)
            .cloned()
            .unwrap_or(ResourceRecord {
                resource_id: id,
                kind: kind.into(),
                path: PathBuf::from(path),
                state: if original.as_ref() == Some(&last) {
                    ResourceState::Preexisting
                } else {
                    ResourceState::Created
                },
                original_value: original,
                last_written_value: last,
                claims: vec![],
            });
        if !record.claims.contains(&claim) {
            record.claims.push(claim.clone())
        }
        if !out
            .iter()
            .any(|r: &ResourceRecord| r.resource_id == record.resource_id)
        {
            out.push(record)
        }
    };
    for path in targets(s) {
        let Ok(physical) = canonical_target(&path) else {
            continue;
        };
        let Some(snap) = snapshots.iter().find(|x| x.path == physical) else {
            continue;
        };
        let before = snap.before.as_deref().unwrap_or_default();
        let after = snap.last_written_value.as_slice();
        if (path.ends_with("settings.json") || path.ends_with("hooks.json")) && !s.hooks.is_empty()
        {
            let claude = s.harness == "claude";
            let pre = render::parse_unique_json(before).ok();
            for h in &s.hooks {
                let entry = if claude {
                    json!({"matcher":h.matcher,"hooks":[{"type":"command","command":h.command}]})
                } else {
                    json!({"command":h.command})
                };
                let present = pre
                    .as_ref()
                    .and_then(|v| if claude { v.get("hooks") } else { Some(v) })
                    .and_then(|v| v.get(&h.event))
                    .and_then(Value::as_array)
                    .is_some_and(|a| a.contains(&entry));
                let key = format!(
                    "{}:{}",
                    h.event,
                    hex(&Sha256::digest(serde_json::to_vec(&entry).unwrap()))
                );
                add(
                    "hook",
                    &key,
                    &physical.display().to_string(),
                    present.then_some(entry.clone()),
                    entry,
                );
            }
        }
        if path.ends_with("config.toml") && s.harness == "codex" && !s.hooks.is_empty() {
            let orig = String::from_utf8_lossy(before).lines().find_map(|l| {
                l.trim().strip_prefix("hooks = ").and_then(|v| match v {
                    "true" => Some(Value::Bool(true)),
                    "false" => Some(Value::Bool(false)),
                    _ => None,
                })
            });
            add(
                "setting",
                "features.hooks",
                &physical.display().to_string(),
                orig,
                Value::Bool(true),
            );
        }
        if path.ends_with("CLAUDE.md") || path.ends_with("AGENTS.md") {
            let marker = format!("impeccable:{}", s.owner);
            let start = format!("<!-- {marker} start -->");
            let end = format!("<!-- {marker} end -->");
            let extract = |bytes: &[u8]| {
                let t = String::from_utf8(bytes.to_vec()).ok()?;
                Some(Value::String(block_body(&t, &start, &end)?.to_owned()))
            };
            let last = extract(after).unwrap_or(Value::Null);
            add(
                "instruction-block",
                &s.owner,
                &physical.display().to_string(),
                extract(before),
                last,
            );
        }
    }
    for m in &s.mcp_servers {
        let path = format!("{}:{}", s.harness, s.root.display());
        add(
            "mcp-server",
            &m.name,
            &path,
            None,
            json!({"name":m.name,"command":m.command,"args":m.args,"env":m.env}),
        );
    }
    out
}
fn block_body<'a>(text: &'a str, start: &str, end: &str) -> Option<&'a str> {
    if text.matches(start).count() != 1
        || text.matches(end).count() != 1
        || text.lines().filter(|line| *line == start).count() != 1
        || text.lines().filter(|line| *line == end).count() != 1
    {
        return None;
    }
    let body_start = text.find(start)? + start.len();
    let body_end = text[body_start..].find(end)? + body_start;
    if body_start >= body_end {
        return None;
    }
    let body = &text[body_start..body_end];
    let body = body
        .strip_prefix("\r\n")
        .or_else(|| body.strip_prefix('\n'))?;
    body.strip_suffix("\r\n")
        .or_else(|| body.strip_suffix('\n'))
}
fn installation_id(s: &Spec) -> String {
    format!(
        "{}-{}-{}",
        s.owner,
        s.harness,
        hex(&Sha256::digest(s.root.to_string_lossy().as_bytes())[..8])
    )
}
fn find_resource_claim(home: &Path, path: &Path) -> Option<Snapshot> {
    let entries = fs::read_dir(home).ok()?;
    for e in entries.flatten() {
        let p = e.path();
        if p.extension().is_none_or(|x| x != "json")
            || p.file_name()
                .is_some_and(|n| n.to_string_lossy().ends_with("pending.json"))
        {
            continue;
        }
        let Ok(bytes) = fs::read(p) else { continue };
        let Ok(j) = serde_json::from_slice::<Journal>(&bytes) else {
            continue;
        };
        if let Some(s) = j.snapshots.into_iter().find(|s| s.path == path) {
            return Some(s);
        }
    }
    None
}
fn has_peer_installation(home: &Path, path: &Path, s: &Spec) -> bool {
    fs::read_dir(home)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .any(|e| {
            let p = e.path();
            if p.extension().is_none_or(|x| x != "json")
                || p.file_name()
                    .is_some_and(|n| n.to_string_lossy().ends_with("pending.json"))
            {
                return false;
            }
            let Some(id) = p.file_stem().and_then(|n| n.to_str()) else {
                return false;
            };
            if id == installation_id(s) {
                return false;
            }
            fs::read(p)
                .ok()
                .and_then(|b| serde_json::from_slice::<Journal>(&b).ok())
                .is_some_and(|j| {
                    j.spec.owner == s.owner
                        && j.spec.harness == s.harness
                        && j.snapshots.iter().any(|x| x.path == path)
                })
        })
}
fn has_other_claim(home: &Path, path: &Path, exclude: &str, owner: &str, harness: &str) -> bool {
    fs::read_dir(home)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .any(|e| {
            let p = e.path();
            if p.file_name()
                .is_some_and(|n| n.to_string_lossy() == format!("{exclude}.json"))
                || p.extension().is_none_or(|x| x != "json")
                || p.file_name()
                    .is_some_and(|n| n.to_string_lossy().ends_with("pending.json"))
            {
                return false;
            }
            fs::read(p)
                .ok()
                .and_then(|b| serde_json::from_slice::<Journal>(&b).ok())
                .is_some_and(|j| {
                    let codex_shared = path.file_name().is_some_and(|n| n == "config.toml")
                        && j.spec.harness == "codex";
                    (codex_shared || (j.spec.owner == owner && j.spec.harness == harness))
                        && j.snapshots.iter().any(|s| s.path == path)
                })
        })
}

fn undo(s: &Spec, j: Option<&Journal>, _home: &Path) -> Result<Value, (&'static str, String, i32)> {
    let Some(j) = j else {
        return Ok(json!({"removed":false,"conflicts":[]}));
    };
    let mut conflicts = Vec::new();
    let mut removed = Vec::new();
    for snap in &j.snapshots {
        if has_other_claim(_home, &snap.path, &installation_id(s), &s.owner, &s.harness) {
            continue;
        }
        let current = fs::read(&snap.path).ok();
        if current
            .as_ref()
            .is_some_and(|b| hex(&Sha256::digest(b)) == snap.written_hash)
            && snap.pure_install
        {
            if let Some(b) = &snap.before {
                safe_write(&snap.path, current.as_deref(), b)?;
            } else {
                safe_delete(&snap.path, current.as_deref())?;
            }
            removed.push(snap.path.clone())
        } else {
            match render::remove_owned(
                s,
                &snap.path,
                current.as_deref().unwrap_or_default(),
                snap.before.as_deref(),
            )? {
                Some(updated) if current.as_deref() != Some(updated.as_slice()) => {
                    safe_write(&snap.path, current.as_deref(), &updated)?;
                    removed.push(snap.path.clone());
                }
                _ => conflicts.push(snap.path.clone()),
            }
        }
    }
    sync_mcp(
        &Spec {
            mcp_servers: vec![],
            ..j.spec.clone()
        },
        Some(&j.spec),
    )?;
    let _ = s;
    Ok(json!({"removed":true,"resourcesRemoved":removed,"conflicts":conflicts}))
}
fn sync_mcp(spec: &Spec, previous: Option<&Spec>) -> Result<(), (&'static str, String, i32)> {
    let old = previous.map(|p| p.mcp_servers.as_slice()).unwrap_or(&[]);
    for server in &spec.mcp_servers {
        let same = old.iter().any(|m| {
            m.name == server.name
                && m.command == server.command
                && m.args == server.args
                && m.env == server.env
        });
        if same {
            continue;
        }
        if old.iter().any(|m| m.name == server.name) {
            run_mcp(spec, "remove", &server.name, None)?
        } else {
            if mcp_exists(spec, &server.name)? {
                return Err((
                    "mcp_name_collision",
                    format!("MCP server name is already in use: {}", server.name),
                    4,
                ));
            }
        }
        run_mcp(spec, "add", &server.name, Some(server))?;
    }
    for server in old {
        if !spec.mcp_servers.iter().any(|m| m.name == server.name) {
            run_mcp(spec, "remove", &server.name, None)?
        }
    }
    Ok(())
}
fn mcp_exists(spec: &Spec, name: &str) -> Result<bool, (&'static str, String, i32)> {
    let binary = mcp_binary(spec);
    let mut cmd = Command::new(binary);
    cmd.env(
        if spec.harness == "claude" {
            "CLAUDE_CONFIG_DIR"
        } else {
            "CODEX_HOME"
        },
        &spec.root,
    );
    if spec.harness == "claude" {
        cmd.args(["mcp", "get", name, "--scope", "user"]);
    } else {
        cmd.args(["mcp", "get", name]);
    }
    let output = cmd.output().map_err(|_| {
        (
            "harness_cli_error",
            format!("Could not run configured {} CLI", spec.harness),
            4,
        )
    })?;
    Ok(output.status.success())
}
fn mcp_binary(spec: &Spec) -> std::ffi::OsString {
    let var = if spec.harness == "claude" {
        "IMPECCABLE_CLAUDE_BIN"
    } else {
        "IMPECCABLE_CODEX_BIN"
    };
    std::env::var_os(var).unwrap_or_else(|| {
        if spec.harness == "claude" {
            "claude".into()
        } else {
            "codex".into()
        }
    })
}
fn run_mcp(
    spec: &Spec,
    action: &str,
    name: &str,
    server: Option<&McpServer>,
) -> Result<(), (&'static str, String, i32)> {
    let mut cmd = Command::new(mcp_binary(spec));
    cmd.env(
        if spec.harness == "claude" {
            "CLAUDE_CONFIG_DIR"
        } else {
            "CODEX_HOME"
        },
        &spec.root,
    );
    if spec.harness == "claude" {
        cmd.args([
            "mcp",
            if action == "add" {
                "add-json"
            } else {
                "remove"
            },
            "--scope",
            "user",
            name,
        ]);
        if let Some(m) = server {
            cmd.arg(
                serde_json::to_string(&json!({"command":m.command,"args":m.args,"env":m.env}))
                    .unwrap(),
            );
        }
    } else {
        cmd.args(["mcp", action, name]);
        if let Some(m) = server {
            for (key, value) in &m.env {
                cmd.arg("--env").arg(format!("{key}={value}"));
            }
            cmd.arg("--").arg(&m.command).args(&m.args);
        }
    }
    let output = cmd.output().map_err(|_| {
        (
            "harness_cli_error",
            format!(
                "Could not run configured {spec_harness} CLI",
                spec_harness = spec.harness
            ),
            4,
        )
    })?;
    if !output.status.success() {
        return Err((
            "mcp_refused",
            format!("{} refused MCP server {}", spec.harness, name),
            4,
        ));
    }
    Ok(())
}
fn hex(b: &[u8]) -> String {
    b.iter().map(|v| format!("{v:02x}")).collect()
}

#[cfg(test)]
mod tests;
