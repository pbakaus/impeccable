//! JS-semantics helpers needed by the group-B checks port that `js.rs` does
//! not carry (kept separate so parallel work does not collide).

/// JS `String.prototype.length`: UTF-16 code units, not chars or bytes.
pub fn utf16_len(s: &str) -> usize {
    s.chars().map(|c| c.len_utf16()).sum()
}

/// JS `str.slice(0, end)` in UTF-16 code units. A cut through a surrogate
/// pair yields U+FFFD for the orphan half (what a lossy re-decode of the JS
/// string would give).
pub fn slice_utf16_prefix(s: &str, end: usize) -> String {
    if utf16_len(s) <= end {
        return s.to_string();
    }
    let units: Vec<u16> = s.encode_utf16().take(end).collect();
    String::from_utf16_lossy(&units)
}

/// JS truthiness of a number: `0`, `-0`, and `NaN` are falsy.
pub fn num_truthy(n: f64) -> bool {
    n != 0.0 && !n.is_nan()
}

/// JS `String.prototype.split(sep)` with a regex separator that never
/// matches empty text: the pieces between matches, keeping empty pieces at
/// the ends exactly as JS does.
pub fn split_regex<'a>(re: &regex::Regex, s: &'a str) -> Vec<&'a str> {
    re.split(s).collect()
}

/// JS SameValueZero, the equality `Set` uses (NaN equals NaN, +0 equals -0).
pub fn same_value_zero(a: f64, b: f64) -> bool {
    (a.is_nan() && b.is_nan()) || a == b
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf16_cases() {
        assert_eq!(utf16_len("abc"), 3);
        assert_eq!(utf16_len("a😀"), 3);
        assert_eq!(slice_utf16_prefix("a😀b", 2), "a\u{FFFD}");
        assert_eq!(slice_utf16_prefix("abc", 60), "abc");
        assert_eq!(slice_utf16_prefix("abcd", 2), "ab");
    }
}
