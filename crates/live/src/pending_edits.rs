//! JS: live/manual-edits-buffer.mjs, the read/write half wrap and accept
//! use (`readBuffer`, `writeBuffer`). The staging/route half belongs to the
//! manual-edit modules (part 3).

use crate::paths::live_dir;
use crate::util::{json_pretty, jsp, safe_read, write_file, Env};
use serde_json::{json, Value};

pub const BUFFER_VERSION: i64 = 1;
const BUFFER_FILENAME: &str = "pending-manual-edits.json";

/// JS: getBufferPath(cwd)
pub fn buffer_path(cwd: &str, env: &Env) -> String {
    jsp::join(&[&live_dir(cwd, env), BUFFER_FILENAME])
}

/// JS: readBuffer(cwd) (non-strict): the entries array, or empty when the
/// file is missing, unparsable, or not shaped `{ entries: [...] }`.
pub fn read_buffer(cwd: &str, env: &Env) -> Vec<Value> {
    let path = buffer_path(cwd, env);
    let Some(raw) = safe_read(&path) else {
        return Vec::new();
    };
    let Ok(parsed) = serde_json::from_str::<Value>(&raw) else {
        return Vec::new();
    };
    match parsed.get("entries") {
        Some(Value::Array(a)) => a.clone(),
        _ => Vec::new(),
    }
}

/// JS: writeBuffer(cwd, buffer)
pub fn write_buffer(cwd: &str, env: &Env, entries: &[Value]) {
    let path = buffer_path(cwd, env);
    let value = json!({ "version": BUFFER_VERSION, "entries": entries });
    let _ = write_file(&path, &json_pretty(&value));
}
