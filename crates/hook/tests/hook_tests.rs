//! Rust counterparts of the edge cases in the public repo's
//! `tests/hook.test.mjs` that the oracle corpus does not exercise: path
//! classifiers, config merging, cache GC, git exclude, rendering and quoting,
//! target expansion, and the run flows (tiering, suppression, oversized files,
//! symlinked roots, umbrella launches, Stop pass, before-edit shell shapes,
//! hook-admin scoping). Findings come from the real regex engine, so fixture
//! bodies carry known slop: `gradient-text` (immediate tier) and `side-tab`
//! (deferred tier).

use std::collections::HashMap;
use std::path::PathBuf;

use impeccable_common::{jsp, Io};
use impeccable_core::findings::{finding, Finding};
use impeccable_detect::MissingHtmlEngine;
use impeccable_hook::hook_lib::*;
use impeccable_hook::{admin, before_edit, hook};
use serde_json::{json, Map, Value};

static HTML: MissingHtmlEngine = MissingHtmlEngine;

#[test]
#[cfg(unix)]
fn gemini_before_tool_preserves_command_body_and_only_carries_literal_identity() {
    let t = Tmp::new();
    let command = "printf '%s\\n' \"$IMPECCABLE_SESSION_ID\" # impeccable build-phase completion\nexit 7";
    for (name, session, disabled, expected) in [
        ("run_shell_command", "owner-123", false, true),
        ("read_file", "owner-123", false, false),
        ("run_shell_command", "bad'$(touch unsafe)", false, false),
        ("run_shell_command", "owner-123", true, false),
    ] {
        let r = rt_with(&t.path(), env(&[("IMPECCABLE_HOOK_DISABLED", if disabled { "1" } else { "" })]));
        let event = json!({"hook_event_name":"BeforeTool", "session_id":session,
            "cwd":t.path(), "tool_name":name, "tool_input":{"command":command, "timeout":12}});
        let (mut io, capture) = Io::captured("", t.0.clone(), HashMap::new());
        hook::run(&r, &event.to_string(), &mut io);
        let stdout = String::from_utf8(capture.stdout.borrow().clone()).unwrap();
        if expected {
            let output: Value = serde_json::from_str(&stdout).unwrap();
            let rewritten = output["hookSpecificOutput"]["tool_input"]["command"].as_str().unwrap();
            assert_eq!(rewritten, format!("export IMPECCABLE_SESSION_ID='owner-123'\n{command}"));
            assert!(output["hookSpecificOutput"].get("additionalContext").is_none());
            #[cfg(unix)] {
                let execution = std::process::Command::new("sh").args(["-c", rewritten]).output().unwrap();
                assert_eq!(execution.status.code(), Some(7));
                assert_eq!(String::from_utf8(execution.stdout).unwrap(), "owner-123\n");
            }
        } else { assert!(stdout.is_empty()); }
    }
}

#[test]
fn gemini_before_tool_leaves_unrelated_shell_commands_untouched() {
    // Only build-phase reads IMPECCABLE_SESSION_ID. Every other shell command
    // must reach Gemini's allowlist / coreTools policy exactly as the model
    // wrote it, so its first word is unchanged.
    let t = Tmp::new();
    let r = rt(&t.path());
    for command in ["npm test", "git status && ls", "impeccable build-phase completion --session-id x"] {
        let event = json!({"hook_event_name":"BeforeTool", "session_id":"owner-123",
            "cwd":t.path(), "tool_name":"run_shell_command", "tool_input":{"command":command}});
        let (mut io, capture) = Io::captured("", t.0.clone(), HashMap::new());
        hook::run(&r, &event.to_string(), &mut io);
        assert!(capture.stdout.borrow().is_empty(), "{command} was rewritten");
    }
}

#[test]
fn build_completion_reminder_skips_native_projects() {
    let t = Tmp::new();
    t.write("PRODUCT.md", "# P\n\n## Platform\nios\n");
    t.write("index.html", "<main>In progress</main>");
    t.write(".impeccable/build/state.json", &json!({
        "sessionId":"owner", "artifact":"index.html", "startedAt":"native-build",
        "phases":{"hero":{"status":"open"}}, "finish":null
    }).to_string());
    let stop = hook::run_stop_hook(&rt(&t.path()), &stop_event(&t.path(), "owner"));
    assert!(stop.stdout.is_empty(), "{}", stop.stdout);
    assert_eq!(stop.audit["skipped"], "native-platform");
}

#[test]
fn session_start_respects_disabled_hook_config() {
    let t = Tmp::new();
    let env_path = t.write("session.env", "");
    t.write(".impeccable/config.json", r#"{"hook":{"enabled":false}}"#);
    let r = rt_with(&t.path(), env(&[("CLAUDE_ENV_FILE", &env_path)]));
    let mut io = Io::captured("", t.0.clone(), HashMap::new()).0;
    let event = json!({"hook_event_name":"SessionStart", "session_id":"owner-123", "cwd":t.path()}).to_string();
    assert_eq!(hook::run(&r, &event, &mut io), 0);
    assert_eq!(t.read("session.env"), "");
}

#[test]
fn admin_on_and_reset_manage_gemini_without_losing_user_settings() {
    let t = Tmp::new();
    let cwd = t.path();
    let r = rt(&cwd);
    std::fs::create_dir_all(t.0.join(".gemini/skills/impeccable")).unwrap();
    t.write(".gemini/settings.json", "{\n  // user model\n  \"model\": {\"name\": \"gemini-3-pro\"}, /* auth */\n  \"security\": {\"auth\": {\"selectedType\": \"oauth-personal\"}}\n}\n");
    let (out, _, code) = admin_run(&r, &["on"]);
    assert_eq!(code, 0);
    assert!(out.contains("Installed or repaired hook manifests for: .gemini."), "{out}");
    let settings: Value = serde_json::from_str(&t.read(".gemini/settings.json")).unwrap();
    assert_eq!(settings["model"]["name"], "gemini-3-pro");
    assert_eq!(settings["security"]["auth"]["selectedType"], "oauth-personal");
    assert!(settings["hooks"]["AfterAgent"].is_array());
    assert!(settings["hooks"]["BeforeTool"][0]["matcher"] == "^run_shell_command$");
    assert!(t.exists(".gemini/settings.json.bak"), "commented settings are backed up before rewrite");
    let (out, _, _) = admin_run(&r, &["reset"]);
    assert!(out.contains("Removed hook entries from: .gemini."), "{out}");
    let settings: Value = serde_json::from_str(&t.read(".gemini/settings.json")).unwrap();
    assert!(settings.get("hooks").is_none());
    assert_eq!(settings["model"]["name"], "gemini-3-pro");
    // A settings file that is not JSON even after comments is left alone:
    // it holds the user's whole Gemini configuration, not just our hooks.
    t.write(".gemini/settings.json", "{ \"model\": ");
    let (out, _, _) = admin_run(&r, &["on"]);
    assert_eq!(t.read(".gemini/settings.json"), "{ \"model\": ");
    assert!(out.contains(".gemini/settings.json"), "{out}");
}

#[test]
fn gemini_after_agent_uses_native_retry_contract_and_session_scope() {
    let t = Tmp::new();
    t.write("index.html", "<main>In progress</main>");
    t.write(".impeccable/build/state.json", &json!({
        "sessionId":"gemini-owner", "artifact":"index.html", "startedAt":"gemini-build",
        "phases":{"hero":{"status":"open"}}, "finish":null
    }).to_string());
    let r = rt(&t.path());
    for (session, active, expected) in [("other", false, false), ("gemini-owner", false, true),
        ("gemini-owner", true, true), ("gemini-owner", true, true), ("gemini-owner", true, false)] {
        let event = json!({"hook_event_name":"AfterAgent", "session_id":session,
            "cwd":t.path(), "stop_hook_active":active});
        assert!(is_stop_event(event.as_object().unwrap()));
        let result = hook::run_stop_hook(&r, &event.to_string());
        if expected {
            let output: Value = serde_json::from_str(&result.stdout).unwrap();
            assert_eq!(output["decision"], "deny");
            assert!(output["reason"].as_str().unwrap().contains("Comp build"));
            assert!(output.get("hookSpecificOutput").is_none());
        } else { assert!(result.stdout.is_empty()); }
    }
}

#[test]
fn session_start_persists_only_a_literal_session_identity() {
    let t = Tmp::new();
    let env_path = t.write("session.env", "export EXISTING=kept\n");
    let r = rt_with(&t.path(), env(&[("CLAUDE_ENV_FILE", &env_path)]));
    let mut io = Io::captured("", t.0.clone(), HashMap::new()).0;
    for session in ["owner-123", "bad'$(touch unsafe)"] {
        let event = json!({"hook_event_name":"SessionStart", "session_id":session, "cwd":t.path()}).to_string();
        assert_eq!(hook::run(&r, &event, &mut io), 0);
    }
    assert_eq!(t.read("session.env"), "export EXISTING=kept\nexport IMPECCABLE_SESSION_ID='owner-123'\n");
}

#[test]
fn unfinished_comp_stop_is_owned_bounded_and_does_not_reopen_on_unrelated_turn() {
    let t = Tmp::new();
    t.write("index.html", "<main>In progress</main>");
    t.write(".impeccable/build/state.json", &json!({
        "tool":"build-phase", "version":2, "startedAt":"build-one",
        "sessionId":"owner", "artifact":"index.html", "finish":null,
        "phases":{"hero":{"status":"open"}}
    }).to_string());
    let r = rt(&t.path());
    assert!(hook::run_stop_hook(&r, &stop_event(&t.path(), "other")).stdout.is_empty());
    let first = hook::run_stop_hook(&r, &stop_event(&t.path(), "owner"));
    assert!(first.stdout.contains("Comp build"), "{}", first.stdout);
    // A new unrelated turn must not spend another reminder on unchanged work.
    assert!(hook::run_stop_hook(&r, &stop_event(&t.path(), "owner")).stdout.is_empty());
    let active = json!({"session_id":"owner","cwd":t.path(),"hook_event_name":"Stop","stop_hook_active":true}).to_string();
    assert!(hook::run_stop_hook(&r, &active).stdout.contains("Comp build"));
    assert!(hook::run_stop_hook(&r, &active).stdout.contains("Comp build"));
    assert!(hook::run_stop_hook(&r, &active).stdout.is_empty());
}

/// A comp build this session recorded as shipped, the way `finish` leaves it.
fn shipped_build(t: &Tmp) {
    shipped_build_in(t, "");
}

/// `shipped_build` under `dir` (empty or ending in `/`), where `build-phase` ran.
fn shipped_build_in(t: &Tmp, dir: &str) {
    t.write(&format!("{dir}index.html"), "<main>Shipped</main>");
    let mut state = json!({
        "tool":"build-phase", "version":2, "startedAt":"build-one", "phase":"review",
        "sessionId":"owner", "artifact":"index.html", "capturePolicy":"native-html-v1", "phases":{}
    });
    for phase in ["comps", "spec", "plates", "hero", "sections", "motion", "responsive", "review"] {
        state["phases"][phase] = json!({"status":"closed"});
    }
    let hash = impeccable_comp_verbs::completion::artifact_hash(&t.0.join(dir), &state).unwrap();
    state["finish"] = json!({"disposition":"ship", "phaseAtFinish":"review", "artifactSha256":hash,
        "captureInputs":[{"path":"index.html","sha256":hash}]});
    t.write(&format!("{dir}.impeccable/build/state.json"), &state.to_string());
}

#[test]
fn findings_over_a_shipped_build_say_a_fix_voids_the_finish_and_the_follow_up_asks_for_it_again() {
    let t = Tmp::new();
    t.write("package.json", "{}");
    shipped_build(&t);
    let file = t.write("card.css", SIDE_TAB_CSS);
    let r = rt(&t.path());
    hook::run_hook(&r, &edit_with_original(&t.path(), &file, "owner", ".card {}\n", ".card {}\n", SIDE_TAB_CSS));
    // The finish holds, so the Stop pass shows the findings, with the note that a fix voids it.
    let first = hook::run_stop_hook(&r, &stop_event(&t.path(), "owner"));
    assert!(first.stdout.contains("side-tab") || first.stdout.contains("Side-tab"), "{}", first.stdout);
    assert!(first.stdout.contains("The comp build for index.html has finish --disposition ship recorded. A fix after it voids that finish"), "{}", first.stdout);
    assert!(first.stdout.contains("/opt/bin/impeccable") && first.stdout.contains(" build-phase finish --disposition ship again"), "{}", first.stdout);
    // The agent fixes the page in the continuation those findings started.
    t.write("index.html", "<main>Shipped, then fixed</main>");
    let active = json!({"session_id":"owner","cwd":t.path(),"hook_event_name":"Stop","stop_hook_active":true}).to_string();
    let follow_up = hook::run_stop_hook(&r, &active);
    assert_eq!(follow_up.audit["kind"], "build-completion", "{:?}", follow_up.audit);
    assert!(follow_up.stdout.contains("A file the recorded finish bound changed after it (index.html)"), "{}", follow_up.stdout);
    assert!(follow_up.stdout.contains("build-phase finish --disposition ship again before you stop"), "{}", follow_up.stdout);
}

#[test]
fn another_hooks_continuation_after_a_shipped_build_is_not_taken_over() {
    let t = Tmp::new();
    shipped_build(&t);
    t.write("index.html", "<main>Changed by someone else's continuation</main>");
    let active = json!({"session_id":"owner","cwd":t.path(),"hook_event_name":"Stop","stop_hook_active":true}).to_string();
    let stop = hook::run_stop_hook(&rt(&t.path()), &active);
    assert!(stop.stdout.is_empty(), "{}", stop.stdout);
    // A new turn is still told the ship no longer covers the page.
    let fresh = hook::run_stop_hook(&rt(&t.path()), &stop_event(&t.path(), "owner"));
    assert!(fresh.stdout.contains("changed after it (index.html)"), "{}", fresh.stdout);
}

#[test]
fn the_findings_marker_grants_one_continuation_not_the_build() {
    let t = Tmp::new();
    t.write("package.json", "{}");
    shipped_build(&t);
    let file = t.write("card.css", SIDE_TAB_CSS);
    let r = rt(&t.path());
    hook::run_hook(&r, &edit_with_original(&t.path(), &file, "owner", ".card {}\n", ".card {}\n", SIDE_TAB_CSS));
    assert!(hook::run_stop_hook(&r, &stop_event(&t.path(), "owner")).stdout.contains("finish --disposition ship recorded"));
    // The continuation the findings started changes nothing the finish bound.
    let active = json!({"session_id":"owner","cwd":t.path(),"hook_event_name":"Stop","stop_hook_active":true}).to_string();
    assert!(hook::run_stop_hook(&r, &active).audit.get("kind").is_none());
    // A later continuation another hook started changes the page: not ours to take over.
    t.write("index.html", "<main>Changed in another hook's continuation</main>");
    let later = hook::run_stop_hook(&r, &active);
    assert!(!later.stdout.contains("Comp build"), "{}", later.stdout);
}

#[test]
fn a_bound_stylesheet_edit_after_a_reminder_earns_another() {
    let t = Tmp::new();
    t.write("site.css", "body{}");
    shipped_build(&t);
    let path = t.0.join(".impeccable/build/state.json");
    let mut state: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    let css_hash = format!("{:x}", <sha2::Sha256 as sha2::Digest>::digest(b"body{}"));
    state["finish"]["captureInputs"].as_array_mut().unwrap().push(json!({"path":"site.css","sha256":css_hash}));
    std::fs::write(&path, state.to_string()).unwrap();
    let r = rt(&t.path());
    t.write("index.html", "<main>Edited after ship</main>");
    assert!(hook::run_stop_hook(&r, &stop_event(&t.path(), "owner")).stdout.contains("Comp build"));
    assert!(hook::run_stop_hook(&r, &stop_event(&t.path(), "owner")).stdout.is_empty());
    // Only the stylesheet changes now; the entry bytes stay as the last reminder saw them.
    t.write("site.css", "body{color:red}");
    let stop = hook::run_stop_hook(&r, &stop_event(&t.path(), "owner"));
    assert!(stop.stdout.contains("(index.html, site.css)"), "{}", stop.stdout);
}

#[test]
fn findings_with_no_shipped_build_carry_no_finish_note() {
    let t = Tmp::new();
    t.write("package.json", "{}");
    let file = t.write("card.css", SIDE_TAB_CSS);
    let r = rt(&t.path());
    hook::run_hook(&r, &edit_with_original(&t.path(), &file, "owner", ".card {}\n", ".card {}\n", SIDE_TAB_CSS));
    let stop = hook::run_stop_hook(&r, &stop_event(&t.path(), "owner"));
    assert!(!stop.stdout.is_empty());
    assert!(!stop.stdout.contains("finish --disposition ship"), "{}", stop.stdout);
}

#[test]
fn legacy_comp_state_never_implicitly_claims_the_current_session() {
    let t = Tmp::new();
    t.write("index.html", "<main>Old work</main>");
    t.write(".impeccable/build/state.json", &json!({"artifact":"index.html","startedAt":"old","phases":{}}).to_string());
    assert!(hook::run_stop_hook(&rt(&t.path()), &stop_event(&t.path(), "new")).stdout.is_empty());
}

#[test]
fn completion_only_transport_does_not_duplicate_detector_feedback() {
    let t = Tmp::new();
    t.write("package.json", "{}");
    let file = t.write("card.css", SIDE_TAB_CSS);
    let r = rt_with(&t.path(), env(&[("IMPECCABLE_HOOK_COMPLETION_ONLY", "1")]));
    hook::run_hook(&r, &edit_with_original(&t.path(), &file, "owner", ".card {}\n", ".card {}\n", SIDE_TAB_CSS));
    let stop = hook::run_stop_hook(&r, &stop_event(&t.path(), "owner"));
    assert!(stop.stdout.is_empty());
    assert_eq!(stop.audit["skipped"], "no-build-continuation");
}

struct Tmp(PathBuf);
impl Tmp {
    fn new() -> Tmp {
        // pid + nanos alone can collide when the parallel runner starts two
        // tests inside one clock tick (seen as a paired flake under full
        // workspace load); the per-process counter makes each dir unique.
        static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let base = std::env::temp_dir().join(format!(
            "impeccable-hook-rs-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&base).unwrap();
        // Canonical path so the JS-style path helpers and the fs agree on macOS.
        // Like Node's `realpathSync`, without the `\\?\` verbatim prefix Windows
        // adds: the kernel takes a verbatim path literally, so a `/` joined
        // under it would not resolve.
        let real = std::fs::canonicalize(&base).unwrap().to_string_lossy().into_owned();
        Tmp(PathBuf::from(real.strip_prefix(r"\\?\").unwrap_or(&real)))
    }
    fn path(&self) -> String {
        self.0.to_string_lossy().into_owned()
    }
    fn write(&self, rel: &str, body: &str) -> String {
        // `PathBuf::join` keeps the `/` inside `rel`, which leaves a mixed-form
        // path on Windows; join the way the hook's own path helpers do, so the
        // returned path is what the hook resolves a relative target to.
        let abs = jsp::join(&[&self.path(), rel]);
        let p = std::path::Path::new(&abs).to_path_buf();
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, body).unwrap();
        abs
    }
    fn exists(&self, rel: &str) -> bool {
        self.0.join(rel).exists()
    }
    fn read(&self, rel: &str) -> String {
        std::fs::read_to_string(self.0.join(rel)).unwrap()
    }
}
impl Drop for Tmp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// The shared config path as the admin verbs print it: relative to the
/// project, in the host's path form (backslashes on Windows, as `path.relative`
/// renders it there).
fn shared_config_rel() -> String {
    jsp::join(&[".impeccable", "config.json"])
}

/// The local config path as the admin verbs print it, in the same host form.
fn local_config_rel() -> String {
    jsp::join(&[".impeccable", "config.local.json"])
}

fn rt_with(cwd: &str, env: HashMap<String, String>) -> Runtime<'static> {
    Runtime::new(
        cwd.to_string(),
        env,
        "/impeccable".to_string(),
        "/opt/bin/impeccable",
        &HTML,
    )
}

fn rt(cwd: &str) -> Runtime<'static> {
    rt_with(cwd, HashMap::new())
}

fn env(pairs: &[(&str, &str)]) -> HashMap<String, String> {
    pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

fn f(id: &str, line: f64, name: &str, description: &str, snippet: &str) -> Finding {
    let mut x = finding(id, "src/Card.tsx", snippet, line);
    x.name = name.to_string();
    x.description = description.to_string();
    x
}

fn edit_event(cwd: &str, file: &str, session: &str) -> String {
    json!({
        "session_id": session, "cwd": cwd, "hook_event_name": "PostToolUse",
        "tool_name": "Edit", "tool_input": { "file_path": file },
    })
    .to_string()
}

fn stop_event(cwd: &str, session: &str) -> String {
    json!({ "session_id": session, "cwd": cwd, "hook_event_name": "Stop", "stop_hook_active": false }).to_string()
}

const GRADIENT_CSS: &str = ".title { background: linear-gradient(90deg, #f472b6, #a78bfa); -webkit-background-clip: text; color: transparent; }\n";
const SIDE_TAB_CSS: &str = ".card { border-left: 4px solid #6366f1; border-radius: 8px; }\n";

fn monorepo_design_fixture(root_design: bool) -> Tmp {
    let t = Tmp::new();
    t.write("package.json", r#"{"workspaces":["apps/*"]}"#);
    t.write("apps/a/package.json", "{}");
    t.write("apps/b/package.json", "{}");
    t.write("apps/a/DESIGN.md", "---\ncolors:\n  primary: '#112233'\n---\n");
    if root_design {
        t.write("DESIGN.md", "---\ncolors:\n  primary: '#224466'\n---\n");
    }
    t.write(".impeccable/config.json", r#"{"hook":{"perEditRules":"all"},"detector":{"advisoryRules":"include"}}"#);
    t
}

// Run identical cases through all three hook entry points. The probe that is
// allowed by the repo palette must still fail against app A's own palette.
fn check_monorepo_design_hook(mode: &str) {
    for (root_design, app, color, expected) in [
        (false, "a", "#ff00aa", true),
        (false, "b", "#ff00aa", false),
        (true, "a", "#224466", true),
        (true, "b", "#ff00aa", true),
        (true, "b", "#224466", false),
    ] {
        let t = monorepo_design_fixture(root_design);
        let cwd = t.path();
        let source = format!(".probe {{ color: {color}; }}\n");
        let file = t.write(&format!("apps/{app}/src/probe.css"), &source);
        let r = rt(&cwd);
        let out = match mode {
            "post" => hook::run_hook(&r, &edit_event(&cwd, &file, "s1")).stdout,
            "before" => {
                // A proposed new file must resolve its owning app too.
                std::fs::remove_file(&file).unwrap();
                hbe(&r, &cursor(&cwd, "Write", json!({
                    "file_path": file, "content": source,
                }))).0
            }
            "stop" => {
                let mut cache = read_cache(&cwd);
                touch_file(&mut cache, "s1", &file);
                persist_cache(&r, &cwd, &cache);
                hook::run_stop_hook(&r, &stop_event(&cwd, "s1")).stdout
            }
            _ => unreachable!(),
        };
        assert_eq!(out.contains("design-system-color"), expected,
            "{mode}: root_design={root_design}, app={app}, color={color}: {out}");
        assert!(!t.exists(&format!("apps/{app}/.impeccable/hook.cache.json")),
            "design resolution must not relocate hook state");
    }
}

/// A Cursor `postToolUse` envelope as Cursor 3.21 builds it for an agent
/// file edit (cursor-agent-exec: base request + `tool_name`, `tool_input`,
/// `tool_output`, `duration`, `tool_use_id`).
fn cursor_post_tool_use(cwd: &str, file: &str, content: &str) -> String {
    json!({
        "conversation_id": "cv-post", "generation_id": "gen-1", "session_id": "cv-post",
        "hook_event_name": "postToolUse", "cursor_version": "3.21.18",
        "workspace_roots": [cwd], "user_email": "dev@example.com", "transcript_path": null,
        "model": "composer-2",
        "tool_name": "Write", "tool_input": { "file_path": file, "content": content },
        "tool_output": "{}", "duration": 12, "tool_use_id": "tool-1",
    })
    .to_string()
}

#[test]
fn cursor_post_tool_use_feeds_findings_back_as_additional_context() {
    let t = Tmp::new();
    let cwd = t.path();
    let file = t.write("src/card.css", SIDE_TAB_CSS);
    let r = rt(&cwd);

    let res = hook::run_hook(&r, &cursor_post_tool_use(&cwd, &file, SIDE_TAB_CSS));

    let out: Value = serde_json::from_str(&res.stdout).unwrap_or_else(|_| panic!("{}", res.stdout));
    let keys: Vec<&String> = out.as_object().unwrap().keys().collect();
    assert_eq!(keys, vec!["additional_context"], "{}", res.stdout);
    let text = out["additional_context"].as_str().unwrap();
    assert!(text.contains("side-tab"), "{text}");
    // Un-tiered: Cursor has no Stop deep pass, so nothing is deferred.
    assert!(res.audit.get("deferred").is_none_or(|v| v == &json!(0)), "{:?}", res.audit);
}

#[test]
fn cursor_additional_context_stays_under_cursors_cap() {
    let t = Tmp::new();
    let cwd = t.path();
    t.write(".impeccable/config.json", r#"{"hook":{"perEditRules":"all","limits":{"maxChars":50000,"maxFindings":1000}}}"#);
    let css: String = (0..400)
        .map(|i| format!(".c{i} {{ border-left: 4px solid #6366f1; border-radius: 8px; background: linear-gradient(90deg, #f472b6, #a78bfa); -webkit-background-clip: text; color: transparent; }}\n"))
        .collect();
    let file = t.write("src/many.css", &css);
    let r = rt(&cwd);

    let res = hook::run_hook(&r, &cursor_post_tool_use(&cwd, &file, &css));

    let out: Value = serde_json::from_str(&res.stdout).unwrap();
    let text = out["additional_context"].as_str().unwrap();
    assert!(text.encode_utf16().count() <= 10_000, "{}", text.len());
    // The same edit through Claude's envelope is not clamped, so the cap is
    // what kept Cursor's text short.
    let claude = hook::run_hook(&rt(&cwd), &edit_event(&cwd, &file, "s-claude"));
    assert!(claude.stdout.len() > 10_000, "{}", claude.stdout.len());
}

#[test]
fn monorepo_design_post_edit() { check_monorepo_design_hook("post"); }

#[test]
fn monorepo_design_before_edit() { check_monorepo_design_hook("before"); }

#[test]
fn monorepo_design_stop() { check_monorepo_design_hook("stop"); }

#[test]
fn monorepo_design_document_locations_and_sidecars() {
    for location in ["DESIGN.md", "docs/DESIGN.md", ".agents/context/DESIGN.md"] {
        let t = monorepo_design_fixture(true);
        let cwd = t.path();
        let file = t.write("apps/b/src/probe.css", ".probe {}\n");
        let md = t.write(&format!("apps/b/{location}"),
            "---\ntypography:\n  body:\n    fontFamily: Georgia\nrounded:\n  md: 8px\ncolors:\n  primary: '#abcdef'\n---\n");
        let sidecar = t.write("apps/b/.impeccable/design.json", "{}");
        let scan = design_system_options_for_file(&rt(&cwd), &read_config(&cwd), &cwd, &file);
        let ds = scan.design_system.as_ref().unwrap();
        assert_eq!(ds.source_path.as_deref(), Some(md.as_str()));
        assert_eq!(ds.sidecar_path.as_deref(), Some(sidecar.as_str()));
        let findings = detector_detect_text(
            ".probe { color: #ff0000; font-family: Verdana; border-radius: 19px; }", &file, &scan);
        for rule in ["design-system-color", "design-system-font", "design-system-radius"] {
            assert!(findings.iter().any(|f| f.antipattern == rule), "{location}: {rule}");
        }
        let allowed = detector_detect_text(
            ".probe { color: #abcdef; font-family: Georgia; border-radius: 8px; }", &file, &scan);
        assert!(allowed.iter().all(|f| !f.antipattern.starts_with("design-system-")));
    }
}

#[test]
fn monorepo_design_local_document_and_disabled_config_do_not_inherit() {
    let t = monorepo_design_fixture(true);
    let cwd = t.path();
    let file = t.write("apps/a/src/probe.css", ".probe {}\n");
    t.write("apps/a/DESIGN.md", "# App-specific prose, with no machine-readable tokens\n");
    let r = rt(&cwd);
    let mut config = read_config(&cwd);
    assert!(design_system_options_for_file(&r, &config, &cwd, &file).design_system.is_none());
    config.design_system_enabled = false;
    let sibling = t.write("apps/b/src/probe.css", ".probe {}\n");
    assert!(design_system_options_for_file(&r, &config, &cwd, &sibling).design_system.is_none());
}

#[test]
fn monorepo_design_batch_notes_follow_the_displayed_file() {
    for mode in ["post-fresh", "post-pending", "post-clean", "stop"] {
        for stale_app in ["a", "b"] {
            let t = monorepo_design_fixture(true);
            let cwd = t.path();
            let source = if mode == "post-clean" { ".probe { color: #112233; }" }
                else { ".probe { color: #ff00aa; }" };
            let a = t.write("apps/a/src/probe.css", source);
            let b = t.write("apps/b/src/probe.css", ".probe { color: #224466; }");
            let r = rt(&cwd);
            if mode == "post-pending" {
                hook::run_hook(&r, &edit_event(&cwd, &a, "s1"));
            }
            let sidecar = t.write(if stale_app == "a" { "apps/a/.impeccable/design.json" }
                else { ".impeccable/design.json" }, "{}");
            std::fs::File::options().write(true).open(sidecar).unwrap()
                .set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_600_000_000)).unwrap();
            let out = if mode == "stop" {
                let mut cache = read_cache(&cwd);
                touch_file(&mut cache, "s1", &a);
                touch_file(&mut cache, "s1", &b);
                persist_cache(&r, &cwd, &cache);
                hook::run_stop_hook(&r, &stop_event(&cwd, "s1")).stdout
            } else {
                let event = json!({"session_id":"s1", "cwd":cwd, "hook_event_name":"PostToolUse",
                    "tool_name":"apply_patch", "tool_input":{"command":format!(
                        "*** Begin Patch\n*** Update File: {a}\n*** Update File: {b}\n*** End Patch")}});
                hook::run_hook(&r, &event.to_string()).stdout
            };
            assert!(out.contains("apps/a/src/probe.css"), "{mode}: {out}");
            assert_eq!(out.contains("DESIGN.md is newer"), stale_app == "a", "{mode}: {out}");
        }
    }
}

fn edit_with_original(cwd: &str, file: &str, session: &str, before: &str, old: &str, new: &str) -> String {
    json!({
        "session_id": session, "cwd": cwd, "hook_event_name": "PostToolUse",
        "tool_name": "Edit", "tool_input": {"file_path": file, "old_string": old, "new_string": new},
        "tool_response": {"filePath": file, "originalFile": before, "oldString": old,
            "newString": new, "replaceAll": false, "userModified": false},
    }).to_string()
}

#[test]
fn stop_baseline_import_only_edit_does_not_blame_existing_font() {
    let t = Tmp::new();
    let cwd = t.path();
    t.write("package.json", "{}");
    // This is the actual working-tree preimage, not HEAD (which might differ).
    let before = "import dead from 'dead';\nconst report = `<style>body { font-family: Fraunces; }</style>`;\n";
    let after = before.replacen("import dead from 'dead';\n", "", 1);
    let file = t.write("query.ts", &after);
    let r = rt(&cwd);
    assert!(detector_detect_text(before, &file, &HookScanOptions::default()).iter().any(|f| f.antipattern == "overused-font"));
    hook::run_hook(&r, &edit_with_original(&cwd, &file, "s1", before, "import dead from 'dead';\n", ""));
    let stop = hook::run_stop_hook(&r, &stop_event(&cwd, "s1"));
    assert!(stop.stdout.is_empty(), "{}", stop.stdout);
    assert_eq!(stop.audit["preExistingFindings"], json!(1));
    assert!(!t.read(".impeccable/hook.cache.json").contains("const report"), "do not persist source contents");
    assert!(!t.exists(".impeccable/config.local.json"), "baseline is not an ignore");
    assert!(detector_detect_text(&after, &file, &HookScanOptions::default()).iter().any(|f| f.antipattern == "overused-font"), "explicit scans stay unchanged");
}

#[test]
fn stop_baseline_reports_new_findings_and_keeps_first_preimage() {
    let t = Tmp::new();
    let cwd = t.path();
    t.write("package.json", "{}");
    let file = t.write("card.css", SIDE_TAB_CSS);
    let r = rt(&cwd);
    hook::run_hook(&r, &edit_with_original(&cwd, &file, "s1", ".card {}\n", ".card {}\n", SIDE_TAB_CSS));
    let second = format!("/* later */\n{SIDE_TAB_CSS}");
    t.write("card.css", &second);
    hook::run_hook(&r, &edit_with_original(&cwd, &file, "s1", SIDE_TAB_CSS, SIDE_TAB_CSS, &second));
    let stop = hook::run_stop_hook(&r, &stop_event(&cwd, "s1"));
    assert!(stop.stdout.contains("[side-tab]"));
    assert!(stop.stdout.contains("[new]"), "{}", stop.stdout);
    assert_eq!(stop.audit["newFindings"], json!(1));
}

#[test]
fn stop_does_not_repeat_findings_after_an_edit_above_them() {
    let t = Tmp::new();
    let cwd = t.path();
    t.write("package.json", "{}");
    let file = t.write("card.css", SIDE_TAB_CSS);
    let r = rt(&cwd);
    hook::run_hook(&r, &edit_with_original(&cwd, &file, "s1", ".card {}\n", ".card {}\n", SIDE_TAB_CSS));
    assert!(!hook::run_stop_hook(&r, &stop_event(&cwd, "s1")).stdout.is_empty());
    // A line inserted above moves the finding; it is the same finding.
    t.write("card.css", &format!("/* later */\n{SIDE_TAB_CSS}"));
    assert!(hook::run_stop_hook(&r, &stop_event(&cwd, "s1")).stdout.is_empty());
}

#[test]
fn a_per_edit_pass_keeps_what_stop_already_reported() {
    let t = Tmp::new();
    let cwd = t.path();
    t.write("package.json", "{}");
    let file = t.write("card.css", SIDE_TAB_CSS);
    let r = rt(&cwd);
    hook::run_hook(&r, &edit_with_original(&cwd, &file, "s1", ".card {}\n", ".card {}\n", SIDE_TAB_CSS));
    assert!(!hook::run_stop_hook(&r, &stop_event(&cwd, "s1")).stdout.is_empty());
    hook::run_hook(&r, &edit_event(&cwd, &file, "s1"));
    assert!(hook::run_stop_hook(&r, &stop_event(&cwd, "s1")).stdout.is_empty());
}

#[test]
fn stop_baseline_missing_or_mismatched_preimage_stays_unknown() {
    for original in [None, Some("not the actual preimage")] {
        let t = Tmp::new();
        let cwd = t.path();
        t.write("package.json", "{}");
        let file = t.write("card.css", SIDE_TAB_CSS);
        let r = rt(&cwd);
        let event = original.map(|before| edit_with_original(&cwd, &file, "s1", before, ".card {}", SIDE_TAB_CSS))
            .unwrap_or_else(|| edit_event(&cwd, &file, "s1"));
        hook::run_hook(&r, &event);
        let stop = hook::run_stop_hook(&r, &stop_event(&cwd, "s1"));
        assert!(stop.stdout.contains("[attribution unknown]"), "{}", stop.stdout);
        assert!(stop.stdout.contains("may predate this session"));
        assert_eq!(stop.audit["unknownFindings"], json!(1));
    }
}

#[test]
fn stop_baseline_existing_debt_fixed_then_reintroduced_is_new() {
    let t = Tmp::new();
    let cwd = t.path();
    t.write("package.json", "{}");
    let clean = ".card {}\n";
    let file = t.write("card.css", clean);
    let r = rt(&cwd);
    hook::run_hook(&r, &edit_with_original(&cwd, &file, "s1", SIDE_TAB_CSS, SIDE_TAB_CSS, clean));
    t.write("card.css", SIDE_TAB_CSS);
    hook::run_hook(&r, &edit_with_original(&cwd, &file, "s1", clean, clean, SIDE_TAB_CSS));
    let stop = hook::run_stop_hook(&r, &stop_event(&cwd, "s1"));
    assert!(stop.stdout.contains("[new]"), "{}", stop.stdout);
    assert_eq!(stop.audit["preExistingFindings"], json!(0));
}

#[test]
fn stop_baseline_late_preimage_does_not_relabel_unknown_debt() {
    let t = Tmp::new();
    let cwd = t.path();
    t.write("package.json", "{}");
    let file = t.write("card.css", SIDE_TAB_CSS);
    let r = rt(&cwd);
    hook::run_hook(&r, &edit_event(&cwd, &file, "s1"));
    let second = format!("/* later */\n{SIDE_TAB_CSS}");
    t.write("card.css", &second);
    hook::run_hook(&r, &edit_with_original(&cwd, &file, "s1", SIDE_TAB_CSS, SIDE_TAB_CSS, &second));
    let stop = hook::run_stop_hook(&r, &stop_event(&cwd, "s1"));
    assert_eq!(stop.audit["unknownFindings"], json!(1));
    assert_eq!(stop.audit["preExistingFindings"], json!(0));
}

#[test]
fn stop_baseline_keeps_indirect_stylesheet_findings_unknown() {
    let t = Tmp::new();
    let cwd = t.path();
    t.write("package.json", "{}");
    t.write("src/styles.css", SIDE_TAB_CSS);
    let before = "import './styles.css';\nexport const Card = () => <div>Before</div>;\n";
    let after = before.replace("Before", "After");
    let file = t.write("src/Card.tsx", &after);
    let r = rt(&cwd);
    hook::run_hook(&r, &edit_with_original(&cwd, &file, "s1", before, "Before", "After"));
    let stop = hook::run_stop_hook(&r, &stop_event(&cwd, "s1"));
    assert!(stop.stdout.contains("[side-tab]"), "{}", stop.stdout);
    assert_eq!(stop.audit["unknownFindings"], json!(1));
    assert_eq!(stop.audit["preExistingFindings"], json!(0));
}

#[test]
fn stop_baseline_extra_identical_occurrence_is_not_suppressed() {
    let t = Tmp::new();
    let cwd = t.path();
    t.write("package.json", "{}");
    // The text detector deduplicates identical snippets within two lines.
    let after = format!("{SIDE_TAB_CSS}\n\n\n{SIDE_TAB_CSS}");
    let file = t.write("card.css", &after);
    let r = rt(&cwd);
    hook::run_hook(&r, &edit_with_original(&cwd, &file, "s1", SIDE_TAB_CSS, SIDE_TAB_CSS, &after));
    let stop = hook::run_stop_hook(&r, &stop_event(&cwd, "s1"));
    assert_eq!(stop.audit["preExistingFindings"], json!(1));
    assert_eq!(stop.audit["newFindings"], json!(1));
}

#[test]
fn stop_baseline_write_create_is_new_but_missing_update_preimage_is_unknown() {
    for (kind, expected) in [("create", "newFindings"), ("update", "unknownFindings")] {
        let t = Tmp::new();
        let cwd = t.path();
        t.write("package.json", "{}");
        let file = t.write("card.css", SIDE_TAB_CSS);
        let r = rt(&cwd);
        let event = json!({"cwd": cwd, "session_id": "s1", "tool_name": "Write",
            "tool_input": {"file_path": file, "content": SIDE_TAB_CSS},
            "tool_response": {"type": kind, "filePath": file, "content": SIDE_TAB_CSS, "originalFile": null}}).to_string();
        hook::run_hook(&r, &event);
        let stop = hook::run_stop_hook(&r, &stop_event(&cwd, "s1"));
        assert_eq!(stop.audit[expected], json!(1));
    }
}

#[test]
fn stop_baseline_unknown_notice_respects_small_output_budget() {
    for (budget, stale) in [(500, false), (500, true), (8000, true)] {
        let t = Tmp::new();
        let cwd = t.path();
        t.write("package.json", "{}");
        t.write(".impeccable/config.json", &json!({"hook":{"limits":{"maxChars":budget}}}).to_string());
        let file = t.write("card.css", SIDE_TAB_CSS);
        let r = rt(&cwd);
        hook::run_hook(&r, &edit_event(&cwd, &file, "s1"));
        if stale {
            // Make the notice eligible only at Stop; no sleeps or clock races.
            t.write("DESIGN.md", "---\nname: Test\n---\n");
            let sidecar = t.write(".impeccable/design.json", "{}");
            std::fs::File::options().write(true).open(sidecar).unwrap()
                .set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_600_000_000)).unwrap();
            assert!(design_system_options(&read_config(&cwd), &cwd).md_newer_than_json());
        }
        let stop = hook::run_stop_hook(&r, &stop_event(&cwd, "s1"));
        let output: Value = serde_json::from_str(&stop.stdout).unwrap();
        let text = output["hookSpecificOutput"]["additionalContext"].as_str().unwrap();
        assert!(text.encode_utf16().count() <= budget, "{text}");
        assert!(text.contains("may predate this session"));
        assert!(text.contains("[side-tab]"), "{text}");
        assert!(text.contains("[attribution unknown]"), "{text}");
        assert!(text.contains("card.css"), "{text}");
        if stale {
            assert_eq!(text.contains("DESIGN.md is newer"), budget > 500, "{text}");
            let cache: Value = serde_json::from_str(&t.read(".impeccable/hook.cache.json")).unwrap();
            assert_eq!(cache["sessions"]["s1"]["designNoteShown"] == json!(true), budget > 500);
        }
    }
}

#[test]
fn stop_baseline_deduplicated_unknown_does_not_add_notice_to_new_finding() {
    let t = Tmp::new();
    let cwd = t.path();
    t.write("package.json", "{}");
    let r = rt(&cwd);
    let old = t.write("old/card.css", SIDE_TAB_CSS);
    hook::run_hook(&r, &edit_event(&cwd, &old, "s1"));
    assert!(hook::run_stop_hook(&r, &stop_event(&cwd, "s1")).stdout.contains("[attribution unknown]"));
    let new = t.write("new/card.css", SIDE_TAB_CSS);
    // Use a verified create event (an empty Edit preimage is not trusted).
    let create = json!({"cwd": cwd, "session_id": "s1", "tool_name": "Write",
        "tool_input": {"file_path": new, "content": SIDE_TAB_CSS},
        "tool_response": {"type": "create", "filePath": new, "content": SIDE_TAB_CSS, "originalFile": null}}).to_string();
    hook::run_hook(&r, &create);
    let stop = hook::run_stop_hook(&r, &stop_event(&cwd, "s1"));
    assert_eq!(stop.audit["unknownFindings"], json!(1), "audit retains the full scan");
    assert!(stop.stdout.contains("[new]"), "{}", stop.stdout);
    assert!(!stop.stdout.contains("may predate this session"), "{}", stop.stdout);
}

#[test]
fn stop_baseline_capped_unknown_does_not_add_notice_to_new_finding() {
    let t = Tmp::new();
    let cwd = t.path();
    t.write("package.json", "{}");
    t.write(".impeccable/config.json", r#"{"hook":{"limits":{"maxFindings":1}}}"#);
    let r = rt(&cwd);
    let new = t.write("new/card.css", SIDE_TAB_CSS);
    hook::run_hook(&r, &edit_with_original(&cwd, &new, "s1", ".card {}", ".card {}", SIDE_TAB_CSS));
    let old = t.write("old/card.css", SIDE_TAB_CSS);
    hook::run_hook(&r, &edit_event(&cwd, &old, "s1"));
    let stop = hook::run_stop_hook(&r, &stop_event(&cwd, "s1"));
    assert_eq!(stop.audit["unknownFindings"], json!(1));
    assert!(stop.stdout.contains("[new]"), "{}", stop.stdout);
    assert!(!stop.stdout.contains("[attribution unknown]"), "{}", stop.stdout);
    assert!(!stop.stdout.contains("may predate this session"), "{}", stop.stdout);
}

#[test]
fn stop_baseline_small_grouped_output_keeps_finding_and_attribution() {
    let t = Tmp::new();
    let cwd = t.path();
    t.write("package.json", "{}");
    t.write(".impeccable/config.json", r#"{"hook":{"limits":{"maxChars":500}}}"#);
    let r = rt(&cwd);
    for path in ["one/card.css", "two/card.css"] {
        let file = t.write(path, SIDE_TAB_CSS);
        hook::run_hook(&r, &edit_event(&cwd, &file, "s1"));
    }
    let stop = hook::run_stop_hook(&r, &stop_event(&cwd, "s1"));
    let output: Value = serde_json::from_str(&stop.stdout).unwrap();
    let text = output["hookSpecificOutput"]["additionalContext"].as_str().unwrap();
    assert!(text.encode_utf16().count() <= 500, "{text}");
    assert!(text.contains("[side-tab]"), "{text}");
    assert!(text.contains("[attribution unknown]"), "{text}");
    assert!(text.contains("may predate this session"), "{text}");
}

#[test]
fn stop_baseline_dropped_notice_reclaims_its_rendering_budget() {
    for max_findings in [1, 5] {
        let t = Tmp::new();
        let cwd = t.path();
        t.write("package.json", "{}");
        t.write(".impeccable/config.json", &json!({"hook":{"limits":{"maxChars":500,"maxFindings":max_findings}}}).to_string());
        let r = rt(&cwd);
        let new = t.write("new/card.css", SIDE_TAB_CSS);
        hook::run_hook(&r, &edit_with_original(&cwd, &new, "s1", ".card {}", ".card {}", SIDE_TAB_CSS));
        let old = t.write("old/card.css", SIDE_TAB_CSS);
        hook::run_hook(&r, &edit_event(&cwd, &old, "s1"));
        let stop = hook::run_stop_hook(&r, &stop_event(&cwd, "s1"));
        let output: Value = serde_json::from_str(&stop.stdout).unwrap();
        let text = output["hookSpecificOutput"]["additionalContext"].as_str().unwrap();
        let groups: Vec<Group> = [(new, "[new]"), (old, "[attribution unknown]")].into_iter().map(|(file_path, label)| {
            let mut findings = detector_detect_text(SIDE_TAB_CSS, &file_path, &HookScanOptions::default());
            for f in &mut findings { f.name = format!("{label} {}", f.name); }
            Group { file_path, findings }
        }).collect();
        let mut config = read_config(&cwd);
        // Unknown is not displayed at this budget. All available space goes
        // to the known-new prefix, rather than a discarded notice.
        config.limits.max_findings = 1.0;
        let expected = render_grouped_template(&r, &groups, &config, &RenderOpts {
            cwd: Some(cwd), short_footer: false, reserve_chars: 0.0,
        });
        assert_eq!(text, expected, "maxFindings={max_findings}");
        assert!(text.contains("[new] Side-tab accent border"), "{text}");
        assert!(!text.contains("may predate this session"), "{text}");
    }
}

#[test]
fn stop_baseline_uses_dirty_worktree_not_git_head() {
    let t = Tmp::new();
    let cwd = t.path();
    t.write("package.json", "{}");
    t.write("card.css", ".card {}\n");
    std::fs::create_dir(t.0.join("empty-hooks")).unwrap();
    let hooks = format!("core.hooksPath={}/empty-hooks", cwd);
    let git = |args: &[&str]| {
        let result = std::process::Command::new("git").current_dir(&t.0)
            .args(["-c", "user.name=Test", "-c", "user.email=test@example.invalid",
                "-c", "commit.gpgsign=false", "-c", &hooks])
            .args(args).output().unwrap();
        assert!(result.status.success(), "{}", String::from_utf8_lossy(&result.stderr));
    };
    git(&["init", "--quiet"]);
    git(&["add", "card.css", "package.json"]);
    git(&["commit", "--quiet", "-m", "clean baseline"]);
    // The user introduced this debt before the agent session; HEAD is clean.
    let before = format!("/* unrelated */\n{SIDE_TAB_CSS}");
    let file = t.write("card.css", SIDE_TAB_CSS);
    let r = rt(&cwd);
    hook::run_hook(&r, &edit_with_original(&cwd, &file, "s1", &before, "/* unrelated */\n", ""));
    let stop = hook::run_stop_hook(&r, &stop_event(&cwd, "s1"));
    assert_eq!(stop.audit["preExistingFindings"], json!(1));
    assert!(stop.stdout.is_empty());
}

#[test]
fn stop_baseline_untrusted_shapes_do_not_suppress_findings() {
    for variant in ["modified", "wrong-path", "no-session", "oversized", "ambiguous", "other-provider"] {
        let t = Tmp::new();
        let cwd = t.path();
        t.write("package.json", "{}");
        let file = t.write("card.css", SIDE_TAB_CSS);
        let mut event: Value = serde_json::from_str(&edit_with_original(&cwd, &file, "s1", SIDE_TAB_CSS, SIDE_TAB_CSS, SIDE_TAB_CSS)).unwrap();
        match variant {
            "modified" => event["tool_response"]["userModified"] = json!(true),
            "wrong-path" => event["tool_response"]["filePath"] = json!("another.css"),
            "no-session" => event["session_id"] = Value::Null,
            "oversized" => event["tool_response"]["originalFile"] = json!("x".repeat(512 * 1024 + 1)),
            "ambiguous" => {
                let repeated = SIDE_TAB_CSS.repeat(2);
                t.write("card.css", &repeated);
                event["tool_response"]["originalFile"] = json!(repeated);
            }
            _ => {},
        }
        let r = if variant == "other-provider" { rt_with(&cwd, env(&[("IMPECCABLE_HOOK_HARNESS", "codex")])) } else { rt(&cwd) };
        hook::run_hook(&r, &event.to_string());
        let session = if variant == "no-session" { "unknown" } else { "s1" };
        let stop = hook::run_stop_hook(&r, &stop_event(&cwd, session));
        assert!(stop.stdout.contains("[attribution unknown]"), "{variant}: {}", stop.stdout);
        assert_eq!(stop.audit["preExistingFindings"], json!(0), "{variant}");
    }
}

#[test]
fn stop_baseline_scan_suppression_discards_exemptions() {
    let t = Tmp::new();
    let cwd = t.path();
    t.write("package.json", "{}");
    let file = t.write("card.css", SIDE_TAB_CSS);
    let r = rt(&cwd);
    let event = edit_with_original(&cwd, &file, "s1", SIDE_TAB_CSS, SIDE_TAB_CSS, SIDE_TAB_CSS);
    for _ in 0..=EDIT_COUNT_THRESHOLD {
        hook::run_hook(&r, &event);
    }
    let stop = hook::run_stop_hook(&r, &stop_event(&cwd, "s1"));
    assert_eq!(stop.audit["unknownFindings"], json!(1));
    assert_eq!(stop.audit["preExistingFindings"], json!(0));
}

fn audit_str<'a>(a: &'a Map<String, Value>, k: &str) -> Option<&'a str> {
    a.get(k).and_then(Value::as_str)
}

// ── classifiers ───────────────────────────────────────────────────────────

#[test]
fn truthy_and_depth() {
    for v in ["1", "true", "TRUE", "yes", "YES", "on", "On"] {
        assert!(truthy(Some(v)), "{v}");
    }
    for v in ["", "0", "false", "no", "off", "yep"] {
        assert!(!truthy(Some(v)), "{v}");
    }
    assert!(!truthy(None));
    assert!(depth_is_set(Some("2")));
    assert!(depth_is_set(Some(" 1 ")));
    assert!(!depth_is_set(Some("0")));
    assert!(!depth_is_set(Some("")));
    assert!(!depth_is_set(None));
}

#[test]
fn sensitive_and_generated_paths() {
    for p in [
        "/x/.env",
        "/x/.env.production",
        "/x/server.pem",
        "/x/id_rsa",
        "/x/id_rsa.pub",
        "/x/api-secret.json",
        "/x/client_secret.ts",
        "/x/credentials.yml",
        "/x/.git/config",
        "/x/secret.json",
    ] {
        assert!(is_sensitive_path(p), "expected sensitive: {p}");
    }
    for p in [
        "/x/src/Card.tsx",
        "/x/app/page.html",
        "/x/styles/main.css",
        "/x/src/CredentialForm.tsx",
        "/x/src/SecretPage.jsx",
        "/x/src/secretary-dashboard.vue",
        "/x/src/credentials-panel.tsx",
        "/x/secretx.json",
    ] {
        assert!(!is_sensitive_path(p), "unexpected sensitive: {p}");
    }
    for p in [
        "/x/src/foo.generated.tsx",
        "/x/types.d.ts",
        "/x/bundle.min.js",
        "/x/node_modules/lib/index.tsx",
        "/x/dist/Card.tsx",
        "/x/build/index.html",
        "/x/pkg.lock.json",
        "/x/.next/server.js",
        "/x/coverage/report.html",
        "/x/site/public/js/generated/counts.js",
        "/x/src/generated/schema.ts",
    ] {
        assert!(is_generated_path(p), "expected generated: {p}");
    }
    for p in [
        "/x/src/generateReport.ts",
        "/x/src/generated-utils.ts",
        "/x/src/components/CodeGenerator.tsx",
        "/x/src/ui/regenerate-button.jsx",
    ] {
        assert!(!is_generated_path(p), "unexpected generated: {p}");
    }
}

#[cfg(unix)]
#[test]
fn inside_project_handles_symlinks_and_unwritten_files() {
    let t = Tmp::new();
    let root = t.path();
    let r = rt(&root);
    let file = t.write("real/src/Card.tsx", "noop");
    let real = format!("{root}/real");
    let link = format!("{root}/link");
    std::os::unix::fs::symlink(&real, &link).unwrap();
    assert!(is_scan_target_inside_project(&r, &file, &link));
    assert!(is_scan_target_inside_project(
        &r,
        &format!("{link}/src/Card.tsx"),
        &real
    ));
    assert!(is_scan_target_inside_project(
        &r,
        &format!("{link}/src/New.tsx"),
        &real
    ));
    assert!(is_scan_target_inside_project(
        &r,
        &format!("{real}/deep/New.tsx"),
        &link
    ));
    assert!(!is_scan_target_inside_project(
        &r,
        &format!("{root}/elsewhere/New.tsx"),
        &real
    ));
    assert!(is_scan_target_inside_project(&r, &real, &real));
    assert!(!is_scan_target_inside_project(&r, "", &real));
    assert!(!is_scan_target_inside_project(&r, &file, ""));
}

// ── config ────────────────────────────────────────────────────────────────

#[test]
fn read_config_merges_shared_then_local_and_legacy_keys() {
    let t = Tmp::new();
    let cwd = t.path();
    assert_eq!(read_config(&cwd), HookConfig::default());
    t.write(
        ".impeccable/config.json",
        r#"{"hook":{"enabled":true,"quiet":true,"auditLog":" log.ndjson ","perEditRules":"all","ignoreRules":["a"],"limits":{"maxFindings":2,"maxChars":100,"maxFileBytes":-1}},"detector":{"ignoreRules":["b"],"ignoreFiles":["x/**"],"extensions":[".blade.php",{"ext":"heex","engine":"text"}],"advisoryRules":"include","designSystem":{"enabled":false}}}"#,
    );
    t.write(
        ".impeccable/config.local.json",
        r#"{"hook":{"enabled":false},"detector":{"ignoreRules":["a","c"],"extensions":[{"ext":".heex","engine":"html"}],"ignoreValues":[{"rule":"Overused-Font","value":"\"Inter\"","file":"a.css","files":["b.css","a.css"],"createdAt":"2026","reason":" r "}]}}"#,
    );
    let c = read_config(&cwd);
    assert!(!c.enabled);
    assert!(c.quiet);
    assert_eq!(c.audit_log.as_deref(), Some("log.ndjson"));
    assert_eq!(c.per_edit_rules, "all");
    assert_eq!(c.ignore_rules, vec!["a", "b", "c"]);
    assert_eq!(c.ignore_files, vec!["x/**"]);
    assert_eq!(c.advisory_rules, "include");
    assert!(!c.design_system_enabled);
    assert_eq!(c.limits.max_findings, 2.0);
    assert_eq!(c.limits.max_chars, 100.0);
    assert_eq!(
        c.limits.max_file_bytes, 131072.0,
        "non-positive keeps the default"
    );
    assert_eq!(
        c.extensions
            .iter()
            .map(|e| (e.ext.as_str(), e.engine.as_str()))
            .collect::<Vec<_>>(),
        vec![(".blade.php", "html"), (".heex", "html")],
        "local override wins per ext, string entries default to html"
    );
    assert_eq!(c.ignore_values.len(), 1);
    let e = &c.ignore_values[0];
    assert_eq!(
        (e.rule.as_str(), e.value.as_str()),
        ("overused-font", "inter")
    );
    assert_eq!(
        e.files.as_ref().unwrap(),
        &vec!["a.css".to_string(), "b.css".to_string()]
    );
    assert_eq!(e.reason.as_deref(), Some("r"));
    // malformed local config is ignored, shared survives
    t.write(".impeccable/config.local.json", "{ nope");
    let c = read_config(&cwd);
    assert!(c.enabled);
    assert_eq!(c.ignore_rules, vec!["a", "b"]);
}

#[test]
fn configured_extensions_match_suffixes() {
    let exts = normalize_extension_entries(&[
        json!(".php"),
        json!({"ext": "blade.php", "engine": "html"}),
        json!({"ext": ".HTML.erb", "engine": "text"}),
    ]);
    assert_eq!(
        match_configured_extension("/x/show.blade.php", &exts)
            .unwrap()
            .ext,
        ".blade.php"
    );
    assert_eq!(
        match_configured_extension("/x/SHOW.HTML.ERB", &exts)
            .unwrap()
            .engine,
        "text"
    );
    assert_eq!(
        match_configured_extension("/x/a.php", &exts).unwrap().ext,
        ".php"
    );
    assert!(
        match_configured_extension("/x/.php", &exts).is_none(),
        "bare dotfile name is not a template"
    );
    assert!(match_configured_extension("/x/a.tsx", &exts).is_none());
    assert!(match_configured_extension("/x/a.php", &[]).is_none());
}

// ── cache ─────────────────────────────────────────────────────────────────

#[test]
fn cache_round_trip_and_gc() {
    let t = Tmp::new();
    let cwd = t.path();
    let r = rt(&cwd);
    let mut cache = read_cache(&cwd);
    assert_eq!(bump_edit_count(&mut cache, "s", "/x/a.tsx"), 1.0);
    assert_eq!(bump_edit_count(&mut cache, "s", "/x/a.tsx"), 2.0);
    let g = f("gradient-text", 3.0, "G", "d", "s");
    remember_findings(&mut cache, "s", "/x/a.tsx", &finding_cache_keys(&[g.clone()]));
    assert!(persist_cache(&r, &cwd, &cache));
    let back = read_cache(&cwd);
    let entry = &back["sessions"]["s"]["files"]["/x/a.tsx"];
    assert_eq!(entry["editCount"], json!(2));
    assert_eq!(entry["findings"], json!(["gradient-text:s#1"]));
    let mut cache2 = back.clone();
    assert!(dedupe_against_cache(&[g.clone()], &finding_cache_keys(&[g.clone()]), &mut cache2, "s", "/x/a.tsx").is_empty());
    // the same finding one line lower is not fresh; one more identical finding is exactly one fresh
    let lower = f("gradient-text", 9.0, "G", "d", "s");
    let both = [g.clone(), lower];
    let keys = finding_cache_keys(&both);
    assert_eq!(dedupe_against_cache(&both, &keys, &mut cache2, "s", "/x/a.tsx").len(), 1);
    assert_eq!(finding_cache_keys(&[f("gradient-text", 5.0, "G", "d", "s")]), finding_cache_keys(&[g.clone()]));
    // same-line value-specific findings stay distinct
    let mut a = f("overused-font", 1.0, "O", "d", "font-family: Inter");
    a.extras.insert("ignoreValue".into(), json!("Inter"));
    let mut b = a.clone();
    b.extras.insert("ignoreValue".into(), json!("Roboto"));
    assert_ne!(finding_cache_keys(&[a]), finding_cache_keys(&[b]));
    // a colour pair that gains a copy is the same finding (r14-t2)
    let pair = f("low-contrast", 0.0, "L", "d", "2.3:1 (need 4.5:1) — text #aaaaaa on #ffffff (and 2 more)");
    let mut more = pair.clone();
    more.snippet = "2.3:1 (need 4.5:1) — text #aaaaaa on #ffffff (and 3 more)".into();
    assert_eq!(finding_cache_keys(&[pair]), finding_cache_keys(&[more]));
    // gc: 10 sessions -> newest 8 kept
    let mut big = read_cache(&cwd);
    for i in 0..10 {
        let s = ensure_session(&mut big, &format!("s{i}"));
        s.insert("updatedAt".into(), json!(1000 + i));
    }
    assert!(persist_cache(&r, &cwd, &big));
    let kept = read_cache(&cwd);
    let ids: Vec<&String> = kept["sessions"].as_object().unwrap().keys().collect();
    assert_eq!(ids.len(), 8, "11 sessions collapse to the 8 newest");
    for dropped in ["s0", "s1", "s2"] {
        assert!(!ids.contains(&&dropped.to_string()), "{dropped} is oldest");
    }
    assert_eq!(ids[0], "s", "the freshly touched session sorts first");
    assert_eq!(ids[1], "s9");
}

#[test]
fn git_excludes_land_in_info_exclude_not_gitignore() {
    let t = Tmp::new();
    let root = t.path();
    std::fs::create_dir_all(t.0.join(".git")).unwrap();
    t.write(".gitignore", "node_modules\n");
    let r = rt(&root);
    let res = ensure_hook_git_excludes(&r, &root);
    assert_eq!(res.mode, "git-info-exclude");
    assert!(res.changed);
    let ex = t.read(".git/info/exclude");
    assert_eq!(
        ex,
        "# impeccable-hook-ignore-start .\n.impeccable/hook.cache.json\n.impeccable/hook.pending.json\n.impeccable/config.local.json\n# impeccable-hook-ignore-end .\n"
    );
    assert_eq!(t.read(".gitignore"), "node_modules\n");
    let again = ensure_hook_git_excludes(&r, &root);
    assert!(!again.changed, "idempotent");
    // a nested cwd gets a prefixed block appended after existing content
    std::fs::create_dir_all(t.0.join("apps/web")).unwrap();
    let nested = format!("{root}/apps/web");
    let res = ensure_hook_git_excludes(&r, &nested);
    assert_eq!(res.patterns[0], "apps/web/.impeccable/hook.cache.json");
    let ex = t.read(".git/info/exclude");
    assert!(
        ex.contains("# impeccable-hook-ignore-end .\n\n# impeccable-hook-ignore-start apps/web\n")
    );
    // no repo at all
    let t2 = Tmp::new();
    assert_eq!(
        ensure_hook_git_excludes(&rt(&t2.path()), &t2.path()).mode,
        "none"
    );
}

#[test]
fn git_excludes_in_a_linked_worktree_reach_the_exclude_file_git_reads() {
    let t = Tmp::new();
    let repo = jsp::join(&[&t.path(), "repo"]);
    let wt = jsp::join(&[&t.path(), "wt"]);
    std::fs::create_dir_all(jsp::join(&[&t.path(), "empty-hooks"])).unwrap();
    std::fs::create_dir_all(&repo).unwrap();
    let hooks = format!("core.hooksPath={}/empty-hooks", t.path());
    let git = |dir: &str, args: &[&str]| {
        std::process::Command::new("git").current_dir(dir)
            .args(["-c", "user.name=Test", "-c", "user.email=test@example.invalid",
                "-c", "commit.gpgsign=false", "-c", &hooks])
            .args(args).output().unwrap()
    };
    for args in [
        &["init", "--quiet"][..],
        &["commit", "--quiet", "--allow-empty", "-m", "init"],
        &["worktree", "add", "--quiet", "../wt"],
    ] {
        let out = git(&repo, args);
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    }
    // A linked worktree's `.git` is a file; git reads `info/exclude` from the
    // common dir, never from the per-worktree gitdir the file points at.
    assert!(impeccable_detect::config::ensure_config_git_exclude(&wt));
    assert!(git(&wt, &["check-ignore", "-q", ".impeccable/config.local.json"]).status.success());
    ensure_hook_git_excludes(&rt(&wt), &wt);
    assert!(git(&wt, &["check-ignore", "-q", ".impeccable/hook.cache.json"]).status.success());
}

// ── filtering ─────────────────────────────────────────────────────────────

#[test]
fn filter_findings_rules_advisory_and_values() {
    let mut c = HookConfig::default();
    let em = f("em-dash-overuse", 1.0, "E", "d", "s");
    let side = f("side-tab", 1.0, "S", "d", "s");
    let mut font = f(
        "overused-font",
        2.0,
        "O",
        "d",
        "body { font-family: \"Inter\", sans-serif; }",
    );
    font.file = "/p/src/a.css".into();
    assert_eq!(
        filter_findings(vec![em.clone(), side.clone()], &c).len(),
        1,
        "advisory dropped by default"
    );
    c.advisory_rules = "include".into();
    assert_eq!(filter_findings(vec![em.clone(), side.clone()], &c).len(), 2);
    c.ignore_rules = vec!["Side-Tab".into()];
    assert_eq!(
        filter_findings(vec![side.clone(), font.clone()], &c).len(),
        1
    );
    c.ignore_rules.clear();
    c.ignore_values = impeccable_detect::config::normalize_ignore_value_entries(&[
        json!({"rule": "overused-font", "value": "inter"}),
    ]);
    assert!(filter_findings(vec![font.clone()], &c).is_empty());
    c.ignore_values = impeccable_detect::config::normalize_ignore_value_entries(&[
        json!({"rule": "overused-font", "value": "*", "files": ["src/*.css"]}),
    ]);
    assert!(
        filter_findings(vec![font.clone()], &c).is_empty(),
        "wildcard scoped to a suffix glob"
    );
    c.ignore_values = impeccable_detect::config::normalize_ignore_value_entries(&[
        json!({"rule": "overused-font", "value": "*"}),
    ]);
    assert_eq!(
        filter_findings(vec![font.clone()], &c).len(),
        1,
        "bare wildcard never matches"
    );
    let (imm, def) =
        split_findings_by_tier(vec![f("gradient-text", 1.0, "G", "d", "s"), side.clone()]);
    assert_eq!(imm[0].antipattern, "gradient-text");
    assert_eq!(def[0].antipattern, "side-tab");
    assert!(per_edit_tiering_active(&HookConfig::default(), "claude"));
    assert!(!per_edit_tiering_active(&HookConfig::default(), "cursor"));
    assert!(!per_edit_tiering_active(&HookConfig::default(), "github"));
    let mut all = HookConfig::default();
    all.per_edit_rules = "all".into();
    assert!(!per_edit_tiering_active(&all, "claude"));
}

// ── rendering ─────────────────────────────────────────────────────────────

fn opts(cwd: &str) -> RenderOpts {
    RenderOpts {
        cwd: Some(cwd.to_string()),
        short_footer: false,
        reserve_chars: 0.0,
    }
}

#[test]
fn render_template_caps_and_footers() {
    let r = rt("/x");
    let c = HookConfig::default();
    let many: Vec<Finding> = (0..12)
        .map(|i| f("side-tab", (i + 1) as f64, &format!("R{i}"), "d", "s"))
        .collect();
    let text = render_template(&r, &many, "/x/Card.tsx", &c, &opts("/x"));
    assert!(text.starts_with(
        "[impeccable@1] Design hook findings requiring review in Card.tsx (12 issue(s)):"
    ));
    assert!(text.contains("... and 7 more (see /impeccable audit)."));
    assert_eq!(text.lines().filter(|l| l.starts_with("- L")).count(), 5);
    // The self-command is quoted in the host's shell form (#476 / #533):
    // single quotes under sh, double quotes on Windows.
    let self_cmd = quote_command_arg("/opt/bin/impeccable", cfg!(windows));
    assert!(text.contains(&format!(
        "Run `{self_cmd} hooks ignore-value <rule> \"<value>\" --reason \"<who decided: evidence>\"`"
    )));
    assert!(text.contains("Full suppression ladder: /impeccable hooks."));
    let short = render_template(
        &r,
        &many[..1],
        "/x/Card.tsx",
        &c,
        &RenderOpts {
            short_footer: true,
            ..opts("/x")
        },
    );
    assert!(short.contains("Triage per the session policy"));
    assert!(short.contains("`impeccable hooks ignore-value`"));
    assert!(!short.contains("Triage each finding"));
    let zero = render_template(
        &r,
        &[f("side-tab", 0.0, "X", "d", "s")],
        "/x/a.tsx",
        &c,
        &opts("/x"),
    );
    assert!(zero.contains("\n- [side-tab] X. d\n"));
}

#[test]
fn render_template_dedupes_descriptions_and_quotes_hints() {
    let r = rt("/x");
    let c = HookConfig::default();
    let desc = "Long registry description that should appear once.";
    let text = render_template(
        &r,
        &[
            f(
                "overused-font",
                2.0,
                "Overused font",
                desc,
                "font-family: \"Roboto\"",
            ),
            f(
                "overused-font",
                9.0,
                "Overused font",
                desc,
                "font-family: \"Inter\"",
            ),
        ],
        "/x/fonts.css",
        &c,
        &opts("/x"),
    );
    assert_eq!(text.matches(desc).count(), 1);
    assert!(text.contains(
        "- L9 [overused-font] Overused font. If intentional: `ignore-value overused-font Inter`."
    ));
    assert!(text.contains("`ignore-value overused-font Roboto`"));
    let bounce = render_template(
        &r,
        &[f(
            "bounce-easing",
            1.0,
            "Bounce",
            "d",
            "animation: bounce-ball",
        )],
        "/x/main.css",
        &c,
        &opts("/x"),
    );
    assert!(bounce.contains("If intentional: `ignore-value bounce-easing bounce-ball`."));
    let hostile = render_template(
        &r,
        &[f(
            "overused-font",
            1.0,
            "Overused font",
            "d",
            "body { font-family: \"$(touch pwned)\", sans-serif; }",
        )],
        "/x/fonts.css",
        &c,
        &opts("/x"),
    );
    assert!(hostile.contains(&format!(
        "ignore-value overused-font {}",
        quote_command_arg("$(touch pwned)", cfg!(windows))
    )));
    let no_hint = {
        let mut x = f("side-tab", 1.0, "Side tab", "d", "s");
        x.extras.insert("ignoreValue".into(), json!("Inter"));
        render_template(&r, &[x], "/x/a.tsx", &c, &opts("/x"))
    };
    assert!(!no_hint.contains("ignore-value side-tab"));
    // platform quoting (#476 / #533)
    // The Windows .cmd launcher is quoted, so PowerShell needs `&` (#744);
    // the sh launcher and bare names keep their spelling.
    assert_eq!(
        self_command_spelling(r"C:\Users\A B\impeccable.cmd", true),
        r"& 'C:\Users\A B\impeccable.cmd'"
    );
    assert_eq!(self_command_spelling("/opt/a b/impeccable", false), "'/opt/a b/impeccable'");
    assert_eq!(self_command_spelling("/opt/a b/impeccable", true), "\"/opt/a b/impeccable\"");
    assert_eq!(self_command_spelling("impeccable", true), "impeccable");
    assert_eq!(
        quote_command_arg("Space Grotesk Var", false),
        "'Space Grotesk Var'"
    );
    assert_eq!(
        quote_command_arg("Space Grotesk Var", true),
        "\"Space Grotesk Var\""
    );
    assert_eq!(quote_command_arg("it's", false), "'it'\\''s'");
    assert_eq!(quote_command_arg("a\"b\\c", true), "\"a\\\"b\\\\c\"");
    assert_eq!(quote_command_arg("Inter", true), "Inter");
}

#[test]
fn render_template_clamps_inside_budget_and_keeps_policy() {
    let r = rt("/x");
    let mut c = HookConfig::default();
    c.limits.max_chars = 500.0;
    let long_path = format!("/x/{}Component.tsx", "deeply-nested/".repeat(6));
    let six: Vec<Finding> = (0..6)
        .map(|i| {
            f(
                "side-tab",
                (i + 1) as f64,
                "Side tab",
                "Colored side border.",
                "s",
            )
        })
        .collect();
    let text = render_template(
        &r,
        &six,
        &long_path,
        &c,
        &RenderOpts {
            reserve_chars: 134.0,
            ..opts("/x")
        },
    );
    assert!(text.chars().count() <= 500, "{}", text.chars().count());
    assert!(text.ends_with("unsure, ask in one line."));
    let huge: Vec<Finding> = (0..5)
        .map(|i| f("side-tab", (i + 1) as f64, "X", &"y".repeat(2000), "s"))
        .collect();
    let text = render_template(&r, &huge, "/x/a.tsx", &c, &opts("/x"));
    assert!(text.chars().count() <= 500);
    let one = render_template(&r, &huge[..1], "/x/a.tsx", &c, &opts("/x"));
    assert!(one.chars().count() <= 500);
    assert!(one.contains("[side-tab]"));
    assert!(one.contains("Triage per the session policy"));
    let three: Vec<Finding> = (1..=3)
        .map(|l| f("side-tab", l as f64, "X", "short issue", "s"))
        .collect();
    let text = render_template(&r, &three, "/x/a.tsx", &c, &opts("/x"));
    assert!(text.chars().count() <= 500);
    for l in ["- L1 ", "- L2 ", "- L3 "] {
        assert!(text.contains(l), "{l} survives");
    }
    assert!(text.contains("Triage per the session policy"));
    // grouped render: global cap of 5 across files, per-file "more" line
    let groups = vec![
        Group {
            file_path: "/x/a.css".into(),
            findings: (1..=4)
                .map(|l| f("side-tab", l as f64, "X", "d", "s"))
                .collect(),
        },
        Group {
            file_path: "/x/b.css".into(),
            findings: (1..=3)
                .map(|l| f("gradient-text", l as f64, "G", "d", "s"))
                .collect(),
        },
    ];
    let text = render_grouped_template(&r, &groups, &HookConfig::default(), &opts("/x"));
    assert!(text.starts_with("[impeccable@1] Design hook findings requiring review across 2 files (7 issue(s)):\na.css (4 issue(s)):\n"));
    assert!(text.contains("b.css (3 issue(s)):\n- L1 [gradient-text] G. d\n- ... 2 more in b.css (see /impeccable audit)."));
    let pending = render_pending_ack(
        &r,
        "/x/a.css",
        &["a:1".into(), "b:2".into(), "c:3".into(), "d:4".into()],
        "/x",
    );
    assert!(pending
        .contains("Still has 4 finding(s) flagged earlier this session (a:1, b:2, c:3, +1 more)."));
    assert!(render_clean_ack(&r, "/x/a.css", "/x")
        .ends_with("keep following the project design system and the impeccable skill guidance."));
}

// ── events / targets ──────────────────────────────────────────────────────

#[test]
fn harness_detection_and_github_normalization() {
    let r = rt("/p");
    let gh: Map<String, Value> = json!({"sessionId": "g1", "toolName": "edit", "toolArgs": "{\"path\":\"src/a.tsx\",\"old_str\":\"a\"}"})
        .as_object()
        .cloned()
        .unwrap();
    assert_eq!(resolve_harness(&r, Some(&gh)), "github");
    let ev = normalize_hook_event(&r, &gh, "/p", "github");
    assert_eq!(ev["tool_input"]["file_path"], json!("src/a.tsx"));
    assert_eq!(ev["session_id"], json!("g1"));
    assert_eq!(ev["cwd"], json!("/p"));
    let patch: Map<String, Value> = json!({"sessionId": "g1", "toolName": "apply_patch", "toolArgs": "*** Begin Patch\n*** Add File: /abs/app.css\n+x\n*** End Patch"})
        .as_object()
        .cloned()
        .unwrap();
    let ev = normalize_hook_event(&r, &patch, "/p", "github");
    assert_eq!(ev["tool_name"], json!("apply_patch"));
    assert_eq!(resolve_target_files(&r, &ev, "/p"), vec!["/abs/app.css"]);
    // an edit whose content carries patch markers is still an edit
    let tricky: Map<String, Value> = json!({"toolName": "edit", "toolArgs": "{\"path\":\"/p/x.css\",\"new_str\":\"*** Begin Patch\"}"})
        .as_object()
        .cloned()
        .unwrap();
    let ev = normalize_hook_event(&r, &tricky, "/p", "github");
    assert_eq!(ev["tool_input"]["file_path"], json!("/p/x.css"));
    let cursor: Map<String, Value> = json!({"conversation_id": "c", "workspace_roots": ["/w"], "tool_input": {"path": "src/App.jsx"}})
        .as_object()
        .cloned()
        .unwrap();
    assert_eq!(resolve_harness(&r, Some(&cursor)), "cursor");
    let ev = normalize_hook_event(&r, &cursor, "/p", "cursor");
    assert_eq!(ev["cwd"], json!("/w"));
    assert_eq!(ev["session_id"], json!("c"));
    assert_eq!(ev["tool_input"]["file_path"], json!("src/App.jsx"));
    // c9e7cd8a: an explicit codex harness now keeps its own identity so the
    // Stop pass can emit the Codex decision/block contract.
    let forced = rt_with("/p", env(&[("IMPECCABLE_HOOK_HARNESS", "codex")]));
    assert_eq!(resolve_harness(&forced, Some(&gh)), "codex");
    assert_eq!(
        parse_apply_patch_paths(&r, "*** Begin Patch\n*** Update File: a.css\r\n*** Add File: /abs/b.css\n*** Delete File: c.css\n", "/p"),
        // A relative patch path is resolved against the cwd with the host's
        // path semantics; an already-absolute one is passed through.
        vec![jsp::join(&["/p", "a.css"]), "/abs/b.css".to_string()]
    );
    assert_eq!(
        payload("t", "Stop", "claude"),
        r#"{"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":"t"}}"#
    );
    assert_eq!(
        payload("t", "PostToolUse", "cursor"),
        r#"{"additional_context":"t"}"#
    );
    assert_eq!(
        payload("t", "PostToolUse", "github"),
        r#"{"additionalContext":"t"}"#
    );
}

#[test]
fn expand_scan_targets_follows_styles() {
    let t = Tmp::new();
    let cwd = t.path();
    let r = rt(&cwd);
    let app = t.write(
        "src/App.jsx",
        "import './theme.scss';\nimport styles from \"./App.module.less\";\nexport default 1;\n",
    );
    t.write("src/styles.css", "a{}");
    t.write("src/index.sass", "a{}");
    t.write("src/theme.scss", "a{}");
    t.write("src/App.module.less", "a{}");
    let out = expand_scan_targets(&r, &[app.clone()], &cwd);
    assert_eq!(out[0], app);
    for name in [
        "src/theme.scss",
        "src/App.module.less",
        "src/styles.css",
        "src/index.sass",
    ] {
        assert!(out.contains(&jsp::join(&[&cwd, name])), "{name} in {out:?}");
    }
    let rel = expand_scan_targets(&r, &["src/App.jsx".into()], &cwd);
    assert_eq!(
        rel[0], app,
        "relative primaries resolve against the project cwd"
    );
    let trav = expand_scan_targets(&r, &[format!("{cwd}/src/../src/App.jsx")], &cwd);
    assert_eq!(
        trav.len(),
        1,
        "traversal-looking primaries are not expanded"
    );
    let css = t.write("src/main.css", "a{}");
    assert_eq!(expand_scan_targets(&r, &[css.clone()], &cwd), vec![css]);
    assert!(expand_scan_targets(&r, &[], &cwd).is_empty());
    let capped: Vec<String> = (0..9).map(|i| format!("{cwd}/f{i}.css")).collect();
    assert_eq!(
        normalize_scan_targets(&r, &capped, &cwd).len(),
        MAX_SCAN_TARGETS
    );
}

// ── run_hook ──────────────────────────────────────────────────────────────

#[test]
fn run_hook_fresh_then_pending_then_stop() {
    let t = Tmp::new();
    let cwd = t.path();
    let r = rt(&cwd);
    let css = t.write("src/a.css", &format!("{GRADIENT_CSS}{SIDE_TAB_CSS}"));
    let ev = edit_event(&cwd, &css, "s1");
    let one = hook::run_hook(&r, &ev);
    assert!(one
        .stdout
        .contains("Design hook findings requiring review in src/a.css (1 issue(s))"));
    assert!(
        one.stdout.contains("[gradient-text]"),
        "immediate tier only"
    );
    assert!(!one.stdout.contains("[side-tab]"));
    assert_eq!(one.audit["deferred"], json!(1));
    assert_eq!(one.audit["freshFindings"], json!(1));
    assert!(t.exists(".impeccable/hook.cache.json"));
    let two = hook::run_hook(&r, &ev);
    assert!(two
        .stdout
        .contains("Still has 1 finding(s) flagged earlier this session (gradient-text:1)"));
    assert_eq!(audit_str(&two.audit, "kind"), Some("pending"));
    assert!(two
        .stdout
        .contains("Handle them before finalizing — the previous reminder still applies."));
    let stop = hook::run_stop_hook(&r, &stop_event(&cwd, "s1"));
    assert!(stop.stdout.contains("\"hookEventName\":\"Stop\""));
    assert!(
        stop.stdout.contains("[side-tab]"),
        "deep pass surfaces the deferred tier"
    );
    assert!(
        !stop.stdout.contains("[gradient-text]"),
        "already reported per edit"
    );
    assert!(
        stop.stdout.contains("Triage per the session policy"),
        "short footer after the first fire"
    );
    // 3c442af7: the Stop pass now syncs the remembered set to the live scan
    // (including the per-edit-surfaced gradient-text), so a second Stop with
    // nothing new is silent instead of re-reporting it.
    let again = hook::run_stop_hook(&r, &stop_event(&cwd, "s1"));
    assert_eq!(again.stdout, "", "second Stop is clean: {}", again.stdout);
    assert_eq!(audit_str(&again.audit, "skipped"), Some("stop-clean"));
    // a session whose deep pass found everything is silent on the next Stop
    let css2 = t.write("src/b.css", SIDE_TAB_CSS);
    hook::run_hook(&r, &edit_event(&cwd, &css2, "s2"));
    assert!(hook::run_stop_hook(&r, &stop_event(&cwd, "s2"))
        .stdout
        .contains("[side-tab]"));
    assert_eq!(
        audit_str(
            &hook::run_stop_hook(&r, &stop_event(&cwd, "s2")).audit,
            "skipped"
        ),
        Some("stop-clean")
    );
    let active = hook::run_stop_hook(&r, &json!({"session_id": "s1", "cwd": cwd, "hook_event_name": "Stop", "stop_hook_active": true}).to_string());
    assert_eq!(
        audit_str(&active.audit, "skipped"),
        Some("stop-hook-active")
    );
    let none = hook::run_stop_hook(&r, &stop_event(&cwd, "nobody"));
    assert_eq!(audit_str(&none.audit, "skipped"), Some("no-touched-files"));
}

#[test]
fn run_hook_acks_and_quiet_modes() {
    let t = Tmp::new();
    let cwd = t.path();
    t.write("package.json", "{}");
    let r = rt(&cwd);
    let clean = t.write("src/Clean.tsx", "export const A = () => <p>hi</p>;\n");
    let ev = edit_event(&cwd, &clean, "s1");
    let one = hook::run_hook(&r, &ev);
    assert!(one
        .stdout
        .contains("No deterministic design-quality issues found"));
    assert!(
        !t.exists(".impeccable"),
        "clean edit in a project without a footprint writes nothing"
    );
    std::fs::create_dir_all(t.0.join(".impeccable")).unwrap();
    let one = hook::run_hook(&r, &ev);
    assert_eq!(audit_str(&one.audit, "kind"), Some("clean"));
    let two = hook::run_hook(&r, &ev);
    assert_eq!(audit_str(&two.audit, "skipped"), Some("clean-ack-deduped"));
    assert!(two.stdout.is_empty());
    let ts = t.write("src/util.ts", "export const x = 1;\n");
    let three = hook::run_hook(&r, &edit_event(&cwd, &ts, "s1"));
    assert_eq!(audit_str(&three.audit, "skipped"), Some("non-ui-ack"));
    let ts_slop = t.write("src/slop.ts", "const s = `.t{background: linear-gradient(90deg,#f00,#00f); -webkit-background-clip: text; color: transparent;}`;\n");
    let four = hook::run_hook(&r, &edit_event(&cwd, &ts_slop, "s1"));
    assert!(
        four.stdout.contains("[gradient-text]"),
        "findings still surface for .ts"
    );
    let quiet = rt_with(&cwd, env(&[("IMPECCABLE_HOOK_QUIET", "1")]));
    let q = hook::run_hook(&quiet, &edit_event(&cwd, &clean, "s2"));
    assert_eq!(q.audit["quiet"], json!(true));
    assert!(q.stdout.is_empty());
    let re = rt_with(&cwd, env(&[("CLAUDE_HOOK_DEPTH", "2")]));
    assert_eq!(hook::run_hook(&re, &ev).audit["reentrant"], json!(true));
    let off = rt_with(&cwd, env(&[("IMPECCABLE_HOOK_DISABLED", "yes")]));
    assert_eq!(
        audit_str(&hook::run_hook(&off, &ev).audit, "skipped"),
        Some("env-disabled")
    );
    assert_eq!(
        audit_str(&hook::run_hook(&r, "").audit, "skipped"),
        Some("stdin-malformed")
    );
    assert_eq!(
        audit_str(&hook::run_hook(&r, "[1]").audit, "skipped"),
        Some("stdin-empty")
    );
}

#[test]
fn run_hook_skips_unsafe_and_foreign_targets() {
    let t = Tmp::new();
    let cwd = t.path();
    t.write("package.json", "{}");
    let r = rt(&cwd);
    let go = |file: &str| hook::run_hook(&r, &edit_event(&cwd, file, "s1"));
    assert_eq!(
        audit_str(&go(&format!("{cwd}/.env.local")).audit, "skipped"),
        Some("sensitive")
    );
    assert_eq!(
        audit_str(&go(&format!("{cwd}/dist/a.css")).audit, "skipped"),
        Some("generated")
    );
    assert_eq!(
        audit_str(&go(&format!("{cwd}/src/../a.css")).audit, "skipped"),
        Some("sensitive")
    );
    assert_eq!(
        audit_str(&go(&format!("{cwd}/README.md")).audit, "skipped"),
        Some("extension")
    );
    assert_eq!(
        audit_str(&go(&format!("{cwd}/src/nope.tsx")).audit, "skipped"),
        Some("file-missing")
    );
    let scratch = Tmp::new();
    let outside = scratch.write("landing.css", GRADIENT_CSS);
    assert_eq!(
        audit_str(&go(&outside).audit, "skipped"),
        Some("outside-project")
    );
    assert!(!t.exists(".impeccable"));
    // template extensions (#316): .blade.php is skipped without config,
    // routed through the text engine with `engine: text`
    let blade = t.write("views/a.blade.php", "<style>.t{background: linear-gradient(90deg,#f00,#00f); -webkit-background-clip: text; color: transparent;}</style>");
    assert_eq!(audit_str(&go(&blade).audit, "skipped"), Some("extension"));
    t.write(
        ".impeccable/config.json",
        r#"{"detector":{"extensions":[{"ext":".blade.php","engine":"text"}]}}"#,
    );
    let res = go(&blade);
    assert!(res.stdout.contains("[gradient-text]"), "{}", res.stdout);
    assert_eq!(audit_str(&res.audit, "ext"), Some(".blade.php"));
}

#[cfg(unix)]
#[test]
fn run_hook_symlinked_cwd_and_umbrella_launch() {
    let t = Tmp::new();
    let root = t.path();
    let r = rt(&root);
    t.write("realproj/package.json", "{}");
    let file = t.write(
        "realproj/src/Card.tsx",
        "export const A = () => <p>hi</p>;\n",
    );
    let link = format!("{root}/proj-link");
    std::os::unix::fs::symlink(format!("{root}/realproj"), &link).unwrap();
    let res = hook::run_hook(&r, &edit_event(&link, &file, "sym"));
    assert_ne!(audit_str(&res.audit, "skipped"), Some("outside-project"));
    assert!(res
        .stdout
        .contains("No deterministic design-quality issues found"));
    // umbrella: cwd has no marker; the child project gets the cache
    t.write("app/package.json", "{}");
    let css = t.write("app/src/a.css", GRADIENT_CSS);
    let res = hook::run_hook(&r, &edit_event(&root, &css, "u1"));
    assert!(res.stdout.contains("Design hook findings requiring review"));
    assert_eq!(
        audit_str(&res.audit, "cwd"),
        Some(format!("{root}/app").as_str())
    );
    assert!(t.exists("app/.impeccable/hook.cache.json"));
    assert!(!t.exists(".impeccable"));
}

#[test]
fn run_hook_oversized_files_and_suppression() {
    let t = Tmp::new();
    let cwd = t.path();
    std::fs::create_dir_all(t.0.join(".impeccable")).unwrap();
    let r = rt(&cwd);
    let big = t.write("bundle.js", &format!("/* {} */", "x".repeat(200 * 1024)));
    let res = hook::run_hook(&r, &edit_event(&cwd, &big, "s1"));
    assert_eq!(audit_str(&res.audit, "skipped"), Some("too-large"));
    assert_eq!(res.audit["bytes"], json!(200 * 1024 + 6));
    let main = t.write(
        "main.css",
        &format!("/* {} */\n{GRADIENT_CSS}", "x".repeat(90 * 1024)),
    );
    let res = hook::run_hook(&r, &edit_event(&cwd, &main, "s1"));
    assert_eq!(res.audit["emitted"], json!(true));
    // the byte count never rides along on another file's audit line
    let small = t.write("a.css", "a{}");
    let patch = json!({"session_id": "p", "cwd": cwd, "hook_event_name": "PostToolUse", "tool_name": "apply_patch",
        "tool_input": {"command": format!("*** Begin Patch\n*** Update File: {big}\n*** Update File: {small}\n*** End Patch")}})
    .to_string();
    let res = hook::run_hook(&r, &patch);
    assert!(res.audit.get("bytes").is_none(), "{:?}", res.audit);
    t.write(
        ".impeccable/config.json",
        r#"{"hook":{"limits":{"maxFileBytes":1024}}}"#,
    );
    let res = hook::run_hook(&r, &edit_event(&cwd, &main, "s3"));
    assert_eq!(
        audit_str(&res.audit, "skipped"),
        Some("too-large"),
        "configured maxFileBytes is honored"
    );
    // suppression: the 7th edit emits the notice once, later edits stay silent
    t.write(".impeccable/config.json", "{}");
    let css = t.write("src/b.css", GRADIENT_CSS);
    let mut outputs = Vec::new();
    for _ in 0..9 {
        outputs.push(hook::run_hook(&r, &edit_event(&cwd, &css, "sup")));
    }
    assert!(outputs[6].stdout.contains("Suppressing further design hints on src/b.css. More than 6 edits in this session reached. Run /impeccable audit to revisit."));
    assert_eq!(outputs[6].audit["suppressed"], json!(true));
    assert!(outputs[7].stdout.is_empty());
    assert_eq!(outputs[8].audit["emitted"], json!(false));
    assert_eq!(outputs[8].audit["editCount"], json!(9));
}

#[test]
fn run_hook_co_located_styles_and_tiering_config() {
    let t = Tmp::new();
    let cwd = t.path();
    t.write("package.json", "{}");
    let r = rt(&cwd);
    let app = t.write(
        "src/App.jsx",
        "export default () => <div className=\"card\" />;\n",
    );
    t.write("src/styles.css", &format!("{SIDE_TAB_CSS}{GRADIENT_CSS}"));
    let res = hook::run_hook(&r, &edit_event(&cwd, &app, "s1"));
    assert!(
        res.stdout
            .contains("Design hook findings requiring review in src/styles.css (1 issue(s))"),
        "{}",
        res.stdout
    );
    let cache = read_cache(&cwd);
    assert_eq!(
        cache["sessions"]["s1"]["files"][&app]["editCount"],
        json!(1)
    );
    assert_eq!(
        cache["sessions"]["s1"]["files"][jsp::join(&[&cwd, "src/styles.css"])]["editCount"],
        json!(0),
        "co-scanned styles do not bump"
    );
    // perEditRules: all restores the deferred tier per edit
    t.write(
        ".impeccable/config.json",
        r#"{"hook":{"perEditRules":"all"}}"#,
    );
    let res = hook::run_hook(&r, &edit_event(&cwd, &app, "s2"));
    assert!(res.stdout.contains("[side-tab]"), "{}", res.stdout);
    assert!(res.stdout.contains("(2 issue(s))"));
    // github harness keeps the full set too
    t.write(".impeccable/config.json", "{}");
    let gh = rt_with(&cwd, env(&[("IMPECCABLE_HOOK_HARNESS", "github")]));
    let res = hook::run_hook(&gh, &edit_event(&cwd, &app, "s3"));
    assert!(res.stdout.starts_with("{\"additionalContext\":"));
    assert!(res.stdout.contains("[side-tab]"));
    // ignoreFiles glob and ignoreRules
    t.write(
        ".impeccable/config.json",
        r#"{"detector":{"ignoreFiles":["src/**"]}}"#,
    );
    let res = hook::run_hook(&r, &edit_event(&cwd, &app, "s4"));
    assert_eq!(audit_str(&res.audit, "skipped"), Some("config-ignore-file"));
    t.write(
        ".impeccable/config.json",
        r#"{"detector":{"ignoreRules":["gradient-text"]}}"#,
    );
    let res = hook::run_hook(&r, &edit_event(&cwd, &app, "s5"));
    assert!(
        res.stdout
            .contains("No deterministic design-quality issues found"),
        "{}",
        res.stdout
    );
    // native platform gate
    t.write("PRODUCT.md", "# P\n\n## Platform\nios and android\n");
    let res = hook::run_hook(&r, &edit_event(&cwd, &app, "s6"));
    assert_eq!(audit_str(&res.audit, "skipped"), Some("native-platform"));
    assert_eq!(audit_str(&res.audit, "platform"), Some("adaptive"));
}

#[test]
fn write_audit_log_targets() {
    let t = Tmp::new();
    let cwd = t.path();
    let mut entry = Map::new();
    entry.insert("event".into(), json!("PostToolUse"));
    entry.insert("cwd".into(), json!(cwd));
    let r = rt_with(
        "/elsewhere",
        env(&[("IMPECCABLE_HOOK_LOG", "logs/a.ndjson")]),
    );
    assert!(write_audit_log(&r, &entry, "/elsewhere"));
    let line = t.read("logs/a.ndjson");
    assert!(
        line.starts_with("{\"ts\":\"")
            && line.contains("\",\"event\":\"PostToolUse\",\"cwd\":\"")
            && line.ends_with("\"}\n")
    );
    let r2 = rt("/elsewhere");
    assert!(
        !write_audit_log(&r2, &entry, "/elsewhere"),
        "no target, no-op"
    );
    t.write(
        ".impeccable/config.json",
        r#"{"hook":{"auditLog":"~/h.ndjson"}}"#,
    );
    let r3 = rt_with("/elsewhere", env(&[("HOME", &cwd)]));
    assert!(write_audit_log(&r3, &entry, "/elsewhere"));
    assert!(t.exists("h.ndjson"));
}

// ── hook-before-edit ──────────────────────────────────────────────────────

fn hbe(r: &Runtime, stdin: &str) -> (String, i32) {
    let (mut io, cap) = Io::captured("", PathBuf::from(&r.proc_cwd), r.env.clone());
    let code = before_edit::run(r, stdin, &mut io);
    drop(io);
    let out = String::from_utf8(cap.stdout.borrow().clone()).unwrap();
    drop(cap);
    (out, code)
}

fn cursor(cwd: &str, tool: &str, input: Value) -> String {
    json!({"hook_event_name": "preToolUse", "conversation_id": "cv1", "workspace_roots": [cwd], "tool_name": tool, "tool_input": input}).to_string()
}

#[test]
fn before_edit_skips_oversized_proposed_content() {
    // Over-cap proposed content (a huge paste or hostile envelope arriving
    // via stdin) must skip the gate instead of being scanned, the same
    // fail-open shape as an unreadable original (triage A3). The envelope
    // carries slop that denies at normal size, so an allow proves the cap
    // fired rather than the scan passing.
    let t = Tmp::new();
    let cwd = t.path();
    t.write("package.json", "{}");
    let r = rt(&cwd);
    let slop = ".t { background: linear-gradient(90deg,#f00,#00f); -webkit-background-clip: text; color: transparent; }\n";
    let (small_out, _) = hbe(
        &r,
        &cursor(&cwd, "Write", json!({"file_path": "src/x.css", "content": slop})),
    );
    assert!(small_out.starts_with("{\"permission\":\"deny\""), "{small_out}");
    let big = format!("{slop}/*{}*/\n", "a".repeat(2 * 1024 * 1024));
    let (out, code) = hbe(
        &r,
        &cursor(&cwd, "Write", json!({"file_path": "src/x.css", "content": big})),
    );
    assert_eq!(code, 0);
    assert_eq!(out, "{\"permission\":\"allow\"}");
}

#[test]
fn before_edit_denies_shell_and_edit_shapes() {
    let t = Tmp::new();
    let cwd = t.path();
    t.write("package.json", "{}");
    let r = rt(&cwd);
    let slop = ".t { background: linear-gradient(90deg,#f00,#00f); -webkit-background-clip: text; color: transparent; }\n";
    let deny = |stdin: &str, label: &str| {
        let (out, code) = hbe(&r, stdin);
        assert_eq!(code, 0);
        assert!(out.starts_with("{\"permission\":\"deny\",\"user_message\":\"[impeccable@1] Impeccable design hook blocked this write before it landed. Design hook findings requiring review in"), "{label}: {out}");
        out
    };
    let allow = |stdin: &str, label: &str| {
        let (out, _) = hbe(&r, stdin);
        assert_eq!(out, "{\"permission\":\"allow\"}", "{label}");
    };
    deny(
        &cursor(
            &cwd,
            "Shell",
            json!({"command": format!("cat > src/x.css <<'EOF'\n{slop}EOF\n")}),
        ),
        "heredoc",
    );
    deny(
        &cursor(
            &cwd,
            "Shell",
            json!({"command": format!("python3 - <<'PY'\nfrom pathlib import Path\nPath(\"src/y.css\").write_text(\"\"\"{slop}\"\"\")\nPY\n")}),
        ),
        "python heredoc",
    );
    deny(
        &cursor(
            &cwd,
            "Shell",
            json!({"command": format!("cat >> src/z.css <<EOF\n{slop}EOF")}),
        ),
        "append redirect",
    );
    deny(
        &cursor(
            &cwd,
            "Shell",
            json!({"command": format!("cat <<'EOF' | tee src/t.css\n{slop}EOF\n")}),
        ),
        "tee",
    );
    t.write("src/src.css", slop);
    deny(
        &cursor(
            &cwd,
            "Shell",
            json!({"command": "cp -f src/src.css src/copy.css"}),
        ),
        "cp",
    );
    let orig = t.write("src/e.css", ".card { color: #111; }\n");
    deny(
        &cursor(
            &cwd,
            "StrReplace",
            json!({"path": orig, "old_string": ".card {", "new_string": format!("{slop}.card {{")}),
        ),
        "edit projection",
    );
    allow(
        &cursor(&cwd, "Edit", json!({"path": orig, "new_string": "x"})),
        "fragment-only",
    );
    allow(
        &cursor(
            &cwd,
            "Edit",
            json!({"path": orig, "old_string": "NOPE", "new_string": "x"}),
        ),
        "old string missing",
    );
    allow(
        &cursor(&cwd, "Shell", json!({"command": "echo hi > src/q.css"})),
        "redirect without content",
    );
    allow(
        &cursor(&cwd, "Write", json!({"path": "src/new.css", "content": ""})),
        "empty content",
    );
    allow(
        &cursor(
            &cwd,
            "Write",
            json!({"path": "src/data.json", "content": "{}"}),
        ),
        "non-ui",
    );
    allow(&cursor(&cwd, "Shell", json!({"command": "ls"})), "no file");
    allow("", "empty stdin");
    allow("{", "malformed stdin");
    let off = rt_with(&cwd, env(&[("IMPECCABLE_HOOK_DISABLED", "true")]));
    let (out, _) = hbe(&off, "{");
    assert_eq!(out, "{\"permission\":\"allow\"}");
    // repeated identical denials downgrade to allow-with-warning after the threshold
    let write = cursor(
        &cwd,
        "Write",
        json!({"path": "src/new.css", "content": slop}),
    );
    let mut last = String::new();
    for _ in 0..7 {
        last = hbe(&r, &write).0;
    }
    assert!(
        last.starts_with("{\"permission\":\"allow\",\"user_message\":\""),
        "{last}"
    );
    assert!(last.contains("This is the 7th repeated denial for the same file and finding signature, so Impeccable is allowing this write to avoid a loop."));
    let cache = read_cache(&cwd);
    assert_eq!(
        cache["sessions"]["cv1"]["files"][jsp::join(&[&cwd, "src/new.css"])]["cursorDenials"]
            ["gradient-text:1"],
        json!(7)
    );
    assert_eq!(cache["sessions"]["cv1"]["footerShown"], json!(true));
}

// ── hook-admin ────────────────────────────────────────────────────────────

fn admin_run(r: &Runtime, args: &[&str]) -> (String, String, i32) {
    let (mut io, cap) = Io::captured("", PathBuf::from(&r.proc_cwd), r.env.clone());
    let argv: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    let code = admin::run(r, &argv, &mut io);
    drop(io);
    let out = String::from_utf8(cap.stdout.borrow().clone()).unwrap();
    let err = String::from_utf8(cap.stderr.borrow().clone()).unwrap();
    drop(cap);
    (out, err, code)
}

#[test]
fn admin_ignore_value_scoping_and_idempotency() {
    let t = Tmp::new();
    let cwd = t.path();
    let r = rt(&cwd);
    let (out, _, code) = admin_run(&r, &["ignore-value", "overused-font", "Inter"]);
    assert_eq!(code, 0);
    assert_eq!(
        out,
        format!("Added overused-font=inter to shared detector.ignoreValues ({}).\n", shared_config_rel())
    );
    assert!(!t.exists(".impeccable/config.local.json"));
    let cfg: Value = serde_json::from_str(&t.read(".impeccable/config.json")).unwrap();
    let entry = &cfg["detector"]["ignoreValues"][0];
    assert_eq!(
        entry
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect::<Vec<_>>(),
        vec!["rule", "value", "createdAt"]
    );
    let before = t.read(".impeccable/config.json");
    // an unrelated edit keeps the entry byte-identical
    admin_run(&r, &["ignore-rule", "side-tab"]);
    let after = t.read(".impeccable/config.json");
    assert!(after.contains(
        &before[before.find("\"ignoreValues\"").unwrap()..before.find("\n  }").unwrap()]
    ));
    let (out, _, _) = admin_run(
        &r,
        &[
            "ignore-value",
            "design-system-font-size",
            "*",
            "--file",
            "src/z.js",
            "--files=src/a.js",
            "--file",
            "src/a.js",
            "--local",
        ],
    );
    assert_eq!(out, format!("Added design-system-font-size=* scoped to src/a.js, src/z.js to local detector.ignoreValues ({}).\n", local_config_rel()));
    let (out, _, _) = admin_run(&r, &["status"]);
    assert!(out.contains(
        "ignoreValues: overused-font=inter, design-system-font-size=* [src/a.js, src/z.js]\n"
    ));
    assert!(out.contains("ignoreRules:  side-tab\n"));
    let (_, err, code) = admin_run(&r, &["ignore-value", "overused-font", "*"]);
    assert_eq!(code, 1);
    assert_eq!(err, "Error: Wildcard value ignores must be scoped with --file <glob>, e.g. /impeccable hooks ignore-value design-system-font-size \"*\" --file \"src/widget.js\". To suppress the rule project-wide use /impeccable hooks ignore-rule overused-font --all-values.\n");
    let (_, err, _) = admin_run(&r, &["ignore-value", "overused-font", "Inter", "--file="]);
    assert_eq!(err, "Error: --file requires a non-empty glob\n");
    let (_, err, _) = admin_run(&r, &["ignore-value", "overused-font", "Inter", "--shard"]);
    assert_eq!(err, "Error: Unknown ignore-value flag: --shard\n");
    let (_, err, code) = admin_run(&r, &["bogus"]);
    assert_eq!(code, 1);
    assert_eq!(err, "Unknown action: bogus\nValid: status, on, off, ignore-rule, ignore-file, ignore-value, reset\n");
    let (out, _, _) = admin_run(&r, &["reset"]);
    assert_eq!(out, format!("Reset design hook config and cache (removed: {}, {}).\n", shared_config_rel(), local_config_rel()));
    assert!(!t.exists(".impeccable/config.json"));
}

/// Upstream be87f5eb (#662), the `hooks ignore-value` twin of the detect-side
/// port (engine 09f8ae7): exact values for rules whose findings can never
/// extract a value are refused with the wildcard-plus-file route; wildcard
/// scoped entries and extractable rules stay accepted.
#[test]
fn admin_ignore_value_refuses_inert_exact_values() {
    let t = Tmp::new();
    let cwd = t.path();
    let r = rt(&cwd);
    let (_, err, code) = admin_run(&r, &["ignore-value", "cramped-padding", "padding: 4px 8px"]);
    assert_eq!(code, 1);
    assert_eq!(err, "Error: cramped-padding has no extractable ignore value. Use /impeccable hooks ignore-value cramped-padding \"*\" --file <glob> to suppress it in matching files.\n");
    let (_, err, code) = admin_run(&r, &["ignore-value", "side-tab", "Inter", "--file", "a.css"]);
    assert_eq!(code, 1);
    assert_eq!(err, "Error: side-tab has no extractable ignore value. Use /impeccable hooks ignore-value side-tab \"*\" --file <glob> to suppress it in matching files.\n");
    assert!(!t.exists(".impeccable/config.json"), "a refused ignore must not write config");

    let (out, _, code) = admin_run(&r, &["ignore-value", "overused-font", "Inter"]);
    assert_eq!(code, 0);
    assert!(out.contains("Added overused-font=inter"), "{out}");

    let (_, _, code) = admin_run(&r, &["ignore-value", "cramped-padding", "*", "--file", "index.html"]);
    assert_eq!(code, 0);
    let cfg: Value = serde_json::from_str(&t.read(".impeccable/config.json")).unwrap();
    let entries: Vec<&Value> = cfg["detector"]["ignoreValues"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["rule"] == json!("cramped-padding"))
        .collect();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0]["value"], json!("*"));
    assert_eq!(entries[0]["files"], json!(["index.html"]));
}

#[test]
fn admin_on_off_preserve_sibling_hook_fields() {
    let t = Tmp::new();
    let cwd = t.path();
    let r = rt(&cwd);
    t.write(".impeccable/config.json", "{\n  \"hook\": {\n    \"quiet\": true,\n    \"consent\": \"accepted\",\n    \"advisoryRules\": \"include\"\n  },\n  \"updateCheck\": false\n}\n");
    let (out, _, _) = admin_run(&r, &["off"]);
    assert_eq!(
        out,
        format!("Design hook disabled for this project (wrote {}).\n", shared_config_rel())
    );
    let cfg: Value = serde_json::from_str(&t.read(".impeccable/config.json")).unwrap();
    assert_eq!(cfg["hook"]["quiet"], json!(true));
    assert_eq!(cfg["hook"]["consent"], json!("accepted"));
    assert_eq!(cfg["hook"]["enabled"], json!(false));
    assert_eq!(
        cfg["hook"]["limits"],
        json!({"maxFindings": 5, "maxChars": 8000})
    );
    assert_eq!(
        cfg["detector"]["advisoryRules"],
        json!("include"),
        "legacy key migrates to detector"
    );
    assert!(cfg["hook"].get("advisoryRules").is_none());
    assert_eq!(cfg["updateCheck"], json!(false));
    assert_eq!(
        cfg.as_object().unwrap().keys().cloned().collect::<Vec<_>>(),
        vec!["hook", "updateCheck", "detector"]
    );
    std::fs::create_dir_all(t.0.join(".github/skills/impeccable")).unwrap();
    let (out, _, _) = admin_run(&r, &["on"]);
    assert_eq!(out, format!(
        "Design hook enabled for this project (wrote {}). Recorded local hook consent in {}. Installed or repaired hook manifests for: .github.\n",
        shared_config_rel(),
        local_config_rel()
    ));
    assert!(t
        .read(".github/hooks/impeccable.json")
        .contains("\"matcher\": \"edit|create|apply_patch\""));
    let (out, _, _) = admin_run(&r, &["on"]);
    assert!(out.ends_with("Hook manifests already installed for: .github.\n"));
    let (out, _, _) = admin_run(&r, &["status"]);
    assert!(out.contains("state:        enabled\n"));
    assert!(out.contains(&format!("local file:   {}\n", local_config_rel())));
}

#[test]
fn admin_on_prunes_local_manifest_when_shared_settings_carry_the_hook() {
    let t = Tmp::new();
    let cwd = t.path();
    let r = rt(&cwd);
    std::fs::create_dir_all(t.0.join(".claude/skills/impeccable")).unwrap();
    t.write(
        ".claude/settings.json",
        r#"{"hooks":{"PostToolUse":[{"matcher":"Edit","hooks":[{"type":"command","command":"node \"${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/hook.mjs\""}]}]}}"#,
    );
    t.write(
        ".claude/settings.local.json",
        "{\n  \"permissions\": {\n    \"allow\": [\n      \"Bash(ls)\"\n    ]\n  },\n  \"hooks\": {\n    \"PostToolUse\": [\n      {\n        \"matcher\": \"Edit\",\n        \"hooks\": [\n          {\n            \"type\": \"command\",\n            \"command\": \"node old/skills/impeccable/scripts/hook.mjs\"\n          }\n        ]\n      }\n    ]\n  }\n}\n",
    );
    let (out, _, _) = admin_run(&r, &["on"]);
    assert!(
        out.ends_with("Hook manifests already installed for: .claude.\n"),
        "{out}"
    );
    let local: Value = serde_json::from_str(&t.read(".claude/settings.local.json")).unwrap();
    assert!(
        local.get("hooks").is_none(),
        "impeccable entries pruned, empty hooks dropped: {local}"
    );
    assert_eq!(local["permissions"]["allow"], json!(["Bash(ls)"]));
    // a local manifest holding only impeccable entries is deleted outright
    t.write(
        ".claude/settings.local.json",
        r#"{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"node x/skills/impeccable/scripts/hook.mjs"}]}]}}"#,
    );
    admin_run(&r, &["on"]);
    assert!(!t.exists(".claude/settings.local.json"));
}

#[test]
fn admin_on_writes_launcher_manifests_for_every_harness() {
    let t = Tmp::new();
    let cwd = t.path();
    let r = rt(&cwd);
    for skill in [
        ".claude/skills/impeccable",
        ".agents/skills/impeccable",
        ".cursor/skills/impeccable",
        ".github/skills/impeccable",
    ] {
        std::fs::create_dir_all(t.0.join(skill)).unwrap();
    }
    let (out, _, code) = admin_run(&r, &["on"]);
    assert_eq!(code, 0, "{out}");
    assert!(out.ends_with("Installed or repaired hook manifests for: .claude, .agents, .cursor, .github.\n"), "{out}");

    let claude: Value = serde_json::from_str(&t.read(".claude/settings.local.json")).unwrap();
    let cmd = "\"${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/impeccable\" hook";
    assert_eq!(claude["hooks"]["PostToolUse"][0]["hooks"][0]["command"], json!(cmd));
    assert_eq!(claude["hooks"]["Stop"][0]["hooks"][0]["command"], json!(cmd));
    assert!(claude["hooks"]["PostToolUse"][0]["hooks"][0].get("commandWindows").is_none());
    assert!(!t.read(".claude/settings.local.json").contains("node "));

    let codex: Value = serde_json::from_str(&t.read(".codex/hooks.json")).unwrap();
    let entry = &codex["hooks"]["PostToolUse"][0]["hooks"][0];
    assert_eq!(entry["command"], json!("\".agents/skills/impeccable/scripts/impeccable\" hook"));
    assert_eq!(entry["commandWindows"], json!(r#"cmd /c if exist ".agents\skills\impeccable\scripts\impeccable.cmd" ".agents\skills\impeccable\scripts\impeccable.cmd" hook"#));
    assert_eq!(
        entry.as_object().unwrap().keys().cloned().collect::<Vec<_>>(),
        vec!["type", "command", "commandWindows", "timeout", "statusMessage"]
    );
    let stop = &codex["hooks"]["Stop"][0]["hooks"][0];
    assert_eq!(stop["command"], json!("\".agents/skills/impeccable/scripts/impeccable\" hook"));
    assert_eq!(stop["commandWindows"], json!(r#"cmd /c if exist ".agents\skills\impeccable\scripts\impeccable.cmd" ".agents\skills\impeccable\scripts\impeccable.cmd" hook"#));
    assert_eq!(stop["timeout"], json!(30));

    let cursor: Value = serde_json::from_str(&t.read(".cursor/hooks.json")).unwrap();
    assert_eq!(
        cursor,
        json!({"version": 1, "hooks": {"postToolUse": [{
            "command": "\".cursor/skills/impeccable/scripts/impeccable\" hook",
            "matcher": "^Write$",
            "timeout": 5,
        }]}})
    );
    let github: Value = serde_json::from_str(&t.read(".github/hooks/impeccable.json")).unwrap();
    assert_eq!(
        github["hooks"]["postToolUse"][0]["bash"],
        json!("\"$(git rev-parse --show-toplevel)/.github/skills/impeccable/scripts/impeccable\" hook")
    );

    // A second `on` is a no-op against the manifests it just wrote.
    let (out, _, _) = admin_run(&r, &["on"]);
    assert!(out.ends_with("Hook manifests already installed for: .claude, .agents, .cursor, .github.\n"), "{out}");
}

fn expected_user_claude_hook_command(home: &str) -> String {
    let launcher = jsp::join(&[home, ".claude", "skills", "impeccable", "scripts", "impeccable"]);
    let q = if cfg!(windows) {
        serde_json::to_string(&launcher).unwrap()
    } else {
        format!("'{}'", launcher.replace('\'', "'\\''"))
    };
    format!("[ ! -f {q} ] || {q} hook")
}

#[test]
fn admin_on_repairs_project_manifest_from_user_scope_claude_skill() {
    let t = Tmp::new();
    let cwd = t.path();
    let home = t.0.join("home");
    std::fs::create_dir_all(home.join(".claude/skills/impeccable/scripts")).unwrap();
    std::fs::write(home.join(".claude/skills/impeccable/scripts/impeccable"), "#!/bin/sh\n").unwrap();
    std::fs::write(home.join(".claude/settings.json"), r#"{"model":"claude-sonnet-5"}"#).unwrap();
    t.write(
        ".claude/settings.local.json",
        r#"{"permissions":{"allow":["Bash(ls)"]},"hooks":{"PostToolUse":[{"matcher":"Edit","hooks":[{"type":"command","command":"node \"${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/hook.mjs\""}]}]}}"#,
    );
    let home_text = home.to_string_lossy().to_string();
    let r = rt_with(&cwd, env(&[("HOME", &home_text), ("USERPROFILE", &home_text)]));

    let (out, _, code) = admin_run(&r, &["on"]);

    assert_eq!(code, 0, "{out}");
    assert!(out.contains("Installed or repaired hook manifests for: .claude."), "{out}");
    let user: Value =
        serde_json::from_str(&std::fs::read_to_string(home.join(".claude/settings.json")).unwrap()).unwrap();
    assert_eq!(user["model"], "claude-sonnet-5");
    let command = user["hooks"]["PostToolUse"][0]["hooks"][0]["command"].as_str().unwrap();
    assert_eq!(command, expected_user_claude_hook_command(&home_text));
    let local: Value = serde_json::from_str(&t.read(".claude/settings.local.json")).unwrap();
    assert!(local.get("hooks").is_none(), "stale project hook was not pruned: {local}");
    assert_eq!(local["permissions"]["allow"], json!(["Bash(ls)"]));

    // Once the project copy is gone, a second run leaves the user file alone.
    let before = std::fs::read_to_string(home.join(".claude/settings.json")).unwrap();
    let (again, _, code) = admin_run(&r, &["on"]);
    assert_eq!(code, 0, "{again}");
    assert_eq!(std::fs::read_to_string(home.join(".claude/settings.json")).unwrap(), before);
}

#[test]
fn admin_on_repairs_shared_project_manifest_from_user_scope_claude_skill() {
    let t = Tmp::new();
    let cwd = t.path();
    let home = t.0.join("home");
    std::fs::create_dir_all(home.join(".claude/skills/impeccable/scripts")).unwrap();
    std::fs::write(home.join(".claude/skills/impeccable/scripts/impeccable"), "#!/bin/sh\n").unwrap();
    let shared_original = r#"{"model":"claude-sonnet-5","hooks":{"PostToolUse":[{"matcher":"Edit","hooks":[{"type":"command","command":"node \"${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/hook.mjs\""}]}]}}"#;
    t.write(".claude/settings.json", shared_original);
    t.write(
        ".claude/settings.local.json",
        r#"{"permissions":{"allow":["Bash(ls)"]},"hooks":{"Stop":[{"hooks":[{"type":"command","command":"node old/skills/impeccable/scripts/hook.mjs"}]}]}}"#,
    );
    let home_text = home.to_string_lossy().to_string();
    let r = rt_with(&cwd, env(&[("HOME", &home_text), ("USERPROFILE", &home_text)]));

    let (out, _, code) = admin_run(&r, &["on"]);

    assert_eq!(code, 0, "{out}");
    assert!(out.contains("Installed or repaired hook manifests for: .claude."), "{out}");
    // The hook lands in the user's own settings, with the absolute launcher.
    let user: Value =
        serde_json::from_str(&std::fs::read_to_string(home.join(".claude/settings.json")).unwrap()).unwrap();
    let command = user["hooks"]["PostToolUse"][0]["hooks"][0]["command"].as_str().unwrap();
    assert_eq!(command, expected_user_claude_hook_command(&home_text));
    let local: Value = serde_json::from_str(&t.read(".claude/settings.local.json")).unwrap();
    assert!(local.get("hooks").is_none(), "local duplicate was not pruned: {local}");
    assert_eq!(local["permissions"]["allow"], json!(["Bash(ls)"]));
}

/// Regression: a user-scope repair must never write a home path into the
/// committed, team-shared `.claude/settings.json`.
#[test]
fn admin_on_user_scope_repair_leaves_committed_settings_byte_unchanged() {
    let t = Tmp::new();
    let cwd = t.path();
    let home = t.0.join("home");
    std::fs::create_dir_all(home.join(".claude/skills/impeccable/scripts")).unwrap();
    std::fs::write(home.join(".claude/skills/impeccable/scripts/impeccable"), "#!/bin/sh\n").unwrap();
    let shared_original = "{\n  \"hooks\": {\"PostToolUse\": [{\"matcher\": \"Edit\", \"hooks\": [{\"type\": \"command\", \"command\": \"\\\"${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/impeccable\\\" hook\"}]}]}\n}\n";
    t.write(".claude/settings.json", shared_original);
    let home_text = home.to_string_lossy().to_string();
    let r = rt_with(&cwd, env(&[("HOME", &home_text), ("USERPROFILE", &home_text)]));

    let (out, _, code) = admin_run(&r, &["on"]);

    assert_eq!(code, 0, "{out}");
    let shared = t.read(".claude/settings.json");
    assert_eq!(shared, shared_original);
    assert!(!shared.contains(&home_text), "home path leaked into the committed manifest: {shared}");
    assert!(std::fs::read_to_string(home.join(".claude/settings.json")).unwrap().contains("impeccable"));
}

/// Regression: an unreadable `~/.claude/settings.json` is skipped, so the
/// project hook must survive; pruning it first would leave no hook at all.
#[test]
fn admin_on_user_scope_keeps_project_hook_when_user_settings_are_invalid() {
    let t = Tmp::new();
    let cwd = t.path();
    let home = t.0.join("home");
    std::fs::create_dir_all(home.join(".claude/skills/impeccable/scripts")).unwrap();
    std::fs::write(home.join(".claude/skills/impeccable/scripts/impeccable"), "#!/bin/sh\n").unwrap();
    let broken = "{ \"model\": \"claude-sonnet-5\",, }";
    std::fs::write(home.join(".claude/settings.json"), broken).unwrap();
    let local_original = r#"{"hooks":{"PostToolUse":[{"matcher":"Edit","hooks":[{"type":"command","command":"\"${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/impeccable\" hook"}]}]}}"#;
    t.write(".claude/settings.local.json", local_original);
    let home_text = home.to_string_lossy().to_string();
    let r = rt_with(&cwd, env(&[("HOME", &home_text), ("USERPROFILE", &home_text)]));

    let (out, _, code) = admin_run(&r, &["on"]);

    assert_eq!(code, 0, "{out}");
    assert!(out.contains("Skipped "), "{out}");
    assert!(out.contains("not valid JSON"), "{out}");
    assert_eq!(std::fs::read_to_string(home.join(".claude/settings.json")).unwrap(), broken);
    assert_eq!(t.read(".claude/settings.local.json"), local_original);
}

/// Regression (PR #986 review): a user skill folder without its launcher is not
/// a user-scope install `hooks on` can switch to. The project hook may still run
/// another installation, so it stays, and `~/.claude/settings.json` is not written.
#[test]
fn admin_on_user_scope_without_launcher_keeps_project_hook() {
    let t = Tmp::new();
    let cwd = t.path();
    let home = t.0.join("home");
    std::fs::create_dir_all(home.join(".claude/skills/impeccable")).unwrap();
    let local_original = r#"{"hooks":{"PostToolUse":[{"matcher":"Edit","hooks":[{"type":"command","command":"\"${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/impeccable\" hook"}]}]}}"#;
    t.write(".claude/settings.local.json", local_original);
    let home_text = home.to_string_lossy().to_string();
    let r = rt_with(&cwd, env(&[("HOME", &home_text), ("USERPROFILE", &home_text)]));

    let (out, _, code) = admin_run(&r, &["on"]);

    assert_eq!(code, 0, "{out}");
    assert_eq!(t.read(".claude/settings.local.json"), local_original);
    assert!(!home.join(".claude/settings.json").exists(), "{out}");
}

/// Regression (PR #986 review): a legacy `hook.mjs` entry already in
/// `~/.claude/settings.json` is not a current user hook. It is replaced with
/// the launcher form, and only then is the project hook pruned.
#[test]
fn admin_on_replaces_legacy_user_hook_before_pruning_project_hook() {
    let t = Tmp::new();
    let cwd = t.path();
    let home = t.0.join("home");
    std::fs::create_dir_all(home.join(".claude/skills/impeccable/scripts")).unwrap();
    std::fs::write(home.join(".claude/skills/impeccable/scripts/impeccable"), "#!/bin/sh\n").unwrap();
    std::fs::write(
        home.join(".claude/settings.json"),
        r#"{"model":"claude-sonnet-5","hooks":{"PostToolUse":[{"matcher":"Edit","hooks":[{"type":"command","command":"node \"~/.claude/skills/impeccable/scripts/hook.mjs\""}]}]}}"#,
    )
    .unwrap();
    t.write(
        ".claude/settings.local.json",
        r#"{"permissions":{"allow":["Bash(ls)"]},"hooks":{"PostToolUse":[{"hooks":[{"type":"command","command":"\"${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/impeccable\" hook"}]}]}}"#,
    );
    let home_text = home.to_string_lossy().to_string();
    let r = rt_with(&cwd, env(&[("HOME", &home_text), ("USERPROFILE", &home_text)]));

    let (out, _, code) = admin_run(&r, &["on"]);

    assert_eq!(code, 0, "{out}");
    let user_text = std::fs::read_to_string(home.join(".claude/settings.json")).unwrap();
    assert!(!user_text.contains("hook.mjs"), "legacy user hook survived: {user_text}");
    let user: Value = serde_json::from_str(&user_text).unwrap();
    assert_eq!(user["model"], "claude-sonnet-5");
    let command = user["hooks"]["PostToolUse"][0]["hooks"][0]["command"].as_str().unwrap();
    assert_eq!(command, expected_user_claude_hook_command(&home_text));
    let local: Value = serde_json::from_str(&t.read(".claude/settings.local.json")).unwrap();
    assert!(local.get("hooks").is_none(), "duplicate project hook survived: {local}");
}

#[test]
fn admin_on_moves_the_retired_cursor_gate_to_post_tool_use() {
    let t = Tmp::new();
    let cwd = t.path();
    let r = rt(&cwd);
    std::fs::create_dir_all(t.0.join(".cursor/skills/impeccable")).unwrap();
    // A pre-migration manifest: the gate on preToolUse beside a foreign hook
    // on the same event and another on a different one.
    t.write(
        ".cursor/hooks.json",
        r#"{"version":1,"hooks":{"preToolUse":[{"command":"./audit.sh","matcher":"Shell"},{"command":"\".cursor/skills/impeccable/scripts/impeccable\" hook-before-edit","timeout":5}],"stop":[{"command":"./notify.sh"}]}}"#,
    );

    let (out, _, code) = admin_run(&r, &["on"]);

    assert_eq!(code, 0, "{out}");
    assert!(out.contains("Installed or repaired hook manifests for: .cursor."), "{out}");
    let cursor: Value = serde_json::from_str(&t.read(".cursor/hooks.json")).unwrap();
    assert_eq!(
        cursor,
        json!({"version": 1, "hooks": {
            "preToolUse": [{"command": "./audit.sh", "matcher": "Shell"}],
            "stop": [{"command": "./notify.sh"}],
            "postToolUse": [{
                "command": "\".cursor/skills/impeccable/scripts/impeccable\" hook",
                "matcher": "^Write$",
                "timeout": 5,
            }],
        }})
    );
}

#[test]
fn admin_on_does_not_repair_project_manifests_from_other_user_scope_skills() {
    let t = Tmp::new();
    let cwd = t.path();
    let home = t.0.join("home");
    std::fs::create_dir_all(home.join(".cursor/skills/impeccable")).unwrap();
    let original = r#"{"version":1,"hooks":{"preToolUse":[{"command":".cursor/skills/impeccable/scripts/impeccable hook-before-edit"}]}}"#;
    t.write(".cursor/hooks.json", original);
    let home_text = home.to_string_lossy().to_string();
    let r = rt_with(&cwd, env(&[("HOME", &home_text), ("USERPROFILE", &home_text)]));

    let (out, _, code) = admin_run(&r, &["on"]);

    assert_eq!(code, 0, "{out}");
    assert!(out.contains("No installed provider skill folders found to repair."), "{out}");
    assert_eq!(t.read(".cursor/hooks.json"), original);
}

#[test]
fn admin_on_repairs_legacy_mjs_manifests_to_the_launcher_form() {
    let t = Tmp::new();
    let cwd = t.path();
    let r = rt(&cwd);
    std::fs::create_dir_all(t.0.join(".claude/skills/impeccable")).unwrap();
    std::fs::create_dir_all(t.0.join(".agents/skills/impeccable")).unwrap();
    // JS-era Claude manifest with a foreign entry alongside the impeccable one.
    t.write(
        ".claude/settings.local.json",
        r#"{"permissions":{"allow":["Bash(ls)"]},"hooks":{"PostToolUse":[{"matcher":"Edit","hooks":[{"type":"command","command":"echo other"}]},{"matcher":"Edit|Write|MultiEdit","hooks":[{"type":"command","command":"node \"${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/hook.mjs\"","timeout":5}]}],"Stop":[{"hooks":[{"type":"command","command":"[ ! -f '/x/.claude/skills/impeccable/scripts/hook.mjs' ] || node '/x/.claude/skills/impeccable/scripts/hook.mjs'"}]}]}}"#,
    );
    // JS-era Codex manifest carrying the CLI installer's commandWindows sibling.
    t.write(
        ".codex/hooks.json",
        r#"{"hooks":{"PostToolUse":[{"matcher":"Edit|Write|apply_patch","hooks":[{"type":"command","command":"[ ! -f \".agents/skills/impeccable/scripts/hook.mjs\" ] || node \".agents/skills/impeccable/scripts/hook.mjs\"","commandWindows":"if exist \".agents/skills/impeccable/scripts/hook.mjs\" (node \".agents/skills/impeccable/scripts/hook.mjs\" & exit /b)","timeout":5}]}]}}"#,
    );
    let (out, _, code) = admin_run(&r, &["on"]);
    assert_eq!(code, 0, "{out}");
    assert!(out.ends_with("Installed or repaired hook manifests for: .claude, .agents.\n"), "{out}");

    let claude = t.read(".claude/settings.local.json");
    assert!(!claude.contains(".mjs"), "legacy entries replaced: {claude}");
    let claude: Value = serde_json::from_str(&claude).unwrap();
    assert_eq!(claude["permissions"]["allow"], json!(["Bash(ls)"]));
    let post = claude["hooks"]["PostToolUse"].as_array().unwrap();
    assert_eq!(post.len(), 2, "foreign entry kept, impeccable entry replaced once: {post:?}");
    assert_eq!(post[0]["hooks"][0]["command"], json!("echo other"));
    assert_eq!(
        post[1]["hooks"][0]["command"],
        json!("\"${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/impeccable\" hook")
    );
    // Upstream 611147a3: the repaired Claude group must exist and carry the
    // current Edit|Write matcher (MultiEdit is retired; see 55fb8e8).
    assert_eq!(post[1]["matcher"], json!("Edit|Write"));
    assert_eq!(claude["hooks"]["Stop"].as_array().unwrap().len(), 1);

    let codex = t.read(".codex/hooks.json");
    assert!(!codex.contains(".mjs"), "{codex}");
    let codex: Value = serde_json::from_str(&codex).unwrap();
    assert_eq!(codex["hooks"]["PostToolUse"].as_array().unwrap().len(), 1);
    assert_eq!(
        codex["hooks"]["PostToolUse"][0]["hooks"][0]["commandWindows"],
        json!(r#"cmd /c if exist ".agents\skills\impeccable\scripts\impeccable.cmd" ".agents\skills\impeccable\scripts\impeccable.cmd" hook"#)
    );

    // A launcher-form manifest written by another checkout is recognized as
    // ours too: shared settings carrying it make `on` prune the local file.
    t.write(
        ".claude/settings.json",
        r#"{"hooks":{"PostToolUse":[{"matcher":"Edit","hooks":[{"type":"command","command":"\"${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/impeccable\" hook"}]}]}}"#,
    );
    let (out, _, _) = admin_run(&r, &["on"]);
    assert!(out.contains("already installed for: .claude"), "{out}");
    let local = t.read(".claude/settings.local.json");
    assert!(!local.contains("skills/impeccable"), "launcher-form entries pruned: {local}");
    let local: Value = serde_json::from_str(&local).unwrap();
    assert_eq!(local["hooks"]["PostToolUse"][0]["hooks"][0]["command"], json!("echo other"));
    assert!(local["hooks"].get("Stop").is_none());
    assert_eq!(local["permissions"]["allow"], json!(["Bash(ls)"]));
}

// ── Grok Build + Codex (#646, #603, upstream 35ae0733/bfe634e2/3c442af7/c9e7cd8a) ──

const MIXED_CSS: &str = ".title { background: linear-gradient(90deg, #f472b6, #a78bfa); -webkit-background-clip: text; color: transparent; }\n.card { border-left: 4px solid #6366f1; border-radius: 8px; }\n";

#[test]
fn grok_and_codex_harness_detection() {
    let r = rt("/p");
    // Grok Build camelCase envelope wins over the old GitHub heuristic.
    let grok = json!({
        "hookEventName": "post_tool_use", "sessionId": "g1", "cwd": "/w",
        "toolName": "str_replace", "toolInput": { "file_path": "src/a.css" },
    })
    .as_object()
    .cloned()
    .unwrap();
    assert_eq!(resolve_harness(&r, Some(&grok)), "grok");
    // GitHub Copilot still classifies by toolArgs.
    let gh = json!({ "toolName": "str_replace_editor", "toolArgs": "{}" }).as_object().cloned().unwrap();
    assert_eq!(resolve_harness(&r, Some(&gh)), "github");
    // A Stop envelope with only hookEventName is Grok too.
    let grok_stop = json!({ "hookEventName": "stop", "sessionId": "g1", "cwd": "/w" }).as_object().cloned().unwrap();
    assert_eq!(resolve_harness(&r, Some(&grok_stop)), "grok");
    // Codex turn-scoped events carry turn_id; Claude Code does not.
    let codex = json!({ "hook_event_name": "Stop", "session_id": "s", "turn_id": "t-1" }).as_object().cloned().unwrap();
    assert_eq!(resolve_harness(&r, Some(&codex)), "codex");
    let claude = json!({ "hook_event_name": "Stop", "session_id": "s" }).as_object().cloned().unwrap();
    assert_eq!(resolve_harness(&r, Some(&claude)), "claude");
    // Explicit env overrides.
    let forced = rt_with("/p", env(&[("IMPECCABLE_HOOK_HARNESS", "grok")]));
    assert_eq!(resolve_harness(&forced, Some(&gh)), "grok");
    // Stop detection matches both casings, on the raw stdin shape.
    assert!(is_stop_event(&grok_stop));
    assert!(is_stop_event(&claude));
    assert!(!is_stop_event(&grok));
}

#[test]
fn grok_post_tool_use_scans_and_stop_reports_everything() {
    let t = Tmp::new();
    let cwd = t.path();
    let r = rt(&cwd);
    let css = t.write("src/a.css", MIXED_CSS);
    // Grok Build PostToolUse: camelCase fields must normalize into a scan,
    // not skip with no-file-path (#646).
    let post = json!({
        "hookEventName": "post_tool_use", "sessionId": "g1", "cwd": cwd,
        "toolName": "str_replace", "toolInput": { "file_path": css },
    })
    .to_string();
    let one = hook::run_hook(&r, &post);
    assert!(one.stdout.contains("gradient-text"), "{}", one.stdout);
    assert_eq!(audit_str(&one.audit, "harness"), Some("grok"));

    // Grok discards PostToolUse stdout, so Stop must re-report the immediate
    // tier alongside the deferred one: the per-edit pass only touched the
    // file, remembering nothing.
    let stop = json!({ "hookEventName": "stop", "sessionId": "g1", "cwd": cwd, "reason": "end_turn" }).to_string();
    let deep = hook::run_stop_hook(&r, &stop);
    assert!(
        deep.stdout.contains("[gradient-text]") && deep.stdout.contains("[side-tab]"),
        "{}",
        deep.stdout
    );
    assert!(deep.stdout.contains("\"hookEventName\":\"Stop\""), "Grok takes the Claude Stop payload shape");

    // The observe-only shutdown fire never re-emits.
    let shutdown = json!({ "hookEventName": "stop", "sessionId": "g1", "cwd": cwd, "reason": "shutdown" }).to_string();
    let second = hook::run_stop_hook(&r, &shutdown);
    assert_eq!(second.stdout, "");
    assert_eq!(audit_str(&second.audit, "skipped"), Some("stop-reason"));

    // stopHookActive (camelCase) guards re-entry like stop_hook_active.
    let active = json!({ "hookEventName": "stop", "sessionId": "g1", "cwd": cwd, "stopHookActive": true }).to_string();
    let re = hook::run_stop_hook(&r, &active);
    assert_eq!(audit_str(&re.audit, "skipped"), Some("stop-hook-active"));
}

#[test]
fn stop_cache_syncs_after_clean_scan_so_reintroductions_fire() {
    // 3c442af7: a finding that was fixed and then reintroduced must fire
    // again — the clean Stop in between rewrites the remembered set.
    let t = Tmp::new();
    let cwd = t.path();
    let r = rt(&cwd);
    let css = t.write("src/a.css", SIDE_TAB_CSS);
    hook::run_hook(&r, &edit_event(&cwd, &css, "s1"));
    let first = hook::run_stop_hook(&r, &stop_event(&cwd, "s1"));
    assert!(first.stdout.contains("[side-tab]"), "{}", first.stdout);
    // Fix it: the next Stop is clean and syncs the remembered set to empty.
    t.write("src/a.css", ".card { color: #333; }\n");
    let clean = hook::run_stop_hook(&r, &stop_event(&cwd, "s1"));
    assert_eq!(audit_str(&clean.audit, "skipped"), Some("stop-clean"));
    // Reintroduce: the deep pass reports it again instead of staying silent.
    t.write("src/a.css", SIDE_TAB_CSS);
    let again = hook::run_stop_hook(&r, &stop_event(&cwd, "s1"));
    assert!(again.stdout.contains("[side-tab]"), "{}", again.stdout);
}

#[test]
fn stop_from_a_subfolder_finds_the_root_cache() {
    // #1088: the per-edit pass keys the cache to the project root; Stop from a
    // subfolder, even one with its own `.impeccable/`, must still find it.
    let t = Tmp::new();
    t.write("package.json", "{}");
    let cwd = t.path();
    let css = t.write("src/a.css", SIDE_TAB_CSS);
    let docs = jsp::join(&[&cwd, "docs"]);
    t.write("docs/readme.txt", "x");
    let app = jsp::join(&[&cwd, "app"]);
    t.write("app/.impeccable/live/roots.json", "{}");
    for (session, sub) in [("s1", &docs), ("s2", &app)] {
        hook::run_hook(&rt(&cwd), &edit_event(&cwd, &css, session));
        let res = hook::run_stop_hook(&rt(sub), &stop_event(sub, session));
        assert!(res.stdout.contains("[side-tab]"), "{session}: {}", res.stdout);
        assert_eq!(audit_str(&res.audit, "cwd"), Some(cwd.as_str()));
    }
}

#[test]
fn stop_from_a_subfolder_build_keeps_its_reminder_and_scans_the_root_cache() {
    // #1088: `build-phase` keeps its state under its own cwd, so the reminder
    // and its config stay there, while the scan still finds root edits.
    let t = Tmp::new();
    t.write("package.json", "{}");
    let cwd = t.path();
    let css = t.write("src/a.css", SIDE_TAB_CSS);
    t.write("app/index.html", "<main>In progress</main>");
    let build = |owner: &str| t.write("app/.impeccable/build/state.json", &json!({
        "tool":"build-phase", "version":2, "startedAt":"build-one",
        "sessionId":owner, "artifact":"index.html", "finish":null,
        "phases":{"hero":{"status":"open"}}
    }).to_string());
    let app = jsp::join(&[&cwd, "app"]);
    hook::run_hook(&rt(&cwd), &edit_event(&cwd, &css, "owner"));
    build("other");
    let res = hook::run_stop_hook(&rt(&app), &stop_event(&app, "owner"));
    assert!(res.stdout.contains("[side-tab]"), "{}", res.stdout);
    build("owner");
    let res = hook::run_stop_hook(&rt(&app), &stop_event(&app, "owner"));
    assert!(res.stdout.contains("Comp build"), "{}", res.stdout);
    t.write("app/.impeccable/config.json", r#"{"hook":{"enabled":false}}"#);
    let res = hook::run_stop_hook(&rt(&app), &stop_event(&app, "owner"));
    assert_eq!(audit_str(&res.audit, "skipped"), Some("config-disabled"));
    // The root's own config gates the scan of root edits.
    t.write("app/.impeccable/config.json", "{}");
    t.write("app/.impeccable/build/state.json", "{}");
    t.write(".impeccable/config.json", r#"{"hook":{"enabled":false}}"#);
    let res = hook::run_stop_hook(&rt(&app), &stop_event(&app, "owner"));
    assert_eq!(audit_str(&res.audit, "skipped"), Some("config-disabled"));
    assert_eq!(audit_str(&res.audit, "cwd"), Some(cwd.as_str()));
}

#[test]
fn stop_from_a_subfolder_shipped_build_marks_the_build_folder_cache() {
    // #1088: findings from a root edit over a build shipped in the subfolder
    // carry the finish note, and its marker lands where the reminder reads it.
    let t = Tmp::new();
    t.write("package.json", "{}");
    let cwd = t.path();
    shipped_build_in(&t, "app/");
    let css = t.write("src/a.css", SIDE_TAB_CSS);
    hook::run_hook(&rt(&cwd), &edit_event(&cwd, &css, "owner"));
    let app = jsp::join(&[&cwd, "app"]);
    let res = hook::run_stop_hook(&rt(&app), &stop_event(&app, "owner"));
    assert!(res.stdout.contains("[side-tab]"), "{}", res.stdout);
    assert!(res.stdout.contains("finish --disposition ship recorded"), "{}", res.stdout);
    assert!(t.read("app/.impeccable/hook.cache.json").contains("findingsAfterFinish"));
    assert!(!t.read(".impeccable/hook.cache.json").contains("findingsAfterFinish"));
}

#[test]
fn codex_stop_emits_decision_block() {
    // #603: Codex Stop rejects Claude's hookSpecificOutput shape; findings
    // that should continue the turn are a top-level blocking decision.
    assert_eq!(payload("findings", "Stop", "codex"), r#"{"decision":"block","reason":"findings"}"#);
    assert_eq!(payload("  ", "Stop", "codex"), "");
    // PostToolUse keeps the shared additional-context shape.
    assert_eq!(
        payload("t", "PostToolUse", "codex"),
        r#"{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"t"}}"#
    );

    let t = Tmp::new();
    let cwd = t.path();
    let r = rt(&cwd);
    let css = t.write("src/a.css", SIDE_TAB_CSS);
    hook::run_hook(&r, &edit_event(&cwd, &css, "s1"));
    let stop = json!({ "session_id": "s1", "cwd": cwd, "hook_event_name": "Stop", "turn_id": "t-9" }).to_string();
    let deep = hook::run_stop_hook(&r, &stop);
    let out: Value = serde_json::from_str(&deep.stdout).unwrap();
    assert_eq!(out["decision"], json!("block"));
    assert!(out["reason"].as_str().unwrap().contains("[side-tab]"));
    assert!(out.get("hookSpecificOutput").is_none());
}

#[test]
fn hermes_harness_shapes_each_pass() {
    // #1178: the Hermes plugin sets the harness explicitly and sends
    // Claude-shaped events; its pre_verify gate reads Codex's Stop shape.
    let forced = rt_with("/p", env(&[("IMPECCABLE_HOOK_HARNESS", "hermes")]));
    let claude = json!({ "hook_event_name": "Stop", "session_id": "s" }).as_object().cloned().unwrap();
    assert_eq!(resolve_harness(&forced, Some(&claude)), "hermes");
    assert_eq!(payload("findings", "Stop", "hermes"), r#"{"decision":"block","reason":"findings"}"#);
    assert_eq!(payload("  ", "Stop", "hermes"), "");
    assert_eq!(
        payload("t", "PostToolUse", "hermes"),
        r#"{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"t"}}"#
    );

    let t = Tmp::new();
    let cwd = t.path();
    let r = rt_with(&cwd, env(&[("IMPECCABLE_HOOK_HARNESS", "hermes")]));
    let css = t.write("src/a.css", SIDE_TAB_CSS);
    let edit = json!({
        "session_id": "h1", "cwd": cwd, "hook_event_name": "PostToolUse",
        "tool_name": "Write", "tool_input": { "file_path": css },
    })
    .to_string();
    let quiet = hook::run_hook(&r, &edit);
    assert_eq!(audit_str(&quiet.audit, "harness"), Some("hermes"));
    assert!(!quiet.stdout.contains("[side-tab]"), "side-tab is deferred to Stop: {}", quiet.stdout);
    let stop = stop_event(&cwd, "h1");
    let deep = hook::run_stop_hook(&r, &stop);
    let out: Value = serde_json::from_str(&deep.stdout).unwrap();
    assert_eq!(out["decision"], json!("block"));
    assert!(out["reason"].as_str().unwrap().contains("[side-tab]"));
    assert!(out.get("hookSpecificOutput").is_none());
    assert_eq!(hook::run_stop_hook(&r, &stop).stdout, "", "a repeat Stop stays silent");
}

// ── live-preview stand-down ───────────────────────────────────────────────
//
// A live variant session owns files carrying preview scaffolding
// (`data-impeccable-variants=` wrappers, `impeccable-carbonize-start`
// blocks). Every hook entry stands down on them: findings there are noise
// and acting on them derails the session; live-complete verifies the file
// once the accepted variant is permanent.

#[test]
fn run_hook_stands_down_on_live_preview_markers() {
    let t = Tmp::new();
    let cwd = t.path();
    let r = rt(&cwd);
    // Control: the same slop without markers is reported.
    let plain = t.write("src/plain.css", GRADIENT_CSS);
    let reported = hook::run_hook(&r, &edit_event(&cwd, &plain, "s1"));
    assert!(reported.stdout.contains("[gradient-text]"), "{}", reported.stdout);
    // A carbonize block in flight: skipped, nothing emitted.
    let carbonized = t.write(
        "src/carbonized.css",
        &format!("/* impeccable-carbonize-start ab12cd34 */\n{GRADIENT_CSS}/* impeccable-carbonize-end ab12cd34 */\n"),
    );
    let skipped = hook::run_hook(&r, &edit_event(&cwd, &carbonized, "s1"));
    assert_eq!(skipped.stdout, "", "no findings while live markers are in the file");
    assert_eq!(skipped.audit["skipped"], json!("live-preview"));
    // A published variants wrapper, same stand-down.
    let wrapped = t.write(
        "src/wrapped.html",
        "<!-- impeccable-variants-start ab12cd34 --><div data-impeccable-variants=\"ab12cd34\" data-impeccable-variant-count=\"3\"></div>\n",
    );
    let skipped = hook::run_hook(&r, &edit_event(&cwd, &wrapped, "s1"));
    assert_eq!(skipped.stdout, "");
    assert_eq!(skipped.audit["skipped"], json!("live-preview"));
}

#[test]
fn before_edit_stands_down_on_live_preview_markers() {
    let t = Tmp::new();
    let cwd = t.path();
    t.write("package.json", "{}");
    let r = rt(&cwd);
    let slop = ".t { background: linear-gradient(90deg,#f00,#00f); -webkit-background-clip: text; color: transparent; }\n";
    // Control: denied at normal size without markers.
    let (out, _) = hbe(&r, &cursor(&cwd, "Write", json!({"file_path": "src/x.css", "content": slop})));
    assert!(out.starts_with("{\"permission\":\"deny\""), "{out}");
    // The very first variants write introduces the markers in the proposed
    // content itself.
    let proposed = format!("/* impeccable-carbonize-start ab12cd34 */\n{slop}");
    let (out, code) = hbe(&r, &cursor(&cwd, "Write", json!({"file_path": "src/x.css", "content": proposed})));
    assert_eq!(code, 0);
    assert_eq!(out, "{\"permission\":\"allow\"}");
    // Later fragment edits touch a file that already carries them on disk:
    // the proposed content alone looks like plain slop.
    t.write("src/y.css", "/* impeccable-carbonize-start ab12cd34 */\n.v { color: red; }\n");
    let (out, code) = hbe(&r, &cursor(&cwd, "Write", json!({"file_path": "src/y.css", "content": slop})));
    assert_eq!(code, 0);
    assert_eq!(out, "{\"permission\":\"allow\"}");
}

#[test]
fn run_hook_stands_down_for_the_whole_edit_when_the_primary_carries_live_markers() {
    // The edited JSX carries the wrapper; the stylesheet it imports does not.
    // Co-scanning would still speak up about the stylesheet mid-session, so
    // the whole event stands down. The same files without markers prove the
    // co-scan is otherwise live.
    let t = Tmp::new();
    let cwd = t.path();
    let r = rt(&cwd);
    t.write("src/styles.css", GRADIENT_CSS);
    let plain = t.write("src/Plain.jsx", "import './styles.css';\nexport default function Plain() { return <h1 className=\"hero-title\">Hi</h1>; }\n");
    let reported = hook::run_hook(&r, &edit_event(&cwd, &plain, "s1"));
    assert!(reported.stdout.contains("[gradient-text]"), "co-scanned stylesheet is reported without markers: {}", reported.stdout);
    let wrapped = t.write(
        "src/App.jsx",
        "import './styles.css';\n{/* impeccable-variants-start ab12cd34 */}<div data-impeccable-variants=\"ab12cd34\" data-impeccable-variant-count=\"3\"></div>\n",
    );
    let skipped = hook::run_hook(&r, &edit_event(&cwd, &wrapped, "s2"));
    assert_eq!(skipped.stdout, "", "nothing is emitted while the edited file is in a live session");
    assert_eq!(skipped.audit["skipped"], json!("live-preview"));
    let audited = audit_str(&skipped.audit, "file").unwrap_or("").replace('\\', "/");
    assert!(audited.ends_with("src/App.jsx"), "the audit names the edited file, not the companion: {audited}");
}

#[test]
fn run_hook_stands_down_before_the_edit_cap_can_suppress_a_live_file() {
    // A file edited past the per-session cap would be skipped as
    // "suppressed" (with the notice) before its content is read. A live
    // wrap on such a file must stand down instead, every time.
    let t = Tmp::new();
    let cwd = t.path();
    std::fs::create_dir_all(t.0.join(".impeccable")).unwrap();
    let r = rt(&cwd);
    // Seven plain edits cross the cap: the 7th carries the notice.
    let css = t.write("src/b.css", GRADIENT_CSS);
    let mut outputs = Vec::new();
    for _ in 0..7 {
        outputs.push(hook::run_hook(&r, &edit_event(&cwd, &css, "cap")));
    }
    assert_eq!(outputs[6].audit["suppressed"], json!(true));
    assert!(outputs[6].stdout.contains("Suppressing further design hints"));
    // Now a live session carbonizes into that same file: stand down, never
    // suppress.
    t.write(
        "src/b.css",
        &format!("/* impeccable-carbonize-start ab12cd34 */\n{GRADIENT_CSS}/* impeccable-carbonize-end ab12cd34 */\n"),
    );
    for i in 0..3 {
        let out = hook::run_hook(&r, &edit_event(&cwd, &css, "cap"));
        assert_eq!(out.stdout, "", "edit {i}: nothing emitted");
        assert_eq!(out.audit["skipped"], json!("live-preview"), "edit {i}");
        assert!(out.audit.get("suppressed").is_none(), "edit {i}: {:?}", out.audit);
        assert!(out.audit.get("editCount").is_none(), "edit {i}: the cap is not bumped for a live wrap");
    }
}

// ─── One scan per edit event (hook_claim) ────────────────────────────────────

fn claim_env(t: &Tmp, extra: &[(&str, &str)]) -> HashMap<String, String> {
    let mut e = env(extra);
    e.insert("IMPECCABLE_HOOK_CLAIM_DIR".into(), jsp::join(&[&t.path(), "claims"]));
    e
}

fn codex_post_tool_use(cwd: &str, file: &str, call: &str) -> String {
    json!({
        "session_id": "codex-s", "turn_id": "turn-1", "cwd": cwd, "hook_event_name": "PostToolUse",
        "model": "gpt-5", "tool_name": "apply_patch", "tool_use_id": call,
        "tool_input": { "file_path": file },
    })
    .to_string()
}

fn claude_post_tool_use(cwd: &str, file: &str, call: &str) -> String {
    json!({
        "session_id": "claude-s", "cwd": cwd, "hook_event_name": "PostToolUse",
        "tool_name": "Edit", "tool_use_id": call, "tool_input": { "file_path": file },
    })
    .to_string()
}

fn scanned(res: &hook::RunResult) -> bool {
    res.audit.get("skipped") != Some(&json!("duplicate-event"))
}

#[test]
fn concurrent_duplicate_invocations_of_one_event_scan_once() {
    for (harness, payload) in [
        ("cursor", cursor_post_tool_use as fn(&str, &str, &str) -> String),
        ("codex", |cwd: &str, file: &str, _c: &str| codex_post_tool_use(cwd, file, "call-1")),
        ("claude", |cwd: &str, file: &str, _c: &str| claude_post_tool_use(cwd, file, "toolu_1")),
    ] {
        let t = Tmp::new();
        let cwd = t.path();
        let file = t.write("src/card.css", SIDE_TAB_CSS);
        let stdin = payload(&cwd, &file, SIDE_TAB_CSS);
        let e = claim_env(&t, &[]);
        let results: Vec<hook::RunResult> = std::thread::scope(|s| {
            let handles: Vec<_> = (0..4)
                .map(|_| {
                    let (cwd, e, stdin) = (cwd.clone(), e.clone(), stdin.clone());
                    s.spawn(move || hook::run_hook(&rt_with(&cwd, e), &stdin))
                })
                .collect();
            handles.into_iter().map(|h| h.join().unwrap()).collect()
        });
        let scans: Vec<&hook::RunResult> = results.iter().filter(|r| scanned(r)).collect();
        assert_eq!(scans.len(), 1, "{harness}: {:?}", results.iter().map(|r| &r.audit).collect::<Vec<_>>());
        assert!(scans[0].audit.contains_key("findings") && !scans[0].stdout.is_empty(), "{harness}: {:?}", scans[0].audit);
        for r in results.iter().filter(|r| !scanned(r)) {
            assert!(r.stdout.is_empty(), "{harness}: a duplicate printed {}", r.stdout);
        }
    }
}

#[test]
fn different_edit_events_each_scan() {
    let t = Tmp::new();
    let cwd = t.path();
    let file = t.write("src/card.css", SIDE_TAB_CSS);
    let other = t.write("src/other.css", SIDE_TAB_CSS);
    let e = claim_env(&t, &[]);
    let first = hook::run_hook(&rt_with(&cwd, e.clone()), &claude_post_tool_use(&cwd, &file, "toolu_1"));
    let next_call = hook::run_hook(&rt_with(&cwd, e.clone()), &claude_post_tool_use(&cwd, &file, "toolu_2"));
    let other_file = hook::run_hook(&rt_with(&cwd, e.clone()), &codex_post_tool_use(&cwd, &other, "toolu_1"));
    for res in [&first, &next_call, &other_file] {
        assert!(scanned(res) && res.audit.contains_key("findings"), "{:?}", res.audit);
    }
}

/// A plugin's hook command sets the harness itself, the project manifest's
/// does not; both receive the same event, so only one scans.
#[test]
fn plugin_and_project_hooks_for_one_codex_event_scan_once() {
    let t = Tmp::new();
    let cwd = t.path();
    let file = t.write("src/card.css", SIDE_TAB_CSS);
    let stdin = codex_post_tool_use(&cwd, &file, "call-7");
    let plugin = hook::run_hook(&rt_with(&cwd, claim_env(&t, &[("IMPECCABLE_HOOK_HARNESS", "codex")])), &stdin);
    let project = hook::run_hook(&rt_with(&cwd, claim_env(&t, &[])), &stdin);
    assert!(scanned(&plugin) && plugin.audit.contains_key("findings"), "{:?}", plugin.audit);
    assert!(!scanned(&project) && project.stdout.is_empty(), "{:?}", project.audit);
}

/// No tool-call id: nothing to tell a duplicate from a real second edit by,
/// so every invocation scans, as before.
#[test]
fn events_without_a_tool_call_id_are_never_claimed() {
    let t = Tmp::new();
    let cwd = t.path();
    let file = t.write("src/card.css", SIDE_TAB_CSS);
    let e = claim_env(&t, &[]);
    for _ in 0..2 {
        let res = hook::run_hook(&rt_with(&cwd, e.clone()), &edit_event(&cwd, &file, "s-noid"));
        assert!(scanned(&res), "{:?}", res.audit);
    }
}

/// The claim fails open: an unusable claim dir means scan, never skip.
#[test]
fn an_unusable_claim_dir_still_scans() {
    let t = Tmp::new();
    let cwd = t.path();
    let file = t.write("src/card.css", SIDE_TAB_CSS);
    let blocker = t.write("claims-file", "not a dir");
    let mut e = env(&[]);
    e.insert("IMPECCABLE_HOOK_CLAIM_DIR".into(), jsp::join(&[&blocker, "nested"]));
    let stdin = claude_post_tool_use(&cwd, &file, "toolu_9");
    for _ in 0..2 {
        let res = hook::run_hook(&rt_with(&cwd, e.clone()), &stdin);
        assert!(scanned(&res) && res.audit.contains_key("findings"), "{:?}", res.audit);
    }
}

#[test]
fn claim_keys_are_path_safe_and_separator_independent_of_the_platform() {
    let ev: Map<String, Value> = serde_json::from_value(json!({ "session_id": "s", "tool_use_id": "t" })).unwrap();
    let key = impeccable_hook::hook_claim::event_key(&ev, r"C:\Users\dev\proj", &[r"C:\Users\dev\proj\src\a.css".into()]).unwrap();
    assert_eq!(key.len(), 64);
    assert!(key.chars().all(|c| c.is_ascii_hexdigit()));
    let ev_none: Map<String, Value> = serde_json::from_value(json!({ "session_id": "s" })).unwrap();
    assert!(impeccable_hook::hook_claim::event_key(&ev_none, "/p", &[]).is_none());
}

// ─── Claim storage safety (#1069 review: shared temp roots) ──────────────────

const OLD_CLAIM: &str = "0000000000000000000000000000000000000000000000000000000000000001";

/// A claim root that is a symlink (say one another user planted) is never
/// followed: nothing behind it is created or deleted, and both hooks scan.
#[test]
#[cfg(unix)]
fn a_symlinked_claim_root_is_never_followed() {
    let t = Tmp::new();
    let cwd = t.path();
    let file = t.write("src/card.css", SIDE_TAB_CSS);
    t.write("victim/2024/keep.txt", "mine");
    t.write(&format!("victim/1/{OLD_CLAIM}"), "");
    let victim = jsp::join(&[&cwd, "victim"]);
    let link = jsp::join(&[&cwd, "claims-link"]);
    std::os::unix::fs::symlink(&victim, &link).unwrap();
    let mut e = env(&[]);
    e.insert("IMPECCABLE_HOOK_CLAIM_DIR".into(), link.clone());
    let stdin = claude_post_tool_use(&cwd, &file, "toolu_link");
    for _ in 0..2 {
        let res = hook::run_hook(&rt_with(&cwd, e.clone()), &stdin);
        assert!(scanned(&res) && res.audit.contains_key("findings"), "{:?}", res.audit);
    }
    assert!(t.exists("victim/2024/keep.txt"));
    assert!(t.exists(&format!("victim/1/{OLD_CLAIM}")));
    let names: Vec<String> = std::fs::read_dir(&victim).unwrap().map(|e| e.unwrap().file_name().into_string().unwrap()).collect();
    assert_eq!(names.len(), 2, "{names:?}");
}

/// A root other users can write to is not trusted either.
#[test]
#[cfg(unix)]
fn a_group_or_world_writable_claim_root_is_not_used() {
    use std::os::unix::fs::PermissionsExt;
    let t = Tmp::new();
    let cwd = t.path();
    let file = t.write("src/card.css", SIDE_TAB_CSS);
    let root = jsp::join(&[&cwd, "claims"]);
    std::fs::create_dir(&root).unwrap();
    std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o777)).unwrap();
    let stdin = claude_post_tool_use(&cwd, &file, "toolu_open");
    for _ in 0..2 {
        let res = hook::run_hook(&rt_with(&cwd, claim_env(&t, &[])), &stdin);
        assert!(scanned(&res), "{:?}", res.audit);
    }
    assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
}

/// The sweep removes only old `<digits>/` buckets and only `<64 hex>` claim
/// files in them. Foreign names, foreign files and symlinks stay.
#[test]
fn the_sweep_removes_only_its_own_old_buckets_and_claims() {
    let t = Tmp::new();
    let cwd = t.path();
    let file = t.write("src/card.css", SIDE_TAB_CSS);
    let root = jsp::join(&[&cwd, "claims"]);
    t.write(&format!("claims/2/{OLD_CLAIM}"), "");
    t.write(&format!("claims/1/{OLD_CLAIM}"), "");
    t.write("claims/1/readme.txt", "not ours");
    t.write("claims/notes/todo.txt", "not ours");
    t.write(&format!("outside/{OLD_CLAIM}"), "");
    #[cfg(unix)]
    std::os::unix::fs::symlink(jsp::join(&[&cwd, "outside"]), jsp::join(&[&root, "3"])).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for d in ["claims", "claims/1", "claims/2", "claims/notes"] {
            std::fs::set_permissions(jsp::join(&[&cwd, d]), std::fs::Permissions::from_mode(0o700)).unwrap();
        }
    }

    let res = hook::run_hook(&rt_with(&cwd, claim_env(&t, &[])), &claude_post_tool_use(&cwd, &file, "toolu_sweep"));
    assert!(scanned(&res), "{:?}", res.audit);

    assert!(!t.exists("claims/2"), "an old bucket of claims only is removed");
    assert!(t.exists("claims/1/readme.txt") && !t.exists(&format!("claims/1/{OLD_CLAIM}")));
    assert!(t.exists("claims/notes/todo.txt"));
    assert!(t.exists(&format!("outside/{OLD_CLAIM}")), "a symlinked bucket is not followed");
    // And the normal path still dedupes.
    let again = hook::run_hook(&rt_with(&cwd, claim_env(&t, &[])), &claude_post_tool_use(&cwd, &file, "toolu_sweep"));
    assert!(!scanned(&again), "{:?}", again.audit);
}

/// Without an override the claims sit under the user's home, not in the
/// shared temp dir.
#[test]
fn claims_default_to_the_users_home() {
    let t = Tmp::new();
    let cwd = t.path();
    let file = t.write("src/card.css", SIDE_TAB_CSS);
    let home = jsp::join(&[&cwd, "home"]);
    std::fs::create_dir(&home).unwrap();
    let e = env(&[("HOME", &home), ("USERPROFILE", &home)]);
    let stdin = claude_post_tool_use(&cwd, &file, "toolu_home");
    let first = hook::run_hook(&rt_with(&cwd, e.clone()), &stdin);
    let second = hook::run_hook(&rt_with(&cwd, e.clone()), &stdin);
    assert!(scanned(&first) && !scanned(&second));
    assert!(t.exists("home/.impeccable/hook-claims"));
}

/// The first edit in a fresh home: concurrent hooks race to create
/// `~/.impeccable`, and the loser must still claim rather than scan.
#[test]
fn concurrent_first_edits_in_a_fresh_home_scan_once() {
    for round in 0..8 {
        let t = Tmp::new();
        let cwd = t.path();
        let file = t.write("src/card.css", SIDE_TAB_CSS);
        let home = jsp::join(&[&cwd, "home"]);
        std::fs::create_dir(&home).unwrap();
        let e = env(&[("HOME", &home), ("USERPROFILE", &home)]);
        let stdin = claude_post_tool_use(&cwd, &file, "toolu_fresh");
        let barrier = std::sync::Barrier::new(4);
        let scans = std::thread::scope(|s| {
            let handles: Vec<_> = (0..4)
                .map(|_| s.spawn(|| { barrier.wait(); scanned(&hook::run_hook(&rt_with(&cwd, e.clone()), &stdin)) }))
                .collect();
            handles.into_iter().map(|h| h.join().unwrap()).filter(|scanned| *scanned).count()
        });
        assert_eq!(scans, 1, "round {round}");
    }
}

// ─── Session root index: Stop from a cwd above the project (#1101) ───────────

/// A temp HOME under the fixture, so the index never touches the real one.
fn home_env(t: &Tmp) -> HashMap<String, String> {
    let home = jsp::join(&[&t.path(), "home"]);
    std::fs::create_dir_all(&home).unwrap();
    env(&[("HOME", &home), ("USERPROFILE", &home)])
}

fn index_dir(t: &Tmp) -> String {
    jsp::join(&[&t.path(), "home", ".impeccable", "hook-sessions"])
}

fn names_in(dir: &str) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .map(|it| it.map(|e| e.unwrap().file_name().into_string().unwrap()).collect())
        .unwrap_or_default();
    names.sort();
    names
}

fn umbrella(t: &Tmp, projects: &[(&str, &str)]) -> (String, Vec<String>) {
    let files = projects
        .iter()
        .map(|(name, css)| {
            t.write(&format!("work/{name}/package.json"), "{}");
            t.write(&format!("work/{name}/src/a.css"), css)
        })
        .collect();
    (jsp::join(&[&t.path(), "work"]), files)
}

#[test]
fn stop_from_an_umbrella_cwd_finds_the_project_below_it() {
    let t = Tmp::new();
    let e = home_env(&t);
    let (work, files) = umbrella(&t, &[("site", SIDE_TAB_CSS)]);
    let edit = hook::run_hook(&rt_with(&work, e.clone()), &edit_event(&work, &files[0], "p1"));
    let site = jsp::join(&[&work, "site"]);
    assert_eq!(audit_str(&edit.audit, "cwd"), Some(site.as_str()));
    let stop = hook::run_stop_hook(&rt_with(&work, e.clone()), &stop_event(&work, "p1"));
    assert!(stop.stdout.contains("[side-tab]"), "{} {:?}", stop.stdout, stop.audit);
    assert_eq!(audit_str(&stop.audit, "cwd"), Some(site.as_str()));
    assert!(stop.audit.get("roots").is_none(), "{:?}", stop.audit);
    // Nothing lands in the umbrella folder itself (#346).
    assert!(!t.exists("work/.impeccable"));
    // The second Stop has nothing new to say.
    let again = hook::run_stop_hook(&rt_with(&work, e.clone()), &stop_event(&work, "p1"));
    assert_eq!(again.stdout, "", "{:?}", again.audit);
    assert_eq!(audit_str(&again.audit, "skipped"), Some("stop-clean"));
    // Another session's Stop does not see this session's roots.
    let other = hook::run_stop_hook(&rt_with(&work, e), &stop_event(&work, "p2"));
    assert_eq!(audit_str(&other.audit, "skipped"), Some("no-touched-files"));
}

#[test]
fn stop_reports_every_project_the_session_edited_within_the_caps() {
    let t = Tmp::new();
    let e = home_env(&t);
    let (work, files) = umbrella(&t, &[("app", SIDE_TAB_CSS), ("site", SIDE_TAB_CSS)]);
    for file in &files {
        hook::run_hook(&rt_with(&work, e.clone()), &edit_event(&work, file, "p1"));
    }
    let stop = hook::run_stop_hook(&rt_with(&work, e.clone()), &stop_event(&work, "p1"));
    assert!(stop.stdout.contains("app/src/a.css"), "{}", stop.stdout);
    assert!(stop.stdout.contains("site/src/a.css"), "{}", stop.stdout);
    assert_eq!(stop.audit["roots"], 2);
    assert_eq!(stop.audit["freshFiles"], 2);
    assert!(!t.exists("work/.impeccable"));
    let again = hook::run_stop_hook(&rt_with(&work, e.clone()), &stop_event(&work, "p1"));
    assert_eq!(again.stdout, "", "{:?}", again.audit);

    // The lead project's caps bound the combined output.
    let t = Tmp::new();
    let e = home_env(&t);
    let (work, files) = umbrella(&t, &[("app", SIDE_TAB_CSS), ("site", SIDE_TAB_CSS)]);
    t.write("work/app/.impeccable/config.json", r#"{"hook":{"limits":{"maxFindings":1}}}"#);
    for file in &files {
        hook::run_hook(&rt_with(&work, e.clone()), &edit_event(&work, file, "p1"));
    }
    let stop = hook::run_stop_hook(&rt_with(&work, e.clone()), &stop_event(&work, "p1"));
    let finding_lines = stop.stdout.matches("[side-tab]").count();
    assert_eq!(finding_lines, 1, "{}", stop.stdout);
    assert!(stop.stdout.contains("more in site/src/a.css"), "{}", stop.stdout);
    // Both projects remembered what this Stop saw: the next is silent.
    let again = hook::run_stop_hook(&rt_with(&work, e), &stop_event(&work, "p1"));
    assert_eq!(again.stdout, "", "{:?}", again.audit);
}

#[test]
fn a_disabled_or_native_project_drops_out_and_the_other_still_reports() {
    let t = Tmp::new();
    let e = home_env(&t);
    let (work, files) = umbrella(&t, &[("app", SIDE_TAB_CSS), ("site", SIDE_TAB_CSS)]);
    for file in &files {
        hook::run_hook(&rt_with(&work, e.clone()), &edit_event(&work, file, "p1"));
    }
    t.write("work/app/.impeccable/config.json", r#"{"hook":{"enabled":false}}"#);
    let stop = hook::run_stop_hook(&rt_with(&work, e.clone()), &stop_event(&work, "p1"));
    assert!(stop.stdout.contains("[side-tab]"), "{}", stop.stdout);
    assert!(!stop.stdout.contains("app/src"), "{}", stop.stdout);
    assert_eq!(audit_str(&stop.audit, "cwd"), Some(jsp::join(&[&work, "site"]).as_str()));
}

#[test]
fn without_a_session_id_stop_walks_up_as_before_and_records_nothing() {
    let t = Tmp::new();
    let e = home_env(&t);
    let (work, files) = umbrella(&t, &[("site", SIDE_TAB_CSS)]);
    let edit = json!({ "cwd": work, "hook_event_name": "PostToolUse", "tool_name": "Edit",
        "tool_input": { "file_path": files[0] } }).to_string();
    hook::run_hook(&rt_with(&work, e.clone()), &edit);
    assert!(!std::path::Path::new(&index_dir(&t)).exists());
    let stop = json!({ "cwd": work, "hook_event_name": "Stop", "stop_hook_active": false }).to_string();
    let res = hook::run_stop_hook(&rt_with(&work, e.clone()), &stop);
    assert_eq!(audit_str(&res.audit, "skipped"), Some("no-touched-files"));
    // From the project itself the walk still finds it.
    let site = jsp::join(&[&work, "site"]);
    let stop = json!({ "cwd": site, "hook_event_name": "Stop", "stop_hook_active": false }).to_string();
    let res = hook::run_stop_hook(&rt_with(&site, e), &stop);
    assert!(res.stdout.contains("[side-tab]"), "{:?}", res.audit);
}

#[test]
fn without_a_usable_home_stop_walks_up_as_before() {
    let t = Tmp::new();
    let (work, files) = umbrella(&t, &[("site", SIDE_TAB_CSS)]);
    hook::run_hook(&rt(&work), &edit_event(&work, &files[0], "p1"));
    let res = hook::run_stop_hook(&rt(&work), &stop_event(&work, "p1"));
    assert_eq!(audit_str(&res.audit, "skipped"), Some("no-touched-files"));
}

/// An index root that is a symlink is never followed: nothing is created or
/// removed behind it, and Stop falls back to the walk up.
#[test]
#[cfg(unix)]
fn a_symlinked_index_root_is_never_followed() {
    let t = Tmp::new();
    let e = home_env(&t);
    let (work, files) = umbrella(&t, &[("site", SIDE_TAB_CSS)]);
    let victim = jsp::join(&[&t.path(), "victim"]);
    t.write(&format!("victim/{OLD_CLAIM}/{OLD_CLAIM}"), &work);
    t.write("home/.impeccable/keep.txt", "");
    std::os::unix::fs::symlink(&victim, index_dir(&t)).unwrap();
    hook::run_hook(&rt_with(&work, e.clone()), &edit_event(&work, &files[0], "p1"));
    let res = hook::run_stop_hook(&rt_with(&work, e), &stop_event(&work, "p1"));
    assert_eq!(audit_str(&res.audit, "skipped"), Some("no-touched-files"));
    assert_eq!(names_in(&victim), vec![OLD_CLAIM.to_string()]);
    assert_eq!(names_in(&jsp::join(&[&victim, OLD_CLAIM])), vec![OLD_CLAIM.to_string()]);
}

/// A root other users can write to is not trusted, for writing or reading.
#[test]
#[cfg(unix)]
fn a_group_or_world_writable_index_root_is_not_used() {
    use std::os::unix::fs::PermissionsExt;
    let t = Tmp::new();
    let e = home_env(&t);
    let (work, files) = umbrella(&t, &[("site", SIDE_TAB_CSS)]);
    let root = index_dir(&t);
    std::fs::create_dir_all(&root).unwrap();
    std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o777)).unwrap();
    hook::run_hook(&rt_with(&work, e.clone()), &edit_event(&work, &files[0], "p1"));
    assert!(names_in(&root).is_empty());
    // A record planted under it is not read either.
    let site = jsp::join(&[&work, "site"]);
    let planted = jsp::join(&[&root, &sha256("p1"), &sha256(&site)]);
    std::fs::create_dir_all(std::path::Path::new(&planted).parent().unwrap()).unwrap();
    std::fs::write(&planted, &site).unwrap();
    let res = hook::run_stop_hook(&rt_with(&work, e), &stop_event(&work, "p1"));
    assert_eq!(audit_str(&res.audit, "skipped"), Some("no-touched-files"));
}

fn sha256(s: &str) -> String {
    use sha2::Digest;
    sha2::Sha256::digest(s.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

/// A record whose content does not hash to its name (a partial write, or a
/// file that is not ours) is ignored.
#[test]
#[cfg(unix)]
fn a_record_that_does_not_hash_to_its_name_is_ignored() {
    let t = Tmp::new();
    let e = home_env(&t);
    let (work, files) = umbrella(&t, &[("site", SIDE_TAB_CSS)]);
    hook::run_hook(&rt_with(&work, e.clone()), &edit_event(&work, &files[0], "p1"));
    let session_dir = jsp::join(&[&index_dir(&t), &sha256("p1")]);
    let site = jsp::join(&[&work, "site"]);
    let record = jsp::join(&[&session_dir, &sha256(&site)]);
    assert_eq!(std::fs::read_to_string(&record).unwrap(), site);
    std::fs::write(&record, "/elsewhere").unwrap();
    let res = hook::run_stop_hook(&rt_with(&work, e), &stop_event(&work, "p1"));
    assert_eq!(audit_str(&res.audit, "skipped"), Some("no-touched-files"));
}

#[test]
fn parallel_first_edits_record_each_root_once() {
    let t = Tmp::new();
    let e = home_env(&t);
    let roots = [jsp::join(&[&t.path(), "work", "a"]), jsp::join(&[&t.path(), "work", "b"])];
    std::thread::scope(|s| {
        for i in 0..16 {
            let (e, root) = (e.clone(), roots[i % 2].clone());
            let cwd = t.path();
            s.spawn(move || impeccable_hook::hook_sessions::record_root(&rt_with(&cwd, e), "p1", &root));
        }
    });
    for root in &roots {
        std::fs::create_dir_all(root).unwrap();
    }
    let session_dir = jsp::join(&[&index_dir(&t), &sha256("p1")]);
    let mut expected: Vec<String> = roots.iter().map(|r| sha256(r)).collect();
    expected.sort();
    assert_eq!(names_in(&session_dir), expected);
    let r = rt_with(&t.path(), e);
    let mut recorded = impeccable_hook::hook_sessions::recorded_roots(&r, "p1");
    recorded.sort();
    assert_eq!(recorded, roots.to_vec());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for dir in [index_dir(&t), session_dir.clone()] {
            assert_eq!(std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777, 0o700, "{dir}");
        }
        let file = jsp::join(&[&session_dir, &sha256(&roots[0])]);
        assert_eq!(std::fs::metadata(&file).unwrap().permissions().mode() & 0o777, 0o600);
    }
}

/// Session ids and roots become 64-hex names whatever characters they hold,
/// so a Windows path or an id with `:` or `/` is a valid file name.
#[test]
fn index_names_are_safe_on_every_file_system() {
    let t = Tmp::new();
    let e = home_env(&t);
    let r = rt_with(&t.path(), e);
    let root = jsp::join(&[&t.path(), "proj"]);
    std::fs::create_dir_all(&root).unwrap();
    let session = r"a/b:c*?<>|\d";
    impeccable_hook::hook_sessions::record_root(&r, session, &root);
    // A recorded root that no longer exists is not returned.
    impeccable_hook::hook_sessions::record_root(&r, session, &jsp::join(&[&t.path(), "gone"]));
    let sessions = names_in(&index_dir(&t));
    assert_eq!(sessions.len(), 1);
    let records = names_in(&jsp::join(&[&index_dir(&t), &sessions[0]]));
    for name in sessions.iter().chain(&records) {
        assert!(name.len() == 64 && name.bytes().all(|b| b.is_ascii_hexdigit()), "{name}");
    }
    assert_eq!(impeccable_hook::hook_sessions::recorded_roots(&r, session), vec![root]);
    // A relative root is not recorded.
    impeccable_hook::hook_sessions::record_root(&r, "p2", "relative/dir");
    assert_eq!(names_in(&index_dir(&t)).len(), 1);
}

/// A new session sweeps session dirs untouched for the expiry window. It
/// removes only `<64 hex>` dirs and `<64 hex>` files in them: foreign names,
/// foreign files, fresh sessions and symlinks stay.
#[test]
#[cfg(unix)]
fn expiry_removes_only_old_session_dirs_of_ours() {
    use std::os::unix::fs::PermissionsExt;
    let t = Tmp::new();
    let e = home_env(&t);
    let root = index_dir(&t);
    let old_a = "a".repeat(64);
    let old_b = "b".repeat(64);
    let fresh = "c".repeat(64);
    let linked = "d".repeat(64);
    t.write(&format!("home/.impeccable/hook-sessions/{old_a}/{OLD_CLAIM}"), "/x");
    t.write(&format!("home/.impeccable/hook-sessions/{old_b}/{OLD_CLAIM}"), "/x");
    t.write(&format!("home/.impeccable/hook-sessions/{old_b}/notes.txt"), "not ours");
    t.write(&format!("home/.impeccable/hook-sessions/{fresh}/{OLD_CLAIM}"), "/x");
    t.write("home/.impeccable/hook-sessions/keep-me/x", "not ours");
    t.write(&format!("outside/{OLD_CLAIM}"), "/x");
    std::os::unix::fs::symlink(jsp::join(&[&t.path(), "outside"]), jsp::join(&[&root, &linked])).unwrap();
    for d in [root.clone(), jsp::join(&[&root, &old_a]), jsp::join(&[&root, &old_b]), jsp::join(&[&root, &fresh]), jsp::join(&[&root, "keep-me"])] {
        std::fs::set_permissions(&d, std::fs::Permissions::from_mode(0o700)).unwrap();
    }
    let long_ago = std::time::SystemTime::now()
        - std::time::Duration::from_secs(impeccable_hook::hook_sessions::EXPIRE_SECONDS + 3600);
    for d in [&old_a, &old_b, &"keep-me".to_string()] {
        std::fs::File::open(jsp::join(&[&root, d])).unwrap().set_modified(long_ago).unwrap();
    }
    impeccable_hook::hook_sessions::record_root(&rt_with(&t.path(), e), "new-session", &jsp::join(&[&t.path(), "p"]));
    let names = names_in(&root);
    assert!(!names.contains(&old_a), "{names:?}");
    assert!(names.contains(&old_b) && names.contains(&fresh) && names.contains(&linked), "{names:?}");
    assert!(names.contains(&"keep-me".to_string()) && names.contains(&sha256("new-session")), "{names:?}");
    assert_eq!(names_in(&jsp::join(&[&root, &old_b])), vec!["notes.txt".to_string()]);
    assert_eq!(names_in(&jsp::join(&[&root, &fresh])), vec![OLD_CLAIM.to_string()]);
    assert!(t.exists(&format!("outside/{OLD_CLAIM}")));
    assert!(t.exists("home/.impeccable/hook-sessions/keep-me/x"));
}
