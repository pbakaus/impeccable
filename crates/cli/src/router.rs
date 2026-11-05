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
        "detect" => {
            impeccable_detect::cli::run_detect_with_pack(rest, io, &engines, pack.rule_pack)
        }
        "ignores" | "ignore" => impeccable_detect::run_ignores(rest, io),
        "skills" => impeccable_skills::run(rest, io),
        "help" | "install" | "link" | "update" | "check" => impeccable_skills::run(args, io),
        // skill scripts
        "context" => impeccable_context::run_context(rest, io),
        "pin" => impeccable_context::run_pin(rest, io),
        "detect-csp" => impeccable_context::run_detect_csp(rest, io),
        "palette" => impeccable_context::run_palette(rest, io),
        "surface-brief" => impeccable_context::run_surface_brief(rest, io),
        "critique-storage" => impeccable_context::run_critique_storage(rest, io),
        "embed-prompt" => impeccable_context::run_embed_prompt(rest, io),
        "signals" | "context-signals" => impeccable_context::run_signals(rest, io),
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
            impeccable_detect::cli::run_detect_with_pack(args, io, &engines, pack.rule_pack)
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
