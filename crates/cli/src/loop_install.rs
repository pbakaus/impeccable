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
const USAGE: &str = "Usage: impeccable loop install [--version X.Y.Z] [--no-open] [--connect|--no-connect] [--taste|--no-taste]\n       impeccable loop update [--no-open]\n       impeccable loop connect [--agent claude|codex] [--taste|--no-taste] [--json]\n       impeccable loop connect --mcp-only [--agent claude|codex] [--json]\n       impeccable loop status [--json]\n       impeccable loop disconnect\n";

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
    for _ in 0..10 {
        // The engine's shared builder: its trust store and the proxy variables
        // (#823), NO_PROXY matched per hop since a redirect can change host.
        let agent = impeccable_context::http::agent_builder(url.as_str())
            .redirects(0)
            .timeout(Duration::from_secs(300))
            .build();
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

const RUNNING: &str =
    "Impeccable Loop didn't quit. Quit it yourself, then run impeccable loop update again.";
/// How long `loop update` waits for a running Loop to quit.
const QUIT_WAIT: Duration = Duration::from_secs(10);

/// The pids whose executable is exactly this bundle's, never another app's: matched by
/// canonical path, not by name or bundle id (a development build shares the id).
fn running_pids(app: &Path) -> Result<Vec<i32>> {
    let exe = executable(app)?;
    let out = Command::new("/bin/ps")
        .args(["-axo", "pid=,comm="])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err("Cannot check whether Loop is running; quit Loop and retry.".into());
    }
    Ok(String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|line| {
            let (pid, comm) = line.trim_start().split_once(char::is_whitespace)?;
            let path = fs::canonicalize(comm.trim()).ok()?;
            (path == exe).then(|| pid.parse().ok()).flatten()
        })
        .collect())
}

/// Ask a running Loop to quit (SIGTERM to this bundle's processes only) and wait up to
/// `wait` for them to exit. One that is still running keeps today's refusal.
fn quit_running(app: &Path, wait: Duration) -> Result<()> {
    #[cfg(unix)]
    let signal = libc::SIGTERM;
    #[cfg(not(unix))]
    let signal = 0;
    quit_running_with(app, wait, signal)
}

/// [`quit_running`] with the signal as a parameter, so a test can stand in for a Loop
/// that ignores it (signal 0 delivers nothing).
fn quit_running_with(app: &Path, wait: Duration, signal: i32) -> Result<()> {
    let pids = running_pids(app)?;
    if pids.is_empty() {
        return Ok(());
    }
    for &pid in &pids {
        #[cfg(unix)]
        // SAFETY: a plain signal to a pid this bundle's executable owns.
        unsafe {
            libc::kill(pid, signal);
        }
    }
    let deadline = std::time::Instant::now() + wait;
    loop {
        if running_pids(app)?.is_empty() {
            return Ok(());
        }
        if std::time::Instant::now() >= deadline {
            return Err(RUNNING.into());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
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
    use crate::loop_connect::Taste;
    if args.iter().any(|a| a == "--mcp-only") {
        return run_mcp_only(args, io);
    }
    // `--taste` / `--no-taste` answer connect's taste question ahead of time.
    let (taste_yes, taste_no) = (
        args.iter().any(|a| a == "--taste"),
        args.iter().any(|a| a == "--no-taste"),
    );
    let verb = args.first().map(String::as_str);
    if (taste_yes || taste_no)
        && ((taste_yes && taste_no) || !matches!(verb, Some("connect" | "install")))
    {
        io.err(&format!("--taste and --no-taste go with loop connect or loop install, one at a time.\n{USAGE}"));
        return 1;
    }
    let taste = if taste_yes {
        Taste::Yes
    } else if taste_no {
        Taste::No
    } else {
        Taste::Ask
    };
    let args: Vec<String> = args
        .iter()
        .filter(|a| *a != "--taste" && *a != "--no-taste")
        .cloned()
        .collect();
    let args = args.as_slice();
    // The JSON forms answer one object on stdout whatever happened, for Loop's own UI.
    if args.iter().any(|a| a == "--json") {
        if let Some(code) = run_json(args, io, std::env::consts::OS, taste) {
            return code;
        }
    }
    // `--connect` / `--no-connect` belong to this wrapper: install itself never changes.
    let wants = |flag: &str| args.iter().any(|a| a == flag);
    let (connect, no_connect) = (wants("--connect"), wants("--no-connect"));
    let install = args.first().is_some_and(|a| a == "install");
    if (connect || no_connect) && (!install || (connect && no_connect)) {
        io.err(&format!("--connect and --no-connect go with loop install, one at a time.\n{USAGE}"));
        return 1;
    }
    let inner: Vec<String> = args
        .iter()
        .filter(|a| *a != "--connect" && *a != "--no-connect")
        .cloned()
        .collect();
    let connect_args = match inner.as_slice() {
        [c] if c == "connect" => Some(None),
        [c, a, h] if c == "connect" && a == "--agent" => Some(Some(h.as_str())),
        _ => None,
    };
    if let Some(only) = connect_args {
        let (result, connected) = match check_platform(std::env::consts::OS) {
            Ok(()) => crate::loop_connect::connect_text(io, only),
            Err(e) => (Err(e), Vec::new()),
        };
        return connect_then_taste(io, result, &connected, taste, "");
    }
    match run_inner(&inner, io, PINS, std::env::consts::OS) {
        Ok(message) => {
            io.out(&message);
            if install && !no_connect {
                return after_install(io, connect, taste);
            }
            0
        }
        Err(e) => {
            io.err(&format!("{e}\n"));
            1
        }
    }
}

/// `loop connect --mcp-only [--agent claude|codex] [--json]`: the MCP server alone, on any
/// OS and without the Loop app, so no platform check, no hooks and no taste offer.
fn run_mcp_only(args: &[String], io: &mut Io) -> i32 {
    let json = args.iter().any(|a| a == "--json");
    let rest: Vec<&str> = args
        .iter()
        .map(String::as_str)
        .filter(|a| *a != "--mcp-only" && *a != "--json")
        .collect();
    let only = match rest.as_slice() {
        ["connect"] => None,
        ["connect", "--agent", h] => Some(*h),
        _ => {
            let e = format!("--mcp-only goes with loop connect [--agent claude|codex] [--json], and nothing else.\n{USAGE}");
            if json {
                io.out(&format!("{}\n", serde_json::json!({ "ok": false, "error": e.trim_end() })));
            } else {
                io.err(&e);
            }
            return 1;
        }
    };
    let (result, value, ok) = crate::loop_connect::connect_mcp(io, only);
    if json {
        io.out(&format!("{value}\n"));
        return if ok { 0 } else { 1 };
    }
    match result {
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

/// The step after a fresh install: connect the agents. `--connect` does it outright; a
/// person at a terminal is asked once (Enter means yes); anything else (an agent, a
/// script, a pipe) gets the one command to run next and nothing is changed.
fn after_install(io: &mut Io, connect: bool, taste: crate::loop_connect::Taste) -> i32 {
    use std::io::IsTerminal;
    let ask = !connect && io.stdin_is_tty && std::io::stdout().is_terminal();
    let yes = connect || (ask && {
        io.out("Connect Claude Code and Codex to Loop now? [Y/n] ");
        let _ = std::io::Write::flush(&mut io.stdout);
        let mut line = String::new();
        std::io::stdin().read_line(&mut line)
            .is_ok_and(|n| connect_answer(n, &line))
    });
    if !yes {
        io.out("Next: impeccable loop connect, so your agents bring their questions to Loop.\n");
        return 0;
    }
    let (result, connected) = crate::loop_connect::connect_text(io, None);
    // Loop itself is installed; say how to finish rather than failing the install.
    let finish = "Loop is installed. Run impeccable loop connect again once that is sorted.\n";
    connect_then_taste(io, result, &connected, taste, finish)
}

/// Print a text connect's report, then make the taste offer to the agents it
/// connected, which still happens when another agent failed. `on_error` follows the
/// error. The exit code is the connect's.
fn connect_then_taste(
    io: &mut Io,
    result: Result<String>,
    connected: &[String],
    taste: crate::loop_connect::Taste,
    on_error: &str,
) -> i32 {
    let code = match result {
        Ok(message) => {
            io.out(&message);
            0
        }
        Err(e) => {
            io.err(&format!("{e}\n{on_error}"));
            1
        }
    };
    if !connected.is_empty() {
        let (lines, _) = crate::loop_connect::offer_taste(io, connected, taste);
        io.out(&lines);
    }
    code
}

fn connect_answer(bytes_read: usize, line: &str) -> bool {
    bytes_read > 0
        && matches!(line.trim().to_ascii_lowercase().as_str(), "" | "y" | "yes")
}

/// `loop status --json` and `loop connect [--agent claude|codex] --json`. `None` when
/// the arguments are not one of those, so usage errors read as usual.
fn run_json(
    args: &[String],
    io: &mut Io,
    os: &str,
    taste: crate::loop_connect::Taste,
) -> Option<i32> {
    let rest: Vec<&str> = args[1..]
        .iter()
        .map(String::as_str)
        .filter(|a| *a != "--json")
        .collect();
    let (value, ok) = match (args.first().map(String::as_str), rest.as_slice()) {
        _ if check_platform(os).is_err() => (
            serde_json::json!({ "ok": false, "error": "Impeccable Loop is only available on macOS." }),
            false,
        ),
        (Some("status"), []) => match crate::loop_connect::status(io) {
            Ok(v) => (v, true),
            Err(e) => (serde_json::json!({ "ok": false, "error": e }), false),
        },
        (Some("connect"), []) => with_taste(io, None, taste),
        (Some("connect"), ["--agent", agent]) => with_taste(io, Some(agent), taste),
        _ => return None,
    };
    io.out(&format!("{value}\n"));
    Some(if ok { 0 } else { 1 })
}

/// `connect --json`: never asks, so the taste block is added or removed only with
/// `--taste` or `--no-taste`. `taste`, present only when a rule file was touched or
/// asked about, lists what happened to each.
fn with_taste(
    io: &mut Io,
    only: Option<&str>,
    taste: crate::loop_connect::Taste,
) -> (serde_json::Value, bool) {
    use crate::loop_connect::Taste;
    let taste = if taste == Taste::Ask { Taste::Skip } else { taste };
    let (mut value, ok) = crate::loop_connect::connect_json(io, only);
    // Only the agents this run connected.
    let connected: Vec<String> = value["agents"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|a| a["result"] == "connected")
        .filter_map(|a| a["agent"].as_str().map(str::to_owned))
        .collect();
    let rows = if connected.is_empty() {
        Vec::new()
    } else {
        crate::loop_connect::offer_taste(io, &connected, taste).1
    };
    if !rows.is_empty() {
        value["taste"] = serde_json::Value::Array(rows);
    }
    (value, ok)
}

/// `loop install` with Loop already there: nothing to do, so it succeeds, and opens the
/// app as an install would (unless `--no-open`).
/// Opens the installed app (unless `--no-open`). Called only under the install lock, so
/// it never restarts a Loop an update is quitting or replacing. A launch that fails
/// still leaves the install fine, so it is reported, not returned as an error.
fn already_installed(app: &Path, no_open: bool) -> Result<String> {
    let mut out = String::from("Loop is already installed. To get the newest: impeccable loop update.\n");
    if !no_open {
        let opened = Command::new("/usr/bin/open").arg(app).status();
        if !opened.as_ref().is_ok_and(|s| s.success()) {
            let why = match opened {
                Ok(s) => format!("open exited with {s}"),
                Err(e) => e.to_string(),
            };
            out.push_str(&format!(
                "Couldn't open Loop ({why}). Open it from {}.\n",
                app.display()
            ));
        }
    }
    Ok(out)
}

/// One Loop install or update at a time, on ~/Applications itself. flock is released
/// automatically on process exit, including a crash.
fn install_lock(apps: &Path) -> Result<fs::File> {
    let lock = fs::File::open(apps).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::fd::AsRawFd;
        // A short wait: a lock released a moment ago can still be held by a process
        // that is starting up and hasn't yet dropped the descriptors it inherited.
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        // SAFETY: flock on a descriptor this function owns; released when the file drops.
        while unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
            if std::time::Instant::now() >= deadline {
                return Err("Another Loop install or update is in progress.".into());
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }
    Ok(lock)
}

fn run_inner(args: &[String], io: &Io, manifest: &str, os: &str) -> Result<String> {
    // Arguments first, so usage and its errors read the same on every OS (the oracle records them).
    if args.first().is_some_and(|s| s == "--help" || s == "-h") {
        return Ok(USAGE.into());
    }
    match args.first().map(String::as_str) {
        Some("connect") if args.len() == 1 => {
            check_platform(os)?;
            return crate::loop_connect::connect(io);
        }
        Some("status") if args.len() == 1 => {
            check_platform(os)?;
            return crate::loop_connect::status(io).map(|v| crate::loop_connect::status_text(&v));
        }
        Some("connect") if args.len() == 3 && args[1] == "--agent" => {
            check_platform(os)?;
            return crate::loop_connect::connect_only(io, Some(&args[2]));
        }
        Some("disconnect") if args.len() == 1 => {
            check_platform(os)?;
            return crate::loop_connect::disconnect(io);
        }
        _ => {}
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
    check_platform(os)?;
    if !update {
        if let Some(app) = io
            .home()
            .map(|home| home.join("Applications").join(APP))
            .filter(|app| app.exists())
        {
            let _lock = install_lock(app.parent().unwrap_or(&app))?;
            return already_installed(&app, no_open);
        }
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
    let _lock = install_lock(&apps)?;
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
        return already_installed(&app, no_open);
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
        // A running Loop is asked to quit only once the new build is downloaded and
        // verified, just before the swap, so a failed download leaves it running.
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
        quit_running(&app, QUIT_WAIT)?;
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
