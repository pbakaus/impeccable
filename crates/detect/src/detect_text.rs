//! Port of `cli/engine/engines/regex/detect-text.mjs`: the regex engine for
//! non-HTML sources (CSS, JSX, TSX, Vue, Svelte, Astro, ...): comment
//! stripping, `<style>` block and CSS-in-JS extraction, the inset-stripe scan,
//! line matchers, page analyzers, dedupe, and inline ignores.

use impeccable_core::checks::css_scan::{
    scan_css_text_for_grid_background, scan_css_text_for_pseudo_stripe, side_stripe_index,
    CssHostIndex, CustomProps,
};
use impeccable_core::checks::row_stripe::scan_css_text_for_row_stripe;
use impeccable_core::checks::rules::DeclaredCorners;
use impeccable_core::findings::{finding, Finding};
use impeccable_core::inline_ignores::apply_inline_ignores;
use impeccable_core::js::{self, ci, number_to_string, string_to_number};
use impeccable_core::page::is_full_page;
use impeccable_core::rule_pack::RulePack;

use crate::design_system::{check_source_design_system, DesignSystem};
use crate::profiler::{profile_findings, profile_step, DetectorProfile, ProfileMeta};
use crate::regex_matchers::{
    analyzer_rule_id, is_neutral_authored_color, sass_sheet_corners,
    is_stripe_child_match, side_tab_known_square_in_sheet, side_tab_markup_known_square,
    side_tab_rounded_in_scope, style_index_text,
    ElementSource, MatchCtx, Scope, SourceText,
    REGEX_ANALYZERS, REGEX_MATCHERS, TEXT_CONTENT_ANALYZER_IDS,
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
    /// Custom properties declared elsewhere in the project (its token
    /// sheets), so a stripe coloured `var(--danger)` in a component reads
    /// the colour the token holds. `None` reads the file's own only.
    pub tokens: Option<&'a CustomProps>,
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

fn is_jsx_name_start(ch: char) -> bool {
    ch.is_alphabetic() || matches!(ch, '_' | '$')
}

fn is_jsx_name_continue(ch: char) -> bool {
    ch.is_alphanumeric() || matches!(ch, '_' | '$' | '.' | ':' | '-')
}

fn is_inside_opening_jsx_tag(source: &str) -> bool {
    let Some(tag_start) = source.rfind('<') else {
        return false;
    };
    let mut chars = source[tag_start + 1..].chars().peekable();
    if !chars.next().is_some_and(is_jsx_name_start) {
        return false;
    }
    while chars.peek().is_some_and(|ch| is_jsx_name_continue(*ch)) {
        chars.next();
    }
    if chars
        .peek()
        .is_some_and(|ch| !is_ws(*ch) && !matches!(ch, '<' | '/' | '>'))
    {
        return false;
    }
    let mut quote: Option<char> = None;
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

struct ParsedJsxTag {
    name: String,
    closing: bool,
    self_closing: bool,
    end: usize,
}

fn jsx_expression_end(chars: &[char], start: usize) -> Option<usize> {
    let mut depth = 1usize;
    let mut sig = Significant::default();
    let mut last_closed_brace_kind: &'static str = "";
    let mut brace_kinds: Vec<&'static str> = Vec::new();
    let mut jsx_stack: Vec<String> = Vec::new();
    let mut cursor = start + 1;
    while cursor < chars.len() {
        let ch = chars[cursor];
        let next = chars.get(cursor + 1).copied();
        if !jsx_stack.is_empty() {
            if ch == '<' {
                if let Some(tag) = parse_jsx_tag(chars, cursor) {
                    let end = tag.end;
                    if tag.closing {
                        if jsx_stack.last() == Some(&tag.name) {
                            jsx_stack.pop();
                        }
                    } else if !tag.self_closing {
                        jsx_stack.push(tag.name);
                    }
                    cursor = end + 1;
                    continue;
                }
            } else if ch == '{' {
                cursor = jsx_expression_end(chars, cursor)? + 1;
                continue;
            }
            cursor += 1;
            continue;
        }
        if ch == '<' && sig.regex_can_start(last_closed_brace_kind) {
            if let Some(tag) = parse_jsx_tag(chars, cursor) {
                if !tag.closing {
                    let end = tag.end;
                    if !tag.self_closing {
                        jsx_stack.push(tag.name);
                    }
                    cursor = end + 1;
                    sig.record(')');
                    continue;
                }
            }
        }
        if matches!(ch, '\'' | '"') {
            cursor = find_quoted_string_end(chars, cursor, ch)? + 1;
            sig.record(')');
            continue;
        }
        if ch == '`' {
            cursor = find_template_literal_end(chars, cursor)? + 1;
            sig.record(')');
            continue;
        }
        if ch == '/' && next == Some('/') {
            cursor += chars[cursor..].iter().position(|c| *c == '\n')?;
            continue;
        }
        if ch == '/' && next == Some('*') {
            cursor = find_sub(chars, cursor + 2, &['*', '/'])? + 2;
            continue;
        }
        if ch == '/' && sig.regex_can_start(last_closed_brace_kind) {
            if let Some(end) = find_regex_literal_end(chars, cursor) {
                cursor = end + 1;
                sig.record(')');
                continue;
            }
        }
        if ch == '{' {
            depth += 1;
            brace_kinds.push(sig.brace_kind(false, true));
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

fn parse_jsx_tag(chars: &[char], start: usize) -> Option<ParsedJsxTag> {
    if chars.get(start) != Some(&'<') {
        return None;
    }
    let mut cursor = start + 1;
    let closing = chars.get(cursor) == Some(&'/');
    if closing {
        cursor += 1;
    }

    if chars.get(cursor) == Some(&'>') {
        return Some(ParsedJsxTag {
            name: String::new(),
            closing,
            self_closing: false,
            end: cursor,
        });
    }
    if !chars.get(cursor).is_some_and(|ch| is_jsx_name_start(*ch)) {
        return None;
    }
    let name_start = cursor;
    cursor += 1;
    while chars
        .get(cursor)
        .is_some_and(|ch| is_jsx_name_continue(*ch))
    {
        cursor += 1;
    }
    let name: String = chars[name_start..cursor].iter().collect();
    if !chars
        .get(cursor)
        .is_some_and(|ch| is_ws(*ch) || matches!(ch, '<' | '/' | '>'))
    {
        return None;
    }
    if closing {
        while chars.get(cursor).is_some_and(|ch| is_ws(*ch)) {
            cursor += 1;
        }
        return (chars.get(cursor) == Some(&'>')).then_some(ParsedJsxTag {
            name,
            closing: true,
            self_closing: false,
            end: cursor,
        });
    }

    let mut angle_depth = 0usize;
    let mut last_significant = name_start + name.chars().count() - 1;
    while cursor < chars.len() {
        let ch = chars[cursor];
        let next = chars.get(cursor + 1).copied();
        if matches!(ch, '\'' | '"') {
            cursor = find_quoted_string_end(chars, cursor, ch)?;
            last_significant = cursor;
        } else if ch == '/' && next == Some('/') {
            cursor += chars[cursor..].iter().position(|c| *c == '\n')?;
            continue;
        } else if ch == '/' && next == Some('*') {
            cursor = find_sub(chars, cursor + 2, &['*', '/'])? + 2;
            continue;
        } else if ch == '{' {
            cursor = jsx_expression_end(chars, cursor)?;
            last_significant = cursor;
        } else if ch == '<' {
            angle_depth += 1;
            last_significant = cursor;
        } else if ch == '>' {
            if angle_depth == 0 {
                return Some(ParsedJsxTag {
                    name,
                    closing: false,
                    self_closing: chars[last_significant] == '/',
                    end: cursor,
                });
            }
            angle_depth -= 1;
            last_significant = cursor;
        } else if !is_ws(ch) {
            last_significant = cursor;
        }
        cursor += 1;
    }
    None
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
    let mut jsx_stack: Vec<String> = Vec::new();
    let mut jsx_closing_slash = None;

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

        if jsx && ch == '<' && (!is_inside_opening_jsx_tag(&output) || jsx_expression_depth > 0) {
            let in_jsx_text = !jsx_stack.is_empty() && jsx_expression_depth == 0;
            if in_jsx_text || sig.regex_can_start(last_closed_brace_kind) {
                if let Some(tag) = parse_jsx_tag(&chars, i) {
                    if tag.closing {
                        if jsx_stack.last() == Some(&tag.name) {
                            jsx_closing_slash = Some(i + 1);
                            jsx_stack.pop();
                        }
                    } else if !tag.self_closing {
                        jsx_stack.push(tag.name);
                    }
                }
            }
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
        } else if ch == '/'
            && sig.regex_can_start(last_closed_brace_kind)
            && jsx_closing_slash != Some(i)
        {
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
                    !jsx_stack.is_empty()
                        || JSX_TEXT_CONTEXT_RE.is_match(last_line(without_last))
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

/// A markup-only view using the comment scanner's literal and JSX parsers.
/// Code literals are blanked; JSX attributes/text and template expressions
/// containing real elements remain visible. Other rules keep their original view.
fn mask_js_literals(content: &str, jsx: bool) -> String {
    struct Mask<'a> {
        chars: &'a [char],
        hidden: Vec<bool>,
        jsx: bool,
    }
    impl Mask<'_> {
        fn hide(&mut self, start: usize, end: usize) {
            self.hidden[start..end].fill(true);
        }
        fn template(&mut self, start: usize) -> usize {
            let mut p = start + 1;
            let mut text = start;
            while p < self.chars.len() {
                match self.chars[p] {
                    '\\' => p = (p + 2).min(self.chars.len()),
                    '`' => {
                        self.hide(text, p + 1);
                        return p + 1;
                    }
                    '$' if self.chars.get(p + 1) == Some(&'{') => {
                        self.hide(text, p + 2);
                        p = self.code(p + 2, true);
                        text = p;
                    }
                    _ => p += 1,
                }
            }
            self.hide(text, p);
            p
        }
        fn element(&mut self, start: usize, tag: ParsedJsxTag) -> usize {
            let mut p = start + 1;
            // Literal attributes belong to markup. Expressions can contain
            // code strings, regexes, or nested JSX and need the code scanner.
            while p < tag.end {
                match self.chars[p] {
                    '\'' | '"' => p = find_quoted_string_end(self.chars, p, self.chars[p])
                        .map(|end| end + 1).unwrap_or(tag.end),
                    '{' => p = self.code(p + 1, true),
                    _ => p += 1,
                }
            }
            p = tag.end + 1;
            if tag.self_closing || tag.closing { return p; }
            while p < self.chars.len() {
                if self.chars[p] == '<' {
                    if let Some(child) = parse_jsx_tag(self.chars, p) {
                        if child.closing && child.name == tag.name { return child.end + 1; }
                        p = self.element(p, child);
                        continue;
                    }
                } else if self.chars[p] == '{' {
                    p = self.code(p + 1, true);
                    continue;
                }
                p += 1;
            }
            p
        }
        fn code(&mut self, start: usize, expression: bool) -> usize {
            let mut p = start;
            let mut sig = Significant::default();
            let mut braces = Vec::new();
            let mut parens = Vec::new();
            let mut last_brace = "";
            while p < self.chars.len() {
                let ch = self.chars[p];
                let next = self.chars.get(p + 1).copied();
                if ch == '/' && matches!(next, Some('/') | Some('*')) {
                    let end = if next == Some('/') {
                        self.chars[p..].iter().position(|c| *c == '\n')
                            .map(|end| p + end).unwrap_or(self.chars.len())
                    } else {
                        find_sub(self.chars, p + 2, &['*', '/'])
                            .map(|end| end + 2).unwrap_or(self.chars.len())
                    };
                    self.hide(p, end);
                    p = end;
                    continue;
                }
                if matches!(ch, '\'' | '"') {
                    let end = find_quoted_string_end(self.chars, p, ch)
                        .map(|end| end + 1).unwrap_or(self.chars.len());
                    self.hide(p, end);
                    p = end;
                    sig.record(')');
                    continue;
                }
                if ch == '`' {
                    p = self.template(p);
                    sig.record(')');
                    continue;
                }
                if ch == '/' && sig.regex_can_start(last_brace) {
                    if let Some(end) = find_regex_literal_end(self.chars, p) {
                        self.hide(p, end + 1);
                        p = end + 1;
                        sig.record(')');
                        continue;
                    }
                }
                if self.jsx && ch == '<' && sig.regex_can_start(last_brace) {
                    if let Some(tag) = parse_jsx_tag(self.chars, p) {
                        p = self.element(p, tag);
                        sig.record(')');
                        continue;
                    }
                }
                if ch == '{' {
                    braces.push(sig.brace_kind(false, true));
                } else if ch == '}' {
                    if expression && braces.is_empty() { return p + 1; }
                    last_brace = braces.pop().unwrap_or("");
                } else if ch == '(' {
                    parens.push(matches!(sig.current_word.as_str(), "if" | "while" | "for" | "with" | "switch" | "catch"));
                } else if ch == ')' && parens.pop() == Some(true) {
                    // A control condition is followed by a statement, where
                    // `/.../` is a regex, unlike division after a function call.
                    sig.record(';');
                    p += 1;
                    continue;
                }
                sig.record(ch);
                p += 1;
            }
            p
        }
    }
    let chars: Vec<char> = content.chars().collect();
    let mut mask = Mask { chars: &chars, hidden: vec![false; chars.len()], jsx };
    mask.code(0, false);
    let mut out = String::with_capacity(content.len());
    for (ch, hidden) in chars.iter().zip(mask.hidden) {
        if hidden && !matches!(ch, '\n' | '\r') {
            out.extend(std::iter::repeat(' ').take(ch.len_utf8()));
        } else {
            out.push(*ch);
        }
    }
    out
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
    sheet: &FileSheet,
) -> Vec<Finding> {
    let content = strip_css_comments(raw_content);
    let mut findings = Vec::new();
    // Read the stylesheet's rule blocks once, and only when a side stripe
    // needs its host's corners.
    let host_index = once_cell::unsync::OnceCell::new();
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
            // A stripe on any edge drops only on a box known square.
            let side = match edge {
                "left" => Some(3),
                "right" => Some(1),
                "top" => Some(0),
                _ => Some(2),
            };
            if let Some(side) = side {
                if host_index
                    .get_or_init(|| CssHostIndex::new(&content))
                    .is_rule_known_square(selector_start, &selector, side, &sheet.corners())
                {
                    continue;
                }
            }
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

// ─── Whole-file radius reading ───────────────────────────────────────────────

/// Every stylesheet a file carries, read for the side accent gate: the file
/// itself for `.css`, `.scss`, `.sass` and `.less`, else its `<style>` blocks
/// and CSS-in-JS templates together. Computed on the first stripe that needs
/// it. A box no radius rule ties to is known square only when nothing here
/// can round it: a class the element may carry could be any of them.
pub struct FileSheet<'a> {
    content: &'a str,
    source: &'a str,
    ext: String,
    corners: once_cell::unsync::OnceCell<DeclaredCorners>,
    style_text: once_cell::unsync::OnceCell<Option<(String, Vec<(usize, usize)>)>>,
    style_sources: once_cell::unsync::OnceCell<String>,
    imports_stylesheet: once_cell::unsync::OnceCell<bool>,
}

re!(
    STYLESHEET_IMPORT_RE,
    r#"(?i)\bimport\s*(?:[\w$*{}\s,]+?\s*from\s*)?\(?\s*['"][^'"\n]+\.(?:css|scss|sass|less|styl|stylus|pcss|postcss)(?:\?[^'"\n]*)?['"]|\brequire\s*\(\s*['"][^'"\n]+\.(?:css|scss|sass|less|styl|stylus|pcss|postcss)(?:\?[^'"\n]*)?['"]\s*\)|@import\b|<style\b[^>]*\bsrc\s*=|<link\b[^>]*\brel\s*=\s*['"]?stylesheet"#
        .to_string()
);
re!(SASS_USE_RE, r#"@use\s+['"]([^'"\n]*)['"]"#.to_string());

impl<'a> FileSheet<'a> {
    /// `content` is the file as read, `source` the comment-blanked text the
    /// matchers run over.
    pub fn new(content: &'a str, source: &'a str, ext: &str) -> Self {
        FileSheet {
            content,
            source,
            ext: js::to_lower_case(ext),
            corners: once_cell::unsync::OnceCell::new(),
            style_text: once_cell::unsync::OnceCell::new(),
            style_sources: once_cell::unsync::OnceCell::new(),
            imports_stylesheet: once_cell::unsync::OnceCell::new(),
        }
    }

    /// Whether the file brings in a stylesheet the reader does not follow: a
    /// script `import` or `require` of a stylesheet (a CSS module too), an
    /// `@import` or a non-`sass:` `@use` in its style text, a `<style src>`
    /// block, or a `<link rel="stylesheet">`. Such a stylesheet could round
    /// any class a markup tag carries.
    pub fn imports_stylesheet(&self) -> bool {
        *self.imports_stylesheet.get_or_init(|| {
            STYLESHEET_IMPORT_RE.is_match(self.source)
                || SASS_USE_RE
                    .captures_iter(self.source)
                    .any(|c| !c[1].starts_with("sass:"))
        })
    }

    /// A component or script file's `<style>` blocks and CSS-in-JS templates
    /// joined into one text: what a markup accent's classes are read against.
    pub fn style_sources(&self) -> &str {
        self.style_sources.get_or_init(|| {
            let mut text = String::new();
            for block in extract_style_blocks(self.content, &self.ext) {
                text.push_str(&blank_css_line_comments(&strip_css_comments(&block.content)));
                text.push('\n');
            }
            for block in extract_css_in_js(self.source, &self.ext) {
                text.push_str(&strip_css_comments(&block.content));
                text.push('\n');
            }
            for global in global_style_templates(self.source, &self.ext) {
                text.push_str(&global);
                text.push('\n');
            }
            text
        })
    }

    /// For a component file (`.astro`, `.vue`, `.svelte`), the source with
    /// every byte outside its `<style>` blocks blanked (newlines kept, so
    /// offsets line up), and the byte spans of the blocks. The whole-file
    /// matcher pass gates a declaration inside a block with it; the block
    /// pass reports a line late, so the whole-file pass has to agree.
    pub fn style_text(&self) -> Option<&(String, Vec<(usize, usize)>)> {
        self.style_text
            .get_or_init(|| {
                if !matches!(self.ext.as_str(), ".astro" | ".vue" | ".svelte") {
                    return None;
                }
                let spans: Vec<(usize, usize)> = STYLE_TAG_RE
                    .captures_iter(self.source)
                    .filter_map(|c| {
                        let (tag, body) = (c.get(0)?, c.get(1)?);
                        let opening = &self.source[tag.start()..body.start()];
                        // An indented-Sass block is read by its own pass.
                        (!SASS_STYLE_TAG_RE.is_match(opening)).then(|| (body.start(), body.end()))
                    })
                    .collect();
                if spans.is_empty() {
                    return None;
                }
                let mut text = String::with_capacity(self.source.len());
                let mut at = 0usize;
                let blank = |out: &mut String, part: &str| {
                    for ch in part.chars() {
                        if ch == '\n' {
                            out.push('\n');
                        } else {
                            out.extend(std::iter::repeat(' ').take(ch.len_utf8()));
                        }
                    }
                };
                for &(start, end) in &spans {
                    blank(&mut text, &self.source[at..start]);
                    text.push_str(&self.source[start..end]);
                    at = end;
                }
                blank(&mut text, &self.source[at..]);
                Some((text, spans))
            })
            .as_ref()
    }

    /// [`CssHostIndex::sheet_corners`] over every stylesheet in the file.
    pub fn corners(&self) -> DeclaredCorners {
        *self.corners.get_or_init(|| {
            let ext = self.ext.as_str();
            if ext == ".sass" {
                return sass_sheet_corners(self.source);
            }
            if CSS_LIKE_EXTS.contains(&ext) {
                return CssHostIndex::new(self.source).sheet_corners();
            }
            let mut sheet = DeclaredCorners::default();
            for block in extract_style_blocks(self.content, ext) {
                let text = blank_css_line_comments(&strip_css_comments(&block.content));
                sheet.raise_to(&CssHostIndex::new(&text).sheet_corners());
            }
            for block in extract_css_in_js(self.source, ext) {
                let text = strip_css_comments(&block.content);
                sheet.raise_to(&CssHostIndex::new(&text).sheet_corners());
            }
            for text in global_style_templates(self.source, ext) {
                sheet.raise_to(&CssHostIndex::new(&text).sheet_corners());
            }
            sheet
        })
    }
}

// ─── Style block extraction ──────────────────────────────────────────────────

/// An extracted CSS block and the 1-based line the JS records for it.
#[derive(Debug, Clone, PartialEq)]
pub struct Block {
    pub content: String,
    pub start_line: usize,
    /// An indented-syntax block: a `<style lang="sass">` tag.
    pub sass: bool,
}

re!(
    STYLE_TAG_RE,
    format!("<{s}[^>]*>({ANY}*?)</{s}>", s = ci("style"))
);

re!(
    SASS_STYLE_TAG_RE,
    r#"(?i)\blang\s*=\s*["']?sass["'\s>]"#.to_string()
);

/// JS: detect-text.mjs#extractStyleBlocks
pub fn extract_style_blocks(content: &str, ext: &str) -> Vec<Block> {
    let ext = js::to_lower_case(ext);
    if ext != ".astro" && ext != ".vue" && ext != ".svelte" {
        return vec![];
    }
    STYLE_TAG_RE
        .captures_iter(content)
        .map(|m| {
            let (tag, body) = (m.get(0).unwrap(), m.get(1).unwrap());
            Block {
                content: body.as_str().to_string(),
                start_line: line_of_offset(content, tag.start()) + 1,
                sass: SASS_STYLE_TAG_RE.is_match(&content[tag.start()..body.start()]),
            }
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

re!(
    GLOBAL_STYLE_TEMPLATE_RE,
    r"\b(?:createGlobalStyle|injectGlobal)\s*`|<style\b[^>]*>\s*\{\s*`".to_string()
);

/// The global style templates a script file carries that [`extract_css_in_js`]
/// does not read: `createGlobalStyle` and `injectGlobal` templates, and a
/// styled-jsx `<style>{`...`}` block. They can round a class a markup tag
/// carries, so the side accent gate reads them with the file's other style
/// text; no other rule scans them.
fn global_style_templates(source: &str, ext: &str) -> Vec<String> {
    if !CSS_IN_JS_EXTENSIONS.contains(&js::to_lower_case(ext).as_str())
        || !GLOBAL_STYLE_TEMPLATE_RE.is_match(source)
    {
        return vec![];
    }
    let chars: Vec<char> = source.chars().collect();
    GLOBAL_STYLE_TEMPLATE_RE
        .find_iter(source)
        .filter_map(|m| {
            let tick = source[..m.end()].chars().count() - 1;
            let end = find_template_literal_end(&chars, tick)?;
            Some(strip_css_comments(
                &chars[tick + 1..end].iter().collect::<String>(),
            ))
        })
        .collect()
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
                sass: false,
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
    sass: bool,
    profile: Option<&DetectorProfile>,
    phase: &str,
    sheet: Option<&FileSheet>,
) -> Vec<Finding> {
    let mut findings = Vec::new();
    let ext = ext_from_file_path(file_path);
    // The image rule reads tags that may span lines, so it walks one joined
    // text from each line's start, with JS/TS literals masked. Only it uses
    // this view: other rules intentionally inspect strings (copy, CSS-in-JS,
    // design tokens).
    let image_source = once_cell::unsync::OnceCell::new();
    // The joined text the side-tab scope reader walks, built once per file,
    // and the stylesheet index over it, built on the first accent it gates.
    let source = once_cell::unsync::OnceCell::new();
    let index = once_cell::unsync::OnceCell::new();
    let markup_index = once_cell::unsync::OnceCell::new();
    for matcher in REGEX_MATCHERS.iter() {
        let run = || {
            let mut matches = Vec::new();
            let image = matcher.id == "broken-image";
            if image
                && (phase != "source"
                    || !lines.iter().any(|l| {
                        l.as_bytes().windows(4).any(|w| w.eq_ignore_ascii_case(b"<img"))
                    }))
            {
                return matches;
            }
            let mut image_cursor = 0;
            for (i, line) in lines.iter().enumerate() {
                let (line, ctxs): (&str, Vec<MatchCtx>) = if image {
                    let (text, starts, markup) = image_source.get_or_init(|| {
                        let joined = lines.join("\n");
                        // Masking keeps every byte offset and newline.
                        let text = if JS_SOURCE_EXTS.contains(&ext.as_str()) {
                            mask_js_literals(&joined, matches!(ext.as_str(), ".js" | ".jsx" | ".tsx"))
                        } else {
                            joined
                        };
                        let mut starts = Vec::with_capacity(lines.len());
                        let mut at = 0;
                        for (i, l) in text.split('\n').enumerate() {
                            starts.push(at);
                            at += l.len() + usize::from(i + 1 < lines.len());
                        }
                        let jsx = matches!(ext.as_str(), ".js" | ".jsx" | ".tsx");
                        let template = matches!(ext.as_str(), ".svelte" | ".vue" | ".astro");
                        let css = CSS_LIKE_EXTS.contains(&ext.as_str());
                        let markup = crate::regex_matchers::scan_markup_context(
                            &text,
                            crate::regex_matchers::MarkupScanOptions {
                                jsx,
                                expressions: jsx || template,
                                nested_tags: jsx || ext == ".astro",
                                raw_text: !JS_SOURCE_EXTS.contains(&ext.as_str()) && !css,
                                markup: !css,
                            },
                        );
                        (text, starts, markup)
                    });
                    let line_start = starts[i];
                    let line_end = text[line_start..]
                        .find('\n')
                        .map(|end| line_start + end)
                        .unwrap_or(text.len());
                    (
                        &text[line_start..line_end],
                        crate::regex_matchers::find_broken_images_in_line(
                            text,
                            markup,
                            &mut image_cursor,
                            line_start,
                            line_end,
                        ),
                    )
                } else {
                    (line, (matcher.find_all)(line))
                };
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
                    let scope = Scope::in_file(
                        &context,
                        ElementSource {
                            lines,
                            source: &source,
                            index: &index,
                            i,
                            block_context,
                            sass,
                            style_text: sheet.and_then(|sheet| sheet.style_text()),
                        },
                    );
                    // A side accent drops only on a box known square: the
                    // declarations around the match read square, and in
                    // stylesheet text the stylesheet agrees.
                    if (matcher.test)(&m, &scope)
                        && (matcher.id != "broken-image"
                            || crate::regex_matchers::image_source_is_missing(m.whole(), &ext))
                        && (matcher.id != "side-tab" || is_stripe_child_match(&m) || {
                            let source = source.get_or_init(|| SourceText::new(lines));
                            side_tab_rounded_in_scope(&m, source, i, sass)
                                || sheet.is_some_and(|sheet| {
                                    match style_index_text(
                                        block_context,
                                        source,
                                        i,
                                        m.index,
                                        sheet.style_text(),
                                    ) {
                                        Some(text) => !side_tab_known_square_in_sheet(
                                            &m,
                                            source,
                                            i,
                                            sass,
                                            &index,
                                            text,
                                            &sheet.corners(),
                                        ),
                                        // Markup: the tag's classes against the
                                        // file's style blocks and CSS-in-JS rules.
                                        None => !side_tab_markup_known_square(
                                            &m,
                                            source,
                                            i,
                                            &markup_index,
                                            sheet.style_sources(),
                                            &sheet.corners(),
                                            sheet.imports_stylesheet(),
                                        ),
                                    }
                                })
                        })
                    {
                        matches.push(finding(
                            matcher.id,
                            file_path,
                            &(matcher.fmt)(&m, &scope),
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

fn row_stripe_findings(
    text: &str,
    file_path: &str,
    line_offset: usize,
    tokens: Option<&CustomProps>,
) -> Vec<Finding> {
    scan_css_text_for_row_stripe(text, tokens)
        .into_iter()
        .map(|hit| {
            let line = line_offset + line_of_offset(text, hit.index.unwrap_or(0));
            finding(&hit.id, file_path, &hit.snippet, line as f64)
        })
        .collect()
}

/// Whether a card scan's side-tab snippet reports the stripe a row-stripe
/// snippet (`<selectors> — <property> <n>px stripe on a row or cell …`)
/// does: the inset scan's names the same selectors and thickness, a side
/// border's the same property and width.
fn same_stripe(card: &str, row: &str) -> bool {
    let Some((selector, detail)) = row.split_once(" — ") else { return false };
    let words: Vec<&str> = detail.split_whitespace().collect();
    let Some(at) = words.iter().position(|w| w.ends_with("px")) else { return false };
    let (prop, px) = (words[..at].join(" "), words[at]);
    if prop == "inset box-shadow" {
        let Some((card_selector, card_detail)) = card.split_once(" — ") else { return false };
        let card_branches: Vec<&str> = card_selector.split(", ").collect();
        return card_detail.starts_with(&format!("inset box-shadow {px} "))
            && selector.split(", ").all(|b| card_branches.contains(&b));
    }
    // The border matcher's snippet is the declaration as written, spaced or not.
    card.split_once(':').is_some_and(|(p, v)| {
        js::trim(p) == prop && js::trim_start(v).split(|c: char| c.is_whitespace() || c == ';' || c == '}').next() == Some(px)
    })
}

fn pseudo_stripe_findings(
    text: &str,
    file_path: &str,
    line_offset: usize,
    sheet: &FileSheet,
) -> Vec<Finding> {
    let host_index = once_cell::unsync::OnceCell::new();
    scan_css_text_for_pseudo_stripe(text)
        .into_iter()
        // A stripe on any edge drops only on a host known square.
        .filter(|hit| {
            side_stripe_index(hit).is_none()
                || !host_index
                    .get_or_init(|| CssHostIndex::new(text))
                    .side_stripe_known_square(hit, &sheet.corners())
        })
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
    let sheet = FileSheet::new(content, &source, &ext);

    // The whole-file pass is stylesheet text in a stylesheet, and inside a
    // component's `<style>` blocks; blocks and templates also get their own
    // passes below.
    findings.extend(run_regex_matchers(
        &lines,
        file_path,
        0,
        css_like,
        file_path.to_ascii_lowercase().ends_with(".sass"),
        profile,
        "source",
        Some(&sheet),
    ));

    // Side stripes on status rows and cells, which the card scans skip; kept
    // apart until those have run so a stripe they report is not doubled.
    let mut row_stripes: Vec<Finding> = Vec::new();
    if css_like {
        findings.extend(scan_inset_stripe_css(content, file_path, 0, &sheet));
        findings.extend(pseudo_stripe_findings(content, file_path, 0, &sheet));
        // Comments blanked in place: a `//` line in a preprocessor sheet is
        // not a rule.
        row_stripes.extend(row_stripe_findings(&source, file_path, 0, options.tokens));
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
            block.sass,
            profile,
            "style-block",
            Some(&sheet),
        ));
        findings.extend(scan_inset_stripe_css(
            &block_content,
            file_path,
            block.start_line - 2,
            &sheet,
        ));
        findings.extend(pseudo_stripe_findings(
            &block_content,
            file_path,
            block.start_line - 2,
            &sheet,
        ));
        row_stripes.extend(row_stripe_findings(
            &block_content,
            file_path,
            block.start_line - 2,
            options.tokens,
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
            false,
            profile,
            "css-in-js",
            Some(&sheet),
        ));
        findings.extend(scan_inset_stripe_css(
            &block_content,
            file_path,
            block.start_line - 1,
            &sheet,
        ));
        findings.extend(pseudo_stripe_findings(
            &block_content,
            file_path,
            block.start_line - 1,
            &sheet,
        ));
        row_stripes.extend(row_stripe_findings(
            &block_content,
            file_path,
            block.start_line - 1,
            options.tokens,
        ));
    }
    let cards = findings.len();
    for stripe in row_stripes {
        if !findings[..cards]
            .iter()
            .any(|f| f.antipattern == "side-tab" && f.line == stripe.line && same_stripe(&f.snippet, &stripe.snippet))
        {
            findings.push(stripe);
        }
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

    crate::design_system::drop_declared_purple_findings(&mut deduped, options.design_system);

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
    fn jsx_line_comment_after_sibling_elements_does_not_report_broken_image() {
        let src = r#"function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function Thumb({ url }: { url?: string }) {
  return (
    <div>
      {url ? (
        // Plain <img>: presigned thumbnail URL
        <img src={url} alt="" />
      ) : null}
    </div>
  );
}
"#;

        let findings = detect_text(
            src,
            "repro.tsx",
            &TextOptions {
                inline_ignores: true,
                ..Default::default()
            },
        );

        assert!(
            findings
                .iter()
                .all(|finding| finding.antipattern != "broken-image"),
            "JSX line comments must not be scanned as markup: {findings:?}"
        );
    }

    #[test]
    fn jsx_closing_tag_names_do_not_start_regex_state() {
        for tag in ["_Row", "$Thumbnail", "Übersicht"] {
            let src = format!("<{tag} value={{a<b>c}}></{tag}>\n// Plain <img> comment\n");
            assert!(
                !strip_js_comments(&src, true).contains("<img>"),
                "opening tag for {tag} must contain comparison expressions without corrupting JSX depth"
            );
        }
    }

    #[test]
    fn opening_jsx_tag_guard_accepts_every_supported_name_start() {
        for source in ["<_Row value=", "<$Thumbnail value=", "<Übersicht value="] {
            assert!(
                is_inside_opening_jsx_tag(source),
                "opening-tag guard must accept the same names as the JSX parser: {source}"
            );
        }
    }

    #[test]
    fn jsx_opening_tag_shapes_keep_their_matching_closer_out_of_regex_state() {
        for opener in ["<Component<T>>", "<Component /* comment */>"] {
            let src = format!("{opener}</Component>\n// Plain <img> comment\n");
            assert!(
                !strip_js_comments(&src, true).contains("<img>"),
                "opening tag {opener} must count toward the matching closer"
            );
        }
    }

    #[test]
    fn comparison_regex_is_not_a_jsx_closing_tag() {
        for prefix in ["", "<foo></foo>;\n"] {
            let src = format!(
                "{prefix}const matches = value</foo>'/.test(value);\n// Plain <img> comment\n"
            );
            assert!(!strip_js_comments(&src, true).contains("<img>"));
        }
    }

    #[test]
    fn jsx_like_text_inside_expressions_does_not_change_tag_depth() {
        for src in [
            "<div>{\"</div>\"}</div>\n// Plain <img> comment\n",
            "<Component pattern={/[//]/}></Component>\n// Plain <img> comment\n",
            "<Component content={<span></span>}></Component>\n// Plain <img> comment\n",
            "const value = a<foo<T>>b;\nconst matches = value</foo>'/.test(value);\n// Plain <img> comment\n",
        ] {
            assert!(
                !strip_js_comments(src, true).contains("<img>"),
                "JS strings, regexes, and comparisons must not affect JSX tag depth: {src}"
            );
        }
    }

    #[test]
    fn repeated_jsx_closing_tags_leave_following_comments_visible_to_the_stripper() {
        let mut src = format!("<>{}</>", "<div></div>".repeat(4_096));
        src.push_str("\n// Plain <img> comment\n");
        assert!(!strip_js_comments(&src, true).contains("<img>"));
    }

    #[test]
    fn css_in_js() {
        let src =
            "const A = styled.div`\n  border-left: 4px solid red;\n  border-radius: 8px;\n`;\n";
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
        let scan = |css: &str| scan_inset_stripe_css(css, "a.css", 0, &FileSheet::new(css, css, ".css"));
        let f = scan(".card {\n  box-shadow: inset 4px 0 0 #6366f1;\n  border-radius: 8px;\n}\n");
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].snippet, ".card — inset box-shadow 4px stripe (left)");
        assert_eq!(f[0].line, 1.0);
        // The same stripe on a square box is the old convention: silent.
        assert!(scan(".q {\n  box-shadow: inset 4px 0 0 #6366f1;\n}\n").is_empty());
        // A top band passes the same gate (r6-t2-side-tab-bands).
        assert!(scan(".t { box-shadow: inset 0 4px 0 #6366f1; }").is_empty());
        assert_eq!(
            scan(".t { box-shadow: inset 0 4px 0 #6366f1; border-radius: 0 0 8px 8px; }").len(),
            1
        );
    }

    /// A stylesheet border accent is rounded when a radius declaration styles
    /// its own element, wherever the rule sits: blank lines change nothing,
    /// and a mixin that might carry a radius is not one.
    #[test]
    fn border_accent_radius_follows_the_element_not_the_line_distance() {
        let at = |src: &str, path: &str| -> usize {
            detect_text(src, path, &TextOptions::default())
                .into_iter()
                .filter(|f| f.antipattern == "border-accent-on-rounded")
                .count()
        };
        let accents = |src: &str| at(src, "/x/a.css");
        let gap = "\n".repeat(6);
        let accent = ".card { border-bottom: 3px solid #d0342c; }";
        let radius = ".card { border-radius: 12px; }";
        assert_eq!(accents(&format!("{accent}\n{radius}\n")), 1);
        assert_eq!(accents(&format!("{accent}{gap}{radius}\n")), 1);
        assert_eq!(
            accents(&format!(
                ".card {{\n  border-bottom: 3px solid #d0342c;\n{}  border-radius: 12px;\n}}\n",
                "  color: red;\n".repeat(5)
            )),
            1
        );
        assert_eq!(
            accents(&format!(
                "{radius}{gap}.card.is-active {{ border-bottom: 3px solid #d0342c; }}\n"
            )),
            1
        );
        let tabs = ".tabs { border-bottom: 3px solid #d0342c; }";
        let zoom = ".zoom { border-radius: 12px; }";
        assert_eq!(accents(&format!("{tabs}{gap}{zoom}\n")), 0);
        assert_eq!(accents(&format!("{tabs} {zoom}\n")), 0);
        assert_eq!(
            accents(&format!(
                "{tabs}\n@media (min-width: 1px) {{\n  .tabs {{ border-radius: 12px; }}\n}}\n"
            )),
            1
        );
        // A mixin that might carry a radius, or one that is not a radius,
        // never asserts one.
        let bar = "border-bottom: 3px solid #d0342c;";
        let include = format!(".card {{ @include border-radius(8px); {bar} }}\n");
        assert_eq!(at(&include, "/x/a.scss"), 0);
        assert_eq!(at(&format!(".card\n  +border-radius(8px)\n  {bar}\n"), "/x/a.sass"), 0);
        assert_eq!(accents(&format!(".card {{ @apply rounded-lg; {bar} }}\n")), 0);
        assert_eq!(accents(&format!(".btn {{ --btn-border-radius: 6px; {bar} }}\n")), 0);
        assert_eq!(at(&format!(".b {{ $card-radius: 8px; }} .b {{ {bar} }}\n"), "/x/a.scss"), 0);
        assert_eq!(at(&format!(".b {{ @card-radius: 8px; {bar} }}\n"), "/x/a.less"), 0);
        assert_eq!(accents(&format!(".card {{ {bar} border-top-left-radius: 8px; }}\n")), 1);
        let tab = format!(".tab-#{{$n}} {{ {bar} }}{gap}.tab-#{{$n}} {{ border-radius: 8px; }}\n");
        assert_eq!(at(&tab, "/x/a.scss"), 0);
        let styled = |body: &str| format!("const A = styled.div`\n  {body}\n`;\n");
        let mixed = styled(&format!("${{mixin}};\n  {bar}\n  border-radius: 12px;"));
        assert_eq!(at(&mixed, "/x/a.tsx"), 1);
        // A radius on a compound that adds to the accent's host does not
        // round it, the way side-tab reads; the reverse does (above). A
        // pseudo-element rule holding the accent reads its own block.
        let specific = format!("{accent}{gap}.card.is-active {{ border-radius: 8px; }}\n");
        assert_eq!(accents(&specific), 0);
        let tab = ".tab::after { border-top: 4px solid #d0342c; border-radius: 4px 4px 0 0; }";
        assert_eq!(accents(&format!("{tab}\n")), 1);
        assert_eq!(accents(&format!("{accent}{gap}.card::after {{ border-radius: 8px; }}\n")), 0);
        let split = format!(
            ".tab::after {{ border-top: 4px solid #d0342c; }}{gap}.tab::after {{ border-radius: 8px; }}\n"
        );
        assert_eq!(accents(&split), 1);
        // A component file's `<style>` block reads the same way.
        let vue = |rules: &str| {
            format!("<template><div class=\"tabs\" /></template>\n<style>\n{rules}\n</style>\n")
        };
        assert_eq!(at(&vue(&format!("{tabs} {zoom}")), "/x/a.vue"), 0);
        assert_eq!(at(&vue(&format!("{tabs} .tabs {{ border-radius: 12px; }}")), "/x/a.vue"), 1);
        // Indented Sass, in a file or a `lang="sass"` block, reads the
        // accent's own scope, however far the radius.
        let far = format!(".card\n  {bar}\n{}  border-radius: 12px\n", "  color: red\n".repeat(5));
        assert_eq!(at(&far, "/x/a.sass"), 1);
        let sass_vue = |rules: &str| {
            format!("<template><div /></template>\n<style lang=\"sass\">\n{rules}</style>\n")
        };
        assert_eq!(at(&sass_vue(&far), "/x/a.vue"), 1);
        let cross = format!(".x\n  border-radius: 12px\n\n\n\n\n\n.card\n  {bar}\n");
        assert_eq!(at(&sass_vue(&cross), "/x/a.vue"), 0);
        // A syntax with no braces is not read as one scope.
        let stylus = format!(
            "<style lang=\"stylus\">\n.card\n  border-bottom: 3px solid red\n{gap}.zoom\n  border-radius: 12px\n</style>\n"
        );
        assert_eq!(at(&stylus, "/x/a.vue"), 0);
        // Known limit: indented Stylus has no reader of its own, so even a
        // radius in the accent's own rule is not seen there.
        let own = "<style lang=\"stylus\">\n.card\n  border-bottom: 3px solid red\n  border-radius: 12px\n</style>\n";
        assert_eq!(at(own, "/x/a.vue"), 0);
    }

    /// A stripe down one side of a status row or cell reports in a sheet, a
    /// component's `<style>` block and a CSS-in-JS template, with a token
    /// colour read from the project's other sheets.
    #[test]
    fn status_row_stripe_is_a_side_tab_in_every_text_source() {
        let side_tabs = |src: &str, path: &str, tokens: Option<&CustomProps>| -> Vec<(f64, String)> {
            let options = TextOptions { tokens, ..TextOptions::default() };
            detect_text(src, path, &options)
                .into_iter()
                .filter(|f| f.antipattern == "side-tab")
                .map(|f| (f.line, f.snippet))
                .collect()
        };
        let rule = "tr.is-broken > td:first-child { box-shadow: inset 3px 0 0 var(--pr-mark-danger); }";
        let svelte = format!("<table><tr class=\"is-broken\"><td>a</td></tr></table>\n\n<style>\n  .x {{ color: red; }}\n  {rule}\n</style>\n");
        let mut tokens = CustomProps::new();
        tokens.set("--pr-mark-danger", "oklch(63% .23 27)".to_string());
        let found = side_tabs(&svelte, "/x/AppsTable.svelte", Some(&tokens));
        assert_eq!(found.len(), 1, "{found:?}");
        assert_eq!(found[0].0, 5.0);
        assert!(found[0].1.starts_with("tr.is-broken > td:first-child"), "{found:?}");
        // The token name says the colour even with no sheet in reach; a
        // neutral token says it is not one.
        assert_eq!(side_tabs(&svelte, "/x/AppsTable.svelte", None).len(), 1);
        let mut neutral = CustomProps::new();
        neutral.set("--pr-mark-danger", "#e5e7eb".to_string());
        assert!(side_tabs(&svelte, "/x/AppsTable.svelte", Some(&neutral)).is_empty());
        assert_eq!(side_tabs(".cell {\n  box-shadow: inset 3px 0 0 red;\n}\n", "/x/a.css", None).len(), 1);
        let styled = "const Row = styled.tr`\n  &.is-new td:first-child { border-left: 3px solid #16a34a; }\n`;\n";
        assert_eq!(side_tabs(styled, "/x/a.tsx", None).len(), 1);
        // A rounded row card reports once, from the card scan.
        let card = ".row-card.is-x { box-shadow: inset 4px 0 0 #d0342c; border-radius: 8px; }\n";
        assert_eq!(side_tabs(card, "/x/a.css", None).len(), 1);
        // Another stripe, or a card's, on the same line is not that stripe.
        let compact = "td.is-x { box-shadow: inset 3px 0 0 red; } td.is-y { box-shadow: inset 3px 0 0 blue; }\n";
        assert_eq!(side_tabs(compact, "/x/a.css", None).len(), 2);
        let beside_card = ".card { border-left: 4px solid #6366f1; border-radius: 12px; } td.is-x { box-shadow: inset 3px 0 0 red; }\n";
        assert_eq!(side_tabs(beside_card, "/x/a.css", None).len(), 2);
        let rounded_elsewhere = ".row-card.is-x { box-shadow: inset 4px 0 0 #d0342c; }\n.row-card { border-radius: 8px; }\n";
        assert_eq!(side_tabs(rounded_elsewhere, "/x/a.css", None).len(), 1);
        let compact_rounded = ".row-card.is-x{border-left:3px solid #d0342c}.row-card{border-radius:8px}\n";
        assert_eq!(side_tabs(compact_rounded, "/x/a.css", None).len(), 1);
        let card_then_cell = ".card{border-left:3px solid red;border-radius:12px} td.is-error{border-left:3px solid blue}\n";
        assert_eq!(side_tabs(card_then_cell, "/x/a.css", None).len(), 2);
        // A line comment in a preprocessor sheet is not a rule.
        for path in ["/x/a.scss", "/x/a.less"] {
            assert!(side_tabs("// td.is-error { box-shadow: inset 3px 0 0 red; }\n", path, None).is_empty(), "{path}");
            assert_eq!(side_tabs("td.is-error { box-shadow: inset 3px 0 0 red; } // flagged\n", path, None).len(), 1, "{path}");
        }
        // Selection and hover stripes on a row stay silent.
        assert!(side_tabs("tr.is-selected td { box-shadow: inset 3px 0 0 #2563eb; }\ntr:hover td { box-shadow: inset 3px 0 0 #2563eb; }\n", "/x/a.css", None).is_empty());
    }

    /// Every text-engine producer of `side-tab` answers a square box and a
    /// rounded card the same way the static and browser engines do.
    #[test]
    fn side_accent_needs_a_rounded_card_in_every_text_producer() {
        let side_tabs = |src: &str, path: &str| -> Vec<String> {
            detect_text(src, path, &TextOptions::default())
                .into_iter()
                .filter(|f| f.antipattern == "side-tab")
                .map(|f| f.snippet)
                .collect()
        };
        let square_css = ".a { border-left: 4px solid #6366f1; }\n\
.b { border-left-width: 5px; border-left-color: #6366f1; }\n\
.c { border-inline-start: 6px solid #6366f1; }\n\
.d { position: relative; }\n.d::before { content: \"\"; position: absolute; left: 0; top: 0; bottom: 0; width: 7px; background: #6366f1; }\n\
.e { box-shadow: inset 8px 0 0 #6366f1; }\n";
        assert_eq!(side_tabs(square_css, "/x/square.css"), Vec::<String>::new());
        let rounded_css = square_css
            .replace(".a { ", ".a { border-radius: 12px; ")
            .replace(".b { ", ".b { border-radius: 12px; ")
            .replace(".c { ", ".c { border-radius: 12px; ")
            .replace(".d { ", ".d { border-radius: 12px; ")
            .replace(".e { ", ".e { border-radius: 12px; ");
        assert_eq!(
            side_tabs(&rounded_css, "/x/rounded.css").len(),
            5,
            "{:?}",
            side_tabs(&rounded_css, "/x/rounded.css")
        );

        let square_tsx = "export const A = () => <div className=\"border-l-4 border-indigo-500 bg-white p-4\" />;\n\
export const B = () => <div style={{ borderLeft: '4px solid #6366f1', padding: 16 }} />;\n";
        assert_eq!(side_tabs(square_tsx, "/x/square.tsx"), Vec::<String>::new());
        let rounded_tsx = "export const A = () => <div className=\"border-l-4 border-indigo-500 rounded-r-lg bg-white p-4\" />;\n\
export const B = () => <div style={{ borderLeft: '4px solid #6366f1', borderRadius: 12 }} />;\n";
        assert_eq!(
            side_tabs(rounded_tsx, "/x/rounded.tsx"),
            vec![
                "border-l-4".to_string(),
                "borderLeft: '4px solid".to_string()
            ]
        );
    }

    /// A nested bar or accent reads the corners of the rule it names with
    /// `&`, in a stylesheet and in a CSS-in-JS template.
    #[test]
    fn nested_side_accents_read_the_enclosing_rule() {
        let side_tabs = |src: &str, path: &str| -> Vec<String> {
            let mut out: Vec<String> = detect_text(src, path, &TextOptions::default())
                .into_iter()
                .filter(|f| f.antipattern == "side-tab")
                .map(|f| f.snippet)
                .collect();
            out.sort();
            out
        };
        // The square host and the child square themselves off: a box no radius
        // rule names reads the whole file, which rounds `.card`.
        let scss = ".sq {\n  position: relative;\n  border-radius: 0;\n  &::before { content: \"\"; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: #6366f1; }\n}\n\
.card {\n  position: relative;\n  border-radius: 12px;\n  &::before { content: \"\"; position: absolute; left: 0; top: 0; bottom: 0; width: 5px; background: #6366f1; }\n  &.is-accent { box-shadow: inset 6px 0 0 #6366f1; }\n  &--accent { border-left: 7px solid #6366f1; }\n  & .child { border-radius: 0; border-left: 8px solid #6366f1; }\n}\n";
        assert_eq!(
            side_tabs(scss, "/x/nested.scss"),
            vec![
                "&.is-accent — inset box-shadow 6px stripe (left)".to_string(),
                "&::before — absolute 5px pseudo-element stripe (left: 0)".to_string(),
                "border-left: 7px solid #6366f1".to_string(),
            ]
        );
        let tsx = "import styled from 'styled-components';\n\
export const Square = styled.div`\n  position: relative;\n  border-radius: 0;\n  &::before { content: \"\"; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: #6366f1; }\n  &.active { border-left: 9px solid #6366f1; }\n`;\n\
export const Card = styled.div`\n  position: relative;\n  border-radius: 12px;\n  &::after { content: \"\"; position: absolute; right: 0; top: 0; bottom: 0; width: 5px; background: #6366f1; }\n  &.active { border-left: 6px solid #6366f1; }\n`;\n";
        assert_eq!(
            side_tabs(tsx, "/x/nested.tsx"),
            vec![
                "&::after — absolute 5px pseudo-element stripe (right: 0)".to_string(),
                "border-left: 6px solid #6366f1".to_string(),
            ]
        );
    }

    /// A markup accent in a file whose style blocks or CSS-in-JS rules
    /// declare a radius reads them for the classes its tag carries; a file
    /// with no radius in its style text leaves the tag as read.
    #[test]
    fn markup_accents_read_the_file_style_text() {
        let side_tabs = |src: &str, path: &str| -> Vec<String> {
            let mut out: Vec<String> = detect_text(src, path, &TextOptions::default())
                .into_iter()
                .filter(|f| f.antipattern == "side-tab")
                .map(|f| f.snippet)
                .collect();
            out.sort();
            out
        };
        let tag = "<div class=\"card border-l-4 border-teal-700 p-4\">x</div>";
        let vue = |css: &str| format!("<template>\n  {tag}\n</template>\n<style scoped>\n{css}\n</style>\n");
        let flag = vec!["border-l-4".to_string()];
        let none = Vec::<String>::new();
        // The class the tag carries is rounded, in a compound or descendant
        // rule, or behind a value the reader cannot resolve.
        assert_eq!(side_tabs(&vue(".card { border-radius: 12px; }"), "/x/a.vue"), flag);
        assert_eq!(side_tabs(&vue(".list .card { border-radius: 12px; }"), "/x/a.vue"), flag);
        assert_eq!(side_tabs(&vue(".card { border-radius: var(--r); }"), "/x/a.vue"), flag);
        assert_eq!(side_tabs(&vue(".card { @apply rounded-lg; }"), "/x/a.vue"), flag);
        // A radius no rule for this tag declares, but unknown: fail safe.
        assert_eq!(side_tabs(&vue(".other { border-radius: var(--r); }"), "/x/a.vue"), flag);
        // Known square: the tag's own class squares it, or every radius is
        // literal and names another class, a pseudo-element or another type.
        assert_eq!(side_tabs(&vue(".card { border-radius: 0; }"), "/x/a.vue"), none);
        assert_eq!(side_tabs(&vue(".other { border-radius: 12px; }\n.card::before { border-radius: 12px; }\nspan { border-radius: 12px; }"), "/x/a.vue"), none);
        let svelte = format!("{tag}\n<style>\n.card {{ border-radius: 12px; }}\n</style>\n");
        assert_eq!(side_tabs(&svelte, "/x/a.svelte"), flag);
        // No radius in the style text: the tag's own reading, as before.
        assert_eq!(side_tabs(&vue(".card { padding: 8px; }"), "/x/a.vue"), none);
        assert_eq!(side_tabs(&format!("export const A = () => {tag};\n").replace("class=", "className="), "/x/a.tsx"), none);
        // Radius utilities on the tag still round it.
        assert_eq!(side_tabs(&vue(".card { border-radius: 0; }").replace("p-4", "rounded-lg p-4"), "/x/a.vue"), flag);
        // CSS-in-JS: a global rule for the class, and a styled component's own
        // template, which styles only that component.
        let tsx = "import styled, { createGlobalStyle } from 'styled-components';\n\
const Global = createGlobalStyle`\n  .card { border-radius: 12px; }\n`;\n\
export const A = () => <div className=\"card border-l-4 p-4\">x</div>;\n";
        assert_eq!(side_tabs(tsx, "/x/global.tsx"), flag);
        let jsx = "export const A = () => (\n  <>\n    <div className=\"card border-l-4 p-4\">x</div>\n    <style jsx>{`\n      .card { border-radius: 12px; }\n    `}</style>\n  </>\n);\n";
        assert_eq!(side_tabs(jsx, "/x/styled-jsx.jsx"), flag);
        assert_eq!(side_tabs(&jsx.replace("12px", "0"), "/x/styled-jsx.jsx"), none);
        let styled = "import styled from 'styled-components';\n\
const Card = styled.div`\n  border-radius: 12px;\n`;\n\
export const A = () => <Card className=\"border-l-4 p-4\">x</Card>;\n\
export const B = () => <div className=\"border-r-4 p-4\">x</div>;\n";
        assert_eq!(side_tabs(styled, "/x/styled.tsx"), flag);
    }

    /// A markup accent in a file that imports a stylesheet reports unless its
    /// own tag squares it off: the import could round any class it carries.
    #[test]
    fn markup_accents_keep_reporting_beside_an_imported_stylesheet() {
        let side_tabs = |src: &str, path: &str| -> Vec<String> {
            let mut out: Vec<String> = detect_text(src, path, &TextOptions::default())
                .into_iter()
                .filter(|f| f.antipattern == "side-tab")
                .map(|f| f.snippet)
                .collect();
            out.sort();
            out
        };
        let flag = vec!["border-l-4".to_string()];
        let none = Vec::<String>::new();
        let tag = "<div className=\"card border-l-4 border-teal-700 p-4\">x</div>";
        for import in [
            "import './card.css';",
            "import styles from './card.module.css';",
            "import * as s from \"./card.scss\";",
            "require('./card.scss');",
            "import('./card.less');",
        ] {
            let src = format!("{import}\nexport const A = () => {tag};\n");
            assert_eq!(side_tabs(&src, "/x/a.jsx"), flag, "{import}");
        }
        // Without an import, or with a script import, the tag reads as before.
        assert_eq!(side_tabs(&format!("export const A = () => {tag};\n"), "/x/a.jsx"), none);
        assert_eq!(side_tabs(&format!("import {{ cn }} from './utils';\nexport const A = () => {tag};\n"), "/x/a.jsx"), none);
        // A tag that squares itself off.
        let square = "import './card.css';\n\
export const A = () => <div className=\"card rounded-none border-l-4 p-4\">x</div>;\n\
export const B = () => <div className=\"card border-l-4 p-4\" style={{ borderRadius: 0 }}>x</div>;\n\
export const C = () => <Box className=\"card\" sx={{ borderRadius: 0, borderLeft: '5px solid #6366f1' }}>x</Box>;\n";
        assert_eq!(side_tabs(square, "/x/b.jsx"), none);
        // A radius on one corner away from the stripe leaves the other open.
        let one_corner = "import './card.css';\nexport const A = () => <div className=\"card border-l-4 p-4\" style={{ borderTopRightRadius: 0 }}>x</div>;\n";
        assert_eq!(side_tabs(one_corner, "/x/c.jsx"), flag);
        // Component files: an `@import` in the style block, and a `src` block.
        let vue = |style: &str| format!("<template>\n  <div class=\"card border-l-4 p-4\" />\n</template>\n{style}\n");
        assert_eq!(side_tabs(&vue("<style scoped>\n@import './card.css';\n</style>"), "/x/a.vue"), flag);
        assert_eq!(side_tabs(&vue("<style scoped src=\"./card.css\"></style>"), "/x/a.vue"), flag);
        // A `sass:` module brings no CSS.
        assert_eq!(side_tabs(&vue("<style lang=\"scss\" scoped>\n@use 'sass:math';\n</style>"), "/x/a.vue"), none);
    }

    /// A border accent reads the stylesheet the way the pseudo-element and
    /// inset scans do: another rule for the same element can round the card,
    /// and a box no radius rule names is known square only when nothing in
    /// the file can round it.
    #[test]
    fn side_accents_read_the_whole_stylesheet() {
        let side_tabs = |src: &str, path: &str| -> Vec<String> {
            let mut out: Vec<String> = detect_text(src, path, &TextOptions::default())
                .into_iter()
                .filter(|f| f.antipattern == "side-tab")
                .map(|f| f.snippet)
                .collect();
            out.sort();
            out
        };
        // Same selector, compound, pseudo-class, grouped, and a second SCSS
        // block: the radius sits in another rule for the same element.
        let css = ".alert { border-radius: 8px; }\n.alert { border-left: 3px solid #6366f1; }\n\
.card { border-radius: 12px; }\n.card.is-active { border-left: 4px solid #6366f1; }\n.card:hover { border-right: 5px solid #6366f1; }\n\
.panel,\n.widget { border-radius: 10px; }\n.widget { border-right: 6px solid #6366f1; }\n";
        assert_eq!(
            side_tabs(css, "/x/flat.css"),
            vec![
                "border-left: 3px solid #6366f1".to_string(),
                "border-left: 4px solid #6366f1".to_string(),
                "border-right: 5px solid #6366f1".to_string(),
                "border-right: 6px solid #6366f1".to_string(),
            ]
        );
        let scss = ".card {\n  border-radius: 12px;\n}\n.card {\n  &.is-active { border-left: 4px solid $primary; }\n}\n";
        assert_eq!(side_tabs(scss, "/x/flat.scss"), vec!["border-left: 4px solid $primary".to_string()]);
        let vue = "<template><div class=\"card\" /></template>\n<style scoped>\n.card { border-radius: 12px; }\n.card.active { border-left: 4px solid #6366f1; }\n</style>\n";
        assert_eq!(side_tabs(vue, "/x/flat.vue"), vec!["border-left: 4px solid #6366f1".to_string()]);

        // A radius the reader cannot resolve, and a radius on another class
        // the element may carry: both border and pseudo-element accents keep
        // their findings.
        let unknown = ".list-item { border-radius: var(--radius); }\n.list-item.active { border-left: 4px solid #6366f1; }\n\
.card { border-radius: 12px; }\n.card-accent { border-left: 5px solid #6366f1; }\n\
.note-accent::before { content: \"\"; position: absolute; left: 0; top: 0; bottom: 0; width: 6px; background: #6366f1; }\n";
        assert_eq!(
            side_tabs(unknown, "/x/unknown.css"),
            vec![
                ".note-accent::before — absolute 6px pseudo-element stripe (left: 0)".to_string(),
                "border-left: 4px solid #6366f1".to_string(),
                "border-left: 5px solid #6366f1".to_string(),
            ]
        );
        // Indented Sass has no index; the whole file still answers.
        let sass = ".card\n  border-radius: 12px\n.card.is-active\n  border-left: 4px solid #6366f1\n";
        assert_eq!(side_tabs(sass, "/x/flat.sass"), vec!["border-left: 4px solid #6366f1".to_string()]);
        // Mixins, `@apply` and interpolations could bring a radius in unseen.
        for source in [".x { @include card; }\n.a { border-left: 4px solid #6366f1; }\n", ".x { @apply rounded-lg; }\n.a { border-left: 4px solid #6366f1; }\n"] {
            assert_eq!(side_tabs(source, "/x/mixin.scss"), vec!["border-left: 4px solid #6366f1".to_string()], "{source}");
        }
        let tsx = "import styled from 'styled-components';\n\
export const Card = styled.div`\n  border-radius: 12px;\n`;\n\
export const Accent = styled(Card)`\n  border-left: 4px solid #6366f1;\n`;\n";
        assert_eq!(side_tabs(tsx, "/x/extend.tsx"), vec!["border-left: 4px solid #6366f1".to_string()]);

        // Known square: no radius anywhere, literal square radii only, or the
        // card's own literal radius under the threshold.
        let square = ".callout { border-left: 4px solid #6366f1; }\n\
.zero { border-left: 5px solid #6366f1; border-radius: 0; }\n\
.tiny { border-right: 6px solid #6366f1; border-radius: 2px; }\n\
.stripe-side { border-left: 7px solid #6366f1; border-radius: 12px 0 0 12px; }\n\
.bar { position: relative; }\n.bar::before { content: \"\"; position: absolute; left: 0; top: 0; bottom: 0; width: 8px; background: #6366f1; }\n\
.shadow { box-shadow: inset 9px 0 0 #6366f1; }\n";
        assert_eq!(side_tabs(square, "/x/square.css"), Vec::<String>::new());
        let square_sass = ".callout\n  padding: 8px\n  border-left: 4px solid #6366f1\n.zero\n  border-radius: 0\n  &.on\n    border-left: 5px solid #6366f1\n";
        assert_eq!(side_tabs(square_sass, "/x/square.sass"), Vec::<String>::new());
        let square_tsx = "import styled from 'styled-components';\n\
export const A = styled.div`\n  padding: 16px;\n  border-left: 6px solid #6366f1;\n`;\n\
export const B = styled.div`\n  position: relative;\n  border-radius: 0;\n  &::before { content: \"\"; position: absolute; left: 0; top: 0; bottom: 0; width: 7px; background: #6366f1; }\n`;\n";
        assert_eq!(side_tabs(square_tsx, "/x/square.tsx"), Vec::<String>::new());
    }

    /// The shapes whose radius the text engine cannot fully read report as
    /// they did before the rounded-card gate, and a literal square host in
    /// each shape stays silent.
    #[test]
    fn side_accents_fail_safe_to_reporting() {
        let side_tabs = |src: &str, path: &str| -> Vec<String> {
            let mut out: Vec<String> = detect_text(src, path, &TextOptions::default())
                .into_iter()
                .filter(|f| f.antipattern == "side-tab")
                .map(|f| f.snippet)
                .collect();
            out.sort();
            out
        };
        let tsx = "import styled from 'styled-components';\n\
export const Card = styled.div`\n  position: relative;\n  border-radius: ${({ theme }) => theme.radii.md};\n  &::before { content: \"\"; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: #6366f1; }\n`;\n\
export const Square = styled.div`\n  position: relative;\n  border-radius: 0;\n  &::before { content: \"\"; position: absolute; left: 0; top: 0; bottom: 0; width: 5px; background: #6366f1; }\n`;\n";
        assert_eq!(
            side_tabs(tsx, "/x/card.tsx"),
            vec!["&::before — absolute 4px pseudo-element stripe (left: 0)".to_string()]
        );
        let scss = ".card {\n  border-radius: 12px;\n  @media (min-width: 600px) {\n    border-left: 4px solid #6366f1;\n  }\n  @include bp(md) {\n    border-left: 5px solid #6366f1;\n  }\n}\n\
.sq {\n  border-radius: 0;\n  @media (min-width: 600px) {\n    border-left: 6px solid #6366f1;\n  }\n  @include bp(md) {\n    border-left: 7px solid #6366f1;\n  }\n}\n";
        assert_eq!(
            side_tabs(scss, "/x/card.scss"),
            vec![
                "border-left: 4px solid #6366f1".to_string(),
                "border-left: 5px solid #6366f1".to_string(),
            ]
        );
        let sass = ".card\n  border-radius: 12px\n  &.on\n    border-left: 4px solid #6366f1\n\
.sq\n  border-radius: 0\n  &.on\n    border-left: 5px solid #6366f1\n";
        assert_eq!(
            side_tabs(sass, "/x/card.sass"),
            vec!["border-left: 4px solid #6366f1".to_string()]
        );
    }
}
