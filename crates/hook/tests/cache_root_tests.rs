//! IMPECCABLE_CACHE_ROOT (#422) — mirrors the scenarios main's
//! tests/hook.test.mjs added in 77a2eae8 / 5c82d58b / 30b3628f / cbd78701.
//!
//! These tests mutate the process environment, so they live in their own
//! test binary (its own process) and serialize on ENV_LOCK.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use impeccable_detect::MissingHtmlEngine;
use impeccable_hook::hook_lib::{get_cache_path, get_pending_path, Runtime};
use impeccable_hook::hook;
use serde_json::json;

static TMP_SEQ: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

static HTML: MissingHtmlEngine = MissingHtmlEngine;
static ENV_LOCK: Mutex<()> = Mutex::new(());

struct EnvGuard {
    saved: Vec<(&'static str, Option<String>)>,
}
impl EnvGuard {
    fn set(pairs: &[(&'static str, Option<&str>)]) -> EnvGuard {
        let mut saved = Vec::new();
        for (k, v) in pairs {
            saved.push((*k, std::env::var(k).ok()));
            match v {
                Some(v) => std::env::set_var(k, v),
                None => std::env::remove_var(k),
            }
        }
        EnvGuard { saved }
    }
}
impl Drop for EnvGuard {
    fn drop(&mut self) {
        for (k, v) in &self.saved {
            match v {
                Some(v) => std::env::set_var(k, v),
                None => std::env::remove_var(k),
            }
        }
    }
}

struct Tmp(PathBuf);
impl Tmp {
    fn new() -> Tmp {
        let base = std::env::temp_dir().join(format!(
            "impeccable-cache-root-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos(),
            // A per-process counter: Windows' clock is coarse enough that two
            // parallel tests can share a nanosecond stamp and then delete each
            // other's directories.
            TMP_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&base).unwrap();
        // Like Node's `realpathSync`: no `\\?\` verbatim prefix on Windows, so the
        // paths the hook joins under this root resolve (the kernel takes a
        // verbatim path literally and rejects a forward slash).
        let real = std::fs::canonicalize(&base).unwrap().to_string_lossy().into_owned();
        Tmp(PathBuf::from(real.strip_prefix(r"\\?\").unwrap_or(&real)))
    }
    fn path(&self) -> String {
        self.0.to_string_lossy().into_owned()
    }
    fn write(&self, rel: &str, body: &str) -> String {
        let abs = self.0.join(rel);
        std::fs::create_dir_all(abs.parent().unwrap()).unwrap();
        std::fs::write(&abs, body).unwrap();
        abs.to_string_lossy().into_owned()
    }
}
impl Drop for Tmp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn rt(cwd: &str) -> Runtime<'static> {
    Runtime::new(cwd.to_string(), HashMap::new(), "/impeccable".to_string(), "/opt/bin/impeccable", &HTML)
}

fn edit_event(cwd: &str, file: &str, session: &str) -> String {
    json!({
        "session_id": session, "cwd": cwd, "hook_event_name": "PostToolUse",
        "tool_name": "Edit", "tool_input": { "file_path": file },
    })
    .to_string()
}

const GRADIENT_CSS: &str = ".title { background: linear-gradient(90deg, #f472b6, #a78bfa); -webkit-background-clip: text; color: transparent; }\n";
const CLEAN_CSS: &str = ".card { color: #333; }\n";

#[test]
fn state_relocates_and_slug_normalizes() {
    let _l = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let root = Tmp::new();
    let _g = EnvGuard::set(&[("IMPECCABLE_CACHE_ROOT", Some(&root.path()))]);

    let cache = get_cache_path("/x/my.app");
    assert!(cache.starts_with(&root.path()), "{}", cache);
    assert!(cache.ends_with("hook.cache.json"));
    // Pending lands in the same per-project dir.
    let pending = get_pending_path("/x/my.app");
    assert_eq!(
        std::path::Path::new(&cache).parent(),
        std::path::Path::new(&pending).parent()
    );
    // Trailing separators and relative segments slug to the same dir.
    assert_eq!(get_cache_path("/x/my.app"), get_cache_path("/x/my.app/"));
    assert_eq!(get_cache_path("/x/my.app"), get_cache_path("/x/other/../my.app"));
    // The readable part stays human-scannable and the 8-hex digest keeps
    // colliding readable slugs apart (`/x/my.app` vs `/x/my-app`).
    let dir = std::path::Path::new(&cache).parent().unwrap().file_name().unwrap().to_string_lossy().into_owned();
    // The readable part is the RESOLVED project path with `:`, `\`, `/` and `.`
    // mapped to `-`, so on Windows it carries the current drive
    // (`D:\x\my.app` -> `D--x-my-app`). Derive it rather than pinning the
    // POSIX spelling.
    let resolved = impeccable_common::jsp::resolve(
        &std::env::current_dir().unwrap().to_string_lossy(),
        &["/x/my.app"],
    );
    let readable: String = resolved
        .chars()
        .map(|c| if matches!(c, ':' | '\\' | '/' | '.') { '-' } else { c })
        .collect();
    assert!(dir.starts_with(&format!("{readable}-")), "{}", dir);
    let digest = dir.rsplit('-').next().unwrap();
    assert_eq!(digest.len(), 8);
    assert!(digest.chars().all(|c| c.is_ascii_hexdigit()));
    assert_ne!(get_cache_path("/x/my.app"), get_cache_path("/x/my-app"));
}

/// The project-local cache path for `/x/app`, joined with the host's path
/// semantics (backslashes on Windows), which is what the stock behavior
/// produces.
fn stock_cache_path() -> String {
    impeccable_common::jsp::join(&["/x/app", ".impeccable", "hook.cache.json"])
}

#[test]
fn root_value_normalization_and_opt_out() {
    let _l = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let root = Tmp::new();
    // Stray whitespace in env files trims away.
    let padded = format!("  {}  ", root.path());
    let trimmed = {
        let _g = EnvGuard::set(&[("IMPECCABLE_CACHE_ROOT", Some(&root.path()))]);
        get_cache_path("/x/app")
    };
    let with_ws = {
        let _g = EnvGuard::set(&[("IMPECCABLE_CACHE_ROOT", Some(&padded))]);
        get_cache_path("/x/app")
    };
    assert_eq!(trimmed, with_ws);
    // Unset or blank keeps stock project-local behavior.
    {
        let _g = EnvGuard::set(&[("IMPECCABLE_CACHE_ROOT", None)]);
        assert_eq!(get_cache_path("/x/app"), stock_cache_path());
    }
    {
        let _g = EnvGuard::set(&[("IMPECCABLE_CACHE_ROOT", Some("   "))]);
        assert_eq!(get_cache_path("/x/app"), stock_cache_path());
    }
}

#[cfg(unix)]
#[test]
fn tilde_expands_against_homedir_or_rejects() {
    let _l = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = Tmp::new();
    let explicit = {
        let joined = format!("{}/caches", home.path());
        let _g = EnvGuard::set(&[("HOME", Some(&home.path())), ("IMPECCABLE_CACHE_ROOT", Some(&joined))]);
        get_cache_path("/x/app")
    };
    let tilde = {
        let _g = EnvGuard::set(&[("HOME", Some(&home.path())), ("IMPECCABLE_CACHE_ROOT", Some("~/caches"))]);
        get_cache_path("/x/app")
    };
    assert_eq!(explicit, tilde);
    // No determinable home dir: expansion is rejected and state falls back
    // to the project-local default (never the process cwd).
    let no_home = {
        let _g = EnvGuard::set(&[("HOME", None), ("USERPROFILE", None), ("IMPECCABLE_CACHE_ROOT", Some("~/caches"))]);
        get_cache_path("/x/app")
    };
    assert_eq!(no_home, "/x/app/.impeccable/hook.cache.json");
}

#[test]
fn run_hook_persists_and_dedupes_through_the_redirect() {
    let _l = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let root = Tmp::new();
    let project = Tmp::new();
    let _g = EnvGuard::set(&[("IMPECCABLE_CACHE_ROOT", Some(&root.path()))]);
    let cwd = project.path();
    let r = rt(&cwd);
    let css = project.write("src/a.css", GRADIENT_CSS);

    let one = hook::run_hook(&r, &edit_event(&cwd, &css, "s1"));
    assert!(one.stdout.contains("gradient-text"), "{}", one.stdout);
    // State lands under the redirect root; the project stays footprint-free.
    assert!(std::path::Path::new(&get_cache_path(&cwd)).exists());
    assert!(!project.0.join(".impeccable").exists());

    // The remembered finding dedupes the second identical edit into pending.
    let two = hook::run_hook(&r, &edit_event(&cwd, &css, "s1"));
    assert!(two.stdout.contains("flagged earlier this session"), "{}", two.stdout);

    // A clean edit still persists its editCount bump: the redirected cache
    // file is the opt-in marker even though `.impeccable/` never appears.
    let clean = project.write("src/b.css", CLEAN_CSS);
    let before = std::fs::read_to_string(get_cache_path(&cwd)).unwrap();
    let three = hook::run_hook(&r, &edit_event(&cwd, &clean, "s1"));
    assert_eq!(three.audit.get("kind").and_then(|v| v.as_str()), Some("clean"));
    let after = std::fs::read_to_string(get_cache_path(&cwd)).unwrap();
    assert_ne!(before, after, "clean-edit editCount bump persisted through the redirect");
}

#[test]
fn no_footprint_noop_gate_holds_under_redirect() {
    let _l = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let root = Tmp::new();
    let project = Tmp::new();
    let _g = EnvGuard::set(&[("IMPECCABLE_CACHE_ROOT", Some(&root.path()))]);
    let cwd = project.path();
    let r = rt(&cwd);
    // A clean UI edit in a project with no Impeccable footprint must be a
    // no-op on disk (issues #344, #305), redirect or not.
    let clean = project.write("src/b.css", CLEAN_CSS);
    let res = hook::run_hook(&r, &edit_event(&cwd, &clean, "s1"));
    assert_eq!(res.audit.get("kind").and_then(|v| v.as_str()), Some("clean"));
    assert!(!std::path::Path::new(&get_cache_path(&cwd)).exists());
    assert!(!project.0.join(".impeccable").exists());
}
