//! What a signed-in CLI sends to the account service, one switch per kind (REN-2530). Every switch is off until the
//! person turns it on in their own terminal, after reading what that kind sends. Nothing uploads before that: each
//! upload checks its switch where it builds its request, detached jobs included. A telemetry opt-out (`DO_NOT_TRACK`,
//! `IMPECCABLE_NO_TELEMETRY`, `telemetry: false`) beats an on switch.
//!
//! The switches live per account service (`<account dir>/uploads.json`, 0600), so a yes on staging is no yes on
//! production. Signing out clears them: the next sign-in, perhaps someone else's, chooses again. `--quiet`, `--json`
//! and an agent's tool output never turn a switch on.
use crate::config::Account;
use impeccable_common::Io;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

/// One kind of upload.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Scan,
    Health,
    Design,
    Critiques,
    Screenshots,
    Prototypes,
    Setup,
}

impl Kind {
    pub const ALL: [Kind; 7] =
        [Kind::Scan, Kind::Health, Kind::Design, Kind::Critiques, Kind::Screenshots, Kind::Prototypes, Kind::Setup];

    pub fn id(self) -> &'static str {
        match self {
            Kind::Scan => "scan",
            Kind::Health => "health",
            Kind::Design => "design",
            Kind::Critiques => "critiques",
            Kind::Screenshots => "screenshots",
            Kind::Prototypes => "prototypes",
            Kind::Setup => "setup",
        }
    }

    pub fn from_id(id: &str) -> Option<Kind> {
        Kind::ALL.into_iter().find(|k| k.id() == id)
    }

    /// What goes and when, as the requests build it (health.rs, design.rs, critiques.rs, critique_frames.rs,
    /// prototypes.rs, setup.rs). A change to a request's fields changes this text in the same commit.
    pub fn sends(self) -> &'static str {
        match self {
            Kind::Scan => "When you sign in, one scan of the repository you're in: its name and parent folder (from its git remote), a key for it, finding counts per rule, a fingerprint of each finding (a hash of its rule, file path and snippet), and the foundations checks.",
            Kind::Health => "After each full scan (impeccable detect, and the scan after a saved critique): the repository's name, parent folder and key, finding counts per rule, a fingerprint of each finding, and the foundations checks.",
            Kind::Design => "Your DESIGN.md and its sidecar, in full, with the repository's name, parent folder and key, each time it changes.",
            Kind::Critiques => "Each critique or audit you save, in full: its title, target, scores, findings and report text, with the repository's name, parent folder and key, the branch, the commit and the pull request number.",
            Kind::Screenshots => "After a saved critique of a web page: a desktop and a phone screenshot of that page, localhost included, taken by a browser on this machine.",
            Kind::Prototypes => "Each prototype you accept: its target path, how many variants it had, when, and the repository's key.",
            Kind::Setup => "Once a day: this device's id, its OS, the CLI, engine and skill versions, and which agents have Impeccable's hooks, MCP servers and instructions.",
        }
    }
}

fn path(account: &Account) -> PathBuf {
    account.dir().join("uploads.json")
}

/// The kinds switched on for this account service. Missing or unreadable: none.
pub fn on(account: &Account) -> Vec<Kind> {
    let Ok(Some(bytes)) = crate::store::read_private(&path(account)) else { return Vec::new() };
    let Ok(v) = serde_json::from_slice::<Value>(&bytes) else { return Vec::new() };
    v["on"].as_array().into_iter().flatten().filter_map(|x| x.as_str().and_then(Kind::from_id)).collect()
}

fn save(account: &Account, kinds: &[Kind]) -> Result<(), String> {
    crate::store::private_dir(&account.dir())?;
    let ids: Vec<&str> = Kind::ALL.into_iter().filter(|k| kinds.contains(k)).map(Kind::id).collect();
    crate::store::write_private(&path(account), json!({ "on": ids }).to_string().as_bytes())
}

/// What an older per-feature `on` or `status` adds while `kind`'s own switch is still off: nothing goes until then.
pub fn still_off(io: &Io, kind: Kind) -> Option<String> {
    let account = Account::from_env(&io.env).ok()?;
    // Someone signed out sends nothing and reads nothing new.
    let signed_in = crate::store::Store::new(&account).state().is_some_and(|s| s.signed_in);
    (signed_in && !on(&account).contains(&kind)).then(|| format!("Nothing is sent until you turn it on in your own terminal: impeccable uploads on {}\n", kind.id()))
}

/// Switch `kinds` on with no question asked: only for tests, which stand in for a person who said yes. No command
/// reaches it.
#[doc(hidden)]
pub fn seed(account: &Account, kinds: &[Kind]) {
    let mut now = on(account);
    now.extend(kinds.iter().filter(|k| !now.contains(k)).copied().collect::<Vec<_>>());
    save(account, &now).expect("uploads.json");
}

/// Every switch off: a sign-out's, so the next sign-in chooses again.
pub fn clear(account: &Account) {
    let _ = std::fs::remove_file(path(account));
}

/// Whether `kind` may upload from `io.cwd` (and `root`, when the upload is about another folder): its switch is on
/// for this account service and no telemetry opt-out applies there.
pub fn allowed(io: &Io, kind: Kind, root: Option<&Path>) -> bool {
    let Ok(account) = Account::from_env(&io.env) else { return false };
    if !on(&account).contains(&kind) {
        return false;
    }
    let opted_out = |dir: &Path| impeccable_context::telemetry::opt_out_reason(&io.env, &dir.to_string_lossy()).is_some();
    !opted_out(&io.cwd) && !root.is_some_and(opted_out)
}

/// The line a signed-in person reads, at most once a day per kind, when `kind` didn't go because its switch is off.
/// Nothing for someone signed out, and nothing under `--quiet` or `--json` (`quiet`).
pub fn skipped(io: &mut Io, kind: Kind, quiet: bool) {
    if quiet || io.env.get("CI").is_some_and(|v| !v.is_empty()) {
        return;
    }
    let Ok(account) = Account::from_env(&io.env) else { return };
    if on(&account).contains(&kind) || !crate::store::Store::new(&account).state().is_some_and(|s| s.signed_in) {
        return;
    }
    let today = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() / 86_400).unwrap_or(0);
    let marker = |day: u64| account.dir().join(format!("uploads-{}-off-{day}", kind.id()));
    let _ = crate::store::private_dir(&account.dir());
    // Creating today's marker is the claim, so parallel commands print the line once.
    if let Err(e) = std::fs::OpenOptions::new().write(true).create_new(true).open(marker(today)) {
        if e.kind() == std::io::ErrorKind::AlreadyExists {
            return;
        }
    }
    let _ = std::fs::remove_file(marker(today.saturating_sub(1)));
    io.err(&format!("Not sent to Impeccable: {} is off. To choose what's sent: impeccable uploads\n", kind.id()));
}

/// The line `login` ends with.
pub const AFTER_LOGIN: &str = "Nothing is sent to Impeccable from this machine until you choose what: impeccable uploads\n";

/// Whether this is a person at their own terminal: stdin and stderr are terminals, and not CI.
pub fn at_terminal(io: &Io) -> bool {
    io.stdin_is_tty && std::io::IsTerminal::is_terminal(&std::io::stderr()) && !io.env.get("CI").is_some_and(|v| !v.is_empty())
}

/// A yes/no question on stderr; only y or yes is yes.
fn ask(io: &mut Io, question: &str) -> bool {
    use std::io::Write;
    io.err(&format!("{question} [y/N] "));
    let _ = io.stderr.flush();
    let mut line = String::new();
    std::io::stdin().read_line(&mut line).is_ok_and(|n| n > 0 && matches!(line.trim().to_ascii_lowercase().as_str(), "y" | "yes"))
}

/// `impeccable uploads [on|off <kind>|all] [--json]`.
pub fn run(args: &[String], io: &mut Io) -> i32 {
    let terminal = at_terminal(io);
    run_with(args, io, terminal, &mut ask)
}

/// [`run`] with the terminal check and the question handed in (tests).
pub fn run_with(args: &[String], io: &mut Io, terminal: bool, ask: &mut dyn FnMut(&mut Io, &str) -> bool) -> i32 {
    let json_out = args.iter().any(|a| a == "--json");
    let words: Vec<&str> = args.iter().map(String::as_str).filter(|a| *a != "--json").collect();
    if words.iter().any(|a| *a == "--help" || *a == "-h") {
        io.out("impeccable uploads: what this machine sends to Impeccable while you're signed in. Every kind is off until you turn it on.\n  impeccable uploads              list each kind, what it sends, and whether it's on\n  impeccable uploads on <kind>    turn one on (or all), after reading what it sends; in your own terminal\n  impeccable uploads off <kind>   turn one off (or all)\n");
        return 0;
    }
    let account = match Account::from_env(&io.env) {
        Ok(a) => a,
        Err(e) => {
            io.err(&format!("impeccable uploads: {e}\n"));
            return 2;
        }
    };
    let pick = |word: Option<&&str>| -> Option<Vec<Kind>> {
        match word.copied() {
            Some("all") => Some(Kind::ALL.to_vec()),
            Some(id) => Kind::from_id(id).map(|k| vec![k]),
            None => None,
        }
    };
    match words.as_slice() {
        [] => {
            let now = on(&account);
            if json_out {
                let state: serde_json::Map<String, Value> = Kind::ALL.into_iter().map(|k| (k.id().to_string(), json!(now.contains(&k)))).collect();
                io.out(&format!("{}\n", json!({ "uploads": state })));
            } else {
                for k in Kind::ALL {
                    io.out(&format!("{:<12} {}\n             {}\n", k.id(), if now.contains(&k) { "on" } else { "off" }, k.sends()));
                }
                io.out("Turn one on: impeccable uploads on <kind>\n");
            }
            0
        }
        ["off", rest @ ..] if rest.len() == 1 => {
            let Some(kinds) = pick(rest.first()) else { return unknown(io, rest[0]) };
            let left: Vec<Kind> = on(&account).into_iter().filter(|k| !kinds.contains(k)).collect();
            if let Err(e) = save(&account, &left) {
                io.err(&format!("impeccable uploads: {e}\n"));
                return 1;
            }
            if !json_out {
                io.out(&format!("Off: {}. Nothing of it is sent from this machine.\n", names(&kinds)));
            }
            0
        }
        ["on", rest @ ..] if rest.len() == 1 => {
            let Some(kinds) = pick(rest.first()) else { return unknown(io, rest[0]) };
            // Only a person reading this in their own terminal turns a switch on: never an agent, a script or CI.
            if !terminal || json_out {
                io.err("Turning uploads on needs you: run impeccable uploads on <kind> in your own terminal.\n");
                return 2;
            }
            for k in &kinds {
                io.err(&format!("{}: {}\n", k.id(), k.sends()));
            }
            if !ask(io, &format!("Send {} to Impeccable from this machine?", names(&kinds))) {
                io.err("Nothing changed.\n");
                return 1;
            }
            let mut now = on(&account);
            now.extend(kinds.iter().filter(|k| !now.contains(k)).copied().collect::<Vec<_>>());
            if let Err(e) = save(&account, &now) {
                io.err(&format!("impeccable uploads: {e}\n"));
                return 1;
            }
            io.err(&format!("On: {}. To stop: impeccable uploads off <kind>\n", names(&kinds)));
            0
        }
        _ => {
            io.err("Usage: impeccable uploads [on|off <kind>|all] [--json]\n");
            2
        }
    }
}

fn names(kinds: &[Kind]) -> String {
    kinds.iter().map(|k| k.id()).collect::<Vec<_>>().join(", ")
}

fn unknown(io: &mut Io, word: &str) -> i32 {
    let ids: Vec<&str> = Kind::ALL.into_iter().map(Kind::id).collect();
    io.err(&format!("No upload kind {word:?}. Kinds: {}, or all.\n", ids.join(", ")));
    2
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn home() -> (PathBuf, HashMap<String, String>) {
        let dir = std::env::temp_dir().join(format!("impeccable-uploads-{}-{}", std::process::id(), rand_suffix()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut env = HashMap::new();
        env.insert("HOME".to_string(), dir.display().to_string());
        env.insert("IMPECCABLE_HOME".to_string(), dir.join(".impeccable").display().to_string());
        env.insert("IMPECCABLE_ACCOUNT_URL".to_string(), "https://api.staging.impeccable.style".to_string());
        (dir, env)
    }

    fn rand_suffix() -> u128 {
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    }

    fn args(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    // Catches a switch that starts on, an agent (no terminal) turning one on, and a no that still saves.
    #[test]
    fn every_kind_starts_off_and_only_a_yes_at_a_terminal_turns_one_on() {
        let (dir, env) = home();
        let (mut io, _) = Io::captured("", dir.clone(), env.clone());
        let account = Account::from_env(&env).unwrap();
        assert!(on(&account).is_empty());
        assert!(Kind::ALL.iter().all(|k| !allowed(&io, *k, None)));
        assert_eq!(run_with(&args(&["on", "critiques"]), &mut io, false, &mut |_, _| true), 2);
        assert_eq!(run_with(&args(&["on", "critiques", "--json"]), &mut io, true, &mut |_, _| true), 2);
        assert_eq!(run_with(&args(&["on", "critiques"]), &mut io, true, &mut |_, _| false), 1);
        assert!(on(&account).is_empty());
        let mut asked = String::new();
        assert_eq!(run_with(&args(&["on", "critiques"]), &mut io, true, &mut |_, q| { asked = q.to_string(); true }), 0);
        assert!(asked.contains("critiques"));
        assert_eq!(on(&account), vec![Kind::Critiques]);
        assert!(allowed(&io, Kind::Critiques, None) && !allowed(&io, Kind::Screenshots, None));
        // Off works anywhere, an agent included.
        assert_eq!(run_with(&args(&["off", "all"]), &mut io, false, &mut |_, _| unreachable!()), 0);
        assert!(on(&account).is_empty());
    }

    // Catches an on switch sending past DO_NOT_TRACK, here or at the folder the upload is about.
    #[test]
    fn a_telemetry_opt_out_beats_an_on_switch() {
        let (dir, mut env) = home();
        let account = Account::from_env(&env).unwrap();
        save(&account, &Kind::ALL).unwrap();
        let (io, _) = Io::captured("", dir.clone(), env.clone());
        assert!(allowed(&io, Kind::Scan, None));
        env.insert("DO_NOT_TRACK".to_string(), "1".to_string());
        let (io, _) = Io::captured("", dir.clone(), env.clone());
        assert!(Kind::ALL.iter().all(|k| !allowed(&io, *k, None)));
    }

    // Catches a yes on staging counting on production, and a sign-out keeping the last person's yes.
    #[test]
    fn switches_belong_to_one_account_service_and_a_sign_out_clears_them() {
        let (dir, env) = home();
        let staging = Account::from_env(&env).unwrap();
        save(&staging, &[Kind::Health]).unwrap();
        let mut prod_env = env.clone();
        prod_env.remove("IMPECCABLE_ACCOUNT_URL");
        let production = Account::from_env(&prod_env).unwrap();
        assert!(on(&production).is_empty());
        let (io, _) = Io::captured("", dir.clone(), prod_env);
        assert!(!allowed(&io, Kind::Health, None));
        clear(&staging);
        assert!(on(&staging).is_empty());
    }

    // Catches a listing or JSON state that disagrees with the store.
    #[test]
    fn the_listing_names_every_kind_and_what_it_sends() {
        let (dir, env) = home();
        save(&Account::from_env(&env).unwrap(), &[Kind::Design]).unwrap();
        let (mut io, cap) = Io::captured("", dir.clone(), env.clone());
        assert_eq!(run_with(&[], &mut io, false, &mut |_, _| false), 0);
        let said = String::from_utf8(cap.stdout.borrow().clone()).unwrap();
        for k in Kind::ALL {
            assert!(said.contains(k.sends()), "{said}");
        }
        assert!(said.contains("design       on"), "{said}");
        let (mut io, cap) = Io::captured("", dir, env);
        assert_eq!(run_with(&args(&["--json"]), &mut io, false, &mut |_, _| false), 0);
        let v: Value = serde_json::from_slice(&cap.stdout.borrow()).unwrap();
        assert_eq!(v["uploads"]["design"], true);
        assert_eq!(v["uploads"]["critiques"], false);
    }
}
