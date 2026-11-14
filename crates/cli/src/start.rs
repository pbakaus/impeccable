//! `impeccable start [--yes] [--json]`: set Impeccable up in one go, by running the
//! verbs that already do each part, in order: the skills, the sign-in, the MCP server
//! for each agent, the repository's first scan and, with `--yes` on a Mac, Loop.
//! Each step keeps its own rules; this only sequences them and reports.
//!
//! Exit codes: 0 set up; 1 a step failed; 2 no coding agent was found;
//! 3 the sign-in did not finish (declined, timed out or refused).
use impeccable_common::Io;
use serde_json::{json, Value};

const USAGE: &str = "Usage: impeccable start [--yes] [--json]

Set Impeccable up here: install the skills, sign in, give your coding agents the
Impeccable MCP server and scan this repository. Running it again redoes nothing.

Options:
  --yes    Also install Impeccable Loop (macOS)
  --json   Print one JSON result on stdout instead of each step's lines
";

pub(crate) fn run(
    args: &[String],
    io: &mut Io,
    engines: &impeccable_detect::Engines,
    rule_pack: Option<&'static dyn impeccable_core::rule_pack::RulePack>,
) -> i32 {
    if args.iter().any(|a| a == "--help" || a == "-h") {
        io.out(USAGE);
        return 0;
    }
    if let Some(bad) = args.iter().find(|a| !matches!(a.as_str(), "--yes" | "-y" | "--json")) {
        io.err(&format!("Unknown option for start: {bad}\n{USAGE}"));
        return 1;
    }
    let yes = args.iter().any(|a| a == "--yes" || a == "-y");
    let json = args.iter().any(|a| a == "--json");
    let mut steps: Vec<Value> = Vec::new();
    let mut failed = false;
    let record = |steps: &mut Vec<Value>, step: &str, result: &str| {
        steps.push(json!({ "step": step, "result": result }));
    };

    // 1. Skills (idempotent: "up to date" on a second run).
    let code = quiet(io, json, |io| impeccable_skills::run(&["install".into(), "-y".into()], io));
    record(&mut steps, "skills", if code == 0 { "done" } else { "failed" });
    failed |= code != 0;

    // 2. Sign in. Its link and its outcome always reach the terminal; under --json on
    // stderr, so stdout carries only the result.
    use impeccable_account::LoginOutcome;
    let held = json.then(|| std::mem::replace(&mut io.stdout, Box::new(std::io::stderr())));
    let signed = impeccable_account::login_for_start(io);
    if let Some(out) = held {
        io.stdout = out;
    }
    record(&mut steps, "sign_in", match signed {
        LoginOutcome::Already => "already",
        LoginOutcome::SignedIn => "done",
        LoginOutcome::Failed => "failed",
    });
    if signed == LoginOutcome::Failed {
        return finish(io, json, &steps, 3);
    }

    // 3. The MCP server for each agent; an entry already there is kept.
    let (mcp, rows, _) = crate::loop_connect::connect_mcp(io, None);
    let found = rows["agents"].as_array().is_some_and(|a| a.iter().any(|r| r["result"] != "not_found"));
    match &mcp {
        Ok(text) if !json => io.err(text),
        Err(e) if !json => io.err(&format!("{e}\n")),
        _ => {}
    }
    record(&mut steps, "mcp", if !found { "no_agents" } else if mcp.is_ok() { "done" } else { "failed" });
    failed |= found && mcp.is_err();

    // 4. The repository's first scan (once per repository; says nothing when not wanted).
    quiet(io, json, |io| {
        crate::router::scan_after_login(io, engines, rule_pack);
        0
    });
    record(&mut steps, "scan", "done");

    // 5. Loop, on a Mac and only when asked: it installs an app.
    if cfg!(target_os = "macos") && yes {
        let code = quiet(io, json, |io| crate::loop_install::run(&["install".into()], io));
        record(&mut steps, "loop", if code == 0 { "done" } else { "failed" });
        failed |= code != 0;
    } else {
        record(&mut steps, "loop", "skipped");
        if cfg!(target_os = "macos") && !json {
            io.err("Impeccable Loop keeps your agents' questions in one place: impeccable loop install\n");
        }
    }

    let code = if !found { 2 } else if failed { 1 } else { 0 };
    finish(io, json, &steps, code)
}

/// Runs a step on this terminal, or with its lines held back under `--json`.
fn quiet(io: &mut Io, json: bool, step: impl FnOnce(&mut Io) -> i32) -> i32 {
    if !json {
        return step(io);
    }
    let (mut sub, _held) = Io::captured("", io.cwd.clone(), io.env.clone());
    step(&mut sub)
}

fn finish(io: &mut Io, json: bool, steps: &[Value], code: i32) -> i32 {
    if json {
        io.out(&format!("{}\n", json!({ "ok": code == 0, "exit": code, "steps": steps })));
    } else {
        match code {
            0 => io.err("Impeccable is set up. Next: ask your agent to /impeccable critique a page.\n"),
            2 => io.err("No coding agent found here. Install Claude Code or Codex, then run impeccable start again.\n"),
            3 => io.err("Not signed in, so setup stopped there. Run impeccable start again to finish.\n"),
            _ => io.err("Setup didn't finish: a step above failed. Run impeccable start again once it's fixed.\n"),
        }
    }
    code
}
