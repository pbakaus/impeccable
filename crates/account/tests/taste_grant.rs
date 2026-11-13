//! A renewal that drops `taste:read` takes the cached rules with it.
//! Fake issuer and file credentials only.
mod support;
use impeccable_account::{config::Account, login, session::Session, store::Store, taste};
use impeccable_common::Io;
use serde_json::json;
use std::time::Duration;
use support::fake::{browser, Fake};

fn signed_in(fake: &Fake, name: &str) -> (Io, Account) {
    fake.knobs.lock().unwrap().taste = true;
    let env = fake.env(name);
    login(&env, &mut |u| browser(u), Duration::from_secs(10)).unwrap();
    let account = Account::from_env(&env).unwrap();
    let (io, _) = Io::captured("", account.home.clone(), env);
    (io, account)
}

fn cached(account: &Account) -> std::path::PathBuf {
    let path = account.home.join("taste.json");
    let copy = json!({"version":1, "fetchedAt":1, "etag":"\"v1\"", "issuer":account.issuer,
        "state":"ready", "rules":[{"id":"r1","text":"Square corners","direction":"prefer"}]});
    std::fs::write(&path, copy.to_string()).unwrap();
    path
}

#[test]
fn renewal_keeps_the_copy_while_the_grant_holds_and_clears_it_when_dropped() {
    let fake = Fake::start();
    let (_io, account) = signed_in(&fake, "taste-renew");
    let path = cached(&account);
    let mut session = Session::load(&account).unwrap();
    session.refresh().unwrap();
    assert!(session.state.taste);
    assert!(path.exists(), "a renewal that keeps taste:read keeps the copy");

    fake.knobs.lock().unwrap().refresh_drops = vec!["taste:read"];
    session.refresh().unwrap();
    assert!(!session.state.taste);
    assert!(!Store::new(&account).state().unwrap().taste);
    assert!(!path.exists(), "a renewal that drops taste:read clears the copy");
}

#[test]
fn the_refresh_worker_clears_the_copy_when_its_own_renewal_drops_the_grant() {
    let fake = Fake::start();
    fake.knobs.lock().unwrap().access_ttl = 0;
    let (mut io, account) = signed_in(&fake, "taste-worker-renew");
    let path = cached(&account);
    fake.knobs.lock().unwrap().refresh_drops = vec!["taste:read"];
    fake.route("GET", "/cli/v1/taste", 403, vec![], "");
    assert_eq!(taste::run_refresh(&[], &mut io), 0);
    assert!(!Store::new(&account).state().unwrap().taste);
    assert!(!path.exists());
}

#[test]
fn another_issuer_under_the_same_home_never_clears_this_ones_copy() {
    let (production, staging) = (Fake::start(), Fake::start());
    let (_io, prod) = signed_in(&production, "taste-shared-home");
    staging.knobs.lock().unwrap().taste = true;
    let mut env = staging.env("taste-shared-home-staging");
    env.insert("IMPECCABLE_HOME".into(), prod.home.to_string_lossy().into_owned());
    // Signing in to staging under the shared home leaves production's copy.
    let path = cached(&prod);
    login(&env, &mut |u| browser(u), Duration::from_secs(10)).unwrap();
    assert!(path.exists(), "a sign-in to another issuer keeps this issuer's copy");
    let stage = Account::from_env(&env).unwrap();
    assert_eq!(stage.home, prod.home);

    // Staging renewal without taste:read, and staging's worker on a 403.
    staging.knobs.lock().unwrap().refresh_drops = vec!["taste:read"];
    Session::load(&stage).unwrap().refresh().unwrap();
    assert!(path.exists(), "another issuer's renewal keeps this issuer's copy");
    staging.knobs.lock().unwrap().refresh_drops = vec![];
    login(&env, &mut |u| browser(u), Duration::from_secs(10)).unwrap();
    assert!(path.exists());
    staging.route("GET", "/cli/v1/taste", 403, vec![], "");
    let (mut io, _) = Io::captured("", stage.home.clone(), env.clone());
    taste::run_refresh(&[], &mut io);
    assert!(path.exists(), "another issuer's 403 keeps this issuer's copy");
    impeccable_account::logout(&env).unwrap();
    assert!(path.exists(), "another issuer's logout keeps this issuer's copy");

    // Production's own renewal without the grant still clears it.
    production.knobs.lock().unwrap().refresh_drops = vec!["taste:read"];
    Session::load(&prod).unwrap().refresh().unwrap();
    assert!(!path.exists());
}
