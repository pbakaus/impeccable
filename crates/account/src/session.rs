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
    noninteractive: bool,
}

impl Session {
    pub fn load(account: &Account) -> Result<Session, SessionError> {
        let store = Store::new(account);
        let state = store
            .try_state()
            .map_err(SessionError::Local)?
            .filter(|s| s.signed_in)
            .ok_or(SessionError::NotSignedIn)?;
        let secret = store
            .try_secret(&state)
            .map_err(SessionError::Local)?
            .ok_or(SessionError::NotSignedIn)?;
        Ok(Session {
            client: Client::new(account),
            store,
            state,
            secret,
            noninteractive: false,
        })
    }

    /// Read existing credentials without prompting, with a caller-owned deadline.
    /// The worker only reads; timing out cannot rotate tokens or upload later.
    pub(crate) fn load_for_upload(account: &Account, wait: std::time::Duration) -> Option<Session> {
        let account = account.clone();
        read_within(wait, move || {
            let store = Store::new(&account);
            let _lock = store.lock_for(std::time::Duration::ZERO).ok()?;
            Self::load_for_upload_locked(&account)
        })
        .flatten()
    }

    /// Renewal may advance the generation, but must retain this upload's login lineage.
    pub(crate) fn matches_upload(&self, original: &State) -> bool {
        self.state.signed_in
            && original.signed_in
            && self.state.issuer == original.issuer
            && self.state.login == original.login
            && self.state.signed_out_at == original.signed_out_at
            && self.state.generation >= original.generation
            && self.secret.generation == self.state.generation
    }

    /// Caller already holds the lifecycle lock.
    pub(crate) fn load_for_upload_locked(account: &Account) -> Option<Session> {
        let store = Store::new(account);
        let state = store.try_state().ok()??;
        if !state.signed_in {
            return None;
        }
        let secret = store.try_secret_noninteractive(&state).ok()??;
        // Never adopt the secret-first crash window of a replacement login.
        if secret.generation != state.generation {
            return None;
        }
        Some(Session {
            client: Client::new(account),
            store,
            state,
            secret,
            noninteractive: true,
        })
    }

    /// Uploads with a short deadline skip refresh rather than risk losing a rotated token.
    pub fn existing_access_token(&self) -> Option<&str> {
        (self.secret.access_expires_at > now() + SKEW_SECS)
            .then_some(self.secret.access_token.as_str())
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

    /// [`Session::access_token`] for a caller that would rather fail than
    /// wait more than `wait` for another command's sign-in step.
    pub fn access_token_within(
        &mut self,
        wait: std::time::Duration,
    ) -> Result<String, SessionError> {
        if self.secret.access_expires_at > now() + SKEW_SECS {
            return Ok(self.secret.access_token.clone());
        }
        let lock = self.store.lock_for(wait).map_err(SessionError::Local)?;
        self.refresh_holding(&lock)?;
        Ok(self.secret.access_token.clone())
    }

    /// A token for a caller already holding the lifecycle lock.
    pub fn access_token_locked(&mut self, lock: &Lock) -> Result<String, SessionError> {
        if self.secret.access_expires_at <= now() + SKEW_SECS {
            self.refresh_holding(lock)?;
        }
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
        let secret = if self.noninteractive {
            self.store
                .try_secret_noninteractive(&state)
                .map_err(SessionError::Local)?
        } else {
            self.store.secret(&state)
        }
        .ok_or(SessionError::NotSignedIn)?;
        if self.noninteractive && secret.generation != state.generation {
            return Err(SessionError::NotSignedIn);
        }
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
            &state.scopes,
        ) {
            Ok(tokens) => {
                let generation = state.generation + 1;
                let next_state = State {
                    foundations: tokens.foundations,
                    taste: tokens.taste,
                    scopes: tokens.scopes.unwrap_or_else(|| state.scopes.clone()),
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

pub(crate) fn read_within<T: Send + 'static>(
    wait: std::time::Duration,
    read: impl FnOnce() -> T + Send + 'static,
) -> Option<T> {
    let (send, receive) = std::sync::mpsc::sync_channel(1);
    std::thread::Builder::new()
        .spawn(move || {
            let _ = send.send(read());
        })
        .ok()?;
    receive.recv_timeout(wait).ok()
}

#[cfg(test)]
mod upload_refresh_tests {
    use super::*;
    #[test]
    fn upload_renewal_rechecks_generations_under_its_lock() {
        let home = std::env::temp_dir().join(format!(
            "design-renew-snapshot-{}",
            crate::oauth::random_b64(12)
        ));
        struct Cleanup(std::path::PathBuf);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
        let _cleanup = Cleanup(home.clone());
        let account = Account {
            issuer: "http://127.0.0.1:1".into(),
            home,
        };
        let store = Store::new(&account);
        let state = State {
            schema: 1,
            foundations: false,
            taste: false,
            scopes: vec![],
            issuer: account.issuer.clone(),
            generation: 1,
            signed_in: true,
            backend: Backend::File,
            token_endpoint: format!("{}/oauth/token", account.issuer),
            revocation_endpoint: None,
            login: 1,
            signed_out_at: 0,
        };
        let mut secret = Secret {
            generation: 1,
            refresh_token: "test-refresh".into(),
            access_token: "test-access".into(),
            access_expires_at: 0,
        };
        let lock = store.lock().unwrap();
        store.save(&lock, &state, &secret).unwrap();
        drop(lock);
        let mut session =
            Session::load_for_upload(&account, std::time::Duration::from_secs(1)).unwrap();
        let lock = session.store.lock().unwrap();
        secret.generation = 2;
        session.store.save(&lock, &state, &secret).unwrap();
        assert_eq!(
            session.refresh_holding(&lock),
            Err(SessionError::NotSignedIn)
        );
    }
}

#[cfg(test)]
mod upload_budget_tests {
    #[test]
    fn a_stalled_credential_backend_does_not_hold_the_caller() {
        let start = std::time::Instant::now();
        let result = super::read_within(std::time::Duration::from_millis(20), || {
            std::thread::sleep(std::time::Duration::from_secs(1));
            7
        });
        assert!(start.elapsed() < std::time::Duration::from_millis(500));
        assert!(result.is_none());
    }
}

/// Only renewal runs independently. No body, upload request, or sync admission
/// is handed to this process. Once rotation starts it keeps the ordinary client
/// timeout and persists under the lifecycle lock even if the parent has exited.
pub(crate) fn renew_for_upload(
    io: &impeccable_common::Io,
    account: &Account,
    started: std::time::Instant,
    verb: &str,
) -> Option<Session> {
    use std::process::{Command, Stdio};
    let mut command = Command::new(std::env::current_exe().ok()?);
    command
        .arg(verb)
        .env_clear()
        .envs(&io.env)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    impeccable_common::proc::detach(&mut command);
    #[cfg(windows)]
    prevent_refresh_stdio_inheritance()?;
    let mut child = command.spawn().ok()?;
    loop {
        if child.try_wait().ok()?.is_some() {
            let left = std::time::Duration::from_secs(2).checked_sub(started.elapsed())?;
            return Session::load_for_upload(account, left);
        }
        if started.elapsed() >= std::time::Duration::from_secs(2) {
            // Reap when possible, but never kill a rotation in flight.
            let _ = std::thread::Builder::new().spawn(move || {
                let _ = child.wait();
            });
            return None;
        }
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
}

/// Hidden renewal-only verb. A busy lifecycle lock skips renewal immediately.
pub(crate) fn run_upload_refresh(args: &[String], io: &mut impeccable_common::Io) -> i32 {
    if !args.is_empty() {
        return 1;
    }
    let Ok(account) = Account::from_env(&io.env) else {
        return 0;
    };
    let Some(mut session) = Session::load_for_upload(&account, std::time::Duration::from_secs(2))
    else {
        return 0;
    };
    let _ = session.access_token_within(std::time::Duration::ZERO);
    0
}

/// A detached Windows child can inherit the CLI's original capture-pipe
/// handles even with its own stdio redirected to NUL. That keeps a harness's
/// output() waiting for EOF until renewal ends. Clearing only inheritance
/// leaves the parent's streams usable and keeps renewal independent of them.
#[cfg(windows)]
fn prevent_refresh_stdio_inheritance() -> Option<()> {
    use std::ffi::c_void;
    #[link(name = "kernel32")]
    extern "system" {
        fn GetStdHandle(kind: u32) -> *mut c_void;
        fn GetFileType(handle: *mut c_void) -> u32;
        fn SetHandleInformation(handle: *mut c_void, mask: u32, flags: u32) -> i32;
    }
    for kind in [-10i32, -11, -12] {
        // SAFETY: these are the three documented standard-handle selectors.
        // We change no ownership and clear only HANDLE_FLAG_INHERIT.
        unsafe {
            let handle = GetStdHandle(kind as u32);
            // Only capture pipes need EOF isolation; console handles are left alone.
            if !handle.is_null()
                && handle as isize != -1
                && GetFileType(handle) == 3
                && SetHandleInformation(handle, 1, 0) == 0
            {
                return None;
            }
        }
    }
    Some(())
}

#[cfg(test)]
mod review_regressions {
    use super::*;
    fn fixture() -> (Account, State, Secret) {
        let account = Account {
            issuer: "http://127.0.0.1:1".into(),
            home: std::env::temp_dir().join(format!("review-session-{}", oauth::random_b64(12))),
        };
        let state = State {
            schema: 1,
            foundations: false,
            taste: false,
            scopes: vec![],
            issuer: account.issuer.clone(),
            generation: 3,
            signed_in: true,
            backend: Backend::File,
            token_endpoint: format!("{}/oauth/token", account.issuer),
            revocation_endpoint: None,
            login: 1,
            signed_out_at: 0,
        };
        let secret = Secret {
            generation: 3,
            access_token: "test-access".into(),
            refresh_token: "test-refresh".into(),
            access_expires_at: now() + 900,
        };
        (account, state, secret)
    }
    #[test]
    fn upload_cannot_adopt_another_login_or_generation_lineage() {
        let (account, state, secret) = fixture();
        let store = Store::new(&account);
        let lock = store.lock().unwrap();
        store.save(&lock, &state, &secret).unwrap();
        drop(lock);
        let session =
            Session::load_for_upload(&account, std::time::Duration::from_secs(1)).unwrap();
        assert!(session.matches_upload(&state));
        let mut earlier = state.clone();
        earlier.generation -= 1;
        assert!(
            session.matches_upload(&earlier),
            "ordinary refresh is allowed"
        );
        let mut original = state.clone();
        original.login += 1;
        assert!(!session.matches_upload(&original));
        original = state.clone();
        original.generation += 1;
        assert!(
            !session.matches_upload(&original),
            "generation must not go backwards"
        );
        original = state.clone();
        original.signed_out_at = 2;
        assert!(!session.matches_upload(&original), "logout lineage changed");
        std::fs::remove_dir_all(account.home).unwrap();
    }
    #[test]
    fn setup_locked_loader_is_noninteractive_and_rejects_mismatched_generations() {
        let (account, state, mut secret) = fixture();
        let store = Store::new(&account);
        let lock = store.lock().unwrap();
        store.save(&lock, &state, &secret).unwrap();
        assert!(
            Session::load_for_upload_locked(&account)
                .unwrap()
                .noninteractive
        );
        secret.generation += 1;
        store.save(&lock, &state, &secret).unwrap();
        assert!(Session::load_for_upload_locked(&account).is_none());
        drop(lock);
        std::fs::remove_dir_all(account.home).unwrap();
    }
}
