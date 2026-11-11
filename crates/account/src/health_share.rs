//! Explicit publication consent, separate from saving design health.
use super::{git, Repo};
use crate::{
    config::Account,
    http::ApiError,
    oauth,
    session::{Session, SessionError},
};
use impeccable_common::Io;
use serde_json::json;
use std::io::Write;
use std::time::Duration;

const USAGE: &str = "Usage: impeccable health share [--with-rules] [--no-label] [--no-trend]\n       impeccable health unshare\n";

pub(super) fn run(args: &[String], io: &mut Io) -> i32 {
    let sharing = args[0] == "share";
    if args[1..].iter().any(|a| a == "--help" || a == "-h") {
        io.out(USAGE);
        return 0;
    }
    if args[1..]
        .iter()
        .any(|a| !sharing || !["--with-rules", "--no-label", "--no-trend"].contains(&a.as_str()))
    {
        io.out(USAGE);
        return 1;
    }
    let label = !args.iter().any(|a| a == "--no-label");
    let trend = !args.iter().any(|a| a == "--no-trend");
    let rules = args.iter().any(|a| a == "--with-rules");
    if sharing && !(label || trend || rules) {
        io.out("Design health: publish at least one of label, trend or rules.\n");
        return 1;
    }
    match publish(
        io,
        sharing,
        json!({"label":label,"trend":trend,"rules":rules}),
    ) {
        Ok(Outcome::Link(url)) => io.out(&format!("{url}\n")),
        Ok(Outcome::Shared) => io.out("Design health: shared.\n"),
        Ok(Outcome::Updated) => io.out(
            "Design health: sharing settings updated. The link you got before still works.\n",
        ),
        Ok(Outcome::Unshared) => io.out("Design health: stopped sharing. The link no longer works.\n"),
        Err(message) => {
            io.out(&format!("Design health: {message}.\n"));
            return 1;
        }
    }
    0
}

fn error(e: SessionError) -> String {
    match e {
        SessionError::NotSignedIn | SessionError::Expired => {
            "not signed in. Run `impeccable login`".into()
        }
        SessionError::Api(ApiError::Status { status: 404, code })
            if code.as_deref() == Some("not_found") =>
        {
            "nothing to share yet. Run a full impeccable detect on this branch first".into()
        }
        SessionError::Api(ApiError::Status { status: 404, .. }) => {
            "sharing isn't available yet".into()
        }
        SessionError::Api(ApiError::Status { status: 429, .. }) => "sharing limit reached".into(),
        e => format!("sharing failed: {e}"),
    }
}

fn publish(
    io: &mut Io,
    sharing: bool,
    publish: serde_json::Value,
) -> Result<Outcome, String> {
    let account = Account::from_env(&io.env)?;
    let mut session = Session::load(&account).map_err(error)?;
    let root = git(&io.cwd.to_string_lossy(), &["rev-parse", "--show-toplevel"])
        .ok_or("run this inside a git repository")?;
    let repo = Repo::of(&root, &io.env).ok_or("run this inside a git repository")?;
    // Refresh before checking scope: renewal can narrow a grant.
    session.access_token().map_err(error)?;
    if !session.state.scopes.iter().any(|s| s == oauth::SHARE_SCOPE) {
        let mut scopes = session.state.scopes.clone();
        scopes.push(oauth::SHARE_SCOPE.into());
        let env = io.env.clone();
        let timeout = io
            .env("IMPECCABLE_LOGIN_TIMEOUT")
            .and_then(|s| s.parse().ok())
            .map(Duration::from_secs)
            .unwrap_or(crate::DEFAULT_LOGIN_TIMEOUT);
        let no_browser = io.env_truthy("IMPECCABLE_NO_BROWSER");
        let done = crate::login_requested(
            &env,
            &mut |url| {
                io.out(&format!("{url}\n"));
                let _ = io.stdout.flush();
                if !no_browser {
                    crate::open_browser(url);
                }
            },
            timeout,
            Some(&scopes),
        )?;
        match &done.entitlement {
            Ok(crate::session::Entitlement { pro: true, .. }) => {
                let outcome =
                    crate::pro::refresh(&done.account, &crate::pro::verify::pinned_keys(&env));
                crate::pro::report(io, &outcome);
            }
            Ok(_) => {
                crate::pro::settle(&done.account, done.login, false);
                crate::report_entitlement(io, &done.entitlement);
            }
            Err(_) => crate::report_entitlement(io, &done.entitlement),
        }
        session = Session::load(&account).map_err(error)?;
        if !session.state.scopes.iter().any(|s| s == oauth::SHARE_SCOPE) {
            return Err("sharing wasn't allowed".into());
        }
    }
    let mut body = json!({"repoKey":repo.key,"streamKey":repo.stream});
    if sharing {
        body["publish"] = publish.clone();
    }
    let path = if sharing { "share" } else { "unshare" };
    let url = format!("{}/cli/v1/health/{path}", account.issuer);
    // The ordinary interactive client has a 60-second request deadline.
    let answer = session
        .call(|client, token| client.post_json(&url, token, body.clone()))
        .map_err(error)?;
    if !sharing {
        return answer["unshared"]
            .as_bool()
            .map(|_| Outcome::Unshared)
            .ok_or_else(|| "invalid sharing response".into());
    }
    if answer["shared"] != true || answer["published"] != publish {
        return Err("invalid sharing response".into());
    }
    match &answer["token"] {
        serde_json::Value::Null if answer.get("token").is_some() => Ok(Outcome::Updated),
        serde_json::Value::String(token)
            if token.len() == 43
                && token
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') =>
        {
            // The service names the page (its `url`, when it has one), so the address
            // stays the service's to move. The CLI never builds one itself.
            match answer.get("url") {
                None | Some(serde_json::Value::Null) => Ok(Outcome::Shared),
                Some(serde_json::Value::String(u)) => page_url(&account.issuer, u, token)
                    .map(Outcome::Link)
                    .ok_or_else(|| "invalid sharing response".into()),
                Some(_) => Err("invalid sharing response".into()),
            }
        }
        _ => Err("invalid sharing response".into()),
    }
}

/// What `share` reports.
#[derive(Debug, PartialEq)]
pub(crate) enum Outcome {
    /// Shared, and the service named the page.
    Link(String),
    /// Shared; the service names no page yet.
    Shared,
    /// Already shared: the settings changed and the earlier link still works.
    Updated,
    Unshared,
}

/// The service's page link, only when it is https (http only for a loopback
/// service), on the service's own domain, and carries this share's token.
fn page_url(issuer: &str, u: &str, token: &str) -> Option<String> {
    let page = url::Url::parse(u).ok()?;
    let service = url::Url::parse(issuer).ok()?;
    let loopback = crate::config::loopback_url(&service);
    let secure = page.scheme() == "https"
        || (loopback && page.scheme() == "http" && crate::config::loopback_url(&page));
    let same = match (page.host_str(), service.host_str()) {
        (Some(p), Some(s)) => {
            p == s
                || matches!(service.host(), Some(url::Host::Domain(_)))
                    && s.split_once('.').is_some_and(|(_, parent)| {
                        // Never broaden a country-code issuer to a possible public
                        // suffix (e.g. service.co.uk -> co.uk). Without a suffix
                        // list, keep country-code services on their exact host.
                        parent
                            .rsplit_once('.')
                            .is_some_and(|(_, tld)| tld.len() > 2)
                            && (p == parent || p.ends_with(&format!(".{parent}")))
                    })
        }
        _ => false,
    };
    let carries = page.query_pairs().any(|(k, v)| k == "t" && v == token);
    (secure && same && carries && page.username().is_empty() && page.password().is_none())
        .then(|| page.into())
}

#[cfg(test)]
mod tests {
    use super::page_url;

    fn allowed(issuer: &str, page: &str) -> bool {
        page_url(issuer, &format!("{page}/shared?t=token"), "token").is_some()
    }

    #[test]
    fn page_domain_is_issuer_or_its_safe_parent() {
        for host in [
            "api.impeccable.style",
            "impeccable.style",
            "www.impeccable.style",
            "a.b.impeccable.style",
        ] {
            assert!(
                allowed("https://api.impeccable.style", &format!("https://{host}")),
                "{host}"
            );
        }
        for host in [
            "evil.style",
            "impeccable.style.evil.example",
            "evilimpeccable.style",
        ] {
            assert!(
                !allowed("https://api.impeccable.style", &format!("https://{host}")),
                "{host}"
            );
        }
        assert!(allowed("https://service.co.uk", "https://service.co.uk"));
        for host in ["co.uk", "other.co.uk", "www.service.co.uk"] {
            assert!(
                !allowed("https://service.co.uk", &format!("https://{host}")),
                "{host}"
            );
        }
        assert!(!allowed(
            "https://impeccable.style",
            "https://www.impeccable.style"
        ));
    }

    #[test]
    fn loopback_pages_use_accounts_transport_rule() {
        for host in ["localhost", "api.localhost", "127.0.0.1", "[::1]"] {
            assert!(
                allowed(
                    &format!("http://{host}:8787"),
                    &format!("http://{host}:3000")
                ),
                "{host}"
            );
        }
        assert!(!allowed(
            "https://api.impeccable.style",
            "http://api.impeccable.style"
        ));
        assert!(!allowed(
            "http://api.localhost",
            "http://api.localhost.evil.example"
        ));
        assert!(!allowed("http://127.0.0.1", "http://evil.0.1"));
    }
}
