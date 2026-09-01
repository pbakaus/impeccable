//! JS: serve-question.mjs -> `impeccable serve-question`
//!
//! Modes: --schema, --wait, --stop, --update, --start (spawns this binary
//! detached with --detached-serve), and the blocking/detached server itself.

use crate::jsp;
use crate::question_page::PAGE;
use crate::util::{exists, is_dir, iso_now, json_compact, json_pretty, mtime_ms, now_ms, safe_read, utf16_len, Env};
use impeccable_common::Io;
use serde_json::{json, Map, Value};
use std::sync::{Arc, Mutex};

const NEXT_CLAIM_GRACE_MS: f64 = 10000.0;

struct Args<'a> {
    argv: &'a [String],
}

impl<'a> Args<'a> {
    fn arg(&self, name: &str) -> Option<String> {
        let i = self.argv.iter().position(|a| a == &format!("--{}", name))?;
        let v = self.argv.get(i + 1)?;
        if !v.is_empty() && !v.starts_with("--") {
            Some(v.clone())
        } else {
            None
        }
    }
    fn arg_or(&self, name: &str, fallback: &str) -> String {
        self.arg(name).unwrap_or_else(|| fallback.to_string())
    }
    fn has(&self, name: &str) -> bool {
        self.argv.iter().any(|a| a == &format!("--{}", name))
    }
}

fn env_set(env: &Env, key: &str) -> bool {
    env.get(key).map(|v| !v.is_empty()).unwrap_or(false)
}

fn state_file(qdir: &str, key: &str) -> String {
    jsp::join(&[qdir, &format!("{}.state.json", key)])
}
fn answer_file(qdir: &str, key: &str) -> String {
    jsp::join(&[qdir, &format!("{}.answer.json", key)])
}
fn flip_file(qdir: &str, key: &str) -> String {
    jsp::join(&[qdir, &format!("{}.flip.json", key)])
}
fn next_file(qdir: &str, key: &str) -> String {
    jsp::join(&[qdir, &format!("{}.next.json", key)])
}

/// `process.kill(pid, 0)`: Ok(()) alive, Err(true) EPERM (alive but unsignalable), Err(false) dead.
fn pid_probe(pid: i64) -> Result<(), bool> {
    match impeccable_common::proc::kill0(pid) {
        Ok(()) => Ok(()),
        Err("EPERM") => Err(true),
        Err(_) => Err(false),
    }
}

/// `process.kill(pid)` (SIGTERM; TerminateProcess on Windows), errors ignored.
fn kill_pid(pid: i64) {
    impeccable_common::proc::terminate(pid);
}

fn read_state(qdir: &str, key: &str) -> Option<Map<String, Value>> {
    let text = safe_read(&state_file(qdir, key))?;
    serde_json::from_str::<Value>(&text).ok()?.as_object().cloned()
}

fn num_field(m: &Map<String, Value>, key: &str) -> Option<f64> {
    m.get(key).and_then(|v| v.as_f64())
}

fn is_alive(qdir: &str, key: &str) -> bool {
    let Some(state) = read_state(qdir, key) else { return false };
    if let Some(lb) = num_field(&state, "lastBeat") {
        if lb != 0.0 && now_ms() - lb < 12000.0 {
            return true;
        }
    }
    // process.kill(state.pid, 0): pid undefined -> throws TypeError (not EPERM) -> false
    let Some(pid) = state.get("pid").and_then(|p| p.as_f64()) else { return false };
    match pid_probe(pid as i64) {
        Ok(()) => true,
        Err(eperm) => eperm,
    }
}

fn print_answer(io: &mut Io, raw: &str) {
    io.out(&format!("ANSWER: {}\n", raw));
    let Ok(a) = serde_json::from_str::<Value>(raw) else { return };
    let truthy = |k: &str| a.get(k).map(crate::staleness::js_truthy).unwrap_or(false);
    if truthy("hero") || truthy("board") {
        io.out("CHOSEN CARD: open the chosen world's board and hero images now, before any code. When your harness only reads files, or runs sandboxed, download them INTO the workspace and open the relative path; a sandboxed viewer rejects absolute paths outside it. They set the craft bar the build must reach.\n");
    }
    if truthy("comp") {
        io.out("CHOSEN COMP: the decision comp at that path is compositional option one. On a comp-led build the comp round adds two variations beside it; on a code-led build it returns at the finish review as the critique reference. Never regenerate it from scratch.\n");
    }
    let option_id = a.get("optionId").and_then(|v| v.as_str());
    if option_id == Some("canon") {
        io.out("CANON CHOSEN: the user picked the category standard on purpose. Ask once for two or three products this should sit alongside; their craft level becomes the quality bar. Execute the canon at full commitment, conventions embraced without irony or smuggled quirk.\n");
    }
    if option_id == Some("reroll") && truthy("register") {
        let r = a.get("register").map(js_str).unwrap_or_default();
        io.out(&format!("REGISTER: the user steered the next hand to the {} register. Re-run concept-seed with the same key, the next --reroll round, and --register {}, then follow what it prints; the register is the user's steering, never yours to pre-select.\n", r, r));
    }
    if truthy("followup") && option_id != Some("reroll") {
        io.out("FOLLOWUP OPEN: the table stays open and the page is showing a loading hand. Deliver the next round now with --update --key <key> --payload <file>, then collect it with --wait; never leave the page waiting on a round you have not sent.\n");
    }
    let bp = a.get("buildPath").and_then(|v| v.as_str());
    if bp == Some("comp") || bp == Some("code") {
        let origin = if truthy("buildPathFlipped") {
            "flipped on the page, so it binds this session only, and the page never writes it back; the sole exception is new-work’s one-time offer, on a project that had no recorded default at all, which asks after the round closes and writes the answer to .impeccable/config.json"
        } else {
            "the round’s recorded default"
        };
        io.out(&format!(
            "BUILD PATH: {} ({}). {}\n",
            bp.unwrap(),
            origin,
            if bp == Some("comp") {
                "Comp-led: the chosen card’s comp is law; generate it before building when it does not exist yet, and the finish review audits the build against it."
            } else {
                "Code-led: no comp is owed; a comp that already rendered rides at the finish review as the critique reference, and the ambition lives in the direction contract."
            }
        ));
    }
}

fn js_str(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => "null".to_string(),
        other => crate::critique_storage::js_string_value(other),
    }
}

fn schema_json() -> Value {
    json!({
      "title": "Choose the visual world",
      "question": "The roll assigned Fillmore Handbill. Keep it, take an alternate, or re-roll.",
      "options": [
        { "id": "assigned", "label": "Fillmore Handbill", "kicker": "THE ROLL", "lineage": "1966-71 Fillmore psychedelic handbills", "thesis": "The gig poster that treats every release like a one-night stand.", "palette": ["#e8452c", "#f5d64c", "#1b2a52", "#f3ead8"], "materials": ["letterpress", "split-fountain ink"], "viewport": "A full-bleed dated bill with the product name in warped display type.", "risk": "Reads nostalgic when the type is set timidly.", "raised": [{ "from": "challenger-microfiche", "raise": "The bill now owns its whole viewport as one continuous printed sheet." }], "comp": ".impeccable/mocks/decision/assigned.webp", "hero": "https://impeccable.style/worlds/cards/posters-covers-sleeves-fillmore-handbill-hero.webp", "board": "https://impeccable.style/worlds/cards/posters-covers-sleeves-fillmore-handbill.webp" },
        { "id": "model-pick", "label": "The Broadside Ballad", "kicker": "IMPECCABLE’S PICK", "lineage": "street-sold ballad sheets", "thesis": "Every release printed as the day’s ballad sheet.", "palette": ["#1f1c18", "#efe5d0", "#a33327"], "materials": ["woodcut", "rag paper"], "viewport": "One tall sheet, the newest release as today’s ballad.", "risk": "Also the direction most runs in this category land on.", "comp": ".impeccable/mocks/decision/model-pick.webp" },
        { "id": "challenger-teletext", "label": "Teletext Service", "verdict": "competitive", "lineage": "broadcast teletext magazines", "thesis": "The catalog as a broadcast index: pages, not sections.", "palette": ["#0000c0", "#ffff00", "#00c000", "#ffffff"], "materials": ["block mosaic", "phosphor glow"], "viewport": "P100 index page, releases as numbered rows.", "case": "Fuses cleanly: releases map to numbered pages; loses narrowly on clarity.", "risk": "Reads retro-novelty when the grid is not strict.", "comp": ".impeccable/mocks/decision/challenger-teletext.webp", "hero": "https://impeccable.style/worlds/cards/broadcast-programming-teletext-service-hero.webp" },
        { "id": "challenger-microfiche", "label": "Microfiche Reader", "verdict": "declined", "lineage": "library microfiche stations", "palette": ["#101418", "#9fb4c0"], "materials": ["film grain", "backlit glass"], "case": "Fuses poorly: listeners do not identify with archival retrieval.", "kept": "Total environmental commitment.", "hero": "https://impeccable.style/worlds/cards/archives-microfiche-reader-hero.webp" }
      ],
      "reroll": { "registers": ["safer", "bolder"] },
      "buildPath": { "value": "comp", "toggle": true },
      "canon": true,
      "canonCard": { "label": "The category standard", "thesis": "What this category ships, executed impeccably.", "palette": ["#ffffff", "#111827", "#2563eb"], "materials": ["clean grid", "product photography"], "viewport": "The arrangement a visitor expects, at full craft.", "risk": "Indistinguishable from the competition by design.", "comp": ".impeccable/mocks/decision/canon.webp" },
      "steer": true
    })
}

const SCHEMA_NOTE: &str = "\nOption ids return verbatim in ANSWER; \"reroll\" and \"canon\" are reserved. hero/board/comp accept URLs or local paths; comp slots may point at files that do not exist yet (serve first, generate after; the page polls until they land, so never block serving on generation). hero on a challenger is the inspiration it draws from and renders picture-in-picture beside the comp, never as the promise of the build. verdict routes rendering: \"wins\" and \"competitive\" challengers keep full cards, \"declined\" ones render demoted after them (narrow, quiet, art as a labeled thumb, \"Adopt anyway\"), with their kept line on the front; the page reorders declined cards to the end on its own. raised on the assigned card renders each donation as a named raise line. Salience parity: when the assigned card declares no comp (no image generation this round), catalog art on every card demotes to a labeled thumb, so what looks important is the verdict’s call, never rendering luck. canonCard renders the standing exit as a subordinate card with the same anatomy; without it, canon stays a quiet footer action. Include canon only for visual-direction rounds; never present it as your own recommendation. The pick card is a kicker convention, not a field: kicker \"IMPECCABLE’S PICK\" on your top-ranked grounded candidate, one at most, never in the lead slot. Every card gets the full anatomy, challengers, canon, and declined included: thesis, palette, materials, viewport, risk; the seed already hands you each challenger’s system rules, so a card with no palette chips is an authoring gap, not a data gap. Keep thesis and each fact to one short sentence: the card front shows thesis, identity, and a two-line risk, while first viewport and the case read on the card back behind the Details chip, so long facts cost the reader a flip, not the page its scanability. A card with no imagery at all has no back; its full read renders on the front, so a text-only round loses nothing. A card may instead declare \"wireframe\" ({\"cols\":12,\"rows\":10,\"regions\":[{\"label\":\"nav rail\",\"x\":0,\"y\":0,\"w\":3,\"h\":10,\"accent\":true}]}): the page draws it as a layout schematic in the media slot; surface-scope rounds use it on code-led builds, it never counts toward salience, and the card keeps its full read on the front. The comp slot carries the card’s full-fidelity direction comp (the legacy key \"sketch\" is accepted as an alias). Comp aspect follows the surface: portrait at device viewport for native or mobile-first surfaces, landscape otherwise; the page adapts its cards to either. reroll accepts true or { \"registers\": [\"safer\", \"bolder\"] }: the register buttons steer the next hand along the familiar-to-bold axis, the answer carries \"register\", and you re-run concept-seed with --register <value> for the next round; offer the registers on direction rounds, and never pre-select one. buildPath rides the payload as { \"value\": \"comp\"|\"code\", \"toggle\": true }: the value is the recorded default (.impeccable/config.json buildPath, or .impeccable/config.local.json where one machine differs) and the toggle renders a footer switch whose flip binds that session only; the ANSWER then carries buildPath plus buildPathFlipped. On a code-led round each card still declares its comp path as a flip reserve: wireframes render, and a flip to comp makes --wait return once with BUILD PATH FLIPPED so you generate the comps into the declared slots while the round stays open; a flip back to code is free, and a comp that already landed stays as the critique reference. The toggle may only be offered when image generation exists: a harness with no image tool and no API key never sets toggle: true, so the choice never renders where comps cannot be made, and code-led simply rides as the untoggleable value. followup: true keeps the table open after a pick for a second round via --update; send the next payload immediately, the page is waiting on it.";

/// JS: Number(arg('timeout','900')) etc.
fn js_number_arg(a: &Args, name: &str, fallback: &str) -> f64 {
    crate::critique_storage::js_number(&a.arg_or(name, fallback))
}

fn sleep_ms(ms: u64) {
    std::thread::sleep(std::time::Duration::from_millis(ms));
}

fn read_json_file(p: &str) -> Result<Value, String> {
    let text = std::fs::read(p).map_err(|e| crate::util::node_read_error(p, &e))?;
    let text = String::from_utf8_lossy(&text).into_owned();
    serde_json::from_str::<Value>(&text).map_err(|e| format!("SyntaxError: {}", js_json_error(&text, &e)))
}

fn js_json_error(text: &str, e: &serde_json::Error) -> String {
    // Approximation of V8's message shape.
    let _ = text;
    format!("Unexpected token in JSON ({})", e)
}

pub fn run(argv: &[String], io: &mut Io) -> i32 {
    let a = Args { argv };
    let env = io.env.clone();
    let cwd = io.cwd.to_string_lossy().into_owned();
    if env_set(&env, "IMPECCABLE_QUESTION_DISABLED") {
        io.out("serve-question: disabled in this session (no browser); use the structured question tool instead.\n");
        return 2;
    }
    let wants_browser = !a.has("no-open") && !a.has("wait") && !a.has("stop") && !a.has("schema") && !a.has("update");
    if wants_browser && !env_set(&env, "IMPECCABLE_QUESTION_FORCE") {
        let headless = env_set(&env, "CI")
            || (env_set(&env, "SSH_CONNECTION") && !env_set(&env, "DISPLAY"))
            || (cfg!(target_os = "linux") && !env_set(&env, "DISPLAY") && !env_set(&env, "WAYLAND_DISPLAY"));
        if headless {
            io.out("serve-question: no browser detected in this environment (CI/headless/remote); use the structured question tool instead. Set IMPECCABLE_QUESTION_FORCE=1 to serve anyway.\n");
            return 2;
        }
    }
    let payload_path = a.arg("payload");
    let timeout_arg = js_number_arg(&a, "timeout", "900");
    let timeout_sec = if timeout_arg.is_finite() && timeout_arg >= 0.0 { timeout_arg } else { 900.0 };
    let idle_arg = js_number_arg(&a, "idle-grace", "600");
    let idle_grace_ms = (if idle_arg.is_finite() && idle_arg > 0.0 { idle_arg } else { 600.0 }) * 1000.0;
    let port_arg = js_number_arg(&a, "port", "0");
    let qdir = jsp::join(&[&cwd, ".impeccable", "questions"]);

    if a.has("schema") {
        io.out(&format!("{}\n", json_pretty(&schema_json())));
        io.out(&format!("{}\n", SCHEMA_NOTE));
        return 0;
    }

    if a.has("wait") {
        let Some(key) = a.arg("key") else {
            io.err("serve-question: --wait needs --key\n");
            return 1;
        };
        let poll_sec = js_number_arg(&a, "poll", "60");
        let deadline = now_ms() + poll_sec * 1000.0;
        let answered = || exists(&answer_file(&qdir, &key));
        let mut saw_close = false;
        while now_ms() < deadline {
            if answered() {
                break;
            }
            if exists(&flip_file(&qdir, &key)) {
                let _ = std::fs::remove_file(flip_file(&qdir, &key));
                io.out("BUILD PATH FLIPPED: comp (for this session only; never write it to settings). The table is still open and the page shows shimmer where the images will land: generate each open card’s comp into its declared path now, lead first, then collect the answer with --wait again. A card whose comp already exists needs nothing.\n");
                return 0;
            }
            if !is_alive(&qdir, &key) {
                io.out("serve-question: the question server is gone with no answer. This is a server failure, not a user decision: restart it with --start and the same payload, reopen the URL for the user, and wait again. Never proceed without their choice while their browser session is open.\n");
                return 2;
            }
            if let Some(state) = read_state(&qdir, &key) {
                let mid_delivery = {
                    let by_file = mtime_ms(&next_file(&qdir, &key)).map(|m| now_ms() - m < NEXT_CLAIM_GRACE_MS).unwrap_or(false);
                    by_file || num_field(&state, "claimedAt").map(|c| c != 0.0 && now_ms() - c < NEXT_CLAIM_GRACE_MS).unwrap_or(false)
                };
                if let Some(lb) = num_field(&state, "lastBeat") {
                    if !mid_delivery && lb != 0.0 && now_ms() - lb > 15000.0 {
                        saw_close = true;
                        break;
                    }
                }
            }
            sleep_ms(1000);
        }
        if saw_close && !answered() {
            io.out("PAGE CLOSED: the question page went away without an answer; re-present, reopen the URL, or fall back to the structured question tool\n");
            return 4;
        }
        if !answered() {
            io.out(&format!("WAITING: no answer yet after {}s; run --wait --key {} again\n", crate::util::js_number_to_string(poll_sec), key));
            return 3;
        }
        let collected = safe_read(&answer_file(&qdir, &key)).unwrap_or_default();
        let collected = crate::util::js_trim(&collected).to_string();
        print_answer(io, &collected);
        let mut keeps_open = false;
        if let Ok(p) = serde_json::from_str::<Value>(&collected) {
            keeps_open = p.get("optionId").and_then(|v| v.as_str()) == Some("reroll") || p.get("followup") == Some(&Value::Bool(true));
        }
        let _ = std::fs::remove_file(answer_file(&qdir, &key));
        if !keeps_open {
            let _ = std::fs::remove_file(state_file(&qdir, &key));
        }
        return 0;
    }

    if a.has("stop") {
        let Some(key) = a.arg("key") else {
            io.err("serve-question: --stop needs --key\n");
            return 1;
        };
        if let Some(state) = read_state(&qdir, &key) {
            if let Some(pid) = state.get("pid").and_then(|p| p.as_f64()) {
                kill_pid(pid as i64);
            }
        }
        let _ = std::fs::remove_file(answer_file(&qdir, &key));
        let _ = std::fs::remove_file(state_file(&qdir, &key));
        io.out("stopped\n");
        return 0;
    }

    if a.has("update") {
        let key = a.arg("key");
        let (Some(key), Some(pp)) = (key, payload_path.clone()) else {
            io.err("serve-question: --update needs --key and --payload\n");
            return 1;
        };
        let next_round = match read_json_file(&jsp::resolve(&cwd, &[&pp])) {
            Ok(v) => v,
            Err(msg) => {
                io.err(&format!("{}\n", msg));
                return 1;
            }
        };
        let ok = next_round.get("options").and_then(|o| o.as_array()).map(|o| !o.is_empty()).unwrap_or(false);
        if !ok {
            io.err("serve-question: --update payload needs an options array; nothing was delivered. Fix the payload and rerun --update on the same key.\n");
            return 1;
        }
        if !is_alive(&qdir, &key) {
            io.err("serve-question: no live question server for that key; the page it served is gone too. Re-present the round with --start and a fresh key, or fall back to the structured question tool.\n");
            return 2;
        }
        let delivered = next_file(&qdir, &key);
        let _ = std::fs::copy(jsp::resolve(&cwd, &[&pp]), &delivered);
        touch_now(&delivered);
        io.out("next round delivered; the page reloads itself\n");
        return 0;
    }

    if a.has("start") {
        let Some(pp) = payload_path.clone() else {
            io.err("serve-question: --start needs --payload <file>\n");
            return 1;
        };
        if let Err(msg) = read_json_file(&jsp::resolve(&cwd, &[&pp])) {
            io.err(&format!("{}\n", msg));
            return 1;
        }
        let _ = std::fs::create_dir_all(&qdir);
        let key = a.arg("key").unwrap_or_else(random_key);
        let log_file = jsp::join(&[&qdir, &format!("{}.log", key)]);
        let log = std::fs::OpenOptions::new().append(true).create(true).open(&log_file);
        let exe = std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| "impeccable".to_string());
        let mut child_args: Vec<String> = vec![
            "serve-question".into(),
            "--payload".into(),
            pp.clone(),
            "--detached-serve".into(),
            "--key".into(),
            key.clone(),
            "--timeout".into(),
            crate::util::js_number_to_string(timeout_sec),
        ];
        if let Some(g) = a.arg("idle-grace") {
            child_args.push("--idle-grace".into());
            child_args.push(g);
        }
        if !a.has("open") {
            child_args.push("--no-open".into());
        }
        let spawned = {
            let mut cmd = std::process::Command::new(&exe);
            cmd.args(&child_args).current_dir(&cwd).stdin(std::process::Stdio::null());
            match log {
                Ok(f) => {
                    let f2 = f.try_clone().ok();
                    cmd.stdout(std::process::Stdio::from(f));
                    if let Some(f2) = f2 {
                        cmd.stderr(std::process::Stdio::from(f2));
                    }
                }
                Err(_) => {
                    cmd.stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
                }
            }
            // JS: spawn(..., { detached: true }) + child.unref()
            impeccable_common::proc::detach(&mut cmd);
            cmd.spawn()
        };
        let _ = spawned; // detached: never waited on
        let deadline = now_ms() + 8000.0;
        while now_ms() < deadline && !exists(&state_file(&qdir, &key)) {
            sleep_ms(100);
        }
        if !exists(&state_file(&qdir, &key)) {
            let tail = safe_read(&log_file)
                .map(|t| {
                    let lines: Vec<&str> = crate::util::js_trim(&t).split('\n').collect();
                    let n = lines.len();
                    lines[n.saturating_sub(4)..].join("\n  ")
                })
                .unwrap_or_default();
            io.err(&format!("serve-question: server failed to start{}\n", if tail.is_empty() { String::new() } else { format!("\n  {}", tail) }));
            let rel = jsp::relative(&cwd, &cwd, &log_file);
            io.err(&format!("serve-question: log at {}. A sandboxed exec that cannot listen on localhost causes exactly this; rerun this command once through the harness's network-enabled or unsandboxed command tool before falling back.\n", if rel.is_empty() { log_file.clone() } else { rel }));
            return 1;
        }
        let state = read_state(&qdir, &key).unwrap_or_default();
        io.out(&format!("QUESTION URL: {}\n", state.get("url").map(js_str).unwrap_or_default()));
        io.out(&format!("QUESTION KEY: {}\n", key));
        io.out("Open the URL for the user now: in-app browser when the harness has one, otherwise the system opener (macOS `open`, Linux `xdg-open`), otherwise show the URL.\n");
        io.out(&format!("Then collect the answer with: {} --wait --key {}\n", crate::provider::detect(&env, &cwd).verb_cmd("serve-question"), key));
        return 0;
    }

    // ---- server (blocking or detached) ----
    let raw = match &payload_path {
        Some(pp) => match std::fs::read(jsp::resolve(&cwd, &[pp])) {
            Ok(b) => String::from_utf8_lossy(&b).into_owned(),
            Err(e) => {
                io.err(&format!("Error: {}\n", crate::util::node_read_error(pp, &e)));
                return 1;
            }
        },
        None => io.stdin().to_string(),
    };
    let detached_key = if a.has("detached-serve") { a.arg("key") } else { None };
    let state = Arc::new(Mutex::new(ServerState::new(cwd.clone(), qdir.clone(), detached_key.clone(), idle_grace_ms)));
    {
        let mut st = state.lock().unwrap();
        if let Err(msg) = st.load_round(&raw) {
            io.err(&format!("serve-question: {}\n", msg));
            return 1;
        }
    }
    let port = if port_arg.is_finite() && port_arg >= 0.0 { port_arg as u16 } else { 0 };
    let server = match tiny_http::Server::http(("127.0.0.1", port)) {
        Ok(s) => s,
        Err(e) => {
            io.err(&format!("Error: listen EADDRINUSE: {}\n", e));
            return 1;
        }
    };
    let actual_port = server.server_addr().to_ip().map(|a| a.port()).unwrap_or(port);
    let url = format!("http://127.0.0.1:{}/", actual_port);
    if a.has("detached-serve") {
        let _ = std::fs::create_dir_all(&qdir);
        let key = a.arg("key").unwrap_or_default();
        let st = json!({ "pid": std::process::id(), "port": actual_port, "url": url });
        let _ = std::fs::write(state_file(&qdir, &key), json_compact(&st));
    } else {
        io.out(&format!("QUESTION URL: {}\n", url));
        io.out("Waiting for the user to choose in the browser (Ctrl-C aborts)...\n");
    }
    if !a.has("no-open") {
        open_system_browser(&url, &env);
    }
    let _ = io.stdout.flush();
    let started_at = now_ms();
    let server = Arc::new(server);
    // Lifetime watchdog thread; exits the process like the JS setInterval.
    {
        let state = state.clone();
        std::thread::spawn(move || loop {
            sleep_ms(2000);
            let st = state.lock().unwrap();
            if st.last_beat_seen.is_none() {
                if timeout_sec > 0.0 && now_ms() - started_at > timeout_sec * 1000.0 {
                    println!("serve-question: timed out with no answer");
                    std::process::exit(2);
                }
            } else if now_ms() - st.last_beat_seen.unwrap() > st.idle_grace_ms {
                let mut delivered_at = 0.0;
                if let Some(nf) = st.next_file() {
                    delivered_at = mtime_ms(&nf).unwrap_or(0.0);
                }
                if now_ms() - delivered_at.max(st.last_claim_at) > NEXT_CLAIM_GRACE_MS {
                    println!("serve-question: the page stopped beating and never came back; exiting");
                    std::process::exit(2);
                }
            }
        });
    }
    for mut request in server.incoming_requests() {
        let method = request.method().as_str().to_string();
        let raw_url = request.url().to_string();
        // JS: every request passes the Host allowlist first; a foreign or
        // missing Host header is a 403.
        let host = request
            .headers()
            .iter()
            .find(|h| h.field.equiv("Host"))
            .map(|h| h.value.as_str().to_string());
        if !allowed_host(host.as_deref(), actual_port) {
            let _ = request.respond(tiny_http::Response::empty(403));
            continue;
        }
        // JS: new URL(req.url, 'http://127.0.0.1'); a target the URL parser
        // rejects is a 400.
        let Some((path, query)) = parse_request_url(&raw_url) else {
            let _ = request.respond(tiny_http::Response::empty(400));
            continue;
        };
        let origin = request
            .headers()
            .iter()
            .find(|h| h.field.equiv("Origin"))
            .map(|h| h.value.as_str().to_string());
        let mut st = state.lock().unwrap();
        if method == "GET" && path == "/" {
            if let Some(pending) = st.next_file() {
                if exists(&pending) {
                    if let Some(text) = safe_read(&pending) {
                        let _ = st.load_round(&text);
                    }
                    let _ = std::fs::remove_file(&pending);
                    st.last_claim_at = now_ms();
                    if let Some(k) = st.detached_key.clone() {
                        if let Some(mut s) = read_state(&st.qdir, &k) {
                            s.insert("claimedAt".into(), Value::from(st.last_claim_at as i64));
                            let _ = std::fs::write(state_file(&st.qdir, &k), json_compact(&Value::Object(s)));
                        }
                    }
                }
            }
            let html = st.page(st.awaiting_next);
            let resp = tiny_http::Response::from_string(html)
                .with_header(tiny_http::Header::from_bytes("content-type", "text/html; charset=utf-8").unwrap());
            let _ = request.respond(resp);
            continue;
        }
        if method == "POST" && path == "/heartbeat" {
            if let Some(code) = reject_detached_post(st.detached_key.as_deref(), origin.as_deref(), &query, actual_port) {
                let _ = request.respond(tiny_http::Response::empty(code));
                continue;
            }
            let _ = request.respond(tiny_http::Response::empty(204));
            st.last_beat_seen = Some(now_ms());
            if let Some(k) = st.detached_key.clone() {
                let now = now_ms();
                if st.last_beat_write.map(|w| now - w > 4000.0).unwrap_or(true) {
                    st.last_beat_write = Some(now);
                    if let Some(mut s) = read_state(&st.qdir, &k) {
                        s.insert("lastBeat".into(), Value::from(now as i64));
                        let _ = std::fs::write(state_file(&st.qdir, &k), json_compact(&Value::Object(s)));
                    }
                }
            }
            continue;
        }
        if method == "GET" && path == "/next-status" {
            let ready = st.next_file().map(|p| exists(&p)).unwrap_or(false);
            let resp = tiny_http::Response::from_string(format!("{{\"ready\":{}}}", ready))
                .with_header(tiny_http::Header::from_bytes("content-type", "application/json").unwrap());
            let _ = request.respond(resp);
            continue;
        }
        if method == "GET" && path.starts_with("/img/") {
            let idx_str: String = path[5..].chars().take_while(|c| c.is_ascii_digit()).collect();
            let rest = &path[5 + idx_str.len()..];
            // JS: the match is now ^\/img\/(\d+)$ over the pathname alone.
            if !idx_str.is_empty() && rest.is_empty() {
                let idx: usize = idx_str.parse().unwrap_or(usize::MAX);
                match st.local_images.get(idx).cloned() {
                    Some(abs) if exists(&abs) && !is_dir(&abs) => {
                        let ty = if abs.ends_with(".webp") {
                            "image/webp"
                        } else if abs.ends_with(".png") {
                            "image/png"
                        } else if abs.ends_with(".svg") {
                            "image/svg+xml"
                        } else if abs.ends_with(".gif") {
                            "image/gif"
                        } else {
                            "image/jpeg"
                        };
                        let bytes = std::fs::read(&abs).unwrap_or_default();
                        let resp = tiny_http::Response::from_data(bytes).with_header(tiny_http::Header::from_bytes("content-type", ty).unwrap());
                        let _ = request.respond(resp);
                    }
                    _ => {
                        let _ = request.respond(tiny_http::Response::empty(404));
                    }
                }
                continue;
            }
        }
        if method == "POST" && (path == "/build-path" || path == "/answer") {
            // JS: both handlers start with rejectDetachedPost (the /answer gate
            // from #555, the /build-path gate from the follow-up commit).
            if let Some(code) = reject_detached_post(st.detached_key.as_deref(), origin.as_deref(), &query, actual_port) {
                let _ = request.respond(tiny_http::Response::empty(code));
                continue;
            }
            let mut body = String::new();
            let _ = std::io::Read::read_to_string(request.as_reader(), &mut body);
            let ok_resp = || tiny_http::Response::from_string("{\"ok\":true}")
                .with_header(tiny_http::Header::from_bytes("content-type", "application/json").unwrap());
            if path == "/build-path" {
                let value = serde_json::from_str::<Value>(&body).ok().and_then(|v| v.get("value").and_then(|x| x.as_str()).map(|s| s.to_string()));
                if let Some(value) = value.filter(|v| v == "comp" || v == "code") {
                    let was_comp = st.live_build_path.as_deref() == Some("comp");
                    st.live_build_path = Some(value.clone());
                    // Only a flip TO comp needs the agent mid-round: comps must
                    // start rendering into the declared slots. The reverse is free.
                    if let Some(k) = st.detached_key.clone() {
                        if value == "comp" && !was_comp {
                            let _ = std::fs::create_dir_all(&st.qdir);
                            let _ = std::fs::write(flip_file(&st.qdir, &k), "{\"buildPath\":\"comp\"}\n");
                        }
                    }
                }
                // Answer only once the flip is on disk. Responding first raced the
                // caller: the 200 reached the client (a separate process) while this
                // one could still be preempted before the write landed, so a poller
                // that trusted the 200 could look for the flip file and miss it.
                let _ = request.respond(ok_resp());
                continue;
            }
            let _ = request.respond(ok_resp());
            // /answer
            let parsed = serde_json::from_str::<Value>(&body).ok().and_then(|v| v.as_object().cloned()).unwrap_or_default();
            let option_id = parsed.get("optionId").cloned().unwrap_or(Value::Null);
            let chosen = st.options.iter().find(|o| o.get("id") == Some(&option_id) && !option_id.is_null()).cloned();
            let is_reroll = option_id.as_str() == Some("reroll");
            let followup_open = st.detached_key.is_some() && st.payload.get("followup") == Some(&Value::Bool(true)) && !is_reroll;
            let mut ans = Map::new();
            ans.insert("optionId".into(), if option_id.is_null() { Value::Null } else { option_id.clone() });
            ans.insert("steer".into(), parsed.get("steer").cloned().filter(|v| !v.is_null()).unwrap_or(Value::String(String::new())));
            if is_reroll {
                if let Some(r) = parsed.get("register").and_then(|v| v.as_str()) {
                    if r == "safer" || r == "bolder" {
                        ans.insert("register".into(), Value::String(r.to_string()));
                    }
                }
            }
            if followup_open {
                ans.insert("followup".into(), Value::Bool(true));
            }
            if let Some(c) = &chosen {
                let hero = c.get("hero").filter(|v| crate::staleness::js_truthy(v));
                let board = c.get("board").filter(|v| crate::staleness::js_truthy(v));
                if hero.is_some() || board.is_some() {
                    ans.insert("hero".into(), c.get("hero").cloned().filter(|v| !v.is_null()).unwrap_or(Value::Null));
                    ans.insert("board".into(), c.get("board").cloned().filter(|v| !v.is_null()).unwrap_or(Value::Null));
                }
                let comp = c.get("comp").filter(|v| !v.is_null()).or_else(|| c.get("sketch").filter(|v| !v.is_null()));
                if let Some(cv) = comp.filter(|v| crate::staleness::js_truthy(v)) {
                    ans.insert("comp".into(), cv.clone());
                }
            }
            if let Some(lbp) = st.live_build_path.clone() {
                if !is_reroll {
                    ans.insert("buildPath".into(), Value::String(lbp.clone()));
                    ans.insert("buildPathFlipped".into(), Value::Bool(Some(lbp.as_str()) != st.build_path_default.as_ref().map(|b| b.0.as_str())));
                }
            }
            let answer = json_compact(&Value::Object(ans));
            let was_awaiting = st.awaiting_next;
            st.awaiting_next = (is_reroll || followup_open) && st.detached_key.is_some();
            if st.awaiting_next && !was_awaiting {
                st.awaiting_next_since = now_ms();
            }
            if let Some(k) = st.detached_key.clone() {
                let _ = std::fs::create_dir_all(&st.qdir);
                let _ = std::fs::write(answer_file(&st.qdir, &k), format!("{}\n", answer));
            } else {
                print_answer(io, &answer);
                let _ = io.stdout.flush();
            }
            if !((is_reroll || followup_open) && st.detached_key.is_some()) {
                drop(st);
                sleep_ms(150);
                let _ = io.stdout.flush();
                return 0;
            }
            continue;
        }
        let _ = request.respond(tiny_http::Response::empty(404));
    }
    0
}

use std::io::Write;

/// JS: serve-question.mjs#allowedHost — browsers omit the :80 suffix on the
/// default HTTP port, so a server on --port 80 sees bare loopback hosts.
fn allowed_host(host: Option<&str>, port: u16) -> bool {
    let Some(host) = host else { return false };
    if host == format!("127.0.0.1:{}", port) || host == format!("localhost:{}", port) {
        return true;
    }
    port == 80 && (host == "127.0.0.1" || host == "localhost")
}

/// JS: serve-question.mjs#allowedOrigin
fn allowed_origin(origin: &str, port: u16) -> bool {
    if origin == format!("http://127.0.0.1:{}", port) || origin == format!("http://localhost:{}", port) {
        return true;
    }
    port == 80 && (origin == "http://127.0.0.1" || origin == "http://localhost")
}

/// JS: serve-question.mjs#rejectDetachedPost. Returns the status to answer
/// with (401/403) when the POST must be rejected, None when it may proceed.
fn reject_detached_post(detached_key: Option<&str>, origin: Option<&str>, query: &str, port: u16) -> Option<u16> {
    if let Some(key) = detached_key {
        if query_param(query, "key").as_deref() != Some(key) {
            return Some(401);
        }
    }
    if let Some(o) = origin {
        if !allowed_origin(o, port) {
            return Some(403);
        }
    }
    None
}

/// JS: url.searchParams.get(name) over the search string (no leading '?').
fn query_param(query: &str, name: &str) -> Option<String> {
    for pair in query.split('&') {
        if pair.is_empty() {
            continue;
        }
        let (k, v) = match pair.split_once('=') {
            Some((k, v)) => (k, v),
            None => (pair, ""),
        };
        if form_decode(k) == name {
            return Some(form_decode(v));
        }
    }
    None
}

/// application/x-www-form-urlencoded decode: '+' is space, %XX is a byte.
fn form_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len()
                && bytes[i + 1].is_ascii_hexdigit()
                && bytes[i + 2].is_ascii_hexdigit() =>
            {
                let h = std::str::from_utf8(&bytes[i + 1..i + 3]).ok().and_then(|x| u8::from_str_radix(x, 16).ok());
                if let Some(v) = h {
                    out.push(v);
                    i += 3;
                } else {
                    out.push(bytes[i]);
                    i += 1;
                }
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// JS: `new URL(req.url, 'http://127.0.0.1')` -> (pathname, search sans '?').
/// None where the URL constructor would throw (a protocol-relative target
/// whose host carries forbidden code points).
fn parse_request_url(raw: &str) -> Option<(String, String)> {
    // Same input cleaning the URL parser applies.
    let trimmed = raw.trim_matches(|c: char| (c as u32) <= 0x20);
    let cleaned: String = trimmed.chars().filter(|c| !matches!(c, '\t' | '\n' | '\r')).collect();
    let starts_slashy = |s: &str, n: usize| s.chars().take(n).filter(|c| *c == '/' || *c == '\\').count() == n;
    let abs = if starts_slashy(&cleaned, 2) {
        // Protocol-relative reference: the authority is taken from the target.
        format!("http:{}", cleaned)
    } else if starts_slashy(&cleaned, 1) {
        format!("http://127.0.0.1{}", cleaned)
    } else {
        // A relative target resolves against the base path '/'.
        format!("http://127.0.0.1/{}", cleaned)
    };
    let u = crate::url::parse(&abs)?;
    let search = u.search.strip_prefix('?').unwrap_or("").to_string();
    Some((u.pathname, search))
}

fn touch_now(p: &str) {
    // Update mtime to now: rewrite the bytes (portable, no filetime crate).
    if let Ok(b) = std::fs::read(p) {
        let _ = std::fs::write(p, b);
    }
}

fn random_key() -> String {
    // Math.random().toString(16).slice(2, 10)
    let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let mut x = (t as u64) ^ ((std::process::id() as u64) << 32) ^ 0x9E3779B97F4A7C15;
    x ^= x >> 33;
    x = x.wrapping_mul(0xff51afd7ed558ccd);
    x ^= x >> 33;
    format!("{:08x}", (x & 0xffffffff) as u32)
}

pub fn open_system_browser(url: &str, env: &Env) -> bool {
    let (cmd, args): (String, Vec<String>) = if cfg!(target_os = "macos") {
        ("open".into(), vec![url.to_string()])
    } else if cfg!(windows) {
        let comspec = env.get("ComSpec").or_else(|| env.get("COMSPEC")).cloned().unwrap_or_else(|| "cmd.exe".into());
        (comspec, vec!["/c".into(), "start".into(), String::new(), url.to_string()])
    } else {
        ("xdg-open".into(), vec![url.to_string()])
    };
    // JS (lib/open-system-browser.mjs): spawn(command, args, { stdio: 'ignore',
    // detached: true }) + unref(). The Windows form is `cmd /c start "" <url>`
    // exactly as the JS spawned it; the URL is a localhost one this process
    // built, so cmd metacharacters are not a concern there.
    let mut c = std::process::Command::new(cmd);
    c.args(args).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    impeccable_common::proc::detach(&mut c);
    c.spawn().is_ok()
}

// ─── round state + page rendering ──────────────────────────────────────────

struct ServerState {
    cwd: String,
    qdir: String,
    detached_key: Option<String>,
    idle_grace_ms: f64,
    payload: Value,
    options: Vec<Value>,
    local_images: Vec<String>,
    build_path_default: Option<(String, bool)>,
    live_build_path: Option<String>,
    awaiting_next: bool,
    awaiting_next_since: f64,
    last_beat_seen: Option<f64>,
    last_beat_write: Option<f64>,
    last_claim_at: f64,
}

fn esc(v: &Value) -> String {
    let s = match v {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        other => js_str(other),
    };
    esc_s(&s)
}

fn esc_s(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn get<'a>(o: &'a Value, k: &str) -> Option<&'a Value> {
    o.get(k).filter(|v| !v.is_null())
}
fn truthy(o: &Value, k: &str) -> bool {
    o.get(k).map(crate::staleness::js_truthy).unwrap_or(false)
}
fn str_of(o: &Value, k: &str) -> Option<String> {
    get(o, k).filter(|v| crate::staleness::js_truthy(v)).map(js_str)
}

impl ServerState {
    fn new(cwd: String, qdir: String, detached_key: Option<String>, idle_grace_ms: f64) -> ServerState {
        ServerState {
            cwd,
            qdir,
            detached_key,
            idle_grace_ms,
            payload: Value::Null,
            options: vec![],
            local_images: vec![],
            build_path_default: None,
            live_build_path: None,
            awaiting_next: false,
            awaiting_next_since: 0.0,
            last_beat_seen: None,
            last_beat_write: None,
            last_claim_at: 0.0,
        }
    }

    fn next_file(&self) -> Option<String> {
        self.detached_key.as_ref().map(|k| next_file(&self.qdir, k))
    }

    /// JS: loadRound(json)
    fn load_round(&mut self, json: &str) -> Result<(), String> {
        let parsed: Value = serde_json::from_str(json).map_err(|e| format!("{}", e))?;
        let ok = parsed.get("options").and_then(|o| o.as_array()).map(|o| !o.is_empty()).unwrap_or(false);
        if !ok {
            return Err("payload needs an options array".into());
        }
        let mut local_images: Vec<String> = Vec::new();
        let cwd = self.cwd.clone();
        let is_url = |s: &str| s.starts_with("http://") || s.starts_with("https://");
        fn image_src(cwd: &str, local_images: &mut Vec<String>, value: Option<&Value>) -> Value {
            let Some(v) = value.filter(|v| crate::staleness::js_truthy(v)) else { return Value::Null };
            let s = js_str(v);
            if s.starts_with("http://") || s.starts_with("https://") {
                return Value::String(s);
            }
            let abs = jsp::resolve(cwd, &[&s]);
            if !exists(&abs) {
                return Value::Null;
            }
            local_images.push(abs);
            Value::String(format!("/img/{}", local_images.len() - 1))
        }
        let mut decorated: Vec<Value> = Vec::new();
        let opts = parsed.get("options").unwrap().as_array().unwrap().clone();
        let canon_card = parsed.get("canonCard").filter(|c| c.is_object() || c.is_array());
        let mut decorate = |option: &Value| -> Value {
            let mut m = option.as_object().cloned().unwrap_or_default();
            let hero = image_src(&cwd, &mut local_images, option.get("hero"));
            let board = image_src(&cwd, &mut local_images, option.get("board"));
            let comp_val = option.get("comp").filter(|v| !v.is_null()).or_else(|| option.get("sketch").filter(|v| !v.is_null()));
            let comp = match comp_val.filter(|v| crate::staleness::js_truthy(v)) {
                None => Value::Null,
                Some(v) => {
                    let s = js_str(v);
                    if is_url(&s) {
                        Value::String(s)
                    } else {
                        local_images.push(jsp::resolve(&cwd, &[&s]));
                        Value::String(format!("/img/{}", local_images.len() - 1))
                    }
                }
            };
            m.insert("heroSrc".into(), hero);
            m.insert("boardSrc".into(), board);
            m.insert("compSrc".into(), comp);
            Value::Object(m)
        };
        for o in &opts {
            decorated.push(decorate(o));
        }
        let canon_decorated = canon_card.map(|c| {
            let mut v = decorate(c);
            if let Some(m) = v.as_object_mut() {
                m.insert("id".into(), Value::String("canon".into()));
                m.insert("isCanon".into(), Value::Bool(true));
            }
            v
        });
        let declined: Vec<Value> = decorated.iter().filter(|o| o.get("verdict").and_then(|v| v.as_str()) == Some("declined")).cloned().collect();
        let mut options: Vec<Value> = decorated.into_iter().filter(|o| o.get("verdict").and_then(|v| v.as_str()) != Some("declined")).collect();
        if let Some(c) = canon_decorated {
            options.push(c);
        }
        options.extend(declined);
        self.payload = parsed.clone();
        self.options = options;
        self.local_images = local_images;
        self.build_path_default = parsed.get("buildPath").filter(|b| crate::staleness::js_truthy(b)).and_then(|b| {
            let v = b.get("value").and_then(|x| x.as_str())?;
            if v == "comp" || v == "code" {
                Some((v.to_string(), b.get("toggle") == Some(&Value::Bool(true))))
            } else {
                None
            }
        });
        self.live_build_path = self.build_path_default.as_ref().map(|b| b.0.clone());
        self.awaiting_next = false;
        Ok(())
    }

    /// JS: page(waiting)
    fn page(&self, waiting: bool) -> String {
        let wait_budget_ms = if waiting { (self.awaiting_next_since + self.idle_grace_ms - now_ms()).max(0.0) } else { self.idle_grace_ms };
        let flip_chip = |label: &str| format!("<button type=\"button\" class=\"chip flip\" aria-label=\"Flip the card\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M12 4a8 8 0 1 1-8 8\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\"/><path d=\"M4 5.5V12h6.5\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg><span>{}</span></button>", label);
        let expand_chip = "<button type=\"button\" class=\"chip expand\" aria-label=\"Expand the image\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M4 9V4h5M20 15v5h-5M20 9V4h-5M4 15v5h5\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg></button>";
        let fact = |label: &str, value: Option<&Value>, cls: &str| -> String {
            match value.filter(|v| crate::staleness::js_truthy(v)) {
                Some(v) => format!("<p class=\"fact{}\"><span class=\"fact-label\">{}</span>{}</p>", if cls.is_empty() { String::new() } else { format!(" {}", cls) }, label, esc(v)),
                None => String::new(),
            }
        };
        let demoted = |o: &Value| o.get("verdict").and_then(|v| v.as_str()) == Some("declined");
        let build_path = self.build_path_default.clone();
        let code_led = build_path.as_ref().map(|b| b.0 == "code").unwrap_or(false);
        let has = |o: &Value, k: &str| truthy(o, k);
        let identity_round = !(self.options.first().map(|o| has(o, "compSrc") || has(o, "heroSrc") || has(o, "boardSrc")).unwrap_or(false));
        let face_comp = |o: &Value| -> Option<String> { if demoted(o) || code_led { None } else { str_of(o, "compSrc") } };
        let thumb_only = |o: &Value| face_comp(o).is_none() && (has(o, "heroSrc") || has(o, "boardSrc")) && (demoted(o) || identity_round);
        let has_media = |o: &Value| face_comp(o).is_some() || ((has(o, "heroSrc") || has(o, "boardSrc")) && !thumb_only(o));
        let has_back = |o: &Value| has_media(o) && (has(o, "viewport") || has(o, "case") || (has(o, "boardSrc") && has(o, "heroSrc")));
        let options = &self.options;
        let anatomy = |o: &Value| -> String {
            let mut rows: Vec<String> = Vec::new();
            if let Some(t) = get(o, "thesis").filter(|v| crate::staleness::js_truthy(v)) {
                rows.push(format!("<p class=\"thesis\">{}</p>", esc(t)));
            }
            let mut id_bits: Vec<String> = Vec::new();
            if let Some(p) = o.get("palette").and_then(|p| p.as_array()).filter(|p| !p.is_empty()) {
                let sw: String = p.iter().take(6).map(|c| format!("<i style=\"background:{}\" title=\"{}\"></i>", esc(c), esc(c))).collect();
                id_bits.push(format!("<span class=\"swatches\">{}</span>", sw));
            }
            if let Some(m) = o.get("materials").and_then(|p| p.as_array()).filter(|p| !p.is_empty()) {
                id_bits.push(m.iter().take(4).map(|x| format!("<span class=\"tag\">{}</span>", esc(x))).collect::<Vec<_>>().join(""));
            }
            if !id_bits.is_empty() {
                rows.push(format!("<div class=\"identity\">{}</div>", id_bits.join("")));
            }
            if let Some(raised) = o.get("raised").and_then(|r| r.as_array()).filter(|r| !r.is_empty()) {
                let name_of = |id: Option<&Value>| -> String {
                    let found = id.and_then(|i| options.iter().find(|x| x.get("id") == Some(i)));
                    match found.and_then(|f| str_of(f, "label")) {
                        Some(l) => l,
                        None => match id {
                            None | Some(Value::Null) => String::new(),
                            Some(v) => js_str(v),
                        },
                    }
                };
                let raise_lines: Vec<String> = raised
                    .iter()
                    .take(6)
                    .map(|r| {
                        let text = get(r, "raise").filter(|v| crate::staleness::js_truthy(v)).or_else(|| get(r, "kept").filter(|v| crate::staleness::js_truthy(v)));
                        format!("<p class=\"raise\"><span class=\"fact-label\">From {}</span>{}</p>", esc_s(&name_of(r.get("from"))), text.map(esc).unwrap_or_default())
                    })
                    .collect();
                let raises_head = |count: usize| -> String {
                    format!(
                        "<div class=\"raises-head\"><span class=\"fact-label\">Improved by Impeccable's worlds</span>{}</div>",
                        if count > 1 { format!("<span class=\"raises-count\" data-raises-count>1/{}</span>", count) } else { String::new() }
                    )
                };
                if raise_lines.len() > 1 {
                    rows.push(format!(
                        "<div class=\"raises raises-cycle\" role=\"button\" tabindex=\"0\" title=\"Click or press Enter for the next improvement\" aria-label=\"How Impeccable's worlds improved this direction; activate to see the next improvement\">\n              {}\n              {}\n              <span class=\"sr-live\" aria-live=\"polite\"></span>\n            </div>",
                        raises_head(raise_lines.len()),
                        raise_lines.join("")
                    ));
                } else {
                    rows.push(format!("<div class=\"raises\">{}{}</div>", raises_head(1), raise_lines[0]));
                }
            }
            if thumb_only(o) {
                let src = str_of(o, "heroSrc").or_else(|| str_of(o, "boardSrc")).unwrap_or_default();
                rows.push(format!("<figure class=\"inspo\" title=\"Inspiration: the world this direction draws from. Your page will not look like this image.\"><img src=\"{}\" alt=\"\"><figcaption>inspired by</figcaption></figure>", esc_s(&src)));
            }
            if has_media(o) {
                rows.push(fact("Risk", o.get("risk"), "clamp"));
            } else {
                rows.push(fact("First viewport", o.get("viewport"), ""));
                rows.push(fact("The case", o.get("case"), ""));
                rows.push(fact("Kept", o.get("kept"), ""));
                rows.push(fact("Risk", o.get("risk"), ""));
            }
            if !has(o, "thesis") && has(o, "body") {
                rows.push(format!("<p class=\"detail\">{}</p>", esc(o.get("body").unwrap())));
            } else if has(o, "body") && has(o, "thesis") && !has_back(o) {
                rows.push(format!("<p class=\"detail more\">{}</p>", esc(o.get("body").unwrap())));
            }
            rows.join("\n            ")
        };
        let back_facts = |o: &Value| -> String {
            let parts = [
                fact("First viewport", o.get("viewport"), ""),
                fact("The case", o.get("case"), ""),
                fact("Kept", o.get("kept"), ""),
                fact("Risk", o.get("risk"), ""),
                if has(o, "body") && has(o, "thesis") { format!("<p class=\"detail more\">{}</p>", esc(o.get("body").unwrap())) } else { String::new() },
            ];
            parts.iter().filter(|p| !p.is_empty()).cloned().collect::<Vec<_>>().join("\n            ")
        };
        let media = |o: &Value| -> String {
            let inspiration_src = str_of(o, "heroSrc").or_else(|| str_of(o, "boardSrc"));
            let inspiration = match &inspiration_src {
                Some(src) => format!("<figure class=\"pip\" title=\"Inspiration: the world this direction draws from. Your page will not look like this image.\">\n              <img src=\"{}\" alt=\"\">\n              <figcaption>inspiration</figcaption>\n            </figure>", esc_s(src)),
                None => String::new(),
            };
            let details = if has_back(o) { flip_chip("Details") } else { String::new() };
            if thumb_only(o) {
                return String::new();
            }
            if face_comp(o).is_some() {
                let text_only_facts = back_facts(o);
                return format!(
                    "<div class=\"media comp-pending\" data-comp=\"{}\">\n            <div class=\"shimmer\"><span class=\"comp-note\">rendering&hellip;</span></div>\n            <img class=\"comp\" alt=\"\" hidden>\n            {}\n            <template class=\"text-only-facts\">{}</template>\n            <div class=\"chips\">{}{}</div>\n          </div>",
                    esc_s(&str_of(o, "compSrc").unwrap_or_default()),
                    inspiration,
                    text_only_facts,
                    expand_chip,
                    details
                );
            }
            if has(o, "heroSrc") || has(o, "boardSrc") {
                return format!(
                    "<div class=\"media\" title=\"Inspiration: the world this direction draws from. Your page will not look like this image.\">\n            <img src=\"{}\" alt=\"\">\n            <p class=\"media-label\">inspiration</p>\n            <div class=\"chips\">{}{}</div>\n          </div>",
                    esc_s(&str_of(o, "heroSrc").or_else(|| str_of(o, "boardSrc")).unwrap_or_default()),
                    expand_chip,
                    details
                );
            }
            String::new()
        };
        let num_of = |v: Option<&Value>| -> f64 {
            match v {
                None | Some(Value::Null) => 0.0,
                Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
                Some(Value::Bool(b)) => {
                    if *b {
                        1.0
                    } else {
                        0.0
                    }
                }
                Some(Value::String(s)) => crate::critique_storage::js_number(s),
                Some(_) => f64::NAN,
            }
        };
        let wire = |o: &Value| -> String {
            let Some(frame) = get(o, "wireframe").filter(|v| crate::staleness::js_truthy(v)) else { return String::new() };
            let Some(regions) = frame.get("regions").and_then(|r| r.as_array()).filter(|r| !r.is_empty()) else { return String::new() };
            if !media(o).is_empty() || demoted(o) {
                return String::new();
            }
            let cols_n = num_of(frame.get("cols"));
            let cols = if cols_n > 0.0 { cols_n } else { 12.0 };
            let rows_n = num_of(frame.get("rows"));
            let rows = if rows_n > 0.0 { rows_n } else { 10.0 };
            let pct = |n: f64, total: f64| -> String { format!("{}%", crate::util::to_fixed(((n / total) * 100.0).min(100.0).max(0.0), 2)) };
            let cells: String = regions
                .iter()
                .take(12)
                .map(|r| {
                    let x = { let v = num_of(r.get("x")); if v.is_nan() || v == 0.0 { 0.0 } else { v } };
                    let y = { let v = num_of(r.get("y")); if v.is_nan() || v == 0.0 { 0.0 } else { v } };
                    let w = { let v = num_of(r.get("w")); (if v.is_nan() || v == 0.0 { 1.0 } else { v }).max(0.5) };
                    let h = { let v = num_of(r.get("h")); (if v.is_nan() || v == 0.0 { 1.0 } else { v }).max(0.5) };
                    format!(
                        "<div class=\"wire-region{}\" style=\"left:{};top:{};width:{};height:{}\"><span>{}</span></div>",
                        if truthy(r, "accent") { " accent" } else { "" },
                        pct(x, cols),
                        pct(y, rows),
                        pct(w, cols),
                        pct(h, rows),
                        esc_s(&str_of(r, "label").unwrap_or_default())
                    )
                })
                .collect();
            format!("<div class=\"media wire\" role=\"img\" aria-label=\"Layout schematic\">\n            <div class=\"wire-field\">{}</div>\n            <p class=\"media-label\">layout</p>\n          </div>", cells)
        };
        let choose_label = |o: &Value| if truthy(o, "isCanon") { "Play it straight" } else if demoted(o) { "Adopt anyway" } else { "Build this" };
        let cards: Vec<String> = options
            .iter()
            .enumerate()
            .map(|(index, o)| {
                let media_html = media(o);
                let wire_html = if media_html.is_empty() { wire(o) } else { String::new() };
                let media_or_wire = if !media_html.is_empty() { media_html.clone() } else { wire_html.clone() };
                let id_esc = esc(o.get("id").unwrap_or(&Value::Null));
                let kicker = if has(o, "kicker") {
                    format!("<span class=\"kicker\">{}</span>", esc(o.get("kicker").unwrap()))
                } else if demoted(o) {
                    "<span class=\"kicker declined-k\">Declined</span>".to_string()
                } else if truthy(o, "isCanon") {
                    "<span class=\"kicker standing\">The standing door</span>".to_string()
                } else {
                    String::new()
                };
                let label_esc = esc(o.get("label").unwrap_or(&Value::Null));
                let back = if has_back(o) {
                    let board = str_of(o, "boardSrc");
                    format!(
                        "<div class=\"face back{}\">\n          {}\n          <div class=\"body back-body\">\n            {}\n            {}\n            <button class=\"choose\" data-id=\"{}\">{}</button>\n          </div>\n        </div>",
                        if index == 0 { " lead" } else { "" },
                        match &board {
                            Some(b) => format!("<div class=\"media back-media\">\n            <img src=\"{}\" alt=\"\">\n            <div class=\"chips\">{}{}</div>\n          </div>", esc_s(b), expand_chip, flip_chip("Front")),
                            None => format!("<div class=\"back-head\"><p class=\"tier\">The full read &middot; {}</p>{}</div>", label_esc, flip_chip("Front")),
                        },
                        if board.is_some() { format!("<p class=\"tier\">The full read &middot; {}</p>", label_esc) } else { String::new() },
                        back_facts(o),
                        id_esc,
                        choose_label(o)
                    )
                } else {
                    String::new()
                };
                format!(
                    "\n    <article class=\"card{}{}\" style=\"--fan:{};--deal:{}ms\" data-id=\"{}\"{}>\n      <div class=\"card-inner\">\n        <div class=\"face front{}{}\">\n          {}\n          {}\n          <div class=\"body\">\n            {}\n            <h2>{}</h2>\n            {}\n            <button class=\"choose\" data-id=\"{}\">{}</button>\n          </div>\n        </div>\n        {}\n      </div>\n    </article>",
                    if truthy(o, "isCanon") { " canon" } else { "" },
                    if demoted(o) { " declined" } else { "" },
                    if index == 0 { "0deg" } else if index % 2 == 1 { "1.4deg" } else { "-1.2deg" },
                    index * 90,
                    id_esc,
                    if code_led && has(o, "compSrc") && !demoted(o) { format!(" data-comp-slot=\"{}\"", esc_s(&str_of(o, "compSrc").unwrap_or_default())) } else { String::new() },
                    if index == 0 { " lead" } else { "" },
                    if media_or_wire.is_empty() { " text-only" } else { "" },
                    kicker,
                    media_or_wire,
                    if has(o, "lineage") { format!("<p class=\"tier\">{}</p>", esc(o.get("lineage").unwrap())) } else { String::new() },
                    label_esc,
                    anatomy(o),
                    id_esc,
                    choose_label(o),
                    back
                )
            })
            .collect();
        let cards_html = cards.join("\n");
        let payload = &self.payload;
        let title_default = |d: &str| -> String {
            match get(payload, "title").filter(|v| crate::staleness::js_truthy(v)) {
                Some(t) => esc(t),
                None => esc_s(d),
            }
        };
        let toggle = build_path.as_ref().map(|b| b.1).unwrap_or(false);
        let bp_confirm = if toggle {
            "<div id=\"bp-confirm\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"bp-confirm-title\" hidden>\n  <div class=\"bp-confirm-panel\">\n    <h2 id=\"bp-confirm-title\">Flip to comp-first?</h2>\n    <p>The agent starts rendering a comp for every open card right away, about a minute or two per card on your image provider, and the images land on the cards as they finish. This flip binds this session only.</p>\n    <div class=\"bp-confirm-actions\">\n      <button type=\"button\" class=\"bp-confirm-go\" data-confirm>Render comps</button>\n      <button type=\"button\" class=\"bp-confirm-stay\" data-cancel>Keep code-first</button>\n    </div>\n  </div>\n</div>".to_string()
        } else {
            String::new()
        };
        let bp_switch = if toggle {
            format!("<div id=\"build-path\" data-default=\"{}\">\n        <div class=\"bp-switch\" role=\"radiogroup\" aria-label=\"Build path\">\n          <button type=\"button\" class=\"bp-opt\" data-bp=\"comp\" role=\"radio\" aria-checked=\"false\">Comp first</button>\n          <button type=\"button\" class=\"bp-opt\" data-bp=\"code\" role=\"radio\" aria-checked=\"false\">Code first</button>\n        </div>\n        <p class=\"bp-note\" data-bp-note></p>\n      </div>", build_path.as_ref().unwrap().0)
        } else {
            String::new()
        };
        let question = match get(payload, "question").filter(|v| crate::staleness::js_truthy(v)) {
            Some(q) => format!("<p class=\"question\">{}</p>", esc(q)),
            None => String::new(),
        };
        let steer = if truthy(payload, "steer") { "<input id=\"steer\" placeholder=\"Optional steer: what should be different or kept?\">" } else { "" };
        let reroll_footer = if truthy(payload, "reroll") {
            let die = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\"/><circle cx=\"8.4\" cy=\"8.4\" r=\"1.5\" fill=\"currentColor\"/><circle cx=\"15.6\" cy=\"8.4\" r=\"1.5\" fill=\"currentColor\"/><circle cx=\"8.4\" cy=\"15.6\" r=\"1.5\" fill=\"currentColor\"/><circle cx=\"15.6\" cy=\"15.6\" r=\"1.5\" fill=\"currentColor\"/><circle cx=\"12\" cy=\"12\" r=\"1.5\" fill=\"currentColor\"/></svg>";
            let registers: Vec<&str> = payload
                .get("reroll")
                .and_then(|r| r.get("registers"))
                .and_then(|r| r.as_array())
                .map(|a| a.iter().filter_map(|v| v.as_str()).filter(|s| *s == "safer" || *s == "bolder").collect())
                .unwrap_or_default();
            let safer = if registers.contains(&"safer") { "<button class=\"reroll-btn\" id=\"reroll-safer\" title=\"Deal the familiar register: conventional grounded directions plus the category standard against named competitors\"><span>&larr; Safer hand</span></button>" } else { "" };
            let bolder = if registers.contains(&"bolder") { "<button class=\"reroll-btn\" id=\"reroll-bolder\" title=\"Deal foreign forms only, at full commitment\"><span>Bolder hand &rarr;</span></button>" } else { "" };
            format!("{}<button class=\"reroll-btn\" id=\"reroll\">{}<span>Re-roll</span></button>{}", safer, die, bolder)
        } else {
            String::new()
        };
        let canon = if truthy(payload, "canon") && !truthy(payload, "canonCard") {
            "<button id=\"canon\" title=\"Skip the roll: build the page this category ships, executed impeccably\">Play it straight</button>"
        } else {
            ""
        };
        let followup = if payload.get("followup") == Some(&Value::Bool(true)) && self.detached_key.is_some() { "true" } else { "false" };
        let beat = if waiting && wait_budget_ms <= 0.0 { "" } else { "beat();" };
        let await_next = if waiting { format!("awaitNextRound(false, {});", crate::util::js_number_to_string(wait_budget_ms)) } else { String::new() };
        // JS: const KEY = ${JSON.stringify(detachedKey || '')};
        let key_json = serde_json::to_string(self.detached_key.as_deref().unwrap_or("")).unwrap_or_else(|_| "\"\"".into());
        let subs: [(&str, String); 15] = [
            ("@@1@@", title_default("impeccable · decision")),
            ("@@2@@", expand_chip.to_string()),
            ("@@3@@", bp_confirm),
            ("@@4@@", title_default("Choose a direction")),
            ("@@5@@", bp_switch),
            ("@@6@@", question),
            ("@@7@@", cards_html),
            ("@@8@@", steer.to_string()),
            ("@@9@@", reroll_footer),
            ("@@10@@", canon.to_string()),
            ("@@11@@", followup.to_string()),
            ("@@12@@", beat.to_string()),
            ("@@13@@", crate::util::js_number_to_string(self.idle_grace_ms)),
            ("@@14@@", await_next),
            ("@@15@@", key_json),
        ];
        let mut html = PAGE.to_string();
        // Replace higher numbers first so @@1@@ does not clobber @@10@@..@@15@@.
        for (k, v) in subs.iter().rev() {
            html = html.replace(k, v);
        }
        let _ = (utf16_len(""), iso_now());
        html
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // JS scenarios: tests/serve-question.test.mjs (public repo main,
    // eaaecbd1 + 2e075dc5 + 7982002d).

    #[test]
    fn allowed_host_exact_match_only() {
        assert!(allowed_host(Some("127.0.0.1:4321"), 4321));
        assert!(allowed_host(Some("localhost:4321"), 4321));
        assert!(!allowed_host(Some("evil.example:4321"), 4321));
        assert!(!allowed_host(Some("127.0.0.1:4322"), 4321));
        assert!(!allowed_host(None, 4321));
        // Bare loopback only passes on port 80, where browsers omit the suffix.
        assert!(!allowed_host(Some("127.0.0.1"), 4321));
        assert!(!allowed_host(Some("localhost"), 4321));
        assert!(allowed_host(Some("127.0.0.1"), 80));
        assert!(allowed_host(Some("localhost"), 80));
        assert!(allowed_host(Some("127.0.0.1:80"), 80));
        assert!(!allowed_host(Some("evil.example"), 80));
    }

    #[test]
    fn allowed_origin_exact_match_only() {
        assert!(allowed_origin("http://127.0.0.1:4321", 4321));
        assert!(allowed_origin("http://localhost:4321", 4321));
        assert!(!allowed_origin("https://evil.example", 4321));
        assert!(!allowed_origin("http://127.0.0.1", 4321));
        assert!(allowed_origin("http://127.0.0.1", 80));
        assert!(allowed_origin("http://localhost", 80));
        assert!(!allowed_origin("https://127.0.0.1", 80));
    }

    #[test]
    fn reject_detached_post_requires_key_then_origin() {
        // No detached key: no key check, origin still gated.
        assert_eq!(reject_detached_post(None, None, "", 4321), None);
        assert_eq!(reject_detached_post(None, Some("https://evil.example"), "", 4321), Some(403));
        // Detached: missing or wrong key is 401 before any origin look.
        assert_eq!(reject_detached_post(Some("seckey"), None, "", 4321), Some(401));
        assert_eq!(reject_detached_post(Some("seckey"), None, "key=wrong", 4321), Some(401));
        assert_eq!(reject_detached_post(Some("seckey"), Some("https://evil.example"), "", 4321), Some(401));
        // Right key, bad origin: 403.
        assert_eq!(reject_detached_post(Some("seckey"), Some("https://evil.example"), "key=seckey", 4321), Some(403));
        // Right key, no or loopback origin: allowed.
        assert_eq!(reject_detached_post(Some("seckey"), None, "key=seckey", 4321), None);
        assert_eq!(reject_detached_post(Some("seckey"), Some("http://127.0.0.1:4321"), "key=seckey", 4321), None);
        // Percent-encoded keys decode the way URLSearchParams does.
        assert_eq!(reject_detached_post(Some("a b"), None, "key=a%20b", 4321), None);
        assert_eq!(reject_detached_post(Some("a b"), None, "key=a+b", 4321), None);
    }

    #[test]
    fn parse_request_url_matches_new_url_semantics() {
        assert_eq!(parse_request_url("/"), Some(("/".into(), String::new())));
        assert_eq!(parse_request_url("/answer"), Some(("/answer".into(), String::new())));
        assert_eq!(parse_request_url("/answer?key=tk"), Some(("/answer".into(), "key=tk".into())));
        assert_eq!(parse_request_url("/img/3"), Some(("/img/3".into(), String::new())));
        assert_eq!(parse_request_url("/img/3?x=1"), Some(("/img/3".into(), "x=1".into())));
        // Protocol-relative target with an empty host: the URL ctor throws -> 400.
        assert_eq!(parse_request_url("//"), None);
        assert_eq!(parse_request_url("//evil host/x"), None);
        // Dot segments normalize like the URL parser.
        assert_eq!(parse_request_url("/x/../answer"), Some(("/answer".into(), String::new())));
    }
}
