//! Advisory geometry check, shared by static HTML and rendered DOM scans.
use crate::checks::measures::CSS_COLOR_TOKEN_RE;
use crate::checks::rules::RuleHit;
use crate::color::parse_any_color;
use crate::js_ext_a::split_commas_outside_parens;

/// Four CSS pixels separates the fixture's deliberate displaced slabs from
/// its small offset accents. This is a review threshold, not a design standard.
/// Negative spread and unresolved lengths/colors stay outside this first rule.
pub fn check_hard_offset_shadow(shadow: &str, current_color: &str, opacity: f64) -> Vec<RuleHit> {
    for layer in split_commas_outside_parens(shadow) {
        let token = CSS_COLOR_TOKEN_RE.find(layer);
        let color_text = token.as_ref().map(|m| m.as_str()).unwrap_or(current_color);
        let color_text = if color_text.eq_ignore_ascii_case("currentcolor") {
            current_color
        } else {
            color_text
        };
        let Some(color) = parse_any_color(Some(color_text)) else {
            continue;
        };
        if !opacity.is_finite() || color.alpha_or_one() * opacity <= 0.1 {
            continue;
        }
        let lengths = CSS_COLOR_TOKEN_RE.replace_all(layer, " ");
        let values: Option<Vec<f64>> = lengths
            .split_whitespace()
            .map(|s| {
                // Computed pixels, plus CSS's unitless zero. Never read 4em as 4px
                // or the numeric fallback inside an unresolved var()/calc().
                let (number, pixels) = s
                    .strip_suffix("px")
                    .map(|n| (n, true))
                    .unwrap_or((s, false));
                let n = number.parse::<f64>().ok()?;
                (n.is_finite() && (pixels || n == 0.0)).then_some(n)
            })
            .collect();
        let Some(v) = values else { continue };
        if !(2..=4).contains(&v.len()) {
            continue;
        }
        let blur = v.get(2).copied().unwrap_or(0.0);
        let spread = v.get(3).copied().unwrap_or(0.0);
        if blur == 0.0 && spread >= 0.0 && v[0].abs().max(v[1].abs()) >= 4.0 {
            return vec![RuleHit::new("hard-offset-shadow", format!(
                "box-shadow: {} — hard offset with no blur; check whether this belongs to the intended visual direction", layer.trim()
            ))];
        }
    }
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;
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
