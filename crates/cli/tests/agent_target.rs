//! Agent-initiated element targeting (the `generate` command) against a real
//! `live-server`: the held-open `POST /agent-target`, the overlay's
//! `/agent-target-result`, and the `/agent-target-claim` roll call with its
//! leases. The full 28-case protocol matrix runs from Node
//! (tests/live-agent-target.test.mjs); this covers the core paths so
//! `cargo test --workspace` gates them on every platform.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::path::Path;
use std::time::{Duration, Instant};

fn http(port: u16, method: &str, target: &str, body: Option<&str>) -> (u16, String) {
    let mut s = TcpStream::connect(("127.0.0.1", port)).expect("connect");
    s.set_read_timeout(Some(Duration::from_secs(20))).unwrap();
    let body = body.unwrap_or("");
    let req = format!(
        "{} {} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        method,
        target,
        port,
        body.len(),
        body
    );
    s.write_all(req.as_bytes()).unwrap();
    let mut out = Vec::new();
    let _ = s.read_to_end(&mut out);
    let text = String::from_utf8_lossy(&out).into_owned();
    let status: u16 = text.split_whitespace().nth(1).and_then(|c| c.parse().ok()).unwrap_or(0);
    let body = text.split_once("\r\n\r\n").map(|(_, b)| b.to_string()).unwrap_or_default();
    let body = if text.to_ascii_lowercase().contains("transfer-encoding: chunked") {
        let mut rest = body.as_str();
        let mut assembled = String::new();
        while let Some((size_line, after)) = rest.split_once("\r\n") {
            let size = usize::from_str_radix(size_line.trim(), 16).unwrap_or(0);
            if size == 0 {
                break;
            }
            assembled.push_str(&after[..size.min(after.len())]);
            rest = after.get(size + 2..).unwrap_or("");
        }
        assembled
    } else {
        body
    };
    (status, body)
}

fn post_json(port: u16, path: &str, body: serde_json::Value) -> (u16, serde_json::Value) {
    let (status, text) = http(port, "POST", path, Some(&body.to_string()));
    let parsed = serde_json::from_str(&text).unwrap_or(serde_json::json!({ "raw": text }));
    (status, parsed)
}

/// A minimal fake overlay: holds the SSE stream open and yields `data:` frames.
struct Overlay {
    reader: BufReader<TcpStream>,
}

impl Overlay {
    fn connect(port: u16, token: &str, client_id: &str) -> Overlay {
        let mut s = TcpStream::connect(("127.0.0.1", port)).expect("connect sse");
        s.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
        let req = format!(
            "GET /events?token={}&clientId={} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAccept: text/event-stream\r\n\r\n",
            token, client_id, port
        );
        s.write_all(req.as_bytes()).unwrap();
        let mut reader = BufReader::new(s);
        // Consume the response head.
        loop {
            let mut line = String::new();
            let n = reader.read_line(&mut line).expect("sse head");
            if n == 0 || line == "\r\n" {
                break;
            }
        }
        Overlay { reader }
    }

    /// The next `data:` frame whose parsed JSON satisfies `matches`; chunk
    /// size lines and keepalives are skipped.
    fn next(&mut self, matches: impl Fn(&serde_json::Value) -> bool) -> serde_json::Value {
        let deadline = Instant::now() + Duration::from_secs(10);
        while Instant::now() < deadline {
            let mut line = String::new();
            match self.reader.read_line(&mut line) {
                Ok(0) => panic!("sse stream closed"),
                Ok(_) => {}
                Err(e) => panic!("sse read: {e}"),
            }
            let line = line.trim_end_matches(['\r', '\n']);
            if let Some(json) = line.strip_prefix("data: ") {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(json) {
                    if matches(&v) {
                        return v;
                    }
                }
            }
        }
        panic!("no matching sse frame within 10s");
    }
}

fn wait_for(p: &Path, secs: u64) -> bool {
    let deadline = Instant::now() + Duration::from_secs(secs);
    while !p.exists() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(50));
    }
    p.exists()
}

fn free_port() -> u16 {
    let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = l.local_addr().unwrap().port();
    drop(l);
    port
}

struct Server {
    child: std::process::Child,
    dir: std::path::PathBuf,
    port: u16,
    token: String,
}

impl Server {
    fn start(tag: &str) -> Server {
        let dir = std::env::temp_dir().join(format!("impeccable-agent-target-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".impeccable/live")).unwrap();
        std::fs::write(dir.join("index.html"), "<html><body><h1>t</h1></body></html>").unwrap();
        let port = free_port();
        let child = std::process::Command::new(env!("CARGO_BIN_EXE_impeccable"))
            .args(["live-server", &format!("--port={}", port)])
            .current_dir(&dir)
            .env("IMPECCABLE_LIVE_COPY_AGENT", "off")
            // A short timeout keeps the browser_timeout case fast; the env
            // override exists exactly for this. The lease shrinks with it.
            .env("IMPECCABLE_AGENT_TARGET_TIMEOUT_MS", "400")
            .env("IMPECCABLE_AGENT_TARGET_CLAIM_LEASE_MS", "250")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .expect("spawn live-server");
        let pid_file = dir.join(".impeccable/live/server.json");
        assert!(wait_for(&pid_file, 10), "server pid file never appeared");
        let info: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&pid_file).unwrap()).unwrap();
        let port = info["port"].as_u64().expect("port") as u16;
        let token = info["token"].as_str().expect("token").to_string();
        Server { child, dir, port, token }
    }

    fn target(&self, extra: serde_json::Value) -> serde_json::Value {
        let mut body = serde_json::json!({ "token": self.token, "selector": "h1", "action": "bolder", "count": 3 });
        if let (Some(b), Some(e)) = (body.as_object_mut(), extra.as_object()) {
            for (k, v) in e {
                b.insert(k.clone(), v.clone());
            }
        }
        body
    }

    /// POST /agent-target on a thread: the server holds it until a verdict.
    fn hold(&self, extra: serde_json::Value) -> std::thread::JoinHandle<(u16, serde_json::Value)> {
        let port = self.port;
        let body = self.target(extra);
        std::thread::spawn(move || post_json(port, "/agent-target", body))
    }

    fn claim(&self, target_id: &str, client_id: &str, eligible: bool) -> serde_json::Value {
        let body = if eligible {
            serde_json::json!({ "token": self.token, "targetId": target_id, "clientId": client_id, "eligible": true })
        } else {
            serde_json::json!({ "token": self.token, "targetId": target_id, "clientId": client_id, "eligible": false, "state": "CYCLING", "reason": "session_active" })
        };
        post_json(self.port, "/agent-target-claim", body).1
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = http(self.port, "GET", &format!("/stop?token={}", self.token), None);
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

#[test]
fn agent_target_validates_and_answers_no_browser() {
    let s = Server::start("validate");
    let (st, body) = post_json(s.port, "/agent-target", serde_json::json!({ "token": "nope", "selector": "h1", "action": "bolder", "count": 3 }));
    assert_eq!(st, 401, "{body}");
    let (st, body) = post_json(s.port, "/agent-target", s.target(serde_json::json!({ "action": "bold" })));
    assert_eq!(st, 400);
    assert!(body["error"].as_str().unwrap().contains("invalid action"), "{body}");
    assert!(body["error"].as_str().unwrap().contains("bolder"), "{body}");
    let (st, body) = post_json(s.port, "/agent-target", s.target(serde_json::json!({ "count": 9 })));
    assert_eq!(st, 400);
    assert_eq!(body["error"], serde_json::json!("agent_target: count must be 1-8"));
    let (st, body) = post_json(s.port, "/agent-target", serde_json::json!({ "token": s.token, "action": "bolder", "count": 3 }));
    assert_eq!(st, 400);
    assert_eq!(body["error"], serde_json::json!("agent_target: selector is required"));
    // No overlay attached: answered at once, not held.
    let (st, body) = post_json(s.port, "/agent-target", s.target(serde_json::json!({})));
    assert_eq!(st, 200);
    assert_eq!(body["ok"], serde_json::json!(false));
    assert_eq!(body["error"], serde_json::json!("no_browser_connected"));
}

#[test]
fn agent_target_broadcasts_and_resolves_with_the_browser_result() {
    let s = Server::start("resolve");
    let mut tab = Overlay::connect(s.port, &s.token, "tab-a");
    tab.next(|m| m["type"] == "connected");
    let held = s.hold(serde_json::json!({ "text": "Studio", "index": 2, "prompt": "warmer", "dryRun": true }));
    let pushed = tab.next(|m| m["type"] == "agent_target");
    assert_eq!(pushed["selector"], serde_json::json!("h1"));
    assert_eq!(pushed["text"], serde_json::json!("Studio"));
    assert_eq!(pushed["index"], serde_json::json!(2));
    assert_eq!(pushed["prompt"], serde_json::json!("warmer"));
    assert_eq!(pushed["dryRun"], serde_json::json!(true));
    let target_id = pushed["targetId"].as_str().expect("targetId").to_string();
    assert_eq!(target_id.len(), 8);
    let claim = s.claim(&target_id, "tab-a", true);
    assert_eq!(claim, serde_json::json!({ "ok": true, "granted": true, "pending": true }));
    // A second tab is denied while the lease is held, and told the request
    // is still pending.
    let denied = s.claim(&target_id, "tab-b", true);
    assert_eq!(denied, serde_json::json!({ "ok": true, "granted": false, "pending": true }));
    let (st, ack) = post_json(
        s.port,
        "/agent-target-result",
        serde_json::json!({ "token": s.token, "targetId": target_id, "ok": true, "dryRun": true, "matchCount": 1, "element": { "tag": "h1" } }),
    );
    assert_eq!(st, 200);
    assert_eq!(ack, serde_json::json!({ "ok": true, "delivered": true }));
    let (st, verdict) = held.join().unwrap();
    assert_eq!(st, 200, "{verdict}");
    assert_eq!(verdict["targetId"], serde_json::json!(target_id));
    assert_eq!(verdict["ok"], serde_json::json!(true));
    assert_eq!(verdict["matchCount"], serde_json::json!(1));
    // Resolved: a late result reports delivered:false, a late claim says gone.
    let (_, late) = post_json(s.port, "/agent-target-result", serde_json::json!({ "token": s.token, "targetId": target_id, "ok": true }));
    assert_eq!(late, serde_json::json!({ "ok": true, "delivered": false }));
    assert_eq!(s.claim(&target_id, "tab-b", true), serde_json::json!({ "ok": true, "granted": false, "pending": false }));
}

#[test]
fn agent_target_times_out_when_the_overlay_never_answers() {
    let s = Server::start("timeout");
    let mut tab = Overlay::connect(s.port, &s.token, "tab-a");
    tab.next(|m| m["type"] == "connected");
    let started = Instant::now();
    let held = s.hold(serde_json::json!({}));
    tab.next(|m| m["type"] == "agent_target");
    let (st, verdict) = held.join().unwrap();
    assert_eq!(st, 200);
    assert_eq!(verdict["error"], serde_json::json!("browser_timeout"));
    assert_eq!(verdict["timeoutMs"], serde_json::json!(400));
    assert!(started.elapsed() < Duration::from_secs(5));
}

#[test]
fn agent_target_roll_call_answers_busy_once_every_overlay_declined() {
    let s = Server::start("busy");
    let mut a = Overlay::connect(s.port, &s.token, "tab-a");
    let mut b = Overlay::connect(s.port, &s.token, "tab-b");
    a.next(|m| m["type"] == "connected");
    b.next(|m| m["type"] == "connected");
    let started = Instant::now();
    let held = s.hold(serde_json::json!({}));
    let pushed = a.next(|m| m["type"] == "agent_target");
    let target_id = pushed["targetId"].as_str().unwrap().to_string();
    assert_eq!(s.claim(&target_id, "tab-a", false), serde_json::json!({ "ok": true, "granted": false }));
    assert_eq!(s.claim(&target_id, "tab-b", false), serde_json::json!({ "ok": true, "granted": false }));
    let (_, verdict) = held.join().unwrap();
    assert_eq!(verdict["error"], serde_json::json!("busy"));
    assert_eq!(verdict["state"], serde_json::json!("CYCLING"));
    assert_eq!(verdict["reason"], serde_json::json!("session_active"));
    assert!(started.elapsed() < Duration::from_millis(350), "the busy verdict did not wait for the timeout");
}

#[test]
fn agent_target_lease_lapses_and_a_disconnect_releases_it() {
    let s = Server::start("lease");
    let mut a = Overlay::connect(s.port, &s.token, "tab-a");
    let mut b = Overlay::connect(s.port, &s.token, "tab-b");
    a.next(|m| m["type"] == "connected");
    b.next(|m| m["type"] == "connected");
    let held = s.hold(serde_json::json!({}));
    let target_id = a.next(|m| m["type"] == "agent_target")["targetId"].as_str().unwrap().to_string();
    // A holds the lease; B is denied inside it.
    assert_eq!(s.claim(&target_id, "tab-a", true)["granted"], serde_json::json!(true));
    assert_eq!(s.claim(&target_id, "tab-b", true)["granted"], serde_json::json!(false));
    // A leaves without a result: its lease is handed back at once, well
    // inside the 250ms lease, and B rescues the request.
    drop(a);
    let mut granted = false;
    for _ in 0..20 {
        std::thread::sleep(Duration::from_millis(15));
        if s.claim(&target_id, "tab-b", true)["granted"] == serde_json::json!(true) {
            granted = true;
            break;
        }
    }
    assert!(granted, "the disconnect released the lease");
    post_json(s.port, "/agent-target-result", serde_json::json!({ "token": s.token, "targetId": target_id, "ok": true, "sessionId": "aabbccdd" }));
    let (_, verdict) = held.join().unwrap();
    assert_eq!(verdict["ok"], serde_json::json!(true));
    assert_eq!(verdict["sessionId"], serde_json::json!("aabbccdd"));
    let _ = &mut b;
}

#[test]
fn agent_target_replays_pending_targets_to_a_late_overlay() {
    let s = Server::start("replay");
    let mut a = Overlay::connect(s.port, &s.token, "tab-a");
    a.next(|m| m["type"] == "connected");
    let held = s.hold(serde_json::json!({}));
    let pushed = a.next(|m| m["type"] == "agent_target");
    let target_id = pushed["targetId"].as_str().unwrap().to_string();
    // B connects after the broadcast and still hears the pending target.
    let mut b = Overlay::connect(s.port, &s.token, "tab-b");
    let replayed = b.next(|m| m["type"] == "agent_target");
    assert_eq!(replayed["targetId"], serde_json::json!(target_id));
    assert_eq!(s.claim(&target_id, "tab-b", true)["granted"], serde_json::json!(true));
    post_json(s.port, "/agent-target-result", serde_json::json!({ "token": s.token, "targetId": target_id, "ok": true, "sessionId": "aabbccdd" }));
    let (_, verdict) = held.join().unwrap();
    assert_eq!(verdict["sessionId"], serde_json::json!("aabbccdd"));
}

#[test]
fn agent_target_reconnect_keeps_the_overlays_lease_and_word() {
    let s = Server::start("reconnect");
    let mut a = Overlay::connect(s.port, &s.token, "tab-a");
    let mut b = Overlay::connect(s.port, &s.token, "tab-b");
    a.next(|m| m["type"] == "connected");
    b.next(|m| m["type"] == "connected");
    let held = s.hold(serde_json::json!({}));
    let target_id = a.next(|m| m["type"] == "agent_target")["targetId"].as_str().unwrap().to_string();
    assert_eq!(s.claim(&target_id, "tab-a", true)["granted"], serde_json::json!(true));
    // An EventSource reconnect: the same page opens a replacement connection
    // under its clientId before the old one is seen to close.
    let mut a2 = Overlay::connect(s.port, &s.token, "tab-a");
    a2.next(|m| m["type"] == "agent_target");
    drop(a);
    std::thread::sleep(Duration::from_millis(150));
    // The old connection's close must not hand tab-a's lease to anyone:
    // tab-b stays denied, tab-a renews as the holder.
    assert_eq!(s.claim(&target_id, "tab-b", true)["granted"], serde_json::json!(false), "the lease survived the reconnect");
    assert_eq!(s.claim(&target_id, "tab-a", true)["granted"], serde_json::json!(true));
    post_json(s.port, "/agent-target-result", serde_json::json!({ "token": s.token, "targetId": target_id, "ok": true, "sessionId": "aabbccdd" }));
    let (_, verdict) = held.join().unwrap();
    assert_eq!(verdict["sessionId"], serde_json::json!("aabbccdd"));
    let _ = (&mut a2, &mut b);
}

#[test]
fn agent_target_roll_call_counts_overlays_not_connections() {
    let s = Server::start("distinct");
    let mut a = Overlay::connect(s.port, &s.token, "tab-a");
    let mut a2 = Overlay::connect(s.port, &s.token, "tab-a");
    a.next(|m| m["type"] == "connected");
    a2.next(|m| m["type"] == "connected");
    let started = Instant::now();
    let held = s.hold(serde_json::json!({}));
    let target_id = a.next(|m| m["type"] == "agent_target")["targetId"].as_str().unwrap().to_string();
    // One overlay behind two connections reports busy once: that completes
    // the roll call instead of waiting on a "second" report until timeout.
    assert_eq!(s.claim(&target_id, "tab-a", false), serde_json::json!({ "ok": true, "granted": false }));
    let (_, verdict) = held.join().unwrap();
    assert_eq!(verdict["error"], serde_json::json!("busy"));
    assert!(started.elapsed() < Duration::from_millis(350), "the busy verdict did not wait for the timeout");
    let _ = &mut a2;
}
