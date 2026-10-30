//! Embeddable CLI router and native browser adapters.
//! Downstream binaries call [`run`] with their build's [`InstalledPack`].
pub mod asset_capture;

pub mod capture_snapshot;

pub mod component_capture;

pub mod entry_capture;

pub mod capture_service;

pub mod reviewed_entry;

mod font_render;
mod router;
pub use router::{run, InstalledPack};
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
