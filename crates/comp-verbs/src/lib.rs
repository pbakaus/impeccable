//! impeccable-comp-verbs: the four comp-fidelity verb orchestrators
//! (`comp-spec`, `comp-diff`, `font-match`, `build-phase`), ported from the
//! skill's JS scripts of the same name.
//!
//! OPEN and free of the closed `core` crate. It wires only the pure `comp`
//! foundation plus `common` (`Io`). Two things it cannot do on its own are
//! injected by the CLI so the browser (and its `core` dependency) stays out:
//!
//!   - font-match's headless rendering of font specimens: a [`font_match::FontRenderer`].
//!   - build-phase's organic-clip-path CSS scan (a rule that lives in `core`):
//!     a [`build_phase::OrganicScan`] closure.
//!
//! The font-index catalog is resolved at run time the way concept-seed resolves
//! its catalog (`IMPECCABLE_CATALOG_DIR`, then the skill's shipped copy); it is
//! never committed to the engine repo. See [`font_match`].

pub mod build_phase;
pub mod comp_diff;
pub mod comp_spec;
pub mod font_match;
mod util;

use impeccable_common::Io;

/// `impeccable comp-spec ...`
pub fn run_comp_spec(argv: &[String], io: &mut Io) -> i32 {
    comp_spec::run(argv, io)
}

/// `impeccable comp-diff ...`
pub fn run_comp_diff(argv: &[String], io: &mut Io) -> i32 {
    comp_diff::run(argv, io)
}

/// `impeccable font-match ...`. `renderer` supplies the headless-browser
/// specimen rendering; pass [`font_match::NoRenderer`] where no browser is
/// available (the catalog/shortlist path owns the ranking then).
pub fn run_font_match(argv: &[String], io: &mut Io, renderer: &mut dyn font_match::FontRenderer) -> i32 {
    font_match::run(argv, io, renderer)
}

/// `impeccable build-phase ...`. `organic_scan` is the injected CSS
/// organic-clip-path scanner (pass [`build_phase::no_organic_scan`] to skip it,
/// matching the JS degraded path).
pub fn run_build_phase(argv: &[String], io: &mut Io, organic_scan: build_phase::OrganicScan) -> i32 {
    build_phase::run(argv, io, organic_scan)
}
