//! Design health over time (REN-1559): after a full `detect` of a git work
//! tree, a signed-in CLI uploads the scan's counts to
//! `POST /cli/v1/health/scans`, so the account can show a per-repo trend.
//! The body carries counts and opaque hashes only: no remote, path, snippet
//! or code. docs/RUNTIME-ENV.md (Design health) has the whole contract.
//!
//! An upload never changes what `detect` printed or its exit code: it runs
//! after the output, has one 5-second deadline (token refresh included), and
//! any failure is silent. It is skipped, before anything is read from the
//! network or git, when `CI` is set, when telemetry is off (`DO_NOT_TRACK`,
//! `IMPECCABLE_NO_TELEMETRY`, `"telemetry": false`), when sync is off
//! (`impeccable health off`), or when nobody is signed in.

use crate::config::{impeccable_home, Account};
use crate::http::{ApiError, Client};
use crate::session::{Session, SessionError};
use impeccable_common::Io;
use ring::rand::{SecureRandom, SystemRandom};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[path = "design.rs"]
mod design;
pub use design::DESIGN_SYNC_DEFAULT_ON;

/// Sync is on for a signed-in person unless they turn it off (decision 1 on
/// REN-1559 is the decider's; this is the recommended default).
pub const SYNC_BY_DEFAULT: bool = true;
/// The whole upload, refresh included.
const DEADLINE: Duration = Duration::from_secs(5);
/// Bumped whenever the fingerprint or ruleset recipe below changes, so the
/// service starts a new baseline instead of reporting false new and fixed.
pub const FINGERPRINT_VERSION: u32 = 1;
const MAX_BYTES: usize = 256 * 1024;
/// Each git question (top level, remote, branch).
const GIT_DEADLINE: Duration = Duration::from_secs(2);
/// How long a change to `health.json` waits for one in another process.
const LOCK_WAIT: Duration = Duration::from_secs(5);
const MAX_RULES: usize = 300;
const MAX_FINGERPRINTS: usize = 5000;
const MAX_LABEL: usize = 100;
const SCANS: &str = "/cli/v1/health/scans";
const FORGET: &str = "/cli/v1/health/forget";

/// One finding, as much of it as the upload uses.
pub struct Hit {
    pub rule: String,
    /// As detect reported it: absolute for a directory scan.
    pub file: String,
    pub snippet: String,
    pub advisory: bool,
}

/// A full scan, from `impeccable_detect::cli::FullScan`.
pub struct Scan {
    /// Catalog evidence only. Missing checks are never inferred as passing.
    pub foundations: std::collections::BTreeMap<String, String>,
    pub root: String,
    pub files_scanned: usize,
    pub hits: Vec<Hit>,
    pub ruleset: Vec<String>,
    pub engine_version: String,
    /// When the scan started.
    pub started: SystemTime,
}

/// Whether a full scan could be uploaded at all: the cheap checks, run
/// before detect is asked for a report. Reads only the environment, the
/// telemetry config, `health.json` and the sign-in's `state.json` (never the
/// keychain, git or the network). `CI`, a telemetry opt-out in the working
/// directory, sync off (or an unreadable `health.json`) or no sign-in: no.
pub fn wanted(io: &Io) -> bool {
    if !io.env.get("CI").is_none_or(|v| v.is_empty()) {
        return false;
    }
    if !Local::read(&io.env).is_some_and(|l| l.sync()) {
        return false;
    }
    let Ok(account) = Account::from_env(&io.env) else {
        return false;
    };
    if !crate::store::Store::new(&account)
        .state()
        .is_some_and(|s| s.signed_in)
    {
        return false;
    }
    let cwd = io.cwd.to_string_lossy();
    impeccable_context::telemetry::opt_out_reason(&io.env, &cwd).is_none()
}

/// Whether the signed-in grant includes foundations consent, from the saved
/// sign-in state alone (no keychain, git or network), so a scan that won't
/// upload foundations doesn't compute them.
pub fn foundations_wanted(io: &Io) -> bool {
    let Ok(account) = Account::from_env(&io.env) else {
        return false;
    };
    crate::store::Store::new(&account)
        .state()
        .is_some_and(|s| s.signed_in && s.foundations)
}

/// Upload `scan` if everything allows it. `quiet` keeps the one-time notice
/// and hint off stderr. The caller has checked [`wanted`].
pub fn after_scan(io: &mut Io, scan: &Scan, quiet: bool) {
    // The scanned root's own config may opt out too (an off anywhere wins).
    if impeccable_context::telemetry::opt_out_reason(&io.env, &scan.root).is_some() {
        return;
    }
    design::after_scan(io, scan, quiet);
    let Ok(account) = Account::from_env(&io.env) else {
        return;
    };
    let Ok(mut session) = Session::load(&account) else {
        return;
    };
    let Some(repo) = Repo::of(&scan.root, &io.env) else {
        return;
    };
    let Some(body) = payload(scan, &repo, &scan_id(), FINGERPRINT_VERSION) else {
        return;
    };
    // A token refresh, when one is due, goes through the ordinary sign-in
    // path and client, exactly as `whoami` does: a short timeout there could
    // drop a rotated refresh token the service already spent.
    // A busy sign-in (another command mid-refresh) skips this upload rather
    // than holding detect on the lock.
    let Ok(token) = session.access_token_within(std::time::Duration::ZERO) else {
        return;
    };
    // The one-time notice and hint belong to this sign-in on this service.
    let marker = format!("{} {}", account.issuer, session.state.login);
    // `off` or `forget` may have run while the scan did.
    if !Local::read(&io.env).is_some_and(|l| l.sync()) {
        return;
    }
    if !session.state.taste && !impeccable_context::taste::disabled(&io.env) {
        crate::stale_grant::emit(
            io,
            &account,
            session.state.login,
            Some(crate::oauth::TASTE_READ_SCOPE),
            Duration::from_secs(2),
            quiet,
        );
    }
    // Its own request and consent: a switched-off route (404) or any other
    // failure is silent and never prevents the health upload.
    if session.state.foundations {
        let mut foundation_body = json!({
            "version": 1,
            "scanId": body["scanId"],
            "repoKey": repo.key,
            "scannedAt": body["scannedAt"],
            "productType": null,
            "items": scan.foundations,
        });
        if let Some(label) = &repo.label {
            foundation_body["label"] = label.clone().into();
        }
        let _ = Client::with_deadline(&account, Duration::from_secs(2)).post_json(
            &format!("{}/cli/v1/foundations", account.issuer),
            &token,
            foundation_body,
        );
    } else {
        crate::stale_grant::emit(
            io,
            &account,
            session.state.login,
            Some(crate::oauth::FOUNDATIONS_SCOPE),
            // The same bound as the foundations request a granted sign-in
            // makes here instead, so a stale one never waits longer.
            Duration::from_secs(2),
            quiet,
        );
    }
    // The foundations request may have been in flight when another
    // terminal saved `off` or `forget`. Do not start a second upload then.
    if !Local::read(&io.env).is_some_and(|l| l.sync()) {
        return;
    }
    // One request, one deadline, no retry: a 401 waits for the next scan.
    // `--quiet` hides the notice, so it stays owed to the next scan that shows it.
    let url = format!("{}{SCANS}", account.issuer);
    match Client::with_deadline(&account, DEADLINE).post_json(&url, &token, body) {
        Ok(_) => {
            let fresh = Local::read(&io.env).unwrap_or_default();
            if !quiet && fresh.noticed.as_deref() != Some(marker.as_str()) {
                io.err(&format!(
                    "Design health: this scan's counts were saved to your account on {}, so you can follow the trend for this repo. Never your code or file names. Turn it off with `impeccable health off`.\n",
                    account.display_host()
                ));
                let _ = Local::update(&io.env, |l| l.noticed = Some(marker));
            }
        }
        Err(ApiError::Status { status: 403, .. }) => {
            crate::stale_grant::note_health_denied(&account, session.state.login);
            crate::stale_grant::emit(
                io,
                &account,
                session.state.login,
                None,
                Duration::ZERO,
                quiet,
            );
        }
        Err(_) => {}
    }
}

/// `impeccable health [status|on|off|forget]`.
pub fn run(args: &[String], io: &mut Io) -> i32 {
    if args.first().map(String::as_str) == Some("design") {
        return design::run(&args[1..], io);
    }
    let env = io.env.clone();
    // An unreadable health.json reads as off.
    let local = Local::read(&env).unwrap_or(Local {
        sync: Some(false),
        ..Local::default()
    });
    let _admission = if args.len() == 1 && matches!(args[0].as_str(), "on" | "off" | "forget") {
        let result = impeccable_home(&env)
            .ok_or_else(|| "no home directory; set IMPECCABLE_HOME".to_string())
            .and_then(|home| crate::store::Store::design_lock_for(&home, Duration::from_secs(3)));
        match result {
            Ok(lock) => Some(lock),
            Err(e) => {
                io.err(&format!("Design health: couldn't save the setting: {e}.\n"));
                return 1;
            }
        }
    } else {
        None
    };
    let set = |io: &mut Io, on: bool| match Local::update(&env, |l| {
        l.sync = Some(on);
        if !on {
            l.design_generation = l.design_generation.wrapping_add(1);
        }
    }) {
        Ok(()) => true,
        Err(e) => {
            io.err(&format!("Design health: couldn't save the setting: {e}.\n"));
            false
        }
    };
    match args.first().map(String::as_str) {
        None | Some("status") if args.len() <= 1 => {
            let cwd = io.cwd.to_string_lossy().into_owned();

            let account = Account::from_env(&env).ok();
            let signed_in = account.as_ref().is_some_and(|a| Session::load(a).is_ok());
            let why_not = if !local.sync() {
                Some("turned off (`impeccable health on` turns it back on)".to_string())
            } else if !env.get("CI").is_none_or(|v| v.is_empty()) {
                Some("off while CI is set".to_string())
            } else if let Some(reason) = impeccable_context::telemetry::opt_out_reason(&env, &cwd)
            {
                Some(format!("off because {reason}"))
            } else if !signed_in {
                Some("off until you sign in with `impeccable login`".to_string())
            } else {
                None
            };
            match why_not {
                None if crate::stale_grant::status(io, crate::oauth::HEALTH_SCOPE) => {
                    io.out("Design health: on, but this sign-in can't save yet. Run impeccable login.\n")
                }
                None => io.out(&format!(
                    "Design health: on. Each full `impeccable detect` of a git repo saves its counts to {}: findings by rule and opaque fingerprints, never code or file names.\n",
                    account.as_ref().map(|a| a.display_host().to_string()).unwrap_or_default()
                )),
                Some(why) => io.out(&format!("Design health: {why}.\n")),
            }
            0
        }
        Some("on") if args.len() == 1 => {
            if !set(io, true) {
                return 1;
            }
            io.out("Design health: on.\n");
            0
        }
        Some("off") if args.len() == 1 => {
            if !set(io, false) {
                return 1;
            }
            io.out("Design health: off. Nothing more is sent; `impeccable health forget` also deletes what was saved.\n");
            0
        }
        Some("forget") if args.len() == 1 => {
            // Off first, so a scan that runs meanwhile can't start a new trend.
            if !set(io, false) {
                return 1;
            }
            let account = match Account::from_env(&env) {
                Ok(a) => a,
                Err(e) => {
                    io.err(&format!("{e}.\n"));
                    return 1;
                }
            };
            let url = format!("{}{FORGET}", account.issuer);
            let result = Session::load(&account)
                .and_then(|mut s| s.call(|c, token| c.post_json(&url, token, json!({}))));
            match result {
                Ok(_) => {
                    design::forget(io);
                    io.out(&format!(
                        "Design health: deleted everything saved on {}, and turned sync off.\n",
                        account.display_host()
                    ));
                    0
                }
                Err(SessionError::Api(ApiError::Status { status: 404, .. })) => {
                    io.err(&format!(
                        "Sync is off, but {} doesn't offer design health right now, so deleting what was saved couldn't be confirmed. Run `impeccable health forget` again later.\n",
                        account.display_host()
                    ));
                    1
                }
                Err(SessionError::NotSignedIn | SessionError::Expired) => {
                    io.err("Sync is off. To delete what was saved, run `impeccable login` and then `impeccable health forget`.\n");
                    1
                }
                Err(e) => {
                    io.err(&format!(
                        "Sync is off, but deleting the saved results failed: {e}.\n"
                    ));
                    1
                }
            }
        }
        _ => {
            io.err("Usage: impeccable health [status|on|off|forget]\n");
            1
        }
    }
}

/// `$IMPECCABLE_HOME/health.json`: the person's choice, and which sign-in
/// has already seen the notice or the hint.
#[derive(Default, Clone)]
struct Local {
    sync: Option<bool>,
    design: Option<bool>,
    design_generation: u64,
    /// `<issuer> <login>` of the sign-in the notice was shown for.
    noticed: Option<String>,
    hinted: Option<String>,
}

impl Local {
    fn path(env: &std::collections::HashMap<String, String>) -> Option<PathBuf> {
        impeccable_home(env).map(|h| h.join("health.json"))
    }
    /// The saved state; the default when there is none yet. `None` when a
    /// file is there but can't be read, which callers treat as off.
    fn read(env: &std::collections::HashMap<String, String>) -> Option<Local> {
        let path = Local::path(env)?;
        let bytes = match std::fs::read(&path) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Some(Local::default()),
            Err(_) => return None,
        };
        let v: Value = serde_json::from_slice(&bytes).ok()?;
        let v = v.as_object()?;
        Some(Local {
            sync: v.get("sync").and_then(Value::as_bool),
            design: v.get("design").and_then(Value::as_bool),
            design_generation: v
                .get("designGeneration")
                .and_then(Value::as_u64)
                .unwrap_or(0),
            noticed: v.get("noticed").and_then(Value::as_str).map(str::to_string),
            hinted: v.get("hinted").and_then(Value::as_str).map(str::to_string),
        })
    }
    fn sync(&self) -> bool {
        self.sync.unwrap_or(SYNC_BY_DEFAULT)
    }
    /// Re-read, change one thing, save, all under `health.json.lock`, so a
    /// scan's notice can't read "on", lose the race to an `off` in another
    /// process and then write its stale state over it. The OS drops the lock
    /// if the process dies. An unreadable file is replaced only by a choice of
    /// sync, never by a notice.
    fn update(
        env: &std::collections::HashMap<String, String>,
        change: impl FnOnce(&mut Local),
    ) -> Result<(), String> {
        let path = Local::path(env).ok_or("no home directory; set IMPECCABLE_HOME")?;
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let lock = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(path.with_extension("json.lock"))
            .map_err(|e| format!("could not open the design health lock: {e}"))?;
        let deadline = std::time::Instant::now() + LOCK_WAIT;
        loop {
            match lock.try_lock() {
                Ok(()) => break,
                Err(std::fs::TryLockError::WouldBlock) if std::time::Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(25))
                }
                Err(std::fs::TryLockError::WouldBlock) => {
                    return Err("another impeccable health change is still running; retry shortly".into())
                }
                Err(std::fs::TryLockError::Error(e)) => {
                    return Err(format!("could not take the design health lock: {e}"))
                }
            }
        }
        let mut local = Local::read(env).unwrap_or(Local {
            sync: Some(false),
            ..Local::default()
        });
        change(&mut local);
        let mut m = Map::new();
        if let Some(s) = local.sync {
            m.insert("sync".into(), s.into());
        }
        if local.design_generation != 0 {
            m.insert("designGeneration".into(), local.design_generation.into());
        }
        if let Some(d) = local.design {
            m.insert("design".into(), d.into());
        }
        if let Some(n) = local.noticed {
            m.insert("noticed".into(), n.into());
        }
        if let Some(h) = local.hinted {
            m.insert("hinted".into(), h.into());
        }
        let saved = crate::store::write_private(&path, Value::Object(m).to_string().as_bytes());
        drop(lock);
        saved
    }
}

/// The repo a scan belongs to, as the service sees it.
struct Repo {
    key: String,
    stream: String,
    label: Option<String>,
}

impl Repo {
    /// `None` unless `root` is the top of a git work tree.
    fn of(root: &str, env: &std::collections::HashMap<String, String>) -> Option<Repo> {
        let top = git(root, &["rev-parse", "--show-toplevel"])?;
        let same = |a: &str, b: &str| match (Path::new(a).canonicalize(), Path::new(b).canonicalize()) {
            (Ok(a), Ok(b)) => a == b,
            _ => false,
        };
        if !same(&top, root) {
            return None;
        }
        let remote = git(root, &["config", "--get", "remote.origin.url"])
            .and_then(|r| normalize_remote(&r));
        let key = match &remote {
            Some(remote) => hex(&Sha256::digest(remote.as_bytes())),
            None => hex(&Sha256::digest(local_repo_id(&top, env)?.as_bytes())),
        };
        // The branch, also before the first commit; "HEAD" when detached. A
        // git that fails or times out here skips the upload rather than file
        // the scan under a branch it couldn't read.
        let branch = git(root, &["symbolic-ref", "--short", "-q", "HEAD"])
            .or_else(|| git(root, &["rev-parse", "--abbrev-ref", "HEAD"]))?;
        let stream = hex(&hash(&[&key, &branch]));
        // The repo's name from its remote, never the folder's: a folder name
        // can say more than the person meant to share (Paul, REN-1553).
        let label = remote.as_deref().and_then(repo_label);
        Some(Repo { key, stream, label })
    }
}

/// One short git question, given at most [`GIT_DEADLINE`] and never
/// fsmonitor, which can hang. `None` on any failure.
fn git(dir: &str, args: &[&str]) -> Option<String> {
    git_with_timeout(dir, args, GIT_DEADLINE)
}

/// Critiques use the same repo identity, including for native projects and subdirectories.
pub(crate) fn critique_repo(
    root: &str,
    env: &std::collections::HashMap<String, String>,
) -> Option<(String, Option<String>)> {
    let short = Duration::from_millis(150);
    let top = git_with_timeout(root, &["rev-parse", "--show-toplevel"], short)?;
    let remote = git_run(root, &["config", "--get", "remote.origin.url"], short);
    repo_identity(&top, remote, env)
}

/// The key and label from the remote read's outcome. A read that timed out is
/// not a repo without a remote: falling back to the local id then would name a
/// different project, so it sends no key.
fn repo_identity(
    top: &str,
    remote: Result<Option<String>, ()>,
    env: &std::collections::HashMap<String, String>,
) -> Option<(String, Option<String>)> {
    let remote = remote.ok()?.and_then(|r| normalize_remote(&r));
    let label = remote.as_deref().and_then(repo_label);
    let identity = remote.or_else(|| local_repo_id(top, env))?;
    Some((hex(&Sha256::digest(identity.as_bytes())), label))
}

fn git_with_timeout(dir: &str, args: &[&str], timeout: Duration) -> Option<String> {
    git_run(dir, args, timeout).ok().flatten()
}

/// `Err` when git didn't answer in time (or couldn't start), `Ok(None)` when it
/// answered with a failure or nothing.
fn git_run(dir: &str, args: &[&str], timeout: Duration) -> Result<Option<String>, ()> {
    let mut child = Command::new("git")
        .args(["-c", "core.fsmonitor=false", "-C", dir])
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| ())?;
    let until = std::time::Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if std::time::Instant::now() < until => {
                std::thread::sleep(Duration::from_millis(5))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(());
            }
        }
    };
    let mut out = String::new();
    let Some(mut stdout) = child.stdout.take() else { return Ok(None) };
    if std::io::Read::read_to_string(&mut stdout, &mut out).is_err() {
        return Ok(None);
    }
    let s = out.trim().to_string();
    Ok((status.success() && !s.is_empty()).then_some(s))
}

/// A repo with no `origin` gets a random id, kept under `IMPECCABLE_HOME`
/// by the repo's path, never in the work tree (whose files the repo
/// controls). A moved repo starts a new trend.
fn local_repo_id(top: &str, env: &std::collections::HashMap<String, String>) -> Option<String> {
    let canonical = Path::new(top).canonicalize().ok()?;
    let name = hex(&Sha256::digest(canonical.to_string_lossy().as_bytes()));
    let file = impeccable_home(env)?.join("health").join("repos").join(name);
    if let Some(id) = read_id(&file) {
        return Some(id);
    }
    let mut bytes = [0u8; 16];
    SystemRandom::new().fill(&mut bytes).ok()?;
    std::fs::create_dir_all(file.parent()?).ok()?;
    publish_id(&file, &hex(&bytes))
}

fn read_id(file: &Path) -> Option<String> {
    let id = std::fs::read_to_string(file).ok()?;
    let id = id.trim();
    (id.len() == 32 && id.bytes().all(|b| b.is_ascii_hexdigit())).then(|| id.to_string())
}

/// Save `id` as the repo's id unless another scan saved one first, and
/// return whichever won: two first scans racing must not split one repo
/// into two trends. A hard link never replaces an existing file.
fn publish_id(file: &Path, id: &str) -> Option<String> {
    let staged = file.with_extension(format!("{id}.new"));
    crate::store::write_private(&staged, format!("{id}\n").as_bytes()).ok()?;
    let linked = std::fs::hard_link(&staged, file);
    let _ = std::fs::remove_file(&staged);
    match linked {
        Ok(()) => Some(id.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => read_id(file),
        Err(_) => None,
    }
}

/// The `origin` remote in one spelling, so every clone of a repo hashes the
/// same: credentials dropped, `git@host:path` and `ssh://` read as
/// `https://host/path`, scheme and host lower-cased, a trailing `/` and
/// `.git` removed.
pub fn normalize_remote(raw: &str) -> Option<String> {
    let raw = raw.trim();
    let (host, path) = if !raw.contains("://") {
        // scp-like: [user@]host:path
        let (host, path) = raw.split_once(':')?;
        if host.contains('/') {
            return None; // a local path
        }
        let host = host.rsplit_once('@').map_or(host, |(_, h)| h);
        (host.to_lowercase(), path.trim_start_matches('/').to_string())
    } else {
        let url = url::Url::parse(raw).ok()?;
        let host = url.host_str()?.to_lowercase();
        let host = match (url.scheme(), url.port()) {
            ("https" | "http", Some(port)) => format!("{host}:{port}"),
            _ => host,
        };
        (host, url.path().trim_start_matches('/').to_string())
    };
    let mut path = path.trim_end_matches('/');
    path = path.strip_suffix(".git").unwrap_or(path);
    let path = path.trim_end_matches('/');
    if host.is_empty() || path.is_empty() {
        return None;
    }
    Some(format!("https://{host}/{path}"))
}

/// The body of one upload, or `None` when the scan can't be described
/// within the service's rules (then nothing is sent).
fn payload(scan: &Scan, repo: &Repo, scan_id: &str, fingerprint_version: u32) -> Option<Value> {
    if !semver(&scan.engine_version) {
        return None;
    }
    let mut rules: std::collections::BTreeMap<&str, (u64, u64)> = Default::default();
    let mut prints: std::collections::BTreeMap<String, u64> = Default::default();
    let (mut findings, mut advisory) = (0u64, 0u64);
    for hit in &scan.hits {
        if !rule_id(&hit.rule) {
            return None;
        }
        let slot = rules.entry(&hit.rule).or_default();
        if hit.advisory {
            slot.1 += 1;
            advisory += 1;
        } else {
            slot.0 += 1;
            findings += 1;
            *prints
                .entry(fingerprint(&scan.root, hit))
                .or_default() += 1;
        }
    }
    if rules.len() > MAX_RULES {
        return None;
    }
    let mut ruleset: Vec<&str> = vec![&scan.engine_version];
    let fv = fingerprint_version.to_string();
    ruleset.push(&fv);
    ruleset.extend(scan.ruleset.iter().map(String::as_str));
    let started = scan
        .started
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0);
    let mut body = json!({
        "version": 1,
        "scanId": scan_id,
        "repoKey": repo.key,
        "streamKey": repo.stream,
        "scannedAt": impeccable_context::util::iso_from_ms(started),
        "coverage": "full",
        "rulesetId": hex(&hash(&ruleset)),
        "fingerprintVersion": fingerprint_version,
        "engineVersion": scan.engine_version,
        "filesScanned": scan.files_scanned,
        "findings": findings,
        "advisory": advisory,
        "rules": rules.iter().map(|(id, (f, a))| (id.to_string(), json!({ "findings": f, "advisory": a }))).collect::<Map<_, _>>(),
        "fingerprints": prints,
    });
    if let Some(label) = &repo.label {
        body["label"] = label.clone().into();
    }
    if prints.len() > MAX_FINGERPRINTS || body.to_string().len() > MAX_BYTES {
        body["fingerprints"] = Value::Null;
        body["truncated"] = true.into();
    }
    (body.to_string().len() <= MAX_BYTES).then_some(body)
}

/// One finding, opaque: its rule, its path from the repo root (with `/`) and
/// its snippet with whitespace collapsed. The line is left out, so code that
/// moves isn't counted as fixed and new.
fn fingerprint(root: &str, hit: &Hit) -> String {
    let file = hit.file.replace('\\', "/");
    let root = root.replace('\\', "/");
    let path = file
        .strip_prefix(root.trim_end_matches('/'))
        .map(|p| p.trim_start_matches('/'))
        .unwrap_or(&file);
    let snippet = hit.snippet.split_whitespace().collect::<Vec<_>>().join(" ");
    hex(&hash(&[&hit.rule, path, &snippet])[..16])
}

/// SHA-256 over length-prefixed parts, so no two lists hash alike.
fn hash(parts: &[&str]) -> [u8; 32] {
    let mut h = Sha256::new();
    for p in parts {
        h.update((p.len() as u64).to_be_bytes());
        h.update(p.as_bytes());
    }
    h.finalize().into()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// A random version 4 UUID.
fn scan_id() -> String {
    let mut b = [0u8; 16];
    SystemRandom::new()
        .fill(&mut b)
        .expect("the OS random source");
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h = hex(&b);
    format!("{}-{}-{}-{}-{}", &h[..8], &h[8..12], &h[12..16], &h[16..20], &h[20..])
}

/// The service's rule id shape: `^[a-z0-9][a-z0-9/-]{0,79}$`.
fn rule_id(id: &str) -> bool {
    let b = id.as_bytes();
    !b.is_empty()
        && b.len() <= 80
        && (b[0].is_ascii_lowercase() || b[0].is_ascii_digit())
        && b.iter()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'/' || *c == b'-')
}

/// `MAJOR.MINOR.PATCH`, optionally with `-pre` and `+build`, at most 64.
fn semver(v: &str) -> bool {
    let (core, rest) = v.split_at(v.find(['-', '+']).unwrap_or(v.len()));
    let nums: Vec<&str> = core.split('.').collect();
    v.len() <= 64
        && nums.len() == 3
        && nums.iter().all(|n| {
            !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()) && (n.len() == 1 || !n.starts_with('0'))
        })
        && rest
            .split(['-', '+'])
            .skip(1)
            .all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-'))
}

/// The repo's name, the last path segment of its normalized remote, as its
/// label. No remote, no label.
fn repo_label(remote: &str) -> Option<String> {
    let path = remote.split_once("://").map_or(remote, |(_, rest)| rest);
    let (_, path) = path.split_once('/')?;
    label(path.rsplit('/').find(|s| !s.is_empty())?)
}

/// A name as a label, unless it looks like an address or carries invisible
/// characters (the service's rule).
fn label(name: &str) -> Option<String> {
    let l = name.trim();
    let format = |c: char| {
        matches!(c, '\u{AD}' | '\u{600}'..='\u{605}' | '\u{61C}' | '\u{6DD}' | '\u{70F}' | '\u{180E}'
            | '\u{890}'..='\u{891}' | '\u{8E2}' | '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2060}'..='\u{2064}'
            | '\u{2066}'..='\u{206F}' | '\u{FEFF}' | '\u{FFF9}'..='\u{FFFB}'
            | '\u{110BD}' | '\u{110CD}' | '\u{13430}'..='\u{1343F}' | '\u{1BCA0}'..='\u{1BCA3}'
            | '\u{1D173}'..='\u{1D17A}' | '\u{E0001}' | '\u{E0020}'..='\u{E007F}')
    };
    let ok = !l.is_empty()
        && l.chars().count() <= MAX_LABEL
        && !name
            .chars()
            .any(|c| matches!(c, '@' | ':' | '/' | '\\') || c.is_control() || format(c));
    ok.then(|| l.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scan(hits: Vec<(&str, &str, &str, bool)>) -> Scan {
        Scan {
            foundations: Default::default(),
            root: "/w/repo".into(),
            files_scanned: 3,
            hits: hits
                .into_iter()
                .map(|(rule, file, snippet, advisory)| Hit {
                    rule: rule.into(),
                    file: file.into(),
                    snippet: snippet.into(),
                    advisory,
                })
                .collect(),
            ruleset: vec!["a-rule".into(), "config=true".into()],
            engine_version: "0.1.19".into(),
            started: UNIX_EPOCH + Duration::from_secs(1_794_000_000),
        }
    }

    fn repo() -> Repo {
        Repo {
            key: "a".repeat(64),
            stream: "b".repeat(64),
            label: Some("repo".into()),
        }
    }

    #[test]
    fn every_spelling_of_a_remote_is_one_repo() {
        // Catches: one repo splitting into several trends because clones spell the remote differently, or credentials reaching the hash.
        for raw in [
            "git@github.com:a/b.git",
            "ssh://git@GitHub.com/a/b/",
            "https://user:tok@github.com/a/b",
            "HTTPS://github.com/a/b.git/",
            "ssh://git@github.com:22/a/b.git",
        ] {
            assert_eq!(
                normalize_remote(raw).as_deref(),
                Some("https://github.com/a/b"),
                "{raw}"
            );
        }
        // A self-hosted server's SSH port is how this clone connects, not
        // which repo it is: its HTTPS clone (no port) is the same repo.
        assert_eq!(
            normalize_remote("ssh://git@git.example.com:2222/a/b.git"),
            normalize_remote("https://git.example.com/a/b")
        );
        assert_eq!(
            normalize_remote("https://git.example.com:8443/a/b").as_deref(),
            Some("https://git.example.com:8443/a/b")
        );
        assert_eq!(normalize_remote("/srv/repos/b.git"), None);
        assert_eq!(normalize_remote("../b"), None);
    }

    #[test]
    fn the_body_keeps_to_the_services_rules() {
        // Catches: a body the service refuses (sums, advisory in fingerprints, a stray field) or one that carries a path or snippet.
        let s = scan(vec![
            ("side-tab", "/w/repo/src/a.tsx", "border-left:  4px", false),
            ("side-tab", "/w/repo/src/a.tsx", "border-left: 4px", false),
            ("low-contrast", "/w/repo/src/b.tsx", "color: #777", false),
            ("dark-glow", "/w/repo/src/b.tsx", "glow", true),
        ]);
        let body = payload(&s, &repo(), "00000000-0000-4000-8000-000000000000", 1).unwrap();
        let keys: Vec<&str> = body.as_object().unwrap().keys().map(String::as_str).collect();
        for k in &keys {
            assert!(
                [
                    "version", "scanId", "repoKey", "streamKey", "scannedAt", "coverage",
                    "rulesetId", "fingerprintVersion", "engineVersion", "filesScanned",
                    "findings", "advisory", "rules", "fingerprints", "truncated", "label"
                ]
                .contains(k),
                "{k}"
            );
        }
        assert_eq!((body["findings"].as_u64(), body["advisory"].as_u64()), (Some(3), Some(1)));
        assert_eq!(body["rules"]["side-tab"], json!({ "findings": 2, "advisory": 0 }));
        assert_eq!(body["rules"]["dark-glow"], json!({ "findings": 0, "advisory": 1 }));
        // The two side-tab snippets differ only in spacing: one fingerprint, counted twice.
        let prints = body["fingerprints"].as_object().unwrap();
        assert_eq!(prints.len(), 2);
        assert_eq!(prints.values().map(|v| v.as_u64().unwrap()).sum::<u64>(), 3);
        assert!(prints.keys().all(|k| k.len() == 32));
        assert!(body.get("truncated").is_none());
        assert_eq!(body["scannedAt"], "2026-11-06T21:20:00.000Z");
        let text = body.to_string();
        assert!(!text.contains("src/") && !text.contains("border") && !text.contains("#777"), "{text}");
    }

    #[test]
    fn a_scan_too_big_to_fingerprint_is_sent_truncated() {
        // Catches: a 413 (or a refused body) for a large repo instead of its counts.
        let files: Vec<String> = (0..MAX_FINGERPRINTS + 1).map(|i| format!("/w/repo/f{i}.css")).collect();
        let s = scan(files.iter().map(|f| ("side-tab", f.as_str(), "x", false)).collect());
        let body = payload(&s, &repo(), "00000000-0000-4000-8000-000000000000", 1).unwrap();
        assert_eq!(body["fingerprints"], Value::Null);
        assert_eq!(body["truncated"], true);
        assert_eq!(body["findings"].as_u64(), Some(MAX_FINGERPRINTS as u64 + 1));
    }

    #[test]
    fn a_rule_id_the_service_would_refuse_sends_nothing() {
        // Catches: one odd pack rule id turning every upload into a 400.
        let s = scan(vec![("Pack.Rule", "/w/repo/a.css", "x", false)]);
        assert!(payload(&s, &repo(), "00000000-0000-4000-8000-000000000000", 1).is_none());
        let mut s = scan(vec![]);
        s.engine_version = "0.1.19+engine.x/y".into();
        assert!(payload(&s, &repo(), "00000000-0000-4000-8000-000000000000", 1).is_none());
    }

    #[test]
    fn the_fingerprint_reads_the_path_from_the_repo_root() {
        // Catches: `detect .` and `detect /abs/repo` (or Windows separators) giving the same finding different fingerprints.
        let hit = |file: &str| Hit { rule: "r".into(), file: file.into(), snippet: "s".into(), advisory: false };
        let a = fingerprint("/w/repo", &hit("/w/repo/src/a.css"));
        assert_eq!(a, fingerprint("/w/repo/", &hit("/w/repo/src/a.css")));
        assert_eq!(a, fingerprint("C:\\w\\repo", &hit("C:\\w\\repo\\src\\a.css")));
        assert_ne!(a, fingerprint("/w/repo", &hit("/w/repo/src/b.css")));
    }

    #[test]
    fn recording_the_notice_never_undoes_an_off_saved_meanwhile() {
        // Catches (review F3): a scan that read "on" writing its notice over an `off` (or `forget`) saved during the scan.
        let home = std::env::temp_dir().join(format!("impeccable-health-local-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let env = std::collections::HashMap::from([(
            "IMPECCABLE_HOME".to_string(),
            home.to_string_lossy().into_owned(),
        )]);
        let seen_by_scan = Local::read(&env).unwrap();
        assert!(seen_by_scan.sync());
        Local::update(&env, |l| l.sync = Some(false)).unwrap(); // `health off` meanwhile
        Local::update(&env, |l| l.noticed = Some("https://issuer 7".into())).unwrap(); // the scan's notice
        let now = Local::read(&env).unwrap();
        assert_eq!((now.sync, now.noticed.as_deref()), (Some(false), Some("https://issuer 7")));
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn an_update_waits_for_one_in_progress_in_another_process() {
        // Catches (review, Greptile P1 on #1343): a scan's notice reading "on", an `off` saving
        // meanwhile, then the notice writing its stale state over it, so uploads resume.
        let home = std::env::temp_dir().join(format!("impeccable-health-lock-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        std::fs::create_dir_all(&home).unwrap();
        let env = std::collections::HashMap::from([(
            "IMPECCABLE_HOME".to_string(),
            home.to_string_lossy().into_owned(),
        )]);
        // Another process is mid-update: it holds the lock.
        let held = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(home.join("health.json.lock"))
            .unwrap();
        held.lock().unwrap();
        let scan = {
            let env = env.clone();
            std::thread::spawn(move || Local::update(&env, |l| l.noticed = Some("https://issuer 7".into())))
        };
        std::thread::sleep(std::time::Duration::from_millis(300));
        assert!(!home.join("health.json").exists(), "the notice wrote while another update held the lock");
        // The other process saves `off`, then lets go.
        crate::store::write_private(&home.join("health.json"), br#"{"sync":false}"#).unwrap();
        drop(held);
        scan.join().unwrap().unwrap();
        let now = Local::read(&env).unwrap();
        assert_eq!((now.sync, now.noticed.as_deref()), (Some(false), Some("https://issuer 7")));
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn labels_and_versions_follow_the_services_rules() {
        assert_eq!(label(" impeccable ").as_deref(), Some("impeccable"));
        assert_eq!(label("me@host"), None);
        assert_eq!(label("repo\\secret"), None);
        assert_eq!(label("\tname"), None);
        assert_eq!(label("a\u{E0001}b"), None);
        assert_eq!(label("a\u{200B}b"), None);
        // The service refuses a backslash anywhere (pristine#4721), so it is never sent.
        assert_eq!(label("acme\\site"), None);
        assert_eq!(label(&"x".repeat(101)), None);
        // Paul, REN-1553 (10 Nov): "no folder names, only repo names".
        assert_eq!(repo_label("https://github.com/acme/site-repo").as_deref(), Some("site-repo"));
        assert_eq!(repo_label("https://gitlab.com/group/sub/tool").as_deref(), Some("tool"));
        assert_eq!(repo_label("https://github.com"), None);
        assert!(semver("0.1.19") && semver("1.0.0-rc.1+b5") && !semver("0.1") && !semver("01.0.0"));
        let id = scan_id();
        assert!(id.len() == 36 && &id[14..15] == "4", "{id}");
    }

    #[test]
    fn a_racing_first_scan_takes_the_id_already_saved() {
        // Catches (review, Greptile): two first scans of a repo without a remote each keeping their own id.
        let dir = std::env::temp_dir().join(format!("impeccable-health-id-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("repo");
        let first = "a".repeat(32);
        assert_eq!(publish_id(&file, &first).as_deref(), Some(first.as_str()));
        assert_eq!(publish_id(&file, &"b".repeat(32)).as_deref(), Some(first.as_str()));
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1, "no staged file left behind");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}

/// Internal renewal-only entry point. It never receives file contents.
pub fn run_design_refresh(args: &[String], io: &mut Io) -> i32 {
    design::run_refresh(args, io)
}

#[cfg(test)]
mod taste_notice_tests {
    use super::*;
    use crate::test_fake::{browser, Fake};

    #[test]
    fn foreground_scan_notices_an_old_taste_grant_once_and_honors_quiet() {
        let fake = Fake::start();
        {
            let mut knobs = fake.knobs.lock().unwrap();
            knobs.health = true;
            knobs.foundations = true;
        }
        let env = fake.env("taste-foreground-notice");
        crate::login(&env, &mut |url| browser(url), Duration::from_secs(10)).unwrap();
        let account = Account::from_env(&env).unwrap();
        let root = account.home.join("repo");
        std::fs::create_dir_all(&root).unwrap();
        assert!(Command::new("git").arg("init").arg(&root).stdout(Stdio::null()).stderr(Stdio::null()).status().unwrap().success());
        // Only the fake issuer changes its advertised scopes after sign-in.
        fake.knobs.lock().unwrap().taste = true;
        let scan = Scan {
            foundations: Default::default(), root: root.to_string_lossy().into_owned(),
            files_scanned: 1, hits: vec![], ruleset: vec![], engine_version: "1.2.3".into(),
            started: SystemTime::now(),
        };
        let (mut io, cap) = Io::captured("", root, env);
        after_scan(&mut io, &scan, true);
        assert!(cap.stderr.borrow().is_empty());
        after_scan(&mut io, &scan, false);
        after_scan(&mut io, &scan, false);
        let output = String::from_utf8(cap.stderr.borrow().clone()).unwrap();
        assert_eq!(output.matches("needs a fresh sign-in").count(), 1, "{output}");
        std::fs::remove_dir_all(account.home).unwrap();
    }
}

#[cfg(test)]
mod repo_identity_tests {
    use super::*;

    #[test]
    fn a_timed_out_remote_sends_no_key_and_a_missing_one_keeps_the_local_id() {
        // Catches: a slow `git config` read under load fell back to the local id, so one
        // repo was reported as another project.
        let home = std::env::temp_dir().join(format!("impeccable-repo-identity-{}", std::process::id()));
        let top = home.join("repo");
        std::fs::create_dir_all(&top).unwrap();
        let env: std::collections::HashMap<String, String> =
            [("IMPECCABLE_HOME".to_string(), home.join(".impeccable").display().to_string())].into();
        let top = top.to_string_lossy().into_owned();
        assert_eq!(repo_identity(&top, Err(()), &env), None);
        let local = repo_identity(&top, Ok(None), &env).expect("local id");
        assert_eq!(local.1, None);
        assert_eq!(repo_identity(&top, Ok(None), &env), Some(local.clone()), "the local id is kept");
        let remote = repo_identity(&top, Ok(Some("git@github.com:ada/pristine.git".into())), &env).unwrap();
        assert_ne!(remote.0, local.0);
        assert!(remote.1.is_some());
        std::fs::remove_dir_all(home).unwrap();
    }
}
