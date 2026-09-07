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

use std::sync::Arc;

use once_cell::sync::Lazy;
use ureq::rustls::pki_types::CertificateDer;
use ureq::rustls::{self, ClientConfig, RootCertStore};

/// `ureq::AgentBuilder::new()` with the engine's trust store installed.
/// Every HTTPS call site builds its agent from this; the plain-HTTP calls
/// to the live server on localhost do not need it.
pub fn agent_builder() -> ureq::AgentBuilder {
    ureq::AgentBuilder::new().tls_config(tls_config())
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
        let _agent = agent_builder().build();
    }
}
