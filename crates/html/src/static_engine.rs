//! The `impeccable detect` adapter for the static HTML engine: implements
//! `impeccable_detect::engines::HtmlEngine` over [`crate::engine::detect_html`],
//! wiring the three pieces `detectHtml` borrows from other JS modules:
//!
//! - the design-system trio (`checkSourceDesignSystem` and
//!   `mergeDesignSystemFindings` from the `detect` crate, plus the DOM-backed
//!   `collectStaticDesignSystemFindings` ported here, JS
//!   `cli/engine/design-system.mjs`),
//! - `runTextContentAnalyzers` (regex engine, `detect` crate),
//! - the detector profile (`detect::profiler::DetectorProfile`) as a
//!   [`ProfileSink`].
//!
//! Dependency direction: html depends on detect, never the reverse; the
//! `cli` binary registers [`StaticHtmlEngine`] in `Engines`.

use std::path::Path;

use impeccable_core::findings::Finding;
use impeccable_core::js;
use impeccable_core::js_ext_b::slice_utf16_prefix;
use impeccable_detect::design_system::{
    check_source_design_system, css_color_label, extract_radius_tokens, is_allowed_color_raw,
    is_allowed_font, is_allowed_radius_raw, is_transparent_css, make_design_finding,
    merge_design_system_findings, primary_font, DesignSystem, STATIC_DESIGN_SKIP_TAGS,
};
use impeccable_detect::detect_text::run_text_content_analyzers;
use impeccable_detect::engines::{EngineError, HtmlEngine, ScanOptions};
use impeccable_detect::profiler::{DetectorProfile, ProfileEvent as DetectProfileEvent};
use once_cell::sync::Lazy;
use regex::Regex;

use crate::background::sv;
use crate::dom::{StaticDocument, StaticElement};
use crate::engine::{detect_html, DesignSystemHook, DetectHtmlOptions};
use crate::profile::{ProfileEvent, ProfileSink};
use crate::quality::pf0;

/// The static HTML engine as `impeccable detect` sees it.
#[derive(Debug, Default, Clone, Copy)]
pub struct StaticHtmlEngine;

impl HtmlEngine for StaticHtmlEngine {
    fn detect_html(
        &self,
        path: &str,
        options: &ScanOptions,
        stderr: &mut dyn std::io::Write,
    ) -> Result<Vec<Finding>, EngineError> {
        // The JS DEGRADED notice fires only when its parser modules fail to
        // import; the port links them in. The stderr sink carries the
        // unreadable-linked-stylesheet notices (issue #652).
        let stderr_cell = std::cell::RefCell::new(stderr);
        let warn = |msg: &str| {
            let _ = stderr_cell.borrow_mut().write_all(msg.as_bytes());
        };
        let profile_sink = options
            .profile
            .as_deref()
            .map(|p| DetectorProfileSink { profile: p });
        let profile_ref: Option<&DetectorProfile> = options.profile.as_deref();
        let analyzers = move |content: &str, file_path: &str| -> Vec<Finding> {
            run_text_content_analyzers(content, file_path, profile_ref)
        };
        let hook = options
            .design_system
            .as_deref()
            .map(|ds| DetectDesignSystemHook { design_system: ds });
        let html_options = DetectHtmlOptions {
            inline_ignores_disabled: !options.inline_ignores,
            design_system: hook.as_ref().map(|h| h as &dyn DesignSystemHook),
            text_content_analyzers: Some(&analyzers),
            profile: profile_sink.as_ref().map(|s| s as &dyn ProfileSink),
            warn: Some(&warn),
        };
        detect_html(Path::new(path), &html_options).map_err(|e| {
            EngineError::new(match e {
                // JS `fs.readFileSync` rejection surfaced by `detectCli`'s catch.
                crate::engine::HtmlEngineError::Read { path, source } => match source.kind() {
                    std::io::ErrorKind::NotFound => {
                        format!("ENOENT: no such file or directory, open '{path}'")
                    }
                    _ => format!("{source}, open '{path}'"),
                },
            })
        })
    }
}

/// [`ProfileSink`] over the detect crate's `DetectorProfile`
/// (`recordProfileEvent` on the `{ events: [] }` shape).
pub struct DetectorProfileSink<'a> {
    pub profile: &'a DetectorProfile,
}

impl ProfileSink for DetectorProfileSink<'_> {
    fn record(&self, event: ProfileEvent) {
        let normalized = DetectProfileEvent {
            engine: or_unknown(event.engine),
            phase: or_unknown(event.phase),
            rule_id: or_unknown(event.rule_id),
            target: event.target,
            ms: if event.ms.is_finite() { event.ms } else { 0.0 },
            findings: event.findings as f64,
            detail: event.detail.filter(|d| !d.is_empty()),
            finding_ids: if event.finding_ids.is_empty() {
                None
            } else {
                Some(event.finding_ids)
            },
        };
        self.profile.events.borrow_mut().push(normalized);
    }
}

fn or_unknown(s: String) -> String {
    if s.is_empty() {
        "unknown".to_string()
    } else {
        s
    }
}

/// [`DesignSystemHook`] over a loaded `DesignSystem`.
pub struct DetectDesignSystemHook<'a> {
    pub design_system: &'a DesignSystem,
}

impl DesignSystemHook for DetectDesignSystemHook<'_> {
    fn check_source(&self, html: &str, file_path: &str) -> Vec<Finding> {
        check_source_design_system(html, file_path, Some(self.design_system))
    }

    fn collect_static(&self, doc: &StaticDocument, file_path: &str) -> Vec<Finding> {
        collect_static_design_system_findings(doc, file_path, self.design_system)
    }

    fn merge(&self, static_findings: Vec<Finding>, source_findings: Vec<Finding>) -> Vec<Finding> {
        merge_design_system_findings(vec![static_findings, source_findings])
    }
}

static WS_RUN_RE: Lazy<Regex> = Lazy::new(|| Regex::new(&format!("{}+", js::WS)).unwrap());

/// JS: design-system.mjs#hasDirectText
fn has_direct_text(el: &StaticElement<'_>) -> bool {
    el.has_direct_text_longer_than(0)
}

/// JS: design-system.mjs#sampleText
fn sample_text(el: &StaticElement<'_>) -> String {
    let raw = el.text_content();
    let collapsed = WS_RUN_RE.replace_all(&raw, " ");
    let text = js::trim(&collapsed);
    if text.is_empty() {
        String::new()
    } else {
        format!(" \"{}\"", slice_utf16_prefix(text, 40))
    }
}

/// JS: design-system.mjs#shouldSkipStaticDesignElement
fn should_skip_static_design_element(el: &StaticElement<'_>) -> bool {
    let tag = el.tag_lower();
    if STATIC_DESIGN_SKIP_TAGS.contains(&tag.as_str()) {
        return true;
    }
    let mut current = Some(*el);
    while let Some(cur) = current {
        if cur.get_attribute("hidden").is_some() || cur.get_attribute("aria-hidden") == Some("true")
        {
            return true;
        }
        let style = cur.style();
        let display = js::to_lower_case(sv(style, "display"));
        let visibility = js::to_lower_case(sv(style, "visibility"));
        if display == "none" || visibility == "hidden" || visibility == "collapse" {
            return true;
        }
        current = cur.parent_element();
    }
    false
}

/// JS: design-system.mjs#collectStaticDesignSystemFindings
///
/// Font-size design-system checks are source-scan-only (see
/// `checkSourceDesignSystem`); computed font-size cascades and clamp() ramps
/// resolve to off-ramp px in the browser.
pub fn collect_static_design_system_findings(
    doc: &StaticDocument,
    file_path: &str,
    ds: &DesignSystem,
) -> Vec<Finding> {
    if !ds.present {
        return vec![];
    }
    let mut findings = Vec::new();
    let mut seen_fonts: Vec<String> = Vec::new();
    let mut seen_colors: Vec<String> = Vec::new();
    let mut seen_radii: Vec<String> = Vec::new();

    for el in doc.query_selector_all("*") {
        if should_skip_static_design_element(&el) {
            continue;
        }
        let tag = el.tag_lower();
        let style = el.style();

        if ds.has_fonts && has_direct_text(&el) {
            let font = primary_font(sv(style, "fontFamily"));
            if !font.is_empty() && !seen_fonts.contains(&font) && !is_allowed_font(&font, Some(ds))
            {
                seen_fonts.push(font.clone());
                findings.push(make_design_finding(
                    "design-system-font",
                    file_path,
                    &format!(
                        "{tag}{} uses {font}; not declared in DESIGN.md typography",
                        sample_text(&el)
                    ),
                    0.0,
                    &font,
                ));
            }
        }

        if ds.has_colors {
            let mut color_checks: Vec<(String, &str)> = Vec::new();
            if has_direct_text(&el) {
                color_checks.push(("text color".to_string(), sv(style, "color")));
            }
            if !is_transparent_css(sv(style, "backgroundColor")) {
                color_checks.push(("background".to_string(), sv(style, "backgroundColor")));
            }
            for side in ["Top", "Right", "Bottom", "Left"] {
                if pf0(sv(style, &format!("border{side}Width"))) > 0.0 {
                    color_checks.push((
                        format!("border-{}", side.to_ascii_lowercase()),
                        sv(style, &format!("border{side}Color")),
                    ));
                }
            }
            if pf0(sv(style, "outlineWidth")) > 0.0 {
                color_checks.push(("outline".to_string(), sv(style, "outlineColor")));
            }

            for (kind, raw) in color_checks {
                let label = css_color_label(raw);
                if is_allowed_color_raw(&label, Some(ds)) {
                    continue;
                }
                let key = format!("{kind}:{label}");
                if seen_colors.contains(&key) {
                    continue;
                }
                seen_colors.push(key);
                findings.push(make_design_finding(
                    "design-system-color",
                    file_path,
                    &format!(
                        "{kind} {label} on {tag}{} is outside DESIGN.md colors",
                        sample_text(&el)
                    ),
                    0.0,
                    &label,
                ));
            }
        }

        if ds.has_radii {
            let raw_radius = js::trim(sv(style, "borderRadius"));
            if raw_radius.is_empty() {
                continue;
            }
            for token in extract_radius_tokens(raw_radius) {
                if is_allowed_radius_raw(&token, Some(ds)) {
                    continue;
                }
                if seen_radii.contains(&token) {
                    continue;
                }
                seen_radii.push(token.clone());
                findings.push(make_design_finding(
                    "design-system-radius",
                    file_path,
                    &format!(
                        "border-radius {token} on {tag}{} is outside the DESIGN.md rounded scale",
                        sample_text(&el)
                    ),
                    0.0,
                    &token,
                ));
            }
        }
    }

    findings
}
