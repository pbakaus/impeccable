//! `artifact.asset` (REN-2123), answered here rather than by the service: the agent names a file on this machine and
//! gets back its content key; the bytes go straight from here to Impeccable, uploaded once per workspace, and never
//! pass through the model. The service's own `artifact.asset` (which reserves an upload by digest) is hidden from the
//! agent's list and called from here.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::Path;

pub const NAME: &str = "artifact.asset";
/// The service's cap on one asset.
pub const MAX_BYTES: u64 = 50 * 1024 * 1024;

/// The content types the service stores, by file extension.
const TYPES: &[(&str, &str)] = &[
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("webp", "image/webp"),
    ("gif", "image/gif"),
    ("avif", "image/avif"),
    ("svg", "image/svg+xml"),
    ("mp4", "video/mp4"),
    ("webm", "video/webm"),
    ("mp3", "audio/mpeg"),
    ("woff2", "font/woff2"),
    ("woff", "font/woff"),
    ("css", "text/css"),
    ("js", "text/javascript"),
    ("mjs", "text/javascript"),
    ("json", "application/json"),
];

/// The tool as the agent sees it.
pub fn tool() -> Value {
    json!({
        "name": NAME,
        "description": "Upload a file from this machine for an artifact to use, once: returns its key for artifact.create and artifact.update's assets. Images, video, audio, fonts, CSS, JS or JSON, up to 50 MB.",
        "inputSchema": { "type": "object", "properties": {
            "path": { "type": "string", "description": "The file, absolute or relative to your working folder." },
            "workspace": { "type": "string" }
        }, "required": ["path"] }
    })
}

/// What the service is asked to reserve, from the file at `path`; Err is the line the agent reads.
#[derive(Debug)]
pub struct Local {
    pub bytes: Vec<u8>,
    pub sha256: String,
    pub content_type: &'static str,
}

/// Read the file the agent named: a regular file (never a symlink, which could point anywhere), of a type the service
/// stores, within the size cap.
pub fn read(cwd: &Path, path: &str) -> Result<Local, String> {
    let file = cwd.join(path);
    let meta = std::fs::symlink_metadata(&file).map_err(|_| format!("There's no file at {path}."))?;
    if !meta.file_type().is_file() {
        return Err(format!("{path} isn't a plain file (a symlink or folder can't be uploaded)."));
    }
    if meta.len() == 0 || meta.len() > MAX_BYTES {
        return Err(format!("{path} is {} bytes; an asset is 1 byte to 50 MB.", meta.len()));
    }
    let ext = file.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).unwrap_or_default();
    let Some((_, content_type)) = TYPES.iter().find(|(e, _)| *e == ext) else {
        let known: Vec<&str> = TYPES.iter().map(|(e, _)| *e).collect();
        return Err(format!("{path} isn't a type an artifact can use. Use one of: {}.", known.join(", ")));
    };
    // Read through one handle, checked to be the file just looked at: a symlink swapped in between is refused, and
    // a file that grows can't be read past the cap.
    let mut handle = std::fs::File::open(&file).map_err(|e| format!("Couldn't read {path}: {e}."))?;
    let opened = handle.metadata().map_err(|e| format!("Couldn't read {path}: {e}."))?;
    if !opened.is_file() || !same_file(&meta, &opened) {
        return Err(format!("{path} changed while it was read. Try again."));
    }
    let mut bytes = Vec::new();
    std::io::Read::read_to_end(&mut std::io::Read::take(&mut handle, MAX_BYTES + 1), &mut bytes)
        .map_err(|e| format!("Couldn't read {path}: {e}."))?;
    if bytes.len() as u64 != meta.len() {
        return Err(format!("{path} changed while it was read. Try again."));
    }
    let sha256 = Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect();
    Ok(Local { bytes, sha256, content_type })
}

#[cfg(unix)]
fn same_file(a: &std::fs::Metadata, b: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    (a.dev(), a.ino()) == (b.dev(), b.ino())
}

#[cfg(not(unix))]
fn same_file(a: &std::fs::Metadata, b: &std::fs::Metadata) -> bool {
    a.len() == b.len() && a.modified().ok() == b.modified().ok()
}

/// The service's reservation answer, from its tool result: the key, and the upload address when the bytes are new.
pub fn reservation(result: &Value) -> Result<(String, Option<String>), String> {
    let text = result.pointer("/content/0/text").and_then(Value::as_str).unwrap_or("");
    if result.get("isError") == Some(&Value::Bool(true)) {
        return Err(if text.is_empty() { "Impeccable refused that upload.".into() } else { text.to_string() });
    }
    let unread = || "Impeccable's answer couldn't be read. Try again.".to_string();
    let v: Value = serde_json::from_str(text).map_err(|_| unread())?;
    let key = v["key"].as_str().filter(|k| !k.is_empty()).ok_or_else(unread)?.to_string();
    // Either the workspace has it, or there's somewhere to send it: anything else is no answer.
    match (v["exists"].as_bool(), v.pointer("/upload/url").and_then(Value::as_str)) {
        (Some(true), _) => Ok((key, None)),
        (_, Some(url)) => Ok((key, Some(url.to_string()))),
        _ => Err(unread()),
    }
}

/// The tool result the agent reads: its key, nothing else.
pub fn done(key: &str) -> Value {
    json!({ "content": [{ "type": "text", "text": json!({ "key": key }).to_string() }] })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_file_by_type_and_refuses_what_it_cant_send() {
        let dir = std::env::temp_dir().join(format!("impeccable-asset-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("hero.PNG"), b"png bytes").unwrap();
        let local = read(&dir, "hero.PNG").unwrap();
        assert_eq!((local.content_type, local.bytes.len()), ("image/png", 9));
        assert!(local.sha256.len() == 64 && local.sha256.bytes().all(|b| b.is_ascii_hexdigit()));
        std::fs::write(dir.join("notes.txt"), b"x").unwrap();
        assert!(read(&dir, "notes.txt").unwrap_err().contains("isn't a type"));
        assert!(read(&dir, "missing.png").unwrap_err().contains("no file"));
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(dir.join("hero.PNG"), dir.join("link.png")).unwrap();
            assert!(read(&dir, "link.png").unwrap_err().contains("symlink"));
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reads_the_services_answer() {
        let text = |v: Value| json!({ "content": [{ "type": "text", "text": v.to_string() }] });
        assert_eq!(reservation(&text(json!({ "key": "k", "exists": true }))).unwrap(), ("k".into(), None));
        assert_eq!(reservation(&text(json!({ "key": "k", "upload": { "url": "https://x/u", "expiresAt": "t" } }))).unwrap(), ("k".into(), Some("https://x/u".into())));
        let refused = json!({ "isError": true, "content": [{ "type": "text", "text": "Your plan's storage is full." }] });
        assert_eq!(reservation(&refused).unwrap_err(), "Your plan's storage is full.");
        // An incomplete answer is never read as success.
        assert!(reservation(&text(json!({ "key": "k", "exists": false }))).is_err());
        assert!(reservation(&text(json!({ "key": "k", "upload": {} }))).is_err());
    }
}
