//! Pro refresh and the offline dispatch decision, against the fake service.
mod support;
use impeccable_account::config::Account;
use impeccable_account::login;
use impeccable_account::pro::verify::{parse_keyring, Keyring};
use impeccable_account::pro::{
    decide, refresh, Decision, Refreshed, WHY_EXPIRED, WHY_NOT_ENTITLED, WHY_NOT_READY,
};
use std::time::Duration;
use support::fake::*;

const DAY: u64 = 86400;

struct Setup {
    fake: Fake,
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
    assert!(!s.account.dir().join("pro/lease").exists());
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
