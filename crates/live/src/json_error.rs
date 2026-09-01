//! V8's `JSON.parse` SyntaxError messages, reproduced by a small scanner so
//! `config_invalid` reports read like Node's. Covers the message shapes V8
//! emits for structural mistakes; anything the scanner cannot classify falls
//! back to the generic `Unexpected token` form.

fn pos_suffix(text: &str, pos: usize) -> String {
    let mut line = 1;
    let mut col = 1;
    for (i, c) in text.char_indices() {
        if i >= pos {
            break;
        }
        if c == '\n' {
            line += 1;
            col = 1;
        } else {
            col += 1;
        }
    }
    format!(
        " in JSON at position {} (line {} column {})",
        pos, line, col
    )
}

fn unexpected_token(text: &str, ch: char) -> String {
    let preview: String = text.chars().take(30).collect();
    format!(
        "Unexpected token '{}', \"{}\" is not valid JSON",
        ch, preview
    )
}

struct Scanner<'a> {
    b: &'a [u8],
    text: &'a str,
    i: usize,
}

const EOF_MSG: &str = "Unexpected end of JSON input";

impl<'a> Scanner<'a> {
    fn ws(&mut self) {
        while self.i < self.b.len() && matches!(self.b[self.i], b' ' | b'\t' | b'\n' | b'\r') {
            self.i += 1;
        }
    }
    fn peek(&self) -> Option<u8> {
        self.b.get(self.i).copied()
    }
    fn ch_at(&self, i: usize) -> char {
        self.text[i..].chars().next().unwrap_or(' ')
    }
    fn value(&mut self) -> Result<(), String> {
        self.ws();
        let Some(c) = self.peek() else {
            return Err(EOF_MSG.to_string());
        };
        match c {
            b'{' => self.object(),
            b'[' => self.array(),
            b'"' => self.string(),
            b't' => self.literal("true"),
            b'f' => self.literal("false"),
            b'n' => self.literal("null"),
            b'-' | b'0'..=b'9' => self.number(),
            _ => Err(unexpected_token(self.text, self.ch_at(self.i))),
        }
    }
    fn literal(&mut self, word: &str) -> Result<(), String> {
        for (k, wb) in word.bytes().enumerate() {
            match self.b.get(self.i + k) {
                None => return Err(EOF_MSG.to_string()),
                Some(&x) if x == wb => {}
                Some(_) => return Err(unexpected_token(self.text, self.ch_at(self.i + k))),
            }
        }
        self.i += word.len();
        Ok(())
    }
    fn number(&mut self) -> Result<(), String> {
        if self.peek() == Some(b'-') {
            self.i += 1;
            if !matches!(self.peek(), Some(b'0'..=b'9')) {
                return Err(format!(
                    "No number after minus sign{}",
                    pos_suffix(self.text, self.i)
                ));
            }
        }
        while matches!(self.peek(), Some(b'0'..=b'9')) {
            self.i += 1;
        }
        if self.peek() == Some(b'.') {
            self.i += 1;
            if !matches!(self.peek(), Some(b'0'..=b'9')) {
                return Err(format!(
                    "Unterminated fractional number{}",
                    pos_suffix(self.text, self.i)
                ));
            }
            while matches!(self.peek(), Some(b'0'..=b'9')) {
                self.i += 1;
            }
        }
        if matches!(self.peek(), Some(b'e') | Some(b'E')) {
            self.i += 1;
            if matches!(self.peek(), Some(b'+') | Some(b'-')) {
                self.i += 1;
            }
            if !matches!(self.peek(), Some(b'0'..=b'9')) {
                return Err(format!(
                    "Exponent part is missing a number{}",
                    pos_suffix(self.text, self.i)
                ));
            }
            while matches!(self.peek(), Some(b'0'..=b'9')) {
                self.i += 1;
            }
        }
        Ok(())
    }
    fn string(&mut self) -> Result<(), String> {
        self.i += 1;
        loop {
            match self.peek() {
                None => {
                    return Err(format!(
                        "Unterminated string{}",
                        pos_suffix(self.text, self.i)
                    ))
                }
                Some(b'"') => {
                    self.i += 1;
                    return Ok(());
                }
                Some(b'\\') => {
                    self.i += 1;
                    match self.peek() {
                        None => {
                            return Err(format!(
                                "Unterminated string{}",
                                pos_suffix(self.text, self.i)
                            ))
                        }
                        Some(b'u') => {
                            for k in 1..=4 {
                                if !self
                                    .b
                                    .get(self.i + k)
                                    .map(|x| x.is_ascii_hexdigit())
                                    .unwrap_or(false)
                                {
                                    return Err(format!(
                                        "Bad Unicode escape{}",
                                        pos_suffix(self.text, self.i + k)
                                    ));
                                }
                            }
                            self.i += 5;
                        }
                        Some(b'"' | b'\\' | b'/' | b'b' | b'f' | b'n' | b'r' | b't') => self.i += 1,
                        Some(_) => {
                            return Err(format!(
                                "Bad escaped character{}",
                                pos_suffix(self.text, self.i)
                            ))
                        }
                    }
                }
                Some(c) if c < 0x20 => {
                    return Err(format!(
                        "Bad control character in string literal{}",
                        pos_suffix(self.text, self.i)
                    ))
                }
                Some(_) => self.i += 1,
            }
        }
    }
    fn array(&mut self) -> Result<(), String> {
        self.i += 1;
        self.ws();
        if self.peek() == Some(b']') {
            self.i += 1;
            return Ok(());
        }
        loop {
            self.value()?;
            self.ws();
            match self.peek() {
                Some(b',') => {
                    self.i += 1;
                    self.ws();
                }
                Some(b']') => {
                    self.i += 1;
                    return Ok(());
                }
                _ => {
                    return Err(format!(
                        "Expected ',' or ']' after array element{}",
                        pos_suffix(self.text, self.i)
                    ))
                }
            }
        }
    }
    fn object(&mut self) -> Result<(), String> {
        self.i += 1;
        self.ws();
        if self.peek() == Some(b'}') {
            self.i += 1;
            return Ok(());
        }
        if self.peek() != Some(b'"') {
            return Err(format!(
                "Expected property name or '}}'{}",
                pos_suffix(self.text, self.i)
            ));
        }
        loop {
            if self.peek() != Some(b'"') {
                return Err(format!(
                    "Expected double-quoted property name{}",
                    pos_suffix(self.text, self.i)
                ));
            }
            self.string()?;
            self.ws();
            if self.peek() != Some(b':') {
                return Err(format!(
                    "Expected ':' after property name{}",
                    pos_suffix(self.text, self.i)
                ));
            }
            self.i += 1;
            self.value()?;
            self.ws();
            match self.peek() {
                Some(b',') => {
                    self.i += 1;
                    self.ws();
                }
                Some(b'}') => {
                    self.i += 1;
                    return Ok(());
                }
                _ => {
                    return Err(format!(
                        "Expected ',' or '}}' after property value{}",
                        pos_suffix(self.text, self.i)
                    ))
                }
            }
        }
    }
}

/// The message `JSON.parse(text)` throws in Node, or None when the text
/// parses.
pub fn json_parse_error(text: &str) -> Option<String> {
    let mut s = Scanner {
        b: text.as_bytes(),
        text,
        i: 0,
    };
    if let Err(e) = s.value() {
        return Some(e);
    }
    s.ws();
    if s.i < s.b.len() {
        return Some(format!(
            "Unexpected non-whitespace character after JSON{}",
            pos_suffix(text, s.i).replacen(" in JSON", "", 1)
        ));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shapes() {
        assert_eq!(
            json_parse_error("{ nope").unwrap(),
            "Expected property name or '}' in JSON at position 2 (line 1 column 3)"
        );
        assert_eq!(
            json_parse_error("[1").unwrap(),
            "Expected ',' or ']' after array element in JSON at position 2 (line 1 column 3)"
        );
        assert_eq!(
            json_parse_error("").unwrap(),
            "Unexpected end of JSON input"
        );
        assert_eq!(
            json_parse_error("[1,]").unwrap(),
            "Unexpected token ']', \"[1,]\" is not valid JSON"
        );
        assert_eq!(
            json_parse_error("{\"a\":1} x").unwrap(),
            "Unexpected non-whitespace character after JSON at position 8 (line 1 column 9)"
        );
        assert!(json_parse_error("{\"a\":[1,2,{\"b\":null}]}").is_none());
    }
}
