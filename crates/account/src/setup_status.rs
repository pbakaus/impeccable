//! `impeccable status` and the lines `impeccable login` ends with: the account
//! service's one setup read (`/cli/v1/setup`), drawn as the service gives it.
//! The next step and each place's step are the service's: nothing here
//! computes one, orders the places, or rewrites a label.
use crate::{
    config::Account,
    http::ApiError,
    session::{Session, SessionError},
};
use impeccable_common::Io;
use serde_json::Value;

const PATH: &str = "/cli/v1/setup";
/// The project this folder is, sent in a header so no log carries it.
const PROJECT_HEADER: &str = "Impeccable-Project";

/// The read, for the folder at `cwd`. The project key goes along when the
/// folder has one, so that project comes back marked `current`.
fn read(session: &mut Session, cwd: &str, env: &std::collections::HashMap<String, String>) -> Result<Value, SessionError> {
    let key = crate::health::critique_repo(cwd, env).map(|(key, _)| key);
    let url = format!("{}{PATH}", session.account().issuer);
    session.call(|client, token| {
        let headers: Vec<(&str, &str)> = key.as_deref().map(|k| (PROJECT_HEADER, k)).into_iter().collect();
        client.get_json_with(&url, Some(token), &headers)
    })
}

/// An answer this client can draw: version 1 with its places listed.
fn usable(v: &Value) -> bool {
    v["version"] == 1 && v["places"].is_array()
}

/// A server string as one terminal line: control characters (escapes, newlines)
/// never reach the terminal.
fn clean(s: &str) -> String {
    s.chars().filter(|c| !c.is_control()).collect::<String>().trim().to_string()
}

fn place_name(kind: &str) -> String {
    match kind {
        "agent" => "Your agent".into(),
        "agent-tools" => "Agent tools".into(),
        "loop" => "Loop".into(),
        "extension" => "Chrome extension".into(),
        "github" => "GitHub pull requests".into(),
        other => clean(other),
    }
}

/// One step as the service wrote it: its label, then what to run or open.
fn step_line(step: &Value) -> Option<String> {
    let label = step["label"].as_str().map(clean).filter(|l| !l.is_empty())?;
    let action = step["command"]
        .as_str()
        .or_else(|| step["url"].as_str().filter(|u| u.starts_with("https://")))
        .map(clean)
        .filter(|a| !a.is_empty());
    Some(match action {
        Some(a) => format!("{label}: {a}"),
        None => label.to_string(),
    })
}

/// At most three lines: what is connected, what isn't yet, and the one next
/// step. A place the service marks `unavailable`, or with a state this
/// version doesn't know, is left out rather than guessed at.
pub fn lines(v: &Value) -> String {
    let mut on = vec![];
    let mut off = vec![];
    for p in v["places"].as_array().into_iter().flatten() {
        let name = place_name(p["kind"].as_str().unwrap_or(""));
        if name.is_empty() {
            continue;
        }
        match p["state"].as_str() {
            Some("on") => on.push(name),
            Some("quiet") => on.push(format!("{name} (quiet)")),
            Some("off") => off.push(name),
            Some("needs-pro") => off.push(format!("{name} (Pro)")),
            _ => {}
        }
    }
    let mut out = String::new();
    if !on.is_empty() {
        out.push_str(&format!("Connected: {}.\n", on.join(", ")));
    }
    if !off.is_empty() {
        out.push_str(&format!("Not connected yet: {}.\n", off.join(", ")));
    }
    if let Some(next) = v.get("next").filter(|n| n.is_object()).and_then(step_line) {
        out.push_str(&format!("Next: {next}\n"));
    }
    out
}

/// The `current` project's line, when the service knows this folder.
fn project_line(v: &Value) -> Option<String> {
    let p = v["projects"].as_array()?.iter().find(|p| p["current"] == true)?;
    let name = p["name"].as_str().map(clean).filter(|n| !n.is_empty())?;
    Some(match p["repository"]["url"].as_str().filter(|u| u.starts_with("https://")).map(clean) {
        Some(url) => format!("This project: {name} ({url}).\n"),
        None => format!("This project: {name}.\n"),
    })
}

/// After a successful sign-in: the setup lines, on stderr with the rest of
/// login's words, so stdout keeps only what a script reads. Quiet when the
/// read fails: the sign-in already worked.
pub fn after_login(io: &mut Io, account: &Account) {
    let Ok(mut session) = Session::load(account) else { return };
    let cwd = io.cwd.to_string_lossy().into_owned();
    if let Ok(v) = read(&mut session, &cwd, &io.env) {
        if usable(&v) {
            io.err(&lines(&v));
        }
    }
}

const USAGE: &str = "Usage: impeccable status [--json]\n\nShows what Impeccable is connected to for your account (your agent, its tools,\nLoop, the Chrome extension and GitHub pull requests), this project when your\naccount knows it, and the one next step.\n\n  --json   Print the account service's answer as it came.\n";

/// `impeccable status [--json]`.
pub fn run(args: &[String], io: &mut Io) -> i32 {
    if args.iter().any(|a| a == "--help" || a == "-h") {
        io.out(USAGE);
        return 0;
    }
    if args.iter().any(|a| a != "--json") {
        io.err(USAGE);
        return 1;
    }
    let json = !args.is_empty();
    let account = match Account::from_env(&io.env) {
        Ok(a) => a,
        Err(e) => {
            io.err(&format!("{e}.\n"));
            return 1;
        }
    };
    let cwd = io.cwd.to_string_lossy().into_owned();
    let env = io.env.clone();
    let result = Session::load(&account).and_then(|mut s| read(&mut s, &cwd, &env));
    let v = match result {
        Ok(v) if usable(&v) => v,
        Ok(_) => {
            io.err("Couldn't read your setup: the account service answered in a shape this version doesn't know. Run impeccable update.\n");
            return 1;
        }
        Err(SessionError::NotSignedIn | SessionError::Expired) => {
            io.err("Not signed in. Run impeccable login.\n");
            return 1;
        }
        Err(SessionError::Api(ApiError::Status { status: 404, .. })) => {
            io.err("Couldn't read your setup: this account service doesn't offer it yet.\n");
            return 1;
        }
        Err(e) => {
            io.err(&format!("Couldn't read your setup: {e}.\n"));
            return 1;
        }
    };
    if json {
        io.out(&format!("{v}\n"));
        return 0;
    }
    io.out(&format!("Signed in to {}.\n", account.display_name()));
    if let Some(line) = project_line(&v) {
        io.out(&line);
    }
    io.out(&lines(&v));
    0
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn example() -> Value {
        json!({ "version": 1, "at": "2026-11-14T09:00:00Z",
          "person": { "name": "Ada", "login": "ada" }, "signIn": { "github": true, "google": false },
          "plan": { "tier": "free", "trialEndsAt": null },
          "projects": [{ "id": "p_3f9c", "name": "pristine", "current": true, "repository": null, "lastSeenAt": "2026-11-14T08:59:40Z", "on": { "agent": true, "pullRequests": false } }],
          "places": [
            { "kind": "agent", "state": "on", "count": 1, "lastSeenAt": "2026-11-14T08:59:40Z", "step": null },
            { "kind": "agent-tools", "state": "off", "count": 0, "lastSeenAt": null, "step": { "id": "add-agent-tools", "place": "agent-tools", "label": "Add to Claude Code", "url": null, "command": "claude mcp add --transport http impeccable https://api.impeccable.style/mcp" } },
            { "kind": "loop", "state": "quiet", "count": 1, "lastSeenAt": null, "step": null },
            { "kind": "extension", "state": "needs-pro", "count": 0, "lastSeenAt": null, "step": { "id": "upgrade", "place": "extension", "label": "Get Pro", "url": "https://impeccable.style/pro", "command": null } },
            { "kind": "github", "state": "unavailable", "count": 0, "lastSeenAt": null, "step": null },
            { "kind": "telepathy", "state": "on", "count": 1, "lastSeenAt": null, "step": null },
            { "kind": "loop", "state": "sideways", "count": 1, "lastSeenAt": null, "step": null }
          ],
          "next": { "id": "add-github", "place": "github", "label": "Add to GitHub", "url": "https://github.com/apps/impeccable-critique/installations/new", "command": null } })
    }

    #[test]
    fn draws_the_places_and_the_services_next_step_as_given() {
        assert_eq!(
            lines(&example()),
            "Connected: Your agent, Loop (quiet), telepathy.\n\
             Not connected yet: Agent tools, Chrome extension (Pro).\n\
             Next: Add to GitHub: https://github.com/apps/impeccable-critique/installations/new\n"
        );
    }

    #[test]
    fn no_next_step_draws_none_and_a_command_wins_over_a_url() {
        let mut v = example();
        v["next"] = Value::Null;
        assert!(!lines(&v).contains("Next"));
        v["next"] = json!({ "id": "sign-in-agent", "place": "agent", "label": "Sign in", "url": "https://x.test/", "command": "npx impeccable login" });
        assert!(lines(&v).ends_with("Next: Sign in: npx impeccable login\n"));
        // A url that isn't https is never shown to open.
        v["next"] = json!({ "id": "get-loop", "place": "loop", "label": "Get it for Mac", "url": "javascript:alert(1)", "command": null });
        assert!(lines(&v).ends_with("Next: Get it for Mac\n"));
    }

    #[test]
    fn names_the_current_project_only() {
        let mut v = example();
        assert_eq!(project_line(&v).as_deref(), Some("This project: pristine.\n"));
        v["projects"][0]["repository"] = json!({ "owner": "ada", "name": "pristine", "url": "https://github.com/ada/pristine" });
        assert_eq!(project_line(&v).as_deref(), Some("This project: pristine (https://github.com/ada/pristine).\n"));
        v["projects"][0]["current"] = false.into();
        assert_eq!(project_line(&v), None);
    }

    #[test]
    fn a_server_string_never_carries_a_terminal_escape() {
        let mut v = example();
        v["next"]["label"] = "Add\u{1b}[31m to\nGitHub".into();
        assert!(lines(&v).ends_with("Next: Add[31m toGitHub: https://github.com/apps/impeccable-critique/installations/new\n"));
    }

    #[test]
    fn refuses_an_unknown_version() {
        let mut v = example();
        assert!(usable(&v));
        v["version"] = 2.into();
        assert!(!usable(&v));
    }
}
