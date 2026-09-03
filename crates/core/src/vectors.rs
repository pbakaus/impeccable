//! Replay dispatcher for the recorded JS call vectors
//! (`tests/oracle/vectors/calls/<module>/<fn>.jsonl`).
//!
//! The codec and the arms for the helper modules live in
//! [`impeccable_foundation::vectors`]; this module re-exports them and adds
//! this crate's own arms, so one `call` reaches every ported function and
//! `KNOWN_FUNCTIONS` is the union of both id tables.

use once_cell::sync::Lazy;
use serde_json::Value;

pub use impeccable_foundation::vectors::{decode, encode, Js};

/// Every `(module, [function, ...])` the dispatcher answers: foundation's
/// arms plus this crate's.
pub static KNOWN_FUNCTIONS: Lazy<Vec<(&'static str, &'static [&'static str])>> = Lazy::new(|| {
    let mut rows: Vec<(&'static str, &'static [&'static str])> =
        impeccable_foundation::vectors::KNOWN_FUNCTIONS.to_vec();
    rows.extend_from_slice(crate::checks::vectors_a::KNOWN);
    rows.extend_from_slice(crate::checks::vectors_b::KNOWN);
    rows
});

/// Invoke the Rust port of `<module>.<fn_name>` with recorder-encoded
/// arguments; returns the recorder-encoded result, or `None` when the
/// function is not known to the dispatcher.
pub fn call(module: &str, fn_name: &str, args: &[Value]) -> Option<Value> {
    if let Some(v) = impeccable_foundation::vectors::call(module, fn_name, args) {
        return Some(v);
    }
    if let Some(v) = crate::checks::vectors_a::call(module, fn_name, args) {
        return Some(v);
    }
    crate::checks::vectors_b::call(module, fn_name, args)
}
