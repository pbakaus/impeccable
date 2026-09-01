//! Vector-replay dispatch for `engines.static-html.css-cascade`, mirroring
//! `impeccable_core::vectors::call` (`tests/vectors.rs` replays the recorded
//! JS calls through it).

use super::checks_shim::CustomProps;
use super::rules::{
    compare_static_priority, parse_static_style_attribute, static_specificity, DeclMeta,
};
use super::shorthand::{
    expand_static_box_values, expand_static_declaration, parse_static_animation,
    parse_static_border, parse_static_font, parse_static_transition,
};
use super::values::{
    css_prop_to_camel, extract_static_color, normalize_static_css_value, parse_static_color,
    split_css_list, split_css_tokens, static_color_to_css, StyleValues,
};
use impeccable_core::color::Rgba;
use impeccable_core::js;
use impeccable_core::vectors::{decode, encode, Js};
use serde_json::Value;

pub const MODULE: &str = "engines.static-html.css-cascade";

/// (module, fn) pairs this crate replays.
pub const KNOWN: &[(&str, &[&str])] = &[(
    MODULE,
    &[
        "compareStaticPriority",
        "cssPropToCamel",
        "expandStaticBoxValues",
        "expandStaticDeclaration",
        "extractStaticColor",
        "normalizeStaticCssValue",
        "parseStaticAnimation",
        "parseStaticBorder",
        "parseStaticColor",
        "parseStaticFont",
        "parseStaticStyleAttribute",
        "parseStaticTransition",
        "splitCssList",
        "splitCssTokens",
        "staticColorToCss",
        "staticSpecificity",
    ],
)];

fn get<'a>(j: &'a Js, key: &str) -> Option<&'a Js> {
    match j {
        Js::Obj(fields) => fields.iter().find(|(k, _)| k == key).map(|(_, v)| v),
        _ => None,
    }
}

fn to_number(j: &Js) -> f64 {
    match j {
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

fn truthy(j: Option<&Js>) -> bool {
    match j {
        None | Some(Js::Undef) | Some(Js::Null) => false,
        Some(Js::Bool(b)) => *b,
        Some(Js::Num(n)) => !(*n == 0.0 || n.is_nan()),
        Some(Js::Str(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

/// JS `String(value || '')` for the string-ish arguments the vectors carry.
fn str_of(j: &Js) -> String {
    match j {
        Js::Str(s) => s.clone(),
        Js::Undef | Js::Null => String::new(),
        Js::Num(n) => {
            if *n == 0.0 || n.is_nan() {
                String::new()
            } else {
                js::number_to_string(*n)
            }
        }
        Js::Bool(b) => {
            if *b {
                "true".to_string()
            } else {
                String::new()
            }
        }
        _ => String::new(),
    }
}

fn str_vec(j: &Js) -> Vec<String> {
    match j {
        Js::Arr(items) => items.iter().map(str_of).collect(),
        _ => Vec::new(),
    }
}

fn arr_of_str(items: &[String]) -> Js {
    Js::Arr(items.iter().map(|s| Js::Str(s.clone())).collect())
}

fn pairs_to_js(pairs: &[(String, String)]) -> Js {
    Js::Arr(
        pairs
            .iter()
            .map(|(a, b)| Js::Arr(vec![Js::Str(a.clone()), Js::Str(b.clone())]))
            .collect(),
    )
}

fn rgba_from(j: &Js) -> Option<Rgba> {
    match j {
        Js::Obj(_) => Some(Rgba {
            r: get(j, "r").map(to_number).unwrap_or(f64::NAN),
            g: get(j, "g").map(to_number).unwrap_or(f64::NAN),
            b: get(j, "b").map(to_number).unwrap_or(f64::NAN),
            a: match get(j, "a") {
                None | Some(Js::Undef) | Some(Js::Null) => None,
                Some(v) => Some(to_number(v)),
            },
        }),
        _ => None,
    }
}

fn rgba_to_js(c: &Rgba) -> Js {
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

fn meta_from(j: &Js) -> Option<DeclMeta> {
    if matches!(j, Js::Undef | Js::Null) {
        return None;
    }
    let spec: Vec<Js> = match get(j, "specificity") {
        Some(Js::Arr(items)) => items.clone(),
        _ => Vec::new(),
    };
    let s = |i: usize| -> u32 {
        // JS `(b.specificity[i] || 0)`
        match spec.get(i) {
            Some(v) => {
                let n = to_number(v);
                if n.is_nan() {
                    0
                } else {
                    n as u32
                }
            }
            None => 0,
        }
    };
    Some(DeclMeta {
        important: truthy(get(j, "important")),
        inline: truthy(get(j, "inline")),
        specificity: [s(0), s(1), s(2)],
        order: get(j, "order").map(to_number).unwrap_or(f64::NAN) as i64,
    })
}

fn style_from(j: &Js) -> Option<StyleValues> {
    match j {
        Js::Obj(fields) => {
            let mut m = StyleValues::new();
            for (k, v) in fields {
                if let Js::Str(s) = v {
                    m.insert(k.clone(), s.clone());
                }
            }
            Some(m)
        }
        _ => None,
    }
}

fn custom_props_from(j: &Js) -> CustomProps {
    let mut m = CustomProps::new();
    if let Js::Map(entries) = j {
        for (k, v) in entries {
            if let (Js::Str(k), Js::Str(v)) = (k, v) {
                m.insert(k.clone(), v.clone());
            }
        }
    }
    m
}

/// Invoke the Rust port of `<module>.<fn_name>` with recorder-encoded
/// arguments; `None` when the function is not known here.
pub fn call(module: &str, fn_name: &str, args: &[Value]) -> Option<Value> {
    if module != MODULE {
        return None;
    }
    let a: Vec<Js> = args.iter().map(decode).collect();
    let arg = |i: usize| a.get(i).cloned().unwrap_or(Js::Undef);
    let s = |i: usize| str_of(&arg(i));
    let result: Js = match fn_name {
        "compareStaticPriority" => {
            let a0 = arg(0);
            let b = meta_from(&arg(1))?;
            Js::Bool(compare_static_priority(meta_from(&a0).as_ref(), &b))
        }
        "cssPropToCamel" => Js::Str(css_prop_to_camel(&s(0))),
        "expandStaticBoxValues" => arr_of_str(&expand_static_box_values(&str_vec(&arg(0)))),
        "expandStaticDeclaration" => pairs_to_js(&expand_static_declaration(&s(0), &s(1))),
        "extractStaticColor" => Js::Str(extract_static_color(&s(0))),
        "normalizeStaticCssValue" => {
            let custom = custom_props_from(&arg(2));
            let parent = style_from(&arg(3));
            let current = style_from(&arg(4));
            Js::Str(normalize_static_css_value(
                &s(0),
                &s(1),
                &custom,
                parent.as_ref(),
                current.as_ref(),
            ))
        }
        "parseStaticAnimation" => {
            let r = parse_static_animation(&s(0));
            Js::Obj(vec![
                ("name".to_string(), Js::Str(r.name)),
                ("timing".to_string(), Js::Str(r.timing)),
            ])
        }
        "parseStaticBorder" => {
            let r = parse_static_border(&s(0));
            Js::Obj(vec![
                ("width".to_string(), Js::Str(r.width)),
                ("color".to_string(), Js::Str(r.color)),
            ])
        }
        "parseStaticColor" => match parse_static_color(&s(0)) {
            Some(c) => rgba_to_js(&c),
            None => Js::Null,
        },
        "parseStaticFont" => pairs_to_js(&parse_static_font(&s(0))),
        "parseStaticStyleAttribute" => {
            let order_base = match arg(1) {
                Js::Undef => 0.0,
                v => to_number(&v),
            } as i64;
            Js::Arr(
                parse_static_style_attribute(&s(0), order_base)
                    .into_iter()
                    .map(|d| {
                        Js::Obj(vec![
                            ("prop".to_string(), Js::Str(d.prop)),
                            ("value".to_string(), Js::Str(d.value)),
                            ("important".to_string(), Js::Bool(d.important)),
                            ("order".to_string(), Js::Num(d.order as f64)),
                        ])
                    })
                    .collect(),
            )
        }
        "parseStaticTransition" => {
            let r = parse_static_transition(&s(0));
            Js::Obj(vec![
                ("property".to_string(), Js::Str(r.property)),
                ("timing".to_string(), Js::Str(r.timing)),
            ])
        }
        "splitCssList" => arr_of_str(&split_css_list(&s(0))),
        "splitCssTokens" => arr_of_str(&split_css_tokens(&s(0))),
        "staticColorToCss" => Js::Str(static_color_to_css(rgba_from(&arg(0)).as_ref())),
        "staticSpecificity" => {
            let sp = static_specificity(&s(0));
            Js::Arr(sp.iter().map(|n| Js::Num(*n as f64)).collect())
        }
        _ => return None,
    };
    Some(encode(&result))
}
