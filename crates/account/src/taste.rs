//! Account taste refresh and best-effort foreground writes. Context itself never loads credentials.
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

/// Use the same credential and renewal mode as setup and critique workers.
pub(crate) fn load_session(account: &Account) -> Option<Session> {
    Session::load_for_upload(account, std::time::Duration::from_secs(2))
}

// Compare the full snapshot as well as its validators: two replies can land in
// the same second, and a pause need not carry a different ETag.
fn reply_is_current(previous: Option<&Value>, current: Option<&Value>) -> bool {
    previous == current
}

/// Hidden detached worker: silent and best effort, including argument errors.
pub fn run_refresh(args: &[String], io: &mut Io) -> i32 {
    if !args.is_empty() || opted_out(io) { return 0; }
    let Ok(account) = Account::from_env(&io.env) else { return 0; };
    let store = Store::new(&account);
    let Some(state) = store.state().filter(|s| s.signed_in && s.taste) else { return 0; };
    let Some(mut session) = load_session(&account) else { return 0; };
    if !session.state.taste || session.state.login != state.login { return 0; }
    let path = account.home.join("taste.json");
    let snapshot = taste::read(&path);
    let previous = snapshot.clone().filter(|v| v["issuer"] == account.issuer);
    let etag = previous.as_ref().and_then(|v| v["etag"].as_str());
    let url = format!("{}/cli/v1/taste?limit=12", account.issuer);
    let answer = session.call(|c, token| c.get_taste(&url, token, etag));
    // Order installation/deletion with logout and reject a replaced sign-in.
    let Ok(_lock) = store.lock() else { return 0; };
    if !store.state().is_some_and(|s| s.signed_in && s.taste && s.login == state.login) {
        return 0;
    }
    if !reply_is_current(snapshot.as_ref(), taste::read(&path).as_ref()) {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn late_replies_cannot_replace_changed_or_deleted_copies() {
        let ready = json!({"etag":"v1", "fetchedAt":1, "state":"ready"});
        assert!(reply_is_current(None, None));
        assert!(reply_is_current(Some(&ready), Some(&ready)));
        assert!(!reply_is_current(Some(&ready), None));
        assert!(!reply_is_current(None, Some(&ready)));
        for (key, value) in [("etag", json!("v2")), ("fetchedAt", json!(2)), ("state", json!("paused"))] {
            let mut newer = ready.clone();
            newer[key] = value;
            assert!(!reply_is_current(Some(&ready), Some(&newer)), "{key}");
        }
    }
}

const USAGE: &str = "Usage: impeccable taste call --kind variant|agent --chose <text> [--over <text>] [--rule <sentence>] [--event <id>] [--json]\n       impeccable taste used --where build|critique <rule id>... [--json]\n";

fn digest_id(prefix: &str, parts: &[&str]) -> String {
    use sha2::{Digest, Sha256};
    let mut hash = Sha256::new();
    for part in parts {
        hash.update((part.len() as u64).to_be_bytes());
        hash.update(part.as_bytes());
    }
    let hex: String = hash.finalize()[..16].iter().map(|b| format!("{b:02x}")).collect();
    format!("{prefix}-{hex}")
}

fn project_root(io: &Io) -> String {
    let cwd = io.cwd.to_string_lossy().into_owned();
    // Read git boundaries directly, including linked worktrees, without spawning git.
    for dir in io.cwd.ancestors() {
        if impeccable_common::git::git_dir(&dir.to_string_lossy()).is_some() {
            return dir.to_string_lossy().into_owned();
        }
    }
    cwd
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64
        && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn parse_write(args: &[String], root: &str) -> Result<(&'static str, Value, bool), &'static str> {
    let command = args.first().map(String::as_str).ok_or("choose call or used")?;
    if !matches!(command, "call" | "used") { return Err("choose call or used"); }
    let mut flags = std::collections::HashMap::new();
    let mut ids = Vec::new();
    let mut json_output = false;
    let mut i = 1;
    while i < args.len() {
        let key = args[i].as_str();
        if key == "--json" { json_output = true; i += 1; continue; }
        let allowed = if command == "call" {
            matches!(key, "--kind" | "--chose" | "--over" | "--rule" | "--event")
        } else { key == "--where" };
        if allowed {
            let value = args.get(i + 1).filter(|v| !v.starts_with("--"))
                .ok_or("missing flag value")?;
            flags.insert(key, value.as_str());
            i += 2;
        } else if command == "used" {
            if valid_id(key) { ids.push(key); }
            i += 1;
        } else { return Err("unknown argument"); }
    }
    if command == "used" {
        let where_ = flags.get("--where").copied().unwrap_or("");
        if !matches!(where_, "build" | "critique") { return Err("--where must be build or critique"); }
        ids.truncate(40);
        return Ok(("uses", json!({"where":where_,"rules":ids}), json_output));
    }
    let kind = flags.get("--kind").copied().unwrap_or("");
    if !matches!(kind, "variant" | "agent") { return Err("--kind must be variant or agent"); }
    let text = |key: &str, max: usize| taste::sanitize(flags.get(key).copied().unwrap_or(""))
        .chars().take(max).collect::<String>().trim().to_string();
    let chose = text("--chose", 200);
    let over = text("--over", 200);
    let rule = text("--rule", 240);
    if chose.is_empty() { return Err("--chose is required"); }
    if kind == "agent" && rule.is_empty() { return Err("--rule is required for agent calls"); }
    let event = if flags.contains_key("--event") {
        let event = text("--event", 120);
        if event.is_empty() { return Err("--event must not be empty"); }
        event
    } else { digest_id("call", &[kind, &chose, &over, &rule, root]) };
    let mut body = json!({"event":event,"kind":kind,"chose":chose});
    if flags.contains_key("--over") { body["over"] = over.into(); }
    if flags.contains_key("--rule") { body["rule"] = rule.into(); }
    Ok(("calls", body, json_output))
}

/// Foreground, best-effort taste writes. No upload outlives this command.
pub fn run(args: &[String], io: &mut Io) -> i32 {
    use std::time::{Duration, Instant};
    if args.iter().any(|a| a == "--help" || a == "-h") {
        io.out(USAGE);
        return 0;
    }
    let started = Instant::now();
    let root = project_root(io);
    let (route, mut body, json_output) = match parse_write(args, &root) {
        Ok(parsed) => parsed,
        Err(error) => { io.err(&format!("Taste: {error}.\n")); return 1; }
    };
    if io.env.contains_key("IMPECCABLE_NO_TASTE")
        || impeccable_context::telemetry::opt_out_reason(&io.env, &root).is_some()
        || (route == "uses" && body["rules"].as_array().is_none_or(|r| r.is_empty()))
    { return 0; }
    let Ok(account) = Account::from_env(&io.env) else { return 0; };
    if !Store::new(&account).state().is_some_and(|s| s.signed_in && s.taste_write) { return 0; }
    // Foreground commands may read the ordinary credential backend, just as health does.
    let read_account = account.clone();
    let Some(Ok(session)) = crate::session::read_within(Duration::from_secs(1), move || Session::load(&read_account))
        else { return 0; };
    if !session.state.taste_write { return 0; }
    // Short best-effort writes never risk a token rotation with a truncated deadline.
    let Some(token) = session.existing_access_token() else { return 0; };
    if route == "uses" {
        let home = impeccable_context::util::homedir(&io.env);
        let Some(salt) = impeccable_common::seed::salt(&home, Some(&root), io.env.get("IMPECCABLE_SEED_SALT").map(String::as_str))
            else { return 0; };
        let date = impeccable_context::util::iso_now();
        body["session"] = digest_id("use", &[&root, &date[..10], &salt]).into();
    }
    let Some(left) = Duration::from_secs(3).checked_sub(started.elapsed()).filter(|d| !d.is_zero())
        else { return 0; };
    let client = crate::http::Client::with_deadline(&account, left);
    let Ok(reply) = client.post_taste(&format!("{}/cli/v1/taste/{route}", account.issuer), token, body)
        else { return 0; };
    let line = if route == "calls" {
        match reply["outcome"].as_str() {
            Some("recorded") => "Taste: recorded.".to_string(),
            Some("duplicate") => "Taste: already recorded.".to_string(),
            Some("paused") => "Taste: learning is paused, nothing stored.".to_string(),
            Some("full") => "Taste: today's limit is reached, nothing stored.".to_string(),
            _ => return 0,
        }
    } else {
        let Some(count) = reply["counted"].as_u64() else { return 0; };
        if count == 0 && !json_output { return 0; }
        format!("Taste: noted {count} rule(s) applied.")
    };
    io.out(&format!("{}\n", if json_output { reply.to_string() } else { line }));
    0
}
