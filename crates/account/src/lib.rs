//! `impeccable login | logout | whoami`: sign in to the Impeccable account
//! service with OAuth (loopback PKCE), and keep the credential lifecycle
//! (storage, lock, generation, logout tombstone). docs/RUNTIME-ENV.md (Account sign-in) has the
//! whole contract. Tokens are never printed or logged.

// Reuse the integration fake issuer in unit tests, including its Pro helpers.
#[cfg(test)]
extern crate self as impeccable_account;
#[cfg(test)]
#[path = "../tests/support/fake.rs"]
mod test_fake;

pub mod config;
pub mod critiques;
mod design_read;
pub mod health;
pub mod http;
pub mod oauth;
pub mod plans;
pub mod prototypes;
pub mod receipt;
pub mod pro;
pub mod session;
pub mod setup;
pub mod setup_status;
mod stale_grant;
pub mod store;
pub mod switches;
pub mod taste;
mod upload_notice;
pub mod world;

use config::Account;
use impeccable_common::Io;
use session::{Entitlement, Session, SessionError};
use std::collections::HashMap;
use std::io::Write;
use std::time::Duration;
use store::{Secret, State, Store};

/// How long `login` waits for the browser to come back.
const DEFAULT_LOGIN_TIMEOUT: Duration = Duration::from_secs(300);

/// The outcome of a completed sign-in.
pub struct LoggedIn {
    pub account: Account,
    /// The sign-in this made (`State::login`).
    pub login: u64,
    pub entitlement: Result<Entitlement, SessionError>,
}

/// Sign in. `open` is handed the authorization URL and returns whether a
/// browser was started; the caller prints the URL either way.
pub fn login(
    env: &HashMap<String, String>,
    open: &mut dyn FnMut(&str),
    timeout: Duration,
) -> Result<LoggedIn, String> {
    let account = Account::from_env(env)?;
    let backend = store::chosen_backend(env)?;
    let client = http::Client::new(&account);
    let store = Store::new(&account);
    // The generation this attempt started from. A logout while the browser
    // is open writes a newer tombstone, and this attempt then must not sign
    // the machine back in. (A token refresh also moves the generation, but
    // leaves the machine signed in; replacing that sign-in is fine.)
    let started = {
        let _lock = store.lock()?;
        store.state().map(|s| s.generation).unwrap_or(0)
    };
    let meta = oauth::metadata(&client, &account)?;
    let pending = oauth::start(&account, &meta)?;
    open(&pending.url);
    // The browser waits on `callback` until the sign-in is saved; dropped on any
    // early return, it tells the browser the sign-in didn't finish.
    let (code, callback) = pending
        .wait(&account.issuer, timeout)
        .map_err(|e| e.to_string())?;
    let tokens = oauth::exchange(&client, &account, &meta.token_endpoint, &pending, &code)
        .map_err(|e| format!("the account service did not accept the sign-in: {e}"))?;
    let (replaced, login) = {
        let lock = store.lock()?;
        let previous = store.state();
        // A logout since this attempt started, even one a newer sign-in
        // has followed, ends this attempt: it must not replace that sign-in.
        let signed_out_since = previous.as_ref().is_some_and(|s| {
            s.signed_out_at > started || (s.generation != started && !s.signed_in)
        });
        if signed_out_since {
            drop(lock);
            if let Some(endpoint) = &meta.revocation_endpoint {
                let _ = oauth::revoke(&client, endpoint, &tokens.refresh_token);
            }
            return Err("you signed out while this sign-in was waiting".into());
        }
        let replaced = previous
            .as_ref()
            .and_then(|s| Some((s.revocation_endpoint.clone()?, store.secret(s)?)));
        let generation = previous.as_ref().map(|s| s.generation).unwrap_or(0) + 1;
        // A new sign-in may be another person: their taste is never the last one's.
        store.clear_taste(&lock);
        let state = State {
            foundations: tokens.foundations,
            taste: tokens.taste,
            scopes: tokens.scopes.unwrap_or_default(),
            schema: 1,
            issuer: account.issuer.clone(),
            generation,
            signed_in: true,
            backend,
            token_endpoint: meta.token_endpoint.clone(),
            revocation_endpoint: meta.revocation_endpoint.clone(),
            login: generation,
            signed_out_at: previous.as_ref().map(|s| s.signed_out_at).unwrap_or(0),
        };
        let secret = Secret {
            generation,
            refresh_token: tokens.refresh_token,
            access_token: tokens.access_token,
            access_expires_at: session::now() + tokens.expires_in,
        };
        store.save(&lock, &state, &secret)?;
        setup::grant(&account, generation, tokens.setup);
        // Nothing Pro from an earlier sign-in carries over to this one. Only
        // once the new sign-in is saved: a failed save leaves the previous
        // sign-in current, with its Pro state intact. Still under the lock.
        pro::reset_holding(&lock, &account);
        (replaced, generation)
    };
    callback.signed_in();
    // The grant this sign-in replaced is ended at the service too.
    if let Some((endpoint, old)) = replaced {
        let _ = oauth::revoke(&client, &endpoint, &old.refresh_token);
    }
    let entitlement = Session::load(&account).and_then(|mut s| session::entitlement(&mut s));
    Ok(LoggedIn {
        account,
        login,
        entitlement,
    })
}

/// Sign out: tombstone and delete locally under the lock, then revoke the
/// grant at the service (best effort). Returns whether anyone was signed in.
pub fn logout(env: &HashMap<String, String>) -> Result<Option<Account>, String> {
    let account = Account::from_env(env)?;
    let store = Store::new(&account);
    let (was, revoke) = {
        let lock = store.lock()?;
        let state = store.state();
        let secret = state.as_ref().and_then(|s| store.secret(s));
        let was = state.as_ref().is_some_and(|s| s.signed_in);
        // Always a tombstone, even with nothing stored: a sign-in still
        // waiting in the browser sees the generation move and stops.
        store.sign_out(&lock, state.as_ref(), store::Backend::File)?;
        pro::reset_holding(&lock, &account);
        let revoke = state
            .and_then(|s| s.revocation_endpoint)
            .zip(secret.map(|s| s.refresh_token));
        (was, revoke)
    };
    if let Some((endpoint, refresh_token)) = revoke {
        let _ = oauth::revoke(&http::Client::new(&account), &endpoint, &refresh_token);
    }
    Ok(was.then_some(account))
}

fn has_flag(args: &[String], flag: &str) -> bool {
    args.iter().any(|a| a == flag)
}

fn unknown_args(args: &[String], allowed: &[&str], io: &mut Io, verb: &str) -> bool {
    if let Some(bad) = args.iter().find(|a| !allowed.contains(&a.as_str())) {
        io.err(&format!("Unknown option for {verb}: {bad}\n"));
        return true;
    }
    false
}

/// `impeccable login [--no-browser]`. With `--no-browser` (or
/// `IMPECCABLE_NO_BROWSER=1`) the authorization URL is the only line on
/// stdout, so a script can open it itself.
/// How a sign-in attempt ended, for callers that act on it (`install`'s sign-in offer).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LoginOutcome {
    /// A usable sign-in was already here; no browser was opened.
    Already,
    /// A fresh sign-in, to this account.
    SignedIn(Account),
    /// Declined, timed out, or the service refused it; the reason is on stderr.
    Failed,
}

pub fn run_login(args: &[String], io: &mut Io) -> i32 {
    if has_flag(args, "--help") || has_flag(args, "-h") {
        io.out(LOGIN_USAGE);
        return 0;
    }
    if unknown_args(args, &["--no-browser", "--force"], io, "login") {
        return 1;
    }
    let skip = if has_flag(args, "--force") { Skip::Never } else { Skip::UnlessStale };
    plain_for_the_run(args, io);
    match sign_in(io, has_flag(args, "--no-browser"), skip) {
        LoginOutcome::Failed => 1,
        LoginOutcome::Already => 0,
        LoginOutcome::SignedIn(account) => {
            setup_status::after_login(io, &account);
            0
        }
    }
}

/// `--no-browser` keeps the rest of the run (setup, the first scan, Loop, the summary) plain too:
/// impeccable_common::steps reads IMPECCABLE_NO_BROWSER.
fn plain_for_the_run(args: &[String], io: &mut Io) {
    if has_flag(args, "--no-browser") {
        io.env.insert("IMPECCABLE_NO_BROWSER".to_string(), "1".to_string());
    }
}

/// Whether Impeccable suggests signing in to someone who isn't signed in: install's
/// offer (or its one-line hint) and the signed-out line after a saved critique or audit.
/// Off, both say nothing; `login` and everything a stored sign-in does are unchanged.
pub const OFFER_SIGN_IN: bool = false;

/// The sign-in `install` offers at its end. Only a fresh sign-in reaches here (the
/// offer is made only when none is stored), and it prints what `login` prints.
pub fn login_after_install(io: &mut Io) -> LoginOutcome {
    sign_in(io, false, Skip::AnyUsable)
}

/// Whether a sign-in is stored here, read offline and silently: `install` asks this
/// before it offers one.
pub fn has_sign_in(io: &Io) -> bool {
    Account::from_env(&io.env).ok().is_some_and(|account| Session::load(&account).is_ok())
}

/// Whether a sign-in is recorded, from the stored state alone: the credential isn't
/// read, so an unattended run never meets a Keychain prompt.
pub fn sign_in_recorded(io: &Io) -> bool {
    Account::from_env(&io.env).ok().is_some_and(|account| {
        store::Store::new(&account).try_state().ok().flatten().is_some_and(|s| s.signed_in)
    })
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Skip {
    Never,
    UnlessStale,
    AnyUsable,
}

fn sign_in(io: &mut Io, no_browser: bool, skip: Skip) -> LoginOutcome {
    if skip != Skip::Never && already_signed_in(io, skip == Skip::UnlessStale) {
        return LoginOutcome::Already;
    }
    let no_browser = no_browser || io.env_truthy("IMPECCABLE_NO_BROWSER");
    let timeout = io
        .env("IMPECCABLE_LOGIN_TIMEOUT")
        .and_then(|s| s.parse::<u64>().ok())
        .map(Duration::from_secs)
        .unwrap_or(DEFAULT_LOGIN_TIMEOUT);
    let env = io.env.clone();
    // A person at a terminal gets install's steps (impeccable_common::steps); anything else the plain lines below.
    let steps = if no_browser { None } else { impeccable_common::steps::Steps::new(io) };
    let mut waiting: Option<impeccable_common::steps::Progress> = None;
    // The link has to reach the terminal before the wait starts.
    let mut open = |url: &str| {
        if let Some(steps) = &steps {
            // Install opened with its own header; a sign-in on its own opens with one.
            if skip != Skip::AnyUsable {
                steps.header(io, "sign in");
            }
            let label = if open_browser(url) { "Opening your browser. If it doesn't open, use this link:" } else { "Open this link to sign in:" };
            steps.link(io, label, url);
            waiting = Some(steps.progress(io, "Waiting for you in the browser"));
            return;
        }
        if no_browser {
            io.out(&format!("{url}\n"));
        } else if open_browser(url) {
            io.err(&format!(
                // The link alone on its line, so a terminal that wraps it never splits it inside a sentence.
                "Opening your browser to sign in. If it doesn't open, visit this link:\n\n{url}\n\n"
            ));
        } else {
            io.err(&format!("Open this link to sign in:\n\n{url}\n\n"));
        }
        let _ = io.stdout.flush();
        let _ = io.stderr.flush();
    };
    let result = login(&env, &mut open, timeout);
    if let Some(steps) = &steps {
        // The waiting line turns into the outcome in place.
        let finish = |io: &mut Io, waiting: Option<impeccable_common::steps::Progress>, title: &str, ok: bool| match (waiting, ok) {
            (Some(p), true) => p.done(steps, io, title, &[]),
            (Some(p), false) => p.failed(steps, io, title, &[]),
            (None, true) => steps.done(io, title, &[]),
            (None, false) => steps.failed(io, title, &[]),
        };
        return match result {
            Ok(done) => {
                // The plan's lines under the step, as the plain path prints them.
                let ((), plan) = steps.held(io, |io| report_after_sign_in(io, &done, &env));
                finish(io, waiting.take(), &format!("Signed in to {}", done.account.display_name()), true);
                steps.details(io, &plan);
                LoginOutcome::SignedIn(done.account)
            }
            Err(e) => {
                finish(io, waiting.take(), &format!("Sign-in failed: {e}"), false);
                LoginOutcome::Failed
            }
        };
    }
    match result {
        Ok(done) => {
            io.err(&format!("Signed in to {}.\n", done.account.display_name()));
            report_after_sign_in(io, &done, &env);
            LoginOutcome::SignedIn(done.account)
        }
        Err(e) => {
            io.err(&format!("Sign-in failed: {e}.\n"));
            LoginOutcome::Failed
        }
    }
}

/// What a fresh sign-in's plan includes, said after it: Pro rules refreshed, or the plan.
fn report_after_sign_in(io: &mut Io, done: &LoggedIn, env: &std::collections::HashMap<String, String>) {
    {
        {
            match &done.entitlement {
                Ok(Entitlement { pro: true, .. }) => {
                    let outcome = pro::refresh(&done.account, &pro::verify::pinned_keys(&env));
                    pro::report(io, &outcome);
                }
                Ok(_) => {
                    pro::settle(&done.account, done.login, false);
                    report_entitlement(io, &done.entitlement);
                }
                Err(_) => report_entitlement(io, &done.entitlement),
            }
        }
    }
}

/// `login` on a machine already signed in to this account: say so and stop, with no
/// browser. False when there is no usable sign-in (none, expired, ended by the
/// service, unreadable), so the browser sign-in goes ahead.
fn already_signed_in(io: &mut Io, unless_stale: bool) -> bool {
    already_signed_in_inner(io, unless_stale).is_some()
}

fn already_signed_in_inner(io: &mut Io, unless_stale: bool) -> Option<()> {
    let account = Account::from_env(&io.env).ok()?;
    let mut session = Session::load(&account).ok()?;
    // A sign-in missing a scope the service now offers is the one the "needs a fresh
    // sign-in" notices send here: that one signs in again.
    if unless_stale && stale_grant::fresh_sign_in_adds(&account, &session.state) {
        return None;
    }
    let login = session.state.login;
    let name = account.display_name();
    match session::entitlement(&mut session) {
        Ok(e) => {
            pro::settle(&account, login, e.pro);
            io.err(&format!("Already signed in to {name}. To sign in again: npx impeccable login --force\n"));
            report_entitlement(io, &Ok(e));
            Some(())
        }
        // Offline or the service is down: the sign-in stored here still stands.
        Err(SessionError::Api(e)) => {
            io.err(&format!("Already signed in to {name}. Couldn't reach it to check the sign-in: {e}.\n"));
            Some(())
        }
        Err(_) => None,
    }
}

fn report_entitlement(io: &mut Io, e: &Result<Entitlement, SessionError>) {
    match e {
        Ok(Entitlement { pro: true, .. }) => io.err("Pro rules: included.\n"),
        // Pro isn't on sale yet: an account without it hears nothing about it (Paul, 17 Nov).
        Ok(_) => {}
        Err(e) => io.err(&format!("Couldn't check Pro access: {e}.\n")),
    }
}

/// `Plan: Pro. Everything in Free, plus:` and one line per item, with
/// announced items marked `(soon)` as the catalog's own markdown does.
fn plan_lines(p: &plans::Plan) -> String {
    let mut out = match &p.builds {
        Some(b) => format!("Plan: {}. Everything in {b}, plus:\n", p.name),
        None => format!("Plan: {}. Includes:\n", p.name),
    };
    for item in &p.adds {
        let soon = if item.soon { " (soon)" } else { "" };
        out.push_str(&format!("  - {}{soon}\n", item.text));
    }
    out
}

pub fn run_logout(args: &[String], io: &mut Io) -> i32 {
    if unknown_args(args, &[], io, "logout") {
        return 1;
    }
    match logout(&io.env.clone()) {
        Ok(Some(account)) => {
            io.err(&format!("Signed out of {}.\n", account.display_name()));
            0
        }
        Ok(None) => {
            io.err("Not signed in.\n");
            0
        }
        Err(e) => {
            io.err(&format!("Sign-out failed: {e}.\n"));
            1
        }
    }
}

/// `impeccable whoami [--json]`: whether this machine is signed in, to which
/// service, and whether that account includes Pro rules. Exit 1 when not
/// signed in or the service cannot be asked.
pub fn run_whoami(args: &[String], io: &mut Io) -> i32 {
    if unknown_args(args, &["--json"], io, "whoami") {
        return 1;
    }
    let json = has_flag(args, "--json");
    let account = match Account::from_env(&io.env) {
        Ok(a) => a,
        Err(e) => {
            io.err(&format!("{e}.\n"));
            return 1;
        }
    };
    let mut login = None;
    let result = Session::load(&account).and_then(|mut s| {
        login = Some(s.state.login);
        session::entitlement(&mut s)
    });
    // An explicit answer applies at once, to the sign-in it was about: "not
    // entitled" ends the offline grace, "entitled" lifts an earlier "no".
    if let (Ok(e), Some(login)) = (&result, login) {
        pro::settle(&account, login, e.pro);
    }
    // What the plan includes, from the public catalog; optional.
    let plan = result.as_ref().ok().and_then(|e| {
        let id = e
            .plan
            .as_deref()
            .unwrap_or(if e.pro { "pro" } else { "free" });
        plans::fetch(&account, id)
    });
    if json {
        let mut v = serde_json::json!({ "account_url": account.issuer, "signed_in": false });
        match &result {
            Ok(e) => {
                v["signed_in"] = true.into();
                v["pro"] = e.pro.into();
                v["reason"] = e.reason.clone().into();
                if let Some(p) = &plan {
                    v["plan"] = serde_json::json!({
                        "id": p.id,
                        "name": p.name,
                        "builds": p.builds,
                        "adds": p.adds.iter()
                            .map(|i| serde_json::json!({ "text": i.text, "soon": i.soon }))
                            .collect::<Vec<_>>(),
                    });
                }
            }
            Err(SessionError::NotSignedIn | SessionError::Expired) => {}
            Err(e) => {
                v["signed_in"] = true.into();
                v["error"] = e.to_string().into();
            }
        }
        io.out(&format!("{v}\n"));
        return if matches!(result, Ok(_)) { 0 } else { 1 };
    }
    match result {
        Ok(e) => {
            io.out(&format!("Signed in to {}.\n", account.display_name()));
            match &plan {
                Some(p) => io.out(&plan_lines(p)),
                None if e.pro => io.out("Pro rules: included.\n"),
                None => {}
            }
            0
        }
        Err(SessionError::NotSignedIn) => {
            io.err("Not signed in. Run `npx impeccable login`.\n");
            1
        }
        Err(SessionError::Expired) => {
            io.err("Your sign-in expired. Run `npx impeccable login`.\n");
            1
        }
        Err(e) => {
            io.err(&format!(
                "Signed in to {}, but couldn't reach it: {e}.\n",
                account.display_name()
            ));
            1
        }
    }
}

const LOGIN_USAGE: &str = "Usage: impeccable login [--no-browser] [--force]

Sign in to your Impeccable account in the browser. Already signed in, it says so
and opens nothing.

Options:
  --no-browser   Print the sign-in link on stdout instead of opening a browser
  --force        Sign in again even when already signed in
";

/// Start the system browser on `url`. Never through a shell: the URL is an
/// argument, so `&` and quotes in it are inert.
fn open_browser(url: &str) -> bool {
    let mut cmd = if cfg!(target_os = "macos") {
        std::process::Command::new("open")
    } else if cfg!(windows) {
        let mut c = std::process::Command::new("rundll32");
        c.arg("url.dll,FileProtocolHandler");
        c
    } else {
        std::process::Command::new("xdg-open")
    };
    cmd.arg(url)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    // Started, not waited on: an opener that hangs must not hold the
    // sign-in before its own deadline starts.
    cmd.spawn().is_ok()
}

#[cfg(test)]
mod plain_run_tests {
    use super::*;

    // Catches `login --no-browser` going on to draw setup, the first scan, Loop and the summary as steps, where the
    // CLI contract pins the plain lines (#1536 review).
    #[test]
    fn no_browser_keeps_the_whole_run_plain() {
        for (args, plain) in [(vec!["--no-browser"], true), (vec!["--force"], false), (vec![], false)] {
            let (mut io, _) = Io::captured("", std::env::temp_dir(), Default::default());
            let args: Vec<String> = args.iter().map(|a| a.to_string()).collect();
            plain_for_the_run(&args, &mut io);
            assert_eq!(impeccable_common::steps::plain_for(&io), plain, "{args:?}");
        }
    }
}
