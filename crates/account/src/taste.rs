//! Account taste refresh and explicit design-call capture. Context never loads credentials.
use crate::config::Account;
use crate::http::ApiError;
use crate::session::{now, Session, SessionError};
use crate::store::{write_private, State, Store};
use impeccable_common::Io;
use impeccable_context::taste;
use serde_json::{json, Value};

/// The read fetches only the person's own preferences, so a telemetry
/// opt-out does not stop it; only its own switch does.
fn opted_out(io: &Io) -> bool {
    taste::disabled(&io.env)
}

/// Credential-free gate, called only from ordinary router entrypoints.
pub fn wanted(io: &Io) -> bool {
    wanted_for(io, None)
}

pub fn wanted_for(io: &Io, focus: Option<&str>) -> bool {
    // No detached work in CI; an explicit `taste-refresh` still runs there.
    if opted_out(io) || io.env.get("CI").is_some_and(|v| !v.is_empty()) { return false; }
    let Ok(account) = Account::from_env(&io.env) else { return false; };
    if !Store::new(&account).state().is_some_and(|s| s.signed_in && s.taste) {
        return false;
    }
    taste::read(&account.home.join(taste::cache_name(focus))).is_none_or(|v| {
        v["repository"].as_str() != crate::health::github_repository(&io.cwd.to_string_lossy()).as_deref()
            || v["issuer"] != account.issuer
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
    let repository_rules = if state == "ready" { taste::rules(&body["repositoryRules"]) } else { vec![] };
    let say = body["say"].as_str().unwrap_or_default().chars().filter(|c| !c.is_control())
        .collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ");
    // The HTTP validator is the server's revision. Servers without one still
    // get a stable content revision, independent of fetchedAt and cache location.
    let rev = etag.clone().filter(|v| !v.is_empty()).unwrap_or_else(|| {
        use sha2::{Digest, Sha256};
        Sha256::digest(json!([state, rules, repository_rules, say, state == "ready" && body["paused"] == true]).to_string().as_bytes())
            .iter().map(|b| format!("{b:02x}")).collect()
    });
    Some(json!({
        "version": 1, "fetchedAt": now(), "etag": etag.unwrap_or_default(),
        "issuer": issuer, "state": state, "rules": rules,
        "repositoryRules": repository_rules, "say": say, "rev": rev,
        // Ready with the person's own taste paused: only the repository's rules apply.
        "paused": state == "ready" && body["paused"] == true,
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

#[derive(Debug, PartialEq, Eq)]
enum Held {
    /// Signed out or signed in again: the copy belongs to that sign-in now.
    Replaced,
    /// The same sign-in lost `taste:read` (a renewal dropped it): its copy goes.
    Revoked,
    Current,
}

/// What the worker may do with the copy once it holds the lock.
fn held(before: &State, now: Option<&State>) -> Held {
    match now {
        Some(s) if s.signed_in && s.login == before.login => {
            if s.taste { Held::Current } else { Held::Revoked }
        }
        _ => Held::Replaced,
    }
}

/// Hidden detached worker: silent and best effort, including argument errors.
pub fn run_refresh(args: &[String], io: &mut Io) -> i32 {
    let focus = match args {
        [] => None,
        [flag, value] if flag == "--focus" && matches!(value.as_str(), "web" | "slides" | "motion") => Some(value.as_str()),
        _ => return 0,
    };
    if !opted_out(io) { let _ = refresh(focus, io); }
    0
}

const LOGIN: &str = "Run impeccable login to sign in with taste access.";

/// Foreground reads and the detached worker share validators, fallback and locks.
fn refresh(focus: Option<&str>, io: &Io) -> Result<Value, String> {
    let repository = crate::health::github_repository(&io.cwd.to_string_lossy());
    let account = Account::from_env(&io.env)?;
    let store = Store::new(&account);
    let state = store.state().filter(|s| s.signed_in && s.taste).ok_or(LOGIN)?;
    let mut session = load_session(&account).ok_or(LOGIN)?;
    if !session.state.taste || session.state.login != state.login { return Err(LOGIN.into()); }
    let path = account.home.join(taste::cache_name(focus));
    let snapshot = taste::read(&path);
    let previous = snapshot.clone().filter(|v| v["issuer"] == account.issuer && v["repository"].as_str() == repository.as_deref());
    // Upgrade pre-foreground caches with a full response so say and rev exist.
    // A cache written before `paused` existed fetches one full reply, so a pause isn't hidden behind 304s.
    let etag = previous.as_ref().filter(|v| v["say"].is_string() && v["rev"].is_string() && v["paused"].is_boolean())
        .and_then(|v| v["etag"].as_str());
    let mut url = url::Url::parse(&format!("{}/cli/v1/taste?limit=12", account.issuer)).unwrap();
    if let Some(repository) = &repository { url.query_pairs_mut().append_pair("repository", repository); }
    let whole_url = url.clone();
    if let Some(focus) = focus { url.query_pairs_mut().append_pair("focus", focus); }
    let mut answer = session.call(|c, token| c.get_taste(url.as_str(), token, etag));
    if focus.is_some() && matches!(&answer, Err(SessionError::Api(ApiError::Status { status: 400, code })) if code.as_deref() == Some("focus")) {
        // No focused validator on the whole-taste fallback.
        answer = session.call(|c, token| c.get_taste(whole_url.as_str(), token, None));
    }
    // Order installation/deletion with logout and reject a replaced sign-in.
    let lock = store.lock()?;
    match held(&state, store.state().as_ref()) {
        Held::Replaced => return Err(LOGIN.into()),
        Held::Revoked => {
            store.clear_taste(&lock);
            return Err(LOGIN.into());
        }
        Held::Current => {}
    }
    // Another issuer under this home shares the file: order with its changes.
    let taste_lock = Store::taste_lock_for(&account.home, std::time::Duration::from_secs(3))?;
    if !reply_is_current(snapshot.as_ref(), taste::read(&path).as_ref()) {
        return Err("Taste changed while reading; run impeccable taste again.".into());
    }
    let next = match answer {
        Ok((200, etag, body)) => cache(&body, &account.issuer, etag).ok_or_else(|| "The account service returned invalid taste.".to_string()),
        Ok((304, _, _)) => previous.map(|mut v| { v["fetchedAt"] = now().into(); v }).ok_or_else(|| "No cached taste for this revision.".to_string()),
        Err(SessionError::Api(ApiError::Status { status: 403 | 404, .. })) => {
            store.clear_taste_holding(&taste_lock);
            return Err(LOGIN.into());
        }
        Err(SessionError::NotSignedIn | SessionError::Expired | SessionError::Api(ApiError::Status { status: 401, .. })) => return Err(LOGIN.into()),
        Err(error) => return Err(error.to_string()),
        _ => return Err("The account service returned invalid taste.".into()),
    }?;
    let mut next = next;
    next["repository"] = json!(repository);
    write_private(&path, next.to_string().as_bytes())?;
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_change_to_paused_alone_changes_the_revision() {
        let body = json!({"version":1, "state":"ready", "rules":[], "say":""});
        let mut paused = body.clone();
        paused["paused"] = json!(true);
        assert_ne!(cache(&body, "https://i.invalid", None).unwrap()["rev"], cache(&paused, "https://i.invalid", None).unwrap()["rev"]);
    }

    #[test]
    fn cached_revisions_are_stable_and_keep_the_say_line() {
        let body = json!({"version":1, "state":"ready", "rules":[], "say":"Applied your taste: <rule>"});
        let first = cache(&body, "https://i.invalid", None).unwrap();
        assert_eq!(cache(&body, "https://i.invalid", None).unwrap()["rev"], first["rev"]);
        assert_eq!(first["say"], body["say"]);
        let mut changed = body.clone();
        changed["repositoryRules"] = json!([{"id":"r", "direction":"prefer", "text":"Square"}]);
        assert_ne!(cache(&changed, "https://i.invalid", None).unwrap()["rev"], first["rev"]);
        assert_eq!(cache(&body, "https://i.invalid", Some("\"v1\"".into())).unwrap()["rev"], "\"v1\"");
    }

    #[test]
    fn note_payload_has_stable_events_and_validates_lengths() {
        let (io, _) = Io::captured("", std::env::temp_dir(), Default::default());
        let mut args: Vec<String> = ["note", "--chose", "Square", "--rule", "Keep corners square", "--repository", "owner/repo"].map(String::from).into();
        let first = note_body(&args, &io).unwrap();
        assert_eq!(note_body(&args, &io).unwrap(), first);
        assert_eq!(first.as_object().unwrap().len(), 4);
        assert_eq!(first["event"].as_str().unwrap().len(), 64);
        args.extend(["--over", "Round"].map(String::from));
        assert_ne!(note_body(&args, &io).unwrap()["event"], first["event"]);
        args.extend(["--event", "explicit"].map(String::from));
        assert_eq!(note_body(&args, &io).unwrap()["event"], "explicit");
        for (flag, max) in [("--event", 120), ("--chose", 200), ("--rule", 240), ("--over", 200), ("--repository", 201)] {
            let mut long = args.clone();
            long.extend([flag.into(), "é".repeat(max + 1)]);
            assert!(note_body(&long, &io).unwrap_err().contains(&max.to_string()));
        }
    }

    #[test]
    fn a_lost_grant_clears_only_the_same_sign_ins_copy() {
        let state = |signed_in: bool, login: u64, taste: bool| -> State {
            serde_json::from_value(json!({
                "schema": 1, "issuer": "https://i.invalid", "generation": 4,
                "signed_in": signed_in, "backend": "file", "token_endpoint": "",
                "login": login, "taste": taste,
            }))
            .unwrap()
        };
        let before = state(true, 2, true);
        assert_eq!(held(&before, Some(&state(true, 2, true))), Held::Current);
        assert_eq!(held(&before, Some(&state(true, 2, false))), Held::Revoked);
        assert_eq!(held(&before, Some(&state(true, 3, false))), Held::Replaced);
        assert_eq!(held(&before, Some(&state(true, 3, true))), Held::Replaced);
        assert_eq!(held(&before, Some(&state(false, 2, false))), Held::Replaced);
        assert_eq!(held(&before, None), Held::Replaced);
    }

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

const USAGE: &str = "Usage: impeccable taste [--focus web|slides|motion] [--since <rev>] [--json]\n       impeccable taste note --chose <text> --rule <text> [--over <text>] [--repository owner/name] [--event <id>] [--json]\n";

pub(crate) fn valid_repository(value: &str) -> bool {
    let parts: Vec<_> = value.split('/').collect();
    value.len() <= 201 && parts.len() == 2 && parts.iter().all(|s| !s.is_empty()
        && *s != "." && *s != ".." && s.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b)))
}

pub fn run(args: &[String], io: &mut Io) -> i32 {
    if args.iter().any(|a| matches!(a.as_str(), "--help" | "-h")) {
        io.out(USAGE);
        return 0;
    }
    if args.first().is_none_or(|arg| arg != "note") { return run_read(args, io); }
    let result = note(args, io);
    match result {
        Ok(value) => {
            if args.iter().any(|a| a == "--json") {
                io.out(&format!("{value}\n"));
            } else {
                let line = match value["outcome"].as_str().unwrap_or_default() {
                    "recorded" => "recorded",
                    "duplicate" => "already recorded",
                    "paused" => "paused (taste capture is paused for your account)",
                    "full" => "full",
                    _ => unreachable!(),
                };
                io.out(&format!("{line}\n"));
            }
            0
        }
        Err(message) => { io.err(&format!("{message}\n")); 1 }
    }
}

fn run_read(args: &[String], io: &mut Io) -> i32 {
    let result = read_command(args, io);
    match result {
        Ok(value) => {
            if args.iter().any(|a| a == "--json") {
                io.out(&format!("{value}\n"));
            } else if let Some(line) = value.as_str() {
                io.out(&format!("{line}\n"));
            } else if value["unchanged"] == true {
                io.out(&format!("Taste rules are unchanged (rev: {}).\n", value["rev"].as_str().unwrap_or_default()));
            } else {
                if value["state"] != "ready" { io.out(&format!("Taste is {}.\n", value["state"].as_str().unwrap_or("off"))); }
                // The person paused their own taste; the repository's rules still apply.
                if value["paused"] == true { io.out("Your own taste is paused; these are this repository's rules.\n"); }
                for rule in taste::rules(&value["rules"]).into_iter().chain(taste::rules(&value["repositoryRules"])) {
                    let label = if rule["direction"] == "prefer" { "Prefer" } else { "Avoid" };
                    io.out(&format!("- {label}: {}\n", rule["text"].as_str().unwrap_or_default()));
                }
                if let Some(say) = value["say"].as_str().filter(|s| !s.is_empty()) { io.out(&format!("{say}\n")); }
                io.out(&format!("rev: {}\n", value["rev"].as_str().unwrap_or_default()));
            }
            0
        }
        Err(message) => { io.err(&format!("{message}\n")); 1 }
    }
}

fn read_command(args: &[String], io: &Io) -> Result<Value, String> {
    let focus = taste::explicit_focus(args).map_err(str::to_string)?;
    let mut since = None;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--json" => {},
            "--focus" => { i += 1; },
            "--since" => {
                i += 1;
                since = Some(args.get(i).filter(|v| !v.is_empty() && !v.starts_with("--"))
                    .ok_or("--since requires a revision.")?.as_str());
            }
            arg if arg.starts_with("--focus=") => {},
            arg if arg.starts_with("--since=") => {
                since = Some(arg.strip_prefix("--since=").filter(|v| !v.is_empty()).ok_or("--since requires a revision.")?);
            }
            _ => return Err(USAGE.trim().into()),
        }
        i += 1;
    }
    if opted_out(io) { return Ok(json!("Taste is off.")); }
    let account = Account::from_env(&io.env)?;
    let state = Store::new(&account).state().filter(|s| s.signed_in).ok_or(LOGIN)?;
    if !state.taste { return Ok(json!("Taste is off.")); }
    let value = refresh(focus, io)?;
    if value["state"] == "paused" { return Ok(json!("Taste is off.")); }
    let rev = &value["rev"];
    if rev.as_str().is_some_and(|rev| Some(rev) == since) {
        return Ok(json!({"unchanged":true, "rev":rev}));
    }
    Ok(json!({"state":value["state"], "rules":value["rules"],
        "repositoryRules":value["repositoryRules"], "say":value["say"], "rev":rev,
        "paused":value["paused"] == true}))
}

fn note_body(args: &[String], io: &Io) -> Result<Value, String> {
    use sha2::{Digest, Sha256};
    if args[0] != "note" { return Err(USAGE.trim().into()); }
    let mut body = json!({});
    let mut i = 1;
    while i < args.len() {
        if args[i] == "--json" { i += 1; continue; }
        let (flag, inline) = args[i].split_once('=').map_or((args[i].as_str(), None), |(k, v)| (k, Some(v)));
        let (key, max) = match flag {
            "--chose" => ("chose", 200), "--rule" => ("rule", 240),
            "--over" => ("over", 200), "--repository" => ("repository", 201), "--event" => ("event", 120),
            _ => return Err(format!("Unknown option: {}\n{USAGE}", args[i])),
        };
        let value = match inline {
            Some(v) => v,
            None => { i += 1; args.get(i).filter(|v| !v.starts_with("--")).map(String::as_str)
                .ok_or_else(|| format!("{flag} requires a value."))? }
        };
        if value.trim().is_empty() || value.chars().count() > max {
            return Err(format!("{flag} must contain 1 to {max} characters."));
        }
        if key == "repository" && !valid_repository(value) { return Err("--repository must be owner/name (at most 201 characters).".into()); }
        body[key] = value.into();
        i += 1;
    }
    for key in ["chose", "rule"] {
        if body.get(key).is_none() { return Err(format!("--{key} is required.")); }
    }
    if body.get("repository").is_none() {
        if let Some(repository) = crate::health::github_repository(&io.cwd.to_string_lossy()) { body["repository"] = repository.into(); }
    }
    if body.get("event").is_none() {
        // A serialized tuple preserves field boundaries and distinguishes absent values.
        let bytes = serde_json::to_vec(&json!([body["chose"], body["rule"], body["over"], body["repository"]])).unwrap();
        body["event"] = Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect::<String>().into();
    }
    Ok(body)
}

fn note(args: &[String], io: &Io) -> Result<Value, String> {
    let body = note_body(args, io)?;
    if opted_out(io) { return Err("Taste is disabled by IMPECCABLE_NO_TASTE.".into()); }
    let login = "Run impeccable login to sign in with taste access.";
    let account = Account::from_env(&io.env)?;
    let mut session = Session::load_quietly(&account).map_err(|e| match e {
        SessionError::NotSignedIn | SessionError::Expired => login.to_string(),
        _ => e.to_string(),
    })?;
    if !session.state.scopes.iter().any(|s| s == "taste:write") { return Err(login.into()); }
    let url = format!("{}/cli/v1/taste/calls", account.issuer);
    let value = session.call(|c, token| c.post_json(&url, token, body.clone())).map_err(|e| match e {
        SessionError::NotSignedIn | SessionError::Expired | SessionError::Api(ApiError::Status { status: 401 | 403, .. }) => login.to_string(),
        _ => e.to_string(),
    })?;
    if !matches!(value["outcome"].as_str(), Some("recorded" | "duplicate" | "paused" | "full")) {
        return Err("The account service returned an invalid taste outcome.".into());
    }
    Ok(value)
}
