use crate::font_render;
use crate::VERSION;
use impeccable_common::Io;

/// Build-time composition of native scan hooks.
pub type InstalledPack =
    impeccable_core::rule_pack::RulePackSet<dyn impeccable_html::StaticRulePack>;

/// Route a CLI invocation using this build's hooks. Callers own stream flushing
/// and process exit; registry registration is process-wide and idempotent.
pub fn run(args: &[String], io: &mut Io, pack: InstalledPack) -> i32 {
    pack.install();
    let html = impeccable_html::StaticHtmlEngine {
        static_rule_pack: pack.static_rule_pack,
    };
    let engines = impeccable_detect::Engines {
        html: &html,
        url: Some(url_engine()),
    };
    // cli/bin/cli.js dispatch: help / version / detect / ignores / skills verbs
    let Some(verb) = args.first().map(String::as_str) else {
        io.out(impeccable_detect::ROOT_USAGE);
        return 0;
    };
    let rest = &args[1..];
    // Chrome starts the binary as the Impeccable extension's native-messaging host, its origin first (REN-2053).
    if impeccable_mcp::browser::is_extension_origin(verb) {
        return impeccable_mcp::native_host(args, io);
    }
    // A small allowlist excludes every hook and internal verb. All I/O beyond
    // the cheap daily gate belongs to a detached process.
    if matches!(
        verb,
        "context"
            | "detect"
            | "doctor"
            | "whoami"
            | "agents"
            | "skills"
            | "install"
            | "update"
            | "check"
    ) {
        crate::setup_report::schedule(io);
        crate::setup_report::schedule_taste(io);
        if verb == "context" {
            crate::switch_sync::schedule(io);
        }
    }
    match verb {
        "--help" | "-h" => {
            io.out(impeccable_detect::ROOT_USAGE);
            0
        }
        "--version" | "-v" => {
            // The installed skill's version, the number `npx impeccable update` moves;
            // the npm shim answers --version itself, so this reaches direct runs only.
            let cwd = io.cwd.to_string_lossy().into_owned();
            let version = impeccable_context::context_cli::installed_skill_version(&io.env, &cwd)
                .unwrap_or_else(|| format!("{VERSION}+engine"));
            io.out(&format!("{version}\n"));
            0
        }
        // Launcher handshake: a cheap discriminator so the launchers can tell
        // this engine apart from the retired 3.x npm CLI (which answers any
        // unknown verb with `Unknown command`, exit 1) before exec'ing a
        // candidate found on PATH or in the unversioned user cache. Kept out
        // of --help on purpose; not part of the user-facing contract.
        "engine-probe" => {
            io.out(&format!("impeccable-engine {VERSION}\n"));
            0
        }
        "motion-capture" => impeccable_browser::motion::run(rest, io),
        "detect" => detect(rest, io, &engines, pack.rule_pack),
        "foundations" => crate::foundations::run(rest, io, &engines, pack.rule_pack),
        "ignores" | "ignore" => impeccable_detect::run_ignores(rest, io),
        // Account sign-in. These never dispatch to the Pro engine.
        "login" => {
            let code = impeccable_account::run_login(rest, io);
            // Help exits 0 too; only a finished sign-in earns the follow-ups.
            let help = rest.iter().any(|a| a == "--help" || a == "-h");
            if code == 0 && !help {
                crate::setup_report::schedule(io);
                scan_after_login(io, &engines, pack.rule_pack);
                crate::loop_install::after_login(io);
                sign_in_summary(io);
            }
            code
        }
        "setup" => impeccable_account::setup::run(rest, io),
        "setup-report" => crate::setup_report::run(io),
        "logout" => impeccable_account::run_logout(rest, io),
        "whoami" => impeccable_account::run_whoami(rest, io),
        "status" => {
            // What the Impeccable block holds in each agent's rule file (REN-2056), read here.
            impeccable_account::setup_status::run_with(rest, io, &|io| {
                format!("Impeccable lines in your agents' rule files:\n{}", crate::agent_block::listing(io))
            })
        }
        "taste-refresh" => impeccable_account::taste::run_refresh(rest, io),
        "world" => impeccable_account::world::run(rest, io),
        "critiques-refresh" => impeccable_account::critiques::run_refresh(rest, io),
        "critiques" => impeccable_account::critiques::run(rest, io),
        "health" => impeccable_account::health::run(rest, io),
        "health-design-refresh" => impeccable_account::health::run_design_refresh(rest, io),
        // Background Pro renewal (pro dispatch spawns it). Not in --help.
        "pro-refresh" => impeccable_account::pro::run_refresh(rest, io),
        "skills" => {
            let code = impeccable_skills::run(rest, io);
            // The launcher finds the newest engine itself, so only install registers it, never update.
            if code == 0 && rest.first().map(String::as_str) == Some("install") {
                register_browser_host(&rest[1..], io);
            }
            code
        }
        "loop" => crate::loop_install::run(rest, io),
        "switches" => crate::agent_block::run(rest, io),
        "switches-refresh" => crate::switch_sync::run_refresh(rest, io),
        "walkthrough" => crate::walkthrough::run(rest, io),
        // The one MCP server an agent runs, over stdio (REN-2053). Never schedules a report: it serves for the agent's whole session.
        "mcp" => impeccable_mcp::run(rest, io),
        // `running` lists the agent sessions running now (REN-2124), beside the engine's own protocol verbs.
        "agents" => match rest.split_first() {
            Some((sub, more)) if sub == "running" => impeccable_mcp::presence::run(more, io),
            _ => impeccable_agents::run(rest, io),
        },
        "install" => {
            let code = impeccable_skills::run(args, io);
            // Install ends by offering the sign-in, or naming it when an agent ran it (`crate::install_sign_in`).
            if code == 0 {
                register_browser_host(rest, io);
                crate::install_sign_in::after_install(rest, io, &engines, pack.rule_pack);
            }
            code
        }
        "help" | "link" | "update" | "check" => impeccable_skills::run(args, io),
        // skill scripts
        "context" => {
            let code = impeccable_hook::run_context(rest, io);
            // init's sign-in line reads this, so a signed-out first run costs the agent no
            // extra call. The stored state only: a context run never meets a Keychain prompt.
            if code == 0 && !rest.iter().any(|a| a == "-h" || a == "--help") {
                io.out(if impeccable_account::sign_in_recorded(io) { "ACCOUNT: signed in\n" } else { "ACCOUNT: not signed in\n" });
            }
            code
        }
        "pin" => impeccable_context::run_pin(rest, io),
        "detect-csp" => impeccable_context::run_detect_csp(rest, io),
        "palette" => impeccable_context::run_palette(rest, io),
        "surface-brief" => impeccable_context::run_surface_brief(rest, io),
        "critique-storage" => {
            let mut saved = None;
            let code = impeccable_context::critique_storage::run_with_saved(rest, io, &mut |s| {
                saved = Some(s)
            });
            if let Some(snapshot) = saved {
                let quiet = rest
                    .iter()
                    .any(|a| matches!(a.as_str(), "--quiet" | "--json" | "-json" | "--github"));
                impeccable_account::critiques::after_save(io, &snapshot, impeccable_account::critiques::Report::Critique, quiet);
            }
            code
        }
        "audit-storage" => {
            let mut saved = None;
            let code = impeccable_context::critique_storage::run_audit_with_saved(rest, io, &mut |s| {
                saved = Some(s)
            });
            if let Some(snapshot) = saved {
                let quiet = rest.iter().any(|a| matches!(a.as_str(), "--quiet" | "--json"));
                impeccable_account::critiques::after_save(io, &snapshot, impeccable_account::critiques::Report::Audit, quiet);
            }
            code
        }
        "embed-prompt" => impeccable_context::run_embed_prompt(rest, io),
        "signals" | "context-signals" => impeccable_context::run_signals(rest, io),
        "doctor" => impeccable_context::run_doctor(rest, io),
        "design-compact" => impeccable_context::run_design_compact(rest, io),
        "design-lookup" => impeccable_context::run_design_lookup(rest, io),
        "font-fetch" => impeccable_context::run_font_fetch(rest, io),
        "concept-seed" => impeccable_context::run_concept_seed(rest, io),
        "telemetry" => impeccable_context::run_telemetry(rest, io),
        "generate-image" => impeccable_context::run_generate_image(rest, io),
        "serve-question" => impeccable_context::run_serve_question(rest, io),
        "component-review" => impeccable_context::component_review::run_with_capturer(
            rest,
            io,
            Some(&mut crate::component_capture::NativeComponentCapturer),
        ),
        // comp-fidelity verbs (crates/comp-verbs over crates/comp)
        "first-viewport" => crate::first_viewport::run(rest, io),
        "shot" => crate::shot::run(rest, io),
        "comp-spec" => impeccable_comp_verbs::run_comp_spec(rest, io),
        "comp-diff" => impeccable_comp_verbs::run_comp_diff(rest, io),
        "font-match" => {
            let mut renderer = font_render::CdpFontRenderer::from_process_env();
            impeccable_comp_verbs::run_font_match(rest, io, &mut renderer)
        }
        "capture-server" => match crate::capture_service::serve(rest) {
            Ok(()) => 0,
            Err(e) => {
                io.err(&format!("Native capture service: {e}\n"));
                1
            }
        },
        "build-phase" => {
            // Inject the organic-clip-path CSS scanner (a rule that lives in the
            // closed `core` crate) so comp-verbs stays core-free.
            let organic = |html: &str| -> Vec<(Option<String>, String)> {
                impeccable_core::checks::css_scan::scan_css_text_for_organic_clip_path(html)
                    .into_iter()
                    .map(|f| (f.selector, f.snippet))
                    .collect()
            };
            match crate::capture_service::RemoteEntryRenderer::from_env(&io.env) {
                Ok(Some(renderer)) => impeccable_comp_verbs::build_phase::run_with_renderer(
                    rest,
                    io,
                    &organic,
                    Some(&renderer),
                ),
                Ok(None) => {
                    let renderer = crate::reviewed_entry::ReviewedEntryRenderer::local(
                        &io.cwd,
                        io.home().as_deref(),
                    );
                    impeccable_comp_verbs::build_phase::run_with_renderer(
                        rest,
                        io,
                        &organic,
                        Some(&renderer),
                    )
                }
                Err(e) => {
                    io.err(&format!("Native capture service: {e}\n"));
                    1
                }
            }
        }
        "hook" => impeccable_hook::run_hook_with_pack(rest, io, engines.html, pack.rule_pack),
        "hook-before-edit" => {
            impeccable_hook::run_hook_before_edit_with_pack(rest, io, engines.html, pack.rule_pack)
        }
        "hooks" | "hook-admin" => impeccable_hook::run_hook_admin(rest, io),
        // A successful variant accept records the prototyping session (REN-1917), after its result is out.
        v if v.starts_with("live") => impeccable_live::run_with_accepted(v, rest, io, &mut |io, a| {
            impeccable_account::prototypes::after_accept(io, &a.session_id, &a.root, &a.target, a.variants, (&a.accepted_at, a.accepted_ms))
        }),
        // `npx impeccable src/` shorthand: a path-shaped, flag, URL, or existing
        // first arg is a detect target (cli.js looksLikeDetectTarget).
        v if impeccable_detect::looks_like_detect_target(v, &io.cwd.to_string_lossy()) => {
            detect(args, io, &engines, pack.rule_pack)
        }
        "init" => {
            io.err(impeccable_detect::INIT_MESSAGE);
            1
        }
        other => {
            io.err(&format!(
                "Unknown command: \"{other}\"\n\nTo see a list of supported commands, run:\n  impeccable --help\n"
            ));
            1
        }
    }
}

/// `detect`, then design health's upload of a full scan once the output is
/// out (`impeccable_account::health`: it never changes the output or the
/// exit code). Hook scans don't come through here.
fn detect(
    args: &[String],
    io: &mut Io,
    engines: &impeccable_detect::Engines,
    rule_pack: Option<&'static dyn impeccable_core::rule_pack::RulePack>,
) -> i32 {
    use std::io::Write;
    // Most runs can't upload (not signed in, CI, opted out): those don't
    // pay for a report.
    if !impeccable_account::health::wanted(io) {
        return impeccable_detect::cli::run_detect_with_pack(args, io, engines, rule_pack);
    }
    let started = std::time::SystemTime::now();
    let mut report = None;
    let code =
        impeccable_detect::cli::run_detect_reporting(args, io, engines, rule_pack, &mut report);
    if let Some(full) = report {
        let _ = io.stdout.flush();
        let _ = io.stderr.flush();
        let foundations = crate::foundations::from_scan(
            &full.root,
            &full,
            impeccable_account::health::foundations_wanted(io),
        );
        let scan = health_scan(full, foundations, started);
        let quiet = args
            .iter()
            .any(|a| matches!(a.as_str(), "--quiet" | "--json" | "-json" | "--github"));
        impeccable_account::health::after_scan(io, &scan, quiet);
    }
    code
}

/// Right after a sign-in, once per repository from this machine: the full
/// scan and upload a signed-in `impeccable detect` makes, so the repository
/// is in the person's account at once (its foundations upload founds a Pro
/// or Team city). Only the local detector runs; the person sees one line,
/// and nothing here changes the sign-in's exit code.
pub(crate) fn scan_after_login(
    io: &mut Io,
    engines: &impeccable_detect::Engines,
    rule_pack: Option<&'static dyn impeccable_core::rule_pack::RulePack>,
) -> &'static str {
    use impeccable_account::health;
    use std::io::Write;
    // CI, sync turned off, or a grant that can't record a repository: say
    // nothing. A telemetry opt-out doesn't stop it: signing in is the consent.
    if !health::wanted_at_sign_in(io) || !health::can_record(io) {
        return "skipped";
    }
    let cwd = io.cwd.display().to_string();
    let root = match health::repo_top_in_time(&cwd) {
        Ok(Some(root)) => root,
        Ok(None) => {
            io.err("Not in a repository, so nothing was scanned. Run impeccable detect in one to add it to your account.\n");
            return "skipped";
        }
        Err(()) => {
            io.err("Git didn't answer in time, so nothing was scanned. Run impeccable detect here to add this repository to your account.\n");
            return "skipped";
        }
    };
    if health::first_scan_done(&io.env, &root) {
        return "already";
    }
    // A person at a terminal watches it scan in place (impeccable_common::steps); anything else gets the plain lines.
    let steps = impeccable_common::steps::Steps::new(io);
    let scanning = match &steps {
        Some(steps) => Some(steps.progress(io, "Scanning this repository (Ctrl-C skips it)")),
        None => {
            io.err("\nScanning this repository for your account (Ctrl-C skips it)...\n");
            None
        }
    };
    let _ = io.stderr.flush();
    let started = std::time::SystemTime::now();
    let mut report = None;
    // The findings stay off the terminal: the line below sums them up.
    let out = std::mem::replace(&mut io.stdout, Box::new(std::io::sink()));
    let err = std::mem::replace(&mut io.stderr, Box::new(std::io::sink()));
    // Scan from the root, as `detect` there would: config, ignores and the
    // design system are read from the working directory, not a subdirectory.
    let cwd = std::mem::replace(&mut io.cwd, std::path::PathBuf::from(&root));
    let args = [root.clone(), "--json".to_string()];
    let _ = impeccable_detect::cli::run_detect_reporting(&args, io, engines, rule_pack, &mut report);
    io.cwd = cwd;
    io.stdout = out;
    io.stderr = err;
    let Some(full) = report else {
        drop(scanning);
        io.err("Couldn't scan this repository. Run impeccable detect here to add it to your account.\n");
        return "failed";
    };
    let (findings, files) = (full.findings.len(), full.files_scanned);
    let foundations = crate::foundations::from_scan(&full.root, &full, health::foundations_wanted(io));
    // Counted as Home counts them, so the two say the same number.
    let to_fix = foundations.values().filter(|s| *s == "failing").count();
    let scan = health_scan(full, foundations, started);
    // What the upload says (the notices) waits under the finished step, so it never breaks the line still drawing.
    let (synced, said) = match &steps {
        Some(steps) => steps.held(io, |io| health::after_sign_in_scan(io, &scan)),
        None => (health::after_sign_in_scan(io, &scan), vec![]),
    };
    let plural = |n: usize, one: &str| {
        if n == 1 {
            format!("1 {one}")
        } else {
            format!("{n} {one}s")
        }
    };
    let mut found = format!("{} in {files} files", plural(findings, "finding"));
    if to_fix > 0 {
        found.push_str(&format!(", {} to fix", plural(to_fix, "foundation")));
    }
    let recorded = synced.recorded();
    if let (Some(steps), Some(scanning)) = (&steps, scanning) {
        let sent = if synced.named { "its name, finding counts" } else { "finding counts" };
        if recorded {
            scanning.done(steps, io, &format!("Added this repository: {found}"), &[&format!("Sent {sent} and foundations checks, never your code or file names.")]);
            steps.details(io, &said);
            match impeccable_account::config::Account::from_env(&io.env).ok().and_then(|a| a.home_url()) {
                Some(url) => steps.link(io, "See it in Foundations:", &format!("{url}/-/foundations")),
                None => steps.details(io, &["Find it under Foundations in your Impeccable account.".to_string()]),
            }
        } else {
            scanning.failed(steps, io, &format!("Scanned this repository ({found})"), &["Couldn't add it to your account just now. Run impeccable detect here to try again."]);
        }
        set_last_scan(found);
        return if recorded { "done" } else { "failed" };
    }
    if recorded {
        // Foundations lists a person's own repositories from any space they're in.
        let find = match impeccable_account::config::Account::from_env(&io.env).ok().and_then(|a| a.home_url()) {
            Some(url) => format!("See it in Foundations:\n{url}/-/foundations"),
            None => "Find it under Foundations in your Impeccable account.".to_string(),
        };
        let sent = if synced.named { "its name, finding counts" } else { "finding counts" };
        io.err(&format!(
            "Added this repository to your account: {found}.\nSent {sent} and foundations checks, never your code or file names.\n{find}\n"
        ));
    } else {
        io.err(&format!(
            "Scanned this repository ({found}), but couldn't add it to your account just now. Run impeccable detect here to try again.\n"
        ));
    }
    if recorded { "done" } else { "failed" }
}

/// A person at a terminal ends a sign-in on one tidy summary of where things stand; anything else ends as before.
pub(crate) fn sign_in_summary(io: &mut Io) {
    let Some(steps) = impeccable_common::steps::Steps::new(io) else {
        return;
    };
    let mut rows = vec![];
    if let Ok(account) = impeccable_account::config::Account::from_env(&io.env) {
        rows.push(("Account", account.display_name()));
    }
    if let Some(found) = last_scan() {
        rows.push(("This repository", found));
    }
    if let Some(said) = crate::loop_install::last_loop() {
        rows.push(("Loop", said));
    }
    steps.summary(io, "You're signed in", &rows);
}

/// What the first scan found, for the closing summary of the sign-in it followed.
static LAST_SCAN: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);
fn set_last_scan(found: String) {
    if let Ok(mut s) = LAST_SCAN.lock() {
        *s = Some(found);
    }
}
pub(crate) fn last_scan() -> Option<String> {
    LAST_SCAN.lock().ok().and_then(|s| s.clone())
}

/// Design health's view of a full scan, with its foundations states.
pub(crate) fn health_scan(
    full: impeccable_detect::cli::FullScan,
    foundations: std::collections::BTreeMap<String, String>,
    started: std::time::SystemTime,
) -> impeccable_account::health::Scan {
    impeccable_account::health::Scan {
        foundations,
        root: full.root,
        files_scanned: full.files_scanned,
        hits: full
            .findings
            .into_iter()
            .map(|f| impeccable_account::health::Hit {
                advisory: f.advisory == Some(true),
                rule: f.antipattern,
                file: f.file,
                snippet: f.snippet,
            })
            .collect(),
        ruleset: full.ruleset,
        engine_version: VERSION.to_string(),
        started,
    }
}

/// Lets Chrome start the browser relay (REN-2053): the launcher and each present browser's host manifest. Install
/// prints what changed; a failure is named and never fails it. `args` are the verb's own: asking for
/// help changes nothing.
fn register_browser_host(args: &[String], io: &mut Io) {
    // CI runs install in throwaway machines: no browser to register with, and no files left behind.
    if io.env.get("CI").is_some_and(|v| !v.is_empty()) || args.iter().any(|a| a == "-h" || a == "--help") {
        return;
    }
    let Some(home) = impeccable_account::config::impeccable_home(&io.env) else { return };
    let user_home = home.parent().map(std::path::Path::to_path_buf).unwrap_or_default();
    let user_home = io.env.get("HOME").filter(|h| !h.is_empty()).map(std::path::PathBuf::from).unwrap_or(user_home);
    let config_home = io.env.get("XDG_CONFIG_HOME").filter(|v| !v.is_empty()).map(std::path::PathBuf::from);
    for line in impeccable_mcp::host_setup::register(&user_home, &home, config_home.as_deref()) {
        let _ = writeln!(io.stdout, "{line}");
    }
}

/// Whether this invocation is a scan the Pro engine may take over: the
/// verbs that run rule packs (`detect`, its path shorthand, and the hooks).
/// `detect --before` / `--kept` run no rules, and a Pro build older than
/// those flags would ignore them and scan instead, so they stay here.
pub fn is_scan(args: &[String], io: &Io) -> bool {
    if args.iter().any(|a| a == "--before" || a == "--kept") {
        return false;
    }
    match args.first().map(String::as_str) {
        Some("detect" | "hook" | "hook-before-edit") => true,
        // Chrome starting the extension's native host: never a path to scan, never through Pro dispatch.
        Some(v) if impeccable_mcp::browser::is_extension_origin(v) => false,
        Some(v) if !KNOWN_VERBS.contains(&v) && !v.starts_with("live") => {
            impeccable_detect::looks_like_detect_target(v, &io.cwd.to_string_lossy())
        }
        _ => false,
    }
}

/// The named verbs `run` matches before the detect shorthand (other than the
/// scan verbs), so a same-named path in the working directory never makes
/// one of them a scan.
const KNOWN_VERBS: &[&str] = &[
    "--help",
    "-h",
    "--version",
    "-v",
    "engine-probe",
    "motion-capture",
    "ignores",
    "ignore",
    "login",
    "logout",
    "whoami",
    "status",
    "world",
    "health",
    "foundations",
    "setup",
    "setup-report",
    "health-design-refresh",
    "critiques",
    "critiques-refresh",
    "taste-refresh",
    "pro-refresh",
    "agents",
    "loop",
    "switches",
    "switches-refresh",
    "walkthrough",
    "mcp",
    "skills",
    "help",
    "install",
    "link",
    "update",
    "check",
    "context",
    "pin",
    "detect-csp",
    "palette",
    "surface-brief",
    "critique-storage",
    "audit-storage",
    "embed-prompt",
    "signals",
    "context-signals",
    "doctor",
    "design-compact",
    "design-lookup",
    "font-fetch",
    "concept-seed",
    "telemetry",
    "generate-image",
    "serve-question",
    "component-review",
    "first-viewport",
    "shot",
    "comp-spec",
    "comp-diff",
    "font-match",
    "capture-server",
    "build-phase",
    "hooks",
    "hook-admin",
    "init",
];

// --- browser engine (crates/browser) -------------------------------------
/// The URL engine, built once from the process environment (browser
/// discovery reads `IMPECCABLE_BROWSER` / `PUPPETEER_EXECUTABLE_PATH` /
/// `CHROME_PATH`, sandbox flags read `CI`).
fn url_engine() -> &'static impeccable_browser::BrowserEngine {
    static ENGINE: std::sync::OnceLock<impeccable_browser::BrowserEngine> =
        std::sync::OnceLock::new();
    ENGINE.get_or_init(impeccable_browser::BrowserEngine::from_process_env)
}
// -------------------------------------------------------------------------

#[cfg(test)]
mod verb_tests {
    #[test]
    fn taste_refresh_is_a_known_internal_verb() {
        assert!(super::KNOWN_VERBS.contains(&"taste-refresh"));
    }

    /// Catches (review, Greptile and Cursor): a verb `run` handles by name but
    /// missing from `KNOWN_VERBS`, so a same-named path in the working
    /// directory sends it through Pro dispatch as if it were a scan.
    #[test]
    fn every_named_verb_is_known_or_a_scan() {
        let src = include_str!("router.rs");
        let body = &src[src.find("pub fn run(").unwrap()..src.find("pub fn is_scan(").unwrap()];
        let mut named = Vec::new();
        for line in body.lines() {
            let line = line.trim_start();
            let Some((arm, _)) = line.split_once("=>") else {
                continue;
            };
            if !arm.starts_with('"') {
                continue;
            }
            named.extend(
                arm.split('|')
                    .map(|v| v.trim().trim_matches('"').to_string()),
            );
        }
        assert!(named.len() > 30, "parsed {named:?}");
        let scans = ["detect", "hook", "hook-before-edit"];
        let missing: Vec<_> = named
            .iter()
            .filter(|v| !scans.contains(&v.as_str()) && !super::KNOWN_VERBS.contains(&v.as_str()))
            .collect();
        assert!(
            missing.is_empty(),
            "verbs run handles but KNOWN_VERBS lacks: {missing:?}"
        );
    }

    /// The wiring check runs no rules, so it never goes to a Pro build that
    /// may predate its flags (#1291).
    #[test]
    fn the_wiring_check_is_not_a_scan() {
        let (io, _) = impeccable_common::Io::captured("", std::env::temp_dir(), Default::default());
        let args = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert!(super::is_scan(&args(&["detect", "page.html"]), &io));
        assert!(!super::is_scan(&args(&["detect", "--before", "page.html"]), &io));
        assert!(!super::is_scan(&args(&["detect", "--kept", "--json", "page.html"]), &io));
        assert!(!super::is_scan(&args(&["--kept", "page.html"]), &io));
    }

    /// Catches asking install or update for help registering a browser host, and CI leaving one behind (#1533).
    #[test]
    fn help_and_ci_register_no_browser_host() {
        let home = std::env::temp_dir().join(format!("imp-router-host-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let launcher = home.join(".impeccable/browser/host");
        let run = |args: &[&str], ci: bool| {
            let mut env: std::collections::HashMap<String, String> = [("HOME".to_string(), home.to_string_lossy().into_owned())].into();
            if ci {
                env.insert("CI".into(), "true".into());
            }
            let (mut io, _) = impeccable_common::Io::captured("", std::env::temp_dir(), env);
            super::register_browser_host(&args.iter().map(|s| s.to_string()).collect::<Vec<_>>(), &mut io);
        };
        // A verified engine in the cache, so only help and CI stand in the way.
        let bin = home.join(".impeccable/bin/1.0.0/impeccable");
        std::fs::create_dir_all(bin.parent().unwrap()).unwrap();
        std::fs::write(&bin, b"#!/bin/sh\n").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(1100));
        std::fs::write(bin.with_file_name("impeccable.verified"), b"abc 10\n").unwrap();
        run(&["--help"], false);
        run(&["-y"], true);
        assert!(!launcher.exists());
        run(&["-y"], false);
        assert_eq!(launcher.exists(), cfg!(unix));
        let _ = std::fs::remove_dir_all(&home);
    }
}
