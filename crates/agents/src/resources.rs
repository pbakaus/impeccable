use super::*;

pub(super) fn apply(
    s: &Spec,
    old: Option<&Journal>,
    home: &Path,
    journal_path: &Path,
    prior_journal: Option<Vec<u8>>,
) -> Result<Journal, (&'static str, String, i32)> {
    let mcp_conflicts = preflight_mcp(s, old.map(|journal| &journal.spec), home)?;
    if !mcp_conflicts.is_empty() {
        return Err((
            "mcp_drift",
            format!(
                "MCP server configuration changed outside the engine: {}",
                mcp_conflicts.join(", ")
            ),
            4,
        ));
    }
    if let Some(old) = old.filter(|o| o.spec.harness == "codex") {
        // A person who changed the approval since it was written decided otherwise; don't undo that.
        let text = fs::read_to_string(old.spec.root.join("config.toml")).unwrap_or_default();
        let changed: Vec<_> = old
            .spec
            .mcp_approvals
            .iter()
            .filter(|a| {
                render::approval_value(&text, &a.server).as_deref() != Some(a.mode.as_str())
            })
            .map(|a| a.server.clone())
            .collect();
        if !changed.is_empty() {
            return Err((
                "approval_drift",
                format!(
                    "Codex MCP approval changed outside the engine: {}",
                    changed.join(", ")
                ),
                4,
            ));
        }
    }
    // A managed block the person edited is theirs: a reapply that would
    // replace it is refused before anything is written (pristine#4333).
    if s.instruction.is_some() {
        if let Some(path) = render::instruction_drift(old.map(|o| &o.spec), s)? {
            return Err((
                "instruction_drift",
                format!(
                    "The managed instruction block in {} was edited outside the engine",
                    path.display()
                ),
                4,
            ));
        }
    }
    let mut snapshots = Vec::new();
    let mut writes = Vec::new();
    let desired_targets = targets(s);
    let mut touched = desired_targets.clone();
    if let Some(old) = old {
        for p in targets(&old.spec) {
            if !touched.contains(&p) {
                touched.push(p)
            }
        }
    }
    let mut touched_physical = Vec::new();
    for path in touched {
        let before = fs::read(&path).ok();
        let physical = canonical_target(&path)?;
        touched_physical.push(physical.clone());
        let mut base = before.clone();
        if let Some(old) = old {
            if targets(&old.spec).contains(&path) {
                let original = old
                    .snapshots
                    .iter()
                    .find(|x| x.path == physical)
                    .and_then(|x| x.before.as_deref());
                // Hooks stay wanted in this config: leave its features.hooks as the file has it.
                // An older engine's journal may hold `hooks = false` from before it turned them
                // on; restoring that here would refuse a reapply the person never blocked.
                let keep_switch = s.harness == "codex"
                    && old.spec.harness == "codex"
                    && !s.hooks.is_empty()
                    && physical.file_name().is_some_and(|n| n == "config.toml");
                let old_spec = if keep_switch {
                    Spec {
                        hooks: vec![],
                        ..old.spec.clone()
                    }
                } else {
                    old.spec.clone()
                };
                if let Some(updated) = render::remove_owned(
                    &old_spec,
                    &physical,
                    base.as_deref().unwrap_or_default(),
                    original,
                )? {
                    base = Some(updated);
                }
            }
        }
        let managed = desired_targets.contains(&path);
        let next = if managed {
            Some(render(s, &path, base.as_deref())?)
        } else {
            base
        };
        let next = if !managed
            && next.as_deref() == Some(b"")
            && old
                .and_then(|j| j.snapshots.iter().find(|x| x.path == physical))
                .is_some_and(|x| x.before.is_none())
        {
            None
        } else {
            next
        };
        if managed && before != next && has_peer_installation(home, &physical, s) {
            return Err((
                "shared_resource_conflict",
                format!(
                    "Conflicting desired values for shared resource {}",
                    physical.display()
                ),
                4,
            ));
        }
        if before != next {
            writes.push((path.clone(), next, managed));
        } else if managed {
            if let Some(mut claim) = find_resource_claim(home, &physical) {
                let id = installation_claim(s);
                if !claim.claims.contains(&id) {
                    claim.claims.push(id)
                }
                snapshots.push(claim);
            } else {
                let written = before.clone().unwrap_or_default();
                snapshots.push(Snapshot {
                    resource_id: format!("file:{}", physical.display()),
                    kind: "managed_file".into(),
                    state: ResourceState::Preexisting,
                    path: physical,
                    before: before.clone(),
                    original_value: before.clone(),
                    last_written_value: written.clone(),
                    written_hash: hex(&Sha256::digest(&written)),
                    claims: vec![installation_claim(s)],
                    pure_install: true,
                });
            }
        }
    }
    let pending_path = home.join(format!("{}.pending.json", installation_id(s)));
    let pending_targets = writes
        .iter()
        .map(|(p, after, _)| {
            Ok(PendingTarget {
                path: canonical_target(p)?,
                before: fs::read(p).ok(),
                after: after.clone(),
            })
        })
        .collect::<Result<Vec<_>, (&'static str, String, i32)>>()?;
    let mcp_change = old.map_or(!s.mcp_servers.is_empty(), |j| {
        j.spec.mcp_servers != s.mcp_servers
    });
    if !pending_targets.is_empty() || mcp_change {
        persist_pending(
            &pending_path,
            &PendingTransaction {
                version: JOURNAL_VERSION,
                journal_path: journal_path.to_path_buf(),
                prior_journal,
                desired_spec: s.clone(),
                prior_spec: old.map(|j| j.spec.clone()),
                targets: pending_targets,
            },
        )?;
        failpoint("journal_intent")?;
    }
    for (logical, next, managed) in writes {
        let before = fs::read(&logical).ok();
        let path = if let Some(next) = &next {
            safe_write(&logical, before.as_deref(), next)?
        } else {
            safe_delete(&logical, before.as_deref())?
        };
        let written = fs::read(&path).unwrap_or_default();
        if managed {
            let existing = old.and_then(|j| j.snapshots.iter().find(|x| x.path == path));
            let baseline = existing
                .map(|x| x.before.clone())
                .unwrap_or_else(|| before.clone());
            let mut claims = existing.map(|x| x.claims.clone()).unwrap_or_default();
            let claim = installation_claim(s);
            if !claims.contains(&claim) {
                claims.push(claim);
            }
            snapshots.push(Snapshot {
                resource_id: format!("file:{}", path.display()),
                kind: "managed_file".into(),
                state: ResourceState::Created,
                path,
                original_value: baseline.clone(),
                before: baseline,
                last_written_value: written.clone(),
                written_hash: hex(&Sha256::digest(&written)),
                claims,
                // Exact restore stays possible across the engine's own rewrites
                // (a staged enable): only while the file still held what the engine
                // last wrote, so an outside edit still means surgical undo.
                pure_install: existing.is_none_or(|x| {
                    x.pure_install
                        && before.as_ref().is_some_and(|b| hex(&Sha256::digest(b)) == x.written_hash)
                }),
            });
        }
    }
    let mcp_conflicts = sync_mcp(s, old.map(|j| &j.spec), home)?;
    if !mcp_conflicts.is_empty() {
        return Err((
            "mcp_drift",
            format!(
                "MCP server configuration changed outside the engine: {}",
                mcp_conflicts.join(", ")
            ),
            4,
        ));
    }
    failpoint("mcp_synced")?;
    let _ = home;
    let mut all = old.map(|j| j.snapshots.clone()).unwrap_or_default();
    all.retain(|x| !touched_physical.contains(&x.path));
    for snap in snapshots {
        all.retain(|x| x.path != snap.path);
        all.push(snap)
    }
    let resources = build_resource_records(s, old, &all, home);
    Ok(Journal {
        version: JOURNAL_VERSION,
        spec: s.clone(),
        snapshots: all,
        resources,
    })
}
pub(super) fn build_resource_records(
    s: &Spec,
    old: Option<&Journal>,
    snapshots: &[Snapshot],
    home: &Path,
) -> Vec<ResourceRecord> {
    let mut known = old.map(|j| j.resources.clone()).unwrap_or_default();
    if let Ok(entries) = fs::read_dir(home) {
        for e in entries.flatten() {
            let p = e.path();
            if p.extension().is_none_or(|x| x != "json")
                || p.file_name()
                    .is_some_and(|n| n.to_string_lossy().ends_with("pending.json"))
            {
                continue;
            }
            let Ok(bytes) = fs::read(p) else { continue };
            let Ok(j) = serde_json::from_slice::<Journal>(&bytes) else {
                continue;
            };
            for r in j.resources {
                if !known.iter().any(|x| x.resource_id == r.resource_id) {
                    known.push(r)
                }
            }
        }
    }
    let claim = installation_claim(s);
    let mut out = Vec::new();
    {
        let mut add = |kind: &str, key: &str, path: &str, original: Option<Value>, last: Value| {
            let id = resource_id(s, kind, path, key);
            let mut record = known
                .iter()
                .find(|r| r.resource_id == id)
                .cloned()
                .unwrap_or(ResourceRecord {
                    resource_id: id,
                    kind: kind.into(),
                    path: PathBuf::from(path),
                    state: ResourceState::Created,
                    original_value: original,
                    last_written_value: Value::Null,
                    claims: vec![],
                });
            // A reapply that writes a new value (another approval mode, edited instruction text)
            // records it; the original stays what the person had before the first install.
            record.state = if record.original_value.as_ref() == Some(&last) {
                ResourceState::Preexisting
            } else {
                ResourceState::Created
            };
            record.last_written_value = last;
            if !record.claims.contains(&claim) {
                record.claims.push(claim.clone())
            }
            if !out
                .iter()
                .any(|r: &ResourceRecord| r.resource_id == record.resource_id)
            {
                out.push(record)
            }
        };
        for path in targets(s) {
            let Ok(physical) = canonical_target(&path) else {
                continue;
            };
            let Some(snap) = snapshots.iter().find(|x| x.path == physical) else {
                continue;
            };
            let before = snap.before.as_deref().unwrap_or_default();
            let after = snap.last_written_value.as_slice();
            if (path.ends_with("settings.json") || path.ends_with("hooks.json"))
                && !s.hooks.is_empty()
            {
                let pre = render::parse_unique_json(before).ok();
                for h in &s.hooks {
                    let entry = h.entry();
                    let present = pre
                        .as_ref()
                        .and_then(|v| v.get("hooks"))
                        .and_then(|v| v.get(&h.event))
                        .and_then(Value::as_array)
                        .is_some_and(|a| a.contains(&entry));
                    let key = format!(
                        "{}:{}",
                        h.event,
                        hex(&Sha256::digest(serde_json::to_vec(&entry).unwrap()))
                    );
                    add(
                        "hook",
                        &key,
                        &physical.display().to_string(),
                        present.then_some(entry.clone()),
                        entry,
                    );
                }
            }
            if path.ends_with("config.toml") && s.harness == "codex" && !s.hooks.is_empty() {
                let orig = String::from_utf8_lossy(before).lines().find_map(|l| {
                    l.trim().strip_prefix("hooks = ").and_then(|v| match v {
                        "true" => Some(Value::Bool(true)),
                        "false" => Some(Value::Bool(false)),
                        _ => None,
                    })
                });
                add(
                    "setting",
                    "features.hooks",
                    &physical.display().to_string(),
                    orig,
                    Value::Bool(true),
                );
            }
            if path.ends_with("config.toml") && s.harness == "codex" {
                let before = String::from_utf8_lossy(before);
                for a in &s.mcp_approvals {
                    add(
                        "mcp-approval",
                        &a.server,
                        &physical.display().to_string(),
                        render::approval_value(&before, &a.server).map(Value::String),
                        Value::String(a.mode.clone()),
                    );
                }
            }
            if path.ends_with("CLAUDE.md") || path.ends_with("AGENTS.md") {
                let marker = format!("impeccable:{}", s.owner);
                let start = format!("<!-- {marker} start -->");
                let end = format!("<!-- {marker} end -->");
                let extract = |bytes: &[u8]| {
                    let t = String::from_utf8(bytes.to_vec()).ok()?;
                    Some(Value::String(block_body(&t, &start, &end)?.to_owned()))
                };
                let last = extract(after).unwrap_or(Value::Null);
                add(
                    "instruction-block",
                    &s.owner,
                    &physical.display().to_string(),
                    extract(before),
                    last,
                );
            }
        }
    }
    for m in &s.mcp_servers {
        let resource_id = mcp_resource_id(s, &m.name);
        let path = PathBuf::from(format!("{}:{}", s.harness, s.root.display()));
        let desired = mcp_config(m);
        let mut record = known
            .iter()
            .find(|r| r.resource_id == resource_id)
            .cloned()
            .unwrap_or(ResourceRecord {
                resource_id: resource_id.clone(),
                kind: "mcp-server".into(),
                path,
                state: ResourceState::Created,
                original_value: None,
                last_written_value: desired.clone(),
                claims: Vec::new(),
            });
        if record.last_written_value != desired {
            record.state = ResourceState::Conflict;
        }
        if !record.claims.contains(&claim) {
            record.claims.push(claim.clone());
        }
        if !out.iter().any(|r| r.resource_id == resource_id) {
            out.push(record);
        }
    }
    out
}
/// One file resource's id: its kind, harness and path, and a digest of the owner and key
/// (an approval's server, a hook's event and entry), so `status` can find the key again.
pub(super) fn resource_id(s: &Spec, kind: &str, path: &str, key: &str) -> String {
    format!(
        "{}:{}:{}:{}",
        kind,
        s.harness,
        path,
        hex(&Sha256::digest(format!("{}:{key}", s.owner).as_bytes()))
    )
}
pub(super) fn block_body<'a>(text: &'a str, start: &str, end: &str) -> Option<&'a str> {
    if text.matches(start).count() != 1
        || text.matches(end).count() != 1
        || text.lines().filter(|line| *line == start).count() != 1
        || text.lines().filter(|line| *line == end).count() != 1
    {
        return None;
    }
    let body_start = text.find(start)? + start.len();
    let body_end = text[body_start..].find(end)? + body_start;
    if body_start >= body_end {
        return None;
    }
    let body = &text[body_start..body_end];
    let body = body
        .strip_prefix("\r\n")
        .or_else(|| body.strip_prefix('\n'))?;
    body.strip_suffix("\r\n")
        .or_else(|| body.strip_suffix('\n'))
}
pub(super) fn installation_id(s: &Spec) -> String {
    format!(
        "{}-{}-{}",
        s.owner,
        s.harness,
        hex(&Sha256::digest(s.root.to_string_lossy().as_bytes())[..8])
    )
}
pub(super) fn find_resource_claim(home: &Path, path: &Path) -> Option<Snapshot> {
    let entries = fs::read_dir(home).ok()?;
    for e in entries.flatten() {
        let p = e.path();
        if p.extension().is_none_or(|x| x != "json")
            || p.file_name()
                .is_some_and(|n| n.to_string_lossy().ends_with("pending.json"))
        {
            continue;
        }
        let Ok(bytes) = fs::read(p) else { continue };
        let Ok(j) = serde_json::from_slice::<Journal>(&bytes) else {
            continue;
        };
        if let Some(s) = j.snapshots.into_iter().find(|s| s.path == path) {
            return Some(s);
        }
    }
    None
}
pub(super) fn has_peer_installation(home: &Path, path: &Path, s: &Spec) -> bool {
    fs::read_dir(home)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .any(|e| {
            let p = e.path();
            if p.extension().is_none_or(|x| x != "json")
                || p.file_name()
                    .is_some_and(|n| n.to_string_lossy().ends_with("pending.json"))
            {
                return false;
            }
            let Some(id) = p.file_stem().and_then(|n| n.to_str()) else {
                return false;
            };
            if id == installation_id(s) {
                return false;
            }
            fs::read(p)
                .ok()
                .and_then(|b| serde_json::from_slice::<Journal>(&b).ok())
                .is_some_and(|j| {
                    j.spec.owner == s.owner
                        && j.spec.harness == s.harness
                        && j.snapshots.iter().any(|x| x.path == path)
                })
        })
}
pub(super) fn has_other_claim(
    home: &Path,
    path: &Path,
    exclude: &str,
    owner: &str,
    harness: &str,
) -> bool {
    fs::read_dir(home)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .any(|e| {
            let p = e.path();
            if p.file_name()
                .is_some_and(|n| n.to_string_lossy() == format!("{exclude}.json"))
                || p.extension().is_none_or(|x| x != "json")
                || p.file_name()
                    .is_some_and(|n| n.to_string_lossy().ends_with("pending.json"))
            {
                return false;
            }
            fs::read(p)
                .ok()
                .and_then(|b| serde_json::from_slice::<Journal>(&b).ok())
                .is_some_and(|j| {
                    let codex_shared = path.file_name().is_some_and(|n| n == "config.toml")
                        && j.spec.harness == "codex";
                    (codex_shared || (j.spec.owner == owner && j.spec.harness == harness))
                        && j.snapshots.iter().any(|s| s.path == path)
                })
        })
}

/// Another Codex installation's journal sets an approval on `server` in this same file.
fn has_other_approval(home: &Path, path: &Path, exclude: &str, server: &str) -> bool {
    fs::read_dir(home)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .any(|e| {
            let p = e.path();
            if p.extension().is_none_or(|x| x != "json")
                || p.file_name().is_some_and(|n| {
                    let n = n.to_string_lossy();
                    n.ends_with("pending.json") || n == format!("{exclude}.json")
                })
            {
                return false;
            }
            fs::read(p)
                .ok()
                .and_then(|b| serde_json::from_slice::<Journal>(&b).ok())
                .is_some_and(|j| {
                    j.spec.harness == "codex"
                        && j.snapshots.iter().any(|x| x.path == path)
                        && j.spec.mcp_approvals.iter().any(|a| a.server == server)
                })
        })
}

pub(super) fn undo(
    s: &Spec,
    j: Option<&Journal>,
    _home: &Path,
) -> Result<Value, (&'static str, String, i32)> {
    let Some(j) = j else {
        // No journal: fine when nothing of this installation is on disk, but
        // resources still there mean the record was lost, and "removed" would
        // be a lie (pristine#4333).
        if let Some(path) = render::installed_on_disk(s) {
            return Err((
                "journal_missing",
                format!(
                    "{} holds this installation's resources but its journal is missing; nothing was removed",
                    path.display()
                ),
                4,
            ));
        }
        return Ok(json!({"removed":false,"conflicts":[]}));
    };
    let mut conflicts = Vec::new();
    let mut removed = Vec::new();
    for snap in &j.snapshots {
        if has_other_claim(_home, &snap.path, &installation_id(s), &s.owner, &s.harness) {
            // Codex's features.hooks is shared, so it stays for the other installation, but an
            // approval belongs to this one: put each back unless another installation set the
            // same server too (#1342 review).
            if j.spec.harness == "codex"
                && snap.path.file_name().is_some_and(|n| n == "config.toml")
                && !j.spec.mcp_approvals.is_empty()
            {
                let own = Spec {
                    hooks: vec![],
                    mcp_approvals: j
                        .spec
                        .mcp_approvals
                        .iter()
                        .filter(|a| {
                            !has_other_approval(_home, &snap.path, &installation_id(s), &a.server)
                        })
                        .cloned()
                        .collect(),
                    ..j.spec.clone()
                };
                let current = fs::read(&snap.path).ok();
                let updated = render::restore_approvals(
                    &own,
                    current.as_deref().unwrap_or_default(),
                    snap.before.as_deref(),
                )?;
                if current.as_deref() != Some(updated.as_slice()) {
                    safe_write(&snap.path, current.as_deref(), &updated)?;
                    removed.push(snap.path.clone());
                }
            }
            continue;
        }
        let current = fs::read(&snap.path).ok();
        if current
            .as_ref()
            .is_some_and(|b| hex(&Sha256::digest(b)) == snap.written_hash)
            && snap.pure_install
        {
            if let Some(b) = &snap.before {
                safe_write(&snap.path, current.as_deref(), b)?;
            } else {
                safe_delete(&snap.path, current.as_deref())?;
            }
            removed.push(snap.path.clone())
        } else {
            // What was written, not what the caller asks about now.
            match render::remove_owned(
                &j.spec,
                &snap.path,
                current.as_deref().unwrap_or_default(),
                snap.before.as_deref(),
            )? {
                Some(updated) if current.as_deref() != Some(updated.as_slice()) => {
                    safe_write(&snap.path, current.as_deref(), &updated)?;
                    removed.push(snap.path.clone());
                    // A hook the person edited stays; report it, not just the file.
                    for hook in render::drifted_hooks(&j.spec, &updated, snap.before.as_deref()) {
                        conflicts.push(json!(format!("{}#{hook}", snap.path.display())));
                    }
                }
                _ => {
                    conflicts.push(json!(snap.path.display().to_string()));
                    let left = current.as_deref().unwrap_or_default();
                    for hook in render::drifted_hooks(&j.spec, left, snap.before.as_deref()) {
                        conflicts.push(json!(format!("{}#{hook}", snap.path.display())));
                    }
                }
            }
        }
    }
    let mcp_conflicts = sync_mcp(
        &Spec {
            mcp_servers: vec![],
            ..j.spec.clone()
        },
        Some(&j.spec),
        _home,
    )?;
    conflicts.extend(
        mcp_conflicts
            .into_iter()
            .map(|name| json!(format!("mcp:{name}"))),
    );
    let _ = s;
    Ok(json!({"removed":true,"resourcesRemoved":removed,"conflicts":conflicts}))
}
pub(super) fn hex(b: &[u8]) -> String {
    b.iter().map(|v| format!("{v:02x}")).collect()
}
