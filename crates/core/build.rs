//! Links the prebuilt closed detector (`libimpeccable_detector.a`, or
//! `impeccable_detector.lib` on MSVC) into `impeccable-core`.
//!
//! Resolution order:
//! 1. `IMPECCABLE_DETECTOR_LIB=<dir>`: a directory holding the archive for the
//!    current target (what a local `cargo xtask detector-archive` in the
//!    private detector repo writes). Used for development and by the
//!    detector repo's CI.
//! 2. The user cache `~/.impeccable/detector/<DETECTOR_VERSION>/<target>/`
//!    (`IMPECCABLE_HOME` overrides `~/.impeccable`).
//! 3. A download of `<base>/detector-v<DETECTOR_VERSION>/<asset>` plus its
//!    `.sha256` sidecar into that cache. `base` is
//!    `IMPECCABLE_DETECTOR_BASE` or the public repo's GitHub Releases.
//!    A download that cannot be verified is refused.
//!
//! The same three steps resolve the second closed artifact, the in-page
//! bundle `detect-antipatterns-browser.js` (the same rules compiled to wasm,
//! served to the browser by live mode). Its path is handed to the crate as
//! `IMPECCABLE_DETECTOR_BUNDLE_JS` for `include_str!`, so the 2 MB generated
//! file is never tracked here.
//!
//! The archive contains no std: it is the closed crates' rlib objects
//! repacked, built with the exact toolchain pinned in `rust-toolchain.toml`.
//! Both sides must use that toolchain (see docs/ENGINE.md).

use std::env;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

const DEFAULT_BASE: &str = "https://github.com/pbakaus/impeccable/releases/download";
const LIB_NAME: &str = "impeccable_detector";
/// The in-page wasm bundle, published beside the archive in every detector
/// release and identical across targets.
const BUNDLE_JS: &str = "detect-antipatterns-browser.js";
/// Refuse anything bigger than this (the real archive is a few tens of MB).
const MAX_ARCHIVE_BYTES: u64 = 256 * 1024 * 1024;

fn main() {
    println!("cargo:rerun-if-env-changed=IMPECCABLE_DETECTOR_LIB");
    println!("cargo:rerun-if-env-changed=IMPECCABLE_DETECTOR_BASE");
    println!("cargo:rerun-if-env-changed=IMPECCABLE_HOME");
    println!("cargo:rerun-if-env-changed=IMPECCABLE_DETECTOR_OFFLINE");

    let target = env::var("TARGET").expect("cargo sets TARGET");
    let msvc = target.contains("msvc");
    let file_name = if msvc { format!("{LIB_NAME}.lib") } else { format!("lib{LIB_NAME}.a") };

    let dir = if let Some(dir) = env::var_os("IMPECCABLE_DETECTOR_LIB").filter(|d| !d.is_empty()) {
        let dir = PathBuf::from(dir);
        let lib = dir.join(&file_name);
        if !lib.is_file() {
            panic!(
                "IMPECCABLE_DETECTOR_LIB={} does not contain {file_name} for target {target}",
                dir.display()
            );
        }
        println!("cargo:rerun-if-changed={}", lib.display());
        dir
    } else {
        let version = required_detector_version();
        let short = short_target(&target);
        let cache = cache_root().join("detector").join(&version).join(short);
        let lib = cache.join(&file_name);
        if !lib.is_file() {
            fetch_into(&cache, &lib, &version, short, &file_name);
        }
        cache
    };

    let bundle = resolve_bundle_js(&dir);
    println!(
        "cargo:rustc-env=IMPECCABLE_DETECTOR_BUNDLE_JS={}",
        bundle.display()
    );

    println!("cargo:rustc-link-search=native={}", dir.display());
    println!("cargo:rustc-link-lib=static={LIB_NAME}");
    println!(
        "cargo:rustc-env=IMPECCABLE_DETECTOR_VERSION={}",
        detector_version().unwrap_or_else(|| "local".to_string())
    );
}

/// The pinned detector release, from `DETECTOR_VERSION` at the workspace root.
/// `None` when the file is absent: the detector repo builds this crate against
/// its own `IMPECCABLE_DETECTOR_LIB` archive and has no version file, and only
/// the download path needs one.
fn detector_version() -> Option<String> {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let path = manifest_dir.join("../../DETECTOR_VERSION");
    println!("cargo:rerun-if-changed={}", path.display());
    fs::read_to_string(&path).ok().map(|s| s.trim().to_string())
}

fn required_detector_version() -> String {
    detector_version().unwrap_or_else(|| {
        panic!(
            "no DETECTOR_VERSION at the workspace root and IMPECCABLE_DETECTOR_LIB is not set. \
             Point IMPECCABLE_DETECTOR_LIB at a directory holding the detector archive for this \
             target, or add the version file."
        )
    })
}

/// The release asset naming: `<os>-<arch>` like the engine binaries.
fn short_target(target: &str) -> &'static str {
    match target {
        "aarch64-apple-darwin" => "darwin-arm64",
        "x86_64-apple-darwin" => "darwin-x64",
        "x86_64-unknown-linux-musl" | "x86_64-unknown-linux-gnu" => "linux-x64",
        "aarch64-unknown-linux-musl" | "aarch64-unknown-linux-gnu" => "linux-arm64",
        "x86_64-pc-windows-msvc" => "windows-x64",
        other => panic!(
            "no prebuilt detector for target {other}. Build the detector for it and point \
             IMPECCABLE_DETECTOR_LIB at the directory holding the archive."
        ),
    }
}

fn cache_root() -> PathBuf {
    if let Some(home) = env::var_os("IMPECCABLE_HOME").filter(|h| !h.is_empty()) {
        return PathBuf::from(home);
    }
    let home = env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    home.join(".impeccable")
}

fn fetch_into(cache: &Path, lib: &Path, version: &str, short: &str, file_name: &str) {
    if env::var_os("IMPECCABLE_DETECTOR_OFFLINE").is_some() {
        panic!(
            "detector archive {} is not cached and IMPECCABLE_DETECTOR_OFFLINE is set. \
             Set IMPECCABLE_DETECTOR_LIB=<dir> to a local build.",
            lib.display()
        );
    }
    let base = env::var("IMPECCABLE_DETECTOR_BASE").unwrap_or_else(|_| DEFAULT_BASE.to_string());
    let base = base.trim_end_matches('/');
    let asset = if file_name.ends_with(".lib") {
        format!("{LIB_NAME}-{short}.lib")
    } else {
        format!("lib{LIB_NAME}-{short}.a")
    };
    let url = format!("{base}/detector-v{version}/{asset}");
    let help = format!(
        "\n\nThe open runtime links a prebuilt closed detector (docs/ENGINE.md). Either:\n\
         - make sure the release detector-v{version} exists at {base} and this machine has network, or\n\
         - set IMPECCABLE_DETECTOR_LIB=<dir> to a directory holding {file_name} for {short}."
    );
    let bytes = download(&url).unwrap_or_else(|e| panic!("cannot download {url}: {e}{help}"));
    let sidecar = download(&format!("{url}.sha256"))
        .unwrap_or_else(|e| panic!("cannot download {url}.sha256: {e}. Refusing an unverified archive.{help}"));
    let expected = String::from_utf8_lossy(&sidecar)
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    let actual = sha256_hex(&bytes);
    if expected.is_empty() || expected != actual {
        panic!("checksum mismatch for {url}: expected {expected}, got {actual}. Refusing the archive.");
    }
    fs::create_dir_all(cache).unwrap_or_else(|e| panic!("cannot create {}: {e}", cache.display()));
    let tmp = cache.join(format!(".{file_name}.part.{}", std::process::id()));
    fs::write(&tmp, &bytes).unwrap_or_else(|e| panic!("cannot write {}: {e}", tmp.display()));
    fs::rename(&tmp, lib).unwrap_or_else(|e| panic!("cannot move {} into place: {e}", tmp.display()));
    println!("cargo:warning=fetched detector v{version} for {short} into {}", lib.display());
}

/// The in-page bundle, resolved like the archive: beside it when
/// `IMPECCABLE_DETECTOR_LIB` supplied one, else the version cache, else a
/// verified download into that cache. Returns the absolute path the crate
/// `include_str!`s.
fn resolve_bundle_js(lib_dir: &Path) -> PathBuf {
    let beside = lib_dir.join(BUNDLE_JS);
    if beside.is_file() {
        println!("cargo:rerun-if-changed={}", beside.display());
        return beside;
    }
    let version = required_detector_version();
    let cached = cache_root()
        .join("detector")
        .join(&version)
        .join(BUNDLE_JS);
    if !cached.is_file() {
        fetch_bundle_js(&cached, &version);
    }
    println!("cargo:rerun-if-changed={}", cached.display());
    cached
}

fn fetch_bundle_js(dest: &Path, version: &str) {
    if env::var_os("IMPECCABLE_DETECTOR_OFFLINE").is_some() {
        panic!(
            "in-page bundle {} is not cached and IMPECCABLE_DETECTOR_OFFLINE is set. \
             Set IMPECCABLE_DETECTOR_LIB=<dir> to a local build that holds {BUNDLE_JS}.",
            dest.display()
        );
    }
    let base = env::var("IMPECCABLE_DETECTOR_BASE").unwrap_or_else(|_| DEFAULT_BASE.to_string());
    let base = base.trim_end_matches('/');
    let url = format!("{base}/detector-v{version}/{BUNDLE_JS}");
    let help = format!(
        "\n\nLive mode serves the closed rules to the page as this wasm bundle \
         (docs/ENGINE.md). Either:\n\
         - make sure the release detector-v{version} exists at {base} and this machine has network, or\n\
         - set IMPECCABLE_DETECTOR_LIB=<dir> to a directory holding {BUNDLE_JS}."
    );
    let bytes = download(&url).unwrap_or_else(|e| panic!("cannot download {url}: {e}{help}"));
    let sidecar = download(&format!("{url}.sha256")).unwrap_or_else(|e| {
        panic!("cannot download {url}.sha256: {e}. Refusing an unverified bundle.{help}")
    });
    let expected = String::from_utf8_lossy(&sidecar)
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    let actual = sha256_hex(&bytes);
    if expected.is_empty() || expected != actual {
        panic!("checksum mismatch for {url}: expected {expected}, got {actual}. Refusing the bundle.");
    }
    let dir = dest.parent().unwrap_or(Path::new("."));
    fs::create_dir_all(dir).unwrap_or_else(|e| panic!("cannot create {}: {e}", dir.display()));
    let tmp = dir.join(format!(".{BUNDLE_JS}.part.{}", std::process::id()));
    fs::write(&tmp, &bytes).unwrap_or_else(|e| panic!("cannot write {}: {e}", tmp.display()));
    fs::rename(&tmp, dest)
        .unwrap_or_else(|e| panic!("cannot move {} into place: {e}", tmp.display()));
    println!(
        "cargo:warning=fetched detector v{version} in-page bundle into {}",
        dest.display()
    );
}

fn download(url: &str) -> Result<Vec<u8>, String> {
    let resp = ureq::get(url)
        .timeout(std::time::Duration::from_secs(120))
        .call()
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    resp.into_reader()
        .take(MAX_ARCHIVE_BYTES + 1)
        .read_to_end(&mut out)
        .map_err(|e| e.to_string())?;
    if out.len() as u64 > MAX_ARCHIVE_BYTES {
        return Err(format!("response larger than {MAX_ARCHIVE_BYTES} bytes"));
    }
    Ok(out)
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}
