//! `detect --before` / `--kept` (#1291): the wiring inventory the static
//! engine reads, and the CLI that saves and compares it.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use impeccable_common::Io;
use impeccable_detect::cli::run_detect;
use impeccable_detect::wiring::{inventory_path, short_hash};
use impeccable_detect::Engines;
use impeccable_html::wiring::wiring_inventory_source;
use impeccable_html::StaticHtmlEngine;
use serde_json::Value;

fn fixture(name: &str) -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/wiring").join(name);
    std::fs::read_to_string(path).unwrap()
}

static SEQ: AtomicUsize = AtomicUsize::new(0);

/// A fresh temp project per test, so parallel tests never share one.
fn project() -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "impeccable-wiring-{}-{}",
        std::process::id(),
        SEQ.fetch_add(1, Ordering::SeqCst)
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("package.json"), "{}\n").unwrap();
    dir
}

fn run(dir: &Path, args: &[&str]) -> (i32, String, String) {
    let args: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    let (mut io, cap) = Io::captured("", dir.to_path_buf(), HashMap::new());
    let html = StaticHtmlEngine::default();
    let engines = Engines { html: &html, url: None };
    let code = run_detect(&args, &mut io, &engines);
    let out = String::from_utf8(cap.stdout.borrow().clone()).unwrap();
    let err = String::from_utf8(cap.stderr.borrow().clone()).unwrap();
    (code, out, err)
}

#[test]
fn the_inventory_lists_every_kind_of_wiring() {
    let inv = wiring_inventory_source(&fixture("before.html"));
    let inline = short_hash("window.dataLayer = window.dataLayer || [];");
    let handler = short_hash("track('signup')");
    let expected: Vec<String> = vec![
        "button type=\"submit\"".to_string(),
        "field input name=\"csrf\" type=\"hidden\"".to_string(),
        "field input name=\"email\" type=\"email\" required".to_string(),
        "field input name=\"terms\" type=\"checkbox\" value=\"yes\" required".to_string(),
        "field select name=\"plan\"".to_string(),
        "field textarea name=\"note\"".to_string(),
        "form action=\"/signup\" method=\"post\"".to_string(),
        format!("handler button onclick #{handler}"),
        "id \"email\"".to_string(),
        "id \"main\"".to_string(),
        "label for=\"email\"".to_string(),
        "link href=\"/\"".to_string(),
        "link href=\"/\"".to_string(),
        "link href=\"/pricing\"".to_string(),
        format!("script inline #{inline}"),
        "script src=\"/js/analytics.js\"".to_string(),
        "test-hook data-cy=\"note\"".to_string(),
        "test-hook data-qa=\"footer-home\"".to_string(),
        "test-hook data-testid=\"signup-form\"".to_string(),
    ];
    assert_eq!(inv.wiring, expected);
    assert_eq!(
        inv.content,
        vec![
            "heading h1 \"Start your trial\"".to_string(),
            "heading h2 \"Questions?\"".to_string(),
            "image alt=\"Acme logo\"".to_string(),
        ]
    );
}

#[test]
fn template_content_counts_once() {
    let inv = wiring_inventory_source(
        "<div id=\"app\"></div><template id=\"row\"><a href=\"/x\" data-testid=\"row-link\" onclick=\"go()\">x</a></template>",
    );
    let hash = short_hash("go()");
    assert_eq!(
        inv.wiring,
        vec![
            format!("handler a onclick #{hash}"),
            "id \"app\"".to_string(),
            "id \"row\"".to_string(),
            "link href=\"/x\"".to_string(),
            "test-hook data-testid=\"row-link\"".to_string(),
        ]
    );
}

/// Review (Greptile): `getByTestId("save")` and `#save` stop matching when
/// the value gains a space, so exact-lookup values are kept untrimmed.
#[test]
fn lookup_values_are_kept_exactly() {
    for (a, b) in [
        ("<b data-testid=\"save\"></b>", "<b data-testid=\"save \"></b>"),
        ("<b id=\"save\"></b>", "<b id=\" save\"></b>"),
        ("<label for=\"save\"></label>", "<label for=\"save \"></label>"),
    ] {
        assert_ne!(wiring_inventory_source(a), wiring_inventory_source(b), "{a} vs {b}");
    }
}

/// Review (Greptile): `--kept` dropped the saved `target`, so an inventory
/// recorded for another page was compared as if it were this one.
#[test]
fn an_inventory_for_another_target_is_not_compared() {
    let dir = project();
    std::fs::write(dir.join("page.html"), fixture("before.html")).unwrap();
    assert_eq!(run(&dir, &["--before", "page.html"]).0, 0);
    let saved = dir.join(inventory_path("page.html"));
    let text = std::fs::read_to_string(&saved).unwrap();
    std::fs::write(&saved, text.replace("\"target\": \"page.html\"", "\"target\": \"other.html\"")).unwrap();
    let (code, out, err) = run(&dir, &["--kept", "page.html"]);
    assert_eq!(code, 2, "{err}");
    assert!(out.is_empty(), "{out}");
    assert!(err.contains("records other.html, not page.html"), "{err}");
    let (code, out, _) = run(&dir, &["--kept", "--json", "page.html"]);
    assert_eq!(code, 2);
    let v: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["targets"][0]["status"], "bad-inventory");
    let _ = std::fs::remove_dir_all(&dir);
}

/// `--scope` and `--viewport` are validated before the wiring branch (as for
/// every detect run) but change nothing in the inventory.
#[test]
fn scope_and_viewport_are_validated_but_inert() {
    let dir = project();
    std::fs::write(dir.join("page.html"), fixture("before.html")).unwrap();
    let (code, _, err) = run(&dir, &["--before", "--scope=bogus", "page.html"]);
    assert_eq!(code, 1);
    assert!(err.starts_with("Error: unknown --scope value(s): bogus."), "{err}");
    let (code, _, err) = run(&dir, &["--before", "--viewport", "nope", "page.html"]);
    assert_eq!(code, 1);
    assert!(err.starts_with("Error: --viewport requires a WxH value"), "{err}");
    let (code, _, err) = run(&dir, &["--before", "--scope", "type", "--viewport", "390x844", "page.html"]);
    assert_eq!(code, 0, "{err}");
    assert!(err.contains("(19 wiring items, 3 content items)"), "{err}");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn defaults_case_and_whitespace_are_not_changes() {
    let a = wiring_inventory_source("<form><input name=q><button onclick=\"go()\">Go</button></form><script>a();</script>");
    let b = wiring_inventory_source(
        "<form method=GET><input name=q type=TEXT><button type=submit onclick=\"  go()\n\">Go</button></form><script>\n  a();\n</script>",
    );
    assert_eq!(a, b);
}

#[test]
fn before_saves_a_self_ignored_inventory() {
    let dir = project();
    std::fs::write(dir.join("page.html"), fixture("before.html")).unwrap();
    let (code, out, err) = run(&dir, &["--before", "page.html"]);
    assert_eq!(code, 0, "{err}");
    assert!(out.is_empty(), "{out}");
    let saved = inventory_path("page.html");
    assert!(saved.starts_with(".impeccable/wiring/page-html-"), "{saved}");
    assert_eq!(
        err,
        format!("Saved the wiring of page.html to {saved} (19 wiring items, 3 content items).\n")
    );
    let file: Value = serde_json::from_str(&std::fs::read_to_string(dir.join(&saved)).unwrap()).unwrap();
    assert_eq!(file["version"], 1);
    assert_eq!(file["target"], "page.html");
    assert_eq!(file["wiring"].as_array().unwrap().len(), 19);
    let ignore = std::fs::read_to_string(dir.join(".impeccable/wiring/.gitignore")).unwrap();
    assert!(ignore.lines().any(|l| l == "*"), "{ignore}");

    // `./page.html` and the absolute path name the same inventory.
    let abs = dir.join("page.html").to_string_lossy().into_owned();
    let (code, _, err) = run(&dir, &["--kept", "./page.html", &abs]);
    assert_eq!(code, 0, "{err}");
    assert_eq!(err.matches("page.html: wiring kept (19 items).").count(), 2, "{err}");
    assert!(err.ends_with("\nWiring kept in 2 files.\n"), "{err}");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn kept_fails_on_missing_wiring_and_lists_new_items() {
    let dir = project();
    std::fs::write(dir.join("page.html"), fixture("before.html")).unwrap();
    assert_eq!(run(&dir, &["--before", "page.html"]).0, 0);
    std::fs::write(dir.join("page.html"), fixture("after.html")).unwrap();
    let (code, out, err) = run(&dir, &["--kept", "page.html"]);
    assert_eq!(code, 1, "{err}");
    assert!(out.is_empty(), "{out}");
    assert!(err.starts_with("page.html: 5 wiring items missing of 19, 4 new.\n"), "{err}");
    assert!(err.contains("  MISSING  field input name=\"email\" type=\"email\" required\n"), "{err}");
    assert!(err.contains("  MISSING  field input name=\"csrf\" type=\"hidden\"\n"), "{err}");
    assert!(err.contains("  MISSING  link href=\"/\"\n"), "{err}");
    assert!(err.contains("  NEW      field input name=\"mail\" type=\"email\" required\n"), "{err}");
    assert!(err.contains("    gone   heading h1 \"Start your trial\"\n"), "{err}");
    assert!(err.contains("Justify each one in the handoff"), "{err}");
    assert!(err.ends_with("\nWiring check failed: 5 items missing in 1 of 1 file.\n"), "{err}");

    let (code, out, err) = run(&dir, &["--kept", "--json", "page.html"]);
    assert_eq!(code, 1, "{err}");
    assert!(err.is_empty(), "{err}");
    let v: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["mode"], "kept");
    assert_eq!(v["ok"], false);
    let t = &v["targets"][0];
    assert_eq!(t["file"], "page.html");
    assert_eq!(t["status"], "missing");
    assert_eq!(t["wiring"]["before"], 19);
    assert_eq!(t["wiring"]["after"], 18);
    assert_eq!(t["missing"].as_array().unwrap().len(), 5);
    assert_eq!(t["new"].as_array().unwrap().len(), 4);
    assert_eq!(t["content"]["new"][0], "heading h1 \"Start your free trial\"");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn kept_without_an_inventory_exits_2() {
    let dir = project();
    std::fs::write(dir.join("page.html"), fixture("before.html")).unwrap();
    std::fs::write(dir.join("other.html"), fixture("before.html")).unwrap();
    let (code, _, err) = run(&dir, &["--kept", "page.html"]);
    assert_eq!(code, 2);
    assert_eq!(err, "Error: no saved wiring for page.html; run detect --before page.html first\n");

    // A file that lost wiring and one with no inventory: 2 wins.
    assert_eq!(run(&dir, &["--before", "other.html"]).0, 0);
    std::fs::write(dir.join("other.html"), fixture("after.html")).unwrap();
    let (code, out, _) = run(&dir, &["--kept", "--json", "other.html", "page.html"]);
    assert_eq!(code, 2);
    let v: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["targets"][0]["status"], "missing");
    assert_eq!(v["targets"][1]["status"], "no-inventory");

    // An inventory from another schema version is not compared.
    std::fs::write(dir.join(inventory_path("other.html")), "{\"version\": 99}").unwrap();
    let (code, _, err) = run(&dir, &["--kept", "other.html"]);
    assert_eq!(code, 2);
    assert!(err.contains("has schema version 99"), "{err}");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn before_json_and_unsupported_targets() {
    let dir = project();
    std::fs::write(dir.join("page.html"), fixture("before.html")).unwrap();
    std::fs::write(dir.join("App.tsx"), "export default () => null;\n").unwrap();
    let (code, out, _) = run(&dir, &["--before", "--json", "page.html"]);
    assert_eq!(code, 0);
    let v: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["mode"], "before");
    assert_eq!(v["targets"][0]["status"], "saved");
    assert_eq!(v["targets"][0]["wiring"], 19);
    assert_eq!(v["targets"][0]["content"], 3);

    let (code, _, err) = run(&dir, &["--before", "App.tsx", "missing.html", "https://example.com", "."]);
    assert_eq!(code, 1);
    assert!(err.contains("Error: cannot record the wiring of App.tsx: only static .html and .htm files are inventoried\n"), "{err}");
    assert!(err.contains("Error: cannot record the wiring of missing.html: ENOENT"), "{err}");
    assert!(err.contains("https://example.com: URL targets are not supported yet"), "{err}");
    assert!(err.contains("Error: cannot record the wiring of .: it is a directory"), "{err}");

    // --kept refuses the same targets before it looks for an inventory.
    let (code, out, _) = run(&dir, &["--kept", "--json", "App.tsx", "https://example.com"]);
    assert_eq!(code, 2);
    let v: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["targets"][0]["file"], "App.tsx");
    assert_eq!(v["targets"][0]["status"], "error");
    assert_eq!(v["targets"][1]["file"], "https://example.com");
    let (code, _, err) = run(&dir, &["--kept", "."]);
    assert_eq!(code, 2);
    assert_eq!(err, "Error: cannot read the wiring of .: it is a directory; pass each .html file\n");

    let (code, _, err) = run(&dir, &["--before"]);
    assert_eq!(code, 1);
    assert!(err.starts_with("Error: --before needs one or more local .html files"), "{err}");
    let (code, _, err) = run(&dir, &["--before", "--kept", "page.html"]);
    assert_eq!(code, 1);
    assert_eq!(err, "Error: --before works on local HTML files and cannot be used with --kept\n");
    let (code, _, err) = run(&dir, &["--kept", "--github", "page.html"]);
    assert_eq!(code, 1);
    assert!(err.contains("cannot be used with --github"), "{err}");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_subdirectory_shares_the_project_inventory() {
    let dir = project();
    std::fs::create_dir_all(dir.join("web")).unwrap();
    std::fs::write(dir.join("web/page.html"), fixture("before.html")).unwrap();
    // Recorded from the project root, checked from the subdirectory.
    let (code, _, err) = run(&dir, &["--before", "web/page.html"]);
    assert_eq!(code, 0, "{err}");
    let saved = inventory_path("web/page.html");
    assert!(err.contains(&format!("Saved the wiring of web/page.html to {saved} ")), "{err}");
    assert!(dir.join(&saved).is_file());
    let (code, _, err) = run(&dir.join("web"), &["--kept", "page.html"]);
    assert_eq!(code, 0, "{err}");
    assert!(err.starts_with("web/page.html: wiring kept (19 items).\n"), "{err}");
    // No .impeccable/ appears in the subdirectory.
    assert!(!dir.join("web/.impeccable").exists());
    let _ = std::fs::remove_dir_all(&dir);
}
