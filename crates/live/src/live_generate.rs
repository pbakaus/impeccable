//! `impeccable live-generate`: agent-initiated element targeting for the
//! `generate` command.
//!
//! Asks the live overlay to find an element by CSS selector, scroll to it,
//! enter the picked state, and fire the normal Go pipeline with the given
//! action and count. On success the browser starts a standard generate
//! session and the verb collects that session's `generate` event into its
//! own output, so the agent's next move is the edit. With `--boot` it runs
//! the lane's boot itself first (reusing a running helper), and with
//! `--open` it opens the dev URL in the browser when no page is connected:
//! one command from a cold project to a leased generate event.

use crate::live_resume::self_cmd;
use crate::paths::read_live_server_info;
use crate::roots::enter_live_root;
use crate::util::println;
use crate::vocabulary::VISUAL_ACTIONS;
use impeccable_common::Io;
use serde_json::{json, Map, Value};
use std::time::{Duration, Instant};

const HELP: &str = "Usage: impeccable live-generate --selector <css> [--text <snippet>] [--index <n>] [--action <name>] [--count <n>] [--prompt <text>] [--dry-run] [--wait-for-browser <ms>] [--no-live-bar] [--boot] [--open] [--target <path>]

Flags:
  --boot             optional; run the generate lane's boot first (impeccable live
                     --allow-missing-context --dev-url --no-live-bar, with --target
                     when given), reusing a running helper; the boot's context and
                     devUrl ride along in the output as `boot`
  --open             optional; when no page with the overlay is connected, open the
                     dev URL in the browser (IMPECCABLE_BROWSER, then `browser` in
                     .impeccable/config.local.json or config.json, then BROWSER, then
                     the platform opener) and wait for it (60 s unless
                     --wait-for-browser says otherwise). On a harness with its own
                     browser (Cursor, Claude Code) the flag is ignored unless
                     IMPECCABLE_BROWSER or the config's `browser` names one: the
                     page comes from the harness browser, never a second window
  --target <path>    optional; the file that renders the element (the boot's --target)
  --dev-url <url>    optional; the dev server you already know (a server the
                     harness runs, a tab on the app, the user's message); probed
                     first, reported as devUrl either way
  --selector <css>   required; resolved with document.querySelectorAll
  --text <snippet>   optional; keeps only matches whose textContent contains it
  --index <n>        optional; 1-based pick among the remaining matches
  --action <name>    optional; one of the live action vocabulary (default: impeccable)
  --count <n>        optional; variants to request, 1-8 (default: 3)
  --prompt <text>    optional; freeform direction, same as typing before Go
  --dry-run          optional; resolve and report without starting anything
  --wait-for-browser <ms>  optional; poll the helper until a page with the
                     overlay connects (or the budget runs out) before sending
                     the target.

With no page connected and neither --open nor --wait-for-browser, the verdict
is browser_needed with devUrl and the harness's way to open it (Cursor
browser_navigate, Claude Code's Browser pane, Codex: --open or the user), so no
second browser is ever launched behind a harness that has one.

On success the output carries the session's generate event as `event` (already
leased, with its _instructions), so the next command is the edit, then
`live-poll --reply <id> done --file <path> --then-poll` for the accept.
";

/// Client-side cap just above the server's 15s hold, so a hung helper still
/// fails fast.
const REQUEST_TIMEOUT_MS: u64 = 20_000;

struct Flags {
    values: Map<String, Value>,
    dry_run: bool,
    no_live_bar: bool,
    boot: bool,
    open: bool,
}

fn parse_flags(argv: &[String]) -> Result<Flags, Value> {
    let mut values = Map::new();
    let mut dry_run = false;
    let mut no_live_bar = false;
    let mut boot = false;
    let mut open = false;
    let mut i = 0;
    while i < argv.len() {
        let arg = &argv[i];
        if !arg.starts_with("--") {
            i += 1;
            continue;
        }
        let key = &arg[2..];
        if key == "dry-run" {
            dry_run = true;
            i += 1;
            continue;
        }
        if key == "no-live-bar" {
            no_live_bar = true;
            i += 1;
            continue;
        }
        if key == "boot" {
            boot = true;
            i += 1;
            continue;
        }
        if key == "open" {
            open = true;
            i += 1;
            continue;
        }
        // The boot's own opt-in, tolerated here so a caller that spells the
        // lane's boot flags on this verb is not refused.
        if key == "allow-missing-context" {
            i += 1;
            continue;
        }
        // `--dev-url` alone is the boot's probe flag (tolerated); with a
        // value it is the dev server the caller already knows.
        if key == "dev-url" {
            match argv.get(i + 1) {
                Some(v) if !v.starts_with("--") => {
                    values.insert(key.to_string(), json!(v));
                    i += 2;
                }
                _ => i += 1,
            }
            continue;
        }
        match argv.get(i + 1) {
            Some(v) if !v.starts_with("--") => {
                values.insert(key.to_string(), json!(v));
                i += 2;
            }
            _ => {
                return Err(json!({ "ok": false, "error": "missing_flag_value", "flag": arg }));
            }
        }
    }
    Ok(Flags {
        values,
        dry_run,
        no_live_bar,
        boot,
        open,
    })
}

fn flag<'a>(flags: &'a Flags, key: &str) -> Option<&'a str> {
    flags.values.get(key).and_then(Value::as_str)
}

/// JS `Number(v)` then `Number.isInteger`: an integer literal only.
fn int_flag(v: &str) -> Option<i64> {
    let t = v.trim();
    if t.is_empty() {
        return None;
    }
    if let Ok(i) = t.parse::<i64>() {
        return Some(i);
    }
    t.parse::<f64>()
        .ok()
        .filter(|f| f.is_finite() && f.fract() == 0.0)
        .map(|f| f as i64)
}

fn print_json(io: &mut Io, v: &Value) {
    println(io, &serde_json::to_string_pretty(v).unwrap_or_default());
}

fn fail(io: &mut Io, v: Value) -> i32 {
    print_json(io, &v);
    1
}

/// The follow-up the agent runs after each verdict. Like the poll loop's
/// `_instructions`, regenerated locally from the verdict, never taken from
/// the wire.
fn instructions_for(result: &Map<String, Value>, self_cmd: &str) -> Option<String> {
    let s = |k: &str| result.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    let n = |k: &str| result.get(k).and_then(Value::as_i64).unwrap_or(0);
    if result.get("ok").and_then(Value::as_bool) == Some(true) {
        if result.get("dryRun").and_then(Value::as_bool) == Some(true) {
            let el = result.get("element").and_then(Value::as_object);
            let tag = el.and_then(|e| e.get("tag")).and_then(Value::as_str).unwrap_or("");
            let id = el
                .and_then(|e| e.get("id"))
                .and_then(Value::as_str)
                .filter(|i| !i.is_empty())
                .map(|i| format!("#{}", i))
                .unwrap_or_default();
            return Some(format!(
                "Dry run only: the selector resolves to one element ({}{}) and no session was started. Rerun without --dry-run to generate.",
                tag, id
            ));
        }
        let reply = format!("{} live-poll --reply {} done --file <project-root-relative path you wrote> --then-poll", self_cmd, s("sessionId"));
        if result.get("event").map(|e| e.is_object()).unwrap_or(false) {
            return Some(format!(
                "Session {} started: the browser scrolled to the target and fired Go (action \"{}\", count {}). Its generate event is in this output as `event`, already leased: follow event._instructions (identity from the event, ONE edit, no knobs). When the edit is written, reply and wait for the user's choice in one call: {}. The accept it returns is baked into source mechanically (_acceptResult.baked) and completes the session; then stop the helper.",
                s("sessionId"), s("action"), n("count"), reply
            ));
        }
        return Some(format!(
            "Session {} started: the browser scrolled to the target and fired Go (action \"{}\", count {}). Its generate event had not arrived yet: run {} live-poll to collect it (its _instructions carry the fast path: identity from the event, ONE edit, no knobs), then reply and wait for the accept in one call: {}.",
            s("sessionId"), s("action"), n("count"), self_cmd, reply
        ));
    }
    let text = match s("error").as_str() {
        "no_dev_server" => format!("No dev server is serving this app: none of the usual ports answered with the page carrying the helper's tag (pass --dev-url <url> when you know where it runs). {}", start_dev_server_hint(&s("harness"))),
        "browser_needed" => format!("{}The helper is up and no page is connected yet. {} Then rerun this exact command with --wait-for-browser 60000.", open_ignored_note(result), open_in_harness_hint(&s("harness"), &s("devUrl"), self_cmd)),
        "browser_open_failed" => format!("The browser could not be launched ({}). Open {} yourself with your harness browser tool, or give the user the URL, then rerun this command with --wait-for-browser 120000.", s("detail"), s("url")),
        "no_browser_connected" if result.get("opened").map(|o| o.is_object()).unwrap_or(false) => format!("The page was opened in the browser but no overlay connected within {} ms. The dev server may still be compiling, or the page does not carry the injected tag (check pageFiles). Reload the page, then rerun this command.", n("waitedMs")),
        "no_browser_connected" if !s("devUrl").is_empty() => format!("{}No page with the live overlay connected within {} ms. {} Then rerun this exact command with --wait-for-browser 60000.", open_ignored_note(result), n("waitedMs"), open_in_harness_hint(&s("harness"), &s("devUrl"), self_cmd)),
        "no_browser_connected" => "No page with the live overlay is connected. Open the app URL that serves a pageFiles entry yourself with your harness browser tool, then rerun this command. Only when no browser tool exists: give the user the URL and rerun with --wait-for-browser 120000 so the command fires as soon as they open the page.".to_string(),
        "browser_timeout" => "The overlay did not answer in time, and no session was started for this request (a Go that lands late is refused). The page may be mid-reload: reload the app page, then rerun this command.".to_string(),
        "invalid_selector" => "The selector is not valid CSS. Fix the selector syntax and rerun.".to_string(),
        "no_match" => {
            if n("rawMatchCount") > 0 {
                format!("The selector hit {} node(s) but none is pickable (too small, chrome, or filtered by --text). Target a larger element or adjust --text.", n("rawMatchCount"))
            } else {
                "The selector matched nothing on the open page. Derive a better selector from the page source (an id, a unique class, or a landmark), or add --text with a snippet of the element's visible text.".to_string()
            }
        }
        "ambiguous" => format!("The selector matched {} elements. Either target their common container instead, or disambiguate with --text \"<visible text>\" or --index <1-based position>. The candidates are listed in this output.", n("matchCount")),
        "index_out_of_range" => format!("--index is out of range: only {} match(es). Use an index from 1 to {}.", n("matchCount"), n("matchCount")),
        "busy" => {
            if s("reason") == "agent_target_in_flight" {
                "That tab is already acting on another generate request. Handle that request's pending event in your poll loop, or wait for its session to end, then rerun.".to_string()
            } else {
                format!("A live session is already mid-flight (browser state {}). Let the user finish or discard it in the browser, or handle the pending event in your poll loop, then rerun.", s("state"))
            }
        }
        "go_failed" => format!("The overlay could not start generation from the picked state (browser state {}). Reload the app page and rerun this command.", s("state")),
        "server_stopping" => format!("The live helper server is shutting down. Re-run the live boot ({} live), reopen the page, then rerun this command.", self_cmd),
        _ => return None,
    };
    Some(text)
}

/// Said first when `--open` was passed on a harness with its own browser.
fn open_ignored_note(result: &Map<String, Value>) -> &'static str {
    if result.get("openIgnored").is_some() {
        "--open was ignored: this harness has its own browser, and a second window is exactly what the lane avoids. "
    } else {
        ""
    }
}

/// How this harness opens a page: its own browser when it has one (no second
/// browser behind it), the system browser or the user otherwise.
fn open_in_harness_hint(harness: &str, dev_url: &str, self_cmd: &str) -> String {
    let _ = self_cmd;
    match harness {
        "cursor" => format!("Open {} with browser_navigate (Cursor's browser; it reuses the tab already on that origin).", dev_url),
        "claude-code" => format!("Open {} in the Browser pane: navigate the tab already on that origin (tabs_context lists them), or preview_start with that URL when the pane is closed.", dev_url),
        "codex" => format!("Codex has no browser tool: rerun this command with --open (the system browser opens {}), or give the user that URL.", dev_url),
        _ => format!("Open {} with your harness's browser tool, reusing a tab already on that origin; without one, rerun this command with --open (the system browser), or give the user that URL.", dev_url),
    }
}

/// Where a dev server gets started in this harness, so the one already
/// running there is the one the page comes from.
fn start_dev_server_hint(harness: &str) -> String {
    match harness {
        "claude-code" => "Start it the way the harness runs servers (preview_start with the project's dev configuration, or the dev script in a background shell), wait for its URL, then rerun this exact command with --dev-url <that url>; never kill or restart that server afterwards.".to_string(),
        "cursor" => "Start the project's dev script in a background terminal (npm run dev or the framework's equivalent), wait for it to print its URL, then rerun this exact command with --dev-url <that url>; never kill or restart that server afterwards.".to_string(),
        _ => "Start the project's dev script in a background terminal (npm run dev or the framework's equivalent), wait for it to print its URL, then rerun this exact command with --dev-url <that url>; never kill or restart that server afterwards.".to_string(),
    }
}

fn server_died(self_cmd: &str, detail: Option<String>, waiting: bool) -> Value {
    let mut v = Map::new();
    v.insert("ok".into(), json!(false));
    v.insert("error".into(), json!("server_unreachable"));
    if let Some(d) = detail {
        v.insert("detail".into(), json!(d));
    }
    let text = if waiting {
        format!("The recorded live server did not answer while waiting for a browser; it likely died. Re-run the live boot ({} live), reopen the app page, then rerun this command.", self_cmd)
    } else {
        format!("The recorded live server did not answer; it likely died. Re-run the live boot ({} live), reopen the app page, then rerun this command.", self_cmd)
    };
    v.insert("_instructions".into(), json!(text));
    Value::Object(v)
}

fn server_not_running(self_cmd: &str) -> Value {
    json!({
        "ok": false,
        "error": "server_not_running",
        "_instructions": format!("No live helper server is recorded for this project. Run the live boot first ({} live), open the app URL that serves a pageFiles entry, then rerun this command.", self_cmd),
    })
}

/// The lane's boot flags, run in-process from the caller's original cwd
/// (`--target` is a path relative to it). Ok: the boot payload. Err: a
/// verdict to print, exit 1.
fn run_boot(args: &[String], original_cwd: &std::path::Path, io: &Io, dev_url_hint: Option<&str>) -> Result<Map<String, Value>, Value> {
    let mut boot_args: Vec<String> = Vec::new();
    if let Some(i) = args.iter().position(|a| a == "--target") {
        if let Some(t) = args.get(i + 1).filter(|t| !t.starts_with("--")) {
            boot_args.push("--target".into());
            boot_args.push(t.clone());
        }
    }
    for a in args {
        if let Some(t) = a.strip_prefix("--target=") {
            boot_args.push("--target".into());
            boot_args.push(t.to_string());
        }
    }
    boot_args.push("--allow-missing-context".into());
    boot_args.push("--dev-url".into());
    boot_args.push("--no-live-bar".into());
    let mut env = io.env.clone();
    if let Some(hint) = dev_url_hint {
        // The known server first, the usual ports behind it, unless the
        // caller already narrowed the list.
        if !env.contains_key("IMPECCABLE_DEV_URL_CANDIDATES") {
            let mut list = vec![hint.trim_end_matches('/').to_string() + "/"];
            list.extend(crate::dev_url::candidates(None));
            env.insert("IMPECCABLE_DEV_URL_CANDIDATES".into(), list.join(","));
        }
    }
    let (mut child, captured) = Io::captured("", original_cwd.to_path_buf(), env);
    let code = crate::live_boot::run(&boot_args, &mut child);
    let out = String::from_utf8_lossy(&captured.stdout.borrow()).into_owned();
    let err = String::from_utf8_lossy(&captured.stderr.borrow()).into_owned();
    let payload: Option<Map<String, Value>> = serde_json::from_str::<Value>(out.trim())
        .ok()
        .and_then(|v| v.as_object().cloned());
    let Some(mut payload) = payload else {
        return Err(json!({
            "ok": false,
            "error": "boot_failed",
            "exitCode": code,
            "detail": if err.trim().is_empty() { out.trim().to_string() } else { err.trim().to_string() },
            "_instructions": "The live boot did not produce a verdict. Run `impeccable live --allow-missing-context --dev-url --no-live-bar` on its own, read its output, and fix what it names before rerunning this command.",
        }));
    };
    if payload.get("ok").and_then(Value::as_bool) != Some(true) {
        let error = payload.get("error").and_then(Value::as_str).unwrap_or("").to_string();
        let text = match error.as_str() {
            "config_missing" | "config_invalid" => "The live config is missing or invalid: follow reference/live-setup.md to create .impeccable/live/config.json, then rerun this command.",
            "target_selection_required" => "Several apps live here: ask the user which one, then rerun this command with --target <a file inside that app>.",
            "context_missing" => "The boot refused for missing context even though this verb asks it to proceed; rerun with the boot's own flags to see why.",
            _ => "The boot refused; its fields say why. Fix that, then rerun this command.",
        };
        payload.insert("ok".into(), json!(false));
        payload.insert("bootError".into(), json!(error));
        payload.insert("_instructions".into(), json!(text));
        return Err(Value::Object(payload));
    }
    Ok(payload)
}

/// What the verdict repeats from the boot: the context the edit needs and
/// where the page is. Plumbing (token, roots, drift) stays out.
fn boot_summary(boot: &Map<String, Value>) -> Value {
    let mut m = Map::new();
    for key in [
        "devUrl", "pageFiles", "projectRoot", "targetPath", "liveBarHidden", "contextMissing", "contextNote",
        "hasProduct", "product", "productPath", "hasDesign", "design", "designPath", "hasSurfaceBrief",
        "surfaceBrief", "surfaceBriefPath",
    ] {
        if let Some(v) = boot.get(key) {
            m.insert(key.into(), v.clone());
        }
    }
    Value::Object(m)
}

/// Collect the session's own generate event (`GET /poll?types=generate&id=`)
/// so the caller's next move is the edit. The event is leased exactly as a
/// poll would lease it; nothing else in the queue is touched.
fn fetch_generate_event(port: i64, token: &str, session_id: &str, budget: Duration, self_cmd: &str) -> Option<Value> {
    let deadline = Instant::now() + budget;
    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now()).as_millis() as u64;
        let slice = remaining.clamp(1_000, 5_000);
        let url = format!(
            "http://127.0.0.1:{}/poll?token={}&timeout={}&leaseMs={}&types=generate&id={}",
            port,
            crate::live_poll::form_encode(token),
            slice,
            crate::live_poll::DEFAULT_EVENT_LEASE_MS,
            crate::live_poll::form_encode(session_id)
        );
        let agent = ureq::AgentBuilder::new()
            .timeout(Duration::from_millis(slice + 30_000))
            .build();
        let Ok(res) = agent.get(&url).call() else { return None };
        let Ok(mut event) = res.into_json::<Value>() else { return None };
        match event.get("type").and_then(Value::as_str) {
            Some("generate") => {
                if let Some(obj) = event.as_object_mut() {
                    match crate::instructions::instructions_for_event(obj, self_cmd) {
                        Some(text) if !text.is_empty() => {
                            obj.insert("_instructions".into(), json!(text));
                        }
                        _ => {
                            obj.remove("_instructions");
                        }
                    }
                }
                return Some(event);
            }
            Some("timeout") => continue,
            _ => return None,
        }
    }
    None
}

/// How long the verb waits for the generate event after a started session.
const EVENT_BUDGET_MS: u64 = 20_000;
/// The wait `--open` implies when `--wait-for-browser` was not given.
const OPEN_WAIT_MS: u64 = 60_000;

pub fn run(args: &[String], io: &mut Io) -> i32 {
    if args.iter().any(|a| a == "--help" || a == "-h") {
        println(io, HELP);
        return 0;
    }
    let flags_probe = match parse_flags(args) {
        Ok(f) => f,
        Err(v) => return fail(io, v),
    };
    // `--boot` runs before the root switch: the boot writes the roots
    // manifest the switch reads, and reads --target relative to this cwd.
    let original_cwd = io.cwd.clone();
    let dev_url_hint: Option<String> = flag(&flags_probe, "dev-url").map(str::trim).filter(|u| !u.is_empty()).map(str::to_string);
    let mut boot: Option<Map<String, Value>> = None;
    if flags_probe.boot {
        match run_boot(args, &original_cwd, io, dev_url_hint.as_deref()) {
            Ok(b) => boot = Some(b),
            Err(v) => return fail(io, v),
        }
    }
    let mut argv: Vec<String> = args.to_vec();
    if let Err(code) = enter_live_root(&mut argv, io) {
        return code;
    }
    let cwd = io.cwd.to_string_lossy().into_owned();
    let env = io.env.clone();
    let me = self_cmd(io);
    let flags = match parse_flags(&argv) {
        Ok(f) => f,
        Err(v) => return fail(io, v),
    };

    let selector = flag(&flags, "selector").map(str::trim).unwrap_or("").to_string();
    if selector.is_empty() {
        return fail(io, json!({
            "ok": false,
            "error": "selector_required",
            "_instructions": "Pass --selector with a CSS selector for the element to target. Derive it from the page source: prefer an id, a unique class, or a landmark section, and add --text \"<visible text>\" when the class repeats.",
        }));
    }
    let action = flag(&flags, "action").unwrap_or("impeccable").to_string();
    if !VISUAL_ACTIONS.contains(&action.as_str()) {
        return fail(io, json!({
            "ok": false,
            "error": "invalid_action",
            "action": action,
            "validActions": VISUAL_ACTIONS,
            "_instructions": "Map the request wording onto the closest listed action (bold -> bolder, quiet/calmer -> quieter, simplify -> distill). When no action fits, use --action impeccable and carry the wording via --prompt.",
        }));
    }
    let count = match flag(&flags, "count") {
        None => 3,
        Some(raw) => match int_flag(raw) {
            Some(c) if (1..=8).contains(&c) => c,
            _ => {
                return fail(io, json!({ "ok": false, "error": "invalid_count", "count": raw, "_instructions": "Pass --count as an integer from 1 to 8." }));
            }
        },
    };
    let index = match flag(&flags, "index") {
        None => None,
        Some(raw) => match int_flag(raw) {
            Some(i) if i >= 1 => Some(i),
            _ => {
                return fail(io, json!({ "ok": false, "error": "invalid_index", "index": raw, "_instructions": "Pass --index as a 1-based integer position among the matches." }));
            }
        },
    };
    let mut wait_for_browser_ms = match flag(&flags, "wait-for-browser") {
        None => 0,
        Some(raw) => match int_flag(raw) {
            Some(ms) if ms >= 1 => ms as u64,
            _ => {
                return fail(io, json!({ "ok": false, "error": "invalid_wait", "wait": raw, "_instructions": "Pass --wait-for-browser as a positive integer of milliseconds, e.g. --wait-for-browser 120000." }));
            }
        },
    };

    let Some((info, _)) = read_live_server_info(&cwd, &env) else {
        return fail(io, server_not_running(&me));
    };
    let port = info.raw.get("port").and_then(Value::as_i64);
    let token = info.raw.get("token").and_then(Value::as_str).map(str::to_string);
    let (Some(port), Some(token)) = (port, token) else {
        return fail(io, server_not_running(&me));
    };
    let harness = impeccable_context::provider::detect(&env, &cwd).id;
    // Every verdict from here on repeats what the boot found, so a refusal
    // still hands the caller its context and dev URL.
    let with_boot = |mut v: Map<String, Value>| -> Value {
        if let Some(b) = &boot {
            v.insert("boot".into(), boot_summary(b));
        }
        v.insert("harness".into(), json!(harness));
        Value::Object(v)
    };

    // Where the page is: the boot's probe, else a probe led by the caller's
    // hint, else the hint itself (a server the harness runs that answers
    // without our tag yet, before its first reload).
    let resolve_dev_url = |boot: &Option<Map<String, Value>>| -> (Option<String>, bool) {
        if let Some(u) = boot.as_ref().and_then(|b| b.get("devUrl")).and_then(Value::as_str).filter(|u| !u.is_empty()) {
            return (Some(u.to_string()), true);
        }
        let mut candidates: Vec<String> = Vec::new();
        if let Some(h) = &dev_url_hint {
            candidates.push(h.trim_end_matches('/').to_string() + "/");
        }
        candidates.extend(crate::dev_url::candidates(env.get("IMPECCABLE_DEV_URL_CANDIDATES").map(String::as_str)));
        if let Some(u) = crate::dev_url::probe(&candidates, &token) {
            return (Some(u), true);
        }
        (dev_url_hint.clone(), false)
    };

    // A harness with its own browser never gets a second window from this
    // verb: `--open` there is ignored unless the user chose a browser
    // explicitly (IMPECCABLE_BROWSER or the config's `browser`; the generic
    // BROWSER variable is not that choice).
    let harness_has_browser = matches!(harness.as_str(), "cursor" | "claude-code");
    let open_ignored = flags.open && harness_has_browser && crate::browser_open::explicit_browser(&cwd, &env).is_none();
    let open = flags.open && !open_ignored;
    let with_open_note = |mut v: Map<String, Value>| -> Map<String, Value> {
        if open_ignored {
            v.insert("openIgnored".into(), json!("harness browser"));
        }
        v
    };

    // Nothing connected, nothing asked to open, nothing to wait for: the
    // caller opens the page itself (its harness's browser, never a second
    // one behind it) and comes back.
    let mut opened: Option<Value> = None;
    if !open && wait_for_browser_ms == 0 && !flags.dry_run {
        let Some(status) = crate::server::fetch_status(port, &token) else {
            return fail(io, server_died(&me, None, false));
        };
        if status.get("connectedClients").and_then(Value::as_i64).unwrap_or(0) == 0 {
            let (dev_url, verified) = resolve_dev_url(&boot);
            let mut v = Map::new();
            v.insert("ok".into(), json!(false));
            if let Some(u) = dev_url {
                v.insert("error".into(), json!("browser_needed"));
                v.insert("devUrl".into(), json!(u));
                v.insert("devUrlVerified".into(), json!(verified));
            } else {
                v.insert("error".into(), json!("no_dev_server"));
            }
            v.insert("harness".into(), json!(harness));
            let mut v = with_open_note(v);
            let text = instructions_for(&v, &me).unwrap_or_default();
            v.insert("_instructions".into(), json!(text));
            return fail(io, with_boot(v));
        }
    }

    // `--open`: hand the page to the browser when nothing is connected yet.
    if open {
        let Some(status) = crate::server::fetch_status(port, &token) else {
            return fail(io, server_died(&me, None, false));
        };
        let connected = status.get("connectedClients").and_then(Value::as_i64).unwrap_or(0) > 0;
        if !connected {
            let (dev_url, _) = resolve_dev_url(&boot);
            let Some(url) = dev_url else {
                let mut v = Map::new();
                v.insert("ok".into(), json!(false));
                v.insert("error".into(), json!("no_dev_server"));
                v.insert("harness".into(), json!(harness));
                let text = instructions_for(&v, &me).unwrap_or_default();
                v.insert("_instructions".into(), json!(text));
                return fail(io, with_boot(v));
            };
            match crate::browser_open::open_url(&url, &cwd, &env) {
                Ok(via) => {
                    opened = Some(json!({ "url": url, "via": via }));
                    if wait_for_browser_ms == 0 {
                        wait_for_browser_ms = OPEN_WAIT_MS;
                    }
                }
                Err(detail) => {
                    let mut v = Map::new();
                    v.insert("ok".into(), json!(false));
                    v.insert("error".into(), json!("browser_open_failed"));
                    v.insert("url".into(), json!(url));
                    v.insert("detail".into(), json!(detail));
                    let text = instructions_for(&v, &me).unwrap_or_default();
                    v.insert("_instructions".into(), json!(text));
                    return fail(io, with_boot(v));
                }
            }
        }
    }

    if wait_for_browser_ms > 0 {
        let deadline = Instant::now() + Duration::from_millis(wait_for_browser_ms);
        loop {
            let Some(status) = crate::server::fetch_status(port, &token) else {
                return fail(io, server_died(&me, None, true));
            };
            if status.get("connectedClients").and_then(Value::as_i64).unwrap_or(0) > 0 {
                break;
            }
            if Instant::now() >= deadline {
                let mut v = Map::new();
                v.insert("ok".into(), json!(false));
                v.insert("error".into(), json!("no_browser_connected"));
                v.insert("waitedMs".into(), json!(wait_for_browser_ms));
                if let Some(o) = &opened {
                    v.insert("opened".into(), o.clone());
                } else if let (Some(u), _) = resolve_dev_url(&boot) {
                    v.insert("devUrl".into(), json!(u));
                }
                v.insert("harness".into(), json!(harness));
                let mut v = with_open_note(v);
                let text = instructions_for(&v, &me).unwrap_or_default();
                v.insert("_instructions".into(), json!(text));
                return fail(io, with_boot(v));
            }
            std::thread::sleep(Duration::from_millis(1_000));
        }
    }

    let mut body = Map::new();
    body.insert("token".into(), json!(token));
    body.insert("selector".into(), json!(selector));
    body.insert("action".into(), json!(action));
    body.insert("count".into(), json!(count));
    if let Some(text) = flag(&flags, "text").filter(|t| !t.is_empty()) {
        body.insert("text".into(), json!(text));
    }
    if let Some(i) = index {
        body.insert("index".into(), json!(i));
    }
    if let Some(prompt) = flag(&flags, "prompt").filter(|p| !p.is_empty()) {
        body.insert("prompt".into(), json!(prompt));
    }
    if flags.dry_run {
        body.insert("dryRun".into(), json!(true));
    }
    if flags.no_live_bar || flags.boot {
        body.insert("hideLiveBar".into(), json!(true));
    }

    let url = format!("http://127.0.0.1:{}/agent-target", port);
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_millis(REQUEST_TIMEOUT_MS))
        .build();
    let sent = agent
        .post(&url)
        .set("Content-Type", "application/json")
        .send_string(&serde_json::to_string(&Value::Object(body)).unwrap_or_default());
    let (status, result) = match sent {
        Ok(res) => {
            let status = res.status();
            match res.into_json::<Value>() {
                Ok(v) => (status, v),
                Err(_) => return fail(io, json!({ "ok": false, "error": "bad_server_response", "status": status })),
            }
        }
        Err(ureq::Error::Status(status, res)) => match res.into_json::<Value>() {
            Ok(v) => (status, v),
            Err(_) => return fail(io, json!({ "ok": false, "error": "bad_server_response", "status": status })),
        },
        Err(ureq::Error::Transport(t)) => {
            let detail = t.to_string();
            let lower = detail.to_ascii_lowercase();
            if lower.contains("timed out") || lower.contains("timeout") {
                let mut v = Map::new();
                v.insert("ok".into(), json!(false));
                v.insert("error".into(), json!("request_timeout"));
                v.insert("detail".into(), json!(detail));
                let mut probe = Map::new();
                probe.insert("error".into(), json!("browser_timeout"));
                let text = instructions_for(&probe, &me).unwrap_or_default();
                v.insert("_instructions".into(), json!(text));
                return fail(io, Value::Object(v));
            }
            return fail(io, server_died(&me, Some(detail), false));
        }
    };
    let mut fields = result.as_object().cloned().unwrap_or_default();
    if !(200..300).contains(&status) {
        let mut v = Map::new();
        v.insert("ok".into(), json!(false));
        let code = fields
            .get("error")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| format!("http_{}", status));
        v.insert("error".into(), json!(code));
        for (k, val) in fields {
            if k != "ok" && k != "error" {
                v.insert(k, val);
            }
        }
        return fail(io, with_boot(v));
    }
    let ok = fields.get("ok").and_then(Value::as_bool) == Some(true);
    let dry_run = fields.get("dryRun").and_then(Value::as_bool) == Some(true);
    if let Some(b) = &boot {
        fields.insert("boot".into(), boot_summary(b));
    }
    if let Some(o) = &opened {
        fields.insert("opened".into(), o.clone());
    }
    if ok && !dry_run {
        let session_id = fields.get("sessionId").and_then(Value::as_str).map(str::to_string);
        if let Some(sid) = session_id.filter(|s| !s.is_empty()) {
            let event = fetch_generate_event(port, &token, &sid, Duration::from_millis(EVENT_BUDGET_MS), &me);
            fields.insert("event".into(), event.unwrap_or(Value::Null));
        }
    }
    if let Some(text) = instructions_for(&fields, &me) {
        fields.insert("_instructions".into(), json!(text));
    }
    print_json(io, &Value::Object(fields));
    if ok {
        0
    } else {
        1
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn busy(reason: &str) -> Map<String, Value> {
        let mut m = Map::new();
        m.insert("ok".into(), json!(false));
        m.insert("error".into(), json!("busy"));
        m.insert("state".into(), json!("CONFIGURING"));
        m.insert("reason".into(), json!(reason));
        m
    }

    #[test]
    fn no_live_bar_is_a_boolean_flag() {
        let flags = parse_flags(&["--selector".to_string(), "h1".to_string(), "--no-live-bar".to_string(), "--count".to_string(), "3".to_string()]).unwrap();
        assert!(flags.no_live_bar);
        assert_eq!(flags.values.get("selector").and_then(Value::as_str), Some("h1"));
        assert_eq!(flags.values.get("count").and_then(Value::as_str), Some("3"));
        assert!(!parse_flags(&["--selector".to_string(), "h1".to_string()]).unwrap().no_live_bar);
    }

    #[test]
    fn dev_url_takes_a_value_and_still_works_bare() {
        let with = parse_flags(&["--dev-url".to_string(), "http://127.0.0.1:5173/".to_string(), "--selector".to_string(), "h1".to_string()]).unwrap();
        assert_eq!(with.values.get("dev-url").and_then(Value::as_str), Some("http://127.0.0.1:5173/"));
        let bare = parse_flags(&["--dev-url".to_string(), "--selector".to_string(), "h1".to_string()]).unwrap();
        assert!(bare.values.get("dev-url").is_none());
        assert_eq!(bare.values.get("selector").and_then(Value::as_str), Some("h1"));
    }

    #[test]
    fn browser_needed_names_the_harness_browser_and_never_a_second_one() {
        let mut m = Map::new();
        m.insert("ok".into(), json!(false));
        m.insert("error".into(), json!("browser_needed"));
        m.insert("devUrl".into(), json!("http://127.0.0.1:5173/"));
        m.insert("harness".into(), json!("cursor"));
        let cursor = instructions_for(&m, "impeccable").unwrap();
        assert!(cursor.contains("browser_navigate"), "{cursor}");
        assert!(cursor.contains("--wait-for-browser 60000"), "{cursor}");
        assert!(!cursor.contains("--open"), "a harness with a browser is never told to open a second one: {cursor}");
        m.insert("harness".into(), json!("claude-code"));
        let claude = instructions_for(&m, "impeccable").unwrap();
        assert!(claude.contains("Browser pane") && claude.contains("navigate") && claude.contains("preview_start"), "{claude}");
        assert!(!claude.contains("--open"), "{claude}");
        m.insert("harness".into(), json!("codex"));
        let codex = instructions_for(&m, "impeccable").unwrap();
        assert!(codex.contains("--open") && codex.contains("give the user"), "{codex}");
        m.insert("harness".into(), json!("source"));
        let other = instructions_for(&m, "impeccable").unwrap();
        assert!(other.contains("browser tool") && other.contains("--open"), "{other}");
    }

    #[test]
    fn an_ignored_open_says_so_before_the_harness_hint() {
        let mut m = Map::new();
        m.insert("ok".into(), json!(false));
        m.insert("error".into(), json!("browser_needed"));
        m.insert("devUrl".into(), json!("http://127.0.0.1:5173/"));
        m.insert("harness".into(), json!("cursor"));
        m.insert("openIgnored".into(), json!("harness browser"));
        let text = instructions_for(&m, "impeccable").unwrap();
        assert!(text.starts_with("--open was ignored"), "{text}");
        assert!(text.contains("browser_navigate"), "{text}");
    }

    #[test]
    fn a_missing_dev_server_points_at_the_harness_way_to_start_one() {
        let mut m = Map::new();
        m.insert("ok".into(), json!(false));
        m.insert("error".into(), json!("no_dev_server"));
        m.insert("harness".into(), json!("claude-code"));
        let text = instructions_for(&m, "impeccable").unwrap();
        assert!(text.contains("preview_start") && text.contains("--dev-url"), "{text}");
        m.insert("harness".into(), json!("cursor"));
        let text = instructions_for(&m, "impeccable").unwrap();
        assert!(text.contains("background terminal") && text.contains("--dev-url"), "{text}");
    }

    #[test]
    fn timeout_instructions_promise_no_stray_session() {
        let mut m = Map::new();
        m.insert("ok".into(), json!(false));
        m.insert("error".into(), json!("browser_timeout"));
        let text = instructions_for(&m, "impeccable").unwrap();
        assert!(text.contains("no session was started"), "{text}");
    }

    #[test]
    fn busy_instructions_tell_the_agent_whose_session_is_in_the_way() {
        let own = instructions_for(&busy("agent_target_in_flight"), "impeccable").unwrap();
        assert!(own.contains("already acting on another generate request"), "{own}");
        let user = instructions_for(&busy("session_active"), "impeccable").unwrap();
        assert!(user.contains("browser state CONFIGURING"), "{user}");
    }
}
