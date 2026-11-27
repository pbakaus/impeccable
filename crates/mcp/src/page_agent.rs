//! Which agent works on a local page (REN-2536): `impeccable agents running --json --url <page>`. The page's port leads
//! to the process listening on it, its working folder to a checkout, and the checkout to the agent sessions in it.
//! It never guesses: when the page has no checkout, or two sessions are equally likely, `agent` is null and the
//! caller asks the person.
use crate::presence::{self, Proc};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;
use std::process::{Command, Stdio};

/// The port of a page on this machine: http(s) on localhost, a loopback address or a `*.localhost` name. Anything
/// else is not a local app.
pub fn local_port(url: &str) -> Option<u16> {
    let (scheme, rest) = url.split_once("://")?;
    let authority = rest.split(['/', '?', '#']).next()?;
    let authority = authority.rsplit('@').next()?;
    let (host, port) = match authority.strip_prefix('[') {
        Some(v6) => {
            let (host, after) = v6.split_once(']')?;
            (host, after.strip_prefix(':'))
        }
        None => match authority.rsplit_once(':') {
            Some((h, p)) => (h, Some(p)),
            None => (authority, None),
        },
    };
    let host = host.to_ascii_lowercase();
    let loopback_v4 = host.parse::<std::net::Ipv4Addr>().is_ok_and(|ip| ip.is_loopback());
    let local = host == "localhost" || host.ends_with(".localhost") || host == "::1" || loopback_v4;
    let default = match scheme.to_ascii_lowercase().as_str() {
        "http" => 80,
        "https" => 443,
        _ => return None,
    };
    if !local {
        return None;
    }
    port.map_or(Some(default), |p| p.parse().ok())
}

fn run_text(cmd: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(cmd)
        .args(args)
        .env("LC_ALL", "C")
        // The caller's own git settings would point `git -C` at their checkout, not the folder asked about.
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

/// `lsof -F` output: each `p<pid>` line, then the `n<name>` lines for it.
pub fn parse_lsof(text: &str) -> Vec<(u32, Option<String>)> {
    let mut out: Vec<(u32, Option<String>)> = Vec::new();
    for line in text.lines() {
        if let Some(pid) = line.strip_prefix('p').and_then(|p| p.parse().ok()) {
            out.push((pid, None));
        } else if let (Some(name), Some(last)) = (line.strip_prefix('n'), out.last_mut()) {
            last.1.get_or_insert_with(|| name.to_string());
        }
    }
    out
}

/// The process listening on a TCP port. Two processes on it (one on 127.0.0.1, another on ::1) are no answer: which
/// one the page reached can't be told here.
fn listener(port: u16) -> Option<u32> {
    let text = run_text(
        "lsof",
        &["-nP", &format!("-iTCP:{port}"), "-sTCP:LISTEN", "-Fp"],
    )?;
    one_pid(&parse_lsof(&text))
}

fn one_pid(found: &[(u32, Option<String>)]) -> Option<u32> {
    let first = found.first()?.0;
    found.iter().all(|(pid, _)| *pid == first).then_some(first)
}

/// Each process's working folder, in one `lsof` for all of them.
fn cwds(pids: &[u32]) -> HashMap<u32, String> {
    if pids.is_empty() {
        return HashMap::new();
    }
    let list = pids
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(",");
    run_text("lsof", &["-a", "-d", "cwd", "-p", &list, "-Fn"])
        .map(|t| {
            parse_lsof(&t)
                .into_iter()
                .filter_map(|(pid, n)| Some((pid, n?)))
                .collect()
        })
        .unwrap_or_default()
}

/// The top of the checkout a folder is in: a worktree, not the repository, so a session in another worktree of the
/// same repository is not taken for the one editing this page.
fn checkout(dir: &str) -> Option<String> {
    if !Path::new(dir).is_dir() {
        return None;
    }
    run_text("git", &["-C", dir, "rev-parse", "--show-toplevel"])
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
}

/// Whether `pid` descends from `ancestor`.
fn descends(procs: &HashMap<u32, Proc>, pid: u32, ancestor: u32) -> bool {
    let mut at = pid;
    for _ in 0..64 {
        if at == ancestor {
            return true;
        }
        match procs.get(&at) {
            Some(p) if p.ppid != at && p.ppid != 0 => at = p.ppid,
            _ => return false,
        }
    }
    false
}

/// The facts the choice is made from, gathered by the caller (`resolve`) or a test.
pub struct Page<'a> {
    pub port: u16,
    pub server: Option<u32>,
    pub checkout: Option<String>,
    pub procs: &'a HashMap<u32, Proc>,
    /// `agents running`'s list, each with the checkout its folder is in.
    pub agents: Vec<(Value, Option<String>)>,
}

/// The sessions working on the page (in its checkout, or the one whose harness the dev server runs under, marked
/// `startedServer`), and the one it belongs to: the session that started the server, else the only connected one, else
/// the only one.
pub fn choose(page: Page) -> Value {
    let mut here: Vec<Value> = Vec::new();
    for (mut agent, at) in page.agents {
        let harness = agent["parent"]["pid"].as_u64().unwrap_or(0) as u32;
        let started = page
            .server
            .is_some_and(|s| harness != 0 && descends(page.procs, s, harness));
        // A session that started the server (`bun run --cwd ../app dev`) works on it wherever its own folder is.
        if !started && (page.checkout.is_none() || at != page.checkout) {
            continue;
        }
        agent["startedServer"] = json!(started);
        here.push(agent);
    }
    let only = |f: &dyn Fn(&Value) -> bool| {
        let hits: Vec<&Value> = here.iter().filter(|a| f(a)).collect();
        (hits.len() == 1).then(|| hits[0]["key"].clone())
    };
    let agent = only(&|a| a["startedServer"] == true)
        .or_else(|| only(&|a| a["connected"] == true))
        .or_else(|| only(&|_| true))
        .unwrap_or(Value::Null);
    json!({
        "port": page.port,
        "server": page.server.map(|pid| json!({ "pid": pid, "checkout": page.checkout })),
        "agents": here,
        "agent": agent,
    })
}

/// Everything `choose` needs, read from this machine: one `ps`, one `lsof` for the port, one for the folders, and a
/// `git` per distinct folder.
pub fn resolve(url: &str, env: &HashMap<String, String>) -> Option<Value> {
    let port = local_port(url)?;
    let mut procs = HashMap::new();
    let listed = presence::agents(presence::dir(env).as_deref(), || {
        procs = presence::snapshot();
        procs.clone()
    });
    let server = listener(port);
    let unknown: Vec<u32> = server
        .into_iter()
        .chain(
            listed
                .iter()
                .filter(|a| a["cwd"].is_null())
                .filter_map(|a| a["pid"].as_u64().map(|p| p as u32)),
        )
        .collect();
    let found = cwds(&unknown);
    let mut tops: HashMap<String, Option<String>> = HashMap::new();
    let mut top_of = |dir: Option<&str>| {
        dir.and_then(|d| {
            tops.entry(d.to_string())
                .or_insert_with(|| checkout(d))
                .clone()
        })
    };
    let page_top = top_of(server.and_then(|s| found.get(&s)).map(String::as_str));
    let agents = listed
        .into_iter()
        .map(|a| {
            let dir = a["cwd"].as_str().map(str::to_string).or_else(|| {
                a["pid"]
                    .as_u64()
                    .and_then(|p| found.get(&(p as u32)).cloned())
            });
            let top = top_of(dir.as_deref());
            (a, top)
        })
        .collect();
    Some(choose(Page {
        port,
        server,
        checkout: page_top,
        procs: &procs,
        agents,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_only_local_pages() {
        assert_eq!(local_port("http://localhost:5173/pricing?x=1"), Some(5173));
        assert_eq!(local_port("http://127.0.0.1:3000"), Some(3000));
        assert_eq!(local_port("http://app.localhost/"), Some(80));
        assert_eq!(local_port("https://[::1]:8443/a"), Some(8443));
        assert_eq!(local_port("http://user@localhost:4000/"), Some(4000));
        // A remote host, or one that only starts with localhost, is not a local app.
        assert_eq!(local_port("https://example.com:5173/"), None);
        assert_eq!(local_port("http://localhost.example.com:5173/"), None);
        assert_eq!(local_port("file:///tmp/a.html"), None);
        assert_eq!(local_port("http://127.example.com:5173/"), None);
        assert_eq!(local_port("ftp://localhost:5173/"), None);
        assert_eq!(local_port("http://127.0.0.2:5173/"), Some(5173));
    }

    #[test]
    fn reads_lsof_fields() {
        assert_eq!(
            parse_lsof("p42\nfcwd\nn/w/app\np7\nn/w/other\n"),
            [(42, Some("/w/app".into())), (7, Some("/w/other".into()))]
        );
        // One server on both addresses is one; two servers sharing the port is no answer.
        assert_eq!(one_pid(&parse_lsof("p42\np42\n")), Some(42));
        assert_eq!(one_pid(&parse_lsof("p42\np7\n")), None);
    }

    // Catches the page handed to the wrong session: one in another checkout, one picked when two are equally likely,
    // or the session that started the dev server losing to a merely connected one.
    #[test]
    fn picks_the_session_that_started_the_server_and_never_guesses() {
        let procs = presence::parse_ps(
            "  100     1 Mon Nov 16 09:00:00 2026     claude --name web
  101   100 Mon Nov 16 09:00:01 2026     /bin/zsh -c bun run dev
  102   101 Mon Nov 16 09:00:02 2026     node vite
  200     1 Mon Nov 16 09:00:00 2026     codex
  300     1 Mon Nov 16 09:00:00 2026     claude
",
        );
        let agent = |key: &str, harness: u32, connected: bool| json!({ "key": key, "parent": { "pid": harness }, "connected": connected });
        let page = |server: Option<u32>, agents: Vec<(Value, Option<String>)>| {
            choose(Page {
                port: 5173,
                server,
                checkout: Some("/w/app".into()),
                procs: &procs,
                agents,
            })
        };
        let at = |dir: &str| Some(dir.to_string());

        // The session that started the server wins, even from another folder; one merely elsewhere is left out.
        let got = page(
            Some(102),
            vec![
                (agent("codex", 200, true), at("/w/app")),
                (agent("web", 100, false), at("/w/elsewhere")),
                (agent("far", 300, true), at("/w/other")),
            ],
        );
        assert_eq!(got["agent"], "web");
        assert_eq!(got["agents"].as_array().unwrap().len(), 2);

        // Nobody started it: the only connected session in the checkout.
        let got = page(
            Some(102),
            vec![
                (agent("codex", 200, true), at("/w/app")),
                (agent("seen", 300, false), at("/w/app")),
            ],
        );
        assert_eq!(got["agent"], "codex");

        // Two connected sessions, neither started it: ask.
        let got = page(
            Some(102),
            vec![
                (agent("a", 200, true), at("/w/app")),
                (agent("b", 300, true), at("/w/app")),
            ],
        );
        assert_eq!(got["agent"], Value::Null);

        // No checkout behind the page: only the session that started it, else nobody.
        let none = |agents| {
            choose(Page {
                port: 5173,
                server: Some(102),
                checkout: None,
                procs: &procs,
                agents,
            })
        };
        assert_eq!(
            none(vec![(agent("codex", 200, true), None)])["agent"],
            Value::Null
        );
        assert_eq!(
            none(vec![
                (agent("codex", 200, true), None),
                (agent("web", 100, true), None)
            ])["agent"],
            "web"
        );
    }
}
