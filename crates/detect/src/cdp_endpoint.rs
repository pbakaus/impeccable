//! `impeccable detect --cdp <port|url>`: the DevTools endpoint of a running
//! Chromium-based app (Electron, NW.js, CEF, WebView2) to attach to.
//!
//! Parsed here, in the crate that owns the flag, so a bad value is refused
//! before any engine runs. Only loopback hosts are accepted: a DevTools port
//! hands whoever reaches it full control of the app, so the scan never asks
//! another machine for one.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

/// Where to attach.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CdpEndpoint {
    /// The host as it is dialled: `127.0.0.1`, `localhost`, `::1`, or another
    /// loopback address. Never bracketed.
    pub host: String,
    pub port: u16,
    /// The browser websocket path (`/devtools/browser/<id>`) when the value
    /// was that `ws://` URL; otherwise `/json/version` supplies it.
    pub browser_path: Option<String>,
    /// The target id when the value was a page's `ws://` URL
    /// (`/devtools/page/<id>`), which picks that page.
    pub page_id: Option<String>,
}

impl CdpEndpoint {
    /// `host:port`, bracketing an IPv6 host.
    pub fn authority(&self) -> String {
        if self.host.contains(':') {
            format!("[{}]:{}", self.host, self.port)
        } else {
            format!("{}:{}", self.host, self.port)
        }
    }
}

/// The error for a missing or unusable `--cdp` value.
pub const CDP_VALUE_ERROR: &str =
    "Error: --cdp requires a DevTools port or URL, e.g. --cdp 9222 or --cdp ws://127.0.0.1:9222/devtools/browser/<id>\n";

/// Parse a `--cdp` value: a port (`9222`), `host:port`, `http://host:port`,
/// or a DevTools websocket URL (`ws://host:port/devtools/browser/<id>` or
/// `.../devtools/page/<id>`). The host must be loopback. The error is the
/// line the CLI prints.
pub fn parse_cdp_endpoint(value: &str) -> Result<CdpEndpoint, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(CDP_VALUE_ERROR.to_string());
    }
    if value.bytes().all(|b| b.is_ascii_digit()) {
        let port = parse_port(value)?;
        return Ok(CdpEndpoint { host: "127.0.0.1".into(), port, browser_path: None, page_id: None });
    }
    let lower = value.to_ascii_lowercase();
    let (rest, websocket) = if let Some(r) = strip_prefix_ci(value, &lower, "ws://") {
        (r, true)
    } else if let Some(r) = strip_prefix_ci(value, &lower, "http://") {
        (r, false)
    } else if lower.contains("://") {
        return Err(format!(
            "Error: --cdp takes a port, host:port, http:// or ws:// URL; got {value}\n"
        ));
    } else {
        (value, false)
    };
    let (authority, path) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, ""),
    };
    let (host, port) = split_authority(authority).ok_or_else(|| CDP_VALUE_ERROR.to_string())?;
    if !is_loopback_host(&host) {
        return Err(format!(
            "Error: --cdp only attaches to a DevTools port on this machine (127.0.0.1, localhost or [::1]), not {host}\n"
        ));
    }
    let port = parse_port(&port)?;
    let mut endpoint = CdpEndpoint { host, port, browser_path: None, page_id: None };
    let path = path.split(['?', '#']).next().unwrap_or("");
    if path.is_empty() || path == "/" {
        return Ok(endpoint);
    }
    if websocket {
        if let Some(id) = path.strip_prefix("/devtools/page/").filter(|id| valid_id(id)) {
            endpoint.page_id = Some(id.to_string());
            return Ok(endpoint);
        }
        if path.strip_prefix("/devtools/browser/").is_some_and(valid_id) {
            endpoint.browser_path = Some(path.to_string());
            return Ok(endpoint);
        }
    }
    Err(format!(
        "Error: --cdp expects a DevTools port or a ws://.../devtools/browser/<id> or .../devtools/page/<id> URL; got {value}\n"
    ))
}

fn strip_prefix_ci<'a>(value: &'a str, lower: &str, prefix: &str) -> Option<&'a str> {
    lower.starts_with(prefix).then(|| &value[prefix.len()..])
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn parse_port(s: &str) -> Result<u16, String> {
    match s.parse::<u32>() {
        Ok(p) if (1..=65535).contains(&p) => Ok(p as u16),
        _ => Err(format!("Error: --cdp port must be between 1 and 65535; got {s}\n")),
    }
}

/// `host:port`, `[v6]:port`. A missing port is not an endpoint.
fn split_authority(authority: &str) -> Option<(String, String)> {
    if let Some(rest) = authority.strip_prefix('[') {
        let end = rest.find(']')?;
        let host = &rest[..end];
        let port = rest[end + 1..].strip_prefix(':')?;
        return Some((host.to_string(), port.to_string()));
    }
    let (host, port) = authority.rsplit_once(':')?;
    if host.is_empty() || host.contains(':') {
        return None;
    }
    Some((host.to_string(), port.to_string()))
}

/// `localhost`, or a loopback IPv4 or IPv6 address.
pub fn is_loopback_host(host: &str) -> bool {
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    if let Ok(v4) = host.parse::<Ipv4Addr>() {
        return v4.is_loopback();
    }
    if let Ok(v6) = host.parse::<Ipv6Addr>() {
        return IpAddr::V6(v6).is_loopback()
            || v6.to_ipv4_mapped().is_some_and(|v4| v4.is_loopback());
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(v: &str) -> CdpEndpoint {
        parse_cdp_endpoint(v).unwrap_or_else(|e| panic!("{v}: {e}"))
    }

    #[test]
    fn ports_and_hosts() {
        assert_eq!(ok("9222"), CdpEndpoint { host: "127.0.0.1".into(), port: 9222, browser_path: None, page_id: None });
        assert_eq!(ok("localhost:9333").authority(), "localhost:9333");
        assert_eq!(ok("http://127.0.0.1:9222/").authority(), "127.0.0.1:9222");
        assert_eq!(ok("127.1.2.3:9222").host, "127.1.2.3");
        let v6 = ok("[::1]:9222");
        assert_eq!((v6.host.as_str(), v6.authority()), ("::1", "[::1]:9222".to_string()));
    }

    #[test]
    fn websocket_urls_name_the_browser_or_a_page() {
        let b = ok("ws://127.0.0.1:9222/devtools/browser/0b5c-77");
        assert_eq!(b.browser_path.as_deref(), Some("/devtools/browser/0b5c-77"));
        assert_eq!(b.page_id, None);
        let p = ok("ws://localhost:9222/devtools/page/ABCDEF0123");
        assert_eq!(p.page_id.as_deref(), Some("ABCDEF0123"));
    }

    #[test]
    fn refuses_other_machines_and_shapes() {
        for (v, needle) in [
            ("10.0.0.5:9222", "not 10.0.0.5"),
            ("ws://example.com:9222/devtools/browser/x", "not example.com"),
            ("0.0.0.0:9222", "not 0.0.0.0"),
            ("[2001:db8::1]:9222", "not 2001:db8::1"),
            ("", "requires a DevTools port"),
            ("localhost", "requires a DevTools port"),
            ("0", "between 1 and 65535"),
            ("70000", "between 1 and 65535"),
            ("https://127.0.0.1:9222", "takes a port"),
            ("ws://127.0.0.1:9222/json", "expects a DevTools port"),
            ("ws://127.0.0.1:9222/devtools/page/", "expects a DevTools port"),
        ] {
            let err = parse_cdp_endpoint(v).expect_err(v);
            assert!(err.contains(needle), "{v}: {err}");
            assert!(err.starts_with("Error: ") && err.ends_with('\n'), "{err}");
        }
    }
}
