use super::*;

pub(super) fn sync_mcp(
    spec: &Spec,
    previous: Option<&Spec>,
    home: &Path,
) -> Result<Vec<String>, (&'static str, String, i32)> {
    let old = previous.map(|p| p.mcp_servers.as_slice()).unwrap_or(&[]);
    let conflicts = preflight_mcp(spec, previous, home)?;
    if !conflicts.is_empty() {
        return Ok(conflicts);
    }

    for prior in old {
        let desired = spec.mcp_servers.iter().find(|m| m.name == prior.name);
        if desired.is_some_and(|m| m == prior) {
            continue;
        }
        if other_mcp_claim(home, spec, &prior.name) {
            continue;
        }
        run_mcp(spec, "remove", &prior.name, None)?;
    }

    for server in &spec.mcp_servers {
        if old.iter().any(|m| m == server) {
            continue;
        }
        if old.iter().any(|m| m.name == server.name) {
            if conflicts.contains(&server.name) {
                continue;
            }
            run_mcp(spec, "add", &server.name, Some(server))?;
            continue;
        }

        let peer = find_peer_mcp_record(home, spec, &server.name);
        if peer.is_none() {
            run_mcp(spec, "add", &server.name, Some(server))?;
            if mcp_get(spec, &server.name)?.as_ref() != Some(&mcp_config(server)) {
                return Err((
                    "mcp_verification_failed",
                    format!("Could not verify installed MCP server {}", server.name),
                    4,
                ));
            }
        }
    }
    Ok(Vec::new())
}
pub(super) fn preflight_mcp(
    spec: &Spec,
    previous: Option<&Spec>,
    home: &Path,
) -> Result<Vec<String>, (&'static str, String, i32)> {
    let old = previous.map(|p| p.mcp_servers.as_slice()).unwrap_or(&[]);
    let mut conflicts = Vec::new();
    for prior in old {
        let desired = spec
            .mcp_servers
            .iter()
            .find(|server| server.name == prior.name);
        let unchanged = desired.is_some_and(|server| server == prior);
        let observed = mcp_get(spec, &prior.name)?;
        if unchanged {
            if observed.as_ref() != Some(&mcp_config(prior)) {
                conflicts.push(prior.name.clone());
            }
            continue;
        }
        let has_peer = other_mcp_claim(home, spec, &prior.name);
        if desired.is_some() && has_peer {
            return Err((
                "shared_resource_conflict",
                format!(
                    "MCP server is still claimed by another installation: {}",
                    prior.name
                ),
                4,
            ));
        }
        if observed.as_ref() != Some(&mcp_config(prior)) {
            conflicts.push(prior.name.clone());
            continue;
        }
        if has_peer {
            continue;
        }
    }
    for desired in &spec.mcp_servers {
        if old.iter().any(|prior| prior.name == desired.name) {
            continue;
        }
        let observed = mcp_get(spec, &desired.name)?;
        if let Some(peer) = find_peer_mcp_record(home, spec, &desired.name) {
            if peer.last_written_value != mcp_config(desired) {
                return Err((
                    "shared_resource_conflict",
                    format!(
                        "MCP server name is claimed with a different configuration: {}",
                        desired.name
                    ),
                    4,
                ));
            }
            if observed.as_ref() != Some(&peer.last_written_value) {
                conflicts.push(desired.name.clone());
            }
        } else if observed.is_some() {
            return Err((
                "mcp_name_collision",
                format!("MCP server name is already in use: {}", desired.name),
                4,
            ));
        }
    }
    Ok(conflicts)
}
/// How long `codex mcp add --url` may take, its browser sign-in included.
const CODEX_SIGN_IN_WAIT: std::time::Duration = std::time::Duration::from_secs(300);
pub(super) fn mcp_resource_id(spec: &Spec, name: &str) -> String {
    let identity = format!("{}:{}:{}", spec.harness, spec.root.display(), name);
    format!("mcp:{}", hex(&Sha256::digest(identity.as_bytes())))
}
pub(super) fn mcp_config(server: &McpServer) -> Value {
    match &server.url {
        Some(url) => json!({"name":server.name,"url":url}),
        None => {
            json!({"name":server.name,"command":server.command,"args":server.args,"env":server.env})
        }
    }
}
pub(super) fn find_peer_mcp_record(home: &Path, spec: &Spec, name: &str) -> Option<ResourceRecord> {
    let id = mcp_resource_id(spec, name);
    fs::read_dir(home).ok()?.flatten().find_map(|entry| {
        let path = entry.path();
        if path.extension().is_none_or(|ext| ext != "json")
            || path
                .file_name()
                .is_some_and(|n| n.to_string_lossy().ends_with("pending.json"))
            || path.file_stem().and_then(|n| n.to_str()) == Some(installation_id(spec).as_str())
        {
            return None;
        }
        let journal: Journal = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
        journal.resources.into_iter().find(|r| r.resource_id == id)
    })
}
pub(super) fn find_peer_mcp_record_from_journal(
    journal: Option<&Journal>,
    spec: &Spec,
    name: &str,
) -> Option<ResourceRecord> {
    let id = mcp_resource_id(spec, name);
    journal?
        .resources
        .iter()
        .find(|record| record.resource_id == id)
        .cloned()
}
/// A remote server's observation carries nothing but its url: Codex's `get --json`
/// settings at their defaults (enabled, no tool filters, timeouts, headers or bearer
/// variable) and a streamable HTTP transport; Claude's JSON with only `type: http`.
fn remote_is_default(candidate: &Value) -> bool {
    let null = |v: Option<&Value>| v.is_none_or(Value::is_null);
    let transport = candidate.get("transport");
    let codex_ok = transport.is_none_or(|t| {
        t.get("type").and_then(Value::as_str) == Some("streamable_http")
            && ["bearer_token_env_var", "http_headers", "env_http_headers", "http_headers_helper"]
                .iter()
                .all(|k| null(t.get(k)))
    });
    let settings_ok = candidate.get("enabled").is_none_or(|v| v == &Value::Bool(true))
        && [
            "disabled_reason",
            "enabled_tools",
            "disabled_tools",
            "startup_timeout_sec",
            "tool_timeout_sec",
            "headers",
            "oauth",
        ]
        .iter()
        .all(|k| null(candidate.get(*k)));
    let claude_type_ok = candidate.get("type").is_none_or(|t| t == "http");
    codex_ok && settings_ok && claude_type_ok
}
pub(super) fn parse_mcp_observation(bytes: &[u8], name: &str) -> Option<Value> {
    if let Ok(value) = render::parse_unique_json(bytes) {
        let candidate = value
            .get("server")
            .or_else(|| value.get("config"))
            .unwrap_or(&value);
        if value
            .get("name")
            .or_else(|| candidate.get("name"))
            .and_then(Value::as_str)
            .is_some_and(|actual| actual != name)
        {
            return None;
        }
        // A remote server: `url` directly (Claude) or under `transport` (Codex's JSON). Any
        // setting beyond the url that isn't its default marks it changed, so an edited entry
        // is never taken for the one installed (and never removed as if it were).
        if let Some(url) = candidate
            .get("url")
            .or_else(|| candidate.get("transport").and_then(|t| t.get("url")))
            .and_then(Value::as_str)
        {
            return Some(if remote_is_default(candidate) {
                json!({"name":name,"url":url})
            } else {
                json!({"name":name,"url":url,"modified":true})
            });
        }
        let command = candidate.get("command")?.as_str()?;
        let args = match candidate.get("args") {
            None => Vec::new(),
            Some(Value::Array(values)) => values
                .iter()
                .map(|value| value.as_str().map(str::to_owned))
                .collect::<Option<Vec<_>>>()?,
            Some(_) => return None,
        };
        let env = match candidate
            .get("env")
            .or_else(|| candidate.get("environment"))
        {
            None => std::collections::BTreeMap::new(),
            Some(Value::Object(values)) => values
                .iter()
                .map(|(key, value)| Some((key.clone(), value.as_str()?.to_owned())))
                .collect::<Option<std::collections::BTreeMap<_, _>>>()?,
            Some(_) => return None,
        };
        return Some(json!({"name":name,"command":command,"args":args,"env":env}));
    }
    let text = std::str::from_utf8(bytes).ok()?;
    let mut command = None;
    let mut url = None;
    let mut kind = None;
    let mut scope = None;
    let mut other = false;
    let mut args: Vec<String> = Vec::new();
    let mut env = std::collections::BTreeMap::new();
    for line in text.lines() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        // Claude's fields are indented under the server's name; other lines are prose.
        let field = line.starts_with("  ") && !line.starts_with("   ");
        match key.trim().to_ascii_lowercase().as_str() {
            "scope" if field => scope = Some(value.trim().to_owned()),
            "type" if field => kind = Some(value.trim().to_ascii_lowercase()),
            "status" | "issue" if field => {}
            "url" if field => {
                if url.replace(value.trim().to_owned()).is_some() {
                    return Some(json!({"name":name,"unparsed":true}));
                }
            }
            "command" => command = Some(value.trim().to_owned()),
            "args" => {
                let value = value.trim();
                if !value.is_empty() {
                    args = serde_json::from_str(value)
                        .unwrap_or_else(|_| value.split_whitespace().map(str::to_owned).collect());
                }
            }
            "environment" | "env" => {
                if let Ok(values) =
                    serde_json::from_str::<std::collections::BTreeMap<String, String>>(value.trim())
                {
                    env = values;
                }
            }
            _ if field => other = true,
            _ => {}
        }
    }
    // Only a user-scoped entry is the one installed: a project or local entry of the same
    // name shadows it, and can't vouch for (or be removed as) the user one.
    if scope.as_deref().is_some_and(|s| !s.to_ascii_lowercase().starts_with("user")) {
        return Some(json!({"name":name,"unparsed":true}));
    }
    if let Some(url) = url {
        if command.is_some() || kind.as_deref().is_some_and(|k| k != "http") {
            return Some(json!({"name":name,"unparsed":true}));
        }
        return Some(if other {
            json!({"name":name,"url":url,"modified":true})
        } else {
            json!({"name":name,"url":url})
        });
    }
    Some(json!({"name":name,"command":command?,"args":args,"env":env}))
}
pub(super) fn other_mcp_claim(home: &Path, spec: &Spec, name: &str) -> bool {
    find_peer_mcp_record(home, spec, name).is_some()
}
pub(super) fn mcp_get(
    spec: &Spec,
    name: &str,
) -> Result<Option<Value>, (&'static str, String, i32)> {
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
        // Claude Code 2.1.x has no --scope on `get`; it reports the server's scope itself.
        // Run it from the agent's config folder, not the caller's project, so a project or
        // local entry of the same name doesn't shadow the user one (the scope is checked too).
        cmd.args(["mcp", "get", name]);
        cmd.current_dir(if spec.root.is_dir() { spec.root.clone() } else { std::env::temp_dir() });
    } else {
        cmd.args(["mcp", "get", name, "--json"]);
    }
    let output = cmd.output().map_err(|_| {
        (
            "harness_cli_error",
            format!("Could not run configured {} CLI", spec.harness),
            4,
        )
    })?;
    if !output.status.success() {
        return Ok(None);
    }
    let parsed = parse_mcp_observation(&output.stdout, name)
        .unwrap_or_else(|| json!({"name":name,"unparsed":true}));
    Ok(Some(parsed))
}
pub(super) fn mcp_binary(spec: &Spec) -> std::ffi::OsString {
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
pub(super) fn run_mcp(
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
            let config = match &m.url {
                Some(url) => json!({"type":"http","url":url}),
                None => json!({"command":m.command,"args":m.args,"env":m.env}),
            };
            cmd.arg(serde_json::to_string(&config).unwrap());
        }
    } else {
        cmd.args(["mcp", action, name]);
        if let Some(m) = server {
            if let Some(url) = &m.url {
                cmd.arg("--url").arg(url);
            } else {
                for (key, value) in &m.env {
                    cmd.arg("--env").arg(format!("{key}={value}"));
                }
                cmd.arg("--").arg(&m.command).args(&m.args);
            }
        }
    }
    // Codex starts its own OAuth sign-in after adding a remote server that offers one. The
    // person completes it in their browser, so its output is theirs to see; it is bounded so
    // a sign-in nobody finishes can't hang the caller. The CLI never sees the tokens.
    if spec.harness == "codex" && action == "add" && server.is_some_and(|m| m.url.is_some()) {
        let mut child = cmd
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::inherit())
            .stderr(std::process::Stdio::inherit())
            .spawn()
            .map_err(|_| ("harness_cli_error", "Could not run configured codex CLI".to_string(), 4))?;
        let deadline = std::time::Instant::now() + CODEX_SIGN_IN_WAIT;
        let status = loop {
            if let Some(status) = child.try_wait().map_err(|e| ("harness_cli_error", e.to_string(), 4))? {
                break Some(status);
            }
            if std::time::Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        };
        return match status {
            Some(s) if s.success() => Ok(()),
            _ => Err((
                "mcp_refused",
                format!("codex didn't finish adding MCP server {name} (or its sign-in)"),
                4,
            )),
        };
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
