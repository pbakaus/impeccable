//! JS: live-commit-manual-edits.mjs `main()` -> `impeccable
//! live-commit-manual-edits`. Applies pending live copy edits as one AI-owned
//! batch and prints the commit result as JSON.

use crate::manual_edits::commit::{commit_manual_edits_value, CommitOptions};
use crate::util::{eprintln, json_compact, println};
use impeccable_common::Io;
use serde_json::{json, Value};

/// JS: argVal(args, name). A bare flag yields the boolean `true`.
pub(crate) fn arg_val(args: &[String], name: &str) -> Value {
    let prefix = format!("{}=", name);
    for arg in args {
        if arg == name {
            return Value::Bool(true);
        }
        if let Some(rest) = arg.strip_prefix(&prefix) {
            return Value::String(rest.to_string());
        }
    }
    Value::Null
}

pub fn run(args: &[String], io: &mut Io) -> i32 {
    if args.iter().any(|a| a == "--help" || a == "-h") {
        println(
            io,
            "Usage: impeccable live-commit-manual-edits [--page-url=<url>] [--provider=auto|codex|claude|mock]",
        );
        return 0;
    }

    let cwd = io.cwd.to_string_lossy().into_owned();
    let env = io.env.clone();
    let page_url = arg_val(args, "--page-url");
    // JS-PARITY: live-commit-manual-edits.mjs#main passes `argVal(...) ||
    // undefined`, so a bare `--provider` reaches the runner as the boolean
    // `true` and falls through to "Unsupported live copy-edit AI runner: true".
    // The string "true" reproduces every branch of that path.
    let provider: Option<String> = match arg_val(args, "--provider") {
        Value::Bool(true) => Some("true".to_string()),
        Value::String(s) if !s.is_empty() => Some(s),
        _ => None,
    };
    let timeout_ms = match env.get("IMPECCABLE_LIVE_COPY_AGENT_TIMEOUT_MS") {
        Some(v) if !v.is_empty() => impeccable_core::js::string_to_number(v),
        _ => 120_000.0,
    };

    let opts = CommitOptions {
        cwd: &cwd,
        env: &env,
        page_url: None,
        provider: provider.as_deref(),
        timeout_ms: Some(timeout_ms),
        apply_batch_to_source: None,
        chat_available: None,
        repair_only: false,
        transaction_id: None,
        batch: None,
    };
    match commit_manual_edits_value(opts, page_url) {
        Ok(result) => {
            println(io, &json_compact(&result));
            0
        }
        Err(message) => {
            eprintln(
                io,
                &json_compact(&json!({ "error": "commit_failed", "message": message })),
            );
            1
        }
    }
}
