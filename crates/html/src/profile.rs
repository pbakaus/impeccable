//! Port of the profiler hooks the static engine emits
//! (`cli/engine/profile/profiler.mjs`: `profileStep`, `profileFindings`,
//! `recordProfileEvent`). The engine records events into any
//! [`ProfileSink`] the caller passes; without one nothing is measured.

use std::time::Instant;

/// One normalized profile event (`recordProfileEvent`).
#[derive(Debug, Clone, PartialEq)]
pub struct ProfileEvent {
    pub engine: String,
    pub phase: String,
    pub rule_id: String,
    pub target: String,
    pub ms: f64,
    pub findings: usize,
    /// Present only when the caller supplied one.
    pub detail: Option<String>,
    /// De-duplicated finding ids of a `profileFindings` step (empty when none).
    pub finding_ids: Vec<String>,
}

/// Where profile events go. `profile.record(event)` in JS.
pub trait ProfileSink {
    fn record(&self, event: ProfileEvent);
}

impl<F: Fn(ProfileEvent)> ProfileSink for F {
    fn record(&self, event: ProfileEvent) {
        self(event)
    }
}

/// A `Vec`-backed sink (`{ events: [] }`).
#[derive(Default)]
pub struct VecSink(pub std::cell::RefCell<Vec<ProfileEvent>>);

impl ProfileSink for VecSink {
    fn record(&self, event: ProfileEvent) {
        self.0.borrow_mut().push(event);
    }
}

/// The identifying part of an event.
#[derive(Debug, Clone)]
pub struct Meta<'a> {
    pub engine: &'a str,
    pub phase: &'a str,
    pub rule_id: &'a str,
    pub target: &'a str,
    pub detail: Option<&'a str>,
}

impl<'a> Meta<'a> {
    pub fn new(phase: &'a str, rule_id: &'a str, target: &'a str) -> Self {
        Meta {
            engine: "static-html",
            phase,
            rule_id,
            target,
            detail: None,
        }
    }
    pub fn with_detail(mut self, detail: &'a str) -> Self {
        self.detail = Some(detail);
        self
    }
    fn event(&self, ms: f64, findings: usize, finding_ids: Vec<String>) -> ProfileEvent {
        ProfileEvent {
            engine: self.engine.to_string(),
            phase: self.phase.to_string(),
            rule_id: self.rule_id.to_string(),
            target: self.target.to_string(),
            ms,
            findings,
            detail: self.detail.map(|d| d.to_string()),
            finding_ids,
        }
    }
}

fn elapsed_ms(start: Instant) -> f64 {
    start.elapsed().as_secs_f64() * 1000.0
}

/// JS `profileStep(profile, meta, callback)`.
pub fn step<T>(profile: Option<&dyn ProfileSink>, meta: Meta<'_>, f: impl FnOnce() -> T) -> T {
    match profile {
        None => f(),
        Some(sink) => {
            let started = Instant::now();
            let out = f();
            sink.record(meta.event(elapsed_ms(started), 0, Vec::new()));
            out
        }
    }
}

/// JS `profileFindings(profile, meta, callback)` for callbacks that return
/// a list of findings with an id (`extractFindingIds`).
pub fn findings<T>(
    profile: Option<&dyn ProfileSink>,
    meta: Meta<'_>,
    id_of: impl Fn(&T) -> &str,
    f: impl FnOnce() -> Vec<T>,
) -> Vec<T> {
    match profile {
        None => f(),
        Some(sink) => {
            let started = Instant::now();
            let out = f();
            let mut ids: Vec<String> = Vec::new();
            for item in &out {
                let id = id_of(item);
                if !id.is_empty() && !ids.iter().any(|i| i == id) {
                    ids.push(id.to_string());
                }
            }
            sink.record(meta.event(elapsed_ms(started), out.len(), ids));
            out
        }
    }
}

/// JS `recordProfileEvent(profile, { ...meta, ms: 0, findings: 0 })`.
pub fn record(profile: Option<&dyn ProfileSink>, meta: Meta<'_>) {
    if let Some(sink) = profile {
        sink.record(meta.event(0.0, 0, Vec::new()));
    }
}
