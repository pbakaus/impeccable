//! After a skill directory is written, make it self-contained: when its
//! `scripts/VERSION` names an engine release and no
//! `scripts/bin/<os>-<arch>/impeccable[.exe]` is present, download that
//! release's binary for this platform from this repo's `engine-v<version>`
//! GitHub Release (the same asset naming and `.sha256` sidecar the launcher
//! uses) and set the executable bit. Not part of the JS; see the crate docs.

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
    let ext = if os == "windows" { ".exe" } else { "" };
    format!("{}/engine-v{version}/impeccable-{os}-{arch}{ext}", base.trim_end_matches('/'))
}

/// Fetch one release binary, verified against its `.sha256` sidecar. Fails
/// closed, mirroring the launchers (triage C1): a sidecar that cannot be
/// fetched or is empty refuses the download - only a binary whose hash
/// matches its published sidecar is ever installed.
fn fetch_binary(url: &str) -> Result<Vec<u8>, String> {
    let bytes = download(url)?;
    let sidecar = download(&format!("{url}.sha256")).map_err(|e| {
        format!("cannot verify against {url}.sha256 ({e}); refusing the unverified download")
    })?;
    let text = String::from_utf8_lossy(&sidecar);
    let expected = text.split_whitespace().next().unwrap_or("").to_lowercase();
    if expected.is_empty() {
        return Err(format!(
            "cannot verify against {url}.sha256 (empty sidecar); refusing the unverified download"
        ));
    }
    let actual = hex(&Sha256::digest(&bytes));
    if actual != expected {
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
            .or_insert_with(|| fetch_binary(&url))
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
}
