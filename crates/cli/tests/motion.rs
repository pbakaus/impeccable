use std::{io::Write, path::PathBuf, process::Command};

// Keep fixture findings in CI logs even when the assertions pass.
fn print_findings(name: &str, report: &serde_json::Value) {
    writeln!(std::io::stdout().lock(), "{name}: {}", report["findings"]).unwrap();
}

#[test]
fn motion_fixtures() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let output =
        std::env::temp_dir().join(format!("impeccable-motion-test-{}", std::process::id()));
    for (name, expected) in [
        ("swap-while-growing", Some("content-swap")),
        ("clipped-container", Some("clipped-midway")),
        ("sibling-over", Some("paint-order-flip")),
        ("late-hover-lift", Some("end-jump")),
        ("smooth", None),
    ] {
        let file = root
            .join(format!("tests/fixtures/motion/{name}.html"))
            .canonicalize()
            .unwrap();
        let url = url::Url::from_file_path(&file).unwrap().to_string();
        let result = Command::new(env!("CARGO_BIN_EXE_impeccable"))
            .args([
                "motion-capture",
                &url,
                "--click",
                "#go",
                "--region",
                "#region",
                "--out-dir",
            ])
            .arg(output.join(name))
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{name}: {}",
            String::from_utf8_lossy(&result.stderr)
        );
        let report: serde_json::Value =
            serde_json::from_slice(&std::fs::read(output.join(name).join("report.json")).unwrap())
                .unwrap();
        let findings = report["findings"].as_array().unwrap();
        if let Some(kind) = expected {
            assert!(
                findings.iter().any(|f| f["kind"] == kind),
                "{name}: {report}"
            );
        } else {
            assert!(findings.is_empty(), "{name}: {report}");
        }
        assert!(output.join(name).join("filmstrip.png").exists());
        assert!(output.join(name).join("index.html").exists());
        let frames = report["frames"].as_array().unwrap();
        assert_eq!(frames.first().unwrap()["phase"], "before");
        assert_eq!(frames[1]["phase"], "first");
        assert_eq!(frames[frames.len() - 2]["phase"], "last");
        assert_eq!(frames.last().unwrap()["phase"], "settled");
        for frame in frames {
            assert!(
                output
                    .join(name)
                    .join(frame["image"].as_str().unwrap())
                    .exists()
            );
        }
        print_findings(name, &report);
        if name == "swap-while-growing" || name == "smooth" {
            let reduced = output.join(format!("{name}-reduced"));
            let result = Command::new(env!("CARGO_BIN_EXE_impeccable"))
                .args([
                    "motion-capture",
                    &url,
                    "--click",
                    "#go",
                    "--region",
                    "#region",
                    "--reduced-motion",
                    "--out-dir",
                ])
                .arg(&reduced)
                .output()
                .unwrap();
            assert!(
                result.status.success(),
                "{}",
                String::from_utf8_lossy(&result.stderr)
            );
            let report: serde_json::Value =
                serde_json::from_slice(&std::fs::read(reduced.join("report.json")).unwrap())
                    .unwrap();
            assert_eq!(report["reducedMotion"], true);
            let ignored = report["findings"]
                .as_array()
                .unwrap()
                .iter()
                .any(|f| f["kind"] == "reduced-motion-ignored");
            assert_eq!(ignored, name == "swap-while-growing", "{report}");
            if name == "smooth" {
                assert!(
                    report["findings"].as_array().unwrap().is_empty(),
                    "{report}"
                );
            }
            print_findings(&format!("{name}-reduced"), &report);
        }
    }
    std::fs::remove_dir_all(output).unwrap();
}
