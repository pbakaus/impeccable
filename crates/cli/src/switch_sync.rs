//! The switch sync (REN-2056): personal switches set on the repo settings page reach
//! this machine's user-level rule files, and a switch changed here (`loop connect`)
//! reaches the page. It runs detached from `context`, never on its path, at most once
//! a minute. Three-way: the set last synced is the base; a set the page changed wins
//! and is written, else a set changed in a file is sent; a person the page has no set
//! for is seeded from the files.
use crate::agent_block;
use impeccable_account::config::Account;
use impeccable_common::Io;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

const VERB: &str = "switches-refresh";
const EVERY_SECS: u64 = 60;

fn cache_path(account: &Account) -> PathBuf {
    account.home.join("switches.json")
}

fn read_cache(account: &Account) -> Option<Value> {
    let v: Value = serde_json::from_slice(&std::fs::read(cache_path(account)).ok()?).ok()?;
    (v["issuer"] == account.issuer).then_some(v)
}

/// File-only gate for `context`: signed in, not CI, not switched off, not fetched in
/// the last minute.
pub fn schedule(io: &Io) {
    let off = |k: &str| io.env.get(k).is_some_and(|v| !v.is_empty());
    if off("CI") || off("IMPECCABLE_NO_SWITCH_SYNC") || !impeccable_account::sign_in_recorded(io) {
        return;
    }
    let Ok(account) = Account::from_env(&io.env) else { return };
    let now = impeccable_account::session::now();
    let fresh = read_cache(&account)
        .and_then(|v| v["fetchedAt"].as_u64())
        .is_some_and(|t| t <= now && now - t < EVERY_SECS);
    if !fresh {
        crate::setup_report::spawn_refresh(io, VERB);
    }
}

/// Every agent's user-level rule file on this machine (`agent_block::user_rule_files`).
pub(crate) fn rule_files(io: &Io) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = agent_block::user_rule_files(io).into_iter().map(|(_, file)| file).collect();
    files.extend(agent_block::cursor_personal_file(io));
    files
}

/// What the worker does, decided from the page's set, the base and each file's set.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Step {
    /// The page has no set yet: send the files' (when any is on).
    Seed(Vec<String>),
    /// The page changed: write its set into every file.
    Write(Vec<String>),
    /// A file changed: send its set.
    Push(Vec<String>),
    Nothing,
}

fn sorted(mut v: Vec<String>) -> Vec<String> {
    v.sort();
    v.dedup();
    v
}

/// `files` holds each file's set, or `None` for a file with no block yet (an agent
/// installed since the last sync, or a block never written): such a file is never read
/// as an edit, only brought up to the page's set.
pub(crate) fn decide(page: Option<&[String]>, base: Option<&[String]>, files: &[Option<Vec<String>>]) -> Step {
    let base = base.map(|b| sorted(b.to_vec()));
    let written: Vec<Vec<String>> = files.iter().flatten().map(|f| sorted(f.clone())).collect();
    let Some(page) = page.map(|p| sorted(p.to_vec())) else {
        let union = sorted(written.into_iter().flatten().collect());
        return if union.is_empty() { Step::Nothing } else { Step::Seed(union) };
    };
    let behind = !page.is_empty() && files.iter().any(Option::is_none);
    if base.as_ref() != Some(&page) {
        return if written.iter().all(|f| *f == page) && !behind { Step::Nothing } else { Step::Write(page) };
    }
    match written.into_iter().find(|f| *f != page) {
        Some(changed) => Step::Push(changed),
        None if behind => Step::Write(page),
        None => Step::Nothing,
    }
}


/// One worker at a time: a lock file in the Impeccable home, stale after two minutes.
/// `None` when another worker holds it.
fn worker_lock(account: &Account) -> Option<impl Drop> {
    struct Held(PathBuf);
    impl Drop for Held {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }
    let path = account.home.join("switches.lock");
    let _ = std::fs::create_dir_all(&account.home);
    for _ in 0..2 {
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(_) => return Some(Held(path)),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                let stale = std::fs::metadata(&path)
                    .and_then(|m| m.modified())
                    .is_ok_and(|t| t.elapsed().unwrap_or_default() > std::time::Duration::from_secs(120));
                if !stale {
                    return None;
                }
                let _ = std::fs::remove_file(&path);
            }
            Err(_) => return None,
        }
    }
    None
}

/// Hidden detached worker: silent and best effort. Anything it can't read or check
/// leaves the files, the page and the base as they were.
/// The sync itself. `context` throttles it to once a minute (`schedule`); started
/// directly it always runs. `--now` is how Loop starts it on a change notice (REN-2056):
/// accepted, and the same as no flag.
pub fn run_refresh(args: &[String], io: &mut Io) -> i32 {
    if args.iter().any(|a| a == "--help" || a == "-h") {
        io.out("Usage: impeccable switches-refresh [--now]\n");
        return 0;
    }
    if args.iter().any(|a| a != "--now") {
        io.err("Usage: impeccable switches-refresh [--now]\n");
        return 2;
    }
    // One line says what happened, for Loop's log: `synced`, `unchanged`, or `skipped: <why>`.
    let said = refresh(args, io);
    io.out(&format!("{said}\n"));
    0
}

fn refresh(args: &[String], io: &mut Io) -> &'static str {
    let Ok(account) = Account::from_env(&io.env) else { return "skipped: no account" };
    // A change notice (`--now`) must not be lost to a refresh already under way, which may
    // have fetched before the change: it waits its turn (up to 15 s), then fetches again.
    let now = args.iter().any(|a| a == "--now");
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
    let _worker = loop {
        match worker_lock(&account) {
            Some(held) => break held,
            None if now && std::time::Instant::now() < deadline => std::thread::sleep(std::time::Duration::from_millis(200)),
            None => return "skipped: another refresh is running",
        }
    };
    // User-level files hold only the person's own set: read with no repository, the team
    // set is all on, so `me` is their own choices. A team's switches reach agents through
    // the repository's own AGENTS.md block instead (REN-2056), so refreshes from different
    // repositories never rewrite these files back and forth.
    let Some(mut link) = impeccable_account::switches::Link::open(io) else { return "skipped: not signed in" };
    let Some(remote) = link.fetch() else { return "skipped: Impeccable didn't answer" };
    let cache = read_cache(&account);
    let base: Option<Vec<String>> = cache
        .as_ref()
        .and_then(|c| c["base"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect()));
    let files = rule_files(io);
    // The files a sync has seen with a block before: in one of them, no block now means
    // every switch was turned off (loop disconnect, or by hand), not an agent new here.
    let known: Vec<String> = cache
        .as_ref()
        .and_then(|c| c["files"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect()))
        .unwrap_or_default();
    let mut sets = Vec::new();
    for f in &files {
        // Only a missing file reads as no switches; one that can't be read stops here.
        // Cursor's rule is per repository while the set is per person, so an old copy in a
        // repository last visited long ago must never read as an edit: it is only ever
        // brought up to the page.
        if f.ends_with(".cursor/rules/impeccable.mdc") {
            sets.push(None);
            continue;
        }
        match agent_block::block_in(f) {
            Ok(Some(ids)) => sets.push(Some(ids.into_iter().map(str::to_string).collect::<Vec<_>>())),
            Ok(None) if known.contains(&f.display().to_string()) => sets.push(Some(vec![])),
            Ok(None) => sets.push(None),
            Err(_) => return "skipped: a rule file can't be read",
        }
    }
    let catalog: Vec<&str> = agent_block::CATALOG.iter().map(|(id, _, _)| *id).collect();
    // Every file gets the set the page now holds, so two files never disagree and push
    // the page back and forth.
    let write_all = |on: &[String], link: &impeccable_account::switches::Link| -> bool {
        if !link.still_current() {
            return false;
        }
        let refs: Vec<&str> = on.iter().map(String::as_str).filter(|id| catalog.contains(id)).collect();
        // Cursor's rule is projected on its own below: a repository that can't take it
        // never holds back the shared base.
        files
            .iter()
            .filter(|f| !f.ends_with(".cursor/rules/impeccable.mdc"))
            .all(|f| agent_block::write_switches(f, &refs).is_ok())
    };
    // What this refresh sent and the service took, if anything: Cursor's rule follows it.
    let mut pushed: Option<Vec<String>> = None;
    // The page's set for this person (the service already falls back to the team's,
    // switch by switch). Until they've set their own, a block this machine already holds
    // (from `loop connect` or `install`) is sent as their first set instead of overwritten.
    let holds_block = sets.iter().any(|s| s.as_ref().is_some_and(|v| !v.is_empty()));
    // Only a block no sync has written yet (no base saved) is migrated; one this sync wrote
    // from the team's set keeps following the page.
    let migrate = !remote.me_set && holds_block && base.is_none();
    let page: Option<Vec<String>> = if migrate { None } else { remote.me.clone() };
    let mut said = "unchanged";
    let synced: Option<Vec<String>> = match decide(page.as_deref(), base.as_deref(), &sets) {
        Step::Seed(on) | Step::Push(on) => {
            let first = !remote.me_set;
            let refs: Vec<&str> = on.iter().map(String::as_str).collect();
            let sent = link.push(&catalog, &refs, first);
            if sent.is_some() {
                pushed = Some(on.clone());
                said = "synced";
            }
            match sent {
                Some(_) if write_all(&on, &link) => Some(on),
                Some(_) => {
                    said = "skipped: a rule file couldn't be written";
                    Some(on)
                }
                // Not sent: the base stays, so the next refresh still sees the change.
                None => {
                    said = "skipped: Impeccable didn't take the change";
                    base.clone()
                }
            }
        }
        Step::Write(on) => {
            if write_all(&on, &link) {
                said = "synced";
                Some(on)
            } else {
                said = "skipped: a rule file couldn't be written";
                base.clone()
            }
        }
        Step::Nothing => page.clone().or(base.clone()),
    };
    // Cursor's rule in this repository ends at the set this refresh settled on (what it
    // just sent, or the page's), whatever the step; a repository that can't take it is
    // skipped without touching the shared state.
    // The retry base is never Cursor's target: a set just sent, else the page's.
    let settled = pushed.or_else(|| page.clone());
    if let (Some(set), Some(cursor)) = (settled, agent_block::cursor_personal_file(io)) {
        if link.still_current() {
            let refs: Vec<&str> = set.iter().map(String::as_str).filter(|id| catalog.contains(id)).collect();
            let _ = agent_block::write_cursor(&cursor, &refs);
        }
    }
    let mut next = json!({ "issuer": account.issuer, "fetchedAt": impeccable_account::session::now() });
    if let Some(set) = synced {
        next["base"] = json!(sorted(set));
    }
    // Remember every file that holds a block now, and keep the ones known before while
    // their agent's folder still exists (another CLAUDE_CONFIG_DIR profile included): an
    // agent removed and installed again later starts fresh, with the saved set.
    // opencode is reached only through a file the person made, so its path goes with
    // the file; every other agent's goes with its folder.
    let mut seen: Vec<String> = known
        .into_iter()
        .filter(|k| {
            let path = Path::new(k);
            if path.parent().is_some_and(|p| p.ends_with("opencode")) {
                path.is_file()
            } else {
                path.parent().is_some_and(Path::is_dir)
            }
        })
        .collect();
    for f in &files {
        let key = f.display().to_string();
        if !seen.contains(&key) && agent_block::block_in(f).is_ok_and(|b| b.is_some()) {
            seen.push(key);
        }
    }
    next["files"] = json!(seen);
    let _ = impeccable_account::store::write_private(&cache_path(&account), next.to_string().as_bytes());
    said
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(ids: &[&str]) -> Vec<String> {
        ids.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn the_page_wins_a_file_change_is_sent_and_an_unset_page_is_seeded() {
        // Catches (REN-2056): a sync that wipes a machine's Loop and taste lines the first
        // time it runs, or undoes the page's change with a stale file, or the reverse.
        assert_eq!(decide(None, None, &[Some(v(&["taste", "loop"])), None]), Step::Seed(v(&["loop", "taste"])));
        assert_eq!(decide(None, None, &[None]), Step::Nothing);
        let base = v(&["loop"]);
        assert_eq!(decide(Some(&v(&["loop", "a11y"])), Some(&base), &[Some(v(&["loop"]))]), Step::Write(v(&["a11y", "loop"])));
        assert_eq!(decide(Some(&base), Some(&base), &[Some(v(&["loop", "taste"]))]), Step::Push(v(&["loop", "taste"])));
        assert_eq!(decide(Some(&base), Some(&base), &[Some(v(&["loop"])), Some(v(&["loop"]))]), Step::Nothing);
        // A first sync on a machine whose files already match the page writes nothing.
        assert_eq!(decide(Some(&base), None, &[Some(v(&["loop"]))]), Step::Nothing);
        // Both changed: the page wins.
        assert_eq!(decide(Some(&v(&["wide"])), Some(&base), &[Some(v(&["taste"]))]), Step::Write(v(&["wide"])));
        // A file with no block yet is brought up to the page, never sent.
        assert_eq!(decide(Some(&base), Some(&base), &[Some(v(&["loop"])), None]), Step::Write(v(&["loop"])));
        assert_eq!(decide(Some(&v(&[])), Some(&v(&[])), &[None]), Step::Nothing);
    }
}
