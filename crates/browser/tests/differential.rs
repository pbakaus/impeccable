//! Differential check of the Rust URL engine against the JS one.
//!
//! URL scans have no oracle goldens (browser output depends on the
//! machine), so this test runs both CLIs against the same served fixtures
//! and the same installed browser (`PUPPETEER_EXECUTABLE_PATH` is pointed at
//! the browser our discovery finds, so Chrome-version drift cannot explain a
//! difference) and diffs the JSON. It skips cleanly when any prerequisite is
//! missing: the public repo checkout, `node`, puppeteer in its node_modules,
//! an installed browser, or the built `impeccable` binary.
//!
//! Env:
//! - `IMPECCABLE_PUBLIC_REPO` - repo root override (default: this workspace).
//! - `IMPECCABLE_BIN` — the Rust binary (default `target/debug/impeccable`).
//! - `IMPECCABLE_DIFF_ALL=1` — single-URL mode over every fixture (slow,
//!   ~3 s per fixture per side); default is a fixed subset.
//! - `IMPECCABLE_DIFF_BUNDLED=1` — let puppeteer use its bundled Chrome
//!   instead of the discovered one.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("workspace root")
}

fn public_repo() -> Option<PathBuf> {
    let p = match std::env::var("IMPECCABLE_PUBLIC_REPO") {
        Ok(p) => PathBuf::from(p),
        Err(_) => workspace_root(),
    };
    if p.join("cli/bin/cli.js").exists() {
        return p.canonicalize().ok();
    }
    None
}

fn find_on_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    let exe = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    std::env::split_paths(&path)
        .map(|d| d.join(&exe))
        .find(|p| p.is_file())
}

/// Serve `dir` on 127.0.0.1:<port>; returns the port. Minimal HTTP/1.0.
fn serve_dir(dir: PathBuf) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { break };
            let dir = dir.clone();
            std::thread::spawn(move || handle(stream, &dir));
        }
    });
    port
}

fn handle(mut stream: TcpStream, dir: &Path) {
    let mut buf = vec![0u8; 8192];
    let n = stream.read(&mut buf).unwrap_or(0);
    let req = String::from_utf8_lossy(&buf[..n]).to_string();
    let path = req
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .unwrap_or("/")
        .split('?')
        .next()
        .unwrap_or("/")
        .trim_start_matches('/')
        .to_string();
    let file = dir.join(&path);
    let (status, ctype, body) = match std::fs::read(&file) {
        Ok(bytes) if !path.contains("..") => {
            let ct = if path.ends_with(".css") {
                "text/css"
            } else if path.ends_with(".js") {
                "application/javascript"
            } else if path.ends_with(".png") {
                "image/png"
            } else if path.ends_with(".svg") {
                "image/svg+xml"
            } else {
                "text/html; charset=utf-8"
            };
            ("200 OK", ct, bytes)
        }
        _ => (
            "404 Not Found",
            "text/html; charset=utf-8",
            b"<h1>404</h1>".to_vec(),
        ),
    };
    let head = format!(
        "HTTP/1.0 {status}\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(&body);
    let _ = stream.flush();
}

struct Run {
    stdout: String,
    stderr: String,
    code: i32,
}

fn run(cmd: &mut Command) -> Run {
    let out = cmd.output().expect("spawn");
    Run {
        stdout: String::from_utf8_lossy(&out.stdout).to_string(),
        stderr: String::from_utf8_lossy(&out.stderr).to_string(),
        code: out.status.code().unwrap_or(-1),
    }
}

/// Pixel-contrast snippets measure animated pages at whatever frame the
/// screenshot lands on; the numbers may legitimately differ run to run.
/// Everything else must be byte-identical.
fn normalize_pixel_contrast(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find("pixel contrast ") {
        out.push_str(&rest[..i]);
        out.push_str("pixel contrast N:1 median N:1 ");
        let after = &rest[i..];
        // skip "pixel contrast X:1 median Y:1 "
        let mut skipped = after;
        for _ in 0..2 {
            if let Some(j) = skipped.find(":1 ") {
                skipped = &skipped[j + 3..];
            }
        }
        rest = skipped;
    }
    out.push_str(rest);
    out
}

fn compare(label: &str, js: &Run, rs: &Run, report: &mut Vec<String>) -> bool {
    let mut ok = true;
    if js.stdout != rs.stdout {
        let js_n = normalize_pixel_contrast(&js.stdout);
        let rs_n = normalize_pixel_contrast(&rs.stdout);
        if js_n == rs_n {
            report.push(format!(
                "{label}: identical except pixel-contrast measurements (animation timing)"
            ));
        } else {
            ok = false;
            let js_v: Result<Value, _> = serde_json::from_str(&js.stdout);
            let rs_v: Result<Value, _> = serde_json::from_str(&rs.stdout);
            let detail = match (js_v, rs_v) {
                (Ok(Value::Array(a)), Ok(Value::Array(b))) => {
                    let mut lines =
                        vec![format!("js {} findings, rs {} findings", a.len(), b.len())];
                    for (i, (x, y)) in a.iter().zip(b.iter()).enumerate() {
                        if x != y {
                            lines.push(format!("  #{i}\n    js: {}\n    rs: {}", x, y));
                            if lines.len() > 6 {
                                break;
                            }
                        }
                    }
                    lines.join("\n")
                }
                _ => format!(
                    "stdout differs\n--- js ---\n{}\n--- rs ---\n{}",
                    js.stdout, rs.stdout
                ),
            };
            report.push(format!("{label}: STDOUT DIFFERS\n{detail}"));
        }
    } else {
        report.push(format!("{label}: identical"));
    }
    if js.stderr != rs.stderr {
        ok = false;
        report.push(format!(
            "{label}: STDERR DIFFERS\n--- js ---\n{}\n--- rs ---\n{}",
            js.stderr, rs.stderr
        ));
    }
    if js.code != rs.code {
        ok = false;
        report.push(format!(
            "{label}: EXIT DIFFERS js={} rs={}",
            js.code, rs.code
        ));
    }
    ok
}

#[test]
fn url_engine_matches_js() {
    let Some(repo) = public_repo() else {
        eprintln!("skip: public repo not found (set IMPECCABLE_PUBLIC_REPO)");
        return;
    };
    let Some(node) = find_on_path("node") else {
        eprintln!("skip: node not on PATH");
        return;
    };
    if !repo.join("cli/engine/detect-antipatterns.mjs").exists() {
        // The public repo's `rust-swap` branch replaced the JS engine with a
        // shim over this binary; there is nothing to diff against.
        eprintln!(
            "skip: JS engine not present in {} (cli/engine missing)",
            repo.display()
        );
        return;
    }
    if !repo.join("node_modules/puppeteer").exists() {
        eprintln!("skip: puppeteer not installed in {}", repo.display());
        return;
    }
    let env: HashMap<String, String> = std::env::vars().collect();
    let Ok(browser) = impeccable_browser::discovery::find_browser(&env) else {
        eprintln!("skip: no installed browser found");
        return;
    };
    let bin = std::env::var("IMPECCABLE_BIN")
        .map(PathBuf::from)
        .unwrap_or_else(|_| workspace_root().join("target/debug/impeccable"));
    if !bin.exists() {
        eprintln!(
            "skip: {} missing (cargo build -p impeccable, or set IMPECCABLE_BIN)",
            bin.display()
        );
        return;
    }
    let fixtures = repo.join("tests/fixtures/antipatterns");
    let mut names: Vec<String> = std::fs::read_dir(&fixtures)
        .expect("fixtures dir")
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| n.ends_with(".html"))
        .collect();
    names.sort();
    let port = serve_dir(fixtures.clone());
    let base = format!("http://127.0.0.1:{port}/");
    let bundled = std::env::var("IMPECCABLE_DIFF_BUNDLED").ok().as_deref() == Some("1");

    let js_cmd = |args: &[String]| {
        let mut c = Command::new(&node);
        c.arg(repo.join("cli/bin/cli.js"))
            .arg("detect")
            .arg("--json")
            .args(args);
        c.current_dir(&repo);
        if !bundled {
            c.env("PUPPETEER_EXECUTABLE_PATH", &browser);
        }
        c
    };
    let rs_cmd = |args: &[String]| {
        let mut c = Command::new(&bin);
        c.arg("detect").arg("--json").args(args);
        c.current_dir(&repo);
        c
    };

    let mut report: Vec<String> = Vec::new();
    let mut all_ok = true;

    // 1. Shared-browser mode: every fixture in one invocation.
    let urls: Vec<String> = names.iter().map(|n| format!("{base}{n}")).collect();
    let js = run(&mut js_cmd(&urls));
    let rs = run(&mut rs_cmd(&urls));
    all_ok &= compare(
        &format!("shared-browser ({} urls)", urls.len()),
        &js,
        &rs,
        &mut report,
    );

    // 2. Single-URL mode (networkidle0): a subset by default.
    let all = std::env::var("IMPECCABLE_DIFF_ALL").ok().as_deref() == Some("1");
    let subset: Vec<String> = if all {
        names.clone()
    } else {
        names.iter().take(6).cloned().collect()
    };
    for n in &subset {
        let u = vec![format!("{base}{n}")];
        let js = run(&mut js_cmd(&u));
        let rs = run(&mut rs_cmd(&u));
        all_ok &= compare(&format!("single {n}"), &js, &rs, &mut report);
    }

    // 3. file:// URLs (design system resolves from the file's project).
    for n in names.iter().take(2) {
        let u = vec![format!("file://{}", fixtures.join(n).display())];
        let js = run(&mut js_cmd(&u));
        let rs = run(&mut rs_cmd(&u));
        all_ok &= compare(&format!("file {n}"), &js, &rs, &mut report);
    }

    // 4. Navigation errors: missing file, closed port.
    let missing = vec![format!(
        "file://{}",
        fixtures.join("does-not-exist.html").display()
    )];
    let js = run(&mut js_cmd(&missing));
    let rs = run(&mut rs_cmd(&missing));
    all_ok &= compare("file missing", &js, &rs, &mut report);

    eprintln!("--- differential report ---");
    for line in &report {
        eprintln!("{line}");
    }
    assert!(
        all_ok,
        "URL engine diverged from the JS engine; see report above"
    );
}
