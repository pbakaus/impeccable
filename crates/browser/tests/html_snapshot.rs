use impeccable_browser::html_snapshot::{HtmlSnapshot, SnapshotSelection};
use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "capture-snapshot-{}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(root.join("assets")).unwrap();
        fs::create_dir_all(root.join(".impeccable")).unwrap();
        for (name, bytes) in [
            ("index.html", "<img src='assets/art.png'>"),
            ("other.html", "other page"),
            ("assets/art.png", "asset bytes"),
            (".impeccable/spec.json", "{}"),
            (".impeccable/comp.png", "comp bytes"),
            (".env", "private"),
        ] {
            fs::write(root.join(name), bytes).unwrap();
        }
        Self(root)
    }
    fn selection(&self) -> SnapshotSelection {
        SnapshotSelection {
            root: self.0.clone(),
            entry: "index.html".into(),
            served: vec!["index.html".into(), "assets/art.png".into()],
            bound: vec![
                ".impeccable/spec.json".into(),
                ".impeccable/comp.png".into(),
            ],
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn snapshot_freezes_bytes_and_detects_every_changed_input() {
    let f = Fixture::new();
    let original = HtmlSnapshot::freeze(f.selection()).unwrap();
    let mut reordered = f.selection();
    reordered.served.reverse();
    reordered.bound.reverse();
    assert_eq!(
        original.digest(),
        HtmlSnapshot::freeze(reordered).unwrap().digest()
    );
    for name in [
        "index.html",
        "assets/art.png",
        ".impeccable/spec.json",
        ".impeccable/comp.png",
    ] {
        let before = fs::read(f.0.join(name)).unwrap();
        fs::write(f.0.join(name), b"changed").unwrap();
        assert!(original.verify_current().is_err(), "{name}");
        assert_eq!(original.bytes(name).unwrap(), before);
        fs::write(f.0.join(name), before).unwrap();
        original.verify_current().unwrap();
    }
}

#[test]
fn routes_are_explicit_and_never_expose_bound_private_files() {
    let f = Fixture::new();
    let s = HtmlSnapshot::freeze(f.selection()).unwrap();
    assert_eq!(
        s.serve_path("/index.html?cache=2"),
        Some("index.html".into())
    );
    assert_eq!(
        s.serve_path("/assets/art.png"),
        Some("assets/art.png".into())
    );
    for route in [
        "/",
        "/other.html",
        "/.env",
        "/.impeccable/comp.png",
        "/../index.html",
        "/assets/../index.html",
        "/%2e%2e/index.html",
        "/assets%2fart.png",
        "/assets\\art.png",
        "http://example.com/index.html",
    ] {
        assert!(s.serve_path(route).is_none(), "{route}");
    }
    let mut selection = f.selection();
    selection.served.push(".env".into());
    assert!(HtmlSnapshot::freeze(selection).is_err());
}

#[test]
fn snapshot_rejects_traversal_symlinks_and_non_html_entries() {
    let f = Fixture::new();
    for bad in [
        "../index.html",
        "/index.html",
        "assets/../index.html",
        "assets/art.png",
    ] {
        let mut selection = f.selection();
        selection.entry = bad.into();
        assert!(HtmlSnapshot::freeze(selection).is_err(), "{bad}");
    }
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(f.0.join("assets"), f.0.join("linked")).unwrap();
        let mut selection = f.selection();
        selection.served.push("linked/art.png".into());
        assert!(HtmlSnapshot::freeze(selection).is_err());
        let s = HtmlSnapshot::freeze(f.selection()).unwrap();
        fs::rename(f.0.join("assets"), f.0.join("original-assets")).unwrap();
        std::os::unix::fs::symlink(f.0.join("original-assets"), f.0.join("assets")).unwrap();
        assert!(s.verify_current().is_err());
    }
}

#[test]
fn snapshot_server_serves_frozen_bytes_and_checks_host() {
    use std::{
        io::{Read, Write},
        net::TcpStream,
        sync::Arc,
    };
    let f = Fixture::new();
    let snapshot = Arc::new(HtmlSnapshot::freeze(f.selection()).unwrap());
    let server = snapshot.serve().unwrap();
    let url = server.entry_url();
    let host = url
        .strip_prefix("http://")
        .unwrap()
        .split('/')
        .next()
        .unwrap();
    let get = |path: &str, request_host: &str| {
        let mut stream = TcpStream::connect(host).unwrap();
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .unwrap();
        write!(
            stream,
            "GET {path} HTTP/1.1\r\nHost: {request_host}\r\nConnection: close\r\n\r\n"
        )
        .unwrap();
        let mut response = Vec::new();
        stream.read_to_end(&mut response).unwrap();
        response
    };
    fs::write(f.0.join("assets/art.png"), b"new bytes").unwrap();
    let actual = get("/assets/art.png", host);
    assert!(actual.ends_with(b"asset bytes"));
    assert!(
        String::from_utf8_lossy(&actual)
            .contains("Cache-Control: private, max-age=3600, immutable")
    );
    assert!(String::from_utf8_lossy(&actual).starts_with("HTTP/1.1 200 OK"));
    for (path, h) in [
        ("/.env", host),
        ("/.impeccable/spec.json", host),
        ("/other.html", host),
        ("/index.html", "attacker.example"),
        ("/assets/../index.html", host),
    ] {
        assert!(String::from_utf8_lossy(&get(path, h)).starts_with("HTTP/1.1 404"));
    }
    assert!(snapshot.verify_current().is_err());
}

#[test]
fn snapshot_server_delivers_large_binary_response_completely() {
    use std::{
        io::{Read, Write},
        net::TcpStream,
        sync::Arc,
    };
    let f = Fixture::new();
    let payload: Vec<u8> = (0..3 * 1024 * 1024).map(|n| (n % 251) as u8).collect();
    fs::write(f.0.join("assets/art.png"), &payload).unwrap();
    let snapshot = Arc::new(HtmlSnapshot::freeze(f.selection()).unwrap());
    let server = snapshot.serve().unwrap();
    let url = server.entry_url();
    let host = url
        .strip_prefix("http://")
        .unwrap()
        .split('/')
        .next()
        .unwrap();
    let mut stream = TcpStream::connect(host).unwrap();
    stream
        .set_read_timeout(Some(std::time::Duration::from_secs(5)))
        .unwrap();
    write!(
        stream,
        "GET /assets/art.png HTTP/1.1\r\nHost: {host}\r\n\r\n"
    )
    .unwrap();
    let mut response = Vec::new();
    stream.read_to_end(&mut response).unwrap();
    let body = response.windows(4).position(|b| b == b"\r\n\r\n").unwrap() + 4;
    assert_eq!(
        response.len() - body,
        payload.len(),
        "large response was truncated"
    );
    assert_eq!(&response[body..], payload);
}
