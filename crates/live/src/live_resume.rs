//! JS: live-resume.mjs -> `impeccable live-resume`. The active durable
//! session checkpoint and the next safe agent action; also the hint helpers
//! `live-status` shares.

use crate::roots::enter_live_root;
use crate::session::create_live_session_store;
use crate::util::{json_pretty, println};
use impeccable_common::Io;
use serde_json::{json, Map, Value};

fn manual_apply_reply_command(self_cmd: &str, id: Option<&str>) -> String {
    format!(
        "{} live-poll --reply {} done --data '<json>'",
        self_cmd,
        id.unwrap_or("EVENT_ID")
    )
}

/// How this binary is spelled in printed agent commands (IMPECCABLE_SELF or
/// the plain `impeccable` verb).
pub fn self_cmd(io: &Io) -> String {
    let cwd = io.cwd.to_string_lossy().into_owned();
    impeccable_context::provider::detect(&io.env, &cwd).self_cmd
}

fn truthy(v: Option<&Value>) -> bool {
    v.map(crate::inject::detect_utils::truthy).unwrap_or(false)
}

fn finite(v: Option<&Value>) -> Option<f64> {
    v.and_then(|x| x.as_f64()).filter(|f| f.is_finite())
}

/// JS: manualApplyResumeHint(event)
pub fn manual_apply_resume_hint(event: Option<&Map<String, Value>>, self_cmd: &str) -> String {
    let empty = Map::new();
    let event = event.unwrap_or(&empty);
    let summary: Map<String, Value> = match event.get("manualApplySummary") {
        Some(v) if crate::inject::detect_utils::truthy(v) => {
            v.as_object().cloned().unwrap_or_default()
        }
        _ => summarize_manual_apply_event(event),
    };
    let mut parts: Vec<String> = Vec::new();
    if truthy(summary.get("pageUrl")) {
        parts.push(format!("page {}", str_of(summary.get("pageUrl"))));
    }
    if truthy(summary.get("chunk")) {
        let chunk = summary.get("chunk").unwrap();
        parts.push(format!(
            "chunk {}/{}",
            str_of(chunk.get("index")),
            str_of(chunk.get("total"))
        ));
    }
    if let Some(n) = finite(summary.get("opCount")) {
        parts.push(format!(
            "{} op(s)",
            impeccable_core::js::number_to_string(n)
        ));
    }
    if let Some(n) = finite(summary.get("entryCount")) {
        parts.push(format!(
            "{} entr{}",
            impeccable_core::js::number_to_string(n),
            if n == 1.0 { "y" } else { "ies" }
        ));
    }
    if let Some(files) = summary
        .get("files")
        .and_then(|f| f.as_array())
        .filter(|f| !f.is_empty())
    {
        let list: Vec<String> = files.iter().map(|f| str_of(Some(f))).collect();
        parts.push(format!("likely files: {}", list.join(", ")));
    }
    let scope = if parts.is_empty() {
        String::new()
    } else {
        format!(" ({})", parts.join(", "))
    };
    let id = event.get("id").and_then(|i| i.as_str());
    format!("Manual Apply pending{}. If you have not already leased it, run {} live-poll. Apply the source edits from the manual_edit_apply batch, then reply with {}. Polling only leases this work item; it does not commit source edits. Do not run {} live-commit-manual-edits for this leased event. Do not poll again before replying.", scope, self_cmd, manual_apply_reply_command(self_cmd, id), self_cmd)
}

/// JS template-literal stringification of a JSON value.
fn str_of(v: Option<&Value>) -> String {
    match v {
        None => "undefined".to_string(),
        Some(Value::Null) => "null".to_string(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n
            .as_f64()
            .map(impeccable_core::js::number_to_string)
            .unwrap_or_else(|| n.to_string()),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Array(a)) => a
            .iter()
            .map(|x| str_of(Some(x)))
            .collect::<Vec<_>>()
            .join(","),
        Some(Value::Object(_)) => "[object Object]".to_string(),
    }
}

fn summarize_manual_apply_event(event: &Map<String, Value>) -> Map<String, Value> {
    let batch = event.get("batch");
    let entries: Vec<Value> = batch
        .and_then(|b| b.get("entries"))
        .and_then(|e| e.as_array())
        .cloned()
        .unwrap_or_default();
    let op_count: usize = entries
        .iter()
        .map(|e| {
            e.get("ops")
                .and_then(|o| o.as_array())
                .map(|a| a.len())
                .unwrap_or(0)
        })
        .sum();
    let mut m = Map::new();
    m.insert(
        "pageUrl".into(),
        match event.get("pageUrl") {
            Some(v) if crate::inject::detect_utils::truthy(v) => v.clone(),
            _ => Value::Null,
        },
    );
    m.insert(
        "chunk".into(),
        match event.get("chunk") {
            Some(v) if crate::inject::detect_utils::truthy(v) => v.clone(),
            _ => Value::Null,
        },
    );
    m.insert("entryCount".into(), json!(entries.len()));
    m.insert("opCount".into(), json!(op_count));
    m.insert("files".into(), json!(collect_manual_apply_files(batch)));
    m
}

fn collect_manual_apply_files(batch: Option<&Value>) -> Vec<String> {
    let mut files: Vec<String> = Vec::new();
    let mut push = |v: Option<&Value>| {
        if let Some(Value::String(s)) = v {
            if !s.is_empty() && !files.contains(s) {
                files.push(s.clone());
            }
        }
    };
    let arr = |v: Option<&Value>| v.and_then(|x| x.as_array()).cloned().unwrap_or_default();
    for entry in arr(batch.and_then(|b| b.get("entries"))) {
        for op in arr(entry.get("ops")) {
            push(op.get("sourceHint").and_then(|h| h.get("file")));
        }
    }
    for cand in arr(batch.and_then(|b| b.get("candidates"))) {
        push(cand.get("sourceHint").and_then(|h| h.get("relativeFile")));
        push(cand.get("sourceHint").and_then(|h| h.get("file")));
        for key in [
            "textMatches",
            "objectKeyMatches",
            "locatorMatches",
            "contextTextMatches",
        ] {
            for item in arr(cand.get(key)) {
                push(item.get("file"));
            }
        }
    }
    files.sort();
    files
}

/// JS: renderSummary(snapshot) -> { renderState, mountedVariants, mountFailures }
pub fn render_summary(snapshot: Option<&Map<String, Value>>) -> Map<String, Value> {
    let mut m = Map::new();
    let get = |k: &str| snapshot.and_then(|s| s.get(k)).cloned();
    m.insert(
        "renderState".into(),
        get("renderState").unwrap_or(Value::Null),
    );
    m.insert(
        "mountedVariants".into(),
        get("mountedVariants")
            .filter(|v| v.is_array())
            .unwrap_or_else(|| json!([])),
    );
    m.insert(
        "mountFailures".into(),
        get("mountFailures")
            .filter(|v| v.is_array())
            .unwrap_or_else(|| json!([])),
    );
    m
}

/// JS: mountFailureAction(snapshot)
pub fn mount_failure_action(
    snapshot: Option<&Map<String, Value>>,
    self_cmd: &str,
) -> Option<String> {
    let failures = snapshot
        .and_then(|s| s.get("mountFailures"))
        .and_then(|f| f.as_array())
        .cloned()
        .unwrap_or_default();
    let latest = failures.last()?;
    let where_ = if truthy(latest.get("url")) {
        format!(" from {}", str_of(latest.get("url")))
    } else {
        String::new()
    };
    let why = if truthy(latest.get("error")) {
        format!(" ({})", str_of(latest.get("error")))
    } else {
        String::new()
    };
    let id = snapshot
        .and_then(|s| s.get("pendingEvent"))
        .and_then(|p| p.get("id"))
        .filter(|v| crate::inject::detect_utils::truthy(v))
        .or_else(|| {
            snapshot
                .and_then(|s| s.get("id"))
                .filter(|v| crate::inject::detect_utils::truthy(v))
        })
        .map(|v| str_of(Some(v)))
        .unwrap_or_else(|| "SESSION_ID".to_string());
    Some(format!("The browser failed to mount variant {}{}{}; nothing is on screen. Fix the variant files, then reply with {} live-poll --reply {} done --file <manifest or source path> for the queued variant_mount_failed event (or republish) so the browser retries.", str_of(latest.get("variant")), where_, why, self_cmd, id))
}

struct Args {
    id: Option<String>,
    help: bool,
}

fn parse_args(argv: &[String]) -> Args {
    let mut out = Args {
        id: None,
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
    resume_cli(&argv, io)
}

fn resume_cli(argv: &[String], io: &mut Io) -> i32 {
    let args = parse_args(argv);
    if args.help {
        println(io, "Usage: impeccable live-resume [--id SESSION_ID]\n\nPrint the active durable session checkpoint and the next safe agent action.");
        return 0;
    }
    let cwd = io.cwd.to_string_lossy().into_owned();
    let env = io.env.clone();
    let id = args.id.filter(|s| !s.is_empty());
    let store = create_live_session_store(&cwd, &env, id.as_deref());
    let self_cmd = self_cmd(io);
    let snapshot = match &id {
        Some(id) => match store.get_snapshot(id, false) {
            Ok(s) => s,
            Err(e) => {
                crate::util::eprintln(io, &format!("Error: {}", e));
                return 1;
            }
        },
        None => store.list_active_sessions().into_iter().next(),
    };
    let Some(snapshot) = snapshot else {
        println(
            io,
            &json_pretty(
                &json!({ "active": false, "nextAction": "No active durable live session found." }),
            ),
        );
        return 0;
    };
    let pending = snapshot
        .get("pendingEvent")
        .filter(|p| crate::inject::detect_utils::truthy(p))
        .cloned();
    let render = render_summary(Some(&snapshot));
    let mount_action = if render.get("renderState").and_then(|r| r.as_str()) == Some("failed") {
        mount_failure_action(Some(&snapshot), &self_cmd)
    } else {
        None
    };
    let pending_type = pending
        .as_ref()
        .and_then(|p| p.get("type"))
        .and_then(|t| t.as_str());
    let phase = snapshot.get("phase").and_then(|p| p.as_str()).unwrap_or("");
    let sid = str_of(snapshot.get("id"));
    let next_action = if pending_type == Some("manual_edit_apply") {
        manual_apply_resume_hint(pending.as_ref().and_then(|p| p.as_object()), &self_cmd)
    } else if let Some(m) = mount_action {
        m
    } else if let Some(p) = &pending {
        format!(
            "Run {} live-poll, handle {} {}, then acknowledge with {} live-poll --reply {} done.",
            self_cmd,
            str_of(p.get("type")),
            str_of(p.get("id")),
            self_cmd,
            str_of(p.get("id"))
        )
    } else if phase == "carbonize_required" {
        let in_file = if truthy(snapshot.get("sourceFile")) {
            format!(" in {}", str_of(snapshot.get("sourceFile")))
        } else {
            String::new()
        };
        format!(
            "Finish carbonize cleanup{}, then run {} live-complete --id {}.",
            in_file, self_cmd, sid
        )
    } else if phase == "accept_requested" {
        format!(
            "Run {} live-complete --id {} after verifying the accepted variant is written.",
            self_cmd, sid
        )
    } else {
        format!(
            "Inspect {}; no pending agent event is currently queued.",
            sid
        )
    };
    let payload = json!({
        "active": true,
        "snapshot": Value::Object(snapshot),
        "pendingEvent": pending.unwrap_or(Value::Null),
        "render": Value::Object(render),
        "nextAction": next_action,
    });
    println(io, &json_pretty(&payload));
    0
}
