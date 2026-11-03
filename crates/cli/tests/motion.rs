use std::{io::Write, path::PathBuf, process::Command};

// Keep fixture findings in CI logs even when the assertions pass.
fn print_findings(name: &str, report: &serde_json::Value) {
    writeln!(std::io::stdout().lock(), "{name}: {}", report["findings"]).unwrap();
}

// Serialize Chrome captures within this test binary, but let each fixture fail
// independently so CI reports every requested failure shape.
static CAPTURE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
fn motion_fixture(name: &str, expected: Option<&str>) {
    let _lock = CAPTURE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let output =
        std::env::temp_dir().join(format!("impeccable-motion-test-{}", std::process::id()));
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
    if name == "shadow-toggle" {
        assert!(findings.iter().any(|f| f["kind"] == "end-jump"), "{report}");
    }
    if name == "playback-reverse" {
        assert!(
            (report["durationMs"].as_f64().unwrap() - 300.).abs() < 1.,
            "{report}"
        );
    }
    if name == "pseudo-twins" {
        for selector in ["#first::before", "#second::before"] {
            assert!(
                frames[1]["elements"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|e| e["selector"] == selector),
                "{report}"
            );
        }
    }
    print_findings(name, &report);
    if name == "swap-while-growing"
        || name == "smooth"
        || name == "playback-rate"
        || name == "grid-gap"
    {
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
            serde_json::from_slice(&std::fs::read(reduced.join("report.json")).unwrap()).unwrap();
        assert_eq!(report["reducedMotion"], true);
        if name == "playback-rate" {
            assert!(
                (report["durationMs"].as_f64().unwrap() - 120.).abs() < 1.,
                "{report}"
            );
            assert!(
                (report["baselineDurationMs"].as_f64().unwrap() - 600.).abs() < 1.,
                "{report}"
            );
        }
        let ignored = report["findings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|f| f["kind"] == "reduced-motion-ignored");
        assert_eq!(
            ignored,
            name == "swap-while-growing" || name == "grid-gap",
            "{report}"
        );
        if name == "grid-gap" {
            assert!(
                report["findings"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|f| f["kind"] == "reduced-motion-ignored" && f["element"] == "#second"),
                "{report}"
            );
        }
        if name == "smooth" || name == "playback-rate" {
            assert!(
                report["findings"].as_array().unwrap().is_empty(),
                "{report}"
            );
        }
        print_findings(&format!("{name}-reduced"), &report);
    }
    std::fs::remove_dir_all(output).unwrap();
}

macro_rules! fixture {
    ($test:ident, $name:literal, $finding:expr) => {
        #[test]
        fn $test() {
            motion_fixture($name, $finding);
        }
    };
}
fixture!(motion_swap, "swap-while-growing", Some("content-swap"));
fixture!(motion_clipped, "clipped-container", Some("clipped-midway"));
fixture!(motion_sibling, "sibling-over", Some("paint-order-flip"));
fixture!(motion_late_hover, "late-hover-lift", Some("end-jump"));
fixture!(motion_smooth, "smooth", None);
fixture!(
    motion_entrance_replay,
    "entrance-replay",
    Some("entrance-replay")
);
fixture!(motion_crossfade_dip, "crossfade-dip", Some("crossfade-dip"));
fixture!(
    motion_crossfade_overexposure,
    "crossfade-overexposure",
    Some("crossfade-dip")
);
fixture!(motion_orphan_linger, "orphan-linger", Some("orphan-linger"));
fixture!(
    motion_paint_order_swap,
    "paint-order-swap",
    Some("end-paint-swap")
);
fixture!(motion_shadow_toggle, "shadow-toggle", Some("start-jump"));
fixture!(motion_playback_rate, "playback-rate", None);
fixture!(motion_playback_reverse, "playback-reverse", None);

fixture!(motion_pseudo_twins, "pseudo-twins", None);

fixture!(motion_grid_gap, "grid-gap", None);
