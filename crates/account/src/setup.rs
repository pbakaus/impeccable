//! Setup status: a private projection of the local inventory. Network work is
//! done only by the detached CLI worker, never by a triggering command or hook.
use crate::{
    config::{impeccable_home, Account},
    http::Client,
    session::{now, Session},
    store::{write_private, Store},
};
use impeccable_common::Io;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs, path::PathBuf, time::Duration};

pub fn grant(account: &Account, login: u64, allowed: bool) {
    let _ = write_private(
        &account.dir().join("setup-grant.json"),
        json!({"login":login,"allowed":allowed})
            .to_string()
            .as_bytes(),
    );
}
fn path(io: &Io) -> Option<PathBuf> {
    Some(impeccable_home(&io.env)?.join("setup.json"))
}
fn read(io: &Io) -> Option<Value> {
    match fs::read(path(io)?) {
        Ok(b) => serde_json::from_slice(&b).ok().filter(Value::is_object),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Some(json!({})),
        Err(_) => None,
    }
}
fn save(io: &Io, v: &Value) -> Result<(), String> {
    write_private(
        &path(io).ok_or("no home directory")?,
        v.to_string().as_bytes(),
    )
}
fn lock(io: &Io, wait: Duration) -> Option<fs::File> {
    let p = path(io)?.with_extension("lock");
    fs::create_dir_all(p.parent()?).ok()?;
    let f = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(p)
        .ok()?;
    let end = std::time::Instant::now() + wait;
    loop {
        match f.try_lock() {
            Ok(()) => return Some(f),
            Err(fs::TryLockError::WouldBlock) if std::time::Instant::now() < end => {
                std::thread::sleep(Duration::from_millis(10))
            }
            Err(_) => return None,
        }
    }
}
fn marker(io: &Io) -> Option<(Account, String)> {
    let a = Account::from_env(&io.env).ok()?;
    let s = Store::new(&a).state()?;
    let g: Value =
        serde_json::from_slice(&fs::read(a.dir().join("setup-grant.json")).ok()?).ok()?;
    (s.signed_in && g["login"] == s.login && g["allowed"] == true).then(|| {
        let m = format!("{} {}", a.issuer, s.login);
        (a, m)
    })
}
pub fn wanted(io: &Io) -> bool {
    if io.env.get("CI").is_some_and(|v| !v.is_empty())
        || impeccable_context::telemetry::opt_out_reason(&io.env, &io.cwd.to_string_lossy())
            .is_some()
    {
        return false;
    }
    let Some(v) = read(io) else {
        return false;
    };
    if v["sync"] == false {
        return false;
    }
    let Some((_, m)) = marker(io) else {
        return false;
    };
    v["attempts"][format!("{:x}", Sha256::digest(m.as_bytes()))]
        .as_u64()
        .is_none_or(|t| now().saturating_sub(t) >= 86400)
}

/// Only release numbers from the service's published grammar can leave the machine.
fn release(v: &str) -> bool {
    let number = |s: &str| {
        !s.is_empty()
            && s.len() <= 6
            && s.bytes().all(|c| c.is_ascii_digit())
            && (s.len() == 1 || !s.starts_with('0'))
    };
    let (core, pre) = v.split_once('-').map_or((v, None), |(a, b)| (a, Some(b)));
    let parts: Vec<_> = core.split('.').collect();
    parts.len() == 3
        && parts.iter().all(|p| number(p))
        && pre.is_none_or(|p| {
            p.split_once('.')
                .is_some_and(|(tag, n)| ["alpha", "beta", "rc", "next"].contains(&tag) && number(n))
        })
}
fn payload(inventory: &Value, cli: &str, skills: &Value, device: &str) -> Option<Value> {
    let engine = env!("CARGO_PKG_VERSION");
    if !release(cli) || !release(engine) {
        return None;
    }
    let os = match std::env::consts::OS {
        "macos" => "macos",
        "linux" => "linux",
        "windows" => "windows",
        _ => return None,
    };
    let mut installs = vec![];
    let mut other = 0;
    for i in inventory["installations"].as_array()? {
        if i["owner"] != "impeccable-loop"
            || !["claude", "codex"].iter().any(|h| i["harness"] == *h)
        {
            other += 1;
            continue;
        }
        let mut hooks = std::collections::BTreeSet::new();
        for h in i["hooks"].as_array()? {
            if let Some(e) = h["event"].as_str().filter(|e| {
                [
                    "SessionStart",
                    "SessionEnd",
                    "Stop",
                    "StopFailure",
                    "SubagentStop",
                    "PreToolUse",
                    "PostToolUse",
                    "UserPromptSubmit",
                    "Notification",
                    "PreCompact",
                ]
                .contains(e)
            }) {
                hooks.insert(e);
            }
        }
        let count = |k: &str| i[k].as_array().map_or(0, Vec::len);
        if count("mcpServers") > 16 || count("mcpApprovals") > 16 {
            return None;
        }
        let mut resources = json!({"created":0,"preexisting":0,"conflict":0});
        for r in i["resources"].as_array()? {
            if let Some(s) = r["state"]
                .as_str()
                .filter(|s| ["created", "preexisting", "conflict"].contains(s))
            {
                let n = resources[s].as_u64()? + 1;
                if n > 1000 {
                    return None;
                }
                resources[s] = n.into();
            }
        }
        installs.push(json!({"owner":"impeccable-loop","harness":i["harness"],"hooks":hooks,"instruction":i["instruction"]==true,"mcpServers":count("mcpServers"),"mcpApprovals":count("mcpApprovals"),"resources":resources}));
    }
    if installs.len() > 32 || other > 32 {
        return None;
    }
    let mut versions = json!({});
    for h in ["claude", "codex"] {
        if let Some(v) = skills[h].as_str().filter(|v| release(v)) {
            versions[h] = v.into();
        }
    }
    let id = crate::oauth::random_b64(16);
    let hex = format!("{:x}", Sha256::digest(id.as_bytes()));
    let report_id = format!(
        "{}-{}-4{}-8{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[13..16],
        &hex[17..20],
        &hex[20..32]
    );
    let pending = inventory["pendingTransactions"].as_u64()?;
    if pending > 1000 {
        return None;
    }
    let b = json!({"version":1,"reportId":report_id,"deviceKey":device,"reportedAt":impeccable_context::util::iso_from_ms(now() as f64*1000.0),"os":os,"cliVersion":cli,"engineVersion":engine,"skills":versions,"installations":installs,"otherInstallations":other,"pendingTransactions":pending});
    (b.to_string().len() <= 16384).then_some(b)
}

/// A daily claim bound to one consented sign-in and one preference revision.
/// Claim before collecting inventory, so failed or hung probes cannot fan out.
pub struct Attempt {
    account: Account,
    marker: String,
    login: u64,
    epoch: u64,
    device: String,
}

pub fn begin(io: &Io) -> Option<Attempt> {
    if !wanted(io) {
        return None;
    }
    let account = Account::from_env(&io.env).ok()?;
    let store = Store::new(&account);
    let _account_lock = store.lock_for(Duration::ZERO).ok()?;
    let _local_lock = lock(io, Duration::ZERO)?;
    if !wanted(io) {
        return None;
    }
    let (_, marker) = marker(io)?;
    let login = store.state()?.login;
    let mut local = read(io)?;
    let epoch = local["epoch"].as_u64().unwrap_or(0);
    let device = local["deviceKey"]
        .as_str()
        .filter(|s| {
            s.len() == 64
                && s.bytes()
                    .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        })
        .map(str::to_string)
        .unwrap_or_else(|| {
            format!(
                "{:x}",
                Sha256::digest(crate::oauth::random_b64(32).as_bytes())
            )
        });
    local["deviceKey"] = device.clone().into();
    if !local["attempts"].is_object() {
        local["attempts"] = json!({});
    }
    local["attempts"][format!("{:x}", Sha256::digest(marker.as_bytes()))] = now().into();
    save(io, &local).ok()?;
    Some(Attempt {
        account,
        marker,
        login,
        epoch,
        device,
    })
}

impl Attempt {
    fn enabled(&self, io: &Io) -> bool {
        read(io)
            .is_some_and(|l| l["sync"] != false && l["epoch"].as_u64().unwrap_or(0) == self.epoch)
            && !io.env.get("CI").is_some_and(|v| !v.is_empty())
            && impeccable_context::telemetry::opt_out_reason(&io.env, &io.cwd.to_string_lossy())
                .is_none()
    }

    pub fn report(self, io: &Io, inventory: &Value, cli: &str, skills: &Value) {
        if !self.enabled(io) {
            return;
        }
        let Some(body) = payload(inventory, cli, skills, &self.device) else {
            return;
        };
        let store = Store::new(&self.account);
        let Ok(account_lock) = store.lock_for(Duration::ZERO) else {
            return;
        };
        // Bind credentials, scope and the daily key under the same lifecycle
        // lock. A replacement sign-in must never lend its token to this claim.
        let Some(mut session) = Session::load_for_upload_locked(&self.account) else {
            return;
        };
        if session.state.login != self.login || marker(io).is_none_or(|(_, m)| m != self.marker) {
            return;
        }
        let Ok(token) = session.access_token_locked(&account_lock) else {
            return;
        };
        // Keep the approved token immutable, but release the lifecycle lock
        // before network I/O so the triggering command's account work cannot
        // wait behind this best-effort upload. A new sign-in cannot lend us
        // its credentials; the service rechecks this token's original grant.
        drop(account_lock);
        // Controls can save immediately even during a token refresh or POST.
        if !self.enabled(io) || marker(io).is_none_or(|(_, m)| m != self.marker) {
            return;
        }
        let _ = Client::with_deadline(&self.account, Duration::from_secs(5)).post_json(
            &format!("{}/cli/v1/setup/reports", self.account.issuer),
            &token,
            body,
        );
    }
}

pub fn report(io: &Io, inventory: &Value, cli: &str, skills: &Value) {
    if let Some(attempt) = begin(io) {
        attempt.report(io, inventory, cli, skills);
    }
}

pub fn run(args: &[String], io: &mut Io) -> i32 {
    let verb = args.first().map(String::as_str).unwrap_or("status");
    if args.len() > 1 || !["status", "on", "off", "forget"].contains(&verb) {
        io.err("Usage: impeccable setup status|on|off|forget\n");
        return 1;
    }
    if verb == "status" {
        io.out(if read(io).is_some_and(|v| v["sync"] != false) {
            "Setup status: on. This machine reports where Impeccable is installed, once a day.\n"
        } else {
            "Setup status: off.\n"
        });
        return 0;
    }
    let Some(local_lock) = lock(io, Duration::from_secs(5)) else {
        io.err("Setup status: couldn't save the setting.\n");
        return 1;
    };
    let mut local = read(io).unwrap_or(json!({}));
    local["sync"] = (verb == "on").into();
    local["epoch"] = local["epoch"].as_u64().unwrap_or(0).wrapping_add(1).into();
    if save(io, &local).is_err() {
        io.err("Setup status: couldn't save the setting.\n");
        return 1;
    }
    drop(local_lock);
    if verb != "forget" {
        io.out(if verb == "on" {
            "Setup status: on. This machine reports where Impeccable is installed, once a day.\n"
        } else {
            "Setup status: off.\n"
        });
        return 0;
    }
    let result = Account::from_env(&io.env).ok().and_then(|a| {
        let url = format!("{}/cli/v1/setup/forget", a.issuer);
        let store = Store::new(&a);
        let account_lock = store.lock().ok()?;
        Session::load(&a)
            .ok()?
            .call_locked(&account_lock, |c, t| c.post_json(&url, t, json!({})))
            .ok()
    });
    if result.is_some() {
        io.out("Setup status: off, and what this machine reported was deleted.\n");
        0
    } else {
        io.err("Setup status is off, but deleting what this machine reported couldn't be confirmed. Run impeccable setup forget again.\n");
        1
    }
}
