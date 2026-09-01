//! JS: live-server.mjs, the in-memory session state and queue mechanics:
//! pending events, parked polls, SSE clients, leases and their timers, agent
//! phases, manual-edit activity. Routes live in `live_server`; the manual
//! apply controller in `manual_edits::apply`.

use crate::manifests::RootsManifest;
use crate::paths::live_dir;
use crate::preflight::{build_generation_preflight, compact_error};
use crate::session::{SessionStore, GENERATION_FENCED_SESSION_PHASES};
use crate::util::{iso_now, jsp, now_ms, Env};
use crate::vocabulary::VARIANT_PROGRESS_CHECKPOINT_REASONS;
use impeccable_context::target_args::TargetOptions;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};

pub const DEFAULT_POLL_TIMEOUT: i64 = 600_000;
pub const SSE_HEARTBEAT_INTERVAL_MS: u64 = 30_000;
pub const CHAT_POLL_FRESHNESS_MS: i64 = 60_000;
pub const POLL_LEASE_EXPIRY_TIMER_GRACE_MS: i64 = 2;
pub const EXIT_TIMER_MS: u64 = 8000;
pub const PREFLIGHT_TIMEOUT_MS: u64 = 15_000;

pub struct PendingEntry {
    pub event: Map<String, Value>,
    pub lease_until: i64,
    pub seq: i64,
}

pub struct ParkedPoll {
    pub id: u64,
    pub tx: Sender<Value>,
    pub lease_ms: i64,
    pub types: Option<Vec<String>>,
}

pub struct SseClient {
    pub id: u64,
    pub tx: Sender<String>,
}

/// One pre-apply file snapshot entry (`{ exists, content }`).
#[derive(Clone, Debug)]
pub struct FileSnapshot {
    pub exists: bool,
    pub content: String,
}

pub struct ApplyDeferred {
    pub tx: Sender<Result<Value, String>>,
    pub event: Map<String, Value>,
    pub batch: Value,
    pub page_url: Value,
    pub rollback_snapshot: Vec<(String, FileSnapshot)>,
    pub cwd: String,
    pub timer_gen: u64,
}

pub struct TimedOutApply {
    pub batch: Value,
    pub rollback_snapshot: Vec<(String, FileSnapshot)>,
    pub cwd: String,
}

pub struct ServerState {
    pub token: String,
    pub port: i64,
    pub cwd: String,
    pub env: Env,
    pub roots: Option<RootsManifest>,
    pub sse_clients: Vec<SseClient>,
    pub pending_events: Vec<PendingEntry>,
    pub pending_polls: Vec<ParkedPoll>,
    pub next_event_seq: i64,
    pub last_agent_polling_broadcast: Option<bool>,
    pub exit_timer_gen: u64,
    pub exit_timer_active: bool,
    pub session_dir: Option<String>,
    pub store: SessionStore,
    pub lease_timer_gen: u64,
    pub lease_timer_active: bool,
    pub manual_edit_activity: Option<Value>,
    pub next_manual_edit_seq: i64,
    pub pending_apply_deferreds: Vec<(String, ApplyDeferred)>,
    pub last_poll_at: i64,
    pub timed_out_apply_ids: Vec<(String, TimedOutApply)>,
    pub next_poll_id: u64,
    pub next_client_id: u64,
    pub next_apply_timer_gen: u64,
    pub shutting_down: bool,
    /// Set once `shutdown` ran its cleanup (it may be invoked from the /stop
    /// handler and again by the accept loop).
    pub cleaned_up: bool,
    pub log_tx: Sender<(bool, String)>,
    pub debug_manual_edit_events: bool,
    pub self_ref: Weak<Mutex<ServerState>>,
    /// Preflight source-resolution cache: target signature -> source file.
    pub source_resolution_cache: HashMap<String, String>,
    pub detect_script: String,
}

pub type Shared = Arc<Mutex<ServerState>>;

pub fn now_i64() -> i64 {
    now_ms() as i64
}

pub fn lock(shared: &Shared) -> std::sync::MutexGuard<'_, ServerState> {
    match shared.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    }
}

/// JS: eventPriority(event)
pub fn event_priority(event: &Map<String, Value>) -> i64 {
    match event.get("type").and_then(|t| t.as_str()) {
        Some("accept") | Some("discard") | Some("exit") => 0,
        Some("manual_edit_apply") | Some("steer") | Some("carbonize_cleanup") => 1,
        Some("generate") => 2,
        _ => 3,
    }
}

fn is_leased_at(entry: &PendingEntry, now: i64) -> bool {
    entry.lease_until != 0 && entry.lease_until > now
}

/// JS: selectAvailablePendingEvent(entries, { now, types }) -> index
pub fn select_available_pending_event(
    entries: &[PendingEntry],
    now: i64,
    types: Option<&[String]>,
) -> Option<usize> {
    let mut best: Option<usize> = None;
    for (i, entry) in entries.iter().enumerate() {
        if is_leased_at(entry, now) {
            continue;
        }
        if let Some(allowed) = types {
            let ty = entry
                .event
                .get("type")
                .and_then(|t| t.as_str())
                .unwrap_or("");
            if !allowed.iter().any(|t| t == ty) {
                continue;
            }
        }
        match best {
            None => best = Some(i),
            Some(b) => {
                let (pb, sb) = (event_priority(&entries[b].event), entries[b].seq);
                let (pi, si) = (event_priority(&entry.event), entry.seq);
                if pi < pb || (pi == pb && si < sb) {
                    best = Some(i);
                }
            }
        }
    }
    best
}

fn ev_str<'a>(m: &'a Map<String, Value>, k: &str) -> Option<&'a str> {
    m.get(k).and_then(|v| v.as_str())
}

pub fn truthy(v: Option<&Value>) -> bool {
    crate::event_validation::truthy(v)
}

impl ServerState {
    pub fn log_out(&self, s: &str) {
        let _ = self.log_tx.send((false, s.to_string()));
    }
    pub fn log_err(&self, s: &str) {
        let _ = self.log_tx.send((true, s.to_string()));
    }

    /// JS: chatAgentLikelyActive()
    pub fn chat_agent_likely_active(&self) -> bool {
        if !self.pending_polls.is_empty() {
            return true;
        }
        if self.last_poll_at == 0 {
            return false;
        }
        now_i64() - self.last_poll_at < CHAT_POLL_FRESHNESS_MS
    }

    /// JS: enqueueEvent(event)
    pub fn enqueue_event(&mut self, mut event: Map<String, Value>) {
        strip_poller_owned_event_fields(&mut event);
        let id = event.get("id").filter(|v| truthy(Some(v))).cloned();
        if let Some(id) = &id {
            let ty = event.get("type").cloned().unwrap_or(Value::Null);
            let is_mount_failed = ty.as_str() == Some("variant_mount_failed");
            let dup = self.pending_events.iter().any(|entry| {
                entry.event.get("id") == Some(id)
                    && entry.event.get("type").cloned().unwrap_or(Value::Null) == ty
                    && (!is_mount_failed || entry.event.get("variant") == event.get("variant"))
            });
            if dup {
                return;
            }
        }
        let seq = self.next_event_seq;
        self.next_event_seq += 1;
        self.pending_events.push(PendingEntry {
            event,
            lease_until: 0,
            seq,
        });
        self.flush_pending_polls();
    }

    /// JS: restorePendingEventsFromStore()
    pub fn restore_pending_events_from_store(&mut self) {
        for snapshot in self.store.list_active_sessions() {
            if let Some(Value::Object(pe)) = snapshot.get("pendingEvent") {
                self.enqueue_event(pe.clone());
            }
        }
    }

    pub fn find_available_pending_event(&self, types: Option<&[String]>) -> Option<usize> {
        select_available_pending_event(&self.pending_events, now_i64(), types)
    }

    /// JS: recordAgentPhase(id, phase, details)
    pub fn record_agent_phase(&mut self, id: &str, phase: &str, details: &[(&str, Value)]) {
        if id.is_empty() {
            return;
        }
        let mut event = Map::new();
        event.insert("type".into(), json!("agent_phase"));
        event.insert("id".into(), json!(id));
        event.insert("phase".into(), json!(phase));
        event.insert("at".into(), json!(now_i64()));
        for (k, v) in details {
            event.insert((*k).to_string(), v.clone());
        }
        let _ = self.store.append_event(&Value::Object(event.clone()));
        self.broadcast(&Value::Object(event));
    }

    /// JS: acknowledgePendingEvent(id, sourceEventType) -> acknowledged event
    pub fn acknowledge_pending_event(
        &mut self,
        id: Option<&str>,
        source_event_type: Option<&str>,
    ) -> Option<Map<String, Value>> {
        let id = id.filter(|s| !s.is_empty())?;
        let idx = self.pending_events.iter().position(|entry| {
            ev_str(&entry.event, "id") == Some(id)
                && (source_event_type.is_none()
                    || ev_str(&entry.event, "type") == source_event_type)
        })?;
        let acknowledged = self.pending_events.remove(idx).event;
        self.schedule_lease_flush();
        self.broadcast_agent_polling_if_changed();
        Some(acknowledged)
    }

    /// JS: releasePendingEvent(id, sourceEventType)
    pub fn release_pending_event(
        &mut self,
        id: Option<&str>,
        source_event_type: Option<&str>,
    ) -> Option<Map<String, Value>> {
        let id = id?;
        let entry = self.pending_events.iter_mut().find(|entry| {
            ev_str(&entry.event, "id") == Some(id)
                && (source_event_type.is_none()
                    || ev_str(&entry.event, "type") == source_event_type)
        })?;
        entry.lease_until = 0;
        let ev = entry.event.clone();
        self.schedule_lease_flush();
        Some(ev)
    }

    /// JS: retirePendingGeneration(id)
    pub fn retire_pending_generation(&mut self, id: Option<&str>) -> usize {
        let Some(id) = id.filter(|s| !s.is_empty()) else {
            return 0;
        };
        let before = self.pending_events.len();
        self.pending_events.retain(|entry| {
            !(ev_str(&entry.event, "id") == Some(id)
                && ev_str(&entry.event, "type") == Some("generate"))
        });
        let retired = before - self.pending_events.len();
        if retired > 0 {
            self.schedule_lease_flush();
            self.broadcast_agent_polling_if_changed();
        }
        retired
    }

    /// JS: findPendingEventById(id, sourceEventType)
    pub fn find_pending_event_by_id(
        &self,
        id: Option<&str>,
        source_event_type: Option<&str>,
    ) -> Option<&Map<String, Value>> {
        let id = id.filter(|s| !s.is_empty())?;
        self.pending_events
            .iter()
            .find(|entry| {
                ev_str(&entry.event, "id") == Some(id)
                    && (source_event_type.is_none()
                        || ev_str(&entry.event, "type") == source_event_type)
            })
            .map(|e| &e.event)
    }

    /// JS: cancelQueuedAnonymousExitEvents()
    pub fn cancel_queued_anonymous_exit_events(&mut self) -> usize {
        let before = self.pending_events.len();
        self.pending_events.retain(|entry| {
            !(ev_str(&entry.event, "type") == Some("exit") && !truthy(entry.event.get("id")))
        });
        let removed = before - self.pending_events.len();
        if removed > 0 {
            self.schedule_lease_flush();
            self.broadcast_agent_polling_if_changed();
        }
        removed
    }

    /// JS: scheduleLeaseFlush()
    pub fn schedule_lease_flush(&mut self) {
        // clearTimeout
        self.lease_timer_gen += 1;
        self.lease_timer_active = false;
        let now = now_i64();
        let next = self
            .pending_events
            .iter()
            .map(|e| e.lease_until)
            .filter(|l| *l > now)
            .min();
        let Some(next) = next else {
            return;
        };
        let gen = self.lease_timer_gen;
        self.lease_timer_active = true;
        let delay = (next - now + POLL_LEASE_EXPIRY_TIMER_GRACE_MS).max(0) as u64;
        let weak = self.self_ref.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(delay));
            if let Some(shared) = weak.upgrade() {
                let mut st = lock(&shared);
                if st.lease_timer_active && st.lease_timer_gen == gen {
                    st.lease_timer_active = false;
                    st.flush_pending_polls();
                    st.broadcast_agent_polling_if_changed();
                }
            }
        });
    }

    /// JS: flushPendingPolls(). Leases run on their own thread (the JS
    /// resolved the poll when the async lease settled).
    pub fn flush_pending_polls(&mut self) {
        let mut changed = false;
        loop {
            if self.pending_polls.is_empty() {
                break;
            }
            let mut found: Option<(usize, usize)> = None;
            let now = now_i64();
            for (pi, poll) in self.pending_polls.iter().enumerate() {
                if let Some(ei) =
                    select_available_pending_event(&self.pending_events, now, poll.types.as_deref())
                {
                    found = Some((pi, ei));
                    break;
                }
            }
            let Some((pi, ei)) = found else {
                self.schedule_lease_flush();
                self.broadcast_agent_polling_if_changed();
                return;
            };
            let poll = self.pending_polls.remove(pi);
            // Claim synchronously (JS: entry.leaseUntil set before any await).
            let lease_ms = poll.lease_ms;
            self.pending_events[ei].lease_until = now_i64() + lease_ms;
            let entry_seq = self.pending_events[ei].seq;
            let entry_event = self.pending_events[ei].event.clone();
            let weak = self.self_ref.clone();
            std::thread::spawn(move || {
                let Some(shared) = weak.upgrade() else {
                    return;
                };
                let event = lease_event(&shared, entry_seq, entry_event, lease_ms);
                {
                    let mut st = lock(&shared);
                    st.last_poll_at = now_i64();
                }
                let _ = poll.tx.send(Value::Object(event));
            });
            changed = true;
        }
        self.schedule_lease_flush();
        if changed {
            self.broadcast_agent_polling_if_changed();
        }
    }

    /// JS: agentPollingConnected()
    pub fn agent_polling_connected(&self) -> bool {
        !self.pending_polls.is_empty()
    }

    /// JS: broadcastAgentPollingIfChanged()
    pub fn broadcast_agent_polling_if_changed(&mut self) {
        let connected = self.agent_polling_connected();
        if self.last_agent_polling_broadcast == Some(connected) {
            return;
        }
        self.last_agent_polling_broadcast = Some(connected);
        self.broadcast(&json!({ "type": "agent_polling", "connected": connected }));
    }

    /// JS: broadcast(msg)
    pub fn broadcast(&mut self, msg: &Value) {
        let data = format!(
            "data: {}\n\n",
            serde_json::to_string(msg).unwrap_or_else(|_| "null".into())
        );
        for client in &self.sse_clients {
            let _ = client.tx.send(data.clone());
        }
    }

    /// JS: recordManualEditActivity(type, details)
    pub fn record_manual_edit_activity(&mut self, ty: &str, details: Map<String, Value>) -> Value {
        let mut entry = Map::new();
        entry.insert("seq".into(), json!(self.next_manual_edit_seq));
        self.next_manual_edit_seq += 1;
        entry.insert("type".into(), json!(ty));
        entry.insert("ts".into(), json!(iso_now()));
        for (k, v) in details {
            entry.insert(k, v);
        }
        let v = Value::Object(entry);
        self.manual_edit_activity = Some(v.clone());
        if self.debug_manual_edit_events {
            let file = jsp::join(&[&live_dir(&self.cwd, &self.env), "manual-edit-events.jsonl"]);
            if let Some(parent) = std::path::Path::new(&file).parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            use std::io::Write;
            if let Ok(mut f) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&file)
            {
                let _ = f.write_all(
                    format!("{}\n", serde_json::to_string(&v).unwrap_or_default()).as_bytes(),
                );
            }
        }
        self.broadcast(&v);
        v
    }

    /// JS: getManualEditStatus()
    pub fn manual_edit_status(&self) -> Value {
        let (total, per_page) = crate::manual_edits::buffer::count_by_page(&self.cwd, &self.env);
        json!({
            "totalCount": total,
            "perPage": per_page,
            "lastActivity": self.manual_edit_activity.clone().unwrap_or(Value::Null),
        })
    }

    /// JS: summarizePendingEventForStatus(entry)
    pub fn summarize_pending_event_for_status(&self, entry: &PendingEntry) -> Value {
        let event = &entry.event;
        let mut s = Map::new();
        s.insert("id".into(), event.get("id").cloned().unwrap_or(Value::Null));
        s.insert(
            "type".into(),
            event.get("type").cloned().unwrap_or(Value::Null),
        );
        // JSON.stringify drops undefined: an event without id/type would
        // omit the key entirely.
        if !event.contains_key("id") {
            s.shift_remove("id");
        }
        if !event.contains_key("type") {
            s.shift_remove("type");
        }
        s.insert("leased".into(), json!(is_leased_at(entry, now_i64())));
        s.insert(
            "leaseUntil".into(),
            if entry.lease_until != 0 {
                json!(entry.lease_until)
            } else {
                Value::Null
            },
        );
        if ev_str(event, "type") == Some("manual_edit_apply") {
            let or_null = |k: &str| match event.get(k) {
                Some(v) if truthy(Some(v)) => v.clone(),
                _ => Value::Null,
            };
            s.insert("pageUrl".into(), or_null("pageUrl"));
            s.insert("chunk".into(), or_null("chunk"));
            s.insert("repair".into(), or_null("repair"));
            s.insert("evidencePath".into(), or_null("evidencePath"));
            let agent_action = match event.get("agentAction") {
                Some(v) if truthy(Some(v)) => v.clone(),
                _ => {
                    crate::manual_edits::apply::build_manual_apply_agent_action(ev_str(event, "id"))
                }
            };
            s.insert("agentAction".into(), agent_action);
            let id = ev_str(event, "id").unwrap_or("");
            let deferred_batch = self
                .pending_apply_deferreds
                .iter()
                .find(|(k, _)| k == id)
                .map(|(_, d)| d.batch.clone())
                .filter(|b| truthy(Some(b)));
            let batch = deferred_batch
                .unwrap_or_else(|| event.get("batch").cloned().unwrap_or(Value::Null));
            s.insert(
                "manualApplySummary".into(),
                crate::manual_edits::apply::summarize_manual_apply_event(event, &batch, &self.cwd),
            );
        }
        Value::Object(s)
    }

    /// JS: activeSessionSummaries()
    pub fn active_session_summaries(&self) -> Vec<Value> {
        self.store
            .list_active_sessions()
            .iter()
            .map(summarize_active_session_for_client)
            .collect()
    }

    /// JS: the /events GET handler's timer arming: after the last SSE client
    /// leaves, queue an anonymous `exit` 8 s later if still nobody.
    pub fn arm_exit_timer(&mut self) {
        self.exit_timer_gen += 1;
        let gen = self.exit_timer_gen;
        self.exit_timer_active = true;
        let weak = self.self_ref.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(EXIT_TIMER_MS));
            if let Some(shared) = weak.upgrade() {
                let mut st = lock(&shared);
                if st.exit_timer_active && st.exit_timer_gen == gen {
                    st.exit_timer_active = false;
                    if st.sse_clients.is_empty() {
                        let mut ev = Map::new();
                        ev.insert("type".into(), json!("exit"));
                        st.enqueue_event(ev);
                    }
                }
            }
        });
    }

    pub fn clear_exit_timer(&mut self) {
        self.exit_timer_gen += 1;
        self.exit_timer_active = false;
    }

    /// Register a parked poll; returns (id, receiver).
    pub fn park_poll(
        &mut self,
        lease_ms: i64,
        types: Option<Vec<String>>,
    ) -> (u64, Receiver<Value>) {
        let (tx, rx) = channel();
        let id = self.next_poll_id;
        self.next_poll_id += 1;
        self.pending_polls.push(ParkedPoll {
            id,
            tx,
            lease_ms,
            types,
        });
        self.broadcast_agent_polling_if_changed();
        self.schedule_lease_flush();
        (id, rx)
    }

    /// Remove a parked poll by id; true when it was still parked.
    pub fn remove_poll(&mut self, id: u64) -> bool {
        let before = self.pending_polls.len();
        self.pending_polls.retain(|p| p.id != id);
        before != self.pending_polls.len()
    }

    /// Register an SSE client; returns (id, receiver).
    pub fn add_sse_client(&mut self) -> (u64, Receiver<String>, Sender<String>) {
        let (tx, rx) = channel();
        let id = self.next_client_id;
        self.next_client_id += 1;
        self.sse_clients.push(SseClient { id, tx: tx.clone() });
        (id, rx, tx)
    }

    /// Remove an SSE client; when none remain arm the exit timer (JS
    /// `req.on('close')`).
    pub fn remove_sse_client(&mut self, id: u64) {
        let before = self.sse_clients.len();
        self.sse_clients.retain(|c| c.id != id);
        if before != self.sse_clients.len() && self.sse_clients.is_empty() {
            self.clear_exit_timer();
            self.arm_exit_timer();
        }
    }

    /// JS: generationIsFenced(id)
    pub fn generation_is_fenced(&self, id: &str) -> bool {
        if id.is_empty() {
            return false;
        }
        match self.store.get_snapshot(id, true) {
            Ok(Some(s)) => s.get("generationCanceled") == Some(&Value::Bool(true)),
            _ => false,
        }
    }

    /// JS: generationPhaseAlreadyRecorded(id, phase)
    pub fn generation_phase_already_recorded(&self, id: &str, phase: &str) -> bool {
        match self.store.get_snapshot(id, true) {
            Ok(Some(s)) => s
                .get("generationTimings")
                .and_then(|t| t.get(phase))
                .map(|v| truthy(Some(v)))
                .unwrap_or(false),
            _ => false,
        }
    }

    /// JS: recordGenerationCheckpoint(event)
    pub fn record_generation_checkpoint(&mut self, event: &Map<String, Value>) {
        let Some(id) = ev_str(event, "id")
            .filter(|s| !s.is_empty())
            .map(String::from)
        else {
            return;
        };
        if ev_str(event, "type") != Some("checkpoint") {
            return;
        }
        if self.generation_is_fenced(&id) {
            return;
        }
        let reason = ev_str(event, "reason").unwrap_or("");
        if !VARIANT_PROGRESS_CHECKPOINT_REASONS.contains(&reason) {
            return;
        }
        let arrived = crate::util::js_number(event.get("arrivedVariants")).unwrap_or(0.0);
        let expected = crate::util::js_number(event.get("expectedVariants")).unwrap_or(0.0);
        if arrived <= 0.0 || expected <= 0.0 {
            return;
        }
        let preview_mode = match event.get("previewMode") {
            Some(v) if truthy(Some(v)) => v.clone(),
            _ => json!("source"),
        };
        let preview_file = match event.get("previewFile") {
            Some(v) if truthy(Some(v)) => Some(v.clone()),
            _ => event.get("file").filter(|v| truthy(Some(v))).cloned(),
        };
        if let Some(pf) = &preview_file {
            let mut msg = Map::new();
            msg.insert("type".into(), json!("variant_progress"));
            msg.insert("id".into(), json!(id));
            msg.insert("file".into(), pf.clone());
            let source_file = match event.get("sourceFile") {
                Some(v) if truthy(Some(v)) => Some(v.clone()),
                _ => {
                    if preview_mode.as_str() == Some("source") {
                        Some(pf.clone())
                    } else {
                        None
                    }
                }
            };
            if let Some(sf) = source_file {
                msg.insert("sourceFile".into(), sf);
            }
            msg.insert("previewFile".into(), pf.clone());
            msg.insert("previewMode".into(), preview_mode.clone());
            msg.insert("arrivedVariants".into(), crate::util::js_num(arrived));
            msg.insert("expectedVariants".into(), crate::util::js_num(expected));
            msg.insert(
                "publicationKind".into(),
                match event.get("publicationKind") {
                    Some(v) if truthy(Some(v)) => v.clone(),
                    _ => json!("variants"),
                },
            );
            self.broadcast(&Value::Object(msg));
        }
        let at = now_i64();
        let details = |at: i64| -> Vec<(&'static str, Value)> {
            vec![
                ("arrivedVariants", crate::util::js_num(arrived)),
                ("expectedVariants", crate::util::js_num(expected)),
                (
                    "checkpointReason",
                    match event.get("reason") {
                        Some(v) if truthy(Some(v)) => v.clone(),
                        _ => Value::Null,
                    },
                ),
                ("at", json!(at)),
            ]
        };
        if !self.generation_phase_already_recorded(&id, "first_reviewable") {
            self.record_agent_phase(&id, "first_reviewable", &details(at));
        }
        if arrived >= 2.0
            && expected >= 3.0
            && !self.generation_phase_already_recorded(&id, "second_reviewable")
        {
            self.record_agent_phase(&id, "second_reviewable", &details(at));
        }
        if arrived >= expected && !self.generation_phase_already_recorded(&id, "all_variants_ready")
        {
            self.record_agent_phase(&id, "all_variants_ready", &details(at));
        }
    }

    /// JS: detectMissedGenerationCompletion(event)
    pub fn detect_missed_generation_completion(&self, event: &Map<String, Value>) -> Option<Value> {
        let id = ev_str(event, "id").filter(|s| !s.is_empty())?;
        if ev_str(event, "type") != Some("checkpoint") {
            return None;
        }
        if ev_str(event, "phase") != Some("generating") {
            return None;
        }
        let arrived = crate::util::js_number(event.get("arrivedVariants")).unwrap_or(0.0);
        let expected = crate::util::js_number(event.get("expectedVariants")).unwrap_or(0.0);
        let behind = arrived <= 0.0 || (expected > 0.0 && arrived < expected);
        if !behind {
            return None;
        }
        let snapshot = self.store.get_snapshot(id, false).ok().flatten()?;
        missed_completion_from_snapshot(&snapshot)
    }
}

/// JS: missedCompletionFromSnapshot(snapshot)
pub fn missed_completion_from_snapshot(snapshot: &Map<String, Value>) -> Option<Value> {
    let id = snapshot.get("id").filter(|v| truthy(Some(v)))?;
    if !truthy(snapshot.get("generationCompletedAt")) {
        return None;
    }
    if truthy(snapshot.get("generationCanceled")) {
        return None;
    }
    let phase = snapshot.get("phase").and_then(|p| p.as_str()).unwrap_or("");
    if GENERATION_FENCED_SESSION_PHASES.contains(&phase) {
        return None;
    }
    let source_file = snapshot
        .get("sourceFile")
        .filter(|v| truthy(Some(v)))
        .cloned();
    let preview_file = snapshot
        .get("previewFile")
        .filter(|v| truthy(Some(v)))
        .cloned();
    let file = source_file.clone().or_else(|| preview_file.clone())?;
    let mut m = Map::new();
    m.insert("type".into(), json!("done"));
    m.insert("id".into(), id.clone());
    m.insert("file".into(), file);
    if let Some(sf) = source_file {
        m.insert("sourceFile".into(), sf);
    }
    if let Some(pf) = preview_file {
        m.insert("previewFile".into(), pf);
    }
    if let Some(pm) = snapshot.get("previewMode").filter(|v| truthy(Some(v))) {
        m.insert("previewMode".into(), pm.clone());
    }
    m.insert("redelivered".into(), json!(true));
    Some(Value::Object(m))
}

/// JS: summarizeActiveSessionForClient(snapshot)
pub fn summarize_active_session_for_client(snapshot: &Map<String, Value>) -> Value {
    let nn = |k: &str, d: Value| -> Value {
        match snapshot.get(k) {
            Some(v) if !v.is_null() => v.clone(),
            _ => d,
        }
    };
    let mut m = Map::new();
    if let Some(id) = snapshot.get("id") {
        m.insert("id".into(), id.clone());
    }
    if let Some(p) = snapshot.get("phase") {
        m.insert("phase".into(), p.clone());
    }
    m.insert("pageUrl".into(), nn("pageUrl", Value::Null));
    m.insert("sourceFile".into(), nn("sourceFile", Value::Null));
    m.insert("previewFile".into(), nn("previewFile", Value::Null));
    m.insert("previewMode".into(), nn("previewMode", Value::Null));
    m.insert("expectedVariants".into(), nn("expectedVariants", json!(0)));
    m.insert("arrivedVariants".into(), nn("arrivedVariants", json!(0)));
    m.insert("visibleVariant".into(), nn("visibleVariant", Value::Null));
    m.insert(
        "checkpointRevision".into(),
        nn("checkpointRevision", json!(0)),
    );
    let bcr = match snapshot.get("browserCheckpointRevision") {
        Some(v) if !v.is_null() => v.clone(),
        _ => nn("checkpointRevision", json!(0)),
    };
    m.insert("browserCheckpointRevision".into(), bcr);
    m.insert(
        "publicationCheckpointRevision".into(),
        nn("publicationCheckpointRevision", json!(0)),
    );
    m.insert(
        "paramValues".into(),
        match snapshot.get("paramValues") {
            Some(v) if truthy(Some(v)) => v.clone(),
            _ => json!({}),
        },
    );
    m.insert("generationPhase".into(), nn("generationPhase", Value::Null));
    m.insert(
        "generationCompletedAt".into(),
        nn("generationCompletedAt", Value::Null),
    );
    m.insert(
        "generationCanceled".into(),
        json!(snapshot.get("generationCanceled") == Some(&Value::Bool(true))),
    );
    m.insert("cancelReason".into(), nn("cancelReason", Value::Null));
    m.insert(
        "mountedVariants".into(),
        match snapshot.get("mountedVariants") {
            Some(v @ Value::Array(_)) => v.clone(),
            _ => json!([]),
        },
    );
    m.insert(
        "mountFailures".into(),
        match snapshot.get("mountFailures") {
            Some(v @ Value::Array(_)) => v.clone(),
            _ => json!([]),
        },
    );
    m.insert("renderState".into(), nn("renderState", Value::Null));
    Value::Object(m)
}

/// JS: leaseEvent(entry, leaseMs) after the synchronous claim: scaffold a
/// generate event (preflight subprocess), re-stamp the lease, record
/// delivery. `entry_event` is the claimed entry's event; the queue entry (by
/// seq) is updated when still present.
pub fn lease_event(
    shared: &Shared,
    seq: i64,
    entry_event: Map<String, Value>,
    lease_ms: i64,
) -> Map<String, Value> {
    let mut event = entry_event;
    prepare_generate_event_for_lease(shared, seq, &mut event);
    let mut st = lock(shared);
    if !truthy(event.get("id")) {
        st.pending_events.retain(|e| e.seq != seq);
        return event;
    }
    if let Some(entry) = st.pending_events.iter_mut().find(|e| e.seq == seq) {
        entry.lease_until = now_i64() + lease_ms;
    }
    // recordGenerateDelivery
    if ev_str(&event, "type") == Some("generate") && !truthy(event.get("generationReadyAt")) {
        let at = now_i64();
        event.insert("generationReadyAt".into(), json!(at));
        if let Some(entry) = st.pending_events.iter_mut().find(|e| e.seq == seq) {
            entry.event = event.clone();
        }
        let _ = st.store.append_event(&Value::Object(event.clone()));
        let id = ev_str(&event, "id").unwrap_or("").to_string();
        st.record_agent_phase(&id, "generation_ready", &[("at", json!(at))]);
    }
    st.schedule_lease_flush();
    st.broadcast_agent_polling_if_changed();
    event
}

/// JS: prepareGenerateEventForLease(entry)
fn prepare_generate_event_for_lease(shared: &Shared, seq: i64, event: &mut Map<String, Value>) {
    if ev_str(event, "type") != Some("generate") || truthy(event.get("scaffoldAttempted")) {
        return;
    }
    let id = ev_str(event, "id").unwrap_or("").to_string();
    let (cwd, env, cached) = {
        let mut st = lock(shared);
        st.record_agent_phase(&id, "picked_up", &[]);
        st.record_agent_phase(&id, "scaffolding", &[]);
        let sig = crate::preflight::target_signature(event);
        let cached = st.source_resolution_cache.get(&sig).cloned();
        (st.cwd.clone(), st.env.clone(), cached)
    };
    let result = run_generation_preflight(event, &cwd, &env, cached.as_deref());
    let mut st = lock(shared);
    match &result {
        PreflightOutcome::Skipped => {}
        PreflightOutcome::Ok {
            signature,
            resolved_source,
            ..
        } => {
            if let Some(src) = resolved_source {
                st.source_resolution_cache
                    .insert(signature.clone(), src.clone());
            }
        }
        PreflightOutcome::Err { signature, .. } => {
            st.source_resolution_cache.remove(signature);
        }
    }
    event.insert("scaffoldAttempted".into(), json!(true));
    let (ok, duration, preview_mode) = match &result {
        PreflightOutcome::Skipped => {
            event.insert("scaffoldDurationMs".into(), Value::Null);
            event.insert("scaffoldError".into(), json!("insufficient_locator"));
            (false, Value::Null, json!("source"))
        }
        PreflightOutcome::Ok {
            duration_ms,
            scaffold,
            ..
        } => {
            let d = crate::util::js_num(*duration_ms);
            event.insert("scaffoldDurationMs".into(), d.clone());
            event.insert("scaffold".into(), scaffold.clone());
            let pm = match scaffold.get("previewMode") {
                Some(v) if truthy(Some(v)) => v.clone(),
                _ => json!("source"),
            };
            (true, d, pm)
        }
        PreflightOutcome::Err {
            duration_ms, error, ..
        } => {
            let d = crate::util::js_num(*duration_ms);
            event.insert("scaffoldDurationMs".into(), d.clone());
            event.insert("scaffoldError".into(), json!(error));
            (false, d, json!("source"))
        }
    };
    if let Some(entry) = st.pending_events.iter_mut().find(|e| e.seq == seq) {
        entry.event = event.clone();
    }
    let _ = st.store.append_event(&Value::Object(event.clone()));
    st.record_agent_phase(
        &id,
        if ok {
            "source_ready"
        } else {
            "scaffold_fallback"
        },
        &[("durationMs", duration), ("previewMode", preview_mode)],
    );
}

pub enum PreflightOutcome {
    Skipped,
    Ok {
        signature: String,
        duration_ms: f64,
        scaffold: Value,
        resolved_source: Option<String>,
    },
    Err {
        signature: String,
        duration_ms: f64,
        error: String,
    },
}

/// JS: runGenerationPreflight(event, { cwd, scriptsDir }): spawns this binary's
/// `live-wrap` / `live-insert --defer-source-write` with a 15 s timeout.
pub fn run_generation_preflight(
    event: &Map<String, Value>,
    cwd: &str,
    env: &Env,
    cached_file: Option<&str>,
) -> PreflightOutcome {
    let Some(cmd) = build_generation_preflight(event, cached_file) else {
        return PreflightOutcome::Skipped;
    };
    let started = Instant::now();
    let exe = std::env::current_exe()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "impeccable".to_string());
    let mut child = match std::process::Command::new(&exe)
        .arg(cmd.verb)
        .args(&cmd.args)
        .current_dir(cwd)
        .env_clear()
        .envs(env)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            return PreflightOutcome::Err {
                signature: cmd.signature,
                duration_ms: elapsed_ms(started),
                error: compact_error("", Some(&e.to_string())),
            };
        }
    };
    let (out_tx, out_rx) = channel::<(Vec<u8>, Vec<u8>)>();
    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();
    std::thread::spawn(move || {
        use std::io::Read;
        let mut o = Vec::new();
        let mut e = Vec::new();
        let et = std::thread::spawn(move || {
            let mut e = Vec::new();
            if let Some(s) = stderr.as_mut() {
                let _ = s.read_to_end(&mut e);
            }
            e
        });
        if let Some(s) = stdout.as_mut() {
            let _ = s.read_to_end(&mut o);
        }
        if let Ok(v) = et.join() {
            e = v;
        }
        let _ = out_tx.send((o, e));
    });
    let deadline = Instant::now() + Duration::from_millis(PREFLIGHT_TIMEOUT_MS);
    let mut timed_out = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break Some(s),
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    timed_out = true;
                    break None;
                }
                std::thread::sleep(Duration::from_millis(5));
            }
            Err(_) => break None,
        }
    };
    let (stdout, stderr) = out_rx.recv().unwrap_or_default();
    let duration_ms = elapsed_ms(started);
    let stdout = String::from_utf8_lossy(&stdout).into_owned();
    let stderr = String::from_utf8_lossy(&stderr).into_owned();
    let success = matches!(status, Some(s) if s.success());
    if !success {
        // JS: execFile rejects with `Command failed: <cmd> <args>` (plus the
        // stderr, which compactError prefers when non-empty).
        let _ = timed_out;
        let message = format!(
            "Command failed: {} {} {}",
            exe,
            cmd.verb,
            cmd.args.join(" ")
        );
        return PreflightOutcome::Err {
            signature: cmd.signature,
            duration_ms,
            error: compact_error(&stderr, Some(&message)),
        };
    }
    let line = stdout
        .trim()
        .split('\n')
        .filter(|l| !l.is_empty())
        .last()
        .map(String::from);
    let Some(line) = line else {
        return PreflightOutcome::Err {
            signature: cmd.signature,
            duration_ms,
            error: compact_error("", Some("preflight returned no scaffold metadata")),
        };
    };
    let scaffold: Value = match serde_json::from_str(&line) {
        Ok(v) => v,
        Err(_) => {
            let msg = crate::json_error::json_parse_error(&line)
                .unwrap_or_else(|| "Unexpected token".to_string());
            return PreflightOutcome::Err {
                signature: cmd.signature,
                duration_ms,
                error: compact_error("", Some(&msg)),
            };
        }
    };
    let resolved_source = scaffold
        .get("sourceFile")
        .and_then(|v| v.as_str())
        .or_else(|| scaffold.get("file").and_then(|v| v.as_str()))
        .map(String::from);
    PreflightOutcome::Ok {
        signature: cmd.signature,
        duration_ms,
        scaffold,
        resolved_source,
    }
}

fn elapsed_ms(started: Instant) -> f64 {
    let d = started.elapsed();
    // performance.now() resolution: fractional milliseconds.
    (d.as_secs_f64() * 1000.0 * 1000.0).round() / 1000.0
}

/// JS: resolveProjectContext(): PRODUCT.md / DESIGN.md truth resolved per
/// request, roots manifest as fallback.
pub struct ProjectContext {
    pub has_product: bool,
    pub resolved_design_path: Option<String>,
    pub context_dir: String,
    pub design_context_dir: Option<String>,
}

pub fn resolve_project_context(
    cwd: &str,
    env: &Env,
    roots: Option<&RootsManifest>,
) -> ProjectContext {
    let ctx = impeccable_context::context::load_context(cwd, &TargetOptions::default(), env);
    let design_path = match &ctx.design_path {
        Some(p) => Some(jsp::resolve(cwd, &[p])),
        None => roots
            .and_then(|r| r.design_path.clone())
            .filter(|p| crate::util::exists(p)),
    };
    let has_product = ctx.has_product
        || roots
            .and_then(|r| r.product_path.as_deref())
            .map(crate::util::exists)
            .unwrap_or(false);
    let context_dir = if !ctx.context_dir.is_empty() {
        ctx.context_dir.clone()
    } else {
        roots
            .and_then(|r| r.context_root.clone())
            .unwrap_or_else(|| cwd.to_string())
    };
    let design_context_dir = ctx
        .design_context_dir
        .clone()
        .or_else(|| design_path.as_deref().map(jsp::dirname));
    ProjectContext {
        has_product,
        resolved_design_path: design_path,
        context_dir,
        design_context_dir,
    }
}

/// JS: live-server.mjs#stripPollerOwnedEventFields (#488) — `_instructions`,
/// `_completionAck`, and `_acceptResult` are owned by the poller: a
/// page-supplied value must never suppress or impersonate the locally
/// generated next step.
pub fn strip_poller_owned_event_fields(event: &mut Map<String, Value>) {
    for key in ["_instructions", "_completionAck", "_acceptResult"] {
        event.remove(key);
    }
}
