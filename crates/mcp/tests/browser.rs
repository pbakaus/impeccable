//! The browser relay (REN-2053) against a fake extension: Chrome's native-messaging frames on one side, agents'
//! `impeccable mcp` processes on the other.
#![cfg(unix)]
use impeccable_mcp::browser::{self, read_frame, write_frame, BUSY, FROM_EXTENSION_MAX};
use impeccable_mcp::{serve_with, Failure, Upstream};
use serde_json::{json, Value};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// The account service, answering tools/list with one remote tool.
struct Remote;
impl Upstream for Remote {
    fn call(&mut self, r: &Value) -> Result<Value, Failure> {
        Ok(json!({ "jsonrpc": "2.0", "id": r["id"], "result": { "tools": [{ "name": "taste.get" }] } }))
    }
    fn sign_in(&mut self) -> Result<(), String> {
        Ok(())
    }
}

fn short_dir(tag: &str) -> PathBuf {
    let d = PathBuf::from("/tmp").join(format!("imp-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    d
}

/// A relay on `socket` with a fake extension; the test holds the extension's end.
fn relay(socket: &Path) -> UnixStream {
    let (ext, host_side) = UnixStream::pair().unwrap();
    let input = host_side.try_clone().unwrap();
    let s = socket.to_path_buf();
    std::thread::spawn(move || browser::host(&s, input, host_side));
    for _ in 0..100 {
        if browser::ready(socket) {
            return ext;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    panic!("relay never came up");
}

fn agent_session(socket: &Path, lines: &[Value]) -> Vec<Value> {
    let input: String = lines.iter().map(|l| format!("{l}\n")).collect();
    let mut out = Vec::new();
    serve_with(input.as_bytes(), &mut out, &mut Vec::new(), &mut Remote, Some(socket));
    String::from_utf8(out).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect()
}

fn names(list: &Value) -> Vec<String> {
    list["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap().to_string()).collect()
}

// Catches browser tools listed with no extension to answer them (every listed tool costs every turn), and a relay
// whose socket or folder another user could open.
#[test]
fn lists_browser_tools_only_while_the_extension_is_connected() {
    let dir = short_dir("list");
    let socket = dir.join("browser").join("host.sock");
    let list = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" });
    assert_eq!(names(&agent_session(&socket, &[list.clone()])[0]), ["taste.get"]);

    // A file left by a crashed relay is replaced, not a reason to fail.
    std::fs::create_dir_all(socket.parent().unwrap()).unwrap();
    std::fs::write(&socket, b"").unwrap();
    let _ext = relay(&socket);
    assert_eq!(names(&agent_session(&socket, &[list])[0]), ["taste.get", "browser_open", "browser_act", "browser_look", "browser_end"]);
    let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
    assert_eq!((mode(socket.parent().unwrap()), mode(&socket)), (0o700, 0o600));
    let _ = std::fs::remove_dir_all(dir);
}

// Catches a call that doesn't reach the extension named for its agent, an answer that doesn't come back as the
// tool's result, a second agent driving at the same time, and an agent's leaving not told to the extension.
#[test]
fn relays_one_agent_at_a_time_and_tells_the_extension_when_it_leaves() {
    let dir = short_dir("drive");
    let socket = dir.join("browser").join("host.sock");
    let mut ext = relay(&socket);

    let mut first = browser::Link::connect(&socket, "claude-code").unwrap();
    let mut ext_answer = ext.try_clone().unwrap();
    let extension = std::thread::spawn(move || {
        let call = read_frame(&mut ext_answer, FROM_EXTENSION_MAX).unwrap().unwrap();
        write_frame(&mut ext_answer, &json!({ "id": call["id"], "result": { "content": [{ "type": "text", "text": "seen" }] } }), FROM_EXTENSION_MAX).unwrap();
        call
    });
    let answer = first.call("browser_look", &json!({ "kind": "styles", "x": 4, "y": 8 })).unwrap();
    let call = extension.join().unwrap();
    assert_eq!((call["agent"].as_str(), call["tool"].as_str(), call["arguments"]["kind"].as_str()), (Some("claude-code"), Some("browser_look"), Some("styles")));
    assert_eq!(answer["content"][0]["text"], "seen");

    // While the first drives, a second is told it's busy and lists no browser tools.
    assert!(!browser::ready(&socket));
    let mut second = browser::Link::connect(&socket, "codex").unwrap();
    assert_eq!(second.call("browser_open", &json!({ "url": "https://example.com" })), Err(BUSY.to_string()));

    // The first leaves: the extension hears it, and the browser is free again.
    drop(first);
    ext.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
    assert_eq!(read_frame(&mut ext, FROM_EXTENSION_MAX).unwrap().unwrap()["type"], "agent-gone");
    assert!(browser::ready(&socket));
    let _ = std::fs::remove_dir_all(dir);
}

// Catches native-host mode answering any origin but our extension's.
#[test]
fn serves_only_the_impeccable_extension() {
    assert!(browser::is_extension_origin("chrome-extension://bdkgmiklpdmaojlpflclinlofgjfpabf/"));
    assert!(!browser::is_extension_origin("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"));
    assert!(!browser::is_extension_origin("mcp"));
}
