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
fn lock(io: &Io) -> Option<fs::File> {
    let p = path(io)?.with_extension("lock");
    fs::create_dir_all(p.parent()?).ok()?;
    let f = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(p)
        .ok()?;
    f.try_lock().ok()?;
    Some(f)
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

pub fn report(io: &Io, inventory: &Value, cli: &str, skills: &Value) {
    let Some(_lock) = lock(io) else {
        return;
    };
    if !wanted(io) {
        return;
    }
    let Some((account, marker)) = marker(io) else {
        return;
    };
    let Some(mut local) = read(io) else {
        return;
    };
    let device = local["deviceKey"]
        .as_str()
        .filter(|s| {
            s.len() == 64
                && s.bytes()
                    .all(|c| (c.is_ascii_digit() || (b'a'..=b'f').contains(&c)))
        })
        .map(str::to_string)
        .unwrap_or_else(|| {
            format!(
                "{:x}",
                Sha256::digest(crate::oauth::random_b64(32).as_bytes())
            )
        });
    let Some(body) = payload(inventory, cli, skills, &device) else {
        return;
    };
    local["deviceKey"] = device.into();
    if !local["attempts"].is_object() {
        local["attempts"] = json!({});
    }
    local["attempts"][format!("{:x}", Sha256::digest(marker.as_bytes()))] = now().into();
    if save(io, &local).is_err() {
        return;
    }
    let Ok(mut session) = Session::load(&account) else {
        return;
    };
    let Ok(token) = session.access_token_within(Duration::ZERO) else {
        return;
    };
    let _ = Client::with_deadline(&account, Duration::from_secs(5)).post_json(
        &format!("{}/cli/v1/setup/reports", account.issuer),
        &token,
        body,
    );
}

pub fn run(args: &[String], io: &mut Io) -> i32 {
    let verb = args.first().map(String::as_str).unwrap_or("status");
    if args.len() > 1 || !["status", "on", "off", "forget"].contains(&verb) {
        io.err("Usage: impeccable setup [status|on|off|forget]\n");
        return 1;
    }
    if verb == "status" {
        io.out(if read(io).is_some_and(|v| v["sync"] != false) {
            "Setup status: on.\n"
        } else {
            "Setup status: off.\n"
        });
        return 0;
    }
    let Some(_lock) = lock(io) else {
        io.err("Setup status: couldn't save the setting.\n");
        return 1;
    };
    let mut local = read(io).unwrap_or(json!({}));
    local["sync"] = (verb == "on").into();
    if save(io, &local).is_err() {
        io.err("Setup status: couldn't save the setting.\n");
        return 1;
    }
    if verb != "forget" {
        io.out(if verb == "on" {
            "Setup status: on.\n"
        } else {
            "Setup status: off.\n"
        });
        return 0;
    }
    let result = Account::from_env(&io.env).ok().and_then(|a| {
        let url = format!("{}/cli/v1/setup/forget", a.issuer);
        Session::load(&a)
            .ok()?
            .call(|c, t| c.post_json(&url, t, json!({})))
            .ok()
    });
    if result.is_some() {
        io.out("Setup status: deleted saved reports and turned sync off.\n");
        0
    } else {
        io.err("Setup status: sync is off; deleting saved reports couldn't be confirmed.\n");
        1
    }
}
