//! Replay codec and open dispatcher for the recorded JS call vectors
//! (`tests/oracle/vectors/calls/<module>/<fn>.jsonl` in the public repo).
//!
//! Values use the recorder's encoding for what JSON cannot carry:
//! `{"$undef":true}`, `{"$nan":true}`, `{"$inf":1|-1}`, `{"$negzero":true}`,
//! `{"$map":[[k,v],...]}`, `{"$set":[...]}`. [`decode`] turns that into a
//! [`Js`] value, [`call`] runs the Rust port, and [`encode`] writes the result
//! back in the same encoding so a test can compare it with the JS result.

pub mod checks_a;
pub mod checks_b;

use crate::color::{self, Rgba};
use crate::inline_ignores::{self, IgnorableFinding, InlineIgnores};
use crate::js;
use serde_json::{json, Map, Value};

/// A decoded JS value.
#[derive(Debug, Clone, PartialEq)]
pub enum Js {
    Undef,
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<Js>),
    Obj(Vec<(String, Js)>),
    Map(Vec<(Js, Js)>),
    Set(Vec<Js>),
}

impl Js {
    fn get(&self, key: &str) -> Option<&Js> {
        match self {
            Js::Obj(fields) => fields.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }
    /// JS `ToNumber` for the value shapes the vectors carry.
    fn to_number(&self) -> f64 {
        match self {
            Js::Undef => f64::NAN,
            Js::Null => 0.0,
            Js::Bool(b) => {
                if *b {
                    1.0
                } else {
                    0.0
                }
            }
            Js::Num(n) => *n,
            Js::Str(s) => js::string_to_number(s),
            _ => f64::NAN,
        }
    }
    fn as_str(&self) -> Option<&str> {
        match self {
            Js::Str(s) => Some(s),
            _ => None,
        }
    }
    fn as_f64(&self) -> Option<f64> {
        match self {
            Js::Num(n) => Some(*n),
            _ => None,
        }
    }
    fn is_nullish(&self) -> bool {
        matches!(self, Js::Undef | Js::Null)
    }
}

/// Decode a recorder-encoded JSON value.
pub fn decode(v: &Value) -> Js {
    match v {
        Value::Null => Js::Null,
        Value::Bool(b) => Js::Bool(*b),
        Value::Number(n) => Js::Num(n.as_f64().unwrap_or(f64::NAN)),
        Value::String(s) => Js::Str(s.clone()),
        Value::Array(items) => Js::Arr(items.iter().map(decode).collect()),
        Value::Object(map) => {
            if map.len() == 1 {
                if let Some((k, val)) = map.iter().next() {
                    match k.as_str() {
                        "$undef" => return Js::Undef,
                        "$nan" => return Js::Num(f64::NAN),
                        "$inf" => {
                            return Js::Num(if val.as_f64().unwrap_or(1.0) < 0.0 {
                                f64::NEG_INFINITY
                            } else {
                                f64::INFINITY
                            })
                        }
                        "$negzero" => return Js::Num(-0.0),
                        "$map" => {
                            let entries = val
                                .as_array()
                                .map(|a| {
                                    a.iter()
                                        .map(|pair| {
                                            let p = pair.as_array().expect("$map pair");
                                            (decode(&p[0]), decode(&p[1]))
                                        })
                                        .collect()
                                })
                                .unwrap_or_default();
                            return Js::Map(entries);
                        }
                        "$set" => {
                            let items = val
                                .as_array()
                                .map(|a| a.iter().map(decode).collect())
                                .unwrap_or_default();
                            return Js::Set(items);
                        }
                        _ => {}
                    }
                }
            }
            Js::Obj(map.iter().map(|(k, v)| (k.clone(), decode(v))).collect())
        }
    }
}

fn encode_number(n: f64) -> Value {
    if n.is_nan() {
        json!({ "$nan": true })
    } else if n == f64::INFINITY {
        json!({ "$inf": 1 })
    } else if n == f64::NEG_INFINITY {
        json!({ "$inf": -1 })
    } else if n == 0.0 && n.is_sign_negative() {
        json!({ "$negzero": true })
    } else if n.fract() == 0.0 && n.abs() < 9.007_199_254_740_992e15 {
        Value::from(n as i64)
    } else {
        Value::from(n)
    }
}

/// Encode a JS value in the recorder's encoding.
pub fn encode(j: &Js) -> Value {
    match j {
        Js::Undef => json!({ "$undef": true }),
        Js::Null => Value::Null,
        Js::Bool(b) => Value::Bool(*b),
        Js::Num(n) => encode_number(*n),
        Js::Str(s) => Value::String(s.clone()),
        Js::Arr(items) => Value::Array(items.iter().map(encode).collect()),
        Js::Obj(fields) => {
            let mut m = Map::new();
            for (k, v) in fields {
                m.insert(k.clone(), encode(v));
            }
            Value::Object(m)
        }
        Js::Map(entries) => {
            json!({ "$map": entries.iter().map(|(k, v)| Value::Array(vec![encode(k), encode(v)])).collect::<Vec<_>>() })
        }
        Js::Set(items) => json!({ "$set": items.iter().map(encode).collect::<Vec<_>>() }),
    }
}

fn rgba_from(j: &Js) -> Option<Rgba> {
    match j {
        Js::Obj(_) => Some(Rgba {
            r: j.get("r").map(|v| v.to_number()).unwrap_or(f64::NAN),
            g: j.get("g").map(|v| v.to_number()).unwrap_or(f64::NAN),
            b: j.get("b").map(|v| v.to_number()).unwrap_or(f64::NAN),
            a: match j.get("a") {
                None | Some(Js::Undef) => None,
                Some(v) => Some(v.to_number()),
            },
        }),
        _ => None,
    }
}

pub(crate) fn rgba_to_js(c: &Rgba) -> Js {
    let mut fields = vec![
        ("r".to_string(), Js::Num(c.r)),
        ("g".to_string(), Js::Num(c.g)),
        ("b".to_string(), Js::Num(c.b)),
    ];
    if let Some(a) = c.a {
        fields.push(("a".to_string(), Js::Num(a)));
    }
    Js::Obj(fields)
}

fn opt_rgba_to_js(c: Option<Rgba>) -> Js {
    match c {
        Some(c) => rgba_to_js(&c),
        None => Js::Null,
    }
}

/// A recorded finding object, viewed through the two fields
/// `isInlineIgnored` reads.
struct JsFinding<'a>(&'a Js);

impl IgnorableFinding for JsFinding<'_> {
    fn antipattern(&self) -> Option<&str> {
        // JS `String(token || '')`: a non-string, truthy value would stringify;
        // the vectors only carry strings or absent.
        self.0.get("antipattern").and_then(|v| v.as_str())
    }
    fn line_number(&self) -> f64 {
        self.0
            .get("line")
            .map(|v| v.to_number())
            .unwrap_or(f64::NAN)
    }
}

fn set_from(j: Option<&Js>) -> Vec<String> {
    match j {
        Some(Js::Set(items)) => items
            .iter()
            .filter_map(|i| i.as_str().map(|s| s.to_string()))
            .collect(),
        _ => Vec::new(),
    }
}

fn map_from(j: Option<&Js>) -> Vec<(usize, Vec<String>)> {
    match j {
        Some(Js::Map(entries)) => entries
            .iter()
            .filter_map(|(k, v)| k.as_f64().map(|n| (n as usize, set_from(Some(v)))))
            .collect(),
        _ => Vec::new(),
    }
}

fn directives_from(j: &Js) -> InlineIgnores {
    InlineIgnores {
        file: set_from(j.get("file")),
        line: map_from(j.get("line")),
        next_line: map_from(j.get("nextLine")),
    }
}

fn set_to_js(set: &[String]) -> Js {
    Js::Set(set.iter().map(|s| Js::Str(s.clone())).collect())
}

fn map_to_js(map: &[(usize, Vec<String>)]) -> Js {
    Js::Map(
        map.iter()
            .map(|(k, v)| (Js::Num(*k as f64), set_to_js(v)))
            .collect(),
    )
}

fn directives_to_js(d: &InlineIgnores) -> Js {
    Js::Obj(vec![
        ("file".to_string(), set_to_js(&d.file)),
        ("line".to_string(), map_to_js(&d.line)),
        ("nextLine".to_string(), map_to_js(&d.next_line)),
    ])
}

/// The `shared.color` functions this dispatcher replays.
pub const COLOR_FNS: &[&str] = &[
    "isNeutralColor",
    "parseRgb",
    "relativeLuminance",
    "contrastRatio",
    "parseGradientColors",
    "extractColorFunctionTokens",
    "hasChroma",
    "getHue",
    "colorToHex",
    "oklabToRgb",
    "oklchToRgb",
    "labToRgb",
    "lchToRgb",
    "colorFunctionToRgb",
    "hslToRgb",
    "hwbToRgb",
    "splitTopLevelCommas",
    "parseColorMix",
    "parseAnyColor",
    "compositeColorOver",
    "isNoPaintColorValue",
];

/// The `shared.inline-ignores` functions this dispatcher replays.
pub const INLINE_IGNORE_FNS: &[&str] = &[
    "parseInlineIgnores",
    "isInlineIgnored",
    "applyInlineIgnores",
];

/// Every (module, fn) pair the open dispatcher knows, so a test can report
/// which of them have no recorded vectors. `impeccable_core` re-exports this
/// and adds the detector's own tables.
pub const KNOWN_FUNCTIONS: &[(&str, &[&str])] = &[
    ("shared.color", COLOR_FNS),
    ("shared.inline-ignores", INLINE_IGNORE_FNS),
    ("rules.checks", checks_a::KNOWN_FNS),
    ("rules.checks", checks_b::KNOWN_FNS),
];

/// Invoke the Rust port of `<module>.<fn_name>` with recorder-encoded
/// arguments; returns the recorder-encoded result, or `None` when the
/// function is not known to the open dispatcher.
pub fn call(module: &str, fn_name: &str, args: &[Value]) -> Option<Value> {
    if let Some(v) = checks_a::call(module, fn_name, args) {
        return Some(v);
    }
    if let Some(v) = checks_b::call(module, fn_name, args) {
        return Some(v);
    }
    let a: Vec<Js> = args.iter().map(decode).collect();
    let arg = |i: usize| a.get(i).cloned().unwrap_or(Js::Undef);
    let str_arg = |i: usize| -> Option<String> { arg(i).as_str().map(|s| s.to_string()) };
    let num_arg = |i: usize| arg(i).to_number();
    let result: Js = match (module, fn_name) {
        ("shared.color", "isNeutralColor") => {
            Js::Bool(color::is_neutral_color(str_arg(0).as_deref()))
        }
        ("shared.color", "parseRgb") => opt_rgba_to_js(color::parse_rgb(str_arg(0).as_deref())),
        ("shared.color", "relativeLuminance") => {
            Js::Num(color::relative_luminance(&rgba_from(&arg(0))?))
        }
        ("shared.color", "contrastRatio") => Js::Num(color::contrast_ratio(
            &rgba_from(&arg(0))?,
            &rgba_from(&arg(1))?,
        )),
        ("shared.color", "parseGradientColors") => Js::Arr(
            color::parse_gradient_colors(str_arg(0).as_deref())
                .iter()
                .map(rgba_to_js)
                .collect(),
        ),
        ("shared.color", "extractColorFunctionTokens") => Js::Arr(
            color::extract_color_function_tokens(str_arg(0).as_deref())
                .into_iter()
                .map(Js::Str)
                .collect(),
        ),
        ("shared.color", "hasChroma") => {
            let c = rgba_from(&arg(0));
            let threshold = if arg(1) == Js::Undef {
                None
            } else {
                Some(num_arg(1))
            };
            Js::Bool(color::has_chroma(c.as_ref(), threshold))
        }
        ("shared.color", "getHue") => Js::Num(color::get_hue(rgba_from(&arg(0)).as_ref())),
        ("shared.color", "colorToHex") => Js::Str(color::color_to_hex(rgba_from(&arg(0)).as_ref())),
        ("shared.color", "oklabToRgb") => {
            rgba_to_js(&color::oklab_to_rgb(num_arg(0), num_arg(1), num_arg(2)))
        }
        ("shared.color", "oklchToRgb") => {
            rgba_to_js(&color::oklch_to_rgb(num_arg(0), num_arg(1), num_arg(2)))
        }
        ("shared.color", "labToRgb") => {
            rgba_to_js(&color::lab_to_rgb(num_arg(0), num_arg(1), num_arg(2)))
        }
        ("shared.color", "lchToRgb") => {
            rgba_to_js(&color::lch_to_rgb(num_arg(0), num_arg(1), num_arg(2)))
        }
        ("shared.color", "colorFunctionToRgb") => opt_rgba_to_js(color::color_function_to_rgb(
            str_arg(0).as_deref().unwrap_or(""),
            num_arg(1),
            num_arg(2),
            num_arg(3),
        )),
        ("shared.color", "hslToRgb") => {
            rgba_to_js(&color::hsl_to_rgb(num_arg(0), num_arg(1), num_arg(2)))
        }
        ("shared.color", "hwbToRgb") => {
            rgba_to_js(&color::hwb_to_rgb(num_arg(0), num_arg(1), num_arg(2)))
        }
        ("shared.color", "splitTopLevelCommas") => Js::Arr(
            color::split_top_level_commas(&str_arg(0)?)
                .into_iter()
                .map(Js::Str)
                .collect(),
        ),
        ("shared.color", "parseColorMix") => opt_rgba_to_js(color::parse_color_mix(&str_arg(0)?)),
        ("shared.color", "parseAnyColor") => {
            opt_rgba_to_js(color::parse_any_color(str_arg(0).as_deref()))
        }
        ("shared.color", "compositeColorOver") => rgba_to_js(&color::composite_color_over(
            &rgba_from(&arg(0))?,
            &rgba_from(&arg(1))?,
        )),
        ("shared.color", "isNoPaintColorValue") => {
            let v = arg(0);
            let s = match &v {
                Js::Str(s) => Some(s.as_str()),
                Js::Undef | Js::Null => None,
                _ => return None,
            };
            Js::Bool(color::is_no_paint_color_value(s))
        }
        ("shared.inline-ignores", "parseInlineIgnores") => {
            directives_to_js(&inline_ignores::parse_inline_ignores(str_arg(0).as_deref()))
        }
        ("shared.inline-ignores", "isInlineIgnored") => {
            let finding = arg(0);
            let directives = directives_from(&arg(1));
            Js::Bool(inline_ignores::is_inline_ignored(
                &JsFinding(&finding),
                &directives,
            ))
        }
        ("shared.inline-ignores", "applyInlineIgnores") => {
            let findings = match arg(0) {
                Js::Arr(items) => items,
                other => return Some(encode(&other)),
            };
            let content = arg(1);
            let content_str = if content.is_nullish() {
                None
            } else {
                content.as_str().map(|s| s.to_string())
            };
            let wrapped: Vec<JsFinding> = findings.iter().map(JsFinding).collect();
            let kept = inline_ignores::apply_inline_ignores(wrapped, content_str.as_deref());
            Js::Arr(kept.into_iter().map(|f| f.0.clone()).collect())
        }
        _ => return None,
    };
    Some(encode(&result))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_encoding() {
        for v in [
            json!({ "$undef": true }),
            json!({ "$nan": true }),
            json!({ "$inf": -1 }),
            json!({ "$negzero": true }),
            json!({ "$map": [[6, { "$set": ["a"] }]] }),
            json!([1, "x", null, { "r": 1, "a": 0.5 }]),
        ] {
            assert_eq!(encode(&decode(&v)), v);
        }
    }
}
