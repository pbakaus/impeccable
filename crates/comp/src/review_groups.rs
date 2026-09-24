//! Structural constraints shared by map inspection and component review.
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};

pub fn issues(regions: &[Value]) -> Vec<(String, String)> {
    let mut issues = Vec::new();
    let mut groups: BTreeMap<&str, Vec<&Value>> = BTreeMap::new();
    for region in regions {
        let Some(group) = region.get("reviewGroup") else { continue; };
        let id = region["id"].as_str().unwrap_or("");
        let Some(name) = group.as_str().filter(|s| !s.trim().is_empty() && s.chars().count() <= 120) else {
            issues.push((id.into(), "reviewGroup needs a nonempty name of at most 120 characters".into()));
            continue;
        };
        groups.entry(name).or_default().push(region);
    }
    for (name, members) in groups {
        let signature = |r: &Value| (r["kind"].as_str().unwrap_or("").to_string(), r["container"] == true);
        let first = signature(members[0]);
        let mixed = members.iter().any(|r| signature(r) != first);
        for region in &members {
            let id = region["id"].as_str().unwrap_or("");
            let message = if !matches!(region["kind"].as_str(), Some("text" | "control" | "chrome")) {
                Some("Review groups are for repeated code components; raster assets remain individual".to_string())
            } else if mixed {
                Some(format!("Review group {name} mixes region kinds or containers with their contents; group only repeated instances of the same code component"))
            } else {
                let mut parent = region["parentId"].as_str();
                let mut visited = HashSet::new();
                let mut nested = false;
                while let Some(p) = parent {
                    if !visited.insert(p) { break; }
                    if members.iter().any(|r| r["id"] == p) { nested = true; break; }
                    parent = regions.iter().find(|r| r["id"] == p).and_then(|r| r["parentId"].as_str());
                }
                nested.then(|| format!("Review group {name} includes an ancestor and its child; group peers, not nested components"))
            };
            if let Some(message) = message { issues.push((id.into(), message)); }
        }
    }
    issues
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn group_limit_counts_unicode_characters() {
        assert!(issues(&[json!({"id":"a","kind":"text","reviewGroup":"部".repeat(120)})]).is_empty());
        assert!(!issues(&[json!({"id":"a","kind":"text","reviewGroup":"部".repeat(121)})]).is_empty());
    }
    #[test]
    fn grouped_peers_keep_identity_but_mixed_or_nested_components_are_refused() {
        let peers = json!([
            {"id":"a","kind":"text","reviewGroup":"labels"},
            {"id":"b","kind":"text","reviewGroup":"labels"}
        ]);
        assert!(issues(peers.as_array().unwrap()).is_empty());
        for change in [json!({"kind":"image"}),json!({"kind":"chrome","container":true}),json!({"parentId":"a"})] {
            let mut bad = peers.clone();
            for (key, value) in change.as_object().unwrap() { bad[1][key] = value.clone(); }
            assert!(!issues(bad.as_array().unwrap()).is_empty());
        }
    }
}
