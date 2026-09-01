//! Vector-replay dispatch for the open `rules.checks` helpers (group a):
//! the emoji test and the stylesheet-text utilities. The detector keeps the
//! arms for its own checks and reuses the `Js` accessors below.

use crate::css::scan as css_scan;
use crate::js;
use crate::rules::types as rules;
use crate::vectors::{decode, encode, Js};
use serde_json::Value;

/// The `rules.checks` functions this group replays. `impeccable_core`'s
/// `vectors::KNOWN_FUNCTIONS` folds this in, so a caller sees one table.
pub const KNOWN_FNS: &[&str] = &[
    "isEmojiOnlyText",
    "collectCssCustomProps",
    "enclosingCssSelector",
    "cssLengthToPx",
    "isZeroOffset",
    "collectMarqueeKeyframes",
    "collectPulseKeyframes",
    "stripReducedMotionBlocks",
];

// ─── Js accessors, shared with the detector-side arms ──────────────────────
pub fn field<'a>(j: &'a Js, key: &str) -> Option<&'a Js> {
    match j {
        Js::Obj(fields) => fields.iter().find(|(k, _)| k == key).map(|(_, v)| v),
        _ => None,
    }
}

pub fn to_number(j: Option<&Js>) -> f64 {
    match j {
        None | Some(Js::Undef) => f64::NAN,
        Some(Js::Null) => 0.0,
        Some(Js::Bool(b)) => {
            if *b {
                1.0
            } else {
                0.0
            }
        }
        Some(Js::Num(n)) => *n,
        Some(Js::Str(s)) => js::string_to_number(s),
        _ => f64::NAN,
    }
}

pub fn truthy(j: Option<&Js>) -> bool {
    match j {
        None | Some(Js::Undef) | Some(Js::Null) => false,
        Some(Js::Bool(b)) => *b,
        Some(Js::Num(n)) => *n != 0.0 && !n.is_nan(),
        Some(Js::Str(s)) => !s.is_empty(),
        _ => true,
    }
}

/// A string-ish field: strings pass through; `undefined` / `null` are None;
/// other primitives stringify the way template literals / `String()` would.
pub fn opt_str(j: Option<&Js>) -> Option<String> {
    match j {
        None | Some(Js::Undef) | Some(Js::Null) => None,
        Some(Js::Str(s)) => Some(s.clone()),
        Some(Js::Num(n)) => Some(js::number_to_string(*n)),
        Some(Js::Bool(b)) => Some(b.to_string()),
        Some(Js::Arr(items)) => Some(
            items
                .iter()
                .map(|i| opt_str(Some(i)).unwrap_or_default())
                .collect::<Vec<_>>()
                .join(","),
        ),
        _ => None,
    }
}

pub fn str_or_empty(j: Option<&Js>) -> String {
    opt_str(j).unwrap_or_default()
}

fn strs_to_js(items: &[String]) -> Vec<Js> {
    items.iter().map(|s| Js::Str(s.clone())).collect()
}

pub fn call(module: &str, fn_name: &str, args: &[Value]) -> Option<Value> {
    if module != "rules.checks" {
        return None;
    }
    let a: Vec<Js> = args.iter().map(decode).collect();
    let arg = |i: usize| -> Option<&Js> {
        match a.get(i) {
            Some(Js::Undef) | None => None,
            Some(v) => Some(v),
        }
    };
    let result: Js = match fn_name {
        "isEmojiOnlyText" => Js::Bool(rules::is_emoji_only_text(&str_or_empty(arg(0)))),
        "collectCssCustomProps" => {
            let map = css_scan::collect_css_custom_props(&str_or_empty(arg(0)));
            Js::Map(
                map.iter()
                    .map(|(k, v)| (Js::Str(k.clone()), Js::Str(v.clone())))
                    .collect(),
            )
        }
        "enclosingCssSelector" => {
            let text = str_or_empty(arg(0));
            let idx = to_number(arg(1));
            if !idx.is_finite() {
                Js::Null
            } else {
                // Recorded index is UTF-16; map to a byte offset.
                let mut units = 0usize;
                let mut byte = text.len();
                for (i, c) in text.char_indices() {
                    if units as f64 >= idx {
                        byte = i;
                        break;
                    }
                    units += c.len_utf16();
                }
                if idx < 0.0 {
                    byte = 0;
                }
                css_scan::enclosing_css_selector(&text, byte)
                    .map(Js::Str)
                    .unwrap_or(Js::Null)
            }
        }
        "cssLengthToPx" => match css_scan::css_length_to_px(&str_or_empty(arg(0))) {
            Some(n) => Js::Num(n),
            None => Js::Null,
        },
        "isZeroOffset" => Js::Bool(css_scan::is_zero_offset(opt_str(arg(0)).as_deref())),
        "collectMarqueeKeyframes" => Js::Set(strs_to_js(&css_scan::collect_marquee_keyframes(
            &str_or_empty(arg(0)),
        ))),
        "collectPulseKeyframes" => {
            let map = css_scan::collect_pulse_keyframes(&str_or_empty(arg(0)));
            Js::Map(
                map.iter()
                    .map(|(k, v)| (Js::Str(k.clone()), Js::Bool(*v)))
                    .collect(),
            )
        }
        "stripReducedMotionBlocks" => {
            Js::Str(css_scan::strip_reduced_motion_blocks(&str_or_empty(arg(0))))
        }
        _ => return None,
    };
    Some(encode(&result))
}
