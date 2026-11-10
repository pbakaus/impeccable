//! Opt-in uploads of newly saved critique reports. No retries, output or hook integration.
use crate::config::{impeccable_home, Account};
use crate::http::{ApiError, Client};
use crate::session::{Session, SessionError};
use impeccable_common::Io;
use impeccable_context::critique_storage::Snapshot;
use serde_json::{json, Value};
use std::time::{Duration, Instant};

pub const CRITIQUE_SYNC_DEFAULT_ON: bool = false;

fn enabled(io: &Io) -> bool {
    let Some(home) = impeccable_home(&io.env) else {
        return false;
    };
    match std::fs::read(home.join("critiques.json")) {
        Ok(bytes) => serde_json::from_slice::<Value>(&bytes)
            .ok()
            .and_then(|v| v.get("sync").and_then(Value::as_bool))
            .unwrap_or(false),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => CRITIQUE_SYNC_DEFAULT_ON,
        Err(_) => false,
    }
}

/// Uses only saved metadata. Missing heuristic detail stays null, never inferred from prose.
fn payload(snapshot: &Snapshot) -> Option<Value> {
    let m = &snapshot.meta;
    let total = m.get("total_score")?.as_u64()?;
    let max = m.get("max_score")?.as_u64()?;
    // The storage parser reads a single N/A index as a number, a list as text.
    let na: Vec<u64> = match m.get("na_heuristics")? {
        Value::Number(n) => vec![n.as_u64()?],
        Value::String(s) if s.is_empty() => vec![],
        Value::String(s) => s
            .split(',')
            .map(|s| s.trim().parse().ok())
            .collect::<Option<_>>()?,
        _ => return None,
    };
    let unique: std::collections::HashSet<_> = na.iter().collect();
    if na.len() > 9
        || unique.len() != na.len()
        || na.iter().any(|n| !(1..=10).contains(n))
        || max != 4 * (10 - na.len() as u64)
        || total > max
    {
        return None;
    }
    let count = |k| m.get(k).and_then(Value::as_u64).filter(|n| *n <= 100);
    let p0 = count("p0_count")?;
    let p1 = count("p1_count")?;
    // Snapshot.body is the complete saved file, including its local-only frontmatter.
    let (_, rest) = snapshot.body.split_once("\n---")?;
    let body = rest.strip_prefix('\n')?;
    if body.trim().is_empty() || body.len() > 64 * 1024 || body.contains('\0') {
        return None;
    }
    let target = m.get("target")?.as_str()?;
    if target.trim().is_empty()
        || target.chars().count() > 200
        || target.chars().any(char::is_control)
    {
        return None;
    }
    let mut random = [0u8; 16];
    use ring::rand::{SecureRandom, SystemRandom};
    SystemRandom::new().fill(&mut random).ok()?;
    random[6] = (random[6] & 15) | 64;
    random[8] = (random[8] & 63) | 128;
    let h: String = random.iter().map(|b| format!("{b:02x}")).collect();
    let id = format!(
        "{}-{}-{}-{}-{}",
        &h[..8],
        &h[8..12],
        &h[12..16],
        &h[16..20],
        &h[20..]
    );
    let stamp = m.get("timestamp")?.as_str()?;
    if stamp.len() != 20 || !stamp.is_ascii() {
        return None;
    }
    let created_at = format!("{}:{}:{}Z", &stamp[..13], &stamp[14..16], &stamp[17..19]);
    Some(json!({
        "version": 1, "critiqueId": id, "createdAt": created_at,
        "target": target, "score": { "total": total, "max": max }, "na": na,
        "heuristics": null, "counts": { "p0": p0, "p1": p1, "p2": count("p2_count"), "p3": count("p3_count") },
        "body": body
    }))
}

pub fn after_save(io: &Io, snapshot: &Snapshot) {
    let started = Instant::now();
    if !enabled(io)
        || io.env.get("CI").is_some_and(|v| !v.is_empty())
        || impeccable_context::telemetry::opt_out_reason(&io.env, &io.cwd.to_string_lossy())
            .is_some()
    {
        return;
    }
    let Ok(account) = Account::from_env(&io.env) else {
        return;
    };
    let Some(state) = crate::store::Store::new(&account).state() else {
        return;
    };
    if !state.signed_in
        || !state
            .scopes
            .split_whitespace()
            .any(|s| s == crate::oauth::CRITIQUES_SCOPE)
    {
        return;
    }
    let Some(mut body) = payload(snapshot) else {
        return;
    };
    // Also honor an opt-out at the report's project root.
    let root = std::path::Path::new(&snapshot.path)
        .parent()
        .and_then(|p| p.parent())
        .and_then(|p| p.parent());
    if let Some(root) = root {
        if impeccable_context::telemetry::opt_out_reason(&io.env, &root.to_string_lossy()).is_some()
        {
            return;
        }
        if let Some(key) = crate::health::critique_repo_key(&root.to_string_lossy(), &io.env) {
            body["repoKey"] = key.into();
        }
    }
    let Some(wait) = Duration::from_secs(2).checked_sub(started.elapsed()) else {
        return;
    };
    let Some(session) = Session::load_for_upload(&account, wait) else {
        return;
    };
    let Some(token) = session.existing_access_token() else {
        return;
    };
    if !enabled(io) {
        return;
    }
    let Some(left) = Duration::from_secs(2)
        .checked_sub(started.elapsed())
        .filter(|d| !d.is_zero())
    else {
        return;
    };
    let _ = Client::with_deadline(&account, left).post_json(
        &format!("{}/cli/v1/critiques", account.issuer),
        token,
        body,
    );
}

pub fn run(args: &[String], io: &mut Io) -> i32 {
    let choice = args.first().map(String::as_str).unwrap_or("status");
    if args.len() > 1 || !["status", "on", "off", "forget"].contains(&choice) {
        io.err("usage: impeccable critiques [status|on|off|forget]\n");
        return 1;
    }
    if choice == "status" {
        io.out(if enabled(io) {
            "Critique sync: on.\n"
        } else {
            "Critique sync: off.\n"
        });
        return 0;
    }
    let save = impeccable_home(&io.env)
        .ok_or_else(|| "no home directory; set IMPECCABLE_HOME".to_string())
        .and_then(|home| {
            std::fs::create_dir_all(&home).map_err(|e| e.to_string())?;
            crate::store::write_private(
                &home.join("critiques.json"),
                json!({"sync": choice == "on"}).to_string().as_bytes(),
            )
        });
    if save.is_err() {
        io.err("Critique sync: couldn't save the setting.\n");
        return 1;
    }
    if choice != "forget" {
        io.out(if choice == "on" {
            "Critique sync: on. Saved report contents will be uploaded.\n"
        } else {
            "Critique sync: off.\n"
        });
        return 0;
    }
    let result = Account::from_env(&io.env)
        .map_err(SessionError::Local)
        .and_then(|account| {
            let url = format!("{}/cli/v1/critiques/forget", account.issuer);
            Session::load(&account)
                .and_then(|mut s| s.call(|c, token| c.post_json(&url, token, json!({}))))
        });
    match result {
        Ok(_) => {
            io.out("Critique history deleted; sync is off.\n");
            0
        }
        Err(SessionError::Api(ApiError::Status { status: 404, .. })) => 0,
        Err(_) => {
            io.err("Critique sync is off; deletion couldn't be confirmed. Run `impeccable critiques forget` again after signing in.\n");
            1
        }
    }
}
