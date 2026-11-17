//! The repo settings page's switches (REN-2056), read and written for the CLI's
//! detached sync worker. Ids and on/off only: the lines the switches stand for are
//! compiled into the engine, so nothing here can put words into a rule file.
use crate::config::Account;
use crate::session::Session;
use impeccable_common::Io;
use serde_json::{json, Value};

/// What the service holds for this person and repository. `me` is the set the page shows
/// them (their own switches, falling back to the team's one by one); `None` only from a
/// service that predates that. `me_set`: whether they have set their own yet, which
/// decides the one-time migration of a machine's existing block.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Remote {
    pub rev: u64,
    pub team: Option<Vec<String>>,
    pub me: Option<Vec<String>>,
    pub me_set: bool,
}

fn ids(v: &Value) -> Option<Option<Vec<String>>> {
    if v.is_null() {
        return Some(None);
    }
    let list = v.as_array()?;
    let out: Option<Vec<String>> = list.iter().map(|x| x.as_str().map(str::to_string)).collect();
    out.map(Some)
}

pub(crate) fn parse(body: &Value) -> Option<Remote> {
    let me = ids(body.get("me")?)?;
    // An older service sends `me: null` for "never set" and no `meSet`.
    let me_set = body.get("meSet").and_then(Value::as_bool).unwrap_or(me.is_some());
    Some(Remote { rev: body["rev"].as_u64()?, team: ids(body.get("team")?)?, me, me_set })
}

/// One sign-in, carried through a whole refresh: the read, any push, and the check
/// before each write, so a sign-in to another account or a sign-out in between stops
/// the refresh instead of crossing accounts.
pub struct Link {
    account: Account,
    session: Session,
    login: u64,
}

impl Link {
    pub fn open(io: &Io) -> Option<Link> {
        let account = Account::from_env(&io.env).ok()?;
        let session = Session::load_for_upload_waiting(&account, std::time::Duration::from_secs(4))?;
        let login = session.state.login;
        Some(Link { account, session, login })
    }

    /// Whether this machine is still signed in with the sign-in the refresh began with.
    pub fn still_current(&self) -> bool {
        crate::store::Store::new(&self.account)
            .state()
            .is_some_and(|s| s.signed_in && s.login == self.login)
    }

    /// `GET /cli/v1/agents?repo=<key>`, the repository key health uploads use; `None` on
    /// any failure.
    /// `GET /cli/v1/agents` with no repository: the person's own set, over an all-on team
    /// (REN-2056; a team's set reaches agents through the repository's AGENTS.md).
    pub fn fetch(&mut self) -> Option<Remote> {
        let url = format!("{}/cli/v1/agents", self.account.issuer);
        let body = self.session.call(|c, token| c.get_json(&url, Some(token))).ok()?;
        parse(&body)
    }

    /// `POST /cli/v1/agents/me` with every catalog id on or off; `first` seeds a person
    /// the service has no set for yet. The new rev, or `None` on any failure.
    pub fn push(&mut self, catalog: &[&str], on: &[&str], first: bool) -> Option<u64> {
        if !self.still_current() {
            return None;
        }
        let switches: serde_json::Map<String, Value> =
            catalog.iter().map(|id| (id.to_string(), json!(on.contains(id)))).collect();
        let mut body = json!({ "switches": switches });
        if first {
            body["first"] = json!(true);
        }
        let url = format!("{}/cli/v1/agents/me", self.account.issuer);
        let answer = self.session.call(|c, token| c.post_json(&url, token, body.clone())).ok()?;
        answer["rev"].as_u64()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_set_nobody_wrote_reads_as_none_and_junk_reads_as_nothing() {
        let r = parse(&json!({ "rev": 3, "team": null, "me": ["taste", "loop"] })).unwrap();
        assert_eq!(r, Remote { rev: 3, team: None, me: Some(vec!["taste".into(), "loop".into()]), me_set: true });
        // The current shape: both sets always arrays, and whether the person set their own.
        let r = parse(&json!({ "rev": 4, "team": ["wide"], "me": ["wide"], "teamSet": false, "meSet": false })).unwrap();
        assert_eq!((r.me.as_deref(), r.me_set), (Some(&["wide".to_string()][..]), false));
        // An older service's `me: null` is "never set".
        assert!(!parse(&json!({ "rev": 1, "team": null, "me": null })).unwrap().me_set);
        assert!(parse(&json!({ "rev": "3", "team": null, "me": [] })).is_none());
        assert!(parse(&json!({ "rev": 3, "team": null, "me": [1] })).is_none());
        assert!(parse(&json!({ "rev": 3, "team": null })).is_none());
    }
}
