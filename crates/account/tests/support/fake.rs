//! A fake Impeccable account service on 127.0.0.1 for tests: OAuth metadata,
//! the consent dialog (which approves at once), the token endpoint with
//! refresh rotation and reuse detection, revocation, and the CLI resource.
#![allow(dead_code)]

use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Default)]
pub struct Knobs {
    /// The `iss` the consent dialog sends back (default: the issuer).
    pub callback_iss: Option<String>,
    /// The `state` it sends back (default: the request's).
    pub callback_state: Option<String>,
    pub entitled: bool,
    pub access_ttl: u64,
    /// Extra routes, answered before the built-in ones:
    /// `(method, path) -> (status, headers, body)`.
    pub routes: HashMap<(String, String), (u16, Vec<(String, String)>, Vec<u8>)>,
}

#[derive(Default)]
pub struct Record {
    pub hits: HashMap<String, usize>,
    pub revoked: Vec<String>,
    codes: HashMap<String, (String, String)>,
    live_refresh: HashSet<String>,
    spent_refresh: HashSet<String>,
    access: HashSet<String>,
    next: u64,
}

pub struct Fake {
    pub url: String,
    pub knobs: Arc<Mutex<Knobs>>,
    pub record: Arc<Mutex<Record>>,
}

impl Fake {
    pub fn start() -> Fake {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let knobs = Arc::new(Mutex::new(Knobs {
            entitled: true,
            access_ttl: 900,
            ..Default::default()
        }));
        let record = Arc::new(Mutex::new(Record::default()));
        let (k, r, u) = (knobs.clone(), record.clone(), url.clone());
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let (k, r, u) = (k.clone(), r.clone(), u.clone());
                std::thread::spawn(move || serve(stream, &u, &k, &r));
            }
        });
        Fake { url, knobs, record }
    }

    pub fn hits(&self, path: &str) -> usize {
        *self.record.lock().unwrap().hits.get(path).unwrap_or(&0)
    }

    pub fn route(
        &self,
        method: &str,
        path: &str,
        status: u16,
        headers: Vec<(&str, String)>,
        body: impl Into<Vec<u8>>,
    ) {
        self.knobs.lock().unwrap().routes.insert(
            (method.into(), path.into()),
            (
                status,
                headers
                    .into_iter()
                    .map(|(a, b)| (a.to_string(), b))
                    .collect(),
                body.into(),
            ),
        );
    }

    /// An env for one test: a fresh IMPECCABLE_HOME, this service, the file backend.
    pub fn env(&self, name: &str) -> HashMap<String, String> {
        let home = temp_home(name);
        HashMap::from([
            (
                "IMPECCABLE_HOME".to_string(),
                home.to_string_lossy().into_owned(),
            ),
            ("IMPECCABLE_ACCOUNT_URL".to_string(), self.url.clone()),
            (
                "IMPECCABLE_CREDENTIAL_STORE".to_string(),
                "file".to_string(),
            ),
            ("HOME".to_string(), home.to_string_lossy().into_owned()),
        ])
    }
}

pub fn temp_home(name: &str) -> PathBuf {
    let dir =
        std::env::temp_dir().join(format!("impeccable-account-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// What a browser does with the authorization URL: follow the consent
/// dialog's redirect to the loopback callback. On a thread, since the CLI
/// is waiting on that callback.
pub fn browser(url: &str) {
    let url = url.to_string();
    std::thread::spawn(move || {
        let _ = ureq::AgentBuilder::new()
            .redirects(5)
            .build()
            .get(&url)
            .call();
    });
}

fn b64(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn serve(mut stream: TcpStream, issuer: &str, knobs: &Mutex<Knobs>, record: &Mutex<Record>) {
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    let mut line = String::new();
    if reader.read_line(&mut line).is_err() {
        return;
    }
    let mut parts = line.split_whitespace();
    let (method, target) = (
        parts.next().unwrap_or("").to_string(),
        parts.next().unwrap_or("").to_string(),
    );
    let mut headers = HashMap::new();
    loop {
        let mut h = String::new();
        if reader.read_line(&mut h).is_err() || h == "\r\n" || h.is_empty() {
            break;
        }
        if let Some((k, v)) = h.trim_end().split_once(':') {
            headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }
    let len: usize = headers
        .get("content-length")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let mut body = vec![0; len];
    let _ = reader.read_exact(&mut body);
    let (path, query) = target.split_once('?').unwrap_or((&target, ""));
    *record
        .lock()
        .unwrap()
        .hits
        .entry(path.to_string())
        .or_default() += 1;
    let q: HashMap<String, String> = url::form_urlencoded::parse(query.as_bytes())
        .into_owned()
        .collect();
    let form: HashMap<String, String> = url::form_urlencoded::parse(&body).into_owned().collect();
    let bearer = headers
        .get("authorization")
        .and_then(|a| a.strip_prefix("Bearer "))
        .map(str::to_string);

    let custom = knobs
        .lock()
        .unwrap()
        .routes
        .get(&(method.clone(), path.to_string()))
        .cloned();
    let (status, extra, out): (u16, Vec<(String, String)>, Vec<u8>) = if let Some(c) = custom {
        let authorized = bearer
            .as_ref()
            .is_some_and(|t| record.lock().unwrap().access.contains(t));
        if path.starts_with("/cli/") && !authorized {
            (401, vec![], vec![])
        } else {
            c
        }
    } else {
        match (method.as_str(), path) {
            ("GET", "/.well-known/oauth-authorization-server") => json(
                200,
                serde_json::json!({
                    "issuer": issuer,
                    "authorization_endpoint": format!("{issuer}/app/oauth/authorize"),
                    "token_endpoint": format!("{issuer}/oauth/token"),
                    "revocation_endpoint": format!("{issuer}/oauth/revoke"),
                    "code_challenge_methods_supported": ["S256"],
                    "authorization_response_iss_parameter_supported": true,
                }),
            ),
            ("GET", "/app/oauth/authorize") => {
                let redirect = q.get("redirect_uri").cloned().unwrap_or_default();
                let ok = q.get("client_id").map(String::as_str) == Some("impeccable-cli")
                    && q.get("resource") == Some(&format!("{issuer}/cli"))
                    && q.get("code_challenge_method").map(String::as_str) == Some("S256")
                    && q.get("code_challenge").is_some_and(|c| c.len() == 43)
                    && q.get("scope").map(String::as_str) == Some("account:read rules:read")
                    && redirect.starts_with("http://127.0.0.1:")
                    && redirect.ends_with("/callback");
                if !ok {
                    (400, vec![], b"bad authorize request".to_vec())
                } else {
                    let k = knobs.lock().unwrap();
                    let mut r = record.lock().unwrap();
                    r.next += 1;
                    let code = format!("code-{}", r.next);
                    r.codes.insert(
                        code.clone(),
                        (q["code_challenge"].clone(), redirect.clone()),
                    );
                    let mut loc = url::Url::parse(&redirect).unwrap();
                    loc.query_pairs_mut()
                        .append_pair("code", &code)
                        .append_pair(
                            "state",
                            k.callback_state
                                .as_deref()
                                .unwrap_or(q.get("state").map(String::as_str).unwrap_or("")),
                        )
                        .append_pair("iss", k.callback_iss.as_deref().unwrap_or(issuer));
                    (303, vec![("location".into(), loc.to_string())], vec![])
                }
            }
            ("POST", "/oauth/token") => token(&form, issuer, knobs, record),
            ("POST", "/oauth/revoke") => {
                record
                    .lock()
                    .unwrap()
                    .revoked
                    .push(form.get("token").cloned().unwrap_or_default());
                (200, vec![], vec![])
            }
            ("GET", "/cli/v1/entitlement") => {
                if !bearer.is_some_and(|t| record.lock().unwrap().access.contains(&t)) {
                    (401, vec![], vec![])
                } else if knobs.lock().unwrap().entitled {
                    json(
                        200,
                        serde_json::json!({ "pro": true, "reason": "operator" }),
                    )
                } else {
                    json(
                        200,
                        serde_json::json!({ "pro": false, "reason": "not_entitled" }),
                    )
                }
            }
            _ => (404, vec![], vec![]),
        }
    };
    let mut head = format!(
        "HTTP/1.1 {status} X\r\ncontent-length: {}\r\nconnection: close\r\n",
        out.len()
    );
    for (k, v) in extra {
        head.push_str(&format!("{k}: {v}\r\n"));
    }
    head.push_str("\r\n");
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(&out);
}

fn json(status: u16, v: serde_json::Value) -> (u16, Vec<(String, String)>, Vec<u8>) {
    (
        status,
        vec![("content-type".into(), "application/json".into())],
        v.to_string().into_bytes(),
    )
}

fn token(
    form: &HashMap<String, String>,
    issuer: &str,
    knobs: &Mutex<Knobs>,
    record: &Mutex<Record>,
) -> (u16, Vec<(String, String)>, Vec<u8>) {
    let invalid = || json(400, serde_json::json!({ "error": "invalid_grant" }));
    if form.get("client_id").map(String::as_str) != Some("impeccable-cli")
        || form.get("resource") != Some(&format!("{issuer}/cli"))
    {
        return json(400, serde_json::json!({ "error": "invalid_target" }));
    }
    let ttl = knobs.lock().unwrap().access_ttl;
    let mut r = record.lock().unwrap();
    match form.get("grant_type").map(String::as_str) {
        Some("authorization_code") => {
            let Some((challenge, redirect)) = form.get("code").and_then(|c| r.codes.remove(c))
            else {
                return invalid();
            };
            let verifier = form.get("code_verifier").cloned().unwrap_or_default();
            if b64(&Sha256::digest(verifier.as_bytes())) != challenge
                || form.get("redirect_uri") != Some(&redirect)
            {
                return invalid();
            }
        }
        Some("refresh_token") => {
            let t = form.get("refresh_token").cloned().unwrap_or_default();
            if r.spent_refresh.contains(&t) {
                // Reuse: the real service revokes the whole grant.
                r.live_refresh.clear();
                r.access.clear();
                return invalid();
            }
            if !r.live_refresh.remove(&t) {
                return invalid();
            }
            r.spent_refresh.insert(t);
        }
        _ => {
            return json(
                400,
                serde_json::json!({ "error": "unsupported_grant_type" }),
            )
        }
    }
    r.next += 1;
    let (access, refresh) = (format!("at-{}", r.next), format!("rt-{}", r.next));
    r.access.insert(access.clone());
    r.live_refresh.insert(refresh.clone());
    json(
        200,
        serde_json::json!({ "access_token": access, "token_type": "Bearer", "expires_in": ttl, "refresh_token": refresh, "scope": "account:read rules:read" }),
    )
}
