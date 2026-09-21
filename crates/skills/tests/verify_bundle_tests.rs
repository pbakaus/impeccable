use impeccable_common::Io;

#[test]
fn verify_bundle_help_is_offline() {
    let (mut io, capture) = Io::captured("", std::env::temp_dir(), Default::default());
    let code = impeccable_skills::run(&["verify-bundle".into(), "--help".into()], &mut io);
    assert_eq!(code, 0);
    assert!(String::from_utf8(capture.stdout.borrow().clone())
        .unwrap()
        .contains("--version"));
    assert!(String::from_utf8(capture.stdout.borrow().clone())
        .unwrap()
        .contains("--signature"));
    assert!(String::from_utf8(capture.stderr.borrow().clone())
        .unwrap()
        .is_empty());
}

#[test]
fn verify_bundle_requires_an_independent_expected_version() {
    let (mut io, capture) = Io::captured("", std::env::temp_dir(), Default::default());
    let code = impeccable_skills::run(&["verify-bundle".into(), "universal.zip".into()], &mut io);
    assert_eq!(code, 2);
    assert!(String::from_utf8(capture.stderr.borrow().clone())
        .unwrap()
        .contains("--version"));
    assert!(String::from_utf8(capture.stdout.borrow().clone())
        .unwrap()
        .is_empty());
}

#[test]
fn local_override_cannot_bypass_signature_verification_in_json_mode() {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/bundle-signature.json"
    ))
    .unwrap();
    let root = impeccable_skills::util::mkdtemp(
        &std::env::temp_dir()
            .join("verify-command-")
            .to_string_lossy(),
    )
    .unwrap();
    let root = std::path::PathBuf::from(root);
    std::fs::write(root.join("bundle.zip"), fixture["bundle"].as_str().unwrap()).unwrap();
    std::fs::write(
        root.join("bundle.zip.sig.json"),
        serde_json::to_vec(&fixture["envelope"]).unwrap(),
    )
    .unwrap();
    let env = [(
        "IMPECCABLE_BUNDLE_PATH".into(),
        root.to_string_lossy().into_owned(),
    )]
    .into();
    let (mut io, capture) = Io::captured("", root.clone(), env);
    let code = impeccable_skills::run(
        &[
            "verify-bundle".into(),
            "bundle.zip".into(),
            "--version=4.2.0".into(),
            "--json".into(),
        ],
        &mut io,
    );
    assert_eq!(code, 1);
    assert!(capture.stdout.borrow().is_empty());
    assert!(String::from_utf8(capture.stderr.borrow().clone())
        .unwrap()
        .contains("Unknown bundle signing key"));
    assert_eq!(std::fs::read_dir(&root).unwrap().count(), 2);
    std::fs::remove_dir_all(root).unwrap();
}
