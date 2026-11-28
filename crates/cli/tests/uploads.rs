//! REN-2530: a signed-in CLI sends nothing until the person turns an upload kind on, and then only that kind.
#[path = "../../account/tests/support/fake.rs"]
mod fake;
use fake::{browser, Fake};
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Output, Stdio};

fn impeccable(env: &HashMap<String, String>, cwd: &Path, args: &[&str]) -> Command {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_impeccable"));
    cmd.args(args).current_dir(cwd).env_clear().envs(env).stdin(Stdio::null());
    for key in ["PATH", "SystemRoot", "TEMP", "TMP"] {
        if let Ok(v) = std::env::var(key) {
            cmd.env(key, v);
        }
    }
    cmd
}

fn run(env: &HashMap<String, String>, cwd: &Path, args: &[&str]) -> Output {
    impeccable(env, cwd, args).output().unwrap()
}

/// The service's routes a signed-in CLI may call without any upload switch on: reads, the sign-in itself.
const READS: &[&str] = &["/cli/v1/entitlement", "/cli/v1/setup", "/cli/v1/manifest", "/cli/v1/agents", "/cli/v1/taste", "/cli/v1/lease"];

/// Every `/cli/v1/` route the fake saw that isn't a read: what left the machine.
fn uploads(fake: &Fake) -> Vec<String> {
    let mut seen: Vec<String> = fake
        .record
        .lock()
        .unwrap()
        .hits
        .keys()
        .filter(|p| p.starts_with("/cli/v1/") && !READS.contains(&p.as_str()))
        .cloned()
        .collect();
    seen.sort();
    seen
}

const META: &str = r#"{"target":"Pricing","total_score":24,"max_score":32,"na_heuristics":"7,10","p0_count":1,"p1_count":2,"p2_count":3,"p3_count":4,"title":"Pricing plans","url":"http://127.0.0.1:9/pricing","heuristics":[{"n":1,"score":4},{"n":2,"score":3}]}"#;

/// A signed-in machine in a git repository with a DESIGN.md, a report to save and a live variant to accept, and no
/// upload switch on.
fn signed_in(name: &str) -> (Fake, HashMap<String, String>, std::path::PathBuf) {
    let fake = Fake::start();
    {
        let mut k = fake.knobs.lock().unwrap();
        k.health = true;
        k.foundations = true;
        k.design = true;
        k.critiques = true;
        k.setup = true;
    }
    let env = fake.env(name);
    let root = Path::new(&env["IMPECCABLE_HOME"]).join("repo");
    std::fs::create_dir_all(&root).unwrap();
    assert!(Command::new("git").arg("init").arg("-q").arg(&root).status().unwrap().success());
    std::fs::write(root.join("DESIGN.md"), "# Design\nCalm.\n").unwrap();
    std::fs::write(root.join("report.md"), "# Report\nCrowded header.\n").unwrap();
    std::fs::write(root.join("page.html"), "<h1 style=\"color:#888;background:#777\">Hi</h1>\n").unwrap();
    let mut child = impeccable(&env, &root, &["login", "--no-browser"]).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    let mut url = String::new();
    BufReader::new(child.stdout.take().unwrap()).read_line(&mut url).unwrap();
    browser(url.trim());
    let out = child.wait_with_output().unwrap();
    assert!(out.status.success());
    let said = String::from_utf8_lossy(&out.stderr).into_owned();
    assert!(said.contains("Nothing is sent to Impeccable from this machine until you choose what: impeccable uploads"), "{said}");
    (fake, env, root)
}

fn accept_variant(env: &HashMap<String, String>, root: &Path, id: &str) {
    std::fs::write(
        root.join("index.html"),
        format!("<!-- impeccable-variants-start {id} -->\n<div data-impeccable-variants=\"{id}\" data-impeccable-variant-count=\"3\" style=\"display: contents\">\n<div data-impeccable-variant=\"original\"><h1>Old</h1></div>\n<div data-impeccable-variant=\"1\"><h1>New</h1></div>\n</div>\n<!-- impeccable-variants-end {id} -->\n"),
    )
    .unwrap();
    let sessions = root.join(".impeccable/live/sessions");
    std::fs::create_dir_all(&sessions).unwrap();
    std::fs::write(
        sessions.join(format!("{id}.jsonl")),
        format!("{}\n", serde_json::json!({"seq": 1, "id": id, "type": "generate", "ts": chrono_now(),
            "event": {"id": id, "type": "generate", "pageUrl": "http://localhost:5173/pricing", "count": 3}})),
    )
    .unwrap();
    assert!(run(env, root, &["live-accept", "--id", id, "--variant", "1"]).status.success());
}

fn chrono_now() -> String {
    let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as f64;
    impeccable_context::util::iso_from_ms(ms)
}

/// Every path that uploads, human and machine output alike, then time for the detached jobs.
fn every_path(env: &HashMap<String, String>, root: &Path) -> String {
    let mut said = String::new();
    for args in [&["detect", "."][..], &["detect", ".", "--json"], &["detect", ".", "--quiet"]] {
        said.push_str(&String::from_utf8_lossy(&run(env, root, args).stderr));
    }
    let out = impeccable(env, root, &["critique-storage", "write", "pricing", "report.md"]).env("IMPECCABLE_CRITIQUE_META", META).output().unwrap();
    said.push_str(&String::from_utf8_lossy(&out.stderr));
    accept_variant(env, root, "ab12cd34");
    run(env, root, &["setup-report"]);
    // The post-critique scan and the screenshot job are detached.
    std::thread::sleep(std::time::Duration::from_secs(4));
    said
}

// Catches (REN-2530): any upload leaving before the person chose it: the sign-in scan, health counts, DESIGN.md, a
// critique, its screenshots, a prototype or the setup report; and the off line missing from human output or
// leaking into --json and --quiet.
#[test]
fn nothing_leaves_a_signed_in_machine_until_a_kind_is_turned_on() {
    let (fake, env, root) = signed_in("uploads-none");
    let said = every_path(&env, &root);
    assert_eq!(uploads(&fake), Vec::<String>::new(), "the service saw uploads");
    assert_eq!(said.matches("Not sent to Impeccable: health is off.").count(), 1, "{said}");
    assert_eq!(said.matches("Not sent to Impeccable: critiques is off.").count(), 1, "{said}");
    // Turning one on needs the person at their terminal: an agent's (no terminal) is refused.
    let out = run(&env, &root, &["uploads", "on", "critiques"]);
    assert_eq!(out.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&out.stderr).contains("in your own terminal"));
    every_path(&env, &root);
    assert_eq!(uploads(&fake), Vec::<String>::new());
}

// Catches one switch letting another kind through: critiques on sends critiques, and nothing else.
#[test]
fn one_kind_on_sends_only_that_kind() {
    let (fake, env, root) = signed_in("uploads-one");
    let account = impeccable_account::config::Account::from_env(&env).unwrap();
    impeccable_account::uploads::seed(&account, &[impeccable_account::uploads::Kind::Critiques]);
    every_path(&env, &root);
    assert_eq!(uploads(&fake), vec!["/cli/v1/critiques".to_string()]);
    impeccable_account::uploads::seed(&account, &[impeccable_account::uploads::Kind::Design]);
    std::fs::write(root.join("DESIGN.md"), "# Design\nCalmer.\n").unwrap();
    run(&env, &root, &["detect", "."]);
    assert_eq!(uploads(&fake), vec!["/cli/v1/critiques".to_string(), "/cli/v1/design".to_string()]);
}

// Catches (REN-2534): DO_NOT_TRACK not stopping the sign-in scan, even with its switch on.
#[test]
fn do_not_track_stops_the_sign_in_scan_with_its_switch_on() {
    let fake = Fake::start();
    {
        let mut k = fake.knobs.lock().unwrap();
        k.health = true;
        k.foundations = true;
    }
    let mut env = fake.env("uploads-dnt");
    let account = impeccable_account::config::Account::from_env(&env).unwrap();
    impeccable_account::uploads::seed(&account, &impeccable_account::uploads::Kind::ALL);
    env.insert("DO_NOT_TRACK".into(), "1".into());
    let root = Path::new(&env["IMPECCABLE_HOME"]).join("repo");
    std::fs::create_dir_all(&root).unwrap();
    assert!(Command::new("git").arg("init").arg("-q").arg(&root).status().unwrap().success());
    std::fs::write(root.join("page.html"), "<h1>Hi</h1>\n").unwrap();
    let mut child = impeccable(&env, &root, &["login", "--no-browser"]).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    let mut url = String::new();
    BufReader::new(child.stdout.take().unwrap()).read_line(&mut url).unwrap();
    browser(url.trim());
    assert!(child.wait().unwrap().success());
    assert_eq!(uploads(&fake), Vec::<String>::new());
}
