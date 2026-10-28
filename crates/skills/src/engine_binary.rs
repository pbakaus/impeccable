//! After a skill directory is written, make it self-contained: when its
//! `scripts/VERSION` names an engine release and no
//! `scripts/bin/<os>-<arch>/impeccable[.exe]` is present, download that
//! release's binary for this platform from this repo's `engine-v<version>`
//! GitHub Release (the same asset naming the launcher uses), verify it against
//! the digest the skill dir's own `scripts/engine-checksums.txt` records, and
//! set the executable bit. Not part of the JS; see the crate docs.

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

/// Install the engine binary into every skill dir in `skill_dirs` that needs
/// one. Prints one line per binary installed; download failures are reported
/// on stderr and do not fail the install (the launcher fetches the binary on
/// first run as a fallback). Also repairs the executable bit on the launcher
/// and any binaries already present in those dirs.
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
    let mut cache: HashMap<String, Result<Vec<u8>, String>> = HashMap::new();
    for skill_dir in skill_dirs {
        let version_file = jsp::join(&[skill_dir, "scripts", "VERSION"]);
        let Ok(raw) = util::read_text(&version_file) else { continue };
        let version = raw.trim();
        if version.is_empty() {
            continue;
        }
        let dest = binary_path(skill_dir, os, arch);
        if util::exists(&dest) {
            continue;
        }
        let url = asset_url(&base, version, os, arch);
        let fetched = cache
            .entry(version.to_string())
            .or_insert_with(|| {
                // Resolve the digest before any network traffic: no line, no download.
                let asset = asset_name(os, arch);
                let manifest = jsp::join(&[skill_dir, "scripts", "engine-checksums.txt"]);
                let expected = util::read_text(&manifest)
                    .ok()
                    .and_then(|text| manifest_digest(&text, version, &asset))
                    .ok_or_else(|| {
                        format!("no checksum for engine {version} ({asset}) in {manifest}; refusing the unverified download")
                    })?;
                fetch_binary(&url, &expected)
            })
            .clone();
        match fetched {
            Ok(bytes) => {
                let written = util::mkdir_p(&jsp::dirname(&dest))
                    .and_then(|_| util::write_bytes(&dest, &bytes))
                    .and_then(|_| util::set_executable(&dest));
                match written {
                    Ok(()) => io.out(&format!(
                        "Installed impeccable engine v{version} ({os}-{arch}) into: {}\n",
                        sys.format_path_for_display(&dest)
                    )),
                    Err(e) => io.err(&format!(
                        "Could not write the impeccable engine v{version} ({os}-{arch}) into {}: {e}\n",
                        sys.format_path_for_display(&dest)
                    )),
                }
            }
            Err(e) => {
                if !e.is_empty() {
                    io.err(&format!(
                        "Could not download the impeccable engine v{version} for {os}-{arch} ({url}): {e}. The launcher fetches it on first run.\n"
                    ));
                    // Report once per version, then stay quiet for its siblings.
                    cache.insert(version.to_string(), Err(String::new()));
                }
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
