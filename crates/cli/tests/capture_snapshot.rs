use impeccable::capture_snapshot::{HtmlSnapshot, SnapshotSelection};
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
fn fresh_capture_ignores_saved_receipts_and_rejects_stale_or_wrong_documents() {
    use impeccable_comp_verbs::asset_capture::{
        AssetCapture, AssetCaptureRequest, AssetRenderer, capture_sha256,
    };
    use serde_json::json;
    use std::sync::Arc;
    let f = Fixture::new();
    fs::write(f.0.join(".impeccable/spec.json"),serde_json::to_vec(&json!({"comp":".impeccable/comp.png","compSize":{"width":200,"height":200},"regions":[{"id":"art","plate":"assets/art.png","px":{"x":20,"y":20,"w":80,"h":80}}]})).unwrap()).unwrap();
    struct Fake {
        entry: Vec<u8>,
        mutation: Option<PathBuf>,
        wrong: bool,
        partial: bool,
        calls: usize,
    }
    impl AssetRenderer for Fake {
        fn capture(&mut self, r: &AssetCaptureRequest) -> Result<AssetCapture, String> {
            self.calls += 1;
            assert!(r.url.starts_with("http://127.0.0.1:"));
            assert!(r.url.ends_with("/index.html"));
            if let Some(path) = &self.mutation {
                fs::write(path, b"changed").unwrap();
            }
            Ok(AssetCapture {
                receipt: json!({"status":if self.partial {"unavailable"} else {"captured"},"stableCapture":true,"resolvedUrl":if self.wrong {"http://other/page"} else {&r.url},"documentResponseSha256":capture_sha256(&self.entry),"assetSha256":capture_sha256(&r.asset_bytes),"referenceSha256":capture_sha256(&r.reference_bytes),"viewport":{"width":200,"height":200,"dpr":1},"expectedBox":r.expected_box,"reducedMotion":true}),
                images: vec![],
            })
        }
    }
    let s = Arc::new(HtmlSnapshot::freeze(f.selection()).unwrap());
    let mut renderer = Fake {
        entry: s.bytes("index.html").unwrap().to_vec(),
        mutation: None,
        wrong: false,
        partial: false,
        calls: 0,
    };
    fs::write(
        f.0.join(".impeccable/receipt.json"),
        br#"{"status":"captured","visible":true}"#,
    )
    .unwrap();
    let capture = s
        .capture_region(&mut renderer, ".impeccable/spec.json", "art", true)
        .unwrap();
    assert_eq!(capture.receipt["inputSnapshot"]["digest"], s.digest());
    assert_eq!(renderer.calls, 1);
    renderer.wrong = true;
    assert!(
        s.capture_region(&mut renderer, ".impeccable/spec.json", "art", true)
            .is_err()
    );
    renderer.partial = true;
    assert!(
        s.capture_region(&mut renderer, ".impeccable/spec.json", "art", true)
            .is_err(),
        "partial stable evidence must also bind the document"
    );
    renderer.partial = false;
    renderer.wrong = false;
    renderer.entry = b"different entry".to_vec();
    assert!(
        s.capture_region(&mut renderer, ".impeccable/spec.json", "art", true)
            .is_err()
    );
    renderer.entry = s.bytes("index.html").unwrap().to_vec();
    renderer.mutation = Some(f.0.join("assets/art.png"));
    assert!(
        s.capture_region(&mut renderer, ".impeccable/spec.json", "art", true)
            .is_err()
    );
    let calls = renderer.calls;
    assert!(
        s.capture_region(&mut renderer, ".impeccable/spec.json", "art", true)
            .is_err()
    );
    assert_eq!(
        renderer.calls, calls,
        "stale input must fail before renderer launch"
    );
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
fn native_browser_capture_is_bound_to_frozen_entry_spec_and_asset() {
    use impeccable::asset_capture::CdpAssetRenderer;
    use impeccable_comp::{png_io, raster};
    use std::sync::Arc;
    let env = std::env::vars().collect();
    if impeccable_browser::discovery::find_browser(&env).is_err() {
        eprintln!("skip: browser unavailable");
        return;
    }
    let f = Fixture::new();
    fs::write(f.0.join("index.html"),"<!doctype html><style>body{margin:0;background:white}img{position:absolute;left:20px;top:20px;width:80px;height:80px}</style><img src='assets/art.png'>").unwrap();
    let image = png_io::encode_png(&raster::create_image(32, 32, [231, 60, 30, 255]), &[]).unwrap();
    fs::write(f.0.join("assets/art.png"), &image).unwrap();
    fs::write(f.0.join(".impeccable/comp.png"), &image).unwrap();
    fs::write(f.0.join(".impeccable/spec.json"),br#"{"comp":".impeccable/comp.png","compSize":{"width":200,"height":200},"regions":[{"id":"art","plate":"assets/art.png","px":{"x":20,"y":20,"w":80,"h":80}}]}"#).unwrap();
    let snapshot = Arc::new(HtmlSnapshot::freeze(f.selection()).unwrap());
    let capture = snapshot
        .capture_region(
            &mut CdpAssetRenderer::from_process_env(),
            ".impeccable/spec.json",
            "art",
            true,
        )
        .unwrap();
    assert_eq!(capture.receipt["status"], "captured", "{}", capture.receipt);
    assert_eq!(
        capture.receipt["combinedContribution"]["changedPixelsInRegion"],
        6400
    );
    assert_eq!(
        capture.receipt["inputSnapshot"]["digest"],
        snapshot.digest()
    );
}

#[test]
fn batch_uses_one_document_and_rejects_mixed_inputs() {
    use impeccable::asset_capture::CdpAssetRenderer;
    use impeccable_comp::{png_io, raster};
    use impeccable_comp_verbs::asset_capture::{AssetCaptureRequest, AssetRenderer, CaptureBox};
    use std::sync::Arc;
    let env = std::env::vars().collect();
    if impeccable_browser::discovery::find_browser(&env).is_err() {
        eprintln!("skip: browser unavailable");
        return;
    }
    let f = Fixture::new();
    // A page-generated token must be identical for every measured region in the batch.
    fs::write(f.0.join("index.html"),"<!doctype html><style>body{margin:0;background:white}img{position:absolute;width:80px;height:80px}</style><img src='assets/art.png' style='left:20px;top:20px'><img src='assets/art.png' style='left:110px;top:110px'><script>document.body.dataset.visit=crypto.randomUUID()</script>").unwrap();
    let image = png_io::encode_png(&raster::create_image(32, 32, [231, 60, 30, 255]), &[]).unwrap();
    fs::write(f.0.join("assets/art.png"), &image).unwrap();
    fs::write(f.0.join(".impeccable/comp.png"), &image).unwrap();
    fs::write(f.0.join(".impeccable/spec.json"),br#"{"comp":".impeccable/comp.png","compSize":{"width":200,"height":200},"regions":[{"id":"first","plate":"assets/art.png","px":{"x":20,"y":20,"w":80,"h":80}},{"id":"second","plate":"assets/art.png","px":{"x":110,"y":110,"w":80,"h":80}}]}"#).unwrap();
    let snapshot = Arc::new(HtmlSnapshot::freeze(f.selection()).unwrap());
    let server = snapshot.serve().unwrap();
    let make = |x| AssetCaptureRequest {
        url: server.entry_url(),
        viewport: [200, 200],
        reduced_motion: true,
        reference_bytes: image.clone(),
        asset_bytes: image.clone(),
        expected_box: CaptureBox {
            x,
            y: x,
            w: 80.,
            h: 80.,
        },
    };
    let mut renderer = CdpAssetRenderer::from_process_env();
    let captures = snapshot
        .capture_regions(
            &mut renderer,
            ".impeccable/spec.json",
            &["first", "second"],
            true,
        )
        .unwrap();
    assert_eq!(captures.len(), 2);
    for capture in &captures {
        assert_eq!(capture.receipt["status"], "captured", "{}", capture.receipt);
        assert_eq!(
            capture.receipt["combinedContribution"]["changedPixelsInRegion"],
            6400
        );
        assert_eq!(
            capture.receipt["domSha256"],
            captures[0].receipt["domSha256"]
        );
        assert_eq!(
            capture.receipt["screenshotSha256"],
            captures[0].receipt["screenshotSha256"]
        );
        assert_eq!(
            capture.receipt["captureDocument"],
            captures[0].receipt["captureDocument"]
        );
    }
    let mut wrong = make(110.);
    wrong.url.push_str("?other-entry");
    assert!(renderer.capture_batch(&[make(20.), wrong]).is_err());
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

#[test]
fn viewport_capture_does_not_switch_responsive_picture_sources() {
    use impeccable::asset_capture::CdpAssetRenderer;
    use impeccable_comp::{png_io, raster};
    use std::sync::Arc;
    if impeccable_browser::discovery::find_browser(&std::env::vars().collect()).is_err() {
        return;
    }
    let f = Fixture::new();
    fs::write(f.0.join("index.html"), "<!doctype html><style>body{margin:0;min-height:2400px;background:white}img{position:absolute;left:20px;top:20px;width:80px;height:80px}</style><picture><source media='(max-width:900px)' srcset='assets/mobile.png'><img src='assets/art.png'></picture>").unwrap();
    let image = png_io::encode_png(&raster::create_image(32, 32, [231, 60, 30, 255]), &[]).unwrap();
    let mobile =
        png_io::encode_png(&raster::create_image(32, 32, [30, 60, 231, 255]), &[]).unwrap();
    fs::write(f.0.join("assets/art.png"), &image).unwrap();
    fs::write(f.0.join("assets/mobile.png"), mobile).unwrap();
    fs::write(f.0.join(".impeccable/comp.png"), &image).unwrap();
    fs::write(f.0.join(".impeccable/spec.json"), br#"{"comp":".impeccable/comp.png","compSize":{"width":1440,"height":960},"regions":[{"id":"art","plate":"assets/art.png","px":{"x":20,"y":20,"w":80,"h":80}}]}"#).unwrap();
    let mut selection = f.selection();
    selection.served.push("assets/mobile.png".into());
    let snapshot = Arc::new(HtmlSnapshot::freeze(selection).unwrap());
    let captures = snapshot
        .capture_regions(
            &mut CdpAssetRenderer::from_process_env(),
            ".impeccable/spec.json",
            &["art"],
            true,
        )
        .unwrap();
    for capture in &captures {
        assert_eq!(capture.receipt["status"], "captured", "{}", capture.receipt);
        assert_eq!(
            capture.receipt["combinedContribution"]["changedPixelsInRegion"],
            6400
        );
        assert_eq!(capture.receipt["batchStabilityVerified"], true);
        let responses = capture.receipt["settlingResponses"].as_array().unwrap();
        assert!(
            !responses
                .iter()
                .any(|r| r["url"].as_str().unwrap_or("").ends_with("mobile.png"))
        );
    }
}
