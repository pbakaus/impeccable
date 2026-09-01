//! JS: live/generation-preflight.mjs, the pure half. The server (part 3)
//! runs `live-wrap` / `live-insert --defer-source-write` when it leases a
//! generate event; the argv it builds, the target signature that keys the
//! source-resolution cache, and the error compaction are shared model and
//! live here so the wrap/insert verbs (part 2) and the server agree.

use serde_json::{json, Map, Value};

/// JS: normalizeTarget(target)
#[derive(Debug, Clone, Default)]
pub struct Target {
    pub element_id: Option<String>,
    pub classes: Option<String>,
    pub tag: Option<String>,
    pub text: Option<String>,
    /// insert mode only
    pub position: Option<String>,
}

fn s(v: Option<&Value>) -> Option<String> {
    match v {
        Some(Value::String(x)) if !x.is_empty() => Some(x.clone()),
        Some(Value::Number(n)) => Some(n.to_string()),
        Some(Value::Bool(true)) => Some("true".to_string()),
        _ => None,
    }
}

fn normalize_target(target: &Map<String, Value>) -> Target {
    let classes = match target.get("classes") {
        Some(Value::Array(a)) => a
            .iter()
            .map(|c| match c {
                Value::String(x) => x.clone(),
                Value::Null => String::new(),
                other => other.to_string(),
            })
            .collect::<Vec<_>>()
            .join(" "),
        Some(Value::String(x)) => x.trim().to_string(),
        _ => String::new(),
    };
    let text = match target.get("textContent") {
        Some(Value::String(t)) => t.trim().chars().take(80).collect::<String>(),
        _ => String::new(),
    };
    Target {
        element_id: s(target.get("id")).or_else(|| s(target.get("elementId"))),
        classes: if classes.is_empty() {
            None
        } else {
            Some(classes)
        },
        tag: s(target.get("tagName")).or_else(|| s(target.get("tag"))),
        text: if text.is_empty() { None } else { Some(text) },
        position: None,
    }
}

fn empty() -> Map<String, Value> {
    Map::new()
}

/// JS: replaceTarget / insertTarget
pub fn event_target(event: &Map<String, Value>) -> (bool, Target) {
    let is_insert = event.get("mode").and_then(|m| m.as_str()) == Some("insert");
    if is_insert {
        let insert = event.get("insert").and_then(|i| i.as_object());
        let anchor = insert
            .and_then(|i| i.get("anchor"))
            .and_then(|a| a.as_object())
            .cloned()
            .unwrap_or_else(empty);
        let mut t = normalize_target(&anchor);
        t.position = Some(
            if insert
                .and_then(|i| i.get("position"))
                .and_then(|p| p.as_str())
                == Some("before")
            {
                "before"
            } else {
                "after"
            }
            .to_string(),
        );
        (true, t)
    } else {
        let el = event
            .get("element")
            .and_then(|e| e.as_object())
            .cloned()
            .unwrap_or_else(empty);
        (false, normalize_target(&el))
    }
}

/// JS: targetSignature(event): the cache key, as its JSON string.
pub fn target_signature(event: &Map<String, Value>) -> String {
    let (is_insert, t) = event_target(event);
    let page_url = match event.get("pageUrl") {
        Some(v) if crate::inject::detect_utils::truthy(v) => v.clone(),
        _ => Value::Null,
    };
    serde_json::to_string(&json!({
        "mode": if is_insert { "insert" } else { "replace" },
        "position": if is_insert { t.position.clone().map(Value::String).unwrap_or(Value::Null) } else { Value::Null },
        "elementId": t.element_id.clone().map(Value::String).unwrap_or(Value::Null),
        "classes": t.classes.clone().map(Value::String).unwrap_or(Value::Null),
        "tag": t.tag.clone().map(Value::String).unwrap_or(Value::Null),
        "pageUrl": page_url,
    }))
    .unwrap_or_default()
}

/// A built preflight command: the verb (`live-wrap` | `live-insert`), its
/// args, mode, and cache signature.
#[derive(Debug, Clone)]
pub struct PreflightCommand {
    pub verb: &'static str,
    pub args: Vec<String>,
    pub mode: &'static str,
    pub signature: String,
}

/// JS: buildGenerationPreflight(event, scriptsDir, { cache }). None when the
/// event is not a generate with an id, or carries neither id nor classes
/// (`insufficient_locator`).
pub fn build_generation_preflight(
    event: &Map<String, Value>,
    cached_file: Option<&str>,
) -> Option<PreflightCommand> {
    if event.get("type").and_then(|t| t.as_str()) != Some("generate") {
        return None;
    }
    let id = event
        .get("id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())?;
    let (is_insert, target) = event_target(event);
    if target.element_id.is_none() && target.classes.is_none() {
        return None;
    }
    let count = match event.get("count") {
        Some(v) if crate::inject::detect_utils::truthy(v) => match v {
            Value::Number(n) => n.to_string(),
            Value::String(s) => s.clone(),
            other => other.to_string(),
        },
        _ => "3".to_string(),
    };
    let mut args = vec![
        "--id".to_string(),
        id.to_string(),
        "--count".to_string(),
        count,
        "--defer-source-write".to_string(),
    ];
    if is_insert {
        args.push("--position".to_string());
        args.push(
            target
                .position
                .clone()
                .unwrap_or_else(|| "after".to_string()),
        );
    }
    if let Some(v) = &target.element_id {
        args.push("--element-id".to_string());
        args.push(v.clone());
    }
    if let Some(v) = &target.classes {
        args.push("--classes".to_string());
        args.push(v.clone());
    }
    if let Some(v) = &target.tag {
        args.push("--tag".to_string());
        args.push(v.clone());
    }
    if let Some(v) = &target.text {
        args.push("--text".to_string());
        args.push(v.clone());
    }
    if !is_insert {
        if let Some(u) = event
            .get("pageUrl")
            .filter(|v| crate::inject::detect_utils::truthy(v))
        {
            args.push("--page-url".to_string());
            args.push(match u {
                Value::String(s) => s.clone(),
                other => other.to_string(),
            });
        }
    }
    if let Some(f) = cached_file {
        args.push("--file".to_string());
        args.push(f.to_string());
    }
    Some(PreflightCommand {
        verb: if is_insert {
            "live-insert"
        } else {
            "live-wrap"
        },
        args,
        mode: if is_insert { "insert" } else { "replace" },
        signature: target_signature(event),
    })
}

/// JS: compactError(error): last non-empty stderr line, else the message,
/// else `preflight failed`, capped at 500 chars.
pub fn compact_error(stderr: &str, message: Option<&str>) -> String {
    let last = stderr
        .trim()
        .split('\n')
        .filter(|l| !l.is_empty())
        .last()
        .map(String::from);
    let msg = last
        .or_else(|| message.map(String::from))
        .unwrap_or_else(|| "preflight failed".to_string());
    msg.chars().take(500).collect()
}
