//! Pro dispatch: a signed-in, entitled machine runs scans on the Pro engine,
//! a separate signed build of this CLI with the Pro rule pack linked in.
//!
//! - **Refresh** (at login, and in a detached `pro-refresh` child; one at a
//!   time per account, by the `refresh.lock` claim): fetch the signed
//!   manifest for this engine and target, verify it against the pinned
//!   release keys, fetch the artifact into a digest-keyed cache unless it is
//!   already there, and get a lease for that digest, verified against the
//!   published lease keys (refetched once on an unknown key id). All of that
//!   runs without the sign-in lock. Installing takes it briefly, and installs
//!   nothing when the sign-in changed, a "not entitled" answer arrived, or a
//!   newer revision was accepted since the refresh started.
//! - **Dispatch** (offline, on every scan): re-verify the manifest, the
//!   revision floor, the lease and its sign-in, then the artifact's digest,
//!   then run the artifact with
//!   `IMPECCABLE_PRO_CHILD=1`. Anything missing or failing runs the open
//!   engine unchanged with one line on stderr saying why. Under two days of
//!   lease left, a background refresh starts; offline, the lease runs to its
//!   end (offline grace), then the open rules.
//! - Never dispatched: a Pro child (`IMPECCABLE_PRO_CHILD`), an explicit
//!   `$IMPECCABLE_BIN`, `IMPECCABLE_PRO=off`, and every non-scan verb.

pub mod verify;

use crate::config::Account;
use crate::http::{ApiError, Client};
use crate::session::{now, Session, SessionError};
use crate::store::{
    private_dir, read_private, write_private, write_private_mode, Lock, NoFollow, Store,
};
use impeccable_common::Io;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use verify::{verify_lease, verify_manifest, Jwks, Keyring, LeaseError};

/// Renew once a lease has less than this left.
pub const RENEW_WITHIN_SECS: u64 = 2 * 86400;
/// Least time between background refresh attempts (the service allows ten
/// leases per grant per hour).
const RETRY_SECS: u64 = 600;
/// After a "not entitled" answer, ask again at most hourly.
const NOT_ENTITLED_RETRY_SECS: u64 = 3600;
/// The artifact download's own deadline (every other request has the
/// client's 60 seconds). Nothing holds the sign-in lock while it runs.
const ARTIFACT_DEADLINE: Duration = Duration::from_secs(600);
/// How long installing waits for the sign-in lock.
const INSTALL_LOCK_WAIT: Duration = Duration::from_secs(10);
/// How long a refresh waits for another one to finish: an explicit one (at
/// login) waits it out, a background one gives way.
const EXPLICIT_CLAIM_WAIT: Duration = Duration::from_secs(60);
const BACKGROUND_CLAIM_WAIT: Duration = Duration::from_secs(2);

pub const ENGINE: &str = env!("CARGO_PKG_VERSION");

/// This build's platform, in the npm platform-package vocabulary.
pub fn target() -> String {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        other => other,
    };
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        other => other,
    };
    format!("{os}-{arch}")
}

/// What the last refresh installed (`pro/current.json`, one file so it is
/// replaced whole): the manifest bytes and signature exactly as served, so
/// each dispatch re-verifies them, the lease, and the sign-in it belongs to
/// (`State::login`). A lease from another sign-in is never used.
#[derive(Serialize, Deserialize)]
struct Current {
    manifest: String,
    signature: String,
    lease: String,
    login: u64,
    /// When the refresh that installed this started. A "not entitled"
    /// recorded at or after it outranks the install, so the install never
    /// has to delete a marker (and can't erase one written while it waited).
    /// 0 in files from before this field: every marker outranks them.
    #[serde(default)]
    installed_at: u64,
}

struct Paths {
    dir: PathBuf,
    /// This engine and target's own install (manifest, lease, retry clock,
    /// refresh claim), so two skills pinning different engines under one
    /// home never overwrite each other's Pro build.
    install: PathBuf,
    artifacts: PathBuf,
}

impl Paths {
    fn new(account: &Account) -> Paths {
        Paths::for_engine(account, ENGINE)
    }
    fn for_engine(account: &Account, engine: &str) -> Paths {
        let dir = account.dir().join("pro");
        Paths {
            install: dir.join(format!("{engine}-{}", target())),
            dir,
            artifacts: account.home.join("pro").join("artifacts"),
        }
    }
    /// Create the account's Pro folder and this engine's install folder.
    fn ensure(&self) -> Result<(), String> {
        private_dir(&self.dir).and_then(|_| private_dir(&self.install))
    }
    /// Every engine's install folder under this account.
    fn installs(&self) -> Vec<PathBuf> {
        std::fs::read_dir(&self.dir)
            .map(|d| d.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect())
            .unwrap_or_default()
    }
    fn current(&self) -> PathBuf {
        self.install.join("current.json")
    }
    /// Where builds before per-engine installs kept the manifest.
    fn legacy_current(&self) -> PathBuf {
        self.dir.join("current.json")
    }
    /// Where an older build kept the lease; removed when Pro state is.
    fn legacy_lease(&self) -> PathBuf {
        self.dir.join("lease")
    }
    fn claim(&self) -> PathBuf {
        self.install.join("refresh.lock")
    }
    /// The highest revision accepted for this engine and target. Kept
    /// outside the account's Pro state, so forgetting a lease never lowers it.
    fn floor(&self) -> PathBuf {
        self.artifacts
            .with_file_name(format!("floor-{ENGINE}-{}", target()))
    }
    fn jwks(&self) -> PathBuf {
        self.dir.join("lease-keys.json")
    }
    fn attempt(&self) -> PathBuf {
        self.install.join("attempt")
    }
    /// "Not entitled" from builds before per-sign-in markers: it applies to
    /// every sign-in.
    fn not_entitled(&self) -> PathBuf {
        self.dir.join("not-entitled")
    }
    /// "Not entitled" for one sign-in (`State::login`), kept apart so an
    /// answer about one sign-in can never replace or stand in for another's.
    fn not_entitled_for(&self, login: u64) -> PathBuf {
        self.dir.join(format!("not-entitled-{login}"))
    }
    /// Every "not entitled" marker, any sign-in.
    fn not_entitled_all(&self) -> Vec<PathBuf> {
        std::fs::read_dir(&self.dir)
            .map(|d| {
                d.flatten()
                    .map(|e| e.path())
                    .filter(|p| p.file_name().is_some_and(|n| n.to_string_lossy().starts_with("not-entitled")))
                    .filter(|p| !p.to_string_lossy().ends_with("-said"))
                    .collect()
            })
            .unwrap_or_default()
    }
    fn artifact(&self, sha: &str) -> PathBuf {
        self.artifacts
            .join(format!("{sha}{}", std::env::consts::EXE_SUFFIX))
    }
}

fn read_text(path: &Path) -> Option<String> {
    read_private(path)
        .ok()
        .flatten()
        .and_then(|b| String::from_utf8(b).ok())
}

/// The digest of a cached artifact of the signed `size`: `None` unless it is
/// a regular file of exactly that size, owned by this user and not writable
/// by others, checked on the opened handle (no symlink followed, and a FIFO
/// does not block the open). Reads at most `size` bytes.
fn sha256_file(path: &Path, size: u64) -> Option<String> {
    let mut f = std::fs::OpenOptions::new()
        .read(true)
        .no_follow()
        .open(path)
        .ok()?;
    let meta = f.metadata().ok()?;
    if !meta.is_file() || meta.len() != size {
        return None;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        // SAFETY: getuid has no preconditions.
        if meta.uid() != unsafe { libc::getuid() } || meta.mode() & 0o022 != 0 {
            return None;
        }
    }
    let mut hash = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    let mut read = 0u64;
    let mut bounded = Read::by_ref(&mut f).take(size);
    loop {
        let n = bounded.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        read += n as u64;
        hash.update(&buf[..n]);
    }
    (read == size).then(|| format!("{:x}", hash.finalize()))
}

fn floor(paths: &Paths) -> u64 {
    read_text(&paths.floor())
        .and_then(|t| t.trim().parse().ok())
        .unwrap_or(0)
}

/// The floor's own lock file, beside it. (Not `with_extension`: the
/// engine version's dots would cut the name.)
fn floor_lock(paths: &Paths) -> PathBuf {
    let floor = paths.floor();
    let mut name = floor.file_name().unwrap_or_default().to_os_string();
    name.push(".lock");
    floor.with_file_name(name)
}

/// Raise the floor, never lower it. The floor is shared by every account
/// under this home, so the read and the write happen under one lock: two
/// refreshes for different accounts can't write 3 and then 2.
fn raise_floor(paths: &Paths, revision: u64) -> Result<(), String> {
    let lock = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .no_follow()
        .open(floor_lock(paths))
        .map_err(|e| format!("could not open the revision floor lock: {e}"))?;
    lock.lock().map_err(|e| format!("could not lock the revision floor: {e}"))?;
    if revision > floor(paths) {
        write_private(&paths.floor(), revision.to_string().as_bytes())?;
    }
    Ok(())
}

/// Remove every engine's installed manifest and lease for this account.
fn remove_installed(paths: &Paths) {
    for install in paths.installs() {
        let _ = std::fs::remove_file(install.join("current.json"));
    }
    let _ = std::fs::remove_file(paths.legacy_current());
    let _ = std::fs::remove_file(paths.legacy_lease());
}

/// Every engine's retry clock: the next scan of each tries again.
fn remove_attempts(paths: &Paths) {
    for install in paths.installs() {
        let _ = std::fs::remove_file(install.join("attempt"));
    }
}

/// Forget this account's lease and installed manifest, under the sign-in
/// lock so it orders with an install (the artifact cache is shared and
/// content-addressed, and the revision floor stays). With `not_entitled`,
/// the answer is recorded with its time: a refresh that started before it
/// installs nothing.
pub fn forget(account: &Account, not_entitled: bool) {
    forget_if(account, None, not_entitled)
}

/// [`forget`] for a caller that already holds the sign-in lock.
pub fn forget_holding(_lock: &Lock, account: &Account, not_entitled: bool) {
    forget_now(account, not_entitled, None)
}

fn forget_now(account: &Account, not_entitled: bool, login: Option<u64>) {
    let paths = Paths::new(account);
    remove_installed(&paths);
    if not_entitled {
        record_refusal(&paths, login);
    }
}

/// Record "not entitled" with its time and, when known, the sign-in it was
/// about. It needs no lock (one atomic write), so a denial is never lost to a
/// busy lock, and dispatch honors it only for that sign-in.
fn record_refusal(paths: &Paths, login: Option<u64>) {
    if private_dir(&paths.dir).is_ok() {
        let path = login.map_or_else(|| paths.not_entitled(), |l| paths.not_entitled_for(l));
        let _ = write_private(&path, now().to_string().as_bytes());
    }
}

/// When "not entitled" was recorded for sign-in `login` (or, from an older
/// build, for every sign-in).
fn refusal(paths: &Paths, login: u64) -> Option<u64> {
    let read = |p: PathBuf| read_text(&p).and_then(|t| t.trim().parse::<u64>().ok());
    match (read(paths.not_entitled_for(login)), read(paths.not_entitled())) {
        (Some(a), Some(b)) => Some(a.max(b)),
        (a, b) => a.or(b),
    }
}

/// A "not entitled" for sign-in `login` that the installed Pro state, if
/// any, doesn't outrank: one recorded at or after the refresh that installed
/// it started.
fn standing_refusal(paths: &Paths, login: u64) -> Option<u64> {
    let at = refusal(paths, login)?;
    let since = installed(paths, login).map_or(0, |c| c.installed_at);
    (at >= since).then_some(at)
}

/// Remove every "not entitled" marker (a new sign-in or a sign-out).
fn clear_refusals(paths: &Paths) {
    for p in paths.not_entitled_all() {
        let _ = std::fs::remove_file(p);
    }
}

/// Apply an entitlement answer the service gave about sign-in `login`, under
/// the sign-in lock, and only while the machine is still on that sign-in: an
/// answer that arrives after a newer sign-in never touches it. "Not entitled"
/// forgets the Pro state at once. "Entitled" drops an earlier "not entitled"
/// and the retry clock, so the next scan fetches the Pro build.
pub fn settle(account: &Account, login: u64, pro: bool) {
    let store = Store::new(account);
    let paths = Paths::new(account);
    let Ok(lock) = store.lock_for(SETTLE_LOCK_WAIT) else {
        // A busy lock (a token refresh mid-request): a denial is still
        // recorded, tagged with its sign-in, so dispatch stops using Pro for
        // it at once; the lease goes with the next locked step.
        if !pro {
            record_refusal(&paths, Some(login));
        }
        return;
    };
    if !store.state().is_some_and(|s| s.signed_in && s.login == login) {
        return;
    }
    if !pro {
        // Still holding the lock, so this orders with an install.
        forget_now(account, true, Some(login));
        drop(lock);
        return;
    }
    // Lift an earlier "no" and its retry clocks; without one, leave the
    // clocks alone so a failing install keeps its pace.
    let lifted = std::fs::remove_file(paths.not_entitled_for(login)).is_ok()
        | std::fs::remove_file(paths.not_entitled()).is_ok();
    if lifted {
        remove_attempts(&paths);
    }
}

const SETTLE_LOCK_WAIT: Duration = Duration::from_secs(5);

/// [`forget`], skipped when the machine has since signed in again
/// (`login` is the sign-in the answer was about).
fn forget_if(account: &Account, login: Option<u64>, not_entitled: bool) {
    let store = Store::new(account);
    match store.lock() {
        Ok(lock) => {
            let same = login.is_none_or(|l| store.state().is_some_and(|s| s.login == l));
            if same {
                forget_now(account, not_entitled, login);
                drop(lock);
            }
        }
        // The lock is stuck. Without a sign-in to check, forgetting is the
        // safe side; with one, record only a denial tagged with it.
        Err(_) => match login {
            None => forget_now(account, not_entitled, None),
            Some(l) if not_entitled => record_refusal(&Paths::new(account), Some(l)),
            Some(_) => {}
        },
    }
}

/// A new sign-in or a sign-out: nothing Pro carries over to it (installed
/// manifest, lease, the last "not entitled" answer, the retry clock). The
/// caller holds the sign-in lock.
pub fn reset_holding(_lock: &Lock, account: &Account) {
    let paths = Paths::new(account);
    remove_installed(&paths);
    clear_refusals(&paths);
    remove_attempts(&paths);
    if let Ok(d) = std::fs::read_dir(&paths.dir) {
        for e in d.flatten() {
            if e.file_name().to_string_lossy().starts_with("pro-on-said-") {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
}

/// One refresh at a time per account: an exclusive OS lock on
/// `pro/refresh.lock`, waiting up to `wait`.
fn claim(paths: &Paths, wait: Duration) -> Option<std::fs::File> {
    let f = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .no_follow()
        .open(paths.claim())
        .ok()?;
    let deadline = Instant::now() + wait;
    loop {
        match f.try_lock() {
            Ok(()) => return Some(f),
            Err(std::fs::TryLockError::WouldBlock) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(25))
            }
            Err(_) => return None,
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum Refreshed {
    /// The Pro engine is installed; `downloaded` is false on a cache hit.
    Ready {
        revision: u64,
        downloaded: bool,
        lease_exp: u64,
    },
    NotEntitled,
    NotSignedIn,
    /// The service is temporarily unable (503 with its code, or no answer);
    /// an existing lease keeps working until it ends.
    Unavailable(String),
    Failed(String),
}

impl std::fmt::Display for Refreshed {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Refreshed::Ready { .. } => f.write_str("ready"),
            Refreshed::NotEntitled => f.write_str("this account doesn't include them"),
            Refreshed::NotSignedIn => f.write_str("not signed in"),
            Refreshed::Unavailable(why) => write!(f, "the Pro service is unavailable ({why})"),
            Refreshed::Failed(why) => f.write_str(why),
        }
    }
}

fn from_session(e: SessionError, account: &Account, login: Option<u64>) -> Refreshed {
    match e {
        SessionError::NotSignedIn | SessionError::Expired => {
            forget_if(account, login, false);
            Refreshed::NotSignedIn
        }
        SessionError::Api(e) => from_api(e, account, login),
        SessionError::Local(e) => Refreshed::Failed(e),
    }
}

fn from_api(e: ApiError, account: &Account, login: Option<u64>) -> Refreshed {
    match (e.status(), e.code()) {
        (Some(403), Some("not_entitled")) => {
            forget_if(account, login, true);
            Refreshed::NotEntitled
        }
        (Some(503), Some(code)) => Refreshed::Unavailable(code.to_string()),
        (None, _) => Refreshed::Unavailable(e.to_string()),
        _ => Refreshed::Failed(format!("the Pro service answered {e}")),
    }
}

/// Fetch, verify and install the Pro engine and its lease, waiting for a
/// refresh already running (the one at login).
pub fn refresh(account: &Account, keys: &Keyring) -> Refreshed {
    refresh_with(account, keys, EXPLICIT_CLAIM_WAIT)
}

fn refresh_with(account: &Account, keys: &Keyring, wait: Duration) -> Refreshed {
    let paths = Paths::new(account);
    if let Err(e) = paths.ensure().and_then(|_| private_dir(&paths.artifacts)) {
        return Refreshed::Failed(e);
    }
    let Some(_claim) = claim(&paths, wait) else {
        return Refreshed::Failed("another Pro refresh is still running".into());
    };
    let started = now();
    let _ = write_private(&paths.attempt(), started.to_string().as_bytes());
    let mut session = match Session::load(account) {
        Ok(s) => s,
        Err(e) => return from_session(e, account, None),
    };
    let login = session.state.login;
    let fail = |e: SessionError| from_session(e, account, Some(login));

    // No sign-in lock from here to the install: a slow or stalled service
    // never holds up `login` or `logout`. Token rotation takes it briefly.
    let target = target();
    // `+` is legal in semver build metadata and would decode as a space.
    let query: String = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("engine", ENGINE)
        .append_pair("target", &target)
        .finish();
    let url = format!("{}/cli/v1/manifest?{query}", account.issuer);
    let fetched =
        session.call(|c, t| c.get_bytes(&url, t, Some("x-impeccable-signature"), 64 * 1024));
    let (bytes, signature) = match fetched {
        Ok((b, Some(s))) => (b, s),
        Ok((_, None)) => return Refreshed::Failed("the release has no signature".into()),
        Err(e) => return fail(e),
    };
    let manifest = match verify_manifest(&bytes, &signature, keys, ENGINE, &target) {
        Ok(m) => m,
        Err(e) => return Refreshed::Failed(e.to_string()),
    };
    // Anti-rollback: never step back below a revision already accepted.
    if manifest.artifact_revision < floor(&paths) {
        return Refreshed::Failed(
            "the service offered an older Pro build than one already installed".into(),
        );
    }

    let exe = paths.artifact(&manifest.artifact_sha256);
    let cached =
        sha256_file(&exe, manifest.size).as_deref() == Some(manifest.artifact_sha256.as_str());
    let downloaded = if cached {
        false
    } else {
        let url = format!(
            "{}/cli/v1/artifact/{}",
            account.issuer, manifest.artifact_sha256
        );
        let slow = Client::with_deadline(account, ARTIFACT_DEADLINE);
        let body = match session.call(|_, t| slow.get_bytes(&url, t, None, manifest.size)) {
            Ok((b, _)) => b,
            Err(e) => return fail(e),
        };
        if body.len() as u64 != manifest.size
            || format!("{:x}", Sha256::digest(&body)) != manifest.artifact_sha256
        {
            return Refreshed::Failed(
                "the downloaded Pro build does not match its signed digest".into(),
            );
        }
        if let Err(e) = write_private_mode(&exe, &body, 0o700) {
            return Refreshed::Failed(format!("could not save the Pro build: {e}"));
        }
        true
    };

    let jwks = read_text(&paths.jwks()).and_then(|t| serde_json::from_str::<Jwks>(&t).ok());
    let keep = match (installed(&paths, login), &jwks) {
        (Some(c), Some(k)) => verify_lease(&c.lease, k, &manifest.artifact_sha256, now())
            .ok()
            .filter(|claims| claims.exp > now() + RENEW_WITHIN_SECS)
            .map(|claims| (c.lease, claims.exp)),
        _ => None,
    };
    let (lease, lease_exp) = match keep {
        Some(l) => l,
        None => {
            let url = format!("{}/cli/v1/lease", account.issuer);
            let body = serde_json::json!({ "artifact_sha256": manifest.artifact_sha256 });
            let answer = match session.call(|c, t| c.post_json(&url, t, body.clone())) {
                Ok(v) => v,
                Err(e) => return fail(e),
            };
            let Some(lease) = answer
                .get("lease")
                .and_then(|l| l.as_str())
                .map(str::to_string)
            else {
                return Refreshed::Failed("the lease answer was malformed".into());
            };
            match accept_lease(account, &paths, &lease, jwks, &manifest.artifact_sha256) {
                Ok(exp) => (lease, exp),
                Err(e) => return Refreshed::Failed(e),
            }
        }
    };

    // Install, under the sign-in lock, only if nothing happened since this
    // refresh started that it would undo.
    let store = Store::new(account);
    let Ok(lock) = store.lock_for(INSTALL_LOCK_WAIT) else {
        return Refreshed::Failed("another impeccable sign-in step is still running".into());
    };
    if !store
        .state()
        .is_some_and(|s| s.signed_in && s.login == login)
    {
        return Refreshed::NotSignedIn;
    }
    let refused_at = refusal(&paths, login);
    if refused_at.is_some_and(|t| t >= started) {
        return Refreshed::NotEntitled;
    }
    if manifest.artifact_revision < floor(&paths) {
        return Refreshed::Failed(
            "the service offered an older Pro build than one already installed".into(),
        );
    }
    let current = Current {
        manifest: String::from_utf8_lossy(&bytes).into_owned(),
        signature,
        lease,
        login,
        installed_at: started,
    };
    let written = serde_json::to_vec(&current)
        .map_err(|e| e.to_string())
        .and_then(|c| write_private(&paths.current(), &c))
        .and_then(|_| raise_floor(&paths, manifest.artifact_revision));
    if let Err(e) = written {
        return Refreshed::Failed(e);
    }
    // Earlier "not entitled" markers stay: `installed_at` outranks them, and
    // deleting here could erase one recorded while this install waited.
    let _ = std::fs::remove_file(paths.legacy_lease());
    drop(lock);
    Refreshed::Ready {
        revision: manifest.artifact_revision,
        downloaded,
        lease_exp,
    }
}

/// The installed state, if it belongs to sign-in `login`.
fn installed(paths: &Paths, login: u64) -> Option<Current> {
    read_text(&paths.current())
        .and_then(|t| serde_json::from_str::<Current>(&t).ok())
        .filter(|c| c.login == login)
}

/// Verify a new lease with the cached lease keys; on an unknown key id (or
/// no cache), fetch the published keys once and try again.
fn accept_lease(
    account: &Account,
    paths: &Paths,
    lease: &str,
    cached: Option<Jwks>,
    sha: &str,
) -> Result<u64, String> {
    if let Some(k) = &cached {
        match verify_lease(lease, k, sha, now()) {
            Ok(c) => return Ok(c.exp),
            Err(LeaseError::UnknownKid) => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    let url = format!("{}/.well-known/impeccable-cli-keys.json", account.issuer);
    let fresh = crate::http::Client::new(account)
        .get_json(&url, None)
        .map_err(|e| format!("could not read the lease keys: {e}"))?;
    let jwks: Jwks = serde_json::from_value(fresh.clone())
        .map_err(|_| "the lease keys are malformed".to_string())?;
    let claims = verify_lease(lease, &jwks, sha, now()).map_err(|e| e.to_string())?;
    write_private(&paths.jwks(), fresh.to_string().as_bytes())?;
    Ok(claims.exp)
}

/// Why a scan runs the open engine, as one terse line (or nothing, for a
/// machine that was never signed in).
#[derive(Debug, PartialEq, Eq)]
pub enum Decision {
    Pro {
        exe: PathBuf,
        renew: bool,
    },
    Open {
        why: Option<&'static str>,
        renew: bool,
    },
}

pub const WHY_NOT_READY: &str = "Pro rules aren't ready yet; using the open rules.";
pub const WHY_NOT_ENTITLED: &str = "Pro rules are off: this account doesn't include them.";
pub const WHY_EXPIRED: &str = "Pro rules are off until the Pro lease renews; using the open rules.";
pub const WHY_UNVERIFIED: &str =
    "Pro rules are off: the Pro build didn't verify; using the open rules.";

/// Flags that mean a program reads this scan's output. The not-entitled line
/// stays out of it, even on stderr.
const MACHINE_OUTPUT: &[&str] = &["--json", "-json", "--github", "--quiet"];

/// Whether this scan prints `why`. Paul's choice (REN-1553 decision 1, 10 Nov):
/// an account without Pro hears "this account doesn't include them" on every
/// scan a person runs, but never from the edit hooks and never when the output
/// is for a program. The other lines say something is wrong or about to change,
/// so they always print.
fn say(why: &str, args: &[String]) -> bool {
    if why != WHY_NOT_ENTITLED {
        return true;
    }
    let hook = matches!(args.first().map(String::as_str), Some("hook" | "hook-before-edit"));
    !hook && !args.iter().any(|a| MACHINE_OUTPUT.contains(&a.as_str()))
}

/// Whether this scan says "Pro rules are on." It does once per sign-in, from
/// a scan a person ran that the Pro build takes: never from the edit hooks or
/// with machine output, and those don't use it up. The marker is created
/// atomically, so two scans at once can't both say it.
fn say_pro_on(paths: &Paths, login: u64, args: &[String]) -> bool {
    let hook = matches!(args.first().map(String::as_str), Some("hook" | "hook-before-edit"));
    if hook || args.iter().any(|a| MACHINE_OUTPUT.contains(&a.as_str())) {
        return false;
    }
    if private_dir(&paths.dir).is_err() {
        return false;
    }
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(paths.dir.join(format!("pro-on-said-{login}")))
        .is_ok()
}

pub const PRO_ON: &str = "Pro rules are on.";

/// The offline decision for one scan. No network. The cheap checks come
/// first; the artifact is hashed only when everything else holds.
pub fn decide(account: &Account, keys: &Keyring, at: u64) -> Decision {
    let store = Store::new(account);
    let Some(state) = store.state().filter(|s| s.signed_in) else {
        return Decision::Open {
            why: None,
            renew: false,
        };
    };
    let paths = Paths::new(account);
    if standing_refusal(&paths, state.login).is_some() {
        return Decision::Open {
            why: Some(WHY_NOT_ENTITLED),
            renew: due(&paths, at, NOT_ENTITLED_RETRY_SECS),
        };
    }
    let renew = due(&paths, at, RETRY_SECS);
    let open = |why| Decision::Open {
        why: Some(why),
        renew,
    };
    // Nothing installed, or installed for an earlier sign-in.
    let Some(current) = installed(&paths, state.login) else {
        return open(WHY_NOT_READY);
    };
    let manifest = match verify_manifest(
        current.manifest.as_bytes(),
        &current.signature,
        keys,
        ENGINE,
        &target(),
    ) {
        Ok(m) => m,
        // An engine update makes the installed build stale: fetch the new one.
        Err(verify::ManifestError::NotForThisEngine) => return open(WHY_NOT_READY),
        Err(_) => return open(WHY_UNVERIFIED),
    };
    if manifest.artifact_revision < floor(&paths) {
        return open(WHY_UNVERIFIED);
    }
    let Some(jwks) = read_text(&paths.jwks()).and_then(|t| serde_json::from_str::<Jwks>(&t).ok())
    else {
        return open(WHY_EXPIRED);
    };
    let claims = match verify_lease(&current.lease, &jwks, &manifest.artifact_sha256, at) {
        Ok(c) => c,
        Err(LeaseError::Expired) => return open(WHY_EXPIRED),
        Err(_) => return open(WHY_UNVERIFIED),
    };
    let exe = paths.artifact(&manifest.artifact_sha256);
    if sha256_file(&exe, manifest.size).as_deref() != Some(manifest.artifact_sha256.as_str()) {
        return open(WHY_UNVERIFIED);
    }
    Decision::Pro {
        exe,
        renew: claims.exp <= at + RENEW_WITHIN_SECS && renew,
    }
}

fn due(paths: &Paths, at: u64, every: u64) -> bool {
    let last = read_text(&paths.attempt())
        .and_then(|t| t.trim().parse::<u64>().ok())
        .unwrap_or(0);
    at.saturating_sub(last) >= every
}

/// The entry point the open binary calls before routing a scan verb. `Some`
/// is the Pro child's exit code; `None` means run the open engine (after
/// any line this printed).
pub fn dispatch(args: &[String], io: &mut Io) -> Option<i32> {
    if io
        .env("IMPECCABLE_PRO_CHILD")
        .is_some_and(|v| !v.is_empty())
        || io.env("IMPECCABLE_BIN").is_some_and(|v| !v.is_empty())
        || io.env("IMPECCABLE_PRO").is_some_and(|v| {
            matches!(
                v.to_ascii_lowercase().as_str(),
                "0" | "off" | "false" | "no"
            )
        })
    {
        return None;
    }
    let account = Account::from_env(&io.env).ok()?;
    let keys = verify::pinned_keys(&io.env);
    let decision = decide(&account, &keys, now());
    let (why, renew) = match &decision {
        Decision::Pro { renew, .. } => (None, *renew),
        Decision::Open { why, renew } => (*why, *renew),
    };
    if renew {
        spawn_refresh(&account);
    }
    if let Some(why) = why.filter(|w| say(w, args)) {
        io.err(&format!("{why}\n"));
    }
    let Decision::Pro { exe, .. } = decision else {
        return None;
    };
    let mut cmd = std::process::Command::new(&exe);
    cmd.args(args).env("IMPECCABLE_PRO_CHILD", "1");
    // Said before the hand-off: on Unix the Pro build replaces this process.
    let paths = Paths::new(&account);
    let login = Store::new(&account).state().map(|s| s.login);
    let said = login.filter(|&l| say_pro_on(&paths, l, args));
    if said.is_some() {
        io.err(&format!("{PRO_ON}\n"));
    }
    let _ = std::io::Write::flush(&mut io.stderr);
    let started = run_child(cmd);
    if started.is_err() {
        // It didn't run after all: let the next scan that does say so.
        if let Some(l) = said {
            let _ = std::fs::remove_file(paths.dir.join(format!("pro-on-said-{l}")));
        }
    }
    match started {
        Ok(code) => Some(code),
        Err(e) => {
            io.err(&format!(
                "Pro rules are off: the Pro build couldn't start ({}); using the open rules.\n",
                e.kind()
            ));
            None
        }
    }
}

/// Unix replaces this process, so stdin, signals and the exit status are the
/// child's own; elsewhere the child runs to completion and its code is ours.
#[cfg(unix)]
fn run_child(mut cmd: std::process::Command) -> std::io::Result<i32> {
    use std::os::unix::process::CommandExt;
    Err(cmd.exec())
}

#[cfg(not(unix))]
fn run_child(mut cmd: std::process::Command) -> std::io::Result<i32> {
    cmd.status().map(|s| s.code().unwrap_or(1))
}

/// Start `impeccable pro-refresh` detached, never waiting on it. The
/// attempt is claimed first, under the refresh lock: of many scans that
/// find a refresh due at once, one starts it.
fn spawn_refresh(account: &Account) {
    let Ok(me) = std::env::current_exe() else {
        return;
    };
    let paths = Paths::new(account);
    if paths.ensure().is_err() {
        return;
    }
    let Some(claim) = claim(&paths, Duration::ZERO) else {
        return;
    };
    let login = Store::new(account).state().map(|s| s.login).unwrap_or(0);
    let every = if standing_refusal(&paths, login).is_some() {
        NOT_ENTITLED_RETRY_SECS
    } else {
        RETRY_SECS
    };
    if !due(&paths, now(), every)
        || write_private(&paths.attempt(), now().to_string().as_bytes()).is_err()
    {
        return;
    }
    drop(claim);
    let mut cmd = std::process::Command::new(me);
    cmd.arg("pro-refresh")
        .env_remove("IMPECCABLE_PRO_CHILD")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    impeccable_common::proc::detach(&mut cmd);
    let _ = cmd.spawn();
}

/// Hidden verb `pro-refresh`: one refresh, then a line on stderr.
pub fn run_refresh(_args: &[String], io: &mut Io) -> i32 {
    let account = match Account::from_env(&io.env) {
        Ok(a) => a,
        Err(e) => {
            io.err(&format!("{e}.\n"));
            return 1;
        }
    };
    let outcome = refresh_with(
        &account,
        &verify::pinned_keys(&io.env),
        BACKGROUND_CLAIM_WAIT,
    );
    report(io, &outcome);
    i32::from(!matches!(outcome, Refreshed::Ready { .. }))
}

pub fn report(io: &mut Io, outcome: &Refreshed) {
    match outcome {
        Refreshed::Ready { .. } => io.err("Pro rules: ready.\n"),
        Refreshed::NotEntitled => io.err("Pro rules: not included with this account.\n"),
        other => io.err(&format!("Pro rules: not ready ({other}).\n")),
    }
}

#[cfg(test)]
mod notice_tests {
    use super::*;

    #[test]
    fn pro_on_is_said_once_per_sign_in_and_never_from_hooks_or_machine_output() {
        // Catches: "Pro rules are on." repeating on every scan or edit hook, or landing in --json output.
        let dir = std::env::temp_dir().join(format!("impeccable-pro-on-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let paths = Paths { dir: dir.join("pro"), install: dir.join("pro").join("engine"), artifacts: dir.join("artifacts") };
        let args = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        // Hooks and machine output never say it, and never use it up.
        assert!(!say_pro_on(&paths, 7, &args(&["hook"])));
        assert!(!say_pro_on(&paths, 7, &args(&["hook-before-edit"])));
        assert!(!say_pro_on(&paths, 7, &args(&["detect", "--json", "."])));
        // The first scan a person runs says it; later ones don't.
        assert!(say_pro_on(&paths, 7, &args(&["detect", "."])));
        assert!(!say_pro_on(&paths, 7, &args(&["detect", "."])));
        assert!(!say_pro_on(&paths, 7, &args(&["src/"])));
        // A new sign-in hears it again.
        assert!(say_pro_on(&paths, 8, &args(&["src/"])));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_account_without_pro_hears_it_on_every_detect_but_never_from_hooks_or_machine_output() {
        // Catches (REN-1553 decision 1, Paul 10 Nov): the line throttled to once a day, said from
        // an edit hook, or mixed into output a program reads (--json, --github, --quiet).
        let args = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert!(!say(WHY_NOT_ENTITLED, &args(&["hook"])));
        assert!(!say(WHY_NOT_ENTITLED, &args(&["hook-before-edit"])));
        assert!(say(WHY_NOT_ENTITLED, &args(&["detect", "."])));
        assert!(say(WHY_NOT_ENTITLED, &args(&["detect", "."])), "every run, not once a day");
        assert!(say(WHY_NOT_ENTITLED, &args(&["src/"])));
        for flag in ["--json", "-json", "--github", "--quiet"] {
            assert!(!say(WHY_NOT_ENTITLED, &args(&["detect", flag, "."])), "{flag}");
            assert!(!say(WHY_NOT_ENTITLED, &args(&["src/", flag])), "{flag}");
        }
        // Lines that say something is wrong are never held back.
        assert!(say(WHY_UNVERIFIED, &args(&["hook"])));
        assert!(say(WHY_UNVERIFIED, &args(&["detect", "--json", "."])));
    }
}

#[cfg(test)]
mod install_tests {
    use super::*;

    fn account(name: &str) -> Account {
        let home = std::env::temp_dir().join(format!("impeccable-pro-{name}-{}", std::process::id()));
        Account { issuer: "https://api.example.test".into(), home }
    }

    #[test]
    fn two_engines_keep_their_own_install_and_forget_clears_both() {
        // Catches (review, Greptile): two skills pinning different engines under one home overwriting each other's manifest and lease.
        let a = account("engines");
        let (old, new) = (Paths::for_engine(&a, "0.1.20"), Paths::for_engine(&a, "0.1.21"));
        assert_ne!(old.current(), new.current());
        assert_ne!(old.attempt(), new.attempt());
        assert_ne!(old.claim(), new.claim());
        for p in [&old, &new] {
            p.ensure().unwrap();
            write_private(&p.current(), b"{}").unwrap();
        }
        remove_installed(&new);
        assert!(!old.current().exists() && !new.current().exists());
        let _ = std::fs::remove_dir_all(&a.home);
    }

    #[test]
    fn each_floor_has_its_own_lock() {
        // Catches (review, Cursor): with_extension cutting "floor-0.1.21-…" at the version's dot, so every engine shared "floor-0.1.lock".
        let a = account("floor-lock");
        let lock = floor_lock(&Paths::new(&a));
        assert_eq!(
            lock.file_name().unwrap().to_string_lossy(),
            format!("{}.lock", Paths::new(&a).floor().file_name().unwrap().to_string_lossy())
        );
    }

    #[test]
    fn concurrent_floor_raises_keep_the_highest() {
        // Catches (review, Greptile): two accounts' refreshes racing so a lower revision overwrites a higher floor.
        let a = account("floor");
        let paths = Paths::new(&a);
        std::fs::create_dir_all(paths.floor().parent().unwrap()).unwrap();
        for round in 0..20u64 {
            let base = round * 100;
            std::thread::scope(|s| {
                for r in 1..=16 {
                    let paths = &paths;
                    s.spawn(move || raise_floor(paths, base + r).unwrap());
                }
            });
            assert_eq!(floor(&paths), base + 16, "round {round}");
        }
        let _ = std::fs::remove_dir_all(&a.home);
    }
}
