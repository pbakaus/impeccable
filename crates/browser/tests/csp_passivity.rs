//! Triage D2: the URL engine must scan passively — with `Page.setBypassCSP`
//! removed, a strict-CSP page's CSP-blocked inline scripts must NOT run during
//! a scan (they did under the old `setBypassCSP(true)` setup).
//!
//! This serves a page with `Content-Security-Policy: script-src 'self'` and an
//! inline `<script>` that a strict CSP blocks. The script, if it ran, would set
//! a global and mutate a marker element. The test drives the browser exactly as
//! the engine does (its page setup no longer bypasses CSP) and asserts the side
//! effect did not fire. Skips cleanly with no installed browser.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::Duration;

const PAGE: &str = r#"<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="script-src 'self'">
<title>csp passivity</title></head>
<body>
<div id="marker">clean</div>
<script>
  // Blocked by `script-src 'self'` (no nonce/hash). Ran only under setBypassCSP.
  window.__impeccableSideEffect = true;
  document.getElementById('marker').textContent = 'SIDE-EFFECT-FIRED';
</script>
</body></html>
"#;

fn serve_once() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            std::thread::spawn(move || handle(stream));
        }
    });
    port
}

fn handle(mut stream: TcpStream) {
    let mut buf = [0u8; 4096];
    let _ = stream.read(&mut buf);
    let body = PAGE.as_bytes();
    let head = format!(
        "HTTP/1.0 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}

#[test]
fn strict_csp_inline_script_does_not_run_during_scan() {
    let env: HashMap<String, String> = std::env::vars().collect();
    let Ok(exe) = impeccable_browser::discovery::find_browser(&env) else {
        eprintln!("skip: no installed browser found");
        return;
    };
    let mut browser = match impeccable_browser::cdp::Browser::launch(&exe, &[], false) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("skip: could not launch browser: {}", e.message);
            return;
        }
    };
    let port = serve_once();
    let url = format!("http://127.0.0.1:{port}/");
    let mut page = browser.new_page().expect("new page");
    page.goto(&url, "networkidle0", Duration::from_secs(30))
        .expect("goto");

    let fired = page
        .evaluate_value("window.__impeccableSideEffect === true")
        .expect("eval side-effect flag");
    let marker = page
        .evaluate_value("document.getElementById('marker').textContent")
        .expect("eval marker");
    page.close();

    assert_eq!(
        fired.as_bool(),
        Some(false),
        "strict-CSP inline script ran during the scan (CSP was bypassed)"
    );
    assert_eq!(
        marker.as_str(),
        Some("clean"),
        "marker was mutated by a CSP-blocked inline script (CSP was bypassed)"
    );
}
