//! `impeccable live-generate`: agent-initiated element targeting for the
//! `generate` command.
//!
//! Asks the live overlay to find an element by CSS selector, scroll to it,
//! enter the picked state, and fire the normal Go pipeline with the given
//! action and count. On success the browser starts a standard generate
//! session; the agent then handles the resulting `generate` event from the
//! poll loop exactly as live.md describes. Requires a running live helper
//! server (`impeccable live` boot) and an open page with the overlay attached.

use crate::live_resume::self_cmd;
use crate::paths::read_live_server_info;
use crate::roots::enter_live_root;
use crate::util::println;
use crate::vocabulary::VISUAL_ACTIONS;
use impeccable_common::Io;
use serde_json::{json, Map, Value};
use std::time::{Duration, Instant};

const HELP: &str = "Usage: impeccable live-generate --selector <css> [--text <snippet>] [--index <n>] [--action <name>] [--count <n>] [--prompt <text>] [--dry-run] [--wait-for-browser <ms>]

Flags:
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
";

/// Client-side cap just above the server's 15s hold, so a hung helper still
/// fails fast.
const REQUEST_TIMEOUT_MS: u64 = 20_000;

struct Flags {
    values: Map<String, Value>,
    dry_run: bool,
}

fn parse_flags(argv: &[String]) -> Result<Flags, Value> {
    let mut values = Map::new();
    let mut dry_run = false;
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
    Ok(Flags { values, dry_run })
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
        return Some(format!(
            "Session {} started: the browser scrolled to the target and fired Go (action \"{}\", count {}). Poll now with {} live-poll; the next event for this session is its generate event. Handle it exactly per live.md's Handle generate, then reply done and keep polling.",
            s("sessionId"), s("action"), n("count"), self_cmd
        ));
    }
    let text = match s("error").as_str() {
        "no_browser_connected" => "No page with the live overlay is connected. Open the app URL that serves a pageFiles entry yourself with your harness browser tool, then rerun this command. Only when no browser tool exists: give the user the URL and rerun with --wait-for-browser 120000 so the command fires as soon as they open the page.".to_string(),
        "browser_timeout" => format!("The overlay did not answer in time. The page may be mid-reload: run {} live-status to check whether a session started anyway, reload the app page, then rerun this command.", self_cmd),
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
        "busy" => format!("A live session is already mid-flight (browser state {}). Let the user finish or discard it in the browser, or handle the pending event in your poll loop, then rerun.", s("state")),
        "go_failed" => format!("The overlay could not start generation from the picked state (browser state {}). Reload the app page and rerun this command.", s("state")),
        "server_stopping" => format!("The live helper server is shutting down. Re-run the live boot ({} live), reopen the page, then rerun this command.", self_cmd),
        _ => return None,
    };
    Some(text)
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

pub fn run(args: &[String], io: &mut Io) -> i32 {
    let mut argv: Vec<String> = args.to_vec();
    if let Err(code) = enter_live_root(&mut argv, io) {
        return code;
    }
    let cwd = io.cwd.to_string_lossy().into_owned();
    let env = io.env.clone();
    if argv.iter().any(|a| a == "--help" || a == "-h") {
        println(io, HELP);
        return 0;
    }
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
    let wait_for_browser_ms = match flag(&flags, "wait-for-browser") {
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
                let text = instructions_for(&v, &me).unwrap_or_default();
                v.insert("_instructions".into(), json!(text));
                return fail(io, Value::Object(v));
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
        return fail(io, Value::Object(v));
    }
    let ok = fields.get("ok").and_then(Value::as_bool) == Some(true);
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
