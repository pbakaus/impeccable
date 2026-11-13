//! The DOM half of `css-cascade.mjs`: `collectStaticCssText`,
//! `buildStaticStyleMap` (rule matching, inline styles, the pseudo-element
//! accent-dash / surface marking, the computed-style pass and the hover
//! pass). Everything here writes into a [`StaticDocument`].
//!
//! `buildBorderOverrideMap` / `buildCustomPropMap` are not ported: they read
//! the jsdom CSSOM (`document.styleSheets`, `rule.style.borderLeft`) which
//! the static document never had, so in the static path they were dead
//! (`customPropMap` is `null`, `overrides` is `null`).

use super::checks_shim::CustomProps;
use super::shorthand::{
    background_paint_parts, expand_shorthand_slot, names_background_geometry, VAR_ANYWHERE_RE,
};
use super::{
    apply_static_declaration, collect_static_css_rules, collect_static_css_rules_from,
    compare_static_priority, is_static_inherited_prop, make_default_style,
    normalize_static_css_value, parse_static_style_attribute, static_default_style, CssRule,
    DeclMeta, SpecifiedDecl, SpecifiedStore, StyleValues, UrlBase, STATIC_DEFAULT_STYLE,
};
use crate::dom::StaticDocument;
use crate::profile::{self, Meta, ProfileSink};
use ego_tree::NodeId;
use impeccable_core::checks::css_scan::{collect_css_custom_props, css_length_to_px};
use impeccable_core::checks::measures;
use impeccable_core::color::parse_any_color;
use impeccable_common::jsp;
use impeccable_core::js;
use indexmap::IndexMap;
use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::HashMap;
use std::path::Path;
use std::rc::Rc;

static STYLESHEET_REL_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)(?-u:\b)stylesheet(?-u:\b)").expect("STYLESHEET_REL_RE"));
static REMOTE_HREF_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)^(https?:)?//").expect("REMOTE_HREF_RE"));

/// JS: css-cascade.mjs#resolveLinkedCssPath(fileDir, href)
/// Cache-busting (styles.css?v=3) and root-relative (/static/app.css) hrefs
/// must not resolve as OS-absolute paths; otherwise the whole stylesheet is
/// invisible to every element-level check.
pub(crate) fn resolve_linked_css_path(file_dir: &str, href: &str) -> String {
    let stripped = href.split(['?', '#']).next().unwrap_or("");
    resolve_css_path_exact(file_dir, stripped)
}

/// [`resolve_linked_css_path`] for a path with no query or fragment left to
/// cut: an image url's path after its `%XX` escapes are decoded, where a
/// `#` or `?` is part of the file name (#560).
pub(crate) fn resolve_css_path_exact(file_dir: &str, stripped: &str) -> String {
    let root_relative = stripped.starts_with('/') && !stripped.starts_with("//");
    if !root_relative {
        return jsp::resolve("/", &[file_dir, stripped]);
    }
    // Drop "." and reject ".." so /../outside.css cannot walk out of dir.
    let trimmed = stripped.trim_start_matches('/');
    let segments: Vec<&str> = trimmed
        .split(['/', '\\'])
        .filter(|p| !p.is_empty() && *p != ".")
        .collect();
    if segments.iter().any(|p| *p == "..") {
        let joined = segments
            .iter()
            .filter(|p| **p != "..")
            .copied()
            .collect::<Vec<_>>()
            .join(jsp::SEP);
        return jsp::join(&[file_dir, &joined]);
    }
    let rel = segments.join(jsp::SEP);
    let mut dir = file_dir.to_string();
    loop {
        let parent = jsp::dirname(&dir);
        if parent == dir {
            break; // never use the filesystem root as document root
        }
        let candidate = jsp::join(&[&dir, &rel]);
        if std::fs::metadata(&candidate)
            .map(|m| m.is_file())
            .unwrap_or(false)
        {
            return candidate;
        }
        // Stop at the project root so a coincidental ~/static/app.css cannot win.
        if Path::new(&jsp::join(&[&dir, "package.json"])).exists()
            || Path::new(&jsp::join(&[&dir, ".git"])).exists()
        {
            break;
        }
        dir = parent;
    }
    jsp::join(&[file_dir, &rel])
}

/// A page's CSS as the cascade reads it: the text of every `<style>` element
/// and every local linked stylesheet, joined with `\n`, plus where each
/// stylesheet linked from another directory sits in that text. The text is
/// never rewritten, so the pattern checks read every sheet as authored; only
/// the rules collected from a foreign sheet resolve their urls against it.
#[derive(Debug, Clone, Default)]
pub struct StaticCss {
    pub text: String,
    page_dir: String,
    foreign_sheets: Vec<ForeignSheet>,
}

#[derive(Debug, Clone)]
struct ForeignSheet {
    start: usize,
    end: usize,
    dir: String,
}

impl StaticCss {
    /// The rules of the whole text in cascade order. With no foreign sheet
    /// this is one parse of the joined text, exactly as before; a foreign
    /// sheet is parsed on its own so its urls can be told apart, and the
    /// order numbers run on across the stretches.
    pub fn rules(&self) -> Vec<CssRule> {
        if self.foreign_sheets.is_empty() {
            return collect_static_css_rules(&self.text);
        }
        let mut rules: Vec<CssRule> = Vec::new();
        let mut cursor = 0usize;
        for sheet in &self.foreign_sheets {
            if sheet.start > cursor {
                let stretch = &self.text[cursor..sheet.start];
                rules.extend(collect_static_css_rules_from(
                    stretch,
                    rules.len() as i64,
                    None,
                ));
            }
            let base = UrlBase::new(&sheet.dir, &self.page_dir);
            let stretch = &self.text[sheet.start..sheet.end];
            rules.extend(collect_static_css_rules_from(
                stretch,
                rules.len() as i64,
                Some(&base),
            ));
            cursor = sheet.end;
        }
        if cursor < self.text.len() {
            let stretch = &self.text[cursor..];
            rules.extend(collect_static_css_rules_from(
                stretch,
                rules.len() as i64,
                None,
            ));
        }
        rules
    }
}

/// JS: css-cascade.mjs#collectStaticCssText(root, fileDir, profile, filePath, modules)
/// The text of every `<style>` element plus every local `<link rel=stylesheet>`
/// resolved relative to `file_dir` (query/hash stripped), joined with `\n`.
/// `warn` receives the JS `process.stderr.write` notice for an unreadable
/// linked stylesheet (once per resolved path per scan).
///
/// Returns that text, as the cascade's [`StaticCss`], plus a second one for
/// the page-level pattern scan: the same join minus the linked sheets
/// `ignored` accepts (given the resolved path). The cascade keeps the full
/// text.
pub fn collect_static_css_text(
    doc: &StaticDocument,
    file_dir: &Path,
    profile: Option<&dyn ProfileSink>,
    file_path: &str,
    warn: Option<&dyn Fn(&str)>,
    ignored: Option<&dyn Fn(&str) -> bool>,
) -> (StaticCss, String) {
    let file_dir_str = file_dir.to_string_lossy().into_owned();
    let mut css = StaticCss {
        page_dir: file_dir_str.clone(),
        ..StaticCss::default()
    };
    let mut pattern_texts: Vec<String> = Vec::new();
    let mut pieces = 0usize;
    // `style_texts.join('\n')`, built in place so a sheet's span is known.
    let mut push = |css: &mut StaticCss, piece: &str, foreign_dir: Option<String>| {
        if pieces > 0 {
            css.text.push('\n');
        }
        pieces += 1;
        let start = css.text.len();
        css.text.push_str(piece);
        if let Some(dir) = foreign_dir {
            css.foreign_sheets.push(ForeignSheet {
                start,
                end: css.text.len(),
                dir,
            });
        }
    };
    let mut warned_missing_stylesheets: std::collections::HashSet<String> =
        std::collections::HashSet::new();
    for style_el in doc.query_selector_all("style") {
        let text = style_el.text_content();
        push(&mut css, &text, None);
        pattern_texts.push(text);
    }
    for link in doc.query_selector_all("link") {
        let rel = link.get_attribute("rel").unwrap_or("");
        let href = link.get_attribute("href").unwrap_or("");
        if !STYLESHEET_REL_RE.is_match(rel) || href.is_empty() || REMOTE_HREF_RE.is_match(href) {
            continue;
        }
        let css_path = resolve_linked_css_path(&file_dir_str, href);
        let read = profile::step(
            profile,
            Meta::new("preprocess", "inline-linked-stylesheet", file_path).with_detail(href),
            || std::fs::read(&css_path),
        );
        match read {
            Ok(bytes) => {
                let sheet_dir = jsp::dirname(&css_path);
                let foreign_dir = (sheet_dir != file_dir_str).then_some(sheet_dir);
                let text = String::from_utf8_lossy(&bytes).into_owned();
                push(&mut css, &text, foreign_dir);
                if !ignored.is_some_and(|f| f(&css_path)) {
                    pattern_texts.push(text);
                }
            }
            Err(_) => {
                if warned_missing_stylesheets.insert(css_path.clone()) {
                    if let Some(warn) = warn {
                        warn(&format!(
                            "impeccable detect: could not read linked stylesheet {href} (resolved to {css_path}); color and custom-property rules will be incomplete\n"
                        ));
                    }
                }
            }
        }
    }
    (css, pattern_texts.join("\n"))
}

static PSEUDO_AFTER_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)::?after\s*$").expect("PSEUDO_AFTER_RE"));
static PSEUDO_RULE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        r"(?i)^(.+?){ws}*::?(?:before|after)$",
        ws = js::WS
    ))
    .expect("PSEUDO_RULE_RE")
});
static PLACEHOLDER_RULE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^(.*)(?:::placeholder|::?-webkit-input-placeholder|::?-moz-placeholder)$")
        .expect("PLACEHOLDER_RULE_RE")
});

fn placeholder_host_selector(selector: &str) -> Option<String> {
    let pm = PLACEHOLDER_RULE_RE.captures(selector)?;
    let captured = pm.get(1).map(|m| m.as_str()).unwrap_or("");
    let trimmed_end = captured.trim_end_matches(|c: char| js::is_js_whitespace(c));
    if trimmed_end.is_empty() {
        return Some("*".to_string());
    }
    // Only fill a trailing empty compound. `star_empty_compounds` would
    // rewrite `.label + ::placeholder` to `.label *+*`.
    let last = trimmed_end.chars().last().unwrap();
    if captured.len() != trimmed_end.len() || last == '>' || last == '+' || last == '~' {
        if last == '>' || last == '+' || last == '~' {
            Some(format!("{}*", trimmed_end))
        } else {
            Some(format!("{} *", trimmed_end))
        }
    } else {
        Some(trimmed_end.to_string())
    }
}
static COLOR_TOKEN_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color-mix)\([^)]*(?:\([^)]*\))?[^)]*\)|#[0-9a-f]{3,8}(?-u:\b)")
        .expect("COLOR_TOKEN_RE")
});
static ZERO_LEN_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^0(?:px)?$").expect("ZERO_LEN_RE"));
// The custom property each `var()` in a value names.
static VAR_NAME_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)var\(\s*(--[^\s,)]+)").expect("VAR_NAME_RE"));
static WS_SPLIT_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(&format!("{}+", js::WS)).expect("WS_SPLIT_RE"));
static GRADIENT_RE: Lazy<Regex> = Lazy::new(|| Regex::new("(?i)gradient").expect("GRADIENT_RE"));
// What a `background-image` value, or the image part of a `background`
// shorthand, paints on its own: a gradient, a `url()`, another image
// function, or a value still holding a `var()` the engine cannot read.
static IMAGE_PAINT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)gradient\(|url\(|image-set\(|image\(|cross-fade\(|element\(|paint\(|var\(")
        .expect("IMAGE_PAINT_RE")
});

fn resolve_root(raw: &str, root: &impeccable_core::checks::css_scan::CustomProps) -> String {
    let lookup = |name: &str| root.get(name).cloned();
    measures::resolve_var_refs(raw, &lookup, 0)
}

/// The four sides an `inset` shorthand sets, top, right, bottom, left, as
/// CSS reads one to four values. Anything else (nothing, or more than four
/// values) is handed to every side as it came, which no side reads as zero.
fn inset_sides(value: &str) -> [String; 4] {
    let raw = js::trim(value);
    let parts: Vec<&str> = if raw.is_empty() {
        Vec::new()
    } else {
        WS_SPLIT_RE.split(raw).collect()
    };
    let s = |i: usize| parts[i].to_string();
    match parts.len() {
        1 => [s(0), s(0), s(0), s(0)],
        2 => [s(0), s(1), s(0), s(1)],
        3 => [s(0), s(1), s(2), s(1)],
        4 => [s(0), s(1), s(2), s(3)],
        _ => [raw.to_string(), raw.to_string(), raw.to_string(), raw.to_string()],
    }
}

const SIDES: [&str; 4] = ["top", "right", "bottom", "left"];

/// The marker an `inset` shorthand holding a `var()` leaves in each side
/// slot (#560), `from-inset(<the shorthand as written>)`: how many values
/// the shorthand holds, and so which side each sets, is known only once
/// the property resolves (`--edges: 0 0` is two values from one token), so
/// the split waits for the computed pass (`split_resolved_inset`). The name
/// holds no `var(`, which the resolver would take for the call itself.
const FROM_INSET: &str = "from-inset";

/// What an `inset` shorthand puts in the four side slots: its sides, read
/// as CSS reads them, or, while it holds a `var()`, the whole shorthand
/// under the `from-inset` marker in every slot, for the split once resolved.
fn inset_side_slots(value: &str) -> [String; 4] {
    if VAR_ANYWHERE_RE.is_match(value) {
        let marker = format!("{FROM_INSET}({})", js::trim(value));
        return [marker.clone(), marker.clone(), marker.clone(), marker];
    }
    inset_sides(value)
}

/// The side slots of a pseudo once its values resolved: a slot still
/// holding the shorthand's `from-inset(...)` takes its own side of the
/// resolved shorthand (`inset: var(--edges)` with `--edges: 0 0` puts `0`
/// on every side), while a slot a later side declaration won keeps that
/// side's value. A shorthand the resolver could not read stays as it came,
/// which no side reads as zero.
fn split_resolved_inset(decls: &mut IndexMap<String, String>) {
    for (i, side) in SIDES.iter().enumerate() {
        let Some(inner) = decls
            .get(*side)
            .and_then(|v| v.strip_prefix(FROM_INSET))
            .and_then(|v| v.strip_prefix('('))
            .and_then(|v| v.strip_suffix(')'))
        else {
            continue;
        };
        let resolved = inset_sides(inner)[i].clone();
        decls.insert(side.to_string(), resolved);
    }
}

/// The key a `::before` / `::after` declaration is merged under: the
/// property lowercased, except a custom property, whose name is
/// case-sensitive (`--Scrim` is not `--scrim`) and is kept as written so a
/// `var()` finds it.
fn pseudo_prop_key(prop: &str) -> String {
    if prop.starts_with("--") {
        prop.to_string()
    } else {
        js::to_lower_case(prop)
    }
}

/// The declarations of one `::before` / `::after` rule, by lowercased
/// property, with `inset` expanded to its four sides in declaration order
/// so a side named later wins, as it does in CSS. An `inset` holding a
/// `var()` leaves its marker in the sides (`inset_side_slots`); this
/// sheet-wide read resolves no side, so it takes the marker for a side not
/// known to be zero.
fn pseudo_decls(rule: &CssRule) -> IndexMap<String, String> {
    let mut decls: IndexMap<String, String> = IndexMap::new();
    for d in &rule.declarations {
        let key = pseudo_prop_key(&d.prop);
        if key == "inset" {
            for (side, value) in SIDES.iter().zip(inset_side_slots(&d.value)) {
                decls.insert(side.to_string(), value);
            }
        }
        decls.insert(key, d.value.clone());
    }
    decls
}

/// Whether a pseudo with these declarations is stretched over its element:
/// positioned, and either 100% by 100%, or at zero on every side (`inset`
/// having been expanded into the sides) with no declared size to keep it
/// small. Opposing offsets stretch a box only while its size is `auto` (or
/// `100%`): a declared `width`, `height`, `inline-size`, or `block-size`
/// wins over the far offset, and a `max-width` or `max-height` below the
/// box (anything but `none`, `100%`, or the initial value) caps it, so such
/// a pseudo is a decoration, not an overlay.
fn pseudo_covers_box(decls: &IndexMap<String, String>) -> bool {
    let get = |k: &str| decls.get(k).map(|s| js::to_lower_case(js::trim(s)));
    let pseudo_pos = get("position").unwrap_or_default();
    if pseudo_pos != "absolute" && pseudo_pos != "fixed" {
        return false;
    }
    let is_100 = |k: &str| get(k).as_deref() == Some("100%");
    if is_100("width") && is_100("height") {
        return true;
    }
    let zero_len = |k: &str| get(k).is_some_and(|s| ZERO_LEN_RE.is_match(&s));
    let lets_stretch = |keys: [&str; 2]| {
        keys.iter().all(|k| match get(k) {
            None => true,
            Some(v) => v == "auto" || v == "100%",
        })
    };
    let uncapped = |k: &str| match get(k) {
        None => true,
        Some(v) => matches!(v.as_str(), "none" | "100%" | "initial" | "unset" | "revert"),
    };
    SIDES.iter().all(|side| zero_len(side))
        && lets_stretch(["width", "inline-size"])
        && lets_stretch(["height", "block-size"])
        && uncapped("max-width")
        && uncapped("max-height")
}

/// The `::before` / `::after` rule pre-pass as the JS read it, one rule at
/// a time: mark base-selector matches whose pseudo paints a short chromatic
/// dash (`setAccentDashPseudo`) or a full-cover opaque surface
/// (`setPseudoSurface`).
fn mark_pseudo_analytic(
    doc: &mut StaticDocument,
    decls: &IndexMap<String, String>,
    base_selector: &str,
    root_custom_props: &impeccable_core::checks::css_scan::CustomProps,
) {
    let get = |k: &str| decls.get(k).map(|s| s.as_str());
    let first_of = |a: &str, b: &str| -> String {
        match get(a) {
            Some(v) if !v.is_empty() => v.to_string(),
            _ => get(b).unwrap_or("").to_string(),
        }
    };
    let w = css_length_to_px(&resolve_root(
        &first_of("width", "inline-size"),
        root_custom_props,
    ));
    let h = css_length_to_px(&resolve_root(
        &first_of("height", "block-size"),
        root_custom_props,
    ));
    if let (Some(w), Some(h)) = (w, h) {
        if (8.0..=80.0).contains(&w) && (1.0..=6.0).contains(&h) {
            let bg_raw = resolve_root(
                &first_of("background-color", "background"),
                root_custom_props,
            );
            let token = COLOR_TOKEN_RE.find(&bg_raw).map(|m| m.as_str().to_string());
            let c = parse_any_color(Some(token.as_deref().unwrap_or(&bg_raw)));
            if let Some(c) = c {
                let mx = js::math_max3(c.r, c.g, c.b);
                let mn = js::math_min3(c.r, c.g, c.b);
                if c.alpha_or_one() >= 0.1 && mx - mn >= 30.0 {
                    let ids: Vec<NodeId> = doc
                        .query_selector_all(base_selector)
                        .iter()
                        .map(|e| e.id())
                        .collect();
                    for id in ids {
                        doc.set_accent_dash_pseudo(id);
                    }
                }
            }
        }
    }
    if pseudo_covers_box(decls) && decls.contains_key("content") {
        let surf_raw = resolve_root(
            &first_of("background-color", "background"),
            root_custom_props,
        );
        let token = COLOR_TOKEN_RE
            .find(&surf_raw)
            .map(|m| m.as_str().to_string());
        let surf = parse_any_color(Some(token.as_deref().unwrap_or(&surf_raw)));
        if let Some(surf) = surf {
            if surf.alpha_or_one() >= 0.9 && !GRADIENT_RE.is_match(&surf_raw) {
                let ids: Vec<NodeId> = doc
                    .query_selector_all(base_selector)
                    .iter()
                    .map(|e| e.id())
                    .collect();
                for id in ids {
                    doc.set_pseudo_surface(id, surf);
                }
            }
        }
    }
}

/// One winner into a merged pseudo map, by the cascade's priority (a later
/// declaration of equal priority wins, as within one rule).
fn put_pseudo_decl(
    map: &mut IndexMap<String, (String, DeclMeta)>,
    key: &str,
    value: &str,
    meta: &DeclMeta,
) {
    if compare_static_priority(map.get(key).map(|(_, m)| m), meta) {
        map.insert(key.to_string(), (value.to_string(), meta.clone()));
    }
}

/// One declaration of a rule into a merged pseudo map. A `background`
/// shorthand also takes the `background-color` and `background-image`
/// keys, with the color and the image list it names
/// (`background_paint_parts`: `transparent` and `none` where it names
/// neither), since it resets both longhands: a longhand declared before it
/// loses its slot, one declared after it wins the slot back, and the
/// readers below prefer the longhand key. `inset` takes the four side keys
/// the same way. Winners already expanded this way merge key by key
/// (`put_pseudo_decl`), never through here again: a replay would hand a
/// longhand's slot back to a shorthand of the same priority that it had
/// already beaten. Values are stored as written: a `background` holding a
/// `var()` goes whole into both slots and an `inset` holding one goes whole
/// into every side slot under the `from-inset` marker (`inset_side_slots`),
/// and the computed pass resolves every value against the element's own
/// custom properties before it reads them (`mark_pseudo_paint`), splitting
/// each shorthand again then. The priority still decides slot by slot, so a
/// side declared after such an `inset` wins its slot from the marker.
fn merge_pseudo_decl(
    map: &mut IndexMap<String, (String, DeclMeta)>,
    key: &str,
    value: &str,
    meta: &DeclMeta,
) {
    put_pseudo_decl(map, key, value, meta);
    if key == "background" {
        let (color, image) = background_paint_parts(value);
        put_pseudo_decl(map, "background-color", &color, meta);
        put_pseudo_decl(map, "background-image", &image, meta);
    } else if key == "inset" {
        for (side, side_value) in SIDES.iter().zip(inset_side_slots(value)) {
            put_pseudo_decl(map, side, &side_value, meta);
        }
    }
}

/// A `content` value that generates no box: `none`, or `normal`, which
/// computes to `none` on `::before` and `::after`.
fn content_generates_no_box(value: &str) -> bool {
    let value = js::to_lower_case(js::trim(value));
    value == "none" || value == "normal"
}

/// Whether a pseudo with these declarations generates a box that paints:
/// a `content` other than `none` or `normal` (a value the engine cannot
/// read is taken to generate one), no `display: none` or `visibility:
/// hidden`, and an opacity above 0.02 (one the engine cannot read is taken
/// to paint).
fn pseudo_paints_a_box(decls: &IndexMap<String, String>) -> bool {
    let get = |k: &str| decls.get(k).map(|s| js::to_lower_case(js::trim(s)));
    let Some(content) = get("content") else {
        return false;
    };
    if content_generates_no_box(&content)
        || get("display").as_deref() == Some("none")
        || get("visibility").as_deref() == Some("hidden")
    {
        return false;
    }
    match get("opacity") {
        Some(opacity) => {
            impeccable_core::checks::sampled_contrast::opacity_value(&opacity).map_or(true, |v| v > 0.02)
        }
        None => true,
    }
}

/// What a CSS-wide keyword means as a custom property's value on the
/// pseudo's own layer (#560): `inherit`, and `unset`, `revert`, and
/// `revert-layer`, which come to the same for a property that inherits and
/// has nothing earlier to revert to, take the element's value; `initial` is
/// the guaranteed-invalid value, which no `var()` resolves without a
/// fallback, so a declaration left naming it is invalid at computed-value
/// time and its property takes its initial value. Any other value is the
/// property's own.
#[derive(Clone, Copy, PartialEq, Eq)]
enum CustomKeyword {
    Inherits,
    Invalid,
}

fn custom_property_keyword(value: &str) -> Option<CustomKeyword> {
    match js::to_lower_case(js::trim(value)).as_str() {
        "inherit" | "unset" | "revert" | "revert-layer" => Some(CustomKeyword::Inherits),
        "initial" => Some(CustomKeyword::Invalid),
        _ => None,
    }
}

/// Whether a `::before` / `::after` rule that names no geometry or paint
/// can still change what the merged read sees: it names `content` (the box
/// turned on or off) or a custom property (a `--scrim` the paint reads).
/// Such a rule is matched against the candidate elements, never looked up
/// over the document (`names_pseudo_paint_or_geometry`).
fn completes_pseudo_elsewhere(decls: &IndexMap<String, (String, DeclMeta)>) -> bool {
    decls.keys().any(|k| k == "content" || k.starts_with("--"))
}

/// Whether a `::before` / `::after` rule names the geometry, the paint, or
/// the box's visibility the merged read below needs, so its matches are
/// worth looking up over the document. A rule naming only `content` (an
/// icon font's, by the thousand) or only custom properties cannot complete
/// an overlay on its own; it is matched against the elements those rules
/// found instead (`completes_pseudo_elsewhere`), since one that turns the
/// box on or off, or sets what the paint reads, from another selector must
/// reach the merge too.
fn names_pseudo_paint_or_geometry(decls: &IndexMap<String, (String, DeclMeta)>) -> bool {
    [
        "position",
        "inset",
        "top",
        "right",
        "bottom",
        "left",
        "width",
        "height",
        "inline-size",
        "block-size",
        "max-width",
        "max-height",
        "background",
        "background-color",
        "background-image",
        "display",
        "visibility",
        "opacity",
    ]
    .iter()
    .any(|key| decls.contains_key(*key))
}

/// The sampled path's marks (#560) on a pseudo stretched over its element
/// that generates a box which paints (`pseudo_paints_a_box`): a raster
/// image makes it a picture under the element's content, and any paint at
/// all makes it an overlay the walk gives up on. Read from the winning
/// declarations of every rule on the same pseudo of the element
/// (`build_static_style_map`), not rule by rule: the geometry and the paint
/// may come from different rules, on one selector or two, and a later rule
/// may take the paint away. Every value is resolved against the element's
/// own custom properties first (`custom_props`, the computed pass's map
/// for the element, inherited and inline values included), under those the
/// pseudo's own rules declare (a `--scrim` on `.hero::before`, or on
/// `.dark::before` for the elements that match it, wins over the element's,
/// the pseudo-element inheriting the rest, one that references another
/// reads the pseudo's own value whatever the order, and one set to a
/// CSS-wide keyword inherits or, at `initial`, goes away), and a shorthand
/// that held a `var()` is split once resolved: a `background` into its
/// color and image parts, an `inset` into the sides it sets
/// (`split_resolved_inset`).
fn mark_pseudo_paint(
    doc: &mut StaticDocument,
    decls: &IndexMap<String, String>,
    ids: &[NodeId],
    custom_props: &CustomProps,
) {
    // The pseudo's own custom properties over the element's: every winner
    // goes in as written first, and each is then resolved against the whole
    // set, as CSS reads a `var()` in one of them against the
    // pseudo-element's own computed values whatever the declaration order
    // (`--scrim: var(--tone); --tone: ...` reads the pseudo's `--tone`, not
    // the element's). The resolver follows chained references, so the order
    // the keys resolve in does not matter either. A CSS-wide keyword is
    // applied first (`custom_property_keyword`): one that inherits leaves
    // the element's value in place, and `initial` takes the property away,
    // so a `var()` on it takes its fallback, and a declaration left naming
    // it is dropped below, as its property takes its initial value.
    let invalid: Vec<&String> = decls
        .iter()
        .filter(|(k, v)| {
            k.starts_with("--") && custom_property_keyword(v) == Some(CustomKeyword::Invalid)
        })
        .map(|(k, _)| k)
        .collect();
    let own_props: Option<CustomProps> = decls.keys().any(|k| k.starts_with("--")).then(|| {
        let mut layered = custom_props.clone();
        let own = || decls.iter().filter(|(k, _)| k.starts_with("--"));
        for (name, value) in own() {
            match custom_property_keyword(value) {
                Some(CustomKeyword::Inherits) => {}
                Some(CustomKeyword::Invalid) => {
                    layered.shift_remove(name);
                }
                None => {
                    layered.insert(name.clone(), value.clone());
                }
            }
        }
        for (name, value) in own() {
            if custom_property_keyword(value).is_some() {
                continue;
            }
            let resolved = super::checks_shim::resolve_var_refs(value, &layered);
            layered.insert(name.clone(), resolved);
        }
        layered
    });
    let custom_props = own_props.as_ref().unwrap_or(custom_props);
    let mut decls: IndexMap<String, String> = decls
        .iter()
        .map(|(k, v)| {
            (
                k.clone(),
                super::checks_shim::resolve_var_refs(v, custom_props),
            )
        })
        .collect();
    // A declaration whose `var()` still names a property the pseudo set to
    // `initial` is invalid at computed-value time, and its property takes
    // its initial value: no paint, no box, no offset, as if never declared.
    if !invalid.is_empty() {
        decls.retain(|_, v| {
            !VAR_NAME_RE
                .captures_iter(v)
                .any(|c| invalid.iter().any(|name| &c[1] == name.as_str()))
        });
    }
    split_resolved_inset(&mut decls);
    let decls = &decls;
    if !pseudo_covers_box(decls) || !pseudo_paints_a_box(decls) {
        return;
    }
    let get = |k: &str| decls.get(k).map(|s| s.as_str());
    let first_of = |a: &str, b: &str| -> String {
        match get(a) {
            Some(v) if !v.is_empty() => v.to_string(),
            _ => get(b).unwrap_or("").to_string(),
        }
    };
    // A pseudo stretched over its element and painting a raster image is a
    // picture under that element's content: the hero photo written as
    // `.hero::before { position: absolute; inset: 0; background: url() }`.
    // The contrast pass stands down over it, as it does over an `<img>`.
    let (_, image_raw) = background_paint_parts(&first_of("background-image", "background"));
    let picture = js::to_lower_case(&image_raw).contains("url(");
    let (color_raw, _) = background_paint_parts(&first_of("background-color", "background"));
    let token = COLOR_TOKEN_RE
        .find(&color_raw)
        .map(|m| m.as_str().to_string());
    let color = parse_any_color(Some(token.as_deref().unwrap_or(&color_raw)));
    // Anything the pseudo paints over the box, however faint, sits between
    // the box's own image and its text (#560). Of the color, only nothing,
    // `none`, `transparent` (which no color parser reads), `initial` and
    // `unset` (the longhand's initial value is transparent), and a color too
    // faint to see are known not to paint, and a value the engine cannot
    // read counts as paint; the image part paints on its own terms, whatever
    // a later longhand did to the color.
    let color_no_paint = color_raw.is_empty()
        || ["none", "transparent", "initial", "unset"]
            .iter()
            .any(|keyword| color_raw.eq_ignore_ascii_case(keyword))
        || color.is_some_and(|c| c.alpha_or_one() <= 0.02);
    let paints = !color_no_paint || IMAGE_PAINT_RE.is_match(&image_raw);
    for id in ids {
        if picture {
            doc.set_pseudo_picture(*id);
        }
        if paints {
            doc.set_pseudo_overlay(*id);
        }
    }
}

/// A `background` shorthand's layer that holds a `var()` is stored whole in
/// every slot (#560), as `from-shorthand(<its tokens>)`, since the parser
/// cannot see what the `var()` holds. Resolved, each slot re-reads the
/// layer with the shorthand grammar and takes what the shorthand named,
/// the default when it named nothing there (`expand_shorthand_slot`); the
/// color slot, which the pinned expansion fills with a `var()` standing
/// before the image, computes as `transparent` when that resolves to
/// background geometry, so no reader of `backgroundColor` takes a keyword
/// for an unreadable color. The second value says the `var()` added or
/// removed layers, which the compute loop records as
/// `backgroundLayersUnknown` for the walk to give up on.
fn shorthand_slot_or_default(prop: &str, value: String) -> (String, bool) {
    match prop {
        "backgroundColor" if names_background_geometry(&value) => {
            ("transparent".to_string(), false)
        }
        "backgroundRepeat" | "backgroundSize" | "backgroundPosition" | "backgroundOrigin"
        | "backgroundClip" | "backgroundAttachment" => expand_shorthand_slot(prop, &value),
        _ => (value, false),
    }
}

/// JS: css-cascade.mjs#buildStaticStyleMap(root, staticDoc, cssText, modules, profile, filePath)
pub fn build_static_style_map(
    doc: &mut StaticDocument,
    css: &StaticCss,
    profile: Option<&dyn ProfileSink>,
    file_path: &str,
) {
    let mut specified: SpecifiedStore<NodeId> = SpecifiedStore::new();
    let mut hover_specified: SpecifiedStore<NodeId> = SpecifiedStore::new();
    let mut placeholder_specified: SpecifiedStore<NodeId> = SpecifiedStore::new();
    let root_custom_props = collect_css_custom_props(&css.text);
    // Selectors of radius rules the matcher refuses: the side-accent gate
    // cannot read their corners, so the elements they may reach stay unknown.
    let mut refused_radius_selectors: Vec<String> = Vec::new();
    let rules = profile::step(
        profile,
        Meta::new("parse-css", "css-rules", file_path),
        || css.rules(),
    );

    let pseudo_paint = profile::step(
        profile,
        Meta::new("selector-match", "css-selectors", file_path),
        || {
            // The winning declarations of every `::before` / `::after` rule
            // on one base selector, for the paint read once all are in
            // (#560): a pseudo's geometry and its paint may be split across
            // rules, and a later rule may take the paint away.
            let mut pseudo_merged: IndexMap<(String, bool), IndexMap<String, (String, DeclMeta)>> =
                IndexMap::new();
            for rule in &rules {
                let placeholder_host = if rule.is_hover {
                    None
                } else {
                    placeholder_host_selector(&rule.selector)
                };
                if !rule.is_hover && placeholder_host.is_none() {
                    if let Some(pm) = PSEUDO_RULE_RE.captures(&rule.selector) {
                        let base = pm.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
                        mark_pseudo_analytic(doc, &pseudo_decls(rule), &base, &root_custom_props);
                        let after = PSEUDO_AFTER_RE.is_match(&rule.selector);
                        let merged = pseudo_merged.entry((base, after)).or_default();
                        for d in &rule.declarations {
                            let meta = DeclMeta {
                                important: d.important,
                                specificity: rule.specificity,
                                order: rule.order,
                                inline: false,
                            };
                            merge_pseudo_decl(merged, &pseudo_prop_key(&d.prop), &d.value, &meta);
                        }
                        continue;
                    }
                }
                let match_selector: Option<&str> = if rule.is_hover {
                    rule.match_selector.as_deref()
                } else if let Some(ref host) = placeholder_host {
                    Some(host.as_str())
                } else {
                    Some(rule.selector.as_str())
                };
                let Some(match_selector) = match_selector else {
                    continue;
                };
                let matched: Vec<NodeId> = match doc.compile(match_selector) {
                    Ok(_) => doc
                        .query_selector_all(match_selector)
                        .iter()
                        .map(|e| e.id())
                        .collect(),
                    Err(_) => {
                        profile::record(
                            profile,
                            Meta::new("selector-match", "unsupported-selector", file_path)
                                .with_detail(match_selector),
                        );
                        if !rule.is_hover
                            && rule
                                .declarations
                                .iter()
                                .any(|d| is_radius_property(&d.prop))
                        {
                            refused_radius_selectors.push(match_selector.to_string());
                        }
                        continue;
                    }
                };
                let store = if rule.is_hover {
                    &mut hover_specified
                } else if placeholder_host.is_some() {
                    &mut placeholder_specified
                } else {
                    &mut specified
                };
                for node in matched {
                    for decl in &rule.declarations {
                        // A `::placeholder` rule contributes its ink alone:
                        // the color, and the `opacity` that fades it.
                        if placeholder_host.is_some()
                            && !matches!(js::to_lower_case(&decl.prop).as_str(), "color" | "opacity")
                        {
                            continue;
                        }
                        let meta = DeclMeta {
                            important: decl.important,
                            specificity: rule.specificity,
                            order: rule.order,
                            inline: false,
                        };
                        apply_static_declaration(store, node, &decl.prop, &decl.value, &meta);
                    }
                }
            }

            // Then by element: the winners of every selector that names the
            // pseudo's geometry or paint, merged by the cascade's own
            // priority, so two selectors matching one element read as one.
            // The lookup is quiet, as the side-accent probes are: a base
            // selector the matcher refuses is not a parity record.
            let mut pseudo_by_node: IndexMap<(NodeId, bool), IndexMap<String, (String, DeclMeta)>> =
                IndexMap::new();
            for ((base, after), decls) in &pseudo_merged {
                if !names_pseudo_paint_or_geometry(decls) {
                    continue;
                }
                let Some(ids) = doc.select_ids_quiet(base) else {
                    continue;
                };
                for id in ids {
                    let merged = pseudo_by_node.entry((id, *after)).or_default();
                    for (key, (value, meta)) in decls {
                        put_pseudo_decl(merged, key, value, meta);
                    }
                }
            }
            // A rule naming only `content`, or only custom properties, is
            // matched against those elements alone, never looked up over
            // the document: one that turns the box on (`.enabled::before {
            // content: '' }`) or off, or sets the `--scrim` the paint reads
            // (`.dark::before { --scrim: rgba(0, 0, 0, 0.7) }`), from
            // another selector merges where it matches.
            let candidates: Vec<NodeId> = {
                let mut ids: Vec<NodeId> = pseudo_by_node.keys().map(|(id, _)| *id).collect();
                ids.dedup();
                ids
            };
            if !candidates.is_empty() {
                for ((base, after), decls) in &pseudo_merged {
                    if names_pseudo_paint_or_geometry(decls) || !completes_pseudo_elsewhere(decls) {
                        continue;
                    }
                    let Some(ids) = doc.matching_ids_quiet(base, &candidates) else {
                        continue;
                    };
                    for id in ids {
                        if let Some(merged) = pseudo_by_node.get_mut(&(id, *after)) {
                            for (key, (value, meta)) in decls {
                                put_pseudo_decl(merged, key, value, meta);
                            }
                        }
                    }
                }
            }
            // The merged declarations, by element, for the computed pass
            // to read against each element's own custom properties.
            let mut pseudo_paint: HashMap<NodeId, Vec<IndexMap<String, String>>> = HashMap::new();
            for ((id, _), decls) in &pseudo_by_node {
                let merged: IndexMap<String, String> = decls
                    .iter()
                    .map(|(k, (v, _))| (k.clone(), v.clone()))
                    .collect();
                pseudo_paint.entry(*id).or_default().push(merged);
            }

            let mut inline_order: i64 = rules.len() as i64 + 1;
            let inline_nodes: Vec<(NodeId, String)> = doc
                .all_elements()
                .iter()
                .filter_map(|el| {
                    el.get_attribute("style")
                        .filter(|s| !s.is_empty())
                        .map(|s| (el.id(), s.to_string()))
                })
                .collect();
            for (node, style_text) in inline_nodes {
                for decl in parse_static_style_attribute(&style_text, inline_order) {
                    let meta = DeclMeta {
                        important: decl.important,
                        specificity: [1, 0, 0],
                        order: decl.order,
                        inline: true,
                    };
                    apply_static_declaration(&mut specified, node, &decl.prop, &decl.value, &meta);
                }
                inline_order += 1000;
            }
            pseudo_paint
        },
    );

    profile::step(
        profile,
        Meta::new("cascade", "compute-styles", file_path),
        || {
            compute_styles(
                doc,
                &specified,
                &hover_specified,
                &placeholder_specified,
                &pseudo_paint,
            );
        },
    );
    mark_side_accent_radius_blind_spots(doc, &css.text, &specified, &refused_radius_selectors);
}

/// Whether a property sets a border radius, in CSS or camelCase spelling.
fn is_radius_property(prop: &str) -> bool {
    let key = prop.replace('-', "").to_ascii_lowercase();
    key.starts_with("border") && key.ends_with("radius")
}

static STATE_PSEUDO_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i):(?:hover|focus|focus-visible|focus-within|active)\b")
        .expect("STATE_PSEUDO_RE")
});
static CLASS_ID_TOKEN_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"[.#](?:\\.|[-_A-Za-z0-9])+").expect("CLASS_ID_TOKEN_RE"));

/// Record what the side-accent gate needs to fail safe on this page: which
/// elements an applied declaration gave a radius, and which elements a radius
/// the cascade could not apply may reach. The cascade skips rules nested in a
/// style rule, rules inside `@container` and unknown at-rules, and selectors
/// the matcher refuses; a radius there could round a card the cascade reads
/// as square, so the elements those selectors name keep their side accents.
/// A radius under the rounded threshold, one on a pseudo-element, and one
/// behind a hover or focus state cannot round the card at rest.
fn mark_side_accent_radius_blind_spots(
    doc: &mut StaticDocument,
    css_text: &str,
    specified: &SpecifiedStore<NodeId>,
    refused: &[String],
) {
    use impeccable_core::checks::css_scan::{pseudo_stripped_selector, CssHostIndex};
    use impeccable_core::checks::rules::SIDE_ACCENT_MIN_RADIUS_PX;

    let declared: Vec<NodeId> = specified
        .iter()
        .filter(|(_, props)| props.keys().any(|k| is_radius_property(k)))
        .map(|(node, _)| *node)
        .collect();
    for node in declared {
        doc.set_radius_declared(node);
    }

    let at_rest = |s: &str| !s.contains("::") && !s.contains('&') && !STATE_PSEUDO_RE.is_match(s);
    let mut selectors: Vec<String> = refused
        .iter()
        .filter(|s| at_rest(s))
        .map(|s| pseudo_stripped_selector(s))
        .collect();
    if css_text.contains("adius") {
        for rule in CssHostIndex::new(css_text).unapplied_radius_rules() {
            let could_round = rule.corners.to_corners().map_or(true, |c| {
                [c.top_left, c.top_right, c.bottom_right, c.bottom_left]
                    .iter()
                    .any(|v| *v >= SIDE_ACCENT_MIN_RADIUS_PX)
            });
            if !could_round {
                continue;
            }
            selectors.extend(
                rule.selectors
                    .iter()
                    .filter(|s| at_rest(s))
                    .map(|s| pseudo_stripped_selector(s)),
            );
        }
    }
    for selector in selectors {
        if selector.is_empty() {
            continue;
        }
        if let Some(ids) = doc.select_ids_quiet(&selector) {
            for id in ids {
                doc.set_radius_unseen(id);
            }
            continue;
        }
        // The matcher refuses the selector: name its element by the classes
        // and id of its last compound, or give up on every element.
        let compound = selector
            .rsplit(|c: char| c.is_whitespace() || matches!(c, '>' | '+' | '~'))
            .next()
            .unwrap_or("");
        let tokens: Vec<String> = CLASS_ID_TOKEN_RE
            .find_iter(compound)
            .map(|m| m.as_str().replace('\\', ""))
            .collect();
        if tokens.is_empty() {
            doc.set_radius_unseen_everywhere();
            continue;
        }
        let ids: Vec<NodeId> = doc
            .all_elements()
            .iter()
            .filter(|el| {
                tokens.iter().all(|t| match t.strip_prefix('.') {
                    Some(class) => el.class_name().split_whitespace().any(|c| c == class),
                    None => el.id_attr() == &t[1..],
                })
            })
            .map(|el| el.id())
            .collect();
        for id in ids {
            doc.set_radius_unseen(id);
        }
    }
}

static FONT_STYLESHEET_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)^(?:https?:)?//(?:fonts\.googleapis\.com|fonts\.bunny\.net|use\.typekit\.net|p\.typekit\.net|api\.fontshare\.com|fonts\.cdnfonts\.com|rsms\.me)/",
    )
    .expect("FONT_STYLESHEET_RE")
});

/// Whether the page links a stylesheet the static engine did not read: a
/// remote sheet (other than a font service, which carries no box rules) or a
/// local one it could not open. [`collect_static_css_text`] skips both.
pub fn has_unread_stylesheet(doc: &StaticDocument, file_dir: &Path) -> bool {
    let dir = file_dir.to_string_lossy().into_owned();
    doc.query_selector_all("link").iter().any(|link| {
        let rel = link.get_attribute("rel").unwrap_or("");
        let href = link.get_attribute("href").unwrap_or("");
        if !STYLESHEET_REL_RE.is_match(rel) || href.is_empty() {
            return false;
        }
        if REMOTE_HREF_RE.is_match(href) {
            return !FONT_STYLESHEET_RE.is_match(href);
        }
        !std::fs::metadata(resolve_linked_css_path(&dir, href))
            .map(|m| m.is_file())
            .unwrap_or(false)
    })
}

/// The `computeNode` walk over every `tag`-typed element, root children
/// first, parents before children (an explicit stack, so a deep DOM cannot
/// overflow the call stack).
fn compute_styles(
    doc: &mut StaticDocument,
    specified: &SpecifiedStore<NodeId>,
    hover_specified: &SpecifiedStore<NodeId>,
    placeholder_specified: &SpecifiedStore<NodeId>,
    pseudo_paint: &HashMap<NodeId, Vec<IndexMap<String, String>>>,
) {
    let mut computed: HashMap<NodeId, Rc<StyleValues>> = HashMap::new();
    let mut customs: HashMap<NodeId, Rc<CustomProps>> = HashMap::new();
    let empty_custom: Rc<CustomProps> = Rc::new(CustomProps::new());
    let empty_specified: IndexMap<String, SpecifiedDecl> = IndexMap::new();

    // (node, parent) in pre-order.
    let mut stack: Vec<(NodeId, Option<NodeId>)> = doc
        .root_elements()
        .iter()
        .rev()
        .filter(|e| e.is_plain_tag())
        .map(|e| (e.id(), None))
        .collect();
    let mut hover_out: Vec<(NodeId, StyleValues)> = Vec::new();
    let mut placeholder_out: Vec<(NodeId, StyleValues)> = Vec::new();

    while let Some((node, parent)) = stack.pop() {
        let parent_style: Option<Rc<StyleValues>> = parent.and_then(|p| computed.get(&p).cloned());
        let parent_custom: Rc<CustomProps> = parent
            .and_then(|p| customs.get(&p).cloned())
            .unwrap_or_else(|| empty_custom.clone());
        let specified_map = specified.get(&node).unwrap_or(&empty_specified);

        let mut custom_props: CustomProps = (*parent_custom).clone();
        for (prop, decl) in specified_map {
            if prop.starts_with("--") {
                let resolved = super::checks_shim::resolve_var_refs(&decl.value, &custom_props);
                custom_props.insert(prop.clone(), resolved);
            }
        }
        // The sampled path's pseudo marks (#560), read here against this
        // element's own custom properties, which the rule pre-pass did not
        // have: a `--scrim` set on the element, inherited, or inline wins
        // over the sheet's first declaration.
        if let Some(pseudos) = pseudo_paint.get(&node) {
            for decls in pseudos {
                mark_pseudo_paint(doc, decls, &[node], &custom_props);
            }
        }

        // Every property starts at its default; only an inherited property
        // the parent carries is overwritten here.
        let mut values: StyleValues = make_default_style();
        if let Some(ps) = parent_style.as_ref() {
            for (prop, _) in STATIC_DEFAULT_STYLE {
                if !is_static_inherited_prop(prop) {
                    continue;
                }
                if let Some(inherited) = ps.get(*prop) {
                    values.insert(prop.to_string(), inherited.clone());
                }
            }
        }
        // Minimal user-agent emphasis styles. Author declarations below
        // still win, including explicit normal/inherit resets.
        if doc.element(node).is_some_and(|el| matches!(el.tag_lower().as_str(), "em" | "i" | "cite" | "dfn" | "var" | "address")) {
            values.insert("fontStyle".to_string(), "italic".to_string());
        }
        let mut layers_unknown = false;
        for (prop, decl) in specified_map {
            if prop.starts_with("--") {
                continue;
            }
            let next = normalize_static_css_value(
                prop,
                &decl.value,
                &custom_props,
                parent_style.as_deref(),
                Some(&values),
            );
            let (next, unknown) = shorthand_slot_or_default(prop, next);
            layers_unknown |= unknown;
            values.insert(prop.clone(), next);
        }
        if layers_unknown {
            values.insert("backgroundLayersUnknown".to_string(), "1".to_string());
        }
        // Hover pass: color / backgroundColor only.
        if let Some(hover_map) = hover_specified.get(&node) {
            let mut hover_values: Option<StyleValues> = None;
            for prop in ["color", "backgroundColor"] {
                let Some(hover_decl) = hover_map.get(prop) else {
                    continue;
                };
                let resting = specified_map.get(prop).map(|d| &d.meta);
                if !compare_static_priority(resting, &hover_decl.meta) {
                    continue;
                }
                let next = normalize_static_css_value(
                    prop,
                    &hover_decl.value,
                    &custom_props,
                    parent_style.as_deref(),
                    Some(&values),
                );
                let (next, _) = shorthand_slot_or_default(prop, next);
                if values.get(prop).map(|s| s.as_str()) == Some(next.as_str()) {
                    continue;
                }
                let hv = hover_values.get_or_insert_with(|| values.clone());
                hv.insert(prop.to_string(), next);
            }
            if let Some(hv) = hover_values {
                hover_out.push((node, hv));
            }
        }

        if let Some(ph_map) = placeholder_specified.get(&node) {
            if let Some(color_decl) = ph_map.get("color") {
                let next = normalize_static_css_value(
                    "color",
                    &color_decl.value,
                    &custom_props,
                    Some(&values),
                    Some(&values),
                );
                let mut ph_style = StyleValues::default();
                ph_style.insert("color".to_string(), next);
                // The rule's own `opacity` fades the placeholder's ink
                // (`::placeholder { opacity: 0 }` hides it); the contrast
                // checks read it beside the color (#560).
                if let Some(opacity_decl) = ph_map.get("opacity") {
                    let next = normalize_static_css_value(
                        "opacity",
                        &opacity_decl.value,
                        &custom_props,
                        Some(&values),
                        Some(&values),
                    );
                    ph_style.insert("opacity".to_string(), next);
                }
                placeholder_out.push((node, ph_style));
            }
        }

        let style_rc = Rc::new(values);
        computed.insert(node, style_rc);
        customs.insert(node, Rc::new(custom_props));

        if let Some(el) = doc.element(node) {
            let children = el.children();
            for child in children.iter().rev() {
                stack.push((child.id(), Some(node)));
            }
        }
    }

    for (node, style) in computed {
        doc.set_style(
            node,
            Rc::try_unwrap(style).unwrap_or_else(|rc| (*rc).clone()),
        );
    }
    for (node, style) in hover_out {
        doc.set_hover_style(node, style);
    }
    for (node, style) in placeholder_out {
        doc.set_placeholder_style(node, style);
    }
}

/// `STATIC_DEFAULT_STYLE[prop]` lookup re-exported for the adapters.
pub fn default_value(prop: &str) -> Option<&'static str> {
    static_default_style(prop)
}
