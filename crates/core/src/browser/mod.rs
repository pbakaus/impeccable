//! The in-page (browser) rule set, as the open runtime sees it.
//!
//! The probe trait, its snapshot implementation, the selector engine, the test
//! fake and the boundary types are open (`impeccable_foundation::browser`) and
//! re-exported here under the paths callers already use. The rules themselves
//! are closed: `driver`, `page_checks`, `element_checks` and `visual` are
//! shims over the C-ABI, and the closed side reaches back into the caller's
//! `&dyn Dom` through the host vtable.
//!
//! `background`, `quality` and `text_collectors` have no open callers and
//! therefore no shim: they run entirely inside the detector, reached through
//! `driver::collect_browser_findings`.

pub use impeccable_foundation::browser::dom;
pub use impeccable_foundation::browser::selector;

#[cfg(any(test, feature = "fake-dom"))]
pub use impeccable_foundation::browser::fake_dom;

pub mod driver;
pub mod element_checks;
pub mod page_checks;
pub mod snapshot;
pub mod visual;

pub use dom::{Dom, ElId, Rect};
pub use impeccable_foundation::browser::{BrowserConfig, BrowserFinding, ElFinding, FindingGroup};

/// The in-page bundle: the same closed rules compiled to wasm, wrapped in the
/// script live mode serves at `/detect.js` (and the extension and the site
/// ship). `crates/core/build.rs` resolves it beside the detector archive, so
/// the generated 2 MB file is not tracked in this repo.
pub const IN_PAGE_BUNDLE_JS: &str = include_str!(env!("IMPECCABLE_DETECTOR_BUNDLE_JS"));
