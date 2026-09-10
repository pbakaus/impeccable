//! Open a URL in the user's browser: the generate lane's one-shot start
//! (`live-generate --open`) hands the page to the browser itself instead of
//! spending an agent turn on it.
//!
//! Preference order (the one issue #611 settled on): `IMPECCABLE_BROWSER`,
//! then `browser` in `.impeccable/config.local.json` or
//! `.impeccable/config.json` at the app root, then `BROWSER`, then the
//! platform's default opener (`open`, `xdg-open`, `cmd /c start`). A value
//! that is a path to a program or script runs with the URL as its argument;
//! on macOS any other value is an application name (`open -a <name>`).

use crate::util::Env;
use serde_json::Value;
use std::path::Path;
use std::process::{Command, Stdio};

/// The browser the user chose for impeccable itself: `IMPECCABLE_BROWSER`,
/// else `browser` in `.impeccable/config.local.json` / `config.json`. This
/// is the one preference that may open a window beside a harness's own
/// browser, because the user asked for exactly that.
pub fn explicit_browser(cwd: &str, env: &Env) -> Option<String> {
    let nonempty = |v: Option<&String>| v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    if let Some(b) = nonempty(env.get("IMPECCABLE_BROWSER")) {
        return Some(b);
    }
    for name in ["config.local.json", "config.json"] {
        let path = Path::new(cwd).join(".impeccable").join(name);
        let Ok(text) = std::fs::read_to_string(&path) else { continue };
        let Ok(v) = serde_json::from_str::<Value>(&text) else { continue };
        if let Some(b) = v.get("browser").and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()) {
            return Some(b.to_string());
        }
    }
    None
}

/// The configured browser, if any (see the module doc for the order): the
/// explicit choice, else the generic `BROWSER` variable.
pub fn resolve_browser(cwd: &str, env: &Env) -> Option<String> {
    explicit_browser(cwd, env).or_else(|| env.get("BROWSER").map(|s| s.trim().to_string()).filter(|s| !s.is_empty()))
}

/// Launch the browser on `url` without waiting for it. Returns a short
/// description of what was launched, for the verdict.
pub fn open_url(url: &str, cwd: &str, env: &Env) -> Result<String, String> {
    let preference = resolve_browser(cwd, env);
    let mut cmd = command_for(url, preference.as_deref());
    let description = format!("{:?}", cmd).replace('"', "");
    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    impeccable_common::proc::detach(&mut cmd);
    cmd.spawn().map(|_| description).map_err(|e| format!("{}: {}", e, preference.unwrap_or_else(|| "default opener".to_string())))
}

fn command_for(url: &str, preference: Option<&str>) -> Command {
    match preference {
        Some(p) if Path::new(p).is_file() || p.contains('/') || p.contains('\\') => {
            let mut c = Command::new(p);
            c.arg(url);
            c
        }
        Some(p) => {
            if cfg!(target_os = "macos") {
                let mut c = Command::new("open");
                c.arg("-a").arg(p).arg(url);
                c
            } else if cfg!(windows) {
                let mut c = Command::new("cmd");
                c.arg("/c").arg("start").arg("").arg(p).arg(url);
                c
            } else {
                let mut c = Command::new(p);
                c.arg(url);
                c
            }
        }
        None => {
            if cfg!(target_os = "macos") {
                let mut c = Command::new("open");
                c.arg(url);
                c
            } else if cfg!(windows) {
                let mut c = Command::new("cmd");
                c.arg("/c").arg("start").arg("").arg(url);
                c
            } else {
                let mut c = Command::new("xdg-open");
                c.arg(url);
                c
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(pairs: &[(&str, &str)]) -> Env {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn the_env_var_wins_then_the_config_then_browser() {
        let dir = std::env::temp_dir().join(format!("impeccable-browser-open-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".impeccable")).unwrap();
        let cwd = dir.to_string_lossy().into_owned();
        assert_eq!(resolve_browser(&cwd, &env(&[])), None);
        assert_eq!(resolve_browser(&cwd, &env(&[("BROWSER", "firefox")])), Some("firefox".into()));
        std::fs::write(dir.join(".impeccable/config.json"), r#"{"browser":"Safari"}"#).unwrap();
        assert_eq!(resolve_browser(&cwd, &env(&[("BROWSER", "firefox")])), Some("Safari".into()));
        std::fs::write(dir.join(".impeccable/config.local.json"), r#"{"browser":"/tmp/my-opener"}"#).unwrap();
        assert_eq!(resolve_browser(&cwd, &env(&[])), Some("/tmp/my-opener".into()));
        assert_eq!(resolve_browser(&cwd, &env(&[("IMPECCABLE_BROWSER", " chrome ")])), Some("chrome".into()));
        // BROWSER is a fallback for the opener, never the user's explicit choice.
        std::fs::remove_file(dir.join(".impeccable/config.local.json")).unwrap();
        std::fs::remove_file(dir.join(".impeccable/config.json")).unwrap();
        assert_eq!(explicit_browser(&cwd, &env(&[("BROWSER", "firefox")])), None);
        assert_eq!(explicit_browser(&cwd, &env(&[("IMPECCABLE_BROWSER", "chrome")])), Some("chrome".into()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_path_runs_with_the_url_as_its_argument() {
        let c = command_for("http://127.0.0.1:5173/", Some("/tmp/opener.sh"));
        let shown = format!("{:?}", c);
        assert!(shown.starts_with("\"/tmp/opener.sh\""), "{shown}");
        assert!(shown.contains("http://127.0.0.1:5173/"), "{shown}");
    }
}
