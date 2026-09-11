//! `ai-color-palette` against a project's own documented palette, through a
//! real browser.
//!
//! The FakeDom tests in `impeccable-core` pin the rule's decision; this one
//! pins the thing only a browser can answer: that the `oklch()` a DESIGN.md
//! declares and the `oklch()` Chrome computes for an element are the same
//! color by the time the rule sees them. A `file://` target loads the
//! DESIGN.md that governs the page's directory, so the whole path runs — the
//! allowlist is parsed from the markdown, the page is rendered, and the
//! browser element sweep decides.
//!
//! Skips cleanly without an installed browser or a built binary, the way
//! `differential.rs` does.
//!
//! Env:
//! - `IMPECCABLE_BIN` — the binary (default `target/debug/impeccable`).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("workspace root")
}

/// A DESIGN.md whose palette is all `oklch()`, including a verdigris that
/// sits inside the rule's cyan band and a violet inside its purple one.
const DESIGN_MD: &str = "---\n\
name: Instruments\n\
colors:\n\
\x20 paper: \"oklch(97.8% 0 0)\"\n\
\x20 ink: \"oklch(13% 0 0)\"\n\
\x20 instrument: \"oklch(24% 0 0)\"\n\
\x20 patina: \"oklch(70% 0.12 188)\"\n\
\x20 iris: \"oklch(58% 0.2 300)\"\n\
---\n\n\
The palette above is the whole system.\n";

fn page(swatch_color: &str, gradient: &str) -> String {
    format!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">\
<title>Instruments</title></head>\
<body style=\"background: oklch(97.8% 0 0); color: oklch(13% 0 0); font-family: Arial, sans-serif\">\
<div style=\"background: oklch(24% 0 0); padding: 24px\">\
<span style=\"color: {swatch_color}; font-size: 16px\">Live</span>\
</div>\
<section style=\"background-image: {gradient}; height: 200px\"></section>\
</body></html>"
    )
}

fn rules(bin: &Path, dir: &Path, file: &str) -> Vec<String> {
    let url = format!("file://{}", dir.join(file).display());
    let out = Command::new(bin)
        .arg("detect")
        .arg("--json")
        .arg(&url)
        .current_dir(dir)
        .output()
        .expect("run detect");
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    let parsed: Value = serde_json::from_str(&stdout)
        .unwrap_or_else(|e| panic!("detect {url} did not print JSON ({e}): {stdout}"));
    parsed
        .as_array()
        .expect("findings array")
        .iter()
        .filter_map(|f| f.get("antipattern")?.as_str().map(str::to_string))
        .collect()
}

#[test]
fn ai_palette_respects_a_documented_oklch_palette() {
    let env: HashMap<String, String> = std::env::vars().collect();
    if impeccable_browser::discovery::find_browser(&env).is_err() {
        eprintln!("skip: no installed browser found");
        return;
    }
    let bin = std::env::var("IMPECCABLE_BIN")
        .map(PathBuf::from)
        .unwrap_or_else(|_| workspace_root().join("target/debug/impeccable"));
    if !bin.exists() {
        eprintln!(
            "skip: {} missing (cargo build -p impeccable, or set IMPECCABLE_BIN)",
            bin.display()
        );
        return;
    }

    let dir = std::env::temp_dir().join(format!("impeccable-ds-palette-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("temp dir");
    // A project marker, so the DESIGN.md walk-up stops here rather than
    // climbing out of the temp directory.
    std::fs::write(dir.join("package.json"), "{\"name\":\"ds-palette-fixture\"}\n").unwrap();
    std::fs::write(dir.join("DESIGN.md"), DESIGN_MD).unwrap();
    std::fs::write(
        dir.join("declared.html"),
        page(
            "oklch(70% 0.12 188)",
            "linear-gradient(oklch(58% 0.2 300), oklch(70% 0.12 188))",
        ),
    )
    .unwrap();
    std::fs::write(
        dir.join("undeclared.html"),
        page(
            "rgb(0, 229, 255)",
            "linear-gradient(rgb(168, 85, 247), rgb(59, 130, 246))",
        ),
    )
    .unwrap();

    let declared = rules(&bin, &dir, "declared.html");
    let undeclared = rules(&bin, &dir, "undeclared.html");
    let _ = std::fs::remove_dir_all(&dir);

    // Every color on this page is a token the DESIGN.md declares, so neither
    // the palette rule nor the drift rule has anything to say.
    assert!(
        !declared.iter().any(|r| r == "ai-color-palette"),
        "declared tokens reported as a generic AI palette: {declared:?}"
    );
    assert!(
        !declared.iter().any(|r| r == "design-system-color"),
        "declared tokens reported as drift: {declared:?}"
    );

    // The same shapes in colors the DESIGN.md never declared still fire.
    assert!(
        undeclared.iter().any(|r| r == "ai-color-palette"),
        "undeclared neon and violet gradient went unreported: {undeclared:?}"
    );
}
