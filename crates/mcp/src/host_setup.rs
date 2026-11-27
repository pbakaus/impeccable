//! Registers the browser relay with Chrome (REN-2053): `install` writes one launcher and, for each
//! Chromium-based browser on the machine, a native-messaging host manifest naming it. macOS and Linux only.
//!
//! The launcher, `<IMPECCABLE_HOME>/browser/host`, holds nothing browser-specific: each time it runs it finds the
//! newest verified engine under `<IMPECCABLE_HOME>/bin` (the rule in CLI-CONTRACT's `agents` section) and execs it
//! with its arguments. So it's written once and survives every update; Chrome starts it with a bare environment,
//! so the home folder is written into it.
#[cfg(unix)]
use crate::browser::EXTENSION_IDS;
#[cfg(unix)]
use serde_json::{json, Value};
use std::path::Path;
#[cfg(unix)]
use std::path::PathBuf;

/// The host's name, as Chrome and the extension know it.
pub const HOST_NAME: &str = "style.impeccable.browser";

/// The launcher script for an Impeccable home folder.
pub fn launcher_script(impeccable_home: &Path) -> String {
    let home = impeccable_home.to_string_lossy().replace('\'', r"'\''");
    format!(
        r#"#!/bin/sh
# Impeccable: runs the newest verified engine under this home's bin folder. Written by impeccable install.
home='{home}'
best=''
for v in $(ls -1 "$home/bin" 2>/dev/null | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | sort -t. -k1,1n -k2,2n -k3,3n); do
  f="$home/bin/$v/impeccable"
  s="$f.verified"
  [ -f "$f" ] && [ -x "$f" ] && [ -f "$s" ] || continue
  [ "$f" -nt "$s" ] && continue
  want=$(awk '{{print $2; exit}}' "$s")
  size=$(wc -c < "$f" | tr -d ' ')
  [ -n "$want" ] && [ "$size" = "$want" ] && best="$f"
done
if [ -z "$best" ]; then
  echo "Impeccable: no verified engine in $home/bin. Run npx impeccable install." >&2
  exit 1
fi
IMPECCABLE_HOME="$home"
export IMPECCABLE_HOME
exec "$best" "$@"
"#
    )
}

#[cfg(unix)]
/// Where Chromium-based browsers read a user's native-messaging hosts: (browser, profile root). A browser counts
/// as present when its profile root exists.
fn browsers(user_home: &Path, config_home: Option<&Path>) -> Vec<(&'static str, PathBuf)> {
    let list: &[(&str, &str)] = if cfg!(target_os = "macos") {
        &[
            ("Chrome", "Library/Application Support/Google/Chrome"),
            ("Chrome Beta", "Library/Application Support/Google/Chrome Beta"),
            ("Chrome Canary", "Library/Application Support/Google/Chrome Canary"),
            ("Chromium", "Library/Application Support/Chromium"),
            ("Edge", "Library/Application Support/Microsoft Edge"),
            ("Brave", "Library/Application Support/BraveSoftware/Brave-Browser"),
        ]
    } else {
        &[
            ("Chrome", ".config/google-chrome"),
            ("Chrome Beta", ".config/google-chrome-beta"),
            ("Chromium", ".config/chromium"),
            ("Edge", ".config/microsoft-edge"),
            ("Brave", ".config/BraveSoftware/Brave-Browser"),
        ]
    };
    // On Linux a set XDG_CONFIG_HOME moves every Chromium profile from ~/.config to it.
    let config = config_home.filter(|p| p.is_absolute()).map(Path::to_path_buf);
    list.iter()
        .map(|(name, rel)| match (&config, rel.strip_prefix(".config/")) {
            (Some(root), Some(under)) => (*name, root.join(under)),
            _ => (*name, user_home.join(rel)),
        })
        .collect()
}

#[cfg(unix)]
/// Sandboxed browsers that can't start a program outside their sandbox: (browser, folder that marks it).
fn sandboxed(user_home: &Path) -> Vec<(&'static str, PathBuf)> {
    if cfg!(target_os = "macos") {
        return Vec::new();
    }
    [
        ("Chromium (snap)", "snap/chromium"),
        ("Chrome (Flatpak)", ".var/app/com.google.Chrome"),
        ("Chromium (Flatpak)", ".var/app/org.chromium.Chromium"),
        ("Brave (Flatpak)", ".var/app/com.brave.Browser"),
        ("Edge (Flatpak)", ".var/app/com.microsoft.Edge"),
    ]
    .iter()
    .map(|(name, rel)| (*name, user_home.join(rel)))
    .filter(|(_, p)| p.is_dir())
    .collect()
}

#[cfg(unix)]
fn manifest(launcher: &Path) -> Value {
    json!({
        "name": HOST_NAME,
        "description": "Impeccable: lets your coding agent use this browser",
        "path": launcher.to_string_lossy(),
        "type": "stdio",
        "allowed_origins": EXTENSION_IDS.iter().map(|id| format!("chrome-extension://{id}/")).collect::<Vec<_>>(),
    })
}

#[cfg(unix)]
/// Write `bytes` to `path` through a file beside it, so a reader never sees half of it.
fn write_atomically(path: &Path, bytes: &[u8], mode: u32) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let tmp = path.with_extension(format!("tmp-{}", std::process::id()));
    std::fs::write(&tmp, bytes)?;
    std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(mode))?;
    std::fs::rename(&tmp, path).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp);
    })
}

/// Whether `<home>/bin` holds an engine the launcher would run: an `x.y.z` folder whose `impeccable` has an
/// `impeccable.verified` stamp whose size field matches it, and that is not newer than the stamp (the launcher's rule).
#[cfg(unix)]
pub fn verified_engine(impeccable_home: &Path) -> bool {
    let Ok(dirs) = std::fs::read_dir(impeccable_home.join("bin")) else { return false };
    dirs.flatten().any(|d| {
        let name = d.file_name();
        let semver = name.to_str().is_some_and(|n| { let p: Vec<_> = n.split('.').collect(); p.len() == 3 && p.iter().all(|x| !x.is_empty() && x.bytes().all(|b| b.is_ascii_digit())) });
        let bin = d.path().join("impeccable");
        let stamp = d.path().join("impeccable.verified");
        let (Ok(b), Ok(st)) = (std::fs::metadata(&bin), std::fs::metadata(&stamp)) else { return false };
        let size = std::fs::read_to_string(&stamp).ok().and_then(|t| t.split_whitespace().nth(1).and_then(|n| n.parse::<u64>().ok()));
        let newer = matches!((b.modified(), st.modified()), (Ok(bm), Ok(sm)) if bm > sm);
        semver && size == Some(b.len()) && !newer
    })
}

/// Write the launcher and every present browser's manifest, once the cache holds a verified engine. Returns the lines
/// install prints: nothing when it was all in place already, or with no engine to run. Never fails the install: a folder it can't write is named and skipped.
#[cfg(unix)]
pub fn register(user_home: &Path, impeccable_home: &Path, config_home: Option<&Path>) -> Vec<String> {
    use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
    let mut lines = Vec::new();
    // A launcher with no engine to run would only fail in Chrome: an install that runs a bundled engine and fills no
    // cache registers nothing, and the next install that does fills it registers then.
    if !verified_engine(impeccable_home) {
        return lines;
    }
    let dir = impeccable_home.join("browser");
    let launcher = dir.join("host");
    let script = launcher_script(impeccable_home);
    if std::fs::read_to_string(&launcher).ok().as_deref() != Some(script.as_str()) {
        let wrote = std::fs::DirBuilder::new().recursive(true).mode(0o700).create(&dir)
            .and_then(|()| std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)))
            .and_then(|()| write_atomically(&launcher, script.as_bytes(), 0o700));
        if wrote.is_err() {
            lines.push(format!("Could not write the Impeccable browser host at {}; your agent can't use Chrome yet.", launcher.display()));
            return lines;
        }
    }
    let ours = manifest(&launcher);
    let body = format!("{}\n", serde_json::to_string_pretty(&ours).unwrap_or_default());
    let mut added = Vec::new();
    for (name, root) in browsers(user_home, config_home) {
        if !root.is_dir() {
            continue;
        }
        let hosts = root.join("NativeMessagingHosts");
        let path = hosts.join(format!("{HOST_NAME}.json"));
        if let Ok(existing) = std::fs::read_to_string(&path) {
            let theirs: Value = serde_json::from_str(&existing).unwrap_or(Value::Null);
            if theirs["path"] == ours["path"] && theirs["allowed_origins"] == ours["allowed_origins"] {
                continue;
            }
            // One an older impeccable wrote points at our own launcher: brought up to this version's origins.
            if theirs["path"] != ours["path"] {
                lines.push(format!("{name} already has another {HOST_NAME} host at {}; left it as it is.", path.display()));
                continue;
            }
        }
        match std::fs::create_dir_all(&hosts).and_then(|()| write_atomically(&path, body.as_bytes(), 0o644)) {
            Ok(()) => added.push(name),
            Err(_) => lines.push(format!("Could not register the Impeccable browser host with {name}; skipped.")),
        }
    }
    if !added.is_empty() {
        lines.insert(0, format!("Your coding agent can now use {} through the Impeccable extension.", added.join(", ")));
    }
    for (name, _) in sandboxed(user_home) {
        lines.push(format!("{name} runs sandboxed and can't start the Impeccable browser host; use a Chrome installed from google.com/chrome."));
    }
    lines
}

#[cfg(not(unix))]
pub fn register(_: &Path, _: &Path, _: Option<&Path>) -> Vec<String> {
    Vec::new()
}
