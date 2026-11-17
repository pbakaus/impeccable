//! Text measures shared by the prompts (moved from impeccable-skills).

/// `str.length` in UTF-16 code units.
pub fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}
