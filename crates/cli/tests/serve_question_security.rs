//! End-to-end check of the serve-question POST gates (public repo main
//! eaaecbd1 / 2e075dc5: session key + Origin/Host allowlists), mirroring the
//! scenarios of tests/serve-question.test.mjs there.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::Path;

fn raw_request(port: u16, method: &str, target: &str, headers: &[(&str, &str)], body: Option<&str>) -> (u16, String) {
    let mut s = TcpStream::connect(("127.0.0.1", port)).expect("connect");
    let body = body.unwrap_or("");
    let mut req = format!("{} {} HTTP/1.1\r\n", method, target);
    let mut has_host = false;
    for (k, v) in headers {
        if k.eq_ignore_ascii_case("host") {
            has_host = true;
        }
        req.push_str(&format!("{}: {}\r\n", k, v));
    }
    if !has_host {
        req.push_str(&format!("Host: 127.0.0.1:{}\r\n", port));
    }
    req.push_str(&format!("Content-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body));
    s.write_all(req.as_bytes()).unwrap();
    let mut out = Vec::new();
    let _ = s.read_to_end(&mut out);
    let text = String::from_utf8_lossy(&out).into_owned();
    let status: u16 = text.split_whitespace().nth(1).and_then(|c| c.parse().ok()).unwrap_or(0);
    (status, text)
}

#[test]
fn detached_posts_require_key_and_loopback_host_origin() {
    let dir = std::env::temp_dir().join(format!("impeccable-sq-sec-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let payload = r#"{"title":"Choose the visual world","question":"The roll assigned Fillmore Handbill.","options":[{"id":"assigned","label":"Fillmore Handbill","kicker":"THE ROLL"},{"id":"challenger-1","label":"Teletext Service"}],"reroll":true,"steer":true}"#;
    std::fs::write(dir.join("q.json"), payload).unwrap();
    let key = "seckey";
    let mut child = std::process::Command::new(env!("CARGO_BIN_EXE_impeccable"))
        .args([
            "serve-question",
            "--detached-serve",
            "--key",
            key,
            "--payload",
            "q.json",
            "--no-open",
            "--timeout",
            "60",
        ])
        .current_dir(&dir)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .expect("spawn serve-question");

    let state_path = dir.join(".impeccable/questions").join(format!("{}.state.json", key));
    let answer_path = dir.join(".impeccable/questions").join(format!("{}.answer.json", key));
    let flip_path = dir.join(".impeccable/questions").join(format!("{}.flip.json", key));
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while !state_path.exists() && std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    let run = || -> Result<(), String> {
        let state: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&state_path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        let port = state.get("port").and_then(|p| p.as_u64()).ok_or("no port")? as u16;
        let good_host = format!("127.0.0.1:{}", port);
        let json = ("Content-Type", "application/json");
        let body = r#"{"optionId":"assigned","steer":""}"#;

        // Missing / wrong key: 401, and no answer lands on disk.
        let (st, _) = raw_request(port, "POST", "/answer", &[json], Some(body));
        assert_eq!(st, 401, "no key");
        assert!(!answer_path.exists());
        let (st, _) = raw_request(port, "POST", "/answer?key=wrong", &[json], Some(body));
        assert_eq!(st, 401, "wrong key");

        // Right key but foreign Origin or Host: 403.
        let (st, _) = raw_request(port, "POST", &format!("/answer?key={}", key), &[json, ("Origin", "https://evil.example")], Some(body));
        assert_eq!(st, 403, "evil origin");
        assert!(!answer_path.exists());
        let (st, _) = raw_request(port, "POST", &format!("/answer?key={}", key), &[json, ("Host", &format!("evil.example:{}", port))], Some(body));
        assert_eq!(st, 403, "spoofed host");

        // Heartbeats take the same gate.
        let (st, _) = raw_request(port, "POST", "/heartbeat", &[], None);
        assert_eq!(st, 401, "no-key heartbeat");

        // Foreign or bare Host on a GET: 403 (bare loopback passes on :80 only).
        let (st, _) = raw_request(port, "GET", "/", &[("Host", &format!("evil.example:{}", port))], None);
        assert_eq!(st, 403, "spoofed host GET");
        let (st, _) = raw_request(port, "GET", "/", &[("Host", "127.0.0.1")], None);
        assert_eq!(st, 403, "bare host GET");

        // A target the URL parser rejects: 400.
        let (st, _) = raw_request(port, "GET", "//", &[("Host", &good_host)], None);
        assert_eq!(st, 400, "// target");

        // The page wires the key into every POST it makes.
        let (st, page) = raw_request(port, "GET", "/", &[("Host", &good_host)], None);
        assert_eq!(st, 200, "page GET");
        assert!(page.contains(r#"const KEY = "seckey""#), "page carries the key");
        assert!(page.contains("/answer' + keyQ"));
        assert!(page.contains("/heartbeat' + keyQ"));
        assert!(page.contains("/build-path' + keyQ"));

        // The build-path flip takes the same gate as /answer.
        let flip = r#"{"value":"comp"}"#;
        let (st, _) = raw_request(port, "POST", "/build-path", &[json], Some(flip));
        assert_eq!(st, 401, "no-key flip");
        assert!(!flip_path.exists());
        let (st, _) = raw_request(port, "POST", &format!("/build-path?key={}", key), &[json, ("Origin", "https://evil.example")], Some(flip));
        assert_eq!(st, 403, "evil-origin flip");
        assert!(!flip_path.exists());
        let (st, _) = raw_request(port, "POST", &format!("/build-path?key={}", key), &[json], Some(flip));
        assert_eq!(st, 200, "keyed flip");
        assert!(flip_path.exists(), "flip file written");

        // With the key (and a loopback Origin) the answer lands.
        let (st, _) = raw_request(
            port,
            "POST",
            &format!("/answer?key={}", key),
            &[json, ("Origin", &format!("http://127.0.0.1:{}", port))],
            Some(body),
        );
        assert_eq!(st, 200, "keyed answer");
        wait_for(&answer_path);
        let answer = std::fs::read_to_string(&answer_path).map_err(|e| e.to_string())?;
        assert!(answer.contains(r#""optionId":"assigned""#), "answer recorded: {}", answer);
        Ok(())
    };
    let result = run();
    let _ = child.kill();
    let _ = child.wait();
    let _ = std::fs::remove_dir_all(&dir);
    result.expect("serve-question security scenario");
}

fn wait_for(p: &Path) {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while !p.exists() && std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
}
