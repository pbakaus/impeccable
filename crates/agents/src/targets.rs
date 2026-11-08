use super::mcp::{find_peer_mcp_record, find_peer_mcp_record_from_journal};
use super::resources::block_body;
use super::*;

pub(super) fn targets(s: &Spec) -> Vec<PathBuf> {
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
pub(super) fn plan(
    s: &Spec,
    j: Option<&Journal>,
    home: &Path,
) -> Result<Value, (&'static str, String, i32)> {
    let mut resources = Vec::new();
    for path in targets(s) {
        let before = fs::read(&path).ok();
        let _physical = canonical_target(&path)?;
        let after = render(s, &path, before.as_deref())?;
        let change = match (&before, after.as_slice()) {
            (None, []) => "unchanged",
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
        let own = j.and_then(|journal| {
            journal
                .resources
                .iter()
                .find(|resource| resource.resource_id == mcp_resource_id(s, &server.name))
        });
        let peer = find_peer_mcp_record_from_journal(j, s, &server.name)
            .or_else(|| find_peer_mcp_record(home, s, &server.name));
        let observed = mcp_get(s, &server.name)?;
        let desired = mcp_config(server);
        let change = if own.is_some_and(|resource| resource.last_written_value == desired)
            || peer
                .as_ref()
                .is_some_and(|resource| resource.last_written_value == desired)
        {
            if observed.as_ref() == Some(&desired) {
                "unchanged"
            } else {
                "conflict"
            }
        } else if observed.is_some() {
            "conflict"
        } else {
            "create"
        };
        mcp_servers.push(json!({"name":server.name,"change":change}));
    }
    Ok(
        json!({"installation":s.root,"resources":resources,"mcpServers":mcp_servers,"previouslyApplied":j.is_some()}),
    )
}
pub(super) fn status(s: &Spec, j: Option<&Journal>) -> Result<Value, (&'static str, String, i32)> {
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
        json!({"installation":s.root,"installed":j.is_some(),"effective":!(s.harness=="codex"&&s.root.join("AGENTS.override.md").exists()),"manualActions":if s.harness=="codex"&&!s.hooks.is_empty(){vec!["Approve hooks via /hooks","Trust this folder"]}else{vec![]},"resources":resources}),
    )
}
pub(super) fn resource_matches(
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
        return Ok(mcp_get(s, name)?.as_ref() == Some(&resource.last_written_value));
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
