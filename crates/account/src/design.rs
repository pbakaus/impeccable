//! Opt-in DESIGN.md contents upload. Only called behind design health's gate.
use super::*;
use std::io::Read;

/// This is the single default for DESIGN.md contents sync.
pub const DESIGN_SYNC_DEFAULT_ON: bool = false;
const TEXT_BYTES: usize = 64 * 1024;
const BODY_BYTES: usize = 160 * 1024;

pub(super) fn run(args: &[String], io: &mut Io) -> i32 {
    let on = match args.first().map(String::as_str) {
        Some("on") if args.len() == 1 => true,
        Some("off") if args.len() == 1 => false,
        _ => {
            io.err("Usage: impeccable health design on|off\n");
            return 1;
        }
    };
    match Local::update(&io.env, |l| l.design = Some(on)) {
        Ok(()) => {
            io.out(if on {
                "DESIGN.md sync: on.\n"
            } else {
                "DESIGN.md sync: off.\n"
            });
            0
        }
        Err(e) => {
            io.err(&format!(
                "DESIGN.md sync: couldn't save the setting: {e}.\n"
            ));
            1
        }
    }
}

/// Read regular files only, without following a symlink out of the repo or
/// opening a pipe. The cap also bounds a file growing after its metadata read.
fn read(path: &Path, cap: usize) -> Option<Vec<u8>> {
    let meta = std::fs::symlink_metadata(path).ok()?;
    if !meta.is_file() || meta.len() > cap as u64 {
        return None;
    }
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .ok()?
        .take((cap + 1) as u64)
        .read_to_end(&mut bytes)
        .ok()?;
    (bytes.len() <= cap).then_some(bytes)
}

pub(super) fn after_scan(io: &Io, scan: &Scan, repo: &Repo, session: &mut Session) {
    if !Local::read(&io.env).is_some_and(|l| l.sync() && l.design.unwrap_or(DESIGN_SYNC_DEFAULT_ON))
        || !session
            .state
            .scopes
            .iter()
            .any(|s| s == crate::oauth::DESIGN_SCOPE)
    {
        return;
    }
    let root = Path::new(&scan.root);
    let Some(bytes) = read(&root.join("DESIGN.md"), TEXT_BYTES) else {
        return;
    };
    let Ok(text) = String::from_utf8(bytes) else {
        return;
    };
    if text.trim().is_empty() || text.contains('\0') {
        return;
    }
    // Bound the source sidecar too. Only the listed extensions are copied;
    // components, narrative, and other fields never enter the request.
    let sidecar_path = root.join(".impeccable/design.json");
    let sidecar = sidecar_path
        .canonicalize()
        .ok()
        .filter(|p| p.starts_with(root))
        .and_then(|_| read(&sidecar_path, 256 * 1024))
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .and_then(|v| metadata(&v["extensions"]))
        .unwrap_or(Value::Null);
    let digest = hex(&hash(&[&text, &sidecar.to_string()]));
    // A separate service or sign-in must get its own copy. This directory is
    // design health's local per-repo state, never the work tree.
    let account = session.account().clone();
    let marker = hex(&hash(&[
        &account.issuer,
        &session.state.login.to_string(),
        &repo.key,
    ]));
    let Some(home) = impeccable_home(&io.env) else {
        return;
    };
    let path = home.join("health/repos").join(format!("{marker}.design"));
    let Some(dir) = path.parent() else {
        return;
    };
    if std::fs::create_dir_all(dir).is_err() {
        return;
    }
    let Ok(lock) = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path.with_extension("design.lock"))
    else {
        return;
    };
    if lock.try_lock().is_err() {
        return;
    }
    if std::fs::read_to_string(&path).ok().as_deref() == Some(&digest) {
        return;
    }
    let body = json!({
        "version": 1, "uploadId": scan_id(), "repoKey": repo.key,
        // Observation time, not mtime: an old file still has to fit the
        // service's one-day changedAt window on its first upload.
        "changedAt": impeccable_context::util::iso_from_ms(SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as f64),
        "text": text, "sidecar": sidecar,
    });
    if serde_json::to_vec(&body).map_or(true, |b| b.len() > BODY_BYTES) {
        return;
    }
    let Ok(token) = session.access_token_within(Duration::ZERO) else {
        return;
    };
    if !Local::read(&io.env).is_some_and(|l| l.sync() && l.design.unwrap_or(DESIGN_SYNC_DEFAULT_ON))
    {
        return;
    }
    if !session
        .state
        .scopes
        .iter()
        .any(|s| s == crate::oauth::DESIGN_SCOPE)
    {
        return;
    }
    let current_marker = hex(&hash(&[
        &account.issuer,
        &session.state.login.to_string(),
        &repo.key,
    ]));
    if current_marker != marker {
        return;
    }
    let url = format!("{}/cli/v1/design", account.issuer);
    if let Ok(answer) = Client::with_deadline(&account, DEADLINE).post_json(&url, &token, body) {
        if matches!(answer["outcome"].as_str(), Some("recorded" | "repeat")) {
            let _ = crate::store::write_private(&path, digest.as_bytes());
        }
    }
}

fn short(v: &Value) -> bool {
    v.as_str().is_some_and(|s| {
        !s.is_empty()
            && s.encode_utf16().count() <= 160
            && !s.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
    })
}

fn fields(v: &Value, keys: &[&str]) -> bool {
    v.as_object().is_some_and(|o| {
        o.iter()
            .all(|(k, v)| keys.contains(&k.as_str()) && short(v))
    })
}

fn metadata(v: &Value) -> Option<Value> {
    let extensions = v.as_object()?;
    let mut out = Map::new();
    for key in [
        "colorMeta",
        "typographyMeta",
        "shadows",
        "motion",
        "breakpoints",
    ] {
        let Some(value) = extensions.get(key) else {
            continue;
        };
        let valid = if key == "colorMeta" || key == "typographyMeta" {
            value.as_object().is_some_and(|o| {
                o.len() <= 64
                    && o.iter().all(|(name, entry)| {
                        !name.is_empty()
                            && name.len() <= 64
                            && name
                                .bytes()
                                .all(|c| c.is_ascii_alphanumeric() || b"_.-".contains(&c))
                            && entry.as_object().is_some_and(|e| {
                                e.iter().all(|(k, v)| {
                                    if key == "colorMeta" && k == "tonalRamp" {
                                        v.as_array()
                                            .is_some_and(|a| a.len() <= 16 && a.iter().all(short))
                                    } else {
                                        (if key == "colorMeta" {
                                            ["role", "displayName", "canonical"]
                                                .contains(&k.as_str())
                                        } else {
                                            ["displayName", "purpose"].contains(&k.as_str())
                                        }) && short(v)
                                    }
                                })
                            })
                    })
            })
        } else {
            value.as_array().is_some_and(|a| {
                a.len() <= 64
                    && a.iter().all(|e| {
                        fields(e, &["name", "value", "purpose"])
                            && short(&e["name"])
                            && short(&e["value"])
                    })
            })
        };
        if !valid {
            return None;
        }
        out.insert(key.to_string(), value.clone());
    }
    let out = Value::Object(out);
    (serde_json::to_vec(&out).ok()?.len() <= 16 * 1024).then_some(out)
}

/// Forget removes hashes too, so a later explicit opt-in can republish.
pub(super) fn forget(io: &Io) {
    let Some(home) = impeccable_home(&io.env) else {
        return;
    };
    let Ok(entries) = std::fs::read_dir(home.join("health/repos")) else {
        return;
    };
    for entry in entries.flatten() {
        if entry.path().extension().is_some_and(|e| e == "design") {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}
