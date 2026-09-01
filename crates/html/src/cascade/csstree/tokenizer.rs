//! Port of css-tree 3.2.1 `lib/tokenizer/` (CSS Syntax Level 3 tokenizer,
//! the char-code predicates, and `TokenStream` with its balance table).
//!
//! The JS walks UTF-16 code units; this port walks `char`s. Every predicate
//! treats any code point >= 0x80 the same way (name-start), so token
//! boundaries and the sliced text come out identical for both units.

// ─── Token types (lib/tokenizer/types.js) ───────────────────────────────────

pub type TokenType = u8;

pub const EOF: TokenType = 0;
pub const IDENT: TokenType = 1;
pub const FUNCTION: TokenType = 2;
pub const AT_KEYWORD: TokenType = 3;
pub const HASH: TokenType = 4;
pub const STRING: TokenType = 5;
pub const BAD_STRING: TokenType = 6;
pub const URL: TokenType = 7;
pub const BAD_URL: TokenType = 8;
pub const DELIM: TokenType = 9;
pub const NUMBER: TokenType = 10;
pub const PERCENTAGE: TokenType = 11;
pub const DIMENSION: TokenType = 12;
pub const WHITESPACE: TokenType = 13;
pub const CDO: TokenType = 14;
pub const CDC: TokenType = 15;
pub const COLON: TokenType = 16;
pub const SEMICOLON: TokenType = 17;
pub const COMMA: TokenType = 18;
pub const LEFT_SQUARE_BRACKET: TokenType = 19;
pub const RIGHT_SQUARE_BRACKET: TokenType = 20;
pub const LEFT_PARENTHESIS: TokenType = 21;
pub const RIGHT_PARENTHESIS: TokenType = 22;
pub const LEFT_CURLY_BRACKET: TokenType = 23;
pub const RIGHT_CURLY_BRACKET: TokenType = 24;
pub const COMMENT: TokenType = 25;

// ─── Char code definitions (lib/tokenizer/char-code-definitions.js) ────────

pub fn is_digit(code: u32) -> bool {
    (0x30..=0x39).contains(&code)
}

pub fn is_hex_digit(code: u32) -> bool {
    is_digit(code) || (0x41..=0x46).contains(&code) || (0x61..=0x66).contains(&code)
}

pub fn is_uppercase_letter(code: u32) -> bool {
    (0x41..=0x5A).contains(&code)
}

pub fn is_lowercase_letter(code: u32) -> bool {
    (0x61..=0x7A).contains(&code)
}

pub fn is_letter(code: u32) -> bool {
    is_uppercase_letter(code) || is_lowercase_letter(code)
}

pub fn is_non_ascii(code: u32) -> bool {
    code >= 0x80
}

pub fn is_name_start(code: u32) -> bool {
    is_letter(code) || is_non_ascii(code) || code == 0x5F
}

pub fn is_name(code: u32) -> bool {
    is_name_start(code) || is_digit(code) || code == 0x2D
}

pub fn is_non_printable(code: u32) -> bool {
    code <= 0x08 || code == 0x0B || (0x0E..=0x1F).contains(&code) || code == 0x7F
}

pub fn is_newline(code: u32) -> bool {
    code == 0x0A || code == 0x0D || code == 0x0C
}

pub fn is_white_space(code: u32) -> bool {
    is_newline(code) || code == 0x20 || code == 0x09
}

pub fn is_valid_escape(first: u32, second: u32) -> bool {
    if first != 0x5C {
        return false;
    }
    if is_newline(second) || second == 0 {
        return false;
    }
    true
}

pub fn is_identifier_start(first: u32, second: u32, third: u32) -> bool {
    if first == 0x2D {
        return is_name_start(second) || second == 0x2D || is_valid_escape(second, third);
    }
    if is_name_start(first) {
        return true;
    }
    if first == 0x5C {
        return is_valid_escape(first, second);
    }
    false
}

pub fn is_number_start(first: u32, second: u32, third: u32) -> u32 {
    if first == 0x2B || first == 0x2D {
        if is_digit(second) {
            return 2;
        }
        return if second == 0x2E && is_digit(third) {
            3
        } else {
            0
        };
    }
    if first == 0x2E {
        return if is_digit(second) { 2 } else { 0 };
    }
    if is_digit(first) {
        return 1;
    }
    0
}

pub fn is_bom(code: u32) -> usize {
    if code == 0xFEFF || code == 0xFFFE {
        1
    } else {
        0
    }
}

pub const EOF_CATEGORY: u32 = 0x80;
pub const WHITESPACE_CATEGORY: u32 = 0x82;
pub const DIGIT_CATEGORY: u32 = 0x83;
pub const NAME_START_CATEGORY: u32 = 0x84;
pub const NON_PRINTABLE_CATEGORY: u32 = 0x85;

pub fn char_code_category(code: u32) -> u32 {
    if code >= 0x80 {
        return NAME_START_CATEGORY;
    }
    if is_white_space(code) {
        WHITESPACE_CATEGORY
    } else if is_digit(code) {
        DIGIT_CATEGORY
    } else if is_name_start(code) {
        NAME_START_CATEGORY
    } else if is_non_printable(code) {
        NON_PRINTABLE_CATEGORY
    } else if code != 0 {
        code
    } else {
        EOF_CATEGORY
    }
}

// ─── Utils (lib/tokenizer/utils.js) ─────────────────────────────────────────

/// `source.charCodeAt(offset)` with 0 past the end (and for negative offsets).
pub fn char_at(source: &[char], offset: usize) -> u32 {
    if offset < source.len() {
        source[offset] as u32
    } else {
        0
    }
}

pub fn get_newline_length(source: &[char], offset: usize, code: u32) -> usize {
    if code == 13 && char_at(source, offset + 1) == 10 {
        2
    } else {
        1
    }
}

pub fn cmp_char(source: &[char], offset: usize, reference_code: u32) -> bool {
    // JS `testStr.charCodeAt(offset)` yields NaN past the end, which never
    // equals the reference; 0 does the same job here.
    let mut code = char_at(source, offset);
    if is_uppercase_letter(code) {
        code |= 32;
    }
    code == reference_code
}

pub fn cmp_str(source: &[char], start: usize, end: usize, reference: &str) -> bool {
    let reference: Vec<char> = reference.chars().collect();
    if end < start || end - start != reference.len() {
        return false;
    }
    if end > source.len() {
        return false;
    }
    for i in start..end {
        let reference_code = reference[i - start] as u32;
        let mut test_code = source[i] as u32;
        if is_uppercase_letter(test_code) {
            test_code |= 32;
        }
        if test_code != reference_code {
            return false;
        }
    }
    true
}

pub fn find_white_space_end(source: &[char], mut offset: usize) -> usize {
    while offset < source.len() {
        if !is_white_space(source[offset] as u32) {
            break;
        }
        offset += 1;
    }
    offset
}

pub fn find_decimal_number_end(source: &[char], mut offset: usize) -> usize {
    while offset < source.len() {
        if !is_digit(source[offset] as u32) {
            break;
        }
        offset += 1;
    }
    offset
}

/// § 4.3.7. Consume an escaped code point (offset is at the `\`).
pub fn consume_escaped(source: &[char], mut offset: usize) -> usize {
    offset += 2;
    if is_hex_digit(char_at(source, offset - 1)) {
        let max_offset = std::cmp::min(source.len(), offset + 5);
        while offset < max_offset {
            if !is_hex_digit(char_at(source, offset)) {
                break;
            }
            offset += 1;
        }
        let code = char_at(source, offset);
        if is_white_space(code) {
            offset += get_newline_length(source, offset, code);
        }
    }
    offset
}

/// § 4.3.11. Consume a name.
pub fn consume_name(source: &[char], mut offset: usize) -> usize {
    while offset < source.len() {
        let code = source[offset] as u32;
        if is_name(code) {
            offset += 1;
            continue;
        }
        if is_valid_escape(code, char_at(source, offset + 1)) {
            offset = consume_escaped(source, offset);
            continue;
        }
        break;
    }
    offset
}

/// § 4.3.12. Consume a number.
pub fn consume_number(source: &[char], mut offset: usize) -> usize {
    let mut code = char_at(source, offset);
    if code == 0x2B || code == 0x2D {
        offset += 1;
        code = char_at(source, offset);
    }
    if is_digit(code) {
        offset = find_decimal_number_end(source, offset + 1);
        code = char_at(source, offset);
    }
    if code == 0x2E && is_digit(char_at(source, offset + 1)) {
        offset += 2;
        offset = find_decimal_number_end(source, offset);
    }
    if cmp_char(source, offset, 101) {
        let mut sign = 0;
        code = char_at(source, offset + 1);
        if code == 0x2D || code == 0x2B {
            sign = 1;
            code = char_at(source, offset + 2);
        }
        if is_digit(code) {
            offset = find_decimal_number_end(source, offset + 1 + sign + 1);
        }
    }
    offset
}

/// § 4.3.14. Consume the remnants of a bad url.
pub fn consume_bad_url_remnants(source: &[char], mut offset: usize) -> usize {
    while offset < source.len() {
        let code = source[offset] as u32;
        if code == 0x29 {
            offset += 1;
            break;
        }
        if is_valid_escape(code, char_at(source, offset + 1)) {
            offset = consume_escaped(source, offset);
        }
        offset += 1;
    }
    offset
}

/// § 4.3.7. Decode an escape body (without the leading `\`).
pub fn decode_escaped(escaped: &[char]) -> String {
    if escaped.len() == 1 && !is_hex_digit(escaped[0] as u32) {
        return escaped[0].to_string();
    }
    let hex: String = escaped.iter().collect();
    // JS parseInt(escaped, 16): parses the leading hex digits.
    let digits: String = hex.chars().take_while(|c| c.is_ascii_hexdigit()).collect();
    let mut code: u32 = if digits.is_empty() {
        // NaN: JS then compares NaN === 0 (false), NaN in ranges (false)
        // and String.fromCodePoint(NaN) throws. Unreachable for valid escapes.
        0xFFFD
    } else {
        u32::from_str_radix(&digits, 16).unwrap_or(0xFFFD)
    };
    if code == 0 || (0xD800..=0xDFFF).contains(&code) || code > 0x10FFFF {
        code = 0xFFFD;
    }
    char::from_u32(code).unwrap_or('\u{FFFD}').to_string()
}

// ─── tokenize (lib/tokenizer/index.js) ──────────────────────────────────────

/// Runs the CSS tokenizer over `source`, calling `on_token(type, start, end)`
/// for each token in order.
pub fn tokenize<F: FnMut(TokenType, usize, usize)>(source: &[char], mut on_token: F) {
    let source_length = source.len();
    let get = |offset: usize| char_at(source, offset);
    let mut start = is_bom(get(0));
    let mut offset = start;
    let mut ty: TokenType;

    // § 4.3.3. Consume a numeric token
    let consume_numeric_token = |offset: &mut usize, ty: &mut TokenType| {
        *offset = consume_number(source, *offset);
        if is_identifier_start(get(*offset), get(*offset + 1), get(*offset + 2)) {
            *ty = DIMENSION;
            *offset = consume_name(source, *offset);
            return;
        }
        if get(*offset) == 0x25 {
            *ty = PERCENTAGE;
            *offset += 1;
            return;
        }
        *ty = NUMBER;
    };

    // § 4.3.6. Consume a url token
    let consume_url_token = |offset: &mut usize, ty: &mut TokenType| {
        *ty = URL;
        *offset = find_white_space_end(source, *offset);
        while *offset < source.len() {
            let code = source[*offset] as u32;
            match char_code_category(code) {
                0x29 => {
                    *offset += 1;
                    return;
                }
                WHITESPACE_CATEGORY => {
                    *offset = find_white_space_end(source, *offset);
                    if get(*offset) == 0x29 || *offset >= source.len() {
                        if *offset < source.len() {
                            *offset += 1;
                        }
                        return;
                    }
                    *offset = consume_bad_url_remnants(source, *offset);
                    *ty = BAD_URL;
                    return;
                }
                0x22 | 0x27 | 0x28 | NON_PRINTABLE_CATEGORY => {
                    *offset = consume_bad_url_remnants(source, *offset);
                    *ty = BAD_URL;
                    return;
                }
                0x5C => {
                    if is_valid_escape(code, get(*offset + 1)) {
                        *offset = consume_escaped(source, *offset) - 1;
                    } else {
                        *offset = consume_bad_url_remnants(source, *offset);
                        *ty = BAD_URL;
                        return;
                    }
                }
                _ => {}
            }
            *offset += 1;
        }
    };

    // § 4.3.4. Consume an ident-like token
    let consume_ident_like_token = |offset: &mut usize, ty: &mut TokenType| {
        let name_start_offset = *offset;
        *offset = consume_name(source, *offset);
        if cmp_str(source, name_start_offset, *offset, "url") && get(*offset) == 0x28 {
            *offset = find_white_space_end(source, *offset + 1);
            if get(*offset) == 0x22 || get(*offset) == 0x27 {
                *ty = FUNCTION;
                *offset = name_start_offset + 4;
                return;
            }
            consume_url_token(offset, ty);
            return;
        }
        if get(*offset) == 0x28 {
            *ty = FUNCTION;
            *offset += 1;
            return;
        }
        *ty = IDENT;
    };

    // § 4.3.5. Consume a string token
    let consume_string_token = |offset: &mut usize, ty: &mut TokenType| {
        let ending_code_point = get(*offset);
        *offset += 1;
        *ty = STRING;
        while *offset < source.len() {
            let code = source[*offset] as u32;
            let cat = char_code_category(code);
            if cat == ending_code_point {
                *offset += 1;
                return;
            }
            match cat {
                WHITESPACE_CATEGORY => {
                    if is_newline(code) {
                        *offset += get_newline_length(source, *offset, code);
                        *ty = BAD_STRING;
                        return;
                    }
                }
                0x5C => {
                    if *offset == source.len() - 1 {
                        // If the next input code point is EOF, do nothing.
                    } else {
                        let next_code = get(*offset + 1);
                        if is_newline(next_code) {
                            *offset += get_newline_length(source, *offset + 1, next_code);
                        } else if is_valid_escape(code, next_code) {
                            *offset = consume_escaped(source, *offset) - 1;
                        }
                    }
                }
                _ => {}
            }
            *offset += 1;
        }
    };

    while offset < source_length {
        let code = source[offset] as u32;
        match char_code_category(code) {
            WHITESPACE_CATEGORY => {
                ty = WHITESPACE;
                offset = find_white_space_end(source, offset + 1);
            }
            0x22 => {
                ty = STRING;
                consume_string_token(&mut offset, &mut ty);
            }
            0x23 => {
                if is_name(get(offset + 1)) || is_valid_escape(get(offset + 1), get(offset + 2)) {
                    ty = HASH;
                    offset = consume_name(source, offset + 1);
                } else {
                    ty = DELIM;
                    offset += 1;
                }
            }
            0x27 => {
                ty = STRING;
                consume_string_token(&mut offset, &mut ty);
            }
            0x28 => {
                ty = LEFT_PARENTHESIS;
                offset += 1;
            }
            0x29 => {
                ty = RIGHT_PARENTHESIS;
                offset += 1;
            }
            0x2B => {
                if is_number_start(code, get(offset + 1), get(offset + 2)) != 0 {
                    ty = NUMBER;
                    consume_numeric_token(&mut offset, &mut ty);
                } else {
                    ty = DELIM;
                    offset += 1;
                }
            }
            0x2C => {
                ty = COMMA;
                offset += 1;
            }
            0x2D => {
                if is_number_start(code, get(offset + 1), get(offset + 2)) != 0 {
                    ty = NUMBER;
                    consume_numeric_token(&mut offset, &mut ty);
                } else if get(offset + 1) == 0x2D && get(offset + 2) == 0x3E {
                    ty = CDC;
                    offset += 3;
                } else if is_identifier_start(code, get(offset + 1), get(offset + 2)) {
                    ty = IDENT;
                    consume_ident_like_token(&mut offset, &mut ty);
                } else {
                    ty = DELIM;
                    offset += 1;
                }
            }
            0x2E => {
                if is_number_start(code, get(offset + 1), get(offset + 2)) != 0 {
                    ty = NUMBER;
                    consume_numeric_token(&mut offset, &mut ty);
                } else {
                    ty = DELIM;
                    offset += 1;
                }
            }
            0x2F => {
                if get(offset + 1) == 0x2A {
                    ty = COMMENT;
                    // source.indexOf('*/', offset + 2)
                    let mut found = None;
                    let mut i = offset + 2;
                    while i + 1 < source_length {
                        if source[i] == '*' && source[i + 1] == '/' {
                            found = Some(i);
                            break;
                        }
                        i += 1;
                    }
                    offset = match found {
                        Some(i) => i + 2,
                        None => source_length,
                    };
                } else {
                    ty = DELIM;
                    offset += 1;
                }
            }
            0x3A => {
                ty = COLON;
                offset += 1;
            }
            0x3B => {
                ty = SEMICOLON;
                offset += 1;
            }
            0x3C => {
                if get(offset + 1) == 0x21 && get(offset + 2) == 0x2D && get(offset + 3) == 0x2D {
                    ty = CDO;
                    offset += 4;
                } else {
                    ty = DELIM;
                    offset += 1;
                }
            }
            0x40 => {
                if is_identifier_start(get(offset + 1), get(offset + 2), get(offset + 3)) {
                    ty = AT_KEYWORD;
                    offset = consume_name(source, offset + 1);
                } else {
                    ty = DELIM;
                    offset += 1;
                }
            }
            0x5B => {
                ty = LEFT_SQUARE_BRACKET;
                offset += 1;
            }
            0x5C => {
                if is_valid_escape(code, get(offset + 1)) {
                    ty = IDENT;
                    consume_ident_like_token(&mut offset, &mut ty);
                } else {
                    ty = DELIM;
                    offset += 1;
                }
            }
            0x5D => {
                ty = RIGHT_SQUARE_BRACKET;
                offset += 1;
            }
            0x7B => {
                ty = LEFT_CURLY_BRACKET;
                offset += 1;
            }
            0x7D => {
                ty = RIGHT_CURLY_BRACKET;
                offset += 1;
            }
            DIGIT_CATEGORY => {
                ty = NUMBER;
                consume_numeric_token(&mut offset, &mut ty);
            }
            NAME_START_CATEGORY => {
                ty = IDENT;
                consume_ident_like_token(&mut offset, &mut ty);
            }
            _ => {
                ty = DELIM;
                offset += 1;
            }
        }
        on_token(ty, start, offset);
        start = offset;
    }
}

// ─── TokenStream (lib/tokenizer/TokenStream.js) ─────────────────────────────

const BLOCK_OPEN_TOKEN: u8 = 1;
const BLOCK_CLOSE_TOKEN: u8 = 2;

fn balance_pair(ty: TokenType) -> TokenType {
    match ty {
        FUNCTION | LEFT_PARENTHESIS => RIGHT_PARENTHESIS,
        LEFT_SQUARE_BRACKET => RIGHT_SQUARE_BRACKET,
        LEFT_CURLY_BRACKET => RIGHT_CURLY_BRACKET,
        _ => 0,
    }
}

fn block_token(ty: TokenType) -> u8 {
    match ty {
        FUNCTION | LEFT_PARENTHESIS | LEFT_SQUARE_BRACKET | LEFT_CURLY_BRACKET => BLOCK_OPEN_TOKEN,
        RIGHT_PARENTHESIS | RIGHT_SQUARE_BRACKET | RIGHT_CURLY_BRACKET => BLOCK_CLOSE_TOKEN,
        _ => 0,
    }
}

pub fn is_block_opener_token_type(ty: TokenType) -> bool {
    block_token(ty) == BLOCK_OPEN_TOKEN
}

pub fn is_block_closer_token_type(ty: TokenType) -> bool {
    block_token(ty) == BLOCK_CLOSE_TOKEN
}

/// The tokenized source with css-tree's cursor and balance table.
pub struct TokenStream {
    pub source: Vec<char>,
    pub first_char_offset: usize,
    pub token_count: usize,
    types: Vec<TokenType>,
    ends: Vec<usize>,
    pub balance: Vec<usize>,
    pub eof: bool,
    pub token_index: usize,
    pub token_type: TokenType,
    pub token_start: usize,
    pub token_end: usize,
}

impl TokenStream {
    pub fn new(source: &str) -> TokenStream {
        let source: Vec<char> = source.chars().collect();
        let source_length = source.len();
        let mut types: Vec<TokenType> = Vec::with_capacity(source_length + 1);
        let mut ends: Vec<usize> = Vec::with_capacity(source_length + 1);
        // JS: Uint32Array(source.length + 1), zero-filled; indexed by token
        // index, and by `balanceStart` which starts at source.length.
        let mut balance: Vec<usize> = vec![0; source_length + 1];
        let mut token_count = 0usize;
        let mut first_char_offset: Option<usize> = None;
        let mut balance_close_type: TokenType = 0;
        let mut balance_start = source_length;

        tokenize(&source, |ty, start, end| {
            let index = token_count;
            token_count += 1;
            types.push(ty);
            ends.push(end);
            if first_char_offset.is_none() {
                first_char_offset = Some(start);
            }
            balance[index] = balance_start;
            if ty == balance_close_type {
                let prev_balance_start = balance[balance_start];
                balance[balance_start] = index;
                balance_start = prev_balance_start;
                balance_close_type = if prev_balance_start < types.len() {
                    balance_pair(types[prev_balance_start])
                } else {
                    // JS reads offsetAndType[prevBalanceStart] >> 24 which is
                    // 0 for an unwritten slot: no close type.
                    0
                };
            } else if is_block_opener_token_type(ty) {
                balance_start = index;
                balance_close_type = balance_pair(ty);
            }
        });

        types.push(EOF);
        ends.push(source_length);
        balance[token_count] = token_count;

        for i in 0..token_count {
            let bs = balance[i];
            if bs <= i {
                let balance_end = balance[bs];
                if balance_end != i {
                    balance[i] = balance_end;
                }
            } else if bs > token_count {
                balance[i] = token_count;
            }
        }

        let mut ts = TokenStream {
            source,
            first_char_offset: first_char_offset.unwrap_or(0),
            token_count,
            types,
            ends,
            balance,
            eof: false,
            token_index: 0,
            token_type: 0,
            token_start: 0,
            token_end: 0,
        };
        ts.reset();
        ts.next();
        ts
    }

    fn reset(&mut self) {
        self.eof = false;
        // JS tokenIndex = -1; we keep it as usize and special-case in next().
        self.token_index = usize::MAX;
        self.token_type = 0;
        self.token_start = self.first_char_offset;
        self.token_end = self.first_char_offset;
    }

    /// JS `offsetAndType[i] & OFFSET_MASK` for i in 0..=tokenCount, i.e. the
    /// end offset of token i (source length for the EOF slot).
    fn raw_end(&self, index: usize) -> usize {
        if index <= self.token_count {
            self.ends[index]
        } else {
            0
        }
    }

    fn raw_type(&self, index: usize) -> TokenType {
        if index <= self.token_count {
            self.types[index]
        } else {
            0
        }
    }

    pub fn lookup_type(&self, offset: isize) -> TokenType {
        let idx = self.token_index as isize + offset;
        if idx >= 0 && (idx as usize) < self.token_count {
            self.types[idx as usize]
        } else {
            EOF
        }
    }

    pub fn lookup_type_non_sc(&self, mut idx: usize) -> TokenType {
        let mut offset = self.token_index;
        while offset < self.token_count {
            let ty = self.types[offset];
            if ty != WHITESPACE && ty != COMMENT {
                if idx == 0 {
                    return ty;
                }
                idx -= 1;
            }
            offset += 1;
        }
        EOF
    }

    pub fn lookup_offset(&self, offset: isize) -> usize {
        let idx = self.token_index as isize + offset;
        if idx >= 0 && (idx as usize) < self.token_count {
            let idx = idx as usize;
            if idx == 0 {
                // JS: offsetAndType[-1] is undefined -> & mask -> 0
                0
            } else {
                self.raw_end(idx - 1)
            }
        } else {
            self.source.len()
        }
    }

    pub fn lookup_value(&self, offset: isize, reference: &str) -> bool {
        let idx = self.token_index as isize + offset;
        if idx >= 0 && (idx as usize) < self.token_count {
            let idx = idx as usize;
            let start = if idx == 0 { 0 } else { self.raw_end(idx - 1) };
            cmp_str(&self.source, start, self.raw_end(idx), reference)
        } else {
            false
        }
    }

    pub fn get_token_start(&self, token_index: usize) -> usize {
        if token_index == self.token_index {
            return self.token_start;
        }
        if token_index > 0 {
            return if token_index < self.token_count {
                self.raw_end(token_index - 1)
            } else {
                self.raw_end(self.token_count)
            };
        }
        self.first_char_offset
    }

    pub fn get_token_end(&self, token_index: usize) -> usize {
        if token_index == self.token_index {
            return self.token_end;
        }
        self.raw_end(std::cmp::min(token_index, self.token_count))
    }

    pub fn get_token_type(&self, token_index: usize) -> TokenType {
        if token_index == self.token_index {
            return self.token_type;
        }
        self.raw_type(std::cmp::min(token_index, self.token_count))
    }

    pub fn substr_to_cursor(&self, start: usize) -> String {
        self.substring(start, self.token_start)
    }

    pub fn substring(&self, start: usize, end: usize) -> String {
        // JS String.prototype.substring: swaps and clamps.
        let len = self.source.len();
        let (mut a, mut b) = (start.min(len), end.min(len));
        if a > b {
            std::mem::swap(&mut a, &mut b);
        }
        self.source[a..b].iter().collect()
    }

    pub fn char_code_at(&self, offset: usize) -> u32 {
        char_at(&self.source, offset)
    }

    pub fn is_balance_edge(&self, token_index: usize) -> bool {
        self.balance[self.token_index.min(self.token_count)] < token_index
    }

    pub fn is_delim(&self, code: u32) -> bool {
        self.token_type == DELIM && self.char_code_at(self.token_start) == code
    }

    pub fn is_delim_at(&self, code: u32, offset: isize) -> bool {
        if offset != 0 {
            return self.lookup_type(offset) == DELIM
                && self.char_code_at(self.lookup_offset(offset)) == code;
        }
        self.is_delim(code)
    }

    /// JS `skip(tokenCount)` (may be negative).
    pub fn skip(&mut self, count: isize) {
        let next = self.token_index as isize + count;
        if next >= 0 && (next as usize) < self.token_count {
            let next = next as usize;
            self.token_index = next;
            self.token_start = if next == 0 { 0 } else { self.raw_end(next - 1) };
            self.token_type = self.types[next];
            self.token_end = self.ends[next];
        } else {
            self.token_index = self.token_count;
            self.next();
        }
    }

    /// Move the cursor to an absolute token index.
    pub fn seek(&mut self, index: usize) {
        let delta = index as isize - self.token_index as isize;
        self.skip(delta);
    }

    pub fn next(&mut self) {
        let next = self.token_index.wrapping_add(1);
        if next < self.token_count {
            self.token_index = next;
            self.token_start = self.token_end;
            self.token_type = self.types[next];
            self.token_end = self.ends[next];
        } else {
            self.eof = true;
            self.token_index = self.token_count;
            self.token_type = EOF;
            self.token_start = self.source.len();
            self.token_end = self.source.len();
        }
    }

    pub fn skip_sc(&mut self) {
        while self.token_type == WHITESPACE || self.token_type == COMMENT {
            self.next();
        }
    }

    /// JS `skipUntilBalanced(startToken, stopConsume)`; `stop_consume` gets
    /// the char code at each token start and returns 0 (continue), 1 (stop
    /// before) or 2 (stop after).
    pub fn skip_until_balanced<F: Fn(u32) -> u8>(&mut self, start_token: usize, stop_consume: F) {
        let mut cursor = start_token;
        while cursor < self.token_count {
            let balance_end = self.balance[cursor];
            if balance_end < start_token {
                break;
            }
            let offset = if cursor > 0 {
                self.raw_end(cursor - 1)
            } else {
                self.first_char_offset
            };
            match stop_consume(self.char_code_at(offset)) {
                1 => break,
                2 => {
                    cursor += 1;
                    break;
                }
                _ => {
                    if is_block_opener_token_type(self.types[cursor]) {
                        cursor = balance_end;
                    }
                }
            }
            cursor += 1;
        }
        let delta = cursor as isize - self.token_index as isize;
        self.skip(delta);
    }
}
