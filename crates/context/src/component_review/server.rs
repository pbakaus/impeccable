use super::{
    manifest::{digest, relative},
    store,
};
use impeccable_common::Io;
use serde_json::{json, Value};
use std::{
    io::Read,
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

const JS: &str = include_str!("../../assets/component-review.js");
const HTML: &str = "<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Component review · Impeccable</title><link rel='stylesheet' href='/review.css'></head><body><main id='review'></main><script src='/review.js' defer></script></body></html>";
const CSS: &str = "@font-face{font-family:Albert Sans;src:url(/fonts/albertsans.ttf)}@font-face{font-family:Alumni Sans;src:url(/fonts/alumnisans.ttf)}@font-face{font-family:JetBrains Mono;src:url(/fonts/jetbrainsmono.ttf)}body{margin:0;background:#fafafa;--font-sans:'Albert Sans',Arial,sans-serif;--font-display:'Alumni Sans',Arial,sans-serif;--font-mono:'JetBrains Mono',monospace}body>p{padding:24px;font:16px var(--font-sans)}";
fn respond(req: tiny_http::Request, code: u16, body: Vec<u8>, mime: &str, csp: &str) {
    let mut response = tiny_http::Response::from_data(body).with_status_code(code);
    for (k, v) in [
        ("Content-Type", mime),
        ("Cache-Control", "no-store"),
        ("X-Content-Type-Options", "nosniff"),
        ("Content-Security-Policy", csp),
        ("Referrer-Policy", "no-referrer"),
    ] {
        response = response.with_header(tiny_http::Header::from_bytes(k, v).unwrap());
    }
    if mime.starts_with("font/") {
        response = response.with_header(
            tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap(),
        );
    }
    let _ = req.respond(response);
}
fn header<'a>(req: &'a tiny_http::Request, name: &'static str) -> Option<&'a str> {
    req.headers()
        .iter()
        .find(|h| h.field.equiv(name))
        .map(|h| h.value.as_str())
}
pub fn authorized(
    method: &str,
    host: Option<&str>,
    origin: Option<&str>,
    site: Option<&str>,
    port: u16,
) -> bool {
    let expected = format!("127.0.0.1:{port}");
    host == Some(expected.as_str())
        && (method != "POST"
            || (origin == Some(format!("http://{expected}").as_str())
                && site == Some("same-origin")))
}
pub fn packet_state(dir: &Path, revision: Option<&str>) -> Result<Value, String> {
    let current = store::read(&dir.join("current.json"))?;
    let historical = revision.is_some_and(|rev| current["packet"]["revision"] != rev);
    let state = if historical {
        let rev = revision.unwrap();
        if rev.len() != 64 || !rev.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("invalid packet revision".into());
        }
        let state = store::read(&dir.join(format!("revisions/{rev}.json")))?;
        if state["packet"]["revision"] != rev {
            return Err("packet revision mismatch".into());
        }
        state
    } else {
        current
    };
    let source_status = if historical {
        if state["receipt"].is_null() {
            Some("This unsubmitted review was superseded by a newer capture.".to_string())
        } else {
            None
        }
    } else if super::lifecycle::closed(&state) {
        None
    } else {
        store::sources_current(&state).err()
    };
    Ok(
        json!({"packet":state["packet"],"draft":state["draft"],"history":state["history"],"receipt":state["receipt"],"sourceStatus":source_status,"historical":historical}),
    )
}
/// How long `serve` waits: `idle` with no request, and `grace` of quiet after the
/// round has a receipt, so the page's submit response lands before the exit.
pub struct Limits {
    pub idle: std::time::Duration,
    pub grace: std::time::Duration,
}
/// Exit 0 once the round has the user's submission, 4 when it closes without
/// one (idle timeout or interrupt). service.json never outlives the server.
pub fn serve(dir: &Path, port: u16, io: &mut Io, limits: Limits, stop: Option<&AtomicBool>) -> Result<i32, String> {
    store::read(&dir.join("current.json"))?;
    let server = tiny_http::Server::http(("127.0.0.1", port)).map_err(|e| e.to_string())?;
    let actual = server
        .server_addr()
        .to_ip()
        .ok_or("listener is not TCP")?
        .port();
    let service = json!({"url":format!("http://127.0.0.1:{actual}/"),"pid":std::process::id()});
    store::write(&dir.join("service.json"), &service)?;
    struct Registration<'a>(&'a Path);
    impl Drop for Registration<'_> {
        fn drop(&mut self) {
            let path = self.0.join("service.json");
            if store::read(&path).is_ok_and(|s| s["pid"] == std::process::id()) {
                let _ = std::fs::remove_file(path);
            }
        }
    }
    let _registration = Registration(dir);
    io.out(&format!("COMPONENT REVIEW: {}\n", service));
    let trusted_csp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
    let mut last = Instant::now();
    loop {
        if stop.is_some_and(|s| s.load(Ordering::SeqCst)) {
            return Ok(4);
        }
        let quiet = last.elapsed();
        if quiet >= limits.grace
            && store::read(&dir.join("current.json")).is_ok_and(|s| !s["receipt"].is_null())
        {
            io.out("COMPONENT REVIEW: submitted\n");
            return Ok(0);
        }
        if quiet >= limits.idle {
            io.out("COMPONENT REVIEW: closed after the idle timeout without a decision\n");
            return Ok(4);
        }
        let wait = limits.grace.min(limits.idle).min(Duration::from_secs(1));
        let Some(mut req) = server.recv_timeout(wait).map_err(|e| e.to_string())? else {
            continue;
        };
        last = Instant::now();
        let method = req.method().as_str().to_string();
        let path = req.url().split('?').next().unwrap_or("").to_string();
        if !authorized(
            &method,
            header(&req, "Host"),
            header(&req, "Origin"),
            header(&req, "Sec-Fetch-Site"),
            actual,
        ) {
            respond(
                req,
                403,
                b"Request origin refused".to_vec(),
                "text/plain",
                trusted_csp,
            );
            continue;
        }
        let result: Result<(Vec<u8>, &str), String> = (|| {
            match (method.as_str(), path.as_str()) {
                ("GET", "/") => Ok((HTML.as_bytes().to_vec(), "text/html; charset=utf-8")),
                ("GET", "/review.js") => {
                    Ok((JS.as_bytes().to_vec(), "text/javascript; charset=utf-8"))
                }
                ("GET", "/review.css") => Ok((CSS.as_bytes().to_vec(), "text/css")),
                ("GET", "/fonts/albertsans.ttf") => Ok((
                    include_bytes!("../../../../ui/component-review/fonts/albertsans.ttf").to_vec(),
                    "font/ttf",
                )),
                ("GET", "/fonts/alumnisans.ttf") => Ok((
                    include_bytes!("../../../../ui/component-review/fonts/alumnisans.ttf").to_vec(),
                    "font/ttf",
                )),
                ("GET", "/fonts/jetbrainsmono.ttf") => Ok((
                    include_bytes!("../../../../ui/component-review/fonts/jetbrainsmono.ttf")
                        .to_vec(),
                    "font/ttf",
                )),
                ("GET", "/packet") => Ok((
                    serde_json::to_vec(&packet_state(dir, None)?).unwrap(),
                    "application/json",
                )),
                ("POST", "/decision") => {
                    if !header(&req, "Content-Type")
                        .is_some_and(|t| t.starts_with("application/json"))
                    {
                        return Err("expected application/json".into());
                    }
                    let mut data = Vec::new();
                    req.as_reader()
                        .take(512 * 1024 + 1)
                        .read_to_end(&mut data)
                        .map_err(|e| e.to_string())?;
                    if data.len() > 512 * 1024 {
                        return Err("decision exceeds 512 KiB".into());
                    }
                    let body: Value = serde_json::from_slice(&data).map_err(|e| e.to_string())?;
                    Ok((
                        serde_json::to_vec(&store::submit(dir, &body)?).unwrap(),
                        "application/json",
                    ))
                }
                _ if method == "GET" && path.starts_with("/packet/") => Ok((
                    serde_json::to_vec(&packet_state(dir, Some(&path[8..]))?).unwrap(),
                    "application/json",
                )),
                _ if method == "GET" && path.starts_with("/files/") => {
                    let rest = &path[7..];
                    let (rev, encoded) = rest.split_once('/').ok_or("invalid file route")?;
                    if rev.len() != 64 || !rev.bytes().all(|b| b.is_ascii_hexdigit()) {
                        return Err("invalid revision".into());
                    }
                    // Only percent-encoded UTF-8/spaces are decoded; relative() rejects traversal and control URL syntax.
                    let name = super::decode_path(encoded)?;
                    relative(&name)?;
                    let state = store::read(&dir.join(format!("revisions/{rev}.json")))?;
                    let hash = state["files"][&name]
                        .as_str()
                        .ok_or("file was not pinned in this review")?;
                    let bytes =
                        std::fs::read(dir.join("blobs").join(hash)).map_err(|e| e.to_string())?;
                    if digest(&bytes) != hash {
                        return Err("review snapshot integrity failure".into());
                    }
                    let mime = match name
                        .rsplit('.')
                        .next()
                        .unwrap_or("")
                        .to_ascii_lowercase()
                        .as_str()
                    {
                        "html" | "htm" => "text/html; charset=utf-8",
                        "css" => "text/css",
                        "png" => "image/png",
                        "jpg" | "jpeg" => "image/jpeg",
                        "webp" => "image/webp",
                        "svg" => "image/svg+xml",
                        "woff2" => "font/woff2",
                        "woff" => "font/woff",
                        "ttf" => "font/ttf",
                        _ => "application/octet-stream",
                    };
                    Ok((bytes, mime))
                }
                _ => Err("route not found".into()),
            }
        })();
        let file_csp = "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; script-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'; sandbox; frame-ancestors 'self'";
        let csp = if path.starts_with("/files/") {
            file_csp
        } else {
            trusted_csp
        };
        match result {
            Ok((body, mime)) => respond(req, 200, body, mime, csp),
            Err(error) => respond(
                req,
                409,
                serde_json::to_vec(&json!({"error":error})).unwrap(),
                "application/json",
                csp,
            ),
        }
    }
}
