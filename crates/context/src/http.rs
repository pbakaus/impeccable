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
//! behind a corporate proxy (#823). Live-mode localhost HTTP does not use
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
pub fn agent_builder() -> ureq::AgentBuilder {
    ureq::AgentBuilder::new()
        .tls_config(tls_config())
        .try_proxy_from_env(true)
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
        let _agent = agent_builder().build();
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
            ("ALL_PROXY", None),
            ("all_proxy", None),
            ("HTTPS_PROXY", None),
            ("https_proxy", None),
            ("HTTP_PROXY", Some(&proxy_url)),
            ("http_proxy", Some(&proxy_url)),
        ]);

        let agent = agent_builder()
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
            ("ALL_PROXY", Some(&proxy_url)),
            ("all_proxy", Some(&proxy_url)),
            ("HTTPS_PROXY", None),
            ("https_proxy", None),
            ("HTTP_PROXY", None),
            ("http_proxy", None),
        ]);

        let agent = agent_builder()
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
