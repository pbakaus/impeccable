//! Port of `cli/engine/rules/checks.mjs` CSS-text scanners: the functions
//! that read raw stylesheet / HTML text (no DOM) and return findings that
//! carry a source `index` (a byte offset here; JS reports UTF-16 units, see
//! `crate::js_ext_a::utf16_index`) and/or a `selector`.

use crate::checks::rules::{
    extract_shadow_lengths, find_shadow_color, glow_is_perceptible, DeclaredCorners, ANY, B, D,
    NOMINAL_CARD_WIDTH_PX,
};
use crate::color::{
    color_to_hex, has_chroma, parse_any_color, relative_luminance, split_top_level_commas, Rgba,
};

use crate::js::{self, ci, math_min, number_to_string, parse_float, WS, WS_CHARS};

use crate::js_ext_a::{
    advance_utf16, is_word_byte, last_index_of_byte, split_commas_outside_parens, split_ws,
    utf16_index, JsMap,
};
use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::HashMap;

/// The stylesheet-text utilities and finding shapes these scanners are built
/// on are shared; re-exported so `checks::css_scan` stays one path.
pub use impeccable_foundation::css::scan::*;

macro_rules! re {
    ($name:ident, $pat:expr) => {
        static $name: Lazy<Regex> = Lazy::new(|| Regex::new(&$pat).expect(stringify!($name)));
    };
}

re!(
    VAR_REF_RE,
    format!(r"var\({WS}*(--[a-zA-Z0-9_-]+){WS}*(?:,{WS}*([^)]+))?\)")
);

/// JS: checks.mjs#resolveVarRefs (Section 4). Kept private to the CSS-text
/// scanners; the measures module carries the public port.
pub(crate) fn resolve_var_refs(raw: &str, custom_props: &CustomProps) -> String {
    resolve_var_refs_depth(raw, custom_props, 0)
}

fn resolve_var_refs_depth(raw: &str, custom_props: &CustomProps, depth: u32) -> String {
    if !raw.contains("var(") {
        return raw.to_string();
    }
    if depth > 8 {
        return raw.to_string();
    }
    VAR_REF_RE
        .replace_all(raw, |m: &regex::Captures| {
            let name = &m[1];
            if let Some(v) = custom_props.get(name) {
                return resolve_var_refs_depth(v, custom_props, depth + 1);
            }
            match m.get(2).map(|f| f.as_str()) {
                Some(fallback) if !fallback.is_empty() => {
                    resolve_var_refs_depth(js::trim(fallback), custom_props, depth + 1)
                }
                _ => m[0].to_string(),
            }
        })
        .into_owned()
}

// ─── cssTextHasDarkRootBg ───────────────────────────────────────────────────
re!(
    DARK_BG_RE,
    format!(
        r"{bg}(?:-{color})?{WS}*:{WS}*(?:#(?:0[0-9a-fA-F]|1[0-9a-fA-F]|2[0-3])[0-9a-fA-F]{{4}}{B}|#(?:0|1)[0-9a-fA-F]{{2}}{B}|{rgb}\({WS}*({D}{{1,2}}){WS}*,{WS}*({D}{{1,2}}){WS}*,{WS}*({D}{{1,2}}){WS}*\))",
        bg = ci("background"),
        color = ci("color"),
        rgb = ci("rgb")
    )
);
re!(
    TW_DARK_BG_RE,
    format!(r"{B}bg-(?:gray|slate|zinc|neutral|stone)-(?:9{D}{{2}}|800){B}")
);
re!(
    ROOT_BLOCK_RE,
    format!(
        r"(?:^|[}}{WS_CHARS},;>])(?:{body}|{html}|:{root}){WS}*(?:,[^{{]*)?\{{([^}}]*)\}}",
        body = ci("body"),
        html = ci("html"),
        root = ci("root")
    )
);
re!(
    INLINE_BODY_STYLE_RE,
    format!(
        r#"<{body}[^>]*{B}{style}{WS}*={WS}*"([^"]*)""#,
        body = ci("body"),
        style = ci("style")
    )
);
re!(
    BG_DECL_RE,
    format!(
        r"{bg}(?:-{color})?{WS}*:{WS}*([^;{{}}]+)",
        bg = ci("background"),
        color = ci("color")
    )
);

/// JS: checks.mjs#cssTextHasDarkRootBg
pub fn css_text_has_dark_root_bg(content: &str, custom_props: &CustomProps) -> bool {
    // A token such as `--color-background: #0a0a0a` is not a background.
    if DARK_BG_RE
        .find_iter(content)
        .any(|m| starts_css_property_token(content, m.start()))
        || TW_DARK_BG_RE.is_match(content)
    {
        return true;
    }
    let mut root_scopes: Vec<&str> = Vec::new();
    for m in ROOT_BLOCK_RE.captures_iter(content) {
        root_scopes.push(m.get(1).unwrap().as_str());
    }
    if let Some(m) = INLINE_BODY_STYLE_RE.captures(content) {
        root_scopes.push(m.get(1).unwrap().as_str());
    }
    for scope in root_scopes {
        for bm in BG_DECL_RE.captures_iter(scope) {
            if !starts_css_property_token(scope, bm.get(0).unwrap().start()) {
                continue;
            }
            let resolved = resolve_var_refs(js::trim(&bm[1]), custom_props);
            if let Some(c) = parse_any_color(Some(&resolved)) {
                if c.alpha_or_one() > 0.5 && relative_luminance(&c) < 0.1 {
                    return true;
                }
            }
        }
    }
    false
}

// ─── scanCssTextForGlow ─────────────────────────────────────────────────────
re!(
    SHADOW_DECL_RE,
    format!(
        r"{B}({box}-{shadow}|{text}-{shadow}){WS}*:{WS}*([^;{{}}]+)",
        box = ci("box"),
        text = ci("text"),
        shadow = ci("shadow")
    )
);

/// JS: checks.mjs#scanCssTextForGlow
pub fn scan_css_text_for_glow(content: &str) -> Vec<IndexedHit> {
    scan_css_text_for_glow_with(content, None)
}

/// [`scan_css_text_for_glow`] with the page's own answer to "is the page
/// dark": `Some` where an engine read the painted root background, `None` to
/// decide from the stylesheet text as the file engines do.
pub fn scan_css_text_for_glow_with(content: &str, dark_page: Option<bool>) -> Vec<IndexedHit> {
    let custom_props = collect_css_custom_props(content);
    let has_dark_bg =
        dark_page.unwrap_or_else(|| css_text_has_dark_root_bg(content, &custom_props));
    let mut results = Vec::new();
    for m in SHADOW_DECL_RE.captures_iter(content) {
        // A custom property named after a shadow (`--bprogress-box-shadow`)
        // declares a token, not a shadow on anything.
        if !starts_css_property_token(content, m.get(1).unwrap().start()) {
            continue;
        }
        let prop = js::to_lower_case(&m[1]);
        let value = resolve_var_refs(js::trim(&m[2]), &custom_props);
        for layer in split_commas_outside_parens(&value) {
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
            // Stylesheet text carries no layout, so the floor is what the
            // declaration itself says: blur, spread and alpha.
            if !glow_is_perceptible(
                vals[2],
                vals.get(3).copied().unwrap_or(0.0),
                color.alpha_or_one(),
                None,
                None,
                None,
            ) {
                continue;
            }
            let zero_offset = vals[0] == 0.0 && vals[1] == 0.0;
            if !zero_offset && !has_dark_bg {
                continue;
            }
            results.push(IndexedHit {
                index: m.get(0).unwrap().start(),
                snippet: if zero_offset {
                    format!("Zero-offset {} glow ({})", prop, color_to_hex(Some(&color)))
                } else {
                    format!(
                        "Colored {} glow ({}) on dark page",
                        prop,
                        color_to_hex(Some(&color))
                    )
                },
            });
            break;
        }
    }
    results
}

// ─── scanCssTextForGridBackground ───────────────────────────────────────────
re!(
    HAIRLINE_RE,
    format!(
        r"{B}{D}{{1,3}}px{WS}*,{WS}*{transparent}{WS}+{D}{{1,3}}px",
        transparent = ci("transparent")
    )
);
re!(
    INVERTED_HAIRLINE_RE,
    format!(
        r"{transparent}{WS}+{calc}\(100%{WS}*-{WS}*{D}{{1,3}}px\)",
        transparent = ci("transparent"),
        calc = ci("calc")
    )
);
re!(
    SIZE_DECL_PX_RE,
    format!(
        r#"{bs}{WS}*:[^;{{}}"']*{B}{D}{{1,3}}px{B}"#,
        bs = ci("background-size")
    )
);
re!(SHORTHAND_PX_ANY_RE, format!(r"/{WS}*{D}{{1,3}}px{B}"));
re!(
    GRID_BG_DECL_RE,
    format!(
        r#"{B}{bg}(?:-{image})?{WS}*:{WS}*([^;{{}}"']*)"#,
        bg = ci("background"),
        image = ci("image")
    )
);
re!(
    GRID_BLOCK_RE,
    format!(
        r#"\{{([^{{}}]*)\}}|{style}{WS}*={WS}*"([^"]*)"|{style}{WS}*={WS}*'([^']*)'"#,
        style = ci("style")
    )
);

/// JS: checks.mjs#scanCssTextForGridBackground
pub fn scan_css_text_for_grid_background(content: &str) -> Vec<IndexedHit> {
    for blk in GRID_BLOCK_RE.captures_iter(content) {
        let block = blk
            .get(1)
            .or_else(|| blk.get(2))
            .or_else(|| blk.get(3))
            .map(|m| m.as_str())
            .filter(|s| !s.is_empty())
            .unwrap_or("");
        // JS `blk[1] || blk[2] || blk[3] || ''`: an empty capture falls
        // through to the next group, but only one group participates.
        let mut hairline_count = 0usize;
        let mut bg_joined = String::new();
        for bm in GRID_BG_DECL_RE.captures_iter(block) {
            let v = &bm[1];
            hairline_count += HAIRLINE_RE.find_iter(v).count();
            hairline_count += INVERTED_HAIRLINE_RE.find_iter(v).count();
            bg_joined.push_str(v);
            bg_joined.push(';');
        }
        if hairline_count == 0 {
            continue;
        }
        let has_px_cell =
            SIZE_DECL_PX_RE.is_match(block) || SHORTHAND_PX_ANY_RE.is_match(&bg_joined);
        // A single hairline is a line, divider, or rail, not a grid, even
        // when tiled by a 2D px cell (issue #615).
        if hairline_count >= 2 && has_px_cell {
            return vec![IndexedHit {
                index: blk.get(0).unwrap().start(),
                snippet: "two-axis grid-line gradient background".to_string(),
            }];
        }
    }
    Vec::new()
}

// ─── scanCssTextForRadialHalo ───────────────────────────────────────────────
re!(
    HALO_DECL_RE,
    format!(
        r"{bg}(?:-{image})?{WS}*:{WS}*([^;{{}}]+)",
        bg = ci("background"),
        image = ci("image")
    )
);
re!(URL_FN_RE, format!(r"{}{WS}*\(", ci("url")));
re!(
    RADIAL_GRAD_RE,
    format!(
        r"({repeating}-)?{radial}-{gradient}\(",
        repeating = ci("repeating"),
        radial = ci("radial"),
        gradient = ci("gradient")
    )
);
re!(
    HALO_COLOR_TOKEN_RE,
    format!(
        r"(?:{rgb}[aA]?|{hsl}[aA]?|{oklch}|{oklab}|{lab}|{lch}|{hwb}|{colormix})\([^)]*(?:\([^)]*\))?[^)]*\)|#[0-9a-fA-F]{{3,8}}{B}|{B}{transparent}{B}",
        rgb = ci("rgb"),
        hsl = ci("hsl"),
        oklch = ci("oklch"),
        oklab = ci("oklab"),
        lab = ci("lab"),
        lch = ci("lch"),
        hwb = ci("hwb"),
        colormix = ci("color-mix"),
        transparent = ci("transparent")
    )
);
re!(PX_STOP_RE, format!(r"(-?[0-9.]+)px{B}"));
re!(TRANSPARENT_EXACT_RE, format!(r"^{}$", ci("transparent")));

/// JS: checks.mjs#scanCssTextForRadialHalo
pub fn scan_css_text_for_radial_halo(content: &str) -> Vec<IndexedHit> {
    scan_css_text_for_radial_halo_with(content, None)
}

/// [`scan_css_text_for_radial_halo`] with the page's own answer to "is the
/// page dark" (see [`scan_css_text_for_glow_with`]).
pub fn scan_css_text_for_radial_halo_with(
    content: &str,
    dark_page: Option<bool>,
) -> Vec<IndexedHit> {
    let custom_props = collect_css_custom_props(content);
    if !dark_page.unwrap_or_else(|| css_text_has_dark_root_bg(content, &custom_props)) {
        return Vec::new();
    }
    let mut findings = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    for m in HALO_DECL_RE.captures_iter(content) {
        if !starts_css_property_token(content, m.get(0).unwrap().start()) {
            continue;
        }
        let value = resolve_var_refs(js::trim(&m[1]), &custom_props);
        if URL_FN_RE.is_match(&value) {
            continue;
        }
        let vbytes = value.as_bytes();
        for g in RADIAL_GRAD_RE.captures_iter(&value) {
            if g.get(1).is_some() {
                continue;
            }
            let g_start = g.get(0).unwrap().start();
            let open = match value[g_start..].find('(') {
                Some(p) => g_start + p,
                None => break,
            };
            let mut depth: i64 = 0;
            let mut end: Option<usize> = None;
            let mut i = open;
            while i < vbytes.len() {
                if vbytes[i] == b'(' {
                    depth += 1;
                } else if vbytes[i] == b')' {
                    depth -= 1;
                    if depth == 0 {
                        end = Some(i);
                        break;
                    }
                }
                i += 1;
            }
            let end = match end {
                Some(e) => e,
                None => break,
            };
            let args = split_top_level_commas(&value[open + 1..end]);
            if args.len() < 2 {
                continue;
            }
            let stops: Vec<&String> = args
                .iter()
                .filter(|a| HALO_COLOR_TOKEN_RE.is_match(a))
                .collect();
            if stops.len() < 2 {
                continue;
            }
            let px_stop = stops.iter().any(|s| {
                PX_STOP_RE
                    .captures(s)
                    .map_or(false, |pm| parse_float(&pm[1]).abs() <= 24.0)
            });
            if px_stop {
                continue;
            }
            let first = match HALO_COLOR_TOKEN_RE.find(stops[0]) {
                Some(f) => f.as_str(),
                None => continue,
            };
            let last = match HALO_COLOR_TOKEN_RE.find(stops[stops.len() - 1]) {
                Some(l) => l.as_str(),
                None => continue,
            };
            let last_color = if TRANSPARENT_EXACT_RE.is_match(last) {
                Some(Rgba::new(0.0, 0.0, 0.0, 0.0))
            } else {
                parse_any_color(Some(last))
            };
            match last_color {
                Some(c) if c.alpha_or_one() <= 0.05 => {}
                _ => continue,
            }
            let first_color = if TRANSPARENT_EXACT_RE.is_match(first) {
                None
            } else {
                parse_any_color(Some(first))
            };
            let first_color = match first_color {
                Some(c) => c,
                None => continue,
            };
            if first_color.alpha_or_one() < 0.7 {
                continue;
            }
            let spread = js::math_max3(first_color.r, first_color.g, first_color.b)
                - js::math_min3(first_color.r, first_color.g, first_color.b);
            if spread < 24.0 {
                continue;
            }
            let snippet = format!(
                "radial-gradient halo ({} → transparent) on dark page",
                color_to_hex(Some(&first_color))
            );
            if seen.contains(&snippet) {
                continue;
            }
            seen.push(snippet.clone());
            findings.push(IndexedHit {
                index: m.get(0).unwrap().start(),
                snippet,
            });
        }
    }
    findings
}

re!(CSS_RULE_BLOCK_RE, CSS_RULE_BLOCK_SOURCE.to_string());

/// JS `/(?:^|[<prefix>])(?:tok…)(?!<run class>)/i.test(s)`, evaluated as:
/// at the start and after every prefix char, take the maximal run of
/// `run` bytes and ask `pred` about it.
fn token_after_prefix(
    s: &str,
    is_prefix: impl Fn(char) -> bool,
    run: impl Fn(u8) -> bool,
    pred: impl Fn(&str) -> bool,
) -> bool {
    let bytes = s.as_bytes();
    let check = |p: usize| -> bool {
        let mut e = p;
        while e < bytes.len() && run(bytes[e]) {
            e += 1;
        }
        pred(&s[p..e])
    };
    if check(0) {
        return true;
    }
    for (i, c) in s.char_indices() {
        if is_prefix(c) && check(i + c.len_utf8()) {
            return true;
        }
    }
    false
}

/// JS `/(?:^|[\s>+~,(])(?:<tags>)(?![\w-])/i.test(selector)`.
fn selector_has_tag(selector: &str, tags: &[&str]) -> bool {
    token_after_prefix(
        selector,
        |c| js::is_js_whitespace(c) || matches!(c, '>' | '+' | '~' | ',' | '('),
        is_word_or_dash,
        |run| tags.iter().any(|t| run.eq_ignore_ascii_case(t)),
    )
}

/// JS `/(?:^|[\s._[-])(?:active|current|selected[…])(?![\w])/i.test(selector)`;
/// `prefixed` adds the `btn[\w-]*|button[\w-]*|link[\w-]*` alternatives.
fn selector_has_state_word(selector: &str, prefixed: bool) -> bool {
    token_after_prefix(
        selector,
        |c| js::is_js_whitespace(c) || matches!(c, '.' | '_' | '[' | '-'),
        is_word_or_dash,
        |run| {
            let word_len = run.bytes().take_while(|b| is_word_byte(*b)).count();
            let word = &run[..word_len];
            if ["active", "current", "selected"]
                .iter()
                .any(|w| word.eq_ignore_ascii_case(w))
            {
                return true;
            }
            if prefixed {
                let lower = run.to_ascii_lowercase();
                return lower.starts_with("btn")
                    || lower.starts_with("button")
                    || lower.starts_with("link");
            }
            false
        },
    )
}

re!(
    ARIA_SELECTED_TRUE_RE,
    format!(
        r#"\[{aria}{WS}*[*^$|~]?={WS}*["']?{t}"#,
        aria = ci("aria-selected"),
        t = ci("true")
    )
);
re!(ARIA_CURRENT_RE, format!(r"\[{}", ci("aria-current")));
re!(
    ARIA_CURRENT_FALSE_TAIL_RE,
    format!(r#"^{WS}*[*^$|~]?={WS}*["']?{f}"#, f = ci("false"))
);

/// JS `/\[aria-current(?!\s*[*^$|~]?=\s*["']?false)/i.test(selector)`.
fn has_aria_current_not_false(selector: &str) -> bool {
    ARIA_CURRENT_RE
        .find_iter(selector)
        .any(|m| !ARIA_CURRENT_FALSE_TAIL_RE.is_match(&selector[m.end()..]))
}

re!(
    STATE_PSEUDO_RE,
    format!(
        r":(?:{hover}|{focus}|{fv}|{fw}|{active}|{checked}){B}",
        hover = ci("hover"),
        focus = ci("focus"),
        fv = ci("focus-visible"),
        fw = ci("focus-within"),
        active = ci("active"),
        checked = ci("checked")
    )
);
re!(
    STATE_PSEUDO_TARGET_RE,
    format!(
        r":(?:{hover}|{focus}|{fv}|{fw}|{active}|{checked}|{target}){B}",
        hover = ci("hover"),
        focus = ci("focus"),
        fv = ci("focus-visible"),
        fw = ci("focus-within"),
        active = ci("active"),
        checked = ci("checked"),
        target = ci("target")
    )
);

// ─── scanCssTextForPseudoStripe ─────────────────────────────────────────────
re!(COMMENT_RE, format!(r"/\*{ANY}*?\*/"));

re!(
    PSEUDO_SEL_RE,
    format!(
        r"::?(?:{before}|{after}){B}",
        before = ci("before"),
        after = ci("after")
    )
);
re!(
    PROSE_TAG_RE,
    format!(
        r"{B}(?:{blockquote}|{pre}|{code}|{nav}|{hr}){B}",
        blockquote = ci("blockquote"),
        pre = ci("pre"),
        code = ci("code"),
        nav = ci("nav"),
        hr = ci("hr")
    )
);
re!(FULL_PCT_RE, r"^100(?:\.0*)?%$".to_string());
re!(
    NO_PAINT_BG_RE,
    format!(
        r"^(?:{none}|{transparent}|{inherit}|{initial}|{unset}|{currentcolor})$",
        none = ci("none"),
        transparent = ci("transparent"),
        inherit = ci("inherit"),
        initial = ci("initial"),
        unset = ci("unset"),
        currentcolor = ci("currentcolor")
    )
);
re!(
    STRIPE_COLOR_TOKEN_RE,
    format!(
        r"(?:{rgb}[aA]?|{hsl}[aA]?|{oklch}|{oklab}|{lab}|{lch}|{hwb})\([^)]*\)|#[0-9a-fA-F]{{3,8}}{B}",
        rgb = ci("rgb"),
        hsl = ci("hsl"),
        oklch = ci("oklch"),
        oklab = ci("oklab"),
        lab = ci("lab"),
        lch = ci("lch"),
        hwb = ci("hwb")
    )
);
re!(
    NEUTRAL_NAME_RE,
    format!(
        r"^(?:{white}|{black}|{gray}|{grey}|{silver})$",
        white = ci("white"),
        black = ci("black"),
        gray = ci("gray"),
        grey = ci("grey"),
        silver = ci("silver")
    )
);

/// Blank comment bodies byte-for-byte (JS: every code unit becomes a
/// space, newlines stay) so offsets survive.
fn blank_comments(raw: &str) -> String {
    COMMENT_RE
        .replace_all(raw, |m: &regex::Captures| {
            let mut out = String::new();
            for c in m[0].chars() {
                if c == '\n' {
                    out.push('\n');
                } else {
                    for _ in 0..c.len_utf16() {
                        out.push(' ');
                    }
                }
            }
            out
        })
        .into_owned()
}

fn get_or<'a>(decls: &'a DeclMap, a: &str, b: &str) -> &'a str {
    match decls.get(a) {
        Some(v) if !v.is_empty() => v,
        _ => match decls.get(b) {
            Some(v) if !v.is_empty() => v,
            _ => "",
        },
    }
}

re!(STRIPE_URL_FN_RE, format!(r#"{}\((?:"[^"]*"|'[^']*'|[^)]*)\)"#, ci("url")));

/// Whether a stripe's background value paints an image and names no colour
/// beside it: a `url()` layer, and no other token that parses as a colour.
/// A value with no `url()` (an unresolved `var()`, a keyword) is left to the
/// caller, which reports it as before.
fn stripe_is_an_image_with_no_colour(bg: &str) -> bool {
    if !STRIPE_URL_FN_RE.is_match(bg) {
        return false;
    }
    let rest = STRIPE_URL_FN_RE.replace_all(bg, " ");
    !rest
        .split(|c: char| is_js_ws(c) || c == ',' || c == '/')
        .filter(|t| !t.is_empty())
        .any(|t| parse_any_color(Some(t)).is_some() || t.contains("var("))
}

/// JS: checks.mjs#scanCssTextForPseudoStripe
pub fn scan_css_text_for_pseudo_stripe(raw_content: &str) -> Vec<PatternFinding> {
    let content = blank_comments(raw_content);
    let custom_props = collect_css_custom_props(&content);
    let mut findings = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    for m in CSS_RULE_BLOCK_RE.captures_iter(&content) {
        let sel_raw = m.get(1).unwrap();
        let selector = js::trim(sel_raw.as_str());
        if !PSEUDO_SEL_RE.is_match(selector) {
            continue;
        }
        if PROSE_TAG_RE.is_match(selector) {
            continue;
        }
        let decls = parse_css_decl_block(&m[2]);
        let position = decls.get("position").map(|s| s.as_str());
        if position != Some("absolute") && position != Some("fixed") {
            continue;
        }
        let width_px = css_length_to_px(&resolve_var_refs(
            get_or(&decls, "width", "inline-size"),
            &custom_props,
        ));
        let height_px = css_length_to_px(&resolve_var_refs(
            get_or(&decls, "height", "block-size"),
            &custom_props,
        ));
        let vertical_candidate = width_px.map_or(false, |w| w >= 3.0 && w <= 12.0);
        let horizontal_candidate = height_px.map_or(false, |h| h >= 3.0 && h <= 12.0)
            && !selector_has_tag(
                selector,
                &["a", "button", "summary", "tr", "td", "th", "table", "li"],
            )
            && !ARIA_SELECTED_TRUE_RE.is_match(selector)
            && !has_aria_current_not_false(selector)
            && !selector_has_state_word(selector, true)
            && !STATE_PSEUDO_RE.is_match(selector);
        if !vertical_candidate && !horizontal_candidate {
            continue;
        }

        let mut top = decls.get("top").map(|s| s.as_str());
        let mut right = decls.get("right").map(|s| s.as_str());
        let mut bottom = decls.get("bottom").map(|s| s.as_str());
        let mut left = decls.get("left").map(|s| s.as_str());
        if let Some(inset) = decls.get("inset").filter(|s| !s.is_empty()) {
            let p = split_ws(inset);
            let (t, r, b, l) = match p.len() {
                1 => (p[0], p[0], p[0], p[0]),
                2 => (p[0], p[1], p[0], p[1]),
                3 => (p[0], p[1], p[2], p[1]),
                _ => (p[0], p[1], p[2], p[3]),
            };
            if top.is_none() {
                top = Some(t);
            }
            if right.is_none() {
                right = Some(r);
            }
            if bottom.is_none() {
                bottom = Some(b);
            }
            if left.is_none() {
                left = Some(l);
            }
        }
        if left.is_none() {
            left = decls.get("inset-inline-start").map(|s| s.as_str());
        }
        if right.is_none() {
            right = decls.get("inset-inline-end").map(|s| s.as_str());
        }

        let height_value = resolve_var_refs(get_or(&decls, "height", "block-size"), &custom_props);
        let height_value = js::trim(&height_value);
        let width_value = resolve_var_refs(get_or(&decls, "width", "inline-size"), &custom_props);
        let width_value = js::trim(&width_value);

        let mut edge: Option<&str> = None;
        let mut thickness_px: Option<f64> = None;
        if vertical_candidate {
            let top_px = css_length_to_px(&resolve_var_refs(top.unwrap_or(""), &custom_props));
            let bottom_px =
                css_length_to_px(&resolve_var_refs(bottom.unwrap_or(""), &custom_props));
            let full_height = (is_zero_offset(top) && is_zero_offset(bottom))
                || FULL_PCT_RE.is_match(height_value)
                || (top_px.is_some()
                    && bottom_px.is_some()
                    && top_px.unwrap() >= 0.0
                    && top_px.unwrap() <= 20.0
                    && bottom_px.unwrap() >= 0.0
                    && bottom_px.unwrap() <= 20.0);
            if full_height {
                edge = if is_zero_offset(left) {
                    Some("left")
                } else if is_zero_offset(right) {
                    Some("right")
                } else {
                    None
                };
                thickness_px = width_px;
            }
        }
        if edge.is_none() && horizontal_candidate {
            let full_width = (is_zero_offset(left) && is_zero_offset(right))
                || FULL_PCT_RE.is_match(width_value);
            if full_width {
                edge = if is_zero_offset(top) {
                    Some("top")
                } else if is_zero_offset(bottom) {
                    Some("bottom")
                } else {
                    None
                };
                thickness_px = height_px;
            }
        }
        let edge = match edge {
            Some(e) => e,
            None => continue,
        };

        let bg = resolve_var_refs(
            get_or(&decls, "background-color", "background"),
            &custom_props,
        );
        let bg = js::trim(&bg);
        if bg.is_empty() || NO_PAINT_BG_RE.is_match(bg) {
            continue;
        }
        let color_token = STRIPE_COLOR_TOKEN_RE.find(bg).map(|t| t.as_str());
        let parsed = parse_any_color(Some(color_token.unwrap_or(bg)));
        if let Some(c) = parsed {
            if c.alpha_or_one() < 0.1 {
                continue;
            }
            let spread = js::math_max3(c.r, c.g, c.b) - js::math_min3(c.r, c.g, c.b);
            if spread < 30.0 {
                continue;
            }
        } else if NEUTRAL_NAME_RE.is_match(bg) {
            continue;
        } else if stripe_is_an_image_with_no_colour(bg) {
            // `background: url(rule.jpg) repeat-x`: the stripe is a picture,
            // and nothing here says it is an accent colour.
            continue;
        }

        // A nested selector (`&::before`) names a different element in every
        // rule it sits in, so only a selector without `&` dedupes on its text.
        if !selector.contains('&') {
            if seen.iter().any(|s| s == selector) {
                continue;
            }
            seen.push(selector.to_string());
        }
        let sel_text = sel_raw.as_str();
        // Offset into the blanked text; map it back onto `raw_content`
        // (blanking keeps UTF-16 positions, not byte positions).
        let blanked_start = sel_raw.start() + (sel_text.len() - js::trim_start(sel_text).len());
        let selector_start = advance_utf16(raw_content, 0, utf16_index(&content, blanked_start));
        findings.push(PatternFinding {
            id: "side-tab".to_string(),
            snippet: format!(
                "{} — absolute {}px pseudo-element stripe ({}: 0)",
                selector,
                thickness_px.map_or("null".to_string(), number_to_string),
                edge
            ),
            index: Some(selector_start),
            selector: Some(selector.to_string()),
            severity: None,
        });
    }
    findings
}

// ─── scanCssTextForInsetStripe ──────────────────────────────────────────────
re!(INSET_RE, format!(r"{B}{}{B}", ci("inset")));

/// JS: checks.mjs#scanCssTextForInsetStripe
pub fn scan_css_text_for_inset_stripe(content: &str) -> Vec<PatternFinding> {
    let custom_props = collect_css_custom_props(content);
    let mut findings = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    for m in CSS_RULE_BLOCK_RE.captures_iter(content) {
        let selector = js::trim(&m[1]);
        if STATE_PSEUDO_TARGET_RE.is_match(selector) {
            continue;
        }
        if ARIA_SELECTED_TRUE_RE.is_match(selector) {
            continue;
        }
        if has_aria_current_not_false(selector) {
            continue;
        }
        if selector_has_state_word(selector, false) {
            continue;
        }
        if selector_has_tag(
            selector,
            &[
                "button",
                "hr",
                "tr",
                "td",
                "th",
                "table",
                "blockquote",
                "pre",
                "code",
            ],
        ) {
            continue;
        }
        let decls = parse_css_decl_block(&m[2]);
        let shadow = match decls.get("box-shadow") {
            Some(s) if !s.is_empty() && INSET_RE.is_match(s) => s,
            _ => continue,
        };
        let declared_width = css_length_to_px(&resolve_var_refs(
            get_or(&decls, "width", "inline-size"),
            &custom_props,
        ));
        if declared_width.map_or(false, |w| w <= 40.0) {
            continue;
        }
        let value = resolve_var_refs(shadow, &custom_props);
        for layer in split_commas_outside_parens(&value) {
            if !INSET_RE.is_match(layer) {
                continue;
            }
            let info = match find_shadow_color(layer) {
                Some(i) => i,
                None => continue,
            };
            let c = match info.color {
                Some(c) => c,
                None => continue,
            };
            if c.alpha_or_one() < 0.1 {
                continue;
            }
            let chroma = js::math_max3(c.r, c.g, c.b) - js::math_min3(c.r, c.g, c.b);
            if chroma < 30.0 {
                continue;
            }
            let vals = extract_shadow_lengths(layer, Some((info.start, info.end)));
            let or0 = |i: usize| -> f64 {
                match vals.get(i) {
                    Some(v) if *v != 0.0 && !v.is_nan() => *v,
                    _ => 0.0,
                }
            };
            let x = or0(0);
            let y = or0(1);
            let blur = or0(2);
            let sp = or0(3);
            if blur != 0.0 || sp != 0.0 {
                continue;
            }
            let ax = x.abs();
            let ay = y.abs();
            let is_stripe =
                (ax >= 3.0 && ax <= 12.0 && ay == 0.0) || (ay >= 3.0 && ay <= 12.0 && ax == 0.0);
            if !is_stripe {
                continue;
            }
            if seen.iter().any(|s| s == selector) {
                break;
            }
            seen.push(selector.to_string());
            let edge = if ay == 0.0 {
                if x > 0.0 {
                    "left"
                } else {
                    "right"
                }
            } else if y > 0.0 {
                "top"
            } else {
                "bottom"
            };
            findings.push(PatternFinding {
                id: "side-tab".to_string(),
                snippet: format!(
                    "{} — inset box-shadow {}px stripe ({})",
                    selector,
                    number_to_string(if ay == 0.0 { ax } else { ay }),
                    edge
                ),
                selector: Some(selector.to_string()),
                index: None,
                severity: None,
            });
            break;
        }
    }
    findings
}

// ─── side stripes on a rounded card ─────────────────────────────────────────
// `side-tab` reports an accent on any edge only on a card rounded away from
// the stripe. The two CSS-text stripe scans above stay the recorded producers
// (their call vectors pin them); every caller gates what they return, against
// a computed style when it has elements in hand and against the host rule's
// own declarations when it has only text.

re!(STRIPE_EDGE_RE, r"\((left|right|top|bottom)(?:: 0)?\)$".to_string());

/// The side a CSS-text `side-tab` stripe sits on, as a `[Top, Right, Bottom,
/// Left]` index, read off the snippet both scans end with: `(left: 0)` /
/// `(bottom: 0)` from the pseudo-element scan, `(left)` / `(top)` from the
/// inset box-shadow scan. Every edge counts: a top or bottom band is gated on
/// a rounded card like a left or right one (decision r6-t2-side-tab-bands).
/// `None` for anything that is not one of those findings.
pub fn side_stripe_index(finding: &PatternFinding) -> Option<usize> {
    if finding.id != "side-tab" {
        return None;
    }
    let caps = STRIPE_EDGE_RE.captures(&finding.snippet)?;
    Some(match &caps[1] {
        "top" => 0,
        "right" => 1,
        "bottom" => 2,
        _ => 3,
    })
}

re!(
    PSEUDO_ELEMENT_STRIP_RE,
    format!(
        r"::?(?:{before}|{after}){B}",
        before = ci("before"),
        after = ci("after")
    )
);
re!(SELECTOR_WS_RUN_RE, format!("{WS}+"));
// Every pseudo-class and pseudo-element with its arguments: the strip the
// static engine applies before it looks a stripe's host elements up.
re!(
    ANY_PSEUDO_STRIP_RE,
    r"::?[a-zA-Z-]+(?:\([^)]*\))?".to_string()
);
re!(
    SIMPLE_SELECTOR_RE,
    r"::?[-A-Za-z]+(?:\([^)]*\))?|\[[^\]]*\]|[.#](?:\\.|[-_A-Za-z0-9])+|\*|[A-Za-z][-A-Za-z0-9]*"
        .to_string()
);

/// The host a `::before` / `::after` rule paints on: the selector with the
/// pseudo-element removed. A selector without one is its own host.
pub fn pseudo_host_selector(selector: &str) -> String {
    js::trim(&PSEUDO_ELEMENT_STRIP_RE.replace_all(selector, "")).to_string()
}

/// The selector with every pseudo-class and pseudo-element removed, so a
/// stripe revealed on `.card:hover::after` reads the corners of `.card`.
pub fn pseudo_stripped_selector(selector: &str) -> String {
    normalize_selector(&ANY_PSEUDO_STRIP_RE.replace_all(selector, ""))
}

fn normalize_selector(selector: &str) -> String {
    SELECTOR_WS_RUN_RE
        .replace_all(js::trim(selector), " ")
        .into_owned()
}

/// The last compound of a selector: the part after its final combinator,
/// ignoring combinator characters inside `(...)` and `[...]`.
fn last_compound(selector: &str) -> &str {
    let b = selector.as_bytes();
    let mut depth = 0i32;
    let mut p = b.len();
    while p > 0 {
        match b[p - 1] {
            b')' | b']' => depth += 1,
            b'(' | b'[' => depth -= 1,
            b' ' | b'\t' | b'\n' | b'\r' | b'>' | b'+' | b'~' if depth <= 0 => break,
            _ => {}
        }
        p -= 1;
    }
    &selector[p..]
}

fn compound_tokens(compound: &str) -> Vec<String> {
    SIMPLE_SELECTOR_RE
        .find_iter(compound)
        .map(|m| m.as_str().to_string())
        .collect()
}

/// Whether a nested selector names the element of the rule it sits in:
/// `&.is-accent`, `&:hover`, `&[data-x]`, `&::before` (painted on that
/// element), a BEM modifier `&--accent`, which by that convention rides on
/// the block's own class, and a context rule `.dark &` or `:hover > &`,
/// whose last compound is the element itself. `& .child`, `&__part` and a
/// bare `.child` name other elements. A selector list names the element only
/// when every selector in it does, and a quoted style-object key
/// (`'&:hover'`) reads as the selector it quotes.
pub fn names_same_element(selector: &str) -> bool {
    let s = js::trim(selector).trim_matches(|c| c == '"' || c == '\'' || c == '`');
    let parts: Vec<&str> = split_commas_outside_parens(s)
        .into_iter()
        .map(js::trim)
        .filter(|p| !p.is_empty())
        .collect();
    !parts.is_empty()
        && parts.iter().all(|part| {
            let Some(rest) = last_compound(part).strip_prefix('&') else {
                return false;
            };
            rest.is_empty() || rest.starts_with(['.', '#', '[', ':']) || rest.starts_with("--")
        })
}

/// Whether text carries a preprocessor or template interpolation (`#{...}`,
/// `${...}`, `@{...}`): a value or selector the text reader cannot resolve.
pub fn has_interpolation(text: &str) -> bool {
    text.contains("${") || text.contains("#{") || text.contains("@{")
}

re!(
    LESS_MIXIN_CALL_RE,
    r"^[.#][-_A-Za-z0-9]+(?:\s*>?\s*[.#][-_A-Za-z0-9]+)*\s*(?:\(.*\))?\s*(?:!important)?$"
        .to_string()
);

/// Whether one declaration-level statement brings in declarations the text
/// reader cannot see: a Sass `@include` / `@extend` or indented `+mixin`, a
/// Tailwind `@apply`, a CSS Modules `composes`, a Less mixin call
/// (`.rounded();`), a style object's `...spread`, or a bare template
/// interpolation (`${truncate}`) standing where a declaration would. Any of
/// them could set a radius, so the corners go unknown at that point. A
/// block-form `@include breakpoint(md) { ... }` is a wrapper, not a
/// statement, and is read through by the callers.
pub fn is_unseen_declaration_source(statement: &str) -> bool {
    let s = js::trim(statement);
    if s.is_empty() {
        return false;
    }
    let lower = js::to_lower_case(s);
    if lower.starts_with("@include")
        || lower.starts_with("@extend")
        || lower.starts_with("@apply")
        || lower.starts_with("composes")
        || s.starts_with("...")
        || (s.starts_with('+') && s[1..].starts_with(|c: char| c.is_ascii_alphabetic()))
    {
        return true;
    }
    // The property half of a declaration (or the whole statement when there
    // is no colon) carrying an interpolation is a bare interpolation.
    let prop = s.split(':').next().unwrap_or(s);
    if has_interpolation(prop) {
        return true;
    }
    // A Less mixin call: `.rounded;`, `.rounded();`, `#ns > .mixin(@r: 4px);`,
    // never a hex color left over from a value that spans lines.
    s.starts_with(['.', '#'])
        && (!s.contains(':') || s.contains('('))
        && !HEX_COLOR_RE.is_match(s)
        && LESS_MIXIN_CALL_RE.is_match(s)
}

re!(HEX_COLOR_RE, r"^#[0-9a-fA-F]{3,8}\b".to_string());

/// Whether an at-rule block could style an element's own box the static
/// cascade never applies. Keyframes, font faces, pages and property
/// registrations cannot round a card at rest.
fn at_rule_can_style_elements(prelude: &str) -> bool {
    let name: String = prelude
        .trim_start_matches('@')
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '-')
        .collect::<String>()
        .to_ascii_lowercase();
    !(name.ends_with("keyframes")
        || matches!(
            name.as_str(),
            "font-face"
                | "page"
                | "property"
                | "counter-style"
                | "font-feature-values"
                | "font-palette-values"
                | "view-transition"
                | "position-try"
        ))
}

/// Whether the static cascade descends into an at-rule block: the ones
/// `collect_static_css_rules` walks.
fn static_cascade_descends(prelude: &str) -> bool {
    let name: String = prelude
        .trim_start_matches('@')
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '-')
        .collect::<String>()
        .to_ascii_lowercase();
    matches!(name.as_str(), "media" | "supports" | "layer")
}

/// A nested rule's selector list with `&` replaced by each selector of the
/// enclosing rule, and a selector without `&` read as a descendant of it.
/// Top-level selectors stay as written; a top-level `&` (a CSS-in-JS
/// template's own element) stays `&`.
fn resolve_nested_selectors(selector: &str, parent: Option<&[String]>) -> Vec<String> {
    const MAX_SELECTORS: usize = 64;
    let mut out = Vec::new();
    for part in split_commas_outside_parens(selector) {
        let part = normalize_selector(part);
        if part.is_empty() {
            continue;
        }
        match parent.filter(|p| !p.is_empty()) {
            None => out.push(part),
            Some(parents) => {
                for q in parents
                    .iter()
                    .take(MAX_SELECTORS - out.len().min(MAX_SELECTORS))
                {
                    out.push(if part.contains('&') {
                        normalize_selector(&part.replace('&', q))
                    } else {
                        format!("{q} {part}")
                    });
                }
            }
        }
        if out.len() >= MAX_SELECTORS {
            break;
        }
    }
    out
}

/// One radius-relevant statement of a rule block, in source order.
enum RadiusDecl {
    /// A radius declaration.
    Set(String, String),
    /// A statement that could bring in a radius the reader cannot see.
    Unseen,
}

/// The radius declarations of one rule block.
struct RadiusRule {
    /// Source position of the block, the order its declarations apply in.
    order: usize,
    decls: Vec<RadiusDecl>,
}

impl RadiusRule {
    fn apply_to(&self, corners: &mut DeclaredCorners) {
        for decl in &self.decls {
            match decl {
                RadiusDecl::Set(prop, value) => {
                    corners.apply(prop, value, NOMINAL_CARD_WIDTH_PX);
                }
                RadiusDecl::Unseen => corners.set_unknown(),
            }
        }
    }
}

/// A rule block carrying a radius the static cascade never applies: a rule
/// nested in another style rule, or one inside an at-rule the cascade skips
/// (`@container`, `@scope`, an unknown at-rule).
pub struct UnappliedRadiusRule {
    /// The block's selectors, nesting resolved.
    pub selectors: Vec<String>,
    /// The corners the block's own statements declare.
    pub corners: DeclaredCorners,
}

/// One open block while [`CssHostIndex::new`] walks the text.
struct HostFrame {
    /// The selectors this block's declarations apply to.
    keys: Vec<String>,
    /// What a nested `&` stands for; `None` at the top level.
    resolve_parent: Option<Vec<String>>,
    /// The selectors naming the element this block styles, its own and those
    /// of the enclosing rules it names with `&` compounds.
    hosts: Vec<String>,
    /// The element this block styles cannot be named: its selector, or the
    /// selector of an enclosing rule it names with `&`, is interpolated.
    hosts_unknown: bool,
    /// A style rule is this block or encloses it.
    in_rule: bool,
    /// Whether the static cascade walks into this block: the top level, and
    /// `@media` / `@supports` / `@layer` blocks outside any style rule.
    static_reachable: bool,
    /// Whether this block can style an element's box at rest (not inside
    /// `@keyframes`, `@font-face`, `@page` and the like).
    styles_elements: bool,
    /// This block is a style rule, not an at-rule or the top level.
    is_rule: bool,
    /// This block's index into [`CssHostIndex::opens`]; `usize::MAX` at the
    /// top level.
    block: usize,
    order: usize,
    direct: String,
    chunk_start: usize,
    seg_start: usize,
}

/// A stylesheet's rule blocks read once, nesting kept, for the rounded-card
/// gate on the CSS-text stripe scans. Every block knows the selectors of the
/// element it styles: a nested `&::before` or `&.is-accent` resolves to the
/// enclosing rule, and a CSS-in-JS template's top-level declarations belong
/// to `&`. Build it once per stylesheet; every stripe then costs one lookup.
pub struct CssHostIndex<'a> {
    raw: &'a str,
    content: String,
    /// Offsets of every block's `{` in the comment-blanked text, ascending,
    /// parallel to `closes`, `hosts` and `hosts_unknown`.
    opens: Vec<usize>,
    /// Offsets of every block's `}`, the text's length for a block left open.
    closes: Vec<usize>,
    hosts: Vec<Vec<String>>,
    hosts_unknown: Vec<bool>,
    rules: Vec<RadiusRule>,
    /// Radius rules the static cascade never applies, by index into `rules`.
    unapplied: Vec<(Vec<String>, usize)>,
    /// Byte spans of the interpolations the walk read as text, ascending.
    interpolations: Vec<(usize, usize)>,
    /// Radius rules by one of their selectors, exactly as resolved.
    exact: HashMap<String, Vec<usize>>,
    /// Radius rules whose selector is a single compound, by its first simple
    /// selector, with the compound's simple selectors.
    by_first_token: HashMap<String, Vec<(usize, Vec<String>)>>,
}

impl<'a> CssHostIndex<'a> {
    pub fn new(css: &'a str) -> Self {
        let content = blank_comments(css);
        let custom_props = collect_css_custom_props(&content);
        let mut index = CssHostIndex {
            raw: css,
            content: String::new(),
            opens: Vec::new(),
            closes: Vec::new(),
            hosts: Vec::new(),
            hosts_unknown: Vec::new(),
            rules: Vec::new(),
            unapplied: Vec::new(),
            interpolations: Vec::new(),
            exact: HashMap::new(),
            by_first_token: HashMap::new(),
        };
        let b = content.as_bytes();
        let mut stack = vec![HostFrame {
            keys: vec!["&".to_string()],
            resolve_parent: None,
            hosts: vec!["&".to_string()],
            hosts_unknown: false,
            in_rule: false,
            static_reachable: true,
            styles_elements: true,
            is_rule: false,
            block: usize::MAX,
            order: 0,
            direct: String::new(),
            chunk_start: 0,
            seg_start: 0,
        }];
        let mut p = 0usize;
        while p < b.len() {
            match b[p] {
                q @ (b'"' | b'\'') => {
                    // Braces and semicolons inside a string are text.
                    let mut e = p + 1;
                    while e < b.len() && b[e] != q && b[e] != b'\n' {
                        if b[e] == b'\\' {
                            e += 1;
                        }
                        e += 1;
                    }
                    p = e;
                }
                b'#' | b'$' | b'@' if b.get(p + 1) == Some(&b'{') => {
                    // A Sass (`#{}`), template (`${}`) or Less (`@{}`)
                    // interpolation belongs to the text around it.
                    let mut depth = 0usize;
                    let mut e = p + 1;
                    while e < b.len() {
                        match b[e] {
                            b'{' => depth += 1,
                            b'}' => {
                                depth -= 1;
                                if depth == 0 {
                                    break;
                                }
                            }
                            _ => {}
                        }
                        e += 1;
                    }
                    index.interpolations.push((p, e));
                    p = e;
                }
                b';' => stack.last_mut().unwrap().seg_start = p + 1,
                b'{' => {
                    let block = index.opens.len();
                    let top = stack.last_mut().unwrap();
                    let selector = js::trim(&content[top.seg_start..p]);
                    top.direct
                        .push_str(&content[top.chunk_start..top.seg_start]);
                    let frame = if selector.starts_with('@') {
                        // An at-rule styles whatever encloses it; a block
                        // `@include breakpoint(md) { ... }` is a wrapper too.
                        HostFrame {
                            keys: top.keys.clone(),
                            resolve_parent: top.resolve_parent.clone(),
                            hosts: top.hosts.clone(),
                            hosts_unknown: top.hosts_unknown,
                            in_rule: top.in_rule,
                            static_reachable: top.static_reachable
                                && !top.in_rule
                                && static_cascade_descends(selector),
                            styles_elements: top.styles_elements
                                && at_rule_can_style_elements(selector),
                            is_rule: false,
                            block,
                            order: p,
                            direct: String::new(),
                            chunk_start: p + 1,
                            seg_start: p + 1,
                        }
                    } else {
                        let resolved =
                            resolve_nested_selectors(selector, top.resolve_parent.as_deref());
                        let mut hosts = resolved.clone();
                        let same = names_same_element(selector);
                        if same {
                            hosts.extend(top.hosts.iter().cloned());
                        }
                        HostFrame {
                            keys: resolved.clone(),
                            resolve_parent: Some(resolved),
                            hosts,
                            hosts_unknown: has_interpolation(selector)
                                || (same && top.hosts_unknown),
                            in_rule: true,
                            static_reachable: top.static_reachable && !top.in_rule,
                            styles_elements: top.styles_elements,
                            is_rule: true,
                            block,
                            order: p,
                            direct: String::new(),
                            chunk_start: p + 1,
                            seg_start: p + 1,
                        }
                    };
                    index.opens.push(p);
                    index.closes.push(b.len());
                    index.hosts.push(frame.hosts.clone());
                    index.hosts_unknown.push(frame.hosts_unknown);
                    stack.push(frame);
                }
                b'}' => {
                    if stack.len() > 1 {
                        let mut frame = stack.pop().unwrap();
                        index.closes[frame.block] = p;
                        frame.direct.push_str(&content[frame.chunk_start..p]);
                        index.add_rule(frame, &custom_props);
                    } else {
                        let root = &mut stack[0];
                        root.direct.push_str(&content[root.chunk_start..p]);
                    }
                    let top = stack.last_mut().unwrap();
                    top.chunk_start = p + 1;
                    top.seg_start = p + 1;
                }
                _ => {}
            }
            p += 1;
        }
        // Blocks left open end with the text.
        while let Some(mut frame) = stack.pop() {
            let start = frame.chunk_start.min(content.len());
            frame.direct.push_str(&content[start..]);
            index.add_rule(frame, &custom_props);
        }
        index.content = content;
        index
    }

    fn add_rule(&mut self, frame: HostFrame, custom_props: &CustomProps) {
        if frame.keys.is_empty() {
            return;
        }
        let decls: Vec<RadiusDecl> = frame
            .direct
            .split(';')
            .filter_map(|part| {
                if is_unseen_declaration_source(part) {
                    return Some(RadiusDecl::Unseen);
                }
                let idx = part.find(':').filter(|i| *i > 0)?;
                let prop = js::trim(&part[..idx]);
                if !prop.to_ascii_lowercase().ends_with("radius") {
                    return None;
                }
                Some(RadiusDecl::Set(
                    prop.to_string(),
                    resolve_var_refs(&part[idx + 1..], custom_props),
                ))
            })
            .collect();
        if decls.is_empty() {
            return;
        }
        let id = self.rules.len();
        // A block the static cascade never applies: nested in a style rule,
        // or under an at-rule it skips.
        if frame.styles_elements
            && (frame.is_rule || frame.in_rule)
            && !(frame.is_rule && frame.static_reachable)
        {
            self.unapplied.push((frame.keys.clone(), id));
        }
        for key in &frame.keys {
            self.exact.entry(key.clone()).or_default().push(id);
            if last_compound(key) == key.as_str() {
                let tokens = compound_tokens(key);
                if let Some(first) = tokens.first() {
                    self.by_first_token
                        .entry(first.clone())
                        .or_default()
                        .push((id, tokens));
                }
            }
        }
        self.rules.push(RadiusRule {
            order: frame.order,
            decls,
        });
    }

    /// The corners every rule naming one of `hosts` declares, in source
    /// order. A rule names a host when one of its selectors is that host, or
    /// is a single compound every part of which the host's last compound
    /// carries (`.card` styles `.card.is-accent`).
    pub fn corners_for_hosts(&self, hosts: &[String]) -> DeclaredCorners {
        let mut corners = DeclaredCorners::default();
        for id in self.tied_rules(hosts) {
            self.rules[id].apply_to(&mut corners);
        }
        corners
    }

    /// The radius rules naming one of `hosts`, in source order: what
    /// [`corners_for_hosts`](Self::corners_for_hosts) applies.
    fn tied_rules(&self, hosts: &[String]) -> Vec<usize> {
        let mut ids: Vec<usize> = Vec::new();
        for host in hosts {
            if let Some(found) = self.exact.get(host) {
                ids.extend(found.iter().copied());
            }
            let tokens = compound_tokens(last_compound(host));
            for token in &tokens {
                for (id, compound) in self.by_first_token.get(token).into_iter().flatten() {
                    if compound.iter().all(|c| tokens.contains(c)) {
                        ids.push(*id);
                    }
                }
            }
        }
        ids.sort_unstable_by_key(|id| (self.rules[*id].order, *id));
        ids.dedup();
        ids
    }

    /// Every radius the text declares, corner by corner at its largest: a
    /// corner no declaration names stays `0`, and one some declaration set to
    /// a value the reader cannot resolve is unknown. A statement that could
    /// bring in declarations the reader cannot see (a mixin call, `@apply`,
    /// `composes`, a spread, a bare interpolation) makes every corner unknown,
    /// as does an interpolation that could carry a radius (one naming a
    /// radius, or a template nested in it). What
    /// [`is_rule_known_square`](Self::is_rule_known_square) reads for a box
    /// no radius rule ties to.
    pub fn sheet_corners(&self) -> DeclaredCorners {
        let mut sheet = DeclaredCorners::default();
        for rule in &self.rules {
            for decl in &rule.decls {
                match decl {
                    RadiusDecl::Set(prop, value) => {
                        let mut one = DeclaredCorners::default();
                        one.apply(prop, value, NOMINAL_CARD_WIDTH_PX);
                        sheet.raise_to(&one);
                    }
                    RadiusDecl::Unseen => sheet.set_unknown(),
                }
            }
        }
        for &(start, end) in &self.interpolations {
            let text = &self.content[start..(end + 1).min(self.content.len())];
            let lower = text.to_ascii_lowercase();
            if text.contains('`') || lower.contains("radius") || lower.contains("rounded") {
                sheet.set_unknown();
            }
        }
        sheet
    }

    /// Whether the rule whose selector starts at `pos` (a byte offset into the
    /// comment-blanked text) styles a box known to be square away from `side`,
    /// the text engine's reading. `sheet` is [`sheet_corners`](Self::sheet_corners)
    /// over every stylesheet the file carries.
    ///
    /// The box is known square when the index names it and either (a) the
    /// radius rules tied to it (the same, compound or grouped selectors)
    /// declare both corners away from the stripe with literal values under the
    /// rounded threshold, or (b) no declaration anywhere in the file can round
    /// those corners and nothing in it could bring in a radius unseen. A box
    /// the index cannot name, a tied rule that rounds it or leaves its radius
    /// unknown, and a file that declares a radius on some selector the index
    /// cannot tie to this rule (the element may carry that class) all keep
    /// the finding.
    pub fn is_rule_known_square(
        &self,
        pos: usize,
        selector: &str,
        side: usize,
        sheet: &DeclaredCorners,
    ) -> bool {
        self.hosts_known_square(self.hosts_at(pos, selector), side, sheet)
    }

    /// [`is_rule_known_square`](Self::is_rule_known_square) for a declaration:
    /// `pos` is a byte offset into the text the index was built on, and the
    /// rule is the innermost block around it (a CSS-in-JS template's own
    /// declarations style `&`).
    pub fn is_declaration_known_square(
        &self,
        pos: usize,
        side: usize,
        sheet: &DeclaredCorners,
    ) -> bool {
        let pos = self.content_offset(pos);
        if self
            .interpolations
            .iter()
            .any(|(start, end)| *start <= pos && pos <= *end)
        {
            return false;
        }
        let before = self.opens.partition_point(|open| *open < pos);
        let block = (0..before).rev().find(|b| self.closes[*b] >= pos);
        let hosts = match block {
            None => Some(vec!["&".to_string()]),
            Some(b) if self.hosts_unknown[b] => None,
            Some(b) => Some(self.host_forms(&self.hosts[b])),
        };
        self.hosts_known_square(hosts, side, sheet)
    }

    /// [`side_stripe_on_rounded_host`](Self::side_stripe_on_rounded_host)'s
    /// text engine twin: whether a stripe from this text sits on
    /// a box known square, so the finding drops. Anything but a
    /// `side-tab` stripe is never known square.
    pub fn side_stripe_known_square(&self, finding: &PatternFinding, sheet: &DeclaredCorners) -> bool {
        let Some(side) = side_stripe_index(finding) else {
            return false;
        };
        let pos = self.content_offset(finding.index.unwrap_or(0));
        let selector = finding.selector.as_deref().unwrap_or("");
        self.is_rule_known_square(pos, selector, side, sheet)
    }

    /// The markup reading: whether an element a markup side accent sits on
    /// (a utility class, a `style` attribute, a style object, a JSX prop) is
    /// known square away from `side`, against the style blocks and CSS-in-JS
    /// rules of its file this index was built on. `tag` is the element's type
    /// (`None` for a component), `styled_root` whether the tag is a styled
    /// component the file defines, so a template's own declarations can style
    /// it, and `classes` its literal class names. `sheet` is
    /// [`sheet_corners`](Self::sheet_corners) over the same style text.
    ///
    /// A file whose style text declares no radius leaves the element to its
    /// own tag. Otherwise every radius rule whose subject could match the
    /// element (each class it names is on the tag, its type is the tag's, it
    /// is not a pseudo-element) must leave the corners away from the stripe
    /// square, an unknown radius counting as round. Past that, the element is
    /// known square when a rule tied to its own classes declares both corners
    /// square, or when every radius in the style text is literal.
    pub fn is_element_known_square(
        &self,
        tag: Option<&str>,
        styled_root: bool,
        classes: &[String],
        side: usize,
        sheet: &DeclaredCorners,
    ) -> bool {
        if !sheet.declared() {
            return true;
        }
        let mut applicable: Vec<usize> = self
            .exact
            .iter()
            .filter(|(selector, _)| selector_could_apply(selector, tag, styled_root, classes))
            .flat_map(|(_, ids)| ids.iter().copied())
            .collect();
        applicable.sort_unstable();
        applicable.dedup();
        for id in applicable {
            let mut corners = DeclaredCorners::default();
            self.rules[id].apply_to(&mut corners);
            if corners.is_rounded_away_from_side(side) {
                return false;
            }
        }
        let mut host = tag.unwrap_or("").to_string();
        for class in classes.iter().filter(|c| is_plain_class_name(c)) {
            host.push('.');
            host.push_str(class);
        }
        let tied_square = !host.is_empty() && {
            let mut declared = DeclaredCorners::unknown();
            for id in self.tied_rules(&[host]) {
                self.rules[id].apply_to(&mut declared);
            }
            !declared.is_rounded_away_from_side(side)
        };
        tied_square || sheet.to_corners().is_some()
    }

    fn hosts_known_square(
        &self,
        hosts: Option<Vec<String>>,
        side: usize,
        sheet: &DeclaredCorners,
    ) -> bool {
        let Some(hosts) = hosts else {
            return false;
        };
        let ids = self.tied_rules(&hosts);
        // What the tied rules give the box, the cascade's `0` where they name
        // no corner: a rounded or unknown corner keeps the finding.
        let mut tied = DeclaredCorners::default();
        // The same rules over corners that start unknown: a corner stays
        // unknown unless a tied rule declares it.
        let mut declared = DeclaredCorners::unknown();
        for &id in &ids {
            self.rules[id].apply_to(&mut tied);
            self.rules[id].apply_to(&mut declared);
        }
        if tied.is_rounded_away_from_side(side) {
            return false;
        }
        !declared.is_rounded_away_from_side(side) || !sheet.is_rounded_away_from_side(side)
    }

    /// A raw-text byte offset in the comment-blanked text.
    fn content_offset(&self, raw_index: usize) -> usize {
        if self.raw.len() == self.content.len() {
            raw_index
        } else {
            advance_utf16(&self.content, 0, utf16_index(self.raw, raw_index))
        }
    }

    /// A block's host selectors with pseudo-elements removed, and again with
    /// every pseudo removed.
    fn host_forms(&self, selectors: &[String]) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        for s in selectors {
            for host in [
                normalize_selector(&pseudo_host_selector(s)),
                pseudo_stripped_selector(s),
            ] {
                if !host.is_empty() && !out.contains(&host) {
                    out.push(host);
                }
            }
        }
        out
    }

    /// The host selectors of the rule whose selector starts at `pos`, a byte
    /// offset into the comment-blanked text, with pseudo-elements removed and
    /// again with every pseudo removed. Falls back on `selector` as written.
    /// `None` when the element cannot be named: its selector, or that of an
    /// enclosing rule it names with `&`, is interpolated, or the rule sits
    /// inside an interpolation the walk read as text.
    fn hosts_at(&self, pos: usize, selector: &str) -> Option<Vec<String>> {
        if has_interpolation(selector)
            || self
                .interpolations
                .iter()
                .any(|(start, end)| *start <= pos && pos <= *end)
        {
            return None;
        }
        let block = self.opens.partition_point(|open| *open < pos);
        if self.hosts_unknown.get(block).copied().unwrap_or(false) {
            return None;
        }
        let written = [selector.to_string()];
        let selectors: &[String] = match self.hosts.get(block) {
            Some(hosts) if !hosts.is_empty() => hosts,
            _ => &written,
        };
        Some(self.host_forms(selectors))
    }

    /// Whether the rule whose selector starts at `pos` (a byte offset into the
    /// comment-blanked text) styles a box rounded away from `side`. A host
    /// the index cannot name keeps the finding.
    pub fn is_rule_rounded_away_from_side(&self, pos: usize, selector: &str, side: usize) -> bool {
        match self.hosts_at(pos, selector) {
            None => true,
            Some(hosts) => self
                .corners_for_hosts(&hosts)
                .is_rounded_away_from_side(side),
        }
    }

    /// Every rule block carrying a radius statement the static cascade never
    /// applies (nested in a style rule, or under an at-rule the cascade
    /// skips), with the corners its own statements declare. The static engine
    /// reads the elements they may reach as unknown.
    pub fn unapplied_radius_rules(&self) -> Vec<UnappliedRadiusRule> {
        self.unapplied
            .iter()
            .map(|(selectors, id)| {
                let mut corners = DeclaredCorners::default();
                self.rules[*id].apply_to(&mut corners);
                UnappliedRadiusRule {
                    selectors: selectors.clone(),
                    corners,
                }
            })
            .collect()
    }

    /// Whether a CSS-text finding from the text this index was built on
    /// survives the rounded-card gate. Anything but a
    /// `side-tab` stripe passes untouched.
    pub fn side_stripe_on_rounded_host(&self, finding: &PatternFinding) -> bool {
        let Some(side) = side_stripe_index(finding) else {
            return true;
        };
        let pos = self.content_offset(finding.index.unwrap_or(0));
        let selector = finding.selector.as_deref().unwrap_or("");
        self.is_rule_rounded_away_from_side(pos, selector, side)
    }
}

/// Whether a class name can be written as a plain `.name` selector.
fn is_plain_class_name(class: &str) -> bool {
    !class.is_empty()
        && !class.starts_with(|c: char| c.is_ascii_digit())
        && class
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Whether a rule's selector could style a markup element: every class its
/// subject names is on the element, its type is the element's (a component
/// has no known type), and it paints no pseudo-element. A subject written
/// with `&` (a CSS-in-JS template's own declarations) styles only a styled
/// component, and an interpolated selector could match anything.
fn selector_could_apply(
    selector: &str,
    tag: Option<&str>,
    styled_root: bool,
    classes: &[String],
) -> bool {
    if has_interpolation(selector) {
        return true;
    }
    let subject = last_compound(selector);
    if subject.contains('&') {
        return styled_root;
    }
    for token in compound_tokens(subject) {
        let lower = token.to_ascii_lowercase();
        if lower.starts_with("::")
            || matches!(
                lower.as_str(),
                ":before" | ":after" | ":first-line" | ":first-letter"
            )
        {
            return false;
        }
        if let Some(class) = token.strip_prefix('.') {
            let class = class.replace('\\', "");
            if !classes.iter().any(|c| *c == class) {
                return false;
            }
        } else if token.starts_with(|c: char| c.is_ascii_alphabetic()) {
            if tag.is_some_and(|t| !t.eq_ignore_ascii_case(&token)) {
                return false;
            }
        }
    }
    true
}

/// The corner radii a stylesheet declares for `host_selector` (a selector
/// list): every rule naming one of its selectors, in source order. A radius
/// declared on a selector text cannot tie to the host (a different class of
/// the same element, a multi-compound rule) is out of reach; a caller
/// holding elements reads their computed style instead.
pub fn css_text_host_corners(css: &str, host_selector: &str) -> DeclaredCorners {
    let hosts: Vec<String> = host_selector
        .split(',')
        .map(normalize_selector)
        .filter(|s| !s.is_empty())
        .collect();
    if hosts.is_empty() {
        return DeclaredCorners::default();
    }
    CssHostIndex::new(css).corners_for_hosts(&hosts)
}

/// One-shot [`CssHostIndex::side_stripe_on_rounded_host`]. A caller gating
/// more than one finding builds the index once instead.
pub fn css_text_side_stripe_on_rounded_host(css: &str, finding: &PatternFinding) -> bool {
    if side_stripe_index(finding).is_none() {
        return true;
    }
    CssHostIndex::new(css).side_stripe_on_rounded_host(finding)
}

// ─── scanCssTextForOrganicClipPath ──────────────────────────────────────────
// A `clip-path: polygon(...)` with many vertices, or `clip-path: path(...)`
// with curves, is CSS approximating an organic contour: a torn edge, a blob,
// a silhouette. Geometric clips (few vertices, or vertices on the 0/50/100
// grid) pass; circle()/inset()/ellipse() pass.
const ORGANIC_POLYGON_MIN_VERTICES: usize = 10;

re!(
    ORGANIC_CLIP_RE,
    format!(
        r"{cp}{WS}*:{WS}*({polygon}|{path}){WS}*\(([^)]*(?:\)[^;}}]*)?)",
        cp = ci("clip-path"),
        polygon = ci("polygon"),
        path = ci("path")
    )
);
re!(CURVE_CMD_RE, "[CSQTAcsqta]".to_string());
re!(SIGNED_NUM_RE, r"-?[0-9.]+".to_string());

/// Split `s` at `sep` where it sits outside parentheses, stopping at the
/// parenthesis that closes the enclosing function. Empty parts are dropped.
pub(crate) fn split_top_level(s: &str, is_sep: impl Fn(char) -> bool) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut depth = 0i32;
    let mut start = 0usize;
    for (i, c) in s.char_indices() {
        match c {
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth < 0 {
                    parts.push(&s[start..i]);
                    return parts.into_iter().map(js::trim).filter(|p| !p.is_empty()).collect();
                }
            }
            _ if depth == 0 && is_sep(c) => {
                parts.push(&s[start..i]);
                start = i + c.len_utf8();
            }
            _ => {}
        }
    }
    parts.push(&s[start..]);
    parts.into_iter().map(js::trim).filter(|p| !p.is_empty()).collect()
}

/// One polygon coordinate as a comparable key: whitespace dropped, and a
/// zero in any unit read as `0`.
fn polygon_coordinate_key(token: &str) -> String {
    let key: String = token.chars().filter(|c| !c.is_whitespace()).collect::<String>().to_ascii_lowercase();
    let unit_start = key.find(|c: char| !(c.is_ascii_digit() || c == '.' || c == '-' || c == '+'));
    let number = &key[..unit_start.unwrap_or(key.len())];
    if !number.is_empty() && number.parse::<f64>().is_ok_and(|v| v == 0.0) {
        return "0".to_string();
    }
    key
}

/// Whether a `polygon()` body draws only horizontal and vertical edges: each
/// vertex shares its x or its y with the next, the last with the first. A
/// stair-stepped pixel corner (`4px 0%, calc(100% - 4px) 0%, calc(100% -
/// 4px) 4px, ...`) is a notched rectangle however many vertices it takes,
/// not an organic contour. A vertex that does not read as two coordinates
/// (a fill rule, a value the split cannot pair) answers no.
fn polygon_is_rectilinear(body: &str) -> bool {
    let mut vertices: Vec<(String, String)> = Vec::new();
    for (i, point) in split_top_level(body, |c| c == ',').into_iter().enumerate() {
        let coords = split_top_level(point, char::is_whitespace);
        if i == 0 && coords.len() == 1 && matches!(js::to_lower_case(coords[0]).as_str(), "nonzero" | "evenodd") {
            continue;
        }
        let [x, y] = coords.as_slice() else {
            return false;
        };
        vertices.push((polygon_coordinate_key(x), polygon_coordinate_key(y)));
    }
    if vertices.len() < 3 {
        return false;
    }
    (0..vertices.len()).all(|i| {
        let (a, b) = (&vertices[i], &vertices[(i + 1) % vertices.len()]);
        a.0 == b.0 || a.1 == b.1
    })
}

/// One polygon coordinate as a number and its unit, when it is a plain
/// length or percentage (`96%`, `4px`, `0`). A `calc()` or a variable is not.
fn polygon_coordinate_number(token: &str) -> Option<(f64, String)> {
    let t = js::trim(token).to_ascii_lowercase();
    let unit_start = t.find(|c: char| !(c.is_ascii_digit() || c == '.' || c == '-' || c == '+')).unwrap_or(t.len());
    let value: f64 = t[..unit_start].parse().ok()?;
    let unit = &t[unit_start..];
    if !unit.chars().all(|c| c.is_ascii_alphabetic() || c == '%') {
        return None;
    }
    // A zero is a zero in any unit.
    Some((value, if value == 0.0 { String::new() } else { unit.to_string() }))
}

/// Whether a `polygon()` body is a zigzag edge: its vertices take two to
/// four distinct values on one axis and step evenly along the other.
/// presswhisper.com's tape ribbon (`100% 20%, 96% 40%, 100% 60%, 96% 80%,
/// ...`) notches both ends that way; a hand-drawn contour wanders on both
/// axes. A coordinate that is not a plain number answers no.
fn polygon_is_zigzag(body: &str) -> bool {
    let mut xs: Vec<(f64, String)> = Vec::new();
    let mut ys: Vec<(f64, String)> = Vec::new();
    for (i, point) in split_top_level(body, |c| c == ',').into_iter().enumerate() {
        let coords = split_top_level(point, char::is_whitespace);
        if i == 0 && coords.len() == 1 && matches!(js::to_lower_case(coords[0]).as_str(), "nonzero" | "evenodd") {
            continue;
        }
        let [x, y] = coords.as_slice() else {
            return false;
        };
        let (Some(x), Some(y)) = (polygon_coordinate_number(x), polygon_coordinate_number(y)) else {
            return false;
        };
        xs.push(x);
        ys.push(y);
    }
    // One unit per axis, so the values compare.
    let one_unit = |v: &[(f64, String)]| {
        let mut units = v.iter().map(|(_, u)| u.as_str()).filter(|u| !u.is_empty());
        let first = units.next();
        units.all(|u| Some(u) == first)
    };
    if xs.len() < 3 || !one_unit(&xs) || !one_unit(&ys) {
        return false;
    }
    let distinct = |v: &[(f64, String)]| {
        let mut d: Vec<f64> = Vec::new();
        for (n, _) in v {
            if !d.iter().any(|x| (x - n).abs() < 0.01) {
                d.push(*n);
            }
        }
        d.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        d
    };
    let even_steps = |d: &[f64]| {
        d.len() >= 3 && {
            let step = d[1] - d[0];
            step > 0.0 && d.windows(2).all(|w| ((w[1] - w[0]) - step).abs() <= 0.5)
        }
    };
    let (dx, dy) = (distinct(&xs), distinct(&ys));
    let xv: Vec<f64> = xs.iter().map(|(n, _)| *n).collect();
    let yv: Vec<f64> = ys.iter().map(|(n, _)| *n).collect();
    ((2..=4).contains(&dx.len()) && even_steps(&dy) && teeth_alternate(&yv, dy[1] - dy[0], &xv))
        || ((2..=4).contains(&dy.len()) && even_steps(&dx) && teeth_alternate(&xv, dx[1] - dx[0], &yv))
}

/// Whether the vertices that advance one step at a time along `along` swing
/// back and forth on `across` like teeth: every swing the same size, each
/// one the other way from the last, at least three of them. A torn edge
/// with levels in no order (96%, 97%, 99%, 100%) swings by uneven amounts.
fn teeth_alternate(along: &[f64], step: f64, across: &[f64]) -> bool {
    let n = along.len();
    let mut swings = 0usize;
    let mut last: Option<f64> = None;
    for i in 0..n {
        let j = (i + 1) % n;
        if ((along[j] - along[i]).abs() - step).abs() > 0.5 {
            // A side that is not one tooth step ends the run.
            last = None;
            continue;
        }
        let swing = across[j] - across[i];
        if swing.abs() < 0.01 {
            continue;
        }
        if let Some(prev) = last {
            if prev.signum() == swing.signum() || (prev.abs() - swing.abs()).abs() > 0.5 {
                return false;
            }
        }
        last = Some(swing);
        swings += 1;
    }
    swings >= 3
}

re!(PATH_TOKEN_RE, r"[A-Za-z]|[-+]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][-+]?[0-9]+)?".to_string());

/// Whether a `path()` body draws a rounded rectangle: every straight
/// segment (`L`, `H`, `V`, a closing `Z`) runs along an edge of the box the
/// path's points span, the straight segments reach all four of its edges,
/// and each run of curves between them joins two adjacent edges, turning a
/// corner. sinter.systems' smooth-corner buttons are squircles drawn that
/// way. A blob has no straight side, or one; a wave divider (straight top
/// and sides, a curved bottom) has three, and its curves run along one
/// edge. The box is spanned by points sampled along every curve as well as
/// the segment ends, so a curve that bulges outside the straight sides
/// moves the box off them. Path data the reader cannot follow answers no.
fn path_is_rounded_rectangle(body: &str) -> bool {
    // Path data holds no parentheses: the body ends at the first one. An
    // inline style escapes the quotes, and a fill rule may lead.
    let data = body.split(')').next().unwrap_or("").replace("&quot;", "\"");
    let data = match data.rfind(',') {
        Some(i) if data[..i].trim().trim_matches(|c| c == '"' || c == '\'').chars().all(|c| c.is_ascii_alphabetic()) => {
            data[i + 1..].to_string()
        }
        _ => data,
    };
    let data = data.trim_matches(|c: char| c == '"' || c == '\'' || c.is_whitespace());
    let tokens: Vec<&str> = PATH_TOKEN_RE.find_iter(data).map(|m| m.as_str()).collect();
    let mut points: Vec<(f64, f64)> = Vec::new();
    // Every segment in drawing order: start, end, and whether it is straight.
    let mut segments: Vec<((f64, f64), (f64, f64), bool)> = Vec::new();
    let (mut cur, mut start) = ((0.0f64, 0.0f64), (0.0f64, 0.0f64));
    // The last cubic or quadratic control point, for `S` and `T` to reflect.
    let mut last_cubic: Option<(f64, f64)> = None;
    let mut last_quad: Option<(f64, f64)> = None;
    let mut i = 0usize;
    let mut cmd: Option<char> = None;
    while i < tokens.len() {
        let tok = tokens[i];
        let c = tok.chars().next().unwrap_or(' ');
        if c.is_ascii_alphabetic() {
            cmd = Some(c);
            i += 1;
            if c == 'Z' || c == 'z' {
                last_cubic = None;
                last_quad = None;
                if cur != start {
                    segments.push((cur, start, true));
                }
                cur = start;
                points.push(cur);
                cmd = None;
            }
            continue;
        }
        let Some(command) = cmd else { return false };
        let arity = match command.to_ascii_uppercase() {
            'M' | 'L' | 'T' => 2,
            'H' | 'V' => 1,
            'C' => 6,
            'S' | 'Q' => 4,
            'A' => 7,
            _ => return false,
        };
        if i + arity > tokens.len() {
            return false;
        }
        let mut args = Vec::with_capacity(arity);
        for t in &tokens[i..i + arity] {
            match t.parse::<f64>() {
                Ok(v) if v.is_finite() => args.push(v),
                _ => return false,
            }
        }
        i += arity;
        let rel = command.is_ascii_lowercase();
        let base = if rel { cur } else { (0.0, 0.0) };
        let end = match command.to_ascii_uppercase() {
            'H' => (if rel { cur.0 + args[0] } else { args[0] }, cur.1),
            'V' => (cur.0, if rel { cur.1 + args[0] } else { args[0] }),
            _ => (base.0 + args[arity - 2], base.1 + args[arity - 1]),
        };
        let at = |k: usize| (base.0 + args[k], base.1 + args[k + 1]);
        let reflect = |c: Option<(f64, f64)>| c.map_or(cur, |c| (2.0 * cur.0 - c.0, 2.0 * cur.1 - c.1));
        let (mut cubic, mut quad) = (None, None);
        match command.to_ascii_uppercase() {
            'C' => {
                let (c1, c2) = (at(0), at(2));
                points.extend(sample_cubic(cur, c1, c2, end));
                cubic = Some(c2);
            }
            'S' => {
                let (c1, c2) = (reflect(last_cubic), at(0));
                points.extend(sample_cubic(cur, c1, c2, end));
                cubic = Some(c2);
            }
            'Q' => {
                let c = at(0);
                points.extend(sample_cubic(cur, lerp(cur, c, 2.0 / 3.0), lerp(end, c, 2.0 / 3.0), end));
                quad = Some(c);
            }
            'T' => {
                let c = reflect(last_quad);
                points.extend(sample_cubic(cur, lerp(cur, c, 2.0 / 3.0), lerp(end, c, 2.0 / 3.0), end));
                quad = Some(c);
            }
            'A' => points.extend(sample_arc(cur, args[0], args[1], args[2], args[3] != 0.0, args[4] != 0.0, end)),
            _ => {}
        }
        last_cubic = cubic;
        last_quad = quad;
        match command.to_ascii_uppercase() {
            'M' => {
                start = end;
                // Pairs after a moveto are implicit linetos.
                cmd = Some(if rel { 'l' } else { 'L' });
            }
            // A straight command of zero length still ends a run of curves:
            // a squircle written as `c ... L 146.016 20` where the curve
            // already reached (146.016, 20) is two corners, not one curve.
            'L' | 'H' | 'V' => segments.push((cur, end, true)),
            _ => segments.push((cur, end, false)),
        }
        cur = end;
        points.push(cur);
    }
    // A zero-length side still marks the edge it sits on.
    let lines: Vec<_> = segments.iter().filter(|s| s.2).map(|s| (s.0, s.1)).collect();
    if lines.len() < 4 || points.is_empty() {
        return false;
    }
    let (mut min_x, mut max_x, mut min_y, mut max_y) = (f64::MAX, f64::MIN, f64::MAX, f64::MIN);
    for (x, y) in &points {
        min_x = min_x.min(*x);
        max_x = max_x.max(*x);
        min_y = min_y.min(*y);
        max_y = max_y.max(*y);
    }
    let tol = 0.01 * (max_x - min_x).max(max_y - min_y).max(1.0);
    let near = |a: f64, b: f64| (a - b).abs() <= tol;
    let mut edges = [false; 4];
    for (a, b) in &lines {
        let side = if near(a.1, min_y) && near(b.1, min_y) {
            0
        } else if near(a.0, max_x) && near(b.0, max_x) {
            1
        } else if near(a.1, max_y) && near(b.1, max_y) {
            2
        } else if near(a.0, min_x) && near(b.0, min_x) {
            3
        } else {
            return false;
        };
        edges[side] = true;
    }
    if !edges.iter().all(|e| *e) {
        return false;
    }
    // Each run of curves between two straight sides turns a corner: it
    // starts on one edge and ends on an edge next to it (top or bottom to
    // left or right). A wave along an edge starts and ends on the same one.
    let on_edges = |p: (f64, f64)| -> Vec<usize> {
        let mut e = Vec::new();
        if near(p.1, min_y) { e.push(0) }
        if near(p.0, max_x) { e.push(1) }
        if near(p.1, max_y) { e.push(2) }
        if near(p.0, min_x) { e.push(3) }
        e
    };
    let Some(first_line) = segments.iter().position(|s| s.2) else { return false };
    let n = segments.len();
    let mut run: Option<((f64, f64), (f64, f64))> = None;
    for k in 1..=n {
        let seg = segments[(first_line + k) % n];
        if seg.2 {
            if let Some((a, b)) = run.take() {
                let (ea, eb) = (on_edges(a), on_edges(b));
                if !ea.iter().any(|x| eb.iter().any(|y| x % 2 != y % 2)) {
                    return false;
                }
            }
        } else {
            run = Some(match run {
                Some((a, _)) => (a, seg.1),
                None => (seg.0, seg.1),
            });
        }
    }
    true
}

const CURVE_SAMPLES: usize = 16;

fn lerp(a: (f64, f64), b: (f64, f64), t: f64) -> (f64, f64) {
    (a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t)
}

/// Points along a cubic Bezier, its ends excluded.
fn sample_cubic(p0: (f64, f64), p1: (f64, f64), p2: (f64, f64), p3: (f64, f64)) -> Vec<(f64, f64)> {
    (1..CURVE_SAMPLES)
        .map(|k| {
            let t = k as f64 / CURVE_SAMPLES as f64;
            let u = 1.0 - t;
            let (a, b, c, d) = (u * u * u, 3.0 * u * u * t, 3.0 * u * t * t, t * t * t);
            (a * p0.0 + b * p1.0 + c * p2.0 + d * p3.0, a * p0.1 + b * p1.1 + c * p2.1 + d * p3.1)
        })
        .collect()
}

/// Points along an SVG elliptical arc, its ends excluded (the endpoint to
/// centre conversion of SVG 1.1 F.6.5, radii scaled up when too small).
fn sample_arc(
    from: (f64, f64),
    rx: f64,
    ry: f64,
    rotation_deg: f64,
    large: bool,
    sweep: bool,
    to: (f64, f64),
) -> Vec<(f64, f64)> {
    let (mut rx, mut ry) = (rx.abs(), ry.abs());
    if from == to || rx == 0.0 || ry == 0.0 {
        return Vec::new();
    }
    let phi = rotation_deg.to_radians();
    let (sin, cos) = phi.sin_cos();
    let (dx, dy) = ((from.0 - to.0) / 2.0, (from.1 - to.1) / 2.0);
    let (x1, y1) = (cos * dx + sin * dy, -sin * dx + cos * dy);
    let lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
    if lambda > 1.0 {
        rx *= lambda.sqrt();
        ry *= lambda.sqrt();
    }
    let num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
    let den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
    let mut coef = if den == 0.0 { 0.0 } else { (num / den).max(0.0).sqrt() };
    if large == sweep {
        coef = -coef;
    }
    let (cx1, cy1) = (coef * rx * y1 / ry, -coef * ry * x1 / rx);
    let (cx, cy) = (
        cos * cx1 - sin * cy1 + (from.0 + to.0) / 2.0,
        sin * cx1 + cos * cy1 + (from.1 + to.1) / 2.0,
    );
    let angle = |ux: f64, uy: f64| uy.atan2(ux);
    let theta1 = angle((x1 - cx1) / rx, (y1 - cy1) / ry);
    let mut delta = angle((-x1 - cx1) / rx, (-y1 - cy1) / ry) - theta1;
    let tau = std::f64::consts::TAU;
    if sweep && delta < 0.0 {
        delta += tau;
    } else if !sweep && delta > 0.0 {
        delta -= tau;
    }
    (1..CURVE_SAMPLES)
        .map(|k| {
            let t = theta1 + delta * k as f64 / CURVE_SAMPLES as f64;
            let (ex, ey) = (rx * t.cos(), ry * t.sin());
            (cos * ex - sin * ey + cx, sin * ex + cos * ey + cy)
        })
        .collect()
}

/// JS: checks.mjs#scanCssTextForOrganicClipPath
///
/// The same declaration repeated (one inline style per button) reports once
/// per selector.
pub fn scan_css_text_for_organic_clip_path(style_text: &str) -> Vec<PatternFinding> {
    let mut findings: Vec<PatternFinding> = Vec::new();
    let push = |findings: &mut Vec<PatternFinding>, f: PatternFinding| {
        if !findings.iter().any(|g| g.snippet == f.snippet && g.selector == f.selector) {
            findings.push(f);
        }
    };
    for m in ORGANIC_CLIP_RE.captures_iter(style_text) {
        let kind = js::to_lower_case(&m[1]);
        let body = m.get(2).map(|g| g.as_str()).unwrap_or("");
        let index = m.get(0).unwrap().start();
        if kind == "path" {
            // curves (C, S, Q, T, A, absolute or relative) drawing a contour,
            // not a rectilinear M/L/Z outline; letters in path data are only
            // commands
            let curves = CURVE_CMD_RE.find_iter(body).count();
            if curves < 3 || path_is_rounded_rectangle(body) {
                continue;
            }
            push(&mut findings, PatternFinding {
                id: "organic-clip-path".to_string(),
                snippet: format!("clip-path: path() with {curves} curve segments"),
                selector: enclosing_css_selector(style_text, index),
                index: None,
                severity: None,
            });
            continue;
        }
        let points: Vec<&str> = body
            .split(',')
            .map(js::trim)
            .filter(|p| !p.is_empty())
            .collect();
        if points.len() < ORGANIC_POLYGON_MIN_VERTICES {
            continue;
        }
        // Vertices sitting on a coarse grid (multiples of 25%) are geometric;
        // a contour has arbitrary values.
        let mut off_grid = 0usize;
        for p in &points {
            for n in SIGNED_NUM_RE.find_iter(p) {
                let v = parse_float(n.as_str());
                if (v - js::math_round(v / 25.0) * 25.0).abs() > 0.5 {
                    off_grid += 1;
                }
            }
        }
        if off_grid < points.len() {
            continue;
        }
        if polygon_is_rectilinear(body) || polygon_is_zigzag(body) {
            continue;
        }
        push(&mut findings, PatternFinding {
            id: "organic-clip-path".to_string(),
            snippet: format!(
                "clip-path: polygon() with {} vertices approximating an organic contour",
                points.len()
            ),
            selector: enclosing_css_selector(style_text, index),
            index: None,
            severity: None,
        });
    }
    findings
}

// ─── scanCssTextForBuriedRaster ─────────────────────────────────────────────
// A raster (background-image url) that never reaches the screen: under a
// near-opaque gradient wash in the same background stack. A tint under 0.9
// alpha passes; a blend mode passes; layers after the url() pass.
re!(
    BURIED_DECL_RE,
    format!(
        r"{bg}(?:-{image})?{WS}*:{WS}*([^;}}]+)",
        bg = ci("background"),
        image = ci("image")
    )
);
re!(BURIED_URL_RE, format!(r"{}\(", ci("url")));
re!(BURIED_GRADIENT_RE, format!(r"{}\(", ci("gradient")));
re!(
    BURIED_GRADIENT_FN_RE,
    format!(
        r"(?:{linear}|{radial}|{conic})-{gradient}\([^()]*(?:\([^()]*\)[^()]*)*\)",
        linear = ci("linear"),
        radial = ci("radial"),
        conic = ci("conic"),
        gradient = ci("gradient")
    )
);
re!(
    BURIED_ALPHA_RE,
    format!(
        r"{rgb}[aA]?\({WS}*[0-9.]+%?{WS}*,?{WS}*[0-9.]+%?{WS}*,?{WS}*[0-9.]+%?{WS}*(?:[,/]{WS}*([0-9.]+%?))?{WS}*\)|{hsl}[aA]?\([^)]*?(?:[,/]{WS}*([0-9.]+%?))?{WS}*\)",
        rgb = ci("rgb"),
        hsl = ci("hsl")
    )
);
re!(
    BURIED_COLOR_FN_STRIP_RE,
    format!(
        r"{rgb}[aA]?\([^)]*\)|{hsl}[aA]?\([^)]*\)",
        rgb = ci("rgb"),
        hsl = ci("hsl")
    )
);
re!(BURIED_HEX_RE, r"#([0-9a-fA-F]{3,8})(?-u:\b)".to_string());
re!(
    BURIED_NAMED_RE,
    format!(
        r"{B}(?:{}){B}",
        ["white", "black", "ivory", "beige", "linen", "snow", "cream"]
            .iter()
            .map(|w| ci(w))
            .collect::<Vec<_>>()
            .join("|")
    )
);
re!(
    BURIED_BG_BLEND_RE,
    format!(
        r"{background}-{blend}-{mode}{WS}*:{WS}*",
        background = ci("background"),
        blend = ci("blend"),
        mode = ci("mode")
    )
);
re!(
    BURIED_MIX_BLEND_RE,
    format!(
        r"{mix}-{blend}-{mode}{WS}*:{WS}*",
        mix = ci("mix"),
        blend = ci("blend"),
        mode = ci("mode")
    )
);

/// JS `/…-blend-mode\s*:\s*(?!normal)/i.test(rule)`. The lookahead's
/// backtracking means the test fails only when `normal` follows the colon
/// with no whitespace at all (with whitespace, a shorter `\s*` leaves the
/// probe on the space, where `(?!normal)` succeeds).
// JS-PARITY: checks.mjs#scanCssTextForBuriedRaster blend-mode guard,
// backtracking bug included.
fn blend_mode_declared_not_normal(rule: &str, re: &Regex) -> bool {
    for m in re.find_iter(rule) {
        let after_colon = {
            // Position right after the `:` (before `\s*`).
            let matched = m.as_str();
            let colon = matched
                .rfind(':')
                .map(|c| m.start() + c + 1)
                .unwrap_or(m.end());
            &rule[colon..]
        };
        // Every position the JS `\s*` could leave the probe at.
        let mut positions: Vec<usize> = vec![0];
        for (i, c) in after_colon.char_indices() {
            if is_js_ws(c) {
                positions.push(i + c.len_utf8());
            } else {
                break;
            }
        }
        for &k in &positions {
            let probe = after_colon[k..].as_bytes();
            let starts_normal = probe.len() >= 6 && probe[..6].eq_ignore_ascii_case(b"normal");
            if !starts_normal {
                return true;
            }
        }
    }
    false
}

fn is_js_ws(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\x0B' | '\x0C' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

/// JS alphaOf: an alpha token normalized to 0..1 ('0.8' -> 0.8, '80%' -> 0.8).
fn buried_alpha_of(a: Option<&str>) -> f64 {
    let Some(a) = a else { return 1.0 };
    let v = parse_float(a);
    if js::trim(a).ends_with('%') {
        v / 100.0
    } else {
        v
    }
}

/// JS: checks.mjs#scanCssTextForBuriedRaster
pub fn scan_css_text_for_buried_raster(style_text: &str) -> Vec<PatternFinding> {
    let mut findings = Vec::new();
    for m in BURIED_DECL_RE.captures_iter(style_text) {
        let value = m.get(1).map(|g| g.as_str()).unwrap_or("");
        let decl_index = m.get(0).unwrap().start();
        if !BURIED_URL_RE.is_match(value) || !BURIED_GRADIENT_RE.is_match(value) {
            continue;
        }
        // a blend mode declared in the same rule keeps the raster visible
        let rule_start = last_index_of_byte(style_text, b'{', decl_index).unwrap_or(0);
        let rule_end = style_text[decl_index..]
            .find('}')
            .map(|p| p + decl_index)
            .unwrap_or(style_text.len());
        let rule = &style_text[rule_start..rule_end];
        if blend_mode_declared_not_normal(rule, &BURIED_BG_BLEND_RE)
            || blend_mode_declared_not_normal(rule, &BURIED_MIX_BLEND_RE)
        {
            continue;
        }
        // Layers are painted first-on-top: only a wash listed BEFORE the
        // url() covers it. An image on top of a gradient is not buried.
        let first_url = match BURIED_URL_RE.find(value) {
            Some(u) => u.start(),
            None => continue,
        };
        let gradients: Vec<&str> = BURIED_GRADIENT_FN_RE
            .find_iter(value)
            .filter(|gm| gm.start() < first_url)
            .map(|gm| gm.as_str())
            .collect();
        let mut opaque_wash = false;
        for g in gradients {
            let mut alphas: Vec<f64> = BURIED_ALPHA_RE
                .captures_iter(g)
                .map(|a| buried_alpha_of(a.get(1).or_else(|| a.get(2)).map(|g| g.as_str())))
                .collect();
            let stripped = BURIED_COLOR_FN_STRIP_RE.replace_all(g, "").into_owned();
            // hex stops: 4- and 8-digit forms carry their own alpha
            for h in BURIED_HEX_RE.captures_iter(&stripped) {
                let hex = &h[1];
                if hex.len() == 4 {
                    let d = &hex[3..4];
                    alphas.push(crate::js::parse_int(&format!("{d}{d}"), 16) / 255.0);
                } else if hex.len() == 8 {
                    alphas.push(crate::js::parse_int(&hex[6..], 16) / 255.0);
                } else {
                    alphas.push(1.0);
                }
            }
            if BURIED_NAMED_RE.is_match(&stripped) {
                alphas.push(1.0);
            }
            if !alphas.is_empty() && alphas.iter().all(|a| !a.is_finite() || *a >= 0.9) {
                opaque_wash = true;
                break;
            }
        }
        if !opaque_wash {
            continue;
        }
        findings.push(PatternFinding {
            id: "buried-raster".to_string(),
            snippet: format!(
                "raster under a near-opaque gradient wash: {}",
                crate::js_ext_b::slice_utf16_prefix(js::trim(value), 90)
            ),
            selector: enclosing_css_selector(style_text, decl_index),
            index: None,
            severity: None,
        });
    }
    findings
}

// ─── bounce names whose keyframes only pulse ────────────────────────────────
re!(
    NAMED_KEYFRAMES_RE,
    format!(r"@(?:-webkit-)?keyframes{WS}+([A-Za-z0-9_-]+){WS}*\{{")
);
re!(KEYFRAME_STEP_RE, r"\{([^{}]*)\}".to_string());
re!(
    SCALE_FN_RE,
    format!(r"^{}(?:[xXyYzZ]|3[dD])?\(([^()]*)\)", ci("scale"))
);

/// Whether every number in `list` (split on commas or white space) is a
/// scale factor between nothing and full size.
fn scale_factors_within_unit(list: &str) -> bool {
    let mut any = false;
    for part in list.split(|c: char| c == ',' || is_js_ws(c)).filter(|p| !p.is_empty()) {
        let Ok(v) = part.parse::<f64>() else { return false };
        if !(0.0..=1.0).contains(&v) {
            return false;
        }
        any = true;
    }
    any
}

/// Whether a `transform` value only scales the element (`none`, or a list of
/// `scale()`, `scaleX()` and kin at any factor): the box swells and shrinks
/// in place and goes nowhere. A value this cannot read is not.
pub fn transform_only_scales(value: &str) -> bool {
    let value = js::trim(value);
    let value = js::trim(value.strip_suffix("!important").unwrap_or(value));
    if value.eq_ignore_ascii_case("none") {
        return true;
    }
    let mut rest = value;
    let mut any = false;
    while !rest.is_empty() {
        let Some(m) = SCALE_FN_RE.captures(rest) else { return false };
        let factors = &m[1];
        if factors.split(|c: char| c == ',' || is_js_ws(c)).filter(|p| !p.is_empty()).any(|p| p.parse::<f64>().is_err()) {
            return false;
        }
        any = true;
        rest = js::trim_start(&rest[m.get(0).unwrap().end()..]);
    }
    any
}

/// Whether one keyframe declaration is part of a pulse: it scales the
/// element between nothing and its full size, fades it, or sets an easing
/// that stays inside its range. Anything that moves the element (a
/// translate, an offset, a margin), turns it, grows it past full size or
/// eases past its end value is not, and neither is a value this cannot read
/// (a `var()`, a `calc()`).
pub fn keyframe_decl_only_pulses(prop: &str, value: &str) -> bool {
    let prop = js::to_lower_case(js::trim(prop));
    let prop = prop.strip_prefix("-webkit-").unwrap_or(&prop);
    let value = js::trim(value);
    let value = js::trim(value.strip_suffix("!important").unwrap_or(value));
    match prop {
        "opacity" => true,
        "scale" => value.eq_ignore_ascii_case("none") || scale_factors_within_unit(value),
        "transform" => {
            if value.eq_ignore_ascii_case("none") {
                return true;
            }
            let mut rest = value;
            let mut any = false;
            while !rest.is_empty() {
                let Some(m) = SCALE_FN_RE.captures(rest) else { return false };
                if !scale_factors_within_unit(&m[1]) {
                    return false;
                }
                any = true;
                rest = js::trim_start(&rest[m.get(0).unwrap().end()..]);
            }
            any
        }
        "animation-timing-function" => {
            let lower = js::to_lower_case(value);
            if lower.contains("linear(") || lower.contains("var(") {
                return false;
            }
            !crate::checks::rules::BEZIER_RE.captures_iter(&lower).any(|m| {
                let (y1, y2) = (parse_float(&m[2]), parse_float(&m[4]));
                !(0.0..=1.0).contains(&y1) || !(0.0..=1.0).contains(&y2)
            })
        }
        _ => false,
    }
}

/// Whether a set of keyframes only pulses: it has declarations, and each one
/// passes [`keyframe_decl_only_pulses`]. A loader dot that swells from
/// nothing to its size and back (SpinKit's `sk-bounceDelay`) is this: nothing
/// moves and nothing passes its end value, whatever the keyframes are called.
pub fn keyframes_only_pulse<'a>(decls: impl IntoIterator<Item = (&'a str, &'a str)>) -> bool {
    let mut any = false;
    for (prop, value) in decls {
        if !keyframe_decl_only_pulses(prop, value) {
            return false;
        }
        any = true;
    }
    any
}

/// [`keyframes_only_pulse`] for the `@keyframes` named `name` in a
/// stylesheet text: `None` when the text defines no such keyframes, and
/// `Some(true)` only when every definition of the name pulses and nothing
/// else.
pub fn css_keyframes_only_pulse(style_text: &str, name: &str) -> Option<bool> {
    let mut verdict: Option<bool> = None;
    let mut pos = 0usize;
    while let Some(m) = NAMED_KEYFRAMES_RE.captures_at(style_text, pos) {
        let after = m.get(0).unwrap().end();
        let bytes = style_text.as_bytes();
        let (mut i, mut depth) = (after, 1i64);
        while i < bytes.len() && depth > 0 {
            match bytes[i] {
                b'{' => depth += 1,
                b'}' => depth -= 1,
                _ => {}
            }
            i += 1;
        }
        pos = i.max(after);
        if &m[1] != name {
            continue;
        }
        if depth != 0 {
            return Some(false);
        }
        let body = &style_text[after..i - 1];
        let pulses = keyframes_only_pulse(KEYFRAME_STEP_RE.captures_iter(body).flat_map(|step| {
            let block = step.get(1).unwrap().as_str();
            block
                .split(';')
                .filter(|d| !js::trim(d).is_empty())
                .map(|d| d.split_once(':').unwrap_or((d, "")))
                .collect::<Vec<_>>()
        }));
        if !pulses {
            return Some(false);
        }
        verdict = Some(true);
    }
    verdict
}

/// Whether a `bounce-easing` name finding (`animation: <name list>`) is a
/// pulse called a bounce: every bounce-named animation in the list has
/// keyframes `only_pulses` can find, and they only pulse. `only_pulses`
/// answers `None` for keyframes it cannot read, which keeps the finding.
pub fn bounce_names_only_pulse(names: &str, only_pulses: impl Fn(&str) -> Option<bool>) -> bool {
    const BOUNCE_WORDS: [&str; 5] = ["bounce", "elastic", "wobble", "jiggle", "spring"];
    let mut any = false;
    for name in names.split(',').map(js::trim).filter(|n| {
        let lower = js::to_lower_case(n);
        BOUNCE_WORDS.iter().any(|w| lower.contains(w))
    }) {
        if only_pulses(name) != Some(true) {
            return false;
        }
        any = true;
    }
    any
}

re!(MARQUEE_TAG_RE, format!(r"<{}{B}", ci("marquee")));

/// JS: checks.mjs#scanCssTextForMarquee. `markup` defaults to `content`.
pub fn scan_css_text_for_marquee(content: &str, markup: Option<&str>) -> Vec<PatternFinding> {
    let markup = markup.unwrap_or(content);
    let mut findings = Vec::new();
    if MARQUEE_TAG_RE.is_match(markup) {
        findings.push(PatternFinding {
            id: "marquee".to_string(),
            snippet: "<marquee> element".to_string(),
            selector: Some("marquee".to_string()),
            index: None,
            severity: None,
        });
    }
    let marquee_keyframes = collect_marquee_keyframes(content);
    if marquee_keyframes.is_empty() {
        return findings;
    }
    let mut seen: Vec<String> = Vec::new();
    for m in CSS_RULE_BLOCK_RE.captures_iter(content) {
        let selector = js::trim(&m[1]);
        let decls = parse_css_decl_block(&m[2]);
        for name in infinite_animation_names(&decls) {
            if !marquee_keyframes.contains(&name) {
                continue;
            }
            let key = format!("{} {}", selector, name);
            if seen.contains(&key) {
                continue;
            }
            seen.push(key);
            findings.push(PatternFinding {
                id: "marquee".to_string(),
                snippet: format!(
                    "{} — infinite horizontal loop animation \"{}\"",
                    selector, name
                ),
                selector: Some(selector.to_string()),
                index: None,
                severity: None,
            });
        }
    }
    findings
}

re!(PCT_VALUE_RE, r"^([0-9.]+)%$".to_string());

/// JS: checks.mjs#isRoundDotRadius
pub fn is_round_dot_radius(radius_value: &str, w: f64, h: f64) -> bool {
    if radius_value.is_empty() {
        return false;
    }
    let trimmed = js::trim(radius_value);
    let first = split_ws(trimmed)[0];
    if let Some(pm) = PCT_VALUE_RE.captures(first) {
        return parse_float(&pm[1]) >= 40.0;
    }
    match css_length_to_px(first) {
        None => false,
        Some(px) => px >= 999.0 || px >= 0.4 * math_min(w, h),
    }
}

// ─── scanCssTextForPulsingDot ───────────────────────────────────────────────
re!(
    PULSE_NAME_RE,
    format!("{}|{}|{}", ci("pulse"), ci("blink"), ci("ping"))
);
re!(
    CLASS_ATTR_RE,
    format!(
        r#"{cls}{WS}*={WS}*(?:"([^"]*)"|'([^']*)')"#,
        cls = ci("class")
    )
);
re!(TW_ANIMATE_RE, format!(r"{B}animate-(ping|pulse){B}"));
re!(TW_ROUNDED_FULL_RE, format!(r"{B}rounded-full{B}"));
re!(
    TW_TINY_SIZE_RE,
    format!(r"{B}(?:w|h|size)-(?:1|1\.5|2|2\.5|3|3\.5|4){B}")
);

/// JS: checks.mjs#scanCssTextForPulsingDot. `markup` defaults to `content`.
pub fn scan_css_text_for_pulsing_dot(content: &str, markup: Option<&str>) -> Vec<PatternFinding> {
    let markup = markup.unwrap_or(content);
    let custom_props = collect_css_custom_props(content);
    let keyframes = collect_pulse_keyframes(content);
    let hero_ranges = landmark_source_ranges(markup);
    let mut findings = Vec::new();
    let mut seen: Vec<String> = Vec::new();

    let stripped = strip_reduced_motion_blocks(content);
    let scan_text = COMMENT_RE.replace_all(&stripped, " ").into_owned();
    let mut merged: JsMap<DeclMap> = JsMap::new();
    for m in CSS_RULE_BLOCK_RE.captures_iter(&scan_text) {
        let decls = parse_css_decl_block(&m[2]);
        if decls.is_empty() {
            continue;
        }
        for raw_selector in m[1].split(',') {
            let selector = js::trim(raw_selector);
            if selector.is_empty() || selector.starts_with('@') {
                continue;
            }
            if !merged.has(selector) {
                merged.set(selector, JsMap::new());
            }
            let acc = merged.get_mut(selector).unwrap();
            for (prop, value) in decls.iter() {
                acc.set(prop, value.clone());
            }
        }
    }

    for (selector, decls) in merged.iter() {
        let names = infinite_animation_names(decls);
        if names.is_empty() {
            continue;
        }
        let pulse_name = names.iter().find(|n| match keyframes.get(n) {
            Some(known) => *known,
            None => PULSE_NAME_RE.is_match(n),
        });
        let pulse_name = match pulse_name {
            Some(p) => p,
            None => continue,
        };
        let w = css_length_to_px(&resolve_var_refs(
            get_or(decls, "width", "inline-size"),
            &custom_props,
        ));
        let h = css_length_to_px(&resolve_var_refs(
            get_or(decls, "height", "block-size"),
            &custom_props,
        ));
        let (w, h) = match (w, h) {
            (Some(w), Some(h)) => (w, h),
            _ => continue,
        };
        if w < 2.0 || h < 2.0 || w > 16.0 || h > 16.0 {
            continue;
        }
        let radius = resolve_var_refs(
            decls.get("border-radius").map(|s| s.as_str()).unwrap_or(""),
            &custom_props,
        );
        if !is_round_dot_radius(&radius, w, h) {
            continue;
        }
        if seen.iter().any(|s| s == selector) {
            continue;
        }
        seen.push(selector.clone());
        let in_landmark = selector_hits_landmark(markup, selector, &hero_ranges);
        findings.push(PatternFinding {
            id: "pulsing-dot".to_string(),
            snippet: format!(
                "{} — {}x{}px dot with infinite \"{}\" animation{}",
                selector,
                number_to_string(w),
                number_to_string(h),
                pulse_name,
                if in_landmark { " in header/nav" } else { "" }
            ),
            selector: Some(selector.clone()),
            index: None,
            severity: if in_landmark {
                Some("error".to_string())
            } else {
                None
            },
        });
    }

    for cm in CLASS_ATTR_RE.captures_iter(markup) {
        let cls = cm
            .get(1)
            .or_else(|| cm.get(2))
            .map(|m| m.as_str())
            .filter(|s| !s.is_empty())
            .unwrap_or("");
        let anim = match TW_ANIMATE_RE.captures(cls) {
            Some(a) => a[1].to_string(),
            None => continue,
        };
        if !TW_ROUNDED_FULL_RE.is_match(cls) {
            continue;
        }
        if !TW_TINY_SIZE_RE.is_match(cls) {
            continue;
        }
        let key = format!("tw:{}", cls);
        if seen.contains(&key) {
            continue;
        }
        seen.push(key);
        let in_landmark = index_in_source_ranges(cm.get(0).unwrap().start(), &hero_ranges);
        findings.push(PatternFinding {
            id: "pulsing-dot".to_string(),
            snippet: format!(
                "animate-{} on tiny rounded-full element{}",
                anim,
                if in_landmark { " in header/nav" } else { "" }
            ),
            selector: None,
            index: None,
            severity: if in_landmark {
                Some("error".to_string())
            } else {
                None
            },
        });
    }

    findings
}

#[cfg(test)]
mod tests {
    use super::*;

    // Expected values come from running the JS functions in Node.

    fn dark(c: &str) -> bool {
        css_text_has_dark_root_bg(c, &collect_css_custom_props(c))
    }

    /// overmindlab.ai: a stair-stepped pixel corner is a notched rectangle.
    #[test]
    fn rectilinear_polygons_are_geometric() {
        let notch = ".px{clip-path:polygon(4px 0%, calc(100% - 4px) 0%, calc(100% - 4px) 4px, 100% 4px, 100% calc(100% - 4px), calc(100% - 4px) calc(100% - 4px), calc(100% - 4px) 100%, 4px 100%, 4px calc(100% - 4px), 0% calc(100% - 4px), 0% 4px, 4px 4px)}";
        assert!(scan_css_text_for_organic_clip_path(notch).is_empty());
        // A zero is a zero in any unit, and a fill rule leads the list.
        assert!(polygon_is_rectilinear("evenodd, 0 0, 10px 0px, 10px 10px, 0% 10px)"));
        // One diagonal edge, and a vertex that is not a pair, answer no.
        assert!(!polygon_is_rectilinear("0 0, 10px 0, 10px 10px, 5px 12px, 0 10px)"));
        assert!(!polygon_is_rectilinear("0 0, 10px, 10px 10px, 0 10px)"));
        let blob = ".b{clip-path:polygon(50% 0%, 61% 8%, 74% 6%, 82% 16%, 94% 22%, 96% 36%, 100% 50%, 92% 63%, 88% 78%, 74% 88%, 60% 100%, 46% 96%)}";
        assert_eq!(scan_css_text_for_organic_clip_path(blob).len(), 1);
    }

    /// presswhisper.com 323796: a tape ribbon with zigzag ends.
    #[test]
    fn zigzag_polygons_are_geometric() {
        let tape = ".tape-edges { clip-path: polygon(0% 0%, 100% 0%, 100% 20%, 96% 40%, 100% 60%, 96% 80%, 100% 100%, 0% 100%, 4% 80%, 0% 60%, 4% 40%, 0% 20%); }";
        assert!(scan_css_text_for_organic_clip_path(tape).is_empty());
        // A torn top edge: evenly stepped x, a few y values.
        assert!(polygon_is_zigzag("0 10%, 10% 0, 20% 10%, 30% 0, 40% 10%, 50% 0, 60% 10%, 70% 0, 80% 10%, 90% 0, 100% 10%, 100% 100%, 0 100%"));
        // Mixed units on one axis do not compare.
        assert!(!polygon_is_zigzag("0 10px, 10% 0, 20% 10%, 30% 0, 40% 10px, 50% 0, 60% 10px, 70% 0, 80% 10px, 90% 0, 100% 10px, 100% 100%, 0 100%"));
        // A blob wanders on both axes; uneven steps are not a zigzag.
        assert!(!polygon_is_zigzag("50% 0%, 61% 8%, 74% 6%, 82% 16%, 94% 22%, 96% 36%, 100% 50%, 92% 63%, 88% 78%, 74% 88%, 60% 100%, 46% 96%"));
        assert!(!polygon_is_zigzag("0% 0%, 100% 0%, 100% 13%, 96% 40%, 100% 62%, 96% 80%, 100% 100%, 0% 100%, 4% 77%, 0% 60%, 4% 31%, 0% 20%"));
        // A coordinate that is not a plain number answers no.
        assert!(!polygon_is_zigzag("0 0, calc(100% - 4px) 0, 100% 20%, 0 100%"));
        // A torn bottom edge with a few levels in no order is not teeth.
        let torn = ".t{clip-path:polygon(0 0, 100% 0, 100% 96%, 95% 100%, 90% 97%, 85% 100%, 80% 96%, 75% 99%, 70% 96%, 65% 100%, 60% 97%, 55% 99%, 50% 96%, 0 96%)}";
        assert_eq!(scan_css_text_for_organic_clip_path(torn).len(), 1);
    }

    /// sinter.systems 321980: smooth-corner buttons clip to a squircle, an
    /// inline style per button.
    #[test]
    fn squircle_paths_are_rounded_rectangles() {
        let squircle = "M 25.2 0 L 110.003 0 c 10.4993 0 15.7489 0 19.429 2.6738 a 14 14 0 0 1 4.9854 6.7023 c 0.7856 2.2452 0.7856 5.0381 0.7856 10.6239 L 135.203 20 c 0 5.5858 0 8.3787 -0.7856 10.6239 a 14 14 0 0 1 -4.9854 6.7023 c -3.6801 2.6738 -8.9297 2.6738 -19.429 2.6738 L 25.2 40 c -10.4993 0 -15.7489 0 -19.429 -2.6738 a 14 14 0 0 1 -4.9854 -6.7023 c -0.7856 -2.2452 -0.7856 -5.0381 -0.7856 -10.6239 L 0 20 c 0 -5.5858 0 -8.3787 0.7856 -10.6239 a 14 14 0 0 1 4.9854 -6.7023 c 3.6801 -2.6738 8.9297 -2.6738 19.429 -2.6738 Z";
        let page = format!(
            "<a style=\"clip-path: path(&quot;{squircle}&quot;);\">Talk</a><a style=\"clip-path: path(&quot;{squircle}&quot;);\">Explore</a>"
        );
        assert!(scan_css_text_for_organic_clip_path(&page).is_empty());
        assert!(path_is_rounded_rectangle(&format!("'{squircle}')")));
        // The same squircle where a corner's curve lands exactly where the
        // straight side ends: a zero-length side still parts the corners.
        let wide = squircle.replace("110.003", "120.816").replace("135.203", "146.016");
        assert!(path_is_rounded_rectangle(&format!("'{wide}')")));
        assert!(path_is_rounded_rectangle("evenodd, 'M10 0H90Q100 0 100 10V90Q100 100 90 100H10Q0 100 0 90V10Q0 0 10 0Z')"));
        // A blob of curves, and a curved shape with one flat side, still report.
        let blob = ".b{clip-path:path('M50 0 C80 0 100 20 100 50 C100 80 80 100 50 100 C20 100 0 80 0 50 C0 20 20 0 50 0 Z')}";
        assert_eq!(scan_css_text_for_organic_clip_path(blob).len(), 1);
        assert!(!path_is_rounded_rectangle("'M0 100 L100 100 C100 40 70 0 50 0 C30 0 0 40 0 100 Z')"));
        // Straight sides joined by curves that bulge far outside them.
        assert!(!path_is_rounded_rectangle(
            "'M20 0 H80 C150 -50 150 50 100 20 V80 C150 150 50 150 80 100 H20 C-50 150 -50 50 0 80 V20 C-50 -50 50 -50 20 0 Z')"
        ));
        // Corner arcs that take the long way round, outside the box.
        assert!(!path_is_rounded_rectangle("'M10 0H90A10 10 0 1 1 100 10V90A10 10 0 1 1 90 100H10A10 10 0 1 1 0 90V10A10 10 0 1 1 10 0Z')"));
        assert!(path_is_rounded_rectangle("'M10 0H90A10 10 0 0 1 100 10V90A10 10 0 0 1 90 100H10A10 10 0 0 1 0 90V10A10 10 0 0 1 10 0Z')"));
        // A wave divider: straight top and sides, curves along the bottom.
        let wave = ".hero{clip-path:path('M0 0 H1440 V300 C1260 360 1080 240 900 300 C720 360 540 240 360 300 C180 360 90 260 0 300 Z')}";
        assert_eq!(scan_css_text_for_organic_clip_path(wave).len(), 1);
        // The same organic declaration twice reports once.
        let twice = format!("{blob}{blob}");
        assert_eq!(scan_css_text_for_organic_clip_path(&twice).len(), 1);
    }

    #[test]
    fn dark_root_bg_matches_node() {
        assert!(dark("body { background: #111827; }"));
        assert!(dark(":root{--bg:#0b0b0f} body{background:var(--bg)}"));
        assert!(dark(".chip{background:#000}"));
        assert!(dark("body{background: rgb(20, 20, 30)}"));
        assert!(!dark("body{background: rgba(0,0,0,0.3)}"));
        assert!(dark("<body style=\"background:#101010\">"));
        assert!(dark("html, .x { background-color: #0a0a0a }"));
        assert!(!dark("x{}body{color:red}"));
        assert!(dark("div{background:#fff} .card{ background: #123 }"));
        assert!(dark("<div class=\"bg-slate-900\">"));
    }

    #[test]
    fn enclosing_selector_matches_node() {
        let cases: &[(&str, usize, Option<&str>)] = &[
            (".a { color: red }", 8, Some(".a")),
            ("@media (x) { .b { c: d } }", 20, None),
            ("@media (x) { .b { c: d } }", 12, None),
            ("50% { c: d }", 6, None),
            ("from, to { c: d }", 12, None),
            ("a;b{c}", 4, Some("b")),
            ("{c}", 1, None),
            ("x", 0, None),
            ("", 0, None),
            (".a\n .b   .c { d }", 12, Some(".a .b .c")),
            ("<style>.q{r}", 10, None),
            (".a{b}.c{d}", 8, Some(".c")),
            (".a { b }", 0, None),
        ];
        for (text, idx, want) in cases {
            assert_eq!(
                enclosing_css_selector(text, *idx).as_deref(),
                *want,
                "{text:?} @ {idx}"
            );
        }
    }

    #[test]
    fn glow_scan_skips_imperceptible_layers() {
        let hits = scan_css_text_for_glow(".cta{box-shadow:0 0 24px rgba(0,169,255,0.6)}");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].snippet, "Zero-offset box-shadow glow (#00a9ff)");
        // 10% alpha over 20px of blur, and a spread that swallows its blur.
        assert!(scan_css_text_for_glow(".a{box-shadow:0 4px 20px rgba(149,100,255,0.1)}").is_empty());
        assert!(
            scan_css_text_for_glow(".b{box-shadow:0 0 40px -22px rgba(52,211,153,0.4)}").is_empty()
        );
        // The reported layer is the one that carries the light.
        let ramp = scan_css_text_for_glow(
            ".c{box-shadow:0 0.7px 0.7px -0.67px rgba(64,120,168,0.37),\
             0 13.65px 13.65px -3.33px rgba(64,120,168,0.247)}body{background:#0b0b0f}",
        );
        assert_eq!(ramp.len(), 1);
        assert_eq!(
            ramp[0].snippet,
            "Colored box-shadow glow (#4078a8) on dark page"
        );
    }

    #[test]
    fn property_tokens_start_their_own_name() {
        let at = |s: &str, needle: &str| starts_css_property_token(s, s.find(needle).unwrap());
        assert!(at("box-shadow:0", "box-shadow"));
        assert!(at(".a{box-shadow:0}", "box-shadow"));
        assert!(!at(".a{--bprogress-box-shadow:0 0 10px #29d}", "box-shadow"));
        assert!(at(".a{-webkit-box-shadow:0 0 8px red}", "box-shadow"));
        assert!(!at(".a{--x-webkit-box-shadow:0}", "box-shadow"));
        assert!(!at("border-width .2s", "width"));
        assert!(!at("line-height .2s", "height"));
        assert!(at("color .2s, width .2s", "width"));
    }

    #[test]
    fn glow_and_dark_page_read_properties_not_tokens() {
        assert!(scan_css_text_for_glow(":root{--bprogress-box-shadow:0 0 10px #29d,0 0 5px #29d}")
            .is_empty());
        assert_eq!(
            scan_css_text_for_glow(".a{-webkit-box-shadow:0 0 12px rgba(59,130,246,.6)}")[0].snippet,
            "Zero-offset box-shadow glow (#3b82f6)"
        );
        // A dark token is not a dark background.
        let token_dark = ".dark{--color-background:#0a0a0a}.c{box-shadow:0 8px 24px rgba(99,102,241,.6)}";
        assert!(scan_css_text_for_glow(token_dark).is_empty());
        let real_dark = "body{background:#0a0a0a}.c{box-shadow:0 8px 24px rgba(99,102,241,.6)}";
        assert_eq!(scan_css_text_for_glow(real_dark).len(), 1);
        // A rendering engine's answer replaces the stylesheet's.
        assert!(scan_css_text_for_glow_with(real_dark, Some(false)).is_empty());
        assert_eq!(scan_css_text_for_glow_with(token_dark, Some(true)).len(), 1);
        let halo = "body{background:#050505}.h{background:radial-gradient(circle,#8fd8f2 0%,transparent 70%)}";
        assert_eq!(scan_css_text_for_radial_halo(halo).len(), 1);
        assert!(scan_css_text_for_radial_halo_with(halo, Some(false)).is_empty());
        assert!(scan_css_text_for_radial_halo(
            ".dark{--hero-background:#050505}.h{--x-background-image:radial-gradient(circle,#8fd8f2 0%,transparent 70%)}"
        )
        .is_empty());
    }

    #[test]
    fn marquee_keyframes_read_a_percentage_inside_calc() {
        assert_eq!(
            collect_marquee_keyframes(
                "@keyframes ticker{from{transform:translateX(0)}to{transform:translateX(calc(-100% - 32px))}}"
            ),
            vec!["ticker".to_string()]
        );
        assert_eq!(
            collect_marquee_keyframes("@keyframes t3d{to{transform:translate3d(calc(-50% + 1rem),0,0)}}"),
            vec!["t3d".to_string()]
        );
        assert!(collect_marquee_keyframes(
            "@keyframes nudge{to{transform:translateX(calc(-10% - 4px))}}"
        )
        .is_empty());
    }

    #[test]
    fn zero_offset_matches_node() {
        for v in ["0", "-0", "0px", "0%", "0rem", "0em", " 0 "] {
            assert!(is_zero_offset(Some(v)), "{v}");
        }
        for v in ["0.0", "1px", "", "auto", "0vw"] {
            assert!(!is_zero_offset(Some(v)), "{v}");
        }
        assert!(!is_zero_offset(None));
    }

    #[test]
    fn pulse_keyframes_match_node() {
        let m = collect_pulse_keyframes("@keyframes spin{to{transform:rotate(360deg)}} @keyframes pulse{50%{opacity:.5}} @-webkit-keyframes ping{75%{transform:scale(2)}} @keyframes glow{0%{box-shadow:0 0 0 red}}");
        let got: Vec<(String, bool)> = m.iter().cloned().collect();
        assert_eq!(
            got,
            vec![
                ("spin".to_string(), false),
                ("pulse".to_string(), true),
                ("ping".to_string(), true),
                ("glow".to_string(), true)
            ]
        );
        let m = collect_pulse_keyframes(
            "@keyframes a{0%{opacity:1}} @keyframes a{0%{transform:rotate(1deg)}}",
        );
        assert_eq!(m.entries(), &[("a".to_string(), true)]);
        let m = collect_pulse_keyframes(
            "@keyframes b{0%{transform:rotate(1deg)}} @keyframes b{0%{opacity:0}}",
        );
        assert_eq!(m.entries(), &[("b".to_string(), true)]);
        let m = collect_pulse_keyframes("@keyframes unterminated{ 0%{opacity:1}");
        assert_eq!(m.entries(), &[("unterminated".to_string(), true)]);
        let m =
            collect_pulse_keyframes("@keyframes n {50%{transform: translateY(2px) scale(1.2)}}");
        assert_eq!(m.entries(), &[("n".to_string(), true)]);
    }

    #[test]
    fn infinite_names_match_node() {
        let names = |b: &str| infinite_animation_names(&parse_css_decl_block(b));
        assert_eq!(names("animation: pulse 2s infinite"), vec!["pulse"]);
        assert_eq!(
            names("animation: 2s ease-in-out infinite pulse, spin 1s linear infinite"),
            vec!["pulse", "spin"]
        );
        assert!(names("animation: pulse 2s").is_empty());
        assert_eq!(
            names("animation-name: a, b, none; animation-iteration-count: infinite"),
            vec!["a", "b"]
        );
        assert!(names("animation-name: a; animation-iteration-count: 3").is_empty());
        assert!(names("animation: infinite 1s ease").is_empty());
        assert_eq!(
            names("animation: 3s cubic-bezier(0,0,1,1) infinite Blink"),
            vec!["Blink"]
        );
        assert_eq!(names("animation: 1s INFINITE my-anim"), vec!["my-anim"]);
    }

    #[test]
    fn decl_block_matches_node() {
        let d = parse_css_decl_block("color: red !important; width : 4PX ;;:x; a:; :b; b: 1: 2");
        assert_eq!(
            d.entries(),
            &[
                ("color".to_string(), "red".to_string()),
                ("width".to_string(), "4PX".to_string()),
                ("b".to_string(), "1: 2".to_string())
            ]
        );
        let d = parse_css_decl_block("Color:Red;color:blue");
        assert_eq!(d.entries(), &[("color".to_string(), "blue".to_string())]);
        assert!(parse_css_decl_block("").is_empty());
        assert!(parse_css_decl_block("x").is_empty());
    }

    #[test]
    fn round_dot_radius_matches_node() {
        let cases: &[(&str, f64, f64, bool)] = &[
            ("50%", 8.0, 8.0, true),
            ("40%", 8.0, 8.0, true),
            ("39.9%", 8.0, 8.0, false),
            ("999px", 8.0, 8.0, true),
            ("4px", 8.0, 8.0, true),
            ("3px", 8.0, 8.0, false),
            ("3px", 8.0, 6.0, true),
            ("9999px 0", 8.0, 8.0, true),
            ("", 8.0, 8.0, false),
            ("auto", 8.0, 8.0, false),
            ("1rem", 8.0, 8.0, true),
            ("0.25rem", 10.0, 10.0, true),
            ("50% 20%", 8.0, 8.0, true),
            ("  50%", 8.0, 8.0, true),
        ];
        for (r, w, h, want) in cases {
            assert_eq!(is_round_dot_radius(r, *w, *h), *want, "{r:?}");
        }
    }

    #[test]
    fn strip_reduced_motion_matches_node() {
        assert_eq!(
            strip_reduced_motion_blocks(
                "a{b:c} @media (prefers-reduced-motion: reduce) { .x { animation: none } } d{e:f}"
            ),
            "a{b:c}  d{e:f}"
        );
        assert_eq!(
            strip_reduced_motion_blocks(
                "@media screen and (prefers-reduced-motion:reduce){a{b:c}}tail"
            ),
            "tail"
        );
        assert_eq!(
            strip_reduced_motion_blocks("no media here"),
            "no media here"
        );
        assert_eq!(
            strip_reduced_motion_blocks("@media (prefers-reduced-motion: reduce) { unterminated"),
            ""
        );
        let keep = "@media (prefers-reduced-motion: no-preference) { a{b:c} }";
        assert_eq!(strip_reduced_motion_blocks(keep), keep);
    }

    #[test]
    fn landmarks_match_node() {
        assert_eq!(
            landmark_source_ranges("<header><nav>x</nav></header><nav>y</nav>"),
            vec![(0, 20), (8, 14), (29, 35)]
        );
        assert_eq!(
            landmark_source_ranges("<HEADER class=\"a\"><div>b</div></HEADER >"),
            vec![(0, 30)]
        );
        assert!(landmark_source_ranges("<headerx></headerx>").is_empty());
        assert!(landmark_source_ranges("</nav><nav>").is_empty());
        assert_eq!(
            landmark_source_ranges("<header><header></header>"),
            vec![(8, 16)]
        );
        assert!(!index_in_source_ranges(5, &[(0, 5)]));
        assert!(index_in_source_ranges(4, &[(0, 5)]));
        assert!(index_in_source_ranges(0, &[(0, 5)]));
        assert!(!index_in_source_ranges(3, &[]));
    }

    #[test]
    fn selector_hits_landmark_matches_node() {
        let html1 = "<header><div class=\"live-dot x\">a</div><span id=\"pulse\">b</span></header><div class=\"live-dot-x\">c</div><nav><i class=\"dot\"></i></nav>";
        let r1 = landmark_source_ranges(html1);
        let cases: &[(&str, bool)] = &[
            (".live-dot", true),
            (".live-dot-x", false),
            ("#pulse", true),
            ("#PULSE", true),
            ("div", false),
            (".a > .live-dot", true),
            (".x", true),
            (".dot", true),
            ("header .live-dot::before", true),
            (".dot,.nope", true),
            (".nope", false),
        ];
        for (sel, want) in cases {
            assert_eq!(selector_hits_landmark(html1, sel, &r1), *want, "{sel}");
        }
        let html2 = "<div data-id=\"q\" class=\"a\">1</div><header><p class=\"b\" data-class=\"q\">2</p><em id=\"q\">3</em></header>";
        let r2 = landmark_source_ranges(html2);
        assert!(selector_hits_landmark(html2, "#q", &r2));
        assert!(selector_hits_landmark(html2, ".q", &r2));
        assert!(selector_hits_landmark(html2, ".b", &r2));
        assert!(!selector_hits_landmark(html2, ".a", &r2));
        let html3 = "<header><a class='dot two'>x</a></header>";
        let r3 = landmark_source_ranges(html3);
        assert!(selector_hits_landmark(html3, ".two", &r3));
        assert!(!selector_hits_landmark(html3, ".tw", &r3));
    }

    #[test]
    fn var_refs_match_node() {
        let cp = collect_css_custom_props(":root{--a: var(--b); --b: #123; --c: var(--c)}");
        assert_eq!(resolve_var_refs("var(--a)", &cp), "#123");
        assert_eq!(resolve_var_refs("var(--zz, red)", &cp), "red");
        assert_eq!(resolve_var_refs("var(--zz)", &cp), "var(--zz)");
        assert_eq!(resolve_var_refs("var( --b , 1px )", &cp), "#123");
        assert_eq!(resolve_var_refs("x var(--c) y", &cp), "x var(--c) y");
        assert_eq!(resolve_var_refs("plain", &cp), "plain");
        assert_eq!(resolve_var_refs("var(--zz, )", &cp), "");
    }

    #[test]
    fn side_stripe_index_reads_both_scan_snippets() {
        let pseudo = scan_css_text_for_pseudo_stripe(
            ".a::before{position:absolute;width:4px;left:0;top:0;bottom:0;background:#3b82f6}\
             .b::after{position:absolute;width:4px;right:0;top:0;bottom:0;background:#3b82f6}\
             .c::after{position:absolute;height:4px;left:0;right:0;bottom:0;background:#3b82f6}",
        );
        let sides: Vec<Option<usize>> = pseudo.iter().map(side_stripe_index).collect();
        assert_eq!(sides, vec![Some(3), Some(1), Some(2)]);
        let inset = scan_css_text_for_inset_stripe(
            ".a{box-shadow:inset 4px 0 0 #6366f1}.b{box-shadow:inset -4px 0 0 #6366f1}\
             .c{box-shadow:inset 0 4px 0 #6366f1}",
        );
        let sides: Vec<Option<usize>> = inset.iter().map(side_stripe_index).collect();
        assert_eq!(sides, vec![Some(3), Some(1), Some(0)]);
    }

    #[test]
    fn css_text_host_corners_follow_source_order() {
        let rounded = |css: &str, host: &str, side: usize| {
            css_text_host_corners(css, host).is_rounded_away_from_side(side)
        };
        // No radius declared for the host: square.
        assert!(!rounded(".card{position:relative}", ".card", 3));
        assert!(!rounded(".other{border-radius:12px}", ".card", 3));
        // The host names itself in a selector list, with whitespace moved.
        assert!(rounded(
            ".x, .card  .body{border-radius:12px}",
            ".card .body",
            3
        ));
        // Longhands after the shorthand square the far corners off.
        assert!(!rounded(
            ".card{border-radius:12px;border-top-right-radius:0;border-bottom-right-radius:0}",
            ".card",
            3
        ));
        // A later shorthand resets the earlier longhands.
        assert!(rounded(
            ".card{border-top-right-radius:0}.card{border-radius:12px}",
            ".card",
            3
        ));
        // Rounded only under the stripe: square where it counts.
        assert!(!rounded(".card{border-radius:12px 0 0 12px}", ".card", 3));
        assert!(rounded(".card{border-radius:12px 0 0 12px}", ".card", 1));
        // var() resolves; an unresolvable value is unknown and keeps the find.
        assert!(rounded(
            ":root{--r:10px}.card{border-radius:var(--r)}",
            ".card",
            3
        ));
        assert!(rounded(".card{border-radius:var(--missing)}", ".card", 3));
        assert!(rounded(".card{border-radius:calc(1rem)}", ".card", 3));
        // Commented-out declarations are not live.
        assert!(!rounded(
            "/* .card{border-radius:12px} */.card{position:relative}",
            ".card",
            3
        ));
    }

    #[test]
    fn css_text_gate_uses_the_pseudo_host() {
        let css = ".card{border-radius:12px}\
                   .card::before{position:absolute;width:4px;left:0;top:0;bottom:0;background:#3b82f6}\
                   .quote::before{position:absolute;width:4px;left:0;top:0;bottom:0;background:#3b82f6}";
        let kept: Vec<String> = scan_css_text_for_pseudo_stripe(css)
            .into_iter()
            .filter(|f| css_text_side_stripe_on_rounded_host(css, f))
            .map(|f| f.selector.unwrap())
            .collect();
        assert_eq!(kept, vec![".card::before".to_string()]);
        assert_eq!(pseudo_host_selector(".a:hover::AFTER"), ".a:hover");
    }

    /// Nested rules, CSS-in-JS templates and pseudo-classes resolve to the
    /// element that carries the corners.
    #[test]
    fn host_index_resolves_nested_hosts() {
        const BAR: &str = "content:\"\";position:absolute;top:0;bottom:0;background:#6366f1";
        let kept = |css: &str| -> Vec<String> {
            let css = css.replace("BAR", BAR);
            let index = CssHostIndex::new(&css);
            scan_css_text_for_pseudo_stripe(&css)
                .into_iter()
                .filter(|f| index.side_stripe_on_rounded_host(f))
                .map(|f| f.snippet)
                .collect()
        };
        // A nested bar reads the rule it sits in. The square card comes first
        // and its identical `&::before` selector does not hide the rounded one.
        assert_eq!(
            kept(
                ".sq { position: relative; &::before { BAR; left: 0; width: 4px } }\n\
                 .card { position: relative; border-radius: 12px; &::before { BAR; left: 0; width: 5px } }"
            ),
            vec!["&::before — absolute 5px pseudo-element stripe (left: 0)".to_string()]
        );
        // A CSS-in-JS template's own declarations style `&`.
        assert_eq!(
            kept("position: relative; border-radius: 12px; &::after { BAR; right: 0; width: 6px }"),
            vec!["&::after — absolute 6px pseudo-element stripe (right: 0)".to_string()]
        );
        assert!(kept("position: relative; &::after { BAR; right: 0; width: 6px }").is_empty());
        // A media query is transparent, a BEM modifier rides on the block's
        // class, and a descendant or a BEM element is another box.
        assert_eq!(
            kept(
                ".m { border-radius: 12px; @media (min-width: 1px) { &::before { BAR; left: 0; width: 7px } } }\n\
                 .b { border-radius: 12px; &--accent::before { BAR; left: 0; width: 8px } &__part::before { BAR; left: 0; width: 9px } }\n\
                 .d { border-radius: 12px; & .inner::before { BAR; left: 0; width: 10px } .child::before { BAR; left: 0; width: 11px } }"
            ),
            vec![
                "&::before — absolute 7px pseudo-element stripe (left: 0)".to_string(),
                "&--accent::before — absolute 8px pseudo-element stripe (left: 0)".to_string(),
            ]
        );
        // A hover-revealed bar reads the card, as the static engine does; a
        // single-compound rule styles every host that carries its classes.
        assert_eq!(
            kept(
                ".h { border-radius: 12px }\n.h:hover::after { BAR; right: 0; width: 5px }\n\
                 .c2 { border-radius: 12px }\n.c2.accent::before { BAR; left: 0; width: 6px }\n\
                 .list .row::before { BAR; left: 0; width: 7px }\n.row { border-radius: 12px }\n\
                 .sq2:hover::after { BAR; right: 0; width: 8px }"
            ),
            vec![
                ".h:hover::after — absolute 5px pseudo-element stripe (right: 0)".to_string(),
                ".c2.accent::before — absolute 6px pseudo-element stripe (left: 0)".to_string(),
                ".list .row::before — absolute 7px pseudo-element stripe (left: 0)".to_string(),
            ]
        );
        // Braces inside strings are text, and a non-ASCII comment does not
        // move the stripe off its rule.
        assert_eq!(
            kept("/* é ü ñ */ .q { content: \"{\"; border-radius: 12px; &::before { BAR; left: 0; width: 4px } }"),
            vec!["&::before — absolute 4px pseudo-element stripe (left: 0)".to_string()]
        );
        assert!(
            css_text_host_corners("a{content:\"{\"} .card{border-radius:12px}", ".card")
                .is_rounded_away_from_side(3)
        );

        assert!(names_same_element("&.is-accent"));
        assert!(names_same_element("&:hover"));
        assert!(names_same_element("&::before"));
        assert!(names_same_element("&--accent"));
        assert!(!names_same_element("& .child"));
        assert!(!names_same_element("&__part"));
        assert!(!names_same_element(".child"));
        assert_eq!(pseudo_stripped_selector(".a:not(.b):hover::after"), ".a");
    }

    /// Where the index cannot see the radius it keeps the finding; a literal
    /// square host in the same shape still drops it.
    #[test]
    fn host_index_fails_safe_where_the_radius_is_unseen() {
        const BAR: &str = "content:\"\";position:absolute;top:0;bottom:0;background:#6366f1";
        let kept = |css: &str| -> Vec<String> {
            let css = css.replace("BAR", BAR);
            let index = CssHostIndex::new(&css);
            scan_css_text_for_pseudo_stripe(&css)
                .into_iter()
                .filter(|f| index.side_stripe_on_rounded_host(f))
                .map(|f| f.snippet)
                .collect()
        };
        // An interpolated radius in a CSS-in-JS template, and its literal
        // square twin.
        assert_eq!(
            kept("position: relative;\n  border-radius: ${({ theme }) => theme.radii.md};\n  &::before { BAR; left: 0; width: 4px }"),
            vec!["&::before — absolute 4px pseudo-element stripe (left: 0)".to_string()]
        );
        assert!(kept(
            "position: relative;\n  border-radius: 0;\n  &::before { BAR; left: 0; width: 4px }"
        )
        .is_empty());
        // A bare interpolation, a Sass include and a Less mixin call could
        // round the card; a later literal radius replaces what they set.
        for mixin in ["${cardShape}", "@include card-shape;", ".rounded();"] {
            let css = format!(
                ".c {{ position: relative; {mixin} &::before {{ BAR; left: 0; width: 5px }} }}"
            );
            assert_eq!(kept(&css).len(), 1, "{mixin}");
        }
        assert!(kept(
            ".c { position: relative; @include card-shape; border-radius: 0; &::before { BAR; left: 0; width: 5px } }"
        )
        .is_empty());
        // An interpolated selector names an element the index cannot find.
        assert_eq!(
            kept("${Row} { position: relative; &::after { BAR; right: 0; width: 6px } }").len(),
            1
        );
        // A media query wrapper passes through to a literal square card.
        assert!(kept(
            ".c { border-radius: 0; @media (min-width: 1px) { &::before { BAR; left: 0; width: 7px } } }"
        )
        .is_empty());

        assert!(names_same_element(".dark &"));
        assert!(names_same_element("&:hover, &:focus-visible"));
        assert!(names_same_element("'&:hover'"));
        assert!(!names_same_element("&:hover, .other"));
        assert!(!names_same_element("& > .child"));

        for unseen in [
            "@include rounded",
            "@extend .card",
            "@apply rounded-lg",
            "composes: card from './card.css'",
            "...base",
            "+rounded",
            "${shape}",
            ".rounded()",
            ".rounded",
            "#ns > .mixin()",
        ] {
            assert!(is_unseen_declaration_source(unseen), "{unseen}");
        }
        for seen in [
            "border-radius: 0",
            "$radius: 12px",
            "border-radius: ${r}px",
            "#000",
            "#fff",
            "color: red",
            "",
        ] {
            assert!(!is_unseen_declaration_source(seen), "{seen}");
        }
    }

    /// The radius rules the static cascade never applies: nested in a style
    /// rule, or under an at-rule it skips. Keyframes style no box at rest.
    #[test]
    fn host_index_lists_radius_rules_the_static_cascade_skips() {
        let css = ".a { border-radius: 12px; }\n\
                   @media (min-width: 1px) { .b { border-radius: 12px; } }\n\
                   .c { & .d { border-radius: 12px; } @media (min-width: 1px) { border-radius: 8px; } }\n\
                   @container (min-width: 1px) { .e { border-radius: 12px; } }\n\
                   @keyframes k { from { border-radius: 0; } to { border-radius: 12px; } }";
        let mut selectors: Vec<String> = CssHostIndex::new(css)
            .unapplied_radius_rules()
            .into_iter()
            .flat_map(|r| r.selectors)
            .collect();
        selectors.sort();
        assert_eq!(selectors, vec![".c", ".c .d", ".e"]);
    }

    #[test]
    fn pseudo_stripe_lookarounds_match_node() {
        let h = |sel: &str| {
            format!("{sel}::before{{position:absolute;height:4px;left:0;right:0;top:0;background:#3b82f6}}")
        };
        let flags = |css: &str| !scan_css_text_for_pseudo_stripe(css).is_empty();
        assert!(!flags(&h(".card a")));
        assert!(flags(&h(".card .ab")));
        assert!(!flags(&h(".card [aria-current]")));
        assert!(!flags(&h(".card [aria-current=\"false\"]")));
        assert!(!flags(&h(".card .btn-x")));
        assert!(!flags(&h(".card .active-x")));
        assert!(flags(&h(".card .activex")));
        assert!(flags(&h(".card .xactive")));
        assert!(!flags(&h(".tabs [aria-selected]")));
        assert!(!flags(&h(".tabs [aria-selected=true]")));
        let li = scan_css_text_for_pseudo_stripe(
            "li::before{position:absolute;width:4px;left:0;top:0;bottom:0;background:#3b82f6}",
        );
        assert_eq!(
            li[0].snippet,
            "li::before — absolute 4px pseudo-element stripe (left: 0)"
        );
        let floating = scan_css_text_for_pseudo_stripe(
            ".x::before{position:absolute;width:4px;left:0;top:2px;bottom:3px;background:oklch(0.7 0.2 30)}",
        );
        assert_eq!(floating.len(), 1);
        let commented = scan_css_text_for_pseudo_stripe(
            "/* .c::before{position:absolute;width:4px;left:0;top:0;bottom:0;background:red} */ .d::after{position:absolute;width:4px;left:0;top:0;bottom:0;background:red}",
        );
        assert_eq!(commented.len(), 1);
        assert_eq!(commented[0].index, Some(83));
        assert_eq!(commented[0].selector.as_deref(), Some(".d::after"));
    }

    #[test]
    fn unicode_inputs_do_not_panic() {
        let samples = [
            "é.a::before{position:absolute;width:4px;left:0;top:0;bottom:0;background:#3b82f6}/*😀*/",
            "@keyframes 😀x{to{transform:translateX(-50%)}} .m{animation:😀x 1s infinite}",
            "<header><div class=\"dot😀 dot\" id=\"é\">x</div></header>.dot{width:8px;height:8px;border-radius:50%;animation:pulse 1s infinite}",
            "body{background:#000} .x{box-shadow:0 0 20px #f00; background: radial-gradient(#f00, transparent)}",
            "@media (prefers-reduced-motion: reduce){.a{b:c}}😀",
            "<svg width=\"300é\" viewBox=\"0 0 400 300\"><rect fill=\"a\"/><rect fill=\"b\"/><rect fill=\"c\"/><circle/><circle/><circle/><ellipse/><polygon/></svg>",
            "😀",
            "{😀",
            "@keyframes k{",
        ];
        for s in samples {
            let _ = scan_css_text_for_pseudo_stripe(s);
            let _ = scan_css_text_for_inset_stripe(s);
            let _ = scan_css_text_for_pulsing_dot(s, None);
            let _ = scan_css_text_for_marquee(s, None);
            let _ = scan_css_text_for_glow(s);
            let _ = scan_css_text_for_grid_background(s);
            let _ = scan_css_text_for_radial_halo(s);
            let _ = collect_marquee_keyframes(s);
            let _ = collect_pulse_keyframes(s);
            let _ = strip_reduced_motion_blocks(s);
            let _ = enclosing_css_selector(s, s.len());
            let _ = crate::checks::html_patterns::check_html_patterns(s, None);
            let _ = crate::checks::html_patterns::scan_html_for_shape_assembled_illustration(s);
        }
    }
    /// lpga.or.jp: `.news::after` is a 10px strip of a repeated photograph.
    /// A stripe that names no colour is not an accent colour.
    #[test]
    fn a_pseudo_stripe_drawn_by_an_image_alone_is_not_reported() {
        let rule = |bg: &str| {
            format!(".news::after{{content:\"\";position:absolute;bottom:0;height:10px;left:0;right:0;background:{bg}}}")
        };
        let snippets = |bg: &str| -> Vec<String> {
            scan_css_text_for_pseudo_stripe(&rule(bg)).into_iter().map(|f| f.snippet).collect()
        };
        assert!(snippets("url(\"../images/before-sns.jpg\") left center / auto 10px repeat-x").is_empty());
        assert!(snippets("url(rule.png)").is_empty());
        let reported = vec![".news::after — absolute 10px pseudo-element stripe (bottom: 0)".to_string()];
        // A colour beside the image, in any spelling, reports as before.
        assert_eq!(snippets("url(rule.png) #e11d48"), reported);
        assert_eq!(snippets("crimson url(rule.png) repeat-x"), reported);
        assert_eq!(snippets("url(rule.png) var(--accent)"), reported);
        // And so does a value with no image that the scan cannot parse.
        assert_eq!(snippets("var(--accent)"), reported);
    }

    #[test]
    fn keyframes_that_only_pulse() {
        // SpinKit: a dot swelling from nothing to its size and back.
        let spinkit = "@keyframes sk-bounceDelay{0%,80%,100%{transform:scale(0)}40%{transform:scale(1)}}";
        assert_eq!(css_keyframes_only_pulse(spinkit, "sk-bounceDelay"), Some(true));
        assert_eq!(css_keyframes_only_pulse(spinkit, "other"), None);
        for (pulses, body) in [
            (true, "0%{opacity:0;-webkit-transform:scale3d(.3,.3,.3)}100%{opacity:1;transform:none}"),
            (true, "50%{scale:0.5 0.5;animation-timing-function:cubic-bezier(0.4,0,0.2,1)}"),
            // Tailwind's bounce moves the element.
            (false, "0%,100%{transform:translateY(-25%);animation-timing-function:cubic-bezier(0.8,0,1,1)}50%{transform:none}"),
            // A pop past full size, an easing past its end value, a turn.
            (false, "0%{transform:scale(0)}60%{transform:scale(1.2)}100%{transform:scale(1)}"),
            (false, "0%{transform:scale(0);animation-timing-function:cubic-bezier(0.34,1.56,0.64,1)}100%{transform:scale(1)}"),
            (false, "0%{transform:scale(0) rotate(10deg)}100%{transform:scale(1)}"),
            // Values this cannot read, another property, no declaration.
            (false, "0%{transform:scale(var(--s))}100%{transform:scale(1)}"),
            (false, "0%{top:0}100%{top:10px}"),
            (false, "0%{}100%{}"),
        ] {
            let css = format!("@keyframes k{{{body}}}");
            assert_eq!(css_keyframes_only_pulse(&css, "k"), Some(pulses), "{body}");
        }
        // Two definitions of one name: both have to pulse.
        let twice = "@keyframes k{0%{transform:scale(0)}100%{transform:scale(1)}} @-webkit-keyframes k{0%{transform:translateY(-10px)}}";
        assert_eq!(css_keyframes_only_pulse(twice, "k"), Some(false));
        assert_eq!(css_keyframes_only_pulse("@keyframes k{0%{opacity:0}", "k"), Some(false));
    }
}
