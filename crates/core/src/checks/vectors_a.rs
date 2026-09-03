//! Vector-replay dispatch for the checks of group a (`rules`,
//! `css_scan`, `html_patterns`). `crate::vectors::call` tries the open
//! foundation arms first, then this; returns None for functions this group
//! does not own.

use crate::checks::css_scan::{self, IndexedHit, PatternFinding};
use crate::checks::html_patterns::{self, HtmlPatternCorpora};
use crate::checks::rules::{self, RuleHit};
use crate::color::Rgba;

use crate::js_ext_a::utf16_index;
use crate::vectors::{decode, encode, Js};
use impeccable_foundation::vectors::checks_a::{field, opt_str, str_or_empty, to_number, truthy};

use serde_json::Value;

/// (module, fn) pairs this group replays; the test treats vectors for other
/// functions as SKIP, not FAIL, so groups can land independently. The open
/// helpers of this group are dispatched by
/// `impeccable_foundation::vectors::checks_a`.
pub const KNOWN: &[(&str, &[&str])] = &[(
    "rules.checks",
    &[
        "checkBorders",
        "checkColors",
        "checkHoverContrast",
        "isCardLikeFromProps",
        "checkIconTile",
        "resolveSerif",
        "checkItalicSerif",
        "isAccentColor",
        "resolveHeroHeadingSizePx",
        "checkHeroEyebrow",
        "checkKickerAboveHeading",
        "checkMotion",
        "checkGlow",
        "cssTextHasDarkRootBg",
        "scanCssTextForGlow",
        "scanCssTextForGridBackground",
        "scanCssTextForRadialHalo",
        "scanCssTextForPseudoStripe",
        "scanCssTextForInsetStripe",
        "scanCssTextForMarquee",
        "isRoundDotRadius",
        "scanCssTextForPulsingDot",
        "scanHtmlForShapeAssembledIllustration",
        "buildHtmlPatternCorpora",
        "checkHtmlPatterns",
    ],
)];

fn rgba(j: Option<&Js>) -> Option<Rgba> {
    match j {
        Some(Js::Obj(_)) => {
            let o = j.unwrap();
            Some(Rgba {
                r: to_number(field(o, "r")),
                g: to_number(field(o, "g")),
                b: to_number(field(o, "b")),
                a: match field(o, "a") {
                    None | Some(Js::Undef) => None,
                    v => Some(to_number(v)),
                },
            })
        }
        _ => None,
    }
}

fn hits_to_js(hits: &[RuleHit]) -> Js {
    Js::Arr(
        hits.iter()
            .map(|h| {
                Js::Obj(vec![
                    ("id".to_string(), Js::Str(h.id.clone())),
                    ("snippet".to_string(), Js::Str(h.snippet.clone())),
                ])
            })
            .collect(),
    )
}

fn indexed_to_js(text: &str, hits: &[IndexedHit]) -> Js {
    Js::Arr(
        hits.iter()
            .map(|h| {
                Js::Obj(vec![
                    (
                        "index".to_string(),
                        Js::Num(utf16_index(text, h.index) as f64),
                    ),
                    ("snippet".to_string(), Js::Str(h.snippet.clone())),
                ])
            })
            .collect(),
    )
}

fn patterns_to_js(text: &str, findings: &[PatternFinding]) -> Js {
    Js::Arr(
        findings
            .iter()
            .map(|f| {
                let mut fields = vec![
                    ("id".to_string(), Js::Str(f.id.clone())),
                    ("snippet".to_string(), Js::Str(f.snippet.clone())),
                ];
                if let Some(sel) = &f.selector {
                    fields.push(("selector".to_string(), Js::Str(sel.clone())));
                }
                if let Some(idx) = f.index {
                    fields.push(("index".to_string(), Js::Num(utf16_index(text, idx) as f64)));
                }
                if let Some(sev) = &f.severity {
                    fields.push(("severity".to_string(), Js::Str(sev.clone())));
                }
                Js::Obj(fields)
            })
            .collect(),
    )
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
    let f = |i: usize, key: &str| -> Option<&Js> { arg(i).and_then(|o| field(o, key)) };
    let result: Js = match fn_name {
        "checkBorders" => {
            let widths = rules::Sides {
                top: to_number(f(1, "Top")),
                right: to_number(f(1, "Right")),
                bottom: to_number(f(1, "Bottom")),
                left: to_number(f(1, "Left")),
            };
            let cs = [
                opt_str(f(2, "Top")),
                opt_str(f(2, "Right")),
                opt_str(f(2, "Bottom")),
                opt_str(f(2, "Left")),
            ];
            let colors = rules::Sides {
                top: cs[0].as_deref(),
                right: cs[1].as_deref(),
                bottom: cs[2].as_deref(),
                left: cs[3].as_deref(),
            };
            let opts = rules::BorderOpts {
                badge_like: truthy(f(4, "badgeLike")),
                status_context: truthy(f(4, "statusContext")),
                tab_context: truthy(f(4, "tabContext")),
            };
            hits_to_js(&rules::check_borders(
                &str_or_empty(arg(0)),
                &widths,
                &colors,
                to_number(arg(3)),
                &opts,
            ))
        }
        "checkColors" => {
            let stops = match f(0, "effectiveBgStops") {
                Some(Js::Arr(items)) => Some(
                    items
                        .iter()
                        .filter_map(|i| rgba(Some(i)))
                        .collect::<Vec<_>>(),
                ),
                _ => None,
            };
            let opts = rules::ColorOpts {
                tag: str_or_empty(f(0, "tag")),
                text_color: rgba(f(0, "textColor")),
                bg_color: rgba(f(0, "bgColor")),
                effective_bg: rgba(f(0, "effectiveBg")),
                effective_bg_stops: stops,
                font_size: to_number(f(0, "fontSize")),
                font_weight: to_number(f(0, "fontWeight")),
                has_direct_text: truthy(f(0, "hasDirectText")),
                is_emoji_only: truthy(f(0, "isEmojiOnly")),
                bg_clip: opt_str(f(0, "bgClip")),
                bg_image: opt_str(f(0, "bgImage")),
                class_list: opt_str(f(0, "classList")),
                detector_is_browser: false,
            };
            hits_to_js(&rules::check_colors(&opts))
        }
        "checkHoverContrast" => {
            let opts = rules::HoverContrastOpts {
                tag: str_or_empty(f(0, "tag")),
                text_color: rgba(f(0, "textColor")),
                bg: rgba(f(0, "bg")),
                own_bg_alpha: match f(0, "ownBgAlpha") {
                    None | Some(Js::Undef) | Some(Js::Null) => None,
                    v => Some(to_number(v)),
                },
                font_size: to_number(f(0, "fontSize")),
                font_weight: to_number(f(0, "fontWeight")),
                has_direct_text: truthy(f(0, "hasDirectText")),
                is_emoji_only: truthy(f(0, "isEmojiOnly")),
            };
            hits_to_js(&rules::check_hover_contrast(&opts))
        }
        "isCardLikeFromProps" => Js::Bool(rules::is_card_like_from_props(
            truthy(arg(0)),
            truthy(arg(1)),
            truthy(arg(2)),
            truthy(arg(3)),
        )),
        "checkIconTile" => {
            let opts = rules::IconTileOpts {
                heading_tag: str_or_empty(f(0, "headingTag")),
                heading_text: opt_str(f(0, "headingText")),
                heading_top: to_number(f(0, "headingTop")),
                sibling_tag: opt_str(f(0, "siblingTag")),
                sibling_width: to_number(f(0, "siblingWidth")),
                sibling_height: to_number(f(0, "siblingHeight")),
                sibling_bottom: to_number(f(0, "siblingBottom")),
                sibling_bg_color: rgba(f(0, "siblingBgColor")),
                sibling_bg_image: opt_str(f(0, "siblingBgImage")),
                sibling_border_width: to_number(f(0, "siblingBorderWidth")),
                sibling_border_radius: to_number(f(0, "siblingBorderRadius")),
                has_icon_child: truthy(f(0, "hasIconChild")),
                icon_child_width: to_number(f(0, "iconChildWidth")),
            };
            hits_to_js(&rules::check_icon_tile(&opts))
        }
        "resolveSerif" => {
            let r = rules::resolve_serif(opt_str(arg(0)).as_deref());
            Js::Obj(vec![
                (
                    "primary".to_string(),
                    r.primary.map(Js::Str).unwrap_or(Js::Null),
                ),
                ("isSerif".to_string(), Js::Bool(r.is_serif)),
            ])
        }
        "checkItalicSerif" => {
            let opts = rules::ItalicSerifOpts {
                tag: str_or_empty(f(0, "tag")),
                font_style: opt_str(f(0, "fontStyle")),
                font_family: opt_str(f(0, "fontFamily")),
                font_size: to_number(f(0, "fontSize")),
                heading_text: opt_str(f(0, "headingText")),
            };
            hits_to_js(&rules::check_italic_serif(&opts))
        }
        "isAccentColor" => Js::Bool(rules::is_accent_color(&str_or_empty(arg(0)))),
        "resolveHeroHeadingSizePx" => Js::Num(rules::resolve_hero_heading_size_px(
            opt_str(arg(0)).as_deref(),
        )),
        "checkHeroEyebrow" => {
            let opts = rules::HeroEyebrowOpts {
                heading_tag: str_or_empty(f(0, "headingTag")),
                heading_text: opt_str(f(0, "headingText")),
                heading_font_size: to_number(f(0, "headingFontSize")),
                heading_in_application_context: truthy(f(0, "headingInApplicationContext")),
                sibling_tag: opt_str(f(0, "siblingTag")),
                sibling_text: opt_str(f(0, "siblingText")),
                sibling_text_transform: opt_str(f(0, "siblingTextTransform")),
                sibling_font_size: to_number(f(0, "siblingFontSize")),
                sibling_letter_spacing: to_number(f(0, "siblingLetterSpacing")),
                sibling_font_weight: opt_str(f(0, "siblingFontWeight")),
                sibling_color: opt_str(f(0, "siblingColor")),
                sibling_has_accent_dash_pseudo: truthy(f(0, "siblingHasAccentDashPseudo")),
            };
            hits_to_js(&rules::check_hero_eyebrow(&opts))
        }
        "checkKickerAboveHeading" => {
            let candidates: Vec<rules::KickerCandidate> = match f(0, "candidates") {
                Some(Js::Arr(items)) => items
                    .iter()
                    .map(|c| rules::KickerCandidate {
                        heading_tag: opt_str(field(c, "headingTag"))
                            .unwrap_or_else(|| "undefined".to_string()),
                        heading_text: opt_str(field(c, "headingText"))
                            .unwrap_or_else(|| "undefined".to_string()),
                        kicker_text: opt_str(field(c, "kickerText"))
                            .unwrap_or_else(|| "undefined".to_string()),
                    })
                    .collect(),
                _ => Vec::new(),
            };
            hits_to_js(&rules::check_kicker_above_heading(&candidates))
        }
        "checkMotion" => {
            let opts = rules::MotionOpts {
                tag: str_or_empty(f(0, "tag")),
                transition_property: opt_str(f(0, "transitionProperty")),
                animation_name: opt_str(f(0, "animationName")),
                timing_functions: opt_str(f(0, "timingFunctions")),
                class_list: opt_str(f(0, "classList")),
            };
            hits_to_js(&rules::check_motion(&opts))
        }
        "checkGlow" => {
            let opts = rules::GlowOpts {
                box_shadow: opt_str(f(0, "boxShadow")),
                text_shadow: opt_str(f(0, "textShadow")),
                effective_bg: rgba(f(0, "effectiveBg")),
            };
            hits_to_js(&rules::check_glow(&opts))
        }
        "cssTextHasDarkRootBg" => {
            let content = str_or_empty(arg(0));
            let props = css_scan::collect_css_custom_props(&content);
            Js::Bool(css_scan::css_text_has_dark_root_bg(&content, &props))
        }
        "scanCssTextForGlow" => {
            let text = str_or_empty(arg(0));
            indexed_to_js(&text, &css_scan::scan_css_text_for_glow(&text))
        }
        "scanCssTextForGridBackground" => {
            let text = str_or_empty(arg(0));
            indexed_to_js(&text, &css_scan::scan_css_text_for_grid_background(&text))
        }
        "scanCssTextForRadialHalo" => {
            let text = str_or_empty(arg(0));
            indexed_to_js(&text, &css_scan::scan_css_text_for_radial_halo(&text))
        }
        "scanCssTextForPseudoStripe" => {
            let raw = str_or_empty(arg(0));
            let out = css_scan::scan_css_text_for_pseudo_stripe(&raw);
            patterns_to_js(&raw, &out)
        }
        "scanCssTextForInsetStripe" => {
            let text = str_or_empty(arg(0));
            patterns_to_js(&text, &css_scan::scan_css_text_for_inset_stripe(&text))
        }
        "scanCssTextForMarquee" => {
            let content = str_or_empty(arg(0));
            let markup = opt_str(arg(1));
            patterns_to_js(
                &content,
                &css_scan::scan_css_text_for_marquee(&content, markup.as_deref()),
            )
        }
        "isRoundDotRadius" => Js::Bool(css_scan::is_round_dot_radius(
            &str_or_empty(arg(0)),
            to_number(arg(1)),
            to_number(arg(2)),
        )),
        "scanCssTextForPulsingDot" => {
            let content = str_or_empty(arg(0));
            let markup = opt_str(arg(1));
            patterns_to_js(
                &content,
                &css_scan::scan_css_text_for_pulsing_dot(&content, markup.as_deref()),
            )
        }
        "scanHtmlForShapeAssembledIllustration" => hits_to_js(
            &html_patterns::scan_html_for_shape_assembled_illustration(&str_or_empty(arg(0))),
        ),
        "buildHtmlPatternCorpora" => {
            let c = html_patterns::build_html_pattern_corpora(&str_or_empty(arg(0)));
            Js::Obj(vec![
                ("styleText".to_string(), Js::Str(c.style_text)),
                ("classText".to_string(), Js::Str(c.class_text)),
            ])
        }
        "checkHtmlPatterns" => {
            let html = str_or_empty(arg(0));
            let corpora = arg(1).map(|c| HtmlPatternCorpora {
                style_text: str_or_empty(field(c, "styleText")),
                class_text: str_or_empty(field(c, "classText")),
            });
            let effective = corpora
                .clone()
                .unwrap_or_else(|| html_patterns::build_html_pattern_corpora(&html));
            let out = html_patterns::check_html_patterns(&html, corpora.as_ref());
            patterns_to_js(&effective.style_text, &out)
        }
        _ => return None,
    };
    Some(encode(&result))
}
