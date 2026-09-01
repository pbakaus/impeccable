//! impeccable-foundation: the open half of the impeccable engine. It carries
//! the JS runtime semantics the port depends on (number and string
//! formatting, trig, regex fragments), colour maths, the rule registry,
//! inline-ignore handling, page and font helpers, the DOM probe trait with
//! its snapshot implementation and selector engine, and the plain-data types
//! every rule check takes in and hands back.
//!
//! What is NOT here is the rule logic: the `check_*` and `scan_*` functions
//! and their heuristics live in `impeccable-core`. This crate is Apache-2.0
//! and has no filesystem, process, or network access; it compiles to wasm.

pub mod boundary;
pub mod browser;
pub mod color;
pub mod constants;
pub mod css;
pub mod fdlibm_trig;
pub mod findings;
pub mod fonts;
pub mod inline_ignores;
pub mod js;
pub mod js_ext_a;
pub mod js_ext_b;
pub mod page;
pub mod registry;
pub mod rules;

#[cfg(any(test, feature = "vectors"))]
pub mod vectors;
