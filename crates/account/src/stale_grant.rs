//! One fresh-sign-in notice shared by all uploads on this issuer and login.
use crate::{
    config::Account,
    http::Client,
    oauth,
    store::{self, State, Store},
};
use impeccable_common::Io;
use std::time::Duration;

const NOTICE: &str = "Saving to your Impeccable account needs a fresh sign-in. Run impeccable login to turn it on.\n";
const DEADLINE: Duration = Duration::from_secs(2);

/// `within` is what is left of the caller's own wait: the check never extends it.
pub(crate) fn offers(account: &Account, scope: &str, within: Duration) -> bool {
    if within.is_zero() {
        return false;
    }
    let account = account.clone();
    let scope = scope.to_string();
    // Metadata is a credential-free read. Bound DNS as well as HTTP without
    // leaving an upload running after the caller stops waiting.
    crate::session::read_within(within, move || {
        oauth::metadata(&Client::with_deadline(&account, within), &account).is_ok_and(|m| {
            match scope.as_str() {
                oauth::HEALTH_SCOPE => m.health,
                oauth::FOUNDATIONS_SCOPE => m.foundations,
                oauth::DESIGN_SCOPE => m.design,
                oauth::CRITIQUES_SCOPE => m.critiques,
                "setup:write" => m.setup,
                _ => false,
            }
        })
    })
    .unwrap_or(false)
}

fn denied_path(account: &Account, login: u64) -> std::path::PathBuf {
    account.dir().join(format!("health-denied-{login}"))
}

/// The service refused this sign-in's health upload (403). Sign-ins from
/// before 4.9 stored no scopes, so for health only a refusal is evidence.
pub(crate) fn note_health_denied(account: &Account, login: u64) {
    let _ = store::write_private(&denied_path(account, login), b"403");
}

fn holds(account: &Account, state: &State, scope: &str) -> bool {
    match scope {
        oauth::HEALTH_SCOPE => store::read_private(&denied_path(account, state.login))
            .ok()
            .flatten()
            .is_none(),
        oauth::FOUNDATIONS_SCOPE => state.foundations,
        "setup:write" => store::read_private(&account.dir().join("setup-grant.json"))
            .ok()
            .flatten()
            .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
            .is_some_and(|g| g["login"] == state.login && g["allowed"] == true),
        _ => state.scopes.iter().any(|s| s == scope),
    }
}

pub(crate) fn status(io: &Io, scope: &str) -> bool {
    let Ok(account) = Account::from_env(&io.env) else {
        return false;
    };
    Store::new(&account)
        .state()
        .is_some_and(|s| {
            s.signed_in && !holds(&account, &s, scope) && offers(&account, scope, DEADLINE)
        })
}

/// `scope` is absent for a health 403, which is itself enough evidence.
/// `within` is what is left of the upload's wait; with none left the notice stays owed.
pub(crate) fn emit(
    io: &mut Io,
    account: &Account,
    login: u64,
    scope: Option<&str>,
    within: Duration,
    quiet: bool,
) {
    if quiet {
        return;
    }
    let store = Store::new(account);
    let path = account.dir().join(format!("stale-grant-notice-{login}"));
    let shown = || store::read_private(&path).ok().flatten().is_some();
    if shown() {
        return;
    }
    // The metadata read happens before the sign-in lock, so a slow service
    // never holds up a concurrent sign-in or token refresh.
    if scope.is_some_and(|s| !offers(account, s, within)) {
        return;
    }
    // Serialize across features and processes, and reject a replaced sign-in.
    let Ok(_lock) = store.lock_for(Duration::ZERO) else {
        return;
    };
    if shown()
        || !store.state().is_some_and(|s| {
            s.signed_in && s.login == login && scope.is_none_or(|scope| !holds(account, &s, scope))
        })
    {
        return;
    }
    // Do not print if persistence fails: this notice must be at most once.
    if store::write_private(&path, b"shown").is_ok() {
        io.err(NOTICE);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state(account: &Account, login: u64) -> State {
        State {
            schema: 1,
            foundations: false,
            scopes: vec![],
            issuer: account.issuer.clone(),
            generation: login,
            signed_in: true,
            backend: store::Backend::File,
            token_endpoint: format!("{}/oauth/token", account.issuer),
            revocation_endpoint: None,
            login,
            signed_out_at: 0,
        }
    }

    #[test]
    fn quiet_leaves_notice_owed_and_features_share_one_marker_per_sign_in() {
        let home = std::env::temp_dir().join(format!("stale-notice-{}", oauth::random_b64(12)));
        let account = Account {
            home: home.clone(),
            issuer: "http://127.0.0.1:1".into(),
        };
        let store = Store::new(&account);
        let lock = store.lock().unwrap();
        store.write_state(&state(&account, 1)).unwrap();
        drop(lock);
        let (mut io, cap) = Io::captured("", home.clone(), Default::default());
        emit(&mut io, &account, 1, None, DEADLINE, true);
        assert!(cap.stderr.borrow().is_empty());
        emit(&mut io, &account, 1, None, DEADLINE, false);
        assert_eq!(&*cap.stderr.borrow(), NOTICE.as_bytes());
        // A scope-gated feature shares health's marker, without metadata I/O.
        emit(&mut io, &account, 1, Some(oauth::CRITIQUES_SCOPE), DEADLINE, false);
        emit(&mut io, &account, 1, None, DEADLINE, false);
        assert_eq!(&*cap.stderr.borrow(), NOTICE.as_bytes());
        store.write_state(&state(&account, 2)).unwrap();
        emit(&mut io, &account, 1, None, DEADLINE, false);
        assert_eq!(&*cap.stderr.borrow(), NOTICE.as_bytes());
        emit(&mut io, &account, 2, None, DEADLINE, false);
        assert_eq!(&*cap.stderr.borrow(), NOTICE.repeat(2).as_bytes());
        std::fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn no_time_left_skips_the_metadata_read_and_leaves_the_notice_owed() {
        // Catches (review, Greptile on 44c6aa146): the check starting a fresh
        // two-second wait after the upload had already spent its own.
        let home = std::env::temp_dir().join(format!("stale-budget-{}", oauth::random_b64(12)));
        // A non-routable address: any metadata read here would hang, not fail fast.
        let account = Account {
            home: home.clone(),
            issuer: "http://10.255.255.1".into(),
        };
        let store = Store::new(&account);
        let lock = store.lock().unwrap();
        store.write_state(&state(&account, 1)).unwrap();
        drop(lock);
        let started = std::time::Instant::now();
        assert!(!offers(&account, oauth::CRITIQUES_SCOPE, Duration::ZERO));
        let (mut io, cap) = Io::captured("", home.clone(), Default::default());
        emit(&mut io, &account, 1, Some(oauth::CRITIQUES_SCOPE), Duration::ZERO, false);
        assert!(started.elapsed() < Duration::from_millis(500));
        assert!(cap.stderr.borrow().is_empty());
        assert!(!account.dir().join("stale-grant-notice-1").exists());
        std::fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn concurrent_features_print_at_most_once() {
        let home = std::env::temp_dir().join(format!("stale-race-{}", oauth::random_b64(12)));
        let account = Account {
            home: home.clone(),
            issuer: "http://127.0.0.1:1".into(),
        };
        let store = Store::new(&account);
        let lock = store.lock().unwrap();
        store.write_state(&state(&account, 1)).unwrap();
        drop(lock);
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(8));
        let workers: Vec<_> = (0..8)
            .map(|_| {
                let account = account.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    let (mut io, cap) = Io::captured("", account.home.clone(), Default::default());
                    barrier.wait();
                    emit(&mut io, &account, 1, None, DEADLINE, false);
                    let output = cap.stderr.borrow().clone();
                    output
                })
            })
            .collect();
        let output: Vec<_> = workers
            .into_iter()
            .flat_map(|w| w.join().unwrap())
            .collect();
        assert_eq!(output, NOTICE.as_bytes());
        std::fs::remove_dir_all(home).unwrap();
    }
}
