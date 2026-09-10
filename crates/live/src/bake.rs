//! Mechanical bake of an accepted generate-lane variant. The lane's variants
//! carry no knobs, so what accept leaves behind (the chosen variant inside
//! its `data-impeccable-variant` div, and every variant's CSS in one
//! `<style data-impeccable-css>` block) can be made permanent without an
//! agent: the chosen variant's rules are rewritten from `:scope` to the
//! element's own selector and appended to the stylesheet that already styles
//! it, and the wrapper is unwrapped in source. Anything the rewrite cannot
//! decide mechanically (knobs, plumbing inside the variant, no stylesheet,
//! no stable selector) refuses, and accept falls back to the carbonize
//! block the agent bakes by hand.

use crate::accept_css::{parse_stylesheet, serialize_nodes, split_selector_list, CssNode};
use crate::accept_verify::verify_accepted_source;
use crate::source_search::{is_generated_file, read_dir_sorted, NEVER_SOURCE_DIRS};
use crate::util::jsp;
use impeccable_core::js::trim;
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{json, Map, Value};

/// Directories a stylesheet search never enters (build output, caches, the
/// framework's own trees).
const SKIP_DIRS: [&str; 12] = [
    "dist", "build", "coverage", ".next", ".nuxt", ".svelte-kit", ".astro", ".turbo", ".vercel", ".cache",
    "out", "storybook-static",
];
const MAX_DEPTH: usize = 6;
const MAX_FILES: usize = 4000;

/// A bake that is ready to write.
#[derive(Debug)]
pub struct BakePlan {
    /// The stylesheet the rules go to (absolute), or None when they go into
    /// the source file's own `<style>` block.
    pub css_file: Option<String>,
    /// The rules, rewritten to the element's real selectors.
    pub css: String,
    /// The element's own selector the rewrite anchored on.
    pub anchor: String,
    /// The accepted variant's lines, at the wrapper's indentation.
    pub restored: Vec<String>,
    pub rules: usize,
}

static ROOT_TAG_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?s)<([A-Za-z][A-Za-z0-9.-]*)((?:\s+[^<>]*?)?)>").unwrap());
static ATTR_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?:^|\s)(id|class|className)\s*=\s*(?:"([^"]*)"|'([^']*)')"#).unwrap());
static SCOPE_PRELUDE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"data-impeccable-variant\s*=\s*["']?(\d+)["']?"#).unwrap());
static VARIANT_PREFIX_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"^\[data-impeccable-variant\s*=\s*["']?\d+["']?\]"#).unwrap());

/// The variant's root tag as written in source: `div`, `my-card`,
/// `PricingGrid`, `Card.Root`.
pub fn root_tag(restored: &[String]) -> Option<String> {
    let text = restored.join("\n");
    ROOT_TAG_RE.captures(&text).map(|c| c[1].to_string())
}

/// Whether a root tag names an element of the rendered page: a lowercase
/// name (custom elements included). A component (`PricingGrid`,
/// `Card.Root`) renders whatever it likes, and its `className` or `id`
/// prop may never reach that element.
pub fn is_element_tag(tag: &str) -> bool {
    tag.chars().next().map(|c| c.is_ascii_lowercase()).unwrap_or(false) && !tag.contains('.')
}

/// The variant's root element, as `#id` or `tag.class.class`: the selector
/// every `:scope` rule is rewritten against. None when the root is a
/// component (what it renders is unknown, so nothing mechanical can anchor
/// on it) or when neither an id nor a static class is on the tag (a JSX
/// expression, a bare `<section>`).
pub fn element_anchor(restored: &[String]) -> Option<String> {
    let text = restored.join("\n");
    let caps = ROOT_TAG_RE.captures(&text)?;
    let raw_tag = &caps[1];
    if !is_element_tag(raw_tag) {
        return None;
    }
    let tag = raw_tag.to_ascii_lowercase();
    let attrs = caps.get(2).map(|m| m.as_str()).unwrap_or("");
    let mut id: Option<String> = None;
    let mut classes: Vec<String> = Vec::new();
    for a in ATTR_RE.captures_iter(attrs) {
        let value = a.get(2).or_else(|| a.get(3)).map(|m| m.as_str()).unwrap_or("");
        match &a[1] {
            "id" => {
                if !value.trim().is_empty() {
                    id = Some(value.trim().to_string());
                }
            }
            _ => classes.extend(value.split_whitespace().map(str::to_string)),
        }
    }
    if let Some(id) = id {
        if is_css_ident(&id) {
            return Some(format!("#{}", id));
        }
    }
    let classes: Vec<String> = classes.into_iter().filter(|c| is_css_ident(c)).collect();
    if classes.is_empty() {
        return None;
    }
    Some(format!("{}.{}", tag, classes.join(".")))
}

fn is_css_ident(s: &str) -> bool {
    !s.is_empty()
        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        && !s.starts_with(|c: char| c.is_ascii_digit())
}

/// The first compound selector of `s` and what follows it (the following
/// combinator or whitespace included), honouring brackets, parens, and
/// quotes. `(s, "")` when there is no combinator.
fn split_first_compound(s: &str) -> (String, String) {
    let chars: Vec<char> = s.chars().collect();
    let mut depth = 0i64;
    let mut quote: Option<char> = None;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if let Some(q) = quote {
            if c == '\\' {
                i += 1;
            } else if c == q {
                quote = None;
            }
        } else if c == '"' || c == '\'' {
            quote = Some(c);
        } else if c == '[' || c == '(' {
            depth += 1;
        } else if c == ']' || c == ')' {
            depth -= 1;
        } else if depth == 0 && (c.is_whitespace() || c == '>' || c == '+' || c == '~') {
            break;
        }
        i += 1;
    }
    (chars[..i].iter().collect(), chars[i..].iter().collect())
}

/// One selector out of a `:scope` (or `[data-impeccable-variant="N"]`)
/// prefixed rule, anchored on the element. A state on the wrapper
/// (`:scope:hover`, `:scope[open]`) lands on the element, which is the
/// wrapper's only child and takes its place after the unwrap. Err when
/// `:scope` survives or the rewrite has no meaning.
pub fn rewrite_selector(selector: &str, anchor: &str) -> Result<String, String> {
    let s = trim(selector).to_string();
    let s = VARIANT_PREFIX_RE.replace(&s, ":scope").into_owned();
    let out = if let Some(rest) = s.strip_prefix(":scope") {
        // Pseudo-classes and attribute selectors written on :scope itself.
        let (state, after) = split_first_compound(rest);
        let after_trim = after.trim_start();
        if after_trim.is_empty() {
            format!("{}{}", anchor, state)
        } else if let Some(child) = after_trim.strip_prefix('>') {
            // `:scope > .x`, `:scope:hover > .x`: the wrapper's child is the
            // element itself, so the wrapper's state is the element's.
            let (first, remainder) = split_first_compound(child.trim_start());
            if first.is_empty() {
                return Err(format!("selector has no child after :scope: {}", selector));
            }
            format!("{}{}{}", first, state, remainder)
        } else if after_trim.starts_with(['+', '~']) {
            return Err(format!("sibling combinator on :scope has no meaning after unwrap: {}", selector));
        } else {
            // `:scope .x`, `:scope:hover .x`: a descendant of the element.
            format!("{}{} {}", anchor, state, after_trim)
        }
    } else {
        s
    };
    if out.contains(":scope") || out.contains("data-impeccable") {
        return Err(format!("selector still names the preview wrapper: {}", selector));
    }
    if trim(&out).is_empty() {
        return Err(format!("selector rewrote to nothing: {}", selector));
    }
    Ok(trim(&out).to_string())
}

fn rewrite_nodes(nodes: &[CssNode], anchor: &str, out: &mut Vec<CssNode>, rules: &mut usize) -> Result<(), String> {
    for node in nodes {
        match node {
            CssNode::Comment { .. } => {}
            CssNode::Rule { prelude, body } => {
                let rewritten: Result<Vec<String>, String> =
                    split_selector_list(prelude).iter().map(|sel| rewrite_selector(sel, anchor)).collect();
                let selectors = rewritten?;
                if selectors.is_empty() {
                    continue;
                }
                out.push(CssNode::Rule { prelude: selectors.join(", "), body: body.clone() });
                *rules += 1;
            }
            CssNode::At { name, prelude, children: Some(children), .. } => {
                if name == "scope" {
                    return Err("nested @scope inside a variant block".to_string());
                }
                let mut inner = Vec::new();
                rewrite_nodes(children, anchor, &mut inner, rules)?;
                if !inner.is_empty() {
                    out.push(CssNode::At {
                        name: name.clone(),
                        prelude: prelude.clone(),
                        children: Some(inner),
                        body: None,
                        statement: false,
                    });
                }
            }
            other => out.push(other.clone()),
        }
    }
    Ok(())
}

/// A rule outside any `@scope`: Astro's global-prefixed mode writes
/// `[data-impeccable-variant="N"] > .x`. Ours are rewritten, other
/// variants' are dropped (None), plain rules are kept as they are.
fn global_rule(prelude: &str, body: &str, variant_num: &str, anchor: &str) -> Result<Option<CssNode>, String> {
    let selectors = split_selector_list(prelude);
    let mine: Vec<String> = selectors
        .iter()
        .filter(|sel| SCOPE_PRELUDE_RE.captures(sel).map(|c| &c[1] == variant_num).unwrap_or(false))
        .cloned()
        .collect();
    if mine.is_empty() {
        if prelude.contains("data-impeccable-variant") {
            return Ok(None);
        }
        return Ok(Some(CssNode::Rule { prelude: prelude.to_string(), body: body.to_string() }));
    }
    let rewritten: Result<Vec<String>, String> = mine.iter().map(|sel| rewrite_selector(sel, anchor)).collect();
    Ok(Some(CssNode::Rule { prelude: rewritten?.join(", "), body: body.to_string() }))
}

/// Nodes outside any `@scope` (the top level, or an `@media` / `@supports`
/// block at the top level): the accepted variant's `@scope` block is
/// flattened and rewritten, prefixed rules go through `global_rule`,
/// nested blocks recurse, and global at-rules (`@keyframes`, `@font-face`)
/// are kept.
fn global_nodes(nodes: &[CssNode], variant_num: &str, anchor: &str, out: &mut Vec<CssNode>, rules: &mut usize) -> Result<(), String> {
    for node in nodes {
        match node {
            CssNode::At { name, prelude, children: Some(children), .. } if name == "scope" => {
                let Some(caps) = SCOPE_PRELUDE_RE.captures(prelude) else {
                    return Err(format!("@scope block without a variant prelude: {}", prelude));
                };
                if &caps[1] == variant_num {
                    rewrite_nodes(children, anchor, out, rules)?;
                }
            }
            CssNode::Rule { prelude, body } => {
                if let Some(rule) = global_rule(prelude, body, variant_num, anchor)? {
                    out.push(rule);
                    *rules += 1;
                }
            }
            CssNode::At { name, prelude, children: Some(children), .. } => {
                let mut inner = Vec::new();
                let mut inner_rules = 0usize;
                global_nodes(children, variant_num, anchor, &mut inner, &mut inner_rules)?;
                if !inner.is_empty() {
                    out.push(CssNode::At {
                        name: name.clone(),
                        prelude: prelude.clone(),
                        children: Some(inner),
                        body: None,
                        statement: false,
                    });
                    *rules += inner_rules;
                }
            }
            other => out.push(other.clone()),
        }
    }
    Ok(())
}

/// The accepted variant's rules out of the whole preview stylesheet: its
/// `@scope ([data-impeccable-variant="N"])` block rewritten and flattened,
/// its prefixed rules rewritten wherever they sit, global at-rules
/// (`@keyframes`, `@font-face`) kept, the other variants' rules dropped.
pub fn extract_variant_css(css: &str, variant_num: &str, anchor: &str) -> Result<(String, usize), String> {
    let nodes = parse_stylesheet(css);
    let mut kept: Vec<CssNode> = Vec::new();
    let mut rules = 0usize;
    global_nodes(&nodes, variant_num, anchor, &mut kept, &mut rules)?;
    if rules == 0 {
        return Err("the accepted variant declares no rules".to_string());
    }
    let text = serialize_nodes(&kept, "");
    if text.contains("data-impeccable") || text.contains(":scope") {
        return Err("rewritten CSS still names the preview wrapper".to_string());
    }
    Ok((text, rules))
}

static SELECTOR_TOKEN_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"[#.][A-Za-z_][A-Za-z0-9_-]*").unwrap());

/// The stylesheet that already styles the element: the `.css` file under
/// the app root with the most rules naming the anchor's id or classes, the
/// only `.css` file when there is exactly one, else none.
pub fn find_owning_stylesheet(cwd: &str, anchor: &str) -> Option<String> {
    let tokens: Vec<String> = SELECTOR_TOKEN_RE.find_iter(anchor).map(|m| m.as_str().to_string()).collect();
    let mut files: Vec<String> = Vec::new();
    walk_css(cwd, 0, &mut files);
    let mut scored: Vec<(usize, usize, String)> = Vec::new();
    for f in &files {
        if is_generated_file(f, cwd) {
            continue;
        }
        let Some(text) = crate::util::safe_read(f) else { continue };
        let mut score = 0usize;
        for t in &tokens {
            // No lookaround in this regex engine: the character after the
            // token is consumed, which is fine for a count.
            let re = Regex::new(&format!(r"(?:^|[\s,>+~{{}}\)]){}(?:[^A-Za-z0-9_-]|$)", regex::escape(t))).ok();
            if let Some(re) = re {
                score += re.find_iter(&text).count();
            }
        }
        scored.push((score, f.len(), f.clone()));
    }
    if scored.is_empty() {
        return None;
    }
    scored.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    let best = &scored[0];
    if best.0 > 0 || scored.len() == 1 {
        return Some(best.2.clone());
    }
    None
}

fn walk_css(dir: &str, depth: usize, out: &mut Vec<String>) {
    if depth > MAX_DEPTH || out.len() >= MAX_FILES {
        return;
    }
    let Some(entries) = read_dir_sorted(dir) else { return };
    for e in entries {
        if e.is_dir {
            if NEVER_SOURCE_DIRS.contains(&e.name.as_str())
                || SKIP_DIRS.contains(&e.name.as_str())
                || (e.name.starts_with('.') && e.name != ".")
            {
                continue;
            }
            walk_css(&jsp::join(&[dir, &e.name]), depth + 1, out);
        } else if e.is_file && e.name.to_ascii_lowercase().ends_with(".css") && !e.name.ends_with(".min.css") {
            out.push(jsp::join(&[dir, &e.name]));
        }
    }
}

static HTML_STYLE_BLOCK_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?s)<style(\b[^>]*)>(.*?)</style>").unwrap());

/// Plan the bake, or say why it is not mechanical. `css_lines` is the whole
/// preview stylesheet (JSX template wrap already stripped), `restored` the
/// accepted variant at the wrapper's indentation, `source_after_unwrap` the
/// source file with the variant unwrapped (to find its own `<style>` block
/// when the file is HTML-like).
pub fn plan(
    cwd: &str,
    target_file: &str,
    is_jsx: bool,
    variant_num: &str,
    css_lines: Option<&[String]>,
    restored: &[String],
    param_values: Option<&Map<String, Value>>,
    source_after_unwrap: &str,
) -> Result<BakePlan, String> {
    if param_values.map(|p| !p.is_empty()).unwrap_or(false) {
        return Err("the session has knobs (paramValues); knob baking needs the agent".into());
    }
    let variant_text = restored.join("\n");
    if variant_text.contains("data-impeccable-") || variant_text.contains("data-p-") {
        return Err("the accepted variant carries preview plumbing inside it".into());
    }
    let Some(css_lines) = css_lines else {
        return Err("no preview stylesheet to bake".into());
    };
    let css = css_lines.join("\n");
    if css.contains("var(--p-") || css.contains("data-p-") || css.contains("data-impeccable-params") {
        return Err("the preview CSS is authored against knobs".into());
    }
    let anchor = element_anchor(restored).ok_or_else(|| match root_tag(restored) {
        Some(tag) if !is_element_tag(&tag) => format!(
            "the variant's root is the component <{}>; what it renders is unknown, so no selector can anchor on it",
            tag
        ),
        _ => "the variant's root tag has no id or static class to anchor selectors on".to_string(),
    })?;
    let (rules_css, rules) = extract_variant_css(&css, variant_num, &anchor)?;
    let css_file = if is_jsx {
        Some(find_owning_stylesheet(cwd, &anchor).ok_or_else(|| "no stylesheet under the app root names the element".to_string())?)
    } else if HTML_STYLE_BLOCK_RE.captures_iter(source_after_unwrap).any(|c| !c[1].contains("data-impeccable")) {
        None
    } else {
        Some(find_owning_stylesheet(cwd, &anchor).ok_or_else(|| "no stylesheet names the element and the page has no <style> block".to_string())?)
    };
    let _ = target_file;
    Ok(BakePlan { css_file, css: rules_css, anchor, restored: restored.to_vec(), rules })
}

/// The block appended to the stylesheet: a one-line provenance comment and
/// the rewritten rules.
pub fn appended_block(plan: &BakePlan, session_id: &str, variant_num: &str) -> String {
    format!(
        "\n/* impeccable generate {}: accepted variant {} */\n{}\n",
        session_id, variant_num, plan.css
    )
}

/// Write the bake: the stylesheet (or the page's last own `<style>` block)
/// gets the rules, the source file gets the unwrapped variant. The source
/// is verified clean before anything is written.
pub fn apply(
    plan: &BakePlan,
    session_id: &str,
    variant_num: &str,
    target_file: &str,
    source_after_unwrap: &str,
) -> Result<Value, String> {
    let block = appended_block(plan, session_id, variant_num);
    let source_text = match &plan.css_file {
        Some(_) => source_after_unwrap.to_string(),
        None => {
            // Into the last <style> block that is the page's own.
            let mut last: Option<(usize, usize)> = None;
            for c in HTML_STYLE_BLOCK_RE.captures_iter(source_after_unwrap) {
                if !c[1].contains("data-impeccable") {
                    let inner = c.get(2).unwrap();
                    last = Some((inner.start(), inner.end()));
                }
            }
            let (_, end) = last.ok_or_else(|| "the page's <style> block disappeared".to_string())?;
            format!("{}{}{}", &source_after_unwrap[..end], block, &source_after_unwrap[end..])
        }
    };
    let (clean, findings) = verify_accepted_source(&source_text);
    if !clean {
        return Err(format!(
            "the baked source would still carry live-mode leftovers: {}",
            findings.iter().filter_map(|f| f.get("why").and_then(Value::as_str)).collect::<Vec<_>>().join("; ")
        ));
    }
    if let Some(css_file) = &plan.css_file {
        let existing = crate::util::safe_read(css_file).unwrap_or_default();
        let joined = if existing.ends_with('\n') || existing.is_empty() {
            format!("{}{}", existing, block.trim_start_matches('\n'))
        } else {
            format!("{}\n{}", existing, block.trim_start_matches('\n'))
        };
        std::fs::write(css_file, joined).map_err(|e| format!("could not write {}: {}", css_file, e))?;
    }
    std::fs::write(target_file, source_text).map_err(|e| format!("could not write {}: {}", target_file, e))?;
    Ok(json!({ "rules": plan.rules, "anchor": plan.anchor }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scope_selectors_rewrite_onto_the_element() {
        let a = "div.pricing-grid";
        assert_eq!(rewrite_selector(":scope > .pricing-grid", a).unwrap(), ".pricing-grid");
        assert_eq!(rewrite_selector(":scope > .pricing-grid .pricing-card", a).unwrap(), ".pricing-grid .pricing-card");
        assert_eq!(rewrite_selector(":scope .pricing-card", a).unwrap(), "div.pricing-grid .pricing-card");
        assert_eq!(rewrite_selector(":scope", a).unwrap(), "div.pricing-grid");
        assert_eq!(rewrite_selector(":scope:hover > .pricing-grid", a).unwrap(), ".pricing-grid:hover");
        assert_eq!(rewrite_selector(":scope:focus-within > .pricing-grid .card", a).unwrap(), ".pricing-grid:focus-within .card");
        assert_eq!(rewrite_selector(":scope[open] > .pricing-grid > .card", a).unwrap(), ".pricing-grid[open] > .card");
        assert_eq!(rewrite_selector(":scope:hover .card", a).unwrap(), "div.pricing-grid:hover .card");
        assert_eq!(rewrite_selector(":scope:not([hidden])", a).unwrap(), "div.pricing-grid:not([hidden])");
        assert!(rewrite_selector(":scope:hover >", a).is_err());
        assert_eq!(rewrite_selector("[data-impeccable-variant=\"2\"] > .x", a).unwrap(), ".x");
        assert!(rewrite_selector(":scope + .x", a).is_err());
        assert!(rewrite_selector(".a :scope", a).is_err());
    }

    #[test]
    fn the_anchor_comes_from_the_root_tag() {
        assert_eq!(element_anchor(&["<div className=\"pricing-grid wide\">".into(), "</div>".into()]), Some("div.pricing-grid.wide".into()));
        assert_eq!(element_anchor(&["<section id=\"pricing\" class=\"pricing\">".into()]), Some("#pricing".into()));
        assert_eq!(element_anchor(&["<section className={cls}>".into()]), None);
        assert_eq!(element_anchor(&["  <h1 class='hero-heading'>Hi</h1>".into()]), Some("h1.hero-heading".into()));
        // A component root renders an unknown element: its className or id
        // prop may never reach it, so nothing anchors on it.
        assert_eq!(element_anchor(&["<PricingGrid className=\"pricing-grid wide\">".into()]), None);
        assert_eq!(element_anchor(&["<Card.Root className=\"card\">".into()]), None);
        assert_eq!(element_anchor(&["<PricingGrid id=\"pricing\">".into()]), None);
        assert_eq!(element_anchor(&["<my-card class=\"card\">".into()]), Some("my-card.card".into()));
        assert_eq!(root_tag(&["<Card.Root className=\"card\">".into()]), Some("Card.Root".into()));
        assert!(is_element_tag("my-card") && !is_element_tag("PricingGrid") && !is_element_tag("Card.Root"));
    }

    #[test]
    fn only_the_accepted_variants_block_survives_rewritten() {
        let css = r#"
@scope ([data-impeccable-variant="1"]) { :scope > .pricing-grid { gap: 8px; } }
@scope ([data-impeccable-variant="2"]) {
  :scope > .pricing-grid { gap: 32px; }
  :scope .pricing-card { border: 2px solid #111; }
  @media (max-width: 600px) { :scope > .pricing-grid { gap: 12px; } }
}
@keyframes rise { from { opacity: 0 } to { opacity: 1 } }
@scope ([data-impeccable-variant="3"]) { :scope > .pricing-grid { gap: 0; } }
"#;
        let (out, rules) = extract_variant_css(css, "2", "div.pricing-grid").unwrap();
        assert_eq!(rules, 3, "{out}");
        assert!(out.contains(".pricing-grid { gap: 32px; }"), "{out}");
        assert!(out.contains("div.pricing-grid .pricing-card { border: 2px solid #111; }"), "{out}");
        assert!(out.contains("@media (max-width: 600px)"), "{out}");
        assert!(out.contains("@keyframes rise"), "{out}");
        assert!(!out.contains("8px") && !out.contains("gap: 0"), "{out}");
        assert!(!out.contains("data-impeccable") && !out.contains(":scope"), "{out}");
    }

    #[test]
    fn prefixed_rules_under_a_top_level_media_block_are_rewritten_not_dropped() {
        // Astro's global-prefixed mode, with a breakpoint.
        let css = r#"
[data-impeccable-variant="1"] > .pricing-grid { gap: 8px; }
[data-impeccable-variant="2"] > .pricing-grid { gap: 32px; }
@media (max-width: 600px) {
  [data-impeccable-variant="1"] > .pricing-grid { gap: 4px; }
  [data-impeccable-variant="2"] > .pricing-grid { gap: 12px; }
  [data-impeccable-variant="2"]:hover > .pricing-grid .card { border-color: #111; }
  .site-wide { color: red; }
}
"#;
        let (out, rules) = extract_variant_css(css, "2", "div.pricing-grid").unwrap();
        assert_eq!(rules, 4, "{out}");
        assert!(out.contains("@media (max-width: 600px)"), "{out}");
        assert!(out.contains("gap: 12px"), "the variant's breakpoint survives: {out}");
        assert!(out.contains(".pricing-grid:hover .card { border-color: #111; }"), "{out}");
        assert!(out.contains(".site-wide { color: red; }"), "{out}");
        assert!(!out.contains("8px") && !out.contains("4px"), "the other variant's rules are gone: {out}");
        assert!(!out.contains("data-impeccable"), "{out}");
    }

    #[test]
    fn knobs_and_plumbing_refuse_the_bake() {
        let restored = vec!["<div className=\"pricing-grid\">".to_string(), "</div>".to_string()];
        let css = vec!["@scope ([data-impeccable-variant=\"1\"]) { :scope > .pricing-grid { gap: var(--p-gap, 8px); } }".to_string()];
        let err = plan("/nonexistent", "src/App.jsx", true, "1", Some(&css), &restored, None, "").unwrap_err();
        assert!(err.contains("knobs"), "{err}");
        let mut pv = Map::new();
        pv.insert("gap".into(), json!(1));
        let err = plan("/nonexistent", "src/App.jsx", true, "1", Some(&css), &restored, Some(&pv), "").unwrap_err();
        assert!(err.contains("paramValues"), "{err}");
        let plumbing = vec!["<div className=\"pricing-grid\" data-impeccable-x=\"1\">".to_string()];
        let err = plan("/nonexistent", "src/App.jsx", true, "1", Some(&css), &plumbing, None, "").unwrap_err();
        assert!(err.contains("plumbing"), "{err}");
        // A component root: its className prop may never reach the rendered element.
        let plain = vec!["@scope ([data-impeccable-variant=\"1\"]) { :scope { gap: 8px; } }".to_string()];
        let component = vec!["<PricingGrid className=\"pricing-grid\">".to_string(), "</PricingGrid>".to_string()];
        let err = plan("/nonexistent", "src/App.jsx", true, "1", Some(&plain), &component, None, "").unwrap_err();
        assert!(err.contains("component <PricingGrid>"), "{err}");
    }

    #[test]
    fn the_owning_stylesheet_is_the_one_naming_the_element() {
        let dir = std::env::temp_dir().join(format!("impeccable-bake-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("src")).unwrap();
        std::fs::create_dir_all(dir.join("node_modules/x")).unwrap();
        std::fs::write(dir.join("src/reset.css"), "* { margin: 0 }").unwrap();
        std::fs::write(dir.join("src/styles.css"), ".pricing-grid { display: grid }\n.pricing-card { padding: 1px }").unwrap();
        std::fs::write(dir.join("node_modules/x/x.css"), ".pricing-grid { color: red }").unwrap();
        let cwd = dir.to_string_lossy().into_owned();
        let found = jsp::to_posix(&find_owning_stylesheet(&cwd, "div.pricing-grid").unwrap());
        assert!(found.ends_with("src/styles.css"), "{found}");
        assert_eq!(find_owning_stylesheet(&cwd, "div.nothing-here"), None);
        std::fs::remove_file(dir.join("src/styles.css")).unwrap();
        // One stylesheet in the app: it is the one.
        let only = jsp::to_posix(&find_owning_stylesheet(&cwd, "div.nothing-here").unwrap());
        assert!(only.ends_with("src/reset.css"), "{only}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
