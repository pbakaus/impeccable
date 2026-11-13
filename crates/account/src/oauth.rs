//! OAuth 2.1 for a native app (RFC 8252): authorization code with PKCE S256,
//! a loopback redirect on `127.0.0.1`, `state`, the RFC 9207 `iss` check,
//! and RFC 8707 resource indicators.

use crate::config::{browser_safe, on_origin, Account, CLIENT_ID, SCOPES};
use crate::http::{ApiError, Client};
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine;
use ring::rand::{SecureRandom, SystemRandom};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};

/// How long one connection to the callback listener may take to send its
/// request head, and how many may be read at once. A slow or idle local
/// connection cannot hold up the browser's.
const REQUEST_HEAD_DEADLINE: Duration = Duration::from_secs(5);
const MAX_PENDING_CONNECTIONS: usize = 16;

pub struct Metadata {
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub revocation_endpoint: Option<String>,
    /// The service lists `health:write` in `scopes_supported`, which it does
    /// only while design health is switched on there. Asking for a scope it
    /// doesn't list fails the sign-in with `invalid_scope`.
    pub health: bool,
    pub setup: bool,
    pub foundations: bool,
    pub design: bool,
    pub critiques: bool,
    /// `journeys:start`, for `impeccable journeys` (`crate::journeys`).
    pub journeys: bool,
}

/// The issuer's RFC 8414 metadata, held to this account: the document must
/// name the same issuer, offer S256 and the `iss` response parameter, and
/// keep its token endpoints on the issuer's own origin.
pub fn metadata(client: &Client, account: &Account) -> Result<Metadata, String> {
    let url = format!("{}/.well-known/oauth-authorization-server", account.issuer);
    let doc = client
        .get_json(&url, None)
        .map_err(|e| format!("could not read the account service's sign-in settings: {e}"))?;
    let s = |k: &str| doc.get(k).and_then(|v| v.as_str()).map(str::to_string);
    if s("issuer").as_deref() != Some(account.issuer.as_str()) {
        return Err("the account service named a different issuer".into());
    }
    let s256 = doc
        .get("code_challenge_methods_supported")
        .and_then(|v| v.as_array())
        .is_some_and(|a| a.iter().any(|m| m == "S256"));
    if !s256
        || doc.get("authorization_response_iss_parameter_supported")
            != Some(&serde_json::Value::Bool(true))
    {
        return Err(
            "the account service does not offer PKCE S256 with issuer identification".into(),
        );
    }
    let authorization_endpoint = s("authorization_endpoint").filter(|e| browser_safe(e, account));
    let token_endpoint = s("token_endpoint").filter(|e| on_origin(e, &account.issuer));
    let revocation_endpoint = s("revocation_endpoint").filter(|e| on_origin(e, &account.issuer));
    let health = doc
        .get("scopes_supported")
        .and_then(|v| v.as_array())
        .is_some_and(|a| a.iter().any(|s| s == HEALTH_SCOPE));
    let foundations = doc
        .get("scopes_supported")
        .and_then(|v| v.as_array())
        .is_some_and(|a| a.iter().any(|s| s == FOUNDATIONS_SCOPE));
    match (authorization_endpoint, token_endpoint) {
        (Some(authorization_endpoint), Some(token_endpoint)) => Ok(Metadata {
            authorization_endpoint,
            token_endpoint,
            revocation_endpoint,
            health,
            setup: doc
                .get("scopes_supported")
                .and_then(|v| v.as_array())
                .is_some_and(|a| a.iter().any(|s| s == "setup:write")),
            foundations,
            design: doc
                .get("scopes_supported")
                .and_then(|v| v.as_array())
                .is_some_and(|a| a.iter().any(|s| s == DESIGN_SCOPE)),
            critiques: doc
                .get("scopes_supported")
                .and_then(|v| v.as_array())
                .is_some_and(|a| a.iter().any(|s| s == CRITIQUES_SCOPE)),
            journeys: doc
                .get("scopes_supported")
                .and_then(|v| v.as_array())
                .is_some_and(|a| a.iter().any(|s| s == JOURNEYS_SCOPE)),
        }),
        _ => Err("the account service's sign-in settings are incomplete".into()),
    }
}

/// Uploading saved critique reports (`crate::critiques`).
pub const CRITIQUES_SCOPE: &str = "critiques:write";

/// Uploading design health results (`crate::health`).
pub const HEALTH_SCOPE: &str = "health:write";
pub const DESIGN_SCOPE: &str = "design:write";

/// Uploading foundations evidence, separately consented from detector counts.
pub const FOUNDATIONS_SCOPE: &str = "foundations:write";

/// Starting and following journeys (`crate::journeys`).
pub const JOURNEYS_SCOPE: &str = "journeys:start";

/// Request feature scopes only where the service advertises them.
pub(crate) fn scopes(meta: &Metadata) -> String {
    let mut scopes = SCOPES.to_string();
    for (offered, scope) in [
        (meta.health, HEALTH_SCOPE),
        (meta.setup, "setup:write"),
        (meta.foundations, FOUNDATIONS_SCOPE),
        (meta.design, DESIGN_SCOPE),
        (meta.critiques, CRITIQUES_SCOPE),
        (meta.journeys, JOURNEYS_SCOPE),
    ] {
        if offered {
            scopes.push(' ');
            scopes.push_str(scope);
        }
    }
    scopes
}

pub fn random_b64(len: usize) -> String {
    let mut bytes = vec![0u8; len];
    SystemRandom::new()
        .fill(&mut bytes)
        .expect("the OS random source");
    B64.encode(bytes)
}

/// `(verifier, challenge)`: 32 random bytes (43 characters) and its S256.
pub fn pkce() -> (String, String) {
    let verifier = random_b64(32);
    let challenge = B64.encode(Sha256::digest(verifier.as_bytes()));
    (verifier, challenge)
}

pub struct Pending {
    listener: TcpListener,
    pub redirect_uri: String,
    pub url: String,
    state: String,
    verifier: String,
    requested_scopes: Vec<String>,
}

/// Bind the loopback listener and build the authorization URL.
pub fn start(account: &Account, meta: &Metadata) -> Result<Pending, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|e| format!("could not open a local port for sign-in: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");
    let (verifier, challenge) = pkce();
    let state = random_b64(24);
    let mut url = url::Url::parse(&meta.authorization_endpoint).map_err(|e| e.to_string())?;
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", CLIENT_ID)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("resource", &account.resource())
        .append_pair("scope", &scopes(meta))
        .append_pair("state", &state);
    Ok(Pending {
        listener,
        redirect_uri,
        url: url.into(),
        state,
        verifier,
        requested_scopes: scopes(meta)
            .split_whitespace()
            .map(str::to_string)
            .collect(),
    })
}

#[derive(Debug, PartialEq, Eq)]
pub enum CallbackError {
    StateMismatch,
    WrongIssuer,
    Denied(String),
    Malformed,
    TimedOut,
}

impl std::fmt::Display for CallbackError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CallbackError::StateMismatch => {
                f.write_str("the sign-in answer did not match this request")
            }
            CallbackError::WrongIssuer => {
                f.write_str("the sign-in answer came from a different account service")
            }
            CallbackError::Denied(code) if code == "access_denied" => {
                f.write_str("sign-in was declined")
            }
            CallbackError::Denied(code) => {
                write!(f, "the account service refused sign-in ({code})")
            }
            CallbackError::Malformed => f.write_str("the sign-in answer was malformed"),
            CallbackError::TimedOut => f.write_str("sign-in timed out"),
        }
    }
}

const PAGE_OK: &str = "<!doctype html><meta charset=utf-8><title>Impeccable</title><p>Signed in. You can close this tab.";
const PAGE_FAIL: &str = "<!doctype html><meta charset=utf-8><title>Impeccable</title><p>Sign-in didn't finish. Check your terminal.";

impl Pending {
    /// Wait for the browser to come back with a code, until `timeout` has
    /// passed in all. Each connection is read on its own thread under its own
    /// short deadline. Requests for other paths, and callbacks that don't
    /// carry this attempt's `state`, are answered and ignored: only an answer
    /// bound to this attempt can end it. Nothing about a request is logged:
    /// its query carries the code.
    pub fn wait(&self, issuer: &str, timeout: Duration) -> Result<String, CallbackError> {
        self.listener
            .set_nonblocking(true)
            .map_err(|_| CallbackError::Malformed)?;
        let deadline = Instant::now() + timeout;
        let (tx, rx) = mpsc::channel::<(TcpStream, Option<String>)>();
        let reading = Arc::new(AtomicUsize::new(0));
        loop {
            if Instant::now() >= deadline {
                return Err(CallbackError::TimedOut);
            }
            match self.listener.accept() {
                Ok((mut stream, _)) => {
                    if reading.load(Ordering::SeqCst) < MAX_PENDING_CONNECTIONS {
                        reading.fetch_add(1, Ordering::SeqCst);
                        let (tx, reading) = (tx.clone(), reading.clone());
                        let until = deadline.min(Instant::now() + REQUEST_HEAD_DEADLINE);
                        std::thread::spawn(move || {
                            let target = read_request_target(&mut stream, until);
                            let _ = tx.send((stream, target));
                            reading.fetch_sub(1, Ordering::SeqCst);
                        });
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(_) => return Err(CallbackError::Malformed),
            }
            while let Ok((stream, target)) = rx.try_recv() {
                if let Some(result) = self.handle(stream, target, issuer) {
                    return result;
                }
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    fn handle(
        &self,
        mut stream: TcpStream,
        target: Option<String>,
        issuer: &str,
    ) -> Option<Result<String, CallbackError>> {
        let _ = stream.set_nonblocking(false);
        let _ = stream.set_write_timeout(Some(REQUEST_HEAD_DEADLINE));
        let query = target.as_deref().and_then(|t| {
            t.strip_prefix("/callback?")
                .or_else(|| (t == "/callback").then_some(""))
        });
        let Some(query) = query else {
            let _ = stream.write_all(
                b"HTTP/1.1 404 Not Found\r\ncontent-length: 0\r\nconnection: close\r\n\r\n",
            );
            return None;
        };
        let result = self.judge(query, issuer);
        let page = if matches!(result, Some(Ok(_))) {
            PAGE_OK
        } else {
            PAGE_FAIL
        };
        let _ = write!(
            stream,
            "HTTP/1.1 200 OK\r\ncontent-type: text/html; charset=utf-8\r\ncache-control: no-store\r\nreferrer-policy: no-referrer\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{page}",
            page.len()
        );
        result
    }

    /// `None` for a callback that is not bound to this attempt (no `state`,
    /// a different one, or repeated keys): it is answered and ignored, so a
    /// local process that finds the port cannot end the sign-in. A bound
    /// answer is then held to `iss`, then read for its outcome.
    fn judge(&self, query: &str, issuer: &str) -> Option<Result<String, CallbackError>> {
        let mut seen: std::collections::HashMap<String, String> = Default::default();
        for (k, v) in url::form_urlencoded::parse(query.as_bytes()) {
            if seen.insert(k.into_owned(), v.into_owned()).is_some() {
                return None;
            }
        }
        let state = seen.get("state")?;
        if !constant_time_eq(state.as_bytes(), self.state.as_bytes()) {
            return None;
        }
        if seen.get("iss").map(String::as_str) != Some(issuer) {
            return Some(Err(CallbackError::WrongIssuer));
        }
        if let Some(error) = seen.get("error") {
            let code = if error.len() <= 64
                && error
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_')
            {
                error.clone()
            } else {
                "error".into()
            };
            return Some(Err(CallbackError::Denied(code)));
        }
        Some(
            seen.get("code")
                .filter(|c| !c.is_empty())
                .cloned()
                .ok_or(CallbackError::Malformed),
        )
    }

    pub fn verifier(&self) -> &str {
        &self.verifier
    }
}

/// `GET <target> HTTP/1.1`'s target, from at most 8 KiB of request head
/// that must all arrive before `until`.
fn read_request_target(stream: &mut TcpStream, until: Instant) -> Option<String> {
    let _ = stream.set_nonblocking(false);
    let mut head = Vec::new();
    let mut buf = [0u8; 1024];
    while !head.windows(4).any(|w| w == b"\r\n\r\n") {
        let left = until.checked_duration_since(Instant::now())?;
        if left.is_zero() {
            return None;
        }
        stream.set_read_timeout(Some(left)).ok()?;
        let n = stream.read(&mut buf).ok()?;
        if n == 0 || head.len() + n > 8192 {
            return None;
        }
        head.extend_from_slice(&buf[..n]);
    }
    let line = std::str::from_utf8(&head).ok()?.lines().next()?;
    let mut parts = line.split(' ');
    (parts.next()? == "GET").then_some(())?;
    parts.next().map(str::to_string)
}

/// Equal length and bytes, without an early exit on the first difference.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

pub struct Tokens {
    pub setup: bool,
    pub foundations: bool,
    pub scopes: Option<Vec<String>>,
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: u64,
}

fn tokens(v: serde_json::Value, fallback: &[String]) -> Result<Tokens, ApiError> {
    // Both tokens are held to RFC 6750 token syntax here, so a token the
    // HTTP layer would reject (and quote in its error) is never stored.
    let s = |k: &str| {
        v.get(k)
            .and_then(|x| x.as_str())
            .filter(|x| crate::http::valid_token(x))
            .map(str::to_string)
    };
    let bearer = v
        .get("token_type")
        .and_then(|t| t.as_str())
        .is_some_and(|t| t.eq_ignore_ascii_case("bearer"));
    match (
        s("access_token"),
        s("refresh_token"),
        v.get("expires_in").and_then(|e| e.as_u64()),
    ) {
        (Some(access_token), Some(refresh_token), Some(expires_in)) if bearer => {
            // RFC 6749: omission means the requested (or previously held) scope.
            let scopes: Vec<String> = match v.get("scope") {
                None => fallback.to_vec(),
                Some(serde_json::Value::String(s)) => {
                    s.split_whitespace().map(str::to_string).collect()
                }
                Some(_) => {
                    return Err(ApiError::Network(
                        "the account service sent a malformed scope".into(),
                    ))
                }
            };
            Ok(Tokens {
                setup: scopes.iter().any(|s| s == "setup:write"),
                foundations: scopes.iter().any(|s| s == FOUNDATIONS_SCOPE),
                scopes: Some(scopes),
                access_token,
                refresh_token,
                expires_in,
            })
        }
        _ => Err(ApiError::Network(
            "the account service sent an incomplete token answer".into(),
        )),
    }
}

pub fn exchange(
    client: &Client,
    account: &Account,
    token_endpoint: &str,
    pending: &Pending,
    code: &str,
) -> Result<Tokens, ApiError> {
    let resource = account.resource();
    let form = [
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", pending.redirect_uri.as_str()),
        ("code_verifier", pending.verifier()),
        ("client_id", CLIENT_ID),
        ("resource", resource.as_str()),
    ];
    client
        .post_form(token_endpoint, &form)
        .and_then(|v| tokens(v, &pending.requested_scopes))
}

pub fn refresh(
    client: &Client,
    account: &Account,
    token_endpoint: &str,
    refresh_token: &str,
    held_scopes: &[String],
) -> Result<Tokens, ApiError> {
    let resource = account.resource();
    let form = [
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
        ("client_id", CLIENT_ID),
        ("resource", resource.as_str()),
    ];
    client
        .post_form(token_endpoint, &form)
        .and_then(|v| tokens(v, held_scopes))
}

/// RFC 7009: revoking the refresh token ends the grant. Best effort; the
/// local sign-in is already gone when this runs.
pub fn revoke(client: &Client, endpoint: &str, refresh_token: &str) -> Result<(), ApiError> {
    let form = [
        ("token", refresh_token),
        ("token_type_hint", "refresh_token"),
        ("client_id", CLIENT_ID),
    ];
    client.post_form_empty(endpoint, &form)
}

#[cfg(test)]
mod scope_tests {
    use super::*;

    #[test]
    fn feature_scopes_compose_only_when_advertised() {
        for mask in 0..64 {
            let meta = Metadata {
                authorization_endpoint: String::new(),
                token_endpoint: String::new(),
                revocation_endpoint: None,
                health: mask & 1 != 0,
                setup: mask & 2 != 0,
                foundations: mask & 4 != 0,
                design: mask & 8 != 0,
                critiques: mask & 16 != 0,
                journeys: mask & 32 != 0,
            };
            let requested = scopes(&meta);
            let requested: Vec<_> = requested.split_whitespace().collect();
            assert_eq!(&requested[..2], &["account:read", "rules:read"]);
            for (bit, scope) in [
                (1, HEALTH_SCOPE),
                (2, "setup:write"),
                (4, FOUNDATIONS_SCOPE),
                (8, DESIGN_SCOPE),
                (16, CRITIQUES_SCOPE),
                (32, JOURNEYS_SCOPE),
            ] {
                assert_eq!(requested.contains(&scope), mask & bit != 0);
            }
            let granted = tokens(
                serde_json::json!({
                    "access_token": "test-access", "refresh_token": "test-refresh",
                    "expires_in": 900, "token_type": "Bearer", "scope": requested.join(" "),
                }),
                &[],
            )
            .unwrap();
            assert_eq!(granted.setup, meta.setup);
            assert_eq!(granted.foundations, meta.foundations);
            assert_eq!(
                granted
                    .scopes
                    .as_ref()
                    .unwrap()
                    .iter()
                    .any(|s| s == DESIGN_SCOPE),
                meta.design
            );
        }
    }
}

#[cfg(test)]
mod omitted_scope_regressions {
    use super::*;
    #[test]
    fn omitted_scope_preserves_requested_or_held_features() {
        for scope in [
            HEALTH_SCOPE,
            "setup:write",
            FOUNDATIONS_SCOPE,
            DESIGN_SCOPE,
            CRITIQUES_SCOPE,
        ] {
            let fallback = vec![scope.to_string()];
            let grant = tokens(serde_json::json!({"access_token":"test-access", "refresh_token":"test-refresh", "expires_in":900, "token_type":"Bearer"}), &fallback).unwrap();
            assert_eq!(grant.scopes.as_ref(), Some(&fallback), "{scope}");
            assert_eq!(grant.setup, scope == "setup:write");
            assert_eq!(grant.foundations, scope == FOUNDATIONS_SCOPE);
            let narrowed = tokens(serde_json::json!({"access_token":"test-access", "refresh_token":"test-refresh", "expires_in":900, "token_type":"Bearer", "scope":""}), &fallback).unwrap();
            assert_eq!(narrowed.scopes, Some(vec![]));
            assert!(!narrowed.setup && !narrowed.foundations);
        }
    }
}
