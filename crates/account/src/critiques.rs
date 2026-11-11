//! Opt-in uploads of newly saved critique reports. No retries, output or hook integration.
use crate::config::{impeccable_home, Account};
use crate::http::Client;
use crate::session::{Session, SessionError};
use impeccable_common::Io;
use impeccable_context::critique_storage::SavedReport;
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
fn payload(snapshot: &SavedReport) -> Option<Value> {
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
    let body = &snapshot.body;
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

pub fn after_save(io: &Io, snapshot: &SavedReport) {
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
        if let Some((key, label)) = crate::health::critique_repo(&root.to_string_lossy(), &io.env) {
            body["repoKey"] = key.into();
            if let Some(label) = label {
                body["label"] = label.into();
            }
        }
    }
    if serde_json::to_vec(&body).map_or(true, |bytes| bytes.len() > 80 * 1024) {
        return;
    }
    let Some(wait) = Duration::from_secs(2).checked_sub(started.elapsed()) else {
        return;
    };
    let Some(session) = Session::load_for_upload(&account, wait) else {
        return;
    };
    let session = if session.existing_access_token().is_none() {
        let Some(fresh) = renew_for_upload(io, &account, started) else {
            return;
        };
        fresh
    } else {
        session
    };
    if !session
        .state
        .scopes
        .split_whitespace()
        .any(|s| s == crate::oauth::CRITIQUES_SCOPE)
    {
        return;
    }
    let Some(token) = session.existing_access_token() else {
        return;
    };
    let Ok(_admission) = crate::store::Store::critique_lock_for(&account.home, Duration::ZERO)
    else {
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
    let admission = impeccable_home(&io.env).and_then(|home| {
        crate::store::Store::critique_lock_for(&home, Duration::from_secs(3)).ok()
    });
    let Some(_admission) = admission else {
        io.err("Critique sync: couldn't save the setting.\n");
        return 1;
    };
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
        Ok(ref answer) if answer.get("forgot").and_then(Value::as_u64).is_some() => {
            io.out("Critique history deleted; sync is off.\n");
            0
        }
        _ => {
            io.err("Critique sync is off; deletion couldn't be confirmed. Run `impeccable critiques forget` again after signing in.\n");
            1
        }
    }
}

/// Only renewal runs independently. No body, upload request, or sync admission
/// is handed to this process. Once rotation starts it keeps the ordinary client
/// timeout and persists under the lifecycle lock even if the parent has exited.
fn renew_for_upload(io: &Io, account: &Account, started: Instant) -> Option<Session> {
    use std::process::{Command, Stdio};
    let mut command = Command::new(std::env::current_exe().ok()?);
    command
        .arg("critiques-refresh")
        .env_clear()
        .envs(&io.env)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    impeccable_common::proc::detach(&mut command);
    #[cfg(windows)]
    prevent_refresh_stdio_inheritance()?;
    let mut child = command.spawn().ok()?;
    loop {
        if child.try_wait().ok()?.is_some() {
            let left = Duration::from_secs(2).checked_sub(started.elapsed())?;
            return Session::load_for_upload(account, left);
        }
        if started.elapsed() >= Duration::from_secs(2) {
            // Reap when possible, but never kill a rotation in flight.
            let _ = std::thread::Builder::new().spawn(move || {
                let _ = child.wait();
            });
            return None;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}

/// Hidden renewal-only verb. A busy lifecycle lock skips renewal immediately.
pub fn run_refresh(args: &[String], io: &mut Io) -> i32 {
    if !args.is_empty() {
        return 1;
    }
    let Ok(account) = Account::from_env(&io.env) else {
        return 0;
    };
    let Some(mut session) = Session::load_for_upload(&account, Duration::from_secs(2)) else {
        return 0;
    };
    let _ = session.access_token_within(Duration::ZERO);
    0
}

/// A detached Windows child can inherit the CLI's original capture-pipe
/// handles even with its own stdio redirected to NUL. That keeps a harness's
/// output() waiting for EOF until renewal ends. Clearing only inheritance
/// leaves the parent's streams usable and keeps renewal independent of them.
#[cfg(windows)]
fn prevent_refresh_stdio_inheritance() -> Option<()> {
    use std::ffi::c_void;
    #[link(name = "kernel32")]
    extern "system" {
        fn GetStdHandle(kind: u32) -> *mut c_void;
        fn GetFileType(handle: *mut c_void) -> u32;
        fn SetHandleInformation(handle: *mut c_void, mask: u32, flags: u32) -> i32;
    }
    for kind in [-10i32, -11, -12] {
        // SAFETY: these are the three documented standard-handle selectors.
        // We change no ownership and clear only HANDLE_FLAG_INHERIT.
        unsafe {
            let handle = GetStdHandle(kind as u32);
            // Only capture pipes need EOF isolation; console handles are left alone.
            if !handle.is_null()
                && handle as isize != -1
                && GetFileType(handle) == 3
                && SetHandleInformation(handle, 1, 0) == 0
            {
                return None;
            }
        }
    }
    Some(())
}
