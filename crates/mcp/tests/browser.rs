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
    // The developer build, its ID pinned by the manifest's key.
    assert!(browser::is_extension_origin("chrome-extension://apffhogljdpdafpcjokfkgbcmhldjmpi/"));
    assert!(!browser::is_extension_origin("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"));
    assert!(!browser::is_extension_origin("mcp"));
}

// Catches the driving agent losing its browser tools on a re-list: its own probe would read the browser as busy.
#[test]
fn the_driving_agent_keeps_its_tools_when_it_lists_again() {
    let dir = short_dir("relist");
    let socket = dir.join("browser").join("host.sock");
    let mut ext = relay(&socket);
    std::thread::spawn(move || {
        while let Ok(Some(call)) = read_frame(&mut ext, FROM_EXTENSION_MAX) {
            if call.get("id").is_some() {
                let _ = write_frame(&mut ext, &json!({ "id": call["id"], "result": { "content": [] } }), FROM_EXTENSION_MAX);
            }
        }
    });
    let replies = agent_session(&socket, &[
        json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": "browser_open", "arguments": { "url": "https://example.com" } } }),
        json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }),
    ]);
    assert!(names(&replies[1]).contains(&"browser_act".to_string()));
    let _ = std::fs::remove_dir_all(dir);
}

/// The account service, unreachable.
struct Down;
impl Upstream for Down {
    fn call(&mut self, _: &Value) -> Result<Value, Failure> {
        Err(Failure::Other("unreachable".into()))
    }
    fn sign_in(&mut self) -> Result<(), String> {
        Ok(())
    }
}

// Catches a reply for an agent that left reaching the next agent (each agent numbers its calls from 1), a second
// relay starting beside the first, a busy agent keeping browser tools it can't use, and local tools hidden when the
// account service is down.
#[test]
fn replies_reach_only_the_agent_that_asked() {
    let dir = short_dir("route");
    let socket = dir.join("browser").join("host.sock");
    let mut ext = relay(&socket);
    let (other_in, other_out) = UnixStream::pair().unwrap();
    assert_eq!(browser::host(&socket, other_in, other_out).map_err(|e| e.kind()), Err(std::io::ErrorKind::AddrInUse));

    // Agent A asks and leaves before the answer.
    let mut a = UnixStream::connect(&socket).unwrap();
    write_frame(&mut a, &json!({ "id": 1, "agent": "a", "tool": "browser_look", "arguments": {} }), browser::TO_EXTENSION_MAX).unwrap();
    let asked_a = read_frame(&mut ext, FROM_EXTENSION_MAX).unwrap().unwrap();
    drop(a);
    assert_eq!(read_frame(&mut ext, FROM_EXTENSION_MAX).unwrap().unwrap()["type"], "agent-gone");

    // Agent B claims; A's late answer arrives first and must not be B's.
    let mut b = browser::Link::connect(&socket, "b").unwrap();
    let mut ext_b = ext.try_clone().unwrap();
    let extension = std::thread::spawn(move || {
        let asked_b = read_frame(&mut ext_b, FROM_EXTENSION_MAX).unwrap().unwrap();
        write_frame(&mut ext_b, &json!({ "id": asked_a["id"], "result": { "content": [{ "type": "text", "text": "A's" }] } }), FROM_EXTENSION_MAX).unwrap();
        write_frame(&mut ext_b, &json!({ "id": asked_b["id"], "result": { "content": [{ "type": "text", "text": "B's" }] } }), FROM_EXTENSION_MAX).unwrap();
    });
    assert_eq!(b.call("browser_look", &json!({ "kind": "screenshot" })).unwrap()["content"][0]["text"], "B's");
    extension.join().unwrap();

    // C, refused while B drives, lists no browser tools after; with the account service down, B's own list is
    // still its browser tools.
    let list = json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" });
    let call = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": "browser_end", "arguments": {} } });
    let c = agent_session(&socket, &[call, list.clone()]);
    assert_eq!((c[0]["result"]["isError"].as_bool(), names(&c[1])), (Some(true), vec!["taste.get".to_string()]));
    drop(b);
    for _ in 0..100 {
        if browser::ready(&socket) {
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    let mut out = Vec::new();
    serve_with(format!("{list}\n").as_bytes(), &mut out, &mut Vec::new(), &mut Down, Some(&socket));
    let reply: Value = serde_json::from_slice(&out).unwrap();
    assert_eq!(names(&reply).len(), 4);
    let _ = std::fs::remove_dir_all(dir);
}

/// A server the test talks to line by line: it sends requests and reads each reply as the server writes it, so
/// nothing depends on thread timing.
struct Live {
    to: UnixStream,
    from: std::io::BufReader<UnixStream>,
    server: std::thread::JoinHandle<()>,
}

impl Live {
    fn start(socket: &Path) -> Live {
        let (to, server_in) = UnixStream::pair().unwrap();
        let (server_out, from) = UnixStream::pair().unwrap();
        // A missing reply fails the test instead of hanging it.
        from.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        let s = socket.to_path_buf();
        let server = std::thread::spawn(move || {
            let mut out = server_out;
            serve_with(std::io::BufReader::new(server_in), &mut out, &mut Vec::new(), &mut Remote, Some(&s));
        });
        Live { to, from: std::io::BufReader::new(from), server }
    }

    fn send(&mut self, v: Value) {
        use std::io::Write as _;
        writeln!(self.to, "{v}").unwrap();
    }

    fn read(&mut self) -> Value {
        use std::io::BufRead as _;
        let mut line = String::new();
        self.from.read_line(&mut line).unwrap();
        serde_json::from_str(&line).unwrap()
    }

    fn end(self) {
        drop(self.to);
        self.server.join().unwrap();
    }
}

fn said(m: &Value) -> String {
    m["method"].as_str().map(str::to_string).unwrap_or_else(|| m["id"].to_string())
}

// Catches an agent that listed before Chrome opened never learning the browser tools exist, and a server that
// doesn't say it sends that notice.
#[test]
fn tells_the_agent_its_tools_changed_when_chrome_connects_later() {
    let dir = short_dir("changed");
    let socket = dir.join("browser").join("host.sock");
    let mut live = Live::start(&socket);
    live.send(json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {} }));
    assert_eq!(live.read()["result"]["capabilities"]["tools"]["listChanged"], true);
    live.send(json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }));
    assert_eq!(said(&live.read()), "2");
    let _ext = relay(&socket);
    live.send(json!({ "jsonrpc": "2.0", "id": 3, "method": "ping" }));
    assert_eq!([said(&live.read()), said(&live.read())], ["notifications/tools/list_changed", "3"]);
    live.send(json!({ "jsonrpc": "2.0", "id": 4, "method": "ping" }));
    assert_eq!(said(&live.read()), "4");
    live.end();
    let _ = std::fs::remove_dir_all(dir);
}

// Catches an agent that ended its session still holding the browser while its MCP process lives on, so every
// other agent is told someone else is using it (REN-2466).
#[test]
fn an_ended_session_hands_the_browser_to_the_next_agent() {
    let dir = short_dir("handoff");
    let socket = dir.join("browser").join("host.sock");
    let mut ext = relay(&socket);
    // A release that never comes fails the test instead of hanging it.
    ext.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
    let mut a = Live::start(&socket);
    for (id, tool) in [(1, "browser_open"), (2, "browser_end")] {
        a.send(json!({ "jsonrpc": "2.0", "id": id, "method": "tools/call", "params": { "name": tool, "arguments": {} } }));
        let asked = read_frame(&mut ext, FROM_EXTENSION_MAX).unwrap().unwrap();
        assert_eq!(asked["tool"], tool);
        write_frame(&mut ext, &json!({ "id": asked["id"], "result": { "content": [] } }), FROM_EXTENSION_MAX).unwrap();
        assert_eq!(a.read()["id"], id);
    }
    // A's process is still running; its session is over, so the relay has let it go.
    assert_eq!(read_frame(&mut ext, FROM_EXTENSION_MAX).unwrap().unwrap()["type"], "agent-gone");
    let mut b = browser::Link::connect(&socket, "b").unwrap();
    let mut ext_b = ext.try_clone().unwrap();
    let extension = std::thread::spawn(move || {
        let asked = read_frame(&mut ext_b, FROM_EXTENSION_MAX).unwrap().unwrap();
        write_frame(&mut ext_b, &json!({ "id": asked["id"], "result": { "content": [{ "type": "text", "text": "B's" }] } }), FROM_EXTENSION_MAX).unwrap();
    });
    assert_eq!(b.call("browser_open", &json!({})).unwrap()["content"][0]["text"], "B's");
    extension.join().unwrap();
    a.end();
    let _ = std::fs::remove_dir_all(dir);
}

// Catches a crashed relay's leftover socket file hiding the relay that replaces it: same path, a new socket.
#[test]
fn a_relay_replacing_a_crashed_ones_file_is_news() {
    let dir = short_dir("stale");
    let socket = dir.join("browser").join("host.sock");
    std::fs::create_dir_all(socket.parent().unwrap()).unwrap();
    std::fs::write(&socket, b"").unwrap();
    let mut live = Live::start(&socket);
    live.send(json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }));
    assert_eq!(said(&live.read()), "1");
    let _ext = relay(&socket);
    live.send(json!({ "jsonrpc": "2.0", "id": 2, "method": "ping" }));
    assert_eq!(said(&live.read()), "notifications/tools/list_changed");
    live.end();
    let _ = std::fs::remove_dir_all(dir);
}
