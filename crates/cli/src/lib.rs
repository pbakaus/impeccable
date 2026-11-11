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
pub use router::{is_scan, run, InstalledPack};
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

mod loop_connect;
mod loop_install;

mod setup_report;

/// Schedule the setup worker after an open binary's Pro scan dispatch.
#[doc(hidden)]
pub fn schedule_setup_report(io: &impeccable_common::Io) {
    setup_report::schedule(io);
}
