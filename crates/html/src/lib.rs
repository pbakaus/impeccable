//! impeccable-html: the static HTML engine (DOM model, CSS cascade, adapters)
//! ported from `cli/engine/engines/static-html/` with byte-for-byte
//! behavioral parity against the JS goldens.
//!
//! Entry points: [`engine::detect_html`] / [`engine::detect_html_source`].

pub mod adapters;
pub mod background;
pub mod cascade;
pub mod dom;
pub mod engine;
pub mod page;
pub mod profile;
pub mod quality;
pub mod select;
pub mod static_engine;

pub use engine::{
    detect_html, detect_html_source, DesignSystemHook, DetectHtmlOptions, HtmlEngineError,
    StaticRulePack, TextContentAnalyzers,
};
pub use static_engine::{DetectDesignSystemHook, DetectorProfileSink, StaticHtmlEngine};
