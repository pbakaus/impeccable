mod support;
use impeccable_account::{config::Account, critiques::{after_save, Report}, health, login, receipt};
use impeccable_common::Io;
use impeccable_context::critique_storage::SavedReport;
use serde_json::json;
use std::{path::Path, time::{Duration, SystemTime}};
use support::fake::{browser, Fake};

#[test]
fn every_page_receipt_names_its_destination() {
    let account = Account::from_env(&[("IMPECCABLE_HOME".into(), std::env::temp_dir().to_string_lossy().into_owned())].into()).unwrap();
    for (page, label, suffix) in [
        ("foundations", Some("owner/site name"), "foundations?repo=owner%2Fsite+name"),
        ("foundations", None, "foundations"),
        ("design-health", None, "design-health"),
        ("design", None, "design"),
        ("critiques", None, "critiques"),
    ] {
        let (mut io, cap) = Io::captured("", std::env::temp_dir(), Default::default());
        receipt::saved(&mut io, receipt::page(&account, page, label), false);
        assert_eq!(String::from_utf8_lossy(&cap.stderr.borrow()), format!("Saved to Impeccable: https://app.impeccable.style/app/-/{suffix}\n"));
    }
}

#[test]
fn reports_keep_the_server_link_and_fail_without_promising_retry() {
    let fake = Fake::start();
    fake.knobs.lock().unwrap().critiques = true;
    let env = fake.env("receipt-report");
    login(&env, &mut |u| browser(u), Duration::from_secs(10)).unwrap();
    let root = Path::new(&env["IMPECCABLE_HOME"]);
    let mut snapshot = SavedReport {
        path: root.join(".impeccable/critique/report.md").to_string_lossy().into(),
        body: "Report".into(),
        meta: json!({"target":"Home", "total_score":16, "max_score":40, "p0_count":0, "p1_count":0, "timestamp":"2026-11-22T00-00-00Z"}).as_object().unwrap().clone(),
    };
    for report in [Report::Critique, Report::Audit] {
        snapshot.meta.insert("max_score".into(), if report == Report::Audit { 20 } else { 40 }.into());
        let (mut io, cap) = Io::captured("", root.into(), env.clone());
        after_save(&mut io, &snapshot, report, false);
        let said = String::from_utf8_lossy(&cap.stdout.borrow()).into_owned();
        assert!(said.starts_with("Saved to Impeccable: http://127.0.0.1:"), "{said}");
        assert!(said.lines().next().unwrap().contains("/app/-/critiques?report="));
    }
    snapshot.meta.insert("max_score".into(), 40.into());
    fake.route("POST", "/cli/v1/critiques", 500, vec![], "{}");
    let (mut io, cap) = Io::captured("", root.into(), env);
    after_save(&mut io, &snapshot, Report::Critique, false);
    assert_eq!(String::from_utf8_lossy(&cap.stdout.borrow()), "Not saved to Impeccable: Impeccable had a problem; the report is saved locally. Run it again to save it.\n");
}

#[test]
fn foundations_failure_is_one_honest_line_and_opt_out_is_once() {
    let fake = Fake::start();
    { let mut k = fake.knobs.lock().unwrap(); k.health = true; k.foundations = true; }
    let mut env = fake.env("receipt-foundations");
    login(&env, &mut |u| browser(u), Duration::from_secs(10)).unwrap();
    let root = Path::new(&env["IMPECCABLE_HOME"]).join("repo");
    std::fs::create_dir_all(&root).unwrap();
    assert!(std::process::Command::new("git").args(["init", "-q"]).arg(&root).status().unwrap().success());
    fake.route("POST", "/cli/v1/foundations", 500, vec![], "{}");
    let scan = health::Scan { foundations: Default::default(), root: root.to_string_lossy().into(), files_scanned: 1, hits: vec![], ruleset: vec!["side-tab".into()], engine_version: "0.1.27".into(), started: SystemTime::now() };
    let (mut io, cap) = Io::captured("", root.clone(), env.clone());
    health::after_scan(&mut io, &scan, false);
    let said = String::from_utf8_lossy(&cap.stderr.borrow()).into_owned();
    assert_eq!(said.lines().filter(|l| l.contains("not saved to Impeccable") || l.starts_with("Not saved")).collect::<Vec<_>>(), ["Foundations not saved to Impeccable: Impeccable had a problem. Run it again to save it."]);
    env.insert("DO_NOT_TRACK".into(), "1".into());
    let (mut io, cap) = Io::captured("", root, env);
    health::after_scan(&mut io, &scan, false);
    health::after_scan(&mut io, &scan, false);
    assert_eq!(String::from_utf8_lossy(&cap.stderr.borrow()), "Not saved to Impeccable: DO_NOT_TRACK is set. Unset DO_NOT_TRACK to enable saving.\n");
}

#[test]
fn a_scan_names_the_pages_the_service_says_it_landed_on() {
    // A link only when it's http(s); otherwise the page built here (REN-2343).
    let built = Some("https://app.impeccable.style/app/-/design".to_string());
    assert_eq!(receipt::landed(&json!({"url": "https://h/app/-/design?repo=a"}), built.clone()).as_deref(), Some("https://h/app/-/design?repo=a"));
    for answer in [
        json!({}), json!({"url": "javascript:alert(1)"}), json!({"url": 3}), json!({"url": "https://"}),
        json!({"url": "https://h/app\nSaved to Impeccable: https://evil"}), json!({"url": "https://h/\u{1b}[2J"}),
    ] {
        assert_eq!(receipt::landed(&answer, built.clone()), built, "{answer}");
    }
    let fake = Fake::start();
    { let mut k = fake.knobs.lock().unwrap(); k.health = true; k.foundations = true; }
    let env = fake.env("receipt-landed");
    login(&env, &mut |u| browser(u), Duration::from_secs(10)).unwrap();
    let root = Path::new(&env["IMPECCABLE_HOME"]).join("repo");
    std::fs::create_dir_all(&root).unwrap();
    assert!(std::process::Command::new("git").args(["init", "-q"]).arg(&root).status().unwrap().success());
    fake.route("POST", "/cli/v1/foundations", 200, vec![], r#"{"outcome":"recorded","inPlace":0,"failing":0,"url":"https://h/app/-/foundations?repo=repo"}"#);
    fake.route("POST", "/cli/v1/health/scans", 200, vec![], r#"{"outcome":"recorded","url":"https://h/app/-/design-health?repo=repo"}"#);
    let scan = health::Scan { foundations: Default::default(), root: root.to_string_lossy().into(), files_scanned: 1, hits: vec![], ruleset: vec!["side-tab".into()], engine_version: "0.1.29".into(), started: SystemTime::now() };
    let (mut io, cap) = Io::captured("", root, env);
    health::after_scan(&mut io, &scan, false);
    let said = String::from_utf8_lossy(&cap.stderr.borrow()).into_owned();
    for page in ["foundations", "design-health"] {
        assert!(said.contains(&format!("Saved to Impeccable: https://h/app/-/{page}?repo=repo\n")), "{said}");
    }
}

#[test]
fn json_receipts_lead_with_foundations_whatever_its_address() {
    let (mut io, _) = Io::captured("", std::env::temp_dir(), Default::default());
    let (_, urls) = receipt::capture(|| {
        receipt::saved(&mut io, Some("https://h/projects/repo/design".into()), true);
        receipt::saved_first(&mut io, Some("https://h/projects/repo/foundations".into()), true);
        receipt::saved(&mut io, Some("https://h/projects/repo/health".into()), true);
    });
    assert_eq!(urls, ["https://h/projects/repo/foundations", "https://h/projects/repo/design", "https://h/projects/repo/health"]);
}

#[test]
fn json_receipts_are_data_and_quiet_receipts_print_nothing() {
    let (mut io, cap) = Io::captured("", std::env::temp_dir(), Default::default());
    let (_, urls) = receipt::capture(|| receipt::saved(&mut io, Some("https://example.com/app/-/design".into()), true));
    assert_eq!(urls, ["https://example.com/app/-/design"]);
    receipt::saved(&mut io, Some("https://example.com/app/-/design".into()), true);
    assert!(cap.stdout.borrow().is_empty());
    assert!(cap.stderr.borrow().is_empty());
}

#[test]
fn telemetry_explanation_is_once_per_project() {
    let root = support::fake::temp_home("receipt-opt-out");
    std::fs::create_dir_all(root.join(".git")).unwrap();
    std::fs::create_dir_all(root.join("src/nested")).unwrap();
    let env = [("IMPECCABLE_HOME".into(), root.to_string_lossy().into_owned()), ("DO_NOT_TRACK".into(), "1".into())].into();
    let (io, _) = Io::captured("", root.clone(), env);
    assert_eq!(impeccable_account::critiques::opt_out_nudge(&io, &root).as_deref(), Some("Not saved to Impeccable: DO_NOT_TRACK is set. Unset DO_NOT_TRACK to enable saving.\n"));
    assert!(impeccable_account::critiques::opt_out_nudge(&io, &root.join("src/nested")).is_none());
    assert!(impeccable_account::critiques::opt_out_nudge(&io, &root).is_none());
    std::fs::remove_dir_all(root).unwrap();
}
