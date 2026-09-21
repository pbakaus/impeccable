//! Project-scoped capture transport. Approval still belongs to the shared gate.
//! Host adapters must independently audit retained evidence before accepting a run.
use crate::reviewed_entry::ReviewedEntryRenderer;
use base64::Engine;
use impeccable_comp_verbs::entry_capture::{
    CapturedEntry, EntryRenderer, EntryRequest, EntryStage,
};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    time::{Duration, Instant},
};

fn request(stream: &TcpStream, key: &str) -> Result<(String, Value), String> {
    let mut reader = BufReader::new(stream.try_clone().map_err(|e| e.to_string())?);
    let mut first = String::new();
    reader
        .by_ref()
        .take(1025)
        .read_line(&mut first)
        .map_err(|e| e.to_string())?;
    if first.len() > 1024 {
        return Err("request line too long".into());
    }
    let parts: Vec<_> = first.split_whitespace().collect();
    if parts.len() != 3 || parts[0] != "POST" {
        return Err("POST required".into());
    }
    let route = parts[1].to_string();
    let mut total = first.len();
    let mut length = None;
    let mut authenticated = false;
    let mut key_seen = false;
    loop {
        let mut line = String::new();
        reader
            .by_ref()
            .take(8193)
            .read_line(&mut line)
            .map_err(|e| e.to_string())?;
        total += line.len();
        if total > 8192 || line.is_empty() {
            return Err("invalid headers".into());
        }
        if line == "\r\n" || line == "\n" {
            break;
        }
        let (name, value) = line.split_once(':').ok_or("invalid header")?;
        match name.to_ascii_lowercase().as_str() {
            "content-length" => {
                if length.is_some() {
                    return Err("duplicate length".into());
                }
                length = Some(
                    value
                        .trim()
                        .parse::<usize>()
                        .map_err(|_| "invalid length")?,
                );
            }
            "x-capture-key" => {
                if key_seen {
                    return Err("duplicate capability".into());
                }
                key_seen = true;
                authenticated = value.trim() == key;
            }
            "origin" | "transfer-encoding" => {
                return Err("unsupported request origin/encoding".into());
            }
            _ => {}
        }
    }
    if !authenticated {
        return Err("invalid capability".into());
    }
    let length = length.ok_or("missing length")?;
    if length > 16384 {
        return Err("request too large".into());
    }
    let mut body = vec![0; length];
    reader.read_exact(&mut body).map_err(|e| e.to_string())?;
    let body: Value = serde_json::from_slice(&body).map_err(|e| e.to_string())?;
    if !body.is_object() || body.get("root").is_some() || body.get("url").is_some() {
        return Err("registered root only; no caller URLs".into());
    }
    Ok((route, body))
}
pub fn serve(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    if args.len() != 2 {
        return Err("expected registered-root ready-file".into());
    }
    let root = std::fs::canonicalize(&args[0])?;
    let key = std::env::var("IMPECCABLE_CAPTURE_CAPABILITY")?;
    if key.len() < 32 {
        return Err("capability too short".into());
    }
    let renderer=ReviewedEntryRenderer{session:std::env::var_os("IMPECCABLE_CAPTURE_REVIEW_SESSION").map(PathBuf::from)};
    // Read host policy once. Requests cannot assert or manufacture approval.
    let component_review_pending = std::env::var("IMPECCABLE_COMPONENT_REVIEW_PENDING").as_deref() == Ok("1");
    let review_tool = std::env::var("IMPECCABLE_COMPONENT_REVIEW_TOOL").unwrap_or_else(|_| "component_review".into());
    let listener = TcpListener::bind("127.0.0.1:0")?;
    listener.set_nonblocking(true)?;
    std::fs::write(
        &args[1],
        serde_json::to_vec(&json!({"port":listener.local_addr()?.port(),"root":root}))?,
    )?;
    let started = Instant::now();
    let mut serial = 0u64;
    let mut captures: HashMap<String, (Instant, Box<dyn CapturedEntry>)> = HashMap::new();
    let mut latest: HashMap<String, String> = HashMap::new();
    let mut active = std::collections::HashSet::new();
    let session = &impeccable_comp_verbs::asset_capture::capture_sha256(key.as_bytes())[..16];
    while started.elapsed() < Duration::from_secs(10800) {
        active.retain(|id| {
            captures
                .get(id)
                .is_some_and(|(at, _)| at.elapsed() < Duration::from_secs(180))
        });
        captures.retain(|id, _| active.contains(id) || latest.values().any(|v| v == id));
        let (mut stream, _) = match listener.accept() {
            Ok(v) => v,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(10));
                continue;
            }
            Err(e) => return Err(e.into()),
        };
        stream.set_nonblocking(false)?;
        stream.set_read_timeout(Some(Duration::from_secs(5)))?;
        stream.set_write_timeout(Some(Duration::from_secs(10)))?;
        let answer = (|| -> Result<Value, String> {
            let (route, body) = request(&stream, &key)?;
            let text = |k: &str| body[k].as_str().ok_or_else(|| format!("missing {k}"));
            match route.as_str() {
                "/capture" => {
                    require_component_review(component_review_pending, &review_tool)?;
                    if active.len() >= 2 {
                        return Err("active capture limit".into());
                    }
                    let stage = match text("stage")? {
                        "hero" => EntryStage::Hero,
                        "responsive" => EntryStage::Responsive,
                        _ => return Err("invalid stage".into()),
                    };
                    let captured = renderer.capture_entry(&EntryRequest {
                        root: PathBuf::from(&root),
                        artifact: text("entry")?.into(),
                        spec: text("spec")?.into(),
                        reference: text("reference")?.into(),
                        stage,
                    })?;
                    serial += 1;
                    let handle = format!("{session}-{serial}");
                    let stage_name = text("stage")?.to_string();
                    let captured = ServiceEntry::new(captured, handle.clone(), &root);
                    let evidence = captured.evidence();
                    let frames:Vec<_>=evidence.frames.iter().map(|f|json!({"name":f.name,"png":base64::engine::general_purpose::STANDARD.encode(&f.png),"regions":f.regions.iter().map(|r|r.receipt.clone()).collect::<Vec<_>>()})).collect();
                    let response =
                        json!({"ok":true,"handle":handle,"report":evidence.report,"frames":frames,"approvedReference":captured.approved_reference().map(|a|json!({"png":base64::engine::general_purpose::STANDARD.encode(&a.png),"proof":a.proof}))});
                    if serde_json::to_vec(&response)
                        .map_err(|e| e.to_string())?
                        .len()
                        > 64 * 1024 * 1024
                    {
                        return Err("response budget exceeded".into());
                    }
                    latest.insert(stage_name, handle.clone());
                    active.insert(handle.clone());
                    captures.insert(handle, (Instant::now(), Box::new(captured)));
                    Ok(response)
                }
                "/verify" => {
                    let handle = text("handle")?;
                    if !active.contains(handle) {
                        return Err("unknown or released capture".into());
                    }
                    let (_, capture) = captures.get(handle).ok_or("unknown capture")?;
                    capture.verify_current()?;
                    Ok(json!({"ok":true}))
                }
                "/release" => Ok(json!({"ok":active.remove(text("handle")?)})),
                "/audit" => {
                    let stage = text("stage")?;
                    if !matches!(stage, "hero" | "responsive") {
                        return Err("invalid stage".into());
                    }
                    let id = latest.get(stage).ok_or("no host capture for stage")?;
                    let (_, capture) = captures.get(id).ok_or("missing host capture")?;
                    let saved_evidence = audit_saved(&root, stage, capture.as_ref())?;
                    Ok(
                        json!({"ok":true,"captureId":id,"inputSnapshot":capture.evidence().report["inputSnapshot"],"manifest":capture.evidence().report["manifest"],"savedEvidence":saved_evidence,"stage":stage}),
                    )
                }
                _ => Err("unknown operation".into()),
            }
        })();
        let (status, body) = match answer {
            Ok(v) => (200, v),
            Err(e) => (400, json!({"ok":false,"error":e})),
        };
        let bytes = serde_json::to_vec(&body)?;
        let header = format!(
            "HTTP/1.1 {status} Result\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            bytes.len()
        );
        let _ = stream
            .write_all(header.as_bytes())
            .and_then(|_| stream.write_all(&bytes));
    }
    Ok(())
}

struct ServiceEntry {
    source: Box<dyn CapturedEntry>,
    evidence: impeccable_comp_verbs::entry_capture::EntryEvidence,
}
impl ServiceEntry {
    fn new(source: Box<dyn CapturedEntry>, id: String, root: &std::path::Path) -> Self {
        use impeccable_comp_verbs::{
            asset_capture::AssetCapture,
            entry_capture::{EntryEvidence, FrameEvidence},
        };
        let e = source.evidence();
        let mut report = e.report.clone();
        report["captureService"] =
            json!({"schema":"native-capture-service-v1","id":id,"registeredRoot":root});
        let frames = e
            .frames
            .iter()
            .map(|f| FrameEvidence {
                name: f.name.clone(),
                png: f.png.clone(),
                regions: f
                    .regions
                    .iter()
                    .map(|r| AssetCapture {
                        receipt: r.receipt.clone(),
                        images: vec![],
                    })
                    .collect(),
            })
            .collect();
        Self {
            source,
            evidence: EntryEvidence { report, frames },
        }
    }
}
impl CapturedEntry for ServiceEntry {
    fn approved_reference(&self)->Option<&impeccable_comp_verbs::entry_capture::ApprovedReference>{self.source.approved_reference()}
    fn evidence(&self) -> &impeccable_comp_verbs::entry_capture::EntryEvidence {
        &self.evidence
    }
    fn verify_current(&self) -> Result<(), String> {
        self.source.verify_current()
    }
}

fn saved(root: &std::path::Path, relative: &str) -> Result<Vec<u8>, String> {
    let mut path = root.to_path_buf();
    for c in std::path::Path::new(relative).components() {
        let std::path::Component::Normal(c) = c else {
            return Err("invalid saved evidence path".into());
        };
        path.push(c);
        if std::fs::symlink_metadata(&path)
            .map_err(|e| e.to_string())?
            .file_type()
            .is_symlink()
        {
            return Err("symlink in saved evidence".into());
        }
    }
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    if !file.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("saved evidence is not a file".into());
    }
    let mut bytes = Vec::new();
    file.take(64 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 64 * 1024 * 1024 {
        return Err("saved evidence exceeds budget".into());
    }
    Ok(bytes)
}
fn audit_saved(
    root: &std::path::Path,
    stage: &str,
    capture: &dyn CapturedEntry,
) -> Result<Vec<Value>, String> {
    capture.verify_current()?;
    let base = format!(".impeccable/review/native/{stage}");
    let evidence = capture.evidence();
    let mut files = Vec::new();
    let mut read = |name: &str| -> Result<Vec<u8>, String> {
        let path = format!("{base}/{name}");
        let bytes = saved(root, &path)?;
        files.push(json!({"path":path,"bytes":bytes.len(),"sha256":impeccable_comp_verbs::asset_capture::capture_sha256(&bytes)}));
        Ok(bytes)
    };
    let report: Value = serde_json::from_slice(&read("inputs.json")?).map_err(|e| e.to_string())?;
    if report != evidence.report {
        return Err("saved capture report differs from host evidence".into());
    }
    if let Some(approved)=capture.approved_reference(){if read("human-approved.png")?!=approved.png{return Err("saved human reference differs from reviewed capture".into())}}
    for frame in &evidence.frames {
        if read(&format!("{}.png", frame.name))? != frame.png {
            return Err("saved frame differs from host capture".into());
        }
        let observations: Value =
            serde_json::from_slice(&read(&format!("{}-observations.json", frame.name))?)
                .map_err(|e| e.to_string())?;
        let expected: Vec<_> = frame.regions.iter().map(|r| r.receipt.clone()).collect();
        if observations != json!(expected) {
            return Err("saved observations differ from host capture".into());
        }
    }
    capture.verify_current()?;
    Ok(files)
}

#[derive(Clone)]
pub struct RemoteEntryRenderer {
    port: u16,
    key: String,
}

fn require_component_review(pending: bool, tool: &str) -> Result<(), String> {
    if pending {
        return Err(format!("Component kit approval is pending. Call {tool} with the component manifest's manifest_path and wait for the user's decisions before assembled-page comparison. No page comparison was performed."));
    }
    Ok(())
}
impl RemoteEntryRenderer {
    pub fn from_env(env: &HashMap<String, String>) -> Result<Option<Self>, String> {
        match (
            env.get("IMPECCABLE_CAPTURE_PORT"),
            env.get("IMPECCABLE_CAPTURE_CAPABILITY"),
        ) {
            (None, None) => Ok(None),
            (Some(port), Some(key))
                if key.len() == 64 && key.bytes().all(|b| b.is_ascii_hexdigit()) =>
            {
                let port: u16 = port.parse().map_err(|_| "invalid native capture port")?;
                if port == 0 {
                    return Err("invalid native capture port".into());
                }
                Ok(Some(Self {
                    port,
                    key: key.clone(),
                }))
            }
            _ => Err("incomplete native capture service configuration".into()),
        }
    }
    fn call(&self, route: &str, body: Value) -> Result<Value, String> {
        let body = serde_json::to_vec(&body).map_err(|e| e.to_string())?;
        let mut stream = TcpStream::connect_timeout(
            &std::net::SocketAddr::from(([127, 0, 0, 1], self.port)),
            Duration::from_secs(3),
        )
        .map_err(|e| e.to_string())?;
        stream
            .set_read_timeout(Some(Duration::from_secs(150)))
            .map_err(|e| e.to_string())?;
        stream
            .set_write_timeout(Some(Duration::from_secs(5)))
            .map_err(|e| e.to_string())?;
        write!(stream,"POST {route} HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Capture-Key: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",self.key,body.len()).map_err(|e|e.to_string())?;
        stream.write_all(&body).map_err(|e| e.to_string())?;
        let mut bytes = Vec::new();
        stream
            .take(64 * 1024 * 1024 + 8193)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > 64 * 1024 * 1024 + 8192 {
            return Err("native capture response too large".into());
        }
        let split = bytes
            .windows(4)
            .position(|v| v == b"\r\n\r\n")
            .filter(|n| *n < 8192)
            .ok_or("invalid native capture HTTP response")?;
        let response: Value =
            serde_json::from_slice(&bytes[split + 4..]).map_err(|e| e.to_string())?;
        if response["ok"] != true {
            return Err(response["error"]
                .as_str()
                .unwrap_or("native service rejected capture")
                .into());
        }
        Ok(response)
    }
}
struct RemoteEntry {
    renderer: RemoteEntryRenderer,
    approved: Option<impeccable_comp_verbs::entry_capture::ApprovedReference>,
    id: String,
    evidence: impeccable_comp_verbs::entry_capture::EntryEvidence,
}
impl CapturedEntry for RemoteEntry {
    fn approved_reference(&self)->Option<&impeccable_comp_verbs::entry_capture::ApprovedReference>{self.approved.as_ref()}
    fn evidence(&self) -> &impeccable_comp_verbs::entry_capture::EntryEvidence {
        &self.evidence
    }
    fn verify_current(&self) -> Result<(), String> {
        self.renderer
            .call("/verify", json!({"handle":self.id}))
            .map(|_| ())
    }
}
impl Drop for RemoteEntry {
    fn drop(&mut self) {
        let _ = self.renderer.call("/release", json!({"handle":self.id}));
    }
}
impl EntryRenderer for RemoteEntryRenderer {
    fn capture_entry(&self, r: &EntryRequest) -> Result<Box<dyn CapturedEntry>, String> {
        use impeccable_comp_verbs::{
            asset_capture::AssetCapture,
            entry_capture::{EntryEvidence, FrameEvidence},
        };
        let stage = match r.stage {
            EntryStage::Hero => "hero",
            EntryStage::Responsive => "responsive",
        };
        let result = self.call(
            "/capture",
            json!({"entry":r.artifact,"spec":r.spec,"reference":r.reference,"stage":stage}),
        )?;
        let id = result["handle"]
            .as_str()
            .ok_or("missing native capture handle")?
            .to_string();
        let parsed = (|| -> Result<Box<dyn CapturedEntry>, String> {
            let root = std::fs::canonicalize(&r.root).map_err(|e| e.to_string())?;
            if result["report"]["captureService"]["registeredRoot"] != json!(root)
                || result["report"]["captureService"]["id"] != id
                || result["report"]["stage"] != stage
                || result["report"]["artifact"] != r.artifact
            {
                return Err("native capture binding mismatch".into());
            }
            let expected = if stage == "hero" {
                vec!["hero"]
            } else {
                vec!["desktop", "mobile"]
            };
            let frames = result["frames"]
                .as_array()
                .filter(|f| f.len() == expected.len())
                .ok_or("invalid native capture frames")?;
            let frames = frames
                .iter()
                .zip(expected)
                .map(|(f, name)| -> Result<FrameEvidence, String> {
                    if f["name"] != name {
                        return Err("invalid native capture frame name".into());
                    }
                    let png = base64::engine::general_purpose::STANDARD
                        .decode(f["png"].as_str().ok_or("missing frame PNG")?)
                        .map_err(|e| e.to_string())?;
                    let regions = f["regions"]
                        .as_array()
                        .filter(|r| !r.is_empty() && r.len() <= 32)
                        .ok_or("invalid native capture regions")?
                        .iter()
                        .map(|r| AssetCapture {
                            receipt: r.clone(),
                            images: vec![],
                        })
                        .collect();
                    Ok(FrameEvidence {
                        name: name.into(),
                        png,
                        regions,
                    })
                })
                .collect::<Result<Vec<_>, _>>()?;
            Ok(Box::new(RemoteEntry {
                approved: if result["approvedReference"].is_null(){None}else{
                    let a=&result["approvedReference"];
                    let png=base64::engine::general_purpose::STANDARD.decode(a["png"].as_str().ok_or("missing reviewed PNG")?).map_err(|e|e.to_string())?;
                    if a["proof"]["schema"]!="human-assembled-reference-v1" || a["proof"]["sha256"]!=impeccable_comp_verbs::asset_capture::capture_sha256(&png) || a["proof"]!=result["report"]["humanTextReview"] {return Err("invalid human reference proof".into())}
                    Some(impeccable_comp_verbs::entry_capture::ApprovedReference{png,proof:a["proof"].clone()})
                },
                renderer: self.clone(),
                id: id.clone(),
                evidence: EntryEvidence {
                    report: result["report"].clone(),
                    frames,
                },
            }))
        })();
        if parsed.is_err() {
            let _ = self.call("/release", json!({"handle":id}));
        }
        parsed
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn parse(bytes: String) -> Result<(String, Value), String> {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let writer = std::thread::spawn(move || {
            let mut s = TcpStream::connect(addr).unwrap();
            let _ = s.write_all(bytes.as_bytes());
        });
        let (stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(1)))
            .unwrap();
        let result = request(&stream, &"a".repeat(64));
        writer.join().unwrap();
        result
    }
    #[test]
    fn request_parser_rejects_origin_ambiguity_and_unbounded_inputs() {
        let header = format!(
            "POST /capture HTTP/1.1\r\nX-Capture-Key: {}\r\n",
            "a".repeat(64)
        );
        assert!(parse(format!("{header}Content-Length: 2\r\n\r\n{{}}")).is_ok());
        for extra in [
            "Origin: http://example.com\r\n",
            "Transfer-Encoding: chunked\r\n",
            "Content-Length: 2\r\n",
            "X-Capture-Key: wrong\r\n",
        ] {
            assert!(parse(format!("{header}{extra}Content-Length: 2\r\n\r\n{{}}")).is_err());
        }
        assert!(parse("POST /capture HTTP/1.1\r\nContent-Length: 2\r\n\r\n{}".into()).is_err());
        assert!(parse(format!("{header}Content-Length: 16385\r\n\r\n")).is_err());
        assert!(
            parse(format!(
                "{header}X-Large: {}\r\nContent-Length: 2\r\n\r\n{{}}",
                "x".repeat(8192)
            ))
            .is_err()
        );
        for body in [r#"{"root":"/"}"#, r#"{"url":"file:///outside"}"#, "[]"] {
            assert!(
                parse(format!(
                    "{header}Content-Length: {}\r\n\r\n{body}",
                    body.len()
                ))
                .is_err()
            );
        }
    }
    #[test]
    fn partial_service_configuration_never_falls_back_to_local_capture() {
        assert!(
            RemoteEntryRenderer::from_env(&HashMap::new())
                .unwrap()
                .is_none()
        );
        let mut env = HashMap::from([("IMPECCABLE_CAPTURE_PORT".into(), "12345".into())]);
        assert!(RemoteEntryRenderer::from_env(&env).is_err());
        env.insert("IMPECCABLE_CAPTURE_CAPABILITY".into(), "a".repeat(64));
        assert!(RemoteEntryRenderer::from_env(&env).unwrap().is_some());
        env.insert(
            "IMPECCABLE_CAPTURE_PORT".into(),
            "http://example.com".into(),
        );
        assert!(RemoteEntryRenderer::from_env(&env).is_err());
    }
}

#[cfg(test)]
mod component_boundary_tests {
    use super::*;
    #[test]
    fn page_capture_requires_configured_human_boundary_before_rendering() {
        let error = require_component_review(true, "component_review").unwrap_err();
        assert!(error.contains("Component kit approval is pending"));
        assert!(error.contains("No page comparison was performed"));
        assert!(require_component_review(false, "component_review").is_ok());
    }
}
