//! One TLS trust configuration for every HTTPS request the engine makes.
//!
//! `ureq`'s default rustls config trusts only the Mozilla roots compiled in
//! through `webpki-roots`. On a machine where an endpoint security agent
//! inspects TLS (Aikido, Zscaler, Netskope: routine in managed corporate
//! setups), every connection terminates at a proxy whose root lives in the
//! OS trust store and nowhere else, so `update` and `install` failed with
//! `invalid peer certificate: UnknownIssuer` while curl and npm on the same
//! machine succeeded (#757).
//!
//! The store built here is the union of the OS trust store
//! (`rustls-native-certs`: the macOS Keychain, the Windows store, the
//! OpenSSL paths on Linux) and the bundled Mozilla roots. A union, not a
//! replacement: a container without `ca-certificates`, or a store that
//! fails to load, verifies against the bundled roots exactly as before.
//! `SSL_CERT_FILE` / `SSL_CERT_DIR` stand in for the OS store, as they do
//! for OpenSSL and curl; the bundled roots stay either way.
//!
//! The shared agent builder also honors `ALL_PROXY`, `HTTPS_PROXY`, and
//! `HTTP_PROXY` (and their lowercase forms) so `update` and `install` work
//! behind a corporate proxy (#823), and `NO_PROXY`, which ureq 2 ignores,
//! per request. Live-mode localhost HTTP does not use
//! this builder. The `socks-proxy` feature is enabled because ureq 2.x
//! prefers `ALL_PROXY`, which is often `socks5://`. We opt in on this
//! builder only, not globally via ureq's `proxy-from-env` feature.

use std::sync::Arc;

#[cfg(test)]
pub(crate) static PROXY_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

use once_cell::sync::Lazy;
use ureq::rustls::pki_types::CertificateDer;
use ureq::rustls::{self, ClientConfig, RootCertStore};

/// `ureq::AgentBuilder::new()` with the engine's trust store installed and
/// env proxy vars honored. Every HTTPS call site builds its agent from this;
/// the plain-HTTP calls to the live server on localhost do not use it.
///
/// `url` is the request the agent is for: ureq 2 never reads `NO_PROXY`, so
/// the builder leaves the proxy off when that host matches it, and always for
/// loopback (a proxy cannot reach this machine's localhost; Go's net/http
/// skips it the same way). Behind a proxy with `NO_PROXY=127.0.0.1`, a local
/// image endpoint otherwise got the proxy's 403.
pub fn agent_builder(url: &str) -> ureq::AgentBuilder {
    let builder = ureq::AgentBuilder::new().tls_config(tls_config());
    if bypasses_proxy(url, &no_proxy_from_env()) {
        builder
    } else {
        builder.try_proxy_from_env(true)
    }
}

/// GET `url`, following up to `max_redirects` redirects itself so every hop
/// gets an agent built for its own host: ureq follows a redirect on the agent
/// it started with, which keeps the first host's proxy choice for a hop that
/// may need the other one. Like ureq, a redirect from https to http is not
/// followed; that response, or the last 3xx when the hops run out, is
/// returned for the caller to treat as the failure it is.
pub fn get_following(
    url: &str,
    max_redirects: u32,
    configure: impl Fn(ureq::AgentBuilder) -> ureq::AgentBuilder,
) -> Result<ureq::Response, ureq::Error> {
    let mut current = url.to_string();
    let mut hops = 0;
    loop {
        let agent = configure(agent_builder(&current)).redirects(0).build();
        let response = agent.get(&current).call()?;
        if !(300..400).contains(&response.status()) || hops >= max_redirects {
            return Ok(response);
        }
        let Some(next) = response
            .header("location")
            .and_then(|loc| url::Url::parse(&current).ok()?.join(loc).ok())
        else {
            return Ok(response);
        };
        let was_https = url::Url::parse(&current).map(|u| u.scheme() == "https").unwrap_or(false);
        if was_https && next.scheme() != "https" {
            return Ok(response);
        }
        current = next.to_string();
        hops += 1;
    }
}

fn no_proxy_from_env() -> String {
    ["NO_PROXY", "no_proxy"]
        .iter()
        .find_map(|key| std::env::var(key).ok().filter(|v| !v.trim().is_empty()))
        .unwrap_or_default()
}

/// Whether a request to `url` goes direct under `no_proxy`, read as curl
/// reads it: comma-separated entries; `*` matches every host; a domain
/// (with or without a leading `.` or `*.`) matches itself and its
/// subdomains; an IP or a CIDR range matches an IP host; `host:port`
/// matches that port only; case does not matter.
pub(crate) fn bypasses_proxy(url: &str, no_proxy: &str) -> bool {
    let Some((host, port)) = host_and_port(url) else { return false };
    let ip = host.parse::<std::net::IpAddr>().ok();
    if host == "localhost" || host.ends_with(".localhost") || ip.is_some_and(|ip| ip.is_loopback()) {
        return true;
    }
    no_proxy.split(',').map(|e| e.trim().to_ascii_lowercase()).filter(|e| !e.is_empty()).any(|entry| {
        if entry == "*" {
            return true;
        }
        if let Some((net, bits)) = entry.split_once('/') {
            return matches!((ip, net.parse::<std::net::IpAddr>(), bits.parse::<u32>()), (Some(ip), Ok(net), Ok(bits)) if in_cidr(ip, net, bits));
        }
        let (name, entry_port) = split_port(&entry);
        if entry_port.is_some_and(|p| p != port) {
            return false;
        }
        // An address entry matches the same address in any spelling
        // (`fd00::5` is `fd00:0:0:0:0:0:0:5`); only names match by suffix.
        if let Ok(entry_ip) = name.parse::<std::net::IpAddr>() {
            return ip == Some(entry_ip);
        }
        // Names match by suffix, and only a host name: an address host is
        // matched by address and CIDR entries alone, as curl and Go do.
        if ip.is_some() {
            return false;
        }
        let name = name.trim_start_matches("*.").trim_start_matches('.').trim_end_matches('.');
        !name.is_empty() && (host == name || host.ends_with(&format!(".{name}")))
    })
}

/// The lowercased host (brackets stripped) and the port, defaulted by scheme.
fn host_and_port(url: &str) -> Option<(String, u16)> {
    let (scheme, rest) = url.split_once("://")?;
    let authority = rest.split(['/', '?', '#']).next()?;
    let authority = authority.rsplit_once('@').map_or(authority, |(_, a)| a);
    let default = match scheme.to_ascii_lowercase().as_str() {
        "https" => 443,
        "http" => 80,
        _ => return None,
    };
    let (host, port) = split_port(authority);
    // `localhost.` is the absolute form of `localhost`: drop the final dot.
    let host = host.trim_start_matches('[').trim_end_matches(']').trim_end_matches('.').to_ascii_lowercase();
    (!host.is_empty()).then(|| (host, port.unwrap_or(default)))
}

/// `name:port`, `[v6]:port`, or a bare name or address. A bare IPv6
/// address (more than one colon, no brackets) has no port.
fn split_port(s: &str) -> (&str, Option<u16>) {
    if let Some(rest) = s.strip_prefix('[') {
        if let Some((addr, tail)) = rest.split_once(']') {
            return (addr, tail.strip_prefix(':').and_then(|p| p.parse().ok()));
        }
    }
    match s.rsplit_once(':') {
        Some((name, port)) if !name.contains(':') => match port.parse() {
            Ok(p) => (name, Some(p)),
            Err(_) => (s, None),
        },
        _ => (s, None),
    }
}

fn in_cidr(ip: std::net::IpAddr, net: std::net::IpAddr, bits: u32) -> bool {
    use std::net::IpAddr::{V4, V6};
    let (a, b, width) = match (ip, net) {
        (V4(a), V4(b)) => (u128::from(u32::from(a)), u128::from(u32::from(b)), 32),
        (V6(a), V6(b)) => (u128::from(a), u128::from(b), 128),
        _ => return false,
    };
    if bits > width {
        return false;
    }
    let shift = width - bits;
    shift >= 128 || (a >> shift) == (b >> shift)
}

fn tls_config() -> Arc<ClientConfig> {
    static CONFIG: Lazy<Arc<ClientConfig>> = Lazy::new(|| {
        // Mirrors ureq's own default config (provider and protocol versions);
        // only the root store differs.
        let config =
            ClientConfig::builder_with_provider(rustls::crypto::ring::default_provider().into())
                .with_protocol_versions(&[&rustls::version::TLS12, &rustls::version::TLS13])
                .expect("the ring provider supports TLS 1.2 and 1.3")
                .with_root_certificates(root_store(rustls_native_certs::load_native_certs().certs))
                .with_no_client_auth();
        Arc::new(config)
    });
    CONFIG.clone()
}

/// The bundled Mozilla roots plus every parsable certificate in `native`.
/// Unparsable entries are dropped, so one broken certificate in the OS
/// store cannot take the bundled roots down with it.
fn root_store(native: Vec<CertificateDer<'static>>) -> RootCertStore {
    let mut store = RootCertStore {
        roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
    };
    store.add_parsable_certificates(native);
    store
}

#[cfg(test)]
mod tests {
    use super::*;
    use ureq::rustls::pki_types::pem::PemObject;

    /// Self-signed CA minted for this test (P-256, v3, CA:TRUE): the shape
    /// of the root a TLS-inspecting proxy installs into the OS store.
    const PROXY_ROOT_PEM: &str = "-----BEGIN CERTIFICATE-----
MIIBdTCCARugAwIBAgIJANhTZvQvv7HJMAoGCCqGSM49BAMCMB0xGzAZBgNVBAMM
EmltcGVjY2FibGUgdGVzdCBDQTAgFw0yNjA5MDcwNjQxMjdaGA8yMTI2MDgxNDA2
NDEyN1owHTEbMBkGA1UEAwwSaW1wZWNjYWJsZSB0ZXN0IENBMFkwEwYHKoZIzj0C
AQYIKoZIzj0DAQcDQgAEYVZtCOXaZsY71/0Roy62iBVcyx8UfMDkPbEbf/IEw5Bm
yNBfKTFS/8FbRBMWHXOwNE0Ns1BLVOB1oQ1XFC5Bz6NCMEAwDwYDVR0TAQH/BAUw
AwEB/zAOBgNVHQ8BAf8EBAMCAQYwHQYDVR0OBBYEFFONzBxi7ewOfuP6cBIIqsxu
3pEiMAoGCCqGSM49BAMCA0gAMEUCIQD98Q0ZRe8ceuopnUwQKYleZd5IzfWhhpmO
tB0WGTOG3QIgdJa8gBPU9Y6WsrursItsnUeGTYHKDCZZ6MjlekLFuoc=
-----END CERTIFICATE-----
";

    fn bundled() -> usize {
        webpki_roots::TLS_SERVER_ROOTS.len()
    }

    #[test]
    fn bundled_roots_alone_when_the_os_store_is_empty() {
        assert_eq!(root_store(Vec::new()).len(), bundled());
    }

    #[test]
    fn os_store_root_joins_the_bundled_roots() {
        let proxy = CertificateDer::from_pem_slice(PROXY_ROOT_PEM.as_bytes()).unwrap();
        assert_eq!(root_store(vec![proxy]).len(), bundled() + 1);
    }

    #[test]
    fn unparsable_os_store_entry_is_dropped() {
        let junk = CertificateDer::from(b"not a certificate".to_vec());
        assert_eq!(root_store(vec![junk]).len(), bundled());
    }

    #[test]
    fn agent_builds_from_this_hosts_store() {
        // Runs the real rustls-native-certs load: it must not panic, and the
        // shared config must be accepted by a ureq agent.
        let _lock = PROXY_ENV_LOCK.lock().unwrap();
        let _agent = agent_builder("https://impeccable.style/").build();
    }

    struct ProxyEnvGuard {
        saved: Vec<(String, Option<String>)>,
    }

    impl ProxyEnvGuard {
        fn set(vars: &[(&str, Option<&str>)]) -> Self {
            let saved = vars
                .iter()
                .map(|(key, _)| (key.to_string(), std::env::var(key).ok()))
                .collect();
            for (key, value) in vars {
                match value {
                    // SAFETY: PROXY_ENV_LOCK serializes every test that
                    // reads or writes these process-global proxy vars.
                    Some(v) => unsafe { std::env::set_var(key, v) },
                    None => unsafe { std::env::remove_var(key) },
                }
            }
            Self { saved }
        }
    }

    impl Drop for ProxyEnvGuard {
        fn drop(&mut self) {
            for (key, value) in &self.saved {
                match value {
                    // SAFETY: same lock as set(); restore before unlock.
                    Some(v) => unsafe { std::env::set_var(key, v) },
                    None => unsafe { std::env::remove_var(key) },
                }
            }
        }
    }

    fn accept_until(
        listener: std::net::TcpListener,
        mut handle: impl FnMut(&mut std::net::TcpStream) -> bool,
    ) {
        use std::time::Duration;
        listener
            .set_nonblocking(true)
            .expect("nonblocking proxy listener");
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while std::time::Instant::now() < deadline {
            let Ok((mut stream, _)) = listener.accept() else {
                std::thread::sleep(Duration::from_millis(10));
                continue;
            };
            let _ = stream.set_nonblocking(false);
            let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(2)));
            let _ = stream.set_write_timeout(Some(std::time::Duration::from_secs(2)));
            if handle(&mut stream) {
                return;
            }
        }
    }

    #[test]
    fn no_proxy_matches_like_curl() {
        let cases: &[(&str, &str, bool)] = &[
            ("http://127.0.0.1:8790/openai/v1", "", true), // loopback never goes through a proxy
            ("http://localhost:3000/", "", true),
            ("http://[::1]:8080/", "", true),
            ("http://app.localhost/", "", true),
            ("http://localhost.:8790/v1", "", true),
            ("http://gpu.lan.:9000/", "gpu.lan", true),
            ("http://gpu.lan:9000/", "gpu.lan.", true),
            ("https://api.openai.com/v1", "", false),
            ("https://api.openai.com/v1", "*", true),
            ("https://api.openai.com/v1", "openai.com", true),
            ("https://api.openai.com/v1", ".openai.com", true),
            ("https://api.openai.com/v1", "*.openai.com", true),
            ("https://openai.com/", ".openai.com", true),
            ("https://notopenai.com/", "openai.com", false),
            ("https://API.OpenAI.com/", "api.openai.com", true),
            ("http://10.1.2.3:9000/", "10.0.0.0/8", true),
            ("http://11.1.2.3:9000/", "10.0.0.0/8", false),
            ("http://10.1.2.3:9000/", "10.1.2.3", true),
            ("http://gpu.lan:9000/", "gpu.lan:9000", true),
            ("http://gpu.lan:9001/", "gpu.lan:9000", false),
            ("https://gpu.lan/", "gpu.lan:443", true),
            ("http://user:pw@gpu.lan:9000/x", " foo.com , gpu.lan ", true),
            ("http://[fd00::5]:80/", "fd00::/8", true),
            ("http://[fd00:0:0:0:0:0:0:5]/", "fd00::5", true),
            ("http://[fd00::6]/", "fd00::5", false),
            ("http://10.1.2.30/", "10.1.2.3", false),
            ("http://10.1.2.3/", "2.3", false),
            ("http://10.1.2.3/", ".3", false),
            ("not a url", "*", false),
        ];
        for (url, no_proxy, want) in cases {
            assert_eq!(bypasses_proxy(url, no_proxy), *want, "{url} with NO_PROXY={no_proxy:?}");
        }
    }

    #[test]
    fn agent_skips_the_proxy_for_no_proxy_hosts() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        use std::time::Duration;

        let _lock = PROXY_ENV_LOCK.lock().unwrap();

        // A proxy that refuses everything, as a sandbox or corporate proxy
        // refuses a loopback destination it cannot reach.
        let proxy = TcpListener::bind("127.0.0.1:0").expect("bind proxy");
        let proxy_port = proxy.local_addr().unwrap().port();
        let target = TcpListener::bind("127.0.0.1:0").expect("bind target");
        let target_port = target.local_addr().unwrap().port();
        let serve = |listener: TcpListener, reply: &'static [u8]| {
            std::thread::spawn(move || {
                accept_until(listener, |stream| {
                    let mut buf = [0u8; 4096];
                    if stream.read(&mut buf).unwrap_or(0) == 0 {
                        return false;
                    }
                    let _ = stream.write_all(reply);
                    true
                });
            })
        };
        let _proxy_thread = serve(proxy, b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
        let target_thread = serve(target, b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok");

        let proxy_url = format!("http://127.0.0.1:{proxy_port}");
        let _env_guard = ProxyEnvGuard::set(&[
            ("all_proxy", None),
            ("ALL_PROXY", None),
            ("https_proxy", Some(&proxy_url)),
            ("HTTPS_PROXY", Some(&proxy_url)),
            ("http_proxy", Some(&proxy_url)),
            ("HTTP_PROXY", Some(&proxy_url)),
            ("no_proxy", None),
            ("NO_PROXY", Some("127.0.0.1,localhost")),
        ]);

        let url = format!("http://127.0.0.1:{target_port}/openai/v1/images");
        let agent = agent_builder(&url).timeout(Duration::from_secs(2)).build();
        let response = agent.get(&url).call().expect("direct request to a NO_PROXY host");
        assert_eq!(response.status(), 200);
        target_thread.join().expect("target thread");
    }

    #[test]
    fn no_proxy_from_the_environment_routes_a_named_host_direct() {
        // Not loopback, so only the NO_PROXY entry can send this one direct:
        // the proxy must see nothing, and the direct lookup of `.invalid` fails.
        use std::io::{Read, Write};
        use std::net::TcpListener;
        use std::time::Duration;

        let _lock = PROXY_ENV_LOCK.lock().unwrap();
        let proxy = TcpListener::bind("127.0.0.1:0").expect("bind proxy");
        let proxy_url = format!("http://127.0.0.1:{}", proxy.local_addr().unwrap().port());
        let hits = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let hits_in = hits.clone();
        let _proxy_thread = std::thread::spawn(move || {
            accept_until(proxy, |stream| {
                let mut buf = [0u8; 4096];
                if stream.read(&mut buf).unwrap_or(0) > 0 {
                    hits_in.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok");
                }
                false
            });
        });
        let url = "http://proxy-test.invalid/";
        for (no_proxy, proxied) in [("proxy-test.invalid", false), ("other.example", true)] {
            let _env_guard = ProxyEnvGuard::set(&[
                ("all_proxy", None),
                ("ALL_PROXY", None),
                ("https_proxy", None),
                ("HTTPS_PROXY", None),
                ("http_proxy", Some(&proxy_url)),
                ("HTTP_PROXY", Some(&proxy_url)),
                ("no_proxy", None),
                ("NO_PROXY", Some(no_proxy)),
            ]);
            let before = hits.load(std::sync::atomic::Ordering::SeqCst);
            let result = agent_builder(url).timeout(Duration::from_secs(2)).build().get(url).call();
            let went_through_proxy = hits.load(std::sync::atomic::Ordering::SeqCst) > before;
            assert_eq!(went_through_proxy, proxied, "NO_PROXY={no_proxy}");
            assert_eq!(result.is_ok(), proxied, "NO_PROXY={no_proxy}");
        }
    }

    #[test]
    fn each_redirect_hop_gets_its_own_proxy_choice() {
        // A loopback host (always direct) redirects to a public name that
        // needs the proxy: the second hop must go through it.
        use std::io::{Read, Write};
        use std::net::TcpListener;
        use std::time::Duration;

        let _lock = PROXY_ENV_LOCK.lock().unwrap();
        let proxy = TcpListener::bind("127.0.0.1:0").expect("bind proxy");
        let proxy_url = format!("http://127.0.0.1:{}", proxy.local_addr().unwrap().port());
        let origin = TcpListener::bind("127.0.0.1:0").expect("bind origin");
        let origin_url = format!("http://127.0.0.1:{}/start", origin.local_addr().unwrap().port());
        let serve = |listener: TcpListener, reply: &'static [u8]| {
            std::thread::spawn(move || {
                accept_until(listener, |stream| {
                    let mut buf = [0u8; 4096];
                    if stream.read(&mut buf).unwrap_or(0) == 0 {
                        return false;
                    }
                    let _ = stream.write_all(reply);
                    true
                });
            })
        };
        let origin_thread = serve(origin, b"HTTP/1.1 302 Found\r\nLocation: http://proxy-test.invalid/image.png\r\nContent-Length: 0\r\n\r\n");
        let proxy_thread = serve(proxy, b"HTTP/1.1 200 OK\r\nContent-Length: 7\r\n\r\nproxied");
        let _env_guard = ProxyEnvGuard::set(&[
            ("all_proxy", None),
            ("ALL_PROXY", None),
            ("https_proxy", None),
            ("HTTPS_PROXY", None),
            ("http_proxy", Some(&proxy_url)),
            ("HTTP_PROXY", Some(&proxy_url)),
            ("no_proxy", None),
            ("NO_PROXY", None),
        ]);
        let response = get_following(&origin_url, 3, |b| b.timeout(Duration::from_secs(2))).expect("redirect followed");
        assert_eq!(response.status(), 200);
        assert_eq!(response.into_string().unwrap(), "proxied");
        origin_thread.join().unwrap();
        proxy_thread.join().unwrap();
    }

    #[test]
    fn get_following_returns_the_last_redirect_when_hops_run_out() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        use std::time::Duration;

        let _lock = PROXY_ENV_LOCK.lock().unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let served = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let served_in = served.clone();
        let server = std::thread::spawn(move || {
            accept_until(listener, |stream| {
                let mut buf = [0u8; 4096];
                if stream.read(&mut buf).unwrap_or(0) == 0 {
                    return false;
                }
                let _ = stream.write_all(b"HTTP/1.1 302 Found\r\nLocation: /again\r\nContent-Length: 0\r\n\r\n");
                served_in.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1 >= 3
            });
        });
        let _env_guard = ProxyEnvGuard::set(&[("NO_PROXY", None), ("no_proxy", None)]);
        let response = get_following(&format!("{base}/start"), 2, |b| b.timeout(Duration::from_secs(2))).expect("response");
        assert_eq!(response.status(), 302);
        server.join().unwrap();
        assert_eq!(served.load(std::sync::atomic::Ordering::SeqCst), 3, "the first request plus two hops");
    }

    #[test]
    fn agent_honors_http_proxy_from_env() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        use std::time::Duration;

        let _lock = PROXY_ENV_LOCK.lock().unwrap();

        let listener = TcpListener::bind("127.0.0.1:0").expect("bind proxy listener");
        let proxy_addr = listener.local_addr().expect("proxy listener addr");

        let request = std::sync::Arc::new(std::sync::Mutex::new(Vec::<u8>::new()));
        let request_for_thread = request.clone();
        let handle = std::thread::spawn(move || {
            accept_until(listener, |stream| {
                let mut buf = [0u8; 4096];
                let n = stream.read(&mut buf).unwrap_or(0);
                let chunk = &buf[..n];
                if chunk.is_empty()
                    || !String::from_utf8_lossy(chunk).contains("proxy-test.invalid")
                {
                    return false;
                }
                request_for_thread.lock().unwrap().extend_from_slice(chunk);
                let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok");
                true
            });
        });

        let proxy_url = format!("http://127.0.0.1:{}", proxy_addr.port());
        let _env_guard = ProxyEnvGuard::set(&[
            ("all_proxy", None),
            ("ALL_PROXY", None),
            ("https_proxy", None),
            ("HTTPS_PROXY", None),
            ("http_proxy", Some(&proxy_url)),
            ("HTTP_PROXY", Some(&proxy_url)),
            ("no_proxy", None),
            ("NO_PROXY", None),
        ]);

        let agent = agent_builder("http://proxy-test.invalid/")
            .timeout(Duration::from_secs(2))
            .build();
        let response = agent.get("http://proxy-test.invalid/").call();
        assert!(response.is_ok(), "expected proxy-routed GET to succeed");

        handle.join().expect("proxy thread");

        let request_bytes = request.lock().unwrap().clone();
        let request_text = String::from_utf8_lossy(&request_bytes);
        assert!(
            request_text.contains("proxy-test.invalid"),
            "proxy should receive request for target host, got: {request_text:?}"
        );
    }

    #[test]
    fn agent_honors_socks5_all_proxy_from_env() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        use std::time::Duration;

        fn socks5_then_http(stream: &mut std::net::TcpStream) -> Option<Vec<u8>> {
            fn read_n(stream: &mut std::net::TcpStream, n: usize) -> Option<Vec<u8>> {
                let mut buf = vec![0u8; n];
                stream.read_exact(&mut buf).ok()?;
                Some(buf)
            }

            let greet = read_n(stream, 2)?;
            if greet[0] != 5 {
                return None;
            }
            let _ = read_n(stream, greet[1] as usize)?;
            stream.write_all(&[0x05, 0x00]).ok()?;

            let req = read_n(stream, 4)?;
            if req[0] != 5 || req[1] != 1 {
                return None;
            }
            match req[3] {
                1 => {
                    let _ = read_n(stream, 6)?;
                }
                3 => {
                    let len = read_n(stream, 1)?;
                    let _ = read_n(stream, len[0] as usize + 2)?;
                }
                4 => {
                    let _ = read_n(stream, 18)?;
                }
                _ => return None,
            }
            stream
                .write_all(&[0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                .ok()?;

            let mut chunk = Vec::new();
            let mut buf = [0u8; 4096];
            loop {
                let n = stream.read(&mut buf).ok()?;
                if n == 0 {
                    break;
                }
                chunk.extend_from_slice(&buf[..n]);
                if String::from_utf8_lossy(&chunk).contains("proxy-test.invalid") {
                    break;
                }
            }
            if !String::from_utf8_lossy(&chunk).contains("proxy-test.invalid") {
                return None;
            }
            let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok");
            Some(chunk)
        }

        let _lock = PROXY_ENV_LOCK.lock().unwrap();

        let listener = TcpListener::bind("127.0.0.1:0").expect("bind socks listener");
        let proxy_addr = listener.local_addr().expect("socks listener addr");

        let request = std::sync::Arc::new(std::sync::Mutex::new(Vec::<u8>::new()));
        let request_for_thread = request.clone();
        let handle = std::thread::spawn(move || {
            accept_until(listener, |stream| {
                if let Some(chunk) = socks5_then_http(stream) {
                    *request_for_thread.lock().unwrap() = chunk;
                    true
                } else {
                    false
                }
            });
        });

        let proxy_url = format!("socks5://127.0.0.1:{}", proxy_addr.port());
        let _env_guard = ProxyEnvGuard::set(&[
            ("all_proxy", Some(&proxy_url)),
            ("ALL_PROXY", Some(&proxy_url)),
            ("https_proxy", None),
            ("HTTPS_PROXY", None),
            ("http_proxy", None),
            ("HTTP_PROXY", None),
            ("no_proxy", None),
            ("NO_PROXY", None),
        ]);

        let agent = agent_builder("http://proxy-test.invalid/")
            .timeout(Duration::from_secs(2))
            .build();
        let response = agent.get("http://proxy-test.invalid/").call();
        assert!(response.is_ok(), "expected SOCKS5-routed GET to succeed");

        handle.join().expect("socks thread");

        let request_bytes = request.lock().unwrap().clone();
        let request_text = String::from_utf8_lossy(&request_bytes);
        assert!(
            request_text.contains("proxy-test.invalid"),
            "SOCKS proxy should receive request for target host, got: {request_text:?}"
        );
    }
}
