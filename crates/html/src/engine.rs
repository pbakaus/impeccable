//! Port of `cli/engine/engines/static-html/detect-html.mjs#detectHtml`: the
//! whole static engine run for one HTML file, in the exact JS finding order
//! (element rules in `STATIC_ELEMENT_RULES` order, design-system findings,
//! then the page-level checks for full pages), then inline ignores.
//!
//! Two pieces the JS reaches into other engines for are exposed as hooks on
//! [`DetectHtmlOptions`] instead of being duplicated here:
//! `runTextContentAnalyzers` (regex engine) and the design-system trio
//! (`checkSourceDesignSystem`, `collectStaticDesignSystemFindings`,
//! `mergeDesignSystemFindings`). The `detect` crate wires them.

use crate::adapters::{
    check_element_borders, check_element_broken_image, check_element_clipped_overflow,
    check_element_colors, check_element_glow, check_element_gpt_border_shadow,
    check_element_hero_eyebrow, check_element_hover_contrast, check_element_icon_tile,
    check_element_italic_serif, check_element_motion, check_element_oversized_h1,
    check_element_radial_spotlight, check_kicker_above_heading_from_doc,
    check_numbered_section_labels_from_doc, scoped_ignore_active,
};
use crate::background::{resolve_background, resolve_border_radius_px, sv};
use crate::cascade::{build_static_style_map, collect_static_css_text};
use crate::dom::{StaticDocument, StaticElement};
use crate::page::{
    check_cream_palette, check_page_layout, check_repeated_container_text_from_doc,
    check_static_page_typography,
};
use crate::profile::{self, Meta, ProfileSink};
use crate::quality::{check_element_quality, check_page_quality_from_doc, pf0};
use impeccable_core::checks::html_patterns::{check_html_patterns, HtmlPatternCorpora};
use impeccable_core::checks::rules::RuleHit;
use impeccable_core::findings::{try_finding, Finding};
use impeccable_core::inline_ignores::apply_inline_ignores;
use impeccable_core::page::is_full_page;
use once_cell::sync::Lazy;
use regex::Regex;
use std::path::Path;

/// The design-system pieces of `detectHtml` (`design-system.mjs`), supplied
/// by the orchestrating crate when a project design system is loaded.
pub trait DesignSystemHook {
    /// JS `checkSourceDesignSystem(html, filePath, { designSystem })`.
    fn check_source(&self, html: &str, file_path: &str) -> Vec<Finding>;
    /// JS `collectStaticDesignSystemFindings(document, window, filePath, designSystem)`.
    fn collect_static(&self, doc: &StaticDocument, file_path: &str) -> Vec<Finding>;
    /// JS `mergeDesignSystemFindings(staticDesignFindings, sourceDesignFindings)`.
    fn merge(&self, static_findings: Vec<Finding>, source_findings: Vec<Finding>) -> Vec<Finding>;
}

/// JS `runTextContentAnalyzers(html, filePath, options)` from the regex
/// engine: em-dash overuse, marketing buzzwords, aphoristic cadence.
pub type TextContentAnalyzers<'a> = &'a dyn Fn(&str, &str) -> Vec<Finding>;

/// The static engine's half of a rule pack (`impeccable_core::rule_pack`):
/// rules written against the parsed page. The [`StaticDocument`] model is
/// this crate's, so this hook cannot live on the engine-wide `RulePack`
/// trait; a pack implements both and hands the same value to both fields of
/// [`DetectHtmlOptions`].
///
/// Findings come back as full [`Finding`] values, built with
/// `impeccable_core::findings::finding_for(row, file_path, snippet, line)` so
/// they carry the pack's own registry metadata.
pub trait StaticRulePack: Send + Sync + std::fmt::Debug {
    /// Runs once per HTML file, after every built-in pass and before inline
    /// ignores.
    fn check_document(&self, doc: &StaticDocument, file_path: &str) -> Vec<Finding>;
}

/// The `options` object `detectHtml` reads.
#[derive(Default, Clone, Copy)]
pub struct DetectHtmlOptions<'a> {
    /// JS `options.inlineIgnores === false` disables the whole-file
    /// `impeccable-disable` waivers; anything else applies them.
    pub inline_ignores_disabled: bool,
    /// JS `options.designSystem` (present only when a DESIGN.md loaded).
    pub design_system: Option<&'a dyn DesignSystemHook>,
    /// The regex engine's text-content analyzers; `None` skips them.
    pub text_content_analyzers: Option<TextContentAnalyzers<'a>>,
    /// JS `options.profile`.
    pub profile: Option<&'a dyn ProfileSink>,
    /// Sink for the JS `process.stderr.write` notices (unreadable linked
    /// stylesheets); `None` drops them.
    pub warn: Option<&'a dyn Fn(&str)>,
    /// A rule pack's static-document hook: rules over the parsed page.
    pub static_rule_pack: Option<&'static dyn StaticRulePack>,
    /// The same pack's engine-wide text hook. An HTML file gets **one** pack
    /// pass: `static_rule_pack` when it is set, otherwise this one over the
    /// raw HTML source (which is how a text-only pack still covers `.html`
    /// files, the way the built-in text-content analyzers do). A pack that
    /// implements both therefore never reports twice for the same file.
    pub rule_pack: Option<&'static dyn impeccable_core::rule_pack::RulePack>,
}

/// Errors of the static engine.
#[derive(Debug, thiserror::Error)]
pub enum HtmlEngineError {
    #[error("cannot read {path}: {source}")]
    Read {
        path: String,
        #[source]
        source: std::io::Error,
    },
}

/// The per-element rules of `STATIC_ELEMENT_RULES`, in table order.
const STATIC_ELEMENT_RULES: &[(&str, &str)] = &[
    ("border-rules", "*"),
    ("color-rules", "*"),
    ("hover-color-rules", "*"),
    ("dark-glow", "*"),
    ("motion-rules", "*"),
    ("icon-tile-stack", "h1,h2,h3,h4,h5,h6"),
    ("italic-serif-display", "h1,h2"),
    ("hero-eyebrow-chip", "h1"),
    ("broken-image", "img"),
    ("quality-rules", "*"),
    ("oversized-h1", "h1"),
    ("clipped-overflow-container", "*"),
    ("gpt-thin-border-wide-shadow", "*"),
    ("radial-spotlight-glow", "*"),
];

fn run_rule(rule_id: &str, el: &StaticElement<'_>, tag: &str) -> Vec<RuleHit> {
    let style = el.style();
    match rule_id {
        "border-rules" => {
            let radius = resolve_border_radius_px(style, pf0(sv(style, "width")));
            check_element_borders(tag, style, radius, el)
        }
        "color-rules" => check_element_colors(el, style, tag, None),
        "hover-color-rules" => check_element_hover_contrast(el, style, tag),
        "dark-glow" => {
            let base = el.parent_element().unwrap_or(*el);
            check_element_glow(style, resolve_background(&base, None))
        }
        "motion-rules" => check_element_motion(tag, style),
        "icon-tile-stack" => check_element_icon_tile(el, tag),
        "italic-serif-display" => check_element_italic_serif(el, style, tag),
        "hero-eyebrow-chip" => check_element_hero_eyebrow(el, style, tag),
        "broken-image" => check_element_broken_image(el),
        "quality-rules" => check_element_quality(el, style, tag),
        "oversized-h1" => check_element_oversized_h1(el, tag),
        "clipped-overflow-container" => check_element_clipped_overflow(el, style),
        "gpt-thin-border-wide-shadow" => check_element_gpt_border_shadow(style),
        "radial-spotlight-glow" => check_element_radial_spotlight(el, style),
        _ => Vec::new(),
    }
}

static PSEUDO_STRIP_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"::?[a-zA-Z-]+(\([^)]*\))?").expect("PSEUDO_STRIP_RE"));

fn read_source(file_path: &Path) -> Result<String, HtmlEngineError> {
    let bytes = std::fs::read(file_path).map_err(|source| HtmlEngineError::Read {
        path: file_path.to_string_lossy().into_owned(),
        source,
    })?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// JS `detectHtml(filePath, options)`: read the file and scan it.
pub fn detect_html(
    file_path: &Path,
    options: &DetectHtmlOptions<'_>,
) -> Result<Vec<Finding>, HtmlEngineError> {
    let file_str = file_path.to_string_lossy().into_owned();
    let html = profile::step(
        options.profile,
        Meta::new("setup", "read-html", &file_str),
        || read_source(file_path),
    )?;
    Ok(detect_html_source(&html, file_path, options))
}

/// `detectHtml` for HTML already in memory. `file_path` names the file in
/// findings and resolves linked stylesheets (its parent directory).
pub fn detect_html_source(
    html: &str,
    file_path: &Path,
    options: &DetectHtmlOptions<'_>,
) -> Vec<Finding> {
    let profile = options.profile;
    let file_str = file_path.to_string_lossy().into_owned();
    let fp = file_str.as_str();
    // JS loads htmlparser2 / css-select / css-tree / domutils here (and falls
    // back to the regex engine with a DEGRADED notice when they are missing);
    // the port links them in, so the step is only kept for the profile shape.
    profile::step(
        profile,
        Meta::new("setup", "import-static-parser", fp),
        || (),
    );
    // JS `path.dirname(path.resolve(filePath))`.
    let resolved = if file_path.is_absolute() {
        file_path.to_path_buf()
    } else {
        std::env::current_dir()
            .map(|cwd| cwd.join(file_path))
            .unwrap_or_else(|_| file_path.to_path_buf())
    };
    let file_dir = resolved
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| resolved.clone());

    let mut doc = profile::step(
        profile,
        Meta::new("parse-html", "parse-document", fp),
        || StaticDocument::parse(html),
    );
    let css_text = collect_static_css_text(&doc, &file_dir, profile, fp, options.warn);
    build_static_style_map(&mut doc, css_text.as_str(), profile, fp);
    let doc = doc;

    let mut findings: Vec<Finding> = Vec::new();
    let mk = |id: &str, snippet: &str| try_finding(id, fp, snippet, 0.0);

    for (rule_id, selector) in STATIC_ELEMENT_RULES {
        let elements = doc.query_selector_all(selector);
        for el in &elements {
            let tag = el.tag_lower();
            let hits = profile::findings(
                profile,
                Meta::new("element", rule_id, fp),
                |h: &RuleHit| h.id.as_str(),
                || run_rule(rule_id, el, &tag),
            );
            for h in hits {
                if scoped_ignore_active(el, &h.id) {
                    continue;
                }
                if let Some(f) = mk(&h.id, &h.snippet) {
                    findings.push(f);
                }
            }
        }
    }

    if let Some(ds) = options.design_system {
        let source_design = profile::findings(
            profile,
            Meta::new("source", "design-system", fp),
            |f: &Finding| f.antipattern.as_str(),
            || ds.check_source(html, fp),
        );
        let static_design = profile::findings(
            profile,
            Meta::new("page", "design-system", fp),
            |f: &Finding| f.antipattern.as_str(),
            || ds.collect_static(&doc, fp),
        );
        findings.extend(ds.merge(static_design, source_design));
    }

    if is_full_page(html) {
        let page = |rule_id: &str, f: &dyn Fn() -> Vec<RuleHit>| -> Vec<RuleHit> {
            profile::findings(
                profile,
                Meta::new("page", rule_id, fp),
                |h: &RuleHit| h.id.as_str(),
                f,
            )
        };
        let mut push_hits = |hits: Vec<RuleHit>| {
            for h in hits {
                if let Some(f) = mk(&h.id, &h.snippet) {
                    findings.push(f);
                }
            }
        };
        push_hits(page("typography-rules", &|| {
            check_static_page_typography(&doc)
        }));
        push_hits(page("kicker-above-heading", &|| {
            check_kicker_above_heading_from_doc(&doc)
        }));
        push_hits(page("numbered-section-labels", &|| {
            check_numbered_section_labels_from_doc(&doc)
        }));
        push_hits(page("repeated-container-text", &|| {
            check_repeated_container_text_from_doc(&doc)
        }));
        push_hits(page("layout-rules", &|| check_page_layout(&doc)));
        push_hits(page("cream-palette", &|| check_cream_palette(&doc)));
        push_hits(page("skipped-heading", &|| {
            check_page_quality_from_doc(&doc)
        }));

        // Scoped corpora for the pattern checks: cssText already carries the
        // <style> blocks and linked local stylesheets; style/class attributes
        // come from the parsed document.
        let mut style_attr_parts: Vec<String> = Vec::new();
        let mut class_attr_parts: Vec<String> = Vec::new();
        for el in doc.query_selector_all("*") {
            if let Some(s) = el.get_attribute("style").filter(|s| !s.is_empty()) {
                style_attr_parts.push(format!("style=\"{}\"", s));
            }
            if let Some(c) = el.get_attribute("class").filter(|c| !c.is_empty()) {
                class_attr_parts.push(c.to_string());
            }
        }
        let mut style_parts = vec![css_text.clone()];
        style_parts.extend(style_attr_parts);
        let corpora = HtmlPatternCorpora {
            style_text: style_parts.join("\n"),
            class_text: class_attr_parts.join("\n"),
        };
        let pattern_hits = profile::findings(
            profile,
            Meta::new("page", "html-patterns", fp),
            |f: &impeccable_core::checks::css_scan::PatternFinding| f.id.as_str(),
            || {
                check_html_patterns(html, Some(&corpora))
                    .into_iter()
                    .filter(|item| item.id != "bounce-easing" && item.id != "layout-transition")
                    .collect()
            },
        );
        for f in pattern_hits {
            if let Some(selector) = f.selector.as_deref() {
                let stripped = PSEUDO_STRIP_RE.replace_all(selector, "");
                let stripped = impeccable_core::js::trim(&stripped);
                let matches = match doc.compile(stripped) {
                    Ok(_) => Some(doc.query_selector_all(stripped)),
                    Err(_) => None,
                };
                if let Some(matches) = matches {
                    if !matches.is_empty()
                        && matches.iter().all(|el| scoped_ignore_active(el, &f.id))
                    {
                        continue;
                    }
                }
            }
            if let Some(mut item) = mk(&f.id, &f.snippet) {
                if let Some(sev) = f.severity.as_ref() {
                    item.severity = sev.clone();
                }
                impeccable_core::findings::derive_advisory_flag(&mut item);
                findings.push(item);
            }
        }

        if let Some(analyzers) = options.text_content_analyzers {
            let text_findings = profile::findings(
                profile,
                Meta::new("page", "text-content", fp),
                |f: &Finding| f.antipattern.as_str(),
                || analyzers(html, fp),
            );
            for f in text_findings {
                if let Some(item) = mk(&f.antipattern, &f.snippet) {
                    findings.push(item);
                }
            }
        }
    }

    // A rule pack sees the page after every built-in pass (element rules, the
    // design-system merge, the page-level checks) and before inline ignores:
    // appending keeps built-in output byte-identical when no pack is
    // installed, and pack findings are waivable like built-in ones.
    if let Some(pack) = options.static_rule_pack {
        let pack_findings = profile::findings(
            profile,
            Meta::new("page", "rule-pack", fp),
            |f: &Finding| f.antipattern.as_str(),
            || pack.check_document(&doc, fp),
        );
        findings.extend(pack_findings);
    } else if let Some(pack) = options.rule_pack {
        let ext = impeccable_detect::detect_text::ext_from_file_path(fp);
        let pack_findings = profile::findings(
            profile,
            Meta::new("source", "rule-pack", fp),
            |f: &Finding| f.antipattern.as_str(),
            || pack.check_text(html, fp, &ext),
        );
        findings.extend(pack_findings);
    }

    if options.inline_ignores_disabled {
        findings
    } else {
        apply_inline_ignores(findings, Some(html))
    }
}

/// The selectors css-select would refuse that a scan of `html` hits (for the
/// parity report; not part of the JS API).
pub fn unsupported_selectors(html: &str, file_path: &Path) -> Vec<String> {
    let file_str = file_path.to_string_lossy().into_owned();
    let file_dir = file_path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_default();
    let mut doc = StaticDocument::parse(html);
    let css_text = collect_static_css_text(&doc, &file_dir, None, &file_str, None);
    build_static_style_map(&mut doc, &css_text, None, &file_str);
    doc.unsupported_selectors()
}
