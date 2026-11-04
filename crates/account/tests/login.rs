//! Sign-in lifecycle against a fake account service on 127.0.0.1.
mod support;
use impeccable_account::session::{Session, SessionError};
use impeccable_account::{config::Account, login, logout};
use std::time::Duration;
use support::fake::{browser, Fake};

const WAIT: Duration = Duration::from_secs(10);

#[test]
fn login_round_trip_stores_a_private_sign_in() {
    // Catches: a sign-in that never completes the code exchange or stores nothing usable.
    let fake = Fake::start();
    let env = fake.env("round-trip");
    let done = login(&env, &mut |url| browser(url), WAIT).expect("login");
    assert_eq!(done.entitlement.unwrap().pro, true);
    let account = Account::from_env(&env).unwrap();
    assert!(Session::load(&account).is_ok());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(account.dir().join("credentials.json"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}

#[test]
fn a_forged_callback_is_refused_before_any_code_exchange() {
    // Catches: accepting an answer from another issuer (mix-up) or another request (CSRF).
    for (name, iss, state) in [
        ("iss", Some("http://127.0.0.1:1"), None),
        ("state", None, Some("forged")),
    ] {
        let fake = Fake::start();
        {
            let mut k = fake.knobs.lock().unwrap();
            k.callback_iss = iss.map(str::to_string);
            k.callback_state = state.map(str::to_string);
        }
        let env = fake.env(&format!("forged-{name}"));
        assert!(
            login(&env, &mut |url| browser(url), WAIT).is_err(),
            "{name}"
        );
        assert_eq!(fake.hits("/oauth/token"), 0, "{name}");
        assert_eq!(
            Session::load(&Account::from_env(&env).unwrap()).err(),
            Some(SessionError::NotSignedIn)
        );
    }
}

#[test]
fn logout_tombstone_stops_a_refresh_that_read_before_it() {
    // Catches: a refresh in flight during logout resurrecting the sign-in.
    let fake = Fake::start();
    let env = fake.env("tombstone");
    login(&env, &mut |url| browser(url), WAIT).unwrap();
    let account = Account::from_env(&env).unwrap();
    let mut stale = Session::load(&account).unwrap();
    assert!(logout(&env).unwrap().is_some());
    assert_eq!(fake.record.lock().unwrap().revoked.len(), 1);
    assert_eq!(stale.refresh(), Err(SessionError::NotSignedIn));
    assert_eq!(
        Session::load(&account).err(),
        Some(SessionError::NotSignedIn)
    );
    assert_eq!(fake.hits("/oauth/token"), 1, "only the code exchange");
}

#[test]
fn a_second_process_adopts_rotated_tokens_instead_of_reusing_the_old_refresh_token() {
    // Catches: two processes refreshing with one token, which the service treats as theft and revokes.
    let fake = Fake::start();
    let env = fake.env("rotation");
    login(&env, &mut |url| browser(url), WAIT).unwrap();
    let account = Account::from_env(&env).unwrap();
    let (mut a, mut b) = (
        Session::load(&account).unwrap(),
        Session::load(&account).unwrap(),
    );
    a.refresh().unwrap();
    b.refresh().unwrap();
    assert_eq!(
        fake.hits("/oauth/token"),
        2,
        "code exchange plus one refresh"
    );
    assert!(
        impeccable_account::session::entitlement(&mut b)
            .unwrap()
            .pro
    );
}
