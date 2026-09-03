//! JSON-in / JSON-out wasm exports over the pure `impeccable_core` surface —
//! for the site and other consumers, not the bundle's own scan path.
//!
//! Two layers:
//!
//! - `pure_call(module, fn, args_json)`: the generic dispatcher. `module` and
//!   `fn` are the JS names (`"rules.checks"`, `"checkBorders"`; `"shared.color"`,
//!   `"parseRgb"`; `"shared.inline-ignores"`, ...), `args_json` the JS
//!   positional arguments as a JSON array (the recorder encoding for what JSON
//!   cannot carry: `{"$undef":true}`, `{"$nan":true}`, `{"$inf":1|-1}`,
//!   `{"$negzero":true}`, `{"$map":[[k,v],...]}`, `{"$set":[...]}`), the
//!   result in the same encoding — or `null` for an unknown function. Backed
//!   by `impeccable_core::vectors::call`, the same dispatch the recorded JS
//!   call vectors replay through, so every function it knows is byte-checked
//!   against the JS. `pure_functions()` lists what it knows.
//! - `pure_<snake_name>(args_json)`: one named export per function, same
//!   argument convention (a JSON array of the JS positional args), for callers
//!   that prefer a fixed name over the dispatcher.
//!
//! Plus a few core helpers the dispatcher does not carry (findings, registry
//! lookups, the two measures color helpers).

use serde_json::{json, Value};
use wasm_bindgen::prelude::*;

fn args_of(args_json: &str) -> Vec<Value> {
    match serde_json::from_str::<Value>(args_json) {
        Ok(Value::Array(a)) => a,
        Ok(Value::Null) | Err(_) => Vec::new(),
        Ok(other) => vec![other],
    }
}

fn dispatch(module: &str, name: &str, args_json: &str) -> String {
    let args = args_of(args_json);
    impeccable_core::vectors::call(module, name, &args)
        .unwrap_or(Value::Null)
        .to_string()
}

/// The generic dispatcher over every pure function the core replays.
#[wasm_bindgen]
pub fn pure_call(module: &str, name: &str, args_json: &str) -> String {
    dispatch(module, name, args_json)
}

/// `[{ module, functions: [...] }]` — what `pure_call` knows.
#[wasm_bindgen]
pub fn pure_functions() -> String {
    // `KNOWN_FUNCTIONS` is the union of foundation's arms and the core's.
    let mut out: Vec<Value> = Vec::new();
    for (module, fns) in impeccable_core::vectors::KNOWN_FUNCTIONS.iter() {
        out.push(json!({ "module": module, "functions": fns }));
    }
    Value::Array(out).to_string()
}

macro_rules! pure_exports {
    ($( $rust:ident => ($module:literal, $js:literal) ),* $(,)?) => {
        $(
            #[doc = concat!("`", $module, ".", $js, "(...args)`: `args_json` is the JSON array of positional args.")]
            #[wasm_bindgen]
            pub fn $rust(args_json: &str) -> String {
                dispatch($module, $js, args_json)
            }
        )*
    };
}

pure_exports! {
    // ── rules.checks: Section 3 pure checks ──
    pure_check_borders => ("rules.checks", "checkBorders"),
    pure_is_emoji_only_text => ("rules.checks", "isEmojiOnlyText"),
    pure_check_colors => ("rules.checks", "checkColors"),
    pure_check_hover_contrast => ("rules.checks", "checkHoverContrast"),
    pure_is_card_like_from_props => ("rules.checks", "isCardLikeFromProps"),
    pure_check_icon_tile => ("rules.checks", "checkIconTile"),
    pure_resolve_serif => ("rules.checks", "resolveSerif"),
    pure_check_italic_serif => ("rules.checks", "checkItalicSerif"),
    pure_is_accent_color => ("rules.checks", "isAccentColor"),
    pure_resolve_hero_heading_size_px => ("rules.checks", "resolveHeroHeadingSizePx"),
    pure_check_hero_eyebrow => ("rules.checks", "checkHeroEyebrow"),
    pure_check_kicker_above_heading => ("rules.checks", "checkKickerAboveHeading"),
    pure_check_motion => ("rules.checks", "checkMotion"),
    pure_check_glow => ("rules.checks", "checkGlow"),
    // ── rules.checks: CSS-text scanners ──
    pure_collect_css_custom_props => ("rules.checks", "collectCssCustomProps"),
    pure_css_text_has_dark_root_bg => ("rules.checks", "cssTextHasDarkRootBg"),
    pure_enclosing_css_selector => ("rules.checks", "enclosingCssSelector"),
    pure_scan_css_text_for_glow => ("rules.checks", "scanCssTextForGlow"),
    pure_scan_css_text_for_grid_background => ("rules.checks", "scanCssTextForGridBackground"),
    pure_scan_css_text_for_radial_halo => ("rules.checks", "scanCssTextForRadialHalo"),
    pure_css_length_to_px => ("rules.checks", "cssLengthToPx"),
    pure_is_zero_offset => ("rules.checks", "isZeroOffset"),
    pure_scan_css_text_for_pseudo_stripe => ("rules.checks", "scanCssTextForPseudoStripe"),
    pure_scan_css_text_for_inset_stripe => ("rules.checks", "scanCssTextForInsetStripe"),
    pure_collect_marquee_keyframes => ("rules.checks", "collectMarqueeKeyframes"),
    pure_scan_css_text_for_marquee => ("rules.checks", "scanCssTextForMarquee"),
    pure_collect_pulse_keyframes => ("rules.checks", "collectPulseKeyframes"),
    pure_is_round_dot_radius => ("rules.checks", "isRoundDotRadius"),
    pure_strip_reduced_motion_blocks => ("rules.checks", "stripReducedMotionBlocks"),
    pure_scan_css_text_for_pulsing_dot => ("rules.checks", "scanCssTextForPulsingDot"),
    // ── rules.checks: HTML patterns ──
    pure_scan_html_for_shape_assembled_illustration => ("rules.checks", "scanHtmlForShapeAssembledIllustration"),
    pure_build_html_pattern_corpora => ("rules.checks", "buildHtmlPatternCorpora"),
    pure_check_html_patterns => ("rules.checks", "checkHtmlPatterns"),
    // ── rules.checks: measures / text rules ──
    pure_parse_radius_to_px => ("rules.checks", "parseRadiusToPx"),
    pure_resolve_var_refs => ("rules.checks", "resolveVarRefs"),
    pure_parse_color_resolved => ("rules.checks", "parseColorResolved"),
    pure_resolve_length_px => ("rules.checks", "resolveLengthPx"),
    pure_check_radial_spotlight => ("rules.checks", "checkRadialSpotlight"),
    pure_check_oversized_h1 => ("rules.checks", "checkOversizedH1"),
    pure_shadow_max_blur_px => ("rules.checks", "shadowMaxBlurPx"),
    pure_check_gpt_thin_border_wide_shadow => ("rules.checks", "checkGptThinBorderWideShadow"),
    pure_check_content_hidden_at_rest => ("rules.checks", "checkContentHiddenAtRest"),
    pure_is_cream_color => ("rules.checks", "isCreamColor"),
    pure_is_kicker_candidate => ("rules.checks", "isKickerCandidate"),
    pure_parse_numbered_label_text => ("rules.checks", "parseNumberedLabelText"),
    pure_is_numbered_section_label_candidate => ("rules.checks", "isNumberedSectionLabelCandidate"),
    pure_check_numbered_section_labels => ("rules.checks", "checkNumberedSectionLabels"),
    pure_check_em_dash_overuse => ("rules.checks", "checkEmDashOveruse"),
    // ── shared.color ──
    pure_is_neutral_color => ("shared.color", "isNeutralColor"),
    pure_parse_rgb => ("shared.color", "parseRgb"),
    pure_relative_luminance => ("shared.color", "relativeLuminance"),
    pure_contrast_ratio => ("shared.color", "contrastRatio"),
    pure_parse_gradient_colors => ("shared.color", "parseGradientColors"),
    pure_extract_color_function_tokens => ("shared.color", "extractColorFunctionTokens"),
    pure_has_chroma => ("shared.color", "hasChroma"),
    pure_get_hue => ("shared.color", "getHue"),
    pure_color_to_hex => ("shared.color", "colorToHex"),
    pure_oklab_to_rgb => ("shared.color", "oklabToRgb"),
    pure_oklch_to_rgb => ("shared.color", "oklchToRgb"),
    pure_lab_to_rgb => ("shared.color", "labToRgb"),
    pure_lch_to_rgb => ("shared.color", "lchToRgb"),
    pure_color_function_to_rgb => ("shared.color", "colorFunctionToRgb"),
    pure_hsl_to_rgb => ("shared.color", "hslToRgb"),
    pure_hwb_to_rgb => ("shared.color", "hwbToRgb"),
    pure_split_top_level_commas => ("shared.color", "splitTopLevelCommas"),
    pure_parse_color_mix => ("shared.color", "parseColorMix"),
    pure_parse_any_color => ("shared.color", "parseAnyColor"),
    pure_composite_color_over => ("shared.color", "compositeColorOver"),
    pure_is_no_paint_color_value => ("shared.color", "isNoPaintColorValue"),
    // ── shared.inline-ignores ──
    pure_parse_inline_ignores => ("shared.inline-ignores", "parseInlineIgnores"),
    pure_is_inline_ignored => ("shared.inline-ignores", "isInlineIgnored"),
    pure_apply_inline_ignores => ("shared.inline-ignores", "applyInlineIgnores"),
}

// ── helpers outside the dispatcher ──────────────────────────────────────────

fn str_arg(args: &[Value], i: usize) -> Option<String> {
    match args.get(i) {
        Some(Value::String(s)) => Some(s.clone()),
        _ => None,
    }
}

fn num_arg(args: &[Value], i: usize) -> f64 {
    match args.get(i) {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(s)) => impeccable_core::js::string_to_number(s),
        Some(Value::Null) => 0.0,
        Some(Value::Bool(true)) => 1.0,
        Some(Value::Bool(false)) => 0.0,
        _ => f64::NAN,
    }
}

/// `cssColorIsTransparent(value)`: `[value]`.
#[wasm_bindgen]
pub fn pure_css_color_is_transparent(args_json: &str) -> String {
    let a = args_of(args_json);
    json!(impeccable_core::checks::measures::css_color_is_transparent(str_arg(&a, 0).as_deref())).to_string()
}

/// `colorsNearlyMatch(a, b)`: `[a, b]`.
#[wasm_bindgen]
pub fn pure_colors_nearly_match(args_json: &str) -> String {
    let a = args_of(args_json);
    json!(impeccable_core::checks::measures::colors_nearly_match(
        str_arg(&a, 0).as_deref(),
        str_arg(&a, 1).as_deref()
    ))
    .to_string()
}

/// `finding(id, filePath, snippet, line)`: `[id, filePath, snippet, line]`;
/// `null` for an unknown rule id (where the JS would throw).
#[wasm_bindgen]
pub fn pure_finding(args_json: &str) -> String {
    let a = args_of(args_json);
    let id = str_arg(&a, 0).unwrap_or_default();
    let file = str_arg(&a, 1).unwrap_or_default();
    let snippet = str_arg(&a, 2).unwrap_or_default();
    let line = num_arg(&a, 3);
    match impeccable_core::findings::try_finding(&id, &file, &snippet, line) {
        Some(f) => serde_json::to_value(&f).unwrap_or(Value::Null).to_string(),
        None => "null".to_string(),
    }
}

/// `getAntipattern(id)`: `[id]` → the registry entry or `null`.
#[wasm_bindgen]
pub fn pure_get_antipattern(args_json: &str) -> String {
    let a = args_of(args_json);
    let id = str_arg(&a, 0).unwrap_or_default();
    match impeccable_core::registry::get_antipattern(&id) {
        Some(ap) => antipattern_json(ap).to_string(),
        None => "null".to_string(),
    }
}

/// `isAdvisoryRule(id)`: `[id]`.
#[wasm_bindgen]
pub fn pure_is_advisory_rule(args_json: &str) -> String {
    let a = args_of(args_json);
    json!(impeccable_core::registry::is_advisory_rule(&str_arg(&a, 0).unwrap_or_default())).to_string()
}

/// `RULE_SCOPES`.
#[wasm_bindgen]
pub fn pure_rule_scopes(_args_json: &str) -> String {
    json!(impeccable_core::registry::rule_scopes()).to_string()
}

/// `getRulesForCategory(category)`: `[category]`.
#[wasm_bindgen]
pub fn pure_get_rules_for_category(args_json: &str) -> String {
    let a = args_of(args_json);
    let rows: Vec<Value> = impeccable_core::registry::get_rules_for_category(&str_arg(&a, 0).unwrap_or_default())
        .into_iter()
        .map(antipattern_json)
        .collect();
    Value::Array(rows).to_string()
}

/// `getRuleEngineSupport(engine)`: `[engine]`.
#[wasm_bindgen]
pub fn pure_get_rule_engine_support(args_json: &str) -> String {
    let a = args_of(args_json);
    json!(impeccable_core::registry::get_rule_engine_support(&str_arg(&a, 0).unwrap_or_default())).to_string()
}

fn antipattern_json(ap: &impeccable_core::registry::Antipattern) -> Value {
    let mut m = serde_json::Map::new();
    m.insert("id".into(), json!(ap.id));
    m.insert("category".into(), json!(ap.category));
    if let Some(s) = ap.scopes {
        m.insert("scopes".into(), json!(s));
    }
    if let Some(s) = ap.severity {
        m.insert("severity".into(), json!(s));
    }
    m.insert("name".into(), json!(ap.name));
    m.insert("description".into(), json!(ap.description));
    if let Some(s) = ap.skill_section {
        m.insert("skillSection".into(), json!(s));
    }
    if let Some(s) = ap.skill_guideline {
        m.insert("skillGuideline".into(), json!(s));
    }
    Value::Object(m)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dispatcher_round_trips() {
        assert_eq!(pure_parse_rgb(r#"["rgb(1, 2, 3)"]"#), r#"{"r":1,"g":2,"b":3,"a":1}"#);
        assert_eq!(pure_call("shared.color", "contrastRatio", r#"[{"r":0,"g":0,"b":0},{"r":255,"g":255,"b":255}]"#), "21");
        let hits = pure_check_em_dash_overuse(r#"["a — b — c — d — e — f — g — h — i"]"#);
        assert!(hits.contains("em-dash-overuse"), "{hits}");
        assert_eq!(pure_call("nope", "nope", "[]"), "null");
        assert!(pure_functions().contains("checkBorders"));
        assert_eq!(pure_css_color_is_transparent(r#"["transparent"]"#), "true");
        assert!(pure_get_antipattern(r#"["side-tab"]"#).contains("\"name\""));
        assert!(pure_finding(r#"["side-tab","a.html","x",3]"#).contains("\"antipattern\":\"side-tab\""));
    }
}
