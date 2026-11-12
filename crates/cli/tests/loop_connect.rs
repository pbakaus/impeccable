//! `impeccable loop connect` and `loop disconnect` against fake `claude` and `codex` CLIs
//! in a scratch home: the Impeccable MCP server and Loop's hooks are added through the
//! agents engine's journal, and disconnect removes exactly what connect wrote.
#![cfg(target_os = "macos")]
use std::collections::HashMap;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

const URL: &str = "https://api.impeccable.style/mcp";
const INSTRUCTION: &str = "When you need a person's decision or input, use needs_you.post (Impeccable) instead of asking in chat or a built-in question tool. If needs_you says Loop isn't connected, ask normally.";

struct Box {
    root: PathBuf,
    env: HashMap<String, String>,
}

impl Box {
    fn new(name: &str) -> Box {
        let root = std::env::temp_dir().join(format!(
            "impeccable-loop-connect-{name}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("home/.claude")).unwrap();
        fs::create_dir_all(root.join("home/.codex")).unwrap();
        fs::create_dir_all(root.join("bin")).unwrap();
        let mut env = HashMap::new();
        env.insert("HOME".into(), root.join("home").display().to_string());
        env.insert(
            "IMPECCABLE_HOME".into(),
            root.join("home/.impeccable").display().to_string(),
        );
        env.insert(
            "PATH".into(),
            format!("{}:/usr/bin:/bin", root.join("bin").display()),
        );
        // Fakes in the image of the real CLIs: Claude 2.1.x prints text on `get` and takes no
        // --scope there; Codex answers `get --json` with its transport object.
        // Fakes in the image of the real CLIs, writing the same files: Claude keeps user
        // MCP servers in .claude.json (in CLAUDE_CONFIG_DIR when set, else HOME); Codex in
        // CODEX_HOME/config.toml.
        script(
            &root.join("bin/claude"),
            r#"#!/bin/sh
f="${CLAUDE_CONFIG_DIR:-$HOME}/.claude.json"
[ -f "$f" ] || echo '{}' > "$f"
case "$2" in
add-json) jq --arg n "$5" --argjson c "$6" '.mcpServers[$n]=$c' "$f" > "$f.t" && mv "$f.t" "$f";;
remove) jq --arg n "$5" 'del(.mcpServers[$n])' "$f" > "$f.t" && mv "$f.t" "$f";;
esac
exit 0
"#,
        );
        script(
            &root.join("bin/codex"),
            r#"#!/bin/sh
f="${CODEX_HOME:-$HOME/.codex}/config.toml"
case "$2" in
add) printf '\n[mcp_servers.%s]\nurl = "%s"\n' "$3" "$5" >> "$f";;
remove) sed -i '' "/^\[mcp_servers\.$3\]$/,/^url = /d" "$f";;
esac
exit 0
"#,
        );
        Box { root, env }
    }
    fn home(&self) -> PathBuf {
        self.root.join("home")
    }
    fn install_loop(&self) {
        let macos = self
            .home()
            .join("Applications/Impeccable Loop.app/Contents/MacOS");
        fs::create_dir_all(&macos).unwrap();
        script(&macos.join("loop-hook"), "#!/bin/sh\nexit 0\n");
    }
    /// A Loop bundle that says which version it is, as a real one does.
    fn install_loop_version(&self, version: &str) {
        self.install_loop();
        fs::write(
            self.home().join("Applications/Impeccable Loop.app/Contents/Info.plist"),
            format!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\"><dict><key>CFBundleShortVersionString</key><string>{version}</string></dict></plist>\n"
            ),
        )
        .unwrap();
    }
    fn run(&self, args: &[&str]) -> Output {
        Command::new(env!("CARGO_BIN_EXE_impeccable"))
            .args(args)
            .env_clear()
            .envs(&self.env)
            .stdin(Stdio::null())
            .output()
            .unwrap()
    }
    fn support(&self) -> PathBuf {
        self.home()
            .join("Library/Application Support/Impeccable Reviews/Loop")
    }
}

impl Drop for Box {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn script(path: &Path, body: &str) {
    fs::write(path, body).unwrap();
    fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
}

fn claude_entry(file: &Path) -> serde_json::Value {
    fs::read_to_string(file)
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .map(|v| v["mcpServers"]["impeccable"].clone())
        .unwrap_or(serde_json::Value::Null)
}

fn codex_config(b: &Box) -> String {
    fs::read_to_string(b.home().join(".codex/config.toml")).unwrap_or_default()
}

fn text(o: &Output) -> String {
    format!(
        "{}{}",
        String::from_utf8_lossy(&o.stdout),
        String::from_utf8_lossy(&o.stderr)
    )
}

#[test]
fn connect_refuses_plainly_without_loop() {
    // Catches: writing hooks that call a Loop helper that isn't there.
    let b = Box::new("no-loop");
    let out = b.run(&["loop", "connect"]);
    assert!(!out.status.success());
    assert!(
        text(&out).contains("impeccable loop install"),
        "{}",
        text(&out)
    );
    assert!(
        !b.home().join(".claude/settings.json").exists(),
        "nothing written"
    );
}

#[test]
fn connect_adds_the_mcp_server_and_hooks_and_disconnect_removes_exactly_them() {
    // Catches (Loop journey C2 and C3): no command connected a customer's agents to Needs you.
    let b = Box::new("roundtrip");
    b.install_loop();
    let personal = r#"{
  "hooks": {
    "Stop": [{"hooks": [{"type": "command", "command": "echo mine"}]}]
  },
  "theme": "dark"
}
"#;
    fs::write(b.home().join(".claude/settings.json"), personal).unwrap();
    let out = b.run(&["loop", "connect"]);
    assert!(out.status.success(), "{}", text(&out));
    let said = text(&out);
    assert!(
        said.contains("/mcp") && said.contains("codex mcp login impeccable"),
        "{said}"
    );

    // The MCP server: the built-in URL, for both agents, in their own files.
    assert_eq!(
        claude_entry(&b.home().join(".claude.json")),
        serde_json::json!({"type":"http","url":URL})
    );
    let config = codex_config(&b);
    assert!(
        config.contains("[mcp_servers.impeccable]\n")
            && config.contains(&format!("url = \"{URL}\"")),
        "{config}"
    );
    // Codex runs Loop's tools without asking first, so a question reaches the person.
    assert!(
        config.contains("default_tools_approval_mode = \"approve\""),
        "{config}"
    );
    // Both agents learn to bring questions to Needs you, in their own rule files.
    for rules in [".claude/CLAUDE.md", ".codex/AGENTS.md"] {
        let text = fs::read_to_string(b.home().join(rules)).unwrap_or_default();
        assert!(text.contains(INSTRUCTION), "{rules}: {text}");
    }

    // Claude's hooks call Loop's helper with the agreed arguments and options.
    let settings: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(b.home().join(".claude/settings.json")).unwrap())
            .unwrap();
    let helper = b
        .home()
        .join("Applications/Impeccable Loop.app/Contents/MacOS/loop-hook");
    let quoted = format!("'{}'", helper.display());
    let command = |event: &str, i: usize| settings["hooks"][event][i]["hooks"][0].clone();
    assert_eq!(
        command("Stop", 0)["command"],
        "echo mine",
        "personal hook kept first"
    );
    let stop = command("Stop", 1);
    assert_eq!(stop["command"], format!("{quoted} claude lifecycle"));
    assert_eq!(
        (
            stop["async"].clone(),
            stop["asyncRewake"].clone(),
            stop["timeout"].clone()
        ),
        (true.into(), true.into(), 86400.into())
    );
    assert_eq!(
        command("PostToolUse", 0)["command"],
        format!("{quoted} claude register")
    );
    assert_eq!(
        settings["hooks"]["PreToolUse"][0]["matcher"],
        "AskUserQuestion"
    );
    assert_eq!(
        command("PreToolUse", 0)["command"],
        format!("{quoted} claude adoption")
    );
    for event in ["SessionStart", "StopFailure"] {
        assert_eq!(
            command(event, 0)["command"],
            format!("{quoted} claude lifecycle"),
            "{event}"
        );
    }

    // What the helper reads, private.
    let claude = b.support().join("claude-install.json");
    let record: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&claude).unwrap()).unwrap();
    assert_eq!(record["enabled"], true);
    assert_eq!(record["harness"], "claude");
    assert_eq!(
        record["executable"],
        b.root.join("bin/claude").display().to_string()
    );
    assert_eq!(
        record["configDir"],
        b.home().join(".claude").display().to_string()
    );
    assert_eq!(
        fs::metadata(&claude).unwrap().permissions().mode() & 0o777,
        0o600
    );
    assert_eq!(
        fs::metadata(b.support()).unwrap().permissions().mode() & 0o777,
        0o700
    );
    let codex: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(b.support().join("codex-install.json")).unwrap())
            .unwrap();
    assert_eq!(
        (codex["enabled"].clone(), codex["harness"].clone()),
        (true.into(), "codex".into())
    );

    // Again: nothing doubles.
    let again = b.run(&["loop", "connect"]);
    assert!(again.status.success(), "{}", text(&again));
    let again: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(b.home().join(".claude/settings.json")).unwrap())
            .unwrap();
    assert_eq!(
        again["hooks"]["Stop"].as_array().unwrap().len(),
        2,
        "connect is idempotent"
    );

    // Disconnect: exactly what connect wrote goes, personal settings come back byte for byte.
    let out = b.run(&["loop", "disconnect"]);
    assert!(out.status.success(), "{}", text(&out));
    assert_eq!(
        fs::read_to_string(b.home().join(".claude/settings.json")).unwrap(),
        personal
    );
    // MCP servers are never removed by disconnect: the exact command is printed instead.
    assert_eq!(
        claude_entry(&b.home().join(".claude.json")),
        serde_json::json!({"type":"http","url":URL})
    );
    assert!(codex_config(&b).contains("mcp_servers.impeccable"));
    // But the instruction blocks and the approval connect added are gone.
    assert!(!codex_config(&b).contains("default_tools_approval_mode"));
    for rules in [".claude/CLAUDE.md", ".codex/AGENTS.md"] {
        let text = fs::read_to_string(b.home().join(rules)).unwrap_or_default();
        assert!(!text.contains(INSTRUCTION), "{rules}: {text}");
    }
    let said = text(&out);
    assert!(
        said.contains("env -u CLAUDE_CONFIG_DIR claude mcp remove --scope user impeccable"),
        "{said}"
    );
    assert!(
        said.contains(&format!(
            "CODEX_HOME='{}' codex mcp remove impeccable",
            b.home().join(".codex").display()
        )),
        "{said}"
    );
    let record: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&claude).unwrap()).unwrap();
    assert_eq!(
        (record["enabled"].clone(), record["uninstalled"].clone()),
        (false.into(), true.into())
    );
}

#[test]
fn an_agent_without_its_cli_is_skipped_not_failed() {
    let b = Box::new("claude-only");
    b.install_loop();
    fs::remove_file(b.root.join("bin/codex")).unwrap();
    let out = b.run(&["loop", "connect"]);
    assert!(out.status.success(), "{}", text(&out));
    assert!(text(&out).contains("Codex: not found"), "{}", text(&out));
    assert!(!claude_entry(&b.home().join(".claude.json")).is_null());
    assert!(!b.support().join("codex-install.json").exists());
}

#[test]
fn disconnect_undoes_the_account_connect_used_not_todays() {
    // Catches (adversarial review, #1389): disconnect from a shell without CLAUDE_CONFIG_DIR
    // missing the work account connect configured.
    let mut b = Box::new("accounts");
    b.install_loop();
    let work = b.root.join("work-claude");
    fs::create_dir_all(&work).unwrap();
    b.env
        .insert("CLAUDE_CONFIG_DIR".into(), work.display().to_string());
    assert!(b.run(&["loop", "connect"]).status.success());
    assert!(work.join("settings.json").exists());
    b.env.remove("CLAUDE_CONFIG_DIR");
    let out = b.run(&["loop", "disconnect"]);
    assert!(out.status.success(), "{}", text(&out));
    assert!(
        !work.join("settings.json").exists(),
        "the work account's hooks are gone"
    );
    let said = text(&out);
    assert!(
        said.contains(&format!(
            "CLAUDE_CONFIG_DIR='{}' claude mcp remove",
            work.display()
        )),
        "the removal command names the work account: {said}"
    );
}

#[test]
fn a_missing_cli_does_not_stop_disconnect() {
    // Disconnect runs no agent CLI at all: hooks go and Loop stops waking either way.
    let b = Box::new("missing-cli");
    b.install_loop();
    assert!(b.run(&["loop", "connect"]).status.success());
    fs::rename(b.root.join("bin/claude"), b.root.join("claude-moved")).unwrap();
    let out = b.run(&["loop", "disconnect"]);
    assert!(out.status.success(), "{}", text(&out));
    assert!(!b.home().join(".claude/settings.json").exists());
    let record: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(b.support().join("claude-install.json")).unwrap())
            .unwrap();
    assert_eq!(record["enabled"], false);
}

#[test]
fn a_symlinked_support_folder_is_refused_before_anything_is_written() {
    let b = Box::new("symlink");
    b.install_loop();
    let elsewhere = b.root.join("elsewhere");
    fs::create_dir_all(&elsewhere).unwrap();
    fs::create_dir_all(
        b.home()
            .join("Library/Application Support/Impeccable Reviews"),
    )
    .unwrap();
    std::os::unix::fs::symlink(&elsewhere, b.support()).unwrap();
    let out = b.run(&["loop", "connect"]);
    assert!(!out.status.success());
    assert!(
        text(&out).contains("isn't a plain folder"),
        "{}",
        text(&out)
    );
    assert!(
        !b.home().join(".claude/settings.json").exists(),
        "no agent changed"
    );
    assert_eq!(fs::read_dir(&elsewhere).unwrap().count(), 0);
}

#[test]
fn one_agent_failing_reports_the_other_and_rolls_itself_back() {
    let b = Box::new("partial");
    b.install_loop();
    // Codex already has a different server called impeccable: connect must not take it over.
    let theirs = "[mcp_servers.impeccable]\nurl = \"https://elsewhere.example/mcp\"\n";
    fs::write(b.home().join(".codex/config.toml"), theirs).unwrap();
    let out = b.run(&["loop", "connect"]);
    assert!(!out.status.success());
    let said = text(&out);
    assert!(said.contains("Claude Code: connected"), "{said}");
    assert!(
        said.contains(&format!(
            "Codex: not connected: {} already has a different MCP server called impeccable; it was left alone. Remove or rename it, then connect again.",
            b.home().join(".codex/config.toml").display()
        )),
        "{said}"
    );
    assert!(
        !b.home().join(".codex/hooks.json").exists(),
        "nothing of Codex's was touched"
    );
    assert_eq!(codex_config(&b), theirs);
}

#[test]
fn the_cli_is_resolved_once_from_absolute_executable_entries() {
    let mut b = Box::new("resolve");
    b.install_loop();
    // A '.' entry and a non-executable claude earlier in PATH are both passed over.
    let decoy = b.root.join("decoy");
    fs::create_dir_all(&decoy).unwrap();
    fs::write(decoy.join("claude"), "not a program").unwrap();
    let path = format!(".:{}:{}", decoy.display(), b.env["PATH"]);
    b.env.insert("PATH".into(), path);
    assert!(b.run(&["loop", "connect"]).status.success());
    let record: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(b.support().join("claude-install.json")).unwrap())
            .unwrap();
    assert_eq!(
        record["executable"],
        b.root.join("bin/claude").display().to_string()
    );
}

#[test]
fn an_entry_the_person_already_had_is_kept_on_disconnect() {
    // connect adds only when absent, so disconnect removes only what it added.
    let b = Box::new("theirs-exact");
    b.install_loop();
    let mine = format!("[mcp_servers.impeccable]\nurl = \"{URL}\"\n");
    fs::write(b.home().join(".codex/config.toml"), &mine).unwrap();
    assert!(b.run(&["loop", "connect"]).status.success());
    assert!(b.run(&["loop", "disconnect"]).status.success());
    assert_eq!(codex_config(&b), mine, "the person's own entry stays");
}

#[test]
fn disconnect_never_touches_another_accounts_server() {
    // Catches (adversarial review, #1389, high): disconnect with CLAUDE_CONFIG_DIR pointing
    // at another account removing that account's server.
    let mut b = Box::new("other-account");
    b.install_loop();
    assert!(b.run(&["loop", "connect"]).status.success());
    let work = b.root.join("work-claude");
    fs::create_dir_all(&work).unwrap();
    let theirs =
        r#"{"mcpServers":{"impeccable":{"type":"http","url":"https://elsewhere.example/mcp"}}}"#;
    fs::write(work.join(".claude.json"), theirs).unwrap();
    b.env
        .insert("CLAUDE_CONFIG_DIR".into(), work.display().to_string());
    assert!(b.run(&["loop", "disconnect"]).status.success());
    assert_eq!(
        fs::read_to_string(work.join(".claude.json")).unwrap(),
        theirs
    );
}

fn journals(b: &Box) -> Vec<PathBuf> {
    let mut found: Vec<PathBuf> = fs::read_dir(b.home().join(".impeccable/agents"))
        .unwrap()
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            let n = p.file_name().unwrap().to_string_lossy().into_owned();
            n.ends_with(".json") && !n.ends_with(".pending.json")
        })
        .collect();
    found.sort();
    found
}

fn claude_journal(b: &Box) -> PathBuf {
    journals(b)
        .into_iter()
        .find(|p| {
            p.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("impeccable-loop-claude-")
        })
        .expect("a Claude journal")
}

#[test]
fn an_unreadable_journal_fails_disconnect_instead_of_reporting_nothing() {
    // Catches (#1389 review): a journal that couldn't be read was skipped, and disconnect
    // said "Nothing to disconnect" while that installation's hooks stayed.
    let b = Box::new("unreadable");
    b.install_loop();
    assert!(b.run(&["loop", "connect"]).status.success());
    let journal = claude_journal(&b);
    fs::write(&journal, "{ not json").unwrap();
    let out = b.run(&["loop", "disconnect"]);
    let said = text(&out);
    assert!(!out.status.success(), "{said}");
    assert!(said.contains(&journal.display().to_string()), "{said}");
    assert!(!said.contains("Nothing to disconnect"), "{said}");
}

#[test]
fn another_owners_pending_transaction_does_not_fail_disconnect() {
    // Catches (#1389 review): every *.pending.json counted, so another tool's half-done
    // apply failed Loop's disconnect with advice that didn't help.
    let b = Box::new("foreign-pending");
    b.install_loop();
    assert!(b.run(&["loop", "connect"]).status.success());
    let journal: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(claude_journal(&b)).unwrap()).unwrap();
    let mut spec = journal["spec"].clone();
    spec["owner"] = "another-tool".into();
    let tx = serde_json::json!({
        "version": 2,
        "journal_path": b.home().join(".impeccable/agents/other.json"),
        "prior_journal": null,
        "desired_spec": spec,
        "prior_spec": null,
        "targets": [],
    });
    let pending = b.home().join(".impeccable/agents/other.pending.json");
    fs::write(&pending, tx.to_string()).unwrap();
    let out = b.run(&["loop", "disconnect"]);
    assert!(out.status.success(), "{}", text(&out));
    assert!(
        pending.exists(),
        "another owner's transaction is left alone"
    );
}

#[test]
fn disconnect_rolls_back_a_connect_that_stopped_part_way() {
    // Catches (#1389 review): a connect that stopped after writing hooks left a pending
    // transaction; disconnect only printed advice and the hooks stayed.
    let b = Box::new("own-pending");
    b.install_loop();
    let settings = b.home().join(".claude/settings.json");
    let before = "{\"theme\": \"dark\"}\n";
    fs::write(&settings, before).unwrap();
    assert!(b.run(&["loop", "connect"]).status.success());
    let journal_path = claude_journal(&b);
    let journal: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&journal_path).unwrap()).unwrap();
    let after = fs::read(&settings).unwrap();
    assert_ne!(after, before.as_bytes());
    // As if the apply had written the hooks and its journal, then stopped.
    let tx = serde_json::json!({
        "version": 2,
        "journal_path": journal_path,
        "prior_journal": null,
        "desired_spec": journal["spec"],
        "prior_spec": null,
        "targets": [{"path": settings, "before": before.as_bytes(), "after": after}],
    });
    let stem = journal_path
        .file_stem()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let pending = journal_path.with_file_name(format!("{stem}.pending.json"));
    fs::write(&pending, tx.to_string()).unwrap();
    let out = b.run(&["loop", "disconnect"]);
    assert!(out.status.success(), "{}", text(&out));
    assert!(!pending.exists());
    assert_eq!(fs::read_to_string(&settings).unwrap(), before);
    // Its journal is gone with the rollback; the MCP server it added and Loop's record
    // are still handled (#1389 review).
    let said = text(&out);
    assert!(
        said.contains("Claude Code: an earlier connect that stopped part way was rolled back")
            && said.contains("claude mcp remove"),
        "{said}"
    );
    let record: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(b.support().join("claude-install.json")).unwrap())
            .unwrap();
    assert_eq!(record["enabled"], false, "{record}");
}

#[test]
fn a_status_it_cannot_read_stops_connect_before_anything_changes() {
    // Catches (#1389 review): a status error read as "not installed", so a later failure
    // could undo hooks that were working.
    let b = Box::new("status-error");
    b.install_loop();
    assert!(b.run(&["loop", "connect"]).status.success());
    let settings = b.home().join(".claude/settings.json");
    let installed = fs::read(&settings).unwrap();
    fs::write(claude_journal(&b), "{ not json").unwrap();
    let out = b.run(&["loop", "connect"]);
    let said = text(&out);
    assert!(!out.status.success(), "{said}");
    assert!(said.contains("couldn't read its hooks"), "{said}");
    assert_eq!(fs::read(&settings).unwrap(), installed);
}

#[test]
fn connect_says_when_the_hooks_point_at_a_loop_that_moved() {
    // Catches (t6): Loop moved to /Applications leaves hooks calling a missing helper,
    // which exits quietly; connect said only "isn't installed".
    let b = Box::new("loop-moved");
    b.install_loop();
    assert!(b.run(&["loop", "connect"]).status.success());
    fs::remove_dir_all(b.home().join("Applications/Impeccable Loop.app")).unwrap();
    let out = b.run(&["loop", "connect"]);
    let said = text(&out);
    assert!(!out.status.success(), "{said}");
    assert!(
        said.contains("Loop's hooks point at a Loop that isn't there")
            && said.contains("Impeccable Loop.app/Contents/MacOS/loop-hook")
            && said.contains("~/Applications"),
        "{said}"
    );
}

#[test]
fn a_relative_config_folder_connects_that_account_not_the_default() {
    // Catches (#1372 review): a relative CLAUDE_CONFIG_DIR or CODEX_HOME was ignored, so
    // connect wrote the default account and said it had connected the one asked for.
    let mut b = Box::new("relative-config");
    b.install_loop();
    let work = b.root.join("work");
    fs::create_dir_all(work.join("claude-work")).unwrap();
    fs::create_dir_all(work.join("codex-work")).unwrap();
    b.env
        .insert("CLAUDE_CONFIG_DIR".into(), "claude-work".into());
    b.env.insert("CODEX_HOME".into(), "./codex-work".into());
    let out = Command::new(env!("CARGO_BIN_EXE_impeccable"))
        .args(["loop", "connect"])
        .current_dir(&work)
        .env_clear()
        .envs(&b.env)
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(out.status.success(), "{}", text(&out));
    assert_eq!(
        claude_entry(&work.join("claude-work/.claude.json")),
        serde_json::json!({"type":"http","url":URL})
    );
    assert!(work.join("claude-work/settings.json").exists());
    assert_eq!(
        claude_entry(&b.home().join(".claude.json")),
        serde_json::Value::Null
    );
    assert!(!b.home().join(".claude/settings.json").exists());
    assert!(fs::read_to_string(work.join("codex-work/config.toml"))
        .unwrap_or_default()
        .contains(URL));
    assert!(!codex_config(&b).contains(URL));
}

#[test]
fn sessions_learn_loop_will_wake_them_only_from_a_loop_that_can_say_so() {
    // Catches: agents polling for answers because nothing told them Loop wakes them, and,
    // the other way, a context hook pointed at Loop 0.1.0, whose helper lacks it.
    for (version, wanted) in [("0.1.0", false), ("0.1.1", true), ("0.1.2", true)] {
        let b = Box::new(&format!("context-{version}"));
        b.install_loop_version(version);
        let out = b.run(&["loop", "connect"]);
        assert!(out.status.success(), "{}", text(&out));
        let settings: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(b.home().join(".claude/settings.json")).unwrap(),
        )
        .unwrap();
        let starts: Vec<String> = settings["hooks"]["SessionStart"]
            .as_array()
            .unwrap()
            .iter()
            .map(|h| h["hooks"][0]["command"].as_str().unwrap().to_string())
            .collect();
        let has = starts.iter().any(|c| c.ends_with(" claude context"));
        assert_eq!(has, wanted, "{version}: {starts:?}");
        let codex = fs::read_to_string(b.home().join(".codex/hooks.json")).unwrap_or_default();
        assert_eq!(
            codex.contains(" codex context"),
            wanted,
            "{version}: {codex}"
        );
        // Disconnect takes it away again.
        assert!(b.run(&["loop", "disconnect"]).status.success());
        let after = fs::read_to_string(b.home().join(".claude/settings.json")).unwrap_or_default();
        assert!(!after.contains(" claude context"), "{after}");
    }
}

#[test]
fn status_and_json_connect_tell_loop_what_each_agent_needs() {
    // Catches: Loop's Settings and first-run panel having no way to see or drive connect.
    let b = Box::new("status-json");
    b.install_loop_version("0.1.1");
    let status = |b: &Box| -> serde_json::Value {
        let out = b.run(&["loop", "status", "--json"]);
        assert!(out.status.success(), "{}", text(&out));
        serde_json::from_slice(&out.stdout).unwrap()
    };
    let before = status(&b);
    assert_eq!(before["loop"]["installed"], true);
    assert_eq!(before["loop"]["version"], "0.1.1");
    for a in before["agents"].as_array().unwrap() {
        assert_eq!(
            (
                a["detected"].clone(),
                a["mcp"].clone(),
                a["hooks"].clone(),
                a["instruction"].clone()
            ),
            (true.into(), "absent".into(), false.into(), false.into()),
            "{a}"
        );
    }
    // One agent, non-interactive, one JSON object on stdout.
    let out = b.run(&["loop", "connect", "--agent", "claude", "--json"]);
    assert!(out.status.success(), "{}", text(&out));
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(v["ok"], true);
    let agents = v["agents"].as_array().unwrap();
    assert_eq!(agents.len(), 1);
    assert_eq!(
        (agents[0]["agent"].clone(), agents[0]["result"].clone()),
        ("claude".into(), "connected".into())
    );
    let after = status(&b);
    let row = |h: &str| {
        after["agents"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["agent"] == h)
            .unwrap()
            .clone()
    };
    assert_eq!(
        (
            row("claude")["mcp"].clone(),
            row("claude")["hooks"].clone(),
            row("claude")["instruction"].clone(),
            row("claude")["connected"].clone()
        ),
        ("registered".into(), true.into(), true.into(), true.into())
    );
    assert_eq!(
        row("codex")["mcp"],
        "absent",
        "only the agent asked for was connected"
    );
    // An unknown agent is a JSON failure, never a prompt.
    let out = b.run(&["loop", "connect", "--agent", "cursor", "--json"]);
    assert!(!out.status.success());
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(v["ok"], false);
    assert!(
        v["error"].as_str().unwrap().contains("Unknown agent"),
        "{v}"
    );
}

#[test]
fn connect_flags_only_go_with_install() {
    let b = Box::new("install-flags");
    for args in [
        vec!["loop", "update", "--connect"],
        vec!["loop", "install", "--connect", "--no-connect"],
    ] {
        let out = b.run(&args);
        assert!(!out.status.success(), "{args:?}");
        assert!(
            text(&out).contains("--connect and --no-connect go with loop install, one at a time."),
            "{}",
            text(&out)
        );
    }
}

#[test]
fn status_tells_the_truth_after_things_change_by_hand() {
    // Catches: status saying connected when a hook or the instruction block was removed,
    // when another config folder is selected, or writing into a home that has nothing.
    let b = Box::new("status-truth");
    b.install_loop_version("0.1.1");
    let status = |b: &Box, extra: &[(&str, String)]| -> serde_json::Value {
        let mut c = Command::new(env!("CARGO_BIN_EXE_impeccable"));
        c.args(["loop", "status", "--json"])
            .env_clear()
            .envs(&b.env)
            .stdin(Stdio::null());
        for (k, v) in extra {
            c.env(k, v);
        }
        serde_json::from_slice(&c.output().unwrap().stdout).unwrap()
    };
    let claude = |v: &serde_json::Value| {
        v["agents"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["agent"] == "claude")
            .unwrap()
            .clone()
    };
    // Nothing installed: status answers without creating the engine's folder.
    status(&b, &[]);
    assert!(
        !b.home().join(".impeccable/agents").exists(),
        "status must not write"
    );
    assert!(b.run(&["loop", "connect"]).status.success());
    assert_eq!(claude(&status(&b, &[]))["hooks"], true);
    // Another Claude config folder is not connected just because the default one is.
    let other = b.root.join("other-claude");
    fs::create_dir_all(&other).unwrap();
    let elsewhere = claude(&status(
        &b,
        &[("CLAUDE_CONFIG_DIR", other.display().to_string())],
    ));
    assert_eq!(
        (elsewhere["connected"].clone(), elsewhere["hooks"].clone()),
        (false.into(), false.into())
    );
    // The instruction block removed by hand: plain status no longer says connected.
    fs::write(b.home().join(".claude/CLAUDE.md"), "").unwrap();
    let plain = text(&b.run(&["loop", "status"]));
    assert!(
        plain.contains("Claude Code: not connected") && plain.contains("instruction missing"),
        "{plain}"
    );
    // The hooks removed by hand: the journal alone no longer counts.
    fs::write(b.home().join(".claude/settings.json"), "{}").unwrap();
    assert_eq!(claude(&status(&b, &[]))["hooks"], false);
}

#[test]
fn json_stays_one_object_when_codex_talks_and_one_agent_keeps_its_next_steps() {
    // Catches: `codex mcp add` printing into the JSON Loop reads, and `--agent` in text
    // mode dropping the sign-in and follow-up lines.
    let b = Box::new("json-clean");
    b.install_loop_version("0.1.1");
    script(
        &b.root.join("bin/codex"),
        r#"#!/bin/sh
f="${CODEX_HOME:-$HOME/.codex}/config.toml"
case "$2" in
add) echo "Added global MCP server 'impeccable'."; printf '\n[mcp_servers.%s]\nurl = "%s"\n' "$3" "$5" >> "$f";;
esac
exit 0
"#,
    );
    let out = b.run(&["loop", "connect", "--agent", "codex", "--json"]);
    let v: serde_json::Value = serde_json::from_slice(&out.stdout)
        .unwrap_or_else(|e| panic!("{e}: {}", String::from_utf8_lossy(&out.stdout)));
    assert_eq!(v["ok"], true, "{v}");
    assert!(String::from_utf8_lossy(&out.stderr).contains("Added global MCP server"));
    let said = text(&b.run(&["loop", "connect", "--agent", "claude"]));
    assert!(
        said.contains("Claude Code: connected.")
            && said.contains("Sign in:")
            && said.contains("/mcp"),
        "{said}"
    );
    assert!(!said.contains("Codex"), "{said}");
}
