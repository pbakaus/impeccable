//! JS number semantics the comp libs rely on, reimplemented locally so the
//! crate stays self-contained (no dependency on the closed `core::js`).
//!
//! Only the handful the ported modules actually use: `Math.round`, the
//! `Uint8Array` store (`ToUint8`), `Number.prototype.toFixed`, the
//! `+x.toFixed(n)` round-trip, and the `#rrggbb` hex builder.

/// JS `Math.round`: round half toward +Infinity. `(x + 0.5).floor()` matches it
/// for negatives too (`Math.round(-0.5) === 0`, `Math.round(-1.5) === -1`).
#[inline]
pub fn round(x: f64) -> f64 {
    (x + 0.5).floor()
}

/// Storing an f64 into a `Uint8Array`: `ToUint8` = truncate toward zero then
/// modulo 256 (wrapping, unlike Rust's saturating `as u8`).
#[inline]
pub fn u8w(x: f64) -> u8 {
    if !x.is_finite() {
        return 0;
    }
    (x.trunc() as i64).rem_euclid(256) as u8
}

/// `Number.prototype.toFixed(digits)` for a finite non-negative-or-negative
/// value. Ported byte-for-byte from the engine's `core::js::to_fixed` so the
/// rounding (exact decimal expansion of the double, half-up on the remainder)
/// is identical.
pub fn to_fixed(v: f64, digits: usize) -> String {
    if !v.is_finite() {
        return format!("{v}");
    }
    if v.abs() >= 1e21 {
        return format!("{v}");
    }
    if v < 0.0 {
        return format!("-{}", to_fixed(-v, digits));
    }
    let exact = format!("{:.1100}", v.abs());
    let (int_part, frac_part) = exact.split_once('.').expect("fixed form");
    let keep = &frac_part[..digits];
    let rest = &frac_part[digits..];
    let round_up = matches!(rest.as_bytes().first(), Some(&c) if c >= b'5');
    let mut buf: Vec<u8> = format!("{int_part}{keep}").into_bytes();
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

/// JS `+value.toFixed(digits)`: round to `digits` decimals, back to a number.
#[inline]
pub fn round_fixed(v: f64, digits: usize) -> f64 {
    to_fixed(v, digits).parse::<f64>().unwrap_or(v)
}

/// JS `'#' + rgb.map(v => clamp(round(v)).toString(16).padStart(2,'0'))`.
pub fn to_hex(rgb: [f64; 3]) -> String {
    let mut s = String::from("#");
    for v in rgb {
        let byte = round(v).max(0.0).min(255.0) as u32;
        s.push_str(&format!("{byte:02x}"));
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_matches_js() {
        assert_eq!(round(2.5), 3.0);
        assert_eq!(round(-0.5), 0.0);
        assert_eq!(round(-1.5), -1.0);
        assert_eq!(round(0.4999), 0.0);
    }

    #[test]
    fn u8_wraps() {
        assert_eq!(u8w(254.9), 254);
        assert_eq!(u8w(256.0), 0);
        assert_eq!(u8w(255.0), 255);
    }

    #[test]
    fn to_fixed_matches_js() {
        assert_eq!(to_fixed(0.12345, 4), "0.1235");
        assert_eq!(to_fixed(1.005, 2), "1.00"); // the classic double quirk
        assert_eq!(to_fixed(42.0, 1), "42.0");
        assert_eq!(round_fixed(0.68515, 4), 0.6852);
    }

    #[test]
    fn hex_matches_js() {
        assert_eq!(to_hex([247.0, 232.0, 232.0]), "#f7e8e8");
        assert_eq!(to_hex([16.0, 32.0, 48.0]), "#102030");
    }
}
