//! The end of `impeccable install` on a terminal: once the skills are in, offer the
//! sign-in, and after a fresh one set up what the plan includes. That covers the MCP
//! server for each coding agent, the repository's first scan and, from Pro up on a Mac,
//! Impeccable Loop. Each part is the verb that already does it; this only offers and
//! sequences them.
//!
//! An install with `-y` or outside a terminal (most are run by a coding agent) ends
//! with one line naming the sign-in instead. Nothing here runs in CI or once a sign-in
//! is stored.
use impeccable_common::Io;
use std::io::Write;

const HINT: &str = "Optional: npx impeccable login keeps your critiques and audits in your Impeccable account. It's free, and creates the account if you're new.\n";

const OFFER: &str =
    "\nSign in to keep your critiques and audits in your Impeccable account and see this
repository on your Home. No account yet? Signing in creates one.
";

#[derive(Debug, PartialEq)]
enum End {
    Nothing,
    /// One line naming the sign-in, for an install nobody is there to answer.
    Hint,
    Offer,
}

/// How install ends, decided before the stored sign-in is read: that read can raise a
/// Keychain prompt, which a scripted or CI install must never see.
fn end(args: &[String], terminal: bool, ci: bool) -> End {
    let has = |flags: [&str; 2]| args.iter().any(|a| flags.contains(&a.as_str()));
    if ci || has(["-h", "--help"]) {
        End::Nothing
    } else if !terminal || has(["-y", "--yes"]) {
        End::Hint
    } else {
        End::Offer
    }
}

/// Whether to offer Loop's install after the sign-in.
fn loop_offered(mac: bool, plan_includes_loop: bool, installed: bool) -> bool {
    mac && plan_includes_loop && !installed
}

pub(crate) fn after_install(
    args: &[String],
    io: &mut Io,
    engines: &impeccable_detect::Engines,
    rule_pack: Option<&'static dyn impeccable_core::rule_pack::RulePack>,
) {
    telemetry_notice(args, io);
    let terminal = io.stdin_is_tty && std::io::IsTerminal::is_terminal(&std::io::stderr());
    match end(args, terminal, io.env_truthy("CI")) {
        End::Nothing => return,
        End::Hint => {
            if !impeccable_account::sign_in_recorded(io) {
                io.err(HINT);
            }
            return;
        }
        End::Offer if impeccable_account::has_sign_in(io) => return,
        End::Offer => {}
    }
    offer_sign_in(io, engines, rule_pack);
}

const TELEMETRY_QUESTION: &str = "Share anonymous usage data?";

/// Asks a person at the terminal, once, whether to share anonymous usage data after
/// install or update, with yes preselected. `-y`, CI and a run with no terminal ask
/// nothing and record nothing, so `context` has the agent mention it instead; so does
/// a cancelled or unclear answer.
pub(crate) fn telemetry_notice(args: &[String], io: &mut Io) {
    use impeccable_context::telemetry;
    let terminal = io.stdin_is_tty && std::io::IsTerminal::is_terminal(&std::io::stderr());
    if end(args, terminal, io.env_truthy("CI")) != End::Offer || telemetry_decided(io) {
        return;
    }
    io.err(&format!("\n{}", telemetry::notice()));
    let on = match impeccable_common::steps::Steps::new(io) {
        Some(mut steps) => {
            let options = [("Yes, keep it on", Some("recommended")), ("No, opt out", None)];
            let Ok(choice) = steps.choose(io, TELEMETRY_QUESTION, &options, 0) else { return };
            choice == 0
        }
        None => {
            let Some(on) = answer(io, TELEMETRY_QUESTION) else { return };
            on
        }
    };
    record_telemetry(io, on);
}

/// Whether the user already answered or opted out, so install never asks twice.
fn telemetry_decided(io: &Io) -> bool {
    use impeccable_context::telemetry;
    telemetry::choice_recorded(&io.env, telemetry::telemetry_disabled(&io.env, &io.cwd.to_string_lossy()))
}

/// Records the answer and says how to change it. When it can't be saved, says so: an
/// opt-out that didn't save leaves telemetry on.
fn record_telemetry(io: &mut Io, on: bool) {
    if let Err(e) = impeccable_context::telemetry::record_choice(&io.env, on, true) {
        io.err(&if on {
            format!("Couldn't save your answer ({e}), so you may be asked again.\n")
        } else {
            format!("Couldn't save your opt-out ({e}), so telemetry is still on. Fix that, then run: npx impeccable telemetry off\n")
        });
        return;
    }
    io.err(if on {
        "Thanks! Change it any time: npx impeccable telemetry off\n"
    } else {
        "Telemetry is off. Turn it back on any time: npx impeccable telemetry on\n"
    });
}

/// The offer prints after install's own "Done!", so its init step is said again,
/// before the setup lines whose `Next:` closes a fresh sign-in.
fn init_next(io: &mut Io) {
    io.err(
        "\nNow type /impeccable init in your AI coding agent's chat to set up design context.\n",
    );
}

fn offer_sign_in(
    io: &mut Io,
    engines: &impeccable_detect::Engines,
    rule_pack: Option<&'static dyn impeccable_core::rule_pack::RulePack>,
) {
    // At a terminal, install's own choice; anything else the plain question.
    let yes = match impeccable_common::steps::Steps::new(io) {
        Some(mut steps) => {
            io.err("\n");
            steps.details(io, &OFFER.trim().lines().map(str::to_string).collect::<Vec<_>>());
            let options = [("Sign in", Some("opens your browser")), ("Not now", Some("later: npx impeccable login"))];
            steps.choose(io, "Sign in now?", &options, 0).unwrap_or(1) == 0
        }
        None => {
            io.err(OFFER);
            ask(io, "Sign in now?")
        }
    };
    if !yes {
        // At a terminal, Done just said the init step; the plain path says it again after its question.
        if impeccable_common::steps::Steps::new(io).is_none() {
            io.err("Later: npx impeccable login\n");
            init_next(io);
        }
        return;
    }
    let impeccable_account::LoginOutcome::SignedIn(account) =
        impeccable_account::login_after_install(io)
    else {
        // Declined, timed out or refused: the sign-in said why. The skills are installed.
        init_next(io);
        return;
    };
    crate::setup_report::schedule(io);

    // The MCP server for each coding agent; an entry already there is kept.
    let (connected, report, _) = crate::loop_connect::connect_mcp(io, None);
    match connected {
        Ok(text) => io.err(&text),
        // No agent on this machine: nothing to rerun, the message says so.
        Err(e) if no_agent_found(&report) => io.err(&format!("{e}\n")),
        Err(e) => io.err(&format!(
            "{e}\nRun impeccable loop connect --mcp-only once that is sorted.\n"
        )),
    }
    crate::router::scan_after_login(io, engines, rule_pack);

    let includes_loop = impeccable_account::setup_status::read_for(io, &account)
        .as_ref()
        .is_some_and(impeccable_account::setup_status::plan_includes_loop);
    let installed = crate::loop_install::installed_app(io).is_some();
    if loop_offered(cfg!(target_os = "macos"), includes_loop, installed) {
        io.err("\nImpeccable Loop is a Mac app that keeps every question your agents ask in one place.\n");
        if offer(io, "Install Loop?", ("Install Loop", "the Mac app, connected to your agents"), "later: impeccable loop install") {
            crate::loop_install::run(&["install".into(), "--connect".into()], io);
        } else if impeccable_common::steps::Steps::new(io).is_none() {
            io.err("Later: impeccable loop install\n");
        }
    } else {
        // Loop already here: offer to connect the agents it doesn't have yet.
        crate::loop_install::after_login(io);
    }
    init_next(io);
    // Read after the steps above, so the lines include what they just connected.
    if let Some(v) = impeccable_account::setup_status::read_for(io, &account) {
        impeccable_account::setup_status::print(io, &v);
    }
    crate::router::sign_in_summary(io);
}

/// A yes/no step: install's own choice at a terminal (Enter takes the first option), the plain `[Y/n]` question elsewhere.
fn offer(io: &mut Io, question: &str, yes: (&str, &str), later: &str) -> bool {
    match impeccable_common::steps::Steps::new(io) {
        Some(mut steps) => steps.choose(io, question, &[(yes.0, Some(yes.1)), ("Not now", Some(later))], 0).unwrap_or(1) == 0,
        None => ask(io, question),
    }
}

/// Whether the MCP step found no coding agent at all, rather than failing on one.
fn no_agent_found(report: &serde_json::Value) -> bool {
    report["agents"]
        .as_array()
        .is_some_and(|rows| !rows.is_empty() && rows.iter().all(|r| r["result"] == "not_found"))
}

/// A yes/no question on stderr; Enter means yes. Keys pressed before the question
/// showed (an extra Enter at install's pickers) are dropped first, so they can't
/// answer it: a yes here signs in or installs an app.
fn ask(io: &mut Io, question: &str) -> bool {
    answer(io, question) == Some(true)
}

/// The `[Y/n]` answer: `Some(true)` for Enter or yes, `Some(false)` for no, `None` for
/// anything else or no input at all.
fn answer(io: &mut Io, question: &str) -> Option<bool> {
    #[cfg(unix)]
    // SAFETY: tcflush on stdin's descriptor only discards unread terminal input.
    unsafe {
        libc::tcflush(libc::STDIN_FILENO, libc::TCIFLUSH);
    }
    io.err(&format!("{question} [Y/n] "));
    let _ = io.stderr.flush();
    let mut line = String::new();
    match std::io::stdin().read_line(&mut line) {
        Ok(n) if n > 0 => match line.trim().to_ascii_lowercase().as_str() {
            "" | "y" | "yes" => Some(true),
            "n" | "no" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Catches the question reaching an install nobody is at, or one that already
    // decided, and an answer that is not recorded or that install would ask again.
    #[test]
    fn install_asks_about_usage_data_once_and_records_the_answer() {
        let home = std::env::temp_dir().join(format!("impeccable-notice-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        std::fs::create_dir_all(&home).unwrap();
        let config = home.join(".impeccable/config.json");
        let io_with = |extra: &[(&str, &str)]| {
            let mut env = std::collections::HashMap::from([("HOME".to_string(), home.to_string_lossy().into_owned()), ("USERPROFILE".to_string(), home.to_string_lossy().into_owned())]);
            env.extend(extra.iter().map(|(k, v)| (k.to_string(), v.to_string())));
            Io::captured("", home.clone(), env)
        };
        let stderr = |cap: &impeccable_common::Captured| String::from_utf8(cap.stderr.borrow().clone()).unwrap();
        // No terminal here (an agent's run): nothing asked, nothing recorded.
        let (mut io, cap) = io_with(&[]);
        telemetry_notice(&[], &mut io);
        assert_eq!(stderr(&cap), "");
        assert!(!config.exists());
        assert!(!telemetry_decided(&io_with(&[]).0));
        assert!(telemetry_decided(&io_with(&[("DO_NOT_TRACK", "1")]).0), "an opt-out is never asked about");
        for (on, said) in [(false, "Telemetry is off."), (true, "Thanks!")] {
            let (mut io, cap) = io_with(&[]);
            record_telemetry(&mut io, on);
            assert!(stderr(&cap).starts_with(said));
            assert_eq!(std::fs::read_to_string(&config).unwrap(), format!("{{\n  \"telemetry\": {on}\n}}\n"));
            assert!(telemetry_decided(&io_with(&[]).0), "never asked twice");
        }
        // An opt-out that can't be saved says so instead of carrying on silently.
        std::fs::write(&config, "not json").unwrap();
        let (mut io, cap) = io_with(&[]);
        record_telemetry(&mut io, false);
        assert!(stderr(&cap).starts_with("Couldn't save your opt-out"), "{}", stderr(&cap));
        assert_eq!(std::fs::read_to_string(&config).unwrap(), "not json");
        let _ = std::fs::remove_dir_all(&home);
    }

    // Catches the offer reaching a scripted, CI or non-terminal install, or the hint
    // missing from an install an agent ran.
    #[test]
    fn offers_the_sign_in_to_a_person_and_names_it_to_an_agent() {
        let args = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        for (flags, terminal, ci, want) in [
            (&[][..], true, false, End::Offer),
            (&["-y"][..], true, false, End::Hint),
            (&["--yes"][..], true, false, End::Hint),
            (&[][..], false, false, End::Hint),
            (&["--help"][..], true, false, End::Nothing),
            (&[][..], true, true, End::Nothing),
            (&["-y"][..], false, true, End::Nothing),
        ] {
            assert_eq!(
                end(&args(flags), terminal, ci),
                want,
                "{flags:?} {terminal} {ci}"
            );
        }
    }

    // Catches the MCP step's rerun hint shown when there is no agent to connect.
    #[test]
    fn tells_apart_no_agent_from_a_failed_connect() {
        let rows = |r: &[&str]| serde_json::json!({ "agents": r.iter().map(|x| serde_json::json!({ "result": x })).collect::<Vec<_>>() });
        assert!(no_agent_found(&rows(&["not_found", "not_found"])));
        assert!(!no_agent_found(&rows(&["not_found", "failed"])));
        assert!(!no_agent_found(&rows(&[])));
    }

    // Catches Loop offered on Free (Loop is Pro and up), off a Mac, or again once installed.
    #[test]
    fn offers_loop_only_from_pro_on_a_mac_without_it() {
        for (mac, includes, installed, want) in [
            (true, true, false, true),
            (true, false, false, false),
            (false, true, false, false),
            (true, true, true, false),
        ] {
            assert_eq!(
                loop_offered(mac, includes, installed),
                want,
                "{mac} {includes} {installed}"
            );
        }
    }
}
