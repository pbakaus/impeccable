//! Embeddable CLI router and native browser adapters.
//! Downstream binaries call [`run`] with their build's [`InstalledPack`].
pub mod asset_capture;

pub mod capture_snapshot;

pub mod component_capture;

pub mod entry_capture;

pub mod capture_service;

pub mod reviewed_entry;

mod first_viewport;
mod shot;
mod font_render;
mod foundations;
mod router;
pub use router::{is_scan, run, InstalledPack};
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

mod loop_connect;
mod loop_install;
mod agent_block;
mod switch_sync;

mod setup_report;
mod install_sign_in;
mod walkthrough;

/// Schedule the setup worker after an open binary's Pro scan dispatch.
#[doc(hidden)]
pub fn schedule_setup_report(io: &impeccable_common::Io) {
    setup_report::schedule(io);
}
