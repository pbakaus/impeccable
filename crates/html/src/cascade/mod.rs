//! Port of `cli/engine/engines/static-html/css-cascade.mjs`, the plain-data
//! half: value/color/token helpers, shorthand expansion, cascade priority,
//! specificity, the specified-declaration store, and the stylesheet rule
//! collector (a port of the css-tree parse + generate subset the JS relies
//! on lives in [`csstree`]).
//!
//! The DOM half of that file lives in [`build`] (`buildStaticStyleMap`,
//! `collectStaticCssText`) and `crate::dom` (`StaticElement`,
//! `StaticDocument`; `buildStaticWindow` is the document's accessor
//! methods). `buildBorderOverrideMap` is jsdom-only and not ported.

pub mod build;
pub mod checks_shim;
pub mod csstree;
pub mod defaults;
pub mod rules;
pub mod shorthand;
pub mod values;

#[cfg(feature = "vectors")]
pub mod vectors;

pub use build::*;
pub use defaults::*;
pub use rules::*;
pub use shorthand::*;
pub use values::*;
