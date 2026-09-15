//! Find an installed Chromium-based browser. The JS engine launches
//! puppeteer's bundled Chrome (on Windows the system `channel: 'chrome'`
//! first, then bundled); the binary downloads nothing, so it discovers an
//! installed browser instead. Order:
//!
//! 1. `IMPECCABLE_BROWSER` (explicit override)
//! 2. `PUPPETEER_EXECUTABLE_PATH` (what puppeteer honors)
//! 3. `CHROME_PATH` (chrome-launcher convention)
//! 4. Per-OS standard locations: Google Chrome, Chromium, Microsoft Edge,
//!    Brave (macOS `/Applications` and `~/Applications` bundles; Linux
//!    binaries on `PATH`; Windows Program Files / LOCALAPPDATA paths).

use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Env keys consulted, in order.
pub const ENV_KEYS: [&str; 3] = [
    "IMPECCABLE_BROWSER",
    "PUPPETEER_EXECUTABLE_PATH",
    "CHROME_PATH",
];

/// Message when nothing is found (rendered by detect as `Error: ${message}`).
pub const NOT_FOUND_MESSAGE: &str = "No Chrome, Chromium, Edge, or Brave installation found for URL scanning. Install Google Chrome, or point IMPECCABLE_BROWSER at a Chromium-based browser executable.";

/// Locate a browser executable, honoring env overrides then standard paths.
/// An env override that names a missing file is reported instead of being
/// silently skipped (mirrors puppeteer's `Browser was not found at the
/// configured executablePath (...)`).
pub fn find_browser(env: &HashMap<String, String>) -> Result<PathBuf, String> {
    for key in ENV_KEYS {
        if let Some(raw) = env.get(key) {
            let raw = raw.trim();
            if raw.is_empty() {
                continue;
            }
            let path = PathBuf::from(raw);
            if is_executable_file(&path) {
                return Ok(path);
            }
            return Err(format!(
                "Browser was not found at the configured executablePath ({raw}) from {key}"
            ));
        }
    }
    for candidate in standard_candidates(env) {
        if is_executable_file(&candidate) {
            return Ok(candidate);
        }
    }
    Err(NOT_FOUND_MESSAGE.to_string())
}

fn is_executable_file(path: &Path) -> bool {
    match std::fs::metadata(path) {
        Ok(m) => m.is_file(),
        Err(_) => false,
    }
}

/// The per-OS candidate list, in priority order (Chrome, Chromium, Edge, Brave).
pub fn standard_candidates(env: &HashMap<String, String>) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if cfg!(target_os = "macos") {
        let bundles = [
            "Google Chrome.app/Contents/MacOS/Google Chrome",
            "Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
            "Chromium.app/Contents/MacOS/Chromium",
            "Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "Brave Browser.app/Contents/MacOS/Brave Browser",
        ];
        let mut roots = vec![PathBuf::from("/Applications")];
        if let Some(home) = env.get("HOME") {
            roots.push(Path::new(home).join("Applications"));
        }
        for bundle in bundles {
            for root in &roots {
                out.push(root.join(bundle));
            }
        }
    } else if cfg!(target_os = "windows") {
        let rel = [
            "Google\\Chrome\\Application\\chrome.exe",
            "Chromium\\Application\\chrome.exe",
            "Microsoft\\Edge\\Application\\msedge.exe",
            "BraveSoftware\\Brave-Browser\\Application\\brave.exe",
        ];
        let roots = windows_roots(env);
        for r in rel {
            for root in &roots {
                out.push(root.join(r));
            }
        }
    } else {
        let names = [
            "google-chrome",
            "google-chrome-stable",
            "chromium",
            "chromium-browser",
            "microsoft-edge",
            "microsoft-edge-stable",
            "brave-browser",
        ];
        let path_var = env.get("PATH").cloned().unwrap_or_default();
        let dirs: Vec<PathBuf> = path_var
            .split(':')
            .filter(|d| !d.is_empty())
            .map(PathBuf::from)
            .chain(
                [
                    "/usr/bin",
                    "/usr/local/bin",
                    "/snap/bin",
                    "/opt/google/chrome",
                ]
                .iter()
                .map(PathBuf::from),
            )
            .collect();
        for name in names {
            for dir in &dirs {
                out.push(dir.join(name));
            }
        }
        out.push(PathBuf::from("/opt/google/chrome/chrome"));
        out.push(PathBuf::from("/opt/microsoft/msedge/msedge"));
        out.push(PathBuf::from("/opt/brave.com/brave/brave"));
    }
    out
}

// Windows environment names are case-insensitive, but std::env::vars keeps
// their original casing when collected into a Rust HashMap. LOCALAPPDATA alone
// must not suppress the Program Files locations where system browsers live.
fn windows_roots(env: &HashMap<String, String>) -> Vec<PathBuf> {
    let value = |name: &str| env.iter().find(|(key, value)|
        key.eq_ignore_ascii_case(name) && !value.is_empty()).map(|(_, value)| value);
    let mut roots = vec![
        PathBuf::from(value("ProgramFiles").map(String::as_str).unwrap_or(r"C:\Program Files")),
        PathBuf::from(value("ProgramFiles(x86)").map(String::as_str).unwrap_or(r"C:\Program Files (x86)")),
    ];
    if let Some(local) = value("LOCALAPPDATA") { roots.push(PathBuf::from(local)); }
    roots
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_override_wins_and_missing_override_errors() {
        let mut env = HashMap::new();
        env.insert(
            "IMPECCABLE_BROWSER".to_string(),
            "/definitely/missing".to_string(),
        );
        let err = find_browser(&env).unwrap_err();
        assert!(err.contains("/definitely/missing"));
        assert!(err.contains("IMPECCABLE_BROWSER"));
        let me = std::env::current_exe().unwrap();
        env.insert(
            "IMPECCABLE_BROWSER".to_string(),
            me.to_string_lossy().to_string(),
        );
        assert_eq!(find_browser(&env).unwrap(), me);
    }

    #[test]
    fn windows_roots_preserve_system_locations_with_mixed_case_environment() {
        let env = HashMap::from([
            ("ProgramFiles".into(), r"D:\Apps".into()),
            ("ProgramFiles(x86)".into(), r"D:\Apps32".into()),
            ("LOCALAPPDATA".into(), r"C:\Users\runner\AppData\Local".into()),
        ]);
        assert_eq!(windows_roots(&env), vec![PathBuf::from(r"D:\Apps"), PathBuf::from(r"D:\Apps32"), PathBuf::from(r"C:\Users\runner\AppData\Local")]);
        let partial = HashMap::from([("LOCALAPPDATA".into(), r"C:\Users\runner\AppData\Local".into())]);
        let roots = windows_roots(&partial);
        assert_eq!(roots[0], PathBuf::from(r"C:\Program Files"));
        assert_eq!(roots[1], PathBuf::from(r"C:\Program Files (x86)"));
    }

    #[test]
    fn candidates_are_ordered_chrome_first() {
        let env = HashMap::new();
        let list = standard_candidates(&env);
        assert!(!list.is_empty());
        let first = list[0].to_string_lossy().to_lowercase();
        assert!(first.contains("chrome"), "{first}");
    }
}
