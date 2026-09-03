//! Rule packs: how a crate that depends on the engine adds rules of its own
//! without forking it.
//!
//! A pack is one process-lifetime value (`&'static dyn RulePack`) that carries
//! its own registry rows and implements the hooks it has rules for. The
//! built-in rules are never a pack: they are compiled in and always run. A
//! pack runs after them, on every engine that got a reference to it, and its
//! findings pass through the same waivers and filters as built-in findings.
//!
//! Three steps for a downstream crate:
//!
//! 1. Declare the registry rows as a `static [Antipattern]` and hand them
//!    back from [`RulePack::registry`]. Ids should be namespaced
//!    (`myproject/my-rule`) so they cannot collide with built-in ids.
//! 2. Call [`install`] once at startup, before any scan. That is what makes
//!    `get_antipattern` (and therefore every finding's name, description,
//!    category, and severity) resolve the pack's ids.
//! 3. Pass the pack into the engine being run: `TextOptions.rule_pack` /
//!    `ScanOptions.rule_pack` (text engine), `DetectHtmlOptions`
//!    (`rule_pack` plus `impeccable_html::StaticRulePack`), or
//!    `BrowserConfig.rule_pack` (the in-page / snapshot driver).
//!
//! The trait is object-safe and every hook has a default that answers empty,
//! so a pack implements only the engines it has rules for.

use crate::browser::{BrowserFinding, Dom, ElFinding, ElId};
use crate::findings::Finding;
use crate::registry::Antipattern;

/// A set of extra rules, plus the hooks they run on.
///
/// `Send + Sync` because a pack is shared across whatever threads the host
/// runs scans on; `Debug` because the option types that carry a pack
/// reference (notably `BrowserConfig`) derive `Debug`. `#[derive(Debug)]` on a
/// unit struct is enough.
pub trait RulePack: Send + Sync + std::fmt::Debug {
    /// The pack's registry rows. [`install`] hands these to
    /// [`crate::registry::extend`].
    fn registry(&self) -> &'static [Antipattern];

    /// Text/source engine, once per file, after the built-in matchers and
    /// page analyzers and before inline ignores. `ext` is the lowercased
    /// extension with its dot (`".tsx"`), empty for a file without one.
    fn check_text(&self, content: &str, file_path: &str, ext: &str) -> Vec<Finding> {
        let _ = (content, file_path, ext);
        Vec::new()
    }

    /// Browser rules over the DOM probe, once per element in the driver's
    /// element loop (same skipped elements as the built-ins), after the
    /// built-in element rules. Findings run through the same disabled-rule
    /// filter and group under the same element.
    fn check_element_dom(&self, dom: &dyn Dom, el: ElId) -> Vec<BrowserFinding> {
        let _ = (dom, el);
        Vec::new()
    }

    /// Browser page-level rules, after the built-in page passes. A finding
    /// with `el: None` is attributed to `document.body`, like the built-in
    /// page checks that name their own target.
    fn check_page_dom(&self, dom: &dyn Dom) -> Vec<ElFinding> {
        let _ = dom;
        Vec::new()
    }
}

/// Register a pack's rows in the registry. Idempotent for the same pack, and
/// safe to call before or after the engines are wired.
///
/// # Panics
/// When a row's id collides with a built-in id or with an already registered
/// pack's id (see [`crate::registry::extend`]).
pub fn install(pack: &'static dyn RulePack) {
    crate::registry::extend(pack.registry());
}
