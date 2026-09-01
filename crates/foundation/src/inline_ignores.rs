//! Port of `cli/engine/shared/inline-ignores.mjs`: eslint-disable-style
//! waivers that live in the scanned file (`impeccable-disable`,
//! `impeccable-disable-line`, `impeccable-disable-next-line`).

use crate::js::{self, ci, WS};
use once_cell::sync::Lazy;
use regex::Regex;

/// JS `DIRECTIVE_RE` =
/// `/impeccable-(disable-next-line|disable-line|disable)\b[ \t]*([^\n\r]*)/gi`.
static DIRECTIVE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        r"{imp}-({dnl}|{dl}|{d})(?-u:\b)[ \t]*([^\n\r]*)",
        imp = ci("impeccable"),
        dnl = ci("disable-next-line"),
        dl = ci("disable-line"),
        d = ci("disable")
    ))
    .unwrap()
});

/// JS `TRAILING_CLOSER_RE` = `/\s*(?:\*\/\}?|--+>|\*\}|#\}|%>|\}\})\s*$/`.
static TRAILING_CLOSER_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        r"{WS}*(?:\*/\}}?|--+>|\*\}}|#\}}|%>|\}}\}}){WS}*$"
    ))
    .unwrap()
});

/// JS `/\s*(?:--+|:)\s*/`.
static REASON_SEP_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(&format!(r"{WS}*(?:--+|:){WS}*")).unwrap());

/// JS `/[\s,]+/`.
static TOKEN_SPLIT_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(&format!(r"[{},]+", js::WS_CHARS)).unwrap());

/// Cheap bail-out `/impeccable-disable/i`.
static HAS_DIRECTIVE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(&ci("impeccable-disable")).unwrap());

/// An insertion-ordered set of rule ids (JS `Set<string>`).
pub type RuleSet = Vec<String>;

/// The parsed directives of one file (JS `parseInlineIgnores` result).
/// `line` and `next_line` are insertion-ordered maps keyed by the 1-based
/// line the directive targets (JS `Map<number, Set<string>>`).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct InlineIgnores {
    pub file: RuleSet,
    pub line: Vec<(usize, RuleSet)>,
    pub next_line: Vec<(usize, RuleSet)>,
}

/// JS `normalizeRule(token)`.
pub fn normalize_rule(token: &str) -> String {
    js::to_lower_case(js::trim(token))
}

/// JS `parseRuleList(remainder)`.
fn parse_rule_list(remainder: &str) -> Vec<String> {
    let stripped = TRAILING_CLOSER_RE.replace(remainder, "");
    let mut text: &str = js::trim(&stripped);
    if let Some(m) = REASON_SEP_RE.find(text) {
        text = &text[..m.start()];
    }
    let tokens: Vec<String> = TOKEN_SPLIT_RE
        .split(text)
        .map(normalize_rule)
        .filter(|t| !t.is_empty())
        .collect();
    if tokens.is_empty() || tokens.iter().any(|t| t == "*") {
        return vec!["*".to_string()];
    }
    tokens
}

fn add_rules(set: &mut RuleSet, rules: &[String]) {
    for rule in rules {
        if !set.iter().any(|r| r == rule) {
            set.push(rule.clone());
        }
    }
}

fn get_set(map: &mut Vec<(usize, RuleSet)>, key: usize) -> &mut RuleSet {
    if let Some(pos) = map.iter().position(|(k, _)| *k == key) {
        &mut map[pos].1
    } else {
        map.push((key, Vec::new()));
        &mut map.last_mut().unwrap().1
    }
}

/// JS `parseInlineIgnores(content)`.
pub fn parse_inline_ignores(content: Option<&str>) -> InlineIgnores {
    let mut result = InlineIgnores::default();
    let text = content.unwrap_or("");
    if !HAS_DIRECTIVE_RE.is_match(text) {
        return result;
    }
    for (i, line) in text.split('\n').enumerate() {
        for m in DIRECTIVE_RE.captures_iter(line) {
            let variant = js::to_lower_case(m.get(1).unwrap().as_str());
            let rules = parse_rule_list(m.get(2).map(|g| g.as_str()).unwrap_or(""));
            if variant == "disable" {
                add_rules(&mut result.file, &rules);
            } else if variant == "disable-line" {
                add_rules(get_set(&mut result.line, i + 1), &rules);
            } else {
                // disable-next-line on line i+1 targets line i+2.
                add_rules(get_set(&mut result.next_line, i + 2), &rules);
            }
        }
    }
    result
}

fn set_matches(set: Option<&RuleSet>, rule: &str) -> bool {
    match set {
        Some(set) => set.iter().any(|r| r == "*" || r == rule),
        None => false,
    }
}

fn map_get<'a>(map: &'a [(usize, RuleSet)], key: usize) -> Option<&'a RuleSet> {
    map.iter().find(|(k, _)| *k == key).map(|(_, s)| s)
}

/// The two fields `isInlineIgnored` reads off a finding.
pub trait IgnorableFinding {
    /// JS `finding.antipattern` (None when absent / not a string).
    fn antipattern(&self) -> Option<&str>;
    /// JS `Number(finding.line)`.
    fn line_number(&self) -> f64;
}

/// JS `isInlineIgnored(finding, directives)`.
pub fn is_inline_ignored<F: IgnorableFinding + ?Sized>(
    finding: &F,
    directives: &InlineIgnores,
) -> bool {
    let rule = normalize_rule(finding.antipattern().unwrap_or(""));
    if rule.is_empty() {
        return false;
    }
    if set_matches(Some(&directives.file), &rule) {
        return true;
    }
    // `Number(finding.line) || 0`
    let mut line = finding.line_number();
    if line.is_nan() {
        line = 0.0;
    }
    if line > 0.0 {
        // Map keys are the integer line numbers written by the parser; a
        // non-integer line can never match one.
        if line.fract() == 0.0 && line <= usize::MAX as f64 {
            let key = line as usize;
            if set_matches(map_get(&directives.line, key), &rule) {
                return true;
            }
            if set_matches(map_get(&directives.next_line, key), &rule) {
                return true;
            }
        }
    }
    false
}

/// JS `hasDirectives(directives)`.
pub fn has_directives(directives: &InlineIgnores) -> bool {
    !directives.file.is_empty() || !directives.line.is_empty() || !directives.next_line.is_empty()
}

/// JS `applyInlineIgnores(findings, content)`: drop findings waived by an
/// inline directive in the same file's source text.
pub fn apply_inline_ignores<F: IgnorableFinding>(
    findings: Vec<F>,
    content: Option<&str>,
) -> Vec<F> {
    if findings.is_empty() {
        return findings;
    }
    let directives = parse_inline_ignores(content);
    if !has_directives(&directives) {
        return findings;
    }
    findings
        .into_iter()
        .filter(|f| !is_inline_ignored(f, &directives))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_directives() {
        let src = "<!-- impeccable-disable low-contrast -- exported -->\nx /* impeccable-disable-line design-system-font */\n// impeccable-disable-next-line bounce-easing: reason\nfoo\n";
        let d = parse_inline_ignores(Some(src));
        assert_eq!(d.file, vec!["low-contrast"]);
        assert_eq!(d.line, vec![(2, vec!["design-system-font".to_string()])]);
        assert_eq!(d.next_line, vec![(4, vec!["bounce-easing".to_string()])]);
        let bare = parse_inline_ignores(Some("<!-- impeccable-disable -->"));
        assert_eq!(bare.file, vec!["*"]);
    }
}
