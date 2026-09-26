use super::manifest::{digest, freeze, relative, string, valid_box};
use serde_json::{json, Value};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

pub fn read(path: &Path) -> Result<Value, String> {
    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}
pub fn write(path: &Path, value: &Value) -> Result<(), String> {
    write_bytes(path, &serde_json::to_vec_pretty(value).unwrap())
}
/// Temp file plus rename, so a reader or a crash never sees a partial file.
pub fn write_bytes(path: &Path, bytes: &[u8]) -> Result<(), String> {
    static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let parent = path.parent().ok_or("missing parent")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let name = path.file_name().ok_or("missing file name")?.to_string_lossy();
    let temp = parent.join(format!(".{name}.tmp-{}-{n}", std::process::id()));
    let result = (|| {
        let mut f = fs::File::create(&temp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        fs::rename(&temp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result.map_err(|e| e.to_string())
}
/// An OS lock on an open handle: the kernel releases it when the holder exits,
/// so there is no stale-lock takeover and dropping never deletes another's lock.
pub struct Lock(#[allow(dead_code)] fs::File);
pub fn lock(dir: &Path) -> Result<Lock, String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    }
    // One writer across prepare, HTTP submission and restart.
    let f = fs::OpenOptions::new().read(true).write(true).create(true).truncate(false)
        .open(dir.join("review.lock")).map_err(|e| e.to_string())?;
    for _ in 0..20 {
        match f.try_lock() {
            Ok(()) => return Ok(Lock(f)),
            Err(fs::TryLockError::WouldBlock) => std::thread::sleep(std::time::Duration::from_millis(25)),
            Err(fs::TryLockError::Error(e)) => return Err(e.to_string()),
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
    if let Some(accepted) = super::lifecycle::final_session(store, project)? {
        return Ok(accepted);
    }
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
    if let Some(accepted) = super::lifecycle::final_session(store, project)? {
        return Ok(accepted);
    }
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
    let journey = super::lifecycle::journey(project)?;
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
        if captured.evidence["schema"] != super::capture::schema_for(&packet)
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
        o["journey"] == journey && o["contentRevision"]
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
    packet["comp"]["url"] = json!(packet["comp"]["url"]
        .as_str()
        .unwrap()
        .replacen("/files/", &prefix, 1));
    for c in packet["components"].as_array_mut().unwrap() {
        for key in ["preview", "context", "thumbnail"] {
            if let Some(url) = c[key]["url"].as_str() {
                c[key]["url"] = json!(url.replacen("/files/", &prefix, 1));
            }
        }
    }
    let mut decisions = serde_json::Map::new();
    let previous = old
        .as_ref().filter(|v| v["journey"] == journey)
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
        let blob = blobs.join(&hash);
        if fs::read(&blob).ok().is_none_or(|b| digest(&b) != hash) {
            write_bytes(&blob, &bytes)?;
        }
        hashes.insert(path, json!(hash));
    }
    if let Some(old) = &old {
        if let Some(old_rev) = old["packet"]["revision"].as_str() {
            write(&dir.join(format!("revisions/{old_rev}.json")), old)?;
        }
    }
    let mut state = json!({"schemaVersion":1,"journey":super::lifecycle::journey(project)?,"contentRevision":content_revision,"project":project,"packet":packet,"files":hashes,"sources":sources,"capture":capture,"draft":draft,"receipt":null});
    if let Some(previous) = old.as_ref().filter(|v| v["journey"] == journey) {
        super::visual_approval::carry(previous, &mut state, &blobs);
        // An unsubmitted intermediate capture is not a revocation. Use only the
        // latest submitted round, so an older approval cannot override later feedback.
        if previous["receipt"].is_null() {
            let mut submitted = fs::read_dir(dir.join("revisions")).into_iter().flatten()
                .filter_map(Result::ok).filter_map(|entry| read(&entry.path()).ok())
                .filter(|s| !s["receipt"].is_null() && s["journey"] == state["journey"])
                .collect::<Vec<_>>();
            submitted.sort_by_key(|s| s["packet"]["round"].as_u64().unwrap_or(0));
            if let Some(previous) = submitted.last() {
                super::visual_approval::carry(previous, &mut state, &blobs);
            }
        }
    }
    state["history"] = old
        .as_ref().filter(|v| v["journey"] == journey)
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
    if let Some(final_dir) = super::lifecycle::final_session(
        dir.parent().ok_or("missing review store")?,
        Path::new(string(&state, "project")?),
    )? {
        if final_dir != dir {
            return Err(
                "The assembled first viewport is already accepted; component review is closed."
                    .into(),
            );
        }
    }
    if body.as_object().is_none_or(|m| {
        m.keys().any(|k| {
            ![
                "schemaVersion",
                "requestId",
                "packetRevision",
                "decisions",
                "missing",
                "inventoryConfirmed",
                "reclassify",
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
    let v3 = packet["schemaVersion"] == 3;
    let mut approved = 0;
    let mut revisions = 0;
    let mut reclassified = 0;
    let target_kind = |d: &Value| matches!(d["kind"].as_str(), Some("plate" | "image" | "texture"));
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
        if d.get("kind").is_some() && d["action"] != "reclassify" {
            return Err("only a reclassify decision carries kind".into());
        }
        match d["action"].as_str() {
            Some("approve") if d["split"] == false => approved += 1,
            Some("revise") if !v3 || c["role"] == "asset" => revisions += 1,
            // A plan item can need a map change neither medium fixes (artwork spilling over a
            // code region). Revise then carries the reviewer's words and must not be empty.
            Some("revise") if d["split"] == false && !d["feedback"].as_str().unwrap().trim().is_empty() => revisions += 1,
            Some("revise") => return Err(format!("{id} is a plan item; revise on a plan item needs feedback describing the region map change")),
            Some("reclassify") if v3 && c["role"] == "plan" && d["split"] == false && target_kind(d) => reclassified += 1,
            Some("reclassify") => return Err("reclassify applies to plan items and needs kind plate, image or texture".into()),
            _ => return Err("invalid decision action".into()),
        }
    }
    let reclassify = body.get("reclassify").map(|r| r.as_array().cloned().ok_or("reclassify must be an array")).transpose()?.unwrap_or_default();
    if !reclassify.is_empty() && !v3 {
        return Err("reclassify belongs to the plan and asset review".into());
    }
    let mut reclassify_ids = std::collections::BTreeSet::new();
    for r in &reclassify {
        let id = string(r, "id")?;
        let listed = packet["codeRegions"].as_array().is_some_and(|code| code.iter().any(|c| c["id"] == id));
        if !listed || !reclassify_ids.insert(id) || !target_kind(r)
            || r.as_object().is_some_and(|m| m.keys().any(|k| !["id", "kind", "feedback"].contains(&k.as_str())))
            || r.get("feedback").is_some_and(|f| f.as_str().is_none_or(|f| f.len() > 8000))
        {
            return Err("invalid reclassification: name a codeRegions id once, with kind plate, image or texture".into());
        }
    }
    if reclassify.len() > 400 {
        return Err("too many reclassifications".into());
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
    let has_feedback = revisions > 0 || reclassified > 0 || !reclassify.is_empty() || !missing.is_empty();
    if !has_feedback && (approved != components.len() || body["inventoryConfirmed"] != true) {
        return Err("approve every component and confirm inventory completeness".into());
    }
    let receipt = json!({"schemaVersion":1,"reviewer":"local-browser","visualDecision":if has_feedback{"changes-requested"}else{"approved"},"captureVerified":super::capture::verified(&state),"capture":state["capture"],"submission":body});
    state["draft"] = json!({"packetRevision":body["packetRevision"],"decisions":decisions,"missing":missing,"inventoryConfirmed":body["inventoryConfirmed"]});
    if v3 { state["draft"]["reclassify"] = json!(reclassify); }
    state["receipt"] = receipt.clone();
    write(&dir.join("current.json"), &state)?;
    // current.json is the authoritative atomic commit; a receipt export is not approval authority.
    Ok(receipt)
}

/// Update only an unsubmitted draft, retaining packet/source identity and old receipts.
pub fn refresh_approvals(dir: &Path) -> Result<usize, String> {
    let _guard = lock(dir)?;
    let mut state = read(&dir.join("current.json"))?;
    if !state["receipt"].is_null() {
        return Ok(0);
    }
    sources_current(&state)?;
    let Some(rev) = state["history"]["packet"]["revision"].as_str() else {
        return Ok(0);
    };
    if rev.len() != 64 || !rev.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("invalid previous revision".into());
    }
    let previous = read(&dir.join(format!("revisions/{rev}.json")))?;
    if previous["packet"]["revision"] != rev {
        return Err("previous revision mismatch".into());
    }
    let count = super::visual_approval::carry(&previous, &mut state, &dir.join("blobs"));
    let history = super::history::between(&previous, &state);
    if count > 0 || state["history"] != history {
        state["history"] = history;
        write(&dir.join("current.json"), &state)?;
    }
    Ok(count)
}
