//! Port of `cli/engine/shared/page.mjs`.

use crate::js::{ci, WS};
use once_cell::sync::Lazy;
use regex::Regex;

static COMMENT_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"<!--[\s\S]*?-->").unwrap());
static FULL_PAGE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        r"<!{doctype}{WS}|<{html}[{WSC}>]|<{head}[{WSC}>]",
        doctype = ci("doctype"),
        html = ci("html"),
        head = ci("head"),
        WSC = crate::js::WS_CHARS
    ))
    .unwrap()
});

/// JS `isFullPage(content)`: content looks like a full page rather than a
/// component/partial (checked with HTML comments stripped).
pub fn is_full_page(content: &str) -> bool {
    let stripped = COMMENT_RE.replace_all(content, "");
    FULL_PAGE_RE.is_match(&stripped)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_full_pages() {
        assert!(is_full_page("<!DOCTYPE html><p>x</p>"));
        assert!(is_full_page("<HTML>"));
        assert!(is_full_page("<head>"));
        assert!(!is_full_page("<!-- <html> --><div>x</div>"));
        assert!(!is_full_page("<header>"));
        assert!(!is_full_page("<div>partial</div>"));
    }
}
