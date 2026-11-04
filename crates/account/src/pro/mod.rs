//! Pro dispatch: a signed-in, entitled machine runs scans on the Pro engine,
//! a separate signed build of this CLI with the Pro rule pack linked in.
//!
//! - **Refresh** (network, under the lifecycle lock; at login, and in a
//!   detached `pro-refresh` child): fetch the signed manifest for this
//!   engine and target, verify it against the pinned release keys, fetch the
//!   artifact into a digest-keyed cache unless it is already there, and get
//!   a lease for that digest, verified against the published lease keys
//!   (refetched once on an unknown key id).
//! - **Dispatch** (offline, on every scan): re-verify the manifest, the
//!   artifact's digest and the lease, then run the artifact with
//!   `IMPECCABLE_PRO_CHILD=1`. Anything missing or failing runs the open
//!   engine unchanged with one line on stderr saying why. Under two days of
//!   lease left, a background refresh starts; offline, the lease runs to its
//!   end (offline grace), then the open rules.
//! - Never dispatched: a Pro child (`IMPECCABLE_PRO_CHILD`), an explicit
//!   `$IMPECCABLE_BIN`, `IMPECCABLE_PRO=off`, and every non-scan verb.

pub mod verify;

use crate::config::Account;
use crate::http::ApiError;
use crate::session::{now, Session, SessionError};
use crate::store::{private_dir, read_private, write_private, Store};
use impeccable_common::Io;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};
use verify::{verify_lease, verify_manifest, Jwks, Keyring, LeaseError};

/// Renew once a lease has less than this left.
pub const RENEW_WITHIN_SECS: u64 = 2 * 86400;
/// Least time between background refresh attempts (the service allows ten
/// leases per grant per hour).
const RETRY_SECS: u64 = 600;
/// After a "not entitled" answer, ask again at most hourly.
const NOT_ENTITLED_RETRY_SECS: u64 = 3600;

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

/// What the last refresh installed (`pro/current.json`): the manifest bytes
/// and signature exactly as served, so each dispatch re-verifies them.
#[derive(Serialize, Deserialize)]
struct Current {
    manifest: String,
    signature: String,
}

struct Paths {
    dir: PathBuf,
    artifacts: PathBuf,
}

impl Paths {
    fn new(account: &Account) -> Paths {
        Paths {
            dir: account.dir().join("pro"),
            artifacts: account.home.join("pro").join("artifacts"),
        }
    }
    fn current(&self) -> PathBuf {
        self.dir.join("current.json")
    }
    fn lease(&self) -> PathBuf {
        self.dir.join("lease")
    }
    fn jwks(&self) -> PathBuf {
        self.dir.join("lease-keys.json")
    }
    fn attempt(&self) -> PathBuf {
        self.dir.join("attempt")
    }
    fn not_entitled(&self) -> PathBuf {
        self.dir.join("not-entitled")
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

fn sha256_file(path: &Path) -> Option<String> {
    let mut f = std::fs::File::open(path).ok()?;
    let mut hash = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        let n = f.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        hash.update(&buf[..n]);
    }
    Some(format!("{:x}", hash.finalize()))
}

/// Forget this account's lease and installed manifest (the artifact cache is
/// shared and content-addressed, so it stays).
pub fn forget(account: &Account, not_entitled: bool) {
    let paths = Paths::new(account);
    let _ = std::fs::remove_file(paths.lease());
    let _ = std::fs::remove_file(paths.current());
    if not_entitled && private_dir(&paths.dir).is_ok() {
        let _ = write_private(&paths.not_entitled(), now().to_string().as_bytes());
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

fn from_session(e: SessionError, account: &Account) -> Refreshed {
    match e {
        SessionError::NotSignedIn | SessionError::Expired => {
            forget(account, false);
            Refreshed::NotSignedIn
        }
        SessionError::Api(e) => from_api(e, account),
        SessionError::Local(e) => Refreshed::Failed(e),
    }
}

fn from_api(e: ApiError, account: &Account) -> Refreshed {
    match (e.status(), e.code()) {
        (Some(403), Some("not_entitled")) => {
            forget(account, true);
            Refreshed::NotEntitled
        }
        (Some(503), Some(code)) => Refreshed::Unavailable(code.to_string()),
        (None, _) => Refreshed::Unavailable(e.to_string()),
        _ => Refreshed::Failed(format!("the Pro service answered {e}")),
    }
}

/// Fetch, verify and install the Pro engine and its lease. Holds the
/// lifecycle lock throughout, so it never races login, logout or another
/// refresh.
pub fn refresh(account: &Account, keys: &Keyring) -> Refreshed {
    let store = Store::new(account);
    let Ok(lock) = store.lock() else {
        return Refreshed::Failed("another impeccable sign-in step is still running".into());
    };
    let mut session = match Session::load(account) {
        Ok(s) => s,
        Err(e) => return from_session(e, account),
    };
    let paths = Paths::new(account);
    if let Err(e) = private_dir(&paths.dir).and_then(|_| private_dir(&paths.artifacts)) {
        return Refreshed::Failed(e);
    }
    let _ = write_private(&paths.attempt(), now().to_string().as_bytes());

    // This process holds the lock, so token refreshes below use it rather
    // than taking it again.
    let target = target();
    // `+` is legal in semver build metadata and would decode as a space.
    let query: String = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("engine", ENGINE)
        .append_pair("target", &target)
        .finish();
    let url = format!("{}/cli/v1/manifest?{query}", account.issuer);
    let fetched = session.call_locked(&lock, |c, t| {
        c.get_bytes(&url, t, Some("x-impeccable-signature"), 64 * 1024)
    });
    let (bytes, signature) = match fetched {
        Ok((b, Some(s))) => (b, s),
        Ok((_, None)) => return Refreshed::Failed("the release has no signature".into()),
        Err(e) => return from_session(e, account),
    };
    let manifest = match verify_manifest(&bytes, &signature, keys, ENGINE, &target) {
        Ok(m) => m,
        Err(e) => return Refreshed::Failed(e.to_string()),
    };
    // Anti-replay: never step back to an older revision than the installed one.
    let installed = installed_manifest(&paths, keys, &target);
    if let Some(old) = &installed {
        if manifest.artifact_revision < old.artifact_revision {
            return Refreshed::Failed(
                "the service offered an older Pro build than the installed one".into(),
            );
        }
    }

    let exe = paths.artifact(&manifest.artifact_sha256);
    let downloaded = if sha256_file(&exe).as_deref() == Some(manifest.artifact_sha256.as_str()) {
        false
    } else {
        let url = format!(
            "{}/cli/v1/artifact/{}",
            account.issuer, manifest.artifact_sha256
        );
        let body =
            match session.call_locked(&lock, |c, t| c.get_bytes(&url, t, None, manifest.size)) {
                Ok((b, _)) => b,
                Err(e) => return from_session(e, account),
            };
        if body.len() as u64 != manifest.size
            || format!("{:x}", Sha256::digest(&body)) != manifest.artifact_sha256
        {
            return Refreshed::Failed(
                "the downloaded Pro build does not match its signed digest".into(),
            );
        }
        if let Err(e) = install_artifact(&exe, &body) {
            return Refreshed::Failed(e);
        }
        true
    };

    let current_lease = read_text(&paths.lease());
    let jwks = read_text(&paths.jwks()).and_then(|t| serde_json::from_str::<Jwks>(&t).ok());
    let keep = match (&current_lease, &jwks) {
        (Some(l), Some(k)) => verify_lease(l, k, &manifest.artifact_sha256, now())
            .ok()
            .filter(|c| c.exp > now() + RENEW_WITHIN_SECS)
            .map(|c| (l.clone(), c.exp)),
        _ => None,
    };
    let (lease, lease_exp) = match keep {
        Some(l) => l,
        None => {
            let url = format!("{}/cli/v1/lease", account.issuer);
            let body = serde_json::json!({ "artifact_sha256": manifest.artifact_sha256 });
            let answer = match session.call_locked(&lock, |c, t| c.post_json(&url, t, body.clone()))
            {
                Ok(v) => v,
                Err(e) => return from_session(e, account),
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
    let current = Current {
        manifest: String::from_utf8_lossy(&bytes).into_owned(),
        signature,
    };
    let written = serde_json::to_vec(&current)
        .map_err(|e| e.to_string())
        .and_then(|c| {
            write_private(&paths.lease(), lease.as_bytes())
                .and_then(|_| write_private(&paths.current(), &c))
        });
    if let Err(e) = written {
        return Refreshed::Failed(e);
    }
    let _ = std::fs::remove_file(paths.not_entitled());
    Refreshed::Ready {
        revision: manifest.artifact_revision,
        downloaded,
        lease_exp,
    }
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

fn install_artifact(exe: &Path, body: &[u8]) -> Result<(), String> {
    let temp = exe.with_extension(format!("{}.part", std::process::id()));
    let result = (|| -> std::io::Result<()> {
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o700);
        }
        std::io::Write::write_all(&mut opts.open(&temp)?, body)?;
        std::fs::rename(&temp, exe)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result.map_err(|e| format!("could not save the Pro build: {e}"))
}

fn installed_manifest(paths: &Paths, keys: &Keyring, target: &str) -> Option<verify::Manifest> {
    let current: Current = serde_json::from_str(&read_text(&paths.current())?).ok()?;
    verify_manifest(
        current.manifest.as_bytes(),
        &current.signature,
        keys,
        ENGINE,
        target,
    )
    .ok()
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

/// The offline decision for one scan. No network.
pub fn decide(account: &Account, keys: &Keyring, at: u64) -> Decision {
    let store = Store::new(account);
    if !store.state().is_some_and(|s| s.signed_in) {
        return Decision::Open {
            why: None,
            renew: false,
        };
    }
    let paths = Paths::new(account);
    if paths.not_entitled().exists() {
        return Decision::Open {
            why: Some(WHY_NOT_ENTITLED),
            renew: due(&paths, at, NOT_ENTITLED_RETRY_SECS),
        };
    }
    let renew = due(&paths, at, RETRY_SECS);
    let Some(current) =
        read_text(&paths.current()).and_then(|t| serde_json::from_str::<Current>(&t).ok())
    else {
        return Decision::Open {
            why: Some(WHY_NOT_READY),
            renew,
        };
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
        Err(verify::ManifestError::NotForThisEngine) => {
            return Decision::Open {
                why: Some(WHY_NOT_READY),
                renew,
            }
        }
        Err(_) => {
            return Decision::Open {
                why: Some(WHY_UNVERIFIED),
                renew,
            }
        }
    };
    let exe = paths.artifact(&manifest.artifact_sha256);
    if sha256_file(&exe).as_deref() != Some(manifest.artifact_sha256.as_str()) {
        return Decision::Open {
            why: Some(WHY_UNVERIFIED),
            renew,
        };
    }
    let jwks = read_text(&paths.jwks()).and_then(|t| serde_json::from_str::<Jwks>(&t).ok());
    let lease = read_text(&paths.lease());
    match (lease, jwks) {
        (Some(l), Some(k)) => match verify_lease(&l, &k, &manifest.artifact_sha256, at) {
            Ok(c) => Decision::Pro {
                exe,
                renew: c.exp <= at + RENEW_WITHIN_SECS && renew,
            },
            Err(LeaseError::Expired) => Decision::Open {
                why: Some(WHY_EXPIRED),
                renew,
            },
            Err(_) => Decision::Open {
                why: Some(WHY_UNVERIFIED),
                renew,
            },
        },
        _ => Decision::Open {
            why: Some(WHY_EXPIRED),
            renew,
        },
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
    if let Some(why) = why {
        io.err(&format!("{why}\n"));
    }
    let Decision::Pro { exe, .. } = decision else {
        return None;
    };
    let mut cmd = std::process::Command::new(&exe);
    cmd.args(args).env("IMPECCABLE_PRO_CHILD", "1");
    let _ = std::io::Write::flush(&mut io.stderr);
    match run_child(cmd) {
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

/// Start `impeccable pro-refresh` detached, never waiting on it.
fn spawn_refresh(account: &Account) {
    let Ok(me) = std::env::current_exe() else {
        return;
    };
    let paths = Paths::new(account);
    if private_dir(&paths.dir).is_err() {
        return;
    }
    // Claim the attempt now so parallel scans don't all start one.
    let _ = write_private(&paths.attempt(), now().to_string().as_bytes());
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
    let outcome = refresh(&account, &verify::pinned_keys(&io.env));
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
