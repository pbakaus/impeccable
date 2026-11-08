//! User-scoped integration management for Claude Code and Codex.
//!
//! The JSON protocol is deliberately resource-oriented. Each request acts on
//! one (owner, harness, account root) installation.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{self, Read},
    path::{Path, PathBuf},
    process::Command,
    time::{Duration, Instant},
};

const REQUEST_VERSION: u32 = 1;
const RESPONSE_VERSION: u32 = 1;
const JOURNAL_VERSION: u32 = 1;

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
#[derive(Debug, Deserialize, Serialize, Clone)]
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
    fs::create_dir_all(&home).map_err(ioerr)?;
    set_mode(&home, 0o700);
    let lock = home.join("agents.lock");
    acquire_lock(&lock, Duration::from_secs(10))?;
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
                let result = apply(s, prior.as_ref(), &home)?;
                write_journal(&journal, &result)?;
                Ok(json!({"installation":id,"state":"applied"}))
            }
            "undo" => {
                let result = undo(s, prior.as_ref(), &home)?;
                if result["conflicts"]
                    .as_array()
                    .is_some_and(|a| !a.is_empty())
                {
                    write_journal(&journal, &prior.unwrap())?;
                } else {
                    let _ = fs::remove_file(&journal);
                }
                Ok(result)
            }
            "recover" => Ok(json!({"installation":id,"state":"clean","transactions":[]})),
            _ => Err(("invalid_request", "Unknown agents verb".into(), 2)),
        }
    })();
    let _ = fs::remove_file(lock);
    result
}
fn ioerr(e: io::Error) -> (&'static str, String, i32) {
    ("io_error", e.to_string(), 1)
}
fn acquire_lock(path: &Path, timeout: Duration) -> Result<(), (&'static str, String, i32)> {
    let start = Instant::now();
    loop {
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
        {
            Ok(f) => {
                set_mode(path, 0o600);
                drop(f);
                return Ok(());
            }
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists && start.elapsed() < timeout => {
                std::thread::sleep(Duration::from_millis(50))
            }
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {
                return Err((
                    "lock_timeout",
                    "Timed out waiting for agents lock".into(),
                    3,
                ))
            }
            Err(e) => return Err(ioerr(e)),
        }
    }
}
#[derive(Serialize, Deserialize, Clone)]
struct Journal {
    version: u32,
    spec: Spec,
    snapshots: Vec<Snapshot>,
}
#[derive(Serialize, Deserialize, Clone)]
struct Snapshot {
    path: PathBuf,
    before: Option<Vec<u8>>,
    written_hash: String,
}
fn read_journal(path: &Path) -> Result<Option<Journal>, (&'static str, String, i32)> {
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(path).map_err(ioerr)?;
    let j: Journal = serde_json::from_slice(&bytes)
        .map_err(|_| ("invalid_journal", "Journal is invalid".into(), 4))?;
    if j.version > JOURNAL_VERSION {
        return Err((
            "newer_journal",
            "Journal was written by a newer engine".into(),
            4,
        ));
    }
    Ok(Some(j))
}
fn write_journal(path: &Path, j: &Journal) -> Result<(), (&'static str, String, i32)> {
    let t = path.with_extension("tmp");
    fs::write(&t, serde_json::to_vec(j).unwrap()).map_err(ioerr)?;
    set_mode(&t, 0o600);
    fs::rename(t, path).map_err(ioerr)
}
fn set_mode(path: &Path, mode: u32) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(mode));
    }
    let _ = (path, mode);
}
fn targets(s: &Spec) -> Vec<PathBuf> {
    if s.harness == "claude" {
        vec![s.root.join("settings.json"), s.root.join("CLAUDE.md")]
    } else {
        vec![
            s.root.join("hooks.json"),
            s.root.join("config.toml"),
            s.root.join("AGENTS.md"),
        ]
    }
}
fn plan(s: &Spec, j: Option<&Journal>) -> Result<Value, (&'static str, String, i32)> {
    let paths = targets(s);
    Ok(
        json!({"installation":s.root,"resources":paths.iter().map(|p|json!({"path":p,"change":if p.exists(){"update-or-merge"}else{"create"}})).collect::<Vec<_>>(),"mcpServers":s.mcp_servers.iter().map(|m|&m.name).collect::<Vec<_>>(),"previouslyApplied":j.is_some()}),
    )
}
fn status(s: &Spec, j: Option<&Journal>) -> Result<Value, (&'static str, String, i32)> {
    let mut resources = Vec::new();
    if let Some(j) = j {
        for x in &j.snapshots {
            let now = fs::read(&x.path).ok();
            resources.push(json!({"path":x.path,"state":if now.as_ref().is_some_and(|b|hex(&Sha256::digest(b))==x.written_hash){"installed"}else{"drift"}}));
        }
    }
    Ok(
        json!({"installation":s.root,"installed":j.is_some(),"effective":if s.harness=="codex"&&s.root.join("AGENTS.override.md").exists(){false}else{true},"manualActions":if s.harness=="codex"&&!s.hooks.is_empty(){vec!["Approve hooks via /hooks","Trust this folder"]}else{vec![]},"resources":resources}),
    )
}
fn apply(
    s: &Spec,
    old: Option<&Journal>,
    home: &Path,
) -> Result<Journal, (&'static str, String, i32)> {
    sync_mcp(s, old.map(|j| &j.spec))?;
    let mut snapshots = Vec::new();
    let mut writes = Vec::new();
    for path in targets(s) {
        let before = fs::read(&path).ok();
        let next = render(s, &path, before.as_deref())?;
        if before.as_deref() != Some(next.as_slice()) {
            writes.push((path.clone(), next));
        }
    }
    for (logical, next) in writes {
        let before = fs::read(&logical).ok();
        let identity = validate_file(&logical)?;
        let path = if fs::symlink_metadata(&logical).is_ok() {
            fs::canonicalize(&logical).map_err(|_| {
                (
                    "unsafe_target",
                    "Target symlink is dangling or cyclic".into(),
                    4,
                )
            })?
        } else {
            logical
        };
        let temp = path.with_extension(format!("agents-{}.tmp", std::process::id()));
        fs::write(&temp, &next).map_err(ioerr)?;
        set_mode(&temp, 0o600);
        if let Some(meta) = &identity {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = fs::set_permissions(&temp, fs::Permissions::from_mode(*meta));
            }
        }
        if fs::read(&path).ok() != before {
            return Err((
                "concurrent_change",
                format!("Target changed during write: {}", path.display()),
                4,
            ));
        }
        fs::rename(&temp, &path).map_err(ioerr)?;
        let written = fs::read(&path).map_err(ioerr)?;
        snapshots.push(Snapshot {
            path,
            before,
            written_hash: hex(&Sha256::digest(&written)),
        });
    }
    let _ = home;
    let mut all = old.map(|j| j.snapshots.clone()).unwrap_or_default();
    for snap in snapshots {
        all.retain(|x| x.path != snap.path);
        all.push(snap)
    }
    Ok(Journal {
        version: JOURNAL_VERSION,
        spec: s.clone(),
        snapshots: all,
    })
}
fn validate_file(path: &Path) -> Result<Option<u32>, (&'static str, String, i32)> {
    if fs::symlink_metadata(path).is_ok() {
        let p = fs::canonicalize(path).map_err(|_| {
            (
                "unsafe_target",
                "Target symlink is dangling or cyclic".into(),
                4,
            )
        })?;
        let md = fs::metadata(&p).map_err(ioerr)?;
        if !md.is_file() {
            return Err(("unsafe_target", "Target is not a regular file".into(), 4));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::{MetadataExt, PermissionsExt};
        if md.uid() != libc_uid() {
                return Err((
                    "unsafe_target",
                    "Target is not owned by current user".into(),
                    4,
                ));
            }
            return Ok(Some(md.permissions().mode() & 0o777));
        }
    }
    Ok(None)
}
#[cfg(unix)]
fn libc_uid() -> u32 {
    extern "C" {
        fn geteuid() -> u32;
    }
    unsafe { geteuid() }
}
#[cfg(not(unix))]
fn libc_uid() -> u32 {
    0
}
fn render(
    s: &Spec,
    path: &Path,
    before: Option<&[u8]>,
) -> Result<Vec<u8>, (&'static str, String, i32)> {
    let is_rule = path.ends_with("CLAUDE.md") || path.ends_with("AGENTS.md");
    if is_rule {
        return render_rule(s, before);
    }
    let mut value = if let Some(b) = before {
        serde_json::from_slice::<Value>(b).map_err(|_| {
            (
                "invalid_settings",
                format!("Refusing non-plain JSON at {}", path.display()),
                4,
            )
        })?
    } else {
        json!({})
    };
    if !value.is_object() {
        return Err(("invalid_settings", "Expected JSON object".into(), 4));
    }
    if s.harness == "claude" && path.ends_with("settings.json") && !s.hooks.is_empty() {
        let obj = value.as_object_mut().unwrap();
        let hooks = obj.entry("hooks").or_insert(json!({}));
        if !hooks.is_object() {
            return Err(("invalid_settings", "hooks must be an object".into(), 4));
        }
        for h in &s.hooks {
            let ev = hooks
                .as_object_mut()
                .unwrap()
                .entry(&h.event)
                .or_insert(json!([]));
            if !ev.is_array() {
                return Err(("invalid_settings", "hook event must be an array".into(), 4));
            }
            let command = json!({"type":"command","command":h.command});
            let entry = json!({"matcher":h.matcher,"hooks":[command]});
            let arr = ev.as_array_mut().unwrap();
            if !arr.contains(&entry) {
                arr.push(entry)
            }
        }
    }
    if s.harness == "codex" && path.ends_with("hooks.json") && !s.hooks.is_empty() {
        let obj = value.as_object_mut().unwrap();
        for h in &s.hooks {
            let ev = obj.entry(&h.event).or_insert(json!([]));
            if !ev.is_array() {
                return Err(("invalid_settings", "hook event must be an array".into(), 4));
            }
            let entry = json!({"command":h.command});
            if !ev.as_array().unwrap().contains(&entry) {
                ev.as_array_mut().unwrap().push(entry)
            }
        }
    }
    serde_json::to_vec_pretty(&value)
        .map(|mut b| {
            b.push(b'\n');
            b
        })
        .map_err(|_| ("invalid_settings", "Could not serialize settings".into(), 4))
}
fn render_rule(s: &Spec, before: Option<&[u8]>) -> Result<Vec<u8>, (&'static str, String, i32)> {
    let marker = format!("impeccable:{}", s.owner);
    let start = format!("<!-- {marker} start -->");
    let end = format!("<!-- {marker} end -->");
    let mut text = before
        .map(|b| String::from_utf8_lossy(b).into_owned())
        .unwrap_or_default();
    let starts = text.matches(&start).count();
    let ends = text.matches(&end).count();
    if starts != ends || starts > 1 {
        return Err((
            "ambiguous_markers",
            "Instruction markers are unbalanced or duplicated".into(),
            4,
        ));
    }
    let nl = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let body = s.instruction.as_deref().unwrap_or("");
    let block = if body.is_empty() {
        String::new()
    } else {
        format!("{start}{nl}{body}{nl}{end}")
    };
    if starts == 1 {
        let a = text.find(&start).unwrap();
        let b = text.find(&end).unwrap() + end.len();
        text.replace_range(a..b, &block);
    } else if !block.is_empty() {
        if !text.is_empty() && !text.ends_with('\n') {
            text.push_str(nl)
        }
        if !text.is_empty() && !text.ends_with(&format!("{nl}{nl}")) {
            text.push_str(nl)
        }
        text.push_str(&block);
        text.push_str(nl)
    }
    Ok(text.into_bytes())
}
fn undo(s: &Spec, j: Option<&Journal>, _home: &Path) -> Result<Value, (&'static str, String, i32)> {
    let Some(j) = j else {
        return Ok(json!({"removed":false,"conflicts":[]}));
    };
    let mut conflicts = Vec::new();
    let mut removed = Vec::new();
    for snap in &j.snapshots {
        let current = fs::read(&snap.path).ok();
        if current
            .as_ref()
            .is_some_and(|b| hex(&Sha256::digest(b)) == snap.written_hash)
        {
            if let Some(b) = &snap.before {
                fs::write(&snap.path, b).map_err(ioerr)?
            } else {
                let _ = fs::remove_file(&snap.path);
            }
            removed.push(snap.path.clone())
        } else {
            conflicts.push(snap.path.clone())
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
fn run_mcp(
    spec: &Spec,
    action: &str,
    name: &str,
    server: Option<&McpServer>,
) -> Result<(), (&'static str, String, i32)> {
    let var = if spec.harness == "claude" {
        "IMPECCABLE_CLAUDE_BIN"
    } else {
        "IMPECCABLE_CODEX_BIN"
    };
    let binary = std::env::var_os(var).unwrap_or_else(|| {
        if spec.harness == "claude" {
            "claude".into()
        } else {
            "codex".into()
        }
    });
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
mod tests {
    use super::*;
    fn spec(harness: &str, root: PathBuf) -> Spec {
        Spec {
            version: 1,
            owner: "impeccable-loop".into(),
            harness: harness.into(),
            root,
            hooks: vec![],
            mcp_servers: vec![],
            instruction: Some("managed text".into()),
        }
    }
    fn temp() -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "impeccable-agents-test-{}-{}",
            std::process::id(),
            Instant::now().elapsed().as_nanos()
        ));
        fs::create_dir_all(&p).unwrap();
        p
    }
    #[test]
    fn rule_render_preserves_crlf_and_outside_bytes() {
        let s = spec("claude", temp());
        let before = b"Keep\r\n\r\n";
        let out = render_rule(&s, Some(before)).unwrap();
        assert!(String::from_utf8(out)
            .unwrap()
            .starts_with("Keep\r\n\r\n<!-- impeccable:impeccable-loop start -->"));
    }
    #[test]
    fn marker_body_and_ambiguous_markers_refused() {
        let mut s = spec("claude", temp());
        s.instruction = Some("bad <!-- impeccable:x -->".into());
        assert!(validate(&s).is_err());
        s.instruction = Some("valid".into());
        assert_eq!(
            render_rule(&s, Some(b"<!-- impeccable:impeccable-loop start -->\nx\n"))
                .unwrap_err()
                .0,
            "ambiguous_markers"
        );
    }
    #[test]
    fn settings_invalid_json_refused() {
        let s = spec("claude", temp());
        let p = s.root.join("settings.json");
        assert_eq!(
            render(&s, &p, Some(b"{/* comment */}")).unwrap_err().0,
            "invalid_settings"
        );
    }
    #[test]
    fn identical_hook_is_not_duplicated() {
        let mut s = spec("claude", temp());
        s.hooks.push(Hook {
            event: "PreToolUse".into(),
            matcher: None,
            command: "echo".into(),
        });
        let p = s.root.join("settings.json");
        let first = render(&s, &p, None).unwrap();
        let second = render(&s, &p, Some(&first)).unwrap();
        assert_eq!(first, second);
    }
    #[test]
    fn apply_then_undo_restores_original_bytes() {
        let root = temp();
        fs::write(root.join("settings.json"), b"{\"other\":1}\n").unwrap();
        fs::write(root.join("CLAUDE.md"), b"Team notes\r\n").unwrap();
        let s = spec("claude", root.clone());
        let home = temp();
        let j = apply(&s, None, &home).unwrap();
        assert!(String::from_utf8(fs::read(root.join("CLAUDE.md")).unwrap())
            .unwrap()
            .contains("impeccable:impeccable-loop"));
        let result = undo(&s, Some(&j), &home).unwrap();
        assert!(result["conflicts"].as_array().unwrap().is_empty());
        assert_eq!(
            fs::read(root.join("settings.json")).unwrap(),
            b"{\"other\":1}\n"
        );
        assert_eq!(fs::read(root.join("CLAUDE.md")).unwrap(), b"Team notes\r\n");
    }
    #[test]
    fn reapply_uses_user_edited_file_as_new_baseline() {
        let root = temp();
        fs::write(root.join("settings.json"), b"{}\n").unwrap();
        let s = spec("claude", root.clone());
        let home = temp();
        let j = apply(&s, None, &home).unwrap();
        let path = root.join("CLAUDE.md");
        let mut edited = fs::read(&path).unwrap();
        edited.extend_from_slice(b"User addition\n");
        fs::write(&path, edited).unwrap();
        let j2 = apply(&s, Some(&j), &home).unwrap();
        undo(&s, Some(&j2), &home).unwrap();
        assert!(String::from_utf8(fs::read(&path).unwrap())
            .unwrap()
            .contains("User addition"));
    }
}
