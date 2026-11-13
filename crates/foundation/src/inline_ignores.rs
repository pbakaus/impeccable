//! Port of `cli/engine/shared/inline-ignores.mjs`: eslint-disable-style
//! waivers that live in the scanned file (`impeccable-disable`,
//! `impeccable-disable-line`, `impeccable-disable-next-line`).
//!
//! [`unused_directives`] names the waivers that matched nothing, which
//! `impeccable detect --report-unused-ignores` reports. A waiver is used
//! when [`is_inline_ignored`] would drop a finding.

use std::collections::{HashMap, HashSet};

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

/// One `impeccable-disable*` comment, in source order.
///
/// `rules` is the parsed list ([`parse_rule_list`]): one or more rule ids,
/// or `["*"]` when the comment names none or names `*`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Directive {
    /// 1-based line the comment sits on.
    pub source_line: usize,
    /// `disable`, `disable-line`, or `disable-next-line`.
    pub variant: String,
    /// The line a `-line` or `-next-line` directive waives. `None` for a
    /// whole-file `disable`, which matches a finding on any line, including
    /// one with no line (static HTML).
    pub target_line: Option<usize>,
    /// Rule ids, or `["*"]` when the comment waives every rule.
    pub rules: Vec<String>,
}

/// A `(directive, rule)` pair that [`is_inline_ignored`] would not waive
/// any of the findings it was shown. `rule` is one id from a multi-rule
/// comment, or `*`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnusedDirective {
    pub source_line: usize,
    pub variant: String,
    pub rule: String,
}

/// JS `parseInlineIgnores(content)`, one entry per comment rather than folded
/// into the waiver sets. The same regexes and the same line numbering:
/// `disable-line` on line `i` targets `i`, `disable-next-line` targets `i + 1`.
pub fn parse_inline_directives(content: Option<&str>) -> Vec<Directive> {
    let text = content.unwrap_or("");
    if !HAS_DIRECTIVE_RE.is_match(text) {
        return Vec::new();
    }
    let mut out = Vec::new();
    for (i, line) in text.split('\n').enumerate() {
        let source_line = i + 1;
        for m in DIRECTIVE_RE.captures_iter(line) {
            let variant = js::to_lower_case(m.get(1).unwrap().as_str());
            let rules = parse_rule_list(m.get(2).map(|g| g.as_str()).unwrap_or(""));
            let target_line = if variant == "disable" {
                None
            } else if variant == "disable-line" {
                Some(source_line)
            } else {
                // disable-next-line on line i+1 targets line i+2.
                Some(source_line + 1)
            };
            out.push(Directive {
                source_line,
                variant,
                target_line,
                rules,
            });
        }
    }
    out
}

/// JS `parseInlineIgnores(content)`.
pub fn parse_inline_ignores(content: Option<&str>) -> InlineIgnores {
    fold_directives(&parse_inline_directives(content))
}

/// Fold per-comment directives into the waiver sets [`is_inline_ignored`]
/// reads.
fn fold_directives(directives: &[Directive]) -> InlineIgnores {
    let mut result = InlineIgnores::default();
    for directive in directives {
        if directive.variant == "disable" {
            add_rules(&mut result.file, &directive.rules);
        } else if directive.variant == "disable-line" {
            let line = directive.target_line.unwrap_or(directive.source_line);
            add_rules(get_set(&mut result.line, line), &directive.rules);
        } else {
            let line = directive
                .target_line
                .unwrap_or(directive.source_line.saturating_add(1));
            add_rules(get_set(&mut result.next_line, line), &directive.rules);
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

/// Line key [`is_inline_ignored`] uses. `Number(finding.line) || 0`, then a
/// positive integer that fits in `usize`. Anything else matches no
/// line-scoped directive.
fn waiver_line(line: f64) -> Option<usize> {
    let line = if line.is_nan() { 0.0 } else { line };
    if line > 0.0 && line.fract() == 0.0 && line <= usize::MAX as f64 {
        Some(line as usize)
    } else {
        None
    }
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
    // Map keys are the integer line numbers written by the parser; a
    // non-integer line can never match one.
    let Some(key) = waiver_line(finding.line_number()) else {
        return false;
    };
    set_matches(map_get(&directives.line, key), &rule)
        || set_matches(map_get(&directives.next_line, key), &rule)
}

/// Findings keyed the way one directive rule looks them up.
///
/// Built once per file. Checking [`is_inline_ignored`] against a fresh
/// waiver set for every (directive, rule) pair rescans every finding, which
/// is quadratic when a file (or a hostile one) has many of both.
struct FindingIndex {
    /// Normalized rules present on at least one finding, any line.
    rules: HashSet<String>,
    /// Positive integer lines that carry a non-empty rule. A line-scoped
    /// `*` is used when its target is here.
    lines_any: HashSet<usize>,
    /// Normalized rule -> waiver lines it sits on.
    lines_by_rule: HashMap<String, HashSet<usize>>,
}

fn index_findings<F: IgnorableFinding>(findings: &[F]) -> FindingIndex {
    let mut rules = HashSet::with_capacity(findings.len());
    let mut lines_any = HashSet::new();
    let mut lines_by_rule: HashMap<String, HashSet<usize>> = HashMap::new();
    for finding in findings {
        let rule = normalize_rule(finding.antipattern().unwrap_or(""));
        if rule.is_empty() {
            continue;
        }
        if let Some(line) = waiver_line(finding.line_number()) {
            lines_any.insert(line);
            lines_by_rule.entry(rule.clone()).or_default().insert(line);
        }
        rules.insert(rule);
    }
    FindingIndex {
        rules,
        lines_any,
        lines_by_rule,
    }
}

/// Whether `rule` inside `directive` alone would make [`is_inline_ignored`]
/// drop some indexed finding.
///
/// A file `disable` matches that rule on any line, and `*` matches every
/// non-empty rule. A `-line` or `-next-line` matches only its target line
/// (already stored on the directive); with no target line it matches nothing.
fn directive_rule_used(index: &FindingIndex, directive: &Directive, rule: &str) -> bool {
    if directive.variant == "disable" {
        return if rule == "*" {
            !index.rules.is_empty()
        } else {
            index.rules.contains(rule)
        };
    }
    let Some(line) = directive.target_line else {
        return false;
    };
    if rule == "*" {
        index.lines_any.contains(&line)
    } else {
        match index.lines_by_rule.get(rule) {
            Some(lines) => lines.contains(&line),
            None => false,
        }
    }
}

/// Directives whose rule waived nothing in `findings`.
///
/// A pair is used when [`is_inline_ignored`] would drop some finding. Each
/// rule of a multi-rule comment is judged on its own. `*` is used when it
/// waived any finding at all, and unused only when it waived none. Findings
/// the caller still has — advisory ones included — count as a use. The same
/// finding can use every directive that would waive it. Findings are indexed
/// once by rule and line, so this stays linear in the file like
/// [`apply_inline_ignores`].
pub fn unused_directives<F: IgnorableFinding>(
    findings: &[F],
    content: Option<&str>,
) -> Vec<UnusedDirective> {
    unused_from(findings, parse_inline_directives(content))
}

fn unused_from<F: IgnorableFinding>(
    findings: &[F],
    directives: Vec<Directive>,
) -> Vec<UnusedDirective> {
    if directives.is_empty() {
        return Vec::new();
    }
    let index = index_findings(findings);
    let mut unused = Vec::new();
    for directive in directives {
        // One comment can name the same id twice. Report it once.
        let mut seen = HashSet::with_capacity(directive.rules.len());
        for rule in &directive.rules {
            if !seen.insert(rule.as_str()) {
                continue;
            }
            if directive_rule_used(&index, &directive, rule) {
                continue;
            }
            unused.push(UnusedDirective {
                source_line: directive.source_line,
                variant: directive.variant.clone(),
                rule: rule.clone(),
            });
        }
    }
    unused
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

/// [`apply_inline_ignores`] and [`unused_directives`] from one parse of
/// `content`: the findings the waivers keep, and each waiver rule that
/// waived none of `findings`.
pub fn apply_inline_ignores_reporting_unused<F: IgnorableFinding>(
    findings: Vec<F>,
    content: Option<&str>,
) -> (Vec<F>, Vec<UnusedDirective>) {
    let directives = parse_inline_directives(content);
    if directives.is_empty() {
        return (findings, Vec::new());
    }
    let waivers = fold_directives(&directives);
    let unused = unused_from(&findings, directives);
    let kept = findings
        .into_iter()
        .filter(|f| !is_inline_ignored(f, &waivers))
        .collect();
    (kept, unused)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_parse_keeps_what_apply_keeps_and_reports_what_unused_reports() {
        let src = "a /* impeccable-disable-line overused-font, bounce-easing */\n// impeccable-disable-next-line side-tab\nb\n";
        let raw = vec![
            crate::findings::finding("overused-font", "a.css", "Inter", 1.0),
            crate::findings::finding("gradient-text", "a.css", "x", 3.0),
        ];
        let (kept, unused) = apply_inline_ignores_reporting_unused(raw.clone(), Some(src));
        assert_eq!(kept, apply_inline_ignores(raw.clone(), Some(src)));
        assert_eq!(unused, unused_directives(&raw, Some(src)));
        let rules: Vec<&str> = unused.iter().map(|u| u.rule.as_str()).collect();
        assert_eq!(rules, vec!["bounce-easing", "side-tab"]);
        let (kept, unused) = apply_inline_ignores_reporting_unused(raw.clone(), Some("no waivers"));
        assert_eq!(kept, raw);
        assert!(unused.is_empty());
    }

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

    /// A directive naming a rule the registry retired still parses and still
    /// waives a finding carrying that id: inline ignores read the id off the
    /// finding and never consult the registry, so a config written against an
    /// older release keeps working instead of failing the scan.
    #[test]
    fn retired_rule_id_still_parses() {
        let d = parse_inline_ignores(Some("<!-- impeccable-disable image-hover-transform -->"));
        assert_eq!(d.file, vec!["image-hover-transform"]);

        struct Hit(&'static str);
        impl IgnorableFinding for Hit {
            fn antipattern(&self) -> Option<&str> {
                Some(self.0)
            }
            fn line_number(&self) -> f64 {
                0.0
            }
        }
        assert!(is_inline_ignored(&Hit("image-hover-transform"), &d));
        assert!(!is_inline_ignored(&Hit("bounce-easing"), &d));

        // `layout-transition`, retired on 2026-10-07, named beside a live rule.
        let d = parse_inline_ignores(Some(
            "<!-- impeccable-disable layout-transition, bounce-easing -->",
        ));
        assert_eq!(d.file, vec!["layout-transition", "bounce-easing"]);
        assert!(is_inline_ignored(&Hit("layout-transition"), &d));
        assert!(is_inline_ignored(&Hit("bounce-easing"), &d));
        assert!(!is_inline_ignored(&Hit("dark-glow"), &d));
    }

    struct At {
        rule: &'static str,
        line: f64,
    }

    impl IgnorableFinding for At {
        fn antipattern(&self) -> Option<&str> {
            Some(self.rule)
        }
        fn line_number(&self) -> f64 {
            self.line
        }
    }

    #[test]
    fn directives_keep_source_line_variant_and_target() {
        let src = "/* impeccable-disable-line overused-font, bounce-easing */\n// impeccable-disable-next-line bounce-easing: the spring\n.hero {}\n<!-- impeccable-disable -->\n";
        let d = parse_inline_directives(Some(src));
        assert_eq!(d.len(), 3);
        assert_eq!(d[0].source_line, 1);
        assert_eq!(d[0].variant, "disable-line");
        assert_eq!(d[0].target_line, Some(1));
        assert_eq!(d[0].rules, vec!["overused-font", "bounce-easing"]);
        assert_eq!(d[1].source_line, 2);
        assert_eq!(d[1].variant, "disable-next-line");
        assert_eq!(d[1].target_line, Some(3));
        assert_eq!(d[1].rules, vec!["bounce-easing"]);
        assert_eq!(d[2].variant, "disable");
        assert_eq!(d[2].target_line, None);
        assert_eq!(d[2].rules, vec!["*"]);
        assert_eq!(
            parse_inline_directives(Some("no waiver here")),
            Vec::<Directive>::new()
        );
    }

    #[test]
    fn unused_line_and_next_line_are_separate_from_a_live_rule() {
        let src = ".brand { font-family: Inter } /* impeccable-disable-line overused-font, bounce-easing */\n/* impeccable-disable-next-line bounce-easing */\n.ok { margin: 0 }\n/* impeccable-disable-next-line bounce-easing */\n.hero { animation: bounce }\n";
        let findings = [
            At {
                rule: "overused-font",
                line: 1.0,
            },
            At {
                rule: "bounce-easing",
                line: 5.0,
            },
        ];
        let unused = unused_directives(&findings, Some(src));
        assert_eq!(
            unused,
            vec![
                UnusedDirective {
                    source_line: 1,
                    variant: "disable-line".into(),
                    rule: "bounce-easing".into(),
                },
                UnusedDirective {
                    source_line: 2,
                    variant: "disable-next-line".into(),
                    rule: "bounce-easing".into(),
                },
            ]
        );
    }

    /// An advisory finding is still a finding. The caller passes it through;
    /// a waiver that matches it was used.
    #[test]
    fn advisory_finding_counts_as_a_use() {
        let src = "/* impeccable-disable-line bounce-easing */\n";
        let findings = [At {
            rule: "bounce-easing",
            line: 1.0,
        }];
        assert!(unused_directives(&findings, Some(src)).is_empty());
    }

    #[test]
    fn star_is_unused_only_when_it_waived_nothing() {
        let src = "<!-- impeccable-disable * -->\n";
        assert_eq!(
            unused_directives(&[] as &[At], Some(src)),
            vec![UnusedDirective {
                source_line: 1,
                variant: "disable".into(),
                rule: "*".into(),
            }]
        );
        let findings = [At {
            rule: "side-tab",
            line: 0.0,
        }];
        assert!(unused_directives(&findings, Some(src)).is_empty());
        // A bare comment is the same `*` waiver.
        let bare = "<!-- impeccable-disable -->\n";
        assert_eq!(unused_directives(&findings, Some(bare)), Vec::new());
    }

    /// Static HTML findings have no line. A whole-file directive can waive
    /// them; a line-scoped one cannot, so it is unused beside them.
    #[test]
    fn lineless_finding_uses_only_a_file_directive() {
        let src = "<!-- impeccable-disable side-tab -->\n<!-- impeccable-disable-line side-tab -->\n<div></div>\n";
        let findings = [At {
            rule: "side-tab",
            line: 0.0,
        }];
        assert_eq!(
            unused_directives(&findings, Some(src)),
            vec![UnusedDirective {
                source_line: 2,
                variant: "disable-line".into(),
                rule: "side-tab".into(),
            }]
        );
    }

    #[test]
    fn a_finding_on_the_comment_line_does_not_use_next_line() {
        let src = "/* impeccable-disable-next-line bounce-easing */\n.hero { animation: bounce }\n";
        let on_comment = [At {
            rule: "bounce-easing",
            line: 1.0,
        }];
        assert_eq!(unused_directives(&on_comment, Some(src)).len(), 1);
        let on_next = [At {
            rule: "bounce-easing",
            line: 2.0,
        }];
        assert!(unused_directives(&on_next, Some(src)).is_empty());
    }

    /// A line-scoped `*` is used by any other rule on its target line. A
    /// repeated id in one comment is a single waiver.
    #[test]
    fn star_line_matches_any_rule_and_duplicate_ids_collapse() {
        let src = "/* impeccable-disable-line */\n/* impeccable-disable-next-line bounce-easing, bounce-easing */\n.x {}\n";
        let on_star = [At {
            rule: "overused-font",
            line: 1.0,
        }];
        assert_eq!(
            unused_directives(&on_star, Some(src)),
            vec![UnusedDirective {
                source_line: 2,
                variant: "disable-next-line".into(),
                rule: "bounce-easing".into(),
            }]
        );
        let on_next = [At {
            rule: "bounce-easing",
            line: 3.0,
        }];
        assert_eq!(
            unused_directives(&on_next, Some(src)),
            vec![UnusedDirective {
                source_line: 1,
                variant: "disable-line".into(),
                rule: "*".into(),
            }]
        );
        let dup = "/* impeccable-disable-line bounce-easing, bounce-easing */\n";
        assert_eq!(unused_directives(&[] as &[At], Some(dup)).len(), 1);
    }

    /// An empty antipattern is not a finding `is_inline_ignored` can drop,
    /// so it does not use a `*` waiver. A non-integer line uses a file
    /// directive and not a line-scoped one.
    #[test]
    fn empty_rule_and_non_integer_line_match_the_ignore_check() {
        let src = "<!-- impeccable-disable -->\n/* impeccable-disable-line */\n";
        let empty = [At {
            rule: "",
            line: 2.0,
        }];
        assert_eq!(unused_directives(&empty, Some(src)).len(), 2);

        let src = "<!-- impeccable-disable bounce-easing -->\n/* impeccable-disable-line bounce-easing */\n";
        let fractional = [At {
            rule: "bounce-easing",
            line: 1.5,
        }];
        assert_eq!(
            unused_directives(&fractional, Some(src)),
            vec![UnusedDirective {
                source_line: 2,
                variant: "disable-line".into(),
                rule: "bounce-easing".into(),
            }]
        );
        let nan = [At {
            rule: "bounce-easing",
            line: f64::NAN,
        }];
        assert_eq!(unused_directives(&nan, Some(src)).len(), 1);
    }
}
