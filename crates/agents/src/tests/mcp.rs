use super::*;

#[cfg(unix)]
#[test]
fn mcp_name_collision_is_detected_through_injected_cli() {
    use std::os::unix::fs::PermissionsExt;
    let _environment = MCP_ENV_LOCK.lock().unwrap();
    let root = temp();
    let script = root.join("fake-claude");
    fs::write(
        &script,
        "#!/bin/sh\nif [ \"$2\" = \"get\" ]; then printf '{\"command\":\"foreign\",\"args\":[],\"env\":{}}'; exit 0; fi\nexit 0\n",
    )
    .unwrap();
    fs::set_permissions(&script, fs::Permissions::from_mode(0o700)).unwrap();
    std::env::set_var("IMPECCABLE_CLAUDE_BIN", &script);
    let mut s = spec("claude", root.clone());
    s.mcp_servers.push(McpServer {
        name: "taken".into(),
        command: "ignored".into(),
        args: vec![],
        env: Default::default(),
    });
    let err = sync_mcp(&s, None, &root).unwrap_err();
    std::env::remove_var("IMPECCABLE_CLAUDE_BIN");
    assert_eq!(err.0, "mcp_name_collision");
}
#[cfg(unix)]
#[test]
fn recover_rolls_back_after_mcp_add_boundary() {
    use std::os::unix::fs::PermissionsExt;
    let _environment = MCP_ENV_LOCK.lock().unwrap();
    let root = temp();
    let home = temp();
    let script = root.join("fake-claude");
    fs::write(
        &script,
        "#!/bin/sh\ncase \"$2\" in\nget) [ -f \"$MCP_STATE\" ] || exit 1; cat \"$MCP_STATE\";;\nadd-json) printf '%s' \"$6\" > \"$MCP_STATE\";;\nremove) rm -f \"$MCP_STATE\";;\nesac\nexit 0\n",
    )
    .unwrap();
    fs::set_permissions(&script, fs::Permissions::from_mode(0o700)).unwrap();
    std::env::set_var("IMPECCABLE_CLAUDE_BIN", &script);
    std::env::set_var("MCP_STATE", root.join("mcp-state.json"));
    let mut s = spec("claude", root.clone());
    s.instruction = None;
    s.mcp_servers.push(McpServer {
        name: "engine-test".into(),
        command: "ignored".into(),
        args: vec![],
        env: Default::default(),
    });
    TEST_FAILPOINT.with(|v| v.set(Some("mcp_synced")));
    let applied = apply(&s, None, &home, &home.join("journal.json"), None);
    TEST_FAILPOINT.with(|v| v.set(None));
    assert_eq!(applied.unwrap_err().0, "injected_failure");
    let result = recover(&home, &installation_id(&s)).unwrap();
    std::env::remove_var("IMPECCABLE_CLAUDE_BIN");
    std::env::remove_var("MCP_STATE");
    assert_eq!(result["state"], "rolled-back");
    assert!(!home
        .join(format!("{}.pending.json", installation_id(&s)))
        .exists());
}
#[cfg(unix)]
#[test]
fn mcp_identical_server_claims_are_shared_until_last_undo() {
    let _environment = MCP_ENV_LOCK.lock().unwrap();
    let home = temp();
    let root = temp();
    let (script, state) = fake_claude(&root);
    set_fake_claude(&script, &state);
    let mut a = spec("claude", root.clone());
    a.instruction = None;
    a.owner = "impeccable-design".into();
    a.mcp_servers.push(McpServer {
        name: "shared".into(),
        command: "server".into(),
        args: vec!["--mode".into(), "safe".into()],
        env: Default::default(),
    });
    let pa = home.join(format!("{}.json", installation_id(&a)));
    let ja = apply(&a, None, &home, &pa, None).unwrap();
    write_journal(&pa, &ja).unwrap();
    let mut b = a.clone();
    b.owner = "impeccable-loop".into();
    let pb = home.join(format!("{}.json", installation_id(&b)));
    let jb = apply(&b, None, &home, &pb, None).unwrap();
    write_journal(&pb, &jb).unwrap();
    let claim = jb
        .resources
        .iter()
        .find(|r| r.kind == "mcp-server")
        .unwrap();
    assert_eq!(claim.claims.len(), 2);
    assert_eq!(
        mcp_get(&b, "shared").unwrap(),
        Some(mcp_config(&b.mcp_servers[0]))
    );

    let first_undo = undo(&a, Some(&ja), &home).unwrap();
    assert_eq!(first_undo["conflicts"], json!([]));
    assert!(mcp_get(&a, "shared").unwrap().is_some());
    fs::remove_file(&pa).unwrap();
    let last_undo = undo(&b, Some(&jb), &home).unwrap();
    assert_eq!(last_undo["conflicts"], json!([]));
    assert_eq!(mcp_get(&b, "shared").unwrap(), None);
    clear_fake_claude();
}
#[cfg(unix)]
#[test]
fn shared_mcp_drift_is_reported_even_when_releasing_one_claim() {
    let _environment = MCP_ENV_LOCK.lock().unwrap();
    let home = temp();
    let root = temp();
    let (script, state) = fake_claude(&root);
    set_fake_claude(&script, &state);
    let mut a = spec("claude", root.clone());
    a.instruction = None;
    a.owner = "impeccable-design".into();
    a.mcp_servers.push(McpServer {
        name: "shared-drift".into(),
        command: "original".into(),
        args: vec![],
        env: Default::default(),
    });
    let pa = home.join(format!("{}.json", installation_id(&a)));
    let ja = apply(&a, None, &home, &pa, None).unwrap();
    write_journal(&pa, &ja).unwrap();
    let mut b = a.clone();
    b.owner = "impeccable-loop".into();
    let pb = home.join(format!("{}.json", installation_id(&b)));
    let jb = apply(&b, None, &home, &pb, None).unwrap();
    write_journal(&pb, &jb).unwrap();

    fs::write(&state, br#"{"command":"changed","args":[],"env":{}}"#).unwrap();
    let result = undo(&a, Some(&ja), &home).unwrap();
    assert_eq!(result["conflicts"], json!(["mcp:shared-drift"]));
    assert_eq!(
        mcp_get(&a, "shared-drift").unwrap().unwrap()["command"],
        "changed"
    );
    clear_fake_claude();
}
#[cfg(unix)]
#[test]
fn mcp_same_name_different_owner_configuration_is_refused() {
    let _environment = MCP_ENV_LOCK.lock().unwrap();
    let home = temp();
    let root = temp();
    let (script, state) = fake_claude(&root);
    set_fake_claude(&script, &state);
    let mut a = spec("claude", root.clone());
    a.instruction = None;
    a.mcp_servers.push(McpServer {
        name: "shared".into(),
        command: "first".into(),
        args: vec![],
        env: Default::default(),
    });
    let pa = home.join(format!("{}.json", installation_id(&a)));
    let ja = apply(&a, None, &home, &pa, None).unwrap();
    write_journal(&pa, &ja).unwrap();
    let mut b = a.clone();
    b.owner = "impeccable-design".into();
    b.mcp_servers[0].command = "different".into();
    assert_eq!(
        apply(&b, None, &home, &home.join("b"), None).unwrap_err().0,
        "shared_resource_conflict"
    );
    assert_eq!(
        mcp_get(&a, "shared").unwrap(),
        Some(mcp_config(&a.mcp_servers[0]))
    );
    clear_fake_claude();
}
#[cfg(unix)]
#[test]
fn mcp_undo_reports_drift_and_leaves_server_untouched() {
    let _environment = MCP_ENV_LOCK.lock().unwrap();
    let home = temp();
    let root = temp();
    let (script, state) = fake_claude(&root);
    set_fake_claude(&script, &state);
    let mut s = spec("claude", root.clone());
    s.instruction = None;
    s.mcp_servers.push(McpServer {
        name: "drifted".into(),
        command: "original".into(),
        args: vec![],
        env: Default::default(),
    });
    let journal_path = home.join(format!("{}.json", installation_id(&s)));
    let journal = apply(&s, None, &home, &journal_path, None).unwrap();
    write_journal(&journal_path, &journal).unwrap();
    fs::write(&state, br#"{"command":"user-edit","args":[],"env":{}}"#).unwrap();
    let result = undo(&s, Some(&journal), &home).unwrap();
    assert_eq!(result["conflicts"], json!(["mcp:drifted"]));
    assert_eq!(
        mcp_get(&s, "drifted").unwrap().unwrap()["command"],
        "user-edit"
    );
    clear_fake_claude();
}
#[cfg(unix)]
#[test]
fn codex_mcp_uses_json_get_and_removes_the_verified_configuration() {
    use std::os::unix::fs::PermissionsExt;
    let _environment = MCP_ENV_LOCK.lock().unwrap();
    let home = temp();
    let root = temp();
    let script = root.join("fake-codex");
    let state = root.join("mcp-state.json");
    fs::write(
        &script,
        "#!/bin/sh\ncase \"$2\" in\nget) [ \"$4\" = \"--json\" ] || exit 3; [ -f \"$MCP_STATE\" ] || exit 1; cat \"$MCP_STATE\";;\nadd) printf '{\"command\":\"%s\",\"args\":[],\"env\":{}}' \"$5\" > \"$MCP_STATE\";;\nremove) rm -f \"$MCP_STATE\";;\nesac\nexit 0\n",
    )
    .unwrap();
    fs::set_permissions(&script, fs::Permissions::from_mode(0o700)).unwrap();
    std::env::set_var("IMPECCABLE_CODEX_BIN", &script);
    std::env::set_var("MCP_STATE", &state);
    let mut s = spec("codex", root.clone());
    s.instruction = None;
    s.mcp_servers.push(McpServer {
        name: "codex-server".into(),
        command: "codex-command".into(),
        args: vec![],
        env: Default::default(),
    });
    let journal_path = home.join(format!("{}.json", installation_id(&s)));
    let journal = apply(&s, None, &home, &journal_path, None).unwrap();
    write_journal(&journal_path, &journal).unwrap();
    assert_eq!(
        mcp_get(&s, "codex-server").unwrap(),
        Some(mcp_config(&s.mcp_servers[0]))
    );
    let result = undo(&s, Some(&journal), &home).unwrap();
    assert_eq!(result["conflicts"], json!([]));
    assert_eq!(mcp_get(&s, "codex-server").unwrap(), None);
    std::env::remove_var("IMPECCABLE_CODEX_BIN");
    std::env::remove_var("MCP_STATE");
}
#[cfg(unix)]
#[test]
fn codex_mcp_collision_uses_json_get() {
    use std::os::unix::fs::PermissionsExt;
    let _environment = MCP_ENV_LOCK.lock().unwrap();
    let root = temp();
    let script = root.join("fake-codex");
    fs::write(
        &script,
        "#!/bin/sh\nif [ \"$2\" = \"get\" ]; then [ \"$4\" = \"--json\" ] || exit 3; printf '{\"command\":\"foreign\",\"args\":[],\"env\":{}}'; exit 0; fi\nexit 0\n",
    )
    .unwrap();
    fs::set_permissions(&script, fs::Permissions::from_mode(0o700)).unwrap();
    std::env::set_var("IMPECCABLE_CODEX_BIN", &script);
    let mut s = spec("codex", root.clone());
    s.instruction = None;
    s.mcp_servers.push(McpServer {
        name: "foreign".into(),
        command: "ours".into(),
        args: vec![],
        env: Default::default(),
    });
    let error = sync_mcp(&s, None, &root).unwrap_err();
    std::env::remove_var("IMPECCABLE_CODEX_BIN");
    assert_eq!(error.0, "mcp_name_collision");
}
