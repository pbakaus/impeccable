//! JS: lib/impeccable-paths.mjs (the live subset): `.impeccable/live` paths,
//! the live config path, server.json read/write, session ids.

use crate::util::{exists, jsp, pid_reachable, read_json, Env};
use impeccable_context::context::resolve_project_root;
use impeccable_context::target_args::TargetOptions;
use serde_json::Value;

pub const IMPECCABLE_DIR: &str = ".impeccable";
pub const LIVE_DIR: &str = "live";

/// JS: getImpeccableDir(cwd)
pub fn impeccable_dir(cwd: &str, env: &Env) -> String {
    jsp::join(&[
        &resolve_project_root(cwd, &TargetOptions::default(), env),
        IMPECCABLE_DIR,
    ])
}

/// JS: getLiveDir(cwd)
pub fn live_dir(cwd: &str, env: &Env) -> String {
    jsp::join(&[&impeccable_dir(cwd, env), LIVE_DIR])
}

/// JS: getLiveConfigPath(cwd)
pub fn live_config_path(cwd: &str, env: &Env) -> String {
    jsp::join(&[&live_dir(cwd, env), "config.json"])
}

/// JS: resolveLiveConfigPath({ cwd, scriptsDir, env }). The legacy
/// `<scriptsDir>/config.json` fallback has no home in a single binary; the
/// primary path is returned when the env override is unset.
pub fn resolve_live_config_path(cwd: &str, env: &Env) -> String {
    if let Some(v) = env.get("IMPECCABLE_LIVE_CONFIG") {
        let t = impeccable_context::util::js_trim(v);
        if !t.is_empty() {
            return if jsp::is_absolute(t) {
                t.to_string()
            } else {
                jsp::resolve(cwd, &[t])
            };
        }
    }
    live_config_path(cwd, env)
}

/// JS: getLiveServerPath(cwd)
pub fn live_server_path(cwd: &str, env: &Env) -> String {
    jsp::join(&[&live_dir(cwd, env), "server.json"])
}

/// JS: getLegacyLiveServerPath(cwd)
pub fn legacy_live_server_path(cwd: &str, env: &Env) -> String {
    jsp::join(&[
        &resolve_project_root(cwd, &TargetOptions::default(), env),
        ".impeccable-live.json",
    ])
}

/// JS: getLiveSessionsDir(cwd)
pub fn live_sessions_dir(cwd: &str, env: &Env) -> String {
    jsp::join(&[&live_dir(cwd, env), "sessions"])
}

/// JS: getLegacyLiveSessionsDir(cwd)
pub fn legacy_live_sessions_dir(cwd: &str, env: &Env) -> String {
    jsp::join(&[
        &resolve_project_root(cwd, &TargetOptions::default(), env),
        ".impeccable-live",
        "sessions",
    ])
}

/// JS: getLiveAnnotationsDir(cwd)
pub fn live_annotations_dir(cwd: &str, env: &Env) -> String {
    jsp::join(&[&live_dir(cwd, env), "annotations"])
}

/// The record `live-server` writes on listen.
#[derive(Debug, Clone)]
pub struct ServerInfo {
    /// `pid` as recorded (any JSON value; only a number counts for liveness).
    pub pid: Option<i64>,
    pub port: Option<i64>,
    pub token: Option<String>,
    /// The parsed record verbatim.
    pub raw: Value,
}

impl ServerInfo {
    pub fn from_value(v: &Value) -> ServerInfo {
        ServerInfo {
            pid: v.get("pid").and_then(|p| p.as_i64()),
            port: v.get("port").and_then(|p| p.as_i64()).or_else(|| {
                v.get("port")
                    .and_then(|p| p.as_str())
                    .and_then(|s| s.parse::<i64>().ok())
            }),
            token: v.get("token").and_then(|t| t.as_str()).map(String::from),
            raw: v.clone(),
        }
    }
    /// `info.pid` was a JSON number.
    pub fn pid_is_number(&self) -> bool {
        matches!(self.raw.get("pid"), Some(Value::Number(_)))
    }
}

/// JS: readLiveServerInfo(cwd): `{ info, path }` or None. A record whose pid
/// is a number and no longer signalable is unlinked and skipped.
pub fn read_live_server_info(cwd: &str, env: &Env) -> Option<(ServerInfo, String)> {
    for file in [
        live_server_path(cwd, env),
        legacy_live_server_path(cwd, env),
    ] {
        let Some(v) = read_json(&file) else { continue };
        let info = ServerInfo::from_value(&v);
        if info.pid_is_number() {
            let alive = info.pid.map(pid_reachable).unwrap_or(false);
            if !alive {
                let _ = std::fs::remove_file(&file);
                continue;
            }
        }
        // JS: `info && typeof info.pid === 'number'` guards the check; any
        // parsed JSON (even a scalar) is returned as-is.
        return Some((info, file));
    }
    None
}

/// JS: writeLiveServerInfo(cwd, info)
pub fn write_live_server_info(cwd: &str, env: &Env, info: &Value) -> String {
    let file = live_server_path(cwd, env);
    let _ = crate::util::write_file(&file, &serde_json::to_string(info).unwrap_or_default());
    file
}

/// JS: removeLiveServerInfo(cwd)
pub fn remove_live_server_info(cwd: &str, env: &Env) {
    for file in [
        live_server_path(cwd, env),
        legacy_live_server_path(cwd, env),
    ] {
        let _ = std::fs::remove_file(&file);
    }
}

/// JS: safeSessionId(id): `/^[A-Za-z0-9_-]{1,128}$/` or an error message.
pub fn safe_session_id(id: &str) -> Result<&str, String> {
    let ok = !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    if ok {
        Ok(id)
    } else {
        Err(format!("invalid session id: {}", id))
    }
}

pub fn file_exists(p: &str) -> bool {
    exists(p)
}
