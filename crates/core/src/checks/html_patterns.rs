//! The HTML-markup pattern scanners. Open: `HtmlPatternCorpora`
//! (`impeccable_foundation::rules::html_patterns`). Closed: the scanners.

use crate::ffi;
use impeccable_foundation::boundary::fn_id;
use impeccable_foundation::css::scan::PatternFinding;
use impeccable_foundation::rules::types::RuleHit;

pub use impeccable_foundation::rules::html_patterns::*;

/// JS: checks.mjs#scanHtmlForShapeAssembledIllustration
pub fn scan_html_for_shape_assembled_illustration(html: &str) -> Vec<RuleHit> {
    ffi::call(fn_id::HTML_SCAN_SHAPE_ASSEMBLED_ILLUSTRATION, &html)
}

/// JS: checks.mjs#buildHtmlPatternCorpora
pub fn build_html_pattern_corpora(html: &str) -> HtmlPatternCorpora {
    ffi::call(fn_id::HTML_BUILD_PATTERN_CORPORA, &html)
}

/// JS: checks.mjs#checkHtmlPatterns
pub fn check_html_patterns(
    html: &str,
    corpora: Option<&HtmlPatternCorpora>,
) -> Vec<PatternFinding> {
    ffi::call(fn_id::HTML_CHECK_PATTERNS, &(html, corpora))
}
