//! A small HTTP/1.1 server core for the live helper: `TcpListener`, one thread
//! per connection, request parsing (headers + Content-Length / chunked body),
//! plain responses, and long-lived streamed responses (SSE, parked polls)
//! with client-close detection. Stands in for `node:http`; nothing here is
//! contract-visible except the routes `live_server` builds on it.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Shutdown, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

pub struct Request {
    pub method: String,
    /// Raw request target (path + query), as `req.url` in Node.
    pub target: String,
    pub path: String,
    pub query: Vec<(String, String)>,
    /// Lower-cased header names.
    pub headers: HashMap<String, String>,
    pub body: Vec<u8>,
    /// Set when the body exceeded `max_body` while reading (payload too large).
    pub body_truncated: bool,
}

impl Request {
    /// `url.searchParams.get(name)`: first value or None.
    pub fn query_get(&self, name: &str) -> Option<&str> {
        self.query
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    }
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .get(&name.to_ascii_lowercase())
            .map(String::as_str)
    }
}

/// Percent-decode with `+` as space (`URLSearchParams` semantics), lossy UTF-8.
pub fn decode_query_component(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let h = (bytes[i + 1] as char).to_digit(16);
                let l = (bytes[i + 2] as char).to_digit(16);
                match (h, l) {
                    (Some(h), Some(l)) => {
                        out.push((h * 16 + l) as u8);
                        i += 3;
                    }
                    _ => {
                        out.push(b'%');
                        i += 1;
                    }
                }
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Split a request target into (pathname, query pairs). Mirrors what
/// `new URL(req.url, base)` exposes: the pathname is kept as sent (minus a
/// fragment), search params are decoded.
pub fn parse_target(target: &str) -> (String, Vec<(String, String)>) {
    let no_frag = target.split('#').next().unwrap_or("");
    let (path, query) = match no_frag.find('?') {
        Some(i) => (&no_frag[..i], &no_frag[i + 1..]),
        None => (no_frag, ""),
    };
    let mut pairs = Vec::new();
    for part in query.split('&') {
        if part.is_empty() {
            continue;
        }
        let (k, v) = match part.find('=') {
            Some(i) => (&part[..i], &part[i + 1..]),
            None => (part, ""),
        };
        pairs.push((decode_query_component(k), decode_query_component(v)));
    }
    let path = if path.is_empty() {
        "/".to_string()
    } else {
        normalize_path(path)
    };
    (path, pairs)
}

/// WHATWG URL path normalization for the cases that matter here: collapse
/// `.` and `..` segments.
fn normalize_path(p: &str) -> String {
    let mut segs: Vec<&str> = Vec::new();
    for seg in p.split('/').skip(1) {
        match seg {
            "." => {}
            ".." => {
                segs.pop();
            }
            s => segs.push(s),
        }
    }
    let mut out = String::from("/");
    out.push_str(&segs.join("/"));
    if p.ends_with("/..") || p.ends_with("/.") {
        if !out.ends_with('/') {
            out.push('/');
        }
    }
    out
}

/// Ceiling on the request head (request line + headers). Node's http server
/// rejects heads over ~16 KB by default (`maxHeaderSize`); this hand-rolled
/// parser used to accumulate header lines unbounded, letting a hostile
/// pre-auth localhost connection grow memory without limit. 64 KB keeps 4x
/// headroom over Node's default for legitimate local tooling while staying
/// finite. A head that exhausts the budget reads as EOF below, so the request
/// is dropped the way any malformed input is: connection closed, no panic.
const MAX_HEAD_BYTES: u64 = 64 * 1024;

/// Read one HTTP request from the stream. `max_body` caps the body read; a
/// body over the cap sets `body_truncated` (the caller answers 413).
pub fn read_request(stream: &TcpStream, max_body: usize) -> Option<Request> {
    let mut reader = BufReader::new(stream.try_clone().ok()?).take(MAX_HEAD_BYTES);
    let mut line = String::new();
    // Request line (skip stray CRLFs between requests).
    loop {
        line.clear();
        let n = reader.read_line(&mut line).ok()?;
        if n == 0 {
            return None;
        }
        if line.trim_end_matches(['\r', '\n']).is_empty() {
            continue;
        }
        break;
    }
    let req_line = line.trim_end_matches(['\r', '\n']).to_string();
    let mut parts = req_line.split_whitespace();
    let method = parts.next()?.to_string();
    let target = parts.next().unwrap_or("/").to_string();
    let mut headers: HashMap<String, String> = HashMap::new();
    loop {
        line.clear();
        let n = reader.read_line(&mut line).ok()?;
        if n == 0 {
            return None;
        }
        let l = line.trim_end_matches(['\r', '\n']);
        if l.is_empty() {
            break;
        }
        if let Some(i) = l.find(':') {
            let name = l[..i].trim().to_ascii_lowercase();
            let value = l[i + 1..].trim().to_string();
            headers.entry(name).or_insert(value);
        }
    }
    // The head is done; the body has its own cap (`max_body`), so drop the
    // head budget and read the body from the underlying buffered stream.
    let mut reader = reader.into_inner();
    let mut body: Vec<u8> = Vec::new();
    let mut truncated = false;
    if let Some(len) = headers
        .get("content-length")
        .and_then(|v| v.trim().parse::<usize>().ok())
    {
        if len > max_body {
            truncated = true;
            // Drain what we can so the peer does not see a reset before the
            // response, then stop.
            let mut remaining = len;
            let mut buf = [0u8; 8192];
            let mut drained = 0usize;
            while remaining > 0 && drained < max_body + 65536 {
                let want = remaining.min(buf.len());
                match reader.read(&mut buf[..want]) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        remaining -= n;
                        drained += n;
                    }
                }
            }
        } else {
            body.resize(len, 0);
            let mut read = 0;
            while read < len {
                match reader.read(&mut body[read..]) {
                    Ok(0) => break,
                    Ok(n) => read += n,
                    Err(_) => break,
                }
            }
            body.truncate(read);
        }
    } else if headers
        .get("transfer-encoding")
        .map(|v| v.to_ascii_lowercase().contains("chunked"))
        .unwrap_or(false)
    {
        loop {
            line.clear();
            if reader.read_line(&mut line).ok()? == 0 {
                break;
            }
            let size_str = line.trim().split(';').next().unwrap_or("").trim();
            let size = usize::from_str_radix(size_str, 16).unwrap_or(0);
            if size == 0 {
                // trailer + final CRLF
                loop {
                    line.clear();
                    let n = reader.read_line(&mut line).unwrap_or(0);
                    if n == 0 || line.trim_end_matches(['\r', '\n']).is_empty() {
                        break;
                    }
                }
                break;
            }
            // The declared size comes straight off the wire: never allocate
            // it up front (a huge chunk-size line would OOM-abort the process
            // under panic=abort). Stream the chunk through a small buffer and
            // stop as soon as the body would exceed the cap. The comparison
            // must not add first: `body.len() + size` wraps when `size` is
            // near usize::MAX, which would bypass the cap entirely.
            if size > max_body.saturating_sub(body.len()) {
                truncated = true;
                break;
            }
            let mut remaining = size;
            let mut buf = [0u8; 8192];
            let mut eof = false;
            while remaining > 0 {
                let want = remaining.min(buf.len());
                match reader.read(&mut buf[..want]) {
                    Ok(0) | Err(_) => {
                        eof = true;
                        break;
                    }
                    Ok(n) => {
                        remaining -= n;
                        body.extend_from_slice(&buf[..n]);
                    }
                }
            }
            if eof {
                break;
            }
            line.clear();
            let _ = reader.read_line(&mut line);
        }
    }
    let (path, query) = parse_target(&target);
    Some(Request {
        method,
        target,
        path,
        query,
        headers,
        body,
        body_truncated: truncated,
    })
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        202 => "Accepted",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        409 => "Conflict",
        410 => "Gone",
        413 => "Payload Too Large",
        415 => "Unsupported Media Type",
        422 => "Unprocessable Entity",
        500 => "Internal Server Error",
        _ => "",
    }
}

/// A response under construction: status, headers (in insertion order), body.
pub struct Response {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Response {
    pub fn new(status: u16) -> Response {
        Response {
            status,
            headers: Vec::new(),
            body: Vec::new(),
        }
    }
    pub fn header(mut self, name: &str, value: &str) -> Response {
        self.headers.push((name.to_string(), value.to_string()));
        self
    }
    pub fn text(mut self, body: &str) -> Response {
        self.body = body.as_bytes().to_vec();
        self
    }
    pub fn bytes(mut self, body: Vec<u8>) -> Response {
        self.body = body;
        self
    }
    pub fn json(self, v: &serde_json::Value) -> Response {
        let s = serde_json::to_string(v).unwrap_or_else(|_| "null".into());
        self.header("Content-Type", "application/json").text(&s)
    }
}

/// Write a complete response and close the connection.
pub fn send_response(stream: &mut TcpStream, cors: &[(String, String)], res: &Response) {
    let mut head = format!("HTTP/1.1 {} {}\r\n", res.status, reason(res.status));
    for (k, v) in cors {
        head.push_str(&format!("{}: {}\r\n", k, v));
    }
    for (k, v) in &res.headers {
        head.push_str(&format!("{}: {}\r\n", k, v));
    }
    head.push_str(&format!("Content-Length: {}\r\n", res.body.len()));
    head.push_str("Connection: close\r\n\r\n");
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(&res.body);
    let _ = stream.flush();
    let _ = stream.shutdown(Shutdown::Write);
}

/// A long-lived response written incrementally (chunked transfer encoding).
pub struct StreamResponse {
    stream: TcpStream,
    open: bool,
}

impl StreamResponse {
    pub fn begin(
        mut stream: TcpStream,
        cors: &[(String, String)],
        status: u16,
        headers: &[(&str, &str)],
    ) -> StreamResponse {
        let mut head = format!("HTTP/1.1 {} {}\r\n", status, reason(status));
        for (k, v) in cors {
            head.push_str(&format!("{}: {}\r\n", k, v));
        }
        for (k, v) in headers {
            head.push_str(&format!("{}: {}\r\n", k, v));
        }
        head.push_str("Transfer-Encoding: chunked\r\n\r\n");
        let ok = stream.write_all(head.as_bytes()).is_ok() && stream.flush().is_ok();
        StreamResponse { stream, open: ok }
    }
    /// Write one chunk; false when the client is gone.
    pub fn write(&mut self, data: &[u8]) -> bool {
        if !self.open || data.is_empty() {
            return self.open;
        }
        let head = format!("{:x}\r\n", data.len());
        let ok = self.stream.write_all(head.as_bytes()).is_ok()
            && self.stream.write_all(data).is_ok()
            && self.stream.write_all(b"\r\n").is_ok()
            && self.stream.flush().is_ok();
        if !ok {
            self.open = false;
        }
        ok
    }
    pub fn end(&mut self) {
        if self.open {
            let _ = self.stream.write_all(b"0\r\n\r\n");
            let _ = self.stream.flush();
            self.open = false;
        }
        let _ = self.stream.shutdown(Shutdown::Both);
    }
    pub fn is_open(&self) -> bool {
        self.open
    }
}

/// Watch a connection for the peer closing it (Node's `req.on('close')`):
/// a reader thread blocks on the socket and calls `on_close` when the read
/// returns EOF or an error, unless `done` was set first (we closed it).
pub fn watch_close(
    stream: &TcpStream,
    done: Arc<AtomicBool>,
    on_close: impl FnOnce() + Send + 'static,
) {
    let Ok(mut clone) = stream.try_clone() else {
        return;
    };
    let _ = clone.set_read_timeout(None);
    std::thread::spawn(move || {
        let mut buf = [0u8; 64];
        loop {
            match clone.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(_) => continue,
            }
        }
        if !done.load(Ordering::SeqCst) {
            on_close();
        }
    });
}

/// Set a per-`read` timeout on the socket. This is `SO_RCVTIMEO`: it bounds a
/// single blocked `read`, not the whole connection, and any byte received
/// resets it. It is a coarse backstop only; the total lane-hold bound is
/// [`read_request_deadline`], not this.
pub fn set_header_timeout(stream: &TcpStream) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(60)));
}

/// Total wall-clock budget for reading one request (request line + headers +
/// body) from an accepted connection while it may still hold a place in the
/// turnstile lane.
///
/// [`set_header_timeout`] is per-`read` (`SO_RCVTIMEO`): any byte inside the
/// window resets it, so a slow-drip or silent peer keeps each `read` returning
/// `Ok(1)` (or blocking under the window) and `read_request` never returns,
/// pinning the connection's ticket and wedging every later mutation behind it.
/// This is one deadline across the whole read, enforced by a watchdog that
/// shuts the socket down when it elapses, turning that pre-auth lane-hold DoS
/// into a bounded, localhost-only stall (BLOCKER, triage D3). 10s is far more
/// than any legitimate local upload needs (the race test's ~4 KB over ~500 ms
/// finishes in a twentieth of it).
pub const READ_REQUEST_DEADLINE: Duration = Duration::from_secs(10);

/// Like [`read_request`] but bounded by a total wall-clock `deadline` across
/// the entire head+body read. A watchdog thread shuts the socket down if the
/// deadline elapses before the read finishes, so the blocked `read` returns and
/// `read_request` gives up (`None`, or a truncated body); the caller returns
/// and the ticket is released on `Drop`. A connection therefore cannot hold its
/// place in the lane past `deadline`, no matter how slowly (or never) it feeds
/// the socket.
pub fn read_request_deadline(
    stream: &TcpStream,
    max_body: usize,
    deadline: Duration,
) -> Option<Request> {
    let done = Arc::new(AtomicBool::new(false));
    let watch_stream = stream.try_clone().ok()?;
    let watch_done = done.clone();
    std::thread::spawn(move || {
        // Poll the done flag so a fast, normal read frees the watchdog promptly
        // instead of pinning a thread for the whole deadline.
        let step = Duration::from_millis(50);
        let mut waited = Duration::ZERO;
        while waited < deadline {
            if watch_done.load(Ordering::SeqCst) {
                return;
            }
            std::thread::sleep(step);
            waited += step;
        }
        if !watch_done.load(Ordering::SeqCst) {
            // Unblock any in-progress read so `read_request` returns; the
            // handler then drops its ticket and the connection closes.
            let _ = watch_stream.shutdown(Shutdown::Both);
        }
    });
    let req = read_request(stream, max_body);
    done.store(true, Ordering::SeqCst);
    req
}

/// Serializes state-mutating request handlers in body-completion order.
///
/// Node's `http` server is single-threaded: a `/events` handler reads its
/// body, and its state mutation runs inside the `end` callback, atomically,
/// before any other request's `end` callback. So the server that creates a
/// session (`generate`) and the checkpoint that references it
/// (`generate_started`) never interleave; the checkpoint sees a store the
/// `generate` before it already wrote. This server is thread-per-connection,
/// so without help two concurrent POSTs race on who reaches the state lock
/// first, and a checkpoint whose small body finishes fast can overtake the
/// `generate` that creates its session, which turns into `404
/// unknown_session`.
///
/// This is the single FIFO those mutations pass through. The accept loop
/// hands every connection a ticket, so tickets are ordered by arrival. A
/// handler reads and parses its FULL request first (that stays parallel);
/// only then, before it touches server state, does it call
/// [`Ticket::wait_turn`], which blocks until every earlier ticket has been
/// released. There is **no timeout**: a checkpoint waits for the earlier
/// `generate` however long that `generate`'s body takes to arrive, so the
/// ordering is deterministic regardless of connection speed. A ticket is
/// released when its handler finishes, when the connection is about to park
/// (SSE, long polls) or run something long, or when the connection dies
/// (`Drop`) without producing a request. So a handler only ever blocks on
/// earlier connections that are alive and still working.
///
/// The wait is unbounded on purpose (ordering must not give up), so on its own
/// a slow-drip or silent connection accepted first would pin its ticket inside
/// [`read_request`] and wedge every later mutation forever. That is prevented
/// upstream, not here: a connection reads its request under a total wall-clock
/// deadline ([`read_request_deadline`]), so a peer that never finishes its
/// request is force-dropped and releases its ticket within that bound. A hung
/// or abandoned upload can delay a later mutation by at most the deadline, and
/// only from localhost.
///
/// Read-only routes (`/status`, `/health`, `/design-system*`, `/source`,
/// `/live.js`, `/detect.js`, `/`) and long-lived routes (SSE, parked polls)
/// do not sit in this lane: they release their ticket up front (read-only)
/// or as soon as they have registered and are about to park (long-lived),
/// so a mutation never waits on a stream and a stream never holds the lane.
pub struct Turnstile {
    inner: std::sync::Mutex<TurnstileState>,
    cv: std::sync::Condvar,
}

struct TurnstileState {
    next: u64,
    /// Tickets issued but not yet released.
    outstanding: std::collections::BTreeSet<u64>,
}

impl Default for Turnstile {
    fn default() -> Self {
        Turnstile {
            inner: std::sync::Mutex::new(TurnstileState {
                next: 1,
                outstanding: std::collections::BTreeSet::new(),
            }),
            cv: std::sync::Condvar::new(),
        }
    }
}

impl Turnstile {
    fn state(&self) -> std::sync::MutexGuard<'_, TurnstileState> {
        match self.inner.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        }
    }

    /// Called by the accept loop, in accept order.
    pub fn issue(self: &Arc<Self>) -> Ticket {
        let mut st = self.state();
        let n = st.next;
        st.next += 1;
        st.outstanding.insert(n);
        Ticket {
            turnstile: self.clone(),
            n,
            released: false,
        }
    }

    /// Block until every earlier outstanding ticket is released. No timeout:
    /// ordering is by arrival and never gives up, so a later mutation cannot
    /// overtake an earlier one whose body is still arriving. An earlier
    /// connection that dies without producing a request releases its ticket
    /// on `Drop`, so this wait only ever tracks earlier connections that are
    /// alive and still working.
    fn wait_turn(&self, n: u64) {
        let mut st = self.state();
        loop {
            match st.outstanding.iter().next() {
                Some(&first) if first < n => {}
                _ => return,
            }
            st = match self.cv.wait(st) {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };
        }
    }

    fn release(&self, n: u64) {
        let mut st = self.state();
        if st.outstanding.remove(&n) {
            self.cv.notify_all();
        }
    }
}

/// One connection's place in the arrival order. Dropping it releases the
/// ticket, so a connection that never produces a request (EOF, timeout)
/// cannot hold later ones up: it leaves the lane the instant it dies.
pub struct Ticket {
    turnstile: Arc<Turnstile>,
    n: u64,
    released: bool,
}

impl Ticket {
    /// Wait for the connections accepted before this one to finish with
    /// server state. Call before the first state access of a handler; a
    /// no-op after `release`.
    pub fn wait_turn(&self) {
        if !self.released {
            self.turnstile.wait_turn(self.n);
        }
    }
    /// Let later connections proceed. Call before parking or before running
    /// anything long that does not need arrival ordering.
    pub fn release(&mut self) {
        if !self.released {
            self.released = true;
            self.turnstile.release(self.n);
        }
    }
}

impl Drop for Ticket {
    fn drop(&mut self) {
        self.release();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    /// Run `read_request` on a raw request written by a client thread.
    fn read_raw(raw: Vec<u8>, max_body: usize) -> Option<Request> {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("addr");
        let client = std::thread::spawn(move || {
            let mut s = TcpStream::connect(addr).expect("connect");
            let _ = s.write_all(&raw);
            let _ = s.flush();
            let _ = s.shutdown(Shutdown::Write);
            // Hold the read half open until the server is done.
            let mut sink = Vec::new();
            let _ = s.read_to_end(&mut sink);
        });
        let (stream, _) = listener.accept().expect("accept");
        set_header_timeout(&stream);
        let req = read_request(&stream, max_body);
        drop(stream);
        let _ = client.join();
        req
    }

    #[test]
    fn chunked_body_is_decoded() {
        let req = read_raw(
            b"POST /x HTTP/1.1\r\nHost: h\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n3\r\nabc\r\n0\r\n\r\n".to_vec(),
            1024 * 1024,
        )
        .expect("request");
        assert_eq!(req.body, b"helloabc");
        assert!(!req.body_truncated);
    }

    #[test]
    fn huge_declared_chunk_size_is_capped_not_allocated() {
        // A wire-supplied chunk size of ~256 TB must not be allocated up
        // front (under panic=abort that OOM would take the server down); the
        // request comes back truncated instead.
        let req = read_raw(
            b"POST /x HTTP/1.1\r\nHost: h\r\nTransfer-Encoding: chunked\r\n\r\nffffffffffff\r\nhi".to_vec(),
            1024 * 1024,
        )
        .expect("request");
        assert!(req.body_truncated);
    }

    #[test]
    fn chunk_size_near_usize_max_does_not_wrap_past_cap() {
        // After a 1-byte chunk, a declared size of usize::MAX made the old
        // `body.len() + size > max_body` guard wrap to 0 and pass, bypassing
        // the cap entirely. It must read as over-cap (truncated), not bypass.
        let req = read_raw(
            b"POST /x HTTP/1.1\r\nHost: h\r\nTransfer-Encoding: chunked\r\n\r\n1\r\na\r\nffffffffffffffff\r\nrest".to_vec(),
            1024 * 1024,
        )
        .expect("request");
        assert!(req.body_truncated);
        assert_eq!(req.body, b"a");
    }

    #[test]
    fn chunk_overflowing_cap_marks_truncated() {
        let req = read_raw(
            b"POST /x HTTP/1.1\r\nHost: h\r\nTransfer-Encoding: chunked\r\n\r\n4\r\nabcd\r\n4\r\nefgh\r\n0\r\n\r\n".to_vec(),
            6,
        )
        .expect("request");
        assert!(req.body_truncated);
        assert!(req.body.len() <= 6);
    }

    #[test]
    fn oversized_header_block_is_dropped() {
        // A head past MAX_HEAD_BYTES reads as EOF: the request is dropped
        // (connection closed) instead of accumulating headers unbounded.
        let mut raw = b"GET / HTTP/1.1\r\nHost: h\r\n".to_vec();
        raw.extend_from_slice(b"X-Big: ");
        raw.extend(std::iter::repeat(b'a').take(2 * MAX_HEAD_BYTES as usize));
        raw.extend_from_slice(b"\r\n\r\n");
        assert!(read_raw(raw, 1024 * 1024).is_none());
    }

    #[test]
    fn head_under_cap_with_body_still_parses() {
        // Sanity: the head budget must not eat into the body read.
        let req = read_raw(
            b"POST /x HTTP/1.1\r\nHost: h\r\nContent-Length: 5\r\n\r\nhello".to_vec(),
            1024 * 1024,
        )
        .expect("request");
        assert_eq!(req.body, b"hello");
        assert!(!req.body_truncated);
    }

    /// The generate/generate_started race, reproduced end to end over real
    /// sockets: a `generate` (accepted first) whose large body arrives in
    /// slow, delayed chunks, and a small `generate_started` checkpoint
    /// (accepted second) that reaches the server fast and races ahead.
    ///
    /// The checkpoint is the `unknown_session` gate: it must never run its
    /// store lookup before the `generate` that creates the session has run
    /// its insert, no matter how slowly the `generate` body dribbles in.
    /// Under the old 250 ms accept-order grace, a body slower than the grace
    /// let the checkpoint skip the still-arriving `generate` and observe an
    /// empty store (`unknown_session`); with the grace gone the checkpoint
    /// waits for the whole slow body. Looped so a flaky reorder would show.
    #[test]
    fn slow_generate_body_never_lets_checkpoint_see_unknown_session() {
        use std::collections::HashSet;
        use std::sync::mpsc;
        use std::sync::Mutex;

        let iters: usize = std::env::var("IMPECCABLE_RACE_ITERS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(10);

        for iter in 0..iters {
            let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
            let addr = listener.local_addr().expect("addr");
            let turnstile = Arc::new(Turnstile::default());
            // Stand-in for the session store: the ids `generate` has created.
            let store: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));
            // Server -> test: fires once the first connection is accepted, so
            // the test only connects the checkpoint after the generate holds
            // the earlier ticket (deterministic accept order).
            let (accepted_tx, accepted_rx) = mpsc::channel::<()>();
            // Checkpoint handler -> test: whether it saw the session.
            let (result_tx, result_rx) = mpsc::channel::<bool>();

            let srv_turnstile = turnstile.clone();
            let srv_store = store.clone();
            let server = std::thread::spawn(move || {
                let mut handlers = Vec::new();
                for i in 0..2 {
                    let (stream, _) = listener.accept().expect("accept");
                    let _ = stream.set_nonblocking(false);
                    // Ticket issued in accept order, exactly as the live
                    // server's accept loop does.
                    let ticket = srv_turnstile.issue();
                    if i == 0 {
                        let _ = accepted_tx.send(());
                    }
                    let store = srv_store.clone();
                    let result_tx = result_tx.clone();
                    handlers.push(std::thread::spawn(move || {
                        // Ticket lives for the whole handler; dropped at the
                        // end -> released, letting the next mutation proceed.
                        let ticket = ticket;
                        set_header_timeout(&stream);
                        let Some(req) = read_request(&stream, 1024 * 1024) else {
                            return;
                        };
                        // Full body is read; only now take the ordering turn.
                        ticket.wait_turn();
                        let msg: serde_json::Value =
                            serde_json::from_slice(&req.body).unwrap_or(serde_json::Value::Null);
                        let ty = msg.get("type").and_then(|v| v.as_str()).unwrap_or("");
                        let id = msg
                            .get("id")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        if ty == "generate" {
                            store.lock().unwrap().insert(id);
                        } else {
                            let known = store.lock().unwrap().contains(&id);
                            let _ = result_tx.send(known);
                        }
                    }));
                }
                for h in handlers {
                    let _ = h.join();
                }
            });

            let sid = format!("sess-{iter}");
            // The generate body is large; dribble it in chunks with sleeps so
            // it takes ~300 ms to finish arriving (well past the old grace).
            let gen_body = serde_json::json!({
                "type": "generate",
                "id": sid,
                "pad": "x".repeat(4000),
            })
            .to_string();
            let gen_head = format!(
                "POST /events HTTP/1.1\r\nHost: h\r\nContent-Length: {}\r\n\r\n",
                gen_body.len()
            );

            let mut gen = TcpStream::connect(addr).expect("connect generate");
            gen.set_nodelay(true).ok();
            gen.write_all(gen_head.as_bytes()).expect("write gen head");
            gen.flush().ok();
            // Block until the server has accepted the generate connection, so
            // the checkpoint that follows is guaranteed the later ticket.
            accepted_rx.recv().expect("generate accepted");

            let gen_writer = std::thread::spawn(move || {
                let bytes = gen_body.into_bytes();
                // Six chunks with 100 ms gaps: the body finishes arriving
                // ~500 ms after it starts, well past the old 250 ms grace, so
                // a checkpoint that gave up on the grace would beat the insert.
                for chunk in bytes.chunks(bytes.len() / 6 + 1) {
                    if gen.write_all(chunk).is_err() {
                        break;
                    }
                    let _ = gen.flush();
                    std::thread::sleep(Duration::from_millis(100));
                }
                // Hold the connection open until the server is done reading.
                let mut sink = Vec::new();
                let _ = gen.read_to_end(&mut sink);
            });

            // The checkpoint: small, sent complete and fast, right away.
            let cp_body = serde_json::json!({
                "type": "checkpoint",
                "id": sid,
                "reason": "generate_started",
            })
            .to_string();
            let cp_raw = format!(
                "POST /events HTTP/1.1\r\nHost: h\r\nContent-Length: {}\r\n\r\n{}",
                cp_body.len(),
                cp_body
            );
            let mut cp = TcpStream::connect(addr).expect("connect checkpoint");
            cp.set_nodelay(true).ok();
            cp.write_all(cp_raw.as_bytes()).expect("write checkpoint");
            cp.flush().ok();

            let known = result_rx
                .recv_timeout(Duration::from_secs(10))
                .expect("checkpoint handler ran");
            assert!(
                known,
                "iteration {iter}: checkpoint observed unknown_session; \
                 the slow generate body was overtaken (ordering broke)",
            );

            let mut sink = Vec::new();
            let _ = cp.read_to_end(&mut sink);
            let _ = gen_writer.join();
            let _ = server.join();
        }
    }

    /// The Fable BLOCKER, reproduced at the lane level: a connection accepted
    /// first that takes a ticket and then goes silent must not wedge a later
    /// state-mutating request beyond the read deadline.
    ///
    /// The silent connection sends a partial head and never finishes, so its
    /// handler blocks inside `read_request`. Under the plain per-`read` timeout
    /// it held its ticket for the whole (up to 60s) window and every later
    /// mutation waited on it with `wait_turn`'s NO-timeout condvar. With
    /// `read_request_deadline` the silent connection is force-dropped at the
    /// total deadline and drops its ticket, so the later request takes its turn
    /// within the bound. Reverting to a deadline-less read makes this hang and
    /// the timed `recv` below fail, so it stays a distinguishing test.
    #[test]
    fn silent_connection_holding_ticket_does_not_wedge_later_events_beyond_deadline() {
        use std::sync::mpsc;

        // Short in-test deadline keeps the test fast; production uses
        // READ_REQUEST_DEADLINE (10s).
        let deadline = Duration::from_millis(400);

        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("addr");
        let turnstile = Arc::new(Turnstile::default());
        // Server -> test: the first connection has been accepted (and holds the
        // lower ticket), so the later request is guaranteed the higher ticket.
        let (accepted_tx, accepted_rx) = mpsc::channel::<()>();
        // Later handler -> test: it took its turn and ran.
        let (ran_tx, ran_rx) = mpsc::channel::<()>();

        let srv_turnstile = turnstile.clone();
        let server = std::thread::spawn(move || {
            let mut handlers = Vec::new();
            for i in 0..2 {
                let (stream, _) = listener.accept().expect("accept");
                let _ = stream.set_nonblocking(false);
                // Ticket issued in accept order, as the live accept loop does.
                let ticket = srv_turnstile.issue();
                if i == 0 {
                    let _ = accepted_tx.send(());
                }
                let ran_tx = ran_tx.clone();
                handlers.push(std::thread::spawn(move || {
                    let ticket = ticket;
                    set_header_timeout(&stream);
                    // The silent connection (i == 0) reads nothing complete and
                    // returns None at the deadline, dropping its ticket. The
                    // later one reads a full request, then takes its turn.
                    if read_request_deadline(&stream, 1024 * 1024, deadline).is_some() {
                        ticket.wait_turn();
                        let _ = ran_tx.send(());
                    }
                }));
            }
            for h in handlers {
                let _ = h.join();
            }
        });

        // Connection A (accepted first, lower ticket): a partial head, then
        // silence. Kept open until the assertion so its ticket can only be
        // released by the deadline, not by an early peer close.
        let mut silent = TcpStream::connect(addr).expect("connect silent");
        silent.set_nodelay(true).ok();
        silent
            .write_all(b"POST /events HTTP/1.1\r\nHost: h\r\n")
            .expect("write partial head");
        silent.flush().ok();
        accepted_rx.recv().expect("silent connection accepted");

        // Connection B (accepted second, higher ticket): a complete request
        // that must take its turn once the silent ticket is released.
        let body = "{\"type\":\"checkpoint\"}";
        let raw = format!(
            "POST /events HTTP/1.1\r\nHost: h\r\nContent-Length: {}\r\n\r\n{}",
            body.len(),
            body
        );
        let mut later = TcpStream::connect(addr).expect("connect later");
        later.set_nodelay(true).ok();
        later.write_all(raw.as_bytes()).expect("write later");
        later.flush().ok();

        // Must run within a small multiple of the deadline. Before the fix the
        // silent ticket was held for the whole read window and this never
        // arrived; generous slack absorbs CI scheduling.
        ran_rx.recv_timeout(deadline * 6).expect(
            "later /events was wedged behind a silent connection past the read deadline",
        );

        drop(silent);
        drop(later);
        let _ = server.join();
    }
}
