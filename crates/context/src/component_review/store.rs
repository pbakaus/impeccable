use super::manifest::{digest, freeze, relative, string, valid_box};
use serde_json::{Value, json};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

pub fn read(path: &Path) -> Result<Value, String> {
    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}
pub fn write(path: &Path, value: &Value) -> Result<(), String> {
    let parent = path.parent().ok_or("missing parent")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let temp = path.with_extension(format!("tmp-{}", std::process::id()));
    let mut f = fs::File::create(&temp).map_err(|e| e.to_string())?;
    f.write_all(&serde_json::to_vec_pretty(value).unwrap())
        .map_err(|e| e.to_string())?;
    f.sync_all().map_err(|e| e.to_string())?;
    fs::rename(&temp, path).map_err(|e| e.to_string())?;
    Ok(())
}
pub struct Lock(PathBuf);
impl Drop for Lock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}
pub fn lock(dir: &Path) -> Result<Lock, String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    }
    let p = dir.join("review.lock");
    // One writer across prepare, HTTP submission and restart. A dead process leaves no live lock.
    for _ in 0..20 {
        match fs::OpenOptions::new().write(true).create_new(true).open(&p) {
            Ok(mut f) => {
                writeln!(f, "{}", std::process::id()).map_err(|e| e.to_string())?;
                return Ok(Lock(p));
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                if let Ok(pid) = fs::read_to_string(&p)
                    .unwrap_or_default()
                    .trim()
                    .parse::<i64>()
                {
                    if matches!(impeccable_common::proc::kill0(pid), Err("ESRCH")) {
                        let _ = fs::remove_file(&p);
                        continue;
                    }
                }
                std::thread::sleep(std::time::Duration::from_millis(25));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("review is busy; retry shortly".into())
}
pub fn session_dir(store: &Path, project: &Path, id: &str) -> PathBuf {
    store.join(digest(format!("{}\0{id}", project.display()).as_bytes()))
}
#[cfg(test)]
pub fn prepare(store: &Path, project: &Path, input: &Value) -> Result<PathBuf, String> {
    prepare_captured(store, project, input, None)
}
#[cfg(test)]
pub fn prepare_captured(
    store: &Path,
    project: &Path,
    input: &Value,
    capturer: Option<&mut dyn super::capture::ComponentCapturer>,
) -> Result<PathBuf, String> {
    prepare_bound(store, project, input, capturer, None)
}
pub fn prepare_file(
    store: &Path,
    project: &Path,
    path: &str,
    capturer: Option<&mut dyn super::capture::ComponentCapturer>,
) -> Result<PathBuf, String> {
    let canonical = project.canonicalize().map_err(|e| e.to_string())?;
    let project = canonical.as_path();
    let path = relative(path)?;
    let full = project
        .join(&path)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !full.starts_with(project) {
        return Err("manifest escapes project".into());
    }
    let bytes = fs::read(&full).map_err(|e| e.to_string())?;
    if bytes.len() > 2 * 1024 * 1024 {
        return Err("manifest exceeds 2 MiB".into());
    }
    let input = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    prepare_bound(
        store,
        project,
        &input,
        capturer,
        Some((path.to_string_lossy().into_owned(), bytes)),
    )
}
fn prepare_bound(
    store: &Path,
    project: &Path,
    input: &Value,
    capturer: Option<&mut dyn super::capture::ComponentCapturer>,
    binding: Option<(String, Vec<u8>)>,
) -> Result<PathBuf, String> {
    let canonical = project.canonicalize().map_err(|e| e.to_string())?;
    let project = canonical.as_path();
    let (mut packet, mut files) = freeze(project, input)?;
    let manifest_digest = binding
        .as_ref()
        .map(|(path, bytes)| json!({"path":path,"sha256":digest(bytes)}));
    if let Some((path, bytes)) = binding {
        files.insert(path, bytes);
    }
    let sources: serde_json::Map<String, Value> = files
        .iter()
        .map(|(p, b)| (p.clone(), json!(digest(b))))
        .collect();
    fs::create_dir_all(store).map_err(|e| e.to_string())?;
    if store
        .canonicalize()
        .map_err(|e| e.to_string())?
        .starts_with(project)
    {
        return Err("review store must be outside the builder project".into());
    }
    let dir = session_dir(store, project, string(input, "id")?);
    let _guard = lock(&dir)?;
    let old = read(&dir.join("current.json")).ok();
    let capture = if let Some(capturer) = capturer {
        let captured = capturer.capture(&mut packet, &files)?;
        for (path, bytes) in captured.files {
            relative(&path)?;
            if !path.starts_with("_review_captures/") || files.contains_key(&path) {
                return Err("invalid native capture output path".into());
            }
            if bytes.len() > 32 * 1024 * 1024
                || files.values().map(Vec::len).sum::<usize>() + bytes.len() > 256 * 1024 * 1024
            {
                return Err("native captures exceed review byte budget".into());
            }
            files.insert(path, bytes);
        }
        if captured.evidence["schema"] != "native-component-previews-v1"
            || captured.evidence["components"].as_array().map(Vec::len)
                != packet["components"].as_array().map(Vec::len)
        {
            return Err("native capture did not cover every component".into());
        }
        for c in packet["components"]
            .as_array_mut()
            .ok_or("missing captured components")?
        {
            let images: Vec<_> = ["preview", "context", "thumbnail"]
                .iter()
                .filter_map(|key| c[*key]["url"].as_str())
                .map(|url| {
                    let path = url
                        .strip_prefix("/files/")
                        .ok_or("capture URL must be pinned")?;
                    let bytes = files.get(path).ok_or("capture image missing")?;
                    Ok(json!({"path":path,"sha256":digest(bytes)}))
                })
                .collect::<Result<_, &str>>()?;
            c["revision"] = json!(digest(
                &serde_json::to_vec(&json!({"component":c,"images":images})).unwrap()
            ));
        }
        packet.as_object_mut().unwrap().remove("revision");
        packet["revision"] = json!(digest(&serde_json::to_vec(&packet).unwrap()));
        // Detect source edits during rendering before committing a new review round.
        sources_current(&json!({"project":project,"sources":sources}))?;
        captured.evidence
    } else {
        Value::Null
    };
    let content_revision = if let Some(binding) = manifest_digest {
        digest(
            &serde_json::to_vec(&json!({"packet":packet["revision"],"manifest":binding})).unwrap(),
        )
    } else {
        string(&packet, "revision")?.to_string()
    };
    sources_current(&json!({"project":project,"sources":sources}))?;
    if old.as_ref().is_some_and(|o| {
        o["contentRevision"]
            .as_str()
            .unwrap_or_else(|| o["packet"]["revision"].as_str().unwrap_or(""))
            == content_revision
    }) {
        return Ok(dir);
    }
    let round = old
        .as_ref()
        .and_then(|o| o["packet"]["round"].as_u64())
        .unwrap_or(0)
        + 1;
    // Content may return to an earlier version. A review round must never do so:
    // otherwise an old submission could authorize this new review accidentally.
    let rev = digest(
        &serde_json::to_vec(&json!({
            "content":content_revision,"round":round,
            "previous":old.as_ref().map(|o| &o["packet"]["revision"])
        }))
        .unwrap(),
    );
    packet["revision"] = json!(rev);
    packet["round"] = json!(round);
    // URLs include the frozen revision, so a new round cannot silently replace old preview pixels.
    let prefix = format!("/files/{rev}/");
    packet["comp"]["url"] = json!(
        packet["comp"]["url"]
            .as_str()
            .unwrap()
            .replacen("/files/", &prefix, 1)
    );
    for c in packet["components"].as_array_mut().unwrap() {
        for key in ["preview", "context", "thumbnail"] {
            if let Some(url) = c[key]["url"].as_str() {
                c[key]["url"] = json!(url.replacen("/files/", &prefix, 1));
            }
        }
    }
    let mut decisions = serde_json::Map::new();
    let previous = old
        .as_ref()
        .map(|v| v["draft"].clone())
        .unwrap_or(Value::Null);
    for c in packet["components"].as_array().unwrap() {
        let id = string(c, "id")?;
        let d = &previous["decisions"][id];
        if d["revision"] == c["revision"] && d["action"] == "approve" {
            decisions.insert(id.into(), d.clone());
        }
    }
    let missing = previous["missing"].as_array().cloned().unwrap_or_default();
    let draft = json!({"packetRevision":rev,"decisions":decisions,"missing":missing,"inventoryConfirmed":false});
    let mut hashes = serde_json::Map::new();
    let blobs = dir.join("blobs");
    fs::create_dir_all(&blobs).map_err(|e| e.to_string())?;
    for (path, bytes) in files {
        let hash = digest(&bytes);
        fs::write(blobs.join(&hash), bytes).map_err(|e| e.to_string())?;
        hashes.insert(path, json!(hash));
    }
    if let Some(old) = &old {
        if let Some(old_rev) = old["packet"]["revision"].as_str() {
            write(&dir.join(format!("revisions/{old_rev}.json")), old)?;
        }
    }
    let mut state = json!({"schemaVersion":1,"contentRevision":content_revision,"project":project,"packet":packet,"files":hashes,"sources":sources,"capture":capture,"draft":draft,"receipt":null});
    state["history"] = old
        .as_ref()
        .map(|previous| super::history::between(previous, &state))
        .unwrap_or(Value::Null);
    write(&dir.join(format!("revisions/{rev}.json")), &state)?;
    write(&dir.join("current.json"), &state)?;
    Ok(dir)
}
pub fn sources_current(state: &Value) -> Result<(), String> {
    let project = Path::new(string(state, "project")?);
    for (path, hash) in state
        .get("sources")
        .unwrap_or(&state["files"])
        .as_object()
        .ok_or("missing pinned files")?
    {
        let full = project
            .join(relative(path)?)
            .canonicalize()
            .map_err(|_| format!("review is stale: {path} disappeared"))?;
        if !full.starts_with(project)
            || digest(&fs::read(full).map_err(|e| e.to_string())?) != hash.as_str().unwrap_or("")
        {
            return Err(format!(
                "review is stale: {path} changed; prepare a new round"
            ));
        }
    }
    Ok(())
}
pub fn submit(dir: &Path, body: &Value) -> Result<Value, String> {
    let _guard = lock(dir)?;
    let mut state = read(&dir.join("current.json"))?;
    if body.as_object().is_none_or(|m| {
        m.keys().any(|k| {
            ![
                "schemaVersion",
                "requestId",
                "packetRevision",
                "decisions",
                "missing",
                "inventoryConfirmed",
            ]
            .contains(&k.as_str())
        })
    }) {
        return Err("unexpected review fields".into());
    }
    let packet = &state["packet"];
    if body["schemaVersion"] != 1
        || body["requestId"] != packet["id"]
        || body["packetRevision"] != packet["revision"]
    {
        return Err("review is stale or identifies another request".into());
    }
    if !state["receipt"].is_null() {
        return if state["receipt"]["submission"] == *body {
            Ok(state["receipt"].clone())
        } else {
            Err("this round already has different feedback".into())
        };
    }
    sources_current(&state)?;
    let decisions = body["decisions"]
        .as_object()
        .ok_or("decisions must be an object")?;
    let components = packet["components"]
        .as_array()
        .ok_or("missing components")?;
    let mut approved = 0;
    let mut revisions = 0;
    for (id, d) in decisions {
        let c = components
            .iter()
            .find(|c| c["id"] == *id)
            .ok_or("unknown component")?;
        if d["revision"] != c["revision"] {
            return Err("stale component revision".into());
        }
        if !d["feedback"].is_string()
            || d["feedback"].as_str().unwrap().len() > 8000
            || !d["split"].is_boolean()
        {
            return Err("invalid component feedback".into());
        }
        match d["action"].as_str() {
            Some("approve") if d["split"] == false => approved += 1,
            Some("revise") => revisions += 1,
            _ => return Err("invalid decision action".into()),
        }
    }
    let missing = body["missing"]
        .as_array()
        .ok_or("missing must be an array")?;
    let mut missing_ids = std::collections::BTreeSet::new();
    for m in missing {
        if !valid_box(&m["box"])
            || string(m, "name")?.trim().is_empty()
            || !m["feedback"].is_string()
            || !missing_ids.insert(string(m, "id")?)
        {
            return Err("invalid missing component".into());
        }
    }
    if missing.len() > 200 || !body["inventoryConfirmed"].is_boolean() {
        return Err("invalid inventory confirmation".into());
    }
    let has_feedback = revisions > 0 || !missing.is_empty();
    if !has_feedback && (approved != components.len() || body["inventoryConfirmed"] != true) {
        return Err("approve every component and confirm inventory completeness".into());
    }
    let receipt = json!({"schemaVersion":1,"reviewer":"local-browser","visualDecision":if has_feedback{"changes-requested"}else{"approved"},"captureVerified":state["capture"]["schema"]=="native-component-previews-v1","capture":state["capture"],"submission":body});
    state["draft"] = json!({"packetRevision":body["packetRevision"],"decisions":decisions,"missing":missing,"inventoryConfirmed":body["inventoryConfirmed"]});
    state["receipt"] = receipt.clone();
    write(&dir.join("current.json"), &state)?;
    // current.json is the authoritative atomic commit; a receipt export is not approval authority.
    Ok(receipt)
}
