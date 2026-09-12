//! Find the dev server that is serving this app right now: the page that
//! carries our injected `live.js?token=<token>` tag is ours, whatever port
//! it answers on. Saves the agent a terminal-reading detour before it can
//! open the page.

use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

/// Ports worth a knock when nothing narrows the search: Vite, Next, Astro,
/// SvelteKit, Nuxt, CRA, Angular, and the usual static servers.
const DEFAULT_PORTS: &[u16] = &[5173, 3000, 4321, 8080, 4173, 3001, 5174, 8000, 4200, 5000, 1234];

/// Candidate origins, in probe order. `IMPECCABLE_DEV_URL_CANDIDATES`
/// (comma-separated) replaces the default list, for tests and unusual hosts.
pub fn candidates(env_override: Option<&str>) -> Vec<String> {
    if let Some(list) = env_override {
        return list
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.trim_end_matches('/').to_string() + "/")
            .collect();
    }
    let mut out = Vec::new();
    for port in DEFAULT_PORTS {
        out.push(format!("http://127.0.0.1:{}/", port));
        out.push(format!("http://localhost:{}/", port));
    }
    out
}

/// The first candidate whose document contains our tag, probed in parallel
/// with short timeouts so a full miss costs well under a second.
pub fn probe(candidates: &[String], token: &str) -> Option<String> {
    let needle = format!("live.js?token={}", token);
    let hits: Vec<Option<String>> = std::thread::scope(|scope| {
        let handles: Vec<_> = candidates
            .iter()
            .map(|url| {
                let needle = needle.clone();
                scope.spawn(move || fetch_root(url).filter(|body| body.contains(&needle)).map(|_| url.clone()))
            })
            .collect();
        handles.into_iter().map(|h| h.join().unwrap_or(None)).collect()
    });
    hits.into_iter().flatten().next()
}

/// A minimal HTTP/1.0 GET of `/`; returns the response body on any 2xx.
fn fetch_root(url: &str) -> Option<String> {
    let rest = url.strip_prefix("http://")?;
    let host_port = rest.split('/').next()?;
    let (host, port) = match host_port.rsplit_once(':') {
        Some((h, p)) => (h, p.parse::<u16>().ok()?),
        None => (host_port, 80),
    };
    let addr = (host, port).to_socket_addrs().ok()?.next()?;
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_millis(300)).ok()?;
    stream.set_read_timeout(Some(Duration::from_millis(1500))).ok()?;
    stream.set_write_timeout(Some(Duration::from_millis(300))).ok()?;
    stream
        .write_all(format!("GET / HTTP/1.0\r\nHost: {}\r\nConnection: close\r\n\r\n", host_port).as_bytes())
        .ok()?;
    let mut raw = Vec::new();
    let mut buf = [0u8; 8192];
    while raw.len() < 512 * 1024 {
        match stream.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => raw.extend_from_slice(&buf[..n]),
            Err(_) => break,
        }
    }
    let text = String::from_utf8_lossy(&raw).into_owned();
    let status_ok = text
        .lines()
        .next()
        .map(|l| l.split_whitespace().nth(1).map(|c| c.starts_with('2')).unwrap_or(false))
        .unwrap_or(false);
    if !status_ok {
        return None;
    }
    Some(text.split_once("\r\n\r\n").map(|(_, b)| b.to_string()).unwrap_or(text))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    fn serve_once(body: &'static str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for _ in 0..2 {
                if let Ok((mut s, _)) = listener.accept() {
                    let mut buf = [0u8; 1024];
                    let _ = s.read(&mut buf);
                    let _ = s.write_all(
                        format!("HTTP/1.0 200 OK\r\nContent-Type: text/html\r\n\r\n{}", body).as_bytes(),
                    );
                }
            }
        });
        format!("http://127.0.0.1:{}/", port)
    }

    #[test]
    fn finds_the_origin_that_serves_our_tag() {
        let ours = serve_once("<html><script src=\"http://localhost:8400/live.js?token=abc-123\"></script></html>");
        let theirs = serve_once("<html><script src=\"http://localhost:8400/live.js?token=other\"></script></html>");
        let dead = "http://127.0.0.1:1/".to_string();
        let found = probe(&[dead, theirs.clone(), ours.clone()], "abc-123");
        assert_eq!(found.as_deref(), Some(ours.as_str()));
        assert_eq!(probe(&[theirs], "abc-123"), None);
    }

    #[test]
    fn env_override_replaces_the_default_list() {
        let c = candidates(Some("http://localhost:9999, http://127.0.0.1:7777/"));
        assert_eq!(c, vec!["http://localhost:9999/".to_string(), "http://127.0.0.1:7777/".to_string()]);
        assert!(candidates(None).iter().any(|u| u == "http://127.0.0.1:5173/"));
    }
}
