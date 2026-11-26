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
    #[cfg(unix)]
    // SAFETY: tcflush on stdin's descriptor only discards unread terminal input.
    unsafe {
        libc::tcflush(libc::STDIN_FILENO, libc::TCIFLUSH);
    }
    io.err(&format!("{question} [Y/n] "));
    let _ = io.stderr.flush();
    let mut line = String::new();
    std::io::stdin().read_line(&mut line).is_ok_and(|n| {
        n > 0 && matches!(line.trim().to_ascii_lowercase().as_str(), "" | "y" | "yes")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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
