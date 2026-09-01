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
    apply_static_declaration, collect_static_css_rules, compare_static_priority,
    is_static_inherited_prop, make_default_style, normalize_static_css_value,
    parse_static_style_attribute, static_default_style, CssRule, DeclMeta, SpecifiedDecl,
    SpecifiedStore, StyleValues, STATIC_DEFAULT_STYLE,
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
fn resolve_linked_css_path(file_dir: &str, href: &str) -> String {
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
) -> String {
    let mut style_texts: Vec<String> = Vec::new();
    let mut warned_missing_stylesheets: std::collections::HashSet<String> =
        std::collections::HashSet::new();
    for style_el in doc.query_selector_all("style") {
        style_texts.push(style_el.text_content());
    }
    let file_dir_str = file_dir.to_string_lossy().into_owned();
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
            Ok(bytes) => style_texts.push(String::from_utf8_lossy(&bytes).into_owned()),
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
    style_texts.join("\n")
}

static PSEUDO_RULE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        r"(?i)^(.+?){ws}*::?(?:before|after)$",
        ws = js::WS
    ))
    .expect("PSEUDO_RULE_RE")
});
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
    css_text: &str,
    profile: Option<&dyn ProfileSink>,
    file_path: &str,
) {
    let mut specified: SpecifiedStore<NodeId> = SpecifiedStore::new();
    let mut hover_specified: SpecifiedStore<NodeId> = SpecifiedStore::new();
    let root_custom_props = collect_css_custom_props(css_text);
    let rules = profile::step(
        profile,
        Meta::new("parse-css", "css-rules", file_path),
        || collect_static_css_rules(css_text),
    );

    profile::step(
        profile,
        Meta::new("selector-match", "css-selectors", file_path),
        || {
            for rule in &rules {
                if !rule.is_hover {
                    if let Some(pm) = PSEUDO_RULE_RE.captures(&rule.selector) {
                        let base = pm.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
                        mark_pseudo_rule(doc, rule, &base, &root_custom_props);
                        continue;
                    }
                }
                let match_selector: Option<&str> = if rule.is_hover {
                    rule.match_selector.as_deref()
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
                        continue;
                    }
                };
                let store = if rule.is_hover {
                    &mut hover_specified
                } else {
                    &mut specified
                };
                for node in matched {
                    for decl in &rule.declarations {
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
            compute_styles(doc, &specified, &hover_specified);
        },
    );
}

/// The `computeNode` walk over every `tag`-typed element, root children
/// first, parents before children (an explicit stack, so a deep DOM cannot
/// overflow the call stack).
fn compute_styles(
    doc: &mut StaticDocument,
    specified: &SpecifiedStore<NodeId>,
    hover_specified: &SpecifiedStore<NodeId>,
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

        let mut values: StyleValues = make_default_style();
        for (prop, default) in STATIC_DEFAULT_STYLE {
            let inherited = if is_static_inherited_prop(prop) {
                parent_style.as_ref().and_then(|ps| ps.get(*prop)).cloned()
            } else {
                None
            };
            values.insert(
                prop.to_string(),
                inherited.unwrap_or_else(|| default.to_string()),
            );
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
}

/// `STATIC_DEFAULT_STYLE[prop]` lookup re-exported for the adapters.
pub fn default_value(prop: &str) -> Option<&'static str> {
    static_default_style(prop)
}
