//! `impeccable loop connect` and `loop disconnect`: connect a person's coding agents to
//! Needs you and Loop.
//!
//! For each agent found (Claude Code, Codex, Cursor, Copilot, opencode), connect:
//! 1. adds the Impeccable MCP server, only if the agent has no server of that name, through
//!    its CLI or the engine journal, then checks the exact global entry it wrote;
//! 2. adds Loop's hooks through the agents engine (journaled, undone exactly);
//! 3. writes the record Loop's helper reads.
//!
//! Disconnect stops Loop waking, then removes journaled resources. Claude and Codex
//! MCP servers stay; journal-owned entries created here are undone with the wake resources.
//! Agent tokens are never seen or stored here: each agent signs in to the MCP server itself.
use impeccable_agents::{installed_specs, recover_spec, run_spec, Hook, McpApproval, Spec};
use crate::agent_block;
use crate::codex_trust;
use impeccable_common::Io;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// The Impeccable MCP servers. Constants of the build: the account service the CLI
/// signs in to (`IMPECCABLE_ACCOUNT_URL`) chooses between them, and nothing else can name
/// one. An entry is written into the agent's own global configuration and outlives the
/// variable, so an account URL that is neither service is refused, never followed and
/// never replaced by production.
const MCP_URL: &str = "https://api.impeccable.style/mcp";
const STAGING_MCP_URL: &str = "https://api.staging.impeccable.style/mcp";
/// The account services, as `impeccable_account::config::normalize_origin` spells them.
const ACCOUNTS: [(&str, &str); 2] = [
    (impeccable_account::config::DEFAULT_ACCOUNT_URL, MCP_URL),
    ("https://api.staging.impeccable.style", STAGING_MCP_URL),
];
thread_local! {
    /// The server this command's account service names, set by every `init_mcp_url`
    /// (not once per process), so a later call with another account never reuses the
    /// first's. Per thread, as each command runs its connect on one.
    static MCP_FOR_ACCOUNT: std::cell::Cell<Option<&'static str>> = const { std::cell::Cell::new(None) };
}
/// A build with the `test-mcp-url` feature (staging end-to-end runs only, like
/// `test-release-keys`) may point connect at another https MCP server through
/// `IMPECCABLE_MCP_URL`. Shipped builds don't have the feature, so they ignore the
/// variable.
#[cfg(feature = "test-mcp-url")]
thread_local! {
    static MCP_OVERRIDE: std::cell::Cell<Option<&'static str>> = const { std::cell::Cell::new(None) };
}

fn mcp_url() -> &'static str {
    #[cfg(feature = "test-mcp-url")]
    if let Some(url) = MCP_OVERRIDE.get() {
        return url;
    }
    MCP_FOR_ACCOUNT.get().unwrap_or(MCP_URL)
}

/// The MCP server of the account service `raw` names (`IMPECCABLE_ACCOUNT_URL`, unset
/// for production), or why there is none.
fn mcp_for_account(raw: Option<&str>) -> Result<&'static str> {
    let Some(raw) = raw.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(MCP_URL);
    };
    let origin = impeccable_account::config::normalize_origin(raw);
    ACCOUNTS
        .iter()
        .find(|(account, _)| origin.as_deref() == Some(*account))
        .map(|(_, mcp)| *mcp)
        .ok_or_else(|| {
            "IMPECCABLE_ACCOUNT_URL isn't the Impeccable account or its staging service, so no MCP server was added. Unset it to connect to Impeccable.".into()
        })
}

/// In a `test-mcp-url` build, a set but unusable `IMPECCABLE_MCP_URL` is refused, never
/// replaced by production: falling back would send a staging run's agents to production.
fn init_mcp_url(io: &Io) -> Result<()> {
    #[cfg(feature = "test-mcp-url")]
    if let Some(url) = io.env("IMPECCABLE_MCP_URL") {
        let usable = url::Url::parse(url)
            .ok()
            .filter(|u| {
                // A local stack serves plain http on this machine only, its MCP on `api.localhost`.
                let loopback = impeccable_account::config::loopback_url(u);
                (u.scheme() == "https" || (u.scheme() == "http" && loopback))
                    && u.host_str().is_some()
                    && u.as_str() == url
            });
        if usable.is_none() || url.contains(char::is_whitespace) {
            MCP_OVERRIDE.set(None);
            return Err("IMPECCABLE_MCP_URL must be a plain https URL, or http on localhost.".into());
        }
        // Leaked once per call, in test builds only.
        MCP_OVERRIDE.set(Some(Box::leak(url.to_string().into_boxed_str())));
        return Ok(());
    }
    #[cfg(feature = "test-mcp-url")]
    MCP_OVERRIDE.set(None);
    let url = mcp_for_account(io.env("IMPECCABLE_ACCOUNT_URL"));
    MCP_FOR_ACCOUNT.set(url.as_ref().ok().copied());
    url.map(|_| ())
}
const MCP_NAME: &str = "impeccable";
/// Why an existing entry of that name isn't the one connect would write.
const SETTINGS_DIFFER: &str = "its settings differ";
/// The agents-engine owner id for everything this writes.
const OWNER: &str = "impeccable-loop";
const APP: &str = "Applications/Impeccable Loop.app";
const HELPER: &str = "Contents/MacOS/loop-hook";
/// Where Loop's helper keeps its state (the old name stays until Loop migrates it).
const SUPPORT_PARENT: &str = "Library/Application Support";
const SUPPORT: [&str; 2] = ["Impeccable Reviews", "Loop"];
/// This command's own note, per connected agent and config folder, of where its MCP
/// server lives, so disconnect can print the exact command to remove it.
const TARGETS: &str = "connect.json";
/// How long one connect or disconnect waits for another to finish.
const LOCK_WAIT: Duration = Duration::from_secs(10);
/// How long an agent's `mcp add` may take, Codex's browser sign-in included.
const ADD_WAIT: Duration = Duration::from_secs(300);

type Result<T> = std::result::Result<T, String>;

/// The first Loop whose helper holds a Codex turn open for an answer (REN-2057).
const STOP_HOLD: semver::Version = semver::Version::new(0, 1, 4);

// Loop 0.2.0 is the first release with the Cursor, Copilot and opencode wake helpers (REN-2057).
const CLI_WAKE: semver::Version = semver::Version::new(0, 2, 0);

/// All harness-specific policy lives here; orchestration below uses these descriptions.
struct AgentDescription {
    harness: &'static str,
    label: &'static str,
    binary: &'static str,
    bin_env: &'static str,
    root: &'static str,
    root_env: Option<&'static str>,
    root_env_suffix: Option<&'static str>,
    mcp_file: &'static str,
    mcp_in_home: bool,
    mcp_manual_file: Option<&'static str>,
    mcp_format: McpFormat,
    registration: Registration,
    rule: &'static str,
    rule_override: Option<&'static str>,
    rule_existing_only: bool,
    post_add: &'static [&'static str],
    sign_in: &'static str,
    status_sign_in: bool,
    follow_up: Option<&'static str>,
    record: RecordLayout,
    approve_tools: bool,
    wake_gate: Option<semver::Version>,
    hooks: &'static [HookDescription],
    plugin: Option<&'static str>,
}

#[derive(Clone, Copy)]
enum McpFormat { Json { section: &'static str, transport: Option<&'static str>, all_tools: bool, enabled: bool }, Toml }
#[derive(Clone, Copy)]
enum Registration {
    // CLI-added servers stay on disconnect, with a manual removal command.
    Cli { add: &'static [&'static str], remove: &'static [&'static str], interactive: bool },
    // The engine both writes and undoes these server entries.
    Journal,
}
#[derive(Clone, Copy, PartialEq)]
enum RecordLayout { Accounts, ConfigDir, Global }

struct HookDescription {
    event: &'static str,
    matcher: Option<&'static str>,
    kind: &'static str,
    timeout: u64,
    background: bool,
    since: Option<semver::Version>,
}

const fn hook(event: &'static str, matcher: Option<&'static str>, kind: &'static str, timeout: u64, background: bool, since: Option<semver::Version>) -> HookDescription {
    HookDescription { event, matcher, kind, timeout, background, since }
}

const AGENTS: &[AgentDescription] = &[
    AgentDescription {
        harness: "claude", label: "Claude Code", binary: "claude", bin_env: "IMPECCABLE_CLAUDE_BIN",
        root: ".claude", root_env: Some("CLAUDE_CONFIG_DIR"), root_env_suffix: None, mcp_file: ".claude.json", mcp_in_home: true, mcp_manual_file: None,
        mcp_format: McpFormat::Json { section: "mcpServers", transport: Some("http"), all_tools: false, enabled: false },
        registration: Registration::Cli { add: &["mcp", "add-json", "--scope", "user", "{name}", "{entry}"], remove: &["mcp", "remove", "--scope", "user", "{name}"], interactive: false },
        rule: "CLAUDE.md", rule_override: None, rule_existing_only: false, post_add: &[],
        sign_in: "in Claude Code, run /mcp, choose impeccable, then Authenticate.", status_sign_in: false, follow_up: None,
        record: RecordLayout::Accounts, approve_tools: false, wake_gate: None,
        plugin: None, hooks: &[
            hook("SessionStart", None, "lifecycle", 86400, true, None),
            hook("Stop", None, "lifecycle", 86400, true, None),
            hook("StopFailure", None, "lifecycle", 86400, true, None),
            hook("PostToolUse", None, "register", 10, false, None),
            hook("PreToolUse", Some("AskUserQuestion"), "adoption", 2, false, None),
            hook("SessionStart", None, "context", 5, false, Some(semver::Version::new(0, 1, 1))),
        ],
    },
    AgentDescription {
        harness: "codex", label: "Codex", binary: "codex", bin_env: "IMPECCABLE_CODEX_BIN",
        root: ".codex", root_env: Some("CODEX_HOME"), root_env_suffix: None, mcp_file: "config.toml", mcp_in_home: false, mcp_manual_file: None,
        mcp_format: McpFormat::Toml,
        registration: Registration::Cli { add: &["mcp", "add", "{name}", "--url", "{url}"], remove: &["mcp", "remove", "{name}"], interactive: true },
        rule: "AGENTS.md", rule_override: Some("AGENTS.override.md"), rule_existing_only: false, post_add: &[],
        sign_in: "run codex mcp login impeccable (skip it if Codex just signed you in).", status_sign_in: false, follow_up: None,
        record: RecordLayout::ConfigDir, approve_tools: true, wake_gate: None,
        plugin: None, hooks: &[
            hook("SessionStart", None, "lifecycle", 10, false, None),
            hook("PostToolUse", None, "register", 10, false, None),
            hook("SessionStart", None, "context", 5, false, Some(semver::Version::new(0, 1, 1))),
            hook("Stop", None, "lifecycle", 3600, false, Some(STOP_HOLD)),
        ],
    },
    AgentDescription {
        harness: "cursor", label: "Cursor", binary: "cursor-agent", bin_env: "IMPECCABLE_CURSOR_BIN",
        root: ".cursor", root_env: None, root_env_suffix: None, mcp_file: "mcp.json", mcp_in_home: false, mcp_manual_file: None,
        mcp_format: McpFormat::Json { section: "mcpServers", transport: None, all_tools: false, enabled: false }, registration: Registration::Journal,
        rule: "rules/impeccable.mdc", rule_override: None, rule_existing_only: false, post_add: &["mcp", "enable", "impeccable"],
        sign_in: "run cursor-agent mcp login impeccable.", status_sign_in: true, follow_up: None,
        record: RecordLayout::Global, approve_tools: true, wake_gate: Some(CLI_WAKE),
        plugin: None, hooks: &[
            hook("sessionStart", None, "lifecycle", 10, false, Some(CLI_WAKE)),
            hook("afterMCPExecution", None, "register", 10, false, Some(CLI_WAKE)),
            hook("stop", None, "lifecycle", 3600, false, Some(CLI_WAKE)),
        ],
    },
    AgentDescription {
        harness: "copilot", label: "GitHub Copilot CLI", binary: "copilot", bin_env: "IMPECCABLE_COPILOT_BIN",
        root: ".copilot", root_env: Some("COPILOT_HOME"), root_env_suffix: None, mcp_file: "mcp-config.json", mcp_in_home: false, mcp_manual_file: None,
        mcp_format: McpFormat::Json { section: "mcpServers", transport: Some("http"), all_tools: true, enabled: false }, registration: Registration::Journal,
        rule: "copilot-instructions.md", rule_override: None, rule_existing_only: false, post_add: &[],
        sign_in: "on first use.", status_sign_in: true,
        follow_up: Some("In each repo, answer \"Yes, and don't ask again\" for Impeccable's tools once; then Copilot wakes by itself."),
        record: RecordLayout::Global, approve_tools: false, wake_gate: Some(CLI_WAKE),
        plugin: None, hooks: &[
            hook("sessionStart", None, "lifecycle", 10, false, Some(CLI_WAKE)),
            hook("postToolUse", None, "register", 10, false, Some(CLI_WAKE)),
            hook("agentStop", None, "lifecycle", 3600, false, Some(CLI_WAKE)),
        ],
    },
    AgentDescription {
        harness: "opencode", label: "opencode", binary: "opencode", bin_env: "IMPECCABLE_OPENCODE_BIN",
        root: ".config/opencode", root_env: Some("XDG_CONFIG_HOME"), root_env_suffix: Some("opencode"),
        mcp_file: "opencode.json", mcp_in_home: false, mcp_manual_file: Some("opencode.jsonc"),
        mcp_format: McpFormat::Json { section: "mcp", transport: Some("remote"), all_tools: false, enabled: true },
        registration: Registration::Journal,
        rule: "AGENTS.md", rule_override: None, rule_existing_only: true, post_add: &[],
        sign_in: "on first use.", status_sign_in: true, follow_up: None,
        record: RecordLayout::Global, approve_tools: false, wake_gate: Some(CLI_WAKE),
        hooks: &[], plugin: Some(include_str!("../assets/opencode-loop-plugin.ts")),
    },
];

fn description(harness: &str) -> Option<&'static AgentDescription> {
    AGENTS.iter().find(|a| a.harness == harness)
}

impl AgentDescription {
    fn hooks_required(&self, version: Option<&semver::Version>) -> bool {
        self.wake_gate.as_ref().is_none_or(|gate| version.is_some_and(|v| v >= gate))
    }

    fn rule_file(&self, root: &Path) -> PathBuf {
        self.rule_override.map(|name| root.join(name)).filter(|p| p.exists())
            .unwrap_or_else(|| root.join(self.rule))
    }

    fn writes_rule(&self, root: &Path) -> bool {
        !self.rule_existing_only || self.rule_file(root).is_file()
    }

    fn rule_files(&self, root: &Path) -> Vec<PathBuf> {
        self.rule_override.into_iter().chain(std::iter::once(self.rule)).map(|name| root.join(name)).collect()
    }

    fn mcp_entry(&self) -> Value {
        let mut entry = json!({"url": mcp_url()});
        if let McpFormat::Json { transport, all_tools, enabled, .. } = self.mcp_format {
            if let Some(transport) = transport { entry["type"] = json!(transport); }
            if all_tools { entry["tools"] = json!(["*"]); }
            if enabled { entry["enabled"] = json!(true); }
        }
        entry
    }

    fn arguments(&self, args: &[&str]) -> Vec<String> {
        args.iter().map(|arg| match *arg {
            "{name}" => MCP_NAME.into(),
            "{url}" => mcp_url().into(),
            "{entry}" => self.mcp_entry().to_string(),
            _ => (*arg).into(),
        }).collect()
    }
}

fn label(harness: &str) -> &'static str {
    description(harness).map_or("Agent", |a| a.label)
}

/// One agent on this Mac, as connect sees it.
struct Agent {
    description: &'static AgentDescription,
    harness: &'static str,
    /// The agent's CLI, validated (absolute, an executable regular file).
    executable: PathBuf,
    /// The root selected by the agent description and its optional environment override.
    root: PathBuf,
    /// The file that holds the agent's global (user-scope) MCP servers.
    mcp_file: PathBuf,
    /// The variable that selects that file, set explicitly for every call (Claude's
    /// default account has none, and its CLI then runs with the variable removed).
    env: Option<(&'static str, PathBuf)>,
}

/// `loop connect`.
pub(crate) fn connect(io: &Io) -> Result<String> {
    connect_only(io, None)
}

/// `loop connect [--agent claude|codex|cursor|copilot|opencode]`: the full text report, sign-in and follow-up
/// steps included, for every agent or just the one named.
pub(crate) fn connect_only(io: &Io, only: Option<&str>) -> Result<String> {
    connect_text(io, only).0
}

/// [`connect_only`], plus the agents this run connected: when one agent fails, the
/// others are still connected and the result is an error naming the failure.
pub(crate) fn connect_text(io: &Io, only: Option<&str>) -> (Result<String>, Vec<String>) {
    match connect_agents(io, only) {
        Err(e) => (Err(e), Vec::new()),
        Ok((out, connected, failed, rows)) => {
            let agents = rows
                .iter()
                .filter(|r| r["result"] == "connected")
                .filter_map(|r| r["agent"].as_str().map(str::to_owned))
                .collect();
            (connect_report(out, only, connected, failed), agents)
        }
    }
}

fn connect_report(out: String, only: Option<&str>, connected: usize, failed: usize) -> Result<String> {
    if connected == 0 && failed == 0 {
        if let Some(harness) = only {
            return Err(format!("{}: not found.", label(harness)));
        }
        return Err(format!(
            "{out}No coding agent found to connect ({}).",
            AGENTS.iter().map(|d| d.label).collect::<Vec<_>>().join(", ")
        ));
    }
    if failed > 0 {
        return Err(out.trim_end().to_string());
    }
    Ok(out)
}

/// `loop connect [--agent claude|codex|cursor|copilot|opencode] --json`, for Loop's own Settings and first-run
/// panel: never asks anything, and always answers one JSON object on stdout. The bool
/// is whether every agent asked for connected.
pub(crate) fn connect_json(io: &Io, only: Option<&str>) -> (Value, bool) {
    match connect_agents(io, only) {
        Ok((_, connected, failed, agents)) => (
            json!({ "ok": failed == 0 && connected > 0, "agents": agents }),
            failed == 0 && connected > 0,
        ),
        Err(e) => (json!({ "ok": false, "error": e, "agents": [] }), false),
    }
}

/// Connects each agent (or just `only`), returning the text report, how many connected
/// and failed, and one JSON row per agent. Errors are the reasons nothing was tried.
fn connect_agents(io: &Io, only: Option<&str>) -> Result<(String, usize, usize, Vec<Value>)> {
    if let Some(h) = only {
        if description(h).is_none() {
            return Err(format!("Unknown agent: {h}. Use {}.", AGENTS.iter().map(|d| d.harness).collect::<Vec<_>>().join(", ")));
        }
    }
    init_mcp_url(io)?;
    let home = home(io)?;
    let helper = home.join(APP).join(HELPER);
    if !helper.is_file() {
        return Err(missing_loop(&helper));
    }
    // Checked before any agent's configuration changes.
    let support = support_dir(&home)?;
    let _lock = lock(&support)?;
    // Taken second, as --mcp-only takes it alone, so the two never add at once.
    let _mcp_lock = mcp_lock(io)?;
    let mut out = String::new();
    let mut rows = Vec::new();
    let (mut connected, mut failed) = (0, 0);
    for d in AGENTS {
        let (harness, label) = (d.harness, d.label);
        if only.is_some_and(|h| h != harness) {
            continue;
        }
        let Some(agent) = agent(io, &home, harness) else {
            out.push_str(&format!("{label}: not found, skipped.\n"));
            rows.push(json!({ "agent": harness, "label": label, "result": "not_found" }));
            continue;
        };
        let file = rule_file(harness, &agent.root);
        let noted = d.writes_rule(&agent.root) && note_missing_rule_file(&support, &file);
        let result = connect_one(&agent, &helper, &support);
        if noted && result.is_err() && fs::symlink_metadata(&file).is_err() {
            forget_missing_rule_file(&support, &file);
        }
        match result {
            Ok(manual) => {
                connected += 1;
                out.push_str(&format!(
                    "{label}: connected.\n  Sign in: {}\n",
                    d.sign_in
                ));
                if !manual.is_empty() {
                    if d.follow_up.is_some() { out.push_str(&format!("  {}\n", manual.join("; "))); }
                    else { out.push_str(&format!("  Then in {label}: {}.\n", manual.join("; "))); }
                }
                rows.push(json!({
                    "agent": harness, "label": label, "result": "connected",
                    "signIn": d.sign_in, "then": manual,
                }));
            }
            Err(e) => {
                failed += 1;
                out.push_str(&format!("{label}: not connected: {e}\n"));
                rows.push(json!({ "agent": harness, "label": label, "result": "failed", "error": e }));
            }
        }
    }
    if connected > 0 {
        out.push_str("To check it works, ask your agent to post a test question to Needs you.\n");
    }
    Ok((out, connected, failed, rows))
}

/// `loop status [--json]`: what Loop and each agent look like right now, read only.
/// Nothing is written and no lock is taken; the agents' CLIs are never run.
pub(crate) fn status(io: &Io) -> Result<Value> {
    // Reading never needs the account's server: on an origin connect would refuse, an
    // entry is judged against production's, as disconnect does. Failing here would also
    // silence login's Loop offer.
    let _ = init_mcp_url(io);
    let home = home(io)?;
    let helper = home.join(APP).join(HELPER);
    let loop_installed = helper.is_file();
    let version = bundle_version(&helper);
    let loop_version = version.as_deref().and_then(|v| semver::Version::parse(v).ok());
    let support = SUPPORT
        .iter()
        .fold(home.join(SUPPORT_PARENT), |d, part| d.join(part));
    let installed = installed_specs(OWNER).map(|f| f.committed).unwrap_or_default();
    let mut agents = Vec::new();
    for d in AGENTS {
        let (harness, label) = (d.harness, d.label);
        let Some(agent) = agent(io, &home, harness) else {
            agents.push(json!({ "agent": harness, "label": label, "detected": false }));
            continue;
        };
        let mcp = if manual_mcp(&agent).is_some() { "manual" } else { match read_entry(&agent) {
            Entry::Exact => "registered",
            Entry::Absent => "absent",
            Entry::Other(_) => "different",
        }};
        // Hooks count only when the engine installed them for this very config folder and
        // every resource is still as written: a journal alone says nothing once a hook was
        // removed by hand. A folder with no installation is answered without touching the
        // engine's folder at all.
        let resources_ok = loop_installed
            && installed.iter().any(|s| s.harness == harness && s.root == agent.root)
            && run_spec("status", &spec(&agent, &helper)).is_ok_and(|s| {
                s["installed"] == true
                    && s["resources"]
                        .as_array()
                        .is_some_and(|r| r.iter().all(|x| x["state"] != "conflict"))
            });
        // Present only where the agent reads it: under an override, the override must carry it.
        // The Impeccable block's loop line, or an older CLI's engine block holding the same
        // line until the next connect folds it in.
        let instruction = agent_block::present(&rule_file(harness, &agent.root), "loop")
            || fs::read_to_string(rule_file(harness, &agent.root)).is_ok_and(|t| t.contains(agent_block::LOOP));
        // The wake record is shared per agent; it speaks for this folder only when it names it.
        let root = agent.root.display().to_string();
        let connected = read_record(&support, harness).is_some_and(|r| {
            r["enabled"] == true
                && (d.record == RecordLayout::Global
                    || r["configDir"].as_str() == Some(root.as_str())
                    || r["accounts"]
                        .as_array()
                        .is_some_and(|a| a.iter().any(|x| x.as_str() == Some(root.as_str()))))
        });
        let hooks_required = d.hooks_required(loop_version.as_ref());
        let hooks = resources_ok && installed.iter().any(|s| s.harness == harness && s.root == agent.root && (!s.hooks.is_empty() || s.wake_plugin.is_some()));
        agents.push(json!({
            "agent": harness, "label": label, "detected": true,
            "signIn": d.sign_in, "hooksRequired": hooks_required,
            "mcp": mcp, "hooks": hooks, "instruction": instruction, "instructionRequired": d.writes_rule(&agent.root),
            "manualMcp": manual_mcp(&agent),
            "connected": connected && (hooks_required || resources_ok),
        }));
    }
    Ok(json!({
        "loop": { "installed": loop_installed, "version": version, "blocked": loop_installed && blocked(&helper) },
        "agents": agents,
    }))
}

/// Whether a `status` agent row is connected all the way: Loop's record names it, and its
/// MCP server, hooks and instruction are all in place.
pub(crate) fn agent_connected(a: &Value) -> bool {
    a["connected"] == true
        && (a["hooks"] == true || a["hooksRequired"] == false)
        && (a["instruction"] == true || a["instructionRequired"] == false)
        && a["mcp"] == "registered"
}

/// The plain-text form of `status`.
pub(crate) fn status_text(v: &Value) -> String {
    let mut out = match v["loop"]["version"].as_str() {
        _ if v["loop"]["blocked"] == true => {
            "Loop: macOS is blocking it. Run impeccable loop update to reinstall it.\n".to_string()
        }
        Some(ver) if v["loop"]["installed"] == true => format!("Loop {ver}: installed.\n"),
        _ if v["loop"]["installed"] == true => "Loop: installed.\n".to_string(),
        _ => "Loop: not installed. Run impeccable loop install.\n".to_string(),
    };
    for a in v["agents"].as_array().into_iter().flatten() {
        let label = a["label"].as_str().unwrap_or("Agent");
        if a["detected"] != true {
            out.push_str(&format!("{label}: not found.\n"));
        } else if agent_connected(a) {
            out.push_str(&format!("{label}: connected.\n"));
        } else {
            out.push_str(&format!(
                "{label}: not connected (MCP server {}, hooks {}, instruction {}). Run impeccable loop connect.\n",
                a["mcp"].as_str().unwrap_or("absent"),
                if a["hooks"] == true { "present" } else { "missing" },
                if a["instruction"] == true { "present" } else { "missing" },
            ));
        }
        if let Some(d) = a["agent"].as_str().and_then(description).filter(|d| d.status_sign_in && a["detected"] == true) {
            out.push_str(&format!("  Sign in: {}\n", d.sign_in));
        }
        if let Some(step) = a["manualMcp"].as_str() { out.push_str(&format!("  {step}\n")); }
        if let Some(step) = a["agent"].as_str().and_then(description).filter(|_| a["detected"] == true).and_then(|d| d.follow_up) {
            out.push_str(&format!("  {step}\n"));
        }
    }
    out
}

/// The MCP server, added only when the agent has none of that name. True when this call
/// added it; an entry of that name that differs is left alone and is an error.
fn manual_mcp(agent: &Agent) -> Option<String> {
    let file = agent.description.mcp_manual_file.map(|name| agent.root.join(name))?;
    (!agent.mcp_file.exists() && file.exists()).then(|| format!("Add the impeccable MCP server ({}) to {}.", mcp_url(), file.display()))
}

fn ensure_mcp(agent: &Agent) -> Result<bool> {
    if manual_mcp(agent).is_some() { return Ok(false); }
    if matches!(agent.description.registration, Registration::Journal) {
        let added = mcp_absent(agent)?;
        if added {
            fs::create_dir_all(&agent.root).map_err(|e| e.to_string())?;
            run_spec("apply", &mcp_spec(agent)).map_err(|(_, m)| m)?;
        }
        post_add(agent)?;
        return Ok(added);
    }
    if !mcp_absent(agent)? { return Ok(false); }
    let ran = add_server(agent);
    match read_entry(agent) {
        Entry::Exact => Ok(true),
        Entry::Absent => Err(ran.err().unwrap_or_else(|| "the agent didn't add the MCP server".into())),
        Entry::Other(why) => Err(format!("the MCP server the agent wrote isn't as expected ({why}); check {}", agent.mcp_file.display())),
    }
}

fn mcp_absent(agent: &Agent) -> Result<bool> {
    match read_entry(agent) {
        Entry::Exact => Ok(false),
        Entry::Absent => Ok(true),
        Entry::Other(why) if why == SETTINGS_DIFFER => {
            return Err(format!(
                "{} already has a different MCP server called {MCP_NAME}; it was left alone. Remove or rename it, then connect again.",
                agent.mcp_file.display()
            ))
        }
        Entry::Other(why) => {
            return Err(format!(
                "{} already has an MCP server called {MCP_NAME} ({why}); it was left alone",
                agent.mcp_file.display()
            ))
        }
    }
}

/// `loop connect --mcp-only [--agent claude|codex|cursor|copilot|opencode] [--json]`: the MCP server alone, for a
/// person without the Loop app (any OS). No hooks, no taste block, no Loop records: each
/// agent signs in to the server itself on first use.
pub(crate) fn connect_mcp(io: &Io, only: Option<&str>) -> (Result<String>, Value, bool) {
    let rows = (|| -> Result<(String, usize, usize, Vec<Value>)> {
        if let Some(h) = only {
            if description(h).is_none() {
                return Err(format!("Unknown agent: {h}. Use {}.", AGENTS.iter().map(|d| d.harness).collect::<Vec<_>>().join(", ")));
            }
        }
        init_mcp_url(io)?;
        let home = home(io)?;
        let _lock = mcp_lock(io)?;
        let (mut out, mut rows, mut connected, mut failed) = (String::new(), Vec::new(), 0, 0);
        for d in AGENTS {
            let (harness, label) = (d.harness, d.label);
            if only.is_some_and(|h| h != harness) {
                continue;
            }
            let Some(agent) = agent(io, &home, harness) else {
                out.push_str(&format!("{label}: not found, skipped.\n"));
                rows.push(json!({ "agent": harness, "label": label, "result": "not_found" }));
                continue;
            };
            match ensure_mcp(&agent) {
                Ok(added) => {
                    connected += 1;
                    let what = if manual_mcp(&agent).is_some() { "MCP setup needs a manual step" } else if added { "MCP server added" } else { "MCP server already there" };
                    out.push_str(&format!("{label}: {what}.\n  Sign in: {}\n", d.sign_in));
                    let manual = manual_mcp(&agent);
                    if let Some(step) = &manual { out.push_str(&format!("  {step}\n")); }
                    rows.push(json!({ "agent": harness, "label": label, "result": "connected", "added": added, "signIn": d.sign_in, "manualMcp": manual }));
                }
                Err(e) => {
                    failed += 1;
                    out.push_str(&format!("{label}: not connected: {e}\n"));
                    rows.push(json!({ "agent": harness, "label": label, "result": "failed", "error": e }));
                }
            }
        }
        Ok((out, connected, failed, rows))
    })();
    match rows {
        Err(e) => (Err(e.clone()), json!({ "ok": false, "error": e, "agents": [] }), false),
        Ok((out, connected, failed, rows)) => {
            let ok = failed == 0 && connected > 0;
            (connect_report(out, only, connected, failed), json!({ "ok": ok, "agents": rows }), ok)
        }
    }
}

/// One agent. A failure after the hooks were newly installed undoes them; an earlier,
/// working installation is never undone by a failed reconnect. Journal-owned MCP
/// entries roll back with the hooks; CLI-added servers stay with a removal command.
fn connect_one(agent: &Agent, helper: &Path, support: &Path) -> Result<Vec<String>> {
    if agent.description.record == RecordLayout::ConfigDir {
        if let Some(other) = read_record(support, agent.harness)
            .filter(|r| r["enabled"] == true)
            .and_then(|r| r["configDir"].as_str().map(PathBuf::from))
            .filter(|dir| *dir != agent.root)
        {
            return Err(format!(
                "{} is already connected for {}; run impeccable loop disconnect first.",
                agent.description.label, other.display()
            ));
        }
    }
    // CLI-owned servers precede the engine apply; journal-owned entries ride with the hooks.
    let added = match agent.description.registration {
        Registration::Cli { .. } => ensure_mcp(agent)?,
        Registration::Journal => {
            if manual_mcp(agent).is_none() { mcp_absent(agent)?; }
            fs::create_dir_all(&agent.root).map_err(|e| e.to_string())?;
            false
        }
    };
    let with_mcp = |why: String| -> String {
        if added {
            format!(
                "{why}; the {MCP_NAME} MCP server it added stays, remove it with: {}",
                remove_command(agent)
            )
        } else {
            why
        }
    };
    if let Err(e) = note_target(support, agent) {
        return Err(with_mcp(e));
    }
    // A rule file whose markers are broken would refuse the loop line after the engine had
    // already taken an older CLI's block out: refuse before anything changes instead.
    let block_file = rule_file(agent.harness, &agent.root);
    if agent.description.writes_rule(&agent.root) {
        if let Err(e) = agent_block::writable(&block_file) {
            return Err(with_mcp(format!("couldn't add the Loop line to {}: {e}", block_file.display())));
        }
    }
    // 2. Loop's hooks, through the engine.
    let spec = spec(agent, helper);
    // An installation whose state can't be read is never treated as absent: a failure
    // below would then undo hooks that were working.
    let was_installed = match run_spec("status", &spec) {
        Ok(s) => s["installed"] == true,
        Err((_, msg)) => return Err(with_mcp(format!("couldn't read its hooks: {msg}"))),
    };
    if let Err((_, msg)) = run_spec("apply", &spec) {
        return Err(with_mcp(match recover_spec(&spec) {
            Ok(r) if r["state"] == "conflict" => format!(
                "{msg}; its half-applied hooks couldn't be rolled back because a file changed, see impeccable agents recover"
            ),
            Ok(_) => msg,
            Err((_, m)) => format!("{msg}; rolling back its hooks also failed: {m}"),
        }));
    }
    // The record as it was, so a failure puts it back: Loop keeps waking exactly what
    // it woke before, and nothing this connect only began.
    let prior_record = fs::read(support.join(format!("{}-install.json", agent.harness))).ok();
    let rollback = |why: String| -> String {
        let mut why = why;
        if let Err(e) = restore_record(support, agent.harness, prior_record.as_deref()) {
            why = format!("{why}; putting back Loop's record also failed: {e}");
        }
        if !was_installed {
            if let Err((_, msg)) = run_spec("undo", &spec) {
                return with_mcp(format!("{why}; undoing its hooks also failed: {msg}"));
            }
        }
        with_mcp(why)
    };
    if let Err(e) = post_add(agent) { return Err(rollback(e)); }
    // 3. The record Loop's helper reads, then a check that everything is in place.
    if let Err(e) = write_record(support, agent, true) {
        return Err(rollback(e));
    }
    let status = match run_spec("status", &spec) {
        Ok(s) => s,
        Err((_, m)) => return Err(rollback(m)),
    };
    let resources = status["resources"].as_array().cloned().unwrap_or_default();
    if status["installed"] != true
        || resources.iter().any(|r| r["state"] == "conflict")
    {
        return Err(rollback(
            "its hooks aren't in place after installing; run impeccable loop connect again".into(),
        ));
    }
    let mut manual: Vec<String> = status["manualActions"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();
    if let Some(step) = agent.description.follow_up { manual.push(step.into()); }
    if let Some(step) = manual_mcp(agent) { manual.push(step); }
    // 4. The "ask through Loop" line, in the file the agent reads.
    if agent.description.writes_rule(&agent.root) {
        if let Err(e) = agent_block::set(&rule_file(agent.harness, &agent.root), "loop", true) {
            return Err(rollback(format!("couldn't add the Loop line to its rule file: {e}")));
        }
    }
    // 5. Codex runs the hooks only once they are trusted (REN-2057). Last, so nothing
    // after it can roll the hooks back. When Codex can't do it (an older Codex, or one
    // that won't start), the engine's own step stays: approve them in /hooks.
    if agent.harness == "codex"
        && codex_trust::trust(&agent.executable, &agent.root, &commands(&spec)).is_ok()
    {
        manual.retain(|m| m != "Approve hooks via /hooks");
    }
    Ok(manual)
}

/// The hooks connect writes, as Codex's listing is matched against them.
fn commands(spec: &Spec) -> Vec<codex_trust::Written> {
    spec.hooks.iter().map(|h| (h.command.clone(), h.timeout)).collect()
}

/// `loop disconnect`: every installation connect made (from the engine's journals, not
/// today's environment), each on its own. Waking stops first, then each description
/// decides whether the server stays or is undone with the hooks.
pub(crate) fn disconnect(io: &Io) -> Result<String> {
    // Disconnect adds no server, so an account URL connect would refuse never blocks it;
    // the URL only decides whether a recorded entry still matches.
    let _ = init_mcp_url(io);
    let home = home(io)?;
    let support = support_dir(&home)?;
    let _lock = lock(&support)?;
    let mut out = String::new();
    let mut failed = false;
    // A connect that stopped part way is rolled back first, so its hooks are either
    // gone or committed (and then undone below).
    let found = installed_specs(OWNER).map_err(|(_, m)| m)?;
    // The taste block goes before the engine's undo, so the engine finds each rule file
    // exactly as it wrote it and cleans up after itself (a file it created goes too).
    let every: Vec<&Spec> = found.pending.iter().chain(&found.committed).collect();
    // Files, directories and empty-file baselines share one cleanup journal.
    let new_files: Vec<Value> = read_json(&support.join(TARGETS))
        .and_then(|n| n[TASTE_NEW_KEY].as_array().cloned())
        .unwrap_or_default();
    let taste_ok = remove_taste(&home, &support, &every, &mut out);
    failed |= !taste_ok;
    // The "ask through Loop" line goes with the hooks: from every file connect may have
    // written it to (Codex's AGENTS.md and its override both, since the override can come
    // or go after a connect). An installation whose line couldn't come out keeps its
    // hooks and journal, so the next disconnect visits it again.
    let mut kept: Vec<(String, PathBuf)> = Vec::new();
    for spec in &every {
        let files = description(&spec.harness).unwrap().rule_files(&spec.root);
        for file in files {
            match agent_block::set(&file, "loop", false) {
                Ok(_) => {}
                Err(e) => {
                    failed = true;
                    kept.push((spec.harness.clone(), spec.root.clone()));
                    out.push_str(&format!(
                        "{}: the Loop line in {} was left in place, and so were its hooks: {e}\n",
                        label(&spec.harness),
                        tilde(&home, &file)
                    ));
                }
            }
        }
    }
    let mut rolled_back = Vec::new();
    for spec in &found.pending {
        let label = label(&spec.harness);
        match recover_spec(spec) {
            Ok(r) if r["state"] == "conflict" => {
                failed = true;
                out.push_str(&format!(
                    "{label}: an earlier connect stopped part way and a file it touched has changed since; its hooks were left as they are.\n"
                ));
            }
            Ok(_) => rolled_back.push(spec),
            Err((_, msg)) => {
                failed = true;
                out.push_str(&format!(
                    "{label}: an earlier connect stopped part way and rolling it back failed: {msg}\n"
                ));
            }
        }
    }
    let found = installed_specs(OWNER).map_err(|(_, m)| m)?;
    for path in &found.unreadable {
        failed = true;
        out.push_str(&format!(
            "Couldn't read {}; whatever it installed was left in place.\n",
            path.display()
        ));
    }
    let specs: Vec<Spec> = found
        .committed
        .into_iter()
        .filter(|s| !kept.iter().any(|(h, r)| *h == s.harness && *r == s.root))
        .collect();
    // A rolled-back first connect has no journal left, but may have added the MCP
    // server and Loop's record: stop the waking and say how to remove the server.
    for spec in rolled_back {
        if specs
            .iter()
            .any(|s| s.harness == spec.harness && s.root == spec.root)
        {
            continue;
        }
        let label = label(&spec.harness);
        match forget_account(&support, &spec.harness, &spec.root) {
            Ok(()) => out.push_str(&format!(
                "{label}: an earlier connect that stopped part way was rolled back.\n"
            )),
            Err(e) => {
                failed = true;
                out.push_str(&format!("{label}: couldn't stop Loop waking it: {e}\n"));
            }
        }
        out.push_str(&mcp_stays(&support, spec));
    }
    for spec in &specs {
        if let Err(e) = forget_account(&support, &spec.harness, &spec.root) {
            failed = true;
            out.push_str(&format!(
                "{}: couldn't stop Loop waking it: {e}\n",
                label(&spec.harness)
            ));
        }
    }
    for spec in &specs {
        let label = label(&spec.harness);
        // The trust connect gave the hooks goes while Codex can still list them. Best
        // effort: an entry left behind names a hook that is gone, so it trusts nothing.
        if spec.harness == "codex" {
            if let Some(exe) = resolve(io, "codex") {
                let _ = codex_trust::untrust(&exe, &spec.root, &commands(spec));
            }
        }
        match run_spec("undo", spec) {
            Ok(result) => match result["conflicts"].as_array().map_or(0, Vec::len) {
                0 => out.push_str(&format!("{label}: disconnected.\n")),
                kept => out.push_str(&format!(
                    "{label}: disconnected; {kept} hooks you changed were left in place.\n"
                )),
            },
            Err((_, msg)) => {
                failed = true;
                out.push_str(&format!("{label}: hooks not removed: {msg}\n"));
            }
        }
        out.push_str(&mcp_stays(&support, spec));
    }
    cleanup_rule_paths(&support, new_files)?;
    if out.is_empty() {
        out.push_str("Nothing to disconnect.\n");
    }
    if failed {
        return Err(out.trim_end().to_string());
    }
    Ok(out)
}

/// The line saying where `spec`'s MCP server stays and the exact command to remove it,
/// or nothing when connect recorded no target or the server is already gone.
fn mcp_stays(support: &Path, spec: &Spec) -> String {
    if matches!(description(&spec.harness).unwrap().registration, Registration::Journal) {
        return String::new();
    }
    match recorded_target(support, &spec.harness, &spec.root) {
        Some(agent) if !matches!(read_entry(&agent), Entry::Absent) => format!(
            "  Its {MCP_NAME} MCP server stays in {}. To remove it: {}\n",
            agent.mcp_file.display(),
            remove_command(&agent)
        ),
        _ => String::new(),
    }
}

/// Why connect can't go on without Loop's helper. When agents are already connected,
/// their hooks call that path and stop waking without an error, so say so.
fn missing_loop(helper: &Path) -> String {
    let connected = installed_specs(OWNER).is_ok_and(|found| !found.committed.is_empty());
    if connected {
        format!(
            "Loop's hooks point at a Loop that isn't there: {} is missing, so your agents' sessions won't wake. Loop has to stay in ~/Applications (if you moved it to /Applications, move it back, or run impeccable loop install), then run impeccable loop connect again.",
            helper.display()
        )
    } else {
        "Impeccable Loop isn't installed in ~/Applications, or is too old to connect agents. Run impeccable loop install first.".into()
    }
}

fn home(io: &Io) -> Result<PathBuf> {
    // The engine's one reading of home: USERPROFILE first on Windows, HOME elsewhere.
    io.home()
        .filter(|h| h.is_absolute())
        .ok_or_else(|| "HOME is not set to an absolute path.".into())
}

/// The agent as connect configures it today, if its CLI is found.
fn agent(io: &Io, home: &Path, harness: &'static str) -> Option<Agent> {
    let executable = resolve(io, harness)?;
    // A relative folder means what it means to the agent started from here: resolved
    // against this directory, never dropped (that would connect the default account).
    let var = |name: &str| {
        io.env(name)
            .filter(|v| !v.is_empty())
            .map(|v| {
                io.cwd
                    .join(v)
                    .components()
                    .filter(|c| !matches!(c, std::path::Component::CurDir))
                    .collect::<PathBuf>()
            })
    };
    let d = description(harness)?;
    let custom = d.root_env.and_then(var);
    let root = custom.as_ref().map(|p| d.root_env_suffix.map_or_else(|| p.clone(), |suffix| p.join(suffix)))
        .unwrap_or_else(|| home.join(d.root));
    let mcp_root = if d.mcp_in_home { custom.as_deref().unwrap_or(home) } else { &root };
    Some(Agent {
        description: d, harness: d.harness, executable,
        mcp_file: mcp_root.join(d.mcp_file),
        env: d.root_env.map(|name| (name, d.root_env_suffix.map_or_else(|| root.clone(), |_| root.parent().unwrap().to_path_buf()))).filter(|_| !d.mcp_in_home || custom.is_some()),
        root,
    })
}

/// Where a recorded installation's MCP server lives, from connect's note (exact, as
/// connect saw it), for the message disconnect prints. No CLI is run from this.
fn recorded_target(support: &Path, harness: &str, root: &Path) -> Option<Agent> {
    let note = read_json(&support.join(TARGETS))?;
    let entry = &note["targets"][format!("{harness}:{}", root.display())];
    let mcp_file = PathBuf::from(entry["file"].as_str()?);
    let d = description(harness)?;
    let env = entry["env"].as_array().and_then(|kv| {
        let observed = kv.first()?.as_str()?;
        let name = d.root_env.filter(|name| observed == *name)?;
        Some((name, PathBuf::from(kv.get(1)?.as_str()?)))
    });
    Some(Agent {
        description: d, harness: d.harness,
        executable: PathBuf::new(),
        root: root.to_path_buf(),
        mcp_file,
        env,
    })
}

fn note_target(support: &Path, agent: &Agent) -> Result<()> {
    let mut note = read_json(&support.join(TARGETS)).unwrap_or_else(|| json!({}));
    if !note["targets"].is_object() {
        note["targets"] = json!({});
    }
    note["targets"][format!("{}:{}", agent.harness, agent.root.display())] = json!({
        "file": agent.mcp_file.display().to_string(),
        "env": agent.env.as_ref().map(|(k, v)| json!([k, v.display().to_string()])),
    });
    publish(support, TARGETS, &note)
}

/// The agent's CLI, resolved once: the engine's override variable, else the first
/// executable regular file named for it in an absolute PATH entry (relative entries such
/// as `.` are skipped).
fn resolve(io: &Io, harness: &str) -> Option<PathBuf> {
    let d = description(harness)?;
    let (over, binary) = (d.bin_env, d.binary);
    if let Some(path) = io.env(over).filter(|v| !v.is_empty()) {
        let p = PathBuf::from(path);
        return runnable(&p).then_some(p);
    }
    // Windows finds a CLI by its extension (npm installs `claude.cmd`), and separates
    // PATH entries with `;`, which split_paths knows.
    let names: &[&str] = if cfg!(windows) { &[".exe", ".cmd", ".bat"] } else { &[""] };
    let path = io.env("PATH")?;
    std::env::split_paths(path)
        .filter(|d| d.is_absolute())
        .flat_map(|d| names.iter().map(move |ext| d.join(format!("{binary}{ext}"))))
        .find(|p| runnable(p))
}

fn runnable(p: &Path) -> bool {
    p.is_absolute()
        && fs::metadata(p).is_ok_and(|m| {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                m.is_file() && m.permissions().mode() & 0o111 != 0
            }
            #[cfg(not(unix))]
            {
                m.is_file()
            }
        })
}

enum Entry {
    Absent,
    /// Exactly the entry connect writes, and nothing else.
    Exact,
    /// Something else under that name, or a file that can't be read as expected.
    Other(String),
}

/// The agent's global `impeccable` MCP entry, read from its own file (never through the
/// CLI, whose view merges in project settings and leaves fields out).
fn read_entry(agent: &Agent) -> Entry {
    let bytes = match fs::read(&agent.mcp_file) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Entry::Absent,
        Err(e) => return Entry::Other(e.to_string()),
    };
    let text = String::from_utf8_lossy(&bytes);
    if let McpFormat::Json { section, .. } = agent.description.mcp_format {
        let Ok(v) = serde_json::from_str::<Value>(&text) else {
            return Entry::Other("its file isn't valid JSON".into());
        };
        return match v.get(section).and_then(|s| s.get(MCP_NAME)) {
            None => Entry::Absent,
            Some(e) if *e == agent.description.mcp_entry() => Entry::Exact,
            Some(_) => Entry::Other(SETTINGS_DIFFER.into()),
        };
    }
    let Ok(doc) = text.parse::<toml_edit::DocumentMut>() else {
        return Entry::Other("its file isn't valid TOML".into());
    };
    let Some(entry) = doc.get("mcp_servers").and_then(|s| s.get(MCP_NAME)) else {
        return Entry::Absent;
    };
    let Some(table) = entry.as_table_like() else {
        return Entry::Other(SETTINGS_DIFFER.into());
    };
    // The approval mode is connect's own (through the engine's mcp_approvals), so a
    // server it already set up still counts as exactly its own.
    let keys: Vec<&str> = table
        .iter()
        .map(|(k, _)| k)
        .filter(|k| *k != "default_tools_approval_mode")
        .collect();
    if keys == ["url"] && table.get("url").and_then(|v| v.as_str()) == Some(mcp_url()) {
        Entry::Exact
    } else {
        Entry::Other(SETTINGS_DIFFER.into())
    }
}

/// The agent's CLI with exactly the configuration selection connect saw, run outside
/// any project so project settings play no part.
fn cli(agent: &Agent, args: &[&str]) -> Command {
    let mut cmd = Command::new(&agent.executable);
    cmd.args(args).stdin(Stdio::null());
    match &agent.env {
        Some((k, v)) => {
            cmd.env(k, v);
        }
        None => {
            if let Some(name) = agent.description.root_env { cmd.env_remove(name); }
        }
    }
    if agent.root.is_dir() {
        cmd.current_dir(&agent.root);
    }
    cmd
}

/// Run the description's approval command after the MCP entry is in place.
fn post_add(agent: &Agent) -> Result<()> {
    let args = agent.description.post_add;
    if args.is_empty() { return Ok(()); }
    let out = cli(agent, args).output().map_err(|e| e.to_string())?;
    if out.status.success() { Ok(()) } else { Err(format!("{} refused to enable impeccable.", agent.description.label)) }
}

/// CLI registration may include browser sign-in, bounded so it cannot hang connect.
fn add_server(agent: &Agent) -> Result<()> {
    let Registration::Cli { add, interactive, .. } = agent.description.registration else { unreachable!() };
    let args = agent.description.arguments(add);
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    if !interactive {
        let out = cli(agent, &args).output().map_err(|e| e.to_string())?;
        return if out.status.success() { Ok(()) } else { Err(format!("{} refused to add the MCP server", agent.description.binary)) };
    }
    let mut child = cli(agent, &args)
        // The agent's own sign-in messages stay on stderr, leaving JSON stdout intact.
        .stdout(std::io::stderr())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| e.to_string())?;
    let deadline = Instant::now() + ADD_WAIT;
    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            return if status.success() {
                Ok(())
            } else {
                Err(format!("{} didn't finish adding the MCP server or signing in", agent.description.binary))
            };
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("{} took too long to add the MCP server or sign in", agent.description.binary));
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// The command a person runs to remove the server, with the exact configuration
/// selection connect used (Claude's default account: the variable unset).
fn remove_command(agent: &Agent) -> String {
    let Registration::Cli { remove, .. } = agent.description.registration else { unreachable!() };
    let env = match &agent.env {
        Some((k, v)) => format!("{k}={} ", quote(v)),
        None => agent.description.root_env.map_or(String::new(), |name| format!("env -u {name} ")),
    };
    format!("{env}{} {}", agent.description.binary, agent.description.arguments(remove).join(" "))
}

fn quote(path: &Path) -> String {
    format!("'{}'", path.display().to_string().replace('\'', r"'\''"))
}

/// The CFBundleShortVersionString of the Loop that owns `helper`
/// (…/Contents/MacOS/loop-hook). None when it can't be read.
fn bundle_version(helper: &Path) -> Option<String> {
    let plist = helper.parent()?.parent()?.join("Info.plist");
    Command::new("/usr/bin/plutil")
        .args(["-extract", "CFBundleShortVersionString", "raw", "-o", "-"])
        .arg(plist)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
}

/// The first Loop whose own reading of the hooks (its Settings and first-run panel)
/// accepts the guarded command below. An older Loop would read guarded hooks as missing,
/// so it keeps the plain command.
const GUARDED_SINCE: semver::Version = semver::Version::new(0, 1, 3);

/// A quarantine flags field (the xattr's first `;`-separated part, four hex digits) with
/// 0x40, the person's approval, clear: macOS would refuse to run the helper.
const UNAPPROVED: &str = "^[0-9a-fA-F]{2}[0-389abAB][0-9a-fA-F];";

/// Whether macOS will refuse to run `helper`: it carries a quarantine flag the person never
/// approved. Loop is signed but not notarized, so it runs only without one. Read with
/// getxattr, no process; the same test as the guarded hook command's.
pub(crate) fn blocked(helper: &Path) -> bool {
    quarantine(helper).is_some_and(|q| {
        let flags = q.split(';').next().unwrap_or_default();
        flags.len() == 4 && u16::from_str_radix(flags, 16).is_ok_and(|f| f & 0x40 == 0)
    })
}

#[cfg(target_os = "macos")]
fn quarantine(path: &Path) -> Option<String> {
    use std::os::unix::ffi::OsStrExt;
    let path = std::ffi::CString::new(path.as_os_str().as_bytes()).ok()?;
    let mut buf = [0u8; 256];
    // SAFETY: both strings are NUL-terminated and buf is as long as the size passed.
    let n = unsafe {
        libc::getxattr(
            path.as_ptr(),
            c"com.apple.quarantine".as_ptr(),
            buf.as_mut_ptr().cast(),
            buf.len(),
            0,
            0,
        )
    };
    (n >= 0).then(|| String::from_utf8_lossy(&buf[..n as usize]).into_owned())
}

#[cfg(not(target_os = "macos"))]
fn quarantine(_: &Path) -> Option<String> {
    None
}

/// An explicit MCP-only installation: no Loop helper, approvals, hooks or rule.
fn mcp_spec(agent: &Agent) -> Spec {
    Spec {
        version: 1, owner: OWNER.into(), harness: agent.harness.into(), root: agent.root.clone(),
        hooks: vec![], wake_plugin: None, mcp_servers: vec![], mcp_approvals: vec![], instruction: None,
        http_mcp_servers: match agent.description.registration {
            Registration::Journal if manual_mcp(agent).is_none() => [(MCP_NAME.into(), mcp_url().into())].into(),
            Registration::Journal => Default::default(),
            Registration::Cli { .. } => Default::default(),
        },
    }
}

/// Loop's hooks and approvals, with journal-owned MCP entries in the same apply.
fn spec(agent: &Agent, helper: &Path) -> Spec {
    let mut spec = mcp_spec(agent);
    let version = bundle_version(helper).and_then(|v| semver::Version::parse(&v).ok());
    let guarded = version.as_ref().is_some_and(|v| *v >= GUARDED_SINCE);
    let helper_q = quote(helper);
    let harness = agent.harness;
    let command = if guarded {
        format!("/usr/bin/xattr -p com.apple.quarantine {helper_q} 2>/dev/null | /usr/bin/grep -Eq '{UNAPPROVED}' || exec {helper_q} {harness}")
    } else { format!("{helper_q} {harness}") };
    if agent.description.hooks_required(version.as_ref()) {
        spec.wake_plugin = agent.description.plugin.map(|template| template.replace("__COMMAND__", &serde_json::to_string(&command).unwrap()));
    }
    spec.hooks = agent.description.hooks.iter()
        .filter(|h| h.since.as_ref().is_none_or(|gate| version.as_ref().is_some_and(|v| v >= gate)))
        .map(|h| {
            let command = format!("{command} {}", h.kind);
            Hook {
                event: h.event.into(), matcher: h.matcher.map(Into::into), command,
                timeout: Some(h.timeout), run_async: h.background.then_some(true), async_rewake: h.background.then_some(true),
            }
        }).collect();
    if agent.description.approve_tools {
        spec.mcp_approvals.push(McpApproval { server: MCP_NAME.into(), mode: "approve".into() });
    }
    spec
}

/// Loop's support folder, made safe before anything else is written: each folder is the
/// person's own and never a symlink, and the folders are 0700.
fn support_dir(home: &Path) -> Result<PathBuf> {
    let parent = home.join(SUPPORT_PARENT);
    fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
    let mut dir = parent;
    for part in SUPPORT {
        dir.push(part);
        match fs::symlink_metadata(&dir) {
            Ok(m) if m.file_type().is_symlink() || !m.is_dir() => {
                return Err(format!(
                    "{} isn't a plain folder; refusing to write there.",
                    dir.display()
                ));
            }
            Ok(_m) => {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::{MetadataExt, PermissionsExt};
                    // SAFETY: getuid has no preconditions.
                    if _m.uid() != unsafe { libc::getuid() } {
                        return Err(format!(
                            "{} belongs to another user; refusing to write there.",
                            dir.display()
                        ));
                    }
                    if _m.mode() & 0o777 != 0o700 {
                        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700))
                            .map_err(|e| e.to_string())?;
                    }
                }
            }
            Err(_) => {
                let mut builder = fs::DirBuilder::new();
                #[cfg(unix)]
                {
                    use std::os::unix::fs::DirBuilderExt;
                    builder.mode(0o700);
                }
                builder.create(&dir).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(dir)
}

/// One connect or disconnect at a time, across the engine, the agents' MCP entries and
/// the helper's records.
fn lock(support: &Path) -> Result<fs::File> {
    lock_at(&support.join(".connect.lock"))
}

/// One change to the agents' MCP servers at a time, with or without Loop: kept under
/// the engine's own folder (IMPECCABLE_HOME, else ~/.impeccable) so `--mcp-only` makes
/// no Loop folder on a machine without Loop.
fn mcp_lock(io: &Io) -> Result<fs::File> {
    let dir = impeccable_account::config::impeccable_home(&io.env)
        .ok_or("HOME is not set to an absolute path.")?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    lock_at(&dir.join(".mcp-connect.lock"))
}

fn lock_at(path: &Path) -> Result<fs::File> {
    let path = path.to_path_buf();
    if fs::symlink_metadata(&path).is_ok_and(|m| !m.is_file()) {
        return Err(format!(
            "{} isn't a plain file; refusing to write there.",
            path.display()
        ));
    }
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    let file = options.open(&path).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::fd::AsRawFd;
        let deadline = Instant::now() + LOCK_WAIT;
        // SAFETY: flock on a descriptor this function owns; released when the file drops.
        while unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
            if Instant::now() >= deadline {
                return Err(
                    "Another impeccable loop connect or disconnect is still running.".into(),
                );
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }
    Ok(file)
}

fn read_json(path: &Path) -> Option<Value> {
    if !fs::symlink_metadata(path).ok()?.is_file() {
        return None;
    }
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

fn read_record(support: &Path, harness: &str) -> Option<Value> {
    read_json(&support.join(format!("{harness}-install.json")))
}

/// The record Loop's helper reads. Claude may be connected for several config folders:
/// `accounts` keeps all of them, `configDir` names the latest.
fn write_record(support: &Path, agent: &Agent, enabled: bool) -> Result<()> {
    let root = agent.root.display().to_string();
    let mut accounts: Vec<String> = read_record(support, agent.harness)
        .filter(|v| v["enabled"] == true)
        .and_then(|v| v["accounts"].as_array().cloned())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|a| a.as_str().map(str::to_owned))
        .collect();
    if !accounts.contains(&root) {
        accounts.push(root.clone());
    }
    let mut record = json!({
        "enabled": enabled,
        "harness": agent.harness,
        "executable": agent.executable.display().to_string(),
        "configDir": root,
    });
    if agent.description.record == RecordLayout::Global { record.as_object_mut().unwrap().remove("configDir"); }
    if agent.description.record == RecordLayout::Accounts {
        record["accounts"] = json!(accounts);
    }
    publish(support, &format!("{}-install.json", agent.harness), &record)
}

/// Disconnect: this config folder no longer wakes. When none is left, the record says
/// so (`enabled: false`, `uninstalled: true`).
fn forget_account(support: &Path, harness: &str, root: &Path) -> Result<()> {
    let Some(mut record) = read_record(support, harness) else {
        return Ok(());
    };
    let root = root.display().to_string();
    let left: Vec<Value> = record["accounts"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|a| a.as_str() != Some(root.as_str()))
        .collect();
    if description(harness).unwrap().record == RecordLayout::Accounts && !left.is_empty() {
        record["accounts"] = json!(left);
        if record["configDir"] == root {
            record["configDir"] = left[0].clone();
        }
    } else {
        record["enabled"] = json!(false);
        record["uninstalled"] = json!(true);
        if description(harness).unwrap().record == RecordLayout::Accounts {
            record["accounts"] = json!([]);
        }
    }
    publish(support, &format!("{harness}-install.json"), &record)
}

/// Write a file whole: staged beside it (0600, created fresh) and renamed over it, so a
/// reader never sees half a file and a symlink at the name is replaced, not followed.
/// Put `harness`'s record back as it was before a connect began: its earlier bytes, or
/// no record at all.
fn restore_record(support: &Path, harness: &str, prior: Option<&[u8]>) -> Result<()> {
    let name = format!("{harness}-install.json");
    match prior {
        Some(bytes) => publish_bytes(support, &name, bytes),
        None => match fs::remove_file(support.join(&name)) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
            _ => Ok(()),
        },
    }
}

fn publish(support: &Path, name: &str, value: &Value) -> Result<()> {
    publish_bytes(support, name, format!("{value:#}\n").as_bytes())
}

fn publish_bytes(support: &Path, name: &str, bytes: &[u8]) -> Result<()> {
    let path = support.join(name);
    let staged = support.join(format!(".{name}.{}", std::process::id()));
    let _ = fs::remove_file(&staged);
    {
        use std::io::Write;
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&staged).map_err(|e| e.to_string())?;
        file.write_all(bytes).map_err(|e| e.to_string())?;
    }
    fs::rename(&staged, &path).map_err(|e| {
        let _ = fs::remove_file(&staged);
        e.to_string()
    })
}

/// What connect does about the taste block (`--taste`, `--no-taste`, or neither).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Taste {
    /// Neither flag: a person at a terminal is asked once; anything else skips it.
    Ask,
    /// Never ask (the JSON form): with no flag, nothing is added.
    Skip,
    Yes,
    No,
}

/// The person's answer for each rule file, in connect's note: `"on"` (added) or
/// `"off"` (declined). The rule file itself never carries it.
const TASTE_KEY: &str = "taste";
/// Paths connect created (files and directories), plus empty-file baselines as
/// `{path, before: ""}`. Cleanup removes created empty paths and restores baselines
/// through this one list; a pre-existing empty file stays.
const TASTE_NEW_KEY: &str = "tasteCreated";

/// Before a connect writes to `file`: note it when it doesn't exist yet, returning
/// whether this call noted it. Called with the connect lock held. A failure only means
/// an emptied file stays later.
fn note_missing_rule_file(support: &Path, file: &Path) -> bool {
    let metadata = fs::symlink_metadata(file).ok();
    let missing = metadata.is_none();
    let empty_mdc = file.extension().is_some_and(|e| e == "mdc")
        && metadata.is_some_and(|m| m.is_file() && m.len() == 0);
    if !missing && !empty_mdc { return false; }
    let mut note = read_json(&support.join(TARGETS)).unwrap_or_else(|| json!({}));
    if !note[TASTE_NEW_KEY].is_array() { note[TASTE_NEW_KEY] = json!([]); }
    let paths = note[TASTE_NEW_KEY].as_array_mut().unwrap();
    let entry = if missing { json!(file) } else { json!({"path": file, "before": ""}) };
    if paths.contains(&entry) { return false; }
    paths.push(entry);
    if let Some(parent) = file.parent().filter(|p| !p.exists()) {
        let entry = json!(parent);
        if !paths.contains(&entry) { paths.push(entry); }
    }
    publish(support, TARGETS, &note).is_ok()
}

fn rule_path(entry: &Value) -> Option<PathBuf> {
    entry.as_str().or_else(|| entry["path"].as_str()).map(PathBuf::from)
}

/// A failed connect that never wrote the rule file leaves no file to clean up.
fn forget_missing_rule_file(support: &Path, file: &Path) {
    let mut note = read_json(&support.join(TARGETS)).unwrap_or_else(|| json!({}));
    if let Some(paths) = note[TASTE_NEW_KEY].as_array_mut() {
        paths.retain(|entry| rule_path(entry).as_deref() != Some(file));
        let _ = publish(support, TARGETS, &note);
    }
}

/// Restore empty baselines, then delete created empty files and directories, deepest first.
/// Edited files and nonempty directories stay recorded for a later disconnect.
fn cleanup_rule_paths(support: &Path, mut paths: Vec<Value>) -> Result<()> {
    paths.sort_by_key(|entry| std::cmp::Reverse(rule_path(entry).map(|p| p.components().count())));
    let mut kept = Vec::new();
    for entry in paths {
        let Some(path) = rule_path(&entry) else { kept.push(entry); continue };
        let Ok(metadata) = fs::symlink_metadata(&path) else { continue };
        let removed = if metadata.is_dir() {
            fs::remove_dir(&path).is_ok()
        } else if metadata.is_file() {
            let empty = fs::read_to_string(&path).is_ok_and(|t| t.is_empty()
                || (path.extension().is_some_and(|e| e == "mdc") && t == agent_block::MDC_HEADER));
            empty && if let Some(before) = entry["before"].as_str() {
                fs::write(&path, before).is_ok()
            } else {
                fs::remove_file(&path).is_ok()
            }
        } else { false };
        if !removed { kept.push(entry); }
    }
    let mut note = read_json(&support.join(TARGETS)).unwrap_or_else(|| json!({}));
    if note[TASTE_NEW_KEY] != json!(kept) {
        note[TASTE_NEW_KEY] = json!(kept);
        publish(support, TARGETS, &note)?;
    }
    Ok(())
}

/// The agent's user-level rule file in this config folder, the one the Impeccable block
/// lives in: Codex's AGENTS.override.md when there is one, since Codex then reads it
/// instead of AGENTS.md.
fn rule_file(harness: &str, root: &Path) -> PathBuf {
    description(harness).unwrap().rule_file(root)
}

fn tilde(home: &Path, path: &Path) -> String {
    path.strip_prefix(home)
        .map_or_else(|_| path.display().to_string(), |rest| format!("~/{}", rest.display()))
}

/// The rule files of `agents` that are connected: an agent counts when the engine
/// holds a committed installation for its config folder.
fn taste_targets(io: &Io, home: &Path, agents: &[String]) -> Vec<PathBuf> {
    let installed = installed_specs(OWNER).map(|f| f.committed).unwrap_or_default();
    AGENTS
        .iter()
        .filter(|d| agents.iter().any(|a| a == d.harness))
        .filter_map(|d| agent(io, home, d.harness))
        .filter(|a| installed.iter().any(|s| s.harness == a.harness && s.root == a.root))
        .filter(|a| a.description.writes_rule(&a.root))
        .map(|a| rule_file(a.harness, &a.root))
        .collect()
}

fn row(file: &Path, result: &str) -> Value {
    json!({ "file": file.display().to_string(), "result": result })
}

/// After a connect: keep the taste block where the person said yes, and ask once (or
/// follow the flag) for the rule files never asked about. A block the person deleted by
/// hand is not put back unless they pass `--taste`; `--no-taste` takes it out. Returns
/// the report lines and one JSON row per rule file changed or asked about.
pub(crate) fn offer_taste(io: &mut Io, agents: &[String], choice: Taste) -> (String, Vec<Value>) {
    use std::io::IsTerminal;
    let (mut out, mut rows) = (String::new(), Vec::new());
    let Ok(home) = home(io) else { return (out, rows) };
    let Ok(support) = support_dir(&home) else { return (out, rows) };
    let targets = taste_targets(io, &home, agents);
    if targets.is_empty() {
        return (out, rows);
    }
    let note = read_json(&support.join(TARGETS)).unwrap_or_else(|| json!({}));
    let answered = |f: &Path| note[TASTE_KEY][f.display().to_string()].is_string();
    let (present, absent): (Vec<PathBuf>, Vec<PathBuf>) =
        targets.into_iter().partition(|f| agent_block::present(f, "taste"));
    // Asked about: files with no answer yet, and with --taste every file without the block.
    let ask: Vec<PathBuf> = absent
        .into_iter()
        .filter(|f| choice == Taste::Yes || !answered(f))
        .collect();
    let yes = match choice {
        _ if ask.is_empty() => None,
        Taste::Yes => Some(true),
        Taste::No => Some(false),
        Taste::Ask if io.stdin_is_tty && std::io::stdout().is_terminal() => {
            let files: Vec<String> = ask.iter().map(|f| tilde(&home, f)).collect();
            io.out(&format!(
                "Let your agents use your Impeccable taste? This adds a line to {}. [Y/n] ",
                files.join(" and ")
            ));
            let _ = std::io::Write::flush(&mut io.stdout);
            let mut line = String::new();
            Some(
                std::io::stdin()
                    .read_line(&mut line)
                    .is_ok_and(|n| yes_answer(n, &line)),
            )
        }
        Taste::Ask | Taste::Skip => None,
    };
    // The answer was taken without the lock; the files and the note change under it.
    let _lock = match lock(&support) {
        Ok(l) => l,
        Err(e) => {
            if yes.is_some() || !present.is_empty() {
                out.push_str(&format!("Taste: nothing changed: {e}\n"));
            }
            return (out, rows);
        }
    };
    // A disconnect or another connect may have run while the person was answering, so
    // the files are looked at again now: only agents still connected are touched, a
    // block taken out meanwhile is not put back, and the answer covers only the files
    // it was asked about.
    let asked = ask;
    let mut note = read_json(&support.join(TARGETS)).unwrap_or_else(|| json!({}));
    let answered = |f: &Path| note[TASTE_KEY][f.display().to_string()].is_string();
    let (present, absent): (Vec<PathBuf>, Vec<PathBuf>) = taste_targets(io, &home, agents)
        .into_iter()
        .partition(|f| agent_block::present(f, "taste"));
    let ask: Vec<PathBuf> = absent
        .into_iter()
        .filter(|f| asked.contains(f) && (choice == Taste::Yes || !answered(f)))
        .collect();
    if !note[TASTE_KEY].is_object() {
        note[TASTE_KEY] = json!({});
    }
    let before = note[TASTE_KEY].clone();
    let mut record = |file: &Path, answer: &str| {
        note[TASTE_KEY][file.display().to_string()] = json!(answer);
    };
    for file in &present {
        let shown = tilde(&home, file);
        if choice == Taste::No {
            match agent_block::set(file, "taste", false) {
                Ok(_) => {
                    record(file, "off");
                    out.push_str(&format!("Taste: removed from {shown}.\n"));
                    rows.push(row(file, "removed"));
                }
                Err(e) => {
                    out.push_str(&format!("Taste: left in {shown}: {e}\n"));
                    rows.push(json!({ "file": file.display().to_string(), "result": "failed", "error": e }));
                }
            }
            continue;
        }
        // Rewritten in place, so a block from an older wording is brought up to date.
        match agent_block::set(file, "taste", true) {
            Ok(changed) => {
                record(file, "on");
                if changed {
                    rows.push(row(file, "updated"));
                }
            }
            Err(e) => {
                out.push_str(&format!("Taste: couldn't update {shown}: {e}\n"));
                rows.push(json!({ "file": file.display().to_string(), "result": "failed", "error": e }));
            }
        }
    }
    for file in &ask {
        let shown = tilde(&home, file);
        match yes {
            Some(true) => match agent_block::set(file, "taste", true) {
                Ok(_) => {
                    record(file, "on");
                    out.push_str(&format!("Taste: added to {shown}.\n"));
                    rows.push(row(file, "added"));
                }
                Err(e) => {
                    out.push_str(&format!("Taste: not added to {shown}: {e}\n"));
                    rows.push(json!({ "file": file.display().to_string(), "result": "failed", "error": e }));
                }
            },
            Some(false) => {
                record(file, "off");
                rows.push(row(file, "declined"));
            }
            None => rows.push(row(file, "skipped")),
        }
    }
    if yes.is_none() && !ask.is_empty() {
        out.push_str("To let your agents use your Impeccable taste: impeccable loop connect --taste\n");
    }
    if note[TASTE_KEY] != before {
        if let Err(e) = publish(&support, TARGETS, &note) {
            out.push_str(&format!("Taste: couldn't record your answer: {e}\n"));
            rows.push(json!({
                "file": support.join(TARGETS).display().to_string(),
                "result": "failed",
                "error": format!("couldn't record your answer: {e}"),
            }));
        }
    }
    (out, rows)
}

fn yes_answer(bytes_read: usize, line: &str) -> bool {
    bytes_read > 0 && matches!(line.trim().to_ascii_lowercase().as_str(), "" | "y" | "yes")
}

/// Disconnect: take the taste block out of every rule file connect put it in, and of
/// the rule files of the installations being removed, then forget the answers so a
/// later connect asks again. An answer whose file could not be changed is kept, so the
/// next disconnect tries that file again. Called with the connect lock held. Returns
/// whether all taste blocks were removed.
fn remove_taste(
    home: &Path,
    support: &Path,
    specs: &[&Spec],
    out: &mut String,
) -> bool {
    let mut note = read_json(&support.join(TARGETS)).unwrap_or_else(|| json!({}));
    let answers = note[TASTE_KEY].as_object().cloned().unwrap_or_default();
    let mut files: Vec<PathBuf> = answers.keys().map(PathBuf::from).collect();
    for spec in specs {
        let file = rule_file(&spec.harness, &spec.root);
        if !files.contains(&file) {
            files.push(file);
        }
    }
    let mut ok = true;
    let mut kept = serde_json::Map::new();
    for file in &files {
        let key = file.display().to_string();
        match agent_block::set(file, "taste", false) {
            Ok(taken) => {
                if taken {
                    out.push_str(&format!("  Removed the taste lines from {}.\n", tilde(home, file)));
                }
            }
            Err(e) => {
                ok = false;
                out.push_str(&format!(
                    "  The taste lines in {} were left in place: {e}\n",
                    tilde(home, file)
                ));
                if let Some(answer) = answers.get(&key) {
                    kept.insert(key.clone(), answer.clone());
                }
            }
        }
    }
    if kept != answers {
        note[TASTE_KEY] = Value::Object(kept);
        if let Err(e) = publish(support, TARGETS, &note) {
            ok = false;
            out.push_str(&format!("  Couldn't forget the taste answers: {e}\n"));
        }
    }
    ok
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_failed_connect_puts_the_record_back_as_it_was() {
        // Catches (#1389 review): a failed first connect left `enabled: true`, so Loop
        // kept waking an agent that wasn't connected.
        let dir = std::env::temp_dir().join(format!("loop-record-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let record = dir.join("claude-install.json");
        let earlier = b"{\"enabled\":true,\"accounts\":[\"/a\"]}\n";
        fs::write(&record, earlier).unwrap();
        publish(
            &dir,
            "claude-install.json",
            &json!({"enabled": true, "accounts": ["/a", "/b"]}),
        )
        .unwrap();
        restore_record(&dir, "claude", Some(earlier)).unwrap();
        assert_eq!(fs::read(&record).unwrap(), earlier);
        restore_record(&dir, "claude", None).unwrap();
        assert!(!record.exists(), "no earlier record: none is left behind");
        restore_record(&dir, "claude", None).unwrap();
        let _ = fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod mcp_url_tests {
    use super::*;

    #[test]
    fn a_shipped_build_ignores_the_mcp_override() {
        // Catches: a variable redirecting a customer's agents to another MCP server.
        let mut env = std::collections::HashMap::new();
        env.insert("IMPECCABLE_MCP_URL".to_string(), "https://evil.example/mcp".to_string());
        let (io, _) = Io::captured("", std::env::temp_dir(), env);
        assert!(init_mcp_url(&io).is_ok());
        #[cfg(not(feature = "test-mcp-url"))]
        assert_eq!(mcp_url(), "https://api.impeccable.style/mcp");
        #[cfg(feature = "test-mcp-url")]
        assert_eq!(mcp_url(), "https://evil.example/mcp");
    }

    #[test]
    fn the_account_service_picks_its_own_mcp_server_and_nothing_else() {
        // Catches: IMPECCABLE_ACCOUNT_URL writing another server into an agent's global
        // config, or falling back to production for a run aimed elsewhere.
        assert_eq!(mcp_for_account(None), Ok("https://api.impeccable.style/mcp"));
        assert_eq!(mcp_for_account(Some(" ")), Ok("https://api.impeccable.style/mcp"));
        assert_eq!(mcp_for_account(Some("https://api.impeccable.style/")), Ok("https://api.impeccable.style/mcp"));
        assert_eq!(mcp_for_account(Some("https://API.staging.impeccable.style")), Ok("https://api.staging.impeccable.style/mcp"));
        for other in ["https://evil.example", "https://api.impeccable.style.evil.test", "http://127.0.0.1:8787", "https://impeccable.style", "not a url"] {
            assert!(mcp_for_account(Some(other)).is_err(), "{other}");
        }
    }

    #[test]
    fn each_call_takes_its_own_account_server() {
        // Catches (#1464 review): the first call's server sticking for the process, so a
        // later production call in it writes staging (or the reverse).
        let io_for = |account: Option<&str>| {
            let mut env = std::collections::HashMap::new();
            if let Some(a) = account {
                env.insert("IMPECCABLE_ACCOUNT_URL".to_string(), a.to_string());
            }
            Io::captured("", std::env::temp_dir(), env).0
        };
        assert!(init_mcp_url(&io_for(Some("https://api.staging.impeccable.style"))).is_ok());
        #[cfg(not(feature = "test-mcp-url"))]
        assert_eq!(mcp_url(), STAGING_MCP_URL);
        assert!(init_mcp_url(&io_for(None)).is_ok());
        #[cfg(not(feature = "test-mcp-url"))]
        assert_eq!(mcp_url(), MCP_URL);
        // A refused account leaves no earlier server behind.
        assert!(init_mcp_url(&io_for(Some("https://api.staging.impeccable.style"))).is_ok());
        assert!(init_mcp_url(&io_for(Some("https://evil.example"))).is_err());
        #[cfg(not(feature = "test-mcp-url"))]
        assert_eq!(mcp_url(), MCP_URL);
    }

    #[test]
    fn a_test_build_refuses_an_unusable_override_instead_of_using_production() {
        // Catches (#1403 review): an empty, http:// or padded IMPECCABLE_MCP_URL silently
        // registering production in a staging run.
        for bad in ["", "http://staging.example/mcp", " https://staging.example/mcp", "https://staging.example/mcp "] {
            let mut env = std::collections::HashMap::new();
            env.insert("IMPECCABLE_MCP_URL".to_string(), bad.to_string());
            let (io, _) = Io::captured("", std::env::temp_dir(), env);
            #[cfg(feature = "test-mcp-url")]
            assert!(init_mcp_url(&io).is_err(), "{bad:?}");
            #[cfg(not(feature = "test-mcp-url"))]
            assert!(init_mcp_url(&io).is_ok(), "{bad:?}");
        }
        // A local stack's http server on this machine is usable in a test build, `api.localhost` included (j9).
        for good in ["http://127.0.0.1:8787/mcp", "http://localhost:8787/mcp", "http://api.localhost:8787/mcp", "https://staging.example/mcp"] {
            let mut env = std::collections::HashMap::new();
            env.insert("IMPECCABLE_MCP_URL".to_string(), good.to_string());
            let (io, _) = Io::captured("", std::env::temp_dir(), env);
            assert!(init_mcp_url(&io).is_ok(), "{good:?}");
        }
        #[cfg(feature = "test-mcp-url")]
        for bad in ["http://127.0.0.1.evil.test/mcp", "http://localhost.evil.test/mcp", "http://192.168.1.2/mcp"] {
            let mut env = std::collections::HashMap::new();
            env.insert("IMPECCABLE_MCP_URL".to_string(), bad.to_string());
            let (io, _) = Io::captured("", std::env::temp_dir(), env);
            assert!(init_mcp_url(&io).is_err(), "{bad:?}");
        }
    }
}
