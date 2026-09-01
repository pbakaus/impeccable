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

use impeccable_common::Io;
use impeccable_core::findings::{finding, Finding};
use impeccable_detect::MissingHtmlEngine;
use impeccable_hook::hook_lib::*;
use impeccable_hook::{admin, before_edit, hook};
use serde_json::{json, Map, Value};

static HTML: MissingHtmlEngine = MissingHtmlEngine;

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
        Tmp(std::fs::canonicalize(&base).unwrap())
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
    remember_findings(&mut cache, "s", "/x/a.tsx", &[g.clone()]);
    assert!(persist_cache(&r, &cwd, &cache));
    let back = read_cache(&cwd);
    let entry = &back["sessions"]["s"]["files"]["/x/a.tsx"];
    assert_eq!(entry["editCount"], json!(2));
    assert_eq!(entry["findings"], json!(["gradient-text:3"]));
    let mut cache2 = back.clone();
    assert!(dedupe_against_cache(&[g.clone()], &mut cache2, "s", "/x/a.tsx").is_empty());
    // same-line value-specific findings stay distinct
    let mut a = f("overused-font", 1.0, "O", "d", "font-family: Inter");
    a.extras.insert("ignoreValue".into(), json!("Inter"));
    let mut b = a.clone();
    b.extras.insert("ignoreValue".into(), json!("Roboto"));
    assert_ne!(finding_cache_key(&a), finding_cache_key(&b));
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
    assert!(text.contains("Run `'/opt/bin/impeccable' hooks ignore-value <rule> \"<value>\" --reason \"<who decided: evidence>\"`"));
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
    assert!(hostile.contains("ignore-value overused-font '$(touch pwned)'"));
    let no_hint = {
        let mut x = f("side-tab", 1.0, "Side tab", "d", "s");
        x.extras.insert("ignoreValue".into(), json!("Inter"));
        render_template(&r, &[x], "/x/a.tsx", &c, &opts("/x"))
    };
    assert!(!no_hint.contains("ignore-value side-tab"));
    // platform quoting (#476 / #533)
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
        vec!["/p/a.css", "/abs/b.css"]
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
        assert!(out.contains(&format!("{cwd}/{name}")), "{name} in {out:?}");
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
        cache["sessions"]["s1"]["files"][format!("{cwd}/src/styles.css")]["editCount"],
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
        cache["sessions"]["cv1"]["files"][format!("{cwd}/src/new.css")]["cursorDenials"]
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
        "Added overused-font=inter to shared detector.ignoreValues (.impeccable/config.json).\n"
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
    assert_eq!(out, "Added design-system-font-size=* scoped to src/a.js, src/z.js to local detector.ignoreValues (.impeccable/config.local.json).\n");
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
    assert_eq!(out, "Reset design hook config and cache (removed: .impeccable/config.json, .impeccable/config.local.json).\n");
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
        "Design hook disabled for this project (wrote .impeccable/config.json).\n"
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
    assert_eq!(out, "Design hook enabled for this project (wrote .impeccable/config.json). Recorded local hook consent in .impeccable/config.local.json. Installed or repaired hook manifests for: .github.\n");
    assert!(t
        .read(".github/hooks/impeccable.json")
        .contains("\"matcher\": \"edit|create|apply_patch\""));
    let (out, _, _) = admin_run(&r, &["on"]);
    assert!(out.ends_with("Hook manifests already installed for: .github.\n"));
    let (out, _, _) = admin_run(&r, &["status"]);
    assert!(out.contains("state:        enabled\n"));
    assert!(out.contains("local file:   .impeccable/config.local.json\n"));
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
    assert_eq!(entry["commandWindows"], json!("\".agents/skills/impeccable/scripts/impeccable.cmd\" hook"));
    assert_eq!(
        entry.as_object().unwrap().keys().cloned().collect::<Vec<_>>(),
        vec!["type", "command", "commandWindows", "timeout", "statusMessage"]
    );
    let stop = &codex["hooks"]["Stop"][0]["hooks"][0];
    assert_eq!(stop["command"], json!("\".agents/skills/impeccable/scripts/impeccable\" hook"));
    assert_eq!(stop["commandWindows"], json!("\".agents/skills/impeccable/scripts/impeccable.cmd\" hook"));
    assert_eq!(stop["timeout"], json!(30));

    let cursor: Value = serde_json::from_str(&t.read(".cursor/hooks.json")).unwrap();
    assert_eq!(
        cursor["hooks"]["preToolUse"][0]["command"],
        json!("\".cursor/skills/impeccable/scripts/impeccable\" hook-before-edit")
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
        json!("\".agents/skills/impeccable/scripts/impeccable.cmd\" hook")
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
