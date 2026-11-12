use std::process::Command;

#[test]
fn directory_text_scan_preserves_the_utf8_error() {
    let root = std::env::temp_dir().join(format!("impeccable-text-bytes-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(
        root.join("style.css"),
        b"/* Caf\xe9 */ body { color: black }",
    )
    .unwrap();
    let result = Command::new(env!("CARGO_BIN_EXE_impeccable"))
        .args(["detect", "--no-config", "--json", "."])
        .current_dir(&root)
        .env("IMPECCABLE_HOME", root.join("home"))
        .env("IMPECCABLE_NO_TELEMETRY", "1")
        .env("IMPECCABLE_TELEMETRY_CHANNEL", "test")
        .output()
        .unwrap();
    std::fs::remove_dir_all(root).unwrap();
    assert_eq!(result.status.code(), Some(1));
    let error = String::from_utf8_lossy(&result.stderr);
    assert!(error.contains("valid UTF-8"), "{error}");
    assert!(!error.contains("ENOENT"), "{error}");
}

#[test]
fn directory_and_explicit_html_scans_accept_the_same_bytes() {
    let root = std::env::temp_dir().join(format!("impeccable-html-bytes-{}", std::process::id()));
    let project = root.join("project");
    std::fs::create_dir_all(&project).unwrap();
    let scan = |target: &str| {
        Command::new(env!("CARGO_BIN_EXE_impeccable"))
            .args(["detect", "--no-config", "--json", target])
            .current_dir(&project)
            .env("IMPECCABLE_HOME", root.join("home"))
            .env("IMPECCABLE_NO_TELEMETRY", "1")
            .env("IMPECCABLE_TELEMETRY_CHANNEL", "test")
            .output()
            .unwrap()
    };
    let mut results = Vec::new();
    for title in [b"Caf\xe9".as_slice(), "Café".as_bytes()] {
        let mut html = b"<!doctype html><html><head><title>".to_vec();
        html.extend_from_slice(title);
        html.extend_from_slice(b"</title><style>body{font-family:Arial,sans-serif}</style></head><body><p>Hello</p></body></html>");
        std::fs::write(project.join("index.html"), html).unwrap();
        results.push((scan("index.html"), scan(".")));
    }
    std::fs::remove_dir_all(root).unwrap();
    for (explicit, directory) in results {
        assert_eq!(explicit.status.code(), Some(2));
        assert_eq!(
            directory.status.code(),
            Some(2),
            "{}",
            String::from_utf8_lossy(&directory.stderr)
        );
        let explicit: serde_json::Value = serde_json::from_slice(&explicit.stdout).unwrap();
        let directory: serde_json::Value = serde_json::from_slice(&directory.stdout).unwrap();
        assert_eq!(explicit, directory);
        assert!(explicit
            .as_array()
            .unwrap()
            .iter()
            .any(|finding| finding["antipattern"] == "overused-font"));
    }
}
