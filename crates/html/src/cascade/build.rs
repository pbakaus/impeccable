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
pub fn collect_static_css_text(
    doc: &StaticDocument,
    file_dir: &Path,
    profile: Option<&dyn ProfileSink>,
    file_path: &str,
    warn: Option<&dyn Fn(&str)>,
) -> StaticCss {
    let file_dir_str = file_dir.to_string_lossy().into_owned();
    let mut css = StaticCss {
        page_dir: file_dir_str.clone(),
        ..StaticCss::default()
    };
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
        push(&mut css, &style_el.text_content(), None);
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
                push(&mut css, &String::from_utf8_lossy(&bytes), foreign_dir);
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
    css
}

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
static WS_SPLIT_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(&format!("{}+", js::WS)).expect("WS_SPLIT_RE"));
static GRADIENT_RE: Lazy<Regex> = Lazy::new(|| Regex::new("(?i)gradient").expect("GRADIENT_RE"));

fn resolve_root(raw: &str, root: &impeccable_core::checks::css_scan::CustomProps) -> String {
    let lookup = |name: &str| root.get(name).cloned();
    measures::resolve_var_refs(raw, &lookup, 0)
}

/// The `::before` / `::after` rule pre-pass: mark base-selector matches whose
/// pseudo paints a short chromatic dash (`setAccentDashPseudo`) or a
/// full-cover opaque surface (`setPseudoSurface`).
fn mark_pseudo_rule(
    doc: &mut StaticDocument,
    rule: &CssRule,
    base_selector: &str,
    root_custom_props: &impeccable_core::checks::css_scan::CustomProps,
) {
    let mut decls: IndexMap<String, String> = IndexMap::new();
    for d in &rule.declarations {
        decls.insert(js::to_lower_case(&d.prop), d.value.clone());
    }
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
    let pseudo_pos = js::to_lower_case(get("position").unwrap_or(""));
    if pseudo_pos == "absolute" || pseudo_pos == "fixed" {
        let zero_len = |v: Option<&str>| v.is_some_and(|s| ZERO_LEN_RE.is_match(js::trim(s)));
        let inset_raw = js::trim(get("inset").unwrap_or(""));
        let covers_box = (!inset_raw.is_empty()
            && WS_SPLIT_RE
                .split(inset_raw)
                .all(|t| ZERO_LEN_RE.is_match(t)))
            || ["top", "right", "bottom", "left"]
                .iter()
                .all(|side| zero_len(get(side)))
            || (js::trim(get("width").unwrap_or("")) == "100%"
                && js::trim(get("height").unwrap_or("")) == "100%");
        // A pseudo stretched over its element and painting a raster image is a
        // picture under that element's content: the hero photo written as
        // `.hero::before { position: absolute; inset: 0; background: url() }`.
        // The contrast pass stands down over it, as it does over an `<img>`.
        if covers_box
            && decls.contains_key("content")
            && js::to_lower_case(&first_of("background-image", "background")).contains("url(")
        {
            let ids: Vec<NodeId> = doc
                .query_selector_all(base_selector)
                .iter()
                .map(|e| e.id())
                .collect();
            for id in ids {
                doc.set_pseudo_picture(id);
            }
        }
        if covers_box && decls.contains_key("content") {
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

    profile::step(
        profile,
        Meta::new("selector-match", "css-selectors", file_path),
        || {
            for rule in &rules {
                let placeholder_host = if rule.is_hover {
                    None
                } else {
                    placeholder_host_selector(&rule.selector)
                };
                if !rule.is_hover && placeholder_host.is_none() {
                    if let Some(pm) = PSEUDO_RULE_RE.captures(&rule.selector) {
                        let base = pm.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
                        mark_pseudo_rule(doc, rule, &base, &root_custom_props);
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
                        if placeholder_host.is_some()
                            && js::to_lower_case(&decl.prop) != "color"
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
        },
    );

    profile::step(
        profile,
        Meta::new("cascade", "compute-styles", file_path),
        || {
            compute_styles(doc, &specified, &hover_specified, &placeholder_specified);
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
            values.insert(prop.clone(), next);
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
