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
        Ok(Some(url)) => io.out(&format!("{url}\n")),
        Ok(None) if sharing => io.out("Design health: sharing updated. Use the existing link.\n"),
        Ok(None) => io.out("Design health: unshared.\n"),
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
            "no saved report for this branch".into()
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
) -> Result<Option<String>, String> {
    let account = Account::from_env(&io.env)?;
    let mut session = Session::load(&account).map_err(error)?;
    let root = git(&io.cwd.to_string_lossy(), &["rev-parse", "--show-toplevel"])
        .ok_or("run this in a git work tree")?;
    let repo = Repo::of(&root, &io.env).ok_or("run this in a git work tree")?;
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
        crate::login_requested(
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
            .map(|_| None)
            .ok_or_else(|| "invalid sharing response".into());
    }
    if answer["shared"] != true || answer["published"] != publish {
        return Err("invalid sharing response".into());
    }
    match &answer["token"] {
        serde_json::Value::Null if answer.get("token").is_some() => Ok(None),
        serde_json::Value::String(token)
            if token.len() == 43
                && token
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') =>
        {
            let mut url = url::Url::parse(&format!("{}/v1/health/shared", account.issuer))
                .map_err(|_| "invalid sharing response")?;
            url.query_pairs_mut().append_pair("t", token);
            Ok(Some(url.into()))
        }
        _ => Err("invalid sharing response".into()),
    }
}
