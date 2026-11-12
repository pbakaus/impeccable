use std::process::Command;

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
