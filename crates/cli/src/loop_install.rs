//! Loop pins are part of the verified engine, never read from the filesystem.
use impeccable_common::Io;
use semver::Version;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use url::Url;

const PINS: &str = include_str!("../loop-checksums.txt");
const BASE: &str = "https://github.com/pbakaus/impeccable/releases/download";
const APP: &str = "Impeccable Loop.app";
const USAGE: &str = "Usage: impeccable loop install [--version X.Y.Z] [--no-open]\n       impeccable loop update [--no-open]\n";

type Result<T> = std::result::Result<T, String>;

fn check_platform(os: &str) -> Result<()> {
    if os == "macos" {
        Ok(())
    } else {
        Err("Impeccable Loop is only available on macOS.".into())
    }
}

fn parse_pins(text: &str) -> Result<BTreeMap<Version, String>> {
    let mut pins = BTreeMap::new();
    for line in text
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
    {
        let fields: Vec<_> = line.split_whitespace().collect();
        let invalid = || "Invalid Loop checksum manifest.".to_string();
        if fields.len() != 2
            || fields[0].len() != 64
            || !fields[0].bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err(invalid());
        }
        let raw = fields[1]
            .strip_prefix("impeccable-loop-")
            .and_then(|s| s.strip_suffix(".zip"))
            .ok_or_else(invalid)?;
        let version = Version::parse(raw).map_err(|_| invalid())?;
        if version.to_string() != raw
            || pins
                .insert(version, fields[0].to_ascii_lowercase())
                .is_some()
        {
            return Err(invalid());
        }
    }
    Ok(pins)
}

/// The configured base never carries a query; a redirect may (GitHub's release assets 302 to a signed
/// `?sp=…&sig=…` URL), and HTTPS is required either way.
fn secure_url(raw: &str, allow_query: bool) -> Result<Url> {
    let url = Url::parse(raw).map_err(|e| e.to_string())?;
    if !url.username().is_empty()
        || url.password().is_some()
        || (url.query().is_some() && !allow_query)
        || url.fragment().is_some()
    {
        return Err(
            "Loop download URL must not contain credentials, a query, or a fragment.".into(),
        );
    }
    if url.scheme() != "https"
        && !(url.scheme() == "http" && matches!(url.host_str(), Some("127.0.0.1" | "localhost")))
    {
        return Err(
            "Loop downloads require HTTPS (HTTP is allowed only on localhost or 127.0.0.1).".into(),
        );
    }
    Ok(url)
}

fn download(raw: &str, path: &Path, expected: &str) -> Result<()> {
    // Validate every redirect too: an HTTPS asset must never downgrade to HTTP.
    let mut url = secure_url(raw, false)?;
    let local_http = url.scheme() == "http";
    // The engine's shared builder: its trust store and the ALL_/HTTPS_/HTTP_PROXY variables (#823).
    let agent = impeccable_context::http::agent_builder()
        .redirects(0)
        .timeout(Duration::from_secs(300))
        .build();
    for _ in 0..10 {
        let response = agent
            .get(url.as_str())
            .call()
            .map_err(|e| format!("Loop download failed: {e}"))?;
        if (300..400).contains(&response.status()) {
            let location = response
                .header("Location")
                .ok_or("Loop download redirect has no Location.")?;
            let next = url.join(location).map_err(|e| e.to_string())?;
            secure_url(next.as_str(), true)?;
            if next.scheme() == "http" && !local_http {
                return Err("Loop download refused an insecure redirect.".into());
            }
            url = next;
            continue;
        }
        if response.status() != 200 {
            return Err(format!(
                "Loop download returned HTTP {}.",
                response.status()
            ));
        }
        let mut file = fs::File::create(path).map_err(|e| e.to_string())?;
        let mut reader = response.into_reader().take(1024 * 1024 * 1024 + 1);
        let mut hasher = Sha256::new();
        let mut total = 0u64;
        let mut buf = [0u8; 65536];
        loop {
            let n = reader.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            total += n as u64;
            if total > 1024 * 1024 * 1024 {
                return Err("Loop download exceeds 1 GiB.".into());
            }
            hasher.update(&buf[..n]);
            file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        }
        if format!("{:x}", hasher.finalize()) != expected {
            return Err("Loop SHA-256 checksum mismatch; refusing to unzip.".into());
        }
        return Ok(());
    }
    Err("Too many Loop download redirects.".into())
}

struct Stage(PathBuf);
impl Stage {
    fn new(parent: &Path) -> Result<Self> {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos();
        // A counter as well as the clock: two stages made in the same tick must not share a name.
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let path = parent.join(format!(
            ".impeccable-loop-{}-{stamp}-{n}",
            std::process::id()
        ));
        fs::create_dir(&path).map_err(|e| e.to_string())?;
        Ok(Self(path))
    }
}
impl Drop for Stage {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn plist(app: &Path, key: &str) -> Result<String> {
    let out = Command::new("/usr/bin/plutil")
        .args(["-extract", key, "raw", "-o", "-"])
        .arg(app.join("Contents/Info.plist"))
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!("Cannot read Loop bundle's {key}."));
    }
    String::from_utf8(out.stdout)
        .map(|s| s.trim().to_string())
        .map_err(|e| e.to_string())
}

fn executable(app: &Path) -> Result<PathBuf> {
    let name = plist(app, "CFBundleExecutable")?;
    if name.is_empty() || Path::new(&name).components().count() != 1 || name == "." || name == ".."
    {
        return Err("Invalid Loop bundle executable.".into());
    }
    fs::canonicalize(app.join("Contents/MacOS").join(name)).map_err(|e| e.to_string())
}

fn refuse_running(app: &Path) -> Result<()> {
    let exe = executable(app)?;
    let out = Command::new("/bin/ps")
        .args(["-axo", "comm="])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err("Cannot check whether Loop is running; quit Loop and retry.".into());
    }
    if String::from_utf8_lossy(&out.stdout)
        .lines()
        .any(|line| fs::canonicalize(line.trim()).is_ok_and(|path| path == exe))
    {
        return Err(
            "Impeccable Loop is running. Quit Loop first, then run impeccable loop update.".into(),
        );
    }
    Ok(())
}

fn swap(staged: &Path, app: &Path, backup: &Path, update: bool) -> Result<()> {
    if update {
        fs::rename(app, backup).map_err(|e| format!("Cannot move old Loop aside: {e}"))?;
    }
    if let Err(e) = fs::rename(staged, app) {
        if update {
            fs::rename(backup, app).map_err(|restore| {
                format!(
                    "Loop swap failed ({e}); restore failed ({restore}). Old app is at {}.",
                    backup.display()
                )
            })?;
        }
        return Err(format!("Loop swap failed; old app restored: {e}"));
    }
    if update {
        fs::remove_dir_all(backup).map_err(|e| {
            format!(
                "Loop installed, but cannot remove backup {}: {e}",
                backup.display()
            )
        })?;
    }
    Ok(())
}

pub(crate) fn run(args: &[String], io: &mut Io) -> i32 {
    match run_inner(args, io, PINS, std::env::consts::OS) {
        Ok(message) => {
            io.out(&message);
            0
        }
        Err(e) => {
            io.err(&format!("{e}\n"));
            1
        }
    }
}

fn run_inner(args: &[String], io: &Io, manifest: &str, os: &str) -> Result<String> {
    check_platform(os)?;
    if args.first().is_some_and(|s| s == "--help" || s == "-h") {
        return Ok(USAGE.into());
    }
    let update = match args.first().map(String::as_str) {
        Some("install") => false,
        Some("update") => true,
        _ => return Err(USAGE.trim_end().into()),
    };
    let mut requested = None;
    let mut no_open = false;
    let mut rest = args[1..].iter();
    while let Some(arg) = rest.next() {
        match arg.as_str() {
            "--no-open" => no_open = true,
            "--version" if !update && requested.is_none() => {
                requested = Some(
                    Version::parse(rest.next().ok_or("--version needs X.Y.Z.")?)
                        .map_err(|_| "Invalid Loop version.")?,
                )
            }
            _ => return Err(format!("Unknown Loop argument: {arg}\n{USAGE}")),
        }
    }
    if !update
        && io
            .home()
            .is_some_and(|home| home.join("Applications").join(APP).exists())
    {
        return Err("Loop is already installed. Use impeccable loop update.".into());
    }
    let pins = parse_pins(manifest)?;
    let version = requested
        .as_ref()
        .or_else(|| pins.last_key_value().map(|(v, _)| v))
        .ok_or(
            "No Loop release is pinned in this engine. Update the Impeccable CLI and try again.",
        )?;
    let digest = pins.get(version).ok_or_else(|| {
        format!("No checksum pinned for Loop {version}; refusing the unverified download.")
    })?;
    let apps = io.home().ok_or("HOME is not set.")?.join("Applications");
    fs::create_dir_all(&apps).map_err(|e| e.to_string())?;
    // flock is released automatically on process exit, including a crash.
    let lock = fs::File::open(&apps).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::fd::AsRawFd;
        if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
            return Err("Another Loop install or update is in progress.".into());
        }
    }
    let _lock = lock;
    // Under the lock no other run is staging, so any stage folder left here is from a run that crashed.
    for entry in fs::read_dir(&apps).map_err(|e| e.to_string())?.flatten() {
        if entry
            .file_name()
            .to_string_lossy()
            .starts_with(".impeccable-loop-")
            && entry.file_name() != ".impeccable-loop-previous.app"
            && entry.path().is_dir()
        {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
    let app = apps.join(APP);
    let backup = apps.join(".impeccable-loop-previous.app");
    if backup.exists() {
        if !app.exists() {
            fs::rename(&backup, &app).map_err(|e| format!("Cannot recover previous Loop: {e}"))?;
        } else {
            fs::remove_dir_all(&backup).map_err(|e| e.to_string())?;
        }
    }
    if app.exists() && !update {
        return Err("Loop is already installed. Use impeccable loop update.".into());
    }
    if !app.exists() && update {
        return Err("Loop is not installed. Use impeccable loop install.".into());
    }
    if update {
        let installed = plist(&app, "CFBundleShortVersionString")?;
        if installed == version.to_string() {
            return Ok(format!("Loop {version} is already current.\n"));
        }
        // Never replace a newer build (a local or later one) with an older pinned release.
        if Version::parse(&installed).is_ok_and(|v| v > *version) {
            return Ok(format!(
                "Loop {installed} is newer than the newest pinned release ({version}); nothing to update.\n"
            ));
        }
        refuse_running(&app)?;
    }
    let base = io
        .env("IMPECCABLE_DOWNLOAD_BASE")
        .filter(|s| !s.is_empty())
        .unwrap_or(BASE);
    secure_url(base, false)?;
    let stage = Stage::new(&apps)?;
    let zip = stage.0.join("loop.zip");
    download(
        &format!(
            "{}/loop-v{version}/impeccable-loop-{version}.zip",
            base.trim_end_matches('/')
        ),
        &zip,
        digest,
    )?;
    let unpacked = stage.0.join("unpacked");
    let status = Command::new("/usr/bin/ditto")
        .args(["-x", "-k"])
        .arg(&zip)
        .arg(&unpacked)
        .status()
        .map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("Cannot unzip Loop release.".into());
    }
    let staged = unpacked.join(APP);
    executable(&staged)?;
    if plist(&staged, "CFBundleShortVersionString")? != version.to_string() {
        return Err("Loop bundle version does not match its release.".into());
    }
    if update {
        refuse_running(&app)?;
    }
    swap(&staged, &app, &backup, update)?;
    if !no_open {
        let status = Command::new("/usr/bin/open")
            .arg(&app)
            .status()
            .map_err(|e| format!("Loop installed, but could not open: {e}"))?;
        if !status.success() {
            return Err("Loop installed, but could not open. Open it from ~/Applications.".into());
        }
    }
    Ok(format!(
        "{} Loop {version} in {}.\n",
        if update { "Updated" } else { "Installed" },
        app.display()
    ))
}

#[cfg(test)]
#[path = "../tests/support/loop_install.rs"]
mod tests;
