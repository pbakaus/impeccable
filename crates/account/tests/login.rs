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

/// The loopback redirect (`http://127.0.0.1:<port>/callback`) in an
/// authorization URL.
fn redirect_uri(url: &str) -> String {
    url::Url::parse(url)
        .unwrap()
        .query_pairs()
        .find(|(k, _)| k == "redirect_uri")
        .unwrap()
        .1
        .into_owned()
}

#[test]
fn a_forged_callback_is_refused_before_any_code_exchange() {
    // Catches: accepting an answer from another issuer (mix-up) or another request (CSRF).
    // A forged `state` is ignored (the attempt then times out); a wrong `iss` on this
    // attempt's `state` ends it.
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
            login(&env, &mut |url| browser(url), Duration::from_secs(2)).is_err(),
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

#[test]
fn a_callback_without_this_attempts_state_does_not_end_the_sign_in() {
    // Catches: any local process that finds the port ending the login with a bare /callback.
    let fake = Fake::start();
    let env = fake.env("bare-callback");
    let done = login(
        &env,
        &mut |url| {
            // Off this thread: `wait` only starts answering once the browser hook returns.
            let (url, callback) = (url.to_string(), redirect_uri(url));
            std::thread::spawn(move || {
                let _ = ureq::get(&callback).call();
                let _ = ureq::get(&format!("{callback}?state=guess&code=x")).call();
                browser(&url);
            });
        },
        WAIT,
    );
    assert!(done.is_ok(), "{:?}", done.err());
    assert_eq!(
        fake.hits("/oauth/token"),
        1,
        "only the real code is exchanged"
    );
}

#[test]
fn a_stalled_local_connection_does_not_hold_up_the_browser() {
    // Catches: a connection that trickles its request head blocking the real callback.
    use std::io::Write;
    let fake = Fake::start();
    let env = fake.env("stalled");
    let mut held = None;
    let done = login(
        &env,
        &mut |url| {
            let host = url::Url::parse(&redirect_uri(url)).unwrap();
            let addr = format!("{}:{}", host.host_str().unwrap(), host.port().unwrap());
            let mut s = std::net::TcpStream::connect(addr).unwrap();
            s.write_all(b"GET /callback?st").unwrap();
            held = Some(s);
            browser(url)
        },
        WAIT,
    );
    assert!(done.is_ok(), "{:?}", done.err());
    drop(held);
}

#[test]
fn a_logout_while_the_browser_is_open_is_not_undone_by_the_sign_in() {
    // Catches: a sign-in that finishes after `logout` signing the machine back in.
    let fake = Fake::start();
    let env = fake.env("logout-during-login");
    let account = Account::from_env(&env).unwrap();
    let done = login(
        &env,
        &mut |url| {
            assert!(logout(&env).unwrap().is_none());
            browser(url)
        },
        WAIT,
    );
    assert!(done.is_err());
    assert_eq!(
        Session::load(&account).err(),
        Some(SessionError::NotSignedIn)
    );
    assert_eq!(
        fake.record.lock().unwrap().revoked.len(),
        1,
        "the tokens the late sign-in got are revoked"
    );
}

#[test]
fn a_sign_in_started_before_a_logout_never_replaces_a_later_one() {
    // Catches (review, Greptile): login A, logout, login B finishes, then A finishes and overwrites B and revokes B's grant.
    let fake = Fake::start();
    let env = fake.env("logout-then-newer-login");
    let account = Account::from_env(&env).unwrap();
    let late = login(
        &env,
        &mut |url| {
            logout(&env).unwrap();
            login(&env, &mut |u| browser(u), WAIT).expect("the newer sign-in");
            browser(url)
        },
        WAIT,
    );
    assert!(late.is_err(), "the attempt from before the logout is refused");
    assert!(Session::load(&account).is_ok(), "the newer sign-in stands");
    assert_eq!(
        fake.record.lock().unwrap().revoked.len(),
        1,
        "only the late attempt's tokens are revoked, never the newer sign-in's"
    );
}

#[test]
fn logout_ends_the_grant_at_the_service() {
    // Catches (review, Greptile): logout revoking the wrong token, or none, while the grant stays usable.
    let fake = Fake::start();
    let env = fake.env("logout-ends-grant");
    login(&env, &mut |url| browser(url), WAIT).expect("login");
    let account = Account::from_env(&env).unwrap();
    let mut session = Session::load(&account).unwrap();
    session.refresh().expect("a rotation, so the grant has more than one token");
    let current = fake.record.lock().unwrap().live_refresh_tokens();
    assert_eq!(current.len(), 1);
    assert!(logout(&env).unwrap().is_some());
    let r = fake.record.lock().unwrap();
    assert_eq!(r.revoked, current, "the current refresh token, not a spent one");
    assert!(r.live_refresh_tokens().is_empty(), "the grant is over");
}

#[test]
fn a_grant_the_service_ended_signs_the_machine_out() {
    // Catches (review, Greptile): an invalid_grant on refresh leaving a dead sign-in stored.
    let fake = Fake::start();
    fake.knobs.lock().unwrap().access_ttl = 0;
    let env = fake.env("service-ended-grant");
    login(&env, &mut |url| browser(url), WAIT).expect("login");
    let account = Account::from_env(&env).unwrap();
    {
        let mut r = fake.record.lock().unwrap();
        let live = r.live_refresh_tokens();
        assert_eq!(live.len(), 1);
        r.end_grant_of(&live[0]);
    }
    let mut session = Session::load(&account).unwrap();
    assert!(session.access_token().is_err());
    assert_eq!(
        Session::load(&account).err(),
        Some(SessionError::NotSignedIn),
        "signed out locally"
    );
}

#[cfg(unix)]
#[test]
fn a_sign_in_that_cannot_be_read_says_so_instead_of_signed_out() {
    // Catches (review, Greptile): a denied Keychain prompt or unreadable credentials reported as "not signed in".
    use std::os::unix::fs::PermissionsExt;
    let fake = Fake::start();
    let env = fake.env("unreadable-sign-in");
    login(&env, &mut |url| browser(url), WAIT).expect("login");
    let account = Account::from_env(&env).unwrap();
    let creds = account.dir().join("credentials.json");
    std::fs::set_permissions(&creds, std::fs::Permissions::from_mode(0o000)).unwrap();
    let loaded = Session::load(&account).err();
    std::fs::set_permissions(&creds, std::fs::Permissions::from_mode(0o600)).unwrap();
    assert!(matches!(loaded, Some(SessionError::Local(_))), "{loaded:?}");
    let state = account.dir().join("state.json");
    std::fs::set_permissions(&state, std::fs::Permissions::from_mode(0o000)).unwrap();
    let loaded = Session::load(&account).err();
    std::fs::set_permissions(&state, std::fs::Permissions::from_mode(0o600)).unwrap();
    assert!(matches!(loaded, Some(SessionError::Local(_))), "{loaded:?}");
    assert!(Session::load(&account).is_ok());
}

/// The Your setup landings the fake has seen, once the browser thread has had time to land.
fn landings(fake: &Fake, want: usize) -> Vec<String> {
    let until = std::time::Instant::now() + Duration::from_secs(5);
    loop {
        let seen = fake.record.lock().unwrap().setup_landings.clone();
        if seen.len() >= want || std::time::Instant::now() >= until {
            return seen;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn a_finished_sign_in_lands_the_browser_on_your_setup() {
    // Catches: the browser left on "you can close this tab" instead of the account's setup page.
    let fake = Fake::start();
    let env = fake.env("lands-on-setup");
    login(&env, &mut |url| browser(url), WAIT).expect("login");
    assert_eq!(landings(&fake, 1), vec!["signed-in=cli".to_string()]);
}

#[test]
fn a_sign_in_that_fails_after_the_callback_never_lands_on_your_setup() {
    // Catches: the browser told it worked (and sent on to Your setup) when the code exchange
    // that follows the callback failed and nothing was saved.
    let fake = Fake::start();
    fake.route("POST", "/oauth/token", 400, vec![], r#"{"error":"invalid_grant"}"#);
    let env = fake.env("exchange-fails");
    assert!(login(&env, &mut |url| browser(url), WAIT).is_err());
    std::thread::sleep(Duration::from_millis(300));
    assert!(landings(&fake, 0).is_empty());
}
