use super::*;
use crate::render::{render_codex_config, render_rule};
use std::sync::Mutex;

static MCP_ENV_LOCK: Mutex<()> = Mutex::new(());
#[cfg(unix)]
fn fake_claude(root: &Path) -> (PathBuf, PathBuf) {
    use std::os::unix::fs::PermissionsExt;
    let script = root.join("fake-claude");
    let state = root.join("mcp-state.json");
    fs::write(
        &script,
        "#!/bin/sh\ncase \"$2\" in\nget) [ -f \"$MCP_STATE\" ] || exit 1; cat \"$MCP_STATE\";;\nadd-json) printf '%s' \"$6\" > \"$MCP_STATE\";;\nremove) rm -f \"$MCP_STATE\";;\nesac\nexit 0\n",
    )
    .unwrap();
    fs::set_permissions(&script, fs::Permissions::from_mode(0o700)).unwrap();
    (script, state)
}
#[cfg(unix)]
fn set_fake_claude(script: &Path, state: &Path) {
    std::env::set_var("IMPECCABLE_CLAUDE_BIN", script);
    std::env::set_var("MCP_STATE", state);
}
#[cfg(unix)]
fn clear_fake_claude() {
    std::env::remove_var("IMPECCABLE_CLAUDE_BIN");
    std::env::remove_var("MCP_STATE");
}
fn spec(harness: &str, root: PathBuf) -> Spec {
    Spec {
        version: 1,
        owner: "impeccable-loop".into(),
        harness: harness.into(),
        root,
        hooks: vec![],
        mcp_servers: vec![],
        instruction: Some("managed text".into()),
    }
}
fn temp() -> PathBuf {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    let p = std::env::temp_dir().join(format!(
        "impeccable-agents-test-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(&p).unwrap();
    p
}
#[test]
fn rule_render_preserves_crlf_and_outside_bytes() {
    let s = spec("claude", temp());
    let before = b"Keep\r\n\r\n";
    let out = render_rule(&s, Some(before)).unwrap();
    assert!(String::from_utf8(out)
        .unwrap()
        .starts_with("Keep\r\n\r\n<!-- impeccable:impeccable-loop start -->"));
}
#[test]
fn marker_body_and_ambiguous_markers_refused() {
    let mut s = spec("claude", temp());
    s.instruction = Some("bad <!-- impeccable:x -->".into());
    assert!(validate(&s).is_err());
    s.instruction = Some("valid".into());
    assert_eq!(
        render_rule(&s, Some(b"<!-- impeccable:impeccable-loop start -->\nx\n"))
            .unwrap_err()
            .0,
        "ambiguous_markers"
    );
    assert_eq!(render_rule(&s,Some(b"<!-- impeccable:impeccable-loop start -->\na\n<!-- impeccable:impeccable-loop end -->\n<!-- impeccable:impeccable-loop start -->\nb\n<!-- impeccable:impeccable-loop end -->\n")).unwrap_err().0,"ambiguous_markers");
}
#[test]
fn rule_block_removal_preserves_outside_crlf_and_blank_lines() {
    let s = spec("claude", temp());
    let original = b"Before\r\n\r\n";
    let mut current = render_rule(&s, Some(original)).unwrap();
    current.extend_from_slice(b"After\r\n\r\n");
    let removed = render::remove_owned(&s, &s.root.join("CLAUDE.md"), &current, Some(original))
        .unwrap()
        .unwrap();
    assert_eq!(removed, b"Before\r\nAfter\r\n\r\n");
}
#[test]
fn settings_invalid_json_refused() {
    let s = spec("claude", temp());
    let p = s.root.join("settings.json");
    assert_eq!(
        render(&s, &p, Some(b"{/* comment */}")).unwrap_err().0,
        "invalid_settings"
    );
    assert_eq!(
        render(&s, &p, Some(b"[]")).unwrap_err().0,
        "invalid_settings"
    );
}
#[test]
fn duplicate_json_keys_are_refused_unchanged() {
    let s = spec("claude", temp());
    let bytes = b"{\"hooks\":{},\"hooks\":{}}";
    let p = s.root.join("settings.json");
    assert_eq!(
        render(&s, &p, Some(bytes)).unwrap_err().0,
        "invalid_settings"
    );
    assert_eq!(bytes, b"{\"hooks\":{},\"hooks\":{}}");
}
#[test]
fn journal_records_each_hook_resource_and_claim() {
    let root = temp();
    let home = temp();
    let mut s = spec("claude", root.clone());
    s.hooks.push(Hook {
        event: "PreToolUse".into(),
        matcher: Some("Edit".into()),
        command: "loop-hook".into(),
    });
    let j = apply(&s, None, &home, &home.join("journal"), None).unwrap();
    let hook = j.resources.iter().find(|r| r.kind == "hook").unwrap();
    assert_eq!(hook.state, ResourceState::Created);
    assert_eq!(hook.claims[0].account_root, root);
    assert!(hook.original_value.is_none());
    assert_eq!(hook.last_written_value["hooks"][0]["command"], "loop-hook");
}
#[test]
fn codex_features_setting_uses_toml_edit_and_preserves_comments() {
    let mut s = spec("codex", temp());
    s.hooks.push(Hook {
        event: "PreToolUse".into(),
        matcher: None,
        command: "loop-hook".into(),
    });
    let result = render_codex_config(
        &s,
        Some(b"model = 'x'\n\n[features]\nhooks = false # user note\n\n[other]\nx = 1\n"),
    )
    .unwrap();
    assert_eq!(
        String::from_utf8(result).unwrap(),
        "model = 'x'\n\n[features]\nhooks = true # user note\n\n[other]\nx = 1\n"
    );
    let commented = render_codex_config(&s, Some(b"# keep this comment\nmodel = 'x'\n")).unwrap();
    assert!(String::from_utf8(commented)
        .unwrap()
        .starts_with("# keep this comment\n"));
    assert_eq!(
        render_codex_config(&s, Some(b"[features]\nhooks = false\n[features]\n"))
            .unwrap_err()
            .0,
        "invalid_settings"
    );
    let with_mcp = render_codex_config(
        &s,
        Some(b"[mcp_servers.tools]\ncommand = 'tool'\n\n[features]\nhooks = false\n"),
    )
    .unwrap();
    assert!(String::from_utf8(with_mcp)
        .unwrap()
        .contains("[mcp_servers.tools]"));
}
#[test]
fn codex_toml_edit_accepts_inline_tables_and_quoted_dotted_server_names() {
    let mut s = spec("codex", temp());
    s.hooks.push(Hook {
        event: "PreToolUse".into(),
        matcher: None,
        command: "loop-hook".into(),
    });
    let input = "[mcp_servers.\"local.tools\"]\ncommand = 'tool'\nenv = { MODE = 'test', ENABLED = true }\n";
    let output = render_codex_config(&s, Some(input.as_bytes())).unwrap();
    let output = String::from_utf8(output).unwrap();
    assert!(output.contains("[mcp_servers.\"local.tools\"]"));
    assert!(output.contains("env = { MODE = 'test', ENABLED = true }"));
    assert!(output.contains("[features]\nhooks = true"));
}
#[test]
fn codex_toml_edit_preserves_crlf_and_existing_feature_keys() {
    let mut s = spec("codex", temp());
    s.hooks.push(Hook {
        event: "PreToolUse".into(),
        matcher: None,
        command: "loop-hook".into(),
    });
    let input = b"model = 'x'\r\n\r\n[features]\r\nother = true\r\n\r\n[mcp_servers.\"a.b\"]\r\ncommand = 'tool'\r\n";
    let output = render_codex_config(&s, Some(input)).unwrap();
    let output = String::from_utf8(output).unwrap();
    assert!(
        output.contains("[features]\r\nother = true\r\nhooks = true\r\n"),
        "{output:?}"
    );
    assert!(output.contains("[mcp_servers.\"a.b\"]\r\ncommand = 'tool'\r\n"));
    assert!(!output.replace("\r\n", "").contains('\n'));
}
#[cfg(unix)]
#[test]
fn strict_writer_preserves_symlink_and_refuses_dangling_link() {
    use std::os::unix::fs::symlink;
    let root = temp();
    let real = root.join("real.json");
    let link = root.join("linked.json");
    fs::write(&real, b"old").unwrap();
    symlink(&real, &link).unwrap();
    safe_write(&link, Some(b"old"), b"new").unwrap();
    assert!(fs::symlink_metadata(&link)
        .unwrap()
        .file_type()
        .is_symlink());
    assert_eq!(fs::read(&real).unwrap(), b"new");
    let dangling = root.join("dangling");
    symlink(root.join("missing"), &dangling).unwrap();
    assert_eq!(validate_file(&dangling).unwrap_err().0, "unsafe_target");
    let cycle_a = root.join("cycle-a");
    let cycle_b = root.join("cycle-b");
    symlink(&cycle_b, &cycle_a).unwrap();
    symlink(&cycle_a, &cycle_b).unwrap();
    assert_eq!(validate_file(&cycle_a).unwrap_err().0, "unsafe_target");
}
#[test]
fn recover_rolls_back_each_interrupted_write_boundary() {
    for point in [
        "journal_intent",
        "temp_synced",
        "before_rename",
        "after_rename",
        "directory_synced",
        "post_verify",
        "mcp_synced",
        "journal_commit",
        "state_temp_synced",
        "state_before_rename",
        "state_after_rename",
        "state_directory_synced",
        "state_verified",
    ] {
        let root = temp();
        let home = temp();
        let s = spec("claude", root.clone());
        let journal = home.join("install.json");
        TEST_FAILPOINT.with(|v| v.set(Some(point)));
        let applied = apply(&s, None, &home, &journal, None);
        if point == "journal_commit" {
            let value = applied.unwrap();
            write_journal(&journal, &value).unwrap();
            assert_eq!(failpoint(point).unwrap_err().0, "injected_failure");
        } else {
            assert_eq!(applied.unwrap_err().0, "injected_failure");
        }
        TEST_FAILPOINT.with(|v| v.set(None));
        let result = recover(&home, &installation_id(&s)).unwrap();
        let expected = if point == "state_temp_synced" || point == "state_before_rename" {
            "clean"
        } else {
            "rolled-back"
        };
        assert_eq!(result["state"], expected, "failpoint {point}");
        assert!(!root.join("CLAUDE.md").exists());
        assert!(!journal.exists());
    }
    for point in [
        "state_temp_synced",
        "state_before_rename",
        "state_after_rename",
        "state_directory_synced",
        "state_verified",
    ] {
        let root = temp();
        let home = temp();
        let s = spec("claude", root.clone());
        let journal = home.join("install.json");
        let value = apply(&s, None, &home, &journal, None).unwrap();
        TEST_FAILPOINT.with(|v| v.set(Some(point)));
        assert_eq!(
            write_journal(&journal, &value).unwrap_err().0,
            "injected_failure"
        );
        TEST_FAILPOINT.with(|v| v.set(None));
        let result = recover(&home, &installation_id(&s)).unwrap();
        assert_eq!(result["state"], "rolled-back", "commit failpoint {point}");
        assert!(!journal.exists());
        assert!(!root.join("CLAUDE.md").exists());
    }
}
#[test]
fn recover_restores_created_file_after_interrupted_delete() {
    for point in ["after_delete", "delete_directory_synced"] {
        let root = temp();
        let home = temp();
        let journal = home.join(format!(
            "{}.json",
            installation_id(&spec("claude", root.clone()))
        ));
        let initial = spec("claude", root.clone());
        let installed = apply(&initial, None, &home, &journal, None).unwrap();
        write_journal(&journal, &installed).unwrap();
        let path = root.join("CLAUDE.md");
        let installed_bytes = fs::read(&path).unwrap();
        let mut desired = initial.clone();
        desired.instruction = None;
        TEST_FAILPOINT.with(|v| v.set(Some(point)));
        let result = apply(
            &desired,
            Some(&installed),
            &home,
            &journal,
            fs::read(&journal).ok(),
        );
        TEST_FAILPOINT.with(|v| v.set(None));
        assert_eq!(result.unwrap_err().0, "injected_failure");
        assert!(!path.exists());
        let recovered = recover(&home, &installation_id(&initial)).unwrap();
        assert_eq!(recovered["state"], "rolled-back", "failpoint {point}");
        assert_eq!(fs::read(path).unwrap(), installed_bytes);
    }
}
#[test]
fn two_owners_can_undo_in_either_order_and_keep_the_other_hook() {
    for reverse in [false, true] {
        let root = temp();
        let home = temp();
        fs::write(root.join("settings.json"), b"{}\n").unwrap();
        let mut a = spec("claude", root.clone());
        a.owner = "impeccable-design".into();
        a.hooks.push(Hook {
            event: "PreToolUse".into(),
            matcher: None,
            command: "design".into(),
        });
        let mut b = spec("claude", root.clone());
        b.owner = "impeccable-loop".into();
        b.hooks.push(Hook {
            event: "PreToolUse".into(),
            matcher: None,
            command: "loop".into(),
        });
        let ja = apply(&a, None, &home, &home.join("a"), None).unwrap();
        let pa = home.join(format!("{}.json", installation_id(&a)));
        write_journal(&pa, &ja).unwrap();
        let jb = apply(&b, None, &home, &home.join("b"), None).unwrap();
        let pb = home.join(format!("{}.json", installation_id(&b)));
        write_journal(&pb, &jb).unwrap();
        if reverse {
            undo(&b, Some(&jb), &home).unwrap();
            let _ = fs::remove_file(&pb);
            assert!(
                String::from_utf8(fs::read(root.join("settings.json")).unwrap())
                    .unwrap()
                    .contains("design")
            );
            undo(&a, Some(&ja), &home).unwrap();
            let _ = fs::remove_file(&pa);
        } else {
            undo(&a, Some(&ja), &home).unwrap();
            let _ = fs::remove_file(&pa);
            assert!(
                String::from_utf8(fs::read(root.join("settings.json")).unwrap())
                    .unwrap()
                    .contains("loop")
            );
            undo(&b, Some(&jb), &home).unwrap();
            let _ = fs::remove_file(&pb);
        }
        let result: Value =
            serde_json::from_slice(&fs::read(root.join("settings.json")).unwrap()).unwrap();
        assert_eq!(result, json!({}), "reverse={reverse}");
    }
}
#[test]
fn preexisting_identical_hook_is_never_removed() {
    let root = temp();
    let home = temp();
    let mut s = spec("claude", root.clone());
    s.hooks.push(Hook {
        event: "PreToolUse".into(),
        matcher: None,
        command: "already-here".into(),
    });
    let path = root.join("settings.json");
    let expected=serde_json::to_vec_pretty(&json!({"hooks":{"PreToolUse":[{"matcher":null,"hooks":[{"type":"command","command":"already-here"}]}]}})).unwrap();
    fs::write(&path, &expected).unwrap();
    let j = apply(&s, None, &home, &home.join("journal"), None).unwrap();
    undo(&s, Some(&j), &home).unwrap();
    assert_eq!(fs::read(path).unwrap(), expected);
}
#[test]
fn newer_journal_is_refused() {
    let path = temp().join("future.json");
    fs::write(&path, b"{\"version\":99}").unwrap();
    assert_eq!(read_journal(&path).unwrap_err().0, "newer_journal");
}
#[test]
fn undo_surgically_removes_managed_hook_after_user_edit() {
    let root = temp();
    let home = temp();
    let mut s = spec("claude", root.clone());
    s.hooks.push(Hook {
        event: "PreToolUse".into(),
        matcher: None,
        command: "managed".into(),
    });
    let journal = home.join("journal");
    let j = apply(&s, None, &home, &journal, None).unwrap();
    let path = root.join("settings.json");
    let mut value: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    value["user"] = json!(true);
    let mut current = serde_json::to_vec_pretty(&value).unwrap();
    current.push(b'\n');
    fs::write(&path, &current).unwrap();
    undo(&s, Some(&j), &home).unwrap();
    let result: Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
    assert_eq!(result["user"], true);
    assert!(result.get("hooks").is_none());
}
#[test]
fn apply_converges_when_a_hook_is_removed_from_the_spec() {
    let root = temp();
    let home = temp();
    let mut s = spec("claude", root.clone());
    s.hooks.push(Hook {
        event: "PreToolUse".into(),
        matcher: None,
        command: "remove-me".into(),
    });
    let p = home.join("journal");
    let first = apply(&s, None, &home, &p, None).unwrap();
    let mut desired = s.clone();
    desired.hooks.clear();
    desired.instruction = None;
    let second = apply(&desired, Some(&first), &home, &p, None).unwrap();
    assert!(second.snapshots.is_empty());
    assert_eq!(fs::read(root.join("settings.json")).unwrap(), b"{}\n");
    assert!(!root.join("CLAUDE.md").exists());
}
#[cfg(unix)]
#[test]
fn shared_codex_features_claim_is_restored_after_last_installation() {
    use std::os::unix::fs::symlink;
    let home = temp();
    let root_a = temp();
    let root_b = temp();
    let config = home.join("config.toml");
    fs::write(&config, b"model = 'x'\n").unwrap();
    symlink(&config, root_a.join("config.toml")).unwrap();
    symlink(&config, root_b.join("config.toml")).unwrap();
    let mut a = spec("codex", root_a.clone());
    a.hooks.push(Hook {
        event: "PreToolUse".into(),
        matcher: None,
        command: "a".into(),
    });
    let mut b = spec("codex", root_b.clone());
    b.owner = "impeccable-design".into();
    b.hooks = a.hooks.clone();
    let ja = apply(&a, None, &home, &home.join("a"), None).unwrap();
    let pa = home.join(format!("{}.json", installation_id(&a)));
    write_journal(&pa, &ja).unwrap();
    let jb = apply(&b, None, &home, &home.join("b"), None).unwrap();
    let pb = home.join(format!("{}.json", installation_id(&b)));
    write_journal(&pb, &jb).unwrap();
    undo(&a, Some(&ja), &home).unwrap();
    let _ = fs::remove_file(pa);
    assert!(String::from_utf8(fs::read(&config).unwrap())
        .unwrap()
        .contains("hooks = true"));
    undo(&b, Some(&jb), &home).unwrap();
    assert_eq!(fs::read(config).unwrap(), b"model = 'x'\n");
}
#[test]
fn non_regular_target_is_refused() {
    let root = temp();
    let dir = root.join("settings.json");
    fs::create_dir(&dir).unwrap();
    let err = validate_file(&dir).unwrap_err();
    assert_eq!(err.0, "unsafe_target");
}
#[cfg(unix)]
#[test]
fn private_state_directory_and_lock_have_restricted_modes() {
    use std::os::unix::fs::PermissionsExt;
    let root = temp();
    let home = root.join(".impeccable").join("agents");
    ensure_private_home(&home).unwrap();
    assert_eq!(
        fs::metadata(&home).unwrap().permissions().mode() & 0o777,
        0o700
    );
    let lock_path = home.join("agents.lock");
    let _guard = acquire_lock(&lock_path, Duration::from_secs(1)).unwrap();
    assert_eq!(
        fs::metadata(lock_path).unwrap().permissions().mode() & 0o777,
        0o600
    );
}
#[test]
fn codex_override_status_is_not_effective() {
    let root = temp();
    fs::write(root.join("AGENTS.override.md"), b"Override\n").unwrap();
    let s = spec("codex", root);
    let status = status(&s, None).unwrap();
    assert_eq!(status["effective"], false);
}
#[cfg(unix)]
#[test]
fn two_accounts_sharing_symlinked_settings_hold_separate_claims() {
    use std::os::unix::fs::symlink;
    let home = temp();
    let physical = home.join("shared-settings.json");
    fs::write(&physical, b"{}\n").unwrap();
    let account_a = temp();
    let account_b = temp();
    symlink(&physical, account_a.join("settings.json")).unwrap();
    symlink(&physical, account_b.join("settings.json")).unwrap();
    let mut a = spec("claude", account_a.clone());
    a.hooks.push(Hook {
        event: "PreToolUse".into(),
        matcher: None,
        command: "same-hook".into(),
    });
    let mut b = a.clone();
    b.root = account_b.clone();
    let ja = apply(&a, None, &home, &home.join("a.json"), None).unwrap();
    write_journal(&home.join(format!("{}.json", installation_id(&a))), &ja).unwrap();
    let after_a = fs::read(&physical).unwrap();
    #[cfg(unix)]
    let inode_a = {
        use std::os::unix::fs::MetadataExt;
        fs::metadata(&physical).unwrap().ino()
    };
    let jb = apply(&b, None, &home, &home.join("b.json"), None).unwrap();
    write_journal(&home.join(format!("{}.json", installation_id(&b))), &jb).unwrap();
    assert_eq!(fs::read(&physical).unwrap(), after_a);
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        assert_eq!(
            fs::metadata(&physical).unwrap().ino(),
            inode_a,
            "second account must not rewrite the shared file"
        );
    }
    undo(&a, Some(&ja), &home).unwrap();
    let _ = fs::remove_file(home.join(format!("{}.json", installation_id(&a))));
    assert_eq!(fs::read(&physical).unwrap(), after_a);
    undo(&b, Some(&jb), &home).unwrap();
    assert_eq!(fs::read(&physical).unwrap(), b"{}\n");
    assert!(fs::symlink_metadata(account_a.join("settings.json"))
        .unwrap()
        .file_type()
        .is_symlink());
}
#[cfg(unix)]
#[test]
fn conflicting_values_for_a_shared_account_resource_are_refused() {
    use std::os::unix::fs::symlink;
    let home = temp();
    let physical = home.join("settings.json");
    fs::write(&physical, b"{}\n").unwrap();
    let aroot = temp();
    let broot = temp();
    symlink(&physical, aroot.join("settings.json")).unwrap();
    symlink(&physical, broot.join("settings.json")).unwrap();
    let mut a = spec("claude", aroot);
    a.hooks.push(Hook {
        event: "PreToolUse".into(),
        matcher: None,
        command: "one".into(),
    });
    let ja = apply(&a, None, &home, &home.join("a"), None).unwrap();
    write_journal(&home.join(format!("{}.json", installation_id(&a))), &ja).unwrap();
    let mut b = spec("claude", broot);
    b.hooks.push(Hook {
        event: "PreToolUse".into(),
        matcher: None,
        command: "two".into(),
    });
    assert_eq!(
        apply(&b, None, &home, &home.join("b"), None).unwrap_err().0,
        "shared_resource_conflict"
    );
}
#[test]
fn identical_hook_is_not_duplicated() {
    let mut s = spec("claude", temp());
    s.hooks.push(Hook {
        event: "PreToolUse".into(),
        matcher: None,
        command: "echo".into(),
    });
    let p = s.root.join("settings.json");
    let first = render(&s, &p, None).unwrap();
    let second = render(&s, &p, Some(&first)).unwrap();
    assert_eq!(first, second);
}
#[test]
fn preexisting_identical_hook_keeps_original_json_bytes() {
    let mut s = spec("claude", temp());
    s.instruction = None;
    s.hooks.push(Hook {
        event: "PreToolUse".into(),
        matcher: None,
        command: "already-here".into(),
    });
    let path = s.root.join("settings.json");
    let bytes = br#"{"hooks":{"PreToolUse":[{"matcher":null,"hooks":[{"type":"command","command":"already-here"}]}]}}"#;
    assert_eq!(render(&s, &path, Some(bytes)).unwrap(), bytes);
}
#[test]
fn plan_reports_actual_changes_and_json_reformatting_without_writing() {
    let root = temp();
    let path = root.join("settings.json");
    let bytes = b"{\"other\":1}";
    fs::write(&path, bytes).unwrap();
    let mut s = spec("claude", root);
    s.instruction = None;
    s.hooks.push(Hook {
        event: "PreToolUse".into(),
        matcher: None,
        command: "loop".into(),
    });
    let result = plan(&s, None, &temp()).unwrap();
    assert_eq!(result["resources"][0]["change"], "update");
    assert_eq!(result["resources"][0]["willReformat"], true);
    assert_eq!(fs::read(path).unwrap(), bytes);
}
#[test]
fn status_checks_owned_resources_without_marking_unrelated_edits_as_drift() {
    let root = temp();
    let home = temp();
    let mut s = spec("claude", root.clone());
    s.hooks.push(Hook {
        event: "PreToolUse".into(),
        matcher: None,
        command: "loop".into(),
    });
    let journal = apply(&s, None, &home, &home.join("journal"), None).unwrap();
    let settings = root.join("settings.json");
    let mut value: Value = serde_json::from_slice(&fs::read(&settings).unwrap()).unwrap();
    value["userSetting"] = json!("kept");
    fs::write(&settings, serde_json::to_vec_pretty(&value).unwrap()).unwrap();
    let state = status(&s, Some(&journal)).unwrap();
    assert_eq!(
        state["resources"]
            .as_array()
            .unwrap()
            .iter()
            .find(|resource| resource["kind"] == "hook")
            .unwrap()["state"],
        "created"
    );
    value["hooks"]["PreToolUse"][0]["hooks"][0]["command"] = json!("edited-by-user");
    fs::write(&settings, serde_json::to_vec_pretty(&value).unwrap()).unwrap();
    let state = status(&s, Some(&journal)).unwrap();
    assert_eq!(
        state["resources"]
            .as_array()
            .unwrap()
            .iter()
            .find(|resource| resource["kind"] == "hook")
            .unwrap()["state"],
        "conflict"
    );
}
#[test]
fn apply_then_undo_restores_original_bytes() {
    let root = temp();
    fs::write(root.join("settings.json"), b"{\"other\":1}\n").unwrap();
    fs::write(root.join("CLAUDE.md"), b"Team notes\r\n").unwrap();
    let s = spec("claude", root.clone());
    let home = temp();
    let journal = home.join("journal.json");
    let j = apply(&s, None, &home, &journal, None).unwrap();
    assert!(String::from_utf8(fs::read(root.join("CLAUDE.md")).unwrap())
        .unwrap()
        .contains("impeccable:impeccable-loop"));
    let result = undo(&s, Some(&j), &home).unwrap();
    assert!(result["conflicts"].as_array().unwrap().is_empty());
    assert_eq!(
        fs::read(root.join("settings.json")).unwrap(),
        b"{\"other\":1}\n"
    );
    assert_eq!(fs::read(root.join("CLAUDE.md")).unwrap(), b"Team notes\r\n");
}
#[test]
fn no_op_reapply_keeps_compact_settings_byte_exact_undo_eligibility() {
    let root = temp();
    let original = br#"{"hooks":{"PreToolUse":[{"matcher":"Edit","hooks":[{"type":"command","command":"personal-hook"}]}]},"other":{"compact":true}}"#;
    let settings = root.join("settings.json");
    fs::write(&settings, original).unwrap();
    let mut desired = spec("claude", root.clone());
    desired.instruction = None;
    desired.hooks.push(Hook {
        event: "PreToolUse".into(),
        matcher: Some("Write".into()),
        command: "impeccable-hook".into(),
    });
    let home = temp();
    let journal_path = home.join(format!("{}.json", installation_id(&desired)));

    let first = apply(&desired, None, &home, &journal_path, None).unwrap();
    write_journal(&journal_path, &first).unwrap();
    let second = apply(
        &desired,
        Some(&first),
        &home,
        &journal_path,
        fs::read(&journal_path).ok(),
    )
    .unwrap();
    assert!(second
        .snapshots
        .iter()
        .all(|snapshot| snapshot.pure_install));
    write_journal(&journal_path, &second).unwrap();

    undo(&desired, Some(&second), &home).unwrap();
    assert_eq!(fs::read(settings).unwrap(), original);
}
#[test]
fn changed_spec_reapply_uses_surgical_undo_and_keeps_personal_hook() {
    let root = temp();
    let original = br#"{"hooks":{"PreToolUse":[{"matcher":"Edit","hooks":[{"type":"command","command":"personal-hook"}]}]},"other":{"compact":true}}"#;
    let settings = root.join("settings.json");
    fs::write(&settings, original).unwrap();
    let mut initial = spec("claude", root.clone());
    initial.instruction = None;
    initial.hooks.push(Hook {
        event: "PreToolUse".into(),
        matcher: Some("Write".into()),
        command: "impeccable-hook-v1".into(),
    });
    let home = temp();
    let journal_path = home.join(format!("{}.json", installation_id(&initial)));
    let first = apply(&initial, None, &home, &journal_path, None).unwrap();
    write_journal(&journal_path, &first).unwrap();

    let mut changed = initial.clone();
    changed.hooks[0].command = "impeccable-hook-v2".into();
    let second = apply(
        &changed,
        Some(&first),
        &home,
        &journal_path,
        fs::read(&journal_path).ok(),
    )
    .unwrap();
    assert!(second
        .snapshots
        .iter()
        .all(|snapshot| !snapshot.pure_install));
    write_journal(&journal_path, &second).unwrap();

    undo(&changed, Some(&second), &home).unwrap();
    let current = render::parse_unique_json(&fs::read(settings).unwrap()).unwrap();
    let entries = current["hooks"]["PreToolUse"].as_array().unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0]["hooks"][0]["command"], "personal-hook");
    assert_eq!(current["other"]["compact"], true);
}
#[test]
fn reapply_uses_user_edited_file_as_new_baseline() {
    let root = temp();
    fs::write(root.join("settings.json"), b"{}\n").unwrap();
    let s = spec("claude", root.clone());
    let home = temp();
    let journal = home.join("journal.json");
    let j = apply(&s, None, &home, &journal, None).unwrap();
    let path = root.join("CLAUDE.md");
    let mut edited = fs::read(&path).unwrap();
    edited.extend_from_slice(b"User addition\n");
    fs::write(&path, edited).unwrap();
    let j2 = apply(&s, Some(&j), &home, &journal, None).unwrap();
    assert!(
        !j2.snapshots[0].pure_install,
        "snapshots={:?}",
        j2.snapshots
    );
    undo(&s, Some(&j2), &home).unwrap();
    let final_text = String::from_utf8(fs::read(&path).unwrap()).unwrap();
    assert!(final_text.contains("User addition"));
    assert!(
        !final_text.contains("impeccable:impeccable-loop"),
        "{final_text:?}"
    );
}

mod mcp;
