//! Workspace tasks that need no Node.
//!
//! `cargo xtask bundle` builds the in-page detector bundle. The bundling
//! itself lives in `impeccable-bundle` (`crates/bundle`), the library a
//! downstream rule pack reuses for its own wasm module; this task is the
//! workspace's caller of it:
//!   1. `wasm-pack build crates/wasm --target no-modules --release`
//!      (opt-level z via `CARGO_PROFILE_RELEASE_OPT_LEVEL`, wasm-opt from
//!      the crate metadata), into `target/wasm-bundle/`;
//!   2. concatenates the page JS (`browser-bundle/*.js`, embedded in
//!      `impeccable-bundle`) in a fixed order with the wasm-bindgen glue and
//!      the .wasm embedded as base64;
//!   3. writes `dist/detect-antipatterns-browser.js` (deterministic: same
//!      sources, same bytes) and `dist/antipatterns.json` (the registry
//!      slice the extension panel reads), and copies the bundle to
//!      `crates/live/assets/detect-antipatterns-browser.js`, the tracked
//!      generated file live mode embeds and serves as `/detect.js`;
//!   4. writes the extension pieces into `extension/detector/`:
//!      `snapshot.js` (content-script snapshot producer), `overlay.js`
//!      (content-script overlay UI), `core.js` + `core_bg.wasm`
//!      (offscreen-document core), `antipatterns.json`. That directory is
//!      gitignored and vendored by `bun run build:extension`, which runs
//!      this task.
//!
//! Run this after touching `crates/core`, `crates/wasm`, or
//! `browser-bundle/`, and commit the refreshed live asset.
//!
//! `cargo xtask bundle --check` rebuilds and fails when the tracked live
//! asset differs (CI staleness gate).

use std::path::{Path, PathBuf};

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("workspace root")
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("bundle") => bundle(
            args.iter().any(|a| a == "--check"),
            args.iter().any(|a| a == "--pure"),
        ),
        _ => {
            eprintln!("usage: cargo xtask bundle [--check] [--pure]");
            std::process::exit(2);
        }
    }
}

fn die(message: String) -> ! {
    eprintln!("{message}");
    std::process::exit(1);
}

/// `pure`: also compile the `pure_*` exports (feature `pure-exports`).
fn bundle(check: bool, pure: bool) {
    let root = root();
    let out_dir = root.join("target/wasm-bundle");
    let cargo_args: &[&str] = if pure { &["--features", "pure-exports"] } else { &[] };
    let (glue, wasm) =
        impeccable_bundle::wasm_pack_build(&root.join("crates/wasm"), &out_dir, cargo_args)
            .unwrap_or_else(|e| die(e));

    if let Err(mismatch) = impeccable_bundle::check_capture_contract() {
        die(mismatch);
    }

    let out = impeccable_bundle::in_page_bundle(&glue, &wasm);
    let registry = impeccable_bundle::registry_json();
    let ext = impeccable_bundle::extension_pieces(&glue, &wasm, &registry);

    let dist = root.join("dist");
    // The one tracked generated file: live mode embeds it (include_str! in
    // crates/live/src/browser_assets.rs) and serves it as /detect.js.
    let live_asset = root.join("crates/live/assets/detect-antipatterns-browser.js");
    if check {
        if std::fs::read(&live_asset).unwrap_or_default() != out.as_bytes() {
            eprintln!("crates/live/assets/detect-antipatterns-browser.js is stale");
            eprintln!("run `cargo xtask bundle` and commit crates/live/assets");
            std::process::exit(1);
        }
        println!("crates/live/assets/detect-antipatterns-browser.js is up to date");
        return;
    }
    std::fs::create_dir_all(&dist).expect("dist dir");
    std::fs::write(dist.join("detect-antipatterns-browser.js"), &out).expect("write bundle");
    std::fs::write(dist.join("antipatterns.json"), &registry).expect("write registry");
    std::fs::create_dir_all(live_asset.parent().unwrap()).expect("live assets dir");
    std::fs::write(&live_asset, &out).expect("write live asset");
    // extension/detector/: gitignored, vendored by `bun run build:extension`.
    let ext_dir = root.join("extension/detector");
    std::fs::create_dir_all(&ext_dir).expect("extension dir");
    std::fs::write(ext_dir.join("snapshot.js"), &ext.snapshot_js).expect("write snapshot.js");
    std::fs::write(ext_dir.join("overlay.js"), &ext.overlay_js).expect("write overlay.js");
    std::fs::write(ext_dir.join("core.js"), &ext.core_js).expect("write core.js");
    std::fs::write(ext_dir.join("core_bg.wasm"), &ext.core_bg_wasm).expect("write core_bg.wasm");
    std::fs::write(ext_dir.join("antipatterns.json"), &ext.antipatterns_json).expect("write registry");
    println!(
        "extension/detector/: snapshot.js {} KB, overlay.js {} KB, core.js {} KB, core_bg.wasm {} KB",
        ext.snapshot_js.len() / 1024,
        ext.overlay_js.len() / 1024,
        ext.core_js.len() / 1024,
        ext.core_bg_wasm.len() / 1024
    );
    let b64_len = wasm.len().div_ceil(3) * 4;
    println!(
        "dist/detect-antipatterns-browser.js: {} KB (wasm {} KB, base64 {} KB, js {} KB)",
        out.len() / 1024,
        wasm.len() / 1024,
        b64_len / 1024,
        (out.len() - b64_len) / 1024
    );
}
