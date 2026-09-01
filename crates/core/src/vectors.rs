//! Replay dispatcher for the recorded JS call vectors
//! (`tests/oracle/vectors/calls/<module>/<fn>.jsonl` in the public repo).
//!
//! The codec and the open arms live in
//! [`impeccable_foundation::vectors`]; the closed arms answer through the
//! boundary, so the frozen vectors keep replaying against the shipped black
//! box exactly as they did against the source tree.

use crate::ffi;
use impeccable_foundation::boundary::{fn_id, JsonBlob};
use once_cell::sync::Lazy;
use serde_json::Value;

pub use impeccable_foundation::vectors::{decode, encode, Js};

/// Every `(module, [function, ...])` the dispatcher answers: foundation's open
/// arms plus the detector's. Fetched from the detector once.
pub static KNOWN_FUNCTIONS: Lazy<Vec<(String, Vec<String>)>> = Lazy::new(|| {
    let mut rows: Vec<(String, Vec<String>)> = impeccable_foundation::vectors::KNOWN_FUNCTIONS
        .iter()
        .map(|(m, fns)| {
            (
                (*m).to_string(),
                fns.iter().map(|f| (*f).to_string()).collect(),
            )
        })
        .collect();
    let closed: Vec<(String, Vec<String>)> = ffi::call(fn_id::VECTORS_KNOWN, &());
    rows.extend(closed);
    rows
});

/// Invoke the Rust port of `<module>.<fn_name>` with recorder-encoded
/// arguments; returns the recorder-encoded result, or `None` when the
/// function is not known to the dispatcher. Foundation's open arms answer
/// first; the detector's arms answer the rest.
pub fn call(module: &str, fn_name: &str, args: &[Value]) -> Option<Value> {
    if let Some(v) = impeccable_foundation::vectors::call(module, fn_name, args) {
        return Some(v);
    }
    let args_json = serde_json::to_string(args).expect("call vectors are JSON");
    let out: Option<JsonBlob> = ffi::call(
        fn_id::VECTORS_CALL,
        &(module, fn_name, args_json.as_str()),
    );
    out.map(|b| b.parse())
}
