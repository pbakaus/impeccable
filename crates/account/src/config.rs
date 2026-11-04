//! Where the account service is and where this machine keeps its sign-in.

use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::PathBuf;

/// The production account service: the OAuth issuer and the CLI resource host.
pub const DEFAULT_ACCOUNT_URL: &str = "https://api.impeccable.style";
/// The first-party public client the service registers for this CLI.
pub const CLIENT_ID: &str = "impeccable-cli";
pub const SCOPES: &str = "account:read rules:read";

/// One account service, as an origin (`scheme://host[:port]`, no path).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Account {
    pub issuer: String,
    /// `$IMPECCABLE_HOME` (default `~/.impeccable`).
    pub home: PathBuf,
}

impl Account {
    /// `IMPECCABLE_ACCOUNT_URL` (default [`DEFAULT_ACCOUNT_URL`]) under
    /// `IMPECCABLE_HOME`. Plain HTTP is accepted only for a loopback host, so
    /// a local rehearsal works and nothing else can downgrade the transport.
    pub fn from_env(env: &HashMap<String, String>) -> Result<Account, String> {
        let raw = env
            .get("IMPECCABLE_ACCOUNT_URL")
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .unwrap_or(DEFAULT_ACCOUNT_URL);
        let issuer = normalize_origin(raw)
            .ok_or_else(|| "IMPECCABLE_ACCOUNT_URL must be an https origin (http only for 127.0.0.1 or localhost)".to_string())?;
        let home =
            impeccable_home(env).ok_or("Could not find a home directory; set IMPECCABLE_HOME")?;
        Ok(Account { issuer, home })
    }

    /// The CLI resource indicator (RFC 8707) the service binds tokens to.
    pub fn resource(&self) -> String {
        format!("{}/cli", self.issuer)
    }

    /// Per-service state: sign-ins to two services never share files.
    pub fn dir(&self) -> PathBuf {
        let digest = Sha256::digest(self.issuer.as_bytes());
        let id: String = digest[..8].iter().map(|b| format!("{b:02x}")).collect();
        self.home.join("account").join(id)
    }

    /// The host shown to people (`api.impeccable.style`).
    pub fn display_host(&self) -> &str {
        self.issuer.split("://").nth(1).unwrap_or(&self.issuer)
    }

    pub fn is_loopback(&self) -> bool {
        url::Url::parse(&self.issuer)
            .map(|u| loopback_url(&u))
            .unwrap_or(false)
    }
}

pub fn impeccable_home(env: &HashMap<String, String>) -> Option<PathBuf> {
    if let Some(h) = env.get("IMPECCABLE_HOME").filter(|s| !s.is_empty()) {
        return Some(PathBuf::from(h));
    }
    let (first, second) = if cfg!(windows) {
        ("USERPROFILE", "HOME")
    } else {
        ("HOME", "USERPROFILE")
    };
    env.get(first)
        .or_else(|| env.get(second))
        .filter(|s| !s.is_empty())
        .map(|h| PathBuf::from(h).join(".impeccable"))
}

/// Loopback names: `127.0.0.1`, `[::1]`, `localhost` and names under it
/// (RFC 6761), which a local split-host rehearsal uses (`api.localhost`).
fn loopback_url(u: &url::Url) -> bool {
    matches!(u.host_str(), Some(h) if h == "127.0.0.1" || h == "[::1]" || h == "localhost" || h.ends_with(".localhost"))
}

/// `scheme://host[:port]` when `raw` is an https origin, or an http loopback
/// one, with no credentials, query or fragment and at most a bare `/` path.
pub fn normalize_origin(raw: &str) -> Option<String> {
    let u = url::Url::parse(raw).ok()?;
    let secure = u.scheme() == "https" || (u.scheme() == "http" && loopback_url(&u));
    if !secure
        || !u.username().is_empty()
        || u.password().is_some()
        || u.query().is_some()
        || u.fragment().is_some()
        || u.path() != "/"
    {
        return None;
    }
    let host = u.host_str()?;
    Some(match u.port() {
        Some(p) => format!("{}://{host}:{p}", u.scheme()),
        None => format!("{}://{host}", u.scheme()),
    })
}

/// Whether `endpoint` is an absolute URL on `origin` (same scheme, host, port).
pub fn on_origin(endpoint: &str, origin: &str) -> bool {
    match url::Url::parse(endpoint) {
        Ok(u) => normalize_origin(&u.origin().ascii_serialization()).as_deref() == Some(origin),
        Err(_) => false,
    }
}

/// Whether `endpoint` may carry a browser to the consent page: https, or an
/// http loopback when the service itself is a loopback rehearsal.
pub fn browser_safe(endpoint: &str, account: &Account) -> bool {
    match url::Url::parse(endpoint) {
        Ok(u) => {
            u.scheme() == "https"
                || (u.scheme() == "http" && loopback_url(&u) && account.is_loopback())
        }
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn origins_accept_https_and_loopback_http_only() {
        for (raw, want) in [
            (
                "https://api.impeccable.style",
                Some("https://api.impeccable.style"),
            ),
            (
                "https://api.impeccable.style/",
                Some("https://api.impeccable.style"),
            ),
            ("http://127.0.0.1:8787", Some("http://127.0.0.1:8787")),
            ("http://api.localhost:8787", Some("http://api.localhost:8787")),
            ("http://api.localhost.example", None),
            ("http://api.impeccable.style", None),
            ("https://api.impeccable.style/v1", None),
            ("https://u:p@api.impeccable.style", None),
        ] {
            assert_eq!(normalize_origin(raw).as_deref(), want, "{raw}");
        }
    }
}
