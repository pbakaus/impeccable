//! Repair history is derived from stored packets, never supplied by the producer.
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

fn inputs(state: &Value, component: &Value) -> BTreeMap<String, Value> {
    let mut paths = BTreeSet::new();
    if let Some(deps) = component["dependencies"].as_array() {
        for p in deps.iter().filter_map(Value::as_str) {
            paths.insert(p.to_string());
        }
    }
    if let Some(capture) = state["capture"]["components"]
        .as_array()
        .and_then(|all| all.iter().find(|c| c["id"] == component["id"]))
    {
        for view in capture["views"]
            .as_object()
            .into_iter()
            .flat_map(|m| m.values())
        {
            for key in ["path", "entry"] {
                if let Some(path) = view[key].as_str() {
                    paths.insert(path.to_string());
                }
            }
            if let Some(deps) = view["observedDependencies"].as_object() {
                paths.extend(deps.keys().cloned());
            }
        }
    }
    let prefix = format!(
        "/files/{}/",
        state["packet"]["revision"].as_str().unwrap_or("")
    );
    for view in [
        &state["packet"]["comp"],
        &component["preview"],
        &component["context"],
        &component["thumbnail"],
    ] {
        if let Some(p) = view["url"]
            .as_str()
            .and_then(|url| url.strip_prefix(&prefix))
        {
            if !p.starts_with("_review_captures/") {
                paths.insert(p.to_string());
            }
        }
    }
    paths
        .into_iter()
        .map(|p| {
            let hash = state["files"][&p].clone();
            (p, hash)
        })
        .collect()
}

pub fn between(previous: &Value, current: &Value) -> Value {
    let old = previous["packet"]["components"].as_array().unwrap();
    let new = current["packet"]["components"].as_array().unwrap();
    let mut changes = serde_json::Map::new();
    let mut feedback = serde_json::Map::new();
    for component in new {
        let id = component["id"].as_str().unwrap();
        let mut change = if let Some(prior) = old.iter().find(|c| c["id"] == id) {
            let before = inputs(previous, prior);
            let after = inputs(current, component);
            let files: BTreeSet<_> = before
                .keys()
                .chain(after.keys())
                .filter(|p| before.get(*p) != after.get(*p))
                .cloned()
                .collect();
            let source_changed = prior["revision"] != component["revision"];
            let unchanged = !source_changed || (current["visualApprovalCarry"][id]["basis"] == "identical-native-captures-v1"
                && current["visualApprovalCarry"][id]["fromPacketRevision"] == previous["packet"]["revision"]);

            let mut reasons = Vec::new();
            if !files.is_empty() {
                reasons.push("files");
            }
            if prior["box"] != component["box"] {
                reasons.push("region");
            }
            if !unchanged && reasons.is_empty() {
                reasons.push("definition");
            }
            json!({"kind":if unchanged{"unchanged"}else{"changed"},"files":files,"reasons":reasons,"sourceChanged":source_changed})
        } else {
            json!({"kind":"added","files":[],"reasons":[]})
        };
        change["carried"] = json!(current["draft"]["decisions"][id]["action"] == "approve");
        // A code region reclassified last round comes back as a component under the same id.
        let listed = previous["draft"]["reclassify"].as_array()
            .and_then(|all| all.iter().find(|r| r["id"] == id))
            .map(|r| json!({"action":"reclassify","kind":r["kind"],"feedback":r["feedback"].as_str().unwrap_or("")}));
        let decision = listed.as_ref().unwrap_or(&previous["draft"]["decisions"][id]);
        if matches!(decision["action"].as_str(), Some("revise" | "reclassify")) && !previous["receipt"].is_null() {
            feedback.insert(
                id.into(),
                json!({"round":previous["packet"]["round"],"decision":decision}),
            );
        } else if decision["action"] != "approve" && previous["history"]["feedback"][id].is_object()
        {
            feedback.insert(id.into(), previous["history"]["feedback"][id].clone());
        }
        changes.insert(id.into(), change);
    }
    let removed: Vec<_> = old
        .iter()
        .filter(|c| !new.iter().any(|n| n["id"] == c["id"]))
        .map(|c| json!({"id":c["id"],"name":c["name"]}))
        .collect();
    json!({"packet":previous["packet"],"draft":previous["draft"],"submitted":!previous["receipt"].is_null(),"changes":changes,"feedback":feedback,"removed":removed})
}
