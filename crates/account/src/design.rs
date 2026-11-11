//! DESIGN.md contents upload. Only called behind design health's gate.
use super::*;

/// This is the single default for DESIGN.md contents sync.
pub const DESIGN_SYNC_DEFAULT_ON: bool = true;
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
    let admission = impeccable_home(&io.env)
        .ok_or_else(|| "no home directory; set IMPECCABLE_HOME".to_string())
        .and_then(|home| crate::store::Store::design_lock_for(&home, Duration::from_secs(3)));
    let _admission = match admission {
        Ok(lock) => lock,
        Err(e) => {
            io.err(&format!(
                "DESIGN.md sync: couldn't save the setting: {e}.\n"
            ));
            return 1;
        }
    };
    match Local::update(&io.env, |l| {
        l.design = Some(on);
        if !on {
            l.design_generation = l.design_generation.wrapping_add(1);
        }
    }) {
        Ok(()) => {
            io.out(if on {
                "DESIGN.md sync: on. Your DESIGN.md uploads to your Impeccable account whenever it changes. To stop: impeccable health design off\n"
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

/// One elapsed-time budget for this contents upload, separate from health.
const UPLOAD_BUDGET: Duration = Duration::from_secs(2);
fn remaining(started: std::time::Instant) -> Option<Duration> {
    UPLOAD_BUDGET
        .checked_sub(started.elapsed())
        .filter(|d| !d.is_zero())
}

pub(super) fn after_scan(io: &mut Io, scan: &Scan, quiet: bool) {
    let started = std::time::Instant::now();
    let env = io.env.clone();
    let Some(local) =
        crate::session::read_within(UPLOAD_BUDGET, move || Local::read(&env)).flatten()
    else {
        return;
    };
    if !local.sync() || !local.design.unwrap_or(DESIGN_SYNC_DEFAULT_ON) {
        return;
    }
    let generation = local.design_generation;
    let Ok(account) = Account::from_env(&io.env) else {
        return;
    };
    let Some(wait) = remaining(started) else {
        return;
    };
    let Some(session) = Session::load_for_upload(&account, wait) else {
        return;
    };
    // State and token came from one locked, generation-checked snapshot.
    let original = session.state.clone();
    let login = original.login;
    let root = scan.root.clone();
    let env = io.env.clone();
    let Some(wait) = remaining(started) else {
        return;
    };
    // Only preparation is handed to this read worker, never a token or POST.
    // A slow filesystem/git call can finish after detect stops waiting safely.
    let Some((repo, text, sidecar)) =
        crate::session::read_within(wait, move || prepare(&root, &env, Repo::of)).flatten()
    else {
        return;
    };
    let digest = hex(&hash(&[&text, &sidecar.to_string()]));
    let marker = hex(&hash(&[
        &account.issuer,
        &login.to_string(),
        &repo.key,
        &generation.to_string(),
    ]));
    let mut body = json!({
        "version": 1, "uploadId": scan_id(), "repoKey": repo.key,
        "changedAt": impeccable_context::util::iso_from_ms(SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as f64),
        "text": text, "sidecar": sidecar,
    });
    if let Some(label) = &repo.label {
        body["label"] = label.clone().into();
    }
    if serde_json::to_vec(&body).map_or(true, |b| b.len() > BODY_BYTES) {
        return;
    }
    if !session
        .state
        .scopes
        .iter()
        .any(|s| s == crate::oauth::DESIGN_SCOPE)
    {
        let Ok(_admission) = crate::store::Store::design_lock_for(&account.home, Duration::ZERO)
        else {
            return;
        };
        if enabled_generation(&io.env, generation) {
            crate::stale_grant::emit(
                io,
                &account,
                login,
                Some(crate::oauth::DESIGN_SCOPE),
                remaining(started).unwrap_or_default(),
                quiet,
            );
        }
        return;
    }
    let session = if session.existing_access_token().is_none() {
        let Some(fresh) =
            crate::session::renew_for_upload(io, &account, started, "health-design-refresh")
        else {
            return;
        };
        fresh
    } else {
        session
    };
    if !session.matches_upload(&original) {
        return;
    }
    if !session
        .state
        .scopes
        .iter()
        .any(|s| s == crate::oauth::DESIGN_SCOPE)
    {
        let Ok(_admission) = crate::store::Store::design_lock_for(&account.home, Duration::ZERO)
        else {
            return;
        };
        if enabled_generation(&io.env, generation) {
            crate::stale_grant::emit(
                io,
                &account,
                login,
                Some(crate::oauth::DESIGN_SCOPE),
                remaining(started).unwrap_or_default(),
                quiet,
            );
        }
        return;
    }
    let Some(token) = session.existing_access_token() else {
        return;
    };
    let home = account.home.clone();
    let env = io.env.clone();
    let expected = digest.clone();
    let Some(wait) = remaining(started) else {
        return;
    };
    let Some((path, cache_lock, admission, cached)) =
        crate::session::read_within(wait, move || {
            let path = home.join("health/repos").join(format!("{marker}.design"));
            std::fs::create_dir_all(path.parent()?).ok()?;
            let cache_lock = std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false)
                .open(path.with_extension("design.lock"))
                .ok()?;
            cache_lock.try_lock().ok()?;
            let cached = std::fs::read_to_string(&path).ok().as_deref() == Some(&expected);
            let admission = crate::store::Store::design_lock_for(&home, Duration::ZERO).ok()?;
            if !enabled_generation(&env, generation) {
                return None;
            }
            Some((path, cache_lock, admission, cached))
        })
        .flatten()
    else {
        return;
    };
    if cached {
        // A prior successful machine-output upload still owes the human notice.
        crate::upload_notice::emit(
            io,
            &account,
            login,
            crate::upload_notice::Kind::Design,
            quiet,
        );
        return;
    }
    // Admission stays held continuously from the settings check through POST
    // and digest persistence. Off/forget cannot return success in that interval.
    let Some(left) = remaining(started) else {
        return;
    };
    let answer = Client::with_deadline(&account, left).post_json(
        &format!("{}/cli/v1/design", account.issuer),
        token,
        body,
    );
    if !answer
        .ok()
        .is_some_and(|v| matches!(v["outcome"].as_str(), Some("recorded" | "repeat")))
    {
        return;
    }
    crate::upload_notice::emit(
        io,
        &account,
        login,
        crate::upload_notice::Kind::Design,
        quiet,
    );
    let Some(left) = remaining(started) else {
        return;
    };
    let env = io.env.clone();
    // Only local cache persistence may outlive the caller here. It retains the
    // admission lock, so even a stalled filesystem cannot save after off succeeds.
    let _ = crate::session::read_within(left, move || {
        let (_cache_lock, _admission) = (cache_lock, admission);
        if enabled_generation(&env, generation) {
            let _ = crate::store::write_private(&path, digest.as_bytes());
        }
    });
}

fn enabled_generation(env: &std::collections::HashMap<String, String>, generation: u64) -> bool {
    Local::read(env).is_some_and(|l| {
        l.sync() && l.design.unwrap_or(DESIGN_SYNC_DEFAULT_ON) && l.design_generation == generation
    })
}

/// Hidden renewal-only verb, shared with critique uploads.
pub(super) fn run_refresh(args: &[String], io: &mut Io) -> i32 {
    crate::session::run_upload_refresh(args, io)
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

fn prepare(
    root: &str,
    env: &std::collections::HashMap<String, String>,
    identify: impl FnOnce(&str, &std::collections::HashMap<String, String>) -> Option<Repo>,
) -> Option<(Repo, String, Value)> {
    let path = Path::new(root);
    let reader = crate::design_read::Reader::new(path)?;
    let repo = identify(root, env)?;
    if !reader.matches_root(path) {
        return None;
    }
    let text = String::from_utf8(reader.read(false, TEXT_BYTES)?).ok()?;
    if text.trim().is_empty() || text.contains('\0') {
        return None;
    }
    let sidecar = reader
        .read(true, 256 * 1024)
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .and_then(|v| metadata(&v["extensions"]))
        .unwrap_or(Value::Null);
    if !reader.matches_root(path) {
        return None;
    }
    Some((repo, text, sidecar))
}

#[cfg(all(test, unix))]
mod identity_tests {
    use super::*;
    fn replaced(ancestor: bool) {
        use std::os::unix::fs::symlink;
        let base =
            std::env::temp_dir().join(format!("design-identity-{}", crate::oauth::random_b64(12)));
        struct Cleanup(PathBuf);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
        let _cleanup = Cleanup(base.clone());
        let root = base.join("parent/repo");
        let outside = base.join("outside/repo");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(root.join("DESIGN.md"), "# A\n").unwrap();
        std::fs::write(outside.join("DESIGN.md"), "# Outside B\n").unwrap();
        let body = prepare(&root.to_string_lossy(), &Default::default(), |_, _| {
            if ancestor {
                std::fs::rename(base.join("parent"), base.join("original")).unwrap();
                symlink(base.join("outside"), base.join("parent")).unwrap();
            } else {
                std::fs::rename(&root, base.join("original")).unwrap();
                symlink(&outside, &root).unwrap();
            }
            Some(Repo {
                key: "00".repeat(32),
                stream: "11".repeat(32),
                label: None,
            })
        });
        assert!(
            body.is_none(),
            "a changed directory identity must fail closed"
        );
    }
    #[test]
    fn a_root_replaced_during_identification_is_refused() {
        replaced(false);
    }
    #[test]
    fn an_ancestor_replaced_during_identification_is_refused() {
        replaced(true);
    }
}

#[cfg(test)]
mod preference_tests {
    use super::*;

    #[test]
    fn design_default_is_on_and_explicit_off_wins() {
        let home =
            std::env::temp_dir().join(format!("design-default-{}", crate::oauth::random_b64(12)));
        let env = [(
            "IMPECCABLE_HOME".into(),
            home.to_string_lossy().into_owned(),
        )]
        .into();
        assert!(enabled_generation(&env, 0));
        Local::update(&env, |l| l.design = Some(false)).unwrap();
        assert!(!enabled_generation(&env, 0));
        std::fs::remove_dir_all(home).unwrap();
    }
}

#[cfg(test)]
mod notice_regressions {
    use super::*;
    #[test]
    fn cached_machine_upload_owes_notice_on_next_human_scan() {
        let home =
            std::env::temp_dir().join(format!("design-notice-{}", crate::oauth::random_b64(12)));
        let root = home.join("repo");
        std::fs::create_dir_all(&root).unwrap();
        assert!(Command::new("git")
            .args(["init", "-q"])
            .arg(&root)
            .status()
            .unwrap()
            .success());
        assert!(Command::new("git")
            .arg("-C")
            .arg(&root)
            .args([
                "config",
                "remote.origin.url",
                "https://example.com/test/repo.git"
            ])
            .status()
            .unwrap()
            .success());
        std::fs::write(root.join("DESIGN.md"), "# Test design\n").unwrap();
        let env = [(
            "IMPECCABLE_HOME".into(),
            home.to_string_lossy().into_owned(),
        )]
        .into();
        let account = Account::from_env(&env).unwrap();
        let store = crate::store::Store::new(&account);
        let state = crate::store::State {
            schema: 1,
            foundations: false,
            scopes: vec![crate::oauth::DESIGN_SCOPE.into()],
            issuer: account.issuer.clone(),
            generation: 1,
            signed_in: true,
            backend: crate::store::Backend::File,
            token_endpoint: "http://127.0.0.1:1/oauth/token".into(),
            revocation_endpoint: None,
            login: 1,
            signed_out_at: 0,
        };
        let secret = crate::store::Secret {
            generation: 1,
            refresh_token: "test-refresh".into(),
            access_token: "test-access".into(),
            access_expires_at: crate::session::now() + 900,
        };
        let lock = store.lock().unwrap();
        store.save(&lock, &state, &secret).unwrap();
        drop(lock);
        let (repo, text, sidecar) = prepare(&root.to_string_lossy(), &env, Repo::of).unwrap();
        let marker = hex(&hash(&[&account.issuer, "1", &repo.key, "0"]));
        let path = home.join("health/repos").join(format!("{marker}.design"));
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, hex(&hash(&[&text, &sidecar.to_string()]))).unwrap();
        let scan = Scan {
            foundations: Default::default(),
            root: root.to_string_lossy().into_owned(),
            files_scanned: 1,
            hits: vec![],
            ruleset: vec![],
            engine_version: "test".into(),
            started: SystemTime::now(),
        };
        let (mut io, cap) = Io::captured("", root, env);
        after_scan(&mut io, &scan, true);
        assert!(cap.stderr.borrow().is_empty());
        after_scan(&mut io, &scan, false);
        assert!(String::from_utf8_lossy(&cap.stderr.borrow()).contains("Uploaded your DESIGN.md"));
        let first = cap.stderr.borrow().clone();
        after_scan(&mut io, &scan, false);
        assert_eq!(*cap.stderr.borrow(), first);
        std::fs::remove_dir_all(home).unwrap();
    }
}
