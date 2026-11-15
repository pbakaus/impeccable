//! The roll API's client side, shared by `concept-seed` (the roll and the
//! agent-run choice ping) and `serve-question` (the picker's own ping).
//!
//! Three pieces live here:
//! - the request plumbing: API base, timeout, opt-outs, and the
//!   `X-Impeccable-Client` header every `/api/roll` and `/api/chosen` request
//!   carries;
//! - the seed reference and the seed ledger. The reference,
//!   `seed:<16 hex of sha256("impeccable-seed:" + key)>`, is what committed
//!   files (the surface brief's FORM line) record instead of the key. The
//!   ledger, `.impeccable/questions/seeds/<those 16 hex>.json`, is the local,
//!   self-ignored record that resolves a reference back to its key on this
//!   machine (`{"key"}`, written for every roll), plus, only while telemetry
//!   is on, one entry per API-dealt round (`poolRevision`, the dealt catalog
//!   ids) and the marker that a round's choice was already sent. Unlike
//!   `roll.json`, which a decision page removes when it takes the roll, the
//!   ledger outlives the page, so the ping the agent sends after the round
//!   still finds its round;
//! - the choice ping body and its send.

use crate::jsp;
use crate::util::{json_compact, safe_read, Env};
use serde_json::{json, Map, Value};
use std::time::Duration;

/// The kinds a choice ping may send. `reroll` means the hand was rejected:
/// the user asked for another hand instead of choosing.
pub const KINDS: [&str; 6] = ["assigned", "pick", "challenger", "canon", "reroll", "grounded"];

/// The kinds a decision-page option card declares. `grounded` is one of the
/// agent's grounded directions that is neither the assigned card nor the
/// pick (a safer round's lineup), any number of them. `dealt` is a surface
/// round's dealt structure other than the lead; it has no ping kind, so its
/// ping carries `option` alone. Canon is the `canonCard`, never an option.
pub const CARD_KINDS: [&str; 5] = ["assigned", "pick", "challenger", "grounded", "dealt"];

/// The highest re-roll round the choice ping reports.
pub const MAX_REROLL: usize = 8;

/// The highest zero-based card position the choice ping reports.
pub const MAX_OPTION: usize = 15;

pub fn api_base(env: &Env) -> String {
    let base = env.get("IMPECCABLE_API_URL").filter(|v| !v.is_empty()).cloned().unwrap_or_else(|| "https://impeccable.style/api".to_string());
    base.strip_suffix('/').unwrap_or(&base).to_string()
}

/// `IMPECCABLE_API_TIMEOUT` in ms (default 4000): one budget for the API
/// calls a run makes.
pub fn api_timeout(env: &Env) -> Duration {
    let ms = env.get("IMPECCABLE_API_TIMEOUT").filter(|v| !v.is_empty()).map(|v| crate::critique_storage::js_number(v)).unwrap_or(4000.0);
    let ms = if ms.is_nan() { 0.0 } else { ms.max(0.0) };
    Duration::from_millis(ms as u64)
}

/// An opt-out variable is set when it is non-empty and not `0` or `false`
/// (any case): `DO_NOT_TRACK=1` opts out, `DO_NOT_TRACK=0` does not.
pub fn env_opts_out(v: Option<&String>) -> bool {
    v.map(|v| v.trim()).is_some_and(|v| !v.is_empty() && v != "0" && !v.eq_ignore_ascii_case("false"))
}

/// The user-level config, `~/.impeccable/config.json`, where
/// `impeccable telemetry off` records `"telemetry": false`.
pub fn user_config_path(env: &Env) -> String {
    jsp::join(&[&crate::util::homedir(env), ".impeccable", "config.json"])
}

fn config_says_off(path: &str) -> bool {
    safe_read(path).and_then(|t| serde_json::from_str::<Value>(&t).ok()).and_then(|v| v.get("telemetry").and_then(Value::as_bool)) == Some(false)
}

/// Why telemetry is off, or `None` when it is on: `DO_NOT_TRACK` or
/// `IMPECCABLE_NO_TELEMETRY` (`env_opts_out`), `"telemetry": false` in the
/// user config, or in the project's `.impeccable/config.json` /
/// `config.local.json` (a project may opt everyone out; nothing opts back in
/// over an off anywhere).
pub fn opt_out_reason(env: &Env, cwd: &str) -> Option<String> {
    for var in ["DO_NOT_TRACK", "IMPECCABLE_NO_TELEMETRY"] {
        if env_opts_out(env.get(var)) {
            return Some(format!("{} is set", var));
        }
    }
    let user = user_config_path(env);
    if config_says_off(&user) {
        return Some(format!("\"telemetry\": false in {}", impeccable_common::jsp::to_posix(&user)));
    }
    // The project config is read where `context` reads its defaults: the
    // working directory, the resolved project root, then the repo root.
    let project = crate::context::resolve_project(cwd, &crate::target_args::TargetOptions::default(), env);
    let mut roots: Vec<String> = Vec::new();
    for r in [cwd, project.project_root.as_str(), project.repo_root.as_str()] {
        if r.is_empty() {
            continue;
        }
        let a = jsp::resolve(r, &[]);
        if !roots.contains(&a) {
            roots.push(a);
        }
    }
    for root in &roots {
        for name in ["config.local.json", "config.json"] {
            let p = jsp::join(&[root, ".impeccable", name]);
            if config_says_off(&p) {
                // Shown with forward slashes on every platform, like every
                // path the engine prints.
                let shown = jsp::relative(cwd, cwd, &p);
                return Some(format!("\"telemetry\": false in {}", impeccable_common::jsp::to_posix(if shown.is_empty() { &p } else { &shown })));
            }
        }
    }
    None
}

pub fn telemetry_disabled(env: &Env, cwd: &str) -> bool {
    opt_out_reason(env, cwd).is_some()
}

/// Sent on the roll request when telemetry is off: the roll still happens
/// (it is the feature), and the server records nothing for it.
pub const TELEMETRY_HEADER: &str = "X-Impeccable-Telemetry";

pub fn agent(url: &str, timeout: Duration) -> ureq::Agent {
    crate::http::agent_builder(url).timeout_connect(timeout).timeout(timeout).build()
}

pub const CLIENT_HEADER: &str = "X-Impeccable-Client";

fn version_token(v: &str) -> bool {
    !v.is_empty() && v.len() <= 32 && v.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'+' | b'-'))
}

/// `impeccable/<version>[ <channel>]`, matching
/// `^impeccable/[0-9A-Za-z.+-]{1,32}( [a-z]{1,16})?$`. The version is the
/// installed skill's (SKILL.md frontmatter, what `/api/version` compares)
/// when the engine can read it, else the engine's own as `<engine>+engine`.
/// The channel is `IMPECCABLE_TELEMETRY_CHANNEL` when it is 1 to 16 lowercase
/// letters (`test` in this repo's tests and CI), else absent.
pub fn client_header(env: &Env, cwd: &str) -> String {
    let skill = crate::context_cli::installed_skill_version(env, cwd).filter(|v| version_token(v));
    let version = skill.unwrap_or_else(|| format!("{}+engine", env!("CARGO_PKG_VERSION")));
    let channel = env
        .get("IMPECCABLE_TELEMETRY_CHANNEL")
        .filter(|c| !c.is_empty() && c.len() <= 16 && c.bytes().all(|b| b.is_ascii_lowercase()))
        .map(|c| format!(" {}", c))
        .unwrap_or_default();
    format!("impeccable/{}{}", version, channel)
}

/// A roll response's `poolRevision` when it is the 12 lowercase hex the API
/// sends; anything else is not recorded or forwarded.
pub fn valid_pool_revision(v: &str) -> bool {
    v.len() == 12 && v.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// A roll response's `handId` (32 lowercase hex, the server's opaque name
/// for the exact hand) is kept and forwarded only in that shape; older
/// servers omit it and nothing is sent.
pub fn valid_hand_id(v: &str) -> bool {
    v.len() == 32 && v.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

// ---- seed ledger -------------------------------------------------------------

/// One API-dealt round as concept-seed recorded it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SeedRound {
    pub scope: String,
    pub reroll: usize,
    pub mode: Option<String>,
    pub register: Option<String>,
    pub pool_revision: Option<String>,
    pub hand_id: Option<String>,
    /// The catalog ids the round printed as challengers, in print order.
    pub dealt: Vec<String>,
    /// The round's choice state: `pending` while the page's send is in
    /// flight, `picker` or `agent` once a send was confirmed.
    pub recorded: Option<String>,
    /// When the pending send began (epoch ms), while `recorded` is `pending`.
    pub pending_at: Option<f64>,
    /// 32 random hex naming this round's choice report, the same for the
    /// page's and the agent's send, so the server can drop a duplicate.
    pub ping_id: Option<String>,
}

impl SeedRound {
    /// A confirmed send: the agent's rerun for this round is a no-op.
    pub fn confirmed(&self) -> bool {
        matches!(self.recorded.as_deref(), Some("picker") | Some("agent"))
    }
}

/// The salt seed references are computed under (`impeccable_common::seed`).
/// `None` when no valid salt can be persisted on this machine: then there
/// is no seed reference at all, never an unsalted one.
pub fn seed_salt(env: &Env, cwd: &str) -> Option<String> {
    impeccable_common::seed::salt(&crate::util::homedir(env), Some(cwd), env.get("IMPECCABLE_SEED_SALT").map(String::as_str))
}

/// Every valid salt this machine keeps (home and project): a reference made
/// under any of them resolves.
pub fn seed_salts(env: &Env, cwd: &str) -> Vec<String> {
    impeccable_common::seed::existing_salts(&crate::util::homedir(env), Some(cwd), env.get("IMPECCABLE_SEED_SALT").map(String::as_str))
}

/// The seed ledger of one project directory: `.impeccable/questions/seeds/
/// <reference hex>.json`, `{"key", "rounds"?: {"<reroll>": {...}}}`. The key
/// entry is what lets a reference stand for its key on this machine and is
/// never pruned; rounds exist only while telemetry is on and are pruned after
/// 30 days. Every update is a read-modify-write under a per-file lock, so the
/// page's send and a concurrent roll of the next round never lose each
/// other's writes.
pub struct Ledger {
    cwd: String,
    salt: Option<String>,
    /// Every salt references may have been made under, `salt` first.
    salts: Vec<String>,
    /// A key this run generated itself: it cannot have a ledger, so the
    /// locator skips its search (`for_fresh_key`).
    fresh: Option<String>,
}

/// Ledger rounds older than this are pruned when a ledger is written; the
/// key behind the reference stays.
const SEED_TTL_MS: f64 = 30.0 * 24.0 * 60.0 * 60.0 * 1000.0;

/// A lock older than this belongs to a process that died holding it.
const LOCK_STALE_MS: u128 = 10_000;

/// How long a ledger update waits for the lock before giving up (best
/// effort: the feature never fails on its ledger).
const LOCK_WAIT_MS: u128 = 3_000;

fn unique_suffix() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{}-{}-{}", std::process::id(), n, t)
}

struct LockGuard(String);

impl Drop for LockGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

fn lock(path: &str) -> Option<LockGuard> {
    let lock = format!("{}.lock", path);
    let start = std::time::Instant::now();
    loop {
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&lock) {
            Ok(_) => return Some(LockGuard(lock)),
            // Windows answers a create racing a delete of the same name with
            // access denied rather than exists: both mean another holder.
            Err(e) if matches!(e.kind(), std::io::ErrorKind::AlreadyExists | std::io::ErrorKind::PermissionDenied) => {
                // Every pass checks the overall deadline first, the stale
                // branch included: a lock that cannot be removed (Windows
                // keeps a deleted file delete-pending; a read-only folder)
                // must not spin forever. Giving up never blocks a flow.
                if start.elapsed().as_millis() > LOCK_WAIT_MS {
                    return None;
                }
                let stale = std::fs::metadata(&lock).ok().and_then(|m| m.modified().ok()).and_then(|t| t.elapsed().ok()).is_some_and(|age| age.as_millis() > LOCK_STALE_MS);
                if stale && std::fs::remove_file(&lock).is_ok() {
                    continue;
                }
                std::thread::sleep(Duration::from_millis(15));
            }
            Err(_) => return None,
        }
    }
}

fn round_from(v: &Value, reroll: usize) -> SeedRound {
    let s = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_string);
    SeedRound {
        scope: s("scope").unwrap_or_default(),
        reroll,
        mode: s("mode"),
        register: s("register"),
        pool_revision: s("poolRevision").filter(|p| valid_pool_revision(p)),
        hand_id: s("handId").filter(|h| valid_hand_id(h)),
        dealt: v.get("dealt").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect()).unwrap_or_default(),
        recorded: s("recorded"),
        pending_at: v.get("pendingAt").and_then(Value::as_f64),
        ping_id: s("pingId").filter(|p| valid_hand_id(p)),
    }
}

impl Ledger {
    pub fn new(env: &Env, cwd: &str) -> Ledger {
        let salt = seed_salt(env, cwd);
        let mut salts: Vec<String> = salt.iter().cloned().collect();
        for s in seed_salts(env, cwd) {
            if !salts.contains(&s) {
                salts.push(s);
            }
        }
        Ledger { cwd: cwd.to_string(), salt, salts, fresh: None }
    }

    fn dir(&self) -> String {
        jsp::join(&[&self.cwd, ".impeccable", "questions", "seeds"])
    }

    /// The key's ledger, located once by the shared rule
    /// (`impeccable_common::seed::locate`): every operation, the printed
    /// reference and resolution all derive from this one answer.
    fn locate(&self, key: &str) -> impeccable_common::seed::Located {
        if self.fresh.as_deref() == Some(key) {
            return impeccable_common::seed::locate_fresh(&self.cwd, self.salt.as_deref(), key);
        }
        impeccable_common::seed::locate(&self.cwd, self.salt.as_deref(), &self.salts, key)
    }

    /// Marks `key` as one this run just generated (no `--from`, no
    /// `IMPECCABLE_CONCEPT_SEED`): 128 random bits have no ledger, so no
    /// name check or folder scan is spent on it.
    pub fn for_fresh_key(mut self, key: &str, fresh: bool) -> Ledger {
        if fresh {
            self.fresh = Some(key.to_string());
        }
        self
    }

    fn file(&self, key: &str) -> String {
        self.locate(key).path.to_string_lossy().into_owned()
    }

    /// The seed reference committed files record instead of `key`: the
    /// reference of the key's existing ledger, under whichever salt it was
    /// made, or for a new key the primary salt's. `None` when this machine
    /// has no salt and the key has no salted ledger.
    pub fn reference(&self, key: &str) -> Option<String> {
        self.locate(key).reference
    }

    fn read_file(path: &str) -> Option<Map<String, Value>> {
        safe_read(path).and_then(|t| serde_json::from_str::<Value>(&t).ok()).and_then(|v| v.as_object().cloned())
    }

    fn write_file(&self, path: &str, ledger: &Map<String, Value>) {
        let temp = format!("{}.tmp-{}", path, unique_suffix());
        if std::fs::write(&temp, json_compact(&Value::Object(ledger.clone()))).is_err() {
            let _ = std::fs::remove_file(&temp);
            return;
        }
        // A rename over a file an unlocked reader has open can fail for a
        // moment on Windows; retry briefly before giving up.
        for attempt in 0..20 {
            if std::fs::rename(&temp, path).is_ok() {
                return;
            }
            if attempt < 19 {
                std::thread::sleep(Duration::from_millis(10));
            }
        }
        let _ = std::fs::remove_file(&temp);
    }

    /// Read, change, write `key`'s ledger under its lock. The questions
    /// directory's ignore file goes in before anything is written.
    fn update<R>(&self, key: &str, f: impl FnOnce(&mut Map<String, Value>) -> R) -> Option<R> {
        if std::fs::create_dir_all(self.dir()).is_err() {
            return None;
        }
        crate::serve_question::ignore_questions_dir(&jsp::join(&[&self.cwd, ".impeccable", "questions"]));
        let located = self.locate(key);
        let path = located.path.to_string_lossy().into_owned();
        let _guard = lock(&path)?;
        let mut ledger = Self::read_file(&path).unwrap_or_default();
        // A ledger made with no salt says so, so it never yields a reference.
        if !located.exists && located.reference.is_none() {
            ledger.insert("unsalted".into(), Value::Bool(true));
        }
        let before = ledger.clone();
        let out = f(&mut ledger);
        if ledger != before {
            self.write_file(&path, &ledger);
        }
        Some(out)
    }

    /// A seed value as given to `--from`: a key stands as itself; a
    /// reference resolves to the key this machine recorded for it. `Err`
    /// names a reference this machine has no record of.
    pub fn resolve(&self, v: &str) -> Result<String, String> {
        if impeccable_common::seed::parse_reference(v).is_none() {
            return Ok(v.to_string());
        }
        // The ledger is named by the reference itself, whatever salt made it.
        impeccable_common::seed::resolve(&self.cwd, v).ok_or_else(|| v.to_string())
    }

    /// Records the key behind a reference, for every roll whatever the
    /// telemetry setting: it is what makes the reference usable.
    pub fn record_key(&self, key: &str) {
        self.update(key, |l| {
            l.insert("key".into(), Value::String(key.to_string()));
        });
        self.prune();
    }

    /// Records an API-dealt round, replacing an earlier record of the same
    /// round (a reproduced roll is a new presentation, so it gets a fresh
    /// `pingId` and no sent state). Telemetry only.
    pub fn record_round(&self, key: &str, round: &SeedRound) {
        let ping_id = impeccable_common::seed::random_hex32();
        self.update(key, |l| {
            l.insert("key".into(), Value::String(key.to_string()));
            let rounds = l.entry("rounds").or_insert_with(|| Value::Object(Map::new()));
            if !rounds.is_object() {
                *rounds = Value::Object(Map::new());
            }
            let mut r = Map::new();
            r.insert("scope".into(), Value::String(round.scope.clone()));
            if let Some(m) = &round.mode {
                r.insert("mode".into(), Value::String(m.clone()));
            }
            if let Some(reg) = &round.register {
                r.insert("register".into(), Value::String(reg.clone()));
            }
            if let Some(p) = round.pool_revision.as_ref().filter(|p| valid_pool_revision(p)) {
                r.insert("poolRevision".into(), Value::String(p.clone()));
            }
            if let Some(h) = round.hand_id.as_ref().filter(|h| valid_hand_id(h)) {
                r.insert("handId".into(), Value::String(h.clone()));
            }
            r.insert("dealt".into(), json!(round.dealt));
            if let Some(p) = &ping_id {
                r.insert("pingId".into(), Value::String(p.clone()));
            }
            rounds.as_object_mut().unwrap().insert(round.reroll.to_string(), Value::Object(r));
        });
        self.prune();
    }

    /// The recorded round `reroll` for `key`, or the latest recorded round
    /// when `reroll` is `None` (a choice resolves on the round last dealt).
    pub fn round(&self, key: &str, reroll: Option<usize>) -> Option<SeedRound> {
        let ledger = Self::read_file(&self.file(key))?;
        let rounds = ledger.get("rounds")?.as_object()?;
        let n = match reroll {
            Some(n) => n,
            None => rounds.keys().filter_map(|k| k.parse::<usize>().ok()).max()?,
        };
        rounds.get(&n.to_string()).map(|v| round_from(v, n))
    }

    fn with_round<R>(&self, key: &str, reroll: usize, f: impl FnOnce(&mut Map<String, Value>) -> R) -> Option<R> {
        self.update(key, |l| {
            let r = l.get_mut("rounds").and_then(Value::as_object_mut).and_then(|rs| rs.get_mut(&reroll.to_string())).and_then(Value::as_object_mut)?;
            Some(f(r))
        })
        .flatten()
    }

    /// The page's claim on a round before it sends: a round with no choice
    /// state becomes `pending`. Returns the round (with its `pingId`) when
    /// the claim took; `None` when the round is unknown or already claimed.
    pub fn claim(&self, key: &str, reroll: usize) -> Option<SeedRound> {
        self.with_round(key, reroll, |r| {
            if r.contains_key("recorded") {
                return None;
            }
            r.insert("recorded".into(), Value::String("pending".into()));
            r.insert("pendingAt".into(), Value::from(crate::util::now_ms() as u64));
            Some(round_from(&Value::Object(r.clone()), reroll))
        })
        .flatten()
    }

    /// Whether a completion for the report `ping_id` still belongs to this
    /// round: a reproduced round gets a new `pingId`, so a send for the old
    /// one that finishes late touches nothing.
    fn same_report(r: &Map<String, Value>, ping_id: Option<&str>) -> bool {
        r.get("pingId").and_then(Value::as_str) == ping_id
    }

    /// A confirmed send of the report `ping_id` by `by`: the round's later
    /// reruns are no-ops. Ignored when the round now names another report.
    pub fn confirm(&self, key: &str, reroll: usize, by: &str, ping_id: Option<&str>) {
        self.with_round(key, reroll, |r| {
            if Self::same_report(r, ping_id) {
                r.insert("recorded".into(), Value::String(by.to_string()));
                r.remove("pendingAt");
            }
        });
    }

    /// A send of the report `ping_id` that failed: a still-pending round
    /// goes back to no state, so the agent's rerun sends it. Ignored when
    /// the round now names another report.
    pub fn release(&self, key: &str, reroll: usize, ping_id: Option<&str>) {
        self.with_round(key, reroll, |r| {
            if Self::same_report(r, ping_id) && r.get("recorded").and_then(Value::as_str) == Some("pending") {
                r.remove("recorded");
                r.remove("pendingAt");
            }
        });
    }

    /// Drops the rounds of ledgers untouched for `SEED_TTL_MS`, keeping the
    /// key so their references keep resolving.
    fn prune(&self) {
        let Ok(entries) = std::fs::read_dir(self.dir()) else { return };
        for e in entries.flatten() {
            let path = e.path().to_string_lossy().into_owned();
            if !path.ends_with(".json") {
                continue;
            }
            let old = e.metadata().ok().and_then(|m| m.modified().ok()).and_then(|t| t.elapsed().ok()).is_some_and(|age| age.as_millis() as f64 > SEED_TTL_MS);
            if !old || !Self::read_file(&path).is_some_and(|l| l.contains_key("rounds")) {
                continue;
            }
            if let Some(_guard) = lock(&path) {
                // Re-checked under the lock: another process may have written
                // a round, or claimed one, since the unlocked look above.
                let still_old = std::fs::metadata(&path).ok().and_then(|m| m.modified().ok()).and_then(|t| t.elapsed().ok()).is_some_and(|age| age.as_millis() as f64 > SEED_TTL_MS);
                if let Some(mut l) = Self::read_file(&path).filter(|_| still_old) {
                    let pending = l.get("rounds").and_then(Value::as_object).is_some_and(|rs| rs.values().any(|r| r.get("recorded").and_then(Value::as_str) == Some("pending")));
                    if !pending && l.remove("rounds").is_some() {
                        self.write_file(&path, &l);
                    }
                }
            }
        }
    }
}

// ---- the choice ping ---------------------------------------------------------

/// One `/api/chosen` body. `source` is `agent` for the agent-run `--kind`
/// command and `picker` when the decision page's server sends it;
/// `kind_source` (picker only) says whether the card declared its kind
/// (`explicit`) or the engine read it from older payload conventions
/// (`inferred`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ChoicePing {
    pub chosen_id: Option<String>,
    pub key: Option<String>,
    pub scope: Option<String>,
    pub mode: Option<String>,
    pub kind: Option<String>,
    pub register: Option<String>,
    /// The chosen card's zero-based position in the payload's options.
    pub option: Option<usize>,
    pub reroll: Option<usize>,
    pub pool_revision: Option<String>,
    pub hand_id: Option<String>,
    pub ping_id: Option<String>,
    pub kind_source: Option<&'static str>,
    pub source: &'static str,
}

impl ChoicePing {
    /// The JSON body, keys in a fixed order, absent values omitted.
    pub fn body(&self) -> Value {
        let mut body = Map::new();
        let mut put = |k: &str, v: &Option<String>| {
            if let Some(v) = v {
                body.insert(k.into(), Value::String(v.clone()));
            }
        };
        put("chosenId", &self.chosen_id);
        put("key", &self.key);
        put("scope", &self.scope);
        put("mode", &self.mode);
        put("kind", &self.kind);
        put("register", &self.register);
        if let Some(o) = self.option.filter(|o| *o <= MAX_OPTION) {
            body.insert("option".into(), Value::from(o));
        }
        if let Some(r) = self.reroll.filter(|r| *r <= MAX_REROLL) {
            body.insert("reroll".into(), Value::from(r));
        }
        if let Some(p) = self.pool_revision.as_ref().filter(|p| valid_pool_revision(p)) {
            body.insert("poolRevision".into(), Value::String(p.clone()));
        }
        if let Some(h) = self.hand_id.as_ref().filter(|h| valid_hand_id(h)) {
            body.insert("handId".into(), Value::String(h.clone()));
        }
        if let Some(p) = self.ping_id.as_ref().filter(|p| valid_hand_id(p)) {
            body.insert("pingId".into(), Value::String(p.clone()));
        }
        if let Some(k) = self.kind_source {
            body.insert("kindSource".into(), Value::String(k.to_string()));
        }
        body.insert("source".into(), Value::String(self.source.to_string()));
        Value::Object(body)
    }
}

/// POSTs the ping to `/api/chosen` within `timeout`. Never fails the
/// caller: any error is a false.
pub fn send_choice(env: &Env, cwd: &str, ping: &ChoicePing, timeout: Duration) -> bool {
    if timeout.is_zero() {
        return false;
    }
    let url = format!("{}/chosen", api_base(env));
    agent(&url, timeout)
        .post(&url)
        .set("Content-Type", "application/json")
        .set(CLIENT_HEADER, &client_header(env, cwd))
        .send_string(&json_compact(&ping.body()))
        .is_ok()
}

// ---- the picker's choice -----------------------------------------------------

fn card_text<'a>(card: &'a Value, k: &str) -> Option<&'a str> {
    card.get(k).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty())
}

fn is_pick_kicker(kicker: &str) -> bool {
    let k = kicker.to_uppercase().replace('\u{2019}', "'");
    k == "IMPECCABLE'S PICK"
}

/// The single dealt catalog world a challenger card draws from, matched by
/// its card images: the same board or hero URL the roll printed, or the
/// workspace copy serve-question keeps of it (`<id>-board.<ext>` /
/// `<id>-hero.<ext>`). `None` when no world or more than one matches.
fn matched_world(card: &Value, dealt: &[Value]) -> Option<String> {
    let images: Vec<&str> = ["hero", "board"].iter().filter_map(|k| card_text(card, k)).collect();
    let mut found: Vec<String> = Vec::new();
    for w in dealt {
        let Some(id) = w.get("id").and_then(Value::as_str) else { continue };
        let urls: Vec<&str> = ["hero", "board"].iter().filter_map(|k| w.get(*k).and_then(Value::as_str)).collect();
        let hit = images.iter().any(|img| {
            if urls.contains(img) {
                return true;
            }
            let file = img.replace('\\', "/");
            let name = file.rsplit('/').next().unwrap_or("");
            let stem = name.rsplit_once('.').map(|(s, _)| s).unwrap_or(name);
            !img.contains("://") && (stem == format!("{}-hero", id) || stem == format!("{}-board", id))
        });
        if hit && !found.iter().any(|f| f == id) {
            found.push(id.to_string());
        }
    }
    (found.len() == 1).then(|| found.remove(0))
}

/// The choice ping for an answer on a decision page. `seed` is the hand's
/// `seed` record (an API-dealt roll the page took, either scope); `payload`
/// the round the page served; `option_id` the answer's; `steer` the
/// register a re-roll answer carries.
///
/// - A re-roll answer is the hand rejected: kind `reroll`, `register` the
///   steer when there is one, `reroll` the round rejected.
/// - `canon` (the reserved option id, direction rounds only): kind `canon`.
/// - An option card sends its declared `kind` (`kindSource: explicit`):
///   `assigned`, `pick`, `challenger` with its `catalogId` as `chosenId`
///   only when that id was dealt this round, and `dealt` with no kind.
/// - A card with no valid `kind` (a payload from older skill text) falls
///   back to the old conventions (`kindSource: inferred`): a `verdict` card
///   is a challenger, its `chosenId` the one dealt world its card images
///   match; kicker `IMPECCABLE'S PICK` is the pick on a plain direction
///   round; kicker `THE ROLL`, or the lead card, is the assigned card on a
///   plain direction round and the dealt lead on a surface round. Anything
///   else sends no kind.
///
/// Every option-card ping carries `option`, the card's zero-based position,
/// so a choice with no kind is still recorded.
pub fn picker_choice(seed: &Value, payload: &Value, option_id: &str, steer: Option<&str>) -> Option<ChoicePing> {
    if seed.get("source").and_then(Value::as_str) != Some("api") {
        return None;
    }
    let scope = seed.get("scope").and_then(Value::as_str).filter(|s| *s == "direction" || *s == "surface")?;
    let key = seed.get("key").and_then(Value::as_str).filter(|k| !k.is_empty())?;
    let reroll = seed.get("reroll").and_then(Value::as_u64).map(|r| r as usize).filter(|r| *r <= MAX_REROLL)?;
    let valid_register = |r: &&str| *r == "safer" || *r == "bolder";
    let register = seed.get("register").and_then(Value::as_str).filter(valid_register);
    let dealt: Vec<Value> = seed.get("dealt").and_then(Value::as_array).cloned().unwrap_or_default();
    let dealt_id = |id: &str| dealt.iter().any(|w| w.get("id").and_then(Value::as_str) == Some(id));
    let s = |k: &str| seed.get(k).and_then(Value::as_str).map(str::to_string);
    let base = ChoicePing {
        key: Some(key.to_string()),
        scope: Some(scope.to_string()),
        mode: s("mode"),
        register: register.map(str::to_string),
        reroll: Some(reroll),
        pool_revision: s("poolRevision").filter(|p| valid_pool_revision(p)),
        hand_id: s("handId").filter(|h| valid_hand_id(h)),
        kind_source: Some("explicit"),
        source: "picker",
        ..Default::default()
    };
    match option_id {
        "" => return None,
        "reroll" => return Some(ChoicePing { kind: Some("reroll".into()), register: steer.filter(valid_register).map(str::to_string), ..base }),
        "canon" if scope == "direction" => return Some(ChoicePing { kind: Some("canon".into()), ..base }),
        "canon" => return None,
        _ => {}
    }
    let options: Vec<Value> = payload.get("options").and_then(Value::as_array).cloned().unwrap_or_default();
    let (index, card) = options.iter().enumerate().find(|(_, o)| o.get("id").and_then(Value::as_str) == Some(option_id))?;
    let option = Some(index).filter(|i| *i <= MAX_OPTION);
    let declared = card_text(card, "kind").filter(|k| CARD_KINDS.contains(k));
    if let Some(k) = declared {
        let (kind, chosen_id) = match k {
            "challenger" => (Some("challenger"), card_text(card, "catalogId").filter(|id| dealt_id(id)).map(str::to_string)),
            "dealt" => (None, None),
            other => (Some(other), None),
        };
        return Some(ChoicePing { kind: kind.map(str::to_string), chosen_id, option, ..base });
    }
    let kicker = card_text(card, "kicker");
    let lead = kicker.is_some_and(|k| k.eq_ignore_ascii_case("THE ROLL")) || index == 0;
    let (kind, chosen_id) = if card_text(card, "verdict").is_some() {
        (Some("challenger"), matched_world(card, &dealt))
    } else if scope == "surface" {
        (lead.then_some("assigned"), None)
    } else if register.is_some() {
        (None, None)
    } else if kicker.is_some_and(is_pick_kicker) {
        (Some("pick"), None)
    } else {
        (lead.then_some("assigned"), None)
    };
    Some(ChoicePing { kind: kind.map(str::to_string), chosen_id, option, kind_source: Some("inferred"), ..base })
}

// ---- `impeccable telemetry off|on|status` -------------------------------------

pub const PRIVACY_URL: &str = "https://impeccable.style/privacy";

fn status_line(env: &Env, cwd: &str) -> String {
    match opt_out_reason(env, cwd) {
        Some(reason) => format!("telemetry: off ({}). Rolls still work; the roll API is told not to record them, and no choice is sent.\n", reason),
        None => format!("telemetry: on. The roll request and the choice ping carry the seed key, scope, mode, round, pool revision, the card kind and catalog id that won, and the client version; never your project's names or code. Turn it off with `impeccable telemetry off`, DO_NOT_TRACK=1, or IMPECCABLE_NO_TELEMETRY=1. Details: {}\n", PRIVACY_URL),
    }
}

/// `impeccable telemetry off|on|status`: `off` records `"telemetry": false`
/// in the user config (`user_config_path`), `on` removes it, `status` says
/// whether telemetry is on and, when off, why. Other keys in the file are
/// kept.
pub fn run(args: &[String], io: &mut impeccable_common::Io) -> i32 {
    let env = io.env.clone();
    let cwd = io.cwd.to_string_lossy().into_owned();
    let path = user_config_path(&env);
    // A missing file is an empty config; one that does not parse to an
    // object is the user's to fix, never overwritten.
    let read = || -> Result<Map<String, Value>, String> {
        let Some(text) = safe_read(&path) else { return Ok(Map::new()) };
        match serde_json::from_str::<Value>(&text) {
            Ok(Value::Object(m)) => Ok(m),
            Ok(_) => Err(format!("{} is not a JSON object", impeccable_common::jsp::to_posix(&path))),
            Err(e) => Err(format!("{} is not valid JSON ({})", impeccable_common::jsp::to_posix(&path), e)),
        }
    };
    let write = |m: &Map<String, Value>| -> Result<(), String> {
        let dir = jsp::join(&[&crate::util::homedir(&env), ".impeccable"]);
        std::fs::create_dir_all(&dir)
            .and_then(|_| std::fs::write(&path, format!("{}\n", crate::util::json_pretty(&Value::Object(m.clone())))))
            .map_err(|e| format!("{}: {}", path, e))
    };
    match args.first().map(String::as_str) {
        Some("status") | None => {
            io.out(&status_line(&env, &cwd));
            0
        }
        Some(cmd @ ("off" | "on")) => {
            let mut m = match read() {
                Ok(m) => m,
                Err(e) => {
                    io.err(&format!("telemetry: {}; fix or remove it, then run `impeccable telemetry {}` again. Nothing was changed.\n", e, cmd));
                    return 1;
                }
            };
            if cmd == "off" {
                m.insert("telemetry".into(), Value::Bool(false));
            } else {
                m.remove("telemetry");
            }
            if let Err(e) = write(&m) {
                io.err(&format!("telemetry: could not write the user config ({})\n", e));
                return 1;
            }
            io.out(&status_line(&env, &cwd));
            0
        }
        Some(other) => {
            io.err(&format!("telemetry: unknown command \"{}\"; use off, on, or status\n", other));
            1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> String {
        let dir = std::env::temp_dir().join(format!("impeccable-telemetry-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.to_string_lossy().into_owned()
    }

    fn env(pairs: &[(&str, &str)]) -> Env {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    fn header_ok(h: &str) -> bool {
        let re = regex::Regex::new(r"^impeccable/[0-9A-Za-z.+-]{1,32}( [a-z]{1,16})?$").unwrap();
        re.is_match(h)
    }

    #[test]
    fn client_header_names_the_skill_version_else_the_engine_and_the_channel() {
        let dir = temp_dir("header");
        let skill = format!("{}/skill", dir);
        std::fs::create_dir_all(&skill).unwrap();
        let e = env(&[("IMPECCABLE_SKILL_DIR", &skill)]);
        let h = client_header(&e, &dir);
        assert_eq!(h, format!("impeccable/{}+engine", env!("CARGO_PKG_VERSION")));
        assert!(header_ok(&h), "{h}");
        std::fs::write(format!("{}/SKILL.md", skill), "---\nname: impeccable\nversion: 4.5.2\n---\n# x\n").unwrap();
        assert_eq!(client_header(&e, &dir), "impeccable/4.5.2");
        let e = env(&[("IMPECCABLE_SKILL_DIR", &skill), ("IMPECCABLE_TELEMETRY_CHANNEL", "test")]);
        let h = client_header(&e, &dir);
        assert_eq!(h, "impeccable/4.5.2 test");
        assert!(header_ok(&h), "{h}");
        // A channel that does not fit the format is dropped, never sent malformed.
        for bad in ["Test", "te st", "abcdefghijklmnopq", "t3st"] {
            let e = env(&[("IMPECCABLE_SKILL_DIR", &skill), ("IMPECCABLE_TELEMETRY_CHANNEL", bad)]);
            assert_eq!(client_header(&e, &dir), "impeccable/4.5.2", "{bad}");
        }
        // A frontmatter version outside the token alphabet falls back to the engine.
        std::fs::write(format!("{}/SKILL.md", skill), "---\nversion: 4.5 beta\n---\n").unwrap();
        assert!(client_header(&env(&[("IMPECCABLE_SKILL_DIR", &skill)]), &dir).ends_with("+engine"));
    }

    pub(crate) fn test_ledger(cwd: &str) -> Ledger {
        Ledger::new(&env(&[("IMPECCABLE_SEED_SALT", "test-salt")]), cwd)
    }

    fn round(n: usize, dealt: &[&str]) -> SeedRound {
        SeedRound {
            scope: "direction".into(),
            reroll: n,
            mode: Some("persuade".into()),
            pool_revision: Some("0123456789ab".into()),
            hand_id: Some("00112233445566778899aabbccddeeff".into()),
            dealt: dealt.iter().map(|s| s.to_string()).collect(),
            ..Default::default()
        }
    }

    #[test]
    fn ledger_rounds_carry_a_ping_id_and_move_through_pending_to_confirmed() {
        let cwd = temp_dir("ledger");
        let l = test_ledger(&cwd);
        assert_eq!(l.round("k1", None), None);
        l.record_round("k1", &round(0, &["a", "b"]));
        l.record_round("k1", &round(1, &["c"]));
        assert_eq!(l.round("k1", None).unwrap().dealt, vec!["c"]);
        let r0 = l.round("k1", Some(0)).unwrap();
        assert_eq!((r0.dealt.clone(), r0.recorded.clone()), (vec!["a".to_string(), "b".to_string()], None));
        let ping_id = r0.ping_id.clone().unwrap();
        assert!(valid_hand_id(&ping_id), "{ping_id}");
        assert_ne!(l.round("k1", Some(1)).unwrap().ping_id.unwrap(), ping_id, "one id per round");
        assert_eq!(l.round("k1", Some(5)), None);
        // The page claims, the claim is exclusive, a failure releases it.
        let claimed = l.claim("k1", 0).unwrap();
        assert_eq!(claimed.ping_id.as_deref(), Some(ping_id.as_str()));
        assert_eq!(l.claim("k1", 0), None);
        let pending = l.round("k1", Some(0)).unwrap();
        assert!(pending.recorded.as_deref() == Some("pending") && pending.pending_at.is_some() && !pending.confirmed());
        let id = Some(ping_id.as_str());
        l.release("k1", 0, id);
        assert_eq!(l.round("k1", Some(0)).unwrap().recorded, None);
        // A confirmed send is final; release never undoes it.
        l.claim("k1", 0).unwrap();
        l.confirm("k1", 0, "picker", id);
        l.release("k1", 0, id);
        let done = l.round("k1", Some(0)).unwrap();
        assert!(done.confirmed() && done.pending_at.is_none(), "{done:?}");
        assert_eq!(l.round("k1", Some(0)).unwrap().ping_id.as_deref(), Some(ping_id.as_str()));
        // Malformed values are never stored.
        let mut r = round(2, &[]);
        r.pool_revision = Some("NOT-HEX".into());
        r.hand_id = Some("00112233445566778899AABBCCDDEEFF".into());
        l.record_round("k1", &r);
        let back = l.round("k1", Some(2)).unwrap();
        assert_eq!((back.pool_revision, back.hand_id), (None, None));
        // Files are named by the reference's hex and hold no time but a pending send's.
        l.record_round("../Evil Key", &round(0, &["x"]));
        for e in std::fs::read_dir(format!("{}/.impeccable/questions/seeds", cwd)).unwrap().flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            assert!(name.len() == 21 && name.ends_with(".json") && !name.contains("k1") && !name.contains("Evil"), "{name}");
            assert!(!std::fs::read_to_string(e.path()).unwrap().contains("\"at\""));
        }
        assert_eq!(l.resolve(&l.reference("../Evil Key").unwrap()).unwrap(), "../Evil Key");
        assert_eq!(std::fs::read_to_string(format!("{}/.impeccable/questions/.gitignore", cwd)).unwrap(), format!("{}\n*\n", impeccable_common::git::RUNTIME_IGNORE_HEADER));
    }

    #[test]
    fn a_late_completion_for_a_replaced_round_changes_nothing() {
        let cwd = temp_dir("ledger-late");
        let l = test_ledger(&cwd);
        l.record_round("k1", &round(0, &["a"]));
        let old = l.claim("k1", 0).unwrap().ping_id;
        // The round is reproduced (a new presentation, a new report) while the
        // old send is still in flight.
        l.record_round("k1", &round(0, &["a"]));
        let fresh = l.round("k1", Some(0)).unwrap();
        assert_ne!(fresh.ping_id, old);
        // The old send finishing, either way, leaves the new round alone.
        l.confirm("k1", 0, "picker", old.as_deref());
        assert_eq!(l.round("k1", Some(0)).unwrap().recorded, None, "a late success does not record the new round");
        let new_claim = l.claim("k1", 0).unwrap();
        l.release("k1", 0, old.as_deref());
        assert_eq!(l.round("k1", Some(0)).unwrap().recorded.as_deref(), Some("pending"), "a late failure does not clear the new claim");
        l.confirm("k1", 0, "picker", new_claim.ping_id.as_deref());
        assert!(l.round("k1", Some(0)).unwrap().confirmed());
    }

    #[test]
    fn no_salt_means_no_reference_never_an_unsalted_one() {
        let cwd = temp_dir("no-salt");
        let home = format!("{}/home", cwd);
        std::fs::create_dir_all(format!("{}/.impeccable", home)).unwrap();
        std::fs::write(format!("{}/.impeccable/seed-salt", home), "corrupt").unwrap();
        let l = Ledger::new(&env(&[("HOME", home.as_str()), ("USERPROFILE", home.as_str())]), &cwd);
        assert_eq!(l.reference("k1"), None);
        assert_eq!(l.resolve(&impeccable_common::seed::reference("", "k1")), Err(impeccable_common::seed::reference("", "k1")), "an unsalted hash resolves to nothing");
        // Telemetry rounds still work by key.
        l.record_round("k1", &round(0, &["a"]));
        assert!(l.round("k1", Some(0)).is_some());
    }

    #[test]
    fn concurrent_ledger_updates_lose_nothing() {
        let cwd = temp_dir("ledger-race");
        let l = test_ledger(&cwd);
        for n in 0..8 {
            l.record_round("k1", &round(n, &["a"]));
        }
        // Eight threads, each claiming and confirming its own round of the
        // same file at once: every write survives the others.
        let handles: Vec<_> = (0..8)
            .map(|n| {
                let cwd = cwd.clone();
                std::thread::spawn(move || {
                    let l = test_ledger(&cwd);
                    let claimed = l.claim("k1", n).unwrap();
                    l.confirm("k1", n, "picker", claimed.ping_id.as_deref());
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }
        for n in 0..8 {
            assert!(l.round("k1", Some(n)).unwrap().confirmed(), "round {n}");
        }
        let leftovers: Vec<String> = std::fs::read_dir(format!("{}/.impeccable/questions/seeds", cwd)).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| n.contains(".tmp-") || n.ends_with(".lock")).collect();
        assert!(leftovers.is_empty(), "{leftovers:?}");
    }

    #[test]
    fn a_stale_lock_is_taken_over() {
        let cwd = temp_dir("ledger-stale");
        let l = test_ledger(&cwd);
        l.record_key("k1");
        let lock_path = format!("{}.lock", l.file("k1"));
        std::fs::write(&lock_path, "").unwrap();
        let old = std::time::SystemTime::now() - Duration::from_secs(60);
        std::fs::File::options().write(true).open(&lock_path).unwrap().set_modified(old).unwrap();
        l.record_round("k1", &round(0, &[]));
        assert!(l.round("k1", Some(0)).is_some(), "a lock left by a dead process does not block");
    }

    #[test]
    fn pruning_keeps_the_key_behind_a_reference() {
        let cwd = temp_dir("ledger-prune");
        let l = test_ledger(&cwd);
        l.record_round("k1", &round(0, &["a"]));
        let path = l.file("k1");
        let old = std::time::SystemTime::now() - Duration::from_secs(40 * 24 * 3600);
        std::fs::File::options().write(true).open(&path).unwrap().set_modified(old).unwrap();
        // A pending send keeps its rounds even on an old file.
        l.claim("k1", 0).unwrap();
        std::fs::File::options().write(true).open(&path).unwrap().set_modified(old).unwrap();
        l.record_key("other");
        assert!(l.round("k1", Some(0)).is_some(), "a pending round is never pruned");
        let id = l.round("k1", Some(0)).unwrap().ping_id;
        l.release("k1", 0, id.as_deref());
        std::fs::File::options().write(true).open(&path).unwrap().set_modified(old).unwrap();
        l.record_key("other");
        assert_eq!(l.round("k1", None), None, "old rounds go");
        assert_eq!(l.resolve(&l.reference("k1").unwrap()).unwrap(), "k1", "the reference still resolves");
    }

    #[test]
    fn body_orders_fields_and_drops_out_of_range_values() {
        let p = ChoicePing {
            chosen_id: Some("w1".into()),
            key: Some("k".into()),
            scope: Some("direction".into()),
            mode: None,
            kind: Some("challenger".into()),
            register: Some("bolder".into()),
            option: Some(3),
            reroll: Some(2),
            pool_revision: Some("0123456789ab".into()),
            hand_id: Some("00112233445566778899aabbccddeeff".into()),
            ping_id: Some("ffeeddccbbaa99887766554433221100".into()),
            kind_source: Some("explicit"),
            source: "picker",
        };
        assert_eq!(json_compact(&p.body()), r#"{"chosenId":"w1","key":"k","scope":"direction","kind":"challenger","register":"bolder","option":3,"reroll":2,"poolRevision":"0123456789ab","handId":"00112233445566778899aabbccddeeff","pingId":"ffeeddccbbaa99887766554433221100","kindSource":"explicit","source":"picker"}"#);
        // A handId in any other shape (an older or odd server) is never sent.
        for bad in ["00112233445566778899AABBCCDDEEFF", "0011", "00112233445566778899aabbccddeeffaa", "zz112233445566778899aabbccddeeff"] {
            assert!(!valid_hand_id(bad), "{bad}");
        }
        let p = ChoicePing { reroll: Some(9), option: Some(16), pool_revision: Some("xyz".into()), hand_id: Some("0011".into()), source: "picker", ..Default::default() };
        assert_eq!(json_compact(&p.body()), r#"{"source":"picker"}"#);
    }

    fn seed(register: Option<&str>) -> Value {
        let mut s = json!({
            "key": "k1", "scope": "direction", "reroll": 1, "mode": "persuade", "source": "api", "poolRevision": "0123456789ab",
            "dealt": [
                { "id": "teletext-service", "board": "https://cards.test/teletext-service.webp", "hero": "https://cards.test/teletext-service-hero.webp" },
                { "id": "microfiche-reader", "board": "https://cards.test/microfiche-reader.webp", "hero": "https://cards.test/microfiche-reader-hero.webp" }
            ]
        });
        if let Some(r) = register {
            s["register"] = json!(r);
        }
        s
    }

    /// A page from older skill text: no card declares a kind.
    fn legacy_page() -> Value {
        json!({ "options": [
            { "id": "assigned", "label": "Fillmore", "hero": "https://cards.test/teletext-service-hero.webp" },
            { "id": "model-pick", "label": "Broadside", "kicker": "IMPECCABLE’S PICK" },
            { "id": "challenger-teletext", "verdict": "competitive", "hero": "https://cards.test/teletext-service-hero.webp" },
            { "id": "challenger-microfiche", "verdict": "declined", "hero": ".impeccable/mocks/worlds/microfiche-reader-hero.webp" },
            { "id": "challenger-own", "verdict": "wins", "hero": "https://elsewhere.test/x.webp" },
            { "id": "grounded-2", "label": "Another" }
        ], "canon": true })
    }

    fn explicit_page() -> Value {
        json!({ "options": [
            { "id": "a", "kind": "assigned" },
            { "id": "p", "kind": "pick", "kicker": "IMPECCABLE’S PICK" },
            { "id": "c1", "kind": "challenger", "catalogId": "teletext-service", "verdict": "competitive" },
            { "id": "c2", "kind": "challenger", "catalogId": "challenger-teletext", "verdict": "wins" },
            { "id": "d", "kind": "dealt" },
            { "id": "g", "kind": "grounded" }
        ], "canon": true })
    }

    /// (kind, chosenId, option, kindSource) of a ping.
    type Read = Option<(Option<String>, Option<String>, Option<usize>, Option<&'static str>)>;
    fn read(p: Option<ChoicePing>) -> Read {
        p.map(|p| (p.kind, p.chosen_id, p.option, p.kind_source))
    }
    fn r(kind: Option<&str>, id: Option<&str>, option: Option<usize>, src: &'static str) -> Read {
        Some((kind.map(str::to_string), id.map(str::to_string), option, Some(src)))
    }

    #[test]
    fn picker_sends_the_kind_each_card_declares() {
        let pg = explicit_page();
        for register in [None, Some("safer"), Some("bolder")] {
            let s = seed(register);
            let k = |id: &str| read(picker_choice(&s, &pg, id, None));
            assert_eq!(k("a"), r(Some("assigned"), None, Some(0), "explicit"), "{register:?}");
            assert_eq!(k("p"), r(Some("pick"), None, Some(1), "explicit"), "{register:?}");
            assert_eq!(k("c1"), r(Some("challenger"), Some("teletext-service"), Some(2), "explicit"));
            // An id that was not dealt never leaves the machine; the kind still goes.
            assert_eq!(k("c2"), r(Some("challenger"), None, Some(3), "explicit"));
            assert_eq!(k("canon"), r(Some("canon"), None, None, "explicit"));
            assert_eq!(k("g"), r(Some("grounded"), None, Some(5), "explicit"), "a safer lineup card");
            assert_eq!(k("nope"), None);
            assert_eq!(picker_choice(&s, &pg, "a", None).unwrap().register.as_deref(), register);
        }
        let p = picker_choice(&seed(None), &pg, "c1", None).unwrap();
        assert_eq!(json_compact(&p.body()), r#"{"chosenId":"teletext-service","key":"k1","scope":"direction","mode":"persuade","kind":"challenger","option":2,"reroll":1,"poolRevision":"0123456789ab","kindSource":"explicit","source":"picker"}"#);
    }

    #[test]
    fn a_reroll_answer_is_the_hand_rejected() {
        let s = seed(Some("safer"));
        let p = picker_choice(&s, &explicit_page(), "reroll", Some("bolder")).unwrap();
        assert_eq!(json_compact(&p.body()), r#"{"key":"k1","scope":"direction","mode":"persuade","kind":"reroll","register":"bolder","reroll":1,"poolRevision":"0123456789ab","kindSource":"explicit","source":"picker"}"#);
        let p = picker_choice(&s, &explicit_page(), "reroll", None).unwrap();
        assert_eq!(p.register, None, "a plain re-roll carries no register");
    }

    #[test]
    fn surface_rounds_send_the_lead_as_assigned_and_other_dealt_cards_by_position() {
        let mut s = seed(None);
        s["scope"] = json!("surface");
        let pg = json!({ "options": [{ "id": "s1", "kind": "assigned" }, { "id": "s2", "kind": "dealt" }, { "id": "s3", "kind": "challenger", "catalogId": "microfiche-reader" }] });
        assert_eq!(read(picker_choice(&s, &pg, "s1", None)), r(Some("assigned"), None, Some(0), "explicit"));
        assert_eq!(read(picker_choice(&s, &pg, "s2", None)), r(None, None, Some(1), "explicit"));
        assert_eq!(read(picker_choice(&s, &pg, "s3", None)), r(Some("challenger"), Some("microfiche-reader"), Some(2), "explicit"));
        assert_eq!(picker_choice(&s, &pg, "canon", None), None, "surface rounds have no canon");
        assert_eq!(json_compact(&picker_choice(&s, &pg, "s2", None).unwrap().body()), r#"{"key":"k1","scope":"surface","mode":"persuade","option":1,"reroll":1,"poolRevision":"0123456789ab","kindSource":"explicit","source":"picker"}"#);
        // Older surface payloads: the lead is inferred, the rest go by position.
        let legacy = json!({ "options": [{ "id": "s1", "kicker": "THE ROLL" }, { "id": "s2" }] });
        assert_eq!(read(picker_choice(&s, &legacy, "s1", None)), r(Some("assigned"), None, Some(0), "inferred"));
        assert_eq!(read(picker_choice(&s, &legacy, "s2", None)), r(None, None, Some(1), "inferred"));
    }

    #[test]
    fn older_payloads_fall_back_to_the_conventions_marked_inferred() {
        let s = seed(None);
        let pg = legacy_page();
        let k = |id: &str| read(picker_choice(&s, &pg, id, None));
        // The assigned card may wear a catalog image; it is still the assigned card, with no id.
        assert_eq!(k("assigned"), r(Some("assigned"), None, Some(0), "inferred"));
        assert_eq!(k("model-pick"), r(Some("pick"), None, Some(1), "inferred"));
        assert_eq!(k("challenger-teletext"), r(Some("challenger"), Some("teletext-service"), Some(2), "inferred"));
        assert_eq!(k("challenger-microfiche"), r(Some("challenger"), Some("microfiche-reader"), Some(3), "inferred"), "the workspace copy of a card image matches its world");
        assert_eq!(k("challenger-own"), r(Some("challenger"), None, Some(4), "inferred"));
        assert_eq!(k("grounded-2"), r(None, None, Some(5), "inferred"));
        // On register rounds only verdict cards keep a kind.
        let s = seed(Some("bolder"));
        assert_eq!(read(picker_choice(&s, &pg, "assigned", None)), r(None, None, Some(0), "inferred"));
        assert_eq!(read(picker_choice(&s, &pg, "challenger-teletext", None)), r(Some("challenger"), Some("teletext-service"), Some(2), "inferred"));
        // A world two dealt entries share an image with is ambiguous: no id.
        let mut s = seed(None);
        s["dealt"][1]["hero"] = json!("https://cards.test/teletext-service-hero.webp");
        assert_eq!(read(picker_choice(&s, &pg, "challenger-teletext", None)), r(Some("challenger"), None, Some(2), "inferred"));
    }

    #[test]
    fn picker_stays_out_of_non_api_rounds() {
        let pg = explicit_page();
        let mut s = seed(None);
        s["source"] = json!("local");
        assert_eq!(picker_choice(&s, &pg, "a", None), None);
        let mut s = seed(None);
        s["reroll"] = json!(9);
        assert_eq!(picker_choice(&s, &pg, "a", None), None);
    }

    #[test]
    fn seed_references_are_salted_hashes_that_resolve_only_where_recorded() {
        let cwd = temp_dir("reference");
        let l = test_ledger(&cwd);
        let r = l.reference("3f9a1c2e").unwrap();
        assert!(impeccable_common::seed::parse_reference(&r).is_some() && r.len() == 21 && !r.contains("3f9a1c2e"), "{r}");
        assert_eq!(l.reference("3f9a1c2e").unwrap(), r, "stable");
        assert_ne!(Ledger::new(&env(&[("IMPECCABLE_SEED_SALT", "another")]), &cwd).reference("3f9a1c2e").unwrap(), r, "salted");
        // A key resolves to itself; a reference only once this machine recorded its key.
        assert_eq!(l.resolve("k1").unwrap(), "k1");
        assert_eq!(l.resolve(&r), Err(r.clone()));
        l.record_key("3f9a1c2e");
        assert_eq!(l.resolve(&r).unwrap(), "3f9a1c2e");
        // The key record carries no telemetry round.
        assert_eq!(l.round("3f9a1c2e", None), None);
    }

    #[test]
    fn opt_outs_follow_the_env_convention_and_both_configs() {
        let cwd = temp_dir("optout");
        let home = format!("{}/home", cwd);
        let base = |extra: &[(&str, &str)]| {
            let mut e = env(&[("HOME", home.as_str()), ("USERPROFILE", home.as_str())]);
            for (k, v) in extra {
                e.insert(k.to_string(), v.to_string());
            }
            e
        };
        assert_eq!(opt_out_reason(&base(&[]), &cwd), None);
        for v in ["1", "true", "yes", "anything"] {
            assert!(telemetry_disabled(&base(&[("DO_NOT_TRACK", v)]), &cwd), "{v}");
            assert!(telemetry_disabled(&base(&[("IMPECCABLE_NO_TELEMETRY", v)]), &cwd), "{v}");
        }
        for v in ["", "0", "false", "FALSE", " "] {
            assert!(!telemetry_disabled(&base(&[("DO_NOT_TRACK", v)]), &cwd), "{v:?}");
        }
        std::fs::create_dir_all(format!("{}/.impeccable", home)).unwrap();
        std::fs::write(format!("{}/.impeccable/config.json", home), r#"{"telemetry": false}"#).unwrap();
        assert!(opt_out_reason(&base(&[]), &cwd).unwrap().contains("telemetry\": false in"));
        std::fs::write(format!("{}/.impeccable/config.json", home), r#"{"telemetry": true}"#).unwrap();
        assert_eq!(opt_out_reason(&base(&[]), &cwd), None);
        std::fs::create_dir_all(format!("{}/.impeccable", cwd)).unwrap();
        std::fs::write(format!("{}/.impeccable/config.json", cwd), r#"{"telemetry": false}"#).unwrap();
        assert_eq!(opt_out_reason(&base(&[]), &cwd).as_deref(), Some("\"telemetry\": false in .impeccable/config.json"));
    }

    #[test]
    fn the_telemetry_verb_records_the_choice_in_the_user_config() {
        let cwd = temp_dir("verb");
        let home = format!("{}/home", cwd);
        let call = |args: &[&str]| {
            let e = env(&[("HOME", home.as_str()), ("USERPROFILE", home.as_str())]);
            let (mut io, cap) = impeccable_common::Io::captured("", std::path::PathBuf::from(&cwd), e);
            let argv: Vec<String> = args.iter().map(|s| s.to_string()).collect();
            let code = run(&argv, &mut io);
            let out = String::from_utf8(cap.stdout.borrow().clone()).unwrap();
            (code, out)
        };
        assert!(call(&["status"]).1.starts_with("telemetry: on."));
        std::fs::create_dir_all(format!("{}/.impeccable", home)).unwrap();
        std::fs::write(format!("{}/.impeccable/config.json", home), r#"{"other": 1}"#).unwrap();
        let (code, out) = call(&["off"]);
        assert_eq!(code, 0);
        assert!(out.starts_with("telemetry: off (\"telemetry\": false in "), "{out}");
        let cfg: Value = serde_json::from_str(&std::fs::read_to_string(format!("{}/.impeccable/config.json", home)).unwrap()).unwrap();
        assert_eq!(cfg, json!({ "other": 1, "telemetry": false }));
        assert!(call(&["status"]).1.starts_with("telemetry: off"));
        assert!(call(&["on"]).1.starts_with("telemetry: on."));
        let cfg: Value = serde_json::from_str(&std::fs::read_to_string(format!("{}/.impeccable/config.json", home)).unwrap()).unwrap();
        assert_eq!(cfg, json!({ "other": 1 }));
        assert_eq!(call(&["maybe"]).0, 1);
    }

    #[test]
    fn a_project_opt_out_counts_from_a_subdirectory() {
        let root = temp_dir("optout-root");
        std::fs::create_dir_all(format!("{}/.git", root)).unwrap();
        std::fs::create_dir_all(format!("{}/.impeccable", root)).unwrap();
        std::fs::write(format!("{}/.impeccable/config.json", root), r#"{"telemetry": false}"#).unwrap();
        // A workspace monorepo, run from a package: the same roots `context`
        // reads its config defaults from.
        std::fs::write(format!("{}/package.json", root), r#"{"private": true, "workspaces": ["packages/*"]}"#).unwrap();
        let sub = format!("{}/packages/web", root);
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(format!("{}/package.json", sub), r#"{"name": "web"}"#).unwrap();
        let e = env(&[("HOME", &format!("{}/home", root)), ("USERPROFILE", &format!("{}/home", root))]);
        let reason = opt_out_reason(&e, &sub).expect("the project root's config counts");
        assert!(reason.contains("\"telemetry\": false in") && reason.contains(".impeccable/config.json"), "{reason}");
    }

    #[test]
    fn telemetry_off_and_on_refuse_to_overwrite_a_malformed_user_config() {
        let cwd = temp_dir("verb-malformed");
        let home = format!("{}/home", cwd);
        std::fs::create_dir_all(format!("{}/.impeccable", home)).unwrap();
        for (body, why) in [("{not json", "is not valid JSON"), ("[1, 2]", "is not a JSON object")] {
            std::fs::write(format!("{}/.impeccable/config.json", home), body).unwrap();
            for cmd in ["off", "on"] {
                let e = env(&[("HOME", home.as_str()), ("USERPROFILE", home.as_str())]);
                let (mut io, cap) = impeccable_common::Io::captured("", std::path::PathBuf::from(&cwd), e);
                assert_eq!(run(&[cmd.to_string()], &mut io), 1);
                let err = String::from_utf8(cap.stderr.borrow().clone()).unwrap();
                assert!(err.contains(why) && err.contains("Nothing was changed"), "{err}");
                assert_eq!(std::fs::read_to_string(format!("{}/.impeccable/config.json", home)).unwrap(), body, "untouched");
            }
        }
    }

    #[test]
    fn references_from_either_salt_resolve() {
        let cwd = temp_dir("two-salts");
        let home = format!("{}/home", cwd);
        let e = env(&[("HOME", home.as_str()), ("USERPROFILE", home.as_str())]);
        // A sandboxed run (no home) makes a project salt and a reference under it.
        // A home that cannot hold a directory (it is a file) stands in for a read-only one.
        let blocked = format!("{}/blocked-home", cwd);
        std::fs::write(&blocked, "").unwrap();
        let sandboxed = Ledger::new(&env(&[("HOME", blocked.as_str()), ("USERPROFILE", blocked.as_str())]), &cwd);
        let old = sandboxed.reference("k1").unwrap();
        sandboxed.record_key("k1");
        // A stray home salt appears later (another tool, a restored backup).
        std::fs::create_dir_all(format!("{}/.impeccable", home)).unwrap();
        std::fs::write(format!("{}/.impeccable/seed-salt", home), "0123456789abcdef0123456789abcdef\n").unwrap();
        let l = Ledger::new(&e, &cwd);
        let new = l.reference("k2").unwrap();
        assert_ne!(impeccable_common::seed::parse_reference(&new), None);
        l.record_key("k2");
        assert_eq!(l.resolve(&old).unwrap(), "k1", "the project salt's reference still resolves");
        assert_eq!(l.resolve(&new).unwrap(), "k2");
    }

    #[cfg(unix)]
    #[test]
    fn a_stale_lock_that_cannot_be_removed_gives_up_within_the_deadline() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::path::PathBuf::from(temp_dir("lock-stuck"));
        let path = dir.join("ledger.json").to_string_lossy().into_owned();
        let lock_path = format!("{}.lock", path);
        std::fs::write(&lock_path, "").unwrap();
        let old = std::time::SystemTime::now() - Duration::from_secs(60);
        std::fs::File::options().write(true).open(&lock_path).unwrap().set_modified(old).unwrap();
        // A read-only folder: the stale lock can be neither removed nor replaced.
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o555)).unwrap();
        if std::fs::remove_file(&lock_path).is_ok() {
            return; // running as root: permissions are not enforced
        }
        let start = std::time::Instant::now();
        assert!(lock(&path).is_none());
        assert!(start.elapsed().as_millis() < LOCK_WAIT_MS + 1_000, "{:?}", start.elapsed());
        let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755));
    }
}
