//! Port of `cli/engine/rules/checks.mjs` Section 3: the pure element checks
//! and their helpers. Every function keeps the JS name in its doc comment;
//! opts objects become structs whose `Option` fields mirror the JS
//! `undefined` / `null` distinctions the source relies on.

use crate::checks::text_rules::NON_RENDERED_TAGS;
use crate::color::{
    color_to_hex, composite_color_over, contrast_ratio, get_hue, has_chroma, is_gray_ink,
    is_neutral_color, lightness_saturation, relative_luminance, Rgba, GRAY_INK_MAX_LIGHTNESS,
};
use crate::constants::{
    BORDER_SAFE_TAGS, GENERIC_FONTS, KNOWN_SERIF_FONTS, SAFE_TAGS, WCAG_LARGE_BOLD_TEXT_PX,
    WCAG_LARGE_TEXT_PX,
};
use crate::js::{
    self, ci, math_max, math_round, number_to_string, parse_float, parse_int, string_to_number,
    to_fixed, WS,
};
use crate::js_ext_a::{num_truthy, slice_utf16_start, split_commas_outside_parens, utf16_length};
use once_cell::sync::Lazy;
use regex::Regex;

/// The hit and option structs these checks are written against are shared;
/// re-exported so `checks::rules` stays one path.
pub use impeccable_foundation::rules::types::*;

macro_rules! re {
    ($name:ident, $pat:expr) => {
        static $name: Lazy<Regex> = Lazy::new(|| Regex::new(&$pat).expect(stringify!($name)));
    };
}

const SIDE_NAMES: [&str; 4] = ["Top", "Right", "Bottom", "Left"];

/// How much corner radius a box needs before it reads as a rounded card.
/// Under this the corners look square at reading distance.
pub const SIDE_ACCENT_MIN_RADIUS_PX: f64 = 4.0;

/// Whether a stripe on side `[Top, Right, Bottom, Left][i]` sits on a rounded
/// box. A side accent is the AI card tell only on a rounded card; the square
/// version is an older convention (a callout's severity rule, a pull quote, a
/// table row marker) and says nothing. The corners that decide it are the two
/// the stripe does not touch, so a box rounded only along the stripe
/// (`border-radius: 8px 0 0 8px` under a left rule) still reads as square.
/// `None` is unknown, not square: a caller that could not read the corners
/// (a radius the engine cannot resolve, a snapshot without the column, the
/// recorded call vectors) keeps its finding.
pub fn is_rounded_away_from_side(corners: Option<&Corners>, i: usize) -> bool {
    let Some(corners) = corners else {
        return true;
    };
    let (a, b) = corners.away_from(i);
    a >= SIDE_ACCENT_MIN_RADIUS_PX && b >= SIDE_ACCENT_MIN_RADIUS_PX
}

/// The box a text-only reader assumes when a radius is a percentage: no
/// element is in hand, and any percentage an author writes rounds a card
/// visibly at card size.
pub const NOMINAL_CARD_WIDTH_PX: f64 = 1000.0;

/// Corner radii gathered from authored declarations, for the producers that
/// read source text rather than a computed style: the CSS-text stripe scans
/// and the regex engine's side accent matchers. Declarations apply in source
/// order, so a later shorthand resets an earlier longhand and a later
/// longhand overrides one corner of an earlier shorthand. A corner is `None`
/// when a declaration that set it could not be resolved.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DeclaredCorners {
    /// `[top-left, top-right, bottom-right, bottom-left]`.
    corners: [Option<f64>; 4],
    declared: bool,
}

/// No declaration yet: every corner at the cascade's `0`.
impl Default for DeclaredCorners {
    fn default() -> Self {
        DeclaredCorners {
            corners: [Some(0.0); 4],
            declared: false,
        }
    }
}

impl DeclaredCorners {
    /// Every corner at once, the way the `border-radius` shorthand sets them.
    pub fn set_all(&mut self, corners: Option<Corners>) {
        self.declared = true;
        self.corners = match corners {
            Some(c) => [
                Some(c.top_left),
                Some(c.top_right),
                Some(c.bottom_right),
                Some(c.bottom_left),
            ],
            None => [None; 4],
        };
    }

    /// One corner, `[top-left, top-right, bottom-right, bottom-left][i]`.
    pub fn set_corner(&mut self, i: usize, px: Option<f64>) {
        self.declared = true;
        self.corners[i] = px;
    }

    /// One corner raised to at least `px`: a conditional class (`md:rounded-lg`)
    /// can round the card, so it never squares one off.
    pub fn raise_corner(&mut self, i: usize, px: Option<f64>) {
        self.declared = true;
        self.corners[i] = match (self.corners[i], px) {
            (Some(a), Some(b)) => Some(a.max(b)),
            _ => None,
        };
    }

    /// Every corner raised to at least `other`'s, an unknown corner staying
    /// unknown: the largest radius any of several declarations can give each
    /// corner. Nothing happens when `other` declared nothing.
    pub fn raise_to(&mut self, other: &DeclaredCorners) {
        if !other.declared {
            return;
        }
        for i in 0..4 {
            self.raise_corner(i, other.corners[i]);
        }
    }

    /// A box whose corners the reader cannot see: every corner unknown, so a
    /// side accent on it keeps its finding until a later literal radius
    /// replaces them.
    pub fn unknown() -> Self {
        let mut corners = DeclaredCorners::default();
        corners.set_unknown();
        corners
    }

    /// Every corner unknown from here on: what a construct the reader cannot
    /// see through does to the corners (a mixin call, a spread, a bare
    /// interpolation). A later literal declaration still replaces them.
    pub fn set_unknown(&mut self) {
        self.set_all(None);
    }

    /// The corners in px when every one is known, the cascade default `0`
    /// where nothing declared one.
    pub fn to_corners(&self) -> Option<Corners> {
        Some(Corners {
            top_left: self.corners[0]?,
            top_right: self.corners[1]?,
            bottom_right: self.corners[2]?,
            bottom_left: self.corners[3]?,
        })
    }

    /// Apply one declaration when it names a radius: the `border-radius`
    /// shorthand, a physical or logical corner longhand, in CSS spelling or
    /// the camelCase a style object uses. A bare number on a camelCase
    /// property is px, the way a React style object reads it. Returns whether
    /// the property was a radius.
    pub fn apply(&mut self, prop: &str, value: &str, width_px: f64) -> bool {
        let camel = !prop.contains('-') && prop.chars().any(|c| c.is_ascii_uppercase());
        let key: String = prop
            .chars()
            .filter(|c| *c != '-')
            .map(|c| c.to_ascii_lowercase())
            .collect();
        let corner = match key.as_str() {
            "borderradius" => None,
            "bordertopleftradius" | "borderstartstartradius" => Some(0),
            "bordertoprightradius" | "borderstartendradius" => Some(1),
            "borderbottomrightradius" | "borderendendradius" => Some(2),
            "borderbottomleftradius" | "borderendstartradius" => Some(3),
            _ => return false,
        };
        re!(IMPORTANT_TAIL, format!(r"(?i){WS}*!{WS}*important{WS}*$"));
        re!(BARE_NUMBER, r"^-?(?:[0-9]+\.?[0-9]*|\.[0-9]+)$".to_string());
        let unquoted = js::trim(value).trim_matches(|c| c == '"' || c == '\'' || c == '`');
        let cleaned = IMPORTANT_TAIL.replace(js::trim(unquoted), "");
        let mut v = js::trim(&cleaned).to_string();
        if camel && BARE_NUMBER.is_match(&v) {
            v.push_str("px");
        }
        match corner {
            None => self.set_all(crate::checks::measures::parse_radius_corners(
                Some(&v),
                width_px,
            )),
            Some(i) => self.set_corner(
                i,
                crate::checks::measures::parse_radius_corner_px(Some(&v), width_px),
            ),
        }
        true
    }

    /// Whether any radius declaration was seen at all.
    pub fn declared(&self) -> bool {
        self.declared
    }

    /// The source-text reading of [`is_rounded_away_from_side`]. A box with
    /// no radius declaration is square, the way the cascade defaults it. A
    /// corner some declaration set to a value the reader could not resolve
    /// is unknown, and an unknown corner keeps the finding.
    pub fn is_rounded_away_from_side(&self, i: usize) -> bool {
        if !self.declared {
            return false;
        }
        let (a, b) = match i {
            0 => (self.corners[3], self.corners[2]),
            1 => (self.corners[0], self.corners[3]),
            2 => (self.corners[0], self.corners[1]),
            _ => (self.corners[1], self.corners[2]),
        };
        match (a, b) {
            (Some(a), Some(b)) => a >= SIDE_ACCENT_MIN_RADIUS_PX && b >= SIDE_ACCENT_MIN_RADIUS_PX,
            _ => true,
        }
    }
}

re!(
    TW_ROUNDED_CLASS_RE,
    r"^rounded(?:-(tl|tr|br|bl|ss|se|ee|es|t|r|b|l|s|e))?(?:-([a-z0-9-]+|\[[^\]]*\]|\([^)]*\)))?$"
        .to_string()
);
re!(TW_CLASS_SPLIT_RE, r#"[\s"'`{}]+"#.to_string());

/// The corners a run of utility classes gives a box. `rounded-*` classes set
/// every corner, then the side classes (`rounded-r-lg`), then the corner
/// classes (`rounded-tr-lg`), the order the framework emits them in, so
/// `rounded-lg rounded-r-none` squares the right corners off. A class behind
/// a variant (`md:rounded-xl`) can only round a corner. A size the scale
/// does not name (a theme key, a `(--var)`) is unknown.
pub fn tailwind_declared_corners(scope: &str) -> DeclaredCorners {
    let mut base: Vec<(u8, &'static [usize], Option<f64>)> = Vec::new();
    let mut variants: Vec<(&'static [usize], Option<f64>)> = Vec::new();
    for raw in TW_CLASS_SPLIT_RE.split(scope) {
        let token = raw.trim_matches('!');
        let bracket = token.find('[').unwrap_or(token.len());
        let (variant, class) = match token[..bracket].rfind(':') {
            Some(i) => (true, token[i + 1..].trim_start_matches('!')),
            None => (false, token),
        };
        let Some(c) = TW_ROUNDED_CLASS_RE.captures(class) else {
            continue;
        };
        let (group, corners): (u8, &'static [usize]) = match c.get(1).map(|m| m.as_str()) {
            None => (0, &[0, 1, 2, 3]),
            Some("t") => (1, &[0, 1]),
            Some("r") | Some("e") => (1, &[1, 2]),
            Some("b") => (1, &[2, 3]),
            Some("l") | Some("s") => (1, &[0, 3]),
            Some("tl") | Some("ss") => (2, &[0]),
            Some("tr") | Some("se") => (2, &[1]),
            Some("br") | Some("ee") => (2, &[2]),
            _ => (2, &[3]),
        };
        let px = match c.get(2).map(|m| m.as_str()) {
            // `rounded` is 4px; `rounded-sm` is 2px in v3 and 4px in v4, and
            // the larger reading keeps the finding.
            None | Some("sm") => Some(4.0),
            Some("none") => Some(0.0),
            Some("xs") => Some(2.0),
            Some("md") => Some(6.0),
            Some("lg") => Some(8.0),
            Some("xl") => Some(12.0),
            Some("2xl") => Some(16.0),
            Some("3xl") => Some(24.0),
            Some("4xl") => Some(32.0),
            Some("full") => Some(9999.0),
            Some(arbitrary) if arbitrary.starts_with('[') => {
                crate::checks::measures::parse_radius_corner_px(
                    Some(&arbitrary[1..arbitrary.len() - 1].replace('_', " ")),
                    NOMINAL_CARD_WIDTH_PX,
                )
            }
            Some(_) => None,
        };
        if variant {
            variants.push((corners, px));
        } else {
            base.push((group, corners, px));
        }
    }
    base.sort_by_key(|entry| entry.0);
    let mut declared = DeclaredCorners::default();
    for (_, corners, px) in base {
        for &i in corners {
            declared.set_corner(i, px);
        }
    }
    for (corners, px) in variants {
        for &i in corners {
            declared.raise_corner(i, px);
        }
    }
    declared
}

/// JS: checks.mjs#checkBorders
pub fn check_borders(
    tag: &str,
    widths: &Sides<f64>,
    colors: &Sides<Option<&str>>,
    radius: f64,
    opts: &BorderOpts,
) -> Vec<RuleHit> {
    let span_badge = tag == "span" && opts.badge_like;
    if set_has(BORDER_SAFE_TAGS, tag) && !span_badge {
        return Vec::new();
    }
    if opts.status_context {
        return Vec::new();
    }
    let mut findings = Vec::new();
    for i in 0..4 {
        let w = widths.get(i);
        if w < 1.0 || is_neutral_color(colors.get(i)) {
            continue;
        }
        let mut max_other = f64::NEG_INFINITY;
        for j in 0..4 {
            if j != i {
                max_other = math_max(max_other, widths.get(j));
            }
        }
        if !(w >= 2.0 && (max_other <= 1.0 || w >= max_other * 2.0)) {
            continue;
        }
        let sn = SIDE_NAMES[i].to_lowercase();
        let is_side = i == 1 || i == 3;
        let w_s = number_to_string(w);
        let r_s = number_to_string(radius);
        if is_side {
            if span_badge {
                continue;
            }
            if !is_rounded_away_from_side(opts.corners.as_ref(), i) {
                continue;
            }
            if radius > 0.0 {
                findings.push(RuleHit::new(
                    "side-tab",
                    format!("border-{sn}: {w_s}px + border-radius: {r_s}px"),
                ));
            } else if w >= 3.0 {
                findings.push(RuleHit::new("side-tab", format!("border-{sn}: {w_s}px")));
            } else if let Some((a, b)) = opts.corners.as_ref().map(|c| c.away_from(i)) {
                // `radius` is the leading value of the computed shorthand,
                // the top-left corner. A card rounded only on the side away
                // from the stripe (`0px 12px 12px 0px` under a left rule)
                // leads with 0 and so took the square stripe's 3px floor,
                // which dropped a 2px stripe on a rounded card. Its radius
                // is that of the two corners the gate above passed, the
                // smaller of the far pair. A stripe of 3px or more keeps the
                // wording it reported under.
                let far = a.min(b);
                if far > 0.0 {
                    findings.push(RuleHit::new(
                        "side-tab",
                        format!("border-{sn}: {w_s}px + border-radius: {}px", number_to_string(far)),
                    ));
                }
            }
        } else if radius > 0.0 && w >= 2.0 {
            findings.push(RuleHit::new(
                "border-accent-on-rounded",
                format!("border-{sn}: {w_s}px + border-radius: {r_s}px"),
            ));
        } else if !opts.tab_context
            && w >= 3.0
            && w <= 12.0
            && is_rounded_away_from_side(opts.corners.as_ref(), i)
        {
            // A top or bottom band is the card tell only on a rounded card,
            // the gate left and right accents pass above (decision
            // r6-t2-side-tab-bands, narrow): on a square box it is a rule
            // across a section or a header. A band on a card rounded all
            // round leads with a radius and reports as
            // `border-accent-on-rounded` instead, so what reaches here is a
            // card rounded only away from its band, or corners nobody could
            // read.
            findings.push(RuleHit::new("side-tab", format!("border-{sn}: {w_s}px")));
        }
    }
    findings
}

/// Pure gate for dedicated stripe-child side-tabs (empty narrow chromatic
/// `div`/`span` at a card edge).
pub fn check_stripe_child(
    selector: &str,
    width: f64,
    edge: Option<&str>,
    bg: Option<Rgba>,
) -> Vec<RuleHit> {
    let Some(edge) = edge else {
        return Vec::new();
    };
    if !(width >= 2.0 && width <= 12.0) {
        return Vec::new();
    }
    let Some(bg) = bg else {
        return Vec::new();
    };
    if bg.alpha_or_one() <= 0.1 {
        return Vec::new();
    }
    let spread = js::math_max3(bg.r, bg.g, bg.b) - js::math_min3(bg.r, bg.g, bg.b);
    if spread < 30.0 {
        return Vec::new();
    }
    vec![RuleHit::new(
        "side-tab",
        format!(
            "{selector} — {}px stripe child ({edge})",
            number_to_string(math_round(width))
        ),
    )]
}

re!(GRADIENT_CI, ci("gradient"));

re!(
    TW_GRAY_TEXT,
    format!(r"{B}text-(?:gray|slate|zinc|neutral|stone)-{D}+{B}")
);
re!(
    TW_COLOR_BG,
    format!(
        r"{B}bg-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-{D}+{B}"
    )
);
re!(TW_BG_CLIP_TEXT, format!(r"{B}bg-clip-text{B}"));

/// JS: detect-text.mjs#TW_SOLID_CHROMATIC_BG_RE and checks.mjs#checkColors's
/// `colorBgMatch`, whose `\d+(?!\/)\b` skips a `bg-blue-500/10` opacity tint
/// (#707). The `regex` crate has no lookahead: `\d+` is already maximal before
/// the word boundary, so the only thing left to test is the byte after it.
pub fn find_solid_chromatic_bg(s: &str) -> Option<&str> {
    let mut from = 0usize;
    while let Some(m) = TW_COLOR_BG.find_at(s, from) {
        if s.as_bytes().get(m.end()) != Some(&b'/') && !in_state_variant(s, m.start()) {
            return Some(m.as_str());
        }
        from = m.start() + 1;
    }
    None
}

/// The first gray text utility that applies at rest and is not near-black ink.
fn find_resting_gray_text(s: &str) -> Option<regex::Match<'_>> {
    TW_GRAY_TEXT
        .find_iter(s)
        .find(|m| !in_state_variant(s, m.start()) && !is_near_black_neutral_class(m.as_str()))
}

/// Whether the utility starting at `start` sits behind a state variant
/// (`hover:bg-emerald-400`, `group-focus:text-gray-500`): it paints only in
/// that state, so it says nothing about the resting colours. Breakpoint and
/// theme variants (`md:`, `dark:`) apply at rest and still count.
fn in_state_variant(s: &str, start: usize) -> bool {
    let token_start = s[..start]
        .rfind(|c: char| c.is_ascii_whitespace())
        .map_or(0, |i| i + 1);
    let prefix = &s[token_start..start];
    if !prefix.ends_with(':') {
        return false;
    }
    prefix.trim_end_matches(':').split(':').any(|variant| {
        let v = variant.trim_start_matches('!');
        matches!(
            v,
            "hover" | "focus" | "focus-visible" | "focus-within" | "active" | "visited"
                | "disabled" | "checked" | "open" | "enabled" | "invalid" | "placeholder"
        ) || v.starts_with("group-")
            || v.starts_with("peer-")
            || v.starts_with("aria-")
            || v.starts_with("data-")
    })
}
re!(TW_BG_GRADIENT_TO, format!(r"{B}bg-gradient-to-"));
re!(
    TW_PURPLE_TEXT,
    format!(r"{B}text-(?:purple|violet|indigo)-{D}+{B}")
);
re!(TW_TEXT_XL, format!(r"{B}text-(?:[2-9]xl){B}"));
re!(
    TW_FROM_PURPLE,
    format!(r"{B}from-(?:purple|violet|indigo)-{D}+{B}")
);
re!(
    TW_TO_PURPLE,
    format!(r"{B}to-(?:purple|violet|indigo|blue|cyan|pink|fuchsia)-{D}+{B}")
);

/// `text-gray-700` and darker: every Tailwind neutral at shade 700 and up sits
/// under `GRAY_INK_MIN_LIGHTNESS`, so the class path skips the same
/// near-black inks the computed-colour path does. The source-text scanner in
/// `impeccable-detect` reads the same helper.
pub fn is_near_black_neutral_class(class: &str) -> bool {
    class
        .trim()
        .rsplit('-')
        .next()
        .and_then(|shade| shade.parse::<u32>().ok())
        .is_some_and(|shade| shade >= 700)
}

fn is_heading_123(tag: &str) -> bool {
    matches!(tag, "h1" | "h2" | "h3")
}

/// Whether a SAFE_TAGS element paints a surface of its own and so earns the
/// full `check_colors` pass: the filled pill, the solid button, the gradient
/// chip. Everything else in those tags is bare text.
fn is_styled_control(opts: &ColorOpts, bg_image: &str) -> bool {
    let own_bg = opts
        .bg_color
        .map_or(false, |c| c.a.map_or(false, |a| a > 0.5));
    let own_gradient = !bg_image.is_empty() && GRADIENT_CI.is_match(bg_image);
    opts.has_direct_text && (own_bg || own_gradient) && opts.font_size >= 9.0
}

/// Whether `check_colors` answers from `safe_tag_text_contrast` rather than
/// from the full pass, which is the set of findings the per-page dedupe
/// owns.
fn scores_safe_tag_text(opts: &ColorOpts) -> bool {
    set_has(SAFE_TAGS, opts.tag.as_str())
        && !is_styled_control(opts, opts.bg_image.as_deref().unwrap_or(""))
}

/// The colour pairs a page has already reported from the SAFE_TAGS text
/// path, threaded through one document's element loop the way `DesignSeen`
/// is. One washed-out link colour used on fifty links is one finding, not
/// fifty; the first element carrying it is the one that reports.
#[derive(Debug, Default)]
pub struct SafeTagTextSeen {
    reported: Vec<(String, String)>,
    /// Keys claimed by a hit on an element only partly on screen, with that
    /// element's handle and snippet.
    provisional: Vec<((String, String), u64, String)>,
    /// Provisional hits a later on-screen element wearing the same pair
    /// replaced: `(handle, snippet)`.
    superseded: Vec<(u64, String)>,
}

/// Who claims a colour pair, for [`SafeTagTextSeen::keep_first_keyed_claiming`]:
/// an opaque handle for the element, and whether it lies wholly on screen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PairClaim {
    pub owner: u64,
    pub on_screen: bool,
}

impl SafeTagTextSeen {
    /// Drops every hit whose rule and snippet this page has already
    /// reported from this path, and every hit `keep` rejects.
    ///
    /// A hit the caller rejects never claims the page's one report of its
    /// colour pair. That ordering is the point of the callback: the engines
    /// waive findings after the rule runs — an inline
    /// `data-impeccable-ignore` on one link, a text layer the background
    /// walk cannot read under another — and registering the pair before
    /// those verdicts would let a single waived element silence every other
    /// element on the page wearing the same colour. `keep` is called at most
    /// once per hit, and only for a hit whose pair the page has not reported
    /// yet: a duplicate the dedupe drops anyway costs no engine work, so an
    /// engine may put real work behind the callback.
    pub fn keep_first(&mut self, hits: &mut Vec<RuleHit>, keep: &mut dyn FnMut(&RuleHit) -> bool) {
        self.keep_first_keyed(hits, &|h: &RuleHit| vec![h.snippet.clone()], keep);
    }

    /// [`Self::keep_first`] with the pairs a hit claims named by `keys_of`
    /// instead of by its snippet alone. A hit is dropped when the page has
    /// already reported any of its keys, and a hit that stands claims all of
    /// them.
    pub fn keep_first_keyed(
        &mut self,
        hits: &mut Vec<RuleHit>,
        keys_of: &dyn Fn(&RuleHit) -> Vec<String>,
        keep: &mut dyn FnMut(&RuleHit) -> bool,
    ) {
        self.keep_first_keyed_claiming(hits, keys_of, None, keep);
    }

    /// [`Self::keep_first_keyed`] where the claimant may lie only partly on
    /// screen. A marquee's first copy starts past the page's left edge, and a
    /// carousel's first card is cut by its right edge: only 'IR' of 'HAIR'
    /// is visible, and the words beside it wearing the same pair are the
    /// ones a reader meets. A hit from such an element stands, but claims its
    /// pair provisionally: the first later element that lies wholly on
    /// screen and wears the same pair reports instead, and the provisional
    /// hit is recorded in [`Self::take_superseded`] for the engine to
    /// withdraw. A provisional claim nobody replaces stands. With no claim
    /// every hit is on screen, which is what `keep_first_keyed` does.
    pub fn keep_first_keyed_claiming(
        &mut self,
        hits: &mut Vec<RuleHit>,
        keys_of: &dyn Fn(&RuleHit) -> Vec<String>,
        claim: Option<PairClaim>,
        keep: &mut dyn FnMut(&RuleHit) -> bool,
    ) {
        let on_screen = claim.map_or(true, |c| c.on_screen);
        hits.retain(|h| {
            let keys: Vec<(String, String)> =
                keys_of(h).into_iter().map(|k| (h.id.clone(), k)).collect();
            if keys.iter().any(|k| self.reported.contains(k)) {
                return false;
            }
            let held = keys
                .iter()
                .any(|k| self.provisional.iter().any(|(p, _, _)| p == k));
            if held && !on_screen {
                return false;
            }
            if !keep(h) {
                return false;
            }
            if held {
                let mut replaced: Vec<(u64, String)> = Vec::new();
                self.provisional.retain(|(p, owner, snippet)| {
                    if keys.contains(p) {
                        if !replaced.iter().any(|(o, s)| o == owner && s == snippet) {
                            replaced.push((*owner, snippet.clone()));
                        }
                        false
                    } else {
                        true
                    }
                });
                for r in replaced {
                    // Every key the replaced hit claimed goes with it.
                    self.provisional.retain(|(_, owner, snippet)| !(r.0 == *owner && r.1 == *snippet));
                    self.superseded.push(r);
                }
            }
            match claim {
                Some(c) if !on_screen => {
                    for key in keys {
                        self.provisional.push((key, c.owner, h.snippet.clone()));
                    }
                }
                _ => {
                    for key in keys {
                        if !self.reported.contains(&key) {
                            self.reported.push(key);
                        }
                    }
                }
            }
            true
        });
    }

    /// Whether the page has already claimed `key` for rule `id`, outright or
    /// provisionally. Asking claims nothing.
    pub fn has_claimed(&self, id: &str, key: &str) -> bool {
        let k = (id.to_string(), key.to_string());
        self.reported.contains(&k) || self.provisional.iter().any(|(p, _, _)| *p == k)
    }

    /// The provisional hits later on-screen elements replaced, as
    /// `(handle, snippet)` (drained).
    pub fn take_superseded(&mut self) -> Vec<(u64, String)> {
        std::mem::take(&mut self.superseded)
    }
}

// ─── Contrast severity ──────────────────────────────────────────────────────

/// The per-finding severity a contrast finding reports at when it is not a
/// full failure.
pub const ADVISORY_SEVERITY: &str = "advisory";

/// The lowest ratio, as printed, that still counts as just under the 4.5:1
/// bar for normal text: within 0.3 of it.
pub const NEAR_BAR_FLOOR_NORMAL: f64 = 4.2;
/// The lowest ratio, as printed, that still counts as just under the 3:1
/// bar for large text: within 0.2 of it.
pub const NEAR_BAR_FLOOR_LARGE: f64 = 2.8;

/// Whether a failing contrast ratio sits just under its bar: 4.2:1 up to
/// 4.5:1 for normal text, 2.8:1 up to 3:1 for large text (taste call r3-02,
/// "Report ratios inside the margin as advisory, outside the failure count.
/// The findings stay visible with their measured ratios.").
///
/// The margin is read off the ratio as the snippet prints it
/// ([`crate::color::ratio_label`]), so every finding that prints `4.2:1`
/// reports the same way, whether the ratio underneath is 4.196 or 4.204. A
/// ratio at or over the bar is not a failure and is not near it; any other
/// bar (a NaN from a candidate with no threshold) has no margin.
pub fn contrast_near_bar(ratio: f64, threshold: f64) -> bool {
    if !ratio.is_finite() || !(ratio < threshold) {
        return false;
    }
    let floor = if threshold == 4.5 {
        NEAR_BAR_FLOOR_NORMAL
    } else if threshold == 3.0 {
        NEAR_BAR_FLOOR_LARGE
    } else {
        return false;
    };
    string_to_number(&crate::color::ratio_label(ratio, threshold)) >= floor
}

/// The severity a failing contrast finding carries: `advisory` just under
/// its bar ([`contrast_near_bar`]), else the rule's own.
pub fn contrast_severity(ratio: f64, threshold: f64) -> Option<String> {
    contrast_near_bar(ratio, threshold).then(|| ADVISORY_SEVERITY.to_string())
}

/// The words in a font family's name that say the face is drawn bold.
const HEAVY_FACE_WORDS: &[&str] = &[
    "bold", "semibold", "demibold", "extrabold", "ultrabold", "heavy", "black",
];

/// Whether the first family in a computed `font-family` list is named as a
/// bold cut: `ploni-demi-bold`, `EMprint Semibold`, `Gotham-Black`,
/// `ProximaNovaBold` (taste call r5-p31). The name is split at anything that
/// is not a letter or digit and at a lower-to-upper case step, so `demi-bold`
/// reads as `demi` + `bold` and `Blackletter` or `Kobold` as neither. Only
/// the first family is read: it is the one the page asked for, and the
/// engine cannot see which face was actually loaded.
pub fn family_names_heavy_face(font_family: &str) -> bool {
    let first = font_family.split(',').next().unwrap_or("");
    let first = first.trim().trim_matches(|c| c == '"' || c == '\'');
    let mut words: Vec<String> = Vec::new();
    let mut word = String::new();
    let mut prev_lower = false;
    for c in first.chars() {
        if !c.is_alphanumeric() {
            if !word.is_empty() {
                words.push(std::mem::take(&mut word));
            }
            prev_lower = false;
            continue;
        }
        if c.is_uppercase() && prev_lower && !word.is_empty() {
            words.push(std::mem::take(&mut word));
        }
        prev_lower = c.is_lowercase();
        word.extend(c.to_lowercase());
    }
    if !word.is_empty() {
        words.push(word);
    }
    words.iter().any(|w| HEAVY_FACE_WORDS.contains(&w.as_str()))
}

/// The weight the large-text contrast bar reads: the computed weight, or 700
/// where the family is named as a bold cut and the computed weight is under
/// it ([`family_names_heavy_face`]). A face drawn bold and served as its
/// family's regular weight computes to 400, and 19px of it is large text.
pub fn contrast_font_weight(font_weight: f64, font_family: &str) -> f64 {
    if font_weight < 700.0 && family_names_heavy_face(font_family) {
        700.0
    } else {
        font_weight
    }
}

/// Marks every `low-contrast` hit advisory. The engines call it on an
/// element whose text has no reading job ([`crate::checks::decorative_text`]).
pub fn demote_low_contrast(hits: &mut [RuleHit]) {
    for h in hits.iter_mut().filter(|h| h.id == "low-contrast") {
        h.severity = Some(ADVISORY_SEVERITY.to_string());
    }
}

/// Whether an ai-color-palette finding is one of its purple/violet forms
/// (purple heading text, a purple or violet gradient, the stock violet
/// accents, Tailwind `purple`/`violet`/`indigo` classes), as opposed to its
/// cyan-on-dark forms. These are the forms a project's DESIGN.md switches
/// off when it declares a purple (see `impeccable_detect::design_system`).
pub fn is_purple_palette_finding(id: &str, snippet: &str) -> bool {
    if id != "ai-color-palette" {
        return false;
    }
    let lower = snippet.to_ascii_lowercase();
    lower.contains("purple") || lower.contains("violet") || lower.contains("indigo")
}

/// Whether a declared colour is a purple or violet: chromatic, in the hue
/// band the rule reads as purple (260-310deg) widened by 10deg a side, so a
/// violet-500 (258deg) or a magenta-leaning plum (318deg) counts.
pub fn is_declared_purple(c: &Rgba) -> bool {
    if !has_chroma(Some(c), Some(30.0)) {
        return false;
    }
    let hue = get_hue(Some(c));
    (250.0..=320.0).contains(&hue)
}

/// JS: checks.mjs#checkColors
pub fn check_colors(opts: &ColorOpts) -> Vec<RuleHit> {
    let tag = opts.tag.as_str();
    let bg_image = opts.bg_image.as_deref().unwrap_or("");
    let bg_clip = opts.bg_clip.as_deref().unwrap_or("");
    if set_has(SAFE_TAGS, tag) && !is_styled_control(opts, bg_image) {
        return safe_tag_text_contrast(opts);
    }
    let mut findings = Vec::new();

    if opts.has_direct_text && opts.text_color.is_some() && !opts.is_emoji_only {
        let text_color = opts.text_color.unwrap();
        // Gradient-clipped text paints the gradient, not `color`, so there
        // is no background to score it against. Text with no letter and no
        // digit (a lone circle, a pair of braces) is not read, which the
        // SAFE_TAGS path already says through `paints_own_text`.
        // A surface in exactly the text's own colour is the walk landing on
        // a fill the text does not sit on, the same guard the SAFE_TAGS path
        // applies (`resolved_bg_matches_text`).
        if bg_clip != "text"
            && !opts.is_glyph_only
            && !(opts.same_color_surface_is_unread && resolved_bg_matches_text(opts, &text_color))
        {
            findings.extend(contrast_findings(opts, &text_color));
        }

        if has_chroma(Some(&text_color), Some(50.0)) {
            let hue = get_hue(Some(&text_color));
            if hue >= 260.0 && hue <= 310.0 && (is_heading_123(tag) || opts.font_size >= 20.0) {
                findings.push(RuleHit::new(
                    "ai-color-palette",
                    format!(
                        "Purple/violet text ({}) on heading",
                        color_to_hex(Some(&text_color))
                    ),
                ));
            }
        }
    }

    if bg_clip == "text" && !bg_image.is_empty() && bg_image.contains("gradient") {
        findings.push(RuleHit::new(
            "gradient-text",
            "background-clip: text + gradient".to_string(),
        ));
    }

    if let Some(class_str) = opts.class_list.as_deref().filter(|s| !s.is_empty()) {
        let gray_match = find_resting_gray_text(class_str);
        let color_bg_match = find_solid_chromatic_bg(class_str);
        // A gray utility names the ink only when it wins the cascade, and a
        // custom scale may spell white with a gray name (hse.de's
        // `text-neutral-0`, rgb(255, 255, 255)). The browser computes the
        // colour the glyphs take, and a near-white ink (the light end
        // [`is_gray_ink`] leaves out) or a plainly chromatic one says the
        // class does not paint gray. A cool gray (`slate-400`) keeps the
        // class reading, and so does a dark ink: a utility the page never
        // compiled leaves the inherited body colour. A file engine keeps
        // reading the class.
        let ink_contradicts_gray = opts.detector_is_browser
            && opts.text_color.as_ref().is_some_and(|ink| {
                lightness_saturation(ink).0 >= GRAY_INK_MAX_LIGHTNESS || has_chroma(Some(ink), Some(50.0))
            });
        if let (Some(g), Some(c), false) = (gray_match, color_bg_match, ink_contradicts_gray) {
            findings.push(RuleHit::new(
                "gray-on-color",
                format!("{} on {}", g.as_str(), c),
            ));
        }
        if TW_BG_CLIP_TEXT.is_match(class_str) && TW_BG_GRADIENT_TO.is_match(class_str) {
            findings.push(RuleHit::new(
                "gradient-text",
                "bg-clip-text + bg-gradient (Tailwind)".to_string(),
            ));
        }
        if let Some(p) = TW_PURPLE_TEXT.find(class_str) {
            if is_heading_123(tag) || TW_TEXT_XL.is_match(class_str) {
                findings.push(RuleHit::new(
                    "ai-color-palette",
                    format!("{} on heading", p.as_str()),
                ));
            }
        }
        if TW_FROM_PURPLE.is_match(class_str) && TW_TO_PURPLE.is_match(class_str) {
            findings.push(RuleHit::new(
                "ai-color-palette",
                "Purple/violet gradient (Tailwind)".to_string(),
            ));
        }
    }

    findings
}

/// A text colour as a dedupe key: its hex, and its alpha where it is
/// translucent. `color_to_hex` drops alpha, so `text-blue-100/70` on a link
/// and `text-blue-100/80` on a caption beside it were one key on one
/// gradient box, and the caption went unreported (veeza.ai).
fn ink_key(text: &Rgba) -> String {
    let alpha = text.alpha_or_one();
    if alpha < 1.0 {
        format!("{}@{}", color_to_hex(Some(text)), (alpha * 1000.0).round() / 1000.0)
    } else {
        color_to_hex(Some(text))
    }
}

/// `check_colors` with the per-page dedupe the SAFE_TAGS text path owes.
/// Each document's element loop threads one `SafeTagTextSeen` through this
/// so a colour the page repeats on every link is reported where it first
/// appears and nowhere else.
///
/// `keep` is the engine's own verdict on a hit this path produced, asked
/// before the pair is registered: the inline-ignore filter, and whatever
/// else the engine knows that the rule does not. It is never called for the
/// findings of the full `check_colors` pass, which the dedupe does not own.
pub fn check_colors_deduped(
    opts: &ColorOpts,
    seen: &mut SafeTagTextSeen,
    keep: &mut dyn FnMut(&RuleHit) -> bool,
) -> Vec<RuleHit> {
    check_colors_deduped_claiming(opts, seen, None, keep)
}

/// [`check_colors_deduped`] with the claimant named, so an element only
/// partly on screen claims its pair provisionally
/// ([`SafeTagTextSeen::keep_first_keyed_claiming`]).
pub fn check_colors_deduped_claiming(
    opts: &ColorOpts,
    seen: &mut SafeTagTextSeen,
    claim: Option<PairClaim>,
    keep: &mut dyn FnMut(&RuleHit) -> bool,
) -> Vec<RuleHit> {
    check_colors_deduped_shaped(opts, seen, claim, &|| false, keep)
}

/// [`check_colors_deduped_claiming`] with the engine's verdict on whether
/// the element's text has no reading job ([`crate::checks::decorative_text`]).
/// `decorative` is asked at most once, and only when the element failed
/// contrast; a yes reports its `low-contrast` hits as advisory.
///
/// An advisory copy never speaks for the page's failing copies of the same
/// colour pair: it is dropped where a failing copy already reported the
/// pair, and the pair it claims is its own, so the white-on-blue avatar
/// initial that comes first leaves the white-on-blue button label after it
/// failing as before.
pub fn check_colors_deduped_shaped(
    opts: &ColorOpts,
    seen: &mut SafeTagTextSeen,
    claim: Option<PairClaim>,
    decorative: &dyn Fn() -> bool,
    keep: &mut dyn FnMut(&RuleHit) -> bool,
) -> Vec<RuleHit> {
    let mut hits = check_colors(opts);
    let shaped = hits.iter().any(|h| h.id == "low-contrast") && decorative();
    if shaped {
        demote_low_contrast(&mut hits);
    }
    if scores_safe_tag_text(opts) {
        let surface_key = match (
            opts.bg_source.as_deref(),
            opts.bg_source_host.as_deref(),
            opts.text_color.as_ref(),
        ) {
            (Some(source), Some(host), Some(text)) => {
                Some(format!("text {} over {} [{}]", ink_key(text), source, host))
            }
            _ => None,
        };
        if shaped {
            hits.retain(|h| {
                !(seen.has_claimed(&h.id, &h.snippet)
                    || surface_key.as_deref().is_some_and(|k| seen.has_claimed(&h.id, k)))
            });
            let keys_of = |h: &RuleHit| {
                let mut keys = vec![format!("decorative {}", h.snippet)];
                if let Some(k) = &surface_key {
                    keys.push(format!("decorative {k}"));
                }
                keys
            };
            seen.keep_first_keyed_claiming(&mut hits, &keys_of, claim, keep);
            return hits;
        }
        // A gradient is sampled where each element's text sits, so fifty
        // links across one gradient header name fifty slightly different
        // colours. They are one text colour on one box, reported once. The
        // box is named by its identity, not by its label: a row of `div.w-14`
        // tiles on amber, lime and blue gradients is three surfaces. The
        // snippet is claimed as well, so identical tiles on one gradient stay
        // one report, as they always were.
        let keys_of = |h: &RuleHit| {
            let mut keys = vec![h.snippet.clone()];
            if let Some(k) = &surface_key {
                keys.push(k.clone());
            }
            keys
        };
        seen.keep_first_keyed_claiming(&mut hits, &keys_of, claim, keep);
    }
    hits
}

/// Contrast for a SAFE_TAGS element that paints its own text without
/// painting its own surface: a link, a nav label, a table cell, a span of
/// small print. The tag gate above exists to keep surface-shaped rules off
/// elements that carry no surface, but the glyphs are still glyphs, and
/// these tags hold most of a page's small text — skipping them reports the
/// heading and passes the fifty links below it set in the same washed-out
/// colour. Only the WCAG verdict travels. `gray-on-color` is a text-vs-
/// surface verdict too, but its precision on bare text has never been
/// measured, and the class-list heuristics beside it (gradient, palette)
/// read the surface rather than the text, so both stay behind the gate
/// until someone measures them.
fn safe_tag_text_contrast(opts: &ColorOpts) -> Vec<RuleHit> {
    if !opts.paints_own_text || !opts.has_direct_text || opts.is_emoji_only {
        return Vec::new();
    }
    // The same floor the styled-control gate uses: under 9px the text is a
    // decorative mark, and `undersized-ui-text` owns it.
    if opts.font_size < 9.0 {
        return Vec::new();
    }
    if set_has(NON_RENDERED_TAGS, opts.tag.as_str()) {
        return Vec::new();
    }
    // Gradient-clipped text paints the gradient, not `color`.
    if opts.bg_clip.as_deref() == Some("text") {
        return Vec::new();
    }
    let Some(text_color) = opts.text_color else {
        return Vec::new();
    };
    if resolved_bg_matches_text(opts, &text_color) {
        return Vec::new();
    }
    contrast_findings(opts, &text_color)
        .into_iter()
        .filter(|h| h.id == "low-contrast")
        .collect()
}

/// Whether the surface the text would be scored against is the text colour
/// itself. Nothing is painted in exactly its own background, so this is the
/// background walk landing on the page's own fill through an image, a video
/// or a positioned shape it cannot see — white label over a hero photo
/// reported as `1.0:1 — text #ffffff on #ffffff`. The walk's blind spots
/// are their own problem; a report that is self-evidently wrong to anyone
/// who opens the page is not worth printing while they are fixed.
///
/// What it hides, stated plainly: text that really is painted in its own
/// background colour, which is invisible and a genuine 1:1 failure. That
/// shape is rare, and a guard on the SAFE_TAGS path alone left `<p>`,
/// headings and custom elements printing `1.0:1 — text #ffffff on #ffffff`
/// for white copy over a photo or a card the walk never read (nike.com,
/// exxonmobil.com), so the full pass in `check_colors` asks it too. It is
/// exact equality on the resolved hex, not a near-match, so text one shade
/// off its surface still reports. In the URL engine an element the pixel
/// pass takes as a candidate is still measured there.
///
/// Narrowing it means knowing whether the walk resolved a surface or gave
/// up and fell through to the page fill, which the check cannot see from
/// `ColorOpts` alone. That is why this guard is written as a hex
/// coincidence rather than as a verdict about the walk: the browser engine
/// asks the real question one layer out, where it has layout, and drops a
/// hit from this path whose text reads over a picture
/// (`resolved_surface_is_under_text`). Here the coincidence is all there is to go
/// on, and it covers the static engine, which has no layout to test.
fn resolved_bg_matches_text(opts: &ColorOpts, text_color: &Rgba) -> bool {
    let text_hex = color_to_hex(Some(text_color));
    let same = |bg: &Rgba| color_to_hex(Some(bg)) == text_hex;
    if let Some(bg) = opts.effective_bg.as_ref() {
        return same(bg);
    }
    opts.effective_bg_stops
        .as_deref()
        .map_or(false, |stops| stops.iter().any(same))
}

/// Whether a computed `background-clip` clips the background to the text:
/// `text`, or one `text` per layer (`text, text`, which a stack of two
/// gradients under `bg-clip-text` computes). A stack that clips any layer to
/// a box paints that layer as a fill, and is not read as clipped text.
pub fn background_clips_to_text(value: &str) -> bool {
    let mut layers = value.split(',').map(js::trim).peekable();
    layers.peek().is_some() && layers.all(|layer| layer == "text")
}

/// A computed `background-clip` as the colour checks read it: `text` when
/// [`background_clips_to_text`] says every layer is clipped to the text,
/// the value as computed otherwise.
pub fn background_clip_for_checks(value: String) -> String {
    if background_clips_to_text(&value) {
        "text".to_string()
    } else {
        value
    }
}

/// The alpha at or below which an ink paints no glyph a reader could see.
pub(crate) const TRANSPARENT_INK_FLOOR: f64 = 0.02;

/// The contrast scoring `check_colors` and `check_placeholder_colors`
/// share: gray-on-color, then WCAG AA against the worst background. The
/// backgrounds are the composited `effective_bg`, or the gradient stops (or
/// the gradient sampled under the text) when no opaque surface resolved;
/// with neither there is nothing to score.
///
/// The ink scored is what a reader sees when the adapter says so:
/// `visible_text`, composited over each background where it is translucent
/// before it is scored and printed (`rgba(255, 255, 255, 0.7)` is not
/// `#ffffff` on the page). Without it `text_color` is scored as declared,
/// which is what the recorded call vectors pin.
/// The channel spread a background needs before gray text on it reads as
/// gray on colour, at a luminance of 0.01 or more.
const GRAY_ON_COLOR_BG_SPREAD: f64 = 40.0;
/// Below this luminance (a CIELAB lightness of about 9, where a colour reads
/// as black) the spread needed grows as the colour darkens.
const GRAY_ON_COLOR_DARK_LUMINANCE: f64 = 0.01;

/// Whether a background reads as colour. The spread bar rises with the square
/// root of how far the colour sits under a luminance of 0.01: a near-black
/// navy (`#04002d`, luminance 0.002, spread 45) and a near-black purple
/// (`#1e002f`, 0.005, spread 47) read as black, while a dark navy (`#001c47`,
/// 0.013), a dark petrol (`#002733`, 0.017) and a very dark blue with a wide
/// spread (`#00004d`, 0.005, spread 77) still read as colour.
///
/// A pale tint is the other end. The channel spread grows with the hue
/// however faint it is, so cream `#feeed4` spreads 42 and clears the bar,
/// while the eye reads it as an off-white: OKLCH puts it at L 0.955 and
/// C 0.038, and `#fde6ba` at L 0.933, C 0.062 (glowcase.app 321836, a 6:1
/// grey-brown on cream that both judges call legible). At OKLCH lightness
/// [`GRAY_ON_COLOR_PALE_LIGHTNESS`] and above the background needs chroma
/// [`GRAY_ON_COLOR_PALE_CHROMA`] as well: amber-300 `#fcd34d` (C 0.153)
/// and a saturated yellow still read as colour, amber-100 `#fef3c7`
/// (C 0.06) and blue-100 `#dbeafe` (C 0.04) do not.
fn background_reads_as_colour(bg: &Rgba) -> bool {
    let lum = relative_luminance(bg);
    let scale = if lum >= GRAY_ON_COLOR_DARK_LUMINANCE {
        1.0
    } else {
        (GRAY_ON_COLOR_DARK_LUMINANCE / math_max(lum, 1e-4)).sqrt()
    };
    if !has_chroma(Some(bg), Some(GRAY_ON_COLOR_BG_SPREAD * scale)) {
        return false;
    }
    let (lightness, chroma) = crate::color::rgb_to_oklch_lc(bg);
    lightness < GRAY_ON_COLOR_PALE_LIGHTNESS || chroma >= GRAY_ON_COLOR_PALE_CHROMA
}

/// The OKLCH lightness at and above which a background is a pale tint, and
/// reads as colour only with [`GRAY_ON_COLOR_PALE_CHROMA`].
const GRAY_ON_COLOR_PALE_LIGHTNESS: f64 = 0.9;
/// The OKLCH chroma a pale tint needs to read as colour.
const GRAY_ON_COLOR_PALE_CHROMA: f64 = 0.09;

fn contrast_findings(opts: &ColorOpts, text_color: &Rgba) -> Vec<RuleHit> {
    // Glyphs inked at (nearly) zero alpha paint nothing: a `color:
    // transparent` label over a sprite, a letter-by-letter reveal at its
    // first frame. The paint gate's floor, for the same reason.
    if opts
        .visible_text
        .is_some_and(|ink| ink.alpha_or_one() <= TRANSPARENT_INK_FLOOR)
    {
        return Vec::new();
    }
    let bgs: Vec<Rgba> = if let Some(bg) = opts.effective_bg {
        vec![bg]
    } else {
        match &opts.effective_bg_stops {
            Some(stops) if !stops.is_empty() => stops.clone(),
            _ => return Vec::new(),
        }
    };
    let mut findings = Vec::new();
    // Gray is low chroma at whatever lightness the ink sits at (relative
    // luminance read as lightness made every off-white under 0.85 gray,
    // REN-404), and the surface is a colour when its spread clears the bar,
    // which rises as the surface nears black.
    if is_gray_ink(text_color) && bgs.iter().all(background_reads_as_colour) {
        let bg_label = match opts.effective_bg {
            Some(bg) => color_to_hex(Some(&bg)),
            None => format!(
                "gradient({})",
                bgs.iter()
                    .map(|b| color_to_hex(Some(b)))
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        };
        findings.push(RuleHit::new(
            "gray-on-color",
            format!("text {} on bg {}", color_to_hex(Some(text_color)), bg_label),
        ));
    }

    let inks: Vec<Rgba> = bgs
        .iter()
        .map(|b| match opts.visible_text {
            Some(ink) if ink.a.map_or(false, |a| a < 1.0) => composite_color_over(&ink, b),
            Some(ink) => ink,
            None => *text_color,
        })
        .collect();
    let ratios: Vec<f64> = bgs.iter().zip(&inks).map(|(b, i)| contrast_ratio(i, b)).collect();
    let mut worst_idx = 0usize;
    for i in 1..ratios.len() {
        if ratios[i] < ratios[worst_idx] {
            worst_idx = i;
        }
    }
    let ratio = ratios[worst_idx];
    let is_large_text = opts.font_size >= WCAG_LARGE_TEXT_PX
        || (opts.font_size >= WCAG_LARGE_BOLD_TEXT_PX && opts.font_weight >= 700.0);
    let threshold = if is_large_text { 3.0 } else { 4.5 };
    if ratio < threshold {
        let is_alpha_fallback_fp = !opts.detector_is_browser
            && opts.effective_bg.is_none()
            && text_color.a.map_or(false, |a| a < 1.0);
        if !is_alpha_fallback_fp {
            let ratio_label = crate::color::ratio_label(ratio, threshold);
            let source = opts
                .bg_source
                .as_deref()
                .map(|s| format!(" ({s})"))
                .unwrap_or_default();
            let mut hit = RuleHit::new(
                "low-contrast",
                format!(
                    "{}:1 (need {}:1) — text {} on {}{}",
                    ratio_label,
                    number_to_string(threshold),
                    color_to_hex(Some(&inks[worst_idx])),
                    color_to_hex(Some(&bgs[worst_idx])),
                    source
                ),
            );
            hit.severity = contrast_severity(ratio, threshold);
            findings.push(hit);
        }
    }
    findings
}

/// Placeholder text contrast, sibling of `check_hover_contrast`. Skips the
/// SAFE_TAGS gate and the host heuristics in `check_colors` (class list,
/// clip, gradient) because the host is an empty control; only the
/// placeholder glyphs are scored. A translucent placeholder is flattened
/// over the composited background first, including each gradient stop when
/// no opaque surface resolved. Snippets carry the placeholder string so
/// fixture tests can key on it.
pub fn check_placeholder_colors(
    opts: &ColorOpts,
    placeholder_text: &str,
    mut text_color: Rgba,
) -> Vec<RuleHit> {
    // A placeholder inked at (nearly) zero alpha paints nothing: Bootstrap's
    // floating labels and `placeholder:text-transparent` hide it so a label
    // can take its place.
    if text_color.alpha_or_one() <= TRANSPARENT_INK_FLOOR {
        return Vec::new();
    }
    // `visible_text` is the host's own ink; the placeholder paints its own.
    let host_ink_cleared;
    let opts = if opts.visible_text.is_some() {
        host_ink_cleared = ColorOpts {
            visible_text: None,
            ..opts.clone()
        };
        &host_ink_cleared
    } else {
        opts
    };
    let mut flat: Option<ColorOpts> = None;
    if text_color.a.map_or(false, |a| a < 1.0) {
        if let Some(bg) = opts.effective_bg {
            text_color = composite_color_over(&text_color, &bg);
        } else if let Some(stops) = opts.effective_bg_stops.as_ref().filter(|s| !s.is_empty()) {
            let mut worst_i = 0usize;
            let mut worst_ratio = f64::MAX;
            let mut worst_fg = text_color;
            for (i, stop) in stops.iter().enumerate() {
                let fg = composite_color_over(&text_color, stop);
                let r = contrast_ratio(&fg, stop);
                if r < worst_ratio {
                    worst_ratio = r;
                    worst_i = i;
                    worst_fg = fg;
                }
            }
            text_color = worst_fg;
            let mut o = opts.clone();
            o.effective_bg = Some(stops[worst_i]);
            o.effective_bg_stops = None;
            flat = Some(o);
        }
    }
    let opts = flat.as_ref().unwrap_or(opts);
    let mut findings = contrast_findings(opts, &text_color);
    for h in &mut findings {
        h.snippet = format!("placeholder \"{}\" {}", placeholder_text, h.snippet);
    }
    findings
}

/// JS: checks.mjs#checkHoverContrast
pub fn check_hover_contrast(opts: &HoverContrastOpts) -> Vec<RuleHit> {
    if !opts.has_direct_text || opts.is_emoji_only || opts.text_color.is_none() || opts.bg.is_none()
    {
        return Vec::new();
    }
    if set_has(SAFE_TAGS, &opts.tag) && !opts.own_bg_alpha.map_or(false, |a| a > 0.5) {
        return Vec::new();
    }
    let text_color = opts.text_color.unwrap();
    let bg = opts.bg.unwrap();
    let ratio = contrast_ratio(&text_color, &bg);
    let is_large_text = opts.font_size >= WCAG_LARGE_TEXT_PX
        || (opts.font_size >= WCAG_LARGE_BOLD_TEXT_PX && opts.font_weight >= 700.0);
    let threshold = if is_large_text { 3.0 } else { 4.5 };
    if ratio >= threshold {
        return Vec::new();
    }
    let mut hit = RuleHit::new(
        "low-contrast",
        format!(
            ":hover state {}:1 (need {}:1) — text {} on {}",
            crate::color::ratio_label(ratio, threshold),
            number_to_string(threshold),
            color_to_hex(Some(&text_color)),
            color_to_hex(Some(&bg))
        ),
    );
    hit.severity = contrast_severity(ratio, threshold);
    vec![hit]
}

// ─── isCardLikeFromProps / HEADING_TAGS ─────────────────────────────────────

/// JS: checks.mjs#isCardLikeFromProps
pub fn is_card_like_from_props(
    has_shadow: bool,
    has_border: bool,
    has_radius: bool,
    has_bg: bool,
) -> bool {
    if !has_shadow && !has_border {
        return false;
    }
    has_radius || has_bg
}

/// The background alpha at which an icon tile's tint is drawn.
pub const ICON_TILE_MIN_BG_ALPHA: f64 = 0.05;

/// JS: checks.mjs#checkIconTile
pub fn check_icon_tile(opts: &IconTileOpts) -> Vec<RuleHit> {
    if !is_heading_tag(&opts.heading_tag) && !opts.heading_is_card_title {
        return Vec::new();
    }
    let sibling_tag = match opts.sibling_tag.as_deref() {
        None | Some("") => return Vec::new(),
        Some(t) => t,
    };
    if is_heading_tag(sibling_tag) {
        return Vec::new();
    }
    let w = opts.sibling_width;
    let h = opts.sibling_height;
    if !(w >= 32.0 && w <= 128.0) {
        return Vec::new();
    }
    if !(h >= 32.0 && h <= 128.0) {
        return Vec::new();
    }
    let ratio = w / h;
    if ratio < 0.7 || ratio > 1.4 {
        return Vec::new();
    }
    // Tailwind's `/10` tint computes to an alpha of exactly 0.1, and a tint
    // that faint still draws the tile.
    let bg_visible = opts
        .sibling_bg_color
        .map_or(false, |c| c.a.map_or(false, |a| a >= ICON_TILE_MIN_BG_ALPHA))
        || opts
            .sibling_bg_image
            .as_deref()
            .map_or(false, |s| !s.is_empty() && s != "none");
    let border_visible = opts.sibling_border_width > 0.0;
    if !bg_visible && !border_visible {
        return Vec::new();
    }
    if opts.sibling_border_radius >= w / 2.0 {
        return Vec::new();
    }
    if !opts.has_icon_child {
        return Vec::new();
    }
    if num_truthy(opts.icon_child_width) && opts.icon_child_width >= w * 0.95 {
        return Vec::new();
    }
    if num_truthy(opts.heading_top)
        && num_truthy(opts.sibling_bottom)
        && opts.sibling_bottom > opts.heading_top + 4.0
    {
        return Vec::new();
    }
    let text = slice_utf16_start(js::trim(opts.heading_text.as_deref().unwrap_or("")), 60);
    vec![RuleHit::new(
        "icon-tile-stack",
        format!(
            "{}x{}px icon tile above {} \"{}\"",
            number_to_string(math_round(w)),
            number_to_string(math_round(h)),
            opts.heading_tag,
            text
        ),
    )]
}

/// JS `f.trim().replace(/^['"]|['"]$/g, '')`.
fn strip_font_quotes(f: &str) -> &str {
    let t = js::trim(f);
    let is_quote = |b: u8| b == b'\'' || b == b'"';
    let bytes = t.as_bytes();
    let start = if !bytes.is_empty() && is_quote(bytes[0]) {
        1
    } else {
        0
    };
    let end = if bytes.len() > start && is_quote(bytes[bytes.len() - 1]) {
        bytes.len() - 1
    } else {
        bytes.len()
    };
    &t[start..end]
}

/// JS: checks.mjs#resolveSerif
pub fn resolve_serif(font_family: Option<&str>) -> SerifResolution {
    let none = SerifResolution {
        primary: None,
        is_serif: false,
    };
    let ff = match font_family {
        None | Some("") => return none,
        Some(s) => s,
    };
    let tokens: Vec<String> = ff
        .split(',')
        .map(|f| js::to_lower_case(strip_font_quotes(f)))
        .collect();
    let primary = tokens
        .iter()
        .find(|f| !f.is_empty() && !set_has(GENERIC_FONTS, f))
        .cloned();
    let primary = match primary {
        None => return none,
        Some(p) => p,
    };
    if set_has(KNOWN_SERIF_FONTS, &primary) {
        return SerifResolution {
            primary: Some(primary),
            is_serif: true,
        };
    }
    if tokens.iter().any(|t| t == "serif") {
        return SerifResolution {
            primary: Some(primary),
            is_serif: true,
        };
    }
    SerifResolution {
        primary: Some(primary),
        is_serif: false,
    }
}

/// JS: checks.mjs#checkItalicSerif
pub fn check_italic_serif(opts: &ItalicSerifOpts) -> Vec<RuleHit> {
    if opts.font_style.as_deref() != Some("italic") {
        return Vec::new();
    }
    let tag = opts.tag.as_str();
    if tag != "h1" && !(tag == "h2" && opts.font_size >= 48.0) {
        return Vec::new();
    }
    if opts.font_size < 48.0 {
        return Vec::new();
    }
    let res = resolve_serif(opts.font_family.as_deref());
    if !res.is_serif {
        return Vec::new();
    }
    let text = slice_utf16_start(js::trim(opts.heading_text.as_deref().unwrap_or("")), 60);
    vec![RuleHit::new(
        "italic-serif-display",
        format!(
            "italic serif {} ({}) at {}px \"{}\"",
            tag,
            res.primary.as_deref().unwrap_or("serif"),
            number_to_string(math_round(opts.font_size)),
            text
        ),
    )]
}

// ─── isAccentColor ──────────────────────────────────────────────────────────
re!(
    ACCENT_RGB_STRICT,
    format!(r"rgba?\({WS}*({D}+){WS}*,{WS}*({D}+){WS}*,{WS}*({D}+)")
);
re!(ACCENT_HEX, format!(r"^#([0-9a-fA-F]{{3,8}}){B}"));
re!(ACCENT_OKLCH_HEAD, format!(r"^{}\(", ci("oklch")));
re!(ACCENT_NUMS, format!(r"{D}*\.{D}+|{D}+"));
re!(
    ACCENT_HSL,
    format!(r"{}[aA]?\({WS}*[0-9.]+{WS}*,{WS}*([0-9.]+)%", ci("hsl"))
);

/// JS: checks.mjs#isAccentColor
pub fn is_accent_color(css_color: &str) -> bool {
    if css_color.is_empty() {
        return false;
    }
    let s = js::trim(css_color);
    if let Some(m) = ACCENT_RGB_STRICT.captures(s) {
        let r = string_to_number(&m[1]);
        let g = string_to_number(&m[2]);
        let b = string_to_number(&m[3]);
        return (js::math_max3(r, g, b) - js::math_min3(r, g, b)) >= 40.0;
    }
    if let Some(m) = ACCENT_HEX.captures(s) {
        let raw = &m[1];
        let h: String = if raw.len() == 3 || raw.len() == 4 {
            let doubled: String = raw.chars().flat_map(|c| [c, c]).collect();
            doubled.chars().take(6).collect()
        } else {
            raw.chars().take(6).collect()
        };
        if h.len() == 6 {
            let r = parse_int(&h[0..2], 16);
            let g = parse_int(&h[2..4], 16);
            let b = parse_int(&h[4..6], 16);
            return (js::math_max3(r, g, b) - js::math_min3(r, g, b)) >= 40.0;
        }
    }
    if ACCENT_OKLCH_HEAD.is_match(s) {
        let nums: Vec<&str> = ACCENT_NUMS.find_iter(s).map(|m| m.as_str()).collect();
        if nums.len() >= 2 {
            let c = parse_float(nums[1]);
            return !c.is_nan() && c >= 0.05;
        }
    }
    if let Some(m) = ACCENT_HSL.captures(s) {
        let sat = parse_float(&m[1]);
        return !sat.is_nan() && sat >= 20.0;
    }
    false
}

// ─── resolveHeroHeadingSizePx ───────────────────────────────────────────────
re!(
    SIMPLE_LENGTH,
    format!(r"^(-?{D}*\.?{D}+){WS}*(px|rem|em|%)?$")
);
re!(CLAMP_RE, format!(r"^clamp\(({DOT}*)\)$"));

fn simple_length_px(token: &str) -> Option<f64> {
    let m = SIMPLE_LENGTH.captures(js::trim(token))?;
    let amount = string_to_number(&m[1]);
    if !amount.is_finite() {
        return None;
    }
    match m.get(2).map(|u| u.as_str()) {
        Some("rem") | Some("em") => Some(amount * 16.0),
        Some("%") => Some(amount * 0.16),
        _ => Some(amount),
    }
}

/// JS: checks.mjs#resolveHeroHeadingSizePx
pub fn resolve_hero_heading_size_px(value: Option<&str>) -> f64 {
    let input = js::to_lower_case(js::trim(value.unwrap_or("")));
    if input.is_empty() {
        return 0.0;
    }
    if let Some(direct) = simple_length_px(&input) {
        return direct;
    }
    if let Some(m) = CLAMP_RE.captures(&input) {
        let parts: Vec<&str> = m[1].split(',').collect();
        if parts.len() == 3 {
            let bounds: Vec<f64> = [simple_length_px(parts[0]), simple_length_px(parts[2])]
                .into_iter()
                .flatten()
                .collect();
            if !bounds.is_empty() {
                let mut mx = f64::NEG_INFINITY;
                for b in bounds {
                    mx = math_max(mx, b);
                }
                return mx;
            }
        }
    }
    0.0
}

/// JS: checks.mjs#checkHeroEyebrow
pub fn check_hero_eyebrow(opts: &HeroEyebrowOpts) -> Vec<RuleHit> {
    if opts.heading_tag != "h1" {
        return Vec::new();
    }
    if opts.heading_in_application_context {
        return Vec::new();
    }
    if !(opts.heading_font_size >= 48.0) {
        return Vec::new();
    }
    let sibling_tag = match opts.sibling_tag.as_deref() {
        None | Some("") => return Vec::new(),
        Some(t) => t,
    };
    if is_heading_tag(sibling_tag) {
        return Vec::new();
    }
    let text = js::trim(opts.sibling_text.as_deref().unwrap_or(""));
    let text_len = utf16_length(text);
    if text_len < 2 || text_len > 60 {
        return Vec::new();
    }
    if !(opts.sibling_font_size > 0.0 && opts.sibling_font_size <= 14.0) {
        return Vec::new();
    }
    let is_uppercased = opts.sibling_text_transform.as_deref() == Some("uppercase")
        || (text.bytes().any(|b| b.is_ascii_uppercase())
            && !text.bytes().any(|b| b.is_ascii_lowercase()));
    // The em floor reaches the common tracked setting of a blog's date line
    // (Tailwind's tracking-widest at 12px is 1.2px), so under the fixed
    // floor a dated line is the post's meta, not an eyebrow: a `<time>`, or
    // text naming a year. At the fixed floor and above nothing changes.
    let em_floor_only = opts.sibling_letter_spacing < HERO_EYEBROW_TRACKING_PX;
    let dated_meta = em_floor_only
        && (opts.sibling_holds_time || crate::checks::text_rules::KICKER_META_YEAR_RE.is_match(text));
    let is_classic_tracked = is_uppercased
        && !dated_meta
        && hero_eyebrow_tracked(
            opts.sibling_letter_spacing,
            opts.sibling_font_size,
            opts.sibling_tracking_floor_em,
        );

    let weight = {
        let n = match opts.sibling_font_weight.as_deref() {
            None => f64::NAN,
            Some(s) => string_to_number(s),
        };
        if num_truthy(n) {
            n
        } else {
            400.0
        }
    };
    let is_accent_bold =
        weight >= 700.0 && is_accent_color(opts.sibling_color.as_deref().unwrap_or(""));
    let is_dash_prefixed = opts.sibling_has_accent_dash_pseudo;
    if !is_classic_tracked && !is_accent_bold && !is_dash_prefixed {
        return Vec::new();
    }
    let heading_text_snippet =
        slice_utf16_start(js::trim(opts.heading_text.as_deref().unwrap_or("")), 60);
    let eyebrow_snippet = slice_utf16_start(text, 40);
    let style = if is_classic_tracked {
        "tracked-caps"
    } else if is_accent_bold {
        "accent-bold"
    } else {
        "dash-prefix"
    };
    vec![RuleHit::new(
        "hero-eyebrow-chip",
        format!(
            "eyebrow chip ({}) \"{}\" above {} \"{}\"",
            style, eyebrow_snippet, opts.heading_tag, heading_text_snippet
        ),
    )]
}

/// JS: checks.mjs#checkKickerAboveHeading
pub fn check_kicker_above_heading(candidates: &[KickerCandidate]) -> Vec<RuleHit> {
    candidates
        .iter()
        .map(|c| {
            RuleHit::new(
                "kicker-above-heading",
                format!(
                    "kicker \"{}\" above {} \"{}\"",
                    c.kicker_text, c.heading_tag, c.heading_text
                ),
            )
        })
        .collect()
}

// ─── checkMotion ────────────────────────────────────────────────────────────

re!(
    BOUNCE_NAME,
    format!(
        "{}|{}|{}|{}|{}",
        ci("bounce"),
        ci("elastic"),
        ci("wobble"),
        ci("jiggle"),
        ci("spring")
    )
);
re!(TW_ANIMATE_BOUNCE, format!(r"{B}animate-bounce{B}"));
/// JS `/cubic-bezier\(\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*\)/g`.
pub(crate) static BEZIER_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        r"cubic-bezier\({WS}*([0-9.-]+){WS}*,{WS}*([0-9.-]+){WS}*,{WS}*([0-9.-]+){WS}*,{WS}*([0-9.-]+){WS}*\)"
    ))
    .expect("BEZIER_RE")
});

/// JS: checks.mjs#checkMotion
pub fn check_motion(opts: &MotionOpts) -> Vec<RuleHit> {
    if set_has(SAFE_TAGS, &opts.tag) {
        return Vec::new();
    }
    let mut findings = Vec::new();
    if let Some(name) = opts.animation_name.as_deref() {
        if !name.is_empty() && name != "none" && BOUNCE_NAME.is_match(name) {
            findings.push(RuleHit::new("bounce-easing", format!("animation: {name}")));
        }
    }
    if let Some(cls) = opts.class_list.as_deref() {
        if !cls.is_empty() && TW_ANIMATE_BOUNCE.is_match(cls) {
            findings.push(RuleHit::new(
                "bounce-easing",
                "animate-bounce (Tailwind)".to_string(),
            ));
        }
    }
    if let Some(tf) = opts.timing_functions.as_deref() {
        if !tf.is_empty() {
            for m in BEZIER_RE.captures_iter(tf) {
                let y1 = parse_float(&m[2]);
                let y2 = parse_float(&m[4]);
                if y1 < -0.1 || y1 > 1.1 || y2 < -0.1 || y2 > 1.1 {
                    findings.push(RuleHit::new(
                        "bounce-easing",
                        format!("cubic-bezier({}, {}, {}, {})", &m[1], &m[2], &m[3], &m[4]),
                    ));
                    break;
                }
            }
        }
    }
    findings
}

/// The light a glow layer has to put out before it is worth reporting: the
/// blur radius scaled by how much of the shadow's ink lands (its color alpha
/// times the element's own opacity), in px.
///
/// Measured on the site corpus: every glow both judges could find in the
/// screenshot scores 3.0 or more, and every one they called invisible tops
/// out at 2.1 (a 3x23px typing caret at 38% alpha on a half-faded element;
/// 20px blurs at 6 to 10% alpha on cards).
pub const GLOW_MIN_STRENGTH_PX: f64 = 3.0;

/// How far out of scale with its element a glow may be. A halo covering more
/// than twice the element's own area is the light of an indicator (a 6px
/// status dot, a 5x8px pulse travelling a connector, a typing caret), not a
/// glow treatment on a surface. In the same corpus the glows judges read as a
/// treatment reach 1.8x; the ones they read as an indicator start at 2.2x.
pub const GLOW_MAX_AREA_RATIO: f64 = 2.0;

/// How far one shadow layer's light reaches outside its element's box: a CSS
/// blur fades over roughly half its radius to each side, and the spread grows
/// the box the blur is applied to (or, when negative, eats into the blur).
fn glow_extent_px(blur: f64, spread: f64) -> f64 {
    blur / 2.0 + spread
}

/// How far a glow has to move the surface it lands on, in 0..255 channel
/// units, at its brightest point. A blurred shadow is densest at the box's
/// edge, where it carries about half the shadow colour's alpha, so each
/// chromatic layer lifts the surface there by half its ink times the largest
/// channel difference between its colour and the surface, and the layers of
/// one shadow add up.
///
/// Measured on the site corpus (runs 2 to 20): the glows both judges called
/// imperceptible lift their surface by 14 or less (a 20px green halo at 15%
/// alpha around avatars on a near-black page, which sits exactly on
/// [`GLOW_MIN_STRENGTH_PX`]); the glows they could find lift it by 28 or
/// more (a 12px teal button glow at 40% alpha, 20px text glows at 28%, a
/// three-layer blue elevation ramp). One judged glow falls under the floor:
/// a pricing card's 30px halo at 15% alpha (lift 10), whose crop shows no
/// light past the card's edge while the call-to-action glow inside it (lift
/// 28) is still reported.
pub const GLOW_MIN_LIFT: f64 = 20.0;

/// The share of the shadow colour's alpha a blurred shadow carries at the
/// edge of its box.
const GLOW_EDGE_DENSITY: f64 = 0.5;

/// Whether one qualifying shadow layer renders as a glow a reader can see.
/// `element_opacity` and `element_size` are `None` on the engines with no
/// layout, which leaves the blur and the alpha to carry the decision.
/// `surface_lift` is how far the whole shadow lifts the surface it lands on
/// (see [`GLOW_MIN_LIFT`]); the lift test runs only where the engine measured
/// the element (`element_size` is known) and resolved that surface, and the
/// declaration floor decides alone everywhere else.
pub(crate) fn glow_is_perceptible(
    blur: f64,
    spread: f64,
    alpha: f64,
    surface_lift: Option<f64>,
    element_opacity: Option<f64>,
    element_size: Option<(f64, f64)>,
) -> bool {
    let extent = glow_extent_px(blur, spread);
    if extent <= 0.0 {
        // A negative spread that swallows the blur keeps the light in the box.
        return false;
    }
    let ink = alpha * element_opacity.unwrap_or(1.0);
    if blur * ink < GLOW_MIN_STRENGTH_PX {
        return false;
    }
    let Some((width, height)) = element_size else {
        return true;
    };
    let element_area = width * height;
    if element_area <= 0.0 {
        // Nothing is painted, so nothing glows.
        return false;
    }
    let lit_area = (width + 2.0 * extent) * (height + 2.0 * extent) - element_area;
    if lit_area > element_area * GLOW_MAX_AREA_RATIO {
        return false;
    }
    surface_lift.map_or(true, |lift| lift >= GLOW_MIN_LIFT)
}

/// How far the chromatic layers of one shadow value lift `surface` at the
/// edge of the box (see [`GLOW_MIN_LIFT`]). Neutral layers are elevation, not
/// glow light, and do not count, and neither does a layer carrying under half
/// the light a glow needs ([`GLOW_MIN_STRENGTH_PX`]): Tailwind's `shadow-lg`
/// in a 0.2 purple adds a 6px layer at 1.2px of light to its 15px one, and
/// the pair lit nothing on gameghost.manus.space's black page. The layers of
/// an elevation ramp that each carry some of the light still add up.
fn glow_surface_lift(value: &str, surface: &Rgba, element_opacity: Option<f64>) -> f64 {
    let opacity = element_opacity.unwrap_or(1.0);
    split_commas_outside_parens(value)
        .into_iter()
        .filter_map(|layer| {
            let info = find_shadow_color(layer)?;
            let color = info.color?;
            let vals = extract_shadow_lengths(layer, Some((info.start, info.end)));
            let blur = vals.get(2).copied().unwrap_or(0.0);
            (blur * color.alpha_or_one() * opacity >= GLOW_MIN_STRENGTH_PX / 2.0).then_some(color)
        })
        .filter(|color| has_chroma(Some(color), Some(30.0)))
        .map(|color| {
            let difference = (color.r - surface.r)
                .abs()
                .max((color.g - surface.g).abs())
                .max((color.b - surface.b).abs());
            GLOW_EDGE_DENSITY * color.alpha_or_one() * opacity * difference
        })
        .sum()
}

fn glow_scan(
    value: Option<&str>,
    prop: &str,
    on_dark_bg: bool,
    surface: Option<Rgba>,
    element_opacity: Option<f64>,
    element_size: Option<(f64, f64)>,
) -> Option<RuleHit> {
    let value = match value {
        None | Some("") | Some("none") => return None,
        Some(v) => v,
    };
    let surface_lift = surface.map(|s| glow_surface_lift(value, &s, element_opacity));
    for layer in split_commas_outside_parens(value) {
        let info = match find_shadow_color(layer) {
            Some(i) => i,
            None => continue,
        };
        let color = match info.color {
            Some(c) => c,
            None => continue,
        };
        if !has_chroma(Some(&color), Some(30.0)) {
            continue;
        }
        let vals = extract_shadow_lengths(layer, Some((info.start, info.end)));
        if vals.len() < 3 || vals[2] <= 4.0 {
            continue;
        }
        if !glow_is_perceptible(
            vals[2],
            vals.get(3).copied().unwrap_or(0.0),
            color.alpha_or_one(),
            surface_lift,
            element_opacity,
            element_size,
        ) {
            continue;
        }
        if vals[0] == 0.0 && vals[1] == 0.0 {
            return Some(RuleHit::new(
                "dark-glow",
                format!("Zero-offset {} glow ({})", prop, color_to_hex(Some(&color))),
            ));
        }
        if on_dark_bg {
            return Some(RuleHit::new(
                "dark-glow",
                format!(
                    "Colored {} glow ({}) on dark background",
                    prop,
                    color_to_hex(Some(&color))
                ),
            ));
        }
    }
    None
}

/// JS: checks.mjs#checkGlow, plus the perceptibility floor (a layer under
/// `GLOW_MIN_STRENGTH_PX`, or out of scale with its element, is passed over).
pub fn check_glow(opts: &GlowOpts) -> Vec<RuleHit> {
    let on_dark_bg = opts
        .effective_bg
        .map_or(false, |bg| relative_luminance(&bg) < 0.1);
    let opacity = opts.element_opacity;
    let size = opts.element_size;
    let found = glow_scan(
        opts.box_shadow.as_deref(),
        "box-shadow",
        on_dark_bg,
        opts.surface,
        opacity,
        size,
    )
    .or_else(|| {
        glow_scan(
            opts.text_shadow.as_deref(),
            "text-shadow",
            on_dark_bg,
            opts.surface,
            opacity,
            size,
        )
    });
    match found {
        Some(f) => vec![f],
        None => Vec::new(),
    }
}

// ─── Section 6 shared: flat type hierarchy ──────────────────────────────────

/// JS: checks.mjs#TYPE_HIERARCHY_SELECTOR
pub const TYPE_HIERARCHY_SELECTOR: &str = "h1,h2,h3,h4,h5,h6,p,li,td,th,dd,blockquote,figcaption";
/// JS: checks.mjs#TYPE_HIERARCHY_MIN_ROLES
pub const TYPE_HIERARCHY_MIN_ROLES: usize = 3;
/// JS: checks.mjs#TYPE_HIERARCHY_MIN_STEP_RATIO
pub const TYPE_HIERARCHY_MIN_STEP_RATIO: f64 = 1.25;

/// One `{ role, size }` entry the JS pushes into `samples`, plus the
/// element's computed font weight ([`parse_font_weight`]; NaN when it does
/// not read as a weight).
#[derive(Debug, Clone, PartialEq)]
pub struct TypeSample {
    pub role: String,
    pub size: f64,
    pub weight: f64,
}

/// How much heavier than the body text a heading has to be for its weight
/// to separate the roles: two steps of the 100-900 scale (400 to 600).
pub const TYPE_HIERARCHY_WEIGHT_STEP: f64 = 200.0;
/// The share of heading elements that have to be that much heavier.
pub const TYPE_HIERARCHY_WEIGHT_SHARE: f64 = 0.8;

/// A computed `font-weight` as a number: `normal` 400, `bold` 700, a number
/// as itself, anything else NaN.
pub fn parse_font_weight(value: &str) -> f64 {
    let v = js::to_lower_case(js::trim(value));
    match v.as_str() {
        "normal" => 400.0,
        "bold" => 700.0,
        _ => {
            let n = js::parse_float(&v);
            if n.is_finite() && (1.0..=1000.0).contains(&n) {
                n
            } else {
                f64::NAN
            }
        }
    }
}

fn type_sample_in_range(sample: &TypeSample) -> bool {
    let size = math_round(sample.size * 10.0) / 10.0;
    !sample.role.is_empty() && size.is_finite() && (8.0..200.0).contains(&size)
}

/// Whether weight, not size, separates the headings from the body text:
/// the body text's most common weight, and at least four in five heading
/// elements set at least [`TYPE_HIERARCHY_WEIGHT_STEP`] heavier. Dense
/// commerce and listing pages (otto.de) run a tight size ramp on purpose and
/// set every heading bold; a flat ramp there reports as advisory (corpus
/// decision r4-p23-flat-type-hierarchy-commerce).
pub fn type_roles_separated_by_weight(samples: &[TypeSample]) -> bool {
    let mut body_weights: Vec<(f64, usize)> = Vec::new();
    let mut heading_weights: Vec<f64> = Vec::new();
    for sample in samples.iter().filter(|s| type_sample_in_range(s)) {
        if !sample.weight.is_finite() {
            continue;
        }
        if sample.role == "body" {
            match body_weights.iter_mut().find(|(w, _)| *w == sample.weight) {
                Some(slot) => slot.1 += 1,
                None => body_weights.push((sample.weight, 1)),
            }
        } else {
            heading_weights.push(sample.weight);
        }
    }
    // The most common body weight; a tie goes to the lighter one.
    let Some(body) = body_weights
        .iter()
        .max_by(|a, b| a.1.cmp(&b.1).then(b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal)))
        .map(|(w, _)| *w)
    else {
        return false;
    };
    if heading_weights.is_empty() {
        return false;
    }
    let heavier = heading_weights
        .iter()
        .filter(|w| **w >= body + TYPE_HIERARCHY_WEIGHT_STEP)
        .count();
    heavier as f64 >= TYPE_HIERARCHY_WEIGHT_SHARE * heading_weights.len() as f64
}

/// The severity a flat-type-hierarchy finding over `samples` reports at:
/// advisory when weight separates the roles, the rule's own otherwise.
pub fn flat_type_hierarchy_severity(samples: &[TypeSample]) -> Option<&'static str> {
    if type_roles_separated_by_weight(samples) {
        Some("advisory")
    } else {
        None
    }
}

/// JS: checks.mjs#typeHierarchyRole
pub fn type_hierarchy_role(tag: &str) -> String {
    let tag = js::to_lower_case(tag);
    let b = tag.as_bytes();
    if b.len() == 2 && b[0] == b'h' && (b'1'..=b'6').contains(&b[1]) {
        tag
    } else {
        "body".to_string()
    }
}

/// JS: checks.mjs#dominantTypeRoleSize
fn dominant_type_role_size(role: &str, samples: &[f64]) -> Option<f64> {
    // `new Map()` keeps insertion order; the JS sorts by count desc then size asc.
    let mut counts: Vec<(f64, f64)> = Vec::new();
    for size in samples {
        match counts
            .iter_mut()
            .find(|(k, _)| crate::js_ext_b::same_value_zero(*k, *size))
        {
            Some(slot) => slot.1 += 1.0,
            None => counts.push((*size, 1.0)),
        }
    }
    let mut ranked = counts;
    ranked.sort_by(|a, b| {
        b.1.partial_cmp(&a.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal))
    });
    if ranked.len() > 1 && ranked[0].1 == ranked[1].1 {
        // A page whose h1 is set at two sizes equally often (a 66px page title
        // and a 48px closing title) still has a top of its ladder, at the
        // larger size. Every other role with no dominant size stays out, as
        // before: which size stands for an h3 used once at 15px, once at 17px
        // and once at 22px is not something the samples say.
        if role != "h1" {
            return None;
        }
        let top = ranked[0].1;
        return ranked
            .iter()
            .take_while(|(_, count)| *count == top)
            .map(|(size, _)| *size)
            .reduce(math_max);
    }
    ranked.first().map(|(size, _)| *size)
}

/// JS: checks.mjs#checkFlatTypeHierarchySamples
pub fn check_flat_type_hierarchy_samples(samples: &[TypeSample]) -> Vec<RuleHit> {
    // `new Map()` keyed by role, in first-seen order.
    let mut by_role: Vec<(String, Vec<f64>)> = Vec::new();
    for sample in samples {
        let size = math_round(sample.size * 10.0) / 10.0;
        if sample.role.is_empty() || !size.is_finite() || size < 8.0 || size >= 200.0 {
            continue;
        }
        match by_role.iter_mut().find(|(r, _)| *r == sample.role) {
            Some(slot) => slot.1.push(size),
            None => by_role.push((sample.role.clone(), vec![size])),
        }
    }

    // The ladder is read from the roles whose size the samples settle. A
    // heading level with no dominant size drops out, and which of its sizes
    // stands for it is not something the samples say.
    let (mut settled_headings, mut dropped_headings) = (0usize, 0usize);
    let mut dropped_sizes: Vec<f64> = Vec::new();
    let mut roles: Vec<(String, f64)> = Vec::new();
    for (role, sizes) in by_role {
        let heading = role != "body";
        match dominant_type_role_size(&role, &sizes) {
            Some(size) => {
                if heading {
                    settled_headings += sizes.len();
                }
                roles.push((role, size));
            }
            None if heading => {
                dropped_headings += sizes.len();
                dropped_sizes.extend(sizes);
            }
            None => {}
        }
    }

    if roles.len() < TYPE_HIERARCHY_MIN_ROLES {
        return Vec::new();
    }

    // An h1 set smaller than the body text is not the page's title but a
    // label wearing the tag (phillips66.com's 14px "FIND FBOS:" form label
    // over 16px copy); the page's real headline sits in some other element,
    // and a ladder topped by the label measures nothing a reader sees.
    let size_of = |name: &str| roles.iter().find(|(r, _)| r == name).map(|(_, size)| *size);
    if let (Some(h1), Some(body)) = (size_of("h1"), size_of("body")) {
        if h1 < body {
            return Vec::new();
        }
    }

    roles.sort_by(|a, b| {
        a.1.partial_cmp(&b.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            // JS-PARITY: checks.mjs sorts ties with `a.role.localeCompare(b.role)`.
            // Every role is `body` or `h1`..`h6`, lowercase ASCII, where the ICU
            // root collation and byte order agree.
            .then_with(|| a.0.cmp(&b.0))
    });
    let largest_step_of = |sizes: &[f64]| -> f64 {
        let mut step = 1.0f64;
        for i in 1..sizes.len() {
            step = math_max(step, sizes[i] / sizes[i - 1]);
        }
        step
    };
    let ladder: Vec<f64> = roles.iter().map(|(_, size)| *size).collect();
    let largest_step = largest_step_of(&ladder);
    if largest_step >= TYPE_HIERARCHY_MIN_STEP_RATIO {
        return Vec::new();
    }

    // When the dropped heading levels hold most of the page's headings, the
    // ladder leaves out the headings a reader sees, and the verdict rests on
    // what they would add. cnnbrasil.com.br sets its thirty h3s at 14, 16 and
    // 20px, ten each, against twelve h1 and h2 on a 14/16/16 ladder; any of
    // those h3s at 20px stands a 1.25 step above the 16px h2, so the page is
    // not shown flat, and it does not report. When no dropped size would
    // break the flatness (h2s tied at 17 and 18px on a 16/16/18 ladder), the
    // ramp is flat whichever size stands for them, and it reports as before.
    if dropped_headings > settled_headings
        && dropped_sizes.iter().any(|&extra| {
            let mut with = ladder.clone();
            with.push(extra);
            with.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            largest_step_of(&with) >= TYPE_HIERARCHY_MIN_STEP_RATIO
        })
    {
        return Vec::new();
    }

    let role_sizes: Vec<String> = roles
        .iter()
        .map(|(role, size)| format!("{} {}px", role, number_to_string(*size)))
        .collect();
    let weight_note = if type_roles_separated_by_weight(samples) {
        "; weight separates headings from body text"
    } else {
        ""
    };
    vec![RuleHit::new(
        "flat-type-hierarchy",
        format!(
            "Role sizes: {} (largest adjacent step {}:1; target {}:1{weight_note})",
            role_sizes.join(", "),
            to_fixed(largest_step, 2),
            number_to_string(TYPE_HIERARCHY_MIN_STEP_RATIO)
        ),
    )]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rgb(r: f64, g: f64, b: f64) -> Rgba {
        Rgba::new(r, g, b, 1.0)
    }

    fn hero_opts(text: &str, tag: &str, spacing: f64) -> HeroEyebrowOpts {
        HeroEyebrowOpts {
            heading_tag: "h1".to_string(),
            heading_text: Some("How we rebuilt the scheduler".to_string()),
            heading_font_size: 60.0,
            heading_in_application_context: false,
            sibling_tag: Some(tag.to_string()),
            sibling_text: Some(text.to_string()),
            sibling_text_transform: Some("uppercase".to_string()),
            sibling_font_size: 12.0,
            sibling_letter_spacing: spacing,
            sibling_font_weight: Some("500".to_string()),
            sibling_color: Some("rgb(85, 85, 85)".to_string()),
            sibling_has_accent_dash_pseudo: false,
            sibling_tracking_floor_em: Some(HERO_EYEBROW_TRACKING_EM),
            sibling_holds_time: tag == "time",
        }
    }

    /// copperhead.sh: "Engineering/2 September 2026" at 0.1em over a post's
    /// h1 is the post's meta. Under the fixed floor a year or a `<time>`
    /// keeps the em floor from calling it tracked caps; at 1.6px and up the
    /// rule reads as it always did.
    #[test]
    fn hero_eyebrow_em_floor_passes_over_a_dated_meta_line() {
        assert!(check_hero_eyebrow(&hero_opts("Engineering · 2 September 2026", "p", 1.2)).is_empty());
        assert!(check_hero_eyebrow(&hero_opts("Sep 2, 2026", "time", 1.2)).is_empty());
        assert!(check_hero_eyebrow(&hero_opts("Sep 2", "time", 1.2)).is_empty());
        assert_eq!(check_hero_eyebrow(&hero_opts("Now in public beta", "p", 1.2)).len(), 1);
        // Not a year: a version or a count stays an eyebrow.
        assert_eq!(check_hero_eyebrow(&hero_opts("Version 3000 is here", "p", 1.2)).len(), 1);
        // At the fixed floor the date line reports, as it did before.
        assert_eq!(
            check_hero_eyebrow(&hero_opts("Engineering · 2 September 2026", "p", 1.8)).len(),
            1
        );
    }

    /// swipeloan.in: light gray on #04002d, a navy that reads as black.
    #[test]
    fn gray_on_color_bar_rises_as_the_background_darkens() {
        assert!(!background_reads_as_colour(&rgb(4.0, 0.0, 45.0)));
        assert!(!background_reads_as_colour(&rgb(30.0, 0.0, 47.0)));
        assert!(!background_reads_as_colour(&rgb(48.0, 0.0, 0.0)));
        assert!(!background_reads_as_colour(&rgb(15.0, 23.0, 42.0)));
        assert!(background_reads_as_colour(&rgb(0.0, 0.0, 77.0)));
        assert!(background_reads_as_colour(&rgb(0.0, 28.0, 71.0)));
        assert!(background_reads_as_colour(&rgb(0.0, 39.0, 51.0)));
        assert!(background_reads_as_colour(&rgb(33.0, 37.0, 74.0)));
        assert!(background_reads_as_colour(&rgb(30.0, 58.0, 138.0)));
        assert!(background_reads_as_colour(&rgb(0.0, 0.0, 255.0)));
        assert!(background_reads_as_colour(&rgb(17.0, 94.0, 89.0)));
        // At or above a luminance of 0.01 the bar is the old 40.
        assert!(background_reads_as_colour(&rgb(16.0, 185.0, 129.0)));
        assert!(!background_reads_as_colour(&rgb(120.0, 140.0, 150.0)));
    }

    /// glowcase.app 321836: grey-brown on cream reads as near-neutral.
    #[test]
    fn gray_on_color_pale_tints_need_chroma() {
        let hex = |h: &str| crate::color::parse_any_color(Some(h)).unwrap();
        // Pale tints a hue spreads past 40 that the eye reads as off-white.
        for pale in ["#feeed4", "#fde6ba", "#fef3c7", "#dbeafe"] {
            assert!(!background_reads_as_colour(&hex(pale)), "{pale}");
        }
        // Pale colours with chroma, and the oracle's should-flag fills.
        for colour in ["#fcd34d", "#ffff00", "#fde68a", "#1e3a8a", "#115e59", "#10b981"] {
            assert!(background_reads_as_colour(&hex(colour)), "{colour}");
        }
        let (l, c) = crate::color::rgb_to_oklch_lc(&hex("#feeed4"));
        assert!((l - 0.955).abs() < 0.005 && (c - 0.038).abs() < 0.005, "{l} {c}");
    }

    #[test]
    fn gray_on_color_scores_the_near_black_navy_as_gray_on_black() {
        let opts = |bg: Rgba| ColorOpts {
            tag: "div".to_string(),
            text_color: Some(rgb(209.0, 209.0, 209.0)),
            effective_bg: Some(bg),
            font_size: 16.0,
            font_weight: 400.0,
            has_direct_text: true,
            ..Default::default()
        };
        let ids = |bg: Rgba| {
            check_colors(&opts(bg))
                .into_iter()
                .map(|h| h.id)
                .collect::<Vec<_>>()
        };
        assert!(!ids(rgb(4.0, 0.0, 45.0)).contains(&"gray-on-color".to_string()));
        assert!(ids(rgb(30.0, 58.0, 138.0)).contains(&"gray-on-color".to_string()));
    }

    /// veeza.ai: `hover:bg-emerald-400` read as the resting fill.
    #[test]
    fn gray_on_color_classes_skip_state_variants() {
        assert_eq!(find_solid_chromatic_bg("text-slate-500 hover:bg-emerald-400"), None);
        assert_eq!(find_solid_chromatic_bg("group-hover:bg-blue-500 bg-red-600"), Some("bg-red-600"));
        assert_eq!(find_solid_chromatic_bg("md:bg-blue-600"), Some("bg-blue-600"));
        assert_eq!(find_solid_chromatic_bg("dark:bg-indigo-700"), Some("bg-indigo-700"));
        assert!(find_resting_gray_text("focus:text-gray-500 bg-blue-600").is_none());
        assert_eq!(
            find_resting_gray_text("text-gray-400 bg-blue-600").map(|m| m.as_str()),
            Some("text-gray-400")
        );
    }

    /// hse.de: a custom scale's `text-neutral-0` is white, and white on red
    /// is not gray on colour. The browser reads the computed ink when it is
    /// light or coloured; a file engine keeps the class.
    #[test]
    fn gray_on_color_class_reads_the_computed_ink_in_a_browser() {
        let opts = |browser: bool, ink: Option<Rgba>| ColorOpts {
            tag: "span".to_string(),
            text_color: ink,
            class_list: Some("text-neutral-0 bg-red-700".to_string()),
            bg_color: Some(Rgba::new(185.0, 28.0, 28.0, 1.0)),
            has_direct_text: true,
            detector_is_browser: browser,
            font_size: 12.0,
            font_weight: 700.0,
            ..Default::default()
        };
        let gray_class = |o: ColorOpts| {
            check_colors(&o)
                .iter()
                .any(|h| h.id == "gray-on-color" && h.snippet == "text-neutral-0 on bg-red-700")
        };
        let white = Some(Rgba::new(255.0, 255.0, 255.0, 1.0));
        let gray = Some(Rgba::new(115.0, 115.0, 115.0, 1.0));
        assert!(!gray_class(opts(true, white)));
        assert!(!gray_class(opts(true, Some(Rgba::new(220.0, 38.0, 38.0, 1.0)))));
        assert!(gray_class(opts(true, gray)));
        // A cool gray keeps the class: slate-400 grazes the saturation bar.
        assert!(gray_class(opts(true, Some(Rgba::new(148.0, 163.0, 184.0, 1.0)))));
        // Near-black is what an uncompiled utility inherits: no contradiction.
        assert!(gray_class(opts(true, Some(Rgba::new(17.0, 24.0, 39.0, 1.0)))));
        assert!(gray_class(opts(true, None)));
        assert!(gray_class(opts(false, white)));
    }

    /// ai-pact.com and podprime.ai: Tailwind's `bg-primary/10` computes to an
    /// alpha of exactly 0.1.
    #[test]
    fn icon_tile_counts_a_ten_percent_tint() {
        let opts = |a: f64| IconTileOpts {
            heading_tag: "h3".to_string(),
            heading_text: Some("Guest CRM".to_string()),
            heading_top: 706.0,
            sibling_tag: Some("div".to_string()),
            sibling_width: 40.0,
            sibling_height: 40.0,
            sibling_bottom: 694.0,
            sibling_bg_color: Some(Rgba::new(53.0, 80.0, 212.0, a)),
            sibling_bg_image: Some("none".to_string()),
            sibling_border_width: 0.0,
            sibling_border_radius: 8.0,
            has_icon_child: true,
            icon_child_width: 20.0,
            heading_is_card_title: false,
        };
        assert_eq!(check_icon_tile(&opts(0.1)).len(), 1);
        assert_eq!(check_icon_tile(&opts(0.05)).len(), 1);
        assert!(check_icon_tile(&opts(0.04)).is_empty());
    }

    fn samples(pairs: &[(&str, f64)]) -> Vec<TypeSample> {
        pairs
            .iter()
            .map(|(role, size)| TypeSample {
                role: role.to_string(),
                size: *size,
                weight: f64::NAN,
            })
            .collect()
    }

    fn weighted(entries: &[(&str, f64, f64, usize)]) -> Vec<TypeSample> {
        entries
            .iter()
            .flat_map(|(role, size, weight, n)| {
                std::iter::repeat_with(move || TypeSample {
                    role: role.to_string(),
                    size: *size,
                    weight: *weight,
                })
                .take(*n)
            })
            .collect()
    }

    /// otto.de (findings 111427, 112210): headings bold at 14-16px over
    /// 14px regular body text. co-trip.jp (109941): headings at 500 and 400
    /// over 400 body text, which weight does not separate.
    #[test]
    fn flat_type_hierarchy_is_advisory_when_weight_separates_the_roles() {
        let otto = weighted(&[
            ("body", 14.0, 400.0, 580),
            ("h2", 16.0, 700.0, 9),
            ("h2", 12.0, 400.0, 1),
            ("h3", 16.0, 700.0, 12),
            ("h3", 14.0, 700.0, 10),
        ]);
        let hits = check_flat_type_hierarchy_samples(&otto);
        assert_eq!(hits.len(), 1, "{hits:?}");
        assert!(hits[0].snippet.ends_with("target 1.25:1; weight separates headings from body text)"), "{hits:?}");
        assert_eq!(flat_type_hierarchy_severity(&otto), Some("advisory"));

        let co_trip = weighted(&[
            ("body", 14.0, 400.0, 123),
            ("h1", 16.0, 500.0, 2),
            ("h2", 16.0, 500.0, 10),
            ("h2", 16.0, 400.0, 8),
            ("h3", 11.7, 400.0, 16),
        ]);
        let hits = check_flat_type_hierarchy_samples(&co_trip);
        assert_eq!(hits.len(), 1, "{hits:?}");
        assert!(hits[0].snippet.ends_with("target 1.25:1)"), "{hits:?}");
        assert_eq!(flat_type_hierarchy_severity(&co_trip), None);

        // One heading in five at body weight is still weight-separated; two
        // in five is not.
        let mostly = weighted(&[("body", 14.0, 400.0, 20), ("h2", 16.0, 700.0, 4), ("h3", 15.0, 400.0, 1)]);
        assert!(type_roles_separated_by_weight(&mostly));
        let split = weighted(&[("body", 14.0, 400.0, 20), ("h2", 16.0, 700.0, 3), ("h3", 15.0, 400.0, 2)]);
        assert!(!type_roles_separated_by_weight(&split));
        // Unread weights say nothing.
        assert!(!type_roles_separated_by_weight(&samples(&[("body", 14.0), ("h2", 16.0)])));
        assert_eq!(parse_font_weight("bold"), 700.0);
        assert_eq!(parse_font_weight(" 600 "), 600.0);
        assert!(parse_font_weight("bolder").is_nan());
    }

    /// copperhead.sh: a 66px title and a 48px closing title, both h1.
    #[test]
    fn flat_type_hierarchy_keeps_a_tied_h1_at_its_larger_size() {
        let mut page = vec![("h1", 66.56), ("h1", 48.64)];
        page.extend([("p", 17.0); 6].iter().map(|(_, s)| ("body", *s)));
        page.extend([("h2", 18.4); 4]);
        page.extend([("h3", 20.8); 8]);
        assert!(check_flat_type_hierarchy_samples(&samples(&page)).is_empty());

        // A tie between two sizes close to the rest still reads as flat.
        let mut flat = vec![("h1", 22.0), ("h1", 21.0)];
        flat.extend([("body", 17.0); 6]);
        flat.extend([("h2", 18.4); 4]);
        flat.extend([("h3", 20.8); 8]);
        let hits = check_flat_type_hierarchy_samples(&samples(&flat));
        assert_eq!(hits.len(), 1, "{hits:?}");
        assert!(hits[0].snippet.contains("h1 22px"), "{hits:?}");

        // Any other tied role stays out of the ladder, as before.
        let mut h3_tie = vec![("h1", 18.0), ("h1", 18.0)];
        h3_tie.extend([("body", 16.0); 4]);
        h3_tie.extend([("h2", 16.0); 3]);
        h3_tie.extend([("h3", 15.0), ("h3", 22.0)]);
        let hits = check_flat_type_hierarchy_samples(&samples(&h3_tie));
        assert!(hits.is_empty() || !hits[0].snippet.contains("h3"), "{hits:?}");
    }

    /// observations-28 row 23: the ladder leaves out the headings a reader
    /// sees. cnnbrasil.com.br sets its thirty h3 headlines at 14, 16 and 20px,
    /// ten each, so the h3 role drops out and a 14/16/16 ladder of body, h1
    /// and h2 reports; phillips66.com's h1 is a 14px form label over 16px
    /// copy. Neither ladder describes the page, and neither reports. A
    /// dropped level declines only when one of its sizes would break the
    /// flatness, and only when it holds more headings than the ladder does:
    /// a tied role holding fewer stays out as before (otto.de's two h2s at 16
    /// and 26px beside an h1, an h3 and an h4).
    #[test]
    fn flat_type_hierarchy_declines_a_ladder_without_the_page_headings() {
        let mut news = vec![("h1", 16.0)];
        news.extend([("body", 14.0); 99]);
        news.extend([("body", 16.0); 44]);
        news.extend([("h2", 16.0); 6]);
        news.extend([("h2", 30.0); 3]);
        news.extend([("h3", 14.0); 10]);
        news.extend([("h3", 16.0); 10]);
        news.extend([("h3", 20.0); 10]);
        assert!(check_flat_type_hierarchy_samples(&samples(&news)).is_empty(), "the h3 role drops out");
        // With one h3 size settled, the ladder holds what a reader sees.
        news.push(("h3", 16.0));
        let hits = check_flat_type_hierarchy_samples(&samples(&news));
        assert_eq!(hits.len(), 1, "{hits:?}");
        assert!(hits[0].snippet.contains("h3 16px"), "{hits:?}");

        let mut label = vec![("h1", 14.0)];
        label.extend([("body", 16.0); 26]);
        label.extend([("body", 15.0); 15]);
        label.extend([("h2", 15.0); 3]);
        assert!(check_flat_type_hierarchy_samples(&samples(&label)).is_empty(), "h1 under body size");
        // An h1 at the body size still counts.
        label[0] = ("h1", 16.0);
        assert_eq!(check_flat_type_hierarchy_samples(&samples(&label)).len(), 1);

        // A dropped level whose sizes would all keep the ramp flat changes
        // nothing: h2s tied at 17 and 18px, most of the headings, on a
        // body 16px, h3 16px, h1 18px ladder.
        let mut tie = vec![("h1", 18.0), ("h2", 17.0), ("h2", 18.0), ("h2", 17.0), ("h2", 18.0), ("h3", 16.0)];
        tie.extend([("body", 16.0); 12]);
        let hits = check_flat_type_hierarchy_samples(&samples(&tie));
        assert_eq!(hits.len(), 1, "the tied h2s keep it flat: {hits:?}");
        assert!(hits[0].snippet.starts_with("Role sizes: body 16px, h3 16px, h1 18px"), "{hits:?}");
        // Tied h2s at 17 and 23px: 23px stands a 1.28 step above the 18px
        // h1, so the ladder does not show the page flat, and it declines.
        tie[2] = ("h2", 23.0);
        tie[4] = ("h2", 23.0);
        assert!(check_flat_type_hierarchy_samples(&samples(&tie)).is_empty(), "a 23px h2 breaks the flatness");

        let mut otto = vec![("h1", 16.0), ("h2", 16.0), ("h2", 26.0), ("h3", 16.0), ("h4", 12.0)];
        otto.extend([("body", 14.0); 357]);
        otto.extend([("body", 12.0); 46]);
        let hits = check_flat_type_hierarchy_samples(&samples(&otto));
        assert_eq!(hits.len(), 1, "a tied minority role stays out: {hits:?}");
        assert!(hits[0].snippet.starts_with("Role sizes: h4 12px, body 14px, h1 16px, h3 16px"), "{hits:?}");
    }

    #[test]
    fn a_provisional_claim_gives_way_to_a_copy_on_screen() {
        let hit = || RuleHit::new("low-contrast", "2.2:1 (need 4.5:1) — text #c9a3c8 on #ffffff".to_string());
        let keys = |h: &RuleHit| vec![h.snippet.clone()];
        let claim = |owner: u64, on_screen: bool| Some(PairClaim { owner, on_screen });
        let mut seen = SafeTagTextSeen::default();
        let mut cut = vec![hit()];
        seen.keep_first_keyed_claiming(&mut cut, &keys, claim(1, false), &mut |_| true);
        assert_eq!(cut.len(), 1, "the first cut copy stands for now");
        let mut second_cut = vec![hit()];
        seen.keep_first_keyed_claiming(&mut second_cut, &keys, claim(2, false), &mut |_| true);
        assert!(second_cut.is_empty(), "a second cut copy adds nothing");
        let mut waived = vec![hit()];
        seen.keep_first_keyed_claiming(&mut waived, &keys, claim(3, true), &mut |_| false);
        assert!(waived.is_empty());
        assert!(seen.take_superseded().is_empty(), "a waived copy replaces nothing");
        let mut readable = vec![hit()];
        seen.keep_first_keyed_claiming(&mut readable, &keys, claim(4, true), &mut |_| true);
        assert_eq!(readable.len(), 1);
        assert_eq!(seen.take_superseded(), vec![(1, hit().snippet)]);
        let mut again = vec![hit()];
        seen.keep_first_keyed_claiming(&mut again, &keys, claim(5, true), &mut |_| true);
        assert!(again.is_empty(), "the readable copy owns the pair");
        let mut lone = SafeTagTextSeen::default();
        let mut only = vec![hit()];
        lone.keep_first_keyed_claiming(&mut only, &keys, claim(6, false), &mut |_| true);
        assert_eq!(only.len(), 1);
        assert!(lone.take_superseded().is_empty(), "a cut copy nobody replaces stands");
    }

    #[test]
    fn translucent_inks_on_one_gradient_box_are_separate_pairs() {
        // veeza.ai: `text-blue-100/70` on a link and `/80` on a caption beside
        // it, on one blue gradient section.
        let span = |alpha: f64| {
            let ink = Rgba::new(219.0, 234.0, 254.0, alpha);
            ColorOpts {
                tag: "span".to_string(),
                text_color: Some(ink),
                effective_bg_stops: Some(vec![Rgba::new(37.0, 99.0, 235.0, 1.0)]),
                font_size: 12.0,
                font_weight: 400.0,
                has_direct_text: true,
                paints_own_text: true,
                detector_is_browser: true,
                visible_text: Some(ink),
                bg_source: Some("gradient on section.blue-band".to_string()),
                bg_source_host: Some("7".to_string()),
                ..Default::default()
            }
        };
        let mut seen = SafeTagTextSeen::default();
        assert_eq!(check_colors_deduped(&span(0.7), &mut seen, &mut |_| true).len(), 1);
        assert_eq!(check_colors_deduped(&span(0.8), &mut seen, &mut |_| true).len(), 1);
        assert!(check_colors_deduped(&span(0.8), &mut seen, &mut |_| true).is_empty());
    }

    #[test]
    fn the_full_pass_guard_is_opt_in() {
        let white = Rgba::new(255.0, 255.0, 255.0, 1.0);
        let opts = |guard: bool| ColorOpts {
            tag: "p".to_string(),
            text_color: Some(white),
            effective_bg: Some(white),
            font_size: 16.0,
            font_weight: 400.0,
            has_direct_text: true,
            same_color_surface_is_unread: guard,
            ..Default::default()
        };
        assert!(check_colors(&opts(false)).iter().any(|h| h.id == "low-contrast"));
        assert!(!check_colors(&opts(true)).iter().any(|h| h.id == "low-contrast"));
    }

    #[test]
    fn icon_fonts_and_close_letters() {
        assert!(is_icon_font_family("\"Material Symbols Outlined\""));
        assert!(is_icon_font_family("'Material Icons', sans-serif"));
        assert!(is_icon_font_family("icomoon"));
        assert!(is_icon_font_family("Brand Icons, sans-serif"));
        assert!(!is_icon_font_family("Inter, sans-serif"));
        assert!(!is_icon_font_family("sans-serif, 'Material Icons'"));
        assert!(is_icon_ligature_text("arrow_forward", "Material Symbols Outlined"));
        assert!(is_icon_ligature_text("counter_1", "Material Icons"));
        assert!(!is_icon_ligature_text("Arrow forward", "Material Symbols Outlined"));
        assert!(!is_icon_ligature_text("arrow_forward", "Inter"));
        assert!(is_close_letter_text(" x "));
        assert!(!is_close_letter_text("xl"));
        assert!(names_close_control(&["modal-closeButton"]));
        assert!(names_close_control(&["", "Dismiss banner"]));
        assert!(!names_close_control(&["tag", "chip"]));
    }

    #[test]
    fn declared_corners_apply_in_order() {
        let mut c = DeclaredCorners::default();
        assert!(!c.declared());
        assert!(!c.is_rounded_away_from_side(3));
        assert!(!c.apply("padding", "12px", NOMINAL_CARD_WIDTH_PX));
        assert!(c.apply("border-radius", "12px", NOMINAL_CARD_WIDTH_PX));
        assert!(c.is_rounded_away_from_side(3));
        assert!(c.apply("border-top-right-radius", "0", NOMINAL_CARD_WIDTH_PX));
        assert!(!c.is_rounded_away_from_side(3));
        // The far corners of a right stripe are still round.
        assert!(c.is_rounded_away_from_side(1));
        // camelCase with a bare number is px; quotes and !important strip.
        let mut js = DeclaredCorners::default();
        js.apply("borderRadius", "12", NOMINAL_CARD_WIDTH_PX);
        assert!(js.is_rounded_away_from_side(3));
        let mut quoted = DeclaredCorners::default();
        quoted.apply("borderRadius", "'2px'", NOMINAL_CARD_WIDTH_PX);
        assert!(!quoted.is_rounded_away_from_side(3));
        let mut important = DeclaredCorners::default();
        important.apply("border-radius", "8px !important", NOMINAL_CARD_WIDTH_PX);
        assert!(important.is_rounded_away_from_side(3));
        // Logical longhands map onto the physical corners (LTR).
        let mut logical = DeclaredCorners::default();
        logical.apply("border-start-end-radius", "8px", NOMINAL_CARD_WIDTH_PX);
        logical.apply("border-end-end-radius", "8px", NOMINAL_CARD_WIDTH_PX);
        assert!(logical.is_rounded_away_from_side(3));
        // Unresolvable is unknown, and unknown keeps the finding.
        let mut unknown = DeclaredCorners::default();
        unknown.apply("border-radius", "$radius", NOMINAL_CARD_WIDTH_PX);
        assert!(unknown.is_rounded_away_from_side(3));
        // A conditional class only ever rounds.
        let mut raised = DeclaredCorners::default();
        raised.set_all(Some(Corners::default()));
        raised.raise_corner(1, Some(8.0));
        raised.raise_corner(2, Some(8.0));
        raised.raise_corner(0, Some(0.0));
        assert!(raised.is_rounded_away_from_side(3));
        assert!(!raised.is_rounded_away_from_side(1));
    }

    #[test]
    fn declared_corners_stay_unknown_until_a_literal_replaces_them() {
        let mut c = DeclaredCorners::unknown();
        assert!(c.declared());
        assert!(c.is_rounded_away_from_side(3));
        assert_eq!(c.to_corners(), None);
        c.apply("border-radius", "0", NOMINAL_CARD_WIDTH_PX);
        assert!(!c.is_rounded_away_from_side(3));
        assert_eq!(c.to_corners(), Some(Corners::default()));
        // A mixin after the literal makes the corners unknown again.
        c.set_unknown();
        assert!(c.is_rounded_away_from_side(1));
        // No declaration at all is the cascade's square default.
        assert_eq!(
            DeclaredCorners::default().to_corners(),
            Some(Corners::default())
        );
        // Utility classes: a known size resolves, an unknown one stays unknown.
        assert_eq!(
            tailwind_declared_corners("rounded-none").to_corners(),
            Some(Corners::default())
        );
        assert_eq!(tailwind_declared_corners("rounded-card").to_corners(), None);
        assert!(!tailwind_declared_corners("p-4 border-l-4").declared());
    }

    // Expected values below were produced by running the JS functions in
    // Node against the same inputs.

    #[test]
    fn hover_contrast_matches_node() {
        let hits = check_hover_contrast(&HoverContrastOpts {
            tag: "div".into(),
            text_color: Some(Rgba::new(120.0, 120.0, 120.0, 1.0)),
            bg: Some(Rgba::new(255.0, 255.0, 255.0, 1.0)),
            own_bg_alpha: Some(1.0),
            font_size: 16.0,
            font_weight: 400.0,
            has_direct_text: true,
            is_emoji_only: false,
        });
        assert_eq!(hits.len(), 1);
        assert_eq!(
            hits[0].snippet,
            ":hover state 4.4:1 (need 4.5:1) — text #787878 on #ffffff"
        );
        // SAFE_TAGS suppression without an own background.
        let none = check_hover_contrast(&HoverContrastOpts {
            tag: "a".into(),
            text_color: Some(Rgba::new(120.0, 120.0, 120.0, 1.0)),
            bg: Some(Rgba::new(255.0, 255.0, 255.0, 1.0)),
            own_bg_alpha: Some(0.2),
            font_size: 16.0,
            font_weight: 400.0,
            has_direct_text: true,
            is_emoji_only: false,
        });
        assert!(none.is_empty());
        // Large bold text uses the 3:1 threshold.
        let large = check_hover_contrast(&HoverContrastOpts {
            tag: "button".into(),
            text_color: Some(Rgba::new(160.0, 160.0, 160.0, 1.0)),
            bg: Some(Rgba::new(255.0, 255.0, 255.0, 1.0)),
            own_bg_alpha: Some(1.0),
            font_size: 19.0,
            font_weight: 700.0,
            has_direct_text: true,
            is_emoji_only: false,
        });
        assert_eq!(
            large[0].snippet,
            ":hover state 2.6:1 (need 3:1) — text #a0a0a0 on #ffffff"
        );
    }

    #[test]
    fn a_ratio_just_under_the_bar_never_prints_as_the_bar() {
        let hover = |text: Rgba, bg: Rgba, font_size: f64| {
            check_hover_contrast(&HoverContrastOpts {
                tag: "div".into(),
                text_color: Some(text),
                bg: Some(bg),
                own_bg_alpha: Some(1.0),
                font_size,
                font_weight: 400.0,
                has_direct_text: true,
                is_emoji_only: false,
            })
        };
        // #747474 on black is 4.49:1, which one decimal rounded to the bar.
        let grey = Rgba::new(116.0, 116.0, 116.0, 1.0);
        let black = Rgba::new(0.0, 0.0, 0.0, 1.0);
        assert_eq!(
            hover(grey, black, 16.0)[0].snippet,
            ":hover state 4.49:1 (need 4.5:1) — text #747474 on #000000"
        );
        // #595959 on black is 2.998:1: two decimals round to 3.00, so they are cut.
        let dim = Rgba::new(89.0, 89.0, 89.0, 1.0);
        assert_eq!(
            hover(dim, black, 24.0)[0].snippet,
            ":hover state 2.99:1 (need 3:1) — text #595959 on #000000"
        );
        // Far under the bar, one decimal as before.
        let pale = Rgba::new(160.0, 160.0, 160.0, 1.0);
        let white = Rgba::new(255.0, 255.0, 255.0, 1.0);
        assert_eq!(
            hover(pale, white, 16.0)[0].snippet,
            ":hover state 2.6:1 (need 4.5:1) — text #a0a0a0 on #ffffff"
        );
    }

    #[test]
    fn glow_needs_to_be_perceptible() {
        let glow = |shadow: &str, opacity: f64, size: Option<(f64, f64)>| {
            check_glow(&GlowOpts {
                box_shadow: Some(shadow.to_string()),
                text_shadow: None,
                effective_bg: Some(Rgba::new(17.0, 24.0, 39.0, 1.0)),
                element_opacity: Some(opacity),
                element_size: size,
                surface: Some(Rgba::new(17.0, 24.0, 39.0, 1.0)),
            })
        };
        // A 24px halo at 60% alpha around a 197x40 button: the treatment the
        // rule is for.
        assert_eq!(
            glow("rgba(0, 169, 255, 0.6) 0px 0px 24px 0px", 1.0, Some((197.0, 40.0))).len(),
            1
        );
        // 10% alpha over 20px of blur is 2.0px of light on a 393x42 card.
        assert!(glow("rgba(149, 100, 255, 0.1) 0px 4px 20px 0px", 1.0, Some((393.0, 42.0)))
            .is_empty());
        // A 3x23px typing caret, caught mid-blink at 56% opacity.
        assert!(glow(
            "rgba(155, 123, 232, 0.38) 0px 0px 9.9px 1.5px",
            0.56,
            Some((3.0, 23.0))
        )
        .is_empty());
        // The same caret at full opacity clears the strength floor, but its
        // halo covers seven times the caret: an indicator, not a treatment.
        assert!(glow(
            "rgba(155, 123, 232, 0.38) 0px 0px 9.9px 1.5px",
            1.0,
            Some((3.0, 23.0))
        )
        .is_empty());
        // A 6px status LED with an 8px halo.
        assert!(glow("rgba(92, 189, 104, 0.5) 0px 0px 8px 0px", 1.0, Some((6.0, 6.0))).is_empty());
        // A negative spread that swallows the blur: no light leaves the box.
        assert!(
            glow("rgba(52, 211, 153, 0.4) 0px 0px 40px -22px", 1.0, Some((280.0, 147.0)))
                .is_empty()
        );
        // An element with nothing painted.
        assert!(glow("rgba(0, 169, 255, 0.6) 0px 0px 24px 0px", 1.0, Some((0.0, 0.0))).is_empty());
        // Without layout the blur and the alpha decide on their own.
        assert_eq!(
            glow("rgba(92, 189, 104, 0.5) 0px 0px 8px 0px", 1.0, None).len(),
            1
        );
        // A stacked elevation ramp reports the layer that carries the light,
        // not the faint one it happens to reach first.
        let ramp = "rgba(64, 120, 168, 0.37) 0px 0.7px 0.7px -0.67px, \
                    rgba(64, 120, 168, 0.31) 0px 6.87px 6.87px -2.67px, \
                    rgba(64, 120, 168, 0.247) 0px 13.65px 13.65px -3.33px";
        assert_eq!(glow(ramp, 1.0, Some((96.0, 96.0))).len(), 1);
        // A 20px green halo at 15% alpha around an 80px avatar sits exactly
        // on the strength floor, but lifts a near-black page by 14: nobody
        // sees it. The same halo at 40% alpha lifts it by 36.
        let avatar = |alpha: f64| {
            check_glow(&GlowOpts {
                box_shadow: Some(format!("rgba(33, 196, 93, {alpha}) 0px 0px 20px 0px")),
                text_shadow: None,
                effective_bg: Some(Rgba::new(10.0, 10.0, 12.0, 1.0)),
                element_opacity: Some(1.0),
                element_size: Some((80.0, 80.0)),
                surface: Some(Rgba::new(10.0, 10.0, 12.0, 1.0)),
            })
        };
        assert!(avatar(0.15).is_empty());
        assert_eq!(avatar(0.4).len(), 1);
        // Tailwind's `shadow-lg shadow-purple-900/20` on a black page: the 6px
        // layer carries 1.2px of light and lights nothing, and the 15px layer
        // alone lifts the page by 14 (gameghost.manus.space).
        let black = Rgba::new(0.0, 0.0, 0.0, 1.0);
        let shadow_lg = check_glow(&GlowOpts {
            box_shadow: Some(
                "oklab(0.381 0.100917 -0.144194 / 0.2) 0px 10px 15px -3px, oklab(0.381 0.100917 -0.144194 / 0.2) 0px 4px 6px -4px"
                    .to_string(),
            ),
            text_shadow: None,
            effective_bg: Some(black),
            element_opacity: Some(1.0),
            element_size: Some((208.0, 36.0)),
            surface: Some(black),
        });
        assert!(shadow_lg.is_empty(), "{shadow_lg:?}");
        // With no resolved fill behind it (a gradient, an image) the lift is
        // not measured, and the strength floor decides as before.
        let unresolved = check_glow(&GlowOpts {
            box_shadow: Some("rgba(33, 196, 93, 0.15) 0px 0px 20px 0px".to_string()),
            text_shadow: None,
            effective_bg: Some(Rgba::new(128.0, 88.0, 0.0, 1.0)),
            element_opacity: Some(1.0),
            element_size: Some((80.0, 80.0)),
            surface: None,
        });
        assert_eq!(unresolved.len(), 1);
    }

    #[test]
    fn hero_heading_size_matches_node() {
        assert_eq!(resolve_hero_heading_size_px(Some("3rem")), 48.0);
        assert_eq!(resolve_hero_heading_size_px(Some(" 56PX ")), 56.0);
        assert_eq!(resolve_hero_heading_size_px(Some("200%")), 32.0);
        assert_eq!(
            resolve_hero_heading_size_px(Some("clamp(2rem, 5vw, 4.5rem)")),
            72.0
        );
        assert_eq!(
            resolve_hero_heading_size_px(Some("clamp(40px, 6vw, 10vw)")),
            40.0
        );
        assert_eq!(resolve_hero_heading_size_px(Some("clamp(5vw, 6vw)")), 0.0);
        assert_eq!(resolve_hero_heading_size_px(Some("5vw")), 0.0);
        assert_eq!(resolve_hero_heading_size_px(None), 0.0);
        assert_eq!(resolve_hero_heading_size_px(Some("")), 0.0);
        assert_eq!(resolve_hero_heading_size_px(Some(".5em")), 8.0);
    }

    #[test]
    fn shadow_helpers_match_node() {
        let c = find_shadow_color("0 0 20px rgba(59,130,246,0.4)").unwrap();
        assert_eq!((c.start, c.end), (9, 29));
        assert_eq!(c.color, Some(Rgba::new(59.0, 130.0, 246.0, 0.4)));
        let hex = find_shadow_color("0 0 20px #3b82f6").unwrap();
        assert_eq!((hex.start, hex.end), (9, 16));
        let named = find_shadow_color("inset 0 0 4px Red").unwrap();
        assert_eq!((named.start, named.end), (14, 17));
        assert_eq!(named.color, Some(Rgba::new(255.0, 0.0, 0.0, 1.0)));
        assert!(find_shadow_color("0 0 4px var(--x)").is_none());
        let p3 = find_shadow_color("0 0 4px color(display-p3 1 0 0)").unwrap();
        assert_eq!((p3.start, p3.end), (8, 31));
        assert_eq!(p3.color, Some(Rgba::new(255.0, 0.0, 0.0, 1.0)));
        assert_eq!(
            extract_shadow_lengths("0 0 20px rgba(59,130,246,0.4)", Some((9, 29))),
            vec![0.0, 0.0, 20.0]
        );
        assert_eq!(
            extract_shadow_lengths("0 1rem .5em 2px", None),
            vec![0.0, 16.0, 8.0, 2.0]
        );
        assert_eq!(
            extract_shadow_lengths("rgb(1, 2, 3) 0px 0px 20px", None),
            vec![1.0, 2.0, 3.0, 0.0, 0.0, 20.0]
        );
    }

    #[test]
    fn glyph_only_text_is_not_scored_on_any_path() {
        // A lone circle in white at 20% on green (bt.cn): the full pass for
        // a div scored it at 1.3:1, while the same glyph in a span was
        // already skipped. Words in that ink still report.
        let opts = |is_glyph_only: bool| ColorOpts {
            tag: "div".to_string(),
            text_color: Some(Rgba::new(255.0, 255.0, 255.0, 0.2)),
            effective_bg: Some(Rgba::new(29.0, 150.0, 52.0, 1.0)),
            visible_text: Some(Rgba::new(255.0, 255.0, 255.0, 0.2)),
            font_size: 20.0,
            font_weight: 400.0,
            has_direct_text: true,
            is_glyph_only,
            bg_clip: Some("border-box".to_string()),
            bg_image: Some("none".to_string()),
            ..Default::default()
        };
        assert!(check_colors(&opts(false)).iter().any(|h| h.id == "low-contrast"));
        let glyph = check_colors(&opts(true));
        assert!(
            glyph.iter().all(|h| h.id != "low-contrast" && h.id != "gray-on-color"),
            "{glyph:?}"
        );
    }

    #[test]
    fn gray_on_color_opacity_tint() {
        let hits = |class_list: &str| {
            check_colors(&ColorOpts {
                tag: "div".to_string(),
                font_size: 14.0,
                font_weight: 400.0,
                has_direct_text: true,
                class_list: Some(class_list.to_string()),
                ..Default::default()
            })
            .into_iter()
            .filter(|h| h.id == "gray-on-color")
            .map(|h| h.snippet)
            .collect::<Vec<_>>()
        };
        // #707: a `/10` opacity tint is not a solid chromatic fill.
        assert!(hits("text-slate-300 hover:bg-red-500/10").is_empty());
        assert!(hits("text-slate-300 bg-red-500/10").is_empty());
        assert_eq!(hits("text-slate-300 bg-red-500"), vec!["text-slate-300 on bg-red-500"]);
        // A later solid class still pairs when an earlier one is a tint.
        assert_eq!(
            hits("text-slate-300 bg-red-500/10 bg-teal-600"),
            vec!["text-slate-300 on bg-teal-600"]
        );
    }

    /// REN-404. The bench's masthead: `#e8edf2` nav links on `#123a36`. The
    /// ink is an off-white with a cool tint, not gray, and the pairing clears
    /// contrast; the old test called everything under 0.85 relative luminance
    /// gray and charged it three times over on a page with nothing wrong.
    #[test]
    fn off_white_on_a_colour_is_not_gray_ink() {
        let ink = |hex_r: f64, hex_g: f64, hex_b: f64| {
            check_colors(&ColorOpts {
                tag: "p".to_string(),
                font_size: 15.0,
                font_weight: 400.0,
                has_direct_text: true,
                text_color: Some(Rgba::new(hex_r, hex_g, hex_b, 1.0)),
                effective_bg: Some(Rgba::new(18.0, 58.0, 54.0, 1.0)),
                ..Default::default()
            })
            .into_iter()
            .map(|h| h.id)
            .collect::<Vec<_>>()
        };
        // #e8edf2 on #123a36.
        assert_eq!(ink(232.0, 237.0, 242.0), Vec::<String>::new());
        // White, the other neutral ink a coloured surface carries.
        assert_eq!(ink(255.0, 255.0, 255.0), Vec::<String>::new());
        // #8a8f8c: the muddy middle, still charged, and the contrast check
        // beside it is untouched.
        assert_eq!(
            ink(138.0, 143.0, 140.0),
            vec!["gray-on-color".to_string(), "low-contrast".to_string()]
        );
    }

    /// Near-black ink on a colour reads as body ink: `#393939` on `#ffc224`
    /// and `#413c38` on `#38e07b` measure 6 to 8:1 and were judged harmless
    /// on a corpus of real sites. A `-700` or darker neutral class is the
    /// same ink.
    #[test]
    fn near_black_ink_on_a_colour_is_not_gray() {
        let ids = |text: Rgba, bg: Rgba| {
            check_colors(&ColorOpts {
                tag: "p".to_string(),
                font_size: 18.0,
                font_weight: 400.0,
                has_direct_text: true,
                text_color: Some(text),
                effective_bg: Some(bg),
                ..Default::default()
            })
            .into_iter()
            .map(|h| h.id)
            .collect::<Vec<_>>()
        };
        let yellow = Rgba::new(255.0, 194.0, 36.0, 1.0);
        let green = Rgba::new(56.0, 224.0, 123.0, 1.0);
        assert!(ids(Rgba::new(57.0, 57.0, 57.0, 1.0), yellow).is_empty());
        assert!(ids(Rgba::new(65.0, 60.0, 56.0, 1.0), green).is_empty());
        // gray-600 on a blue panel is still gray.
        assert_eq!(
            ids(Rgba::new(75.0, 85.0, 99.0, 1.0), Rgba::new(37.0, 99.0, 235.0, 1.0)),
            vec!["gray-on-color".to_string(), "low-contrast".to_string()]
        );
        let class_hits = |class: &str| {
            check_colors(&ColorOpts {
                tag: "div".to_string(),
                class_list: Some(class.to_string()),
                ..Default::default()
            })
            .into_iter()
            .filter(|h| h.id == "gray-on-color")
            .map(|h| h.snippet)
            .collect::<Vec<_>>()
        };
        assert!(class_hits("text-gray-800 bg-yellow-400").is_empty());
        assert!(class_hits("text-neutral-700 bg-green-400").is_empty());
        assert_eq!(
            class_hits("text-gray-600 bg-blue-600"),
            vec!["text-gray-600 on bg-blue-600"]
        );
        // A darker class first does not hide a gray one after it.
        assert_eq!(
            class_hits("text-gray-900 md:text-gray-400 bg-blue-600"),
            vec!["text-gray-400 on bg-blue-600"]
        );
    }

    #[test]
    fn placeholder_colors_ignore_host_class_heuristics() {
        let opts = ColorOpts {
            tag: "input".to_string(),
            effective_bg: Some(Rgba::new(255.0, 255.0, 255.0, 1.0)),
            font_size: 24.0,
            font_weight: 400.0,
            class_list: Some("text-slate-300 bg-red-500".to_string()),
            bg_clip: Some("text".to_string()),
            bg_image: Some("linear-gradient(red, blue)".to_string()),
            ..Default::default()
        };
        let ink = check_placeholder_colors(&opts, "Name", Rgba::new(26.0, 26.0, 26.0, 1.0));
        assert!(ink.is_empty(), "{ink:?}");
        let pale = check_placeholder_colors(&opts, "Name", Rgba::new(187.0, 187.0, 187.0, 1.0));
        assert_eq!(pale.len(), 1);
        assert_eq!(pale[0].id, "low-contrast");
        assert!(pale[0].snippet.contains("placeholder \"Name\""), "{pale:?}");
        // No resolved surface and no gradient stops: nothing to score.
        let unresolved = ColorOpts {
            effective_bg: None,
            effective_bg_stops: None,
            ..opts.clone()
        };
        let none = check_placeholder_colors(&unresolved, "Name", Rgba::new(187.0, 187.0, 187.0, 1.0));
        assert!(none.is_empty(), "{none:?}");
        // Translucent black over a light gradient: flatten per stop, then score.
        let gradient = ColorOpts {
            effective_bg: None,
            effective_bg_stops: Some(vec![
                Rgba::new(255.0, 255.0, 255.0, 1.0),
                Rgba::new(240.0, 240.0, 240.0, 1.0),
            ]),
            ..opts.clone()
        };
        let wash = check_placeholder_colors(
            &gradient,
            "Name",
            Rgba::new(0.0, 0.0, 0.0, 0.2),
        );
        assert_eq!(wash.len(), 1, "{wash:?}");
        assert_eq!(wash[0].id, "low-contrast");
    }

    #[test]
    fn a_gradient_text_colour_is_reported_once_per_box_not_per_label() {
        let white = Rgba::new(255.0, 255.0, 255.0, 1.0);
        let tile = |stops: Vec<Rgba>, host: Option<&str>| ColorOpts {
            tag: "span".to_string(),
            text_color: Some(white),
            effective_bg_stops: Some(stops),
            font_size: 24.0,
            font_weight: 700.0,
            has_direct_text: true,
            paints_own_text: true,
            bg_clip: Some("border-box".to_string()),
            bg_image: Some("none".to_string()),
            bg_source: Some("gradient on div.w-14".to_string()),
            bg_source_host: host.map(str::to_string),
            ..Default::default()
        };
        let amber = vec![Rgba::new(251.0, 191.0, 36.0, 1.0)];
        let amber_edge = vec![Rgba::new(249.0, 179.0, 27.0, 1.0)];
        let lime = vec![Rgba::new(163.0, 230.0, 53.0, 1.0)];
        let report = |seen: &mut SafeTagTextSeen, opts: &ColorOpts| {
            check_colors_deduped(opts, seen, &mut |_h: &RuleHit| true)
                .into_iter()
                .filter(|h| h.id == "low-contrast")
                .count()
        };

        // chorusai.replit.app: tiles sharing `div.w-14` on amber and lime
        // gradients are two surfaces, and the lime one still reports.
        let mut seen = SafeTagTextSeen::default();
        assert_eq!(report(&mut seen, &tile(amber.clone(), Some("12"))), 1);
        assert_eq!(report(&mut seen, &tile(lime.clone(), Some("40"))), 1);
        // A second element on the amber box, sampled elsewhere, is the same
        // colour on the same box.
        assert_eq!(report(&mut seen, &tile(amber_edge, Some("12"))), 0);
        // Another box whose snippet is the same pair is the pair the page
        // already reported.
        assert_eq!(report(&mut seen, &tile(amber.clone(), Some("77"))), 0);

        // Without an identity the snippet alone is the key.
        let mut seen = SafeTagTextSeen::default();
        assert_eq!(report(&mut seen, &tile(amber.clone(), None)), 1);
        assert_eq!(report(&mut seen, &tile(lime, None)), 1);
        assert_eq!(report(&mut seen, &tile(amber, None)), 0);
    }

    #[test]
    fn a_waived_hit_claims_neither_key() {
        let mut seen = SafeTagTextSeen::default();
        let hit = || vec![RuleHit::new("low-contrast", "1.7:1 (need 3:1) — text #ffffff on #fbbf24".to_string())];
        let keys = |h: &RuleHit| vec![h.snippet.clone(), "text #ffffff over gradient on div.w-14 [12]".to_string()];
        let mut hits = hit();
        seen.keep_first_keyed(&mut hits, &keys, &mut |_h: &RuleHit| false);
        assert!(hits.is_empty());
        let mut hits = hit();
        seen.keep_first_keyed(&mut hits, &keys, &mut |_h: &RuleHit| true);
        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn heading_tags_and_card_like() {
        assert!(is_heading_tag("h4"));
        assert!(!is_heading_tag("div"));
        assert!(is_card_like_from_props(true, false, false, true));
        assert!(!is_card_like_from_props(false, false, true, true));
    }

    #[test]
    fn near_bar_margin_reads_the_printed_ratio() {
        // Normal text: printed 4.2 up to 4.49 is advisory, printed 4.1 fails.
        assert!(contrast_near_bar(4.499, 4.5));
        assert!(contrast_near_bar(4.3, 4.5));
        assert!(contrast_near_bar(4.2, 4.5));
        assert!(contrast_near_bar(4.174, 4.5)); // prints 4.2
        assert!(!contrast_near_bar(4.149, 4.5)); // prints 4.1
        assert!(!contrast_near_bar(4.5, 4.5));
        assert!(!contrast_near_bar(2.0, 4.5));
        // Large text: printed 2.8 up to 2.99 is advisory, printed 2.7 fails.
        assert!(contrast_near_bar(2.995, 3.0));
        assert!(contrast_near_bar(2.779, 3.0)); // prints 2.8
        assert!(!contrast_near_bar(2.745, 3.0)); // prints 2.7
        assert!(!contrast_near_bar(3.0, 3.0));
        // No bar, no margin.
        assert!(!contrast_near_bar(4.3, f64::NAN));
        assert!(!contrast_near_bar(f64::NAN, 4.5));
        assert_eq!(contrast_severity(4.3, 4.5).as_deref(), Some("advisory"));
        assert_eq!(contrast_severity(3.9, 4.5), None);
    }

    fn white_panel(text: Rgba, font_size: f64, font_weight: f64) -> ColorOpts {
        ColorOpts {
            tag: "p".to_string(),
            text_color: Some(text),
            effective_bg: Some(Rgba::new(255.0, 255.0, 255.0, 1.0)),
            font_size,
            font_weight,
            has_direct_text: true,
            ..Default::default()
        }
    }

    /// r5-p31: walla.co.il's `ploni-demi-bold` and exxonmobil.com's
    /// `EMprint Semibold` compute to weight 400.
    #[test]
    fn a_family_named_as_a_bold_cut_reads_as_bold() {
        for heavy in [
            "ploni-demi-bold, arial",
            "\"EMprint Semibold\", Arial, sans-serif",
            "EMprint-Semibold",
            "ProximaNovaBold",
            "Gotham-Black",
            "\"Avenir Heavy\"",
            "Inter ExtraBold",
            "Arial Black, sans-serif",
            "DEMIBOLD",
        ] {
            assert!(family_names_heavy_face(heavy), "{heavy}");
            assert_eq!(contrast_font_weight(400.0, heavy), 700.0, "{heavy}");
        }
        for plain in [
            "\"Lilita One\", cursive",
            "Inter, \"Arial Black\"",
            "Blackletter",
            "Kobold",
            "Boldonse",
            "ploni-regular",
            "Heavyweight",
            "",
        ] {
            assert!(!family_names_heavy_face(plain), "{plain}");
            assert_eq!(contrast_font_weight(400.0, plain), 400.0, "{plain}");
        }
        // A computed weight at or over 700 is kept as it is.
        assert_eq!(contrast_font_weight(900.0, "Gotham-Black"), 900.0);
        assert_eq!(contrast_font_weight(600.0, "Inter"), 600.0);
    }

    #[test]
    fn check_colors_stamps_near_bar_hits_advisory() {
        let gray = |v: f64| Rgba::new(v, v, v, 1.0);
        let near = check_colors(&white_panel(gray(121.0), 14.0, 400.0)); // #797979 4.35:1
        let hit = near.iter().find(|h| h.id == "low-contrast").expect("hit");
        assert!(hit.is_advisory(), "{hit:?}");
        let far = check_colors(&white_panel(gray(125.0), 14.0, 400.0)); // #7d7d7d 4.12:1
        assert_eq!(far.iter().find(|h| h.id == "low-contrast").unwrap().severity, None);
        // r3-08 keeps bold display text under the large-text margin failing.
        let display = check_colors(&white_panel(gray(158.0), 40.0, 700.0)); // #9e9e9e 2.68:1
        assert_eq!(display.iter().find(|h| h.id == "low-contrast").unwrap().severity, None);
        let display_near = check_colors(&white_panel(gray(149.0), 40.0, 700.0)); // #959595 2.99:1
        assert!(display_near.iter().find(|h| h.id == "low-contrast").unwrap().is_advisory());
        let hover = check_hover_contrast(&HoverContrastOpts {
            tag: "button".to_string(),
            text_color: Some(gray(120.0)),
            bg: Some(gray(255.0)),
            own_bg_alpha: Some(1.0),
            font_size: 14.0,
            font_weight: 400.0,
            has_direct_text: true,
            is_emoji_only: false,
        });
        assert!(hover[0].is_advisory(), "{hover:?}");
    }

    #[test]
    fn shaped_hits_claim_their_own_pair() {
        let link = ColorOpts {
            tag: "span".to_string(),
            paints_own_text: true,
            ..white_panel(Rgba::new(187.0, 187.0, 187.0, 1.0), 14.0, 400.0)
        };
        let mut seen = SafeTagTextSeen::default();
        let mut keep = |_: &RuleHit| true;
        // Decorative first: advisory, and a second decorative copy dedupes.
        let a = check_colors_deduped_shaped(&link, &mut seen, None, &|| true, &mut keep);
        assert!(a.len() == 1 && a[0].is_advisory(), "{a:?}");
        assert!(check_colors_deduped_shaped(&link, &mut seen, None, &|| true, &mut keep).is_empty());
        // The failing copy after it still reports, and then speaks for both.
        let b = check_colors_deduped_shaped(&link, &mut seen, None, &|| false, &mut keep);
        assert!(b.len() == 1 && !b[0].is_advisory(), "{b:?}");
        assert!(check_colors_deduped_shaped(&link, &mut seen, None, &|| false, &mut keep).is_empty());
        let mut seen2 = SafeTagTextSeen::default();
        assert_eq!(check_colors_deduped_shaped(&link, &mut seen2, None, &|| false, &mut keep).len(), 1);
        assert!(check_colors_deduped_shaped(&link, &mut seen2, None, &|| true, &mut keep).is_empty());
        // The verdict is asked only of an element that failed.
        let readable = ColorOpts {
            text_color: Some(Rgba::new(20.0, 20.0, 20.0, 1.0)),
            ..link.clone()
        };
        let asked = std::cell::Cell::new(false);
        check_colors_deduped_shaped(&readable, &mut seen, None, &|| { asked.set(true); true }, &mut keep);
        assert!(!asked.get());
    }
}
