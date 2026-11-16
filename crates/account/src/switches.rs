//! The repo settings page's switches (REN-2056), read and written for the CLI's
//! detached sync worker. Ids and on/off only: the lines the switches stand for are
//! compiled into the engine, so nothing here can put words into a rule file.
use crate::config::Account;
use crate::session::Session;
use impeccable_common::Io;
use serde_json::{json, Value};

/// What the service holds for this person and repository. `None` for a set means
/// nobody has written it yet: the files stand as they are.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Remote {
    pub rev: u64,
    pub team: Option<Vec<String>>,
    pub me: Option<Vec<String>>,
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
    Some(Remote { rev: body["rev"].as_u64()?, team: ids(body.get("team")?)?, me: ids(body.get("me")?)? })
}

fn session(io: &Io) -> Option<(Account, Session)> {
    let account = Account::from_env(&io.env).ok()?;
    let session = Session::load_for_upload(&account, std::time::Duration::from_secs(2))?;
    Some((account, session))
}

/// `GET /cli/v1/agents?repo=<key>`, the repository key health uploads use; `None` on
/// any failure.
pub fn fetch(io: &Io, repo: &str) -> Option<Remote> {
    let (account, mut session) = session(io)?;
    let query: String = url::form_urlencoded::Serializer::new(String::new()).append_pair("repo", repo).finish();
    let url = format!("{}/cli/v1/agents?{query}", account.issuer);
    let body = session.call(|c, token| c.get_json(&url, Some(token))).ok()?;
    parse(&body)
}

/// `POST /cli/v1/agents/me` with every catalog id on or off; `first` seeds a person
/// the service has no set for yet. The new rev, or `None` on any failure.
pub fn push(io: &Io, catalog: &[&str], on: &[&str], first: bool) -> Option<u64> {
    let (account, mut session) = session(io)?;
    let switches: serde_json::Map<String, Value> =
        catalog.iter().map(|id| (id.to_string(), json!(on.contains(id)))).collect();
    let mut body = json!({ "switches": switches });
    if first {
        body["first"] = json!(true);
    }
    let url = format!("{}/cli/v1/agents/me", account.issuer);
    let answer = session.call(|c, token| c.post_json(&url, token, body.clone())).ok()?;
    answer["rev"].as_u64()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_set_nobody_wrote_reads_as_none_and_junk_reads_as_nothing() {
        let r = parse(&json!({ "rev": 3, "team": null, "me": ["taste", "loop"] })).unwrap();
        assert_eq!(r, Remote { rev: 3, team: None, me: Some(vec!["taste".into(), "loop".into()]) });
        assert!(parse(&json!({ "rev": "3", "team": null, "me": [] })).is_none());
        assert!(parse(&json!({ "rev": 3, "team": null, "me": [1] })).is_none());
        assert!(parse(&json!({ "rev": 3, "team": null })).is_none());
    }
}
