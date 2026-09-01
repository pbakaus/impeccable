//! Port of `cli/engine/profile/profiler.mjs`. Library only: no CLI flag
//! exposes it (the JS has no `--profile` either). Engines record one event
//! per rule/phase when a profile is passed programmatically;
//! `summarize_detector_profile` groups them the way the JS does.

use std::cell::RefCell;
use std::time::Instant;

use impeccable_core::js::to_fixed;
use serde::Serialize;

/// JS `recordProfileEvent` normalized event.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ProfileEvent {
    pub engine: String,
    pub phase: String,
    #[serde(rename = "ruleId")]
    pub rule_id: String,
    pub target: String,
    #[serde(with = "impeccable_core::js::json_number")]
    pub ms: f64,
    #[serde(with = "impeccable_core::js::json_number")]
    pub findings: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(rename = "findingIds", skip_serializing_if = "Option::is_none")]
    pub finding_ids: Option<Vec<String>>,
}

/// JS `createDetectorProfile()` → `{ events: [] }`.
#[derive(Debug, Default)]
pub struct DetectorProfile {
    pub events: RefCell<Vec<ProfileEvent>>,
}

/// The `{ engine, phase, ruleId, target }` meta passed to `profileFindings`.
#[derive(Debug, Clone, Copy)]
pub struct ProfileMeta<'a> {
    pub engine: &'a str,
    pub phase: &'a str,
    pub rule_id: &'a str,
    pub target: &'a str,
}

impl DetectorProfile {
    pub fn new() -> Self {
        Self::default()
    }

    /// JS `recordProfileEvent(profile, event)`.
    pub fn record(&self, meta: ProfileMeta, ms: f64, findings: usize, finding_ids: Vec<String>) {
        let normalized = ProfileEvent {
            engine: or_unknown(meta.engine),
            phase: or_unknown(meta.phase),
            rule_id: or_unknown(meta.rule_id),
            target: meta.target.to_string(),
            ms: if ms.is_finite() { ms } else { 0.0 },
            findings: findings as f64,
            detail: None,
            finding_ids: if finding_ids.is_empty() {
                None
            } else {
                Some(finding_ids)
            },
        };
        self.events.borrow_mut().push(normalized);
    }
}

fn or_unknown(s: &str) -> String {
    if s.is_empty() {
        "unknown".to_string()
    } else {
        s.to_string()
    }
}

/// JS `extractFindingIds(findings)`: unique ids in first-seen order.
pub fn extract_finding_ids<'a>(ids: impl Iterator<Item = &'a str>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for id in ids {
        if !id.is_empty() && !out.iter().any(|x| x == id) {
            out.push(id.to_string());
        }
    }
    out
}

/// JS `profileFindings(profile, meta, callback)`: time a rule and record the
/// finding count and ids. `id_of` extracts a finding's id.
pub fn profile_findings<T>(
    profile: Option<&DetectorProfile>,
    meta: ProfileMeta,
    id_of: impl Fn(&T) -> &str,
    callback: impl FnOnce() -> Vec<T>,
) -> Vec<T> {
    let Some(profile) = profile else {
        return callback();
    };
    let started = Instant::now();
    let findings = callback();
    let ms = started.elapsed().as_secs_f64() * 1000.0;
    let ids = extract_finding_ids(findings.iter().map(&id_of));
    profile.record(meta, ms, findings.len(), ids);
    findings
}

/// JS `profileStep(profile, meta, callback)`: time a step with no findings.
pub fn profile_step<T>(
    profile: Option<&DetectorProfile>,
    meta: ProfileMeta,
    callback: impl FnOnce() -> T,
) -> T {
    let Some(profile) = profile else {
        return callback();
    };
    let started = Instant::now();
    let out = callback();
    let ms = started.elapsed().as_secs_f64() * 1000.0;
    profile.record(meta, ms, 0, vec![]);
    out
}

/// One row of `summarizeDetectorProfile`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ProfileSummary {
    pub engine: String,
    pub phase: String,
    #[serde(rename = "ruleId")]
    pub rule_id: String,
    pub target: String,
    #[serde(with = "impeccable_core::js::json_number")]
    pub calls: f64,
    #[serde(rename = "totalMs", with = "impeccable_core::js::json_number")]
    pub total_ms: f64,
    #[serde(rename = "avgMs", with = "impeccable_core::js::json_number")]
    pub avg_ms: f64,
    #[serde(with = "impeccable_core::js::json_number")]
    pub p50: f64,
    #[serde(with = "impeccable_core::js::json_number")]
    pub p95: f64,
    #[serde(with = "impeccable_core::js::json_number")]
    pub findings: f64,
}

fn percentile(sorted: &[f64], pct: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let n = sorted.len() as f64;
    let idx = ((pct / 100.0) * n).ceil() - 1.0;
    let idx = idx.max(0.0).min(n - 1.0) as usize;
    sorted[idx]
}

fn round3(v: f64) -> f64 {
    impeccable_core::js::parse_float(&to_fixed(v, 3))
}

/// JS `summarizeDetectorProfile(profile)`.
pub fn summarize_detector_profile(profile: &DetectorProfile) -> Vec<ProfileSummary> {
    struct Group {
        engine: String,
        phase: String,
        rule_id: String,
        target: String,
        calls: f64,
        total_ms: f64,
        findings: f64,
        samples: Vec<f64>,
    }
    let mut groups: Vec<(String, Group)> = Vec::new();
    for event in profile.events.borrow().iter() {
        let key = format!(
            "{}\0{}\0{}\0{}",
            event.engine, event.phase, event.rule_id, event.target
        );
        let idx = match groups.iter().position(|(k, _)| *k == key) {
            Some(i) => i,
            None => {
                groups.push((
                    key,
                    Group {
                        engine: event.engine.clone(),
                        phase: event.phase.clone(),
                        rule_id: event.rule_id.clone(),
                        target: event.target.clone(),
                        calls: 0.0,
                        total_ms: 0.0,
                        findings: 0.0,
                        samples: vec![],
                    },
                ));
                groups.len() - 1
            }
        };
        let g = &mut groups[idx].1;
        let ms = if event.ms.is_finite() { event.ms } else { 0.0 };
        g.calls += 1.0;
        g.total_ms += ms;
        g.findings += if event.findings.is_finite() {
            event.findings
        } else {
            0.0
        };
        g.samples.push(ms);
    }
    let mut out: Vec<ProfileSummary> = groups
        .into_iter()
        .map(|(_, mut g)| {
            g.samples
                .sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            ProfileSummary {
                engine: g.engine,
                phase: g.phase,
                rule_id: g.rule_id,
                target: g.target,
                calls: g.calls,
                total_ms: round3(g.total_ms),
                avg_ms: round3(g.total_ms / g.calls),
                p50: round3(percentile(&g.samples, 50.0)),
                p95: round3(percentile(&g.samples, 95.0)),
                findings: g.findings,
            }
        })
        .collect();
    // Stable sort by totalMs desc (JS Array.prototype.sort is stable).
    out.sort_by(|a, b| {
        b.total_ms
            .partial_cmp(&a.total_ms)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    out
}
