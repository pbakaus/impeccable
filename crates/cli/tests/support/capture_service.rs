//! The host capture service as NATIVE-CAPTURE.md describes it: the engine
//! binary's `capture-server <registered-project> <ready-file>`, a host-generated
//! capability, and a client configured only through the port and capability.
use impeccable::capture_service::RemoteEntryRenderer;
use impeccable_comp_verbs::asset_capture::capture_sha256;
use serde_json::Value;
use std::{
    collections::HashMap,
    io::{Read, Write},
    net::TcpStream,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

pub struct CaptureService {
    child: Child,
    dir: PathBuf,
    pub port: u16,
    pub key: String,
}
impl CaptureService {
    /// `session` is the host-selected review session (outside the project).
    pub fn start(project: &Path, session: Option<&Path>) -> Self {
        let nonce = format!(
            "{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        );
        let dir = std::env::temp_dir().join(format!("capture-service-{nonce}"));
        std::fs::create_dir_all(&dir).unwrap();
        let ready = dir.join("ready.json");
        let key = capture_sha256(nonce.as_bytes());
        let mut command = Command::new(env!("CARGO_BIN_EXE_impeccable"));
        command
            .arg("capture-server")
            .arg(project)
            .arg(&ready)
            .env("IMPECCABLE_CAPTURE_CAPABILITY", &key)
            .env_remove("IMPECCABLE_COMPONENT_REVIEW_PENDING")
            .env_remove("IMPECCABLE_CAPTURE_REVIEW_SESSION")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::inherit());
        if let Some(session) = session {
            command.env("IMPECCABLE_CAPTURE_REVIEW_SESSION", session);
        }
        let mut child = command.spawn().expect("start capture-server");
        let started = Instant::now();
        let port = loop {
            if let Some(port) = std::fs::read(&ready)
                .ok()
                .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
                .and_then(|v| v["port"].as_u64())
            {
                break port as u16;
            }
            let failure = match child.try_wait() {
                Ok(Some(status)) => Some(format!("capture-server exited before it was ready: {status}")),
                Err(e) => Some(format!("capture-server status unavailable: {e}")),
                Ok(None) if started.elapsed() > Duration::from_secs(60) => {
                    Some("capture-server never wrote its ready file".into())
                }
                Ok(None) => None,
            };
            if let Some(failure) = failure {
                let _ = child.kill();
                let _ = child.wait();
                let _ = std::fs::remove_dir_all(&dir);
                panic!("{failure}");
            }
            std::thread::sleep(Duration::from_millis(20));
        };
        Self { child, dir, port, key }
    }
    /// The client exactly as build-phase builds it from the host's environment.
    pub fn renderer(&self) -> RemoteEntryRenderer {
        let env = HashMap::from([
            ("IMPECCABLE_CAPTURE_PORT".to_string(), self.port.to_string()),
            ("IMPECCABLE_CAPTURE_CAPABILITY".to_string(), self.key.clone()),
        ]);
        RemoteEntryRenderer::from_env(&env).unwrap().expect("service configured")
    }
    /// A host request (the audit endpoint is the host adapter's, not the client's).
    pub fn post(&self, route: &str, body: &Value) -> Value {
        let body = serde_json::to_vec(body).unwrap();
        let mut stream = TcpStream::connect(("127.0.0.1", self.port)).unwrap();
        stream.set_read_timeout(Some(Duration::from_secs(150))).unwrap();
        write!(
            stream,
            "POST {route} HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Capture-Key: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            self.key,
            body.len()
        )
        .unwrap();
        stream.write_all(&body).unwrap();
        let mut bytes = Vec::new();
        stream.read_to_end(&mut bytes).unwrap();
        let split = bytes.windows(4).position(|w| w == b"\r\n\r\n").expect("HTTP response");
        serde_json::from_slice(&bytes[split + 4..]).unwrap()
    }
}
impl Drop for CaptureService {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}
