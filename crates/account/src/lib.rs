//! `impeccable login | logout | whoami`: sign in to the Impeccable account
//! service with OAuth (loopback PKCE), and keep the credential lifecycle
//! (storage, lock, generation, logout tombstone). docs/RUNTIME-ENV.md (Account sign-in) has the
//! whole contract. Tokens are never printed or logged.

pub mod config;
pub mod critiques;
mod design_read;
pub mod health;
pub mod http;
pub mod oauth;
pub mod plans;
pub mod pro;
pub mod session;
pub mod setup;
pub mod store;

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
    let code = pending
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
        let state = State {
            foundations: tokens.foundations,
            // Omitted scope retains the requested OAuth grant, but critique
            // contents require the explicit consent reported by its token answer.
            scopes: tokens.scopes.unwrap_or_else(|| {
                oauth::scopes(&meta)
                    .split_whitespace()
                    .filter(|s| *s != oauth::CRITIQUES_SCOPE)
                    .map(str::to_string)
                    .collect()
            }),
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
pub fn run_login(args: &[String], io: &mut Io) -> i32 {
    if has_flag(args, "--help") || has_flag(args, "-h") {
        io.out(LOGIN_USAGE);
        return 0;
    }
    if unknown_args(args, &["--no-browser"], io, "login") {
        return 1;
    }
    let no_browser = has_flag(args, "--no-browser") || io.env_truthy("IMPECCABLE_NO_BROWSER");
    let timeout = io
        .env("IMPECCABLE_LOGIN_TIMEOUT")
        .and_then(|s| s.parse::<u64>().ok())
        .map(Duration::from_secs)
        .unwrap_or(DEFAULT_LOGIN_TIMEOUT);
    let env = io.env.clone();
    // The link has to reach the terminal before the wait starts.
    let mut open = |url: &str| {
        if no_browser {
            io.out(&format!("{url}\n"));
        } else if open_browser(url) {
            io.err(&format!(
                "Opening your browser to sign in. If it doesn't open, visit:\n  {url}\n"
            ));
        } else {
            io.err(&format!("Open this link to sign in:\n  {url}\n"));
        }
        let _ = io.stdout.flush();
        let _ = io.stderr.flush();
    };
    let result = login(&env, &mut open, timeout);
    match result {
        Ok(done) => {
            io.err(&format!("Signed in to {}.\n", done.account.display_host()));
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
            0
        }
        Err(e) => {
            io.err(&format!("Sign-in failed: {e}.\n"));
            1
        }
    }
}

fn report_entitlement(io: &mut Io, e: &Result<Entitlement, SessionError>) {
    match e {
        Ok(Entitlement { pro: true, .. }) => io.err("Pro rules: included.\n"),
        Ok(_) => io.err("Pro rules: not included with this account.\n"),
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
            io.err(&format!("Signed out of {}.\n", account.display_host()));
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
            io.out(&format!("Signed in to {}.\n", account.display_host()));
            match &plan {
                Some(p) => io.out(&plan_lines(p)),
                None if e.pro => io.out("Pro rules: included.\n"),
                None => io.out("Pro rules: not included with this account.\n"),
            }
            0
        }
        Err(SessionError::NotSignedIn) => {
            io.err("Not signed in. Run `impeccable login`.\n");
            1
        }
        Err(SessionError::Expired) => {
            io.err("Your sign-in expired. Run `impeccable login`.\n");
            1
        }
        Err(e) => {
            io.err(&format!(
                "Signed in to {}, but couldn't reach it: {e}.\n",
                account.display_host()
            ));
            1
        }
    }
}

const LOGIN_USAGE: &str = "Usage: impeccable login [--no-browser]

Sign in to your Impeccable account in the browser.

Options:
  --no-browser   Print the sign-in link on stdout instead of opening a browser
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
