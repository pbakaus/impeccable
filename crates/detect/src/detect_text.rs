//! Port of `cli/engine/engines/regex/detect-text.mjs`: the regex engine for
//! non-HTML sources (CSS, JSX, TSX, Vue, Svelte, Astro, ...): comment
//! stripping, `<style>` block and CSS-in-JS extraction, the inset-stripe scan,
//! line matchers, page analyzers, dedupe, and inline ignores.

use impeccable_core::checks::css_scan::{
    scan_css_text_for_grid_background, scan_css_text_for_pseudo_stripe,
};
use impeccable_core::findings::{finding, Finding};
use impeccable_core::inline_ignores::apply_inline_ignores;
use impeccable_core::js::{self, ci, number_to_string, string_to_number};
use impeccable_core::page::is_full_page;
use impeccable_core::rule_pack::RulePack;

use crate::design_system::{check_source_design_system, DesignSystem};
use crate::profiler::{profile_findings, profile_step, DetectorProfile, ProfileMeta};
use crate::regex_matchers::{
    analyzer_rule_id, is_neutral_authored_color, MatchCtx, REGEX_ANALYZERS, REGEX_MATCHERS,
    TEXT_CONTENT_ANALYZER_IDS,
};
use crate::util::{line_of_offset, re, ANY, B, D, W, WS, WS_CHARS};

/// Options for `detect_text` (the JS `options` object).
#[derive(Default)]
pub struct TextOptions<'a> {
    pub profile: Option<&'a DetectorProfile>,
    pub design_system: Option<&'a DesignSystem>,
    /// JS `options.inlineIgnores === false` disables the waivers.
    pub inline_ignores: bool,
    /// An installed rule pack's text hook; `None` runs the built-ins only.
    pub rule_pack: Option<&'static dyn RulePack>,
}

const PAGE_ANALYZER_EXTS: &[&str] = &[".html", ".htm", ".astro", ".vue", ".svelte"];
const JS_SOURCE_EXTS: &[&str] = &[".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"];
const REGEX_PREFIX_KEYWORDS: &[&str] = &[
    "await",
    "case",
    "default",
    "delete",
    "do",
    "else",
    "in",
    "instanceof",
    "new",
    "of",
    "return",
    "throw",
    "typeof",
    "void",
    "yield",
];
const BLOCK_BRACE_PREFIX_KEYWORDS: &[&str] = &["do", "else", "finally", "try"];
const CSS_LIKE_EXTS: &[&str] = &[".css", ".scss", ".sass", ".less"];
const CSS_IN_JS_EXTENSIONS: &[&str] = &[".js", ".ts", ".jsx", ".tsx"];

re!(EXT_RE, format!("\\.{W}+$"));

/// JS `extFromFilePath`.
pub fn ext_from_file_path(file_path: &str) -> String {
    match EXT_RE.find(file_path) {
        Some(m) => js::to_lower_case(m.as_str()),
        None => String::new(),
    }
}

/// JS `shouldRunPageAnalyzers`.
pub fn should_run_page_analyzers(content: &str, file_path: &str) -> bool {
    if !is_full_page(content) {
        return false;
    }
    let ext = ext_from_file_path(file_path);
    ext.is_empty() || PAGE_ANALYZER_EXTS.contains(&ext.as_str())
}

fn is_ws(c: char) -> bool {
    js::is_js_whitespace(c)
}
fn is_word_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == '$'
}

re!(JSX_TAG_START_RE, "^<[A-Za-z][A-Za-z0-9_.:-]*");

fn is_inside_opening_jsx_tag(source: &str) -> bool {
    let Some(tag_start) = source.rfind('<') else {
        return false;
    };
    if !JSX_TAG_START_RE.is_match(&source[tag_start..]) {
        return false;
    }
    let mut quote: Option<char> = None;
    let mut chars = source[tag_start + 1..].chars();
    while let Some(ch) = chars.next() {
        if let Some(q) = quote {
            if ch == '\\' {
                chars.next();
            } else if ch == q {
                quote = None;
            }
        } else if ch == '\'' || ch == '"' {
            quote = Some(ch);
        } else if ch == '>' {
            return false;
        }
    }
    true
}

re!(JSX_TEXT_CONTEXT_RE, "<[A-Za-z](?:[^>]*[^/])?>[^<]*$");
re!(
    URL_HOST_RE,
    format!(
        "^[{W}.-]+\\.[A-Za-z]{{2,}}(?:[:/?#{WS_CHARS}<]|$)",
        W = "A-Za-z0-9_"
    )
);

fn last_line(output: &str) -> &str {
    match output.rfind('\n') {
        Some(i) => &output[i + 1..],
        None => output,
    }
}

/// Tracker of the "significant character" state the JS comment stripper and
/// template-expression scanner share.
#[derive(Default)]
struct Significant {
    last: Option<char>,
    previous: Option<char>,
    ante_previous: Option<char>,
    current_word: String,
    current_word_prefix: Option<char>,
    word_separated: bool,
}

impl Significant {
    fn record(&mut self, ch: char) {
        if is_ws(ch) {
            self.word_separated = true;
            return;
        }
        let is_word = is_word_char(ch);
        if is_word && (self.word_separated || self.current_word.is_empty()) {
            self.current_word.clear();
            self.current_word_prefix = self.last;
        } else if !is_word {
            self.current_word_prefix = None;
        }
        self.word_separated = false;
        self.ante_previous = self.previous;
        self.previous = self.last;
        self.last = Some(ch);
        if is_word {
            self.current_word.push(ch);
        } else {
            self.current_word.clear();
        }
    }
    fn after_postfix_update(&self) -> bool {
        matches!(self.last, Some('+') | Some('-'))
            && self.previous == self.last
            && self.ante_previous != self.last
    }
    fn regex_can_start(&self, last_closed_brace_kind: &str) -> bool {
        self.last.is_none()
            || (matches!(
                self.last,
                Some(
                    '=' | '('
                        | '['
                        | '{'
                        | '!'
                        | '?'
                        | ':'
                        | ';'
                        | ','
                        | '&'
                        | '|'
                        | '+'
                        | '-'
                        | '*'
                        | '%'
                        | '^'
                        | '~'
                        | '<'
                        | '>'
                )
            ) && !self.after_postfix_update())
            || (self.last == Some('}') && last_closed_brace_kind == "block")
            || (self.previous == Some('=') && self.last == Some('>'))
            || (self.current_word_prefix != Some('.')
                && REGEX_PREFIX_KEYWORDS.contains(&self.current_word.as_str()))
    }
    fn brace_kind(&self, starts_jsx_expression: bool, allow_empty: bool) -> &'static str {
        if !starts_jsx_expression
            && ((allow_empty && self.last.is_none())
                || self.last == Some(')')
                || self.last == Some(';')
                || self.last == Some('}')
                || (self.previous == Some('=') && self.last == Some('>'))
                || BLOCK_BRACE_PREFIX_KEYWORDS.contains(&self.current_word.as_str()))
        {
            "block"
        } else {
            "expression"
        }
    }
}

#[derive(Clone, Copy, PartialEq)]
enum State {
    Code,
    LineComment,
    BlockComment,
    Regex,
    Template,
    SingleQuote,
    DoubleQuote,
}

/// JS: detect-text.mjs#stripJsComments. Blanks comments without moving any
/// following source so line numbers survive.
pub fn strip_js_comments(content: &str, jsx: bool) -> String {
    let chars: Vec<char> = content.chars().collect();
    let mut state = State::Code;
    let mut output = String::with_capacity(content.len());
    let mut sig = Significant::default();
    let mut regex_char_class = false;
    let mut jsx_expression_depth: usize = 0;
    let mut last_closed_brace_kind: &'static str = "";
    let mut brace_kinds: Vec<&'static str> = Vec::new();
    let mut template_expression_depths: Vec<usize> = Vec::new();

    let mut i = 0;
    while i < chars.len() {
        let ch = chars[i];
        let next = chars.get(i + 1).copied();

        if state == State::LineComment {
            if ch == '\n' {
                output.push(ch);
                state = State::Code;
            } else {
                for _ in 0..ch.len_utf16() {
                    output.push(' ');
                }
            }
            i += 1;
            continue;
        }
        if state == State::BlockComment {
            if ch == '*' && next == Some('/') {
                output.push_str("  ");
                i += 2;
                state = State::Code;
            } else {
                if ch == '\n' {
                    output.push('\n');
                } else {
                    for _ in 0..ch.len_utf16() {
                        output.push(' ');
                    }
                }
                i += 1;
            }
            continue;
        }
        if state == State::Regex {
            output.push(ch);
            if ch == '\\' && next.is_some() {
                output.push(next.unwrap());
                i += 2;
                continue;
            } else if ch == '[' {
                regex_char_class = true;
            } else if ch == ']' {
                regex_char_class = false;
            } else if ch == '/' && !regex_char_class {
                state = State::Code;
                sig.record('/');
            }
            i += 1;
            continue;
        }
        if state == State::Template && ch == '$' && next == Some('{') {
            output.push_str("${");
            i += 2;
            sig.record('$');
            sig.record('{');
            template_expression_depths.push(1);
            brace_kinds.push("expression");
            if jsx_expression_depth > 0 {
                jsx_expression_depth += 1;
            }
            state = State::Code;
            continue;
        }
        if state != State::Code {
            output.push(ch);
            if ch == '\\' && next.is_some() {
                output.push(next.unwrap());
                i += 2;
                continue;
            } else if (state == State::SingleQuote && ch == '\'')
                || (state == State::DoubleQuote && ch == '"')
                || (state == State::Template && ch == '`')
            {
                state = State::Code;
                sig.record(ch);
            }
            i += 1;
            continue;
        }

        let jsx_url_separator = jsx
            && ch == '/'
            && next == Some('/')
            && jsx_expression_depth == 0
            && (output.ends_with("http:")
                || output.ends_with("https:")
                || (JSX_TEXT_CONTEXT_RE.is_match(last_line(&output))
                    && URL_HOST_RE.is_match(&chars[i + 2..].iter().collect::<String>())));
        if ch == '/' && next == Some('/') && jsx_url_separator {
            output.push_str("//");
            i += 2;
            sig.record('/');
            sig.record('/');
        } else if ch == '/' && next == Some('/') {
            output.push_str("  ");
            i += 2;
            state = State::LineComment;
        } else if ch == '/' && next == Some('*') {
            output.push_str("  ");
            i += 2;
            state = State::BlockComment;
        } else if !template_expression_depths.is_empty() && ch == '{' {
            output.push(ch);
            *template_expression_depths.last_mut().unwrap() += 1;
            brace_kinds.push(sig.brace_kind(false, true));
            if jsx_expression_depth > 0 {
                jsx_expression_depth += 1;
            }
            sig.record(ch);
            i += 1;
        } else if !template_expression_depths.is_empty() && ch == '}' {
            output.push(ch);
            let depth_index = template_expression_depths.len() - 1;
            template_expression_depths[depth_index] =
                template_expression_depths[depth_index].saturating_sub(1);
            last_closed_brace_kind = brace_kinds.pop().unwrap_or("");
            if jsx_expression_depth > 0 {
                jsx_expression_depth -= 1;
            }
            sig.record(ch);
            if template_expression_depths[depth_index] == 0 {
                template_expression_depths.pop();
                state = State::Template;
            }
            i += 1;
        } else if ch == '/' && sig.regex_can_start(last_closed_brace_kind) {
            output.push(ch);
            state = State::Regex;
            regex_char_class = false;
            i += 1;
        } else {
            output.push(ch);
            let starts_jsx_expression = jsx
                && ch == '{'
                && jsx_expression_depth == 0
                && ({
                    let without_last = &output[..output.len() - ch.len_utf8()];
                    JSX_TEXT_CONTEXT_RE.is_match(last_line(without_last))
                        || is_inside_opening_jsx_tag(without_last)
                });
            if ch == '{' {
                brace_kinds.push(sig.brace_kind(starts_jsx_expression, true));
            } else if ch == '}' {
                last_closed_brace_kind = brace_kinds.pop().unwrap_or("");
            }
            if ch == '{' && (jsx_expression_depth > 0 || starts_jsx_expression) {
                jsx_expression_depth += 1;
            } else if ch == '}' && jsx_expression_depth > 0 {
                jsx_expression_depth -= 1;
            }
            sig.record(ch);
            if ch == '\'' {
                state = State::SingleQuote;
            } else if ch == '"' {
                state = State::DoubleQuote;
            } else if ch == '`' {
                state = State::Template;
            }
            i += 1;
        }
    }
    output
}

re!(CSS_COMMENT_RE, format!("/\\*{ANY}*?\\*/"));

/// JS `stripCssComments`: blank comment bodies (each UTF-16 unit that is not
/// a newline becomes a space).
pub fn strip_css_comments(content: &str) -> String {
    CSS_COMMENT_RE
        .replace_all(content, |c: &regex::Captures| blank_non_newlines(&c[0]))
        .into_owned()
}

fn blank_non_newlines(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if c == '\n' {
            out.push('\n');
        } else {
            for _ in 0..c.len_utf16() {
                out.push(' ');
            }
        }
    }
    out
}

re!(HTML_COMMENT_RE, format!("<!--{ANY}*?-->"));
re!(
    BLANK_STYLE_TAG_RE,
    format!("<{s}{B}[^>]*>({ANY}*?)</{s}>", s = ci("style"))
);
re!(
    BLANK_SCRIPT_TAG_RE,
    format!("<{s}{B}[^>]*>{ANY}*?</{s}>", s = ci("script"))
);

/// JS `blankHtmlComments`.
fn blank_html_comments(text: &str) -> String {
    HTML_COMMENT_RE
        .replace_all(text, |c: &regex::Captures| blank_non_newlines(&c[0]))
        .into_owned()
}

/// JS `blankCssLineCommentsInStyleBlocks`.
fn blank_css_line_comments_in_style_blocks(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut last_index = 0usize;
    for m in BLANK_STYLE_TAG_RE.captures_iter(text) {
        let whole = m.get(0).unwrap();
        let inner = m.get(1).unwrap().as_str();
        let open_length = whole.as_str().len() - inner.len() - "</style>".len();
        output.push_str(&text[last_index..whole.start()]);
        output.push_str(&whole.as_str()[..open_length]);
        output.push_str(&blank_css_line_comments(inner));
        output.push_str(&whole.as_str()[open_length + inner.len()..]);
        last_index = whole.end();
    }
    output.push_str(&text[last_index..]);
    output
}

/// JS `blankHtmlAndCssCommentsOutsideScripts`.
fn blank_html_and_css_comments_outside_scripts(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut last_index = 0usize;
    for m in BLANK_SCRIPT_TAG_RE.find_iter(text) {
        output.push_str(&blank_css_line_comments_in_style_blocks(
            &strip_css_comments(&blank_html_comments(&text[last_index..m.start()])),
        ));
        output.push_str(m.as_str());
        last_index = m.end();
    }
    output.push_str(&blank_css_line_comments_in_style_blocks(
        &strip_css_comments(&blank_html_comments(&text[last_index..])),
    ));
    output
}

fn is_js_ws(c: char) -> bool {
    matches!(c,
        '\t' | '\n' | '\x0B' | '\x0C' | '\r' | ' ' | '\u{A0}' | '\u{1680}'
        | '\u{2000}'..='\u{200A}' | '\u{2028}' | '\u{2029}' | '\u{202F}'
        | '\u{205F}' | '\u{3000}' | '\u{FEFF}')
}

/// JS `blankCssLineComments`: a small state machine that blanks `//` line
/// comments while leaving quoted strings, `url(...)` interiors (including
/// protocol-relative `url(//...)`), and `://` untouched.
fn blank_css_line_comments(text: &str) -> String {
    #[derive(PartialEq)]
    enum State {
        Code,
        Line,
        Single,
        Double,
    }
    let chars: Vec<char> = text.chars().collect();
    let mut output = String::with_capacity(text.len());
    let mut state = State::Code;
    let mut url_depth = 0usize;
    let mut i = 0usize;
    while i < chars.len() {
        let ch = chars[i];
        let next = chars.get(i + 1).copied();
        if state == State::Line {
            if ch == '\n' {
                output.push('\n');
                state = State::Code;
            } else {
                for _ in 0..ch.len_utf16() {
                    output.push(' ');
                }
            }
            i += 1;
            continue;
        }
        if state == State::Single || state == State::Double {
            output.push(ch);
            if ch == '\\' {
                if let Some(n) = next {
                    output.push(n);
                    i += 1;
                }
            } else if (state == State::Single && ch == '\'')
                || (state == State::Double && ch == '"')
            {
                state = State::Code;
            }
            i += 1;
            continue;
        }
        let prev = output.chars().last();
        if ch == '/'
            && next == Some('/')
            && url_depth == 0
            && prev != Some(':')
            && prev != Some('(')
            && prev != Some('\\')
        {
            output.push_str("  ");
            i += 2;
            state = State::Line;
            continue;
        }
        if ch == '\'' {
            state = State::Single;
        } else if ch == '"' {
            state = State::Double;
        }
        if ch == '(' {
            let behind: String = {
                let trimmed: &str = output.trim_end_matches(is_js_ws);
                trimmed.to_string()
            };
            if url_depth > 0 || behind.to_ascii_lowercase().ends_with("url") {
                url_depth += 1;
            }
        } else if ch == ')' && url_depth > 0 {
            url_depth -= 1;
        }
        output.push(ch);
        i += 1;
    }
    output
}

fn chars_start_with(chars: &[char], at: usize, needle: &str) -> bool {
    let n: Vec<char> = needle.chars().collect();
    at + n.len() <= chars.len() && chars[at..at + n.len()] == n[..]
}

/// JS `findAstroFrontmatterClose`: index (in char units) of the `\n` before
/// the closing `---` fence, skipping fences hidden inside strings, template
/// literals, comments, and regex literals.
fn find_astro_frontmatter_close(chars: &[char]) -> Option<usize> {
    if !chars_start_with(chars, 0, "---") {
        return None;
    }
    let mut cursor = chars.iter().position(|c| *c == '\n')?;
    cursor += 1;
    while cursor < chars.len() {
        if chars[cursor - 1] == '\n' && chars_start_with(chars, cursor, "---") {
            let mut end = cursor + 3;
            while end < chars.len() && (chars[end] == ' ' || chars[end] == '\t') {
                end += 1;
            }
            if end >= chars.len() || chars[end] == '\n' || chars[end] == '\r' {
                return Some(cursor - 1);
            }
        }
        let ch = chars[cursor];
        let next = chars.get(cursor + 1).copied();
        if ch == '\'' || ch == '"' {
            cursor = find_quoted_string_end(chars, cursor, ch)? + 1;
            continue;
        }
        if ch == '`' {
            cursor = find_template_literal_end(chars, cursor)? + 1;
            continue;
        }
        if ch == '/' && next == Some('/') {
            let line_end = chars[cursor..].iter().position(|c| *c == '\n')? + cursor;
            cursor = line_end;
            continue;
        }
        if ch == '/' && next == Some('*') {
            let comment_end = find_sub(chars, cursor + 2, &['*', '/'])?;
            cursor = comment_end + 2;
            continue;
        }
        if ch == '/' && next != Some('/') && next != Some('*') {
            if let Some(close) = find_regex_literal_end(chars, cursor) {
                cursor = close + 1;
                continue;
            }
        }
        cursor += 1;
    }
    None
}

/// JS `blankAstroFrontmatterComments`.
fn blank_astro_frontmatter_comments(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let Some(close) = find_astro_frontmatter_close(&chars) else {
        return text.to_string();
    };
    let head: String = chars[..close].iter().collect();
    let tail: String = chars[close..].iter().collect();
    let mut out = strip_js_comments(&head, false);
    out.push_str(&tail);
    out
}

/// JS `blankCommentsForMatchers`.
fn blank_comments_for_matchers(text: &str, ext: &str) -> String {
    if PAGE_ANALYZER_EXTS.contains(&ext) {
        let with_frontmatter = if ext == ".astro" {
            blank_astro_frontmatter_comments(text)
        } else {
            text.to_string()
        };
        return blank_html_and_css_comments_outside_scripts(&with_frontmatter);
    }
    if CSS_LIKE_EXTS.contains(&ext) {
        let without_blocks = strip_css_comments(text);
        return if ext == ".css" {
            without_blocks
        } else {
            blank_css_line_comments(&without_blocks)
        };
    }
    text.to_string()
}

// ─── Inset stripe scan ───────────────────────────────────────────────────────

re!(
    CHROMATIC_SHADOW_TOKEN_RE,
    format!(
        "(?:^|-)(?:{})(?:-|$)",
        [
            "accent", "kinpaku", "patina", "gold", "red", "orange", "amber", "yellow", "lime",
            "green", "emerald", "teal", "cyan", "blue", "indigo", "violet", "purple", "magenta",
            "pink", "rose", "coral", "aqua", "mint", "burgundy", "crimson", "scarlet"
        ]
        .iter()
        .map(|w| ci(w))
        .collect::<Vec<_>>()
        .join("|")
    )
);
re!(
    IMPORTANT_TAIL_RE,
    format!("{WS}*{}{WS}*$", ci("!important"))
);
re!(
    IMPORTANT_TAIL_LOOSE_RE,
    format!("{WS}*!{WS}*{}{WS}*$", ci("important"))
);
re!(
    NO_PAINT_KEYWORD_RE,
    format!(
        "^(?:{}|{}|{}|{})$",
        ci("currentcolor"),
        ci("transparent"),
        ci("inherit"),
        ci("unset")
    )
);
re!(
    VAR_NAME_RE,
    format!("^{}\\({WS}*(--[{W}-]+)", ci("var"), W = "A-Za-z0-9_")
);
re!(
    COLOR_SHAPE_RE,
    format!(
        "^(?:#|{rgb}[aA]?\\(|{hsl}[aA]?\\(|{hwb}\\(|{oklch}\\(|{oklab}\\(|{lch}\\(|{lab}\\(|{color}\\(|[a-zA-Z]+$)",
        rgb = ci("rgb"),
        hsl = ci("hsl"),
        hwb = ci("hwb"),
        oklch = ci("oklch"),
        oklab = ci("oklab"),
        lch = ci("lch"),
        lab = ci("lab"),
        color = ci("color")
    )
);

fn inset_stripe_color_is_chromatic(raw_color: &str) -> bool {
    let color = IMPORTANT_TAIL_RE
        .replace(js::trim(raw_color), "")
        .into_owned();
    if NO_PAINT_KEYWORD_RE.is_match(&color) {
        return false;
    }
    if let Some(m) = VAR_NAME_RE.captures(&color) {
        return CHROMATIC_SHADOW_TOKEN_RE.is_match(&m[1]);
    }
    if !COLOR_SHAPE_RE.is_match(&color) {
        return false;
    }
    !is_neutral_authored_color(&color)
}

fn tokenize_shadow_layer(layer: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut depth = 0i32;
    let mut current = String::new();
    for ch in layer.chars() {
        if ch == '(' {
            depth += 1;
        } else if ch == ')' {
            depth -= 1;
        } else if depth == 0 && is_ws(ch) {
            if !current.is_empty() {
                tokens.push(std::mem::take(&mut current));
            }
            continue;
        }
        current.push(ch);
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

re!(
    SHADOW_LENGTH_RE,
    format!("^-?{D}*\\.?{D}+(?:{})?$", ci("px"))
);
fn is_shadow_length(token: &str) -> bool {
    SHADOW_LENGTH_RE.is_match(token)
}
re!(PX_TAIL_RE, format!("{}$", ci("px")));
re!(INSET_TOKEN_RE, format!("^{}$", ci("inset")));

re!(RULE_RE, "([^{};]+)\\{([^{}]*)\\}");
re!(
    STATE_PSEUDO_RE,
    format!(
        ":(?:{}|{}|{}|{}|{}|{}|{}){B}",
        ci("hover"),
        ci("focus"),
        ci("focus-visible"),
        ci("focus-within"),
        ci("active"),
        ci("checked"),
        ci("target")
    )
);
re!(
    ARIA_SELECTED_RE,
    format!(
        "\\[{}{WS}*[*^$|~]?={WS}*[\"']?{}",
        ci("aria-selected"),
        ci("true")
    )
);
re!(ARIA_CURRENT_RE, format!("\\[{}", ci("aria-current")));
re!(
    ARIA_CURRENT_FALSE_RE,
    format!(
        "^\\[{}{WS}*[*^$|~]?={WS}*[\"']?{}",
        ci("aria-current"),
        ci("false")
    )
);
re!(
    STATE_WORD_RE,
    format!(
        "(?:^|[{WS_CHARS}._\\[-])(?:{}|{}|{})",
        ci("active"),
        ci("current"),
        ci("selected")
    )
);
re!(
    SAFE_TAG_RE,
    format!(
        "(?:^|[{WS_CHARS}>+~,(])(?:{})",
        [
            "button",
            "hr",
            "tr",
            "td",
            "th",
            "table",
            "blockquote",
            "pre",
            "code"
        ]
        .iter()
        .map(|w| ci(w))
        .collect::<Vec<_>>()
        .join("|")
    )
);
re!(WS_RUN_RE, format!("{WS}+"));
re!(
    WIDTH_DECL_RE,
    format!(
        "(?:^|;){WS}*(?:{}|{}){WS}*:{WS}*({D}+(?:\\.{D}+)?){}",
        ci("width"),
        ci("inline-size"),
        ci("px")
    )
);
re!(
    BOX_SHADOW_DECL_RE,
    format!("(?:^|;){WS}*{}{WS}*:{WS}*([^;]+)", ci("box-shadow"))
);
re!(INSET_WORD_RE, format!("{B}{}{B}", ci("inset")));

/// `/[\s._[-](?:active|current|selected)(?![\w])/i`: the word must not be
/// followed by a word char.
fn selector_has_state_word(selector: &str) -> bool {
    let mut pos = 0;
    while let Some(m) = STATE_WORD_RE.find_at(selector, pos) {
        let after = selector[m.end()..].chars().next();
        if !after
            .map(|c| c.is_ascii_alphanumeric() || c == '_')
            .unwrap_or(false)
        {
            return true;
        }
        pos = m.start() + 1;
        while pos < selector.len() && !selector.is_char_boundary(pos) {
            pos += 1;
        }
        if pos > selector.len() {
            break;
        }
    }
    false
}

/// `(?:^|[\s>+~,(])(?:button|...)(?![\w-])`.
fn selector_has_safe_tag(selector: &str) -> bool {
    let mut pos = 0;
    while let Some(m) = SAFE_TAG_RE.find_at(selector, pos) {
        let after = selector[m.end()..].chars().next();
        if !after
            .map(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
            .unwrap_or(false)
        {
            return true;
        }
        pos = m.start() + 1;
        while pos < selector.len() && !selector.is_char_boundary(pos) {
            pos += 1;
        }
        if pos > selector.len() {
            break;
        }
    }
    false
}

/// `/\[aria-current(?!\s*[*^$|~]?=\s*["']?false)/i`.
fn selector_has_aria_current_not_false(selector: &str) -> bool {
    for m in ARIA_CURRENT_RE.find_iter(selector) {
        let rest = &selector[m.start()..];
        if !ARIA_CURRENT_FALSE_RE.is_match(rest) {
            return true;
        }
    }
    false
}

fn last_capture<'a>(re: &regex::Regex, text: &'a str) -> Option<regex::Captures<'a>> {
    re.captures_iter(text).last()
}

/// JS: detect-text.mjs#scanInsetStripeCss
pub fn scan_inset_stripe_css(
    raw_content: &str,
    file_path: &str,
    line_offset: usize,
) -> Vec<Finding> {
    let content = strip_css_comments(raw_content);
    let mut findings = Vec::new();
    for m in RULE_RE.captures_iter(&content) {
        let g1 = m.get(1).unwrap();
        let sel_raw = g1.as_str();
        let leading = sel_raw.len() - js::trim_start(sel_raw).len();
        let selector_start = g1.start() + leading;
        let selector = WS_RUN_RE.replace_all(js::trim(sel_raw), " ").into_owned();
        if selector.is_empty() {
            continue;
        }
        if STATE_PSEUDO_RE.is_match(&selector) {
            continue;
        }
        if ARIA_SELECTED_RE.is_match(&selector) {
            continue;
        }
        if selector_has_aria_current_not_false(&selector) {
            continue;
        }
        if selector_has_state_word(&selector) {
            continue;
        }
        if selector_has_safe_tag(&selector) {
            continue;
        }
        let body = &m[2];
        if let Some(width) = last_capture(&WIDTH_DECL_RE, body) {
            if string_to_number(&width[1]) <= 40.0 {
                continue;
            }
        }
        let Some(declaration) = last_capture(&BOX_SHADOW_DECL_RE, body) else {
            continue;
        };
        if !INSET_WORD_RE.is_match(&declaration[1]) {
            continue;
        }
        let shadow_value =
            js::trim(&IMPORTANT_TAIL_LOOSE_RE.replace(&declaration[1], "")).to_string();
        for raw_layer in split_layers(&shadow_value) {
            let layer = js::trim(&raw_layer);
            let tokens = tokenize_shadow_layer(layer);
            if !tokens.iter().any(|t| INSET_TOKEN_RE.is_match(t)) {
                continue;
            }
            let rest: Vec<&String> = tokens
                .iter()
                .filter(|t| !INSET_TOKEN_RE.is_match(t))
                .collect();
            let lengths: Vec<&&String> = rest.iter().filter(|t| is_shadow_length(t)).collect();
            let colors: Vec<&&String> = rest.iter().filter(|t| !is_shadow_length(t)).collect();
            if lengths.len() < 2 || lengths.len() > 4 || colors.len() != 1 {
                continue;
            }
            let values: Vec<(f64, bool)> = lengths
                .iter()
                .map(|t| {
                    (
                        string_to_number(&PX_TAIL_RE.replace(t, "")),
                        PX_TAIL_RE.is_match(t),
                    )
                })
                .collect();
            let x = values[0];
            let y = values[1];
            let blur = values.get(2).map(|v| v.0).unwrap_or(0.0);
            let spread = values.get(3).map(|v| v.0).unwrap_or(0.0);
            if (x.0 != 0.0 && !x.1) || (y.0 != 0.0 && !y.1) || blur != 0.0 || spread != 0.0 {
                continue;
            }
            let ax = x.0.abs();
            let ay = y.0.abs();
            if !(((3.0..=12.0).contains(&ax) && ay == 0.0)
                || ((3.0..=12.0).contains(&ay) && ax == 0.0))
            {
                continue;
            }
            if !inset_stripe_color_is_chromatic(colors[0]) {
                continue;
            }
            let edge = if ay == 0.0 {
                if x.0 > 0.0 {
                    "left"
                } else {
                    "right"
                }
            } else if y.0 > 0.0 {
                "top"
            } else {
                "bottom"
            };
            let line = line_offset + line_of_offset(&content, selector_start);
            let thickness = if ay == 0.0 { ax } else { ay };
            findings.push(finding(
                "side-tab",
                file_path,
                &format!(
                    "{selector} — inset box-shadow {}px stripe ({edge})",
                    number_to_string(thickness)
                ),
                line as f64,
            ));
            break;
        }
    }
    findings
}

/// JS `value.split(/,(?![^(]*\))/)`: split on commas not inside parens.
fn split_layers(value: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let chars: Vec<char> = value.chars().collect();
    for (i, ch) in chars.iter().enumerate() {
        if *ch == ',' {
            // Lookahead `(?![^(]*\))`: no `)` before the next `(`.
            let mut inside = false;
            for c in &chars[i + 1..] {
                if *c == '(' {
                    break;
                }
                if *c == ')' {
                    inside = true;
                    break;
                }
            }
            if !inside {
                out.push(std::mem::take(&mut current));
                continue;
            }
        }
        current.push(*ch);
    }
    out.push(current);
    out
}

// ─── Style block extraction ──────────────────────────────────────────────────

/// An extracted CSS block and the 1-based line the JS records for it.
#[derive(Debug, Clone, PartialEq)]
pub struct Block {
    pub content: String,
    pub start_line: usize,
}

re!(
    STYLE_TAG_RE,
    format!("<{s}[^>]*>({ANY}*?)</{s}>", s = ci("style"))
);

/// JS: detect-text.mjs#extractStyleBlocks
pub fn extract_style_blocks(content: &str, ext: &str) -> Vec<Block> {
    let ext = js::to_lower_case(ext);
    if ext != ".astro" && ext != ".vue" && ext != ".svelte" {
        return vec![];
    }
    STYLE_TAG_RE
        .captures_iter(content)
        .map(|m| Block {
            content: m[1].to_string(),
            start_line: line_of_offset(content, m.get(0).unwrap().start()) + 1,
        })
        .collect()
}

// ─── CSS-in-JS extraction ────────────────────────────────────────────────────

fn find_quoted_string_end(chars: &[char], start: usize, quote: char) -> Option<usize> {
    let mut cursor = start + 1;
    while cursor < chars.len() {
        if chars[cursor] == '\\' {
            cursor += 1;
        } else if chars[cursor] == quote {
            return Some(cursor);
        }
        cursor += 1;
    }
    None
}

fn find_regex_literal_end(chars: &[char], start: usize) -> Option<usize> {
    let mut in_class = false;
    let mut cursor = start + 1;
    while cursor < chars.len() {
        let ch = chars[cursor];
        if ch == '\\' {
            cursor += 1;
        } else if ch == '[' {
            in_class = true;
        } else if ch == ']' {
            in_class = false;
        } else if ch == '/' && !in_class {
            while chars
                .get(cursor + 1)
                .map(|c| c.is_ascii_alphabetic())
                .unwrap_or(false)
            {
                cursor += 1;
            }
            return Some(cursor);
        } else if ch == '\n' || ch == '\r' {
            return None;
        }
        cursor += 1;
    }
    None
}

fn find_template_expression_end(chars: &[char], start: usize) -> Option<usize> {
    let mut depth = 1usize;
    let mut sig = Significant::default();
    let mut last_closed_brace_kind: &'static str = "";
    let mut brace_kinds: Vec<&'static str> = Vec::new();
    let mut cursor = start;
    while cursor < chars.len() {
        let ch = chars[cursor];
        let next = chars.get(cursor + 1).copied();
        if ch == '\'' || ch == '"' {
            cursor = find_quoted_string_end(chars, cursor, ch)?;
            sig.record(')');
        } else if ch == '/' && next == Some('/') {
            let line_end = chars[cursor + 2..].iter().position(|c| *c == '\n')? + cursor + 2;
            cursor = line_end;
        } else if ch == '/' && next == Some('*') {
            let comment_end = find_sub(chars, cursor + 2, &['*', '/'])?;
            cursor = comment_end + 1;
        } else if ch == '/' && sig.regex_can_start(last_closed_brace_kind) {
            cursor = find_regex_literal_end(chars, cursor)?;
            sig.record(')');
        } else if ch == '`' {
            cursor = find_template_literal_end(chars, cursor)?;
            sig.record(')');
        } else if ch == '{' {
            depth += 1;
            brace_kinds.push(sig.brace_kind(false, false));
            sig.record(ch);
        } else if ch == '}' {
            depth -= 1;
            if depth == 0 {
                return Some(cursor);
            }
            last_closed_brace_kind = brace_kinds.pop().unwrap_or("");
            sig.record(ch);
        } else {
            sig.record(ch);
        }
        cursor += 1;
    }
    None
}

fn find_sub(chars: &[char], from: usize, needle: &[char]) -> Option<usize> {
    if from > chars.len() {
        return None;
    }
    chars[from..]
        .windows(needle.len())
        .position(|w| w == needle)
        .map(|p| p + from)
}

fn find_template_literal_end(chars: &[char], start: usize) -> Option<usize> {
    let mut cursor = start + 1;
    while cursor < chars.len() {
        let ch = chars[cursor];
        if ch == '\\' {
            cursor += 1;
        } else if ch == '`' {
            return Some(cursor);
        } else if ch == '$' && chars.get(cursor + 1) == Some(&'{') {
            cursor = find_template_expression_end(chars, cursor + 2)?;
        }
        cursor += 1;
    }
    None
}

/// `{ tagStart, contentStart, contentEnd }` in char indices.
struct Template {
    tag_start: usize,
    content_start: usize,
    content_end: usize,
}

re!(
    CSS_TAG_RE,
    format!("{B}(?:styled(?:\\.{W}+|\\([^)]+\\))|css)")
);

fn find_css_in_js_templates(content: &str) -> Vec<Template> {
    let chars: Vec<char> = content.chars().collect();
    // Map byte offsets to char indices for the tag regex.
    let mut byte_to_char: Vec<usize> = Vec::with_capacity(content.len() + 1);
    for (ci_idx, (b, c)) in content.char_indices().enumerate() {
        while byte_to_char.len() < b {
            byte_to_char.push(ci_idx);
        }
        byte_to_char.push(ci_idx);
        let _ = c;
    }
    while byte_to_char.len() <= content.len() {
        byte_to_char.push(chars.len());
    }
    let char_to_byte: Vec<usize> = {
        let mut v: Vec<usize> = content.char_indices().map(|(b, _)| b).collect();
        v.push(content.len());
        v
    };
    let mut templates = Vec::new();
    let mut search_from = 0usize; // byte offset
    while search_from <= content.len() {
        let Some(m) = CSS_TAG_RE.find_at(content, search_from) else {
            break;
        };
        let tag_start = byte_to_char[m.start()];
        let mut cursor = byte_to_char[m.end()];
        while cursor < chars.len() && is_ws(chars[cursor]) {
            cursor += 1;
        }
        let mut skip = false;
        if chars.get(cursor) == Some(&'<') {
            let mut depth = 0i64;
            while cursor < chars.len() {
                let ch = chars[cursor];
                if ch == '<' {
                    depth += 1;
                } else if ch == '>' && chars.get(cursor.wrapping_sub(1)) != Some(&'=') {
                    depth -= 1;
                }
                cursor += 1;
                if depth == 0 {
                    break;
                }
            }
            if depth != 0 {
                skip = true;
            } else {
                while cursor < chars.len() && is_ws(chars[cursor]) {
                    cursor += 1;
                }
            }
        }
        if skip || chars.get(cursor) != Some(&'`') {
            search_from = m.end();
            continue;
        }
        let content_start = cursor + 1;
        match find_template_literal_end(&chars, cursor) {
            None => {
                search_from = m.end();
                continue;
            }
            Some(end) => {
                templates.push(Template {
                    tag_start,
                    content_start,
                    content_end: end,
                });
                search_from = char_to_byte[(end + 1).min(chars.len())];
            }
        }
    }
    templates
}

/// JS: detect-text.mjs#extractCSSinJS
pub fn extract_css_in_js(content: &str, ext: &str) -> Vec<Block> {
    let ext = js::to_lower_case(ext);
    if !CSS_IN_JS_EXTENSIONS.contains(&ext.as_str()) {
        return vec![];
    }
    let chars: Vec<char> = content.chars().collect();
    find_css_in_js_templates(content)
        .into_iter()
        .map(|t| {
            let before: String = chars[..t.tag_start].iter().collect();
            Block {
                content: chars[t.content_start..t.content_end].iter().collect(),
                start_line: before.split('\n').count(),
            }
        })
        .collect()
}

fn strip_css_in_js_comments(content: &str, ext: &str) -> String {
    if !CSS_IN_JS_EXTENSIONS.contains(&js::to_lower_case(ext).as_str()) {
        return content.to_string();
    }
    let chars: Vec<char> = content.chars().collect();
    let templates = find_css_in_js_templates(content);
    let mut output = String::with_capacity(content.len());
    let mut cursor = 0usize;
    for t in templates {
        output.extend(chars[cursor..t.content_start].iter());
        let inner: String = chars[t.content_start..t.content_end].iter().collect();
        output.push_str(&strip_css_comments(&inner));
        cursor = t.content_end;
    }
    output.extend(chars[cursor..].iter());
    output
}

// ─── Matchers over lines ─────────────────────────────────────────────────────

/// JS: detect-text.mjs#runRegexMatchers
pub fn run_regex_matchers(
    lines: &[&str],
    file_path: &str,
    line_offset: usize,
    block_context: bool,
    profile: Option<&DetectorProfile>,
    phase: &str,
) -> Vec<Finding> {
    let mut findings = Vec::new();
    for matcher in REGEX_MATCHERS.iter() {
        let run = || {
            let mut matches = Vec::new();
            for (i, line) in lines.iter().enumerate() {
                let ctxs: Vec<MatchCtx> = (matcher.find_all)(line);
                if ctxs.is_empty() {
                    continue;
                }
                let context: String = if block_context {
                    let lo = i.saturating_sub(3);
                    let hi = (i + 4).min(lines.len());
                    lines[lo..hi].join(" ")
                } else {
                    line.to_string()
                };
                for m in ctxs {
                    if (matcher.test)(&m, &context) {
                        matches.push(finding(
                            matcher.id,
                            file_path,
                            &(matcher.fmt)(&m, &context),
                            (i + 1 + line_offset) as f64,
                        ));
                    }
                }
            }
            matches
        };
        let meta = ProfileMeta {
            engine: "regex",
            phase,
            rule_id: matcher.id,
            target: file_path,
        };
        findings.extend(profile_findings(
            profile,
            meta,
            |f: &Finding| f.antipattern.as_str(),
            run,
        ));
    }
    findings
}

/// JS: detect-text.mjs#runTextContentAnalyzers
pub fn run_text_content_analyzers(
    content: &str,
    file_path: &str,
    profile: Option<&DetectorProfile>,
) -> Vec<Finding> {
    if !should_run_page_analyzers(content, file_path) {
        return vec![];
    }
    let mut findings = Vec::new();
    // JS: the 3 text-content analyzers sit at indices 1-3 of REGEX_ANALYZERS.
    // flat-type-hierarchy left this source-only path in #702 because it needs
    // rendered role and usage evidence.
    for (i, rule_id) in TEXT_CONTENT_ANALYZER_IDS.iter().enumerate() {
        let analyzer = REGEX_ANALYZERS[1 + i];
        let meta = ProfileMeta {
            engine: "regex",
            phase: "text-content",
            rule_id,
            target: file_path,
        };
        findings.extend(profile_findings(
            profile,
            meta,
            |f: &Finding| f.antipattern.as_str(),
            || analyzer(content, file_path),
        ));
    }
    findings
}

fn pseudo_stripe_findings(text: &str, file_path: &str, line_offset: usize) -> Vec<Finding> {
    scan_css_text_for_pseudo_stripe(text)
        .into_iter()
        .map(|hit| {
            let line = line_offset + line_of_offset(text, hit.index.unwrap_or(0));
            finding(&hit.id, file_path, &hit.snippet, line as f64)
        })
        .collect()
}

/// JS: detect-text.mjs#detectText
pub fn detect_text(content: &str, file_path: &str, options: &TextOptions) -> Vec<Finding> {
    let profile = options.profile;
    let mut findings: Vec<Finding> = Vec::new();
    let ext = ext_from_file_path(file_path);
    let comment_stripped = if JS_SOURCE_EXTS.contains(&ext.as_str()) {
        strip_js_comments(content, ext == ".js" || ext == ".jsx" || ext == ".tsx")
    } else {
        blank_comments_for_matchers(content, &ext)
    };
    let source = strip_css_in_js_comments(&comment_stripped, &ext);
    let lines: Vec<&str> = source.split('\n').collect();
    let css_like = CSS_LIKE_EXTS.contains(&ext.as_str());

    findings.extend(run_regex_matchers(
        &lines, file_path, 0, css_like, profile, "source",
    ));

    if css_like {
        findings.extend(scan_inset_stripe_css(content, file_path, 0));
        findings.extend(pseudo_stripe_findings(content, file_path, 0));
    }

    let grid_meta = ProfileMeta {
        engine: "regex",
        phase: "source",
        rule_id: "codex-grid-background",
        target: file_path,
    };
    findings.extend(profile_findings(
        profile,
        grid_meta,
        |f: &Finding| f.antipattern.as_str(),
        || {
            scan_css_text_for_grid_background(&source)
                .into_iter()
                .map(|hit| {
                    finding(
                        "codex-grid-background",
                        file_path,
                        &hit.snippet,
                        line_of_offset(&source, hit.index) as f64,
                    )
                })
                .collect()
        },
    ));

    let style_blocks = profile_step(
        profile,
        ProfileMeta {
            engine: "regex",
            phase: "extract",
            rule_id: "style-blocks",
            target: file_path,
        },
        || extract_style_blocks(content, &ext),
    );
    for block in &style_blocks {
        let block_content = blank_css_line_comments(&strip_css_comments(&block.content));
        let block_lines: Vec<&str> = block_content.split('\n').collect();
        findings.extend(run_regex_matchers(
            &block_lines,
            file_path,
            block.start_line - 1,
            true,
            profile,
            "style-block",
        ));
        findings.extend(scan_inset_stripe_css(
            &block_content,
            file_path,
            block.start_line - 2,
        ));
        findings.extend(pseudo_stripe_findings(
            &block_content,
            file_path,
            block.start_line - 2,
        ));
    }

    let css_js_blocks = profile_step(
        profile,
        ProfileMeta {
            engine: "regex",
            phase: "extract",
            rule_id: "css-in-js",
            target: file_path,
        },
        || extract_css_in_js(&source, &ext),
    );
    for block in &css_js_blocks {
        let block_content = strip_css_comments(&block.content);
        let block_lines: Vec<&str> = block_content.split('\n').collect();
        findings.extend(run_regex_matchers(
            &block_lines,
            file_path,
            block.start_line - 1,
            true,
            profile,
            "css-in-js",
        ));
        findings.extend(scan_inset_stripe_css(
            &block_content,
            file_path,
            block.start_line - 1,
        ));
        findings.extend(pseudo_stripe_findings(
            &block_content,
            file_path,
            block.start_line - 1,
        ));
    }

    if let Some(ds) = options.design_system {
        let meta = ProfileMeta {
            engine: "regex",
            phase: "source",
            rule_id: "design-system",
            target: file_path,
        };
        findings.extend(profile_findings(
            profile,
            meta,
            |f: &Finding| f.antipattern.as_str(),
            || check_source_design_system(content, file_path, Some(ds)),
        ));
    }

    // Deduplicate (same antipattern + snippet within 2 lines).
    let mut deduped: Vec<Finding> = Vec::new();
    for f in findings {
        let is_dupe = deduped.iter().any(|d| {
            d.antipattern == f.antipattern
                && d.snippet == f.snippet
                && (d.line - f.line).abs() <= 2.0
        });
        if !is_dupe {
            deduped.push(f);
        }
    }

    if should_run_page_analyzers(content, file_path) {
        for (i, analyzer) in REGEX_ANALYZERS.iter().enumerate() {
            let rule_id = analyzer_rule_id(i);
            let meta = ProfileMeta {
                engine: "regex",
                phase: "page-analyzer",
                rule_id: &rule_id,
                target: file_path,
            };
            deduped.extend(profile_findings(
                profile,
                meta,
                |f: &Finding| f.antipattern.as_str(),
                || analyzer(content, file_path),
            ));
        }
    }

    // A rule pack sees the file after every built-in matcher, analyzer, and
    // the dedupe, and before inline ignores: its rows are waivable with
    // `impeccable-disable` exactly like built-in rules, and appending keeps
    // built-in output byte-identical when no pack is installed.
    if let Some(pack) = options.rule_pack {
        deduped.extend(pack.check_text(content, file_path, &ext));
    }

    if options.inline_ignores {
        apply_inline_ignores(deduped, Some(content))
    } else {
        deduped
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn comments() {
        let out = strip_js_comments("a // x\nb /* y */ c\nconst r = /\\/\\//; d", true);
        assert_eq!(out, "a     \nb         c\nconst r = /\\/\\//; d");
        assert_eq!(strip_css_comments("a /* é */ b"), "a         b");
    }

    #[test]
    fn css_in_js() {
        let src = "const A = styled.div`\n  border-left: 4px solid red;\n`;\n";
        let blocks = extract_css_in_js(src, ".tsx");
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].start_line, 1);
        let f = detect_text(
            src,
            "/x/a.tsx",
            &TextOptions {
                inline_ignores: true,
                ..Default::default()
            },
        );
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].line, 2.0);
    }

    #[test]
    fn inset_stripe() {
        let css = ".card {\n  box-shadow: inset 4px 0 0 #6366f1;\n}\n";
        let f = scan_inset_stripe_css(css, "a.css", 0);
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].snippet, ".card — inset box-shadow 4px stripe (left)");
        assert_eq!(f[0].line, 1.0);
    }
}
