//! A signed-in session: the stored tokens, refreshed under the lifecycle lock.
//!
//! The service rotates refresh tokens and treats reuse as theft (it revokes
//! the grant). So a refresh happens only under the lock, after re-reading
//! the store; when another process already rotated (the generation moved),
//! its tokens are adopted instead of spending the old refresh token again.

use crate::config::Account;
use crate::http::{ApiError, Client};
use crate::oauth;
use crate::store::{Backend, Lock, Secret, State, Store};

/// Refresh this long before the access token's stated expiry.
const SKEW_SECS: u64 = 60;

#[derive(Debug, PartialEq, Eq)]
pub enum SessionError {
    /// No sign-in, or a logout happened (the tombstone).
    NotSignedIn,
    /// The service no longer honours the refresh token; signed out locally.
    Expired,
    Api(ApiError),
    Local(String),
}

impl std::fmt::Display for SessionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SessionError::NotSignedIn => f.write_str("not signed in"),
            SessionError::Expired => f.write_str("your sign-in expired"),
            SessionError::Api(e) => write!(f, "{e}"),
            SessionError::Local(e) => f.write_str(e),
        }
    }
}

pub fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub struct Session {
    pub store: Store,
    pub client: Client,
    pub state: State,
    secret: Secret,
}

impl Session {
    pub fn load(account: &Account) -> Result<Session, SessionError> {
        let store = Store::new(account);
        let state = store
            .state()
            .filter(|s| s.signed_in)
            .ok_or(SessionError::NotSignedIn)?;
        let secret = store.secret(&state).ok_or(SessionError::NotSignedIn)?;
        Ok(Session {
            client: Client::new(account),
            store,
            state,
            secret,
        })
    }

    pub fn account(&self) -> &Account {
        &self.store.account
    }

    /// A live access token, refreshing first when it is (nearly) expired.
    pub fn access_token(&mut self) -> Result<String, SessionError> {
        if self.secret.access_expires_at > now() + SKEW_SECS {
            return Ok(self.secret.access_token.clone());
        }
        self.refresh()?;
        Ok(self.secret.access_token.clone())
    }

    /// Rotate the tokens under the lock (see the module note).
    pub fn refresh(&mut self) -> Result<(), SessionError> {
        let lock = self.store.lock().map_err(SessionError::Local)?;
        self.refresh_holding(&lock)
    }

    /// [`Session::refresh`] for a caller that already holds the lock.
    pub fn refresh_holding(&mut self, lock: &Lock) -> Result<(), SessionError> {
        let state = self
            .store
            .state()
            .filter(|s| s.signed_in)
            .ok_or(SessionError::NotSignedIn)?;
        let secret = self.store.secret(&state).ok_or(SessionError::NotSignedIn)?;
        if state.generation != self.state.generation && secret.access_expires_at > now() + SKEW_SECS
        {
            self.state = state;
            self.secret = secret;
            return Ok(());
        }
        match oauth::refresh(
            &self.client,
            self.account(),
            &state.token_endpoint,
            &secret.refresh_token,
        ) {
            Ok(tokens) => {
                let generation = state.generation + 1;
                let next_state = State {
                    generation,
                    ..state
                };
                let next_secret = Secret {
                    generation,
                    refresh_token: tokens.refresh_token,
                    access_token: tokens.access_token,
                    access_expires_at: now() + tokens.expires_in,
                };
                self.store
                    .save(lock, &next_state, &next_secret)
                    .map_err(SessionError::Local)?;
                self.state = next_state;
                self.secret = next_secret;
                Ok(())
            }
            Err(ApiError::Status { status: 400, code })
                if code.as_deref() == Some("invalid_grant") =>
            {
                self.store
                    .sign_out(lock, Some(&state), Backend::File)
                    .map_err(SessionError::Local)?;
                Err(SessionError::Expired)
            }
            Err(e) => Err(SessionError::Api(e)),
        }
    }

    /// An authorized call: on a 401 the tokens are refreshed once and the
    /// call repeated.
    pub fn call<T>(
        &mut self,
        mut f: impl FnMut(&Client, &str) -> Result<T, ApiError>,
    ) -> Result<T, SessionError> {
        let token = self.access_token()?;
        match f(&self.client, &token) {
            Err(ApiError::Status { status: 401, .. }) => {
                self.refresh()?;
                f(&self.client, &self.secret.access_token).map_err(SessionError::Api)
            }
            other => other.map_err(SessionError::Api),
        }
    }

    /// [`Session::call`] for a caller that already holds the lock.
    pub fn call_locked<T>(
        &mut self,
        lock: &Lock,
        mut f: impl FnMut(&Client, &str) -> Result<T, ApiError>,
    ) -> Result<T, SessionError> {
        if self.secret.access_expires_at <= now() + SKEW_SECS {
            self.refresh_holding(lock)?;
        }
        match f(&self.client, &self.secret.access_token) {
            Err(ApiError::Status { status: 401, .. }) => {
                self.refresh_holding(lock)?;
                f(&self.client, &self.secret.access_token).map_err(SessionError::Api)
            }
            other => other.map_err(SessionError::Api),
        }
    }

    pub fn get(&mut self, path: &str) -> Result<serde_json::Value, SessionError> {
        let url = format!("{}{path}", self.account().issuer);
        self.call(|client, token| client.get_json(&url, Some(token)))
    }
}

/// What `/cli/v1/entitlement` says about this account.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entitlement {
    pub pro: bool,
    pub reason: String,
    /// The plan id, when the service names one the catalog knows
    /// (`free`, `pro`, `team`, `enterprise`). Without it, `pro` decides.
    pub plan: Option<String>,
}

pub fn entitlement(session: &mut Session) -> Result<Entitlement, SessionError> {
    let v = session.get("/cli/v1/entitlement")?;
    let pro = v
        .get("pro")
        .and_then(|p| p.as_bool())
        .ok_or_else(|| SessionError::Local("the entitlement answer was malformed".into()))?;
    let reason = v
        .get("reason")
        .and_then(|r| r.as_str())
        .filter(|r| r.len() <= 64 && r.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_'))
        .unwrap_or("unknown")
        .to_string();
    let plan = v
        .get("plan")
        .and_then(|p| p.as_str())
        .filter(|p| crate::plans::known(p))
        .map(str::to_string);
    Ok(Entitlement { pro, reason, plan })
}
