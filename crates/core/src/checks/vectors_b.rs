//! Vector-replay dispatch for the closed checks of group b (`measures`,
//! `text_rules`). `crate::vectors::call` tries the open foundation arms
//! first, then this; returns None for functions this group does not own.

use crate::checks::measures::{self, Finding};
use crate::checks::text_rules;
use crate::color::Rgba;
use crate::js;
use crate::vectors::{decode, encode, Js};

use impeccable_foundation::vectors::checks_b::{
    field, num_field, opt_str, str_field, str_field_or_empty, to_number,
};

use serde_json::Value;

/// (module, fn) pairs this group replays; the test treats vectors for other
/// functions as SKIP, not FAIL, so groups can land independently. The open
/// helpers of this group are dispatched by
/// `impeccable_foundation::vectors::checks_b`.
pub const KNOWN: &[(&str, &[&str])] = &[(
    "rules.checks",
    &[
        "checkRadialSpotlight",
        "checkOversizedH1",
        "checkGptThinBorderWideShadow",
        "checkContentHiddenAtRest",
        "isCreamColor",
        "isKickerCandidate",
        "isNumberedSectionLabelCandidate",
        "checkNumberedSectionLabels",
        "checkEmDashOveruse",
    ],
)];

fn rgba_from(j: &Js) -> Option<Rgba> {
    match j {
        Js::Obj(_) => Some(Rgba {
            r: num_field(j, "r"),
            g: num_field(j, "g"),
            b: num_field(j, "b"),
            a: match field(j, "a") {
                None | Some(Js::Undef) => None,
                Some(v) => Some(to_number(v)),
            },
        }),
        _ => None,
    }
}

fn findings_to_js(findings: &[Finding]) -> Js {
    Js::Arr(
        findings
            .iter()
            .map(|f| {
                Js::Obj(vec![
                    ("id".to_string(), Js::Str(f.id.clone())),
                    ("snippet".to_string(), Js::Str(f.snippet.clone())),
                ])
            })
            .collect(),
    )
}

pub fn call(module: &str, fn_name: &str, args: &[Value]) -> Option<Value> {
    if module != "rules.checks" {
        return None;
    }
    let a: Vec<Js> = args.iter().map(decode).collect();
    let arg = |i: usize| a.get(i).cloned().unwrap_or(Js::Undef);
    let result: Js = match fn_name {
        "checkRadialSpotlight" => {
            let o = arg(0);
            let input = measures::RadialSpotlightInput {
                gradient_value: str_field(&o, "gradientValue"),
                width: num_field(&o, "width"),
                height: num_field(&o, "height"),
                label: str_field(&o, "label"),
            };
            findings_to_js(&measures::check_radial_spotlight(&input))
        }
        "checkOversizedH1" => {
            let o = arg(0);
            let rect = match field(&o, "rect") {
                Some(r @ Js::Obj(_)) => Some(measures::Rect {
                    width: num_field(r, "width"),
                    height: num_field(r, "height"),
                }),
                _ => None,
            };
            let vp = |key: &str| match field(&o, key) {
                None | Some(Js::Undef) => 0.0,
                Some(v) => to_number(v),
            };
            let input = measures::OversizedH1Input {
                tag: str_field_or_empty(&o, "tag"),
                font_size: num_field(&o, "fontSize"),
                heading_text: str_field_or_empty(&o, "headingText"),
                rect,
                viewport_width: vp("viewportWidth"),
                viewport_height: vp("viewportHeight"),
            };
            findings_to_js(&measures::check_oversized_h1(&input))
        }
        "checkGptThinBorderWideShadow" => {
            let o = arg(0);
            let widths: Vec<f64> = match field(&o, "borderWidths") {
                Some(Js::Arr(items)) => items.iter().map(to_number).collect(),
                _ => return None,
            };
            let colors: Option<Vec<Option<String>>> = match field(&o, "borderColors") {
                Some(Js::Arr(items)) => Some(
                    items
                        .iter()
                        .map(|c| match c {
                            Js::Str(s) => Some(s.clone()),
                            _ => None,
                        })
                        .collect(),
                ),
                _ => None,
            };
            let input = measures::GptBorderShadowInput {
                border_widths: &widths,
                border_colors: colors.as_deref(),
                box_shadow: str_field(&o, "boxShadow"),
            };
            findings_to_js(&measures::check_gpt_thin_border_wide_shadow(&input))
        }
        "checkContentHiddenAtRest" => {
            let o = arg(0);
            let n = |key: &str| match field(&o, key) {
                None | Some(Js::Undef) => 0.0,
                Some(v) => to_number(v),
            };
            let samples: Vec<String> = match field(&o, "hiddenSamples") {
                Some(Js::Arr(items)) => items
                    .iter()
                    .map(|s| match s {
                        Js::Str(s) => s.clone(),
                        other => match encode(other) {
                            Value::String(s) => s,
                            v => v.to_string(),
                        },
                    })
                    .collect(),
                _ => vec![],
            };
            let input = measures::ContentHiddenInput {
                total_chars: n("totalChars"),
                hidden_chars: n("hiddenChars"),
                hidden_samples: samples,
            };
            findings_to_js(&measures::check_content_hidden_at_rest(&input))
        }
        "isCreamColor" => Js::Bool(measures::is_cream_color(rgba_from(&arg(0)).as_ref())),
        "isKickerCandidate" => {
            let o = arg(0);
            let input = text_rules::KickerCandidateInput {
                heading_level: num_field(&o, "headingLevel"),
                heading_text: str_field_or_empty(&o, "headingText"),
                heading_font_size: num_field(&o, "headingFontSize"),
                kicker_tag: str_field_or_empty(&o, "kickerTag"),
                kicker_text: str_field_or_empty(&o, "kickerText"),
                kicker_text_transform: str_field_or_empty(&o, "kickerTextTransform"),
                kicker_font_variant: str_field_or_empty(&o, "kickerFontVariant"),
                kicker_font_size: num_field(&o, "kickerFontSize"),
                kicker_letter_spacing: num_field(&o, "kickerLetterSpacing"),
            };
            Js::Bool(text_rules::is_kicker_candidate(&input))
        }
        "isNumberedSectionLabelCandidate" => {
            let o = arg(0);
            let label_index = match field(&o, "labelIndex") {
                None | Some(Js::Undef) | Some(Js::Null) => None,
                Some(v) => Some(to_number(v)),
            };
            let weight_str;
            let label_font_weight = match field(&o, "labelFontWeight") {
                Some(Js::Str(s)) => s.as_str(),
                Some(Js::Num(n)) => {
                    weight_str = js::number_to_string(*n);
                    weight_str.as_str()
                }
                _ => "",
            };
            let input = text_rules::NumberedLabelCandidateInput {
                heading_tag: str_field_or_empty(&o, "headingTag"),
                heading_text: str_field_or_empty(&o, "headingText"),
                heading_font_size: num_field(&o, "headingFontSize"),
                label_tag: str_field_or_empty(&o, "labelTag"),
                label_index,
                label_text: str_field_or_empty(&o, "labelText"),
                label_font_size: num_field(&o, "labelFontSize"),
                label_letter_spacing: num_field(&o, "labelLetterSpacing"),
                label_font_weight,
                label_font_family: str_field_or_empty(&o, "labelFontFamily"),
                label_text_transform: str_field_or_empty(&o, "labelTextTransform"),
                label_color: str_field_or_empty(&o, "labelColor"),
            };
            Js::Bool(text_rules::is_numbered_section_label_candidate(&input))
        }
        "checkNumberedSectionLabels" => {
            let o = arg(0);
            let candidates: Vec<text_rules::NumberedLabelCandidate> = match field(&o, "candidates")
            {
                Some(Js::Arr(items)) => items
                    .iter()
                    .map(|c| text_rules::NumberedLabelCandidate {
                        index: num_field(c, "index"),
                        label_text: str_field_or_empty(c, "labelText").to_string(),
                        heading_tag: str_field_or_empty(c, "headingTag").to_string(),
                        heading_text: str_field_or_empty(c, "headingText").to_string(),
                    })
                    .collect(),
                _ => return Some(Value::Array(vec![])),
            };
            let min_count = match field(&o, "minCount") {
                None | Some(Js::Undef) => None,
                Some(v) => Some(to_number(v)),
            };
            findings_to_js(&text_rules::check_numbered_section_labels(
                &candidates,
                min_count,
            ))
        }
        "checkEmDashOveruse" => {
            let t = arg(0);
            findings_to_js(&text_rules::check_em_dash_overuse(opt_str(&t)))
        }
        _ => return None,
    };
    Some(encode(&result))
}
