//! `artifact.asset` (REN-2123): the agent names a file, the bytes go from here to Impeccable once, the agent gets a key.
use impeccable_mcp::{serve_session, Failure, Upstream};
use serde_json::{json, Value};
use std::collections::HashMap;

/// The account service: lists its digest-taking `artifact.asset`, reserves an upload the first time a digest is seen,
/// answers `exists` after, and records what was uploaded.
#[derive(Default)]
struct Service {
    stored: Vec<String>,
    reserved: Vec<Value>,
    uploads: Vec<(String, String, usize)>,
}
impl Upstream for Service {
    fn call(&mut self, r: &Value) -> Result<Value, Failure> {
        let result = match r["method"].as_str() {
            Some("tools/list") => json!({ "tools": [{ "name": "artifact.asset", "inputSchema": { "required": ["sha256", "bytes", "contentType"] } }, { "name": "artifact.create" }] }),
            Some("tools/call") => {
                let args = r["params"]["arguments"].clone();
                self.reserved.push(args.clone());
                let sha = args["sha256"].as_str().unwrap().to_string();
                let answer = if self.stored.contains(&sha) { json!({ "key": sha, "exists": true }) } else { json!({ "key": sha, "upload": { "url": format!("https://api.example/api/artifacts/asset?token={sha}"), "expiresAt": "t" } }) };
                json!({ "content": [{ "type": "text", "text": answer.to_string() }] })
            }
            _ => json!({}),
        };
        Ok(json!({ "jsonrpc": "2.0", "id": r["id"], "result": result }))
    }
    fn sign_in(&mut self) -> Result<(), String> {
        Ok(())
    }
    fn upload(&mut self, url: &str, content_type: &str, bytes: &[u8]) -> Result<(), String> {
        self.uploads.push((url.to_string(), content_type.to_string(), bytes.len()));
        self.stored.push(url.rsplit('=').next().unwrap().to_string());
        Ok(())
    }
}

// Catches the model handed the service's digest-taking tool (it can't hash or PUT), a file uploaded again that the
// workspace already has, and a key missing from the answer.
#[test]
fn uploads_a_file_once_and_answers_with_its_key() {
    let dir = std::env::temp_dir().join(format!("impeccable-asset-e2e-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("shots")).unwrap();
    std::fs::write(dir.join("shots/hero.webp"), vec![7u8; 2048]).unwrap();
    let call = |id: u32, args: Value| json!({ "jsonrpc": "2.0", "id": id, "method": "tools/call", "params": { "name": "artifact.asset", "arguments": args } });
    let lines = [
        json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }),
        call(2, json!({ "path": "shots/hero.webp", "workspace": "acme" })),
        call(3, json!({ "path": "shots/hero.webp" })),
        call(4, json!({ "path": "shots/none.webp" })),
    ];
    let input: String = lines.iter().map(|l| format!("{l}\n")).collect();
    let (mut out, mut service, env) = (Vec::new(), Service::default(), HashMap::new());
    serve_session(input.as_bytes(), &mut out, &mut Vec::new(), &mut service, None, Some((&env, &dir)));
    let replies: Vec<Value> = String::from_utf8(out).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect();

    // The agent's list has this tool, taking a path, in the service's place.
    let tools = replies[0]["result"]["tools"].as_array().unwrap();
    assert_eq!(tools.iter().filter(|t| t["name"] == "artifact.asset").count(), 1);
    assert_eq!(tools.iter().find(|t| t["name"] == "artifact.asset").unwrap()["inputSchema"]["required"], json!(["path"]));

    // Uploaded once, with its type and exact length; the second call finds it and sends nothing.
    let key = |r: &Value| serde_json::from_str::<Value>(r["result"]["content"][0]["text"].as_str().unwrap()).unwrap()["key"].clone();
    assert_eq!(key(&replies[1]), key(&replies[2]));
    assert_eq!(service.uploads.len(), 1);
    assert_eq!((service.uploads[0].1.as_str(), service.uploads[0].2), ("image/webp", 2048));
    assert_eq!((service.reserved[0]["workspace"].as_str(), service.reserved[0]["bytes"].as_u64()), (Some("acme"), Some(2048)));

    // A missing file is the tool's own error, and nothing reaches the service.
    assert_eq!(replies[3]["result"]["isError"], true);
    assert_eq!(service.reserved.len(), 2);
    let _ = std::fs::remove_dir_all(&dir);
}
