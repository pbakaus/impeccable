//! Exercise the same router downstream binaries call, with and without hooks.
use impeccable::{run, InstalledPack};
use impeccable_common::Io;
use impeccable_core::{
    browser::{BrowserFinding, Dom, ElId},
    findings::{finding_for, Finding},
    registry::Antipattern,
    rule_pack::RulePack,
};
use impeccable_html::{dom::StaticDocument, StaticRulePack};
use std::{collections::HashMap, fs, path::PathBuf};

const fn row(id: &'static str) -> Antipattern {
    Antipattern {
        id,
        category: "quality",
        scopes: None,
        severity: Some("warning"),
        name: "Test marker",
        description: "Test marker",
        skill_section: None,
        skill_guideline: None,
    }
}
static ROWS: &[Antipattern] = &[
    row("testcli/source"),
    row("testcli/static"),
    row("testcli/browser"),
];
#[derive(Debug)]
struct Pack;
static PACK: Pack = Pack;
impl RulePack for Pack {
    fn registry(&self) -> &'static [Antipattern] {
        ROWS
    }
    fn check_text(&self, content: &str, path: &str, _: &str) -> Vec<Finding> {
        if content.contains("PACK_MARKER") {
            vec![finding_for(&ROWS[0], path, "PACK_MARKER", 1.)]
        } else {
            vec![]
        }
    }
    fn check_element_dom(&self, dom: &dyn Dom, el: ElId) -> Vec<BrowserFinding> {
        if dom.direct_text_nodes(el).concat().contains("PACK_MARKER") {
            vec![BrowserFinding::new(ROWS[2].id, "PACK_MARKER")]
        } else {
            vec![]
        }
    }
}
impl StaticRulePack for Pack {
    fn check_document(&self, doc: &StaticDocument, path: &str) -> Vec<Finding> {
        if doc
            .query_selector_all("p")
            .iter()
            .any(|el| el.direct_text().contains("PACK_MARKER"))
        {
            vec![finding_for(&ROWS[1], path, "PACK_MARKER", 1.)]
        } else {
            vec![]
        }
    }
}
fn installed() -> InstalledPack {
    InstalledPack {
        rule_pack: Some(&PACK),
        static_rule_pack: Some(&PACK),
    }
}
struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "cli-pack-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        fs::create_dir_all(&path).unwrap();
        fs::write(path.join("app.tsx"), "const title = 'PACK_MARKER';").unwrap();
        fs::write(
            path.join("index.html"),
            "<!doctype html><html><body><p>PACK_MARKER</p></body></html>",
        )
        .unwrap();
        Self(path)
    }
    fn run(&self, args: &[&str], input: &str, pack: InstalledPack) -> (i32, String) {
        let (mut io, captured) = Io::captured(
            input,
            self.0.clone(),
            HashMap::from([("HOME".into(), self.0.display().to_string())]),
        );
        let code = run(
            &args.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
            &mut io,
            pack,
        );
        drop(io);
        let output = format!(
            "{}{}",
            String::from_utf8_lossy(&captured.stdout.borrow()),
            String::from_utf8_lossy(&captured.stderr.borrow())
        );
        (code, output)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
#[test]
fn cli_file_paths_compose_hooks_and_none_stays_empty() {
    let f = Fixture::new();
    for (target, expected) in [
        ("app.tsx", "testcli/source"),
        ("index.html", "testcli/static"),
    ] {
        for verb in ["detect", ""] {
            let args = if verb.is_empty() {
                vec![target, "--json", "--no-config"]
            } else {
                vec![verb, target, "--json", "--no-config"]
            };
            let baseline = f.run(&args, "", InstalledPack::NONE);
            let output = f.run(&args, "", installed());
            assert!(output.1.contains(expected), "{output:?}");
            assert!(!output.1.contains("testcli/browser"));
            if target.ends_with("html") {
                assert!(!output.1.contains("testcli/source"));
            }
            assert!(!baseline.1.contains("testcli/"), "{baseline:?}");
            assert_eq!(baseline, f.run(&args, "", InstalledPack::NONE));
        }
    }
}
#[test]
fn cli_html_falls_back_to_source_hook_without_static_hook() {
    let f = Fixture::new();
    let output = f.run(
        &["detect", "index.html", "--json", "--no-config"],
        "",
        InstalledPack {
            rule_pack: Some(&PACK),
            static_rule_pack: None,
        },
    );
    assert!(output.1.contains("testcli/source"), "{output:?}");
    assert!(!output.1.contains("testcli/static"));
}

#[test]
fn cli_url_runs_browser_hook() {
    if impeccable_browser::discovery::find_browser(&std::env::vars().collect()).is_err() {
        return;
    }
    let engine = impeccable_browser::BrowserEngine::from_process_env();
    match engine.launch() {
        Ok(browser) => drop(browser),
        Err(error) => {
            eprintln!("Skipping browser pack test: {error:?}");
            return;
        }
    }
    let f = Fixture::new();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/", listener.local_addr().unwrap());
    listener.set_nonblocking(true).unwrap();
    let done = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let stop = done.clone();
    let server = std::thread::spawn(move || {
        use std::io::{Read, Write};
        while !stop.load(std::sync::atomic::Ordering::Relaxed) {
            if let Ok((mut stream, _)) = listener.accept() {
                stream
                    .set_read_timeout(Some(std::time::Duration::from_secs(1)))
                    .unwrap();
                let _ = stream.read(&mut [0; 4096]);
                let body = "<!doctype html><html><body><p>PACK_MARKER</p></body></html>";
                let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
            } else {
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
        }
    });
    let args = ["detect", &url, "--json", "--no-config"];
    let baseline = f.run(&args, "", InstalledPack::NONE);
    let output = f.run(&args, "", installed());
    done.store(true, std::sync::atomic::Ordering::Relaxed);
    server.join().unwrap();
    assert!(output.1.contains("testcli/browser"), "{output:?}");
    assert!(!baseline.1.contains("testcli/"), "{baseline:?}");
}

#[test]
fn cli_hooks_receive_source_and_static_hooks() {
    let f = Fixture::new();
    fs::create_dir_all(f.0.join(".impeccable")).unwrap();
    fs::write(
        f.0.join(".impeccable/config.json"),
        r#"{"hook":{"perEditRules":"all"}}"#,
    )
    .unwrap();
    for (target, id) in [
        ("app.tsx", "testcli/source"),
        ("index.html", "testcli/static"),
    ] {
        for verb in ["hook", "hook-before-edit"] {
            let event = serde_json::json!({
                "session_id": format!("{verb}-{target}"), "cwd": f.0,
                "hook_event_name": "PostToolUse", "tool_name": "Write",
                "tool_input": {"file_path": f.0.join(target), "content": fs::read_to_string(f.0.join(target)).unwrap()}
            }).to_string();
            let baseline = f.run(&[verb], &event, InstalledPack::NONE);
            let output = f.run(&[verb], &event, installed());
            assert!(!baseline.1.contains(id), "{baseline:?}");
            assert!(output.1.contains(id), "{verb} {target}: {output:?}");
        }
    }
}
