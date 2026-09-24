//! Component review is an explicit, opt-in runtime. It does not yet replace the build-phase gates.
pub mod capture;
mod history;
mod lifecycle;
mod manifest;
mod server;
mod store;
#[cfg(test)]
mod tests;
pub mod verify;
mod visual_approval;
use impeccable_common::Io;
use serde_json::json;
use std::path::PathBuf;
fn arg(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|v| v == name)
        .and_then(|i| args.get(i + 1))
        .cloned()
}
fn decode_path(s: &str) -> Result<String, String> {
    let mut out = Vec::new();
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len() {
                return Err("bad path escape".into());
            }
            let pair = std::str::from_utf8(&bytes[i + 1..i + 3]).map_err(|e| e.to_string())?;
            out.push(u8::from_str_radix(pair, 16).map_err(|e| e.to_string())?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    let decoded = String::from_utf8(out).map_err(|e| e.to_string())?;
    if decoded.chars().any(char::is_control) {
        return Err("control character in path".into());
    }
    Ok(decoded)
}
pub fn run(args: &[String], io: &mut Io) -> i32 {
    run_with_capturer(args, io, None)
}
pub fn run_with_capturer(
    args: &[String],
    io: &mut Io,
    mut capturer: Option<&mut dyn capture::ComponentCapturer>,
) -> i32 {
    let result = (|| -> Result<i32, String> {
        let store = arg(args, "--store")
            .map(PathBuf::from)
            .or_else(|| io.home().map(|h| h.join(".impeccable/component-reviews")))
            .ok_or("no home directory; supply --store outside the project")?;
        match args.first().map(String::as_str) {
            Some("lifecycle") => {
                let sessions: Vec<PathBuf> = args.windows(2).filter(|w| w[0] == "--session-dir")
                    .map(|w| PathBuf::from(&w[1])).collect();
                let required: Vec<String> = args.windows(2).filter(|w| w[0] == "--require")
                    .map(|w| w[1].clone()).collect();
                let sessions = if sessions.is_empty() && !args.iter().any(|a| a == "--hosted") {
                    let project = io.cwd.canonicalize().map_err(|e| e.to_string())?;
                    lifecycle::project_sessions(&store, &project)?
                } else { sessions };
                io.out(&format!("{}\n", lifecycle::inspect(&sessions, &required)?));
                Ok(0)
            }
            Some("prepare") | Some("capture") => {
                let path = arg(args, "--manifest")
                    .ok_or("prepare needs --manifest <project-relative file>")?;
                if args[0] == "capture" {
                    if let Some(tool) = io.env("IMPECCABLE_COMPONENT_REVIEW_TOOL") {
                        return Err(format!("This session uses hosted human review. Call {tool} with manifest_path={path:?}; it captures the components and waits for the user's decisions. A failed capture is not approval."));
                    }
                }
                let project = io.cwd.canonicalize().map_err(|e| e.to_string())?;
                let renderer=if args[0]=="capture" {Some(capturer.take().ok_or("native component capturer unavailable")?)}else{None};
                let dir=store::prepare_file(&store,&project,&path,renderer)?;
                let state = store::read(&dir.join("current.json"))?;
                let status = state["receipt"]["visualDecision"]
                    .as_str()
                    .unwrap_or("awaiting-review");
                io.out(&format!("{}\n", json!({
                    "session": dir.file_name().unwrap().to_string_lossy(),
                    "revision": state["packet"]["revision"],
                    "status": status,
                    "capture": state["capture"],
                    "round": state["packet"]["round"],
                    "lifecycle": if lifecycle::closed(&state) { lifecycle::terminal(&state) } else { serde_json::Value::Null }
                })));
                Ok(0)
            }
            Some("verify") => {
                let path = arg(args, "--manifest").ok_or("verify needs --manifest <project-relative file>")?;
                let receipt = verify::approved(&store, &io.cwd, &path)?;
                io.out(&format!("{}\n", receipt));
                Ok(0)
            }
            Some("serve") | Some("status") | Some("refresh-approvals") => {
                let id = arg(args, "--session").ok_or("needs --session <id from prepare>")?;
                if id.len() != 64 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
                    return Err("invalid session id".into());
                }
                let dir = store.join(id);
                if args[0] == "refresh-approvals" {
                    let count=store::refresh_approvals(&dir)?;
                    io.out(&format!("{}\n",json!({"carried":count})));
                    Ok(0)
                } else if args[0] == "serve" {
                    // Same no-browser signal as serve-question: exit 2 routes to the unattended path.
                    let set = |k: &str| io.env(k).is_some_and(|v| !v.is_empty());
                    let headless = set("CI") || (set("SSH_CONNECTION") && !set("DISPLAY"))
                        || (cfg!(target_os = "linux") && !set("DISPLAY") && !set("WAYLAND_DISPLAY"));
                    if set("IMPECCABLE_QUESTION_DISABLED") || (headless && !set("IMPECCABLE_QUESTION_FORCE")) {
                        io.out("component-review: no reviewer can open a browser in this session; the review stays pending.\n");
                        return Ok(2);
                    }
                    let port = arg(args, "--port")
                        .unwrap_or_else(|| "0".into())
                        .parse::<u16>()
                        .map_err(|e| e.to_string())?;
                    let idle = arg(args, "--idle-timeout")
                        .or_else(|| io.env("IMPECCABLE_COMPONENT_REVIEW_IDLE_TIMEOUT").map(String::from))
                        .map(|v| v.parse::<u64>().ok().filter(|&n| n > 0).ok_or("--idle-timeout needs a positive number of seconds"))
                        .transpose()?
                        .unwrap_or(30 * 60);
                    static STOP: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
                    impeccable_common::proc::on_interrupt(&STOP);
                    let limits = server::Limits { idle: std::time::Duration::from_secs(idle), grace: std::time::Duration::from_secs(5) };
                    server::serve(&dir, port, io, limits, Some(&STOP))
                } else {
                    let state = store::read(&dir.join("current.json"))?;
                    io.out(&format!("{}\n", json!({
                        "revision": state["packet"]["revision"],
                        "receipt": state["receipt"],
                        "capture": state["capture"],
                        "sourceStatus": if lifecycle::closed(&state) { None } else { store::sources_current(&state).err() },
                        "lifecycle": if lifecycle::closed(&state) { lifecycle::terminal(&state) } else { serde_json::Value::Null },
                        // A crashed or killed server leaves its file behind; only a live PID is a service.
                        "service": store::read(&dir.join("service.json")).ok()
                            .filter(|s| s["pid"].as_i64().is_some_and(impeccable_common::proc::pid_reachable))
                    })));
                    Ok(0)
                }
            }
            _ => Err("usage: impeccable component-review prepare|capture|verify --manifest <file> | lifecycle [--session-dir <dir>] [--require components|hero] [--hosted] | serve --session <id> [--port 0] [--idle-timeout <seconds>] | status|refresh-approvals --session <id> [--store <outside-project-dir>]".into())
        }
    })();
    match result {
        Ok(code) => code,
        Err(e) => {
            io.err(&format!("component-review: {e}\n"));
            1
        }
    }
}
