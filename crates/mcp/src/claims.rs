//! The local MCP as Loop's observer of one agent session (REN-2503, design v3). The server is the only authority over
//! who holds an inbox; this process claims it under the CLI's own sign-in, renews its lease without model turns,
//! records receipt of the deliveries it hands the agent, and releases it when the session ends.
//!
//! - **Which session:** the harness that started this process (`presence::harness_process`) and the harness's own
//!   session id, from Loop's hook record that names that process by pid and start time. No record, no claim.
//! - **Handles:** a random instance handle that lives only in this process's memory, and the installation handle kept
//!   once in `<IMPECCABLE_HOME>/installation`. Neither appears in a tool's arguments or results, so a model can't pass
//!   or forge one. Calls to `/mcp` carry the instance as `Impeccable-Instance` while a claim is held.
//! - **Rebind:** `<IMPECCABLE_HOME>/running/session-<sha256(harness + session)>.json` keeps the inbox's name and
//!   project, so a restarted MCP in the same harness session claims the same inbox before the agent names itself.
//! - **Wake proof:** Loop's `claims/<sha256(harness + session)>.json` names the claim Loop may wake, checked against
//!   Loop's own sign-in. It never holds a handle.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// How often a held lease is renewed: a third of the lease the server gives (60 s, so every 20 s).
const RENEW_SHARE: u32 = 3;
/// How long a conflict holds off the next claim: the server's lease (60 s), after which a gone holder has lapsed.
const LEASE_FALLBACK: Duration = Duration::from_secs(60);
/// The server takes at most this many delivery ids in one receipt.
const RECEIPT_MAX: usize = 100;
/// Loop's own records and proofs are small; anything larger isn't one.
const RECORD_MAX: u64 = 4096;

/// Why the claims door didn't answer.
#[derive(Debug, PartialEq, Eq)]
pub enum Refused {
    /// The door isn't there (`NEEDS_YOU_CLAIMS` off): this process does nothing more.
    Off,
    /// Another live session holds the inbox.
    Conflict,
    /// The lease lapsed: the claim is gone and is taken again on the next Needs-you call.
    Lapsed,
    /// Anything else (no sign-in, the network): tried again later.
    Other,
}

/// `POST /cli/v1/needs-you/claims` under the CLI's own sign-in. Its own trait so the renewal thread can hold one.
pub trait Door: Send {
    fn post(&mut self, body: &Value) -> Result<Value, Refused>;
    /// The account service's issuer origin, as Loop's sign-in names it.
    fn issuer(&self) -> Option<String>;
}

/// The harness process this session runs in, as found at `initialize`.
#[derive(Clone, Debug, PartialEq)]
pub struct Harness {
    /// Loop's name for it: claude, codex, cursor, copilot, opencode or antigravity.
    pub name: &'static str,
    pub pid: u32,
    /// Its start as seconds and microseconds since the epoch, where the system gives them (macOS).
    pub started: Option<(u64, u64)>,
    /// Its start as `ps -o lstart` prints it here (local time).
    pub lstart: String,
    /// The session's name the harness was started with (`claude --name …`).
    pub session_name: Option<String>,
}

/// Loop's harness name for presence's.
pub fn loop_harness(presence_name: &str) -> Option<&'static str> {
    match presence_name {
        "claude-code" => Some("claude"),
        "codex" => Some("codex"),
        "cursor" => Some("cursor"),
        "copilot" => Some("copilot"),
        "opencode" => Some("opencode"),
        "antigravity" => Some("antigravity"),
        _ => None,
    }
}

/// Loop's state folder: `~/Library/Application Support/Impeccable Reviews/Loop`.
pub fn loop_root(env: &HashMap<String, String>) -> Option<PathBuf> {
    let home = env.get("HOME").filter(|h| h.starts_with('/'))?;
    Some(Path::new(home).join("Library/Application Support/Impeccable Reviews/Loop"))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// The lowercase SHA-256 of `harness + session`, no separator: the proof's and the rebind file's name.
pub fn session_hash(harness: &str, session: &str) -> String {
    hex(&Sha256::digest(format!("{harness}{session}").as_bytes()))
}

fn canonical_uuid(s: &str) -> bool {
    s.len() == 36
        && s.char_indices().all(|(i, c)| if matches!(i, 8 | 13 | 18 | 23) { c == '-' } else { c.is_ascii_digit() || ('a'..='f').contains(&c) })
}

/// A regular file of ours (owned by this user, nobody else's to read or write), at most 4 KiB, as JSON.
#[cfg(unix)]
fn read_private(path: &Path) -> Option<Value> {
    use std::os::unix::fs::MetadataExt;
    let meta = std::fs::symlink_metadata(path).ok()?;
    let mine = meta.uid() == unsafe { libc::getuid() };
    if !meta.file_type().is_file() || !mine || meta.mode() & 0o077 != 0 || meta.len() > RECORD_MAX {
        return None;
    }
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}
#[cfg(not(unix))]
fn read_private(_path: &Path) -> Option<Value> {
    None
}

fn words(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Whether Loop's hook record names `harness`'s process: its pid, and its start to the microsecond where the record
/// has one, else its `ps` start text exactly (spacing aside).
pub fn record_matches(record: &Value, harness: &Harness) -> bool {
    if record["pid"].as_u64() != Some(u64::from(harness.pid)) {
        return false;
    }
    if record.get("startSec").is_some() || record.get("startUsec").is_some() {
        return match (record["startSec"].as_u64(), record["startUsec"].as_u64(), harness.started) {
            (Some(sec), Some(usec), Some(started)) => (sec, usec) == started,
            _ => false,
        };
    }
    record["start"].as_str().is_some_and(|s| !s.trim().is_empty() && words(s) == words(&harness.lstart))
}

/// The harness's own session id: the one Loop hook record under `root` that names its process.
pub fn harness_session(root: &Path, harness: &Harness) -> Option<String> {
    let prefix = format!("{}-", harness.name);
    let mut found = None;
    for entry in std::fs::read_dir(root).ok()?.flatten() {
        let file = entry.file_name();
        let Some(session) = file.to_str().and_then(|f| f.strip_prefix(&prefix)).and_then(|f| f.strip_suffix(".json")) else { continue };
        if !canonical_uuid(session) {
            continue;
        }
        let Some(record) = read_private(&entry.path()) else { continue };
        if record_matches(&record, harness) {
            // Two records naming one process can't be told apart: neither is used.
            if found.is_some() {
                return None;
            }
            found = Some(session.to_string());
        }
    }
    found
}

/// A random handle of 32 hex characters, from the system's random source.
fn random_handle() -> Option<String> {
    use std::io::Read;
    let mut bytes = [0u8; 16];
    std::fs::File::open("/dev/urandom").ok()?.read_exact(&mut bytes).ok()?;
    Some(hex(&bytes))
}

fn handle_ok(h: &str) -> bool {
    (16..=64).contains(&h.len()) && h.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Write `bytes` to `path` as a private file: staged beside it (never through a link) and renamed into place.
#[cfg(unix)]
fn write_private(path: &Path, bytes: &[u8]) -> bool {
    use std::io::Write;
    use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
    let Some(dir) = path.parent() else { return false };
    if std::fs::DirBuilder::new().recursive(true).mode(0o700).create(dir).is_err()
        || !std::fs::symlink_metadata(dir).is_ok_and(|m| m.file_type().is_dir())
    {
        return false;
    }
    let Some(staged) = random_handle().map(|r| dir.join(format!(".{r}.new"))) else { return false };
    let wrote = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(&staged)
        .and_then(|mut f| f.write_all(bytes));
    if wrote.is_err() || std::fs::rename(&staged, path).is_err() {
        let _ = std::fs::remove_file(&staged);
        return false;
    }
    true
}
#[cfg(not(unix))]
fn write_private(_path: &Path, _bytes: &[u8]) -> bool {
    false
}

/// The installation's handle: made once and kept in `<IMPECCABLE_HOME>/installation`.
pub fn installation(home: &Path) -> Option<String> {
    let path = home.join("installation");
    if let Ok(text) = std::fs::read_to_string(&path) {
        let text = text.trim();
        if handle_ok(text) {
            return Some(text.to_string());
        }
    }
    // Made with create_new on the file itself, so two processes starting together agree: the loser reads the
    // winner's handle.
    let made = random_handle()?;
    for _ in 0..20 {
        if create_private(&path, made.as_bytes()) {
            return Some(made);
        }
        if let Some(text) = std::fs::read_to_string(&path).ok().map(|t| t.trim().to_string()).filter(|t| handle_ok(t)) {
            return Some(text);
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    None
}

/// A new 0600 file at `path`, written only when nothing is there yet.
#[cfg(unix)]
fn create_private(path: &Path, bytes: &[u8]) -> bool {
    use std::io::Write;
    use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
    let Some(dir) = path.parent() else { return false };
    if std::fs::DirBuilder::new().recursive(true).mode(0o700).create(dir).is_err() {
        return false;
    }
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
        .and_then(|mut f| f.write_all(bytes))
        .is_ok()
}
#[cfg(not(unix))]
fn create_private(_path: &Path, _bytes: &[u8]) -> bool {
    false
}

/// The claim this process holds.
#[derive(Clone, Debug, PartialEq)]
struct Held {
    claim: String,
    generation: String,
    user: Option<String>,
    /// When the server last confirmed the lease, and how long it runs: past that, the claim is gone even when the
    /// server couldn't be reached to say so.
    renewed: std::time::Instant,
    lease: Duration,
}

impl Held {
    fn live(&self) -> bool {
        self.renewed.elapsed() < self.lease
    }
}

/// What the renewal thread and the serving thread share.
struct Shared {
    door: Box<dyn Door>,
    held: Option<Held>,
    /// The door said it's off (`NEEDS_YOU_CLAIMS`): nothing more is tried.
    off: bool,
}

impl Shared {
    /// The claim is gone: Loop must not wake this session on it, and the next Needs-you call claims again.
    fn lose(&mut self, proof: &Path, why: &Result<Value, Refused>) {
        self.held = None;
        self.off |= why == &Err(Refused::Off);
        let _ = std::fs::remove_file(proof);
    }
}

/// Where this session's files go, and who it is.
#[derive(Clone)]
pub struct Place {
    /// `<IMPECCABLE_HOME>`.
    pub home: PathBuf,
    /// Loop's state folder.
    pub loop_root: PathBuf,
    /// The folder the agent works in.
    pub cwd: PathBuf,
    /// This folder's project key (64 hex), or empty.
    pub project: String,
    /// The branch checked out there, if any.
    pub branch: Option<String>,
    /// How often a held lease is renewed, at most (20 s; a third of a shorter lease the server gives).
    pub renew_every: Duration,
}

/// One session's claim on its inbox.
pub struct Observer {
    shared: Arc<Mutex<Shared>>,
    harness: &'static str,
    session: String,
    place: Place,
    instance: String,
    installation: String,
    name: Option<String>,
    /// The door said it's off: nothing more is tried.
    done: bool,
    /// Another instance's lease was live: no claim is tried before this. Its lease runs out within one lease when that
    /// process is gone (a crash, a restart that didn't release), and this session then takes the inbox over.
    not_before: Option<std::time::Instant>,
    /// Whether the conflict line was told.
    told: bool,
    /// The conflict line, told to the agent once.
    tell: Option<String>,
    every: Duration,
    stop: Option<mpsc::Sender<()>>,
    renewer: Option<std::thread::JoinHandle<()>>,
}

impl Observer {
    /// This session's observer, when its harness has a Loop record naming it. Claims at once when the inbox already
    /// has a name (the harness's, or the one this harness session claimed before).
    pub fn start(door: Box<dyn Door>, harness: &Harness, place: Place) -> Option<Observer> {
        let session = harness_session(&place.loop_root, harness)?;
        let instance = random_handle()?;
        let installation = installation(&place.home)?;
        let every = place.renew_every;
        let mut me = Observer {
            shared: Arc::new(Mutex::new(Shared { door, held: None, off: false })),
            harness: harness.name,
            session,
            place,
            instance,
            installation,
            name: None,
            done: false,
            not_before: None,
            told: false,
            tell: None,
            every,
            stop: None,
            renewer: None,
        };
        let earlier = read_private(&me.rebind_path()).and_then(|r| r["name"].as_str().map(str::to_string));
        if let Some(name) = harness.session_name.clone().or(earlier) {
            me.name = Some(name);
            me.claim();
        }
        Some(me)
    }

    /// The instance handle to send as `Impeccable-Instance`, while a claim is held.
    pub fn instance(&self) -> Option<String> {
        self.lock().held.as_ref().is_some_and(Held::live).then(|| self.instance.clone())
    }

    /// The harness's own session id.
    pub fn session(&self) -> &str {
        &self.session
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Shared> {
        self.shared.lock().unwrap_or_else(|p| p.into_inner())
    }

    fn rebind_path(&self) -> PathBuf {
        self.place.home.join("running").join(format!("session-{}.json", session_hash(self.harness, &self.session)))
    }

    fn proof_path(&self) -> PathBuf {
        self.place.loop_root.join("claims").join(format!("{}.json", session_hash(self.harness, &self.session)))
    }

    /// A Needs-you call named the session: the inbox takes that name if it has none yet, and a claim that isn't held
    /// (never taken, or lapsed) is taken now.
    pub fn named(&mut self, from: &str) {
        if self.name.is_none() {
            let name: String = from.trim().chars().filter(|c| !c.is_control()).collect();
            if name.is_empty() || name.chars().count() > 40 {
                return;
            }
            self.name = Some(name);
        }
        self.reclaim();
    }

    /// A Needs-you call, named or not: a claim that isn't held (or ran out) is taken again, under the name it has.
    pub fn reclaim(&mut self) {
        let lost = {
            let mut s = self.lock();
            if s.held.as_ref().is_some_and(|h| !h.live()) {
                let gone = Err(Refused::Lapsed);
                s.lose(&self.proof_path(), &gone);
            }
            s.held.is_none()
        };
        if lost {
            self.claim();
        }
    }

    /// The line the agent is told once: another session holds this inbox.
    pub fn take_note(&mut self) -> Option<String> {
        self.tell.take()
    }

    fn claim(&mut self) {
        if self.lock().off {
            self.done = true;
        }
        let Some(name) = self.name.clone().filter(|_| !self.done) else { return };
        if self.not_before.is_some_and(|t| std::time::Instant::now() < t) {
            return;
        }
        let folder = self.place.cwd.file_name().and_then(|f| f.to_str()).map(str::to_string);
        let mut context = json!({ "harness": self.harness });
        if let Some(b) = &self.place.branch { context["branch"] = json!(b); }
        if let Some(f) = folder { context["folder"] = json!(f); }
        let body = json!({ "action": "claim", "instance": self.instance, "installation": self.installation, "name": name,
            "project": self.place.project, "session": self.session, "context": context });
        let answer = self.lock().door.post(&body);
        match answer {
            Ok(v) => {
                self.not_before = None;
                let generation = match &v["generation"] {
                    Value::String(s) => s.clone(),
                    Value::Number(n) => n.to_string(),
                    _ => return,
                };
                let Some(claim) = v["claim"].as_str().map(str::to_string) else { return };
                let lease = v["leaseSeconds"].as_u64().filter(|s| *s >= 3).map(Duration::from_secs).unwrap_or(LEASE_FALLBACK);
                self.every = self.every.min(lease / RENEW_SHARE);
                let held = Held { claim, generation, user: v["userId"].as_str().map(str::to_string), renewed: std::time::Instant::now(), lease };
                self.lock().held = Some(held.clone());
                let rebind = json!({ "claim": held.claim, "generation": held.generation, "name": name, "project": self.place.project });
                write_private(&self.rebind_path(), rebind.to_string().as_bytes());
                self.prove(&held);
                self.renew_in_background();
            }
            Err(Refused::Off) => self.done = true,
            Err(Refused::Conflict) => {
                self.not_before = Some(std::time::Instant::now() + LEASE_FALLBACK);
                if !std::mem::replace(&mut self.told, true) {
                    self.tell = Some(format!("Another session holds {name} in this project."));
                }
            }
            Err(Refused::Lapsed | Refused::Other) => {}
        }
    }

    /// Loop's wake proof for the claim held.
    fn prove(&self, held: &Held) {
        let (Some(user), Some(issuer)) = (held.user.clone(), self.lock().door.issuer()) else { return };
        let proof = json!({ "harness": self.harness, "session": self.session, "claimId": held.claim,
            "generation": held.generation, "userId": user, "issuer": issuer });
        write_private(&self.proof_path(), proof.to_string().as_bytes());
    }

    fn renew_in_background(&mut self) {
        if self.renewer.is_some() {
            return;
        }
        let (tx, rx) = mpsc::channel::<()>();
        let (shared, instance, every, proof) = (Arc::clone(&self.shared), self.instance.clone(), self.every, self.proof_path());
        self.stop = Some(tx);
        self.renewer = Some(std::thread::spawn(move || loop {
            match rx.recv_timeout(every) {
                Err(RecvTimeoutError::Timeout) => {}
                _ => return,
            }
            let mut s = shared.lock().unwrap_or_else(|p| p.into_inner());
            let Some(held) = s.held.clone() else { continue };
            let body = json!({ "action": "renew", "claim": held.claim, "generation": held.generation, "instance": instance });
            let answer = s.door.post(&body);
            match &answer {
                Ok(_) => {
                    if let Some(h) = s.held.as_mut() { h.renewed = std::time::Instant::now(); }
                }
                Err(Refused::Lapsed | Refused::Off) => s.lose(&proof, &answer),
                // Unreachable: the claim holds only as long as its last confirmed lease.
                Err(_) if !held.live() => s.lose(&proof, &answer),
                Err(_) => {}
            }
        }));
    }

    /// Record that the agent was handed these deliveries.
    pub fn received(&mut self, deliveries: &[String]) {
        let mut s = self.lock();
        let Some(held) = s.held.clone() else { return };
        for chunk in deliveries.chunks(RECEIPT_MAX) {
            let body = json!({ "action": "receipt", "claim": held.claim, "generation": held.generation, "instance": self.instance, "deliveries": chunk });
            let answer = s.door.post(&body);
            if matches!(answer, Err(Refused::Lapsed | Refused::Off)) {
                s.lose(&self.proof_path(), &answer);
                return;
            }
        }
    }
}

impl Drop for Observer {
    /// The session ended: the claim is released and Loop's proof removed. The rebind file stays, so a restart in
    /// the same harness session claims the same inbox.
    fn drop(&mut self) {
        drop(self.stop.take());
        if let Some(t) = self.renewer.take() {
            let _ = t.join();
        }
        let mut s = self.lock();
        if let Some(held) = s.held.take() {
            let body = json!({ "action": "release", "claim": held.claim, "generation": held.generation, "instance": self.instance });
            let _ = s.door.post(&body);
        }
        drop(s);
        let _ = std::fs::remove_file(self.proof_path());
    }
}

/// The delivery ids a `needs_you.answer` result hands the agent: each item's `delivery`, in the structured result or
/// its JSON text.
pub fn deliveries(result: &Value) -> Vec<String> {
    let mut out = Vec::new();
    let mut take = |v: &Value| {
        for item in v["items"].as_array().into_iter().flatten() {
            if let Some(d) = item["delivery"].as_str().filter(|d| canonical_uuid(d)) {
                if !out.iter().any(|o| o == d) {
                    out.push(d.to_string());
                }
            }
        }
    };
    take(&result["structuredContent"]);
    for part in result["content"].as_array().into_iter().flatten() {
        if let Some(v) = part["text"].as_str().and_then(|t| serde_json::from_str::<Value>(t).ok()) {
            take(&v);
        }
    }
    out
}

/// The harness this process runs under, from one process list (macOS and Linux).
#[cfg(unix)]
pub fn this_harness(procs: &HashMap<u32, crate::presence::Proc>) -> Option<Harness> {
    let parent = crate::presence::harness_process(procs, std::process::id())?;
    let name = crate::presence::harness_name(parent).and_then(loop_harness)?;
    Some(Harness { name, pid: parent.pid, started: started(parent.pid), lstart: parent.start.clone(), session_name: crate::presence::session_name(parent) })
}

/// A process's start to the microsecond (macOS's `proc_pidinfo`, as Loop's hook reads it).
#[cfg(target_os = "macos")]
fn started(pid: u32) -> Option<(u64, u64)> {
    let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_bsdinfo>() as libc::c_int;
    let got = unsafe { libc::proc_pidinfo(pid as libc::c_int, libc::PROC_PIDTBSDINFO, 0, (&mut info as *mut libc::proc_bsdinfo).cast(), size) };
    (got == size).then_some((info.pbi_start_tvsec, info.pbi_start_tvusec))
}
#[cfg(all(unix, not(target_os = "macos")))]
fn started(_pid: u32) -> Option<(u64, u64)> {
    None
}

/// The branch checked out in `cwd`, if any.
pub fn branch(cwd: &Path) -> Option<String> {
    let out = std::process::Command::new("git")
        .args(["branch", "--show-current"])
        .current_dir(cwd)
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;
    let b = String::from_utf8(out.stdout).ok()?.trim().to_string();
    (out.status.success() && !b.is_empty() && b.len() <= 200).then_some(b)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    const SESSION: &str = "0b5c6f4e-2c1d-4a8e-9f3b-7d6e5c4b3a21";
    const USER: &str = "01a18631-cef8-710a-a804-1e4ec1422235";
    const DELIVERY: &str = "11111111-2222-4333-8444-555555555555";

    type Answer = Box<dyn FnMut(&Value) -> Result<Value, Refused> + Send>;
    /// The claims door as a script: every body it gets is kept, and `answer` says what it replies.
    #[derive(Clone)]
    struct Fake {
        log: Arc<Mutex<Vec<Value>>>,
        answer: Arc<Mutex<Answer>>,
    }
    impl Door for Fake {
        fn post(&mut self, body: &Value) -> Result<Value, Refused> {
            self.log.lock().unwrap().push(body.clone());
            (self.answer.lock().unwrap())(body)
        }
        fn issuer(&self) -> Option<String> {
            Some("https://api.staging.impeccable.style".into())
        }
    }
    fn fake(answer: impl FnMut(&Value) -> Result<Value, Refused> + Send + 'static) -> Fake {
        Fake { log: Arc::default(), answer: Arc::new(Mutex::new(Box::new(answer))) }
    }
    fn granted(body: &Value) -> Result<Value, Refused> {
        Ok(match body["action"].as_str() {
            Some("claim") => json!({ "claim": "c1aim-0000-0000", "generation": "7", "leaseSeconds": 60, "userId": USER }),
            Some("receipt") => json!({ "received": body["deliveries"].as_array().map_or(0, Vec::len) }),
            _ => json!({ "ok": true, "userId": USER }),
        })
    }
    fn actions(f: &Fake) -> Vec<String> {
        f.log.lock().unwrap().iter().map(|b| b["action"].as_str().unwrap_or("").to_string()).collect()
    }

    struct Box_ {
        root: PathBuf,
    }
    impl Box_ {
        fn new(tag: &str) -> Box_ {
            let root = std::env::temp_dir().join(format!("impeccable-claims-{tag}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&root);
            std::fs::create_dir_all(root.join("home/Library/Application Support/Impeccable Reviews/Loop")).unwrap();
            std::fs::create_dir_all(root.join("impeccable")).unwrap();
            Box_ { root }
        }
        fn env(&self) -> HashMap<String, String> {
            HashMap::from([("HOME".to_string(), self.root.join("home").display().to_string())])
        }
        fn loop_root(&self) -> PathBuf {
            loop_root(&self.env()).unwrap()
        }
        fn place(&self) -> Place {
            Place { home: self.root.join("impeccable"), loop_root: self.loop_root(), cwd: self.root.join("web"), project: "a".repeat(64), branch: Some("main".into()), renew_every: Duration::from_millis(20) }
        }
        fn record(&self, name: &str, record: Value, mode: u32) -> PathBuf {
            let path = self.loop_root().join(name);
            std::fs::write(&path, record.to_string()).unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(mode)).unwrap();
            path
        }
        fn proof(&self) -> PathBuf {
            self.loop_root().join("claims").join(format!("{}.json", session_hash("claude", SESSION)))
        }
        fn rebind(&self) -> PathBuf {
            self.root.join("impeccable/running").join(format!("session-{}.json", session_hash("claude", SESSION)))
        }
    }
    impl Drop for Box_ {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    fn harness(name: Option<&str>) -> Harness {
        Harness { name: "claude", pid: 4242, started: Some((1_764_000_000, 123_456)), lstart: "Thu Nov 27 09:00:00 2026".into(), session_name: name.map(str::to_string) }
    }
    fn mode(p: &Path) -> u32 {
        std::fs::metadata(p).unwrap().permissions().mode() & 0o777
    }

    // Catches a record for another process (a reused pid, another start) taken for this session's, and a record
    // anyone could have written read at all.
    #[test]
    fn finds_the_session_only_from_a_private_record_that_names_this_process() {
        let b = Box_::new("find");
        let h = harness(None);
        let mine = json!({ "pid": 4242, "startSec": 1_764_000_000u64, "startUsec": 123_456, "session": SESSION });
        assert!(record_matches(&mine, &h));
        assert!(!record_matches(&json!({ "pid": 4242, "startSec": 1_764_000_000u64, "startUsec": 1 }), &h));
        assert!(!record_matches(&json!({ "pid": 4243, "start": "Thu Nov 27 09:00:00 2026" }), &h));
        // An older record's text start, spacing aside; a numeric start never falls back to it.
        assert!(record_matches(&json!({ "pid": 4242, "start": "Thu Nov  27 09:00:00 2026" }), &h));
        assert!(!record_matches(&json!({ "pid": 4242, "startSec": 1, "start": "Thu Nov 27 09:00:00 2026" }), &h));

        b.record(&format!("claude-{SESSION}.json"), mine.clone(), 0o644);
        b.record("claude-not-a-session.json", mine.clone(), 0o600);
        b.record(&format!("codex-{SESSION}.json"), mine.clone(), 0o600);
        assert_eq!(harness_session(&b.loop_root(), &h), None);
        b.record(&format!("claude-{SESSION}.json"), mine.clone(), 0o600);
        assert_eq!(harness_session(&b.loop_root(), &h).as_deref(), Some(SESSION));
        // A link to a private record is no record.
        let other = "9b5c6f4e-2c1d-4a8e-9f3b-7d6e5c4b3a21";
        std::os::unix::fs::symlink(b.loop_root().join(format!("claude-{SESSION}.json")), b.loop_root().join(format!("claude-{other}.json"))).unwrap();
        assert_eq!(harness_session(&b.loop_root(), &h).as_deref(), Some(SESSION));
    }

    // Catches a claim sent without its handles or session, a proof Loop would refuse (fields, strings, mode), a handle
    // written to disk, a lapsed lease left looking held, and a release that never reaches the server.
    #[test]
    fn claims_proves_renews_reclaims_after_a_lapse_and_releases() {
        let b = Box_::new("life");
        b.record(&format!("claude-{SESSION}.json"), json!({ "pid": 4242, "startSec": 1_764_000_000u64, "startUsec": 123_456 }), 0o600);
        let lapse = Arc::new(Mutex::new(false));
        let lapsing = Arc::clone(&lapse);
        let door = fake(move |body| if body["action"] == "renew" && *lapsing.lock().unwrap() { Err(Refused::Lapsed) } else { granted(body) });
        let mut o = Observer::start(Box::new(door.clone()), &harness(Some("t1jp")), b.place()).unwrap();

        let claim = door.log.lock().unwrap()[0].clone();
        assert_eq!((claim["action"].as_str(), claim["name"].as_str(), claim["session"].as_str()), (Some("claim"), Some("t1jp"), Some(SESSION)));
        assert_eq!(claim["project"], "a".repeat(64));
        assert_eq!(claim["context"], json!({ "harness": "claude", "branch": "main", "folder": "web" }));
        let instance = claim["instance"].as_str().unwrap().to_string();
        assert!(handle_ok(&instance) && handle_ok(claim["installation"].as_str().unwrap()));
        assert_eq!(o.instance().as_deref(), Some(instance.as_str()));

        let proof: Value = serde_json::from_slice(&std::fs::read(b.proof()).unwrap()).unwrap();
        assert_eq!(proof, json!({ "harness": "claude", "session": SESSION, "claimId": "c1aim-0000-0000", "generation": "7",
            "userId": USER, "issuer": "https://api.staging.impeccable.style" }));
        assert_eq!((mode(&b.proof()), mode(&b.rebind())), (0o600, 0o600));
        let rebind = std::fs::read_to_string(b.rebind()).unwrap();
        assert!(!rebind.contains(&instance) && rebind.contains("t1jp"));
        assert_eq!(mode(&b.root.join("impeccable/installation")), 0o600);

        std::thread::sleep(Duration::from_millis(120));
        assert!(actions(&door).iter().any(|a| a == "renew"));
        assert!(door.log.lock().unwrap().iter().filter(|x| x["action"] == "renew").all(|x| x["instance"] == instance.as_str() && x["generation"] == "7"));

        *lapse.lock().unwrap() = true;
        std::thread::sleep(Duration::from_millis(120));
        assert_eq!(o.instance(), None);
        assert!(!b.proof().exists());
        *lapse.lock().unwrap() = false;
        o.named("t1jp");
        assert_eq!(actions(&door).iter().filter(|a| *a == "claim").count(), 2);
        assert!(b.proof().exists());

        drop(o);
        assert_eq!(actions(&door).last().map(String::as_str), Some("release"));
        assert!(!b.proof().exists() && b.rebind().exists());
    }

    // Catches a restarted MCP in the same harness session that waits for the agent to name itself again, and an
    // installation handle remade on every start.
    #[test]
    fn a_restart_in_the_same_session_claims_the_same_inbox() {
        let b = Box_::new("restart");
        b.record(&format!("claude-{SESSION}.json"), json!({ "pid": 4242, "startSec": 1_764_000_000u64, "startUsec": 123_456 }), 0o600);
        let first = fake(granted);
        let mut o = Observer::start(Box::new(first.clone()), &harness(None), b.place()).unwrap();
        assert!(first.log.lock().unwrap().is_empty());
        o.named("review bot");
        let installation = first.log.lock().unwrap()[0]["installation"].clone();
        drop(o);
        let again = fake(granted);
        let o = Observer::start(Box::new(again.clone()), &harness(None), b.place()).unwrap();
        let claim = again.log.lock().unwrap()[0].clone();
        assert_eq!((claim["name"].as_str(), &claim["installation"]), (Some("review bot"), &installation));
        drop(o);
    }

    // Catches claiming again and again once the door is off, a conflict told more than once or not at all, and a
    // conflict that never retries after the holder is gone (a crashed session's restart could never take its inbox).
    #[test]
    fn an_off_door_stops_and_a_conflict_is_told_once() {
        let b = Box_::new("off");
        b.record(&format!("claude-{SESSION}.json"), json!({ "pid": 4242, "startSec": 1_764_000_000u64, "startUsec": 123_456 }), 0o600);
        let off = fake(|_| Err(Refused::Off));
        let mut o = Observer::start(Box::new(off.clone()), &harness(Some("t1jp")), b.place()).unwrap();
        o.named("t1jp");
        assert_eq!((actions(&off).len(), o.instance(), o.take_note()), (1, None, None));
        drop(o);
        assert_eq!(actions(&off).len(), 1);

        let held = fake(|_| Err(Refused::Conflict));
        let mut o = Observer::start(Box::new(held.clone()), &harness(Some("t1jp")), b.place()).unwrap();
        assert_eq!(o.take_note().as_deref(), Some("Another session holds t1jp in this project."));
        o.named("t1jp");
        assert_eq!((o.take_note(), actions(&held).len()), (None, 1));
        // Once the holder's lease could have run out (it crashed), the next call tries again, told nothing new.
        o.not_before = Some(std::time::Instant::now());
        o.named("t1jp");
        assert_eq!((o.take_note(), actions(&held).len()), (None, 2));
    }

    // Catches a claim (and Loop's proof) outliving its lease when renewals can't reach the server, and a session
    // that never takes it back afterwards.
    #[test]
    fn an_unconfirmed_lease_runs_out_and_the_next_call_claims_again() {
        let b = Box_::new("unreachable");
        b.record(&format!("claude-{SESSION}.json"), json!({ "pid": 4242, "startSec": 1_764_000_000u64, "startUsec": 123_456 }), 0o600);
        let door = fake(|body| if body["action"] == "renew" { Err(Refused::Other) } else { granted(body) });
        let mut o = Observer::start(Box::new(door.clone()), &harness(Some("t1jp")), b.place()).unwrap();
        assert!(o.instance().is_some() && o.proof_path().exists());
        o.lock().held.as_mut().unwrap().lease = Duration::from_millis(1);
        std::thread::sleep(Duration::from_millis(150));
        assert_eq!((o.instance(), o.proof_path().exists()), (None, false));
        o.reclaim();
        assert_eq!(actions(&door).iter().filter(|a| *a == "claim").count(), 2);
        assert!(o.instance().is_some());
    }

    // Catches renewals and receipts carrying on after the switch went off.
    #[test]
    fn the_switch_going_off_ends_the_claim() {
        let b = Box_::new("switched-off");
        b.record(&format!("claude-{SESSION}.json"), json!({ "pid": 4242, "startSec": 1_764_000_000u64, "startUsec": 123_456 }), 0o600);
        let door = fake(|body| if body["action"] == "renew" { Err(Refused::Off) } else { granted(body) });
        let mut o = Observer::start(Box::new(door.clone()), &harness(Some("t1jp")), b.place()).unwrap();
        std::thread::sleep(Duration::from_millis(150));
        assert_eq!((o.instance(), o.proof_path().exists()), (None, false));
        o.named("t1jp");
        o.reclaim();
        let log = actions(&door);
        assert_eq!(log.iter().filter(|a| *a == "claim").count(), 1, "{log:?}");
        assert_eq!(log.iter().filter(|a| *a == "renew").count(), 1, "{log:?}");
    }

    // Catches two processes starting together each making an installation handle.
    #[test]
    fn processes_starting_together_agree_on_the_installation() {
        let b = Box_::new("installation");
        let home = b.root.join("impeccable");
        let handles: Vec<_> = (0..8).map(|_| { let h = home.clone(); std::thread::spawn(move || installation(&h)) }).collect();
        let got: std::collections::BTreeSet<_> = handles.into_iter().map(|t| t.join().unwrap().unwrap()).collect();
        assert_eq!(got.len(), 1, "{got:?}");
    }

    /// The account service's `/mcp` as one canned answer, remembering the instance each call carried.
    struct Mcp {
        result: Value,
        instances: Vec<Option<String>>,
        instance: Option<String>,
    }
    impl crate::Upstream for Mcp {
        fn call(&mut self, request: &Value) -> Result<Value, crate::Failure> {
            self.instances.push(self.instance.clone());
            Ok(json!({ "jsonrpc": "2.0", "id": request["id"], "result": self.result }))
        }
        fn sign_in(&mut self) -> Result<(), String> {
            Ok(())
        }
        fn set_instance(&mut self, instance: Option<String>) {
            self.instance = instance;
        }
    }

    // Catches an answer handed to the agent without its receipt, a receipt for another tool's result, a call made
    // without the instance while the claim is held, and the conflict line never reaching the agent.
    #[test]
    fn records_receipt_of_what_the_agent_was_handed_and_sends_the_instance() {
        let b = Box_::new("receipt");
        b.record(&format!("claude-{SESSION}.json"), json!({ "pid": 4242, "startSec": 1_764_000_000u64, "startUsec": 123_456 }), 0o600);
        let door = fake(granted);
        let o = Observer::start(Box::new(door.clone()), &harness(Some("t1jp")), b.place()).unwrap();
        let instance = o.instance().unwrap();
        let items = json!({ "items": [{ "kind": "answered", "delivery": DELIVERY }, { "kind": "answered", "delivery": "not-a-uuid" }] });
        let mut up = Mcp { result: json!({ "content": [{ "type": "text", "text": items.to_string() }] }), instances: vec![], instance: None };
        let lines = [
            json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": "taste.get", "arguments": {} } }),
            json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": { "name": "needs_you.answer", "arguments": { "from": "t1jp" } } }),
        ];
        let input = lines.iter().map(Value::to_string).collect::<Vec<_>>().join("\n");
        let (mut out, mut err) = (Vec::new(), Vec::new());
        crate::serve_observed(input.as_bytes(), &mut out, &mut err, &mut up, o);
        assert_eq!(up.instances, [Some(instance.clone()), Some(instance)]);
        let receipts: Vec<Value> = door.log.lock().unwrap().iter().filter(|x| x["action"] == "receipt").cloned().collect();
        assert_eq!(receipts.len(), 1);
        assert_eq!(receipts[0]["deliveries"], json!([DELIVERY]));
        assert_eq!(actions(&door).last().map(String::as_str), Some("release"));

        let b = Box_::new("told");
        b.record(&format!("claude-{SESSION}.json"), json!({ "pid": 4242, "startSec": 1_764_000_000u64, "startUsec": 123_456 }), 0o600);
        let o = Observer::start(Box::new(fake(|_| Err(Refused::Conflict))), &harness(Some("t1jp")), b.place()).unwrap();
        let mut up = Mcp { result: json!({ "content": [{ "type": "text", "text": "{}" }] }), instances: vec![], instance: None };
        let (mut out, mut err) = (Vec::new(), Vec::new());
        crate::serve_observed(format!("{}\n{}", lines[1], lines[1]).as_bytes(), &mut out, &mut err, &mut up, o);
        let said = String::from_utf8(out).unwrap();
        assert_eq!(said.matches("Another session holds t1jp in this project.").count(), 1, "{said}");
        assert_eq!(up.instances, [None, None]);
    }
}
