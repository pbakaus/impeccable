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
//!      slice the extension panel reads), and copies both into
//!      `crates/live/assets/`, where they are tracked: live mode embeds the
//!      bundle and serves it as `/detect.js`, and `antipatterns.json` is the
//!      registry a downstream consumer reads out of a source checkout;
//!   4. writes the extension pieces into `extension/detector/`:
//!      `snapshot.js` (content-script snapshot producer), `overlay.js`
//!      (content-script overlay UI), `core.js` + `core_bg.wasm`
//!      (offscreen-document core), `antipatterns.json`. That directory is
//!      gitignored and vendored by `bun run build:extension`, which runs
//!      this task.
//!
//! Run this after touching `crates/core`, `crates/foundation`,
//! `crates/wasm`, or `browser-bundle/`, and commit the refreshed assets.
//!
//! `cargo xtask bundle --check` rebuilds and fails when either tracked asset
//! differs (CI staleness gate).

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
    // The two tracked generated files. live mode embeds the bundle
    // (include_str! in crates/live/src/browser_assets.rs) and serves it as
    // /detect.js, so the binary has to carry it; antipatterns.json is the
    // registry slice downstream consumers read out of a source checkout
    // (impeccable.style counts and renders the rules from it).
    let assets = root.join("crates/live/assets");
    let tracked: [(PathBuf, &[u8]); 2] = [
        (assets.join("detect-antipatterns-browser.js"), out.as_bytes()),
        (assets.join("antipatterns.json"), registry.as_bytes()),
    ];
    if check {
        let mut stale = false;
        for (path, want) in &tracked {
            let name = path.strip_prefix(&root).unwrap_or(path).display();
            if std::fs::read(path).unwrap_or_default() != *want {
                eprintln!("{name} is stale");
                stale = true;
            } else {
                println!("{name} is up to date");
            }
        }
        if stale {
            eprintln!("run `cargo xtask bundle` and commit crates/live/assets");
            std::process::exit(1);
        }
        return;
    }
    std::fs::create_dir_all(&dist).expect("dist dir");
    std::fs::write(dist.join("detect-antipatterns-browser.js"), &out).expect("write bundle");
    std::fs::write(dist.join("antipatterns.json"), &registry).expect("write registry");
    std::fs::create_dir_all(&assets).expect("live assets dir");
    for (path, bytes) in &tracked {
        std::fs::write(path, bytes).expect("write tracked asset");
    }
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
