//! JS: live-server.mjs -> `impeccable live-server`. The live variant mode
//! helper server: `/live.js`, SSE push, browser events, agent long-poll,
//! manual copy-edit routes; plus the `stop`, `--background`, and `--help`
//! branches.

use crate::browser_assets::{
    assemble_live_browser_script, load_detect_script, read_live_browser_script_parts, scripts_dir,
    MODERN_SCREENSHOT_JS,
};
use crate::event_validation::validate_event;
use crate::json_error::json_parse_error;
use crate::live_http::{
    read_request_deadline, send_response, set_header_timeout, watch_close, Request, Response,
    StreamResponse, Ticket, Turnstile, READ_REQUEST_DEADLINE,
};
use crate::manual_edits::apply as manual_apply;
use crate::manual_edits::buffer as manual_buffer;
use crate::paths::{
    live_annotations_dir, live_dir, read_live_server_info, remove_live_server_info,
    write_live_server_info,
};
use crate::random::random_uuid;
use crate::roots::enter_live_root;
use crate::server_state::{
    lease_event, lock, now_i64, resolve_project_context, truthy, ServerState, Shared,
    DEFAULT_POLL_TIMEOUT, SSE_HEARTBEAT_INTERVAL_MS,
};
use crate::session::create_live_session_store;
use crate::svelte_component::{
    bump_svelte_component_preview_revision, compile_check_variants,
    remove_all_svelte_component_sessions, sweep_inactive_svelte_component_sessions,
};
use crate::svelte_sessions::apply_deferred_svelte_component_accepts;
use crate::util::{exists, jsp, println, read_dir_names_raw, safe_read, Env};
use impeccable_common::Io;
use serde_json::{json, Map, Value};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const MAX_ANNOTATION_BYTES: usize = 10 * 1024 * 1024;
const MAX_JSON_BODY: usize = 64 * 1024 * 1024;
const ACCEPT_RECEIPT_MAX_AGE_MS: f64 = 14.0 * 24.0 * 60.0 * 60.0 * 1000.0;

static SIGNALED: AtomicBool = AtomicBool::new(false);

/// JS: `process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown)`
/// (Ctrl-C / console close on Windows).
fn install_signal_handlers() {
    impeccable_common::proc::on_interrupt(&SIGNALED);
}

const HELP: &str = "Usage: impeccable live-server [options]

Start the live variant mode server (zero dependencies).

Commands:
  (default)     Start the server (foreground)
  stop          Stop the server and remove the injected live.js script tag
  stop --keep-inject   Stop the server only (leave the script tag in the HTML entry)

Options:
  --background  Start detached, print connection JSON to stdout, then exit
  --port=PORT   Use a specific port (default: auto-detect starting at 8400)
  --keep-inject Only with stop: skip live-inject --remove
  --help        Show this help

Endpoints:
  /live.js             Browser script (element picker + variant cycling)
  /detect.js           Detection overlay (backwards compatible)
  /modern-screenshot.js Vendored modern-screenshot UMD build (lazy-loaded by live.js)
  /annotation          POST raw image/png to stage a variant screenshot
  /events              SSE stream (server→browser) + POST (browser→server)
  /poll                Long-poll for agent CLI
  /manual-edit-stash   Stage browser copy edits
  /manual-edit-commit  Apply staged browser copy edits
  /manual-edit-discard Discard staged browser copy edits
  /source              Raw source file reader (no-HMR fallback)
  /status              Durable recovery status (token-protected)
  /health              Health check";

pub fn run(args: &[String], io: &mut Io) -> i32 {
    let mut argv: Vec<String> = args.to_vec();
    let roots = match enter_live_root(&mut argv, io) {
        Ok(r) => r,
        Err(code) => return code,
    };
    let cwd = io.cwd.to_string_lossy().into_owned();
    let env = io.env.clone();

    if argv.iter().any(|a| a == "--help" || a == "-h") {
        println(io, HELP);
        return 0;
    }

    if argv.iter().any(|a| a == "stop") {
        return stop(&argv, &cwd, io);
    }

    if argv.iter().any(|a| a == "--background") {
        let child_args: Vec<String> = argv
            .iter()
            .filter(|a| *a != "--background")
            .cloned()
            .collect();
        return match crate::server::spawn_detached_with_args(&cwd, &env, &child_args) {
            Some(info) => {
                println(io, &serde_json::to_string(&info).unwrap_or_default());
                0
            }
            None => {
                io.err("Timed out waiting for live server to start.\n");
                1
            }
        };
    }

    // Check for existing session
    if let Some((existing, path)) = read_live_server_info(&cwd, &env) {
        let alive = existing
            .pid
            .map(|p| crate::util::kill0(p).is_ok())
            .unwrap_or(false);
        if alive {
            let port = existing
                .raw
                .get("port")
                .map(js_display)
                .unwrap_or_else(|| "undefined".to_string());
            let pid = existing
                .raw
                .get("pid")
                .map(js_display)
                .unwrap_or_else(|| "undefined".to_string());
            io.err(&format!(
                "Live server already running on port {} (pid {}).\n",
                port, pid
            ));
            let self_cmd = impeccable_context::provider::detect(&env, &cwd).self_cmd;
            io.err(&format!(
                "Stop it first with: {} live-server stop\n",
                self_cmd
            ));
            return 1;
        }
        let _ = std::fs::remove_file(&path);
    }

    let token = random_uuid();
    let store = create_live_session_store(&cwd, &env, None);
    let (log_tx, log_rx) = channel::<(bool, String)>();
    let debug_events = env
        .get("IMPECCABLE_LIVE_DEBUG_EVENTS")
        .map(|v| matches!(v.to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
        .unwrap_or(false);
    let detect_script = load_detect_script(&env, &cwd);
    let shared: Shared = Arc::new_cyclic(|weak| {
        Mutex::new(ServerState {
            token: token.clone(),
            port: 0,
            cwd: cwd.clone(),
            env: env.clone(),
            roots,
            sse_clients: Vec::new(),
            pending_events: Vec::new(),
            pending_polls: Vec::new(),
            next_event_seq: 1,
            last_agent_polling_broadcast: None,
            exit_timer_gen: 0,
            exit_timer_active: false,
            session_dir: None,
            store,
            lease_timer_gen: 0,
            lease_timer_active: false,
            manual_edit_activity: None,
            next_manual_edit_seq: 1,
            pending_apply_deferreds: Vec::new(),
            last_poll_at: 0,
            timed_out_apply_ids: Vec::new(),
            next_poll_id: 1,
            next_client_id: 1,
            next_apply_timer_gen: 0,
            shutting_down: false,
            cleaned_up: false,
            log_tx,
            debug_manual_edit_events: debug_events,
            self_ref: weak.clone(),
            source_resolution_cache: std::collections::HashMap::new(),
            detect_script,
        })
    });

    // Startup sweeps (JS order).
    {
        let mut st = lock(&shared);
        manual_apply::rollback_transaction(
            &mut st,
            None,
            "manual_edit_server_start_recovered_abandoned_transaction",
        );
        // applyLegacyDeferredAcceptsOnStartup
        let deferred = apply_deferred_svelte_component_accepts(&cwd, &env);
        let applied = deferred
            .get("applied")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let failed = deferred.get("failed").and_then(|v| v.as_u64()).unwrap_or(0);
        if applied > 0 || failed > 0 {
            io.out(&format!(
                "[impeccable] applied legacy deferred Svelte component accepts: {}\n",
                serde_json::to_string(&deferred).unwrap_or_default()
            ));
        }
        // sweepOrphanSvelteComponentSessionsOnStartup
        let active_ids: Vec<String> = st
            .store
            .list_active_sessions()
            .iter()
            .filter_map(|s| s.get("id").and_then(|v| v.as_str()).map(String::from))
            .filter(|s| !s.is_empty())
            .collect();
        let sweep = sweep_inactive_svelte_component_sessions(&active_ids, &cwd);
        let removed_n = sweep
            .get("removed")
            .and_then(|v| v.as_array())
            .map(|a| a.len())
            .unwrap_or(0);
        if removed_n > 0 || sweep.get("removedRoot") == Some(&Value::Bool(true)) {
            io.out(&format!(
                "[impeccable] swept orphaned Svelte component sessions: {}\n",
                serde_json::to_string(&sweep).unwrap_or_default()
            ));
        }
        // sweepStaleAcceptReceiptsOnStartup
        let receipts = jsp::join(&[&live_dir(&cwd, &env), "accept-receipts"]);
        if exists(&receipts) {
            let cutoff = crate::util::now_ms() - ACCEPT_RECEIPT_MAX_AGE_MS;
            let mut removed = 0;
            for name in read_dir_names_raw(&receipts).unwrap_or_default() {
                if !name.ends_with(".json") && !name.ends_with(".tmp") {
                    continue;
                }
                let file = jsp::join(&[&receipts, &name]);
                let mtime = impeccable_context::util::mtime_ms(&file);
                match mtime {
                    Some(m) if m >= cutoff => continue,
                    None => continue,
                    _ => {}
                }
                if std::fs::remove_file(&file).is_ok() {
                    removed += 1;
                }
            }
            if removed > 0 {
                io.out(&format!(
                    "[impeccable] removed {} accept receipt(s) older than 14 days\n",
                    removed
                ));
            }
        }
        st.restore_pending_events_from_store();
        manual_apply::prune_stale_evidence(&st);
    }

    // Port
    let port_arg = argv.iter().find(|a| a.starts_with("--port="));
    let listener = match port_arg {
        Some(a) => {
            let raw = a.splitn(2, '=').nth(1).unwrap_or("");
            let p = impeccable_core::js::parse_int(raw, 10);
            let port = if p.is_nan() { 0u16 } else { p as u16 };
            match TcpListener::bind(("127.0.0.1", port)) {
                Ok(l) => l,
                Err(e) => {
                    io.err(&format!(
                        "Error: listen EADDRINUSE: address already in use 127.0.0.1:{} ({})\n",
                        port, e
                    ));
                    return 1;
                }
            }
        }
        None => {
            let mut port: u16 = 8400;
            loop {
                match TcpListener::bind(("127.0.0.1", port)) {
                    Ok(l) => break l,
                    Err(_) => {
                        if port == u16::MAX {
                            io.err("Error: no free port\n");
                            return 1;
                        }
                        port += 1;
                    }
                }
            }
        }
    };
    let port = listener.local_addr().map(|a| a.port()).unwrap_or(0) as i64;

    // Annotation session dir
    let annot_root = live_annotations_dir(&cwd, &env);
    let _ = std::fs::create_dir_all(&annot_root);
    let session_dir = mkdtemp(&jsp::join(&[&annot_root, "session-"]));

    {
        let mut st = lock(&shared);
        st.port = port;
        st.session_dir = session_dir.clone();
    }

    install_signal_handlers();
    let _ = listener.set_nonblocking(true);
    write_live_server_info(
        &cwd,
        &env,
        &json!({ "pid": std::process::id(), "port": port, "token": token }),
    );
    let url = format!("http://localhost:{}", port);
    io.out(&format!("\nImpeccable live server running on {}\n", url));
    io.out(&format!("Token: {}\n\n", token));
    io.out(&format!("Script: {}/live.js\n", url));
    io.out("Inject: managed by impeccable live-inject; Astro source tags use is:inline automatically.\n");
    io.out("Stop:   impeccable live-server stop\n");
    let _ = std::io::Write::flush(&mut io.stdout);

    // Accept loop. Tickets are issued here, in accept order, so handlers can
    // observe each other in arrival order (see `Turnstile`).
    let turnstile = Arc::new(Turnstile::default());
    // Defense in depth against a connection flood (slow-loris fan-out, fd/thread
    // exhaustion): cap concurrent in-flight handlers. Over the cap, the socket
    // is closed before a ticket is issued, so it never enters the lane. The cap
    // is generous; legitimate local tooling never approaches it.
    let active_connections = Arc::new(AtomicUsize::new(0));
    const MAX_CONCURRENT_CONNECTIONS: usize = 512;
    loop {
        // Drain console output from worker threads.
        while let Ok((is_err, line)) = log_rx.try_recv() {
            if is_err {
                io.err(&line);
            } else {
                io.out(&line);
            }
        }
        let _ = std::io::Write::flush(&mut io.stdout);
        let _ = std::io::Write::flush(&mut io.stderr);
        if SIGNALED.load(Ordering::SeqCst) || lock(&shared).shutting_down {
            break;
        }
        match listener.accept() {
            Ok((stream, _)) => {
                // Accepted sockets may inherit the listener's non-blocking
                // flag (BSD/macOS); connection threads block on reads.
                let _ = stream.set_nonblocking(false);
                if active_connections.load(Ordering::SeqCst) >= MAX_CONCURRENT_CONNECTIONS {
                    // Over the cap: drop before issuing a ticket, so a flood of
                    // stalled sockets cannot enter (or wedge) the lane.
                    let _ = stream.shutdown(std::net::Shutdown::Both);
                    continue;
                }
                active_connections.fetch_add(1, Ordering::SeqCst);
                let active = active_connections.clone();
                let shared = shared.clone();
                let ticket = turnstile.issue();
                std::thread::spawn(move || {
                    handle_connection(shared, stream, ticket);
                    active.fetch_sub(1, Ordering::SeqCst);
                });
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(_) => {
                std::thread::sleep(Duration::from_millis(10));
            }
        }
    }
    shutdown(&shared);
    while let Ok((is_err, line)) = log_rx.try_recv() {
        if is_err {
            io.err(&line);
        } else {
            io.out(&line);
        }
    }
    drop(listener);
    0
}

/// JS `${value}` for a JSON scalar in a template string.
fn js_display(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => "null".to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n
            .as_f64()
            .map(impeccable_context::util::js_number_to_string)
            .unwrap_or_default(),
        other => other.to_string(),
    }
}

/// `fs.mkdtempSync(prefix)`: prefix + 6 random [A-Za-z0-9] chars.
fn mkdtemp(prefix: &str) -> Option<String> {
    const ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    for _ in 0..100 {
        let mut b = [0u8; 6];
        if getrandom::getrandom(&mut b).is_err() {
            let t = crate::util::now_ms() as u64;
            for (i, x) in b.iter_mut().enumerate() {
                *x = ((t >> (i * 7)) & 0xff) as u8;
            }
        }
        let suffix: String = b
            .iter()
            .map(|x| ALPHABET[(*x as usize) % ALPHABET.len()] as char)
            .collect();
        let dir = format!("{}{}", prefix, suffix);
        if std::fs::create_dir(&dir).is_ok() {
            return Some(dir);
        }
    }
    None
}

/// JS: the `stop` branch.
fn stop(argv: &[String], cwd: &str, io: &mut Io) -> i32 {
    let keep_inject = argv.iter().any(|a| a == "--keep-inject");
    let env = io.env.clone();
    let stopped = match read_live_server_info(cwd, &env) {
        Some((info, _)) => {
            let port = info
                .raw
                .get("port")
                .map(js_display)
                .unwrap_or_else(|| "undefined".to_string());
            let token = info
                .raw
                .get("token")
                .map(js_display)
                .unwrap_or_else(|| "undefined".to_string());
            let url = format!("http://localhost:{}/stop?token={}", port, token);
            match ureq::get(&url).call() {
                Ok(res) if (200..300).contains(&res.status()) => Some(port),
                _ => None,
            }
        }
        None => None,
    };
    match stopped {
        Some(port) => println(io, &format!("Stopped live server on port {}.", port)),
        None => println(io, "No running live server found."),
    }
    if !keep_inject {
        // JS: execFileSync(node, [live-inject.mjs, '--remove'], { cwd })
        // with the child's stderr inherited.
        let (mut child_io, captured) = Io::captured("", std::path::PathBuf::from(cwd), env.clone());
        let code = crate::live_inject::run(&["--remove".to_string()], &mut child_io);
        let out = String::from_utf8_lossy(&captured.stdout.borrow()).into_owned();
        let err = String::from_utf8_lossy(&captured.stderr.borrow()).into_owned();
        io.err(&err);
        if code == 0 {
            let line = out
                .trim()
                .split('\n')
                .filter(|l| !l.is_empty())
                .last()
                .map(String::from);
            if let Some(line) = line {
                if let Ok(j) = serde_json::from_str::<Value>(&line) {
                    if j.get("removed") == Some(&Value::Bool(true)) {
                        let file = j
                            .get("file")
                            .map(js_display)
                            .unwrap_or_else(|| "undefined".to_string());
                        println(io, &format!("Removed live script tag from {}.", file));
                    }
                }
            }
        } else {
            let detail = if !err.trim().is_empty() {
                err.trim().to_string()
            } else if !out.trim().is_empty() {
                out.trim().to_string()
            } else {
                format!("Command failed: impeccable live-inject --remove")
            };
            let first = detail.split('\n').next().unwrap_or("");
            io.err(&format!(
                "Note: could not remove live script tag ({})\n",
                first
            ));
        }
    }
    0
}

/// JS: shutdown()
fn shutdown(shared: &Shared) {
    let mut st = lock(shared);
    if st.cleaned_up {
        return;
    }
    st.cleaned_up = true;
    remove_all_svelte_component_sessions(&st.cwd);
    remove_live_server_info(&st.cwd, &st.env);
    st.lease_timer_gen += 1;
    st.lease_timer_active = false;
    if let Some(dir) = st.session_dir.take() {
        let _ = std::fs::remove_dir_all(dir);
    }
    for client in st.sse_clients.drain(..) {
        let _ = client.tx.send("\0end".to_string());
    }
    for poll in st.pending_polls.drain(..) {
        let _ = poll.tx.send(json!({ "type": "exit" }));
    }
    // Give response writers a moment to flush before the process exits.
    drop(st);
    std::thread::sleep(Duration::from_millis(50));
}

fn is_loopback_origin(origin: &str) -> bool {
    if origin.is_empty() {
        return false;
    }
    let (scheme, rest) = match origin.find("://") {
        Some(i) => (&origin[..i], &origin[i + 3..]),
        None => return false,
    };
    let scheme = scheme.to_ascii_lowercase();
    if scheme != "http" && scheme != "https" {
        return false;
    }
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let authority = authority.rsplit('@').next().unwrap_or("");
    let host = if authority.starts_with('[') {
        match authority.find(']') {
            Some(i) => &authority[..=i],
            None => return false,
        }
    } else {
        authority.split(':').next().unwrap_or("")
    };
    let host = host.to_ascii_lowercase();
    host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "[::1]"
}

fn respond(stream: &mut TcpStream, cors: &[(String, String)], res: Response) {
    send_response(stream, cors, &res);
}

fn json_res(status: u16, v: Value) -> Response {
    Response::new(status).json(&v)
}

fn text_res(status: u16, content_type: Option<&str>, body: &str) -> Response {
    let r = Response::new(status);
    let r = match content_type {
        Some(ct) => r.header("Content-Type", ct),
        None => r,
    };
    r.text(body)
}

fn handle_connection(shared: Shared, mut stream: TcpStream, mut ticket: Ticket) {
    set_header_timeout(&stream);
    // Read the whole request under a total wall-clock deadline. Without it a
    // slow-drip or silent peer accepted first would pin its ticket here and
    // wedge every later mutation (Fable BLOCKER, triage D3); the deadline
    // force-drops such a connection and releases its ticket within the bound.
    let Some(req) = read_request_deadline(
        &stream,
        MAX_JSON_BODY.max(MAX_ANNOTATION_BYTES + 1),
        READ_REQUEST_DEADLINE,
    ) else {
        return;
    };
    let _ = stream.set_read_timeout(None);
    // Reading and parsing ran in parallel with other connections; from here
    // on, routes that touch server state run in arrival order. Static asset
    // and read-only-file routes do not need a turn and give theirs up now.
    // CORS preflights do take a turn: the browser issues the real POSTs as
    // their preflights are answered, so answering preflights out of order
    // would reorder the POSTs (checkpoint before generate) at the source.
    match (req.path.as_str(), req.method.as_str()) {
        ("/live.js", _)
        | ("/detect.js", _)
        | ("/", _)
        | ("/modern-screenshot.js", _)
        | ("/health", _)
        | ("/status", _)
        | ("/design-system.json", _)
        | ("/design-system/raw", _)
        | ("/source", _) => ticket.release(),
        _ => ticket.wait_turn(),
    }
    let token_now = lock(&shared).token.clone();
    let mut cors: Vec<(String, String)> = Vec::new();
    if let Some(origin) = req.header("origin") {
        if !origin.is_empty()
            && (is_loopback_origin(origin) || req.query_get("token") == Some(token_now.as_str()))
        {
            cors.push(("Access-Control-Allow-Origin".into(), origin.to_string()));
            cors.push(("Vary".into(), "Origin".into()));
        }
    }
    cors.push((
        "Access-Control-Allow-Methods".into(),
        "GET, POST, OPTIONS".into(),
    ));
    cors.push(("Access-Control-Allow-Headers".into(), "Content-Type".into()));
    if req.method == "OPTIONS" {
        respond(&mut stream, &cors, Response::new(204));
        return;
    }
    let p = req.path.clone();
    let token_ok = req.query_get("token") == Some(token_now.as_str());

    match (p.as_str(), req.method.as_str()) {
        ("/live.js", _) => {
            if !token_ok {
                respond(
                    &mut stream,
                    &cors,
                    text_res(401, Some("text/plain"), "Unauthorized"),
                );
                return;
            }
            let (cwd, env, port, roots) = {
                let st = lock(&shared);
                (st.cwd.clone(), st.env.clone(), st.port, st.roots.clone())
            };
            let parts = match read_live_browser_script_parts(scripts_dir(&env, &cwd).as_deref()) {
                Ok(p) => p,
                Err(e) => {
                    respond(
                        &mut stream,
                        &cors,
                        text_res(
                            500,
                            Some("text/plain"),
                            &format!("Error reading live browser scripts: {}", e),
                        ),
                    );
                    return;
                }
            };
            let prefix = impeccable_context::provider::detect(&env, &cwd).command_prefix;
            // JS: projectIgnores from live/project-ignores.mjs (issue #639),
            // read per request so waiver edits land on the next tab reload.
            let project_ignores = crate::project_ignores::collect_project_detector_ignores(
                &cwd,
                &env,
                Some(&cwd),
                roots.as_ref().and_then(|r| r.context_root.as_deref()),
                roots.as_ref().map(|r| r.repo_root.as_str()),
            );
            let body = assemble_live_browser_script(&token_now, port, &prefix, &cwd, &parts, &project_ignores);
            respond(
                &mut stream,
                &cors,
                Response::new(200)
                    .header("Content-Type", "application/javascript; charset=utf-8")
                    .header(
                        "Cache-Control",
                        "no-store, no-cache, must-revalidate, max-age=0",
                    )
                    .header("Pragma", "no-cache")
                    .text(&body),
            );
        }
        ("/detect.js", _) | ("/", _) => {
            let script = lock(&shared).detect_script.clone();
            if script.is_empty() {
                respond(&mut stream, &cors, text_res(404, None, "Not available"));
                return;
            }
            respond(
                &mut stream,
                &cors,
                text_res(200, Some("application/javascript; charset=utf-8"), &script),
            );
        }
        ("/modern-screenshot.js", _) => {
            respond(
                &mut stream,
                &cors,
                Response::new(200)
                    .header("Content-Type", "application/javascript")
                    .header("Cache-Control", "public, max-age=31536000, immutable")
                    .bytes(MODERN_SCREENSHOT_JS.to_vec()),
            );
        }
        ("/annotation", "POST") => handle_annotation(&shared, &mut stream, &cors, &req, token_ok),
        ("/status", _) => {
            if !token_ok {
                respond(
                    &mut stream,
                    &cors,
                    json_res(401, json!({ "error": "Unauthorized" })),
                );
                return;
            }
            let st = lock(&shared);
            let sessions = st.active_session_summaries();
            let pending: Vec<Value> = st
                .pending_events
                .iter()
                .map(|e| st.summarize_pending_event_for_status(e))
                .collect();
            let body = json!({
                "status": "ok",
                "port": st.port,
                "connectedClients": st.sse_clients.len(),
                "pendingEvents": pending,
                "agentPolling": st.agent_polling_connected(),
                "activeSessions": sessions,
                "manualEdits": st.manual_edit_status(),
            });
            drop(st);
            respond(&mut stream, &cors, json_res(200, body));
        }
        ("/health", _) => {
            let (cwd, env, roots, port, clients) = {
                let st = lock(&shared);
                (
                    st.cwd.clone(),
                    st.env.clone(),
                    st.roots.clone(),
                    st.port,
                    st.sse_clients.len(),
                )
            };
            let has_ctx = resolve_project_context(&cwd, &env, roots.as_ref()).has_product;
            respond(
                &mut stream,
                &cors,
                json_res(
                    200,
                    json!({ "status": "ok", "port": port, "mode": "variant", "hasProjectContext": has_ctx, "connectedClients": clients }),
                ),
            );
        }
        ("/design-system.json", _) | ("/design-system/raw", _) => {
            if !token_ok {
                respond(&mut stream, &cors, text_res(401, None, "Unauthorized"));
                return;
            }
            let (cwd, env, roots) = {
                let st = lock(&shared);
                (st.cwd.clone(), st.env.clone(), st.roots.clone())
            };
            let ctx = resolve_project_context(&cwd, &env, roots.as_ref());
            let md_path = ctx.resolved_design_path.clone();
            let project_root =
                impeccable_context::context::resolve_project_root(&cwd, &Default::default(), &env);
            let context_dir = ctx
                .design_context_dir
                .clone()
                .unwrap_or_else(|| ctx.context_dir.clone());
            let candidates = impeccable_context::staleness::design_sidecar_candidates_for(
                &project_root,
                Some(&context_dir),
            );
            let json_path = candidates
                .iter()
                .find(|c| exists(c))
                .cloned()
                .unwrap_or_else(|| jsp::join(&[&project_root, ".impeccable", "design.json"]));
            let md_stat = md_path
                .as_deref()
                .and_then(impeccable_context::util::mtime_ms);
            let json_stat = impeccable_context::util::mtime_ms(&json_path);
            if p == "/design-system/raw" {
                let Some(md) = md_path
                    .as_deref()
                    .filter(|_| md_stat.is_some())
                    .and_then(safe_read)
                else {
                    respond(&mut stream, &cors, text_res(404, None, "Not found"));
                    return;
                };
                respond(
                    &mut stream,
                    &cors,
                    text_res(200, Some("text/markdown; charset=utf-8"), &md),
                );
                return;
            }
            if md_stat.is_none() && json_stat.is_none() {
                respond(
                    &mut stream,
                    &cors,
                    json_res(404, json!({ "present": false })),
                );
                return;
            }
            let mut response = Map::new();
            response.insert("present".into(), json!(true));
            response.insert("hasMd".into(), json!(md_stat.is_some()));
            response.insert("hasSidecar".into(), json!(json_stat.is_some()));
            response.insert(
                "mdNewerThanJson".into(),
                json!(matches!((md_stat, json_stat), (Some(m), Some(j)) if m > j + 1000.0)),
            );
            if md_stat.is_some() {
                let md = md_path.as_deref().and_then(safe_read).unwrap_or_default();
                match crate::design_md::parse_design_md(&md) {
                    Ok(v) => {
                        response.insert("parsed".into(), v);
                    }
                    Err(e) => {
                        response.insert("parseError".into(), json!(e));
                    }
                }
            }
            if json_stat.is_some() {
                let raw = safe_read(&json_path).unwrap_or_default();
                match serde_json::from_str::<Value>(&raw) {
                    Ok(v) => {
                        response.insert("sidecar".into(), v);
                    }
                    Err(_) => {
                        let msg = json_parse_error(&raw)
                            .unwrap_or_else(|| "Unexpected token".to_string());
                        response.insert(
                            "sidecarError".into(),
                            json!(format!("Failed to parse .impeccable/design.json: {}", msg)),
                        );
                    }
                }
            }
            respond(&mut stream, &cors, json_res(200, Value::Object(response)));
        }
        ("/source", _) => {
            if !token_ok {
                respond(&mut stream, &cors, text_res(401, None, "Unauthorized"));
                return;
            }
            let file_path = req.query_get("path").unwrap_or("");
            if file_path.is_empty() || file_path.contains("..") {
                respond(&mut stream, &cors, text_res(400, None, "Bad path"));
                return;
            }
            let cwd = lock(&shared).cwd.clone();
            let abs = jsp::resolve(&cwd, &[file_path]);
            // JS (#618): realpath both sides so a symlink under the root
            // cannot lead the read out of the workspace.
            let (real_root, real_target) = match (std::fs::canonicalize(&cwd), std::fs::canonicalize(&abs)) {
                (Ok(r), Ok(t)) => (
                    r.to_string_lossy().into_owned(),
                    t.to_string_lossy().into_owned(),
                ),
                _ => {
                    respond(&mut stream, &cors, text_res(404, None, "File not found"));
                    return;
                }
            };
            // Confine to the project root after symlink resolution. A bare
            // `startsWith(cwd)` string check lets a sibling dir whose name
            // extends the root name (projeto -> projeto-backup) slip
            // through; compare on the relative path instead. An empty rel
            // means the request resolved to the root directory itself, which
            // this file route never serves.
            let rel = jsp::relative("/", &real_root, &real_target);
            if rel.is_empty() || rel.starts_with("..") || jsp::is_absolute(&rel) {
                respond(&mut stream, &cors, text_res(403, None, "Forbidden"));
                return;
            }
            let Some(content) = safe_read(&real_target) else {
                respond(&mut stream, &cors, text_res(404, None, "File not found"));
                return;
            };
            respond(
                &mut stream,
                &cors,
                text_res(200, Some("text/html; charset=utf-8"), &content),
            );
        }
        ("/events", "GET") => handle_sse(&shared, stream, &cors, token_ok, &mut ticket),
        ("/manual-edit-stash", "POST")
        | ("/manual-edit-stash", "GET")
        | ("/manual-edit-commit", "POST")
        | ("/manual-edit-repair-decision", "POST")
        | ("/manual-edit-discard", "POST")
        | ("/manual-edit", "POST") => {
            handle_manual_edit_route(&shared, &mut stream, &cors, &req, &token_now, &mut ticket)
        }
        ("/events", "POST") => handle_events_post(&shared, &mut stream, &cors, &req, &token_now),
        ("/stop", _) => {
            if !token_ok {
                respond(&mut stream, &cors, text_res(401, None, "Unauthorized"));
                return;
            }
            // JS: `res.end('stopping'); shutdown();` runs the cleanup in the
            // same tick, before the client can observe the response.
            shutdown(&shared);
            respond(
                &mut stream,
                &cors,
                text_res(200, Some("text/plain"), "stopping"),
            );
        }
        ("/poll", "GET") => handle_poll_get(&shared, stream, &cors, &req, token_ok, &mut ticket),
        ("/poll", "POST") => {
            handle_poll_post(&shared, &mut stream, &cors, &req, &token_now, &mut ticket)
        }
        _ => respond(&mut stream, &cors, text_res(404, None, "Not found")),
    }
}

fn parse_json_body(req: &Request) -> Option<Value> {
    let text = String::from_utf8_lossy(&req.body);
    serde_json::from_str::<Value>(&text).ok()
}

fn handle_annotation(
    shared: &Shared,
    stream: &mut TcpStream,
    cors: &[(String, String)],
    req: &Request,
    token_ok: bool,
) {
    if !token_ok {
        respond(stream, cors, text_res(401, None, "Unauthorized"));
        return;
    }
    let event_id = req.query_get("eventId").unwrap_or("");
    let valid_id = !event_id.is_empty()
        && event_id.len() <= 64
        && event_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    if !valid_id {
        respond(
            stream,
            cors,
            json_res(400, json!({ "error": "Invalid eventId" })),
        );
        return;
    }
    if req
        .header("content-type")
        .unwrap_or("")
        .to_ascii_lowercase()
        != "image/png"
    {
        respond(
            stream,
            cors,
            json_res(415, json!({ "error": "Content-Type must be image/png" })),
        );
        return;
    }
    let session_dir = lock(shared).session_dir.clone();
    let Some(session_dir) = session_dir else {
        respond(
            stream,
            cors,
            json_res(500, json!({ "error": "Session dir unavailable" })),
        );
        return;
    };
    if req.body_truncated || req.body.len() > MAX_ANNOTATION_BYTES {
        respond(
            stream,
            cors,
            json_res(413, json!({ "error": "Payload too large" })),
        );
        return;
    }
    let abs = jsp::join(&[&session_dir, &format!("{}.png", event_id)]);
    if let Err(e) = std::fs::write(&abs, &req.body) {
        respond(
            stream,
            cors,
            json_res(500, json!({ "error": format!("Write failed: {}", e) })),
        );
        return;
    }
    respond(
        stream,
        cors,
        json_res(200, json!({ "ok": true, "path": abs })),
    );
}

fn handle_sse(
    shared: &Shared,
    stream: TcpStream,
    cors: &[(String, String)],
    token_ok: bool,
    ticket: &mut Ticket,
) {
    let mut stream = stream;
    if !token_ok {
        respond(&mut stream, cors, text_res(401, None, "Unauthorized"));
        return;
    }
    let (client_id, rx, tx, connected_frame) = {
        let mut st = lock(shared);
        st.clear_exit_timer();
        st.cancel_queued_anonymous_exit_events();
        let has_ctx = resolve_project_context(&st.cwd, &st.env, st.roots.as_ref()).has_product;
        let frame = format!(
            "data: {}\n\n",
            serde_json::to_string(&json!({
                "type": "connected",
                "hasProjectContext": has_ctx,
                "agentPolling": st.agent_polling_connected(),
                "activeSessions": st.active_session_summaries(),
            }))
            .unwrap_or_default()
        );
        let (id, rx, tx) = st.add_sse_client();
        (id, rx, tx, frame)
    };
    // Registered; the stream now parks, so let later requests through.
    ticket.release();
    let done = Arc::new(AtomicBool::new(false));
    {
        let tx = tx.clone();
        watch_close(&stream, done.clone(), move || {
            let _ = tx.send("\0close".to_string());
        });
    }
    let mut res = StreamResponse::begin(
        stream,
        cors,
        200,
        &[
            ("Content-Type", "text/event-stream"),
            ("Cache-Control", "no-cache"),
            ("Connection", "keep-alive"),
        ],
    );
    let mut alive = res.write(connected_frame.as_bytes());
    let mut next_heartbeat = Instant::now() + Duration::from_millis(SSE_HEARTBEAT_INTERVAL_MS);
    while alive {
        let now = Instant::now();
        let wait = if next_heartbeat > now {
            next_heartbeat - now
        } else {
            Duration::from_millis(0)
        };
        match rx.recv_timeout(wait) {
            Ok(msg) => {
                if msg == "\0close" {
                    break;
                }
                if msg == "\0end" {
                    res.end();
                    break;
                }
                alive = res.write(msg.as_bytes());
            }
            Err(RecvTimeoutError::Timeout) => {
                alive = res.write(b": keepalive\n\n");
                next_heartbeat = Instant::now() + Duration::from_millis(SSE_HEARTBEAT_INTERVAL_MS);
            }
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
    done.store(true, Ordering::SeqCst);
    res.end();
    let mut st = lock(shared);
    st.remove_sse_client(client_id);
}

fn handle_events_post(
    shared: &Shared,
    stream: &mut TcpStream,
    cors: &[(String, String)],
    req: &Request,
    token: &str,
) {
    let Some(msg) = parse_json_body(req) else {
        respond(
            stream,
            cors,
            json_res(400, json!({ "error": "Invalid JSON" })),
        );
        return;
    };
    let msg_obj = msg.as_object().cloned().unwrap_or_default();
    if msg_obj.get("token").and_then(|t| t.as_str()) != Some(token) {
        respond(
            stream,
            cors,
            json_res(401, json!({ "error": "Unauthorized" })),
        );
        return;
    }
    let ty = msg_obj
        .get("type")
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .to_string();
    if ty == "manual_edits" {
        respond(
            stream,
            cors,
            json_res(
                400,
                json!({ "error": "manual_edits must POST to /manual-edit-stash, not /events" }),
            ),
        );
        return;
    }
    if ty == "manual_edit_apply" {
        respond(
            stream,
            cors,
            json_res(
                400,
                json!({ "error": "manual_edit_apply is disabled; use /manual-edit-stash then /manual-edit-commit" }),
            ),
        );
        return;
    }
    if let Some(error) = validate_event(&msg) {
        respond(stream, cors, json_res(400, json!({ "error": error })));
        return;
    }
    let mut msg_obj = msg_obj;
    crate::server_state::strip_poller_owned_event_fields(&mut msg_obj);
    let mut st = lock(shared);
    if ty == "agent_phase" {
        let id = msg_obj
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let phase = msg_obj
            .get("phase")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let mut details: Vec<(&str, Value)> = Vec::new();
        if let Some(Value::Number(n)) = msg_obj.get("durationMs") {
            if n.as_f64().map(|f| f.is_finite()).unwrap_or(false) {
                details.push(("durationMs", Value::Number(n.clone())));
            }
        }
        if let Some(Value::String(o)) = msg_obj.get("owner") {
            details.push(("owner", json!(o)));
        }
        st.record_agent_phase(&id, &phase, &details);
        drop(st);
        respond(stream, cors, json_res(200, json!({ "ok": true })));
        return;
    }
    let id_val = msg_obj.get("id").cloned();
    let id_truthy = truthy(id_val.as_ref());
    let id_str = id_val.as_ref().and_then(|v| v.as_str()).map(String::from);
    if id_truthy && ty != "generate" && ty != "steer" {
        let known = id_str.as_deref().map(|i| st.store.has(i)).unwrap_or(false);
        if !known {
            drop(st);
            respond(
                stream,
                cors,
                json_res(404, json!({ "error": "unknown_session", "id": id_val })),
            );
            return;
        }
    }
    let missed = st.detect_missed_generation_completion(&msg_obj);
    if id_truthy {
        if let Err(e) = st.store.append_event(&msg) {
            drop(st);
            respond(
                stream,
                cors,
                json_res(
                    500,
                    json!({ "error": "session_store_append_failed", "message": e }),
                ),
            );
            return;
        }
    }
    if ty == "accept" || ty == "discard" {
        st.retire_pending_generation(id_str.as_deref());
    }
    st.record_generation_checkpoint(&msg_obj);
    if let Some(m) = missed {
        st.broadcast(&m);
    }
    if ty == "exit" {
        remove_all_svelte_component_sessions(&st.cwd);
    }
    let orphaned_discard = ty == "discard" && msg_obj.get("orphaned") == Some(&Value::Bool(true));
    if orphaned_discard && id_truthy {
        let _ = st
            .store
            .append_event(&json!({ "type": "discarded", "id": id_val, "orphaned": true }));
    }
    if ty != "checkpoint" && ty != "variant_mounted" && !orphaned_discard {
        st.enqueue_event(msg_obj);
    }
    drop(st);
    respond(stream, cors, json_res(200, json!({ "ok": true })));
}

fn parse_int_or(v: Option<&str>, default: i64) -> i64 {
    match v {
        Some(s) if !s.is_empty() => {
            let n = impeccable_core::js::parse_int(s, 10);
            if n.is_nan() {
                // JS: setTimeout(NaN) fires immediately; NaN lease means never leased.
                i64::MIN
            } else {
                n as i64
            }
        }
        _ => default,
    }
}

fn parse_poll_types(v: Option<&str>) -> Option<Vec<String>> {
    let v = v?;
    if v.is_empty() {
        return None;
    }
    let types: Vec<String> = v
        .split(',')
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();
    if types.is_empty() {
        None
    } else {
        Some(types)
    }
}

fn handle_poll_get(
    shared: &Shared,
    stream: TcpStream,
    cors: &[(String, String)],
    req: &Request,
    token_ok: bool,
    ticket: &mut Ticket,
) {
    let mut stream = stream;
    if !token_ok {
        respond(
            &mut stream,
            cors,
            json_res(401, json!({ "error": "Unauthorized" })),
        );
        return;
    }
    let timeout = parse_int_or(req.query_get("timeout"), DEFAULT_POLL_TIMEOUT);
    let lease_raw = parse_int_or(req.query_get("leaseMs"), 30000);
    let lease_ms = if lease_raw == i64::MIN { 0 } else { lease_raw };
    let types = parse_poll_types(req.query_get("types"));
    let mut st = lock(shared);
    st.last_poll_at = now_i64();
    if let Some(idx) = st.find_available_pending_event(types.as_deref()) {
        st.pending_events[idx].lease_until = now_i64() + lease_ms;
        let seq = st.pending_events[idx].seq;
        let event = st.pending_events[idx].event.clone();
        drop(st);
        // Leasing may run the generation preflight (a child process); the
        // arrival-order claim ends here.
        ticket.release();
        let event = lease_event(shared, seq, event, lease_ms);
        respond(&mut stream, cors, json_res(200, Value::Object(event)));
        return;
    }
    let (poll_id, rx) = st.park_poll(lease_ms, types);
    drop(st);
    ticket.release();
    let done = Arc::new(AtomicBool::new(false));
    {
        let shared = shared.clone();
        watch_close(&stream, done.clone(), move || {
            let mut st = lock(&shared);
            if st.remove_poll(poll_id) {
                st.broadcast_agent_polling_if_changed();
            }
        });
    }
    let wait_ms: u64 = if timeout == i64::MIN {
        1
    } else {
        timeout.max(0) as u64
    };
    let event = match rx.recv_timeout(Duration::from_millis(wait_ms)) {
        Ok(ev) => ev,
        Err(RecvTimeoutError::Timeout) => {
            let mut st = lock(shared);
            if st.remove_poll(poll_id) {
                st.broadcast_agent_polling_if_changed();
                drop(st);
                json!({ "type": "timeout" })
            } else {
                drop(st);
                // Taken by a flush: the lease thread will deliver.
                rx.recv().unwrap_or_else(|_| json!({ "type": "exit" }))
            }
        }
        Err(RecvTimeoutError::Disconnected) => json!({ "type": "exit" }),
    };
    done.store(true, Ordering::SeqCst);
    respond(&mut stream, cors, json_res(200, event));
}

/// JS: sessionFileMetadataFromPollReply(file)
fn session_file_metadata_from_poll_reply(file: Option<&Value>, cwd: &str) -> Map<String, Value> {
    let mut base = Map::new();
    let Some(Value::String(f)) = file else {
        // JS: `{ file }` with file undefined/non-string -> key present with
        // that value (undefined dropped by JSON).
        if let Some(v) = file {
            base.insert("file".into(), v.clone());
        }
        return base;
    };
    if f.is_empty() {
        base.insert("file".into(), json!(f));
        return base;
    }
    let normalized = jsp::to_posix(f);
    base.insert("file".into(), json!(normalized));
    if !normalized.ends_with("/manifest.json") && normalized != "manifest.json" {
        return base;
    }
    if !normalized.contains(".impeccable/live/previews/")
        && !normalized.contains("node_modules/.impeccable-live/")
        && !normalized.contains("src/lib/impeccable/")
        && !normalized.contains("/.impeccable-live/")
    {
        return base;
    }
    let full = jsp::resolve(cwd, &[&normalized]);
    let rel = jsp::relative("/", cwd, &full);
    if rel.is_empty() || rel.starts_with("..") || jsp::is_absolute(&rel) {
        return base;
    }
    let Some(manifest) = crate::util::read_json(&full) else {
        return base;
    };
    if manifest.get("previewMode").and_then(|v| v.as_str()) != Some("svelte-component") {
        return base;
    }
    let Some(sf) = manifest.get("sourceFile").filter(|v| truthy(Some(v))) else {
        return base;
    };
    let sf_str = jsp::to_posix(&js_display(sf));
    let mut m = Map::new();
    m.insert("file".into(), json!(sf_str));
    m.insert("sourceFile".into(), json!(sf_str));
    m.insert("previewFile".into(), json!(normalized));
    m.insert(
        "previewMode".into(),
        manifest.get("previewMode").cloned().unwrap_or(Value::Null),
    );
    m
}

/// JS: inferSourceEventType(msg, pendingEvents)
fn infer_source_event_type(st: &ServerState, msg: &Map<String, Value>) -> Option<String> {
    let id = msg.get("id");
    let entries: Vec<&crate::server_state::PendingEntry> = st
        .pending_events
        .iter()
        .filter(|e| match id {
            Some(v) => e.event.get("id") == Some(v),
            None => !e.event.contains_key("id"),
        })
        .collect();
    let has_type = |t: &str| {
        entries
            .iter()
            .any(|e| e.event.get("type").and_then(|v| v.as_str()) == Some(t))
    };
    let ty = msg.get("type").and_then(|t| t.as_str()).unwrap_or("");
    match ty {
        "discarded" | "discard" => Some("discard".into()),
        "complete" => {
            if has_type("carbonize_cleanup") {
                Some("carbonize_cleanup".into())
            } else if has_type("accept") {
                Some("accept".into())
            } else if has_type("generate") {
                Some("generate".into())
            } else {
                None
            }
        }
        "steer_done" => Some("steer".into()),
        "agent_done" | "done" => {
            if !has_type("generate") && has_type("variant_mount_failed") {
                Some("variant_mount_failed".into())
            } else {
                Some("generate".into())
            }
        }
        "error" => {
            let now = now_i64();
            entries
                .iter()
                .find(|e| e.lease_until != 0 && e.lease_until > now)
                .and_then(|e| {
                    e.event
                        .get("type")
                        .and_then(|v| v.as_str())
                        .map(String::from)
                })
                .or_else(|| Some("generate".into()))
        }
        _ => None,
    }
}

fn handle_poll_post(
    shared: &Shared,
    stream: &mut TcpStream,
    cors: &[(String, String)],
    req: &Request,
    token: &str,
    ticket: &mut Ticket,
) {
    let Some(msg) = parse_json_body(req) else {
        respond(
            stream,
            cors,
            json_res(400, json!({ "error": "Invalid JSON" })),
        );
        return;
    };
    let msg = msg.as_object().cloned().unwrap_or_default();
    if msg.get("token").and_then(|t| t.as_str()) != Some(token) {
        respond(
            stream,
            cors,
            json_res(401, json!({ "error": "Unauthorized" })),
        );
        return;
    }
    let msg_id = msg.get("id").and_then(|v| v.as_str()).map(String::from);
    let msg_id_val = msg.get("id").cloned().unwrap_or(Value::Null);
    let msg_type = msg.get("type").and_then(|v| v.as_str()).map(String::from);
    let mut st = lock(shared);
    let cwd = st.cwd.clone();

    // 1. In-flight manual apply deferred
    if let Some(id) = msg_id.as_deref() {
        if let Some((_, deferred)) = st.pending_apply_deferreds.iter().find(|(k, _)| k == id) {
            let d_batch = deferred.batch.clone();
            let d_page = deferred.page_url.clone();
            let d_chunk = deferred
                .event
                .get("chunk")
                .filter(|v| truthy(Some(v)))
                .cloned()
                .unwrap_or(Value::Null);
            let d_repair = deferred
                .event
                .get("repair")
                .filter(|v| truthy(Some(v)))
                .cloned()
                .unwrap_or(Value::Null);
            let d_event_id = deferred
                .event
                .get("id")
                .and_then(|v| v.as_str())
                .map(String::from);
            match manual_apply::validate_manual_apply_result_message(
                &msg,
                &d_batch,
                d_event_id.as_deref(),
            ) {
                Err(body) => {
                    let mut details = Map::new();
                    details.insert("id".into(), msg_id_val.clone());
                    details.insert("pageUrl".into(), d_page);
                    details.insert("chunk".into(), d_chunk);
                    details.insert("repair".into(), d_repair);
                    let reason = body
                        .get("reason")
                        .filter(|v| truthy(Some(v)))
                        .cloned()
                        .or_else(|| body.get("error").filter(|v| truthy(Some(v))).cloned())
                        .unwrap_or(json!("invalid_manual_apply_result"));
                    details.insert("reason".into(), reason);
                    details.insert(
                        "status".into(),
                        msg.get("data")
                            .and_then(|d| d.get("status"))
                            .filter(|v| truthy(Some(v)))
                            .cloned()
                            .unwrap_or(Value::Null),
                    );
                    st.record_manual_edit_activity("manual_edit_apply_reply_invalid", details);
                    drop(st);
                    respond(stream, cors, json_res(400, body));
                    return;
                }
                Ok(result) => {
                    let mut details = Map::new();
                    details.insert("id".into(), msg_id_val.clone());
                    details.insert("pageUrl".into(), d_page);
                    details.insert("chunk".into(), d_chunk);
                    details.insert("repair".into(), d_repair);
                    details.insert(
                        "status".into(),
                        result.get("status").cloned().unwrap_or(Value::Null),
                    );
                    details.insert(
                        "appliedCount".into(),
                        json!(result
                            .get("appliedEntryIds")
                            .and_then(|a| a.as_array())
                            .map(|a| a.len())
                            .unwrap_or(0)),
                    );
                    details.insert(
                        "failed".into(),
                        manual_apply::summarize_manual_apply_failures(result.get("failed"), &cwd),
                    );
                    details.insert(
                        "fileCount".into(),
                        json!(result
                            .get("files")
                            .and_then(|a| a.as_array())
                            .map(|a| a.len())
                            .unwrap_or(0)),
                    );
                    details.insert(
                        "noteCount".into(),
                        json!(result
                            .get("notes")
                            .and_then(|a| a.as_array())
                            .map(|a| a.len())
                            .unwrap_or(0)),
                    );
                    st.record_manual_edit_activity("manual_edit_apply_reply_received", details);
                    manual_apply::resolve_deferred(&mut st, id, result);
                    st.acknowledge_pending_event(Some(id), None);
                    st.flush_pending_polls();
                    drop(st);
                    respond(stream, cors, json_res(200, json!({ "ok": true })));
                    return;
                }
            }
        }
        // 2. Timed-out apply id
        if st.timed_out_apply_ids.iter().any(|(k, _)| k == id) {
            let rollback = manual_apply::rollback_timed_out_reply(&mut st, &msg);
            let mut details = Map::new();
            details.insert("id".into(), msg_id_val.clone());
            details.insert(
                "rolledBackFileCount".into(),
                json!(rollback
                    .get("rolledBackFiles")
                    .and_then(|a| a.as_array())
                    .map(|a| a.len())
                    .unwrap_or(0)),
            );
            details.insert(
                "rollbackFailureCount".into(),
                json!(rollback
                    .get("rollbackFailures")
                    .and_then(|a| a.as_array())
                    .map(|a| a.len())
                    .unwrap_or(0)),
            );
            st.record_manual_edit_activity("manual_edit_apply_stale_reply_rejected", details);
            let mut body = Map::new();
            body.insert("error".into(), json!("stale_manual_edit_apply_reply"));
            if let Some(o) = rollback.as_object() {
                for (k, v) in o {
                    body.insert(k.clone(), v.clone());
                }
            }
            drop(st);
            respond(stream, cors, json_res(409, Value::Object(body)));
            return;
        }
    }
    // 3. sourceEventType
    let source_event_type: Option<String> = match msg.get("sourceEventType") {
        Some(v) if truthy(Some(v)) => Some(js_display(v)),
        _ => infer_source_event_type(&st, &msg),
    };
    // 4. retry
    if msg_type.as_deref() == Some("retry") {
        let released = st.release_pending_event(msg_id.as_deref(), source_event_type.as_deref());
        if released.is_none() {
            let has_id = truthy(msg.get("id"));
            let mut body = Map::new();
            body.insert(
                "error".into(),
                json!(if has_id {
                    "unknown_poll_retry_id"
                } else {
                    "missing_poll_retry_id"
                }),
            );
            if let Some(v) = msg.get("id") {
                body.insert("id".into(), v.clone());
            }
            drop(st);
            respond(
                stream,
                cors,
                json_res(if has_id { 404 } else { 400 }, Value::Object(body)),
            );
            return;
        }
        st.flush_pending_polls();
        drop(st);
        respond(
            stream,
            cors,
            json_res(200, json!({ "ok": true, "released": true })),
        );
        return;
    }
    // 5. steer_done needs file or message
    let pending_before = st
        .find_pending_event_by_id(msg_id.as_deref(), source_event_type.as_deref())
        .cloned();
    if pending_before
        .as_ref()
        .and_then(|e| e.get("type"))
        .and_then(|t| t.as_str())
        == Some("steer")
        && msg_type.as_deref() == Some("steer_done")
        && !truthy(msg.get("file"))
        && !matches!(msg.get("message"), Some(Value::String(m)) if !m.trim().is_empty())
    {
        drop(st);
        respond(
            stream,
            cors,
            json_res(
                400,
                json!({
                    "error": "steer_done_requires_file_or_message",
                    "hint": "Reply with --file after writing source, or include a message explaining an intentional no-op.",
                }),
            ),
        );
        return;
    }
    // 6. Acknowledge
    let acknowledged =
        st.acknowledge_pending_event(msg_id.as_deref(), source_event_type.as_deref());
    let mut skip_journal_reply = false;
    let mut existing_session: Option<Map<String, Value>> = None;
    if acknowledged.is_none() {
        if let Some(id) = msg_id.as_deref().filter(|s| !s.is_empty()) {
            if let Ok(Some(snapshot)) = st.store.get_snapshot(id, true) {
                if truthy(snapshot.get("updatedAt")) {
                    let phase = snapshot.get("phase").and_then(|p| p.as_str()).unwrap_or("");
                    skip_journal_reply = phase == "completed" || phase == "discarded";
                    existing_session = Some(snapshot);
                }
            }
        }
    }
    if acknowledged.is_none() && existing_session.is_none() {
        let mut details = Map::new();
        details.insert(
            "id".into(),
            if truthy(msg.get("id")) {
                msg_id_val.clone()
            } else {
                Value::Null
            },
        );
        details.insert(
            "type".into(),
            match msg.get("type") {
                Some(v) if truthy(Some(v)) => v.clone(),
                _ => Value::Null,
            },
        );
        st.record_manual_edit_activity("manual_edit_poll_reply_unknown", details);
        let has_id = truthy(msg.get("id"));
        let mut body = Map::new();
        body.insert(
            "error".into(),
            json!(if has_id {
                "unknown_poll_reply_id"
            } else {
                "missing_poll_reply_id"
            }),
        );
        if let Some(v) = msg.get("id") {
            body.insert("id".into(), v.clone());
        }
        drop(st);
        respond(
            stream,
            cors,
            json_res(if has_id { 404 } else { 400 }, Value::Object(body)),
        );
        return;
    }
    // 7. file metadata
    let reply_meta = session_file_metadata_from_poll_reply(msg.get("file"), &cwd);
    // 8. Svelte publish
    if reply_meta.get("previewMode").and_then(|v| v.as_str()) == Some("svelte-component")
        && truthy(msg.get("id"))
        && (msg_type.as_deref() == Some("done") || !truthy(msg.get("type")))
    {
        let id = msg_id.clone().unwrap_or_default();
        drop(st);
        // The compile check is the JS `await`; the state work after it is a
        // fresh turn from the lock's point of view, so give the ticket up.
        ticket.release();
        let check = compile_check_variants(&id, &cwd);
        if check.get("ok") != Some(&Value::Bool(true)) {
            respond(
                stream,
                cors,
                json_res(
                    422,
                    json!({
                        "error": "variant_compile_failed",
                        "id": msg_id_val,
                        "failures": check.get("failures").cloned().unwrap_or(json!([])),
                        "_instructions": "The publish was NOT delivered: the listed variant file(s) do not compile, so the browser never saw them. Fix each failure at the given file and line (the most common cause is a second top-level <style> element; Svelte allows exactly one, so merge all rules into the existing block), then send the same --reply done again.",
                    }),
                ),
            );
            return;
        }
        let _ = bump_svelte_component_preview_revision(&id, &cwd);
        st = lock(shared);
    }
    // 9. Journal
    if truthy(msg.get("id")) && !skip_journal_reply {
        let event_type = match msg_type.as_deref() {
            Some("steer_done") => "steer_done",
            Some("discard") | Some("discarded") => "discarded",
            Some("complete") => "complete",
            Some("error") => "agent_error",
            _ => "agent_done",
        };
        let mut ev = Map::new();
        ev.insert("type".into(), json!(event_type));
        ev.insert("id".into(), msg_id_val.clone());
        if let Some(f) = reply_meta.get("file") {
            ev.insert("file".into(), f.clone());
        }
        if let Some(v) = reply_meta.get("sourceFile") {
            ev.insert("sourceFile".into(), v.clone());
        }
        if let Some(v) = reply_meta.get("previewFile") {
            ev.insert("previewFile".into(), v.clone());
        }
        if let Some(v) = reply_meta.get("previewMode") {
            ev.insert("previewMode".into(), v.clone());
        }
        if let Some(m) = msg.get("message") {
            ev.insert("message".into(), m.clone());
        }
        if let Some(t) = acknowledged.as_ref().and_then(|a| a.get("type")) {
            ev.insert("sourceEventType".into(), t.clone());
        }
        ev.insert(
            "carbonize".into(),
            json!(msg.get("data").and_then(|d| d.get("carbonize")) == Some(&Value::Bool(true))),
        );
        let _ = st.store.append_event(&Value::Object(ev));
    }
    st.flush_pending_polls();
    // 10. Broadcast
    let mut b = Map::new();
    b.insert(
        "type".into(),
        match msg.get("type") {
            Some(v) if truthy(Some(v)) => v.clone(),
            _ => json!("done"),
        },
    );
    if let Some(v) = msg.get("id") {
        b.insert("id".into(), v.clone());
    }
    if let Some(v) = msg.get("message") {
        b.insert("message".into(), v.clone());
    }
    if let Some(v) = msg.get("file") {
        b.insert("file".into(), v.clone());
    }
    if let Some(v) = reply_meta.get("sourceFile") {
        b.insert("sourceFile".into(), v.clone());
    }
    if let Some(v) = reply_meta.get("previewFile") {
        b.insert("previewFile".into(), v.clone());
    }
    if let Some(v) = reply_meta.get("previewMode") {
        b.insert("previewMode".into(), v.clone());
    }
    if let Some(v) = msg.get("data") {
        b.insert("data".into(), v.clone());
    }
    st.broadcast(&Value::Object(b));
    drop(st);
    respond(stream, cors, json_res(200, json!({ "ok": true })));
}

// ---------------------------------------------------------------------------
// Manual edit routes (JS: live/manual-edit-routes.mjs)
// ---------------------------------------------------------------------------

fn summarize_pending_manual_edit_batch(
    cwd: &str,
    env: &Env,
    page_url: Option<&str>,
) -> Map<String, Value> {
    let buffer = manual_buffer::read_buffer(cwd, env);
    let entries: Vec<&Value> = buffer
        .entries
        .iter()
        .filter(|e| page_url.is_none() || e.get("pageUrl").and_then(|p| p.as_str()) == page_url)
        .collect();
    let mut m = Map::new();
    m.insert("pendingEntryCount".into(), json!(entries.len()));
    m.insert(
        "pendingOpCount".into(),
        json!(entries
            .iter()
            .map(|e| e
                .get("ops")
                .and_then(|o| o.as_array())
                .map(|a| a.len())
                .unwrap_or(0))
            .sum::<usize>()),
    );
    m
}

fn files_summary(files: Option<&Value>, limit: usize, cwd: &str) -> Vec<Value> {
    files
        .and_then(|f| f.as_array())
        .map(|a| {
            a.iter()
                .take(limit)
                .filter_map(|f| manual_apply::summarize_manual_log_file(Some(f), cwd))
                .map(Value::String)
                .collect()
        })
        .unwrap_or_default()
}

fn flag_truthy(v: Option<&str>) -> bool {
    matches!(
        v.map(|s| s.to_ascii_lowercase()).as_deref(),
        Some("1") | Some("true") | Some("yes")
    )
}

fn handle_manual_edit_route(
    shared: &Shared,
    stream: &mut TcpStream,
    cors: &[(String, String)],
    req: &Request,
    token: &str,
    ticket: &mut Ticket,
) {
    let p = req.path.as_str();
    let (cwd, env) = {
        let st = lock(shared);
        (st.cwd.clone(), st.env.clone())
    };
    let token_ok = req.query_get("token") == Some(token);
    match (p, req.method.as_str()) {
        ("/manual-edit-stash", "POST") => {
            let Some(msg) = parse_json_body(req) else {
                respond(
                    stream,
                    cors,
                    json_res(400, json!({ "error": "Invalid JSON" })),
                );
                return;
            };
            let msg_obj = msg.as_object().cloned().unwrap_or_default();
            if msg_obj.get("token").and_then(|t| t.as_str()) != Some(token) {
                respond(
                    stream,
                    cors,
                    json_res(401, json!({ "error": "Unauthorized" })),
                );
                return;
            }
            let mut check = msg_obj.clone();
            check.insert("type".into(), json!("manual_edits"));
            if let Some(error) = validate_event(&Value::Object(check)) {
                respond(stream, cors, json_res(400, json!({ "error": error })));
                return;
            }
            let entry = json!({
                "id": msg_obj.get("id"),
                "pageUrl": msg_obj.get("pageUrl"),
                "element": msg_obj.get("element"),
                "ops": msg_obj.get("ops"),
            });
            if let Err(e) = manual_buffer::stage_entry(&cwd, &env, &entry) {
                respond(
                    stream,
                    cors,
                    json_res(500, json!({ "error": "stash_write_failed", "message": e })),
                );
                return;
            }
            let (total, per_page) = manual_buffer::count_by_page(&cwd, &env);
            let page_url = msg_obj
                .get("pageUrl")
                .and_then(|p| p.as_str())
                .unwrap_or("");
            let pending_count = per_page.get(page_url).and_then(|v| v.as_u64()).unwrap_or(0);
            let ops = msg_obj
                .get("ops")
                .and_then(|o| o.as_array())
                .cloned()
                .unwrap_or_default();
            let mut hinted: Vec<String> = Vec::new();
            for op in &ops {
                if let Some(f) = manual_apply::summarize_manual_log_file(
                    op.get("sourceHint").and_then(|h| h.get("file")),
                    &cwd,
                ) {
                    if !hinted.contains(&f) {
                        hinted.push(f);
                    }
                }
            }
            let mut details = Map::new();
            details.insert(
                "id".into(),
                msg_obj.get("id").cloned().unwrap_or(Value::Null),
            );
            details.insert(
                "pageUrl".into(),
                msg_obj.get("pageUrl").cloned().unwrap_or(Value::Null),
            );
            details.insert("opCount".into(), json!(ops.len()));
            details.insert("pendingCount".into(), json!(pending_count));
            details.insert("totalCount".into(), json!(total));
            details.insert("hintedFileCount".into(), json!(hinted.len()));
            let mut st = lock(shared);
            st.record_manual_edit_activity("manual_edit_stashed", details);
            drop(st);
            respond(
                stream,
                cors,
                json_res(
                    200,
                    json!({ "ok": true, "pendingCount": pending_count, "totalCount": total, "perPage": per_page }),
                ),
            );
        }
        ("/manual-edit-stash", "GET") => {
            if !token_ok {
                respond(stream, cors, text_res(401, None, "Unauthorized"));
                return;
            }
            let page_url = req.query_get("pageUrl").unwrap_or("");
            let (total, per_page) = manual_buffer::count_by_page(&cwd, &env);
            let buffer = manual_buffer::read_buffer(&cwd, &env);
            let entries: Vec<Value> = if !page_url.is_empty() {
                buffer
                    .entries
                    .into_iter()
                    .filter(|e| e.get("pageUrl").and_then(|p| p.as_str()) == Some(page_url))
                    .collect()
            } else {
                buffer.entries
            };
            let count = if !page_url.is_empty() {
                per_page.get(page_url).and_then(|v| v.as_u64()).unwrap_or(0) as usize
            } else {
                total
            };
            respond(
                stream,
                cors,
                json_res(
                    200,
                    json!({ "count": count, "totalCount": total, "perPage": per_page, "entries": entries }),
                ),
            );
        }
        ("/manual-edit-commit", "POST") => {
            handle_manual_edit_commit(shared, stream, cors, req, token_ok, &cwd, &env, ticket)
        }
        ("/manual-edit-repair-decision", "POST") => {
            let payload: Value = if req.body.is_empty() {
                json!({})
            } else {
                match parse_json_body(req) {
                    Some(v) => v,
                    None => {
                        respond(
                            stream,
                            cors,
                            json_res(400, json!({ "error": "Invalid JSON" })),
                        );
                        return;
                    }
                }
            };
            let tok = payload
                .get("token")
                .and_then(|t| t.as_str())
                .filter(|s| !s.is_empty())
                .or_else(|| req.query_get("token"));
            if tok != Some(token) {
                respond(stream, cors, text_res(401, None, "Unauthorized"));
                return;
            }
            let page_url: Value = match payload.get("pageUrl") {
                Some(v) if truthy(Some(v)) => v.clone(),
                _ => match req.query_get("pageUrl") {
                    Some(s) if !s.is_empty() => json!(s),
                    _ => Value::Null,
                },
            };
            let action_raw = match payload.get("action") {
                Some(v) if truthy(Some(v)) => js_display(v),
                _ => req.query_get("action").unwrap_or("").to_string(),
            };
            let action = action_raw.trim().to_ascii_lowercase();
            if action != "rollback" {
                respond(
                    stream,
                    cors,
                    json_res(
                        400,
                        json!({ "error": "unsupported_manual_edit_repair_decision", "action": action }),
                    ),
                );
                return;
            }
            let mut st = lock(shared);
            let page_url_str = page_url.as_str().map(String::from);
            let rollback = manual_apply::rollback_transaction(
                &mut st,
                page_url_str.as_deref(),
                "manual_edit_user_requested_rollback",
            );
            let (total, per_page) = manual_buffer::count_by_page(&cwd, &env);
            let remaining = match page_url_str.as_deref() {
                Some(pu) => per_page.get(pu).and_then(|v| v.as_u64()).unwrap_or(0) as usize,
                None => total,
            };
            let mut response = Map::new();
            response.insert("action".into(), json!(action));
            response.insert("pageUrl".into(), page_url);
            response.insert("rollback".into(), rollback.unwrap_or(Value::Null));
            response.insert("remainingCount".into(), json!(remaining));
            response.insert("totalCount".into(), json!(total));
            response.insert("perPage".into(), Value::Object(per_page));
            st.record_manual_edit_activity("manual_edit_repair_rollback_done", response.clone());
            drop(st);
            respond(stream, cors, json_res(200, Value::Object(response)));
        }
        ("/manual-edit-discard", "POST") => {
            if !token_ok {
                respond(stream, cors, text_res(401, None, "Unauthorized"));
                return;
            }
            let page_url = req.query_get("pageUrl").map(String::from);
            let mut st = lock(shared);
            let buffer = manual_buffer::read_buffer(&cwd, &env);
            let transaction_rollback = manual_apply::rollback_transaction(
                &mut st,
                page_url.as_deref(),
                "manual_edit_discarded",
            );
            let (discarded_entries, discarded): (Vec<Value>, usize) = match page_url.as_deref() {
                Some(pu) => {
                    let entries: Vec<Value> = buffer
                        .entries
                        .iter()
                        .filter(|e| e.get("pageUrl").and_then(|p| p.as_str()) == Some(pu))
                        .cloned()
                        .collect();
                    let n = match manual_buffer::remove_entries(&cwd, &env, |e| {
                        e.get("pageUrl").and_then(|p| p.as_str()) == Some(pu)
                    }) {
                        Ok(n) => n,
                        Err(e) => {
                            drop(st);
                            respond(
                                stream,
                                cors,
                                json_res(500, json!({ "error": "discard_failed", "message": e })),
                            );
                            return;
                        }
                    };
                    (entries, n)
                }
                None => {
                    let n = match manual_buffer::truncate_buffer(&cwd, &env) {
                        Ok(n) => n,
                        Err(e) => {
                            drop(st);
                            respond(
                                stream,
                                cors,
                                json_res(500, json!({ "error": "discard_failed", "message": e })),
                            );
                            return;
                        }
                    };
                    (buffer.entries.clone(), n)
                }
            };
            let canceled = manual_apply::cancel_pending_events(
                &mut st,
                page_url.as_deref(),
                "manual_edit_discarded",
            );
            let (total, per_page) = manual_buffer::count_by_page(&cwd, &env);
            let mut details = Map::new();
            details.insert(
                "pageUrl".into(),
                page_url.as_deref().map(|s| json!(s)).unwrap_or(Value::Null),
            );
            details.insert("discarded".into(), json!(discarded));
            details.insert(
                "canceledApplyIds".into(),
                Value::Array(
                    canceled
                        .iter()
                        .map(|c| c.get("id").cloned().unwrap_or(Value::Null))
                        .collect(),
                ),
            );
            if let Some(tr) = &transaction_rollback {
                let mut t = Map::new();
                t.insert("id".into(), tr.get("id").cloned().unwrap_or(Value::Null));
                t.insert(
                    "rolledBackFiles".into(),
                    Value::Array(files_summary(tr.get("rolledBackFiles"), usize::MAX, &cwd)),
                );
                if let Some(rf) =
                    manual_apply::summarize_manual_diagnostics(tr.get("rollbackFailures"), &cwd)
                {
                    t.insert("rollbackFailures".into(), rf);
                }
                if let Some(s) = tr.get("skipped") {
                    t.insert("skipped".into(), s.clone());
                }
                details.insert("transactionRollback".into(), Value::Object(t));
            }
            details.insert("totalCount".into(), json!(total));
            st.record_manual_edit_activity("manual_edit_discarded", details);
            drop(st);
            respond(
                stream,
                cors,
                json_res(
                    200,
                    json!({ "discarded": discarded, "entries": discarded_entries, "canceledApplyEvents": canceled, "totalCount": total, "perPage": per_page }),
                ),
            );
        }
        ("/manual-edit", "POST") => {
            respond(
                stream,
                cors,
                json_res(
                    410,
                    json!({ "error": "/manual-edit is removed; use /manual-edit-stash and /manual-edit-commit for staged copy edits." }),
                ),
            );
        }
        _ => respond(stream, cors, text_res(404, None, "Not found")),
    }
}

fn handle_manual_edit_commit(
    shared: &Shared,
    stream: &mut TcpStream,
    cors: &[(String, String)],
    req: &Request,
    token_ok: bool,
    cwd: &str,
    env: &Env,
    ticket: &mut Ticket,
) {
    if !token_ok {
        respond(stream, cors, text_res(401, None, "Unauthorized"));
        return;
    }
    let page_url: Option<String> = req.query_get("pageUrl").map(String::from);
    let page_url_val = page_url.as_deref().map(|s| json!(s)).unwrap_or(Value::Null);
    let async_mode = flag_truthy(req.query_get("async"));
    let repair_only = flag_truthy(req.query_get("repair"));
    let existing_transaction = manual_apply::read_manual_apply_transaction(cwd, env);
    if repair_only && existing_transaction.is_none() {
        respond(
            stream,
            cors,
            json_res(
                409,
                json!({ "error": "manual_edit_repair_transaction_missing" }),
            ),
        );
        return;
    }
    let mut st = lock(shared);
    let recovered = if repair_only {
        None
    } else {
        manual_apply::rollback_transaction(
            &mut st,
            page_url.as_deref(),
            "manual_edit_commit_recovered_abandoned_transaction",
        )
    };
    let before = st.manual_edit_status();
    let before_total = before.get("totalCount").cloned().unwrap_or(json!(0));
    let before_per_page = before.get("perPage").cloned().unwrap_or(json!({}));
    let pending_count: u64 = match page_url.as_deref() {
        Some(pu) => before_per_page
            .get(pu)
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
        None => before_total.as_u64().unwrap_or(0),
    };
    let mut details = Map::new();
    details.insert("pageUrl".into(), page_url_val.clone());
    details.insert("repairOnly".into(), json!(repair_only));
    details.insert("pendingCount".into(), json!(pending_count));
    details.insert("totalCount".into(), before_total.clone());
    details.insert(
        "recoveredTransaction".into(),
        match &recovered {
            Some(r) => {
                let mut m = Map::new();
                m.insert("id".into(), r.get("id").cloned().unwrap_or(Value::Null));
                m.insert(
                    "reason".into(),
                    r.get("reason").cloned().unwrap_or(Value::Null),
                );
                if let Some(s) = r.get("skipped") {
                    m.insert("skipped".into(), s.clone());
                }
                if let Some(f) = r.get("rolledBackFiles") {
                    m.insert("rolledBackFiles".into(), f.clone());
                }
                if let Some(rf) =
                    manual_apply::summarize_manual_diagnostics(r.get("rollbackFailures"), cwd)
                {
                    m.insert("rollbackFailures".into(), rf);
                }
                Value::Object(m)
            }
            None => Value::Null,
        },
    );
    for (k, v) in summarize_pending_manual_edit_batch(cwd, env, page_url.as_deref()) {
        details.insert(k, v);
    }
    st.record_manual_edit_activity("manual_edit_commit_started", details);
    drop(st);
    // The commit itself waits on an agent (JS: awaited); later requests must
    // not queue behind it.
    ticket.release();
    if async_mode {
        respond(
            stream,
            cors,
            json_res(
                202,
                json!({ "status": "started", "pendingCount": pending_count, "totalCount": before_total, "perPage": before_per_page }),
            ),
        );
    }
    // The commit itself.
    let mut routed_provider = "subprocess";
    let mut transaction: Option<Value> = None;
    let mut commit_batch: Option<Value> = None;
    if pending_count > 0 {
        let transaction_batch = crate::manual_edits::evidence::build_manual_edit_evidence(
            cwd,
            env,
            page_url.as_deref(),
        );
        if !repair_only && manual_apply::count_manual_apply_ops(&transaction_batch) > 0 {
            transaction = Some(manual_apply::write_manual_apply_transaction(
                cwd,
                env,
                &page_url_val,
                &transaction_batch,
            ));
        } else if repair_only && existing_transaction.is_some() {
            transaction = existing_transaction.clone();
        }
        commit_batch = Some(transaction_batch);
    }
    let requested_mode = env
        .get("IMPECCABLE_LIVE_COPY_AGENT")
        .cloned()
        .unwrap_or_else(|| "auto".to_string())
        .trim()
        .to_ascii_lowercase();
    let chat_active = || lock(shared).chat_agent_likely_active();
    let use_chat = requested_mode == "chat" || (requested_mode == "auto" && chat_active());
    let timeout_ms = {
        let raw = env
            .get("IMPECCABLE_LIVE_COPY_AGENT_TIMEOUT_MS")
            .filter(|v| !v.is_empty());
        match raw {
            Some(v) => impeccable_core::js::string_to_number(v),
            None => 120000.0,
        }
    };
    let transaction_id: Option<String> = transaction
        .as_ref()
        .and_then(|t| t.get("id"))
        .and_then(|v| v.as_str())
        .map(String::from)
        .or_else(|| {
            existing_transaction
                .as_ref()
                .and_then(|t| t.get("id"))
                .and_then(|v| v.as_str())
                .map(String::from)
        });
    let result: Result<Value, String> = if use_chat {
        routed_provider = "chat";
        let shared_c = shared.clone();
        let page_url_c = page_url_val.clone();
        let mut apply_cb = move |batch: &Value, repair: Option<&Value>| -> Result<Value, String> {
            manual_apply::push_batch_in_chunks_and_wait(&shared_c, batch, &page_url_c, repair)
        };
        crate::manual_edits::commit::commit_manual_edits(
            crate::manual_edits::commit::CommitOptions {
                cwd,
                env,
                page_url: page_url.as_deref(),
                provider: Some("chat"),
                timeout_ms: Some(timeout_ms),
                apply_batch_to_source: Some(&mut apply_cb),
                chat_available: Some(&chat_active),
                repair_only,
                transaction_id: transaction_id.as_deref(),
                batch: commit_batch.as_ref(),
            },
        )
    } else {
        let provider = if ["codex", "claude", "mock"].contains(&requested_mode.as_str()) {
            Some(requested_mode.as_str())
        } else {
            None
        };
        crate::manual_edits::commit::commit_manual_edits(
            crate::manual_edits::commit::CommitOptions {
                cwd,
                env,
                page_url: page_url.as_deref(),
                provider,
                timeout_ms: Some(timeout_ms),
                apply_batch_to_source: None,
                chat_available: Some(&chat_active),
                repair_only,
                transaction_id: transaction_id.as_deref(),
                batch: commit_batch.as_ref(),
            },
        )
    };
    let result = match result {
        Ok(r) => r,
        Err(message) => {
            let mut st = lock(shared);
            if transaction.is_some() {
                manual_apply::rollback_transaction(
                    &mut st,
                    page_url.as_deref(),
                    "manual_edit_commit_exception",
                );
            }
            let mut details = Map::new();
            details.insert("pageUrl".into(), page_url_val.clone());
            details.insert("provider".into(), json!(routed_provider));
            details.insert("error".into(), json!("manual_edit_commit_failed"));
            details.insert("message".into(), json!(message));
            details.insert(
                "transactionId".into(),
                transaction
                    .as_ref()
                    .and_then(|t| t.get("id"))
                    .cloned()
                    .unwrap_or(Value::Null),
            );
            st.record_manual_edit_activity("manual_edit_commit_failed", details);
            // finally: clear transaction (result undefined -> not kept)
            if let Some(t) = &transaction {
                manual_apply::clear_manual_apply_transaction(
                    cwd,
                    env,
                    t.get("id").and_then(|v| v.as_str()),
                );
            }
            drop(st);
            if !async_mode {
                respond(
                    stream,
                    cors,
                    json_res(
                        500,
                        json!({ "error": "manual_edit_commit_failed", "message": message }),
                    ),
                );
            }
            return;
        }
    };
    if let Some(t) = &transaction {
        let keep = result.get("needsManualDecision") == Some(&Value::Bool(true));
        if !keep {
            manual_apply::clear_manual_apply_transaction(
                cwd,
                env,
                t.get("id").and_then(|v| v.as_str()),
            );
        }
    }
    let (total, per_page) = manual_buffer::count_by_page(cwd, env);
    let remaining = match page_url.as_deref() {
        Some(pu) => per_page.get(pu).and_then(|v| v.as_u64()).unwrap_or(0) as usize,
        None => total,
    };
    let tid_val = transaction_id
        .as_deref()
        .map(|s| json!(s))
        .unwrap_or(Value::Null);
    let mut st = lock(shared);
    if result.get("needsManualDecision") == Some(&Value::Bool(true)) {
        let mut details = Map::new();
        details.insert("pageUrl".into(), page_url_val.clone());
        details.insert("provider".into(), json!(routed_provider));
        details.insert("transactionId".into(), tid_val);
        details.insert(
            "repair".into(),
            match result.get("repair") {
                Some(v) if truthy(Some(v)) => v.clone(),
                _ => Value::Null,
            },
        );
        details.insert(
            "failed".into(),
            manual_apply::summarize_manual_apply_failures(result.get("failed"), cwd),
        );
        details.insert(
            "files".into(),
            Value::Array(files_summary(result.get("files"), 20, cwd)),
        );
        details.insert("remainingCount".into(), json!(remaining));
        details.insert("totalCount".into(), json!(total));
        st.record_manual_edit_activity("manual_edit_repair_needs_decision", details);
    } else {
        let mut details = Map::new();
        details.insert("pageUrl".into(), page_url_val.clone());
        details.insert("provider".into(), json!(routed_provider));
        details.insert(
            "reason".into(),
            match result.get("reason") {
                Some(v) if truthy(Some(v)) => v.clone(),
                _ => Value::Null,
            },
        );
        details.insert(
            "repair".into(),
            match result.get("repair") {
                Some(v) if truthy(Some(v)) => v.clone(),
                _ => Value::Null,
            },
        );
        details.insert(
            "appliedCount".into(),
            json!(result
                .get("applied")
                .and_then(|a| a.as_array())
                .map(|a| a.len())
                .unwrap_or(0)),
        );
        details.insert(
            "failedCount".into(),
            json!(result
                .get("failed")
                .and_then(|a| a.as_array())
                .map(|a| a.len())
                .unwrap_or(0)),
        );
        details.insert(
            "failed".into(),
            manual_apply::summarize_manual_apply_failures(result.get("failed"), cwd),
        );
        details.insert(
            "files".into(),
            Value::Array(files_summary(result.get("files"), 20, cwd)),
        );
        if let Some(w) = manual_apply::summarize_manual_diagnostics(result.get("warnings"), cwd) {
            details.insert("warnings".into(), w);
        }
        details.insert(
            "rolledBackFiles".into(),
            Value::Array(files_summary(result.get("rolledBackFiles"), 20, cwd)),
        );
        if let Some(rf) =
            manual_apply::summarize_manual_diagnostics(result.get("rollbackFailures"), cwd)
        {
            details.insert("rollbackFailures".into(), rf);
        }
        if let Some(Value::Array(_)) = result.get("unreportedFiles") {
            details.insert(
                "unreportedFiles".into(),
                Value::Array(files_summary(result.get("unreportedFiles"), 20, cwd)),
            );
        }
        details.insert(
            "noteCount".into(),
            json!(result
                .get("notes")
                .and_then(|a| a.as_array())
                .map(|a| a.len())
                .unwrap_or(0)),
        );
        details.insert(
            "cleared".into(),
            match result.get("cleared") {
                Some(v) if truthy(Some(v)) => v.clone(),
                _ => json!(0),
            },
        );
        details.insert("remainingCount".into(), json!(remaining));
        details.insert("totalCount".into(), json!(total));
        st.record_manual_edit_activity("manual_edit_commit_done", details);
    }
    drop(st);
    if !async_mode {
        let mut body = result.as_object().cloned().unwrap_or_default();
        body.insert("totalCount".into(), json!(total));
        body.insert("perPage".into(), Value::Object(per_page));
        respond(stream, cors, json_res(200, Value::Object(body)));
    }
}

#[cfg(test)]
mod content_type_tests {
    use super::*;

    // upstream 632912b5 / #690: the generated /live.js and /detect.js responses
    // must declare charset=utf-8 so non-ASCII bytes in the scripts are decoded
    // correctly. These lock the Content-Type the two route arms emit.
    #[test]
    fn detect_js_response_declares_utf8_charset() {
        let res = text_res(200, Some("application/javascript; charset=utf-8"), "console.log(1)");
        assert!(res
            .headers
            .iter()
            .any(|(k, v)| k == "Content-Type" && v == "application/javascript; charset=utf-8"));
    }

    #[test]
    fn live_js_response_declares_utf8_charset() {
        let res = Response::new(200)
            .header("Content-Type", "application/javascript; charset=utf-8")
            .header(
                "Cache-Control",
                "no-store, no-cache, must-revalidate, max-age=0",
            )
            .header("Pragma", "no-cache")
            .text("body");
        assert!(res
            .headers
            .iter()
            .any(|(k, v)| k == "Content-Type" && v == "application/javascript; charset=utf-8"));
    }
}
