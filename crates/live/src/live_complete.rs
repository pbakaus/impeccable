//! JS: live-complete.mjs -> `impeccable live-complete`. The canonical durable
//! completion acknowledgement, gated on the accepted source being clean.

use crate::accept_verify::verify_accepted_file;
use crate::paths::read_live_server_info;
use crate::roots::enter_live_root;
use crate::server::post_poll;
use crate::session::create_live_session_store;
use crate::util::{json_pretty, jsp, println};
use impeccable_common::Io;
use serde_json::{json, Value};

const USAGE: &str = "Usage: impeccable live-complete --id SESSION_ID [--discarded|--error MESSAGE] [--force]\n\nAppend the final durable session acknowledgement. Use after accept/discard cleanup is verified.\nCompletion is refused while the session's source file still carries live-mode leftovers\n(markers, data-p-* attributes, unbaked --p-* vars); fix the file or pass --force.";

struct Args {
    id: Option<String>,
    status: &'static str,
    message: Option<String>,
    force: bool,
    help: bool,
}

fn parse_args(argv: &[String]) -> Args {
    let mut out = Args {
        id: None,
        status: "complete",
        message: None,
        force: false,
        help: false,
    };
    let mut i = 0;
    while i < argv.len() {
        let a = &argv[i];
        if a == "--id" {
            i += 1;
            out.id = argv.get(i).cloned();
        } else if let Some(v) = a.strip_prefix("--id=") {
            out.id = Some(v.to_string());
        } else if a == "--discarded" || a == "--discard" {
            out.status = "discarded";
        } else if a == "--error" {
            out.status = "agent_error";
            i += 1;
            out.message = Some(
                argv.get(i)
                    .cloned()
                    .filter(|m| !m.is_empty())
                    .unwrap_or_else(|| "unknown error".to_string()),
            );
        } else if let Some(v) = a.strip_prefix("--error=") {
            out.status = "agent_error";
            out.message = Some(v.to_string());
        } else if a == "--force" {
            out.force = true;
        } else if a == "--help" || a == "-h" {
            out.help = true;
        }
        i += 1;
    }
    out
}

pub fn run(args: &[String], io: &mut Io) -> i32 {
    let mut argv: Vec<String> = args.to_vec();
    if let Err(code) = enter_live_root(&mut argv, io) {
        return code;
    }
    complete_cli(&argv, io)
}

fn complete_cli(argv: &[String], io: &mut Io) -> i32 {
    let args = parse_args(argv);
    let id = args.id.clone().filter(|s| !s.is_empty());
    if args.help || id.is_none() {
        println(io, USAGE);
        return if args.help { 0 } else { 1 };
    }
    let id = id.unwrap();
    let cwd = io.cwd.to_string_lossy().into_owned();
    let env = io.env.clone();

    if args.status == "complete" && !args.force {
        let store = create_live_session_store(&cwd, &env, Some(&id));
        let snapshot = match store.get_snapshot(&id, true) {
            Ok(s) => s,
            Err(e) => {
                crate::util::eprintln(io, &format!("Error: {}", e));
                return 1;
            }
        };
        let source_file = snapshot
            .as_ref()
            .and_then(|s| s.get("sourceFile"))
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(String::from);
        if let Some(sf) = &source_file {
            let abs = jsp::resolve(&cwd, &[sf]);
            let rel = jsp::relative("/", &cwd, &abs);
            let inside = !rel.is_empty() && !rel.starts_with("..") && !jsp::is_absolute(&rel);
            if inside
                && !rel.starts_with(&format!("node_modules{}", jsp::SEP))
                && !rel.starts_with("node_modules/")
            {
                let (clean, findings, _missing) = verify_accepted_file(&abs);
                if !clean {
                    println(
                        io,
                        &json_pretty(&json!({
                            "ok": false,
                            "error": "source_dirty",
                            "id": id,
                            "file": sf,
                            "findings": findings,
                            "hint": "The accepted source still carries live-mode leftovers. Finish the carbonize cleanup (bake params, remove markers and data-p-* attributes), then run live-complete again. Use --force only if a finding is a false positive.",
                        })),
                    );
                    return 1;
                }
            }
        }
    }

    let server_info = read_live_server_info(&cwd, &env).map(|(i, _)| i);
    let server_result: Option<Value> = server_info.as_ref().and_then(|info| {
        let ty = match args.status {
            "discarded" => "discarded",
            "agent_error" => "error",
            _ => "complete",
        };
        let mut body = json!({ "token": info.token.clone().map(Value::String).unwrap_or(Value::Null), "id": id, "type": ty });
        if let Some(m) = &args.message {
            body["message"] = json!(m);
        }
        if info.token.is_none() {
            body.as_object_mut().map(|o| o.shift_remove("token"));
        }
        info.port.and_then(|p| post_poll(p, &body))
    });
    if server_result
        .as_ref()
        .and_then(|r| r.get("ok"))
        .map(crate::inject::detect_utils::truthy)
        .unwrap_or(false)
    {
        let store = create_live_session_store(&cwd, &env, Some(&id));
        let snapshot = store.get_snapshot(&id, true).ok().flatten();
        let phase = snapshot
            .as_ref()
            .and_then(|s| s.get("phase"))
            .filter(|p| crate::inject::detect_utils::truthy(p))
            .cloned()
            .unwrap_or_else(|| json!(args.status));
        println(
            io,
            &json_pretty(
                &json!({ "ok": true, "id": id, "phase": phase, "snapshot": snapshot.map(Value::Object).unwrap_or(Value::Null) }),
            ),
        );
        return 0;
    }

    let store = create_live_session_store(&cwd, &env, Some(&id));
    let event = match args.status {
        "discarded" => json!({ "type": "discarded", "id": id }),
        "agent_error" => {
            json!({ "type": "agent_error", "id": id, "message": args.message.clone().unwrap_or_else(|| "unknown error".to_string()) })
        }
        _ => json!({ "type": "complete", "id": id }),
    };
    match store.append_event(&event) {
        Ok(snapshot) => {
            let phase = snapshot.get("phase").cloned().unwrap_or(Value::Null);
            println(
                io,
                &json_pretty(
                    &json!({ "ok": true, "id": id, "phase": phase, "snapshot": Value::Object(snapshot) }),
                ),
            );
            0
        }
        Err(e) => {
            crate::util::eprintln(io, &format!("Error: {}", e));
            1
        }
    }
}
