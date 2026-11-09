//! Pro refresh and the offline dispatch decision, against the fake service.
mod support;
use impeccable_account::config::Account;
use impeccable_account::{login, logout};
use impeccable_account::pro::verify::{parse_keyring, Keyring};
use impeccable_account::pro::{
    decide, forget, refresh, Decision, Refreshed, WHY_EXPIRED, WHY_NOT_ENTITLED, WHY_NOT_READY,
    WHY_UNVERIFIED,
};
use std::collections::HashMap;
use std::time::{Duration, Instant};
use support::fake::*;

const DAY: u64 = 86400;

struct Setup {
    fake: Fake,
    env: HashMap<String, String>,
    account: Account,
    keys: Keyring,
    release: ring::signature::Ed25519KeyPair,
    lease_key: ring::signature::Ed25519KeyPair,
}

/// Signed in, with a release and lease key the test generated.
fn setup(name: &str) -> Setup {
    let fake = Fake::start();
    let env = fake.env(name);
    login(&env, &mut |url| browser(url), Duration::from_secs(10)).unwrap();
    let release = keypair();
    let keys = parse_keyring(&release_keys_json("r1", &release)).unwrap();
    let lease_key = keypair();
    fake.lease_keys(&[("l1", &lease_key)]);
    Setup {
        account: Account::from_env(&env).unwrap(),
        env,
        fake,
        keys,
        release,
        lease_key,
    }
}

fn ready(s: &Setup, artifact: &[u8], lease_exp: u64) -> String {
    let sha = s.fake.publish("r1", &s.release, artifact, 1);
    s.fake.lease("l1", &s.lease_key, &sha, lease_exp);
    assert!(matches!(
        refresh(&s.account, &s.keys),
        Refreshed::Ready { .. }
    ));
    sha
}

#[test]
fn a_cached_artifact_is_not_downloaded_again() {
    // Catches: re-downloading the Pro build on every renewal (cache keyed by anything but its digest).
    let s = setup("cache-hit");
    ready(&s, b"pro build", unix_now() + DAY);
    assert!(matches!(
        refresh(&s.account, &s.keys),
        Refreshed::Ready {
            downloaded: false,
            ..
        }
    ));
    let sha = sha256_hex(b"pro build");
    assert_eq!(s.fake.hits(&format!("/cli/v1/artifact/{sha}")), 1);
    assert!(matches!(
        decide(&s.account, &s.keys, unix_now()),
        Decision::Pro { .. }
    ));
}

#[test]
fn a_manifest_with_a_bad_signature_installs_nothing() {
    // Catches: trusting a manifest (and downloading its artifact) that the pinned release key didn't sign.
    let s = setup("bad-signature");
    let sha = s.fake.publish("r1", &keypair(), b"pro build", 1);
    assert!(matches!(refresh(&s.account, &s.keys), Refreshed::Failed(_)));
    assert_eq!(s.fake.hits(&format!("/cli/v1/artifact/{sha}")), 0);
    assert!(matches!(
        decide(&s.account, &s.keys, unix_now()),
        Decision::Open {
            why: Some(WHY_NOT_READY),
            ..
        }
    ));
}

#[test]
fn not_entitled_deletes_the_lease_at_once() {
    // Catches: an explicit "not entitled" leaving the offline grace running.
    let s = setup("not-entitled");
    ready(&s, b"pro build", unix_now() + 6 * DAY);
    s.fake.route(
        "GET",
        "/cli/v1/manifest",
        403,
        vec![],
        r#"{"error":"not_entitled"}"#,
    );
    assert_eq!(refresh(&s.account, &s.keys), Refreshed::NotEntitled);
    assert!(!s.account.dir().join(format!("pro/{}-{}/current.json", impeccable_account::pro::ENGINE, impeccable_account::pro::target())).exists());
    assert!(matches!(
        decide(&s.account, &s.keys, unix_now()),
        Decision::Open {
            why: Some(WHY_NOT_ENTITLED),
            ..
        }
    ));
}

#[test]
fn an_expired_lease_runs_the_open_rules() {
    // Catches: offline grace outliving the lease's own expiry.
    let s = setup("expired");
    let exp = unix_now() + DAY;
    ready(&s, b"pro build", exp);
    assert!(matches!(
        decide(&s.account, &s.keys, exp - 10),
        Decision::Pro { .. }
    ));
    assert!(matches!(
        decide(&s.account, &s.keys, exp + 1),
        Decision::Open {
            why: Some(WHY_EXPIRED),
            ..
        }
    ));
}

#[test]
fn an_unknown_lease_key_is_refetched_once() {
    // Catches: a lease-key rotation breaking renewals, or a lease from an unpublished key being accepted.
    let s = setup("unknown-kid");
    let sha = ready(&s, b"pro build", unix_now() + DAY);
    assert_eq!(s.fake.hits("/.well-known/impeccable-cli-keys.json"), 1);

    let rotated = keypair();
    s.fake.lease("l2", &rotated, &sha, unix_now() + DAY);
    s.fake.lease_keys(&[("l2", &rotated), ("l1", &s.lease_key)]);
    assert!(matches!(
        refresh(&s.account, &s.keys),
        Refreshed::Ready { .. }
    ));
    assert_eq!(s.fake.hits("/.well-known/impeccable-cli-keys.json"), 2);

    let unpublished = keypair();
    s.fake.lease("l3", &unpublished, &sha, unix_now() + DAY);
    assert!(matches!(refresh(&s.account, &s.keys), Refreshed::Failed(_)));
    assert_eq!(s.fake.hits("/.well-known/impeccable-cli-keys.json"), 3);
}

fn artifact_path(s: &Setup, sha: &str) -> std::path::PathBuf {
    s.account
        .home
        .join("pro/artifacts")
        .join(format!("{sha}{}", std::env::consts::EXE_SUFFIX))
}

#[test]
fn a_revocation_seen_during_a_refresh_is_not_undone_by_it() {
    // Catches: a refresh that read "entitled" before a revocation installing its lease after it.
    let s = setup("revoke-mid-refresh");
    let sha = s.fake.publish("r1", &s.release, b"pro build", 1);
    s.fake.lease("l1", &s.lease_key, &sha, unix_now() + 6 * DAY);
    let gate = s.fake.hold("/cli/v1/lease");
    let (account, keys) = (s.account.clone(), s.keys.clone());
    let running = std::thread::spawn(move || refresh(&account, &keys));
    s.fake.wait_for_hits("/cli/v1/lease", 1);
    // What `whoami` does on `pro: false`.
    forget(&s.account, true);
    gate.open();
    assert_eq!(running.join().unwrap(), Refreshed::NotEntitled);
    assert!(!s.account.dir().join(format!("pro/{}-{}/current.json", impeccable_account::pro::ENGINE, impeccable_account::pro::target())).exists());
    assert!(matches!(
        decide(&s.account, &s.keys, unix_now()),
        Decision::Open {
            why: Some(WHY_NOT_ENTITLED),
            ..
        }
    ));
}

#[test]
fn a_stalled_download_does_not_hold_up_logout() {
    // Catches: a refresh holding the sign-in lock through a slow or attacker-paced download.
    let s = setup("stalled-download");
    let sha = s.fake.publish("r1", &s.release, b"pro build", 1);
    s.fake.lease("l1", &s.lease_key, &sha, unix_now() + 6 * DAY);
    let gate = s.fake.hold(&format!("/cli/v1/artifact/{sha}"));
    let (account, keys) = (s.account.clone(), s.keys.clone());
    let running = std::thread::spawn(move || refresh(&account, &keys));
    s.fake.wait_for_hits(&format!("/cli/v1/artifact/{sha}"), 1);
    let t = Instant::now();
    assert!(logout(&s.env).unwrap().is_some());
    assert!(t.elapsed() < Duration::from_secs(5), "{:?}", t.elapsed());
    gate.open();
    assert_eq!(running.join().unwrap(), Refreshed::NotSignedIn);
    assert!(!s.account.dir().join(format!("pro/{}-{}/current.json", impeccable_account::pro::ENGINE, impeccable_account::pro::target())).exists());
}

#[test]
fn a_lease_from_an_earlier_sign_in_is_not_used() {
    // Catches: account A's offline lease running Pro for account B after A logs out and B signs in.
    let s = setup("earlier-sign-in");
    ready(&s, b"pro build", unix_now() + 6 * DAY);
    logout(&s.env).unwrap();
    login(&s.env, &mut |url| browser(url), Duration::from_secs(10)).unwrap();
    // The new sign-in's own refresh fails for now; the old lease must not stand in.
    s.fake
        .route("GET", "/cli/v1/manifest", 503, vec![], r#"{"error":"busy"}"#);
    assert!(matches!(
        refresh(&s.account, &s.keys),
        Refreshed::Failed(_) | Refreshed::Unavailable(_)
    ));
    assert!(matches!(
        decide(&s.account, &s.keys, unix_now()),
        Decision::Open {
            why: Some(WHY_NOT_READY),
            ..
        }
    ));
}

#[test]
fn a_revocation_does_not_lower_the_revision_floor() {
    // Catches: forgetting the lease also forgetting which revision was installed, opening a downgrade.
    let s = setup("floor");
    let new = s.fake.publish("r1", &s.release, b"pro build 2", 2);
    s.fake.lease("l1", &s.lease_key, &new, unix_now() + 6 * DAY);
    assert!(matches!(
        refresh(&s.account, &s.keys),
        Refreshed::Ready { revision: 2, .. }
    ));
    forget(&s.account, true);
    let old = s.fake.publish("r1", &s.release, b"pro build 1", 1);
    s.fake.lease("l1", &s.lease_key, &old, unix_now() + 6 * DAY);
    assert!(matches!(refresh(&s.account, &s.keys), Refreshed::Failed(_)));
    assert_eq!(s.fake.hits(&format!("/cli/v1/artifact/{old}")), 0);
}

#[cfg(unix)]
#[test]
fn a_fifo_in_place_of_the_artifact_falls_back_instead_of_hanging() {
    // Catches: a scan blocking on a FIFO (or an endless file) where the cached Pro build should be.
    let s = setup("fifo");
    let exp = unix_now() + DAY;
    let sha = ready(&s, b"pro build", exp);
    let exe = artifact_path(&s, &sha);
    std::fs::remove_file(&exe).unwrap();
    assert!(std::process::Command::new("mkfifo")
        .arg(&exe)
        .status()
        .unwrap()
        .success());
    let (account, keys) = (s.account.clone(), s.keys.clone());
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send((
            decide(&account, &keys, unix_now()),
            decide(&account, &keys, exp + 1),
        ));
    });
    let (now, later) = rx
        .recv_timeout(Duration::from_secs(5))
        .expect("decide hung on the FIFO");
    assert!(matches!(
        now,
        Decision::Open {
            why: Some(WHY_UNVERIFIED),
            ..
        }
    ));
    // An expired lease is decided before the artifact is touched.
    assert!(matches!(
        later,
        Decision::Open {
            why: Some(WHY_EXPIRED),
            ..
        }
    ));
}

fn whoami(env: &HashMap<String, String>) -> i32 {
    let (mut io, _out) = impeccable_common::Io::captured("", std::env::temp_dir(), env.clone());
    impeccable_account::run_whoami(&[], &mut io)
}

#[test]
fn whoami_seeing_pro_clears_a_stale_not_entitled_answer() {
    // Catches (review, Cursor): after a plan upgrade, whoami says Pro is included while scans keep the open rules on an old "not entitled".
    let s = setup("whoami-upgrade");
    s.fake.knobs.lock().unwrap().entitled = false;
    assert_eq!(whoami(&s.env), 0);
    assert!(matches!(decide(&s.account, &s.keys, unix_now()), Decision::Open { why: Some(WHY_NOT_ENTITLED), .. }));
    s.fake.knobs.lock().unwrap().entitled = true;
    assert_eq!(whoami(&s.env), 0);
    assert!(matches!(
        decide(&s.account, &s.keys, unix_now()),
        Decision::Open { why: Some(WHY_NOT_READY), renew: true }
    ));
}

#[test]
fn an_answer_about_an_earlier_sign_in_leaves_the_current_one_alone() {
    // Catches (review, Greptile): whoami's "not entitled" for sign-in A, arriving after sign-in B installed Pro, wiping B.
    let s = setup("stale-answer");
    let earlier = impeccable_account::store::Store::new(&s.account).state().unwrap().login;
    login(&s.env, &mut |url| browser(url), Duration::from_secs(10)).unwrap();
    ready(&s, b"pro build", unix_now() + 6 * DAY);
    impeccable_account::pro::settle(&s.account, earlier, false);
    assert!(matches!(decide(&s.account, &s.keys, unix_now()), Decision::Pro { .. }));
    let current = impeccable_account::store::Store::new(&s.account).state().unwrap().login;
    impeccable_account::pro::settle(&s.account, current, false);
    assert!(matches!(decide(&s.account, &s.keys, unix_now()), Decision::Open { why: Some(WHY_NOT_ENTITLED), .. }));
}

#[test]
fn whoami_keeps_the_retry_clock_when_there_was_no_denial() {
    // Catches (review, Greptile): every whoami deleting the retry clocks, so a failing Pro install retries on every scan.
    let s = setup("whoami-keeps-clock");
    let install = s.account.dir().join(format!("pro/{}-{}", impeccable_account::pro::ENGINE, impeccable_account::pro::target()));
    std::fs::create_dir_all(&install).unwrap();
    std::fs::write(install.join("attempt"), unix_now().to_string()).unwrap();
    assert_eq!(whoami(&s.env), 0);
    assert!(install.join("attempt").exists(), "no earlier denial, so the clock stays");
}

#[test]
fn a_stale_answer_never_forgets_when_the_sign_in_lock_is_busy() {
    // Catches (review, Cursor): settle falling back to forgetting, unchecked, when the lock wait runs out.
    let s = setup("stale-answer-busy-lock");
    let earlier = impeccable_account::store::Store::new(&s.account).state().unwrap().login;
    login(&s.env, &mut |url| browser(url), Duration::from_secs(10)).unwrap();
    ready(&s, b"pro build", unix_now() + 6 * DAY);
    let store = impeccable_account::store::Store::new(&s.account);
    let held = store.lock().unwrap();
    let started = Instant::now();
    impeccable_account::pro::settle(&s.account, earlier, false);
    assert!(started.elapsed() < Duration::from_secs(30), "settle gave up waiting in {:?}", started.elapsed());
    drop(held);
    assert!(matches!(decide(&s.account, &s.keys, unix_now()), Decision::Pro { .. }));
}

#[test]
fn a_denial_for_the_current_sign_in_applies_even_while_the_lock_is_busy() {
    // Catches (review, Greptile): a token refresh holding the lock making settle drop a real "not entitled", leaving the lease usable.
    let s = setup("denial-busy-lock");
    ready(&s, b"pro build", unix_now() + 6 * DAY);
    let current = impeccable_account::store::Store::new(&s.account).state().unwrap().login;
    let store = impeccable_account::store::Store::new(&s.account);
    let held = store.lock().unwrap();
    impeccable_account::pro::settle(&s.account, current, false);
    assert!(matches!(decide(&s.account, &s.keys, unix_now()), Decision::Open { why: Some(WHY_NOT_ENTITLED), .. }));
    drop(held);
}

#[test]
fn an_old_denial_neither_replaces_a_current_one_nor_blocks_a_current_install() {
    // Catches (review, Greptile and Cursor): one shared marker, so an old sign-in's denial overwrote the current one's, or aborted its install.
    let s = setup("denials-per-sign-in");
    let earlier = impeccable_account::store::Store::new(&s.account).state().unwrap().login;
    login(&s.env, &mut |url| browser(url), Duration::from_secs(10)).unwrap();
    let current = impeccable_account::store::Store::new(&s.account).state().unwrap().login;
    let store = impeccable_account::store::Store::new(&s.account);
    // An old answer recorded while the lock is busy doesn't stop this sign-in's install.
    let held = store.lock().unwrap();
    impeccable_account::pro::settle(&s.account, earlier, false);
    drop(held);
    ready(&s, b"pro build", unix_now() + 6 * DAY);
    assert!(matches!(decide(&s.account, &s.keys, unix_now()), Decision::Pro { .. }));
    // A current denial, then an old one landing last: the current one stands.
    let held = store.lock().unwrap();
    impeccable_account::pro::settle(&s.account, current, false);
    impeccable_account::pro::settle(&s.account, earlier, false);
    drop(held);
    assert!(matches!(decide(&s.account, &s.keys, unix_now()), Decision::Open { why: Some(WHY_NOT_ENTITLED), .. }));
}

#[test]
fn a_denial_recorded_while_an_install_waits_is_not_erased_by_it() {
    // Catches (review, Greptile P1 on #1299): an install holding the sign-in lock while it waits on the
    // revision floor, settle timing out and recording a denial without the lock, then the install
    // deleting that newer denial, so scans kept the Pro lease.
    let s = setup("denial-during-install");
    let sha = s.fake.publish("r1", &s.release, b"pro build", 1);
    s.fake.lease("l1", &s.lease_key, &sha, unix_now() + 6 * DAY);
    let current = impeccable_account::store::Store::new(&s.account).state().unwrap().login;
    // Another account's refresh holds the shared revision floor.
    let floor_lock = s.account.home.join("pro").join(format!(
        "floor-{}-{}.lock",
        impeccable_account::pro::ENGINE,
        impeccable_account::pro::target()
    ));
    std::fs::create_dir_all(floor_lock.parent().unwrap()).unwrap();
    let held = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&floor_lock)
        .unwrap();
    held.lock().unwrap();
    let (account, keys) = (s.account.clone(), s.keys.clone());
    let running = std::thread::spawn(move || refresh(&account, &keys));
    // The install now holds the sign-in lock, so this denial is recorded without it.
    let deadline = Instant::now() + Duration::from_secs(20);
    while impeccable_account::store::Store::new(&s.account).lock_for(Duration::ZERO).is_ok() {
        assert!(Instant::now() < deadline, "the install never took the sign-in lock");
        std::thread::sleep(Duration::from_millis(20));
    }
    impeccable_account::pro::settle(&s.account, current, false);
    drop(held);
    let _ = running.join().unwrap();
    assert!(matches!(
        decide(&s.account, &s.keys, unix_now()),
        Decision::Open { why: Some(WHY_NOT_ENTITLED), .. }
    ));
}

#[test]
fn a_sign_in_that_fails_to_save_leaves_the_current_pro_state_alone() {
    // Catches (review, Cursor on #1299): login clearing the Pro install before saving the new
    // sign-in, so a failed save left `whoami` signed in but scans on the open rules.
    let s = setup("failed-relogin-keeps-pro");
    ready(&s, b"pro build", unix_now() + 6 * DAY);
    assert!(matches!(decide(&s.account, &s.keys, unix_now()), Decision::Pro { .. }));
    // The new secret can't be written: a directory where the file goes.
    let secret = s.account.dir().join("credentials.json");
    std::fs::remove_file(&secret).unwrap();
    std::fs::create_dir(&secret).unwrap();
    assert!(login(&s.env, &mut |url| browser(url), Duration::from_secs(10)).is_err());
    assert!(matches!(decide(&s.account, &s.keys, unix_now()), Decision::Pro { .. }));
}
