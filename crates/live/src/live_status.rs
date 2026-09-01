//! JS: live-status.mjs -> `impeccable live-status`. Durable recovery status,
//! with or without a running helper server.

use crate::live_resume::{
    manual_apply_resume_hint, mount_failure_action, render_summary, self_cmd,
};
use crate::paths::read_live_server_info;
use crate::roots::enter_live_root;
use crate::server::fetch_status;
use crate::session::create_live_session_store;
use crate::util::{json_pretty, println};
use impeccable_common::Io;
use serde_json::{json, Map, Value};

pub fn run(args: &[String], io: &mut Io) -> i32 {
    let mut argv: Vec<String> = args.to_vec();
    if let Err(code) = enter_live_root(&mut argv, io) {
        return code;
    }
    status_cli(io)
}

fn status_cli(io: &mut Io) -> i32 {
    let cwd = io.cwd.to_string_lossy().into_owned();
    let env = io.env.clone();
    let info = read_live_server_info(&cwd, &env).map(|(i, _)| i);
    let server: Option<Value> = info
        .as_ref()
        .and_then(|i| match (i.port, i.token.as_deref()) {
            (Some(p), Some(t)) => fetch_status(p, t),
            (Some(p), None) => fetch_status(p, "undefined"),
            _ => None,
        });
    let store = create_live_session_store(&cwd, &env, None);
    let active: Vec<Value> = store
        .list_active_sessions()
        .into_iter()
        .map(Value::Object)
        .collect();
    let manual_apply = find_pending_manual_apply(server.as_ref(), &active);
    let sessions: Vec<Value> = server
        .as_ref()
        .and_then(|s| s.get("activeSessions"))
        .and_then(|a| a.as_array())
        .cloned()
        .unwrap_or(active);
    let render_failure = sessions
        .iter()
        .find(|s| s.get("renderState").and_then(|r| r.as_str()) == Some("failed"))
        .cloned();
    let live_server = server.as_ref().map(|s| {
        json!({
            "status": s.get("status").cloned().unwrap_or(Value::Null),
            "port": s.get("port").cloned().unwrap_or(Value::Null),
            "connectedClients": s.get("connectedClients").cloned().unwrap_or(Value::Null),
            "agentPolling": s.get("agentPolling").cloned().unwrap_or(Value::Null),
            "pendingEvents": s.get("pendingEvents").cloned().unwrap_or(Value::Null),
        })
    });
    // JSON.stringify drops undefined members: strip absent keys.
    let live_server = live_server.map(|mut v| {
        if let (Some(obj), Some(src)) = (
            v.as_object_mut(),
            server.as_ref().and_then(|s| s.as_object()),
        ) {
            for k in [
                "status",
                "port",
                "connectedClients",
                "agentPolling",
                "pendingEvents",
            ] {
                if !src.contains_key(k) {
                    obj.shift_remove(k);
                }
            }
        }
        v
    });
    let render: Vec<Value> = sessions
        .iter()
        .map(|s| {
            let mut m = Map::new();
            m.insert("id".into(), s.get("id").cloned().unwrap_or(Value::Null));
            for (k, v) in render_summary(s.as_object()) {
                m.insert(k, v);
            }
            Value::Object(m)
        })
        .collect();
    let hint = recovery_hint(
        server.is_some(),
        manual_apply.as_ref(),
        render_failure.as_ref(),
        &self_cmd(io),
    );
    let payload = json!({
        "liveServer": live_server.unwrap_or(Value::Null),
        "activeSessions": sessions,
        "render": render,
        "recoveryHint": hint,
    });
    println(io, &json_pretty(&payload));
    0
}

fn recovery_hint(
    server_up: bool,
    manual_apply: Option<&Value>,
    render_failure: Option<&Value>,
    self_cmd: &str,
) -> Value {
    if let Some(m) = manual_apply {
        return Value::String(manual_apply_resume_hint(m.as_object(), self_cmd));
    }
    if let Some(r) = render_failure {
        return mount_failure_action(r.as_object(), self_cmd)
            .map(Value::String)
            .unwrap_or(Value::Null);
    }
    if server_up {
        return json!(format!("Run {} live-poll to continue pending work, or {} live-complete --id <session> after manual cleanup.", self_cmd, self_cmd));
    }
    json!(format!(
        "Start {} live-server to requeue pending durable events, then run {} live-poll.",
        self_cmd, self_cmd
    ))
}

fn find_pending_manual_apply(server: Option<&Value>, active: &[Value]) -> Option<Value> {
    if let Some(events) = server
        .and_then(|s| s.get("pendingEvents"))
        .and_then(|p| p.as_array())
    {
        if let Some(e) = events
            .iter()
            .find(|e| e.get("type").and_then(|t| t.as_str()) == Some("manual_edit_apply"))
        {
            return Some(e.clone());
        }
    }
    active
        .iter()
        .map(|s| s.get("pendingEvent").cloned().unwrap_or(Value::Null))
        .find(|e| e.get("type").and_then(|t| t.as_str()) == Some("manual_edit_apply"))
}
