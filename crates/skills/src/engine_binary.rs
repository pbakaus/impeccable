//! After a skill directory is written, make sure its engine exists: when its
//! `scripts/VERSION` names an engine release, fetch that release's binary for
//! this platform from this repo's `engine-v<version>` GitHub Release (the same
//! asset naming the launcher uses), verify it against the digest the skill
//! dir's own `scripts/engine-checksums.txt` records, and put it in the
//! version-pinned user cache the launchers read
//! (`$IMPECCABLE_HOME` or `~/.impeccable`, then `bin/<version>/`), with the
//! `<digest> <size>` stamp that lets them skip the rehash. One copy per
//! machine, not one per harness skill dir (#1175). A skill dir that already
//! holds `scripts/bin/<os>-<arch>/` (an offline bundle) is left as it is. Not
//! part of the JS; see the crate docs.

use std::collections::HashMap;

use impeccable_common::Io;
use sha2::{Digest, Sha256};

use crate::bundle::{download, hex};
use crate::providers::Sys;
use crate::util::{self, jsp};

pub const DEFAULT_DOWNLOAD_BASE: &str = "https://github.com/pbakaus/impeccable/releases/download";

/// The `<os>-<arch>` tag the launcher computes (`darwin|linux|windows` x
/// `arm64|x64`); `None` on a platform without a release asset.
pub fn platform_tag() -> Option<(&'static str, &'static str)> {
    let os = if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        return None;
    };
    let arch = if cfg!(target_arch = "aarch64") {
        "arm64"
    } else if cfg!(target_arch = "x86_64") {
        "x64"
    } else {
        return None;
    };
    Some((os, arch))
}

/// Where the binary for `(os, arch)` lives inside a skill directory.
pub fn binary_path(skill_dir: &str, os: &str, arch: &str) -> String {
    let name = if os == "windows" { "impeccable.exe" } else { "impeccable" };
    jsp::join(&[skill_dir, "scripts", "bin", &format!("{os}-{arch}"), name])
}

/// Where the launchers look for a version's engine:
/// `<IMPECCABLE_HOME or ~/.impeccable>/bin/<version>/impeccable[.exe]`.
pub fn cache_binary_path(sys: &Sys, version: &str, os: &str) -> String {
    let root = sys
        .env
        .get("IMPECCABLE_HOME")
        .filter(|v| !v.is_empty())
        .cloned()
        .unwrap_or_else(|| jsp::join(&[&sys.home, ".impeccable"]));
    let name = if os == "windows" { "impeccable.exe" } else { "impeccable" };
    jsp::join(&[&root, "bin", version, name])
}

/// The cached engine is good when its stamp holds the expected digest and
/// the binary's size and the binary is not newer than the stamp: the rule
/// the launchers apply before they run it without rehashing.
fn cache_is_verified(cached: &str, expected: &str) -> bool {
    let (Ok(bin), Ok(stamp_meta)) = (std::fs::metadata(cached), std::fs::metadata(format!("{cached}.verified"))) else {
        return false;
    };
    let Ok(stamp) = util::read_text(&format!("{cached}.verified")) else { return false };
    let mut fields = stamp.split_whitespace();
    let fresh = match (bin.modified(), stamp_meta.modified()) {
        (Ok(b), Ok(v)) => b <= v,
        _ => false,
    };
    fields.next().is_some_and(|d| d.eq_ignore_ascii_case(expected))
        && fields.next() == Some(bin.len().to_string().as_str())
        && fresh
}

/// The release asset URL for a version and platform. Engine releases are
/// tagged `engine-v<version>` because the repo also carries skill, CLI,
/// extension and detector tags.
pub fn asset_url(base: &str, version: &str, os: &str, arch: &str) -> String {
    format!("{}/engine-v{version}/{}", base.trim_end_matches('/'), asset_name(os, arch))
}

fn asset_name(os: &str, arch: &str) -> String {
    let ext = if os == "windows" { ".exe" } else { "" };
    format!("impeccable-{os}-{arch}{ext}")
}

/// The digest `engine-checksums.txt` records for `version` and `asset`. Lines
/// are `<version> <asset> <sha256>`; blank lines and `#` comments are skipped.
fn manifest_digest(manifest: &str, version: &str, asset: &str) -> Option<String> {
    manifest.lines().find_map(|line| {
        let mut f = line.split_whitespace();
        match (f.next(), f.next(), f.next()) {
            (Some(v), Some(a), Some(sum)) if v == version && a == asset => Some(sum.to_lowercase()),
            _ => None,
        }
    })
}

/// Fetch one release binary, verified against the digest `expected` from the
/// manifest. Fails closed, mirroring the launchers: only a binary whose hash
/// matches the committed digest is ever installed.
fn fetch_binary(url: &str, expected: &str) -> Result<Vec<u8>, String> {
    let bytes = download(url)?;
    if hex(&Sha256::digest(&bytes)) != expected {
        return Err(format!("checksum mismatch downloading {url}"));
    }
    Ok(bytes)
}

/// Belt and suspenders for the executable bit: chmod +x the launcher
/// (`scripts/impeccable`) and every staged engine binary
/// (`scripts/bin/**/impeccable*`) inside a skill dir. Zip extraction and the
/// dir copy preserve modes themselves, but any channel that loses them (a
/// zip with no unix modes, a mode-dropping copier) would otherwise turn every
/// hook and Setup call into "Permission denied". No-op off unix and for
/// missing paths.
pub fn ensure_executable_scripts(skill_dir: &str) {
    let launcher = jsp::join(&[skill_dir, "scripts", "impeccable"]);
    if util::exists(&launcher) {
        let _ = util::set_executable(&launcher);
    }
    let bin_root = jsp::join(&[skill_dir, "scripts", "bin"]);
    for tag in util::read_dir_names(&bin_root).unwrap_or_default() {
        let dir = jsp::join(&[&bin_root, &tag]);
        if !util::is_dir(&dir) {
            continue;
        }
        for name in util::read_dir_names(&dir).unwrap_or_default() {
            if name.starts_with("impeccable") {
                let _ = util::set_executable(&jsp::join(&[&dir, &name]));
            }
        }
    }
}

/// Make sure the engine every skill dir in `skill_dirs` pins is in the user
/// cache. Prints one line per binary installed; download failures are
/// reported on stderr and do not fail the install (the launcher fetches the
/// binary on first run as a fallback). Also repairs the executable bit on the
/// launcher and any binaries already present in those dirs.
pub fn install_engine_binaries(sys: &Sys, io: &mut Io, skill_dirs: &[String]) {
    for skill_dir in skill_dirs {
        ensure_executable_scripts(skill_dir);
    }
    let Some((os, arch)) = platform_tag() else { return };
    let base = sys
        .env
        .get("IMPECCABLE_DOWNLOAD_BASE")
        .filter(|v| !v.is_empty())
        .cloned()
        .unwrap_or_else(|| DEFAULT_DOWNLOAD_BASE.to_string());
    let asset = asset_name(os, arch);
    // One attempt per version, whatever the number of skill dirs.
    let mut done: HashMap<String, ()> = HashMap::new();
    for skill_dir in skill_dirs {
        let version_file = jsp::join(&[skill_dir, "scripts", "VERSION"]);
        let Ok(raw) = util::read_text(&version_file) else { continue };
        let version = raw.trim().to_string();
        if version.is_empty() || done.contains_key(&version) {
            continue;
        }
        // An offline bundle stages its own binary; the launcher runs it.
        if util::exists(&binary_path(skill_dir, os, arch)) {
            continue;
        }
        done.insert(version.clone(), ());
        // Resolve the digest before any network traffic: no line, no download.
        let manifest = jsp::join(&[skill_dir, "scripts", "engine-checksums.txt"]);
        let Some(expected) = util::read_text(&manifest).ok().and_then(|text| manifest_digest(&text, &version, &asset)) else {
            io.err(&format!(
                "Could not download the impeccable engine v{version} for {os}-{arch}: no checksum for engine {version} ({asset}) in {manifest}; refusing the unverified download. The launcher fetches it on first run.\n"
            ));
            continue;
        };
        let cached = cache_binary_path(sys, &version, os);
        if cache_is_verified(&cached, &expected) {
            continue;
        }
        let url = asset_url(&base, &version, os, arch);
        let bytes = match fetch_binary(&url, &expected) {
            Ok(bytes) => bytes,
            Err(e) => {
                io.err(&format!(
                    "Could not download the impeccable engine v{version} for {os}-{arch} ({url}): {e}. The launcher fetches it on first run.\n"
                ));
                continue;
            }
        };
        // Stage beside the target and rename, so a launcher never runs half a file.
        let staging = format!("{cached}.part.{}", std::process::id());
        let written = util::mkdir_p(&jsp::dirname(&cached))
            .and_then(|_| util::write_bytes(&staging, &bytes))
            .and_then(|_| util::set_executable(&staging))
            .and_then(|_| std::fs::rename(&staging, &cached).map_err(|e| e.to_string()))
            .and_then(|_| util::write_bytes(&format!("{cached}.verified"), format!("{expected} {}\n", bytes.len()).as_bytes()));
        match written {
            Ok(()) => io.out(&format!(
                "Installed impeccable engine v{version} ({os}-{arch}) into: {}\n",
                sys.format_path_for_display(&cached)
            )),
            Err(e) => {
                let _ = std::fs::remove_file(&staging);
                io.err(&format!(
                    "Could not write the impeccable engine v{version} ({os}-{arch}) into {}: {e}\n",
                    sys.format_path_for_display(&cached)
                ));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asset_naming_matches_launcher() {
        assert_eq!(
            asset_url(DEFAULT_DOWNLOAD_BASE, "1.2.3", "darwin", "arm64"),
            "https://github.com/pbakaus/impeccable/releases/download/engine-v1.2.3/impeccable-darwin-arm64"
        );
        assert_eq!(asset_url("http://x/", "1", "windows", "x64"), "http://x/engine-v1/impeccable-windows-x64.exe");
        // The sibling binary path is joined with the host's path semantics
        // (backslashes on Windows); only the asset name is platform-keyed.
        assert_eq!(
            binary_path("/s", "linux", "x64"),
            jsp::join(&["/s", "scripts", "bin", "linux-x64", "impeccable"])
        );
        assert_eq!(
            binary_path("/s", "windows", "arm64"),
            jsp::join(&["/s", "scripts", "bin", "windows-arm64", "impeccable.exe"])
        );
    }

    /// Serves `body` to every request on 127.0.0.1 and counts them.
    fn counting_server(body: &'static [u8]) -> (String, std::sync::Arc<std::sync::atomic::AtomicUsize>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let hits = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counted = hits.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut buf = [0u8; 4096];
                let _ = stream.read(&mut buf);
                counted.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                let head = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                let _ = stream.write_all(head.as_bytes()).and_then(|_| stream.write_all(body));
            }
        });
        (base, hits)
    }

    #[test]
    fn install_fills_the_version_cache_once_and_copies_into_no_skill_dir() {
        // #1175: one 16 MB engine per machine, not one per harness skill dir.
        let Some((os, arch)) = platform_tag() else { return };
        const BODY: &[u8] = b"#!/bin/sh\necho engine\n";
        let digest = hex(&Sha256::digest(BODY));
        let root = std::env::temp_dir().join(format!("impeccable-cache-only-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let home = root.join("cache").to_string_lossy().into_owned();
        let dirs: Vec<String> = ["claude", "agents"].iter().map(|h| {
            let d = root.join(h);
            std::fs::create_dir_all(d.join("scripts")).unwrap();
            std::fs::write(d.join("scripts/VERSION"), "7.7.7\n").unwrap();
            std::fs::write(d.join("scripts/engine-checksums.txt"), format!("7.7.7 {} {digest}\n", asset_name(os, arch))).unwrap();
            d.to_string_lossy().into_owned()
        }).collect();
        let (base, hits) = counting_server(BODY);
        let env: util::Env = [
            ("IMPECCABLE_DOWNLOAD_BASE".to_string(), base),
            ("IMPECCABLE_HOME".to_string(), home.clone()),
        ].into();
        for _ in 0..2 {
            let (mut io, captured) = Io::captured("", root.clone(), env.clone());
            install_engine_binaries(&Sys::new(env.clone(), root.to_string_lossy().into_owned()), &mut io, &dirs);
            assert_eq!(String::from_utf8_lossy(&captured.stderr.borrow()), "");
        }
        let cached = cache_binary_path(&Sys::new(env.clone(), String::new()), "7.7.7", os);
        assert_eq!(std::fs::read(&cached).unwrap(), BODY);
        assert_eq!(util::read_text(&format!("{cached}.verified")).unwrap(), format!("{digest} {}\n", BODY.len()));
        for d in &dirs {
            assert!(!util::exists(&binary_path(d, os, arch)), "no copy in {d}");
        }
        assert_eq!(hits.load(std::sync::atomic::Ordering::SeqCst), 1, "one download for both dirs and both runs");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn install_refuses_a_version_with_no_manifest_line() {
        let Some((os, arch)) = platform_tag() else { return };
        let dir = std::env::temp_dir().join(format!("impeccable-no-manifest-line-{}", std::process::id()));
        let skill_dir = dir.to_string_lossy().into_owned();
        std::fs::create_dir_all(dir.join("scripts")).unwrap();
        std::fs::write(dir.join("scripts/VERSION"), "9.9.9\n").unwrap();
        std::fs::write(dir.join("scripts/engine-checksums.txt"), "1.0.0 impeccable-linux-x64 abc\n").unwrap();
        // A refused port: reaching the network would fail with a different error.
        let env: util::Env = [("IMPECCABLE_DOWNLOAD_BASE".to_string(), "http://127.0.0.1:9".to_string())].into();
        let (mut io, captured) = Io::captured("", dir.clone(), env.clone());
        install_engine_binaries(&Sys::new(env, skill_dir.clone()), &mut io, &[skill_dir.clone()]);
        let stderr = String::from_utf8_lossy(&captured.stderr.borrow()).into_owned();
        assert!(stderr.contains("no checksum for engine 9.9.9"), "{stderr}");
        assert!(!util::exists(&binary_path(&skill_dir, os, arch)));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn manifest_digest_matches_version_and_asset() {
        let manifest = "# header: 1.2.3 impeccable-linux-x64 ffff\n\n\
            1.2.3 impeccable-linux-x64 ABC123\n\
            1.2.3 impeccable-windows-x64.exe def456\n\
            1.2.2 impeccable-linux-x64 old\n";
        assert_eq!(manifest_digest(manifest, "1.2.3", "impeccable-linux-x64").as_deref(), Some("abc123"));
        assert_eq!(manifest_digest(manifest, "1.2.3", "impeccable-windows-x64.exe").as_deref(), Some("def456"));
        assert_eq!(manifest_digest(manifest, "1.2.2", "impeccable-linux-x64").as_deref(), Some("old"));
        assert_eq!(manifest_digest(manifest, "1.2.3", "impeccable-darwin-arm64"), None);
        assert_eq!(manifest_digest(manifest, "9.9.9", "impeccable-linux-x64"), None);
        assert_eq!(manifest_digest("# only 1.2.3 impeccable-linux-x64 ffff\n", "1.2.3", "impeccable-linux-x64"), None);
        assert_eq!(manifest_digest("", "1.2.3", "impeccable-linux-x64"), None);
    }
}
