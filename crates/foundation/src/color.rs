//! Port of `cli/engine/shared/color.mjs`.
//!
//! Every function keeps the JS name in its doc comment. Colors are the JS
//! `{ r, g, b, a? }` object: `a` is absent on the `CSS_NAMED_COLORS` entries
//! and present everywhere else, exactly as in the source.

use crate::js::{
    self, ci, math_cos, math_hypot, math_max, math_max3, math_min, math_min3, math_pow, math_round,
    math_sin, number_to_string_radix, parse_float, parse_int, string_to_number, WS,
};
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};

/// The JS color object `{ r, g, b, a? }`.
///
/// `Deserialize` is derived; `Serialize` is written by hand because the JSON
/// shape and the boundary's binary shape differ. In JSON `a` is omitted when
/// absent (the JS object literal had no `a` key) and integral channels print
/// without a fraction. Postcard is not self-describing, so a skipped field or
/// an i64 in an f64 slot would desynchronize the stream: for a non
/// human-readable format every field is written, as an f64.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
pub struct Rgba {
    #[serde(with = "crate::js::json_number")]
    pub r: f64,
    #[serde(with = "crate::js::json_number")]
    pub g: f64,
    #[serde(with = "crate::js::json_number")]
    pub b: f64,
    #[serde(default, with = "crate::js::json_number::option")]
    pub a: Option<f64>,
}

impl Serialize for Rgba {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        if !s.is_human_readable() {
            let mut st = s.serialize_struct("Rgba", 4)?;
            st.serialize_field("r", &self.r)?;
            st.serialize_field("g", &self.g)?;
            st.serialize_field("b", &self.b)?;
            st.serialize_field("a", &self.a)?;
            return st.end();
        }
        struct Num(f64);
        impl Serialize for Num {
            fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
                crate::js::json_number::serialize(&self.0, s)
            }
        }
        let mut st = s.serialize_struct("Rgba", if self.a.is_some() { 4 } else { 3 })?;
        st.serialize_field("r", &Num(self.r))?;
        st.serialize_field("g", &Num(self.g))?;
        st.serialize_field("b", &Num(self.b))?;
        match self.a {
            Some(a) => st.serialize_field("a", &Num(a))?,
            None => st.skip_field("a")?,
        }
        st.end()
    }
}

impl Rgba {
    pub const fn new(r: f64, g: f64, b: f64, a: f64) -> Self {
        Rgba {
            r,
            g,
            b,
            a: Some(a),
        }
    }
    const fn named(r: f64, g: f64, b: f64) -> Self {
        Rgba { r, g, b, a: None }
    }
    /// JS `c.a ?? 1`.
    pub fn alpha_or_one(&self) -> f64 {
        self.a.unwrap_or(1.0)
    }
}

macro_rules! re {
    ($name:ident, $pat:expr) => {
        static $name: Lazy<Regex> = Lazy::new(|| Regex::new(&$pat).expect(stringify!($name)));
    };
}

/// JS `\d` is ASCII only.
const D: &str = "[0-9]";

/// JS `str.match(re)` returning capture groups as `Option<&str>` per group
/// (None where the group did not participate).
fn caps<'a>(re: &Regex, s: &'a str) -> Option<regex::Captures<'a>> {
    re.captures(s)
}

fn grp<'a>(c: &regex::Captures<'a>, i: usize) -> Option<&'a str> {
    c.get(i).map(|m| m.as_str())
}

/// JS `!value` for a string argument: absent or empty is falsy.
fn falsy(s: Option<&str>) -> bool {
    matches!(s, None | Some(""))
}

// ─── isNeutralColor ─────────────────────────────────────────────────────────

re!(
    NEUTRAL_RGB,
    format!(r"rgba?\(({D}+),{WS}*({D}+),{WS}*({D}+)")
);
re!(
    NEUTRAL_OKLCH,
    format!(r"{}\({WS}*[0-9.]+%?{WS}*([0-9.\-]+)", ci("oklch"))
);
re!(
    NEUTRAL_LCH,
    format!(r"{}\({WS}*[0-9.]+%?{WS}*([0-9.\-]+)", ci("lch"))
);
re!(
    NEUTRAL_OKLAB,
    format!(
        r"{}\({WS}*[0-9.]+%?{WS}*([0-9.\-]+){WS}+([0-9.\-]+)",
        ci("oklab")
    )
);
re!(
    NEUTRAL_LAB,
    format!(
        r"{}\({WS}*[0-9.]+%?{WS}*([0-9.\-]+){WS}+([0-9.\-]+)",
        ci("lab")
    )
);
re!(
    NEUTRAL_HSL,
    format!(
        r"{}{}?\({WS}*[0-9.\-]+{WS}*,?{WS}*([0-9.]+)%",
        ci("hsl"),
        ci("a")
    )
);
re!(
    NEUTRAL_HWB,
    format!(
        r"{}\({WS}*[0-9.\-]+{WS}+([0-9.]+)%{WS}+([0-9.]+)%",
        ci("hwb")
    )
);

/// JS `isNeutralColor(color)`.
pub fn is_neutral_color(color: Option<&str>) -> bool {
    if falsy(color) || color == Some("transparent") {
        return true;
    }
    let color = color.unwrap();

    if let Some(m) = caps(&NEUTRAL_RGB, color) {
        let r = string_to_number(grp(&m, 1).unwrap());
        let g = string_to_number(grp(&m, 2).unwrap());
        let b = string_to_number(grp(&m, 3).unwrap());
        return (math_max3(r, g, b) - math_min3(r, g, b)) < 30.0;
    }
    if let Some(m) = caps(&NEUTRAL_OKLCH, color) {
        return parse_float(grp(&m, 1).unwrap()) < 0.02;
    }
    if let Some(m) = caps(&NEUTRAL_LCH, color) {
        return parse_float(grp(&m, 1).unwrap()) < 3.0;
    }
    if let Some(m) = caps(&NEUTRAL_OKLAB, color) {
        let a = parse_float(grp(&m, 1).unwrap());
        let b = parse_float(grp(&m, 2).unwrap());
        return math_hypot(&[a, b]) < 0.02;
    }
    if let Some(m) = caps(&NEUTRAL_LAB, color) {
        let a = parse_float(grp(&m, 1).unwrap());
        let b = parse_float(grp(&m, 2).unwrap());
        return math_hypot(&[a, b]) < 3.0;
    }
    if let Some(m) = caps(&NEUTRAL_HSL, color) {
        return parse_float(grp(&m, 1).unwrap()) < 10.0;
    }
    if let Some(m) = caps(&NEUTRAL_HWB, color) {
        let w = parse_float(grp(&m, 1).unwrap());
        let b = parse_float(grp(&m, 2).unwrap());
        return (1.0 - math_min(100.0, w + b) / 100.0) < 0.1;
    }
    false
}

// ─── parseRgb ───────────────────────────────────────────────────────────────

re!(
    PARSE_RGB,
    format!(r"rgba?\(({D}+),{WS}*({D}+),{WS}*({D}+)(?:,{WS}*([0-9.]+))?\)")
);

/// JS `parseRgb(color)`.
pub fn parse_rgb(color: Option<&str>) -> Option<Rgba> {
    if falsy(color) || color == Some("transparent") {
        return None;
    }
    let m = caps(&PARSE_RGB, color.unwrap())?;
    Some(Rgba {
        r: string_to_number(grp(&m, 1).unwrap()),
        g: string_to_number(grp(&m, 2).unwrap()),
        b: string_to_number(grp(&m, 3).unwrap()),
        a: Some(match grp(&m, 4) {
            Some(a) => string_to_number(a),
            None => 1.0,
        }),
    })
}

// ─── Luminance / contrast ───────────────────────────────────────────────────

/// JS `relativeLuminance({ r, g, b })`.
pub fn relative_luminance(c: &Rgba) -> f64 {
    let lin = |v: f64| {
        let ch = v / 255.0;
        if ch <= 0.03928 {
            ch / 12.92
        } else {
            math_pow((ch + 0.055) / 1.055, 2.4)
        }
    };
    let (rs, gs, bs) = (lin(c.r), lin(c.g), lin(c.b));
    0.2126 * rs + 0.7152 * gs + 0.0722 * bs
}

/// JS `contrastRatio(c1, c2)`.
pub fn contrast_ratio(c1: &Rgba, c2: &Rgba) -> f64 {
    let l1 = relative_luminance(c1);
    let l2 = relative_luminance(c2);
    (math_max(l1, l2) + 0.05) / (math_min(l1, l2) + 0.05)
}

// ─── Color-function token extraction ────────────────────────────────────────

/// JS `COLOR_FUNCTION_NAMES`.
pub const COLOR_FUNCTION_NAMES: &[&str] = &[
    "rgb",
    "rgba",
    "hsl",
    "hsla",
    "hwb",
    "oklch",
    "oklab",
    "lch",
    "lab",
    "color",
    "color-mix",
];

re!(FN_NAME, r"([a-zA-Z][a-zA-Z\-]*)\(".to_string());

/// JS `extractColorFunctionTokens(value)`.
pub fn extract_color_function_tokens(value: Option<&str>) -> Vec<String> {
    let s = value.unwrap_or("");
    let bytes = s.as_bytes();
    let mut tokens = Vec::new();
    let mut last_index = 0usize;
    while last_index <= s.len() {
        let Some(m) = FN_NAME.captures_at(s, last_index) else {
            break;
        };
        let whole = m.get(0).unwrap();
        let name = m.get(1).unwrap().as_str().to_ascii_lowercase();
        if !COLOR_FUNCTION_NAMES.contains(&name.as_str()) {
            last_index = whole.end();
            continue;
        }
        let mut depth = 0i64;
        let mut end: Option<usize> = None;
        let mut i = whole.end() - 1;
        while i < bytes.len() {
            if bytes[i] == b'(' {
                depth += 1;
            } else if bytes[i] == b')' {
                depth -= 1;
                if depth == 0 {
                    end = Some(i);
                    break;
                }
            }
            i += 1;
        }
        let Some(end) = end else { break };
        tokens.push(s[whole.start()..=end].to_string());
        last_index = end + 1;
    }
    tokens
}

// ─── parseGradientColors ────────────────────────────────────────────────────

re!(
    HEX_IN_GRADIENT,
    r"#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?-u:\b)".to_string()
);

/// JS `parseGradientColors(bgImage)`.
pub fn parse_gradient_colors(bg_image: Option<&str>) -> Vec<Rgba> {
    let Some(bg) = bg_image else { return vec![] };
    if bg.is_empty() || !bg.contains("gradient") {
        return vec![];
    }
    let mut colors = Vec::new();
    // Byte-offset spans; JS uses UTF-16 indices from `indexOf`/`matchAll`, but
    // both index the same string so containment is identical.
    let mut token_spans: Vec<(usize, usize)> = Vec::new();
    let mut from = 0usize;
    for token in extract_color_function_tokens(Some(bg)) {
        let Some(rel) = bg.get(from..).and_then(|rest| rest.find(&token)) else {
            break;
        };
        let start = from + rel;
        token_spans.push((start, start + token.len()));
        from = start + token.len();
        if let Some(c) = parse_any_color(Some(&token)) {
            colors.push(c);
        }
    }
    for m in HEX_IN_GRADIENT.captures_iter(bg) {
        // Nested hex inside color-mix is an ingredient, not a stop (issue #578).
        let idx = m.get(0).unwrap().start();
        if token_spans.iter().any(|&(s, e)| idx >= s && idx < e) {
            continue;
        }
        let h = m.get(1).unwrap().as_str();
        if h.len() == 6 {
            colors.push(Rgba::new(
                parse_int(&h[0..2], 16),
                parse_int(&h[2..4], 16),
                parse_int(&h[4..6], 16),
                1.0,
            ));
        } else {
            let hb = h.as_bytes();
            let dbl = |i: usize| parse_int(&format!("{}{}", hb[i] as char, hb[i] as char), 16);
            colors.push(Rgba::new(dbl(0), dbl(1), dbl(2), 1.0));
        }
    }
    colors
}

// ─── Chroma / hue / hex ─────────────────────────────────────────────────────

/// JS `hasChroma(c, threshold = 30)`.
pub fn has_chroma(c: Option<&Rgba>, threshold: Option<f64>) -> bool {
    let Some(c) = c else { return false };
    let threshold = threshold.unwrap_or(30.0);
    (math_max3(c.r, c.g, c.b) - math_min3(c.r, c.g, c.b)) >= threshold
}

/// JS `getHue(c)`.
pub fn get_hue(c: Option<&Rgba>) -> f64 {
    let Some(c) = c else { return 0.0 };
    let r = c.r / 255.0;
    let g = c.g / 255.0;
    let b = c.b / 255.0;
    let max = math_max3(r, g, b);
    let min = math_min3(r, g, b);
    if max == min {
        return 0.0;
    }
    let d = max - min;
    let h = if max == r {
        ((g - b) / d + if g < b { 6.0 } else { 0.0 }) / 6.0
    } else if max == g {
        ((b - r) / d + 2.0) / 6.0
    } else {
        ((r - g) / d + 4.0) / 6.0
    };
    math_round(h * 360.0)
}

/// JS `colorToHex(c)`.
pub fn color_to_hex(c: Option<&Rgba>) -> String {
    let Some(c) = c else { return "?".to_string() };
    let mut out = String::from("#");
    for v in [c.r, c.g, c.b] {
        let s = number_to_string_radix(v, 16);
        // padStart(2, '0') counts UTF-16 units; hex output is ASCII.
        if s.len() < 2 {
            for _ in 0..(2 - s.len()) {
                out.push('0');
            }
        }
        out.push_str(&s);
    }
    out
}

// ─── Color-space conversions ────────────────────────────────────────────────

/// JS `clamp01(x)`.
fn clamp01(x: f64) -> f64 {
    if x.is_finite() {
        math_max(0.0, math_min(1.0, x))
    } else {
        0.0
    }
}

/// JS `encodeSrgbChannel(x)`.
fn encode_srgb_channel(x: f64) -> f64 {
    let c = clamp01(x);
    let v = if c <= 0.0031308 {
        12.92 * c
    } else {
        1.055 * math_pow(c, 1.0 / 2.4) - 0.055
    };
    math_round(v * 255.0)
}

/// JS `decodeSrgbChannel(x)`.
fn decode_srgb_channel(x: f64) -> f64 {
    let c = if x.is_finite() { x } else { 0.0 };
    let sign = if c < 0.0 { -1.0 } else { 1.0 };
    let abs = c.abs();
    sign * if abs <= 0.04045 {
        abs / 12.92
    } else {
        math_pow((abs + 0.055) / 1.055, 2.4)
    }
}

/// JS `linearSrgbToColor(r, g, b, a = 1)`.
fn linear_srgb_to_color(r: f64, g: f64, b: f64) -> Rgba {
    Rgba::new(
        encode_srgb_channel(r),
        encode_srgb_channel(g),
        encode_srgb_channel(b),
        1.0,
    )
}

/// JS `oklabToRgb(L, a, b)`.
pub fn oklab_to_rgb(l: f64, a: f64, b: f64) -> Rgba {
    let l_ = l + 0.3963377774 * a + 0.2158037573 * b;
    let m_ = l - 0.1055613458 * a - 0.0638541728 * b;
    let s_ = l - 0.0894841775 * a - 1.2914855480 * b;
    let lc = l_ * l_ * l_;
    let mc = m_ * m_ * m_;
    let sc = s_ * s_ * s_;
    linear_srgb_to_color(
        4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc,
        -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc,
        -0.0041960863 * lc - 0.7034186147 * mc + 1.7076147010 * sc,
    )
}

/// JS `oklchToRgb(L, C, H)`.
pub fn oklch_to_rgb(l: f64, c: f64, h: f64) -> Rgba {
    let h_rad = (h * std::f64::consts::PI) / 180.0;
    oklab_to_rgb(l, c * math_cos(h_rad), c * math_sin(h_rad))
}

/// JS `labToRgb(L, a, b)`.
pub fn lab_to_rgb(l: f64, a: f64, b: f64) -> Rgba {
    let kappa = 24389.0 / 27.0;
    let epsilon = 216.0 / 24389.0;
    let fy = (l + 16.0) / 116.0;
    let fx = fy + a / 500.0;
    let fz = fy - b / 200.0;
    let invert = |t: f64| {
        if t * t * t > epsilon {
            t * t * t
        } else {
            (116.0 * t - 16.0) / kappa
        }
    };
    let yr = if l > kappa * epsilon {
        math_pow((l + 16.0) / 116.0, 3.0)
    } else {
        l / kappa
    };
    let xn = 0.3457 / 0.3585;
    let zn = (1.0 - 0.3457 - 0.3585) / 0.3585;
    let x = invert(fx) * xn;
    let y = yr;
    let z = invert(fz) * zn;
    linear_srgb_to_color(
        3.1341359569958707 * x - 1.6173863321612538 * y - 0.4906619460083532 * z,
        -0.9787955029120890 * x + 1.9162545672595240 * y + 0.0334427311613195 * z,
        0.0719553798841168 * x - 0.2289768264158322 * y + 1.4053860583241250 * z,
    )
}

/// JS `lchToRgb(L, C, H)`.
pub fn lch_to_rgb(l: f64, c: f64, h: f64) -> Rgba {
    let h_rad = (h * std::f64::consts::PI) / 180.0;
    lab_to_rgb(l, c * math_cos(h_rad), c * math_sin(h_rad))
}

/// JS `colorFunctionToRgb(space, c1, c2, c3)`.
pub fn color_function_to_rgb(space: &str, c1: f64, c2: f64, c3: f64) -> Option<Rgba> {
    match space {
        "srgb" => Some(Rgba::new(
            math_round(clamp01(c1) * 255.0),
            math_round(clamp01(c2) * 255.0),
            math_round(clamp01(c3) * 255.0),
            1.0,
        )),
        "srgb-linear" => Some(linear_srgb_to_color(c1, c2, c3)),
        "display-p3" => {
            let (r, g, b) = (
                decode_srgb_channel(c1),
                decode_srgb_channel(c2),
                decode_srgb_channel(c3),
            );
            Some(linear_srgb_to_color(
                1.2249401762805587 * r - 0.2249404646817506 * g + 0.0000002884022551 * b,
                -0.0420569547096138 * r + 1.0420571661298634 * g - 0.0000002113202247 * b,
                -0.0196375587040044 * r - 0.0786360772174755 * g + 1.0982736359214800 * b,
            ))
        }
        _ => None,
    }
}

/// JS `hslToRgb(h, s, l)`.
pub fn hsl_to_rgb(h: f64, s: f64, l: f64) -> Rgba {
    let h = ((h % 360.0) + 360.0) % 360.0;
    let c = (1.0 - (2.0 * l - 1.0).abs()) * s;
    let x = c * (1.0 - (((h / 60.0) % 2.0) - 1.0).abs());
    let m0 = l - c / 2.0;
    let (r, g, b) = if h < 60.0 {
        (c, x, 0.0)
    } else if h < 120.0 {
        (x, c, 0.0)
    } else if h < 180.0 {
        (0.0, c, x)
    } else if h < 240.0 {
        (0.0, x, c)
    } else if h < 300.0 {
        (x, 0.0, c)
    } else {
        (c, 0.0, x)
    };
    Rgba::new(
        math_round((r + m0) * 255.0),
        math_round((g + m0) * 255.0),
        math_round((b + m0) * 255.0),
        1.0,
    )
}

/// JS `hwbToRgb(h, w, bl)`.
pub fn hwb_to_rgb(h: f64, w: f64, bl: f64) -> Rgba {
    if w + bl >= 1.0 {
        let g = math_round((w / (w + bl)) * 255.0);
        return Rgba::new(g, g, g, 1.0);
    }
    let base = hsl_to_rgb(h, 1.0, 0.5);
    let mix = |c: f64| math_round(((c / 255.0) * (1.0 - w - bl) + w) * 255.0);
    Rgba::new(mix(base.r), mix(base.g), mix(base.b), 1.0)
}

// ─── Named colors ───────────────────────────────────────────────────────────

/// JS `CSS_NAMED_COLORS`, in source order. Entries carry no `a`.
pub const CSS_NAMED_COLORS: &[(&str, Rgba)] = &[
    ("black", Rgba::named(0.0, 0.0, 0.0)),
    ("white", Rgba::named(255.0, 255.0, 255.0)),
    ("gray", Rgba::named(128.0, 128.0, 128.0)),
    ("grey", Rgba::named(128.0, 128.0, 128.0)),
    ("silver", Rgba::named(192.0, 192.0, 192.0)),
    ("dimgray", Rgba::named(105.0, 105.0, 105.0)),
    ("darkgray", Rgba::named(169.0, 169.0, 169.0)),
    ("lightgray", Rgba::named(211.0, 211.0, 211.0)),
    ("gainsboro", Rgba::named(220.0, 220.0, 220.0)),
    ("whitesmoke", Rgba::named(245.0, 245.0, 245.0)),
    ("red", Rgba::named(255.0, 0.0, 0.0)),
    ("crimson", Rgba::named(220.0, 20.0, 60.0)),
    ("tomato", Rgba::named(255.0, 99.0, 71.0)),
    ("coral", Rgba::named(255.0, 127.0, 80.0)),
    ("salmon", Rgba::named(250.0, 128.0, 114.0)),
    ("orange", Rgba::named(255.0, 165.0, 0.0)),
    ("gold", Rgba::named(255.0, 215.0, 0.0)),
    ("yellow", Rgba::named(255.0, 255.0, 0.0)),
    ("olive", Rgba::named(128.0, 128.0, 0.0)),
    ("lime", Rgba::named(0.0, 255.0, 0.0)),
    ("green", Rgba::named(0.0, 128.0, 0.0)),
    ("teal", Rgba::named(0.0, 128.0, 128.0)),
    ("turquoise", Rgba::named(64.0, 224.0, 208.0)),
    ("cyan", Rgba::named(0.0, 255.0, 255.0)),
    ("aqua", Rgba::named(0.0, 255.0, 255.0)),
    ("skyblue", Rgba::named(135.0, 206.0, 235.0)),
    ("dodgerblue", Rgba::named(30.0, 144.0, 255.0)),
    ("blue", Rgba::named(0.0, 0.0, 255.0)),
    ("navy", Rgba::named(0.0, 0.0, 128.0)),
    ("indigo", Rgba::named(75.0, 0.0, 130.0)),
    ("rebeccapurple", Rgba::named(102.0, 51.0, 153.0)),
    ("purple", Rgba::named(128.0, 0.0, 128.0)),
    ("violet", Rgba::named(238.0, 130.0, 238.0)),
    ("orchid", Rgba::named(218.0, 112.0, 214.0)),
    ("magenta", Rgba::named(255.0, 0.0, 255.0)),
    ("fuchsia", Rgba::named(255.0, 0.0, 255.0)),
    ("hotpink", Rgba::named(255.0, 105.0, 180.0)),
    ("pink", Rgba::named(255.0, 192.0, 203.0)),
    ("maroon", Rgba::named(128.0, 0.0, 0.0)),
];

/// Lookup in `CSS_NAMED_COLORS` by (already lowercased) name.
pub fn named_color(name: &str) -> Option<&'static Rgba> {
    CSS_NAMED_COLORS
        .iter()
        .find(|(n, _)| *n == name)
        .map(|(_, c)| c)
}

// ─── splitTopLevelCommas ────────────────────────────────────────────────────

/// JS `splitTopLevelCommas(str)`.
pub fn split_top_level_commas(s: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut depth: i64 = 0;
    let mut start = 0usize;
    for (i, ch) in s.char_indices() {
        if ch == '(' {
            depth += 1;
        } else if ch == ')' {
            depth = std::cmp::max(0, depth - 1);
        } else if ch == ',' && depth == 0 {
            parts.push(js::trim(&s[start..i]).to_string());
            start = i + 1;
        }
    }
    let tail = js::trim(&s[start..]);
    if !tail.is_empty() {
        parts.push(tail.to_string());
    }
    parts
}

// ─── parseColorMix ──────────────────────────────────────────────────────────

re!(COLOR_MIX_HEAD, format!(r"^{}\(", ci("color-mix")));
re!(IN_SPACE, format!(r"^{}{WS}", ci("in")));
re!(PCT_TRAIL, format!(r"{WS}+([0-9.]+)%$"));
re!(PCT_LEAD, format!(r"^([0-9.]+)%{WS}+"));
re!(TRANSPARENT_RE, format!(r"^{}$", ci("transparent")));

struct MixComponent {
    color: Rgba,
    pct: Option<f64>,
}

fn parse_mix_component(component: &str) -> Option<MixComponent> {
    let mut pct = None;
    let mut color_str = component;
    if let Some(m) = PCT_TRAIL.captures(component) {
        pct = Some(parse_float(grp(&m, 1).unwrap()));
        color_str = js::trim(&component[..m.get(0).unwrap().start()]);
    } else if let Some(m) = PCT_LEAD.captures(component) {
        pct = Some(parse_float(grp(&m, 1).unwrap()));
        color_str = js::trim(&component[m.get(0).unwrap().end()..]);
    }
    let color = if TRANSPARENT_RE.is_match(color_str) {
        Some(Rgba::new(0.0, 0.0, 0.0, 0.0))
    } else {
        parse_any_color(Some(color_str))
    };
    color.map(|color| MixComponent { color, pct })
}

/// JS `parseColorMix(str)`.
pub fn parse_color_mix(s: &str) -> Option<Rgba> {
    if !COLOR_MIX_HEAD.is_match(js::trim(s)) {
        return None;
    }
    let bytes = s.as_bytes();
    let open = s.find('(')?;
    let mut depth = 0i64;
    let mut end: Option<usize> = None;
    let mut i = open;
    while i < bytes.len() {
        if bytes[i] == b'(' {
            depth += 1;
        } else if bytes[i] == b')' {
            depth -= 1;
            if depth == 0 {
                end = Some(i);
                break;
            }
        }
        i += 1;
    }
    let end = end?;
    let args = split_top_level_commas(&s[open + 1..end]);
    if args.len() != 3 || !IN_SPACE.is_match(&args[0]) {
        return None;
    }
    let c1 = parse_mix_component(&args[1])?;
    let c2 = parse_mix_component(&args[2])?;
    let (p1, p2) = match (c1.pct, c2.pct) {
        (None, None) => (50.0, 50.0),
        (None, Some(p2)) => (100.0 - p2, p2),
        (Some(p1), None) => (p1, 100.0 - p1),
        (Some(p1), Some(p2)) => (p1, p2),
    };
    let sum = p1 + p2;
    if sum <= 0.0 {
        return None;
    }
    let w1 = p1 / sum;
    let w2 = p2 / sum;
    let alpha_scale = if sum < 100.0 { sum / 100.0 } else { 1.0 };
    let a1 = c1.color.alpha_or_one();
    let a2 = c2.color.alpha_or_one();
    let a = (a1 * w1 + a2 * w2) * alpha_scale;
    if a <= 0.0 {
        return Some(Rgba::new(0.0, 0.0, 0.0, 0.0));
    }
    let mix = |x1: f64, x2: f64| math_round((x1 * a1 * w1 + x2 * a2 * w2) / (a1 * w1 + a2 * w2));
    Some(Rgba::new(
        mix(c1.color.r, c2.color.r),
        mix(c1.color.g, c2.color.g),
        mix(c1.color.b, c2.color.b),
        math_min(1.0, a),
    ))
}

// ─── compositeColorOver ─────────────────────────────────────────────────────

/// JS `compositeColorOver(top, base)`.
pub fn composite_color_over(top: &Rgba, base: &Rgba) -> Rgba {
    let a = top.alpha_or_one();
    Rgba::new(
        math_round(top.r * a + base.r * (1.0 - a)),
        math_round(top.g * a + base.g * (1.0 - a)),
        math_round(top.b * a + base.b * (1.0 - a)),
        1.0,
    )
}

// ─── Component helpers ──────────────────────────────────────────────────────

re!(NONE_RE, format!(r"^{}$", ci("none")));

/// JS `parseColorComponent(token, scale = 1)`.
fn parse_color_component(token: Option<&str>, scale: f64) -> Option<f64> {
    let t = js::trim(token?);
    if NONE_RE.is_match(t) {
        return Some(0.0);
    }
    let num = parse_float(t);
    if !num.is_finite() {
        return None;
    }
    Some(if t.ends_with('%') {
        (num / 100.0) * scale
    } else {
        num
    })
}

/// JS `parseAlphaToken(token)`.
fn parse_alpha_token(token: Option<&str>) -> f64 {
    let Some(token) = token else { return 1.0 };
    let t = js::trim(token);
    if NONE_RE.is_match(t) {
        return 1.0;
    }
    let num = parse_float(t);
    if !num.is_finite() {
        return 1.0;
    }
    if t.ends_with('%') {
        num / 100.0
    } else {
        num
    }
}

// ─── parseAnyColor ──────────────────────────────────────────────────────────

re!(
    ANY_RGB,
    format!(
        r"rgba?\({WS}*({D}+(?:\.{D}+)?){WS}*,?{WS}*({D}+(?:\.{D}+)?){WS}*,?{WS}*({D}+(?:\.{D}+)?)(?:{WS}*[,/]{WS}*([0-9.]+)(%)?)?{WS}*\)"
    )
);
re!(ANY_HEX, r"^#([0-9a-fA-F]{3,8})$".to_string());
re!(
    ANY_OKLCH,
    format!(
        r"{}\({WS}*([0-9.]+)(%?){WS}*[{WSC},]*{WS}*([0-9.]+){WS}*[{WSC},]+{WS}*([\-0-9.]+)(?:{})?(?:{WS}*/{WS}*([0-9.]+)(%)?)?{WS}*\)",
        ci("oklch"),
        ci("deg"),
        WSC = js::WS_CHARS
    )
);
re!(
    ANY_OKLAB,
    format!(
        r"{}\({WS}*([0-9.]+)(%?){WS}+(-?[0-9.]+)(%?){WS}+(-?[0-9.]+)(%?)(?:{WS}*/{WS}*([0-9.]+)(%)?)?{WS}*\)",
        ci("oklab")
    )
);
re!(
    ANY_LCH,
    format!(
        r"^{}\({WS}*([0-9.]+%?|{none}){WS}+([0-9.]+%?|{none}){WS}+(-?[0-9.]+)(?:{deg})?(?:{WS}*/{WS}*([0-9.]+%?|{none}))?{WS}*\)$",
        ci("lch"),
        none = ci("none"),
        deg = ci("deg")
    )
);
re!(
    ANY_LAB,
    format!(
        r"^{}\({WS}*([0-9.]+%?|{none}){WS}+(-?[0-9.]+%?|{none}){WS}+(-?[0-9.]+%?|{none})(?:{WS}*/{WS}*([0-9.]+%?|{none}))?{WS}*\)$",
        ci("lab"),
        none = ci("none")
    )
);
re!(
    ANY_COLOR_FN,
    format!(
        r"^{}\({WS}*([a-zA-Z0-9\-]+){WS}+(-?[0-9.eE+\-]+%?|{none}){WS}+(-?[0-9.eE+\-]+%?|{none}){WS}+(-?[0-9.eE+\-]+%?|{none})(?:{WS}*/{WS}*([0-9.]+%?|{none}))?{WS}*\)$",
        ci("color"),
        none = ci("none")
    )
);
re!(
    ANY_HSL,
    format!(
        r"{}{}?\({WS}*(-?[0-9.]+)(?:{deg})?{WS}*[,{WSC}]{WS}*([0-9.]+)%{WS}*[,{WSC}]{WS}*([0-9.]+)%(?:{WS}*[,/]{WS}*([0-9.]+)(%)?)?{WS}*\)",
        ci("hsl"),
        ci("a"),
        deg = ci("deg"),
        WSC = js::WS_CHARS
    )
);
re!(
    ANY_HWB,
    format!(
        r"{}\({WS}*(-?[0-9.]+)(?:{deg})?{WS}+([0-9.]+)%{WS}+([0-9.]+)%(?:{WS}*/{WS}*([0-9.]+)(%)?)?{WS}*\)",
        ci("hwb"),
        deg = ci("deg")
    )
);

/// JS `m[a] === '%' ? parseFloat(m[n]) / 100 : parseFloat(m[n])` alpha rule.
fn alpha_from(num: &str, pct: Option<&str>) -> f64 {
    let alpha = parse_float(num);
    if pct == Some("%") {
        alpha / 100.0
    } else {
        alpha
    }
}

/// JS `parseAnyColor(s)`.
pub fn parse_any_color(s: Option<&str>) -> Option<Rgba> {
    let s = s?;
    if s.is_empty() {
        return None;
    }
    let str_ = js::trim(s);
    if str_ == "transparent" || str_ == "currentcolor" || str_ == "inherit" {
        return None;
    }
    if COLOR_MIX_HEAD.is_match(str_) {
        return parse_color_mix(str_);
    }
    if let Some(m) = caps(&ANY_RGB, str_) {
        let mut c = Rgba::new(
            math_round(string_to_number(grp(&m, 1).unwrap())),
            math_round(string_to_number(grp(&m, 2).unwrap())),
            math_round(string_to_number(grp(&m, 3).unwrap())),
            1.0,
        );
        if let Some(a) = grp(&m, 4) {
            c.a = Some(if grp(&m, 5) == Some("%") {
                parse_float(a) / 100.0
            } else {
                string_to_number(a)
            });
        }
        return Some(c);
    }
    if let Some(m) = caps(&ANY_HEX, str_) {
        let h = grp(&m, 1).unwrap();
        let hb = h.as_bytes();
        let dbl = |i: usize| parse_int(&format!("{}{}", hb[i] as char, hb[i] as char), 16);
        if h.len() == 3 || h.len() == 4 {
            return Some(Rgba::new(
                dbl(0),
                dbl(1),
                dbl(2),
                if h.len() == 4 { dbl(3) / 255.0 } else { 1.0 },
            ));
        }
        if h.len() == 6 || h.len() == 8 {
            return Some(Rgba::new(
                parse_int(&h[0..2], 16),
                parse_int(&h[2..4], 16),
                parse_int(&h[4..6], 16),
                if h.len() == 8 {
                    parse_int(&h[6..8], 16) / 255.0
                } else {
                    1.0
                },
            ));
        }
        // JS-PARITY: 5- and 7-digit hex strings match the regex but fall
        // through every length branch and continue to the later parsers.
    }
    if let Some(m) = caps(&ANY_OKLCH, str_) {
        let lnum = parse_float(grp(&m, 1).unwrap());
        let l = if grp(&m, 2) == Some("%") {
            lnum / 100.0
        } else {
            lnum
        };
        let mut rgb = oklch_to_rgb(
            l,
            parse_float(grp(&m, 3).unwrap()),
            parse_float(grp(&m, 4).unwrap()),
        );
        if let Some(a) = grp(&m, 5) {
            rgb.a = Some(alpha_from(a, grp(&m, 6)));
        }
        return Some(rgb);
    }
    if let Some(m) = caps(&ANY_OKLAB, str_) {
        let l = if grp(&m, 2) == Some("%") {
            parse_float(grp(&m, 1).unwrap()) / 100.0
        } else {
            parse_float(grp(&m, 1).unwrap())
        };
        let a = if grp(&m, 4) == Some("%") {
            parse_float(grp(&m, 3).unwrap()) * 0.004
        } else {
            parse_float(grp(&m, 3).unwrap())
        };
        let b = if grp(&m, 6) == Some("%") {
            parse_float(grp(&m, 5).unwrap()) * 0.004
        } else {
            parse_float(grp(&m, 5).unwrap())
        };
        let mut rgb = oklab_to_rgb(l, a, b);
        if let Some(al) = grp(&m, 7) {
            rgb.a = Some(alpha_from(al, grp(&m, 8)));
        }
        return Some(rgb);
    }
    if let Some(m) = caps(&ANY_LCH, str_) {
        let l = parse_color_component(grp(&m, 1), 100.0);
        let c = parse_color_component(grp(&m, 2), 150.0);
        let h = parse_float(grp(&m, 3).unwrap());
        let (Some(l), Some(c)) = (l, c) else {
            return None;
        };
        if !h.is_finite() {
            return None;
        }
        let mut rgb = lch_to_rgb(l, c, h);
        rgb.a = Some(parse_alpha_token(grp(&m, 4)));
        return Some(rgb);
    }
    if let Some(m) = caps(&ANY_LAB, str_) {
        let l = parse_color_component(grp(&m, 1), 100.0);
        let a = parse_color_component(grp(&m, 2), 125.0);
        let b = parse_color_component(grp(&m, 3), 125.0);
        let (Some(l), Some(a), Some(b)) = (l, a, b) else {
            return None;
        };
        let mut rgb = lab_to_rgb(l, a, b);
        rgb.a = Some(parse_alpha_token(grp(&m, 4)));
        return Some(rgb);
    }
    if let Some(m) = caps(&ANY_COLOR_FN, str_) {
        let c1 = parse_color_component(grp(&m, 2), 1.0);
        let c2 = parse_color_component(grp(&m, 3), 1.0);
        let c3 = parse_color_component(grp(&m, 4), 1.0);
        let (Some(c1), Some(c2), Some(c3)) = (c1, c2, c3) else {
            return None;
        };
        let space = js::to_lower_case(grp(&m, 1).unwrap());
        let mut rgb = color_function_to_rgb(&space, c1, c2, c3)?;
        rgb.a = Some(parse_alpha_token(grp(&m, 5)));
        return Some(rgb);
    }
    if let Some(m) = caps(&ANY_HSL, str_) {
        let mut rgb = hsl_to_rgb(
            parse_float(grp(&m, 1).unwrap()),
            parse_float(grp(&m, 2).unwrap()) / 100.0,
            parse_float(grp(&m, 3).unwrap()) / 100.0,
        );
        if let Some(a) = grp(&m, 4) {
            rgb.a = Some(alpha_from(a, grp(&m, 5)));
        }
        return Some(rgb);
    }
    if let Some(m) = caps(&ANY_HWB, str_) {
        let mut rgb = hwb_to_rgb(
            parse_float(grp(&m, 1).unwrap()),
            parse_float(grp(&m, 2).unwrap()) / 100.0,
            parse_float(grp(&m, 3).unwrap()) / 100.0,
        );
        if let Some(a) = grp(&m, 4) {
            rgb.a = Some(alpha_from(a, grp(&m, 5)));
        }
        return Some(rgb);
    }
    // JS-PARITY: the JS does `CSS_NAMED_COLORS[str.toLowerCase()]`, a plain
    // object lookup, so inherited names like "constructor" or "__proto__"
    // yield a truthy non-color and JS returns `{ a: 1 }`. Rust returns None
    // for those; no real CSS value hits that path.
    let lower = js::to_lower_case(str_);
    if let Some(named) = named_color(&lower) {
        return Some(Rgba::new(named.r, named.g, named.b, 1.0));
    }
    None
}

// ─── isNoPaintColorValue ────────────────────────────────────────────────────

/// JS `isNoPaintColorValue(value)`.
pub fn is_no_paint_color_value(value: Option<&str>) -> bool {
    let v = js::to_lower_case(js::trim(value.unwrap_or("")));
    if v.is_empty() {
        return true;
    }
    matches!(
        v.as_str(),
        "transparent" | "none" | "initial" | "inherit" | "unset" | "revert" | "revert-layer"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn regexes_compile() {
        let _ = &*NEUTRAL_RGB;
        let _ = &*NEUTRAL_OKLCH;
        let _ = &*NEUTRAL_LCH;
        let _ = &*NEUTRAL_OKLAB;
        let _ = &*NEUTRAL_LAB;
        let _ = &*NEUTRAL_HSL;
        let _ = &*NEUTRAL_HWB;
        let _ = &*PARSE_RGB;
        let _ = &*FN_NAME;
        let _ = &*HEX_IN_GRADIENT;
        let _ = &*COLOR_MIX_HEAD;
        let _ = &*IN_SPACE;
        let _ = &*PCT_TRAIL;
        let _ = &*PCT_LEAD;
        let _ = &*TRANSPARENT_RE;
        let _ = &*NONE_RE;
        let _ = &*ANY_RGB;
        let _ = &*ANY_HEX;
        let _ = &*ANY_OKLCH;
        let _ = &*ANY_OKLAB;
        let _ = &*ANY_LCH;
        let _ = &*ANY_LAB;
        let _ = &*ANY_COLOR_FN;
        let _ = &*ANY_HSL;
        let _ = &*ANY_HWB;
    }

    /// Expected values recorded from Node 24 running color.mjs; covers the
    /// functions and branches the call vectors do not reach.
    #[test]
    fn node_recorded_edges() {
        let c = |r: f64, g: f64, b: f64, a: f64| Some(Rgba::new(r, g, b, a));
        assert_eq!(
            Some(hwb_to_rgb(200.0, 0.2, 0.3)),
            c(51.0, 136.0, 179.0, 1.0)
        );
        assert_eq!(Some(hwb_to_rgb(0.0, 0.6, 0.6)), c(128.0, 128.0, 128.0, 1.0));
        assert_eq!(
            Some(hwb_to_rgb(-30.0, 0.1, 0.1)),
            c(230.0, 26.0, 128.0, 1.0)
        );
        assert_eq!(Some(hwb_to_rgb(359.9, 0.0, 0.0)), c(255.0, 0.0, 0.0, 1.0));
        assert_eq!(
            Some(hwb_to_rgb(120.0, 0.5, 0.5)),
            c(128.0, 128.0, 128.0, 1.0)
        );
        assert_eq!(
            color_to_hex(Some(&Rgba::new(255.5, -5.0, f64::NAN, 1.0))),
            "#ff.8-5NaN"
        );
        assert_eq!(
            color_to_hex(Some(&Rgba::new(0.1, 1e21, 0.0, 1.0))),
            "#0.1999999999999a3635c9adc5dea0000000"
        );
        let p = |s: &str| parse_any_color(Some(s));
        let bad_alpha = p("rgba(0,0,0,.)").unwrap();
        assert!(bad_alpha.a.unwrap().is_nan());
        assert_eq!(p("#12345"), None);
        assert_eq!(p("rgb(1.5 2.5 3.5 / 50%)"), c(2.0, 3.0, 4.0, 0.5));
        assert_eq!(p("hsl(400deg, 50%, 50%)"), c(191.0, 149.0, 64.0, 1.0));
        assert_eq!(p("HWB(200 20% 30% / 0.5)"), c(51.0, 136.0, 179.0, 0.5));
        assert_eq!(p("color(display-p3 1 0.5 0)"), c(255.0, 118.0, 0.0, 1.0));
        assert_eq!(p("lab(50% 20% -30%)"), c(135.0, 105.0, 183.0, 1.0));
        assert_eq!(p("oklch(0.5 0.1 -50deg / 20%)"), c(117.0, 82.0, 142.0, 0.2));
        assert!(is_neutral_color(Some("hwb(0 50% 50%)")));
        assert!(is_neutral_color(Some("oklab(0.5 -.01 .01)")));
        assert!(is_neutral_color(Some("hsla(10, 5%, 50%, 1)")));
        assert!(is_neutral_color(Some("lab(50 2 -2)")));
        assert!(!is_neutral_color(Some("weird")));
        assert_eq!(
            parse_color_mix("color-mix(in srgb, red 30%, blue 30%)"),
            c(128.0, 0.0, 128.0, 0.6)
        );
        assert_eq!(
            parse_color_mix("color-mix(in srgb, transparent, transparent)"),
            c(0.0, 0.0, 0.0, 0.0)
        );
        assert_eq!(
            parse_color_mix("color-mix(in srgb, 25% red, blue)"),
            c(64.0, 0.0, 191.0, 1.0)
        );
    }

    #[test]
    fn basics() {
        assert_eq!(
            parse_any_color(Some("#fff")),
            Some(Rgba::new(255.0, 255.0, 255.0, 1.0))
        );
        assert_eq!(
            color_to_hex(Some(&Rgba::new(255.0, 0.0, 10.0, 1.0))),
            "#ff000a"
        );
        assert!(is_neutral_color(Some("rgb(10, 20, 30)")));
        assert!(!is_neutral_color(Some("oklch(65% 0.18 250)")));
        assert_eq!(
            split_top_level_commas("a, b(c, d), e"),
            vec!["a", "b(c, d)", "e"]
        );
        assert_eq!(parse_any_color(Some("Constructor")), None);
        assert!(is_no_paint_color_value(None));
    }
}
