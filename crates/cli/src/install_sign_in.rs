//! The end of `impeccable install` on a terminal: once the skills are in, offer the
//! sign-in, and after a fresh one set up what the plan includes. That covers the MCP
//! server for each coding agent, the repository's first scan and, from Pro up on a Mac,
//! Impeccable Loop. Each part is the verb that already does it; this only offers and
//! sequences them.
//!
//! Nothing here runs for `install -y`, outside a terminal, in CI, against production
//! before launch, or when a sign-in is already stored, so scripted installs and reruns
//! are what they were.
use impeccable_common::Io;
use std::io::Write;

const OFFER: &str =
    "\nSign in to keep your critiques and audits in your Impeccable account and see this
repository on your Home. With Pro, the detector catches more and Loop collects
your agents' questions. No account yet? Signing in creates one.
";

/// Impeccable hasn't launched: until it does, the offer shows only when the CLI points
/// at another account service (staging or a local stack). The launch release sets this.
const OFFERED_ON_PRODUCTION: bool = false;

/// Whether install's end may offer the sign-in, before the stored one is read: that
/// read can raise a Keychain prompt, which a scripted or CI install must never see.
fn offered(args: &[String], terminal: bool, ci: bool, production: bool) -> bool {
    let scripted = args
        .iter()
        .any(|a| matches!(a.as_str(), "-y" | "--yes" | "-h" | "--help"));
    terminal && !ci && !scripted && (OFFERED_ON_PRODUCTION || !production)
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
    let production = impeccable_account::config::Account::from_env(&io.env)
        .ok()
        .is_none_or(|a| a.issuer == impeccable_account::config::DEFAULT_ACCOUNT_URL);
    if !offered(args, terminal, io.env_truthy("CI"), production)
        || impeccable_account::has_sign_in(io)
    {
        return;
    }
    io.err(OFFER);
    if !ask(io, "Sign in now?") {
        io.err("Later: impeccable login\n");
        return;
    }
    let impeccable_account::LoginOutcome::SignedIn(account) =
        impeccable_account::login_after_install(io)
    else {
        // Declined, timed out or refused: the sign-in said why. The skills are installed.
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
        if ask(io, "Install Loop?") {
            crate::loop_install::run(&["install".into(), "--connect".into()], io);
        } else {
            io.err("Later: impeccable loop install\n");
        }
    } else {
        // Loop already here: offer to connect the agents it doesn't have yet.
        crate::loop_install::after_login(io);
    }
    // Read after the steps above, so the lines include what they just connected.
    if let Some(v) = impeccable_account::setup_status::read_for(io, &account) {
        impeccable_account::setup_status::print(io, &v);
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

    // Catches the offer reaching a scripted, CI or non-terminal install, or production
    // before launch.
    #[test]
    fn offers_the_sign_in_only_to_a_person_not_signed_in() {
        let args = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        for (flags, terminal, ci, production, want) in [
            (&[][..], true, false, false, true),
            (&[][..], true, false, true, OFFERED_ON_PRODUCTION),
            (&["-y"][..], true, false, false, false),
            (&["--yes"][..], true, false, false, false),
            (&["--help"][..], true, false, false, false),
            (&[][..], false, false, false, false),
            (&[][..], true, true, false, false),
        ] {
            assert_eq!(
                offered(&args(flags), terminal, ci, production),
                want,
                "{flags:?} {terminal} {ci} {production}"
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
