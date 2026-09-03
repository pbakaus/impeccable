//! Workspace tasks that need no Node.
//!
//! `cargo xtask bundle` builds the in-page detector bundle:
//!   1. `wasm-pack build crates/wasm --target no-modules --release`
//!      (opt-level z via `CARGO_PROFILE_RELEASE_OPT_LEVEL`, wasm-opt from
//!      the crate metadata), into `target/wasm-bundle/`;
//!   2. concatenates the page JS (`browser-bundle/*.js`) in a fixed order
//!      with the wasm-bindgen glue and the .wasm embedded as base64;
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

use base64::Engine;
use std::path::{Path, PathBuf};
use std::process::Command;

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("workspace root")
}

/// browser-bundle/*.js concatenation order. `@@GLUE@@` is the wasm-bindgen
/// glue, `@@WASM@@` the embedded module + synchronous instantiation.
const ORDER: &[&str] = &[
    "00-header.js",
    "10-probe.js",
    "15-snapshot.js",
    "@@GLUE@@",
    "@@WASM@@",
    "30-scan-common.js",
    "35-visual.js",
    "40-overlay.js",
    "50-scan.js",
    "99-footer.js",
];

/// The extension pieces (`dist/extension/`), each an IIFE over a subset of
/// the same sources plus a `window.*` export line. `core.js` is the wasm
/// glue + an async loader (the module ships beside it as `core_bg.wasm`;
/// no base64: the offscreen document fetches it) + the scan plumbing and
/// visual-contrast orchestration + the offscreen session protocol.
const EXT_SNAPSHOT: &[&str] = &["15-snapshot.js"];
const EXT_OVERLAY: &[&str] = &["40-overlay.js"];
const EXT_CORE: &[&str] = &["@@GLUE@@", "@@LOADER@@", "30-scan-common.js", "35-visual.js", "60-offscreen.js"];

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

fn run(cmd: &mut Command, what: &str) {
    let status = cmd.status().unwrap_or_else(|e| panic!("{what}: failed to spawn: {e}"));
    if !status.success() {
        eprintln!("{what} failed ({status})");
        std::process::exit(1);
    }
}

/// `pure`: also compile the `pure_*` exports (feature `pure-exports`).
fn bundle(check: bool, pure: bool) {
    let root = root();
    let out_dir = root.join("target/wasm-bundle");
    let wasm_pack = std::env::var("WASM_PACK").unwrap_or_else(|_| "wasm-pack".to_string());
    let mut cmd = Command::new(&wasm_pack);
    cmd.current_dir(&root)
        .arg("build")
        .arg("crates/wasm")
        .arg("--target")
        .arg("no-modules")
        .arg("--release")
        .arg("--no-typescript")
        .arg("--no-pack")
        .arg("--out-dir")
        .arg(&out_dir)
        .arg("--out-name")
        .arg("impeccable")
        // Size profile for the module; native builds keep opt-level 3.
        .env("CARGO_PROFILE_RELEASE_OPT_LEVEL", "z")
        // wasm-pack refuses to build a `cdylib` whose Cargo.toml lives in a
        // workspace with `[profile.*]` overrides only when it cannot find
        // the target dir; keep it explicit.
        .env("CARGO_TARGET_DIR", root.join("target"));
    if pure {
        cmd.arg("--").arg("--features").arg("pure-exports");
    }
    if std::env::var_os("IMPECCABLE_XTASK_SKIP_WASM_PACK").is_none() {
        run(&mut cmd, "wasm-pack build");
    }

    let glue = std::fs::read_to_string(out_dir.join("impeccable.js")).expect("wasm-bindgen glue");
    let wasm = std::fs::read(out_dir.join("impeccable_bg.wasm")).expect("wasm module");
    let b64 = base64::engine::general_purpose::STANDARD.encode(&wasm);
    let bundle_dir = root.join("browser-bundle");
    let src = |name: &str| -> String {
        let s = std::fs::read_to_string(bundle_dir.join(name))
            .unwrap_or_else(|e| panic!("browser-bundle/{name}: {e}"));
        if s.ends_with('\n') {
            s
        } else {
            s + "\n"
        }
    };
    check_capture_contract(&src("15-snapshot.js"));

    let mut out = String::new();
    for part in ORDER {
        match *part {
            "@@GLUE@@" => {
                out.push_str("// --- wasm-bindgen glue (generated by cargo xtask bundle) ---\n");
                out.push_str(&glue);
                if !glue.ends_with('\n') {
                    out.push('\n');
                }
            }
            "@@WASM@@" => {
                out.push_str("// --- impeccable_wasm module (generated by cargo xtask bundle) ---\n");
                out.push_str(&format!("const __IMPECCABLE_WASM_BYTES = {};\n", wasm.len()));
                out.push_str("const __IMPECCABLE_WASM_B64 = \"");
                out.push_str(&b64);
                out.push_str("\";\n");
                out.push_str(WASM_INIT);
            }
            name => out.push_str(&src(name)),
        }
    }

    // Extension pieces.
    let ext_piece = |parts: &[&str], exports: &str, header: &str| -> String {
        let mut p = String::new();
        p.push_str(header);
        p.push_str("(function () {\n");
        for part in parts {
            match *part {
                "@@GLUE@@" => {
                    p.push_str("// --- wasm-bindgen glue (generated by cargo xtask bundle) ---\n");
                    p.push_str(&glue);
                    if !glue.ends_with('\n') {
                        p.push('\n');
                    }
                }
                "@@LOADER@@" => p.push_str(EXT_CORE_LOADER),
                name => p.push_str(&src(name)),
            }
        }
        p.push_str(exports);
        p.push_str("})();\n");
        p
    };
    let ext_header = |what: &str| {
        format!(
            "/**\n * Impeccable extension: {what}\n * Copyright (c) 2026 Paul Bakaus\n *\n * GENERATED -- do not edit. Source: browser-bundle/*.js (+ crates/core, crates/wasm for core.js).\n * Rebuild: cargo xtask bundle\n */\n"
        )
    };
    let ext_snapshot = ext_piece(
        EXT_SNAPSHOT,
        "window.__impeccableSnapshot = __impeccableSnapshot;\nwindow.__impeccableCreateDrawableIO = __createDrawableIO;\n",
        &ext_header("snapshot.js, the content-script page snapshot producer (measurement only)"),
    );
    let ext_overlay = ext_piece(
        EXT_OVERLAY,
        "window.__impeccableCreateOverlay = createImpeccableOverlay;\n",
        &ext_header("overlay.js, the content-script overlay UI (draws a findings list; no rules)"),
    );
    let ext_core = ext_piece(
        EXT_CORE,
        "",
        &ext_header("core.js, the offscreen-document WASM core loader + scan session (rules run in core_bg.wasm)"),
    );

    let registry = registry_json();
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
    std::fs::write(ext_dir.join("snapshot.js"), &ext_snapshot).expect("write snapshot.js");
    std::fs::write(ext_dir.join("overlay.js"), &ext_overlay).expect("write overlay.js");
    std::fs::write(ext_dir.join("core.js"), &ext_core).expect("write core.js");
    std::fs::write(ext_dir.join("core_bg.wasm"), &wasm).expect("write core_bg.wasm");
    std::fs::write(ext_dir.join("antipatterns.json"), &registry).expect("write registry");
    println!(
        "extension/detector/: snapshot.js {} KB, overlay.js {} KB, core.js {} KB, core_bg.wasm {} KB",
        ext_snapshot.len() / 1024,
        ext_overlay.len() / 1024,
        ext_core.len() / 1024,
        wasm.len() / 1024
    );
    println!(
        "dist/detect-antipatterns-browser.js: {} KB (wasm {} KB, base64 {} KB, js {} KB)",
        out.len() / 1024,
        wasm.len() / 1024,
        b64.len() / 1024,
        (out.len() - b64.len()) / 1024
    );
}

/// The `atob` + synchronous instantiation that runs at bundle load. Chrome
/// (verified on 151, headless and headed) compiles multi-MB modules
/// synchronously on the main thread; the historical 4 KB limit no longer
/// applies to `new WebAssembly.Module`. A CSP without 'wasm-unsafe-eval'
/// throws here; consumers handle that per docs/WASM-BUNDLE.md.
const WASM_INIT: &str = r#"function __impeccableWasmBytes() {
  const bin = atob(__IMPECCABLE_WASM_B64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
let __impeccable = null;
let __impeccableInitError = null;
try {
  wasm_bindgen.initSync({ module: __impeccableWasmBytes() });
  __impeccable = wasm_bindgen;
} catch (e) {
  __impeccableInitError = e;
}
"#;

/// The offscreen document's core loader: fetch the module beside the script
/// and instantiate asynchronously (the extension's own CSP carries
/// 'wasm-unsafe-eval'). Also stubs the live-page probe namespace the glue
/// imports, so a call that would need a page fails loudly instead of with a
/// ReferenceError.
const EXT_CORE_LOADER: &str = r#"const __impeccableDom = new Proxy({}, {
  get() { throw new Error('[impeccable] the offscreen document has no live page; load a snapshot first'); },
});
async function __impeccableLoadCore() {
  await wasm_bindgen({ module_or_path: chrome.runtime.getURL('detector/core_bg.wasm') });
  return wasm_bindgen;
}
"#;

/// The capture contract: the property and state lists in 15-snapshot.js
/// must equal the core's (`STYLE_PROPS`, `PSEUDO_PROPS` in snapshot.rs;
/// `STATE_PSEUDOS` in selector.rs), or a rule reads a column the capture
/// did not write.
fn check_capture_contract(snapshot_js: &str) {
    fn js_list(src: &str, name: &str) -> Vec<String> {
        let start = src
            .find(&format!("const {name} = ["))
            .unwrap_or_else(|| panic!("15-snapshot.js: {name} not found"));
        let rest = &src[start..];
        let end = rest.find("];").expect("list end");
        rest[..end]
            .split('"')
            .skip(1)
            .step_by(2)
            .map(|s| s.to_string())
            .collect()
    }
    let pairs: [(&str, Vec<String>); 3] = [
        ("__SNAP_STYLE_PROPS", impeccable_core::browser::snapshot::STYLE_PROPS.iter().map(|s| s.to_string()).collect()),
        ("__SNAP_PSEUDO_PROPS", impeccable_core::browser::snapshot::PSEUDO_PROPS.iter().map(|s| s.to_string()).collect()),
        ("__SNAP_STATE_PSEUDOS", impeccable_core::browser::selector::STATE_PSEUDOS.iter().map(|s| s.to_string()).collect()),
    ];
    for (name, want) in pairs {
        let have = js_list(snapshot_js, name);
        if have != want {
            eprintln!("browser-bundle/15-snapshot.js {name} differs from the core's list");
            eprintln!("  js:   {have:?}");
            eprintln!("  core: {want:?}");
            std::process::exit(1);
        }
    }
}

/// `dist/antipatterns.json`: `{ id, name, category, description }` per rule,
/// as `scripts/build-extension.js` writes it (2-space JSON, trailing newline).
fn registry_json() -> String {
    let rows: Vec<serde_json::Value> = impeccable_core::registry::ANTIPATTERNS
        .iter()
        .map(|ap| {
            serde_json::json!({
                "id": ap.id,
                "name": ap.name,
                "category": ap.category,
                "description": ap.description,
            })
        })
        .collect();
    let mut s = serde_json::to_string_pretty(&rows).expect("registry json");
    s.push('\n');
    s
}
