//! JS: live/event-validation.mjs. Shared event validation for the helper
//! server; messages verbatim.

use crate::vocabulary::{AGENT_PHASES, VISUAL_ACTIONS};
use serde_json::{Map, Value};

pub const MOUNT_URL_MAX_LENGTH: usize = 2000;
pub const MOUNT_ERROR_MAX_LENGTH: usize = 1000;
const FORBIDDEN_MANUAL_EDIT_TEXT_CHARS: [char; 4] = ['<', '{', '}', '`'];

fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

/// JS truthiness of a JSON value.
pub fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().map(|f| f != 0.0 && !f.is_nan()).unwrap_or(false),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

fn is_valid_id(v: Option<&Value>) -> bool {
    match v {
        Some(Value::String(s)) => {
            s.len() == 8 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
        }
        _ => false,
    }
}

fn is_valid_variant_id_str(s: &str) -> bool {
    (1..=3).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_digit())
}

fn is_valid_variant_id(v: Option<&Value>) -> bool {
    match v {
        Some(Value::String(s)) => is_valid_variant_id_str(s),
        _ => false,
    }
}

/// JS `String(value)` for the variantId check in carbonize_cleanup.
fn js_string(v: Option<&Value>) -> String {
    match v {
        None => "undefined".to_string(),
        Some(Value::Null) => "null".to_string(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Number(n)) => n
            .as_f64()
            .map(impeccable_context::util::js_number_to_string)
            .unwrap_or_default(),
        Some(Value::Array(a)) => a
            .iter()
            .map(|x| js_string(Some(x)))
            .collect::<Vec<_>>()
            .join(","),
        Some(Value::Object(_)) => "[object Object]".to_string(),
    }
}

fn is_integer(v: Option<&Value>) -> Option<f64> {
    match v {
        Some(Value::Number(n)) => {
            let f = n.as_f64()?;
            if f.is_finite() && f.fract() == 0.0 {
                Some(f)
            } else {
                None
            }
        }
        _ => None,
    }
}

fn is_finite_num(v: Option<&Value>) -> Option<f64> {
    match v {
        Some(Value::Number(n)) => n.as_f64().filter(|f| f.is_finite()),
        _ => None,
    }
}

fn is_plain_object(v: Option<&Value>) -> bool {
    matches!(v, Some(Value::Object(_)))
}

fn validate_annotation_fields(msg: &Map<String, Value>) -> Option<String> {
    if let Some(sp) = msg.get("screenshotPath") {
        if !sp.is_string() {
            return Some("generate: screenshotPath must be string".into());
        }
    }
    if let Some(c) = msg.get("comments") {
        if !c.is_array() {
            return Some("generate: comments must be array".into());
        }
    }
    if let Some(s) = msg.get("strokes") {
        if !s.is_array() {
            return Some("generate: strokes must be array".into());
        }
    }
    None
}

/// JS: insert-ui.mjs canCreateInsert({ prompt, comments, strokes })
pub fn can_create_insert(
    prompt: Option<&Value>,
    comments: Option<&Value>,
    strokes: Option<&Value>,
) -> bool {
    let has_prompt = matches!(prompt, Some(Value::String(s)) if !s.trim().is_empty());
    let has_comments = matches!(comments, Some(Value::Array(a)) if !a.is_empty());
    let has_strokes = matches!(strokes, Some(Value::Array(a)) if a.iter().any(|s| {
        matches!(s.get("points"), Some(Value::Array(p)) if p.len() >= 2)
    }));
    has_prompt || has_comments || has_strokes
}

fn validate_insert_generate(msg: &Map<String, Value>) -> Option<String> {
    let insert = match msg.get("insert") {
        Some(Value::Object(o)) => o,
        _ => return Some("generate: insert mode requires insert object".into()),
    };
    match insert.get("position").and_then(|p| p.as_str()) {
        Some("before") | Some("after") => {}
        _ => return Some("generate: insert.position must be before or after".into()),
    }
    let anchor = match insert.get("anchor") {
        Some(Value::Object(o)) => o,
        _ => return Some("generate: insert.anchor required".into()),
    };
    let has_classes = matches!(anchor.get("classes"), Some(Value::Array(a)) if !a.is_empty());
    if !truthy(anchor.get("tagName")) && !truthy(anchor.get("outerHTML")) && !has_classes {
        return Some("generate: insert.anchor needs tagName, classes, or outerHTML".into());
    }
    let placeholder = match msg.get("placeholder") {
        Some(Value::Object(o)) => o,
        _ => return Some("generate: insert mode requires placeholder dimensions".into()),
    };
    if is_finite_num(placeholder.get("width")).is_none()
        || is_finite_num(placeholder.get("height")).is_none()
    {
        return Some("generate: placeholder width and height must be numbers".into());
    }
    if !can_create_insert(
        msg.get("freeformPrompt"),
        msg.get("comments"),
        msg.get("strokes"),
    ) {
        return Some("generate: insert requires freeformPrompt or annotations".into());
    }
    validate_annotation_fields(msg)
}

fn validate_replace_generate(msg: &Map<String, Value>) -> Option<String> {
    let action_ok = match msg.get("action") {
        Some(Value::String(a)) if !a.is_empty() => VISUAL_ACTIONS.contains(&a.as_str()),
        _ => false,
    };
    if !action_ok {
        return Some("generate: invalid action".into());
    }
    let element_ok = match msg.get("element") {
        Some(el) if truthy(Some(el)) => truthy(el.get("outerHTML")),
        _ => false,
    };
    if !element_ok {
        return Some("generate: missing element context".into());
    }
    validate_annotation_fields(msg)
}

fn validate_manual_edit_event(msg: &Map<String, Value>, label: &str) -> Option<String> {
    if !is_valid_id(msg.get("id")) {
        return Some(format!("{}: missing or malformed id", label));
    }
    match msg.get("pageUrl") {
        Some(Value::String(s)) if !s.is_empty() => {}
        _ => return Some(format!("{}: missing pageUrl", label)),
    }
    match msg.get("element") {
        Some(Value::Object(_)) | Some(Value::Array(_)) => {}
        _ => return Some(format!("{}: missing element", label)),
    }
    let ops = match msg.get("ops") {
        Some(Value::Array(a)) if !a.is_empty() => a,
        _ => return Some(format!("{}: ops must be non-empty array", label)),
    };
    if ops.len() > 100 {
        return Some(format!("{}: too many ops (max 100)", label));
    }
    for op in ops {
        if !op.get("ref").map(|v| v.is_string()).unwrap_or(false) {
            return Some(format!("{}: op.ref required", label));
        }
        if !op.get("tag").map(|v| v.is_string()).unwrap_or(false) {
            return Some(format!("{}: op.tag required", label));
        }
        if !op
            .get("originalText")
            .map(|v| v.is_string())
            .unwrap_or(false)
        {
            return Some(format!("{}: op.originalText required", label));
        }
        let deleted = op.get("deleted") == Some(&Value::Bool(true));
        let new_text = op.get("newText").and_then(|v| v.as_str());
        if !deleted && new_text.is_none() {
            return Some(format!("{}: text op requires newText", label));
        }
        if let Some(t) = new_text {
            if !deleted && t.trim().is_empty() {
                return Some(format!("{}: newText cannot be empty", label));
            }
            let hits: Vec<String> = FORBIDDEN_MANUAL_EDIT_TEXT_CHARS
                .iter()
                .filter(|c| t.contains(**c))
                .map(|c| c.to_string())
                .collect();
            if !hits.is_empty() {
                return Some(format!(
                    "{}: newText cannot contain {} (plain text only; ask the AI to insert markup)",
                    label,
                    hits.join(" ")
                ));
            }
        }
    }
    None
}

fn is_valid_mount_variant(v: Option<&Value>) -> bool {
    matches!(is_integer(v), Some(f) if (1.0..=999.0).contains(&f))
}

fn validate_mount_ack(msg: &Map<String, Value>) -> Option<String> {
    if !is_valid_id(msg.get("id")) {
        return Some("variant_mounted: missing or malformed id".into());
    }
    if !is_valid_mount_variant(msg.get("variant")) {
        return Some("variant_mounted: variant must be an integer 1-999".into());
    }
    if let Some(url) = msg.get("url") {
        match url {
            Value::String(s) => {
                if utf16_len(s) > MOUNT_URL_MAX_LENGTH {
                    return Some("variant_mounted: url too long".into());
                }
            }
            _ => return Some("variant_mounted: url must be string".into()),
        }
    }
    None
}

fn validate_mount_failure(msg: &Map<String, Value>) -> Option<String> {
    if !is_valid_id(msg.get("id")) {
        return Some("variant_mount_failed: missing or malformed id".into());
    }
    if !is_valid_mount_variant(msg.get("variant")) {
        return Some("variant_mount_failed: variant must be an integer 1-999".into());
    }
    match msg.get("url") {
        Some(Value::String(s)) if !s.trim().is_empty() => {
            if utf16_len(s) > MOUNT_URL_MAX_LENGTH {
                return Some("variant_mount_failed: url too long".into());
            }
        }
        _ => return Some("variant_mount_failed: url required".into()),
    }
    match msg.get("error") {
        Some(Value::String(s)) if !s.trim().is_empty() => {
            if utf16_len(s) > MOUNT_ERROR_MAX_LENGTH {
                return Some("variant_mount_failed: error too long".into());
            }
        }
        _ => return Some("variant_mount_failed: error required".into()),
    }
    None
}

/// JS: validateEvent(msg). None when valid, else the message.
pub fn validate_event(msg: &Value) -> Option<String> {
    let obj = match msg {
        Value::Object(o) if truthy(o.get("type")) => o,
        _ => return Some("Missing or invalid message".into()),
    };
    let ty = match obj.get("type") {
        Some(Value::String(t)) => t.as_str(),
        Some(other) => {
            let s = js_string(Some(other));
            return Some(format!("Unknown event type: {}", s));
        }
        None => return Some("Missing or invalid message".into()),
    };
    match ty {
        "generate" => {
            if !is_valid_id(obj.get("id")) {
                return Some("generate: missing or malformed id".into());
            }
            match is_integer(obj.get("count")) {
                Some(c) if (1.0..=8.0).contains(&c) => {}
                _ => return Some("generate: count must be 1-8".into()),
            }
            if obj.get("mode").and_then(|m| m.as_str()) == Some("insert") {
                return validate_insert_generate(obj);
            }
            validate_replace_generate(obj)
        }
        "accept" => {
            if !is_valid_id(obj.get("id")) {
                return Some("accept: missing or malformed id".into());
            }
            if !is_valid_variant_id(obj.get("variantId")) {
                return Some("accept: missing or malformed variantId".into());
            }
            if let Some(pv) = obj.get("paramValues") {
                if !matches!(pv, Value::Object(_)) {
                    return Some("accept: paramValues must be an object".into());
                }
            }
            None
        }
        "discard" => {
            if is_valid_id(obj.get("id")) {
                None
            } else {
                Some("discard: missing or malformed id".into())
            }
        }
        "checkpoint" => {
            if !is_valid_id(obj.get("id")) {
                return Some("checkpoint: missing or malformed id".into());
            }
            match is_integer(obj.get("revision")) {
                Some(r) if r >= 0.0 => {}
                _ => return Some("checkpoint: revision must be a non-negative integer".into()),
            }
            if let Some(pv) = obj.get("paramValues") {
                if !matches!(pv, Value::Object(_)) {
                    return Some("checkpoint: paramValues must be an object".into());
                }
            }
            None
        }
        "agent_phase" => {
            if !is_valid_id(obj.get("id")) {
                return Some("agent_phase: missing or malformed id".into());
            }
            let phase = match obj.get("phase") {
                Some(Value::String(p)) if !p.is_empty() => p.as_str(),
                _ => return Some("agent_phase: missing phase".into()),
            };
            if !AGENT_PHASES.contains(&phase) {
                return Some(format!(
                    "agent_phase: unknown phase {} (expected one of {})",
                    phase,
                    AGENT_PHASES.join(", ")
                ));
            }
            if let Some(d) = obj.get("durationMs") {
                match is_finite_num(Some(d)) {
                    Some(f) if f >= 0.0 => {}
                    _ => {
                        return Some("agent_phase: durationMs must be a non-negative number".into())
                    }
                }
            }
            None
        }
        "variant_mounted" => validate_mount_ack(obj),
        "variant_mount_failed" => validate_mount_failure(obj),
        "exit" => None,
        "prefetch" => match obj.get("pageUrl") {
            Some(Value::String(s)) if !s.is_empty() => None,
            _ => Some("prefetch: missing pageUrl".into()),
        },
        "manual_edits" => validate_manual_edit_event(obj, "manual_edits"),
        "steer" => {
            if !is_valid_id(obj.get("id")) {
                return Some("steer: missing or malformed id".into());
            }
            match obj.get("message") {
                Some(Value::String(m)) if !m.trim().is_empty() => {
                    if utf16_len(m) > 4000 {
                        return Some("steer: message too long".into());
                    }
                }
                _ => return Some("steer: message required".into()),
            }
            if let Some(p) = obj.get("pageUrl") {
                if !p.is_string() {
                    return Some("steer: pageUrl must be string".into());
                }
            }
            None
        }
        "carbonize_cleanup" => {
            if !is_valid_id(obj.get("id")) {
                return Some("carbonize_cleanup: missing or malformed id".into());
            }
            if !is_valid_id(obj.get("sessionId")) {
                return Some("carbonize_cleanup: missing or malformed sessionId".into());
            }
            match obj.get("file") {
                Some(Value::String(f)) if !f.is_empty() => {}
                _ => return Some("carbonize_cleanup: missing file".into()),
            }
            if !is_valid_variant_id_str(&js_string(obj.get("variantId"))) {
                return Some("carbonize_cleanup: missing or malformed variantId".into());
            }
            None
        }
        other => Some(format!("Unknown event type: {}", other)),
    }
}

/// `is_plain_object` kept for callers that need the JS `typeof x === 'object'
/// && !Array.isArray(x)` check.
pub fn is_object(v: Option<&Value>) -> bool {
    is_plain_object(v)
}
