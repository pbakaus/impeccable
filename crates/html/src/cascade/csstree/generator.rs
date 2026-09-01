//! Port of css-tree 3.2.1 `lib/generator/` (`csstree.generate(node)` in the
//! default "safe" mode) for the node types the parser subset produces.
//!
//! The generator emits tokens and inserts a single space between two
//! adjacent tokens only where re-tokenizing would otherwise merge them
//! (`token-before.js` safe pairs). Raw / Combinator / TypeSelector /
//! Operator / UnicodeRange / AnPlusB values are re-tokenized and emitted
//! verbatim (auto-whitespace suppressed inside the chunk).

use super::ast::Node;
use super::strings::{encode_string, encode_url};
use super::tokenizer::*;

const PLUSSIGN: u32 = 0x2B;
const HYPHENMINUS: u32 = 0x2D;
const REVERSESOLIDUS: u32 = 0x5C;

/// token-before.js `code(type, value)`.
fn code(ty: TokenType, value: &str) -> u32 {
    if ty == DELIM {
        let c = value.chars().next().map(|c| c as u32).unwrap_or(0);
        let c = std::cmp::min(c, 0x80) << 6;
        return c << 1;
    }
    (ty as u32) << 1
}

fn code_char(c: char) -> u32 {
    (std::cmp::min(c as u32, 0x80) << 6) << 1
}

/// The `safePairs` set as (prevCode, nextCode) keys.
fn safe_pairs() -> &'static std::collections::HashSet<u64> {
    use once_cell::sync::Lazy;
    static SET: Lazy<std::collections::HashSet<u64>> = Lazy::new(|| {
        #[derive(Clone, Copy)]
        enum K {
            T(TokenType),
            C(char),
        }
        use K::*;
        let pairs: &[(K, K)] = &[
            (T(IDENT), T(IDENT)),
            (T(IDENT), T(FUNCTION)),
            (T(IDENT), T(URL)),
            (T(IDENT), T(BAD_URL)),
            (T(IDENT), C('-')),
            (T(IDENT), T(NUMBER)),
            (T(IDENT), T(PERCENTAGE)),
            (T(IDENT), T(DIMENSION)),
            (T(IDENT), T(CDC)),
            (T(IDENT), T(LEFT_PARENTHESIS)),
            (T(AT_KEYWORD), T(IDENT)),
            (T(AT_KEYWORD), T(FUNCTION)),
            (T(AT_KEYWORD), T(URL)),
            (T(AT_KEYWORD), T(BAD_URL)),
            (T(AT_KEYWORD), C('-')),
            (T(AT_KEYWORD), T(NUMBER)),
            (T(AT_KEYWORD), T(PERCENTAGE)),
            (T(AT_KEYWORD), T(DIMENSION)),
            (T(AT_KEYWORD), T(CDC)),
            (T(HASH), T(IDENT)),
            (T(HASH), T(FUNCTION)),
            (T(HASH), T(URL)),
            (T(HASH), T(BAD_URL)),
            (T(HASH), C('-')),
            (T(HASH), T(NUMBER)),
            (T(HASH), T(PERCENTAGE)),
            (T(HASH), T(DIMENSION)),
            (T(HASH), T(CDC)),
            (T(DIMENSION), T(IDENT)),
            (T(DIMENSION), T(FUNCTION)),
            (T(DIMENSION), T(URL)),
            (T(DIMENSION), T(BAD_URL)),
            (T(DIMENSION), C('-')),
            (T(DIMENSION), T(NUMBER)),
            (T(DIMENSION), T(PERCENTAGE)),
            (T(DIMENSION), T(DIMENSION)),
            (T(DIMENSION), T(CDC)),
            (C('#'), T(IDENT)),
            (C('#'), T(FUNCTION)),
            (C('#'), T(URL)),
            (C('#'), T(BAD_URL)),
            (C('#'), C('-')),
            (C('#'), T(NUMBER)),
            (C('#'), T(PERCENTAGE)),
            (C('#'), T(DIMENSION)),
            (C('#'), T(CDC)),
            (C('-'), T(IDENT)),
            (C('-'), T(FUNCTION)),
            (C('-'), T(URL)),
            (C('-'), T(BAD_URL)),
            (C('-'), C('-')),
            (C('-'), T(NUMBER)),
            (C('-'), T(PERCENTAGE)),
            (C('-'), T(DIMENSION)),
            (C('-'), T(CDC)),
            (T(NUMBER), T(IDENT)),
            (T(NUMBER), T(FUNCTION)),
            (T(NUMBER), T(URL)),
            (T(NUMBER), T(BAD_URL)),
            (T(NUMBER), T(NUMBER)),
            (T(NUMBER), T(PERCENTAGE)),
            (T(NUMBER), T(DIMENSION)),
            (T(NUMBER), C('%')),
            (T(NUMBER), T(CDC)),
            (C('@'), T(IDENT)),
            (C('@'), T(FUNCTION)),
            (C('@'), T(URL)),
            (C('@'), T(BAD_URL)),
            (C('@'), C('-')),
            (C('@'), T(CDC)),
            (C('.'), T(NUMBER)),
            (C('.'), T(PERCENTAGE)),
            (C('.'), T(DIMENSION)),
            (C('+'), T(NUMBER)),
            (C('+'), T(PERCENTAGE)),
            (C('+'), T(DIMENSION)),
            (C('/'), C('*')),
            // safe-mode additions
            (T(IDENT), T(HASH)),
            (T(DIMENSION), T(HASH)),
            (T(HASH), T(HASH)),
            (T(AT_KEYWORD), T(LEFT_PARENTHESIS)),
            (T(AT_KEYWORD), T(STRING)),
            (T(AT_KEYWORD), T(COLON)),
            (T(PERCENTAGE), T(PERCENTAGE)),
            (T(PERCENTAGE), T(DIMENSION)),
            (T(PERCENTAGE), T(FUNCTION)),
            (T(PERCENTAGE), C('-')),
            (T(RIGHT_PARENTHESIS), T(IDENT)),
            (T(RIGHT_PARENTHESIS), T(FUNCTION)),
            (T(RIGHT_PARENTHESIS), T(PERCENTAGE)),
            (T(RIGHT_PARENTHESIS), T(DIMENSION)),
            (T(RIGHT_PARENTHESIS), T(HASH)),
            (T(RIGHT_PARENTHESIS), C('-')),
        ];
        let k = |x: K| -> u32 {
            match x {
                T(t) => (t as u32) << 1,
                C(c) => code_char(c),
            }
        };
        pairs
            .iter()
            .map(|(a, b)| ((k(*a) as u64) << 16) | k(*b) as u64)
            .collect()
    });
    &SET
}

/// token-before.js `safe(prevCode, type, value)`: returns the next code with
/// bit 0 set when a space must be emitted first.
fn token_before_safe(prev_code: u32, ty: TokenType, value: &str) -> u32 {
    let next_code = code(ty, value);
    let next_char_code = value.chars().next().map(|c| c as u32).unwrap_or(0);
    let key = |next: u32| -> u64 { (((prev_code & 0xFFFE) as u64) << 16) | next as u64 };
    let emit_ws = if (next_char_code == HYPHENMINUS && ty != IDENT && ty != FUNCTION && ty != CDC)
        || next_char_code == PLUSSIGN
    {
        safe_pairs().contains(&key(next_char_code << 7))
    } else {
        safe_pairs().contains(&key(next_code))
    };
    next_code | u32::from(emit_ws)
}

pub struct Generator {
    buffer: String,
    prev_code: u32,
}

impl Generator {
    fn token(&mut self, ty: TokenType, value: &str, suppress_auto_white_space: bool) {
        self.prev_code = token_before_safe(self.prev_code, ty, value);
        if !suppress_auto_white_space && (self.prev_code & 1) != 0 {
            self.buffer.push(' ');
        }
        self.buffer.push_str(value);
        if ty == DELIM && value.chars().next().map(|c| c as u32) == Some(REVERSESOLIDUS) {
            self.buffer.push('\n');
        }
    }

    fn tok(&mut self, ty: TokenType, value: &str) {
        self.token(ty, value, false);
    }

    /// `this.tokenize(raw)`: re-tokenize and emit each token verbatim; only
    /// the first may receive auto whitespace.
    fn tokenize(&mut self, raw: &str) {
        let chars: Vec<char> = raw.chars().collect();
        let mut tokens: Vec<(TokenType, usize, usize)> = Vec::new();
        tokenize(&chars, |ty, start, end| tokens.push((ty, start, end)));
        for (ty, start, end) in tokens {
            let value: String = chars[start..end].iter().collect();
            self.token(ty, &value, start != 0);
        }
    }

    fn children(&mut self, children: &[Node]) {
        for c in children {
            self.node(c);
        }
    }

    fn children_with(&mut self, children: &[Node], delimiter: fn(&mut Generator, &Node)) {
        let mut prev: Option<&Node> = None;
        for c in children {
            if let Some(p) = prev {
                delimiter(self, p);
            }
            self.node(c);
            prev = Some(c);
        }
    }

    pub fn node(&mut self, node: &Node) {
        match node {
            Node::StyleSheet { children } => self.children(children),
            Node::Rule { prelude, block } => {
                self.node(prelude);
                self.node(block);
            }
            Node::Atrule {
                name,
                prelude,
                block,
            } => {
                self.tok(AT_KEYWORD, &format!("@{}", name));
                if let Some(p) = prelude {
                    self.node(p);
                }
                match block {
                    Some(b) => self.node(b),
                    None => self.tok(SEMICOLON, ";"),
                }
            }
            Node::Block { children } => {
                self.tok(LEFT_CURLY_BRACKET, "{");
                self.children_with(children, |g, prev| {
                    if matches!(prev, Node::Declaration { .. }) {
                        g.tok(SEMICOLON, ";");
                    }
                });
                self.tok(RIGHT_CURLY_BRACKET, "}");
            }
            Node::Declaration {
                important,
                property,
                value,
            } => {
                self.tok(IDENT, property);
                self.tok(COLON, ":");
                self.node(value);
                match important {
                    super::ast::Important::No => {}
                    super::ast::Important::Yes => {
                        self.tok(DELIM, "!");
                        self.tok(IDENT, "important");
                    }
                    super::ast::Important::Other(s) => {
                        self.tok(DELIM, "!");
                        self.tok(IDENT, s);
                    }
                }
            }
            Node::Raw { value } => self.tokenize(value),
            Node::Comment { value } => self.tok(COMMENT, &format!("/*{}*/", value)),
            Node::Cdo => self.tok(CDO, "<!--"),
            Node::Cdc => self.tok(CDC, "-->"),
            Node::Value { children } => self.children(children),
            Node::WhiteSpace { value } => self.tok(WHITESPACE, value),
            Node::Hash { value } => self.tok(HASH, &format!("#{}", value)),
            Node::Operator { value } => self.tokenize(value),
            Node::Parentheses { children } => {
                self.tok(LEFT_PARENTHESIS, "(");
                self.children(children);
                self.tok(RIGHT_PARENTHESIS, ")");
            }
            Node::Brackets { children } => {
                self.tok(DELIM, "[");
                self.children(children);
                self.tok(DELIM, "]");
            }
            Node::Str { value } => self.tok(STRING, &encode_string(value)),
            Node::Dimension { value, unit } => self.tok(DIMENSION, &format!("{}{}", value, unit)),
            Node::Percentage { value } => self.tok(PERCENTAGE, &format!("{}%", value)),
            Node::Number { value } => self.tok(NUMBER, value),
            Node::Function { name, children } => {
                self.tok(FUNCTION, &format!("{}(", name));
                self.children(children);
                self.tok(RIGHT_PARENTHESIS, ")");
            }
            Node::Url { value } => self.tok(URL, &encode_url(value)),
            Node::Identifier { name } => self.tok(IDENT, name),
            Node::UnicodeRange { value } => self.tokenize(value),
            Node::SelectorList { children } => {
                self.children_with(children, |g, _| g.tok(COMMA, ","));
            }
            Node::Selector { children } => self.children(children),
            Node::TypeSelector { name } => self.tokenize(name),
            Node::ClassSelector { name } => {
                self.tok(DELIM, ".");
                self.tok(IDENT, name);
            }
            Node::IdSelector { name } => {
                // Delim instead of Hash: css-tree's hack to avoid a space
                // between an ident and an id selector in safe mode.
                self.tok(DELIM, &format!("#{}", name));
            }
            Node::AttributeSelector {
                name,
                matcher,
                value,
                flags,
            } => {
                self.tok(DELIM, "[");
                self.node(name);
                if let Some(m) = matcher {
                    self.tokenize(m);
                    if let Some(v) = value {
                        self.node(v);
                    }
                }
                if let Some(f) = flags {
                    self.tok(IDENT, f);
                }
                self.tok(DELIM, "]");
            }
            Node::PseudoClassSelector { name, children } => {
                self.tok(COLON, ":");
                match children {
                    None => self.tok(IDENT, name),
                    Some(c) => {
                        self.tok(FUNCTION, &format!("{}(", name));
                        self.children(c);
                        self.tok(RIGHT_PARENTHESIS, ")");
                    }
                }
            }
            Node::PseudoElementSelector { name, children } => {
                self.tok(COLON, ":");
                self.tok(COLON, ":");
                match children {
                    None => self.tok(IDENT, name),
                    Some(c) => {
                        self.tok(FUNCTION, &format!("{}(", name));
                        self.children(c);
                        self.tok(RIGHT_PARENTHESIS, ")");
                    }
                }
            }
            Node::Combinator { name } => self.tokenize(name),
            Node::NestingSelector => self.tok(DELIM, "&"),
            Node::Nth { nth, selector } => {
                self.node(nth);
                if let Some(s) = selector {
                    self.tok(IDENT, "of");
                    self.node(s);
                }
            }
            Node::AnPlusB { a, b } => {
                if let Some(a) = a.as_deref().filter(|s| !s.is_empty()) {
                    let a_str = match a {
                        "+1" | "1" => "n".to_string(),
                        "-1" => "-n".to_string(),
                        _ => format!("{}n", a),
                    };
                    match b.as_deref().filter(|s| !s.is_empty()) {
                        Some(b) => {
                            let b_str = if b.starts_with('-') || b.starts_with('+') {
                                b.to_string()
                            } else {
                                format!("+{}", b)
                            };
                            self.tokenize(&format!("{}{}", a_str, b_str));
                        }
                        None => self.tokenize(&a_str),
                    }
                } else {
                    // JS `this.tokenize(node.b)`; b is a string here.
                    let b = b.clone().unwrap_or_default();
                    self.tokenize(&b);
                }
            }
        }
    }
}

/// `csstree.generate(node)`.
pub fn generate(node: &Node) -> String {
    let mut g = Generator {
        buffer: String::new(),
        prev_code: 0,
    };
    g.node(node);
    g.buffer
}
