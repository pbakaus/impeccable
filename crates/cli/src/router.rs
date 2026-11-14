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
        "detect" => detect(rest, io, &engines, pack.rule_pack),
        "foundations" => crate::foundations::run(rest, io, &engines, pack.rule_pack),
        "ignores" | "ignore" => impeccable_detect::run_ignores(rest, io),
        // Account sign-in. These never dispatch to the Pro engine.
        "login" => {
            let code = impeccable_account::run_login(rest, io);
            if code == 0 {
                crate::setup_report::schedule(io);
            }
            code
        }
        "setup" => impeccable_account::setup::run(rest, io),
        "setup-report" => crate::setup_report::run(io),
        "logout" => impeccable_account::run_logout(rest, io),
        "whoami" => impeccable_account::run_whoami(rest, io),
        "taste-refresh" => impeccable_account::taste::run_refresh(rest, io),
        "world" => impeccable_account::world::run(rest, io),
        "critiques-refresh" => impeccable_account::critiques::run_refresh(rest, io),
        "critiques" => impeccable_account::critiques::run(rest, io),
        "health" => impeccable_account::health::run(rest, io),
        "health-design-refresh" => impeccable_account::health::run_design_refresh(rest, io),
        // Background Pro renewal (pro dispatch spawns it). Not in --help.
        "pro-refresh" => impeccable_account::pro::run_refresh(rest, io),
        "skills" => impeccable_skills::run(rest, io),
        "loop" => crate::loop_install::run(rest, io),
        "walkthrough" => crate::walkthrough::run(rest, io),
        "agents" => impeccable_agents::run(rest, io),
        "help" | "install" | "link" | "update" | "check" => impeccable_skills::run(args, io),
        // skill scripts
        "context" => impeccable_hook::run_context(rest, io),
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
                impeccable_account::critiques::after_save(io, &snapshot, quiet);
            }
            code
        }
        "audit-storage" => impeccable_context::run_audit_storage(rest, io),
        "embed-prompt" => impeccable_context::run_embed_prompt(rest, io),
        "signals" | "context-signals" => impeccable_context::run_signals(rest, io),
        "design-sidecar" => impeccable_context::design_sidecar::run(rest, io),
        "doctor" => impeccable_context::run_doctor(rest, io),
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
        v if v.starts_with("live") => impeccable_live::run(v, rest, io),
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

/// Whether this invocation is a scan the Pro engine may take over: the
/// verbs that run rule packs (`detect`, its path shorthand, and the hooks).
pub fn is_scan(args: &[String], io: &Io) -> bool {
    match args.first().map(String::as_str) {
        Some("detect" | "hook" | "hook-before-edit") => true,
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
    "ignores",
    "ignore",
    "login",
    "logout",
    "whoami",
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
    "walkthrough",
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
    "design-sidecar",
    "doctor",
    "concept-seed",
    "telemetry",
    "generate-image",
    "serve-question",
    "component-review",
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
}
