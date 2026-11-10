use super::*;
use crate::targets::resource_matches;

pub fn run(args: &[String], io: &mut impeccable_common::Io) -> i32 {
    let Some(verb) = args.first().map(String::as_str) else {
        return fail(
            io,
            "invalid_request",
            "Expected capabilities, list, plan, apply, undo, status, or recover",
            2,
        );
    };
    if verb == "capabilities" {
        io.out(&json!({"schemaVersion":RESPONSE_VERSION,"requestVersion":REQUEST_VERSION,"journalVersion":JOURNAL_VERSION,"harnesses":["claude","codex"],"scopes":["user"],"verbs":["list","plan","apply","undo","status","recover"],"lockTimeoutSeconds":10}).to_string());
        return 0;
    }
    if verb == "list" {
        return match agents_home().and_then(|home| list(&home)) {
            Ok(body) => {
                io.out(
                    &json!({"schemaVersion":RESPONSE_VERSION,"ok":true,"result":body}).to_string(),
                );
                0
            }
            Err((code, msg, exit)) => fail(io, code, &msg, exit),
        };
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
pub(super) fn fail(
    io: &mut impeccable_common::Io,
    code: &'static str,
    message: &str,
    exit: i32,
) -> i32 {
    io.out(&json!({"schemaVersion":RESPONSE_VERSION,"ok":false,"error":ErrorBody{code,message:message.to_owned()}}).to_string());
    exit
}
pub(super) fn validate(s: &Spec) -> Result<(), String> {
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
    for h in &s.hooks {
        if s.harness == "codex" && (h.run_async.is_some() || h.async_rewake.is_some()) {
            return Err("async and asyncRewake hooks are Claude Code only".into());
        }
        if h.timeout == Some(0) {
            return Err("Hook timeout must be at least one second".into());
        }
    }
    for a in &s.mcp_approvals {
        if s.harness != "codex" {
            return Err("MCP approvals are Codex only".into());
        }
        if a.server.is_empty()
            || !a
                .server
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            return Err("Invalid MCP server name".into());
        }
        if !["approve", "prompt", "auto", "writes"].contains(&a.mode.as_str()) {
            return Err("Unsupported MCP approval mode".into());
        }
    }
    for m in &s.mcp_servers {
        if m.name.is_empty() || m.name.contains(['/', '\\']) {
            return Err("Invalid MCP server name".into());
        }
        match &m.url {
            Some(url) => {
                if !m.command.is_empty() || !m.args.is_empty() || !m.env.is_empty() {
                    return Err("A remote MCP server takes a url and nothing else".into());
                }
                let parsed =
                    url::Url::parse(url).map_err(|_| "Invalid MCP server url".to_string())?;
                if parsed.scheme() != "https"
                    || !parsed.username().is_empty()
                    || parsed.password().is_some()
                    || parsed.host_str().is_none()
                {
                    return Err("An MCP server url must be https, with no credentials".into());
                }
            }
            None if m.command.is_empty() => {
                return Err("An MCP server needs a command or a url".into());
            }
            None => {}
        }
    }
    Ok(())
}
pub(super) fn operate(verb: &str, s: &Spec) -> Result<Value, (&'static str, String, i32)> {
    let home = agents_home()?;
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
            "plan" => plan(s, prior.as_ref(), &home),
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
pub(super) fn agents_home() -> Result<PathBuf, (&'static str, String, i32)> {
    std::env::var_os("IMPECCABLE_AGENTS_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".impeccable/agents")))
        .ok_or_else(|| ("io_error", "No home directory configured".into(), 1))
}
/// Every committed installation in the journal, as a setup report: who owns it, which harness, which hook events
/// and other entries it wrote, and whether each is still as written. Read-only, without the lock (journals are
/// written atomically), and with no path, command or account root, so the report can leave the machine.
pub(super) fn list(home: &Path) -> Result<Value, (&'static str, String, i32)> {
    let mut installations = Vec::new();
    let mut pending = 0;
    let mut unreadable = 0;
    let entries = match fs::read_dir(home) {
        Ok(entries) => entries.flatten().map(|e| e.path()).collect::<Vec<_>>(),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => vec![],
        Err(e) => return Err(ioerr(e)),
    };
    for path in entries {
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        if name.ends_with(".pending.json") {
            pending += 1;
            continue;
        }
        if !name.ends_with(".json") {
            continue;
        }
        // One journal never sinks the report: one an undo removed since the directory was read is gone, and one that
        // cannot be read (invalid, or a newer engine's) is counted, not named.
        let j = match read_journal(&path) {
            Ok(Some(j)) => j,
            Ok(None) => continue,
            Err(_) if !path.exists() => continue,
            Err(_) => {
                unreadable += 1;
                continue;
            }
        };
        let mut resources = Vec::new();
        for r in &j.resources {
            // A resource only a harness CLI can check, with that CLI gone, is unchecked rather than an error.
            let state = match resource_matches(&j.spec, &j, r) {
                Ok(true) => format!("{:?}", r.state).to_lowercase(),
                Ok(false) => "conflict".into(),
                Err(_) => "unchecked".into(),
            };
            resources.push(json!({"kind":r.kind,"state":state}));
        }
        installations.push(json!({
            "owner":j.spec.owner,
            "harness":j.spec.harness,
            "hooks":j.spec.hooks.iter().map(|h| json!({"event":h.event,"matcher":h.matcher})).collect::<Vec<_>>(),
            "instruction":j.spec.instruction.is_some(),
            "mcpServers":j.spec.mcp_servers.iter().map(|m| m.name.clone()).collect::<Vec<_>>(),
            "mcpApprovals":j.spec.mcp_approvals.iter().map(|a| a.server.clone()).collect::<Vec<_>>(),
            "resources":resources,
        }));
    }
    installations.sort_by_key(|i| (i["owner"].to_string(), i["harness"].to_string()));
    Ok(
        json!({"engineVersion":env!("CARGO_PKG_VERSION"),"installations":installations,"pendingTransactions":pending,"unreadableJournals":unreadable}),
    )
}
