//! Port of css-tree `lib/utils/string.js` and `lib/utils/url.js`
//! (decode on parse, encode on generate).

use super::tokenizer::{
    consume_escaped, decode_escaped, is_hex_digit, is_valid_escape, is_white_space,
};

const REVERSE_SOLIDUS: u32 = 0x5C;
const QUOTATION_MARK: u32 = 0x22;
const APOSTROPHE: u32 = 0x27;
const SPACE: u32 = 0x20;
const LEFTPARENTHESIS: u32 = 0x28;
const RIGHTPARENTHESIS: u32 = 0x29;

fn code_at(s: &[char], i: usize) -> u32 {
    if i < s.len() {
        s[i] as u32
    } else {
        0
    }
}

/// Shared body of string/url decode: `[start, end]` inclusive char range.
fn decode_range(s: &[char], start: usize, end: usize, len: usize) -> String {
    let mut decoded = String::new();
    let mut i = start;
    while i <= end && i < len {
        let mut code = s[i] as u32;
        if code == REVERSE_SOLIDUS {
            if i == end {
                // if the next input code point is EOF, do nothing
                // otherwise include last quote as escaped
                if i != len - 1 {
                    decoded = s[i + 1..].iter().collect();
                }
                break;
            }
            i += 1;
            code = code_at(s, i);
            if is_valid_escape(REVERSE_SOLIDUS, code) {
                let escape_start = i - 1;
                let escape_end = consume_escaped(s, escape_start);
                i = escape_end - 1;
                let body: Vec<char> = s[escape_start + 1..escape_end.min(len)].to_vec();
                decoded.push_str(&decode_escaped(&body));
            } else if code == 0x0D && code_at(s, i + 1) == 0x0A {
                i += 1;
            }
        } else {
            decoded.push(s[i]);
        }
        i += 1;
    }
    decoded
}

/// css-tree `string.decode`: strips the quotes and resolves escapes.
pub fn decode_string(str_: &str) -> String {
    let s: Vec<char> = str_.chars().collect();
    let len = s.len();
    if len == 0 {
        return String::new();
    }
    let first = s[0] as u32;
    let start = if first == QUOTATION_MARK || first == APOSTROPHE {
        1
    } else {
        0
    };
    let end = if start == 1 && len > 1 && s[len - 1] as u32 == first {
        len - 2
    } else {
        len - 1
    };
    if end + 1 < start {
        return String::new();
    }
    // JS loops i from start to end inclusive; with start=1,end=len-2 for `""`
    // (len 2) that is 1..=0, an empty loop.
    if start > end {
        return String::new();
    }
    decode_range(&s, start, end, len)
}

/// css-tree `string.encode` (CSSOM serialize-a-string), double quotes.
pub fn encode_string(str_: &str) -> String {
    let mut encoded = String::from("\"");
    let mut ws_before_hex_is_needed = false;
    for ch in str_.chars() {
        let code = ch as u32;
        if code == 0 {
            encoded.push('\u{FFFD}');
            continue;
        }
        if code <= 0x1F || code == 0x7F {
            encoded.push('\\');
            encoded.push_str(&format!("{:x}", code));
            ws_before_hex_is_needed = true;
            continue;
        }
        if code == QUOTATION_MARK || code == REVERSE_SOLIDUS {
            encoded.push('\\');
            encoded.push(ch);
            ws_before_hex_is_needed = false;
        } else {
            if ws_before_hex_is_needed && (is_hex_digit(code) || is_white_space(code)) {
                encoded.push(' ');
            }
            encoded.push(ch);
            ws_before_hex_is_needed = false;
        }
    }
    encoded.push('"');
    encoded
}

/// css-tree `url.decode`: strips `url(` `)` and surrounding whitespace,
/// resolves escapes.
pub fn decode_url(str_: &str) -> String {
    let s: Vec<char> = str_.chars().collect();
    let len = s.len();
    let mut start = 4usize;
    let mut end: isize = if len > 0 && s[len - 1] as u32 == RIGHTPARENTHESIS {
        len as isize - 2
    } else {
        len as isize - 1
    };
    while (start as isize) < end && is_white_space(code_at(&s, start)) {
        start += 1;
    }
    while (start as isize) < end && is_white_space(code_at(&s, end as usize)) {
        end -= 1;
    }
    if end < start as isize {
        return String::new();
    }
    decode_range(&s, start, end as usize, len)
}

/// css-tree `url.encode`.
pub fn encode_url(str_: &str) -> String {
    let mut encoded = String::from("url(");
    let mut ws_before_hex_is_needed = false;
    for ch in str_.chars() {
        let code = ch as u32;
        if code == 0 {
            encoded.push('\u{FFFD}');
            continue;
        }
        if code <= 0x1F || code == 0x7F {
            encoded.push('\\');
            encoded.push_str(&format!("{:x}", code));
            ws_before_hex_is_needed = true;
            continue;
        }
        if code == SPACE
            || code == REVERSE_SOLIDUS
            || code == QUOTATION_MARK
            || code == APOSTROPHE
            || code == LEFTPARENTHESIS
            || code == RIGHTPARENTHESIS
        {
            encoded.push('\\');
            encoded.push(ch);
            ws_before_hex_is_needed = false;
        } else {
            if ws_before_hex_is_needed && is_hex_digit(code) {
                encoded.push(' ');
            }
            encoded.push(ch);
            ws_before_hex_is_needed = false;
        }
    }
    encoded.push(')');
    encoded
}
