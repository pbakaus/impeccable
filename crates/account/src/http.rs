//! HTTP to the account service. Nothing here logs a request: bodies carry
//! codes, verifiers and tokens, and errors keep only a status and the
//! service's machine-readable `error` code.

use crate::config::{self, Account};
use std::io::Read;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ApiError {
    /// The service answered with a status; `code` is its `error` field when
    /// that is a plain identifier.
    Status { status: u16, code: Option<String> },
    /// No answer (DNS, connect, TLS, timeout), or an answer we could not read.
    Network(String),
}

impl ApiError {
    pub fn code(&self) -> Option<&str> {
        match self {
            ApiError::Status { code, .. } => code.as_deref(),
            ApiError::Network(_) => None,
        }
    }
    pub fn status(&self) -> Option<u16> {
        match self {
            ApiError::Status { status, .. } => Some(*status),
            ApiError::Network(_) => None,
        }
    }
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ApiError::Status {
                status,
                code: Some(code),
            } => write!(f, "{code} (HTTP {status})"),
            ApiError::Status { status, code: None } => write!(f, "HTTP {status}"),
            ApiError::Network(e) => f.write_str(e),
        }
    }
}

/// Every request goes to the account service's own origin: a URL read back
/// from `state.json` or from metadata is checked here, at the boundary,
/// before any code, token or verifier is attached to it.
pub struct Client {
    agent: ureq::Agent,
    origin: String,
}

/// Largest JSON answer read from the service.
const MAX_JSON: u64 = 1024 * 1024;
/// The whole of one request, connect to last byte: a service that trickles
/// bytes cannot hold a caller (and the sign-in lock it may hold) for longer.
pub const REQUEST_DEADLINE: Duration = Duration::from_secs(60);

impl Client {
    pub fn new(account: &Account) -> Client {
        Client::with_deadline(account, REQUEST_DEADLINE)
    }

    pub fn with_deadline(account: &Account, deadline: Duration) -> Client {
        Client::build(account, deadline, None)
    }

    /// A client for a caller with a hard budget ending at `end`: name lookup
    /// is bounded by it too (see [`bounded_lookup`]), so a stalled resolver
    /// drops the request instead of holding the caller.
    pub fn until(account: &Account, end: Instant) -> Client {
        Client::build(account, end.saturating_duration_since(Instant::now()), Some(end))
    }

    fn build(account: &Account, deadline: Duration, end: Option<Instant>) -> Client {
        // A loopback rehearsal must not be sent to a corporate proxy, and
        // its names never reach a resolver: plain HTTP is allowed for them
        // only because they cannot leave the machine.
        let builder = if account.is_loopback() {
            ureq::AgentBuilder::new().resolver(resolve_loopback)
        } else {
            // Every request stays on the issuer's origin (`checked`), so its
            // host decides the NO_PROXY match for the whole client.
            let builder = impeccable_context::http::agent_builder(&account.issuer);
            match end {
                Some(end) => builder.resolver(move |netloc: &str| bounded_lookup(netloc, end, system_lookup)),
                None => builder,
            }
        };
        // ureq 2 gives timeout_connect precedence over its overall timeout.
        // ureq resolves names synchronously with no timeout of its own; only a
        // client from `until` bounds that. Never move an upload to a detached
        // worker: it could transmit after the caller's timeout or opt-out.
        let agent = builder
            .timeout_connect(deadline.min(Duration::from_secs(10)))
            .timeout_read(deadline.min(Duration::from_secs(30)))
            .timeout(deadline)
            .redirects(0)
            .build();
        Client {
            agent,
            origin: account.issuer.clone(),
        }
    }

    fn checked(&self, url: &str) -> Result<(), ApiError> {
        if config::on_origin(url, &self.origin) {
            Ok(())
        } else {
            Err(ApiError::Network(
                "refused a request outside the account service".into(),
            ))
        }
    }

    pub fn get_json(&self, url: &str, bearer: Option<&str>) -> Result<serde_json::Value, ApiError> {
        self.checked(url)?;
        let mut req = self.agent.get(url).set("accept", "application/json");
        if let Some(token) = bearer {
            req = req.set("authorization", &bearer_header(token)?);
        }
        json_body(req.call())
    }

    /// Conditional taste read. A 304 has no JSON body.
    pub fn get_taste(
        &self, url: &str, bearer: &str, etag: Option<&str>,
    ) -> Result<(u16, Option<String>, serde_json::Value), ApiError> {
        self.checked(url)?;
        let mut req = self.agent.get(url)
            .set("accept", "application/json")
            .set("authorization", &bearer_header(bearer)?);
        if let Some(etag) = etag { req = req.set("if-none-match", etag); }
        let resp = req.call().map_err(classify)?;
        let status = resp.status();
        let etag = resp.header("etag").map(str::to_string);
        let body = if status == 304 { serde_json::Value::Null } else { json_body(Ok(resp))? };
        Ok((status, etag, body))
    }

    /// Taste writes accept exactly 200, including when another 2xx contains JSON.
    pub fn post_taste(&self, url: &str, bearer: &str, body: serde_json::Value) -> Result<serde_json::Value, ApiError> {
        self.checked(url)?;
        let response = self.agent.post(url).set("accept", "application/json")
            .set("authorization", &bearer_header(bearer)?)
            .send_json(body).map_err(classify)?;
        if response.status() != 200 {
            return Err(ApiError::Status { status: response.status(), code: None });
        }
        json_body(Ok(response))
    }

    pub fn post_form(
        &self,
        url: &str,
        form: &[(&str, &str)],
    ) -> Result<serde_json::Value, ApiError> {
        self.checked(url)?;
        let req = self.agent.post(url).set("accept", "application/json");
        json_body(req.send_form(form))
    }

    /// A form POST whose answer has no body worth reading (revocation).
    pub fn post_form_empty(&self, url: &str, form: &[(&str, &str)]) -> Result<(), ApiError> {
        self.checked(url)?;
        self.agent
            .post(url)
            .send_form(form)
            .map(|_| ())
            .map_err(classify)
    }

    pub fn post_json(
        &self,
        url: &str,
        bearer: &str,
        body: serde_json::Value,
    ) -> Result<serde_json::Value, ApiError> {
        self.checked(url)?;
        let req = self
            .agent
            .post(url)
            .set("accept", "application/json")
            .set("authorization", &bearer_header(bearer)?);
        json_body(req.send_json(body))
    }

    /// GET returning the raw body (at most `max` bytes) and one named header.
    pub fn get_bytes(
        &self,
        url: &str,
        bearer: &str,
        header: Option<&str>,
        max: u64,
    ) -> Result<(Vec<u8>, Option<String>), ApiError> {
        self.checked(url)?;
        let resp = self
            .agent
            .get(url)
            .set("authorization", &bearer_header(bearer)?)
            .call()
            .map_err(classify)?;
        let value = header.and_then(|h| resp.header(h)).map(str::to_string);
        let mut buf = Vec::new();
        resp.into_reader()
            .take(max + 1)
            .read_to_end(&mut buf)
            .map_err(read_error)?;
        if buf.len() as u64 > max {
            return Err(ApiError::Network("answer too large".into()));
        }
        Ok((buf, value))
    }
}

fn json_body(result: Result<ureq::Response, ureq::Error>) -> Result<serde_json::Value, ApiError> {
    let resp = result.map_err(classify)?;
    let mut buf = Vec::new();
    resp.into_reader()
        .take(MAX_JSON)
        .read_to_end(&mut buf)
        .map_err(read_error)?;
    serde_json::from_slice(&buf)
        .map_err(|_| ApiError::Network("the service sent an answer that is not JSON".into()))
}

fn classify(e: ureq::Error) -> ApiError {
    match e {
        ureq::Error::Status(status, resp) => {
            let mut buf = Vec::new();
            let _ = resp.into_reader().take(16 * 1024).read_to_end(&mut buf);
            let code = serde_json::from_slice::<serde_json::Value>(&buf)
                .ok()
                .and_then(|v| v.get("error").and_then(|c| c.as_str()).map(str::to_string))
                .filter(|c| {
                    c.len() <= 64
                        && c.bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
                });
            ApiError::Status { status, code }
        }
        // Never the transport's own text: ureq quotes a rejected header
        // line whole, and that line can be `authorization: Bearer <token>`.
        ureq::Error::Transport(t) => ApiError::Network(transport_reason(t.kind()).into()),
    }
}

fn transport_reason(kind: ureq::ErrorKind) -> &'static str {
    use ureq::ErrorKind::*;
    match kind {
        Dns => "could not resolve the account service",
        ConnectionFailed => "could not connect to the account service",
        ProxyConnect | ProxyUnauthorized | InvalidProxyUrl => "the proxy refused the connection",
        Io => "the connection to the account service failed or timed out",
        _ => "the request to the account service failed",
    }
}

fn read_error(e: std::io::Error) -> ApiError {
    ApiError::Network(match e.kind() {
        std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock => {
            "the account service took too long to answer".into()
        }
        _ => "the connection to the account service failed".into(),
    })
}

/// `Bearer <token>` for an RFC 6750 b64token, and nothing else: a token with
/// a control character or space would make the HTTP layer reject (and quote)
/// the header.
fn bearer_header(token: &str) -> Result<String, ApiError> {
    if valid_token(token) {
        Ok(format!("Bearer {token}"))
    } else {
        Err(ApiError::Network(
            "the account service issued a malformed token".into(),
        ))
    }
}

/// The longest token the client accepts. Both tokens and their metadata
/// must fit one Windows Credential Manager blob ([`crate::store::MAX_SECRET`]),
/// so a sign-in the browser step completed can always be saved. The service's
/// tokens are far shorter (a signed access token is about 450 bytes).
pub const MAX_TOKEN: usize = 1024;

pub fn valid_token(token: &str) -> bool {
    let body = token.trim_end_matches('=');
    !body.is_empty()
        && token.len() <= MAX_TOKEN
        && body
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-._~+/".contains(&b))
}

fn system_lookup(netloc: &str) -> std::io::Result<Vec<SocketAddr>> {
    std::net::ToSocketAddrs::to_socket_addrs(netloc).map(Iterator::collect)
}

/// Resolve `netloc` (the issuer's, or a proxy's) by `end` at the latest. The
/// lookup runs on a helper thread that is abandoned when time runs out; it
/// carries no request, so nothing is sent after the caller gave up.
fn bounded_lookup(
    netloc: &str,
    end: Instant,
    lookup: fn(&str) -> std::io::Result<Vec<SocketAddr>>,
) -> std::io::Result<Vec<SocketAddr>> {
    let timed_out = || std::io::Error::new(std::io::ErrorKind::TimedOut, "name lookup ran out of time");
    let wait = end.saturating_duration_since(Instant::now());
    if wait.is_zero() {
        return Err(timed_out());
    }
    let netloc = netloc.to_string();
    crate::session::read_within(wait, move || lookup(&netloc)).unwrap_or_else(|| Err(timed_out()))
}

/// Loopback rehearsal names resolve to loopback, without a resolver
/// (RFC 6761 section 6.3); any other name is refused rather than looked up.
fn resolve_loopback(netloc: &str) -> std::io::Result<Vec<SocketAddr>> {
    let refuse = || std::io::Error::new(std::io::ErrorKind::Other, "not a loopback host");
    let (host, port) = netloc.rsplit_once(':').ok_or_else(refuse)?;
    let port: u16 = port.parse().map_err(|_| refuse())?;
    let host = host.trim_start_matches('[').trim_end_matches(']');
    let ips: Vec<IpAddr> = if host == "localhost" || host.ends_with(".localhost") {
        vec![Ipv4Addr::LOCALHOST.into(), Ipv6Addr::LOCALHOST.into()]
    } else {
        match host.parse::<IpAddr>() {
            Ok(ip) if ip.is_loopback() => vec![ip],
            _ => return Err(refuse()),
        }
    };
    Ok(ips
        .into_iter()
        .map(|ip| SocketAddr::new(ip, port))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_stalled_name_lookup_gives_up_at_the_callers_deadline() {
        fn stalls(_: &str) -> std::io::Result<Vec<SocketAddr>> {
            std::thread::sleep(Duration::from_secs(5));
            Ok(vec![])
        }
        fn answers(_: &str) -> std::io::Result<Vec<SocketAddr>> {
            Ok(vec![SocketAddr::new(Ipv4Addr::LOCALHOST.into(), 443)])
        }
        let started = Instant::now();
        let err = bounded_lookup("api.example.invalid:443", started + Duration::from_millis(200), stalls)
            .unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::TimedOut);
        assert!(started.elapsed() < Duration::from_secs(2), "{:?}", started.elapsed());
        assert_eq!(bounded_lookup("x:443", Instant::now() + Duration::from_secs(2), answers).unwrap().len(), 1);
        assert!(bounded_lookup("x:443", Instant::now(), answers).is_err());
    }

    #[test]
    fn loopback_names_never_reach_a_resolver() {
        let v4: SocketAddr = "127.0.0.1:8787".parse().unwrap();
        assert!(resolve_loopback("api.localhost:8787")
            .unwrap()
            .contains(&v4));
        assert!(resolve_loopback("localhost:8787").unwrap().contains(&v4));
        assert_eq!(resolve_loopback("127.0.0.1:8787").unwrap(), vec![v4]);
        assert!(resolve_loopback("[::1]:8787").unwrap()[0]
            .ip()
            .is_loopback());
        assert!(resolve_loopback("10.0.0.1:8787").is_err());
        assert!(resolve_loopback("api.impeccable.style:443").is_err());
    }

    #[test]
    fn a_token_with_a_control_character_is_refused_without_quoting_it() {
        let err = bearer_header("abc.def\n").unwrap_err();
        assert!(!err.to_string().contains("abc.def"), "{err}");
        assert!(bearer_header("eyJhbGc.eyJzdWI.sig-_~+/==").is_ok());
        assert!(!valid_token(""));
        assert!(!valid_token("has space"));
    }

    #[test]
    fn requests_off_the_account_origin_are_refused() {
        let account = Account {
            issuer: "http://127.0.0.1:1".into(),
            home: std::env::temp_dir(),
        };
        let client = Client::new(&account);
        let err = client
            .post_form_empty("https://attacker.example/revoke", &[("token", "t")])
            .unwrap_err();
        assert_eq!(
            err.to_string(),
            "refused a request outside the account service"
        );
    }
}
