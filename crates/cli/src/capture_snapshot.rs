//! Immutable, explicit static-HTML inputs for native capture. Not a framework server.
//! The native caller owns the selection; private bound inputs are never HTTP routes.
use impeccable_comp_verbs::asset_capture::capture_sha256 as hash;
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File},
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Component, Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread::{self, JoinHandle},
    time::Duration,
};

const MAX_FILES: usize = 1024;
const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES: usize = 128 * 1024 * 1024;

pub struct SnapshotSelection {
    pub root: PathBuf,
    pub entry: String,
    /// Explicit local static dependencies, including the entry. No directory crawling.
    pub served: Vec<String>,
    /// Spec, reference and other gate inputs. Hashed but never served unless also in served.
    pub bound: Vec<String>,
}
pub struct HtmlSnapshot {
    root: PathBuf,
    entry: String,
    served: BTreeSet<String>,
    files: BTreeMap<String, Vec<u8>>,
    manifest: Value,
    digest: String,
}
impl HtmlSnapshot {
    pub fn freeze(selection: SnapshotSelection) -> Result<Self, String> {
        let root = fs::canonicalize(&selection.root).map_err(|e| format!("snapshot root: {e}"))?;
        if !root.is_dir() {
            return Err("snapshot root is not a directory".into());
        }
        valid_relative(&selection.entry)?;
        if !matches!(
            Path::new(&selection.entry)
                .extension()
                .and_then(|s| s.to_str()),
            Some("html" | "htm")
        ) {
            return Err(
                "snapshot requires an HTML entry; framework build binding is unsupported".into(),
            );
        }
        let served: BTreeSet<_> = selection.served.into_iter().collect();
        if !served.contains(&selection.entry) {
            return Err("selected entry is not served".into());
        }
        for name in &served {
            valid_relative(name)?;
            if name.split('/').any(|p| p.starts_with('.')) || mime(name).is_none() {
                return Err(format!("not an allowed static dependency: {name}"));
            }
        }
        let names: BTreeSet<_> = served.iter().cloned().chain(selection.bound).collect();
        if names.len() > MAX_FILES {
            return Err("snapshot exceeds file limit".into());
        }
        let mut files = BTreeMap::new();
        let mut total = 0;
        for name in names {
            let bytes = read_input(&root, &name)?;
            total += bytes.len();
            if total > MAX_TOTAL_BYTES {
                return Err("snapshot exceeds total byte limit".into());
            }
            files.insert(name, bytes);
        }
        let manifest = json!({"schema":"native-html-input-snapshot-v1","entry":selection.entry,
            "files":files.iter().map(|(name,bytes)|json!({"path":name,"sha256":hash(bytes),"bytes":bytes.len(),"served":served.contains(name)})).collect::<Vec<_>>()});
        let digest = hash(&serde_json::to_vec(&manifest).map_err(|e| e.to_string())?);
        let snapshot = Self {
            root,
            entry: selection.entry,
            served,
            files,
            manifest,
            digest,
        };
        snapshot.verify_current()?;
        Ok(snapshot)
    }
    /// Fresh in-process diagnostic evidence. Persisted receipts are deliberately not inputs.
    pub fn capture_region(
        self: &Arc<Self>,
        renderer: &mut dyn impeccable_comp_verbs::asset_capture::AssetRenderer,
        spec_path: &str,
        region_id: &str,
        reduced_motion: bool,
    ) -> Result<impeccable_comp_verbs::asset_capture::AssetCapture, String> {
        self.capture_regions(renderer, spec_path, &[region_id], reduced_motion)?
            .into_iter()
            .next()
            .ok_or_else(|| "capture returned no evidence".into())
    }
    /// Every requested region shares one frozen snapshot, server and browser document.
    pub fn capture_regions(
        self: &Arc<Self>,
        renderer: &mut dyn impeccable_comp_verbs::asset_capture::AssetRenderer,
        spec_path: &str,
        region_ids: &[&str],
        reduced_motion: bool,
    ) -> Result<Vec<impeccable_comp_verbs::asset_capture::AssetCapture>, String> {
        self.capture_regions_at_viewport(renderer, spec_path, region_ids, reduced_motion, None)
    }
    /// Desktop/mobile captures retain the comp-owned region coordinates scaled
    /// to the requested width. Reflow fidelity remains a separate gate concern.
    pub fn capture_regions_at_viewport(
        self: &Arc<Self>,
        renderer: &mut dyn impeccable_comp_verbs::asset_capture::AssetRenderer,
        spec_path: &str,
        region_ids: &[&str],
        reduced_motion: bool,
        viewport: Option<[u32; 2]>,
    ) -> Result<Vec<impeccable_comp_verbs::asset_capture::AssetCapture>, String> {
        use impeccable_comp_verbs::asset_capture::AssetCaptureRequest;
        self.verify_current()?;
        if region_ids.is_empty()
            || region_ids.len() > 32
            || region_ids.iter().copied().collect::<BTreeSet<_>>().len() != region_ids.len()
        {
            return Err("capture requires 1 to 32 distinct regions".into());
        }
        let spec: Value = serde_json::from_slice(
            self.bytes(spec_path)
                .ok_or("spec is not bound to snapshot")?,
        )
        .map_err(|e| e.to_string())?;
        let reference = spec["comp"].as_str().ok_or("spec has no reference")?;
        let width = u32::try_from(
            spec["compSize"]["width"]
                .as_u64()
                .ok_or("missing reference width")?,
        )
        .map_err(|e| e.to_string())?;
        let height = u32::try_from(
            spec["compSize"]["height"]
                .as_u64()
                .ok_or("missing reference height")?,
        )
        .map_err(|e| e.to_string())?;
        let scale = viewport.map(|v| v[0] as f64 / width as f64).unwrap_or(1.);
        let [width, height] = viewport.unwrap_or([width, height]);
        let server = self.serve()?;
        let mut requests = Vec::new();
        for region_id in region_ids {
            let regions: Vec<_> = spec["regions"]
                .as_array()
                .ok_or("missing regions")?
                .iter()
                .filter(|r| r["id"] == *region_id)
                .collect();
            if regions.len() != 1 {
                return Err("region must resolve uniquely in bound spec".into());
            }
            let region = regions[0];
            let asset = region["plate"].as_str().ok_or("region has no asset path")?;
            if !self.served.contains(asset) {
                return Err("required asset is not served by snapshot".into());
            }
            let request = AssetCaptureRequest {
                url: server.entry_url(),
                viewport: [width, height],
                reduced_motion,
                expected_box: {
                    let mut b: impeccable_comp_verbs::asset_capture::CaptureBox =
                        serde_json::from_value(region["px"].clone()).map_err(|e| e.to_string())?;
                    b.x *= scale;
                    b.y *= scale;
                    b.w *= scale;
                    b.h *= scale;
                    b
                },
                reference_bytes: self
                    .bytes(reference)
                    .ok_or("reference is not bound to snapshot")?
                    .to_vec(),
                asset_bytes: self
                    .bytes(asset)
                    .ok_or("asset is not bound to snapshot")?
                    .to_vec(),
            };
            request.validate()?;
            requests.push(request);
        }
        let mut captures = if requests.len() == 1 {
            vec![renderer.capture(&requests[0])?]
        } else {
            renderer.capture_batch(&requests)?
        };
        self.verify_current()?;
        if captures.len() != requests.len() {
            return Err("native capture omitted requested regions".into());
        }
        for ((capture, request), region_id) in captures.iter_mut().zip(&requests).zip(region_ids) {
            let receipt = &capture.receipt;
            if receipt["status"] == "captured" || receipt["stableCapture"] == true {
                let entry = self.bytes(&self.entry).unwrap();
                // Text responses arrive decoded; bind them to the text these bytes decode to.
                let document = if receipt["documentResponseText"] == true {
                    hash(&impeccable_browser::response_capture::decoded_text(entry))
                } else {
                    hash(entry)
                };
                let expected = json!({
                    "resolvedUrl": request.url,
                    "documentResponseSha256": document,
                    "assetSha256": hash(&request.asset_bytes),
                    "referenceSha256": hash(&request.reference_bytes),
                    "viewport": {"width": width, "height": height, "dpr": 1},
                    "expectedBox": request.expected_box,
                    "reducedMotion": reduced_motion,
                });
                let mismatches: Vec<_> = expected.as_object().unwrap().iter()
                    .filter(|(key, value)| receipt[*key] != **value)
                    .map(|(key, _)| key.as_str()).collect();
                if !mismatches.is_empty() {
                    return Err(format!(
                        "native capture does not match frozen inputs and document ({region_id}: {})",
                        mismatches.join(", ")
                    ));
                }
            }
            capture.receipt["regionId"] = json!(region_id);
            capture.receipt["inputSnapshot"] = json!({"digest":self.digest,"manifest":self.manifest,"originalInputsVerified":true});
        }
        Ok(captures)
    }
    pub fn digest(&self) -> &str {
        &self.digest
    }
    pub fn manifest(&self) -> &Value {
        &self.manifest
    }
    pub fn entry(&self) -> &str {
        &self.entry
    }
    pub fn bytes(&self, name: &str) -> Option<&[u8]> {
        self.files.get(name).map(Vec::as_slice)
    }
    pub fn verify_current(&self) -> Result<(), String> {
        for (name, bytes) in &self.files {
            if read_input(&self.root, name)? != *bytes {
                return Err(format!("capture input changed: {name}"));
            }
        }
        Ok(())
    }
    /// Strict origin-form routes. Decode percent-encoded UTF-8, but never separators.
    pub fn serve_path(&self, target: &str) -> Option<String> {
        let raw = target.strip_prefix('/')?.split('?').next()?;
        let mut bytes = Vec::new();
        let input = raw.as_bytes();
        let mut i = 0;
        while i < input.len() {
            if input[i] == b'%' {
                let hex = std::str::from_utf8(input.get(i + 1..i + 3)?).ok()?;
                let byte = u8::from_str_radix(hex, 16).ok()?;
                if matches!(byte, b'/' | b'\\' | 0) {
                    return None;
                }
                bytes.push(byte);
                i += 3;
            } else {
                bytes.push(input[i]);
                i += 1;
            }
        }
        let name = String::from_utf8(bytes).ok()?;
        valid_relative(&name).ok()?;
        self.served.contains(&name).then_some(name)
    }
    pub fn serve(self: &Arc<Self>) -> Result<SnapshotServer, String> {
        let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        let addr = listener.local_addr().map_err(|e| e.to_string())?;
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let host = addr.to_string();
        let stop = Arc::new(AtomicBool::new(false));
        let worker_stop = stop.clone();
        let snapshot = self.clone();
        let worker_host = host.clone();
        let worker = thread::spawn(move || {
            while !worker_stop.load(Ordering::Acquire) {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let _ = respond(&mut stream, &worker_host, &snapshot);
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(5))
                    }
                    Err(_) => break,
                }
            }
        });
        Ok(SnapshotServer {
            host,
            entry: self.entry.clone(),
            stop,
            worker: Some(worker),
        })
    }
}
fn valid_relative(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name.contains(['\\', '\0', '?', '#', ':'])
        || name
            .split('/')
            .any(|p| p.is_empty() || p == "." || p == "..")
        || Path::new(name)
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(format!("invalid snapshot path: {name}"));
    }
    Ok(())
}
fn read_input(root: &Path, name: &str) -> Result<Vec<u8>, String> {
    valid_relative(name)?;
    let inspect = || -> Result<fs::Metadata, String> {
        if fs::symlink_metadata(root)
            .map_err(|e| e.to_string())?
            .file_type()
            .is_symlink()
        {
            return Err("snapshot root replaced by symlink".into());
        }
        let mut path = root.to_path_buf();
        for part in Path::new(name).components() {
            path.push(part);
            let m =
                fs::symlink_metadata(&path).map_err(|e| format!("snapshot input {name}: {e}"))?;
            if m.file_type().is_symlink() {
                return Err(format!("symlink snapshot input: {name}"));
            }
        }
        let m = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        if !m.is_file() || m.len() > MAX_FILE_BYTES {
            return Err(format!("unsupported or oversized input: {name}"));
        }
        Ok(m)
    };
    let before = inspect()?;
    let mut file = File::open(root.join(name)).map_err(|e| e.to_string())?;
    let opened = file.metadata().map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if before.dev() != opened.dev() || before.ino() != opened.ino() {
            return Err(format!("input replaced while opening: {name}"));
        }
    }
    if !opened.is_file() || opened.len() > MAX_FILE_BYTES {
        return Err(format!("unsupported or oversized input: {name}"));
    }
    let mut bytes = Vec::new();
    (&mut file)
        .take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    let after = inspect()?;
    if bytes.len() as u64 > MAX_FILE_BYTES
        || before.len() != after.len()
        || before.modified().ok() != after.modified().ok()
        || bytes.len() as u64 != after.len()
    {
        return Err(format!("input changed while reading: {name}"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if before.dev() != after.dev() || before.ino() != after.ino() {
            return Err(format!("input replaced while reading: {name}"));
        }
    }
    Ok(bytes)
}
fn mime(name: &str) -> Option<&'static str> {
    Some(match Path::new(name).extension()?.to_str()? {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        _ => return None,
    })
}
fn encode_path(path: &str) -> String {
    path.bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || matches!(b, b'/' | b'-' | b'_' | b'.' | b'~') {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}
pub struct SnapshotServer {
    host: String,
    entry: String,
    stop: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}
impl SnapshotServer {
    pub fn entry_url(&self) -> String {
        format!("http://{}/{}", self.host, encode_path(&self.entry))
    }
}
impl Drop for SnapshotServer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}
fn respond(
    stream: &mut TcpStream,
    host: &str,
    snapshot: &HtmlSnapshot,
) -> Result<(), std::io::Error> {
    // BSD/macOS can inherit O_NONBLOCK from the listening socket. Explicitly
    // switch accepted streams back before write_all; otherwise large bodies
    // stop at EWOULDBLOCK and appear as valid-header/truncated-image responses.
    stream.set_nonblocking(false)?;
    stream.set_read_timeout(Some(Duration::from_secs(2)))?;
    stream.set_write_timeout(Some(Duration::from_secs(2)))?;
    let mut bytes = Vec::new();
    let mut buf = [0u8; 1024];
    while bytes.len() <= 8192 && !bytes.windows(4).any(|x| x == b"\r\n\r\n") {
        let n = stream.read(&mut buf)?;
        if n == 0 {
            return Ok(());
        }
        bytes.extend_from_slice(&buf[..n]);
    }
    let request = std::str::from_utf8(&bytes).unwrap_or("");
    let mut lines = request.split("\r\n");
    let mut first = lines.next().unwrap_or("").split_whitespace();
    let method = first.next();
    let target = first.next();
    let protocol = first.next();
    let hosts: Vec<_> = lines
        .filter_map(|line| line.split_once(':'))
        .filter(|(key, _)| key.eq_ignore_ascii_case("host"))
        .map(|(_, value)| value.trim())
        .collect();
    let valid = bytes.len() <= 8192
        && method == Some("GET")
        && protocol == Some("HTTP/1.1")
        && first.next().is_none()
        && hosts == [host];
    let route = if valid {
        target.and_then(|t| snapshot.serve_path(t))
    } else {
        None
    };
    let (status, kind, body) = match route.as_deref() {
        Some(name) => ("200 OK", mime(name).unwrap(), snapshot.bytes(name).unwrap()),
        None => ("404 Not Found", "text/plain", b"Not found".as_slice()),
    };
    write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: private, max-age=3600, immutable\r\nX-Content-Type-Options: nosniff\r\n\r\n",
        body.len()
    )?;
    stream.write_all(body)
}
