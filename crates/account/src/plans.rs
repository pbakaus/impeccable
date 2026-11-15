//! What the signed-in plan includes, for `whoami`: the public plan catalog
//! at `GET {account}/v1/plans`, read without a token. The catalog is
//! customer copy the service can change at any time, so it is optional:
//! any failure (unreachable, 404 while the catalog is off, a malformed
//! answer) gives `None` and `whoami` prints its plain Pro line instead.
//! Every string is cleaned before it reaches a terminal.

use crate::config::Account;
use crate::http::Client;
use serde_json::Value;
use std::time::Duration;

/// `whoami` already waited on the entitlement; the catalog is extra.
const DEADLINE: Duration = Duration::from_secs(5);
const MAX_NAME: usize = 40;
const MAX_TEXT: usize = 160;
const MAX_ITEMS: usize = 30;
const IDS: &[&str] = &["free", "pro", "team", "enterprise"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Item {
    pub text: String,
    pub soon: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Plan {
    pub id: String,
    pub name: String,
    /// The name of the plan this one builds on, when the catalog names one.
    pub builds: Option<String>,
    pub adds: Vec<Item>,
}

/// Whether `id` is a plan the catalog can name.
pub fn known(id: &str) -> bool {
    IDS.contains(&id)
}

/// The catalog entry for `id`, or `None` when it can't be had.
pub fn fetch(account: &Account, id: &str) -> Option<Plan> {
    let url = format!("{}/v1/plans", account.issuer);
    let v = Client::with_deadline(account, DEADLINE)
        .get_json(&url, None)
        .ok()?;
    find(&v, id)
}

fn find(catalog: &Value, id: &str) -> Option<Plan> {
    let plans = catalog.get("plans")?.as_array()?;
    let by_id = |id: &str| {
        plans
            .iter()
            .find(|p| p.get("id").and_then(Value::as_str) == Some(id))
    };
    let plan = by_id(id)?;
    let name = clean(plan.get("name")?.as_str()?, MAX_NAME)?;
    let builds = plan
        .get("builds")
        .and_then(Value::as_str)
        .and_then(|b| by_id(b)?.get("name")?.as_str())
        .and_then(|n| clean(n, MAX_NAME));
    let adds = plan
        .get("adds")?
        .as_array()?
        .iter()
        .filter_map(|item| {
            Some(Item {
                text: clean(item.get("text")?.as_str()?, MAX_TEXT)?,
                soon: item.get("soon").and_then(Value::as_bool) == Some(true),
            })
        })
        .take(MAX_ITEMS)
        .collect();
    Some(Plan {
        id: id.to_string(),
        name,
        builds,
        adds,
    })
}

/// One line of plain text: no control characters (so no terminal escapes),
/// no bidirectional overrides, at most `max` characters. Empty is `None`.
fn clean(s: &str, max: usize) -> Option<String> {
    let bidi = |c: char| matches!(c, '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}');
    let mut out: String = s
        .chars()
        .map(|c| if c.is_whitespace() { ' ' } else { c })
        .filter(|&c| !c.is_control() && !bidi(c))
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if out.chars().count() > max {
        out = out.chars().take(max - 1).collect::<String>() + "…";
    }
    (!out.is_empty()).then_some(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_plan_names_what_it_builds_on_and_tags_what_is_coming() {
        let v = json!({ "plans": [
            { "id": "free", "name": "Free", "builds": null, "adds": [{ "text": "The skill" }] },
            { "id": "pro", "name": "Pro", "builds": "free", "adds": [
                { "text": "Detector Pro" }, { "text": "Live++", "soon": true }, { "nope": 1 }
            ] },
        ] });
        let plan = find(&v, "pro").unwrap();
        assert_eq!(plan.name, "Pro");
        assert_eq!(plan.builds.as_deref(), Some("Free"));
        assert_eq!(
            plan.adds,
            vec![
                Item {
                    text: "Detector Pro".into(),
                    soon: false
                },
                Item {
                    text: "Live++".into(),
                    soon: true
                },
            ]
        );
        assert_eq!(find(&v, "free").unwrap().builds, None);
        assert_eq!(find(&v, "team"), None);
        assert_eq!(find(&json!({ "plans": {} }), "pro"), None);
    }

    #[test]
    fn catalog_text_cannot_drive_the_terminal() {
        // Catches: a hostile or broken catalog writing escapes, overrides or a wall of text to the terminal.
        assert_eq!(
            clean("Pro\u{1b}[2J\u{202E}x\n\tplan", 40).as_deref(),
            Some("Pro[2Jx plan")
        );
        assert_eq!(clean(" \u{7} ", 40), None);
        assert_eq!(clean(&"a".repeat(50), 10).unwrap().chars().count(), 10);
    }
}
