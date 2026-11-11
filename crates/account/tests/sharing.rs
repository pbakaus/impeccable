mod support;
use impeccable_account::{health, login};
use impeccable_common::{Captured, Io};
use serde_json::json;
use std::{io::Write, path::PathBuf, process::Command, time::Duration};
use support::fake::{browser, Fake};

// Follow consent only when the command actually prints its authorization URL.
struct Consent;
impl Write for Consent {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        for line in String::from_utf8_lossy(bytes).lines() {
            if line.starts_with("http://") && line.contains("/app/oauth/authorize?") {
                browser(line);
            }
        }
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
fn setup(name: &str) -> (Fake, Io, Captured) {
    let fake = Fake::start();
    fake.knobs.lock().unwrap().sharing = true;
    let mut env = fake.env(name);
    env.insert("IMPECCABLE_NO_BROWSER".into(), "1".into());
    env.insert("IMPECCABLE_LOGIN_TIMEOUT".into(), "10".into());
    login(&env, &mut browser, Duration::from_secs(10)).unwrap();
    assert!(!fake.record.lock().unwrap().scopes[0].contains("health:share"));
    let root = PathBuf::from(&env["IMPECCABLE_HOME"]).join("repo");
    std::fs::create_dir_all(&root).unwrap();
    for args in [
        vec!["init", "-b", "main"],
        vec![
            "remote",
            "add",
            "origin",
            "https://github.com/example/design.git",
        ],
    ] {
        assert!(Command::new("git")
            .arg("-C")
            .arg(&root)
            .args(args)
            .output()
            .unwrap()
            .status
            .success());
    }
    let (mut io, captured) = Io::captured("", root, env);
    io.stdout = Box::new(Consent);
    (fake, io, captured)
}
fn run(io: &mut Io, args: &[&str]) -> i32 {
    health::run(&args.iter().map(|s| s.to_string()).collect::<Vec<_>>(), io)
}
#[test]
fn missing_scope_requires_explicit_consent_and_preserves_current_scopes() {
    let (fake, mut io, _) = setup("share-consent");
    assert_eq!(run(&mut io, &["share"]), 0);
    assert_eq!(
        fake.record.lock().unwrap().scopes,
        [
            "account:read rules:read",
            "account:read rules:read health:share"
        ]
    );
}
#[test]
fn share_happy_path_flags_identity_and_existing_link() {
    let (fake, mut io, _) = setup("share-happy");
    assert_eq!(run(&mut io, &["share"]), 0);
    let first = fake.record.lock().unwrap().shares[0].clone();
    assert_eq!(
        first["publish"],
        json!({"label":true,"trend":true,"rules":false})
    );
    assert_eq!(
        first["repoKey"],
        format!(
            "{:x}",
            <sha2::Sha256 as sha2::Digest>::digest(b"https://github.com/example/design")
        )
    );
    let (out_io, out) = Io::captured("", io.cwd.clone(), io.env.clone());
    io.stdout = out_io.stdout;
    assert_eq!(
        run(
            &mut io,
            &["share", "--with-rules", "--no-label", "--no-trend"]
        ),
        0
    );
    assert!(String::from_utf8_lossy(&out.stdout.borrow()).contains("sharing settings updated"));
    let second = fake.record.lock().unwrap().shares[1].clone();
    assert_eq!(first["streamKey"], second["streamKey"]);
    assert_eq!(
        second["publish"],
        json!({"label":false,"trend":false,"rules":true})
    );
    assert_eq!(run(&mut io, &["share", "--no-label", "--no-trend"]), 1);
    assert_eq!(fake.hits("/cli/v1/health/share"), 2);
    // A new branch must publish a different stream of the same repo.
    assert!(Command::new("git")
        .arg("-C")
        .arg(&io.cwd)
        .args(["symbolic-ref", "HEAD", "refs/heads/other"])
        .status()
        .unwrap()
        .success());
    assert_eq!(run(&mut io, &["share"]), 0);
    assert_ne!(
        fake.record.lock().unwrap().shares[2]["streamKey"],
        first["streamKey"]
    );
    // No page named by the service yet: no link, never one the CLI builds itself.
    let printed = String::from_utf8_lossy(&out.stdout.borrow()).to_string();
    assert!(printed.contains("Design health: shared.\n"), "{printed}");
    assert!(!printed.contains("/v1/health/shared"), "{printed}");
}

#[test]
fn sharing_prints_only_the_page_the_service_names() {
    // Catches (Designer, 11 Nov 2026): the CLI hardcoding the share address, or printing a
    // link the service didn't name, on another domain, or without this share's token.
    let token = "A".repeat(43);
    for (offered, shown) in [
        (format!("{{FAKE}}/shared/health?t={token}"), true),
        (format!("https://evil.example/shared/health?t={token}"), false),
        ("{FAKE}/shared/health?t=other".to_string(), false),
    ] {
        let (fake, mut io, _) = setup("share-url");
        // First share asks for the consent (answered by the Consent writer); then stop it,
        // so the next share gets a new token and the page link under test.
        assert_eq!(run(&mut io, &["share"]), 0);
        assert_eq!(run(&mut io, &["unshare"]), 0);
        let offered = offered.replace("{FAKE}", &fake.url);
        fake.knobs.lock().unwrap().share_url = Some(offered.clone());
        let (out_io, out) = Io::captured("", io.cwd.clone(), io.env.clone());
        io.stdout = out_io.stdout;
        let code = run(&mut io, &["share"]);
        let printed = String::from_utf8_lossy(&out.stdout.borrow()).to_string();
        if shown {
            assert_eq!(code, 0, "{printed}");
            assert_eq!(printed, format!("{offered}\n"));
        } else {
            assert_ne!(code, 0, "{offered}");
            assert!(!printed.contains(&offered), "{printed}");
        }
    }
}
#[test]
fn sharing_404_not_available() {
    let (fake, mut io, _) = setup("share-404");
    fake.knobs.lock().unwrap().sharing = false;
    let (out_io, out) = Io::captured("", io.cwd.clone(), io.env.clone());
    io.stdout = out_io.stdout;
    assert_eq!(run(&mut io, &["share"]), 1);
    assert_eq!(
        String::from_utf8_lossy(&out.stdout.borrow()),
        "Design health: sharing isn't available yet.\n"
    );
    assert_eq!(fake.record.lock().unwrap().scopes.len(), 1);
}
#[test]
fn sharing_route_404_and_429_limited() {
    for (status, body, message) in [
        (404, "", "sharing isn't available yet"),
        (429, r#"{"error":"limited"}"#, "sharing limit reached"),
        (
            404,
            r#"{"error":"not_found"}"#,
            "nothing to share yet. Run a full impeccable detect on this branch first",
        ),
    ] {
        let (fake, mut io, _) = setup(&format!("share-error-{status}-{}", body.len()));
        fake.route("POST", "/cli/v1/health/share", status, vec![], body);
        let (out_io, out) = Io::captured("", io.cwd.clone(), io.env.clone());
        // Keep the consent follower for the URL, then capture the error too.
        struct Both(Consent, Box<dyn Write>);
        impl Write for Both {
            fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
                self.0.write_all(b)?;
                self.1.write_all(b)?;
                Ok(b.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                self.1.flush()
            }
        }
        io.stdout = Box::new(Both(Consent, out_io.stdout));
        assert_eq!(run(&mut io, &["share"]), 1);
        assert!(
            String::from_utf8_lossy(&out.stdout.borrow()).contains(message),
            "{}",
            String::from_utf8_lossy(&out.stdout.borrow())
        );
    }
}
#[test]
fn unshare_posts_only_the_target() {
    let (fake, mut io, _) = setup("unshare");
    assert_eq!(run(&mut io, &["share"]), 0);
    let shared = fake.record.lock().unwrap().shares[0].clone();
    assert_eq!(run(&mut io, &["unshare"]), 0);
    assert_eq!(
        fake.record.lock().unwrap().unshares,
        [json!({"repoKey":shared["repoKey"],"streamKey":shared["streamKey"]})]
    );
}
#[test]
fn non_git_directory_is_refused() {
    let (fake, mut io, _) = setup("share-non-git");
    io.cwd = PathBuf::from(&io.env["IMPECCABLE_HOME"]);
    let (out_io, out) = Io::captured("", io.cwd.clone(), io.env.clone());
    io.stdout = out_io.stdout;
    assert_eq!(run(&mut io, &["share"]), 1);
    assert_eq!(
        String::from_utf8_lossy(&out.stdout.borrow()),
        "Design health: run this inside a git repository.\n"
    );
    assert_eq!(fake.hits("/cli/v1/health/share"), 0);
}

#[test]
fn declined_sharing_consent_never_publishes() {
    let (fake, mut io, _) = setup("share-declined");
    fake.knobs.lock().unwrap().sharing_denied = true;
    assert_eq!(run(&mut io, &["share"]), 1);
    assert_eq!(fake.hits("/cli/v1/health/share"), 0);
}

#[test]
fn consent_preserves_feature_scopes_without_requesting_new_upload_features() {
    let (fake, mut io, _) = setup("share-held-scopes");
    fake.knobs.lock().unwrap().health = true;
    login(&io.env, &mut browser, Duration::from_secs(10)).unwrap();
    fake.knobs.lock().unwrap().critiques = true;
    assert_eq!(run(&mut io, &["share"]), 0);
    assert_eq!(
        fake.record.lock().unwrap().scopes.last().unwrap(),
        "account:read rules:read health:write health:share"
    );
}

#[test]
fn share_consent_refreshes_pro() {
    let (fake, mut io, _) = setup("share-pro-refresh");
    assert_eq!(fake.hits("/cli/v1/manifest"), 0);
    assert_eq!(run(&mut io, &["share"]), 0);
    assert_eq!(fake.hits("/cli/v1/manifest"), 1);
}

#[cfg(feature = "test-release-keys")]
#[test]
fn installed_pro_still_dispatches_after_share_consent() {
    use impeccable_account::{config::Account, pro};
    use support::fake::{keypair, release_keys_json, unix_now};
    let (fake, mut io, captured) = setup("share-pro-installed");
    let release = keypair();
    let lease = keypair();
    let key_json = release_keys_json("r1", &release);
    let keys = pro::verify::parse_keyring(&key_json).unwrap();
    io.env
        .insert("IMPECCABLE_PRO_RELEASE_KEYS".into(), key_json);
    let account = Account::from_env(&io.env).unwrap();
    fake.lease_keys(&[("l1", &lease)]);
    let sha = fake.publish("r1", &release, b"pro build", 1);
    fake.lease("l1", &lease, &sha, unix_now() + 86400);
    assert!(matches!(
        pro::refresh(&account, &keys),
        pro::Refreshed::Ready { .. }
    ));
    assert!(matches!(
        pro::decide(&account, &keys, unix_now()),
        pro::Decision::Pro { .. }
    ));
    assert_eq!(run(&mut io, &["share"]), 0);
    assert!(String::from_utf8_lossy(&captured.stderr.borrow()).contains("Pro rules: ready.\n"));
    assert!(matches!(
        pro::decide(&account, &keys, unix_now()),
        pro::Decision::Pro { .. }
    ));
}
