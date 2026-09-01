//! Vector-replay dispatch for the open `rules.checks` helpers (group b):
//! the CSS measurement helpers and the numbered-label parser. The detector
//! keeps the arms for its own checks and reuses the `Js` accessors below.

use super::rgba_to_js;
use crate::css::measures;
use crate::js;
use crate::rules::text as text_rules;
use crate::vectors::{decode, encode, Js};
use serde_json::Value;

/// The `rules.checks` functions this group replays. `impeccable_core`'s
/// `vectors::KNOWN_FUNCTIONS` folds this in, so a caller sees one table.
pub const KNOWN_FNS: &[&str] = &[
    "parseRadiusToPx",
    "resolveVarRefs",
    "parseColorResolved",
    "resolveLengthPx",
    "shadowMaxBlurPx",
    "parseNumberedLabelText",
];

pub fn field<'a>(j: &'a Js, key: &str) -> Option<&'a Js> {
    match j {
        Js::Obj(fields) => fields.iter().find(|(k, _)| k == key).map(|(_, v)| v),
        _ => None,
    }
}

/// JS ToNumber for the shapes the vectors carry.
pub fn to_number(j: &Js) -> f64 {
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

pub fn num_field(j: &Js, key: &str) -> f64 {
    field(j, key).map(to_number).unwrap_or(f64::NAN)
}

/// A string field, `None` for absent / undefined / null.
pub fn str_field<'a>(j: &'a Js, key: &str) -> Option<&'a str> {
    match field(j, key) {
        Some(Js::Str(s)) => Some(s.as_str()),
        _ => None,
    }
}

/// `x || ''` for a string field.
pub fn str_field_or_empty<'a>(j: &'a Js, key: &str) -> &'a str {
    str_field(j, key).unwrap_or("")
}

pub fn opt_str(j: &Js) -> Option<&str> {
    match j {
        Js::Str(s) => Some(s.as_str()),
        _ => None,
    }
}

pub fn opt_num_to_js(n: Option<f64>) -> Js {
    match n {
        Some(n) => Js::Num(n),
        None => Js::Null,
    }
}

/// A recorded `Map` of custom properties.
pub struct JsCustomProps(Vec<(String, String)>);

impl measures::CustomProps for JsCustomProps {
    fn get(&self, name: &str) -> Option<String> {
        self.0
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.clone())
    }
}

pub fn custom_props_from(j: &Js) -> Option<JsCustomProps> {
    match j {
        Js::Map(entries) => Some(JsCustomProps(
            entries
                .iter()
                .filter_map(|(k, v)| match (k, v) {
                    (Js::Str(k), Js::Str(v)) => Some((k.clone(), v.clone())),
                    _ => None,
                })
                .collect(),
        )),
        _ => None,
    }
}

pub fn call(module: &str, fn_name: &str, args: &[Value]) -> Option<Value> {
    if module != "rules.checks" {
        return None;
    }
    let a: Vec<Js> = args.iter().map(decode).collect();
    let arg = |i: usize| a.get(i).cloned().unwrap_or(Js::Undef);
    let result: Js = match fn_name {
        "parseRadiusToPx" => {
            let value = arg(0);
            let width = to_number(&arg(1));
            opt_num_to_js(measures::parse_radius_to_px(opt_str(&value), width))
        }
        "resolveVarRefs" => {
            let raw = arg(0);
            let Js::Str(raw) = &raw else {
                return Some(encode(&raw));
            };
            let map = custom_props_from(&arg(1)).unwrap_or(JsCustomProps(vec![]));
            let depth = match arg(2) {
                Js::Undef => 0.0,
                other => to_number(&other),
            };
            let depth = if depth.is_nan() {
                0
            } else {
                depth.max(0.0) as u32
            };
            Js::Str(measures::resolve_var_refs(raw, &map, depth))
        }
        "parseColorResolved" => {
            let s = arg(0);
            let map = custom_props_from(&arg(1));
            let out = measures::parse_color_resolved(
                opt_str(&s),
                map.as_ref().map(|m| m as &dyn measures::CustomProps),
            );
            match out {
                Some(c) => rgba_to_js(&c),
                None => Js::Null,
            }
        }
        "resolveLengthPx" => {
            let value = arg(0);
            let fs = to_number(&arg(1));
            opt_num_to_js(measures::resolve_length_px(opt_str(&value), fs))
        }
        "shadowMaxBlurPx" => {
            let bs = arg(0);
            let opts = arg(1);
            let min_alpha = match field(&opts, "minAlpha") {
                None | Some(Js::Undef) => None,
                Some(v) => Some(to_number(v)),
            };
            Js::Num(measures::shadow_max_blur_px(opt_str(&bs), min_alpha))
        }
        "parseNumberedLabelText" => {
            let raw = arg(0);
            match text_rules::parse_numbered_label_text(opt_str(&raw)) {
                Some(l) => Js::Obj(vec![
                    ("index".to_string(), Js::Num(l.index)),
                    ("text".to_string(), Js::Str(l.text)),
                ]),
                None => Js::Null,
            }
        }
        _ => return None,
    };
    Some(encode(&result))
}
