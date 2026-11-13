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

    /// The account as people read it: "Impeccable" for the production
    /// service, and "Impeccable (<host>)" for any other, so a staging or test
    /// sign-in is never mistaken for the real account.
    pub fn display_name(&self) -> String {
        if self.issuer == DEFAULT_ACCOUNT_URL {
            "Impeccable".to_string()
        } else {
            format!("Impeccable ({})", self.display_host())
        }
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
pub(crate) fn loopback_url(u: &url::Url) -> bool {
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

    #[test]
    fn the_account_is_named_impeccable_and_only_other_services_show_a_host() {
        // Catches: sign-in lines naming the host (api.impeccable.style) where a person expects their Impeccable account.
        let at = |url: &str| Account { issuer: url.to_string(), home: PathBuf::from("/h") };
        assert_eq!(at(DEFAULT_ACCOUNT_URL).display_name(), "Impeccable");
        assert_eq!(
            at("https://api.staging.impeccable.style").display_name(),
            "Impeccable (api.staging.impeccable.style)"
        );
    }
    use super::*;

    #[test]
    fn context_and_account_agree_on_the_expected_issuer() {
        let mut env = HashMap::from([("IMPECCABLE_HOME".into(), "/unused".into())]);
        for override_url in [None, Some(" https://API.example.test:443/ "), Some("http://api.localhost:8787/"), Some("https://bad.test/path"), Some("")] {
            env.remove("IMPECCABLE_ACCOUNT_URL");
            if let Some(raw) = override_url { env.insert("IMPECCABLE_ACCOUNT_URL".into(), raw.into()); }
            assert_eq!(impeccable_context::taste::expected_issuer(&env), Account::from_env(&env).ok().map(|a| a.issuer));
        }
    }

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
            (
                "http://api.localhost:8787",
                Some("http://api.localhost:8787"),
            ),
            ("http://api.localhost.example", None),
            ("http://api.impeccable.style", None),
            ("https://api.impeccable.style/v1", None),
            ("https://u:p@api.impeccable.style", None),
        ] {
            assert_eq!(normalize_origin(raw).as_deref(), want, "{raw}");
        }
    }
}
