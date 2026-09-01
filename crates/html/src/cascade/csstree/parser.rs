//! Port of the css-tree 3.2.1 parser subset that `csstree.parse(cssText,
//! { positions: false, parseValue: true, parseCustomProperty: false })`
//! exercises for a stylesheet: StyleSheet, Rule, Atrule, Block, Declaration,
//! Value (default recognizer + `var()` / `expression()`), the selector nodes
//! and pseudo-class arguments, and Raw with css-tree's balanced skipping and
//! fallback recovery.
//!
//! One deliberate shortcut, invisible to the caller: at-rule preludes are
//! always consumed as `Raw` (css-tree parses `@media` / `@supports` /
//! `@layer` / `@import` / `@container` preludes into dedicated nodes and
//! falls back to Raw on error). Both paths stop at the same token (the first
//! top-level `{` or `;`, or EOF), the prelude text is never read by the
//! cascade, and only `name` and `block` are consulted.

use super::ast::{Important, Node};
use super::strings::{decode_string, decode_url};
use super::tokenizer::*;

/// A css-tree `SyntaxError`; the message is not part of any output.
#[derive(Debug, Clone, PartialEq)]
pub struct ParseError;

pub type PResult<T> = Result<T, ParseError>;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Scope {
    Value,
    Selector,
}

pub struct Parser {
    pub ts: TokenStream,
    /// css-tree option `parseCustomProperty` (false in the cascade).
    pub parse_custom_property: bool,
    /// css-tree option `parseValue` (true in the cascade).
    pub parse_value: bool,
    /// css-tree option `parseRulePrelude` (true).
    pub parse_rule_prelude: bool,
}

const EXCLAMATIONMARK: u32 = 0x21;
const NUMBERSIGN: u32 = 0x23;
const DOLLARSIGN: u32 = 0x24;
const AMPERSAND: u32 = 0x26;
const ASTERISK: u32 = 0x2A;
const PLUSSIGN: u32 = 0x2B;
const HYPHENMINUS: u32 = 0x2D;
const FULLSTOP: u32 = 0x2E;
const SOLIDUS: u32 = 0x2F;
const SEMICOLON_CODE: u32 = 0x3B;
const EQUALSSIGN: u32 = 0x3D;
const GREATERTHANSIGN: u32 = 0x3E;
const QUESTIONMARK: u32 = 0x3F;
const CIRCUMFLEXACCENT: u32 = 0x5E;
const LEFTCURLYBRACKET: u32 = 0x7B;
const VERTICALLINE: u32 = 0x7C;
const TILDE: u32 = 0x7E;
const N_CODE: u32 = 0x6E;
const U_CODE: u32 = 0x75;

// stopConsume predicates (parser/create.js)
fn consume_until_balance_end(_code: u32) -> u8 {
    0
}
fn consume_until_left_curly_bracket(code: u32) -> u8 {
    if code == LEFTCURLYBRACKET {
        1
    } else {
        0
    }
}
fn consume_until_left_curly_bracket_or_semicolon(code: u32) -> u8 {
    if code == LEFTCURLYBRACKET || code == SEMICOLON_CODE {
        1
    } else {
        0
    }
}
fn consume_until_exclamation_mark_or_semicolon(code: u32) -> u8 {
    if code == EXCLAMATIONMARK || code == SEMICOLON_CODE {
        1
    } else {
        0
    }
}
fn consume_until_semicolon_included(code: u32) -> u8 {
    if code == SEMICOLON_CODE {
        2
    } else {
        0
    }
}

/// css-tree `parse(source)` with the cascade's options; `Err` mirrors the
/// throw the JS `try/catch` swallows.
pub fn parse_stylesheet(source: &str) -> PResult<Node> {
    let mut p = Parser {
        ts: TokenStream::new(source),
        parse_custom_property: false,
        parse_value: true,
        parse_rule_prelude: true,
    };
    let ast = p.style_sheet()?;
    if !p.ts.eof {
        return Err(ParseError);
    }
    Ok(ast)
}

impl Parser {
    // ─── TokenStream conveniences ─────────────────────────────────────

    fn error<T>(&self) -> PResult<T> {
        Err(ParseError)
    }

    fn eat(&mut self, token_type: TokenType) -> PResult<()> {
        if self.ts.token_type != token_type {
            // The JS tweaks message/offset (and for Hash advances past a `#`
            // delim) before throwing; only the throw is observable.
            return Err(ParseError);
        }
        self.ts.next();
        Ok(())
    }

    fn eat_ident(&mut self, name: &str) -> PResult<()> {
        if self.ts.token_type != IDENT || !self.ts.lookup_value(0, name) {
            return Err(ParseError);
        }
        self.ts.next();
        Ok(())
    }

    fn eat_delim(&mut self, code: u32) -> PResult<()> {
        if !self.ts.is_delim(code) {
            return Err(ParseError);
        }
        self.ts.next();
        Ok(())
    }

    fn consume(&mut self, token_type: TokenType) -> PResult<String> {
        let start = self.ts.token_start;
        self.eat(token_type)?;
        Ok(self.ts.substr_to_cursor(start))
    }

    fn consume_function_name(&mut self) -> PResult<String> {
        let name = self
            .ts
            .substring(self.ts.token_start, self.ts.token_end.saturating_sub(1));
        self.eat(FUNCTION)?;
        Ok(name)
    }

    fn consume_number_of(&mut self, token_type: TokenType) -> PResult<String> {
        let end = consume_number(&self.ts.source, self.ts.token_start);
        let number = self.ts.substring(self.ts.token_start, end);
        self.eat(token_type)?;
        Ok(number)
    }

    fn cmp_str_tok(&self, reference: &str) -> bool {
        cmp_str(
            &self.ts.source,
            self.ts.token_start,
            self.ts.token_end,
            reference,
        )
    }

    fn parse_with_fallback<C, F>(&mut self, consumer: C, fallback: F) -> PResult<Node>
    where
        C: FnOnce(&mut Parser) -> PResult<Node>,
        F: FnOnce(&mut Parser) -> PResult<Node>,
    {
        let start_index = self.ts.token_index;
        match consumer(self) {
            Ok(node) => Ok(node),
            Err(_) => {
                self.ts.seek(start_index);
                fallback(self)
            }
        }
    }

    // ─── Raw ───────────────────────────────────────────────────────────

    fn get_offset_exclude_ws(&self) -> usize {
        if self.ts.token_index > 0 && self.ts.lookup_type(-1) == WHITESPACE {
            return if self.ts.token_index > 1 {
                self.ts.get_token_start(self.ts.token_index - 1)
            } else {
                self.ts.first_char_offset
            };
        }
        self.ts.token_start
    }

    /// JS `this.Raw(consumeUntil, excludeWhiteSpace)`.
    fn raw(&mut self, consume_until: Option<fn(u32) -> u8>, exclude_white_space: bool) -> Node {
        let start_offset = self.ts.get_token_start(self.ts.token_index);
        let stop = consume_until.unwrap_or(consume_until_balance_end);
        self.ts.skip_until_balanced(self.ts.token_index, stop);
        let end_offset = if exclude_white_space && self.ts.token_start > start_offset {
            self.get_offset_exclude_ws()
        } else {
            self.ts.token_start
        };
        Node::Raw {
            value: self.ts.substring(start_offset, end_offset),
        }
    }

    // ─── Sequences ─────────────────────────────────────────────────────

    fn read_sequence(&mut self, scope: Scope) -> PResult<Vec<Node>> {
        let mut children: Vec<Node> = Vec::new();
        let mut space = false;
        while !self.ts.eof {
            match self.ts.token_type {
                COMMENT => {
                    self.ts.next();
                    continue;
                }
                WHITESPACE => {
                    space = true;
                    self.ts.next();
                    continue;
                }
                _ => {}
            }
            let child = match scope {
                Scope::Value => self.value_get_node()?,
                Scope::Selector => self.selector_get_node()?,
            };
            let Some(mut child) = child else {
                break;
            };
            if space {
                Self::on_white_space(scope, Some(&mut child), &mut children);
                space = false;
            }
            children.push(child);
        }
        if space {
            Self::on_white_space(scope, None, &mut children);
        }
        Ok(children)
    }

    fn is_plus_minus_operator(node: Option<&Node>) -> bool {
        match node {
            Some(Node::Operator { value }) => value.ends_with('-') || value.ends_with('+'),
            _ => false,
        }
    }

    fn on_white_space(scope: Scope, next: Option<&mut Node>, children: &mut Vec<Node>) {
        match scope {
            Scope::Value => {
                if let Some(next) = next {
                    if Self::is_plus_minus_operator(Some(next)) {
                        if let Node::Operator { value } = next {
                            *value = format!(" {}", value);
                        }
                    }
                }
                if Self::is_plus_minus_operator(children.last()) {
                    if let Some(Node::Operator { value }) = children.last_mut() {
                        value.push(' ');
                    }
                }
            }
            Scope::Selector => {
                let last_ok =
                    matches!(children.last(), Some(n) if !matches!(n, Node::Combinator { .. }));
                let next_ok = matches!(next, Some(n) if !matches!(n, Node::Combinator { .. }));
                if last_ok && next_ok {
                    children.push(Node::Combinator {
                        name: " ".to_string(),
                    });
                }
            }
        }
    }

    /// scope/default.js `defaultRecognizer` (the Value scope's getNode).
    fn value_get_node(&mut self) -> PResult<Option<Node>> {
        Ok(Some(match self.ts.token_type {
            HASH => self.hash()?,
            COMMA => self.operator(),
            LEFT_PARENTHESIS => self.parentheses()?,
            LEFT_SQUARE_BRACKET => self.brackets()?,
            STRING => self.string()?,
            DIMENSION => self.dimension()?,
            PERCENTAGE => self.percentage()?,
            NUMBER => self.number()?,
            FUNCTION => {
                if self.cmp_str_tok("url(") {
                    self.url()?
                } else {
                    self.function()?
                }
            }
            URL => self.url()?,
            IDENT => {
                if cmp_char(&self.ts.source, self.ts.token_start, U_CODE)
                    && cmp_char(&self.ts.source, self.ts.token_start + 1, PLUSSIGN)
                {
                    self.unicode_range()?
                } else {
                    self.identifier()?
                }
            }
            DELIM => {
                let code = self.ts.char_code_at(self.ts.token_start);
                if code == SOLIDUS || code == ASTERISK || code == PLUSSIGN || code == HYPHENMINUS {
                    return Ok(Some(self.operator()));
                }
                if code == NUMBERSIGN {
                    return self.error();
                }
                return Ok(None);
            }
            _ => return Ok(None),
        }))
    }

    /// scope/selector.js getNode.
    fn selector_get_node(&mut self) -> PResult<Option<Node>> {
        Ok(Some(match self.ts.token_type {
            LEFT_SQUARE_BRACKET => self.attribute_selector()?,
            HASH => self.id_selector()?,
            COLON => {
                if self.ts.lookup_type(1) == COLON {
                    self.pseudo_element_selector()?
                } else {
                    self.pseudo_class_selector()?
                }
            }
            IDENT => self.type_selector()?,
            NUMBER | PERCENTAGE => self.percentage()?,
            DIMENSION => {
                if self.ts.char_code_at(self.ts.token_start) == FULLSTOP {
                    return self.error();
                }
                return Ok(None);
            }
            DELIM => {
                let code = self.ts.char_code_at(self.ts.token_start);
                match code {
                    PLUSSIGN | GREATERTHANSIGN | TILDE | SOLIDUS => self.combinator()?,
                    FULLSTOP => self.class_selector()?,
                    ASTERISK | VERTICALLINE => self.type_selector()?,
                    NUMBERSIGN => self.id_selector()?,
                    AMPERSAND => self.nesting_selector()?,
                    _ => return Ok(None),
                }
            }
            _ => return Ok(None),
        }))
    }

    // ─── Value nodes ───────────────────────────────────────────────────

    fn hash(&mut self) -> PResult<Node> {
        let start = self.ts.token_start;
        self.eat(HASH)?;
        Ok(Node::Hash {
            value: self.ts.substr_to_cursor(start + 1),
        })
    }

    fn operator(&mut self) -> Node {
        let start = self.ts.token_start;
        self.ts.next();
        Node::Operator {
            value: self.ts.substr_to_cursor(start),
        }
    }

    fn parentheses(&mut self) -> PResult<Node> {
        self.eat(LEFT_PARENTHESIS)?;
        let children = self.read_sequence(Scope::Value)?;
        if !self.ts.eof {
            self.eat(RIGHT_PARENTHESIS)?;
        }
        Ok(Node::Parentheses { children })
    }

    fn brackets(&mut self) -> PResult<Node> {
        self.eat(LEFT_SQUARE_BRACKET)?;
        let children = self.read_sequence(Scope::Value)?;
        if !self.ts.eof {
            self.eat(RIGHT_SQUARE_BRACKET)?;
        }
        Ok(Node::Brackets { children })
    }

    fn string(&mut self) -> PResult<Node> {
        let raw = self.consume(STRING)?;
        Ok(Node::Str {
            value: decode_string(&raw),
        })
    }

    fn dimension(&mut self) -> PResult<Node> {
        let start = self.ts.token_start;
        let value = self.consume_number_of(DIMENSION)?;
        let value_len = value.chars().count();
        let unit = self.ts.substring(start + value_len, self.ts.token_start);
        Ok(Node::Dimension { value, unit })
    }

    fn percentage(&mut self) -> PResult<Node> {
        let value = self.consume_number_of(PERCENTAGE)?;
        Ok(Node::Percentage { value })
    }

    fn number(&mut self) -> PResult<Node> {
        let value = self.consume(NUMBER)?;
        Ok(Node::Number { value })
    }

    fn function(&mut self) -> PResult<Node> {
        let name = self.consume_function_name()?;
        let name_lower = name.to_lowercase();
        let children = match name_lower.as_str() {
            "var" => self.fn_var()?,
            "expression" => vec![self.raw(None, false)],
            _ => self.read_sequence(Scope::Value)?,
        };
        if !self.ts.eof {
            self.eat(RIGHT_PARENTHESIS)?;
        }
        Ok(Node::Function { name, children })
    }

    /// syntax/function/var.js
    fn fn_var(&mut self) -> PResult<Vec<Node>> {
        let mut children = Vec::new();
        self.ts.skip_sc();
        children.push(self.identifier()?);
        self.ts.skip_sc();
        if self.ts.token_type == COMMA {
            children.push(self.operator());
            let start_index = self.ts.token_index;
            let mut value = if self.parse_custom_property {
                self.value()?
            } else {
                self.raw(Some(consume_until_exclamation_mark_or_semicolon), false)
            };
            if let Node::Value { children: vc } = &mut value {
                if vc.is_empty() {
                    let mut offset = start_index as isize - self.ts.token_index as isize;
                    while offset <= 0 {
                        if self.ts.lookup_type(offset) == WHITESPACE {
                            vc.push(Node::WhiteSpace {
                                value: " ".to_string(),
                            });
                            break;
                        }
                        offset += 1;
                    }
                }
            }
            children.push(value);
        }
        Ok(children)
    }

    fn url(&mut self) -> PResult<Node> {
        let value = match self.ts.token_type {
            URL => {
                let raw = self.consume(URL)?;
                decode_url(&raw)
            }
            FUNCTION => {
                if !self.cmp_str_tok("url(") {
                    return self.error();
                }
                self.eat(FUNCTION)?;
                self.ts.skip_sc();
                let raw = self.consume(STRING)?;
                let v = decode_string(&raw);
                self.ts.skip_sc();
                if !self.ts.eof {
                    self.eat(RIGHT_PARENTHESIS)?;
                }
                v
            }
            _ => return self.error(),
        };
        Ok(Node::Url { value })
    }

    fn identifier(&mut self) -> PResult<Node> {
        let name = self.consume(IDENT)?;
        Ok(Node::Identifier { name })
    }

    fn value(&mut self) -> PResult<Node> {
        let children = self.read_sequence(Scope::Value)?;
        Ok(Node::Value { children })
    }

    // ─── UnicodeRange ──────────────────────────────────────────────────

    fn eat_hex_sequence(&mut self, offset: usize, allow_dash: bool) -> PResult<isize> {
        let mut len: usize = 0;
        let mut pos = self.ts.token_start + offset;
        while pos < self.ts.token_end {
            let code = self.ts.char_code_at(pos);
            if code == HYPHENMINUS && allow_dash && len != 0 {
                self.eat_hex_sequence(offset + len + 1, false)?;
                return Ok(-1);
            }
            if !is_hex_digit(code) {
                return self.error();
            }
            len += 1;
            if len > 6 {
                return self.error();
            }
            pos += 1;
        }
        self.ts.next();
        Ok(len as isize)
    }

    fn eat_question_mark_sequence(&mut self, max: isize) -> PResult<()> {
        let mut count: isize = 0;
        while self.ts.is_delim(QUESTIONMARK) {
            count += 1;
            if count > max {
                return self.error();
            }
            self.ts.next();
        }
        Ok(())
    }

    fn starts_with_code(&self, code: u32) -> PResult<()> {
        if self.ts.char_code_at(self.ts.token_start) != code {
            return self.error();
        }
        Ok(())
    }

    fn scan_unicode_range(&mut self) -> PResult<()> {
        match self.ts.token_type {
            NUMBER => {
                let hex_length = self.eat_hex_sequence(1, true)?;
                if self.ts.is_delim(QUESTIONMARK) {
                    self.eat_question_mark_sequence(6 - hex_length)?;
                    return Ok(());
                }
                if self.ts.token_type == DIMENSION || self.ts.token_type == NUMBER {
                    self.starts_with_code(HYPHENMINUS)?;
                    self.eat_hex_sequence(1, false)?;
                    return Ok(());
                }
                Ok(())
            }
            DIMENSION => {
                let hex_length = self.eat_hex_sequence(1, true)?;
                if hex_length > 0 {
                    self.eat_question_mark_sequence(6 - hex_length)?;
                }
                Ok(())
            }
            _ => {
                self.eat_delim(PLUSSIGN)?;
                if self.ts.token_type == IDENT {
                    let hex_length = self.eat_hex_sequence(0, true)?;
                    if hex_length > 0 {
                        self.eat_question_mark_sequence(6 - hex_length)?;
                    }
                    return Ok(());
                }
                if self.ts.is_delim(QUESTIONMARK) {
                    self.ts.next();
                    self.eat_question_mark_sequence(5)?;
                    return Ok(());
                }
                self.error()
            }
        }
    }

    fn unicode_range(&mut self) -> PResult<Node> {
        let start = self.ts.token_start;
        self.eat_ident("u")?;
        self.scan_unicode_range()?;
        Ok(Node::UnicodeRange {
            value: self.ts.substr_to_cursor(start),
        })
    }

    // ─── Selector nodes ────────────────────────────────────────────────

    fn selector_list(&mut self) -> PResult<Node> {
        let mut children = Vec::new();
        while !self.ts.eof {
            children.push(self.selector()?);
            if self.ts.token_type == COMMA {
                self.ts.next();
                continue;
            }
            break;
        }
        Ok(Node::SelectorList { children })
    }

    fn selector(&mut self) -> PResult<Node> {
        let children = self.read_sequence(Scope::Selector)?;
        if children.is_empty() {
            return self.error();
        }
        Ok(Node::Selector { children })
    }

    fn eat_identifier_or_asterisk(&mut self) -> PResult<()> {
        if self.ts.token_type != IDENT && !self.ts.is_delim(ASTERISK) {
            return self.error();
        }
        self.ts.next();
        Ok(())
    }

    fn type_selector(&mut self) -> PResult<Node> {
        let start = self.ts.token_start;
        if self.ts.is_delim(VERTICALLINE) {
            self.ts.next();
            self.eat_identifier_or_asterisk()?;
        } else {
            self.eat_identifier_or_asterisk()?;
            if self.ts.is_delim(VERTICALLINE) {
                self.ts.next();
                self.eat_identifier_or_asterisk()?;
            }
        }
        Ok(Node::TypeSelector {
            name: self.ts.substr_to_cursor(start),
        })
    }

    fn class_selector(&mut self) -> PResult<Node> {
        self.eat_delim(FULLSTOP)?;
        let name = self.consume(IDENT)?;
        Ok(Node::ClassSelector { name })
    }

    fn id_selector(&mut self) -> PResult<Node> {
        let start = self.ts.token_start;
        self.eat(HASH)?;
        Ok(Node::IdSelector {
            name: self.ts.substr_to_cursor(start + 1),
        })
    }

    fn get_attribute_name(&mut self) -> PResult<Node> {
        if self.ts.eof {
            return self.error();
        }
        let start = self.ts.token_start;
        let mut expect_ident = false;
        if self.ts.is_delim(ASTERISK) {
            expect_ident = true;
            self.ts.next();
        } else if !self.ts.is_delim(VERTICALLINE) {
            self.eat(IDENT)?;
        }
        if self.ts.is_delim(VERTICALLINE) {
            if self.ts.char_code_at(self.ts.token_start + 1) != EQUALSSIGN {
                self.ts.next();
                self.eat(IDENT)?;
            } else if expect_ident {
                return self.error();
            }
        } else if expect_ident {
            return self.error();
        }
        Ok(Node::Identifier {
            name: self.ts.substr_to_cursor(start),
        })
    }

    fn get_operator(&mut self) -> PResult<String> {
        let start = self.ts.token_start;
        let code = self.ts.char_code_at(start);
        if code != EQUALSSIGN
            && code != TILDE
            && code != CIRCUMFLEXACCENT
            && code != DOLLARSIGN
            && code != ASTERISK
            && code != VERTICALLINE
        {
            return self.error();
        }
        self.ts.next();
        if code != EQUALSSIGN {
            if !self.ts.is_delim(EQUALSSIGN) {
                return self.error();
            }
            self.ts.next();
        }
        Ok(self.ts.substr_to_cursor(start))
    }

    fn attribute_selector(&mut self) -> PResult<Node> {
        let mut matcher = None;
        let mut value = None;
        let mut flags = None;
        self.eat(LEFT_SQUARE_BRACKET)?;
        self.ts.skip_sc();
        let name = self.get_attribute_name()?;
        self.ts.skip_sc();
        if self.ts.token_type != RIGHT_SQUARE_BRACKET {
            if self.ts.token_type != IDENT {
                matcher = Some(self.get_operator()?);
                self.ts.skip_sc();
                value = Some(Box::new(if self.ts.token_type == STRING {
                    self.string()?
                } else {
                    self.identifier()?
                }));
                self.ts.skip_sc();
            }
            if self.ts.token_type == IDENT {
                flags = Some(self.consume(IDENT)?);
                self.ts.skip_sc();
            }
        }
        self.eat(RIGHT_SQUARE_BRACKET)?;
        Ok(Node::AttributeSelector {
            name: Box::new(name),
            matcher,
            value,
            flags,
        })
    }

    fn combinator(&mut self) -> PResult<Node> {
        let start = self.ts.token_start;
        let name;
        match self.ts.token_type {
            WHITESPACE => {
                name = " ".to_string();
            }
            DELIM => {
                match self.ts.char_code_at(self.ts.token_start) {
                    GREATERTHANSIGN | PLUSSIGN | TILDE => {
                        self.ts.next();
                    }
                    SOLIDUS => {
                        self.ts.next();
                        self.eat_ident("deep")?;
                        self.eat_delim(SOLIDUS)?;
                    }
                    _ => return self.error(),
                }
                name = self.ts.substr_to_cursor(start);
            }
            _ => {
                // JS: `name` stays undefined; unreachable from the selector
                // recognizer, which only calls this for the delims above.
                name = String::new();
            }
        }
        Ok(Node::Combinator { name })
    }

    fn nesting_selector(&mut self) -> PResult<Node> {
        self.eat_delim(AMPERSAND)?;
        Ok(Node::NestingSelector)
    }

    fn pseudo_children(&mut self, name_lower: &str) -> PResult<Option<Vec<Node>>> {
        Ok(Some(match name_lower {
            "dir" => vec![self.identifier()?],
            "has" | "matches" | "is" | "-moz-any" | "-webkit-any" | "where" | "not" => {
                vec![self.selector_list()?]
            }
            "lang" => self.parse_language_range_list()?,
            "nth-child" | "nth-last-child" | "nth-last-of-type" | "nth-of-type" => {
                vec![self.nth()?]
            }
            "slotted" | "host" | "host-context" => vec![self.selector()?],
            _ => return Ok(None),
        }))
    }

    fn pseudo_selector_body(&mut self) -> PResult<(String, Option<Vec<Node>>)> {
        if self.ts.token_type == FUNCTION {
            let name = self.consume_function_name()?;
            let name_lower = name.to_lowercase();
            let children = if self.ts.lookup_type_non_sc(0) == RIGHT_PARENTHESIS {
                Vec::new()
            } else {
                // Peek whether a dedicated pseudo parser exists before
                // committing skipSC (the JS skips only in that branch).
                let known = matches!(
                    name_lower.as_str(),
                    "dir"
                        | "has"
                        | "matches"
                        | "is"
                        | "-moz-any"
                        | "-webkit-any"
                        | "where"
                        | "not"
                        | "lang"
                        | "nth-child"
                        | "nth-last-child"
                        | "nth-last-of-type"
                        | "nth-of-type"
                        | "slotted"
                        | "host"
                        | "host-context"
                );
                if known {
                    self.ts.skip_sc();
                    let c = self.pseudo_children(&name_lower)?.unwrap_or_default();
                    self.ts.skip_sc();
                    c
                } else {
                    vec![self.raw(None, false)]
                }
            };
            self.eat(RIGHT_PARENTHESIS)?;
            Ok((name, Some(children)))
        } else {
            let name = self.consume(IDENT)?;
            Ok((name, None))
        }
    }

    fn pseudo_class_selector(&mut self) -> PResult<Node> {
        self.eat(COLON)?;
        let (name, children) = self.pseudo_selector_body()?;
        Ok(Node::PseudoClassSelector { name, children })
    }

    fn pseudo_element_selector(&mut self) -> PResult<Node> {
        self.eat(COLON)?;
        self.eat(COLON)?;
        let (name, children) = self.pseudo_selector_body()?;
        Ok(Node::PseudoElementSelector { name, children })
    }

    fn parse_language_range_list(&mut self) -> PResult<Vec<Node>> {
        let mut children = Vec::new();
        self.ts.skip_sc();
        while !self.ts.eof {
            match self.ts.token_type {
                IDENT => children.push(self.identifier()?),
                STRING => children.push(self.string()?),
                COMMA => children.push(self.operator()),
                RIGHT_PARENTHESIS => break,
                _ => return self.error(),
            }
            self.ts.skip_sc();
        }
        Ok(children)
    }

    // ─── Nth / AnPlusB ─────────────────────────────────────────────────

    fn nth(&mut self) -> PResult<Node> {
        self.ts.skip_sc();
        let nth = if self.ts.lookup_value(0, "odd") || self.ts.lookup_value(0, "even") {
            self.identifier()?
        } else {
            self.an_plus_b()?
        };
        self.ts.skip_sc();
        let mut selector = None;
        if self.ts.lookup_value(0, "of") {
            self.ts.next();
            selector = Some(Box::new(self.selector_list()?));
        }
        Ok(Node::Nth {
            nth: Box::new(nth),
            selector,
        })
    }

    fn check_integer(&self, offset: usize, disallow_sign: bool) -> PResult<()> {
        let mut pos = self.ts.token_start + offset;
        let code = self.ts.char_code_at(pos);
        if code == PLUSSIGN || code == HYPHENMINUS {
            if disallow_sign {
                return self.error();
            }
            pos += 1;
        }
        while pos < self.ts.token_end {
            if !is_digit(self.ts.char_code_at(pos)) {
                return self.error();
            }
            pos += 1;
        }
        Ok(())
    }

    fn check_token_is_integer(&self, disallow_sign: bool) -> PResult<()> {
        self.check_integer(0, disallow_sign)
    }

    fn expect_char_code(&self, offset: usize, code: u32) -> PResult<()> {
        if !cmp_char(&self.ts.source, self.ts.token_start + offset, code) {
            return self.error();
        }
        Ok(())
    }

    fn consume_b(&mut self) -> PResult<Option<String>> {
        let mut offset: isize = 0;
        let mut sign: u32 = 0;
        let mut ty = self.ts.token_type;
        while ty == WHITESPACE || ty == COMMENT {
            offset += 1;
            ty = self.ts.lookup_type(offset);
        }
        if ty != NUMBER {
            if self.ts.is_delim_at(PLUSSIGN, offset) || self.ts.is_delim_at(HYPHENMINUS, offset) {
                sign = if self.ts.is_delim_at(PLUSSIGN, offset) {
                    PLUSSIGN
                } else {
                    HYPHENMINUS
                };
                loop {
                    offset += 1;
                    ty = self.ts.lookup_type(offset);
                    if ty != WHITESPACE && ty != COMMENT {
                        break;
                    }
                }
                if ty != NUMBER {
                    self.ts.skip(offset);
                    self.check_token_is_integer(true)?;
                }
            } else {
                return Ok(None);
            }
        }
        if offset > 0 {
            self.ts.skip(offset);
        }
        if sign == 0 {
            let c = self.ts.char_code_at(self.ts.token_start);
            if c != PLUSSIGN && c != HYPHENMINUS {
                return self.error();
            }
        }
        self.check_token_is_integer(sign != 0)?;
        let num = self.consume(NUMBER)?;
        Ok(Some(if sign == HYPHENMINUS {
            format!("-{}", num)
        } else {
            num
        }))
    }

    fn an_plus_b(&mut self) -> PResult<Node> {
        let start = self.ts.token_start;
        let mut a: Option<String> = None;
        let mut b: Option<String>;

        if self.ts.token_type == NUMBER {
            self.check_token_is_integer(false)?;
            b = Some(self.consume(NUMBER)?);
        } else if self.ts.token_type == IDENT
            && cmp_char(&self.ts.source, self.ts.token_start, HYPHENMINUS)
        {
            a = Some("-1".to_string());
            self.expect_char_code(1, N_CODE)?;
            match self.ts.token_end - self.ts.token_start {
                2 => {
                    self.ts.next();
                    b = self.consume_b()?;
                }
                3 => {
                    self.expect_char_code(2, HYPHENMINUS)?;
                    self.ts.next();
                    self.ts.skip_sc();
                    self.check_token_is_integer(true)?;
                    b = Some(format!("-{}", self.consume(NUMBER)?));
                }
                _ => {
                    self.expect_char_code(2, HYPHENMINUS)?;
                    self.check_integer(3, true)?;
                    self.ts.next();
                    b = Some(self.ts.substr_to_cursor(start + 2));
                }
            }
        } else if self.ts.token_type == IDENT
            || (self.ts.is_delim(PLUSSIGN) && self.ts.lookup_type(1) == IDENT)
        {
            let mut sign = 0usize;
            a = Some("1".to_string());
            if self.ts.is_delim(PLUSSIGN) {
                sign = 1;
                self.ts.next();
            }
            self.expect_char_code(0, N_CODE)?;
            match self.ts.token_end - self.ts.token_start {
                1 => {
                    self.ts.next();
                    b = self.consume_b()?;
                }
                2 => {
                    self.expect_char_code(1, HYPHENMINUS)?;
                    self.ts.next();
                    self.ts.skip_sc();
                    self.check_token_is_integer(true)?;
                    b = Some(format!("-{}", self.consume(NUMBER)?));
                }
                _ => {
                    self.expect_char_code(1, HYPHENMINUS)?;
                    self.check_integer(2, true)?;
                    self.ts.next();
                    b = Some(self.ts.substr_to_cursor(start + sign + 1));
                }
            }
        } else if self.ts.token_type == DIMENSION {
            let code = self.ts.char_code_at(self.ts.token_start);
            let sign = if code == PLUSSIGN || code == HYPHENMINUS {
                1
            } else {
                0
            };
            let mut i = self.ts.token_start + sign;
            while i < self.ts.token_end {
                if !is_digit(self.ts.char_code_at(i)) {
                    break;
                }
                i += 1;
            }
            if i == self.ts.token_start + sign {
                return self.error();
            }
            self.expect_char_code(i - self.ts.token_start, N_CODE)?;
            a = Some(self.ts.substring(start, i));
            if i + 1 == self.ts.token_end {
                self.ts.next();
                b = self.consume_b()?;
            } else {
                self.expect_char_code(i - self.ts.token_start + 1, HYPHENMINUS)?;
                if i + 2 == self.ts.token_end {
                    self.ts.next();
                    self.ts.skip_sc();
                    self.check_token_is_integer(true)?;
                    b = Some(format!("-{}", self.consume(NUMBER)?));
                } else {
                    self.check_integer(i - self.ts.token_start + 2, true)?;
                    self.ts.next();
                    b = Some(self.ts.substr_to_cursor(i + 1));
                }
            }
        } else {
            return self.error();
        }

        if let Some(av) = &a {
            if av.starts_with('+') {
                a = Some(av[1..].to_string());
            }
        }
        if let Some(bv) = &b {
            if bv.starts_with('+') {
                b = Some(bv[1..].to_string());
            }
        }
        Ok(Node::AnPlusB { a, b })
    }

    // ─── Structure nodes ───────────────────────────────────────────────

    fn comment(&mut self) -> PResult<Node> {
        let start = self.ts.token_start;
        let mut end = self.ts.token_end;
        self.eat(COMMENT)?;
        if end >= start
            && self.ts.char_code_at(end.wrapping_sub(2)) == ASTERISK
            && self.ts.char_code_at(end.wrapping_sub(1)) == SOLIDUS
        {
            end -= 2;
        }
        Ok(Node::Comment {
            value: self.ts.substring(start + 2, end),
        })
    }

    fn style_sheet(&mut self) -> PResult<Node> {
        let mut children = Vec::new();
        while !self.ts.eof {
            let before = (self.ts.token_index, self.ts.eof);
            let child = match self.ts.token_type {
                WHITESPACE => {
                    self.ts.next();
                    continue;
                }
                COMMENT => {
                    if self.ts.char_code_at(self.ts.token_start + 2) != EXCLAMATIONMARK {
                        self.ts.next();
                        continue;
                    }
                    self.comment()?
                }
                CDO => {
                    self.eat(CDO)?;
                    Node::Cdo
                }
                CDC => {
                    self.eat(CDC)?;
                    Node::Cdc
                }
                AT_KEYWORD => {
                    self.parse_with_fallback(|p| p.atrule(false), |p| Ok(p.raw(None, false)))?
                }
                _ => self.parse_with_fallback(|p| p.rule(), |p| Ok(p.raw(None, false)))?,
            };
            children.push(child);
            // Guard against a zero-token consumer (the JS would spin); the
            // recovery paths always advance for well-formed token tables.
            if (self.ts.token_index, self.ts.eof) == before {
                return Err(ParseError);
            }
        }
        Ok(Node::StyleSheet { children })
    }

    fn rule(&mut self) -> PResult<Node> {
        let prelude = if self.parse_rule_prelude {
            self.parse_with_fallback(
                |p| {
                    let prelude = p.selector_list()?;
                    if !prelude.is_raw() && !p.ts.eof && p.ts.token_type != LEFT_CURLY_BRACKET {
                        return p.error();
                    }
                    Ok(prelude)
                },
                |p| Ok(p.raw(Some(consume_until_left_curly_bracket), true)),
            )?
        } else {
            self.raw(Some(consume_until_left_curly_bracket), true)
        };
        let block = self.block(true)?;
        Ok(Node::Rule {
            prelude: Box::new(prelude),
            block: Box::new(block),
        })
    }

    fn is_declaration_block_atrule(&self) -> bool {
        let mut offset: isize = 1;
        loop {
            let ty = self.ts.lookup_type(offset);
            if ty == EOF {
                return false;
            }
            if ty == RIGHT_CURLY_BRACKET {
                return true;
            }
            if ty == LEFT_CURLY_BRACKET || ty == AT_KEYWORD {
                return false;
            }
            offset += 1;
        }
    }

    fn atrule(&mut self, is_declaration: bool) -> PResult<Node> {
        let start = self.ts.token_start;
        self.eat(AT_KEYWORD)?;
        let name = self.ts.substr_to_cursor(start + 1);
        let name_lower = name.to_lowercase();
        self.ts.skip_sc();

        let mut prelude = None;
        if !self.ts.eof
            && self.ts.token_type != LEFT_CURLY_BRACKET
            && self.ts.token_type != SEMICOLON
        {
            // See the module doc: preludes are consumed as Raw.
            prelude = Some(Box::new(
                self.raw(Some(consume_until_left_curly_bracket_or_semicolon), true),
            ));
            self.ts.skip_sc();
        }

        let mut block = None;
        match self.ts.token_type {
            SEMICOLON => {
                self.ts.next();
            }
            LEFT_CURLY_BRACKET => {
                block = Some(Box::new(match name_lower.as_str() {
                    // atrule/*.js block handlers
                    "media" | "supports" | "container" | "scope" | "starting-style" => {
                        self.block(is_declaration)?
                    }
                    "layer" => self.block(false)?,
                    "nest" | "page" | "font-face" => self.block(true)?,
                    _ => {
                        let is_decl = self.is_declaration_block_atrule();
                        self.block(is_decl)?
                    }
                }));
            }
            _ => {}
        }

        Ok(Node::Atrule {
            name,
            prelude,
            block,
        })
    }

    fn consume_declaration(&mut self) -> PResult<Node> {
        if self.ts.token_type == SEMICOLON {
            return Ok(self.raw(Some(consume_until_semicolon_included), true));
        }
        let node = self.parse_with_fallback(
            |p| p.declaration(),
            |p| Ok(p.raw(Some(consume_until_semicolon_included), true)),
        )?;
        if self.ts.token_type == SEMICOLON {
            self.ts.next();
        }
        Ok(node)
    }

    fn consume_rule(&mut self) -> PResult<Node> {
        self.parse_with_fallback(|p| p.rule(), |p| Ok(p.raw(None, true)))
    }

    fn block(&mut self, is_style_block: bool) -> PResult<Node> {
        let mut children = Vec::new();
        self.eat(LEFT_CURLY_BRACKET)?;
        while !self.ts.eof {
            match self.ts.token_type {
                RIGHT_CURLY_BRACKET => break,
                WHITESPACE | COMMENT => {
                    self.ts.next();
                }
                AT_KEYWORD => {
                    let node = self.parse_with_fallback(
                        |p| p.atrule(is_style_block),
                        |p| Ok(p.raw(None, true)),
                    )?;
                    children.push(node);
                }
                _ => {
                    let before = (self.ts.token_index, self.ts.eof);
                    if is_style_block && self.ts.is_delim(AMPERSAND) {
                        children.push(self.consume_rule()?);
                    } else if is_style_block {
                        children.push(self.consume_declaration()?);
                    } else {
                        children.push(self.consume_rule()?);
                    }
                    if (self.ts.token_index, self.ts.eof) == before {
                        return Err(ParseError);
                    }
                }
            }
        }
        if !self.ts.eof {
            self.eat(RIGHT_CURLY_BRACKET)?;
        }
        Ok(Node::Block { children })
    }

    fn read_property(&mut self) -> PResult<String> {
        let start = self.ts.token_start;
        if self.ts.token_type == DELIM {
            match self.ts.char_code_at(self.ts.token_start) {
                ASTERISK | DOLLARSIGN | PLUSSIGN | NUMBERSIGN | AMPERSAND => {
                    self.ts.next();
                }
                SOLIDUS => {
                    self.ts.next();
                    if self.ts.is_delim(SOLIDUS) {
                        self.ts.next();
                    }
                }
                _ => {}
            }
        }
        if self.ts.token_type == HASH {
            self.eat(HASH)?;
        } else {
            self.eat(IDENT)?;
        }
        Ok(self.ts.substr_to_cursor(start))
    }

    fn get_important(&mut self) -> PResult<Important> {
        self.eat(DELIM)?;
        self.ts.skip_sc();
        let important = self.consume(IDENT)?;
        Ok(if important == "important" {
            Important::Yes
        } else {
            Important::Other(important)
        })
    }

    fn declaration(&mut self) -> PResult<Node> {
        let start_token = self.ts.token_index;
        let property = self.read_property()?;
        let custom_property = property.len() >= 2 && property.starts_with("--");
        let parse_value = if custom_property {
            self.parse_custom_property
        } else {
            self.parse_value
        };
        let mut important = Important::No;

        self.ts.skip_sc();
        self.eat(COLON)?;

        let value_start = self.ts.token_index;
        if !custom_property {
            self.ts.skip_sc();
        }

        let mut value = if parse_value {
            self.parse_with_fallback(
                |p| {
                    let start_value_token = p.ts.token_index;
                    let value = p.value()?;
                    if !value.is_raw()
                        && !p.ts.eof
                        && p.ts.token_type != SEMICOLON
                        && !p.ts.is_delim(EXCLAMATIONMARK)
                        && !p.ts.is_balance_edge(start_value_token)
                    {
                        return p.error();
                    }
                    Ok(value)
                },
                |p| {
                    Ok(p.raw(
                        Some(consume_until_exclamation_mark_or_semicolon),
                        !custom_property,
                    ))
                },
            )?
        } else {
            self.raw(
                Some(consume_until_exclamation_mark_or_semicolon),
                !custom_property,
            )
        };

        if custom_property {
            if let Node::Value { children } = &mut value {
                if children.is_empty() {
                    let mut offset = value_start as isize - self.ts.token_index as isize;
                    while offset <= 0 {
                        if self.ts.lookup_type(offset) == WHITESPACE {
                            children.push(Node::WhiteSpace {
                                value: " ".to_string(),
                            });
                            break;
                        }
                        offset += 1;
                    }
                }
            }
        }

        if self.ts.is_delim(EXCLAMATIONMARK) {
            important = self.get_important()?;
            self.ts.skip_sc();
        }

        if !self.ts.eof && self.ts.token_type != SEMICOLON && !self.ts.is_balance_edge(start_token)
        {
            return self.error();
        }

        Ok(Node::Declaration {
            important,
            property,
            value: Box::new(value),
        })
    }
}
