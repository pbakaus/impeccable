//! The `detect` feature: the two file-scanning engines as JSON-in / JSON-out
//! wasm exports, for hosts that cannot exec the `impeccable` binary
//! (Cloudflare Workers, other wasm sandboxes).
//!
//! Both take the same options object, all keys optional:
//!
//! ```json
//! {
//!   "inlineIgnores": true,
//!   "designSystem": { "frontmatter": { ... }, "sidecar": { ... } }
//! }
//! ```
//!
//! - `inlineIgnores` (default `true`): apply the `impeccable-disable` waivers
//!   found in the source, exactly as the CLI does. `false` reports waived
//!   findings too.
//! - `designSystem`: the DESIGN.md inputs, not a pre-normalized object (the
//!   JS API's `options.designSystem` carried `Set`s and `Map`s, which JSON
//!   cannot). `frontmatter` is the parsed DESIGN.md frontmatter, `sidecar`
//!   the parsed `design.json`; the export normalizes them the way
//!   `loadDesignSystemForCwd` does. Omit it and no design-system rules run.
//!
//! Both return the findings array the CLI's `--json` prints, in the same
//! order and with the same keys:
//!
//! ```json
//! [{ "antipattern": "side-tab", "name": "...", "description": "...",
//!    "severity": "warning", "category": "slop", "file": "src/Card.tsx",
//!    "line": 12, "snippet": "border-left: 4px solid #6366f1" }]
//! ```
//!
//! `advisory: true` appears on advisory rules only. Bad options JSON is not
//! an error: it falls back to the defaults, like the CLI ignoring an
//! unreadable config.
//!
//! A rule pack ([`impeccable_core::rule_pack`]) reaches these exports through
//! [`crate::set_rule_pack`] and [`set_static_rule_pack`], which a downstream
//! wasm crate calls from Rust before its own exports run. There is no
//! JS-facing setter: a pack is compiled in, not passed at the boundary.

use std::path::Path;
use std::sync::OnceLock;

use impeccable_detect::design_system::{normalize_design_system, DesignSystem};
use impeccable_detect::detect_text::{detect_text, TextOptions};
use impeccable_html::{detect_html_source, DesignSystemHook, DetectHtmlOptions, StaticRulePack};
use serde_json::Value;
use wasm_bindgen::prelude::*;

static STATIC_PACK: OnceLock<&'static dyn StaticRulePack> = OnceLock::new();

/// Install the static-document half of a rule pack for
/// [`detect_html_source_json`]. Rust-only, called once at startup;
/// [`crate::set_rule_pack`] installs the engine-wide half (and the pack's
/// registry rows).
pub fn set_static_rule_pack(pack: &'static dyn StaticRulePack) {
    let _ = STATIC_PACK.set(pack);
}

/// The installed static-document hook, if any.
pub fn installed_static_rule_pack() -> Option<&'static dyn StaticRulePack> {
    STATIC_PACK.get().copied()
}

struct Options {
    inline_ignores: bool,
    design_system: Option<DesignSystem>,
}

fn parse_options(options_json: &str) -> Options {
    let parsed: Value = serde_json::from_str(options_json).unwrap_or(Value::Null);
    let inline_ignores = parsed
        .get("inlineIgnores")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let design_system = parsed.get("designSystem").and_then(|ds| {
        let frontmatter = ds.get("frontmatter").and_then(Value::as_object);
        let sidecar = ds.get("sidecar");
        if frontmatter.is_none() && sidecar.is_none() {
            return None;
        }
        Some(normalize_design_system(
            frontmatter,
            sidecar,
            ds.get("sourcePath").and_then(Value::as_str),
            ds.get("sidecarPath").and_then(Value::as_str),
            false,
        ))
    });
    Options {
        inline_ignores,
        design_system,
    }
}

fn findings_json(findings: &[impeccable_core::findings::Finding]) -> String {
    serde_json::to_string(findings).unwrap_or_else(|_| "[]".into())
}

/// The text/source engine (`impeccable detect` on anything but HTML): CSS,
/// JSX, TSX, Vue, Svelte, Astro, and plain source. `file_path` names the file
/// in the findings and picks the matchers by extension.
#[wasm_bindgen]
pub fn detect_text_json(content: &str, file_path: &str, options_json: &str) -> String {
    let options = parse_options(options_json);
    let findings = detect_text(
        content,
        file_path,
        &TextOptions {
            profile: None,
            design_system: options.design_system.as_ref(),
            inline_ignores: options.inline_ignores,
            rule_pack: crate::installed_rule_pack(),
        },
    );
    findings_json(&findings)
}

/// The static HTML engine over HTML already in memory: the parsed page, the
/// CSS cascade, the element and page rules, and the text-content analyzers.
/// `file_path` names the file in the findings; linked stylesheets are
/// resolved relative to it, which in wasm means only inline `<style>` blocks
/// contribute (there is no filesystem).
#[wasm_bindgen]
pub fn detect_html_source_json(html: &str, file_path: &str, options_json: &str) -> String {
    let options = parse_options(options_json);
    let analyzers = |content: &str, path: &str| {
        impeccable_detect::detect_text::run_text_content_analyzers(content, path, None)
    };
    let hook = options
        .design_system
        .as_ref()
        .map(|ds| impeccable_html::DetectDesignSystemHook { design_system: ds });
    let findings = detect_html_source(
        html,
        Path::new(file_path),
        &DetectHtmlOptions {
            inline_ignores_disabled: !options.inline_ignores,
            design_system: hook.as_ref().map(|h| h as &dyn DesignSystemHook),
            text_content_analyzers: Some(&analyzers),
            profile: None,
            warn: None,
            static_rule_pack: installed_static_rule_pack(),
            rule_pack: crate::installed_rule_pack(),
        },
    );
    findings_json(&findings)
}

/// The immediate tier: the rule ids the design hook fixes at edit time, as a
/// JSON array of strings.
///
/// It rides the `detect` feature because the consumers that need it are the
/// ones scanning files without the binary. A reviewer downstream reads it to
/// decide how loudly a finding is reported, and copying the list into that
/// codebase is how the two drift apart.
#[wasm_bindgen]
pub fn immediate_tier_rules_json() -> String {
    serde_json::to_string(impeccable_core::registry::IMMEDIATE_TIER_RULES)
        .unwrap_or_else(|_| "[]".into())
}
