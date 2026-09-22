//! Native transport evidence: read the response that was rendered, never refetch.
use impeccable_browser::{cdp::Browser, discovery};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use std::time::Duration;

#[test]
fn response_capture_reads_original_bytes_and_preserves_repeated_url_ambiguity() {
    let env: HashMap<String, String> = std::env::vars().collect();
    let Ok(exe) = discovery::find_browser(&env) else {
        eprintln!("skip: no browser");
        return;
    };
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let origin = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
    let hits = Arc::new(AtomicUsize::new(0));
    let count = hits.clone();
    std::thread::spawn(move || {
        for mut stream in listener.incoming().flatten() {
            let mut request = [0u8; 4096];
            let n = stream.read(&mut request).unwrap_or(0);
            let request = String::from_utf8_lossy(&request[..n]);
            let (kind, body) = if request.starts_with("GET /asset.bin ") {
                let number = count.fetch_add(1, Ordering::SeqCst);
                (
                    "application/octet-stream",
                    if number == 0 {
                        vec![0, 255, 13, 128, 42]
                    } else {
                        vec![99, 4, 0, 128]
                    },
                )
            } else {
                (
                    "text/html",
                    b"<!doctype html><title>capture</title><body>fixture</body>".to_vec(),
                )
            };
            let header = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(header.as_bytes());
            let _ = stream.write_all(&body);
        }
    });
    let mut browser = Browser::launch(&exe, &[], false).expect("isolated browser");
    let mut page = browser.new_page().unwrap();
    assert!(
        page.response_evidence(&[]).is_err(),
        "capture must be explicitly enabled"
    );
    page.begin_response_capture().unwrap();
    page.goto(&origin, "load", Duration::from_secs(15)).unwrap();
    page.evaluate_value("fetch('/asset.bin').then(r=>r.arrayBuffer()).then(()=>true)")
        .unwrap();
    // Pump a browser round-trip after the fetch's completion event.
    page.evaluate_value("true").unwrap();
    let urls = vec![format!("{origin}/asset.bin")];
    let first = page.response_evidence(&urls).unwrap();
    assert_eq!(first.responses.len(), 1);
    assert_eq!(
        first.responses[0].body.as_deref(),
        Some(&[0, 255, 13, 128, 42][..])
    );
    assert!(!first.responses[0].ambiguous_url);
    assert_eq!(
        hits.load(Ordering::SeqCst),
        1,
        "body evidence must not make another request"
    );
    page.evaluate_value("fetch('/asset.bin').then(r=>r.arrayBuffer()).then(()=>true)")
        .unwrap();
    page.evaluate_value("true").unwrap();
    let repeated = page.response_evidence(&urls).unwrap();
    assert_eq!(repeated.responses.len(), 2);
    assert!(repeated.responses.iter().all(|r| r.ambiguous_url));
    assert_eq!(
        repeated.responses[0].body.as_deref(),
        Some(&[0, 255, 13, 128, 42][..])
    );
    assert_eq!(
        repeated.responses[1].body.as_deref(),
        Some(&[99, 4, 0, 128][..])
    );
    assert_eq!(hits.load(Ordering::SeqCst), 2);
    assert!(!repeated.changed_during_collection);
    assert!(!repeated.truncated);
    assert_eq!(repeated.responses[0].status, Some(200.0));
    assert_eq!(repeated.responses[0].mime_type, "application/octet-stream");
    // A new document must not borrow response evidence from its predecessor.
    page.goto(&format!("{origin}/next"), "load", Duration::from_secs(15))
        .unwrap();
    let next = page.response_evidence(&urls).unwrap();
    assert!(next.responses.is_empty());
    assert_eq!(next.missing_urls, urls);
    assert_eq!(hits.load(Ordering::SeqCst), 2);
    page.close();
    browser.close();
}

#[test]
fn large_utf8_document_retains_exact_bytes_without_refetch() {
    let env: HashMap<String, String> = std::env::vars().collect();
    let Ok(exe) = discovery::find_browser(&env) else { return; };
    // One non-Latin-1 character makes Blink retain a two-byte string. The
    // inspector buffer must accommodate it even though the UTF-8 body is <16MiB.
    let body = format!("<!doctype html><meta charset=utf-8><title>€</title><!--{}-->", "a".repeat(9 * 1024 * 1024)).into_bytes();
    let served = body.clone();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://127.0.0.1:{}/index.html", listener.local_addr().unwrap().port());
    let hits = Arc::new(AtomicUsize::new(0));
    let count = hits.clone();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request = [0; 4096];
        stream.read(&mut request).unwrap();
        count.fetch_add(1, Ordering::SeqCst);
        write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", served.len()).unwrap();
        stream.write_all(&served).unwrap();
    });
    let mut browser = Browser::launch(&exe, &[], false).unwrap();
    let mut page = browser.new_page().unwrap();
    page.begin_response_capture().unwrap();
    page.goto(&url, "load", Duration::from_secs(15)).unwrap();
    let evidence = page.response_evidence(&[url]).unwrap();
    let response = &evidence.responses[0];
    assert!(response.unavailable_reason.is_none(), "{:?}", response.unavailable_reason);
    assert_eq!(response.body.as_deref(), Some(body.as_slice()));
    assert_eq!(hits.load(Ordering::SeqCst), 1);
    page.close();
    browser.close();
    server.join().unwrap();
}
