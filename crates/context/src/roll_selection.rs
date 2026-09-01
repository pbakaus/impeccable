//! JS: lib/roll-selection.mjs (driven synchronously with sha256 hex).

use crate::catalog::{sha256_hex, WELL_TIERS};
use crate::context::locale_compare;
use serde_json::Value;
use std::collections::{HashMap, HashSet};

pub const COMPOSITION_GRAINS: [&str; 4] = ["product", "flow", "view", "region"];
pub const COMPOSITION_PLATFORMS: [&str; 3] = ["web", "ios", "android"];

fn s<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(|x| x.as_str())
}

/// JS: rank(items, input, idFor): sort by digest desc (localeCompare), id asc.
fn rank<T: Clone>(items: &[T], input: &str, id_for: impl Fn(&T) -> String) -> Vec<T> {
    let mut scored: Vec<(T, String, String)> = items
        .iter()
        .map(|it| {
            let id = id_for(it);
            let score = sha256_hex(&format!("{}:{}", input, id));
            (it.clone(), id, score)
        })
        .collect();
    scored.sort_by(|a, b| {
        // hex digests: localeCompare == byte order for [0-9a-f]
        b.2.cmp(&a.2).then_with(|| locale_compare(&a.1, &b.1))
    });
    scored.into_iter().map(|(it, _, _)| it).collect()
}

fn tickets_for_rating(rating: Option<&Value>) -> usize {
    match rating.and_then(|r| r.as_f64()) {
        Some(x) if x == 1.0 => 1,
        Some(x) if x == 2.0 => 2,
        Some(x) if x == 3.0 => 2,
        _ => 2,
    }
}

fn review_field<'a>(v: &'a Value, key: &str) -> Option<&'a Value> {
    v.get("review").filter(|r| !r.is_null()).and_then(|r| r.get(key))
}

#[derive(Clone)]
struct Ticket {
    item: Value,
    ticket: usize,
}

fn challenger_tickets(pool: &[Value]) -> Vec<Ticket> {
    let mut out = Vec::new();
    for c in pool {
        if review_field(c, "breadth").and_then(|b| b.as_str()) == Some("niche") {
            continue;
        }
        let n = tickets_for_rating(review_field(c, "rating"));
        for t in 0..n {
            out.push(Ticket { item: c.clone(), ticket: t });
        }
    }
    out
}

fn composition_tickets(pool: &[Value]) -> Vec<Ticket> {
    let mut out = Vec::new();
    for c in pool {
        let n = tickets_for_rating(review_field(c, "rating"));
        for t in 0..n {
            out.push(Ticket { item: c.clone(), ticket: t });
        }
    }
    out
}

fn mode_allows(concept: &Value, mode: &str) -> bool {
    match review_field(concept, "allowedModes").and_then(|a| a.as_array()) {
        Some(a) if !a.is_empty() => a.iter().any(|m| m.as_str() == Some(mode)),
        _ => true,
    }
}

pub struct ChallengerSelection {
    pub approved: Vec<Value>,
    pub picks: Vec<Value>,
}

/// JS: selectApprovedChallengers
pub fn select_approved_challengers(
    scope: &str,
    key: &str,
    reroll: usize,
    mode: Option<&str>,
    concepts: &[Value],
) -> Result<ChallengerSelection, String> {
    let approved: Vec<Value> = concepts.iter().filter(|c| s(c, "status") == Some("approved")).cloned().collect();
    let wanted: [&str; 2] = if scope == "direction" { ["world", "dual"] } else { ["composition", "dual"] };
    // Map keyed by wellTier (string or null); iteration order = insertion order.
    let mut tier_order: Vec<String> = Vec::new();
    let mut by_tier: HashMap<String, Vec<Value>> = HashMap::new();
    for c in &approved {
        let tier = match c.get("wellTier") {
            Some(Value::String(t)) => t.clone(),
            _ => "\u{0}null".to_string(),
        };
        if !by_tier.contains_key(&tier) {
            tier_order.push(tier.clone());
        }
        by_tier.entry(tier).or_default().push(c.clone());
    }
    if WELL_TIERS.iter().any(|t| by_tier.get(*t).map(|p| p.is_empty()).unwrap_or(true)) {
        return Err("concept-seed: every challenger tier needs at least one approved concept".to_string());
    }
    if let Some(mode) = mode {
        for tier in &tier_order {
            let pool = by_tier.get(tier).unwrap();
            let eligible: Vec<Value> = pool.iter().filter(|c| mode_allows(c, mode)).cloned().collect();
            if !eligible.is_empty() {
                by_tier.insert(tier.clone(), eligible);
            }
        }
    }
    for tier in &tier_order {
        let pool = by_tier.get(tier).unwrap();
        let matching: Vec<Value> = pool.iter().filter(|c| s(c, "strength").map(|x| wanted.contains(&x)).unwrap_or(false)).cloned().collect();
        if !matching.is_empty() {
            by_tier.insert(tier.clone(), matching);
        }
    }

    let pick_round = |round: usize, excluded: &HashSet<String>| -> Vec<Value> {
        let salt = if round == 0 { String::new() } else { format!(":reroll-{}", round) };
        let tiers: Vec<String> = WELL_TIERS.iter().map(|t| t.to_string()).collect();
        let order = rank(&tiers, &format!("{}:{}:tiers{}", scope, key, salt), |t| t.clone());
        let mut picks: Vec<Value> = Vec::new();
        for (index, tier) in order.iter().enumerate() {
            let full = by_tier.get(tier).cloned().unwrap_or_default();
            let mut pool: Vec<Value> = full.iter().filter(|c| !excluded.contains(s(c, "id").unwrap_or(""))).cloned().collect();
            if pool.is_empty() {
                pool = full;
            }
            let mut tickets = challenger_tickets(&pool);
            if tickets.is_empty() {
                tickets = pool.iter().map(|c| Ticket { item: c.clone(), ticket: 0 }).collect();
            }
            let ranked = rank(&tickets, &format!("{}:{}:challenger-{}{}", scope, key, index, salt), |e| {
                format!("{}#{}", s(&e.item, "id").unwrap_or(""), e.ticket)
            });
            let mut ordered: Vec<Value> = Vec::new();
            let mut seen: HashSet<String> = HashSet::new();
            for e in ranked {
                let id = s(&e.item, "id").unwrap_or("").to_string();
                if seen.contains(&id) {
                    continue;
                }
                seen.insert(id);
                ordered.push(e.item);
            }
            let first = ordered[0].clone();
            let first_family = first.get("familyId").cloned().unwrap_or(Value::Null);
            let first_id = s(&first, "id").unwrap_or("").to_string();
            let second = ordered
                .iter()
                .find(|c| c.get("familyId").cloned().unwrap_or(Value::Null) != first_family)
                .or_else(|| ordered.iter().find(|c| s(c, "id").unwrap_or("") != first_id))
                .cloned();
            picks.push(first);
            if let Some(sec) = second {
                picks.push(sec);
            }
        }
        picks
    };

    let mut excluded: HashSet<String> = HashSet::new();
    let mut picks = pick_round(0, &excluded);
    for round in 1..=reroll {
        for p in &picks {
            excluded.insert(s(p, "id").unwrap_or("").to_string());
        }
        picks = pick_round(round, &excluded);
    }
    Ok(ChallengerSelection { approved, picks })
}

#[derive(Clone)]
pub struct CompositionMatch {
    pub grain: Option<String>,
    pub at_grain: Option<usize>,
    pub grain_available: Option<usize>,
    pub platform: Option<String>,
    pub platform_excluded: usize,
}

pub struct CompositionSelection {
    pub picks: Vec<Value>,
    pub match_: CompositionMatch,
}

fn empty_match(grain: Option<&str>, platform: Option<&str>, platform_excluded: usize) -> CompositionMatch {
    CompositionMatch {
        grain: grain.map(|g| g.to_string()),
        at_grain: grain.map(|_| 0),
        grain_available: grain.map(|_| 0),
        platform: platform.map(|p| p.to_string()),
        platform_excluded,
    }
}

/// JS: selectApprovedCompositions
pub fn select_approved_compositions(
    scope: &str,
    key: &str,
    reroll: usize,
    mode: Option<&str>,
    grain: Option<&str>,
    platform: Option<&str>,
    compositions: &[Value],
    count: usize,
) -> CompositionSelection {
    let mut approved: Vec<Value> = compositions.iter().filter(|c| s(c, "status") == Some("approved")).cloned().collect();
    let broad: Vec<Value> = approved.iter().filter(|c| review_field(c, "breadth").and_then(|b| b.as_str()) != Some("niche")).cloned().collect();
    if !broad.is_empty() {
        approved = broad;
    }
    if approved.is_empty() {
        return CompositionSelection { picks: vec![], match_: empty_match(grain, platform, 0) };
    }
    if let Some(mode) = mode {
        let matching: Vec<Value> = approved.iter().filter(|c| s(c, "surface") == Some(mode)).cloned().collect();
        if matching.is_empty() {
            return CompositionSelection { picks: vec![], match_: empty_match(grain, platform, 0) };
        }
        approved = matching;
    }
    let mut platform_excluded = 0;
    if let Some(platform) = platform {
        let survives: Vec<Value> = approved
            .iter()
            .filter(|c| match c.get("platforms").and_then(|p| p.as_array()) {
                Some(a) if !a.is_empty() => a.iter().any(|p| p.as_str() == Some(platform)),
                _ => true,
            })
            .cloned()
            .collect();
        platform_excluded = approved.len() - survives.len();
        approved = survives;
        if approved.is_empty() {
            return CompositionSelection { picks: vec![], match_: empty_match(grain, Some(platform), platform_excluded) };
        }
    }
    let mut prior: HashSet<String> = HashSet::new();
    let mut picks: Vec<Value> = Vec::new();
    for round in 0..=reroll {
        let available: Vec<Value> = approved.iter().filter(|c| !prior.contains(s(c, "id").unwrap_or(""))).cloned().collect();
        let base = if available.len() >= count.min(approved.len()) { available } else { approved.clone() };
        let mut tickets = composition_tickets(&base);
        if tickets.is_empty() {
            tickets = base.iter().map(|c| Ticket { item: c.clone(), ticket: 0 }).collect();
        }
        let salt = if round == 0 { format!("{}:{}:staging", scope, key) } else { format!("{}:{}:staging:reroll-{}", scope, key, round) };
        let ranked: Vec<Value> = rank(&tickets, &salt, |e| format!("{}#{}", s(&e.item, "id").unwrap_or(""), e.ticket))
            .into_iter()
            .map(|e| e.item)
            .collect();
        let ordered: Vec<Value> = match grain {
            Some(g) => {
                let mut o: Vec<Value> = ranked.iter().filter(|c| s(c, "grain") == Some(g)).cloned().collect();
                o.extend(ranked.iter().filter(|c| s(c, "grain") != Some(g)).cloned());
                o
            }
            None => ranked,
        };
        let mut families: HashSet<String> = HashSet::new();
        picks = Vec::new();
        for c in &ordered {
            let family = match c.get("familyId") {
                Some(Value::Null) | None => s(c, "id").unwrap_or("").to_string(),
                Some(Value::String(f)) => f.clone(),
                Some(v) => serde_json::to_string(v).unwrap_or_default(),
            };
            if families.contains(&family) {
                continue;
            }
            picks.push(c.clone());
            families.insert(family);
            if picks.len() >= count {
                break;
            }
        }
        for c in &ordered {
            if picks.len() >= count {
                break;
            }
            let cid = s(c, "id").unwrap_or("");
            if !picks.iter().any(|p| s(p, "id").unwrap_or("") == cid) {
                picks.push(c.clone());
            }
        }
        if round < reroll {
            for p in &picks {
                prior.insert(s(p, "id").unwrap_or("").to_string());
            }
        }
    }
    let at_grain = grain.map(|g| picks.iter().filter(|c| s(c, "grain") == Some(g)).count());
    CompositionSelection {
        match_: CompositionMatch {
            grain: grain.map(|g| g.to_string()),
            at_grain,
            grain_available: grain.map(|g| approved.iter().filter(|c| s(c, "grain") == Some(g)).count()),
            platform: platform.map(|p| p.to_string()),
            platform_excluded,
        },
        picks,
    }
}
