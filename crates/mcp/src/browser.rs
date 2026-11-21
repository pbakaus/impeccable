//! The browser half of `impeccable mcp` (REN-2053): the person's own agent drives their signed-in Chrome through the
//! Impeccable extension, locally. Nothing here leaves the machine.
//!
//! Chrome starts this binary as the extension's native-messaging host, with the extension's origin as its first
//! argument. The host relays length-prefixed JSON frames between the extension (stdin and stdout) and one owner-only
//! unix socket, `<IMPECCABLE_HOME>/browser/host.sock`. An `impeccable mcp` process connects there to drive; one agent
//! at a time, and a second is told the browser is busy. The extension decides everything else: which sites are
//! allowed (the person's Allow), Pro, and every end. It ends the session when its agent goes away.
//!
//! Who can send commands: a process of this user that can open that socket (the folder is 0700, the socket 0600),
//! the same trust as the CLI's stored sign-in. Our servers never reach it.
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// The Impeccable extension's origins, the only ones the host serves: the Chrome Web Store build, and the developer
/// build loaded unpacked, whose manifest `key` pins its ID (only the developer build asks for native messaging yet).
pub const EXTENSION_IDS: &[&str] = &["bdkgmiklpdmaojlpflclinlofgjfpabf", "apffhogljdpdafpcjokfkgbcmhldjmpi"];
/// Chrome's own caps: a host's message to the extension is at most 1 MB, the extension's to the host 64 MiB.
pub const TO_EXTENSION_MAX: usize = 1024 * 1024;
pub const FROM_EXTENSION_MAX: usize = 64 * 1024 * 1024;
/// macOS caps a unix socket's path at 104 bytes.
const SOCKET_PATH_MAX: usize = 100;
/// How long a browser call waits for the extension: the person may be deciding whether to allow a site.
pub const CALL_WAIT: Duration = Duration::from_secs(6 * 60);
/// What the agent reads when another agent is driving.
pub const BUSY: &str = "Another agent is using the browser. Try again when it has finished.";
/// What the agent reads when the extension went away mid-call.
pub const GONE: &str = "The Impeccable extension stopped answering. Open Chrome and try again.";

/// Whether `arg` is our extension's origin, as Chrome passes it to a native host.
pub fn is_extension_origin(arg: &str) -> bool {
    arg.strip_prefix("chrome-extension://")
        .map(|rest| rest.trim_end_matches('/'))
        .is_some_and(|id| EXTENSION_IDS.contains(&id))
}

/// The relay's socket, or None where there is no home or the path is too long for a unix socket.
pub fn socket_path(env: &HashMap<String, String>) -> Option<PathBuf> {
    let path = impeccable_account::config::impeccable_home(env)?.join("browser").join("host.sock");
    (path.as_os_str().len() <= SOCKET_PATH_MAX).then_some(path)
}

/// Read one frame: a 4-byte native-endian length, then that much JSON. None at a clean end of input.
pub fn read_frame(r: &mut impl Read, max: usize) -> io::Result<Option<Value>> {
    let mut len = [0u8; 4];
    match r.read_exact(&mut len) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let len = u32::from_ne_bytes(len) as usize;
    if len > max {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "frame too large"));
    }
    let mut body = vec![0u8; len];
    r.read_exact(&mut body)?;
    serde_json::from_slice(&body).map(Some).map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "frame is not JSON"))
}

/// Write one frame, refusing one larger than `max`.
pub fn write_frame(w: &mut impl Write, v: &Value, max: usize) -> io::Result<()> {
    let body = serde_json::to_vec(v).map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "unencodable"))?;
    if body.len() > max {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "frame too large"));
    }
    w.write_all(&(body.len() as u32).to_ne_bytes())?;
    w.write_all(&body)?;
    w.flush()
}

/// The four tools an agent sees while the extension is connected. One line each: every listed tool costs every turn.
pub fn tools() -> Vec<Value> {
    let num = || json!({ "type": "number" });
    vec![
        json!({ "name": "browser_open", "description": "Open a page in the person's own Chrome (they allow each site once or always); answers with its accessibility tree, each control's [ref] beside it.",
            "inputSchema": { "type": "object", "properties": { "url": { "type": "string" } }, "required": ["url"] } }),
        json!({ "name": "browser_act", "description": "Act on the open page by a control's ref (or x, y): goto, back, click, type, press, scroll, or set the viewport (a real 390 wide). Answers with the tree after.",
            "inputSchema": { "type": "object", "properties": {
                "op": { "type": "string", "enum": ["goto", "back", "click", "type", "press", "scroll", "viewport"] },
                "ref": { "type": "integer" }, "x": num(), "y": num(), "dx": num(), "dy": num(), "width": num(), "height": num(),
                "text": { "type": "string" }, "key": { "type": "string" }, "url": { "type": "string" } }, "required": ["op"] } }),
        json!({ "name": "browser_look", "description": "Look at the open page: a screenshot, a zoomed region (x, y, w, h), a motion filmstrip, computed styles and tokens or ink edges of a ref or point, or the tree.",
            "inputSchema": { "type": "object", "properties": {
                "kind": { "type": "string", "enum": ["screenshot", "zoom", "filmstrip", "styles", "ink", "tree"] },
                "ref": { "type": "integer" }, "x": num(), "y": num(), "w": num(), "h": num(), "seconds": num() }, "required": ["kind"] } }),
        json!({ "name": "browser_end", "description": "End your browser session and hand the tab back.",
            "inputSchema": { "type": "object", "properties": {} } }),
    ]
}

/// Which socket file is at `socket` now (device, inode and change time, since a filesystem may reuse a deleted file's
/// inode at once), or None when there's none: a new relay's socket differs from a crashed one's leftover even at the
/// same path.
#[cfg(unix)]
pub fn socket_identity(socket: &Path) -> Option<(u64, u64, i64, i64)> {
    use std::os::unix::fs::MetadataExt;
    std::fs::symlink_metadata(socket).ok().map(|m| (m.dev(), m.ino(), m.ctime(), m.ctime_nsec()))
}
#[cfg(not(unix))]
pub fn socket_identity(_: &Path) -> Option<(u64, u64, i64, i64)> {
    None
}

pub fn is_browser_tool(name: &str) -> bool {
    name.starts_with("browser_")
}

#[cfg(unix)]
pub use unix::{host, ready, Link};

#[cfg(not(unix))]
pub struct Link;
#[cfg(not(unix))]
impl Link {
    /// No unix socket on Windows yet, so no browser tools there.
    pub fn connect(_: &Path, _: &str) -> Option<Link> {
        None
    }
    pub fn call(&mut self, _: &str, _: &Value) -> Result<Value, String> {
        Err(GONE.to_string())
    }
}
#[cfg(not(unix))]
pub fn ready(_: &Path) -> bool {
    false
}
#[cfg(not(unix))]
pub fn host(_: &Path, _: impl Read + Send + 'static, _: impl Write + Send + 'static) -> io::Result<()> {
    Err(io::Error::new(io::ErrorKind::Unsupported, "the browser relay needs a unix socket"))
}

#[cfg(unix)]
mod unix {
    use super::*;
    use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
    use std::os::unix::net::{UnixListener, UnixStream};
    use std::sync::{Arc, Mutex};

    /// Who drives, and which agent's call each relay id answers. One lock decides a claim, a call's id and its
    /// send, and an agent's departure: so a reply goes only to the agent that asked, and an `agent-gone` can never
    /// follow the next agent's first call.
    #[derive(Default)]
    struct Relay {
        driver: Option<(u64, UnixStream)>,
        /// Relay id -> (connection, the agent's own id).
        pending: HashMap<u64, (u64, Value)>,
        next: u64,
    }

    /// The relay, until the extension closes its side. `ext_in`/`ext_out` are the host's stdin and stdout.
    pub fn host(socket: &Path, mut ext_in: impl Read + Send + 'static, ext_out: impl Write + Send + 'static) -> io::Result<()> {
        let dir = socket.parent().ok_or_else(|| io::Error::other("no folder"))?;
        std::fs::DirBuilder::new().recursive(true).mode(0o700).create(dir)?;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
        // One relay per machine user: the lock is held for the relay's life, so replacing a stale socket can't race
        // another relay starting.
        let lock = std::fs::OpenOptions::new().create(true).truncate(false).write(true).open(dir.join("host.lock"))?;
        if lock.try_lock().is_err() {
            return Err(io::Error::new(io::ErrorKind::AddrInUse, "another relay is running"));
        }
        let _ = std::fs::remove_file(socket);
        let listener = UnixListener::bind(socket)?;
        std::fs::set_permissions(socket, std::fs::Permissions::from_mode(0o600))?;
        let ext_out = Arc::new(Mutex::new(ext_out));
        let relay = Arc::new(Mutex::new(Relay::default()));

        {
            let (ext_out, relay) = (ext_out.clone(), relay.clone());
            std::thread::spawn(move || {
                for (n, stream) in listener.incoming().flatten().enumerate() {
                    let (ext_out, relay) = (ext_out.clone(), relay.clone());
                    std::thread::spawn(move || agent(n as u64, stream, &*ext_out, &relay));
                }
            });
        }

        // The extension: an answer goes back to the agent that asked, under its own id, while it still drives.
        while let Ok(Some(mut frame)) = read_frame(&mut ext_in, FROM_EXTENSION_MAX) {
            let mut r = relay.lock().unwrap();
            let to = frame["id"].as_u64().and_then(|rid| r.pending.remove(&rid));
            let Some((conn, theirs)) = to else { continue };
            if let Some((d, s)) = r.driver.as_mut() {
                if *d == conn {
                    frame["id"] = theirs;
                    let _ = write_frame(s, &frame, FROM_EXTENSION_MAX);
                }
            }
        }
        if let Some((_, s)) = relay.lock().unwrap().driver.take() {
            let _ = s.shutdown(std::net::Shutdown::Both);
        }
        let _ = std::fs::remove_file(socket);
        drop(lock);
        Ok(())
    }

    /// One connection. A probe is answered here and claims nothing; the first call claims the browser for this
    /// connection, and its end hands it back and tells the extension, which ends the session.
    fn agent(n: u64, mut stream: UnixStream, ext_out: &Mutex<impl Write>, relay: &Mutex<Relay>) {
        while let Ok(Some(mut frame)) = read_frame(&mut stream, TO_EXTENSION_MAX) {
            let probe = frame["type"] == "probe";
            let reply = {
                let mut r = relay.lock().unwrap();
                let other = r.driver.as_ref().is_some_and(|(d, _)| *d != n);
                if probe {
                    Some(if other { json!({ "error": BUSY }) } else { json!({ "type": "ready" }) })
                } else if other {
                    Some(json!({ "id": frame["id"], "error": BUSY }))
                } else {
                    if r.driver.is_none() {
                        let Ok(writer) = stream.try_clone() else { break };
                        r.driver = Some((n, writer));
                    }
                    r.next += 1;
                    let rid = r.next;
                    r.pending.insert(rid, (n, frame["id"].clone()));
                    frame["id"] = json!(rid);
                    if write_frame(&mut *ext_out.lock().unwrap(), &frame, TO_EXTENSION_MAX).is_err() {
                        break;
                    }
                    None
                }
            };
            if let Some(reply) = reply {
                if write_frame(&mut stream, &reply, TO_EXTENSION_MAX).is_err() {
                    break;
                }
            }
        }
        let mut r = relay.lock().unwrap();
        r.pending.retain(|_, (conn, _)| *conn != n);
        if r.driver.as_ref().is_some_and(|(d, _)| *d == n) {
            let _ = write_frame(&mut *ext_out.lock().unwrap(), &json!({ "type": "agent-gone" }), TO_EXTENSION_MAX);
            r.driver = None;
        }
    }

    /// Whether the relay is up and free for this agent: a connect, a probe and its answer, within about 100 ms.
    pub fn ready(socket: &Path) -> bool {
        let Ok(mut s) = UnixStream::connect(socket) else { return false };
        let short = Some(Duration::from_millis(100));
        if s.set_read_timeout(short).is_err() || s.set_write_timeout(short).is_err() {
            return false;
        }
        write_frame(&mut s, &json!({ "type": "probe" }), TO_EXTENSION_MAX).is_ok()
            && matches!(read_frame(&mut s, FROM_EXTENSION_MAX), Ok(Some(f)) if f["type"] == "ready")
    }

    /// An agent's connection to the relay, held for its session once it has made a call.
    pub struct Link {
        stream: UnixStream,
        agent: String,
        next: u64,
    }

    impl Link {
        pub fn connect(socket: &Path, agent: &str) -> Option<Link> {
            let stream = UnixStream::connect(socket).ok()?;
            stream.set_write_timeout(Some(Duration::from_secs(5))).ok()?;
            Some(Link { stream, agent: agent.to_string(), next: 1 })
        }

        /// One tool call, answered with the extension's MCP result (content, isError) or the line the agent reads.
        pub fn call(&mut self, tool: &str, arguments: &Value) -> Result<Value, String> {
            let id = self.next;
            self.next += 1;
            let frame = json!({ "id": id, "agent": self.agent, "tool": tool, "arguments": arguments });
            write_frame(&mut self.stream, &frame, TO_EXTENSION_MAX).map_err(|_| GONE.to_string())?;
            self.stream.set_read_timeout(Some(CALL_WAIT)).map_err(|_| GONE.to_string())?;
            loop {
                match read_frame(&mut self.stream, FROM_EXTENSION_MAX) {
                    Ok(Some(f)) if f["id"] == json!(id) => {
                        return match f.get("result") {
                            Some(r) => Ok(r.clone()),
                            None => Err(f["error"].as_str().unwrap_or(GONE).to_string()),
                        };
                    }
                    Ok(Some(_)) => continue,
                    _ => return Err(GONE.to_string()),
                }
            }
        }
    }
}
