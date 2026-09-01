//! Helper-server touchpoints the shared model needs before the server itself
//! (`live-server`) exists: the identity probe roots resolution runs against a
//! recorded server, the `/status` and `/poll` calls status/complete make, and
//! the detached spawn the boot performs.

use crate::paths::read_live_server_info;
use crate::util::Env;
use serde_json::Value;
use std::time::{Duration, Instant};

/// JS: the `node -e` one-liner in roots.mjs `hasLiveServer`: authenticated
/// `GET /status?token=` on 127.0.0.1 answering 200 within `timeout_ms`.
/// Reimplemented natively (no Node spawn).
pub fn probe_status(port: u16, token: &str, timeout_ms: u64) -> bool {
    let url = format!(
        "http://127.0.0.1:{}/status?token={}",
        port,
        crate::util::encode_uri_component(token)
    );
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_millis(timeout_ms))
        .timeout(Duration::from_millis(timeout_ms))
        .build();
    match agent.get(&url).call() {
        Ok(res) => res.status() == 200,
        Err(_) => false,
    }
}

/// JS: `fetch('http://localhost:PORT/status?token=TOKEN')` then `res.json()`;
/// None on any failure or non-2xx.
pub fn fetch_status(port: i64, token: &str) -> Option<Value> {
    let url = format!("http://localhost:{}/status?token={}", port, token);
    let res = ureq::get(&url).call().ok()?;
    if !(200..300).contains(&res.status()) {
        return None;
    }
    res.into_json::<Value>().ok()
}

/// JS: `fetch('http://localhost:PORT/poll', { method: 'POST', body })` then
/// `res.json()`; None on any failure or non-2xx.
pub fn post_poll(port: i64, body: &Value) -> Option<Value> {
    let url = format!("http://localhost:{}/poll", port);
    let res = ureq::post(&url)
        .set("Content-Type", "application/json")
        .send_string(&serde_json::to_string(body).unwrap_or_default())
        .ok()?;
    if !(200..300).contains(&res.status()) {
        return None;
    }
    res.into_json::<Value>().ok()
}

/// JS: `runScript('live-server.mjs', ['--background'])` from live.mjs: spawn
/// the helper detached and return the `{pid, port, token}` record it prints.
pub fn spawn_detached(cwd: &str, env: &Env) -> Option<Value> {
    spawn_detached_with_args(cwd, env, &[])
}

/// JS: the `--background` branch of live-server.mjs: spawn
/// `<self> live-server <args>` detached (setsid on unix, DETACHED_PROCESS on
/// windows) with ignored stdio, then wait up to 10 s for a `server.json`
/// written by a pid other than ours and return its record.
pub fn spawn_detached_with_args(cwd: &str, env: &Env, child_args: &[String]) -> Option<Value> {
    let exe = std::env::current_exe().ok()?;
    let mut cmd = std::process::Command::new(&exe);
    cmd.arg("live-server")
        .args(child_args)
        .current_dir(cwd)
        .env_clear()
        .envs(env)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    impeccable_common::proc::detach(&mut cmd);
    let mut child = cmd.spawn().ok()?;
    let own_pid = std::process::id() as i64;
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut result: Option<Value> = None;
    while Instant::now() < deadline {
        if let Some((info, _)) = read_live_server_info(cwd, env) {
            if info.pid != Some(own_pid) {
                result = Some(info.raw);
                break;
            }
        }
        // A child that already exited cannot become ready.
        if let Ok(Some(_)) = child.try_wait() {
            if read_live_server_info(cwd, env).is_none() {
                std::thread::sleep(Duration::from_millis(5));
                if let Some((info, _)) = read_live_server_info(cwd, env) {
                    if info.pid != Some(own_pid) {
                        result = Some(info.raw);
                    }
                }
                break;
            }
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    // Detach: never wait on the server (JS `child.unref()`); reap it if it
    // has already exited so no zombie lingers while we finish.
    let _ = child.try_wait();
    result
}
