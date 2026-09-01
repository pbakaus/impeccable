//! JS-semantics helpers needed by the group-A checks port (`checks::rules`,
//! `checks::css_scan`, `checks::html_patterns`) that `js.rs` does not carry.
//! Kept in its own file so parallel porting work does not collide.

use crate::js;

/// JS `String.prototype.length`: UTF-16 code units.
pub fn utf16_length(s: &str) -> usize {
    s.chars().map(|c| c.len_utf16()).sum()
}

/// The UTF-16 code-unit index that JS would report for the char starting at
/// byte offset `byte_idx` of `s` (what `RegExp#exec` puts in `.index`).
pub fn utf16_index(s: &str, byte_idx: usize) -> usize {
    utf16_length(&s[..byte_idx.min(s.len())])
}

/// JS `str.slice(0, end)` in UTF-16 code units. A cut through a surrogate
/// pair drops the orphan half (a lone surrogate has no Rust representation).
pub fn slice_utf16_start(s: &str, end: usize) -> String {
    let mut out = String::new();
    let mut units = 0usize;
    for c in s.chars() {
        let n = c.len_utf16();
        if units + n > end {
            break;
        }
        units += n;
        out.push(c);
    }
    out
}

/// Byte offset of the char boundary that is `units` UTF-16 code units after
/// `byte_idx` (clamped to the string end). A boundary inside a surrogate
/// pair rounds up to the end of that char.
pub fn advance_utf16(s: &str, byte_idx: usize, units: usize) -> usize {
    let mut pos = byte_idx;
    let mut left = units;
    for c in s[byte_idx..].chars() {
        if left == 0 {
            break;
        }
        let n = c.len_utf16();
        pos += c.len_utf8();
        left = left.saturating_sub(n);
    }
    pos
}

/// Byte offset of the char boundary that is `units` UTF-16 code units before
/// `byte_idx` (clamped to 0). A boundary inside a surrogate pair rounds down
/// to the start of that char.
pub fn retreat_utf16(s: &str, byte_idx: usize, units: usize) -> usize {
    let mut pos = byte_idx;
    let mut left = units;
    for c in s[..byte_idx].chars().rev() {
        if left == 0 {
            break;
        }
        let n = c.len_utf16();
        pos -= c.len_utf8();
        left = left.saturating_sub(n);
    }
    pos
}

/// JS `value.split(/,(?![^(]*\))/)`: split on commas that are not followed
/// by a `)` before the next `(` (i.e. commas outside parentheses, judged by
/// the lookahead alone, exactly as the JS regex does).
pub fn split_commas_outside_parens(s: &str) -> Vec<&str> {
    let bytes = s.as_bytes();
    let mut parts = Vec::new();
    let mut start = 0usize;
    for (i, &b) in bytes.iter().enumerate() {
        if b != b',' {
            continue;
        }
        // Lookahead `[^(]*\)`: is there a `)` before any `(` after the comma?
        let mut closes_first = false;
        for &c in &bytes[i + 1..] {
            if c == b'(' {
                break;
            }
            if c == b')' {
                closes_first = true;
                break;
            }
        }
        if closes_first {
            continue;
        }
        parts.push(&s[start..i]);
        start = i + 1;
    }
    parts.push(&s[start..]);
    parts
}

/// JS `str.split(/\s+/)` (JS whitespace; keeps the empty leading / trailing
/// pieces JS produces).
pub fn split_ws(s: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut start = 0usize;
    let mut in_ws = false;
    let mut ws_start = 0usize;
    for (i, c) in s.char_indices() {
        if js::is_js_whitespace(c) {
            if !in_ws {
                in_ws = true;
                ws_start = i;
            }
        } else if in_ws {
            in_ws = false;
            parts.push(&s[start..ws_start]);
            start = i;
        }
    }
    if in_ws {
        parts.push(&s[start..ws_start]);
        parts.push("");
    } else {
        parts.push(&s[start..]);
    }
    parts
}

/// JS truthiness of a number.
pub fn num_truthy(n: f64) -> bool {
    n != 0.0 && !n.is_nan()
}

/// JS `\w` (ASCII word character).
pub fn is_word_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

/// JS `String.prototype.lastIndexOf(needle, from)` for a one-byte needle:
/// the last position `<= from` holding `needle`.
pub fn last_index_of_byte(s: &str, needle: u8, from: usize) -> Option<usize> {
    let bytes = s.as_bytes();
    if bytes.is_empty() {
        return None;
    }
    let mut i = from.min(bytes.len() - 1);
    loop {
        if bytes[i] == needle {
            return Some(i);
        }
        if i == 0 {
            return None;
        }
        i -= 1;
    }
}

/// An insertion-ordered string map with JS `Map` semantics: `set` on an
/// existing key updates the value in place, iteration follows first
/// insertion.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct JsMap<V> {
    entries: Vec<(String, V)>,
}

impl<V> JsMap<V> {
    pub fn new() -> Self {
        JsMap {
            entries: Vec::new(),
        }
    }
    pub fn get(&self, key: &str) -> Option<&V> {
        self.entries.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }
    pub fn get_mut(&mut self, key: &str) -> Option<&mut V> {
        self.entries
            .iter_mut()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v)
    }
    pub fn has(&self, key: &str) -> bool {
        self.entries.iter().any(|(k, _)| k == key)
    }
    pub fn set(&mut self, key: &str, value: V) {
        if let Some(slot) = self.entries.iter_mut().find(|(k, _)| k == key) {
            slot.1 = value;
        } else {
            self.entries.push((key.to_string(), value));
        }
    }
    pub fn len(&self) -> usize {
        self.entries.len()
    }
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
    pub fn iter(&self) -> impl Iterator<Item = &(String, V)> {
        self.entries.iter()
    }
    pub fn entries(&self) -> &[(String, V)] {
        &self.entries
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf16_helpers() {
        assert_eq!(utf16_length("a😀b"), 4);
        assert_eq!(utf16_index("a😀b", 5), 3);
        assert_eq!(slice_utf16_start("a😀b", 2), "a");
        assert_eq!(slice_utf16_start("a😀b", 3), "a😀");
        assert_eq!(slice_utf16_start("abc", 60), "abc");
        assert_eq!(advance_utf16("a😀b", 0, 1), 1);
        assert_eq!(advance_utf16("a😀b", 1, 1), 5);
        assert_eq!(retreat_utf16("a😀b", 5, 1), 1);
        assert_eq!(retreat_utf16("a😀b", 5, 3), 0);
    }

    #[test]
    fn split_helpers() {
        assert_eq!(
            split_commas_outside_parens("0 0 4px rgba(1,2,3,.4), 1px 1px red"),
            vec!["0 0 4px rgba(1,2,3,.4)", " 1px 1px red"]
        );
        assert_eq!(split_commas_outside_parens(""), vec![""]);
        assert_eq!(split_commas_outside_parens("a,b,"), vec!["a", "b", ""]);
        assert_eq!(split_ws("a  b"), vec!["a", "b"]);
        assert_eq!(split_ws(" a b "), vec!["", "a", "b", ""]);
        assert_eq!(split_ws(""), vec![""]);
        assert_eq!(split_ws("abc"), vec!["abc"]);
    }

    #[test]
    fn last_index_of() {
        assert_eq!(last_index_of_byte("a{b{c", b'{', 4), Some(3));
        assert_eq!(last_index_of_byte("a{b{c", b'{', 2), Some(1));
        assert_eq!(last_index_of_byte("a{b{c", b'{', 0), None);
        assert_eq!(last_index_of_byte("", b'{', 0), None);
    }
}
