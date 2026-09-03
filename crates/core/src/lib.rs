//! impeccable-core: the rule logic of the impeccable detector engine, ported
//! from the JS `cli/engine` with byte-for-byte behavioral parity. The
//! `check_*` / `scan_*` functions and the heuristics behind them live here.
//!
//! Everything they are written against lives in `impeccable-foundation`: JS
//! number and string semantics, colour maths, the rule registry, inline
//! ignores, the DOM probe trait, and the plain-data input and output types.
//! This crate re-exports those modules for its own convenience, so
//! `crate::js`, `crate::color`, `crate::browser::dom` and friends keep
//! resolving inside it, and so consumers can name everything through
//! `impeccable_core::`. No filesystem, process, or network access lives here,
//! and the crate compiles to wasm (`crates/wasm` builds the in-page bundle
//! and the extension core from it).

pub mod browser;
pub mod checks;

pub use impeccable_foundation::{
    color, constants, fdlibm_trig, findings, fonts, inline_ignores, js, js_ext_a, js_ext_b, page,
    registry, rule_pack,
};

#[cfg(any(test, feature = "vectors"))]
pub mod vectors;
