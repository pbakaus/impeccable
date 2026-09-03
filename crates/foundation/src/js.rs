//! JavaScript semantics helpers shared by the whole port.
//!
//! Everything here reproduces ECMAScript / V8 behavior bit for bit so that
//! numbers, strings, and math results the JS engine would have produced come
//! out identical from the Rust side. Nothing in this module touches I/O.

// ─── Whitespace and string helpers ──────────────────────────────────────────

/// The characters JS `String.prototype.trim` and the regex `\s` class treat as
/// whitespace: ECMA-262 WhiteSpace (TAB, VT, FF, SP, NBSP, ZWNBSP, and the
/// Unicode `Zs` category) plus LineTerminator (LF, CR, LS, PS).
pub fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\u{0009}'
            | '\u{000A}'
            | '\u{000B}'
            | '\u{000C}'
            | '\u{000D}'
            | '\u{0020}'
            | '\u{00A0}'
            | '\u{1680}'
            | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

/// The body of a regex character class matching exactly the JS `\s` set, for
/// splicing into `regex` crate patterns (whose `\s` is Unicode White_Space and
/// differs at U+0085 and U+FEFF).
pub const WS_CHARS: &str = r"\t\n\x0B\x0C\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}";

/// A regex class equal to JS `\s`.
pub const WS: &str = r"[\t\n\x0B\x0C\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]";

/// JS `String.prototype.trim`.
pub fn trim(s: &str) -> &str {
    s.trim_matches(is_js_whitespace)
}

/// JS `String.prototype.trimStart`.
pub fn trim_start(s: &str) -> &str {
    s.trim_start_matches(is_js_whitespace)
}

/// JS `String.prototype.toLowerCase` (Unicode default full case mapping;
/// Rust's `to_lowercase` implements the same mapping including final sigma).
pub fn to_lower_case(s: &str) -> String {
    s.to_lowercase()
}

/// JS `String.prototype.toUpperCase`.
pub fn to_upper_case(s: &str) -> String {
    s.to_uppercase()
}

/// Expand an ASCII keyword into a case-insensitive regex fragment
/// (`oklch` -> `[oO][kK][lL][cC][hH]`). JS non-unicode `/i` never lets a
/// non-ASCII character match an ASCII one, so this is exactly its behavior
/// for ASCII literals, unlike the regex crate's Unicode case folding.
pub fn ci(word: &str) -> String {
    let mut out = String::with_capacity(word.len() * 4);
    for c in word.chars() {
        if c.is_ascii_alphabetic() {
            out.push('[');
            out.push(c.to_ascii_lowercase());
            out.push(c.to_ascii_uppercase());
            out.push(']');
        } else {
            out.push_str(&regex::escape(&c.to_string()));
        }
    }
    out
}

// ─── Number -> string ───────────────────────────────────────────────────────

/// Shortest round-trip decimal digits of a positive finite f64, as
/// (digits, n) where value = 0.d1d2..dk × 10^n, i.e. ECMA-262's (s, k, n)
/// with `digits.len() == k`.
fn shortest_digits(v: f64) -> (String, i32) {
    debug_assert!(v.is_finite() && v > 0.0);
    // Rust's `{:e}` is the shortest representation that round-trips.
    let s = format!("{:e}", v);
    let (mant, exp) = s.split_once('e').expect("exp form");
    let exp: i32 = exp.parse().expect("exp int");
    let mut digits: String = mant.chars().filter(|c| *c != '.').collect();
    // ECMA-262 Number::toString: when two shortest candidates are equally
    // close to x, choose the even one. Rust picks the upper one. A tie means
    // the exact expansion of x has exactly k+1 significant digits ending in
    // 5; check cheaply at 21 digits, then confirm on the exact expansion.
    let k = digits.len();
    if k < 17 {
        let probe = exact_sig_digits(v, 20);
        if probe.len() == k + 1 && probe.ends_with('5') {
            let exact = exact_sig_digits(v, 1100);
            if exact.len() == k + 1 && exact.ends_with('5') {
                let lower = &exact[..k];
                let last = lower.as_bytes()[k - 1] - b'0';
                if last % 2 == 0 {
                    digits = lower.to_string();
                } else {
                    let mut up = lower.as_bytes().to_vec();
                    let mut i = k;
                    loop {
                        if i == 0 {
                            up.insert(0, b'1');
                            break;
                        }
                        i -= 1;
                        if up[i] == b'9' {
                            up[i] = b'0';
                        } else {
                            up[i] += 1;
                            break;
                        }
                    }
                    let mut up = String::from_utf8(up).unwrap();
                    while up.len() > 1 && up.ends_with('0') {
                        up.pop();
                    }
                    digits = up;
                }
            }
        }
    }
    // mant is d.ddd × 10^exp = 0.dddd × 10^(exp+1)
    (digits, exp + 1)
}

/// Significant digits of `v` rounded (half-even) to `prec + 1` digits, with
/// trailing zeros removed. `prec = 1100` yields the exact expansion.
fn exact_sig_digits(v: f64, prec: usize) -> String {
    let s = format!("{:.*e}", prec, v);
    let (mant, _) = s.split_once('e').expect("exp form");
    let mut digits: String = mant.chars().filter(|c| *c != '.').collect();
    while digits.len() > 1 && digits.ends_with('0') {
        digits.pop();
    }
    digits
}

/// JS `Number.prototype.toString()` (radix 10), per ECMA-262 Number::toString.
pub fn number_to_string(v: f64) -> String {
    if v.is_nan() {
        return "NaN".to_string();
    }
    if v == 0.0 {
        return "0".to_string();
    }
    if v.is_infinite() {
        return if v > 0.0 {
            "Infinity".to_string()
        } else {
            "-Infinity".to_string()
        };
    }
    if v < 0.0 {
        return format!("-{}", number_to_string(-v));
    }
    let (digits, n) = shortest_digits(v);
    let k = digits.len() as i32;
    if k <= n && n <= 21 {
        let mut out = digits;
        for _ in 0..(n - k) {
            out.push('0');
        }
        return out;
    }
    if 0 < n && n <= 21 {
        let (a, b) = digits.split_at(n as usize);
        return format!("{}.{}", a, b);
    }
    if -6 < n && n <= 0 {
        let mut out = String::from("0.");
        for _ in 0..(-n) {
            out.push('0');
        }
        out.push_str(&digits);
        return out;
    }
    let e = n - 1;
    let sign = if e < 0 { '-' } else { '+' };
    if k == 1 {
        return format!("{}e{}{}", digits, sign, e.abs());
    }
    let (a, b) = digits.split_at(1);
    format!("{}.{}e{}{}", a, b, sign, e.abs())
}

/// The next representable double above `v` (for positive finite `v`).
fn next_double(v: f64) -> f64 {
    if v.is_nan() || v == f64::INFINITY {
        return v;
    }
    if v == 0.0 {
        return f64::from_bits(1);
    }
    let bits = v.to_bits();
    if v > 0.0 {
        f64::from_bits(bits + 1)
    } else {
        f64::from_bits(bits - 1)
    }
}

/// Unbiased exponent of the double's integer-mantissa form (V8 `Double::Exponent`).
fn double_exponent(v: f64) -> i32 {
    let bits = v.to_bits();
    let biased = ((bits >> 52) & 0x7ff) as i32;
    if biased == 0 {
        // Denormal
        return -1074;
    }
    biased - 1075
}

/// JS `Number.prototype.toString(radix)` for radix 2..36 (V8's
/// `DoubleToRadixCString`). Radix 10 delegates to [`number_to_string`].
pub fn number_to_string_radix(value: f64, radix: u32) -> String {
    if radix == 10 {
        return number_to_string(value);
    }
    if value.is_nan() {
        return "NaN".to_string();
    }
    if value == 0.0 {
        return "0".to_string();
    }
    if value.is_infinite() {
        return if value > 0.0 {
            "Infinity".to_string()
        } else {
            "-Infinity".to_string()
        };
    }
    const CHARS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let radix_f = radix as f64;
    let negative = value < 0.0;
    let value = if negative { -value } else { value };
    let mut integer = value.floor();
    let mut fraction = value - integer;
    let mut delta = 0.5 * (next_double(value) - value);
    delta = delta.max(next_double(0.0));
    let mut frac_digits: Vec<u8> = Vec::new();
    if fraction >= delta {
        loop {
            fraction *= radix_f;
            delta *= radix_f;
            let digit = fraction as i32;
            frac_digits.push(CHARS[digit as usize]);
            fraction -= digit as f64;
            if fraction > 0.5 || (fraction == 0.5 && (digit & 1) == 1) {
                if fraction + delta > 1.0 {
                    // Carry over into already written digits.
                    loop {
                        match frac_digits.pop() {
                            None => {
                                integer += 1.0;
                                break;
                            }
                            Some(c) => {
                                let d = if c > b'9' {
                                    (c - b'a') as u32 + 10
                                } else {
                                    (c - b'0') as u32
                                };
                                if d + 1 < radix {
                                    frac_digits.push(CHARS[(d + 1) as usize]);
                                    break;
                                }
                            }
                        }
                    }
                    break;
                }
            }
            if !(fraction >= delta) {
                break;
            }
        }
    }
    // Integer digits, filling unrepresented low digits with zero.
    let mut int_digits: Vec<u8> = Vec::new();
    while double_exponent(integer / radix_f) > 0 {
        integer /= radix_f;
        int_digits.push(b'0');
    }
    loop {
        let remainder = integer % radix_f;
        int_digits.push(CHARS[remainder as usize]);
        integer = (integer - remainder) / radix_f;
        if !(integer > 0.0) {
            break;
        }
    }
    let mut out = String::new();
    if negative {
        out.push('-');
    }
    for &c in int_digits.iter().rev() {
        out.push(c as char);
    }
    if !frac_digits.is_empty() {
        out.push('.');
        for &c in &frac_digits {
            out.push(c as char);
        }
    }
    out
}

/// JS `Number.prototype.toFixed(digits)`: rounds the exact decimal expansion
/// half-up (ties pick the larger n), unlike Rust's ties-to-even formatting.
pub fn to_fixed(v: f64, digits: usize) -> String {
    if !v.is_finite() {
        return number_to_string(v);
    }
    if v.abs() >= 1e21 {
        return number_to_string(v);
    }
    if v < 0.0 {
        return format!("-{}", to_fixed(-v, digits));
    }
    // Exact decimal expansion of the double (a double has at most 1074
    // fractional digits, so 1100 places is exact with trailing zeros).
    let exact = format!("{:.1100}", v.abs());
    let (int_part, frac_part) = exact.split_once('.').expect("fixed form");
    let keep = &frac_part[..digits];
    let rest = &frac_part[digits..];
    let round_up = match rest.as_bytes().first() {
        None => false,
        Some(&c) => c > b'5' || (c == b'5'), // remainder >= .5 rounds up (half-up)
    };
    let mut buf: Vec<u8> = format!("{}{}", int_part, keep).into_bytes();
    if round_up {
        let mut i = buf.len();
        loop {
            if i == 0 {
                buf.insert(0, b'1');
                break;
            }
            i -= 1;
            if buf[i] == b'9' {
                buf[i] = b'0';
            } else {
                buf[i] += 1;
                break;
            }
        }
    }
    let int_len = buf.len() - digits;
    let mut out = String::from_utf8(buf[..int_len].to_vec()).unwrap();
    if digits > 0 {
        out.push('.');
        out.push_str(std::str::from_utf8(&buf[int_len..]).unwrap());
    }
    out
}

// ─── String -> number ───────────────────────────────────────────────────────

fn scan_decimal_prefix(s: &str) -> Option<(usize, String)> {
    // Returns (byte length consumed, normalized literal for Rust parsing).
    let b = s.as_bytes();
    let mut i = 0;
    let mut norm = String::new();
    if i < b.len() && (b[i] == b'+' || b[i] == b'-') {
        if b[i] == b'-' {
            norm.push('-');
        }
        i += 1;
    }
    if s[i..].starts_with("Infinity") {
        norm.push_str("inf");
        return Some((i + "Infinity".len(), norm));
    }
    let int_start = i;
    while i < b.len() && b[i].is_ascii_digit() {
        i += 1;
    }
    let int_digits = &s[int_start..i];
    let mut frac_digits = "";
    let mut consumed = i;
    if i < b.len() && b[i] == b'.' {
        let fs = i + 1;
        let mut j = fs;
        while j < b.len() && b[j].is_ascii_digit() {
            j += 1;
        }
        frac_digits = &s[fs..j];
        if !int_digits.is_empty() || !frac_digits.is_empty() {
            consumed = j;
        }
    }
    if int_digits.is_empty() && frac_digits.is_empty() {
        return None;
    }
    // Exponent
    let mut exp = String::new();
    if consumed < b.len() && (b[consumed] == b'e' || b[consumed] == b'E') {
        let mut j = consumed + 1;
        let mut e = String::from("e");
        if j < b.len() && (b[j] == b'+' || b[j] == b'-') {
            e.push(b[j] as char);
            j += 1;
        }
        let ds = j;
        while j < b.len() && b[j].is_ascii_digit() {
            j += 1;
        }
        if j > ds {
            e.push_str(&s[ds..j]);
            exp = e;
            consumed = j;
        }
    }
    if int_digits.is_empty() {
        norm.push('0');
    } else {
        norm.push_str(int_digits);
    }
    if !frac_digits.is_empty() {
        norm.push('.');
        norm.push_str(frac_digits);
    }
    norm.push_str(&exp);
    Some((consumed, norm))
}

/// JS global `parseFloat`.
pub fn parse_float(s: &str) -> f64 {
    let t = trim_start(s);
    match scan_decimal_prefix(t) {
        None => f64::NAN,
        Some((_, norm)) => norm.parse::<f64>().unwrap_or(f64::NAN),
    }
}

/// JS `Number(string)` / unary `+` on a string (StringToNumber).
pub fn string_to_number(s: &str) -> f64 {
    let t = trim(s);
    if t.is_empty() {
        return 0.0;
    }
    let lower_prefix = |p: &str| {
        t.len() > 2 && t.as_bytes()[0] == b'0' && (t.as_bytes()[1] | 0x20) == p.as_bytes()[1]
    };
    if lower_prefix("0x") {
        return parse_radix_digits(&t[2..], 16).unwrap_or(f64::NAN);
    }
    if lower_prefix("0o") {
        return parse_radix_digits(&t[2..], 8).unwrap_or(f64::NAN);
    }
    if lower_prefix("0b") {
        return parse_radix_digits(&t[2..], 2).unwrap_or(f64::NAN);
    }
    match scan_decimal_prefix(t) {
        Some((n, norm)) if n == t.len() => norm.parse::<f64>().unwrap_or(f64::NAN),
        _ => f64::NAN,
    }
}

fn parse_radix_digits(s: &str, radix: u32) -> Option<f64> {
    if s.is_empty() {
        return None;
    }
    let mut v = 0.0f64;
    for c in s.chars() {
        let d = c.to_digit(radix)?;
        v = v * radix as f64 + d as f64;
    }
    Some(v)
}

/// JS global `parseInt(string, radix)`. `radix == 0` means "auto" (10, or 16
/// after a `0x` prefix). Returns NaN when no digit can be read.
pub fn parse_int(s: &str, radix: u32) -> f64 {
    let mut t = trim_start(s);
    let mut sign = 1.0;
    if let Some(rest) = t.strip_prefix('-') {
        sign = -1.0;
        t = rest;
    } else if let Some(rest) = t.strip_prefix('+') {
        t = rest;
    }
    let mut r = radix;
    let mut strip_prefix = true;
    if r != 0 {
        if !(2..=36).contains(&r) {
            return f64::NAN;
        }
        if r != 16 {
            strip_prefix = false;
        }
    } else {
        r = 10;
    }
    if strip_prefix && (t.starts_with("0x") || t.starts_with("0X")) {
        t = &t[2..];
        r = 16;
    }
    let end = t
        .chars()
        .take_while(|c| c.to_digit(r).is_some())
        .map(|c| c.len_utf8())
        .sum::<usize>();
    if end == 0 {
        return f64::NAN;
    }
    let digits = &t[..end];
    let v = if r == 10 {
        digits.parse::<f64>().unwrap_or(f64::NAN)
    } else {
        parse_radix_digits(digits, r).unwrap_or(f64::NAN)
    };
    sign * v
}

// ─── Math ───────────────────────────────────────────────────────────────────

/// JS `Math.round`: nearest integer, ties toward +∞, preserving -0.
pub fn math_round(x: f64) -> f64 {
    if !x.is_finite() {
        return x;
    }
    let f = x.floor();
    let diff = x - f;
    let r = if diff >= 0.5 { f + 1.0 } else { f };
    if r == 0.0 && x < 0.0 {
        -0.0
    } else {
        r
    }
}

/// JS `Math.max` over two values (NaN-propagating, +0 beats -0).
pub fn math_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        return f64::NAN;
    }
    if a == 0.0 && b == 0.0 {
        return if a.is_sign_negative() && b.is_sign_negative() {
            -0.0
        } else {
            0.0
        };
    }
    if a > b {
        a
    } else {
        b
    }
}

/// JS `Math.min` over two values (NaN-propagating, -0 beats +0).
pub fn math_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        return f64::NAN;
    }
    if a == 0.0 && b == 0.0 {
        return if a.is_sign_negative() || b.is_sign_negative() {
            -0.0
        } else {
            0.0
        };
    }
    if a < b {
        a
    } else {
        b
    }
}

/// JS `Math.max(a, b, c)`.
pub fn math_max3(a: f64, b: f64, c: f64) -> f64 {
    math_max(math_max(a, b), c)
}

/// JS `Math.min(a, b, c)`.
pub fn math_min3(a: f64, b: f64, c: f64) -> f64 {
    math_min(math_min(a, b), c)
}

/// JS `Math.hypot(...values)` as V8 computes it: scale by the max, Kahan-sum
/// the squares, `sqrt(sum) * max`.
pub fn math_hypot(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mut one_nan = false;
    let mut max = 0.0f64;
    let mut abs: Vec<f64> = Vec::with_capacity(values.len());
    for &v in values {
        if v.is_nan() {
            one_nan = true;
            abs.push(0.0);
        } else {
            let a = v.abs();
            abs.push(a);
            if a > max {
                max = a;
            }
        }
    }
    if max == f64::INFINITY {
        return f64::INFINITY;
    }
    if one_nan {
        return f64::NAN;
    }
    if max == 0.0 {
        return 0.0;
    }
    let mut sum = 0.0f64;
    let mut compensation = 0.0f64;
    for a in abs {
        let n = a / max;
        let summand = n * n - compensation;
        let preliminary = sum + summand;
        compensation = (preliminary - sum) - summand;
        sum = preliminary;
    }
    sum.sqrt() * max
}

/// JS `Math.sin` as V8 computes it in Node: fdlibm `sin` (Node builds V8
/// without `V8_USE_LIBM_TRIG_FUNCTIONS`, so `base::ieee754::sin` is fdlibm).
pub fn math_sin(x: f64) -> f64 {
    crate::fdlibm_trig::fdlibm_sin(x)
}

/// JS `Math.cos` as V8 computes it in Node (see [`math_sin`]).
pub fn math_cos(x: f64) -> f64 {
    crate::fdlibm_trig::fdlibm_cos(x)
}

/// JS `Math.pow` / `**` as V8 computes it (`v8::internal::math::pow` with
/// `--use-std-math-pow`, the default): the ECMAScript special cases, then
/// `std::pow` from the platform libm, which is what `f64::powf` calls.
pub fn math_pow(x: f64, y: f64) -> f64 {
    if y.is_nan() {
        return f64::NAN;
    }
    if y.is_infinite() && (x == 1.0 || x == -1.0) {
        return f64::NAN;
    }
    if y == 2.0 {
        return x * x;
    }
    if y == 0.5 {
        if x.is_infinite() {
            return f64::INFINITY;
        }
        return (x + 0.0).sqrt();
    }
    x.powf(y)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn number_to_string_cases() {
        assert_eq!(number_to_string(0.1 + 0.2), "0.30000000000000004");
        assert_eq!(number_to_string(1e21), "1e+21");
        assert_eq!(
            number_to_string(123456789012345680000.0),
            "123456789012345680000"
        );
        assert_eq!(number_to_string(5e-7), "5e-7");
        assert_eq!(number_to_string(0.000001), "0.000001");
        assert_eq!(number_to_string(-0.0), "0");
        assert_eq!(number_to_string(f64::NAN), "NaN");
        assert_eq!(number_to_string(f64::INFINITY), "Infinity");
        assert_eq!(number_to_string(f64::NEG_INFINITY), "-Infinity");
        assert_eq!(number_to_string(1.0), "1");
        assert_eq!(number_to_string(-1.5), "-1.5");
        assert_eq!(
            number_to_string(1.7976931348623157e308),
            "1.7976931348623157e+308"
        );
        assert_eq!(number_to_string(5e-324), "5e-324");
        assert_eq!(number_to_string(1234.5678), "1234.5678");
        assert_eq!(number_to_string(1.5e-7), "1.5e-7");
        assert_eq!(number_to_string(100.0), "100");
        assert_eq!(number_to_string(255.0), "255");
        // Shortest-digit ties pick the even candidate (ECMA-262), not the upper.
        assert_eq!(number_to_string(980014115057302.25), "980014115057302.2");
        assert_eq!(number_to_string(896675801537170.25), "896675801537170.2");
        assert_eq!(number_to_string(-980014115057302.25), "-980014115057302.2");
    }

    #[test]
    fn number_to_string_radix_cases() {
        assert_eq!(number_to_string_radix(255.0, 16), "ff");
        assert_eq!(number_to_string_radix(0.0, 16), "0");
        assert_eq!(number_to_string_radix(10.0, 16), "a");
        assert_eq!(number_to_string_radix(255.5, 16), "ff.8");
        assert_eq!(number_to_string_radix(-255.0, 16), "-ff");
        assert_eq!(number_to_string_radix(0.1, 16), "0.1999999999999a");
        assert_eq!(number_to_string_radix(f64::NAN, 16), "NaN");
        assert_eq!(number_to_string_radix(1e21, 16), "3635c9adc5dea00000");
    }

    #[test]
    fn to_fixed_cases() {
        assert_eq!(to_fixed(2.5, 0), "3");
        assert_eq!(to_fixed(1.005, 2), "1.00");
        assert_eq!(to_fixed(1.5, 0), "2");
        assert_eq!(to_fixed(0.5, 0), "1");
        assert_eq!(to_fixed(-2.5, 0), "-3");
        assert_eq!(to_fixed(-0.0001, 2), "-0.00");
        assert_eq!(to_fixed(0.0, 2), "0.00");
        assert_eq!(to_fixed(-0.0, 2), "0.00");
        assert_eq!(to_fixed(1e21, 2), "1e+21");
        assert_eq!(to_fixed(4.35, 1), "4.3");
        assert_eq!(to_fixed(4.45, 1), "4.5");
        assert_eq!(to_fixed(9.995, 2), "9.99");
        assert_eq!(to_fixed(99.5, 0), "100");
        assert_eq!(to_fixed(0.000001, 7), "0.0000010");
        assert_eq!(to_fixed(f64::NAN, 2), "NaN");
        assert_eq!(to_fixed(3.6, 1), "3.6");
        assert_eq!(to_fixed(1.45, 1), "1.4");
        assert_eq!(to_fixed(8.345, 2), "8.35");
    }

    #[test]
    fn parse_float_cases() {
        assert_eq!(parse_float("  1.5abc"), 1.5);
        assert!(parse_float("abc").is_nan());
        assert!(parse_float("").is_nan());
        assert!(parse_float(".").is_nan());
        assert_eq!(parse_float(".5"), 0.5);
        assert_eq!(parse_float("1."), 1.0);
        assert_eq!(parse_float("1e"), 1.0);
        assert_eq!(parse_float("1e3x"), 1000.0);
        assert_eq!(parse_float("-.5"), -0.5);
        assert_eq!(parse_float("1.2.3"), 1.2);
        assert!(parse_float("--5").is_nan());
        assert_eq!(parse_float("Infinityx"), f64::INFINITY);
        assert_eq!(parse_float("-Infinity"), f64::NEG_INFINITY);
        assert_eq!(parse_float("\u{a0}\u{feff}42"), 42.0);
        assert!(parse_float("0x10").is_nan() == false && parse_float("0x10") == 0.0);
        assert_eq!(parse_float("21.5%"), 21.5);
    }

    #[test]
    fn string_to_number_cases() {
        assert_eq!(string_to_number(""), 0.0);
        assert_eq!(string_to_number("  "), 0.0);
        assert_eq!(string_to_number("12"), 12.0);
        assert_eq!(string_to_number("1."), 1.0);
        assert_eq!(string_to_number(".5"), 0.5);
        assert!(string_to_number("1.2.3").is_nan());
        assert!(string_to_number(".").is_nan());
        assert!(string_to_number("1e").is_nan());
        assert_eq!(string_to_number("0x10"), 16.0);
        assert_eq!(string_to_number("-Infinity"), f64::NEG_INFINITY);
        assert_eq!(string_to_number("+.5"), 0.5);
    }

    #[test]
    fn parse_int_cases() {
        assert_eq!(parse_int("ff", 16), 255.0);
        assert_eq!(parse_int("0xff", 16), 255.0);
        assert_eq!(parse_int("0xff", 0), 255.0);
        assert_eq!(parse_int("12px", 10), 12.0);
        assert!(parse_int("px", 10).is_nan());
        assert_eq!(parse_int("-08", 10), -8.0);
        assert!(parse_int("1", 1).is_nan());
        assert_eq!(parse_int("zz", 36), 1295.0);
    }

    #[test]
    fn math_round_cases() {
        assert_eq!(math_round(2.5), 3.0);
        assert_eq!(math_round(-2.5), -2.0);
        assert_eq!(math_round(0.49999999999999994), 0.0);
        assert!(math_round(-0.3).is_sign_negative());
        assert!(math_round(-0.5).is_sign_negative() && math_round(-0.5) == 0.0);
        assert_eq!(math_round(-1e-20), 0.0);
        assert_eq!(math_round(1e300), 1e300);
    }

    #[test]
    fn math_minmax_cases() {
        assert!(math_max(1.0, f64::NAN).is_nan());
        assert!(math_max(-0.0, 0.0).is_sign_positive());
        assert!(math_min(-0.0, 0.0).is_sign_negative());
        assert_eq!(math_max3(1.0, 3.0, 2.0), 3.0);
        assert_eq!(math_min3(1.0, 3.0, 2.0), 1.0);
    }

    #[test]
    fn math_smoke() {
        assert_eq!(math_pow(2.0, 10.0), 1024.0);
        assert_eq!(math_pow(4.0, 0.5), 2.0);
        assert!(math_pow(1.0, f64::INFINITY).is_nan());
        assert_eq!(math_pow(f64::NEG_INFINITY, 0.5), f64::INFINITY);
        assert!(math_pow(-2.0, 0.5).is_nan());
        assert!(math_pow(2.0, f64::NAN).is_nan());
        assert_eq!(math_pow(-0.0, 0.5), 0.0);
        assert!(math_pow(-0.0, 0.5).is_sign_positive());
        assert!((math_pow(0.5, 2.4) - 0.18946457081379978).abs() < 1e-15);
        assert_eq!(math_sin(0.0), 0.0);
        assert_eq!(math_cos(0.0), 1.0);
        assert!((math_sin(std::f64::consts::FRAC_PI_2) - 1.0).abs() < 1e-15);
        assert!((math_cos(std::f64::consts::PI) + 1.0).abs() < 1e-15);
        assert!((math_sin(1e10) - (1e10f64).sin()).abs() < 1e-9);
        assert!((math_cos(1e22) - (1e22f64).cos()).abs() < 1e-9);
        assert_eq!(math_hypot(&[3.0, 4.0]), 5.0);
        assert!(math_pow(-8.0, 1.0 / 3.0).is_nan());
        assert_eq!(math_pow(-2.0, 3.0), -8.0);
    }

    #[test]
    fn trim_cases() {
        assert_eq!(trim("\u{feff} a \u{a0}\n"), "a");
        assert_eq!(trim("\u{85}a"), "\u{85}a");
    }
}

/// Serde helpers that write an `f64` the way `JSON.stringify` does: integral
/// values without a fractional part (`0`, not `0.0`), non-finite as `null`.
pub mod json_number {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    pub fn serialize<S: Serializer>(v: &f64, s: S) -> Result<S::Ok, S::Error> {
        if v.is_finite() && v.fract() == 0.0 && v.abs() < 9.007_199_254_740_992e15 {
            (*v as i64).serialize(s)
        } else {
            v.serialize(s)
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<f64, D::Error> {
        f64::deserialize(d)
    }

    /// Same, for `Option<f64>`.
    pub mod option {
        use serde::{Deserialize, Deserializer, Serialize, Serializer};

        pub fn serialize<S: Serializer>(v: &Option<f64>, s: S) -> Result<S::Ok, S::Error> {
            match v {
                Some(x) => super::serialize(x, s),
                None => Option::<f64>::None.serialize(s),
            }
        }

        pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Option<f64>, D::Error> {
            Option::<f64>::deserialize(d)
        }
    }
}
