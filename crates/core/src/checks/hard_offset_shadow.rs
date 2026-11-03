//! Advisory geometry check, shared by static HTML and rendered DOM scans.
use crate::checks::rules::RuleHit;
use crate::color::{parse_any_color, Rgba, COLOR_FUNCTION_NAMES};
use cssparser::{Parser, ParserInput, Token};

/// Four CSS pixels separates the fixture's deliberate displaced slabs from
/// its small offset accents. This is a review threshold, not a design standard.
/// Negative spread and unresolved lengths/colors stay outside this first rule.
pub fn check_hard_offset_shadow(shadow: &str, current_color: &str, opacity: f64) -> Vec<RuleHit> {
    if !has_shadow(shadow) {
        return Vec::new();
    }
    let mut input = ParserInput::new(shadow);
    let mut parser = Parser::new(&mut input);
    // A malformed layer invalidates the entire CSS declaration, including a
    // matching layer before it. Do not emit findings until every layer parses.
    // Unresolved values likewise cannot establish a visible shadow here.
    let layers: Result<_, cssparser::ParseError<'_, ()>> = parser.parse_comma_separated(|parser| {
        let start = parser.position();
        let layer = parse_layer(parser, current_color).ok_or_else(|| parser.new_custom_error(()))?;
        Ok((parser.slice_from(start), layer))
    });
    let Ok(layers) = layers else {
        return Vec::new();
    };
    for (text, layer) in layers {
        let v = &layer.lengths;
        if layer.inset || !opacity.is_finite() || layer.color.alpha_or_one() * opacity <= 0.1 {
            continue;
        }
        let blur = v.get(2).copied().unwrap_or(0.0);
        let spread = v.get(3).copied().unwrap_or(0.0);
        if blur == 0.0 && spread >= 0.0 && v[0].abs().max(v[1].abs()) >= 4.0 {
            return vec![RuleHit::new("hard-offset-shadow", format!(
                "box-shadow: {}: hard offset with no blur; check whether this belongs to the intended visual direction", text.trim()
            ))];
        }
    }
    Vec::new()
}

/// The rule runs on every element in both engines, so an absent shadow
/// returns before the tokenizer or an ancestor walk runs.
pub fn has_shadow(shadow: &str) -> bool {
    let shadow = shadow.trim();
    !shadow.is_empty() && !shadow.eq_ignore_ascii_case("none")
}

const LENGTH_UNITS: &[&str] = &[
    "px", "em", "rem", "ex", "rex", "ch", "rch", "cap", "rcap", "ic", "ric", "lh", "rlh", "vw", "vh",
    "vi", "vb", "vmin", "vmax", "svw", "svh", "lvw", "lvh", "dvw", "dvh", "cqw", "cqh", "cqi", "cqb",
    "cqmin", "cqmax", "cm", "mm", "q", "in", "pt", "pc",
];

fn is_length_unit(unit: &str) -> bool {
    LENGTH_UNITS.iter().any(|u| unit.eq_ignore_ascii_case(u))
}

struct ShadowLayer {
    lengths: Vec<f64>,
    color: Rgba,
    inset: bool,
}

fn shadow_color(paint: &str) -> Option<Rgba> {
    if paint.eq_ignore_ascii_case("transparent") {
        Some(Rgba::new(0.0, 0.0, 0.0, 0.0))
    } else {
        parse_any_color(Some(paint))
    }
}

// The static CSS serializer can omit whitespace between tokens (0#333 or
// rgb(0,0,0)4px). Tokenize CSS rather than splitting on spaces, keeping nested
// color functions whole and rejecting unresolved lengths and unknown paint.
fn parse_layer(parser: &mut Parser<'_, '_>, current_color: &str) -> Option<ShadowLayer> {
    let mut lengths = Vec::new();
    let mut color = None;
    let mut inset = false;
    let mut lengths_closed = false;
    while !parser.is_exhausted() {
        parser.skip_whitespace();
        let start = parser.position();
        let token = parser.next().ok()?.clone();
        let paint = match token {
            Token::Dimension { value, unit, .. }
                if unit.eq_ignore_ascii_case("px") && value.is_finite() =>
            {
                // Keep the f64 threshold precision used by this check; the
                // tokenizer stores numeric values as f32.
                let raw = parser.slice_from(start);
                let value = raw[..raw.len() - unit.len()].parse::<f64>().ok()?;
                if !value.is_finite() || lengths_closed {
                    return None;
                }
                lengths.push(value);
                continue;
            }
            // A zero length is zero in every unit (`0em` blur paints the same
            // hard edge as `0px`); other non-px lengths stay unresolved.
            Token::Dimension { value, ref unit, .. } if value == 0.0 && is_length_unit(unit) => {
                if lengths_closed {
                    return None;
                }
                lengths.push(0.0);
                continue;
            }
            Token::Number { .. } if parser.slice_from(start).parse::<f64>().ok()? == 0.0 => {
                if lengths_closed {
                    return None;
                }
                lengths.push(0.0);
                continue;
            }
            Token::Ident(ref name) if name.eq_ignore_ascii_case("inset") => {
                if inset {
                    return None;
                }
                inset = true;
                lengths_closed |= !lengths.is_empty();
                continue;
            }
            Token::Ident(ref name) if name.eq_ignore_ascii_case("currentcolor") => current_color,
            Token::Ident(_) | Token::Hash(_) | Token::IDHash(_) => parser.slice_from(start),
            Token::Function(ref name)
                if COLOR_FUNCTION_NAMES
                    .iter()
                    .any(|f| name.eq_ignore_ascii_case(f)) =>
            {
                parser
                    .parse_nested_block(|nested| {
                        while nested.next_including_whitespace_and_comments().is_ok() {}
                        Ok::<_, cssparser::ParseError<'_, ()>>(())
                    })
                    .ok()?;
                parser.slice_from(start)
            }
            _ => return None,
        };
        // Color and inset may surround the length group, but cannot split it.
        lengths_closed |= !lengths.is_empty();
        let parsed = shadow_color(paint)?;
        if color.replace(parsed).is_some() {
            return None;
        }
    }
    if !(2..=4).contains(&lengths.len()) || lengths.get(2).is_some_and(|blur| *blur < 0.0) {
        return None;
    }
    Some(ShadowLayer {
        lengths,
        color: color.or_else(|| shadow_color(current_color))?,
        inset,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn invalid_layer_rejects_the_entire_shadow_list() {
        for invalid in [
            "0 0 -1px black",
            "inset 0 0 -1px black",
            "4px black",
            "0 0 0 0 0 black",
            "4px 4px red blue",
            "4px red 4px",
            "4px inset 4px",
            "inset inset 4px 4px",
            "4px 4px notacolor",
            "none",
            "",
        ] {
            for shadow in [
                format!("{invalid}, 4px 4px black"),
                format!("4px 4px black, {invalid}"),
            ] {
                assert!(check_hard_offset_shadow(&shadow, "black", 1.0).is_empty(), "{shadow}");
            }
        }
    }

    #[test]
    fn valid_nonmatching_layers_preserve_outer_shadow_advisories() {
        for control in [
            "inset 4px 4px black",
            "4px 4px black inset",
            "black inset 4px 4px",
            "0 0 1px black",
            "0 0 0 -1px black",
            "0 0 transparent",
            "0 0 TRANSPARENT",
            "0 0 rgba(0, 0, 0, 0.1)",
            "0 0 color-mix(in srgb, rgb(255, 0, 0) 50%, blue)",
        ] {
            for shadow in [
                format!("{control}, 4px 4px black"),
                format!("4px 4px black, {control}"),
            ] {
                assert_eq!(check_hard_offset_shadow(&shadow, "black", 1.0).len(), 1, "{shadow}");
            }
        }
    }

    #[test]
    fn named_and_functional_shadow_colors() {
        for shadow in [
            "4px 4px red",
            "4px 4px 0#333",
            "rgb(255,0,0)4px 4px",
            "gray -4px 4px",
            "4px 4px ReBeccAPurple",
            "4px 4px hwb(0 0% 0%)",
            "hwb(0 0% 0% / 50%) 4px 4px",
            "4px 4px color(srgb 1 0 0)",
            "4px 4px color-mix(in srgb, rgb(255, 0, 0) 50%, blue)",
            "4px 4px currentColor",
            "4px 4px",
        ] {
            assert_eq!(
                check_hard_offset_shadow(shadow, "red", 1.0).len(),
                1,
                "{shadow}"
            );
        }
        for shadow in [
            "4px 4px hwb(0 0% 0% / 10%)",
            "4px 4px TRANSPARENT",
            "4px 4px red blue",
            "red 4px blue 4px",
            "4px 4px notacolor",
            "4px 4px var(--color, red)",
            "4px 4px var(--color, rgb(255,0,0))",
            "4px 4px red)",
            "4px 4px hwb(0 0% 0%",
            "inset 4px 4px red",
        ] {
            assert!(
                check_hard_offset_shadow(shadow, "red", 1.0).is_empty(),
                "{shadow}"
            );
        }
        assert!(check_hard_offset_shadow("4px 4px hwb(0 0% 0% / 50%)", "red", 0.2).is_empty());
    }

    #[test]
    fn review_cases_named_colors_zero_blur_and_invisible_paint() {
        for s in [
            "4px 4px black",
            "4px 4px 0 black",
            "4px 4px 0px black",
            "4px 4px 0em black",
            "4px 4px 0rem 0vw black",
            "4px 4px 0.0em black",
        ] {
            assert_eq!(check_hard_offset_shadow(s, "black", 1.0).len(), 1, "{s}");
        }
        for s in [
            "4px 4px 0 transparent",
            "4px 4px 0 rgba(0, 0, 0, 0)",
            "4px 4px 0 rgb(0 0 0 / 0)",
            "4px 4px 0 hsla(0, 0%, 0%, 0)",
            "4px 4px 0 hsl(0 0% 0% / 0%)",
            "4px 4px 1em black",
            "4px 4px 0deg black",
            "4px 4px 0% black",
        ] {
            assert!(check_hard_offset_shadow(s, "black", 1.0).is_empty(), "{s}");
        }
    }

    #[test]
    fn resolved_layers_and_boundaries() {
        for s in [
            "4px 4px 0 #333",
            "-6px 6px #333",
            "0 4px 0 black",
            "4px 4px",
            "4px 4px currentColor",
            "0 0 0 transparent, 4px 4px #333",
        ] {
            assert_eq!(check_hard_offset_shadow(s, "#333", 1.0).len(), 1, "{s}");
        }
        for s in [
            "3.99px 3.99px #333",
            "3.99999999px 3.99999999px red",
            "4px 4px 0.1px #333",
            "inset 4px 4px 0 #333",
            "0 0 0 4px #333",
            "4px 4px 0 transparent",
            "4px 4px rgba(0,0,0,.1)",
            "4px 4px 0 -8px #333",
            "4em 4em #333",
            "var(--shadow, 4px 4px #333)",
            "calc(2px + 2px) 4px #333",
            "4px 4px color(unknown 0 0 0)",
            "none",
        ] {
            assert!(check_hard_offset_shadow(s, "#333", 1.0).is_empty(), "{s}");
        }
        assert!(check_hard_offset_shadow("4px 4px #333", "#333", 0.0).is_empty());
        assert!(check_hard_offset_shadow("4px 4px", "transparent", 1.0).is_empty());
    }
}
