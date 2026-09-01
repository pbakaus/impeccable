//! The rule checks, as the open runtime sees them.
//!
//! Each module re-exports its open half from `impeccable_foundation` (the
//! value parsing, the selector and tag lists, the input and output types) and
//! shims its closed half across the boundary. The signatures are the closed
//! ones, unchanged.

pub mod css_scan;
pub mod html_patterns;
pub mod measures;
pub mod rules;
pub mod text_rules;
