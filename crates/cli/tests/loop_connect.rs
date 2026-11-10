//! `impeccable loop connect` and `loop disconnect` against fake `claude` and `codex` CLIs
//! in a scratch home: the Impeccable MCP server and Loop's hooks are added through the
//! agents engine's journal, and disconnect removes exactly what connect wrote.
#![cfg(unix)]
use std::collections::HashMap;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

const URL: &str = "https://api.impeccable.style/mcp";

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
        env.insert("MCP_STATE_DIR".into(), root.display().to_string());
        // Fakes in the image of the real CLIs: Claude 2.1.x prints text on `get` and takes no
        // --scope there; Codex answers `get --json` with its transport object.
        script(
            &root.join("bin/claude"),
            r#"#!/bin/sh
s="$MCP_STATE_DIR/claude-$3"
case "$2" in
get) for a in "$@"; do [ "$a" = "--scope" ] && exit 1; done; [ -f "$s" ] || exit 1
  url=$(sed -n 's/.*"url":"\([^"]*\)".*/\1/p' "$s"); printf '%s:\n  Scope: User config\n  Type: http\n  URL: %s\n' "$3" "$url";;
add-json) printf '%s' "$6" > "$MCP_STATE_DIR/claude-$5";;
remove) rm -f "$MCP_STATE_DIR/claude-$5";;
esac
exit 0
"#,
        );
        script(
            &root.join("bin/codex"),
            r#"#!/bin/sh
s="$MCP_STATE_DIR/codex-$3"
case "$2" in
get) [ -f "$s" ] || exit 1; cat "$s";;
add) printf '{"name":"%s","transport":{"type":"streamable_http","url":"%s"}}' "$3" "$5" > "$s";;
remove) rm -f "$s";;
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

    // The MCP server: the built-in URL, for both agents.
    let claude_mcp = fs::read_to_string(b.root.join("claude-impeccable")).unwrap();
    assert_eq!(claude_mcp, format!(r#"{{"type":"http","url":"{URL}"}}"#));
    assert!(fs::read_to_string(b.root.join("codex-impeccable"))
        .unwrap()
        .contains(URL));

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
    assert!(b.run(&["loop", "connect"]).status.success());
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
    assert!(!b.root.join("claude-impeccable").exists());
    assert!(!b.root.join("codex-impeccable").exists());
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
    assert!(b.root.join("claude-impeccable").exists());
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
    assert!(!b.root.join("claude-impeccable").exists());
}

#[test]
fn a_missing_cli_does_not_stop_the_other_agent_disconnecting() {
    let b = Box::new("missing-cli");
    b.install_loop();
    assert!(b.run(&["loop", "connect"]).status.success());
    fs::rename(b.root.join("bin/claude"), b.root.join("claude-moved")).unwrap();
    let out = b.run(&["loop", "disconnect"]);
    assert!(!out.status.success(), "a partial disconnect says so");
    assert!(text(&out).contains("Codex: disconnected"), "{}", text(&out));
    assert!(
        text(&out).contains("Claude Code: not fully disconnected"),
        "{}",
        text(&out)
    );
    assert!(!b.root.join("codex-impeccable").exists());
    let record: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(b.support().join("claude-install.json")).unwrap())
            .unwrap();
    assert_eq!(
        record["enabled"], false,
        "Loop stops waking even when cleanup can't finish"
    );
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
    fs::write(b.root.join("codex-impeccable"), r#"{"name":"impeccable","transport":{"type":"streamable_http","url":"https://elsewhere.example/mcp"}}"#).unwrap();
    let out = b.run(&["loop", "connect"]);
    assert!(!out.status.success());
    let said = text(&out);
    assert!(said.contains("Claude Code: connected"), "{said}");
    assert!(said.contains("Codex: not connected"), "{said}");
    assert!(
        !b.home().join(".codex/hooks.json").exists(),
        "Codex's half install was rolled back"
    );
    assert!(fs::read_to_string(b.root.join("codex-impeccable"))
        .unwrap()
        .contains("elsewhere"));
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
