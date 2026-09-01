//! impeccable-core: the open runtime's view of the detector engine.
//!
//! This crate holds no rule logic. It is the seam between the open runtime
//! (the `html`, `detect`, `browser`, `live`, `hook` and `context` crates) and
//! the closed detector, and it exposes exactly the module paths those crates
//! already use:
//!
//! - the **open** helpers (`js`, `color`, `registry`, `browser::dom`, the
//!   plain-data input and output types, ...) are `pub use`d straight from
//!   `impeccable-foundation`, which is Apache-2.0 and part of this workspace;
//! - the **closed** functions (`checks::rules::check_borders`,
//!   `browser::driver::collect_browser_findings`, ...) are one-line shims with
//!   the same signatures, which encode their arguments and call across the
//!   C-ABI in [`impeccable_foundation::boundary`] into the prebuilt detector
//!   archive that `build.rs` links.
//!
//! Consumers cannot tell the difference, which is the point: moving a
//! function from open to closed (or back) is a change here and nowhere else.

pub mod browser;
pub mod checks;
mod ffi;

pub use impeccable_foundation::{
    color, constants, fdlibm_trig, findings, fonts, inline_ignores, js, js_ext_a, js_ext_b, page,
    registry,
};

#[cfg(any(test, feature = "vectors"))]
pub mod vectors;

/// The boundary contract, re-exported so tests and tools can name the ids.
pub use impeccable_foundation::boundary;
