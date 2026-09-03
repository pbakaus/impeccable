//! Which [`Dom`] the exports run against: the live-page probe
//! ([`JsDom`]) by default, or a loaded [`SnapshotDom`] once
//! `snapshot_load` has been called (the extension's offscreen document,
//! where no page is reachable). One switch, so every export — the findings
//! run, serialization, hidden text, the visual-contrast decisions — is the
//! same code over either probe.

use crate::js_dom::JsDom;
use impeccable_core::browser::snapshot::{Facts, SnapshotDom};
use impeccable_core::browser::Dom;
use std::cell::RefCell;
use wasm_bindgen::prelude::*;

thread_local! {
    static SNAPSHOT: RefCell<Option<SnapshotDom>> = const { RefCell::new(None) };
}

/// Run `f` against the current probe.
pub fn with_dom<R>(f: impl FnOnce(&dyn Dom) -> R) -> R {
    SNAPSHOT.with(|s| {
        let guard = s.borrow();
        match guard.as_ref() {
            Some(d) => {
                d.reset_memo();
                f(d)
            }
            None => f(&JsDom::fresh()),
        }
    })
}

/// Load a page snapshot (JSON from `15-snapshot.js`) as the probe for every
/// following export call. Returns the element count, or `u32::MAX` when the
/// JSON did not parse (the previous snapshot, if any, is dropped either way).
#[wasm_bindgen]
pub fn snapshot_load(json: &str) -> u32 {
    let parsed = SnapshotDom::from_json(json);
    SNAPSHOT.with(|s| {
        let mut slot = s.borrow_mut();
        match parsed {
            Ok(d) => {
                let n = d.snap.len() as u32;
                *slot = Some(d);
                n
            }
            Err(_) => {
                *slot = None;
                u32::MAX
            }
        }
    })
}

/// Drop the loaded snapshot; exports go back to the live-page probe.
#[wasm_bindgen]
pub fn snapshot_clear() {
    SNAPSHOT.with(|s| *s.borrow_mut() = None);
}

/// Whether a snapshot is the current probe.
#[wasm_bindgen]
pub fn snapshot_loaded() -> bool {
    SNAPSHOT.with(|s| s.borrow().is_some())
}

/// Facts (`{ hits: [{ x, y, top, stack }] }`) answering an earlier
/// `snapshot_take_needs`.
#[wasm_bindgen]
pub fn snapshot_add_facts(json: &str) -> bool {
    let Ok(facts) = serde_json::from_str::<Facts>(json) else { return false };
    SNAPSHOT.with(|s| match s.borrow().as_ref() {
        Some(d) => {
            d.add_facts(&facts);
            true
        }
        None => false,
    })
}

/// Whether the calls since the last `snapshot_take_needs` asked something
/// the snapshot could not answer.
#[wasm_bindgen]
pub fn snapshot_has_needs() -> bool {
    SNAPSHOT.with(|s| s.borrow().as_ref().is_some_and(|d| d.has_needs()))
}

/// The pending questions as `{ hitTests: [[x, y], ...] }` (drained).
#[wasm_bindgen]
pub fn snapshot_take_needs() -> String {
    SNAPSHOT.with(|s| match s.borrow().as_ref() {
        Some(d) => serde_json::to_string(&d.take_needs()).unwrap_or_else(|_| "{}".into()),
        None => "{}".into(),
    })
}

/// Computed-style properties the rules asked for that the capture did not
/// record (a parity diagnostic; empty on a complete capture).
#[wasm_bindgen]
pub fn snapshot_unknown_style_props() -> String {
    SNAPSHOT.with(|s| match s.borrow().as_ref() {
        Some(d) => serde_json::to_string(&d.unknown_style_props()).unwrap_or_else(|_| "[]".into()),
        None => "[]".into(),
    })
}

/// One-shot: load `snapshot_json` and run `collectBrowserFindings` with
/// `config_json`. Returns `{ groups, pageLevel }` when the snapshot answered
/// everything, else `{ needs: { hitTests } }` — answer them (inline as
/// `hits` in the snapshot, or `snapshot_add_facts` + `collect_browser_findings`)
/// and run again. The snapshot stays loaded.
#[wasm_bindgen]
pub fn collect_findings_from_snapshot(snapshot_json: &str, config_json: &str) -> String {
    if snapshot_load(snapshot_json) == u32::MAX {
        return "{\"error\":\"snapshot did not parse\"}".into();
    }
    let config: impeccable_core::browser::BrowserConfig = serde_json::from_str(config_json).unwrap_or_default();
    SNAPSHOT.with(|s| {
        let guard = s.borrow();
        let d = guard.as_ref().expect("loaded");
        match impeccable_core::browser::snapshot::collect_findings_from_snapshot(d, &config) {
            Ok(out) => serde_json::to_string(&out).unwrap_or_else(|_| "{\"groups\":[],\"pageLevel\":[]}".into()),
            Err(needs) => serde_json::json!({ "needs": needs }).to_string(),
        }
    })
}

/// `node.parentElement || document.body` over the loaded snapshot (the
/// offscreen visual-contrast adapter's `parentOrBody`); 0 without a snapshot.
#[wasm_bindgen]
pub fn snapshot_parent_or_body(el: u32) -> u32 {
    SNAPSHOT.with(|s| match s.borrow().as_ref() {
        Some(d) => d.parent(el).or(d.body()).unwrap_or(0),
        None => 0,
    })
}

/// The media intrinsics the capture recorded for `el` (`{ nw, nh, vw, vh,
/// w, h, cur, src }`), or `null`.
#[wasm_bindgen]
pub fn snapshot_media(el: u32) -> String {
    SNAPSHOT.with(|s| match s.borrow().as_ref() {
        Some(d) => match d.snap.get(el).and_then(|n| n.media.as_ref()) {
            Some(m) => serde_json::to_string(m).unwrap_or_else(|_| "null".into()),
            None => "null".into(),
        },
        None => "null".into(),
    })
}

/// `{ scrollX, scrollY, innerWidth, innerHeight }` of the loaded snapshot.
#[wasm_bindgen]
pub fn snapshot_viewport() -> String {
    SNAPSHOT.with(|s| match s.borrow().as_ref() {
        Some(d) => serde_json::json!({
            "scrollX": d.scroll_x(), "scrollY": d.scroll_y(),
            "innerWidth": d.inner_width(), "innerHeight": d.inner_height(),
        })
        .to_string(),
        None => "null".into(),
    })
}
