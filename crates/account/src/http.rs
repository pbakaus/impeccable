//! HTTP to the account service. Nothing here logs a request: bodies carry
//! codes, verifiers and tokens, and errors keep only a status and the
//! service's machine-readable `error` code.

use crate::config::Account;
use std::io::Read;
use std::time::Duration;

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

pub struct Client {
    agent: ureq::Agent,
}

/// Largest JSON answer read from the service.
const MAX_JSON: u64 = 1024 * 1024;

impl Client {
    pub fn new(account: &Account) -> Client {
        // A loopback rehearsal must not be sent to a corporate proxy.
        let builder = if account.is_loopback() {
            ureq::AgentBuilder::new()
        } else {
            impeccable_context::http::agent_builder()
        };
        let agent = builder
            .timeout_connect(Duration::from_secs(10))
            .timeout_read(Duration::from_secs(30))
            .redirects(0)
            .build();
        Client { agent }
    }

    pub fn get_json(&self, url: &str, bearer: Option<&str>) -> Result<serde_json::Value, ApiError> {
        let mut req = self.agent.get(url).set("accept", "application/json");
        if let Some(token) = bearer {
            req = req.set("authorization", &format!("Bearer {token}"));
        }
        json_body(req.call())
    }

    pub fn post_form(
        &self,
        url: &str,
        form: &[(&str, &str)],
    ) -> Result<serde_json::Value, ApiError> {
        let req = self.agent.post(url).set("accept", "application/json");
        json_body(req.send_form(form))
    }

    /// A form POST whose answer has no body worth reading (revocation).
    pub fn post_form_empty(&self, url: &str, form: &[(&str, &str)]) -> Result<(), ApiError> {
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
        let req = self
            .agent
            .post(url)
            .set("accept", "application/json")
            .set("authorization", &format!("Bearer {bearer}"));
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
        let resp = self
            .agent
            .get(url)
            .set("authorization", &format!("Bearer {bearer}"))
            .call()
            .map_err(classify)?;
        let value = header.and_then(|h| resp.header(h)).map(str::to_string);
        let mut buf = Vec::new();
        resp.into_reader()
            .take(max + 1)
            .read_to_end(&mut buf)
            .map_err(|e| ApiError::Network(e.to_string()))?;
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
        .map_err(|e| ApiError::Network(e.to_string()))?;
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
        // Transport errors name the URL, never a body; our URLs carry no secret.
        ureq::Error::Transport(t) => ApiError::Network(t.to_string()),
    }
}
