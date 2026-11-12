//! Read-only account taste refresh. Context itself never loads credentials.
use crate::config::Account;
use crate::http::ApiError;
use crate::session::{now, Session, SessionError};
use crate::store::{write_private, Store};
use impeccable_common::Io;
use impeccable_context::taste;
use serde_json::{json, Value};

/// The read fetches only the person's own preferences, so a telemetry
/// opt-out does not stop it; only its own switch does.
fn opted_out(io: &Io) -> bool {
    taste::disabled(&io.env)
}

/// File-only gate, called only from ordinary router entrypoints.
pub fn wanted(io: &Io) -> bool {
    // No detached work in CI; an explicit `taste-refresh` still runs there.
    if opted_out(io) || io.env.get("CI").is_some_and(|v| !v.is_empty()) { return false; }
    let Ok(account) = Account::from_env(&io.env) else { return false; };
    if !Store::new(&account).state().is_some_and(|s| s.signed_in && s.taste) {
        return false;
    }
    taste::read(&account.home.join("taste.json")).is_none_or(|v| {
        v["issuer"] != account.issuer
            || v["fetchedAt"].as_u64().is_none_or(|t| t > now() || now().saturating_sub(t) > 60)
    })
}

fn cache(body: &Value, issuer: &str, etag: Option<String>) -> Option<Value> {
    let state = body["state"].as_str()?;
    if body["version"] != 1 || !matches!(state, "ready" | "empty" | "paused" | "plan")
        || !body["rules"].is_array()
    {
        return None;
    }
    let rules = if state == "ready" { taste::rules(&body["rules"]) } else { vec![] };
    Some(json!({
        "version": 1, "fetchedAt": now(), "etag": etag.unwrap_or_default(),
        "issuer": issuer, "state": state, "rules": rules,
    }))
}

/// Hidden detached worker: silent and best effort, including argument errors.
pub fn run_refresh(args: &[String], io: &mut Io) -> i32 {
    if !args.is_empty() || opted_out(io) { return 0; }
    let Ok(account) = Account::from_env(&io.env) else { return 0; };
    let store = Store::new(&account);
    let Some(state) = store.state().filter(|s| s.signed_in && s.taste) else { return 0; };
    let Ok(mut session) = Session::load(&account) else { return 0; };
    if !session.state.taste || session.state.login != state.login { return 0; }
    let path = account.home.join("taste.json");
    let previous = taste::read(&path).filter(|v| v["issuer"] == account.issuer);
    let etag = previous.as_ref().and_then(|v| v["etag"].as_str());
    let url = format!("{}/cli/v1/taste?limit=12", account.issuer);
    let answer = session.call(|c, token| c.get_taste(&url, token, etag));
    // Order installation/deletion with logout and reject a replaced sign-in.
    let Ok(_lock) = store.lock() else { return 0; };
    if !store.state().is_some_and(|s| s.signed_in && s.taste && s.login == state.login) {
        return 0;
    }
    let next = match answer {
        Ok((200, etag, body)) => cache(&body, &account.issuer, etag),
        Ok((304, _, _)) => previous.map(|mut v| { v["fetchedAt"] = now().into(); v }),
        Err(SessionError::Api(ApiError::Status { status: 403 | 404, .. })) => {
            let _ = std::fs::remove_file(path);
            return 0;
        }
        _ => None,
    };
    if let Some(next) = next {
        let _ = write_private(&path, next.to_string().as_bytes());
    }
    0
}
