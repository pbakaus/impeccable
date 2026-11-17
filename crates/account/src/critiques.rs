//! Uploads of newly saved critique reports. No retries or hook integration.
use crate::config::{impeccable_home, Account};
use crate::http::Client;
use crate::session::{Session, SessionError};
use impeccable_common::Io;
use impeccable_context::critique_storage::SavedReport;
use serde_json::{json, Value};
use std::time::{Duration, Instant};

pub const CRITIQUE_SYNC_DEFAULT_ON: bool = true;

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
/// What a saved report is: a critique (ten heuristics out of 40) or an audit
/// (five dimensions out of 20, none n/a, no heuristics). The cloud keeps
/// both in the person's critique history and marks audits.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Report {
    Critique,
    Audit,
}

impl Report {
    fn noun(self) -> &'static str {
        match self {
            Report::Critique => "critique",
            Report::Audit => "audit",
        }
    }
}

/// Uses only saved metadata. Missing heuristic detail stays null, never inferred from prose.
fn payload(snapshot: &SavedReport, report: Report) -> Option<Value> {
    let m = &snapshot.meta;
    let total = m.get("total_score")?.as_u64()?;
    let max = m.get("max_score")?.as_u64()?;
    // The storage parser reads a single N/A index as a number, a list as text.
    if report == Report::Audit && (max != 20 || m.get("na_heuristics").is_some()) {
        return None;
    }
    // The storage parser reads a single N/A index as a number, a list as text.
    let na: Vec<u64> = match m.get("na_heuristics").unwrap_or(&Value::String(String::new())) {
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
        || (report == Report::Critique && max != 4 * (10 - na.len() as u64))
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
    let mut out = json!({
        "version": 1, "critiqueId": id, "createdAt": created_at,
        "target": target, "score": { "total": total, "max": max }, "na": na,
        "heuristics": null, "counts": { "p0": p0, "p1": p1, "p2": count("p2_count"), "p3": count("p3_count") },
        "body": body
    });
    // Only an audit names its kind: a critique's upload stays as every server so far reads it.
    if report == Report::Audit {
        out["kind"] = "audit".into();
    }
    Some(out)
}

/// One line on stdout, where the person's agent reads it, after a saved
/// critique (journey 3): where it went, why it didn't, or once a day per
/// project while signed out, how to keep its history. Nothing when sync is off,
/// in CI, under an opt-out, or with `--json`/`--quiet`/`--github`.
pub fn after_save(io: &mut Io, snapshot: &SavedReport, report: Report, quiet: bool) {
    // Quiet saves still upload; they only say nothing, and spend no once-only line.
    if let Some(line) = upload(io, snapshot, report, quiet).filter(|_| !quiet) {
        io.out(&line);
    }
}

pub(crate) const RELOGIN: &str = "sign in again with npx impeccable login";

fn not_saved(reason: impl std::fmt::Display) -> Option<String> {
    Some(format!("Not saved to Impeccable: {reason}\n"))
}

/// The project a saved report belongs to: `<root>/.impeccable/critique/<file>`.
fn project_root(snapshot: &SavedReport) -> Option<&std::path::Path> {
    std::path::Path::new(&snapshot.path)
        .parent()
        .and_then(|p| p.parent())
        .and_then(|p| p.parent())
}

/// Signed out: at most once a day per project, so a run of critiques costs the
/// customer's agent one line, not one per report.
fn signed_out_nudge(account: &Account, root: Option<&std::path::Path>, report: Report) -> Option<String> {
    use sha2::{Digest, Sha256};
    let project = root.map(|r| r.to_string_lossy().into_owned()).unwrap_or_default();
    let digest = Sha256::digest(project.as_bytes());
    let key: String = digest[..8].iter().map(|b| format!("{b:02x}")).collect();
    let today = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() / 86_400)
        .unwrap_or(0);
    let marker = |day: u64| account.dir().join(format!("critique-sign-in-nudge-{key}-{day}"));
    let _ = crate::store::private_dir(&account.dir());
    // Creating today's marker is the claim, so parallel saves print the line once.
    match std::fs::OpenOptions::new().write(true).create_new(true).open(marker(today)) {
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => return None,
        // A marker that can't be written never hides the line; it can only repeat it.
        _ => {}
    }
    let _ = std::fs::remove_file(marker(today.saturating_sub(1)));
    Some(format!("Keep this {}'s history: npx impeccable login\n", report.noun()))
}

/// Why an upload stopped before an answer. Each caller words its own line.
pub(crate) enum Stop {
    /// Sync off, CI, an opt-out, or a sign-in the service would not widen: say nothing.
    Silent,
    SignedOut(Account),
    NoAccount(String),
    Slow,
    Unreadable,
    Expired,
    Switched,
    Busy,
    /// This sign-in lacks `critiques:write` and signing in again would grant it.
    NoScope,
}

/// The opt-outs and the sign-in an upload needs before it builds a body:
/// sync on, not CI, no telemetry opt-out (here or at `root`), signed in.
pub(crate) fn ready(io: &Io, root: Option<&std::path::Path>) -> Result<(Account, crate::store::State), Stop> {
    if !enabled(io)
        || io.env.get("CI").is_some_and(|v| !v.is_empty())
        || impeccable_context::telemetry::opt_out_reason(&io.env, &io.cwd.to_string_lossy())
            .is_some()
    {
        return Err(Stop::Silent);
    }
    let account = Account::from_env(&io.env).map_err(Stop::NoAccount)?;
    // Also honor an opt-out at the project root.
    if root.is_some_and(|root| {
        impeccable_context::telemetry::opt_out_reason(&io.env, &root.to_string_lossy()).is_some()
    }) {
        return Err(Stop::Silent);
    }
    match crate::store::Store::new(&account).state().filter(|s| s.signed_in) {
        Some(state) => Ok((account, state)),
        None => Err(Stop::SignedOut(account)),
    }
}

/// Posts `body` to `path` on the account service within two seconds of
/// `started`, the way every critique-scoped upload does: a readable session
/// with `critiques:write`, renewed if it expired, the same sign-in it started
/// with, and the upload lock. `quiet` keeps the shared scope notice owed.
pub(crate) fn send(
    io: &mut Io,
    started: Instant,
    (account, state): &(Account, crate::store::State),
    path: &str,
    body: Value,
    quiet: bool,
) -> Result<(Result<Value, crate::http::ApiError>, u64), Stop> {
    let left = || {
        Duration::from_secs(2)
            .checked_sub(started.elapsed())
            .filter(|d| !d.is_zero())
    };
    let wait = left().ok_or(Stop::Slow)?;
    let session = Session::load_for_upload(&account, wait).ok_or(Stop::Unreadable)?;
    let has_scope =
        |s: &crate::store::State| s.scopes.iter().any(|s| s == crate::oauth::CRITIQUES_SCOPE);
    // A service that does not take critiques at all has nothing to sign in for.
    // The answer is kept per sign-in, so a stale sign-in costs one metadata read, not one per save.
    let offered_mark = account
        .dir()
        .join(format!("critique-scope-offered-{}", state.login));
    let missing_scope = |io: &Io| {
        let offered = crate::store::read_private(&offered_mark)
            .ok()
            .flatten()
            .is_some()
            || (crate::stale_grant::offers(
                &account,
                crate::oauth::CRITIQUES_SCOPE,
                left().unwrap_or_default(),
            ) && {
                let _ = crate::store::write_private(&offered_mark, b"offered");
                true
            });
        let say = offered && enabled(io);
        // A quiet save prints nothing, so the shared notice stays owed.
        if say && !quiet {
            crate::stale_grant::mark_shown(&account, state.login);
        }
        if say { Stop::NoScope } else { Stop::Silent }
    };
    if !has_scope(&state) {
        return Err(missing_scope(io));
    }
    let session = if session.existing_access_token().is_none() {
        match crate::session::renew_for_upload(io, &account, started, "critiques-refresh") {
            Some(fresh) => fresh,
            // Out of time, the refresh carries on and may still succeed.
            None if left().is_none() => return Err(Stop::Slow),
            None => return Err(Stop::Expired),
        }
    } else {
        session
    };
    if !session.matches_upload(&state) {
        return Err(Stop::Switched);
    }
    let token = session.existing_access_token().ok_or(Stop::Expired)?;
    let Ok(_admission) = crate::store::Store::critique_lock_for(&account.home, Duration::ZERO)
    else {
        return Err(Stop::Busy);
    };
    if !enabled(io) {
        return Err(Stop::Silent);
    }
    if !has_scope(&session.state) {
        return Err(missing_scope(io));
    }
    let wait = left().ok_or(Stop::Slow)?;
    let answer = Client::with_deadline(&account, wait).post_json(
        &format!("{}{path}", account.issuer),
        token,
        body,
    );
    Ok((answer, session.state.login))
}

fn upload(io: &mut Io, snapshot: &SavedReport, report: Report, quiet: bool) -> Option<String> {
    let started = Instant::now();
    let root = project_root(snapshot);
    const SLOW: &str = "the account service took too long; the report is saved locally and the next critique will upload";
    let stopped = |stop: Stop| match stop {
        Stop::Silent => None,
        Stop::SignedOut(account) => {
            if quiet {
                None
            } else {
                signed_out_nudge(&account, root, report)
            }
        }
        Stop::NoAccount(e) => not_saved(e),
        Stop::Slow => not_saved(SLOW),
        Stop::Unreadable => not_saved(format!("your sign-in couldn't be read; {RELOGIN}")),
        Stop::Expired => not_saved(format!("your sign-in expired; {RELOGIN}")),
        Stop::Switched => not_saved("you signed in or out while it was saving; save the critique again"),
        Stop::Busy => not_saved("another critique was uploading; save this one again to upload it"),
        Stop::NoScope => {
            Some(format!("Not saved to Impeccable: this sign-in can't save critiques; {RELOGIN}\n"))
        }
    };
    let signed_in = match ready(io, root) {
        Ok(signed_in) => signed_in,
        Err(stop) => return stopped(stop),
    };
    let Some(mut body) = payload(snapshot, report) else {
        return not_saved("the report's scores were missing or invalid (IMPECCABLE_CRITIQUE_META); save it again with the metadata critique.md shows");
    };
    if let Some(root) = root {
        if let Some((key, label)) = crate::health::critique_repo(&root.to_string_lossy(), &io.env) {
            body["repoKey"] = key.into();
            if let Some(label) = label {
                body["label"] = label.into();
            }
        }
    }
    if serde_json::to_vec(&body).map_or(true, |bytes| bytes.len() > 80 * 1024) {
        return not_saved("the report is over 80 KB; save a shorter report");
    }
    let (answer, login) = match send(io, started, &signed_in, "/cli/v1/critiques", body, quiet) {
        Ok(sent) => sent,
        Err(stop) => return stopped(stop),
    };
    use crate::http::ApiError;
    match answer {
        Ok(v) if matches!(v["outcome"].as_str(), Some("recorded" | "repeat")) => {
            // The first save on a sign-in also says it happens every time and how to stop.
            let first = !quiet
                && crate::upload_notice::first(&signed_in.0, login, if report == Report::Audit {
                    crate::upload_notice::Kind::Audit
                } else {
                    crate::upload_notice::Kind::Critique
                });
            let at = v["url"].as_str().filter(|u| u.starts_with("https://") || u.starts_with("http://"));
            let mut line = match at {
                Some(url) => format!("Saved to Impeccable: {url}"),
                None => "Saved to Impeccable.".to_string(),
            };
            if first {
                line.push_str(&format!(" Every {} you save uploads; to stop: impeccable critiques off", report.noun()));
            }
            Some(line + "\n")
        }
        Ok(_) => not_saved("the account service gave an answer this version doesn't read; update with npx impeccable update"),
        Err(ApiError::Status { status: 401, .. }) => not_saved(format!("your sign-in expired; {RELOGIN}")),
        Err(ApiError::Status { status: 403, .. }) => not_saved(format!("this sign-in can't save critiques; {RELOGIN}")),
        Err(ApiError::Status { status: 409, .. }) => not_saved("it was made before you deleted your critique history"),
        Err(ApiError::Status { status: 429, .. }) => not_saved("you've reached the upload limit (10 a minute, 200 a day); the next critique after that will upload"),
        Err(ApiError::Status { status: 400 | 413, .. }) => not_saved("the account service refused the report; update with npx impeccable update"),
        Err(e @ ApiError::Status { .. }) => not_saved(format!("the account service had a problem ({e}); the next critique will upload")),
        Err(ApiError::Network(e)) => not_saved(format!("{e}; the report is saved locally and the next critique will upload")),
    }
}

pub fn run(args: &[String], io: &mut Io) -> i32 {
    let choice = args.first().map(String::as_str).unwrap_or("status");
    if args.len() > 1 || !["status", "on", "off", "forget"].contains(&choice) {
        io.err("Usage: impeccable critiques status|on|off|forget\n");
        return 1;
    }
    if choice == "status" {
        io.out(if enabled(io) {
            if crate::stale_grant::status(io, crate::oauth::CRITIQUES_SCOPE) {
                "Critique sync: on, but this sign-in can't save yet. Run npx impeccable login.\n"
            } else {
                "Critique sync: on.\n"
            }
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
            "Critique sync: on. Each critique report you save uploads to your Impeccable account. To stop: impeccable critiques off\n"
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
            io.err("Critique sync is off, but deleting your history couldn't be confirmed. Run impeccable critiques forget again.\n");
            1
        }
    }
}

/// Hidden renewal-only verb; shared with DESIGN.md uploads.
pub fn run_refresh(args: &[String], io: &mut Io) -> i32 {
    crate::session::run_upload_refresh(args, io)
}

#[cfg(test)]
mod preference_tests {
    use super::*;

    #[test]
    fn critique_default_is_on_and_explicit_off_wins() {
        let home =
            std::env::temp_dir().join(format!("critique-default-{}", crate::oauth::random_b64(12)));
        let env = [(
            "IMPECCABLE_HOME".into(),
            home.to_string_lossy().into_owned(),
        )]
        .into();
        let (io, _) = Io::captured("", home.clone(), env);
        assert!(enabled(&io));
        std::fs::create_dir_all(&home).unwrap();
        std::fs::write(home.join("critiques.json"), br#"{"sync":false}"#).unwrap();
        assert!(!enabled(&io));
        std::fs::remove_dir_all(home).unwrap();
    }
}
