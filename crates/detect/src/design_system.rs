//! Port of `cli/engine/design-system.mjs`: DESIGN.md discovery (walk-up with
//! project boundaries), the frontmatter YAML subset, sidecar parsing, the
//! normalized allowlists, the source-scan design-system rules, and the
//! finding merge/dedupe helpers.
//!
//! The DOM-backed `collectStaticDesignSystemFindings` lives with the static
//! HTML engine (crates/html); it builds on the `pub` helpers here
//! (`primary_font`, `is_allowed_*`, `css_color_label`, `extract_radius_tokens`,
//! `make_design_finding`, `is_transparent_css`, `STATIC_DESIGN_SKIP_TAGS`), so
//! the html crate depends on this crate, never the reverse.

use std::collections::HashMap;
use std::rc::Rc;

use impeccable_core::checks::measures::resolve_length_px;
use impeccable_core::color::{parse_any_color, Rgba};
use impeccable_core::constants::GENERIC_FONTS;
use impeccable_core::findings::{finding, Finding};
use impeccable_core::js::{self, ci, math_round, number_to_string, parse_float, parse_int};
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{Map, Value};

use crate::jsp;
use crate::util::{exists, js_string, re, read_json, read_text, ANY, WS};

const DESIGN_NAMES: &[&str] = &["DESIGN.md", "Design.md", "design.md"];
const FALLBACK_DIRS: &[&str] = &[".agents/context", "docs"];
const PROJECT_ROOT_MARKERS: &[&str] = &[".git", "package.json", ".impeccable"];
const COLOR_CHANNEL_TOLERANCE: f64 = 6.0;
const SHADOW_ALPHA_TOLERANCE: f64 = 0.02;
const RADIUS_TOLERANCE_PX: f64 = 0.5;
const FONT_SIZE_TOLERANCE_PX: f64 = 0.5;

/// JS `STATIC_DESIGN_SKIP_TAGS`.
pub const STATIC_DESIGN_SKIP_TAGS: &[&str] = &[
    "head", "title", "meta", "link", "style", "script", "noscript", "template", "source",
];

re!(
    FONT_SIZE_LITERAL_RE,
    format!("^-?[{D}.]+(?:px|rem)$", D = "0-9")
);
re!(
    CSS_COLOR_RE,
    format!(
        "#[0-9a-fA-F]{{3,8}}(?-u:\\b)|{rgb}[aA]?\\([^)]+\\)|{oklch}\\([^)]+\\)|{hsl}[aA]?\\([^)]+\\)",
        rgb = ci("rgb"),
        oklch = ci("oklch"),
        hsl = ci("hsl")
    )
);
re!(
    FONT_DECL_RE,
    format!("{}{WS}*:{WS}*([^;}}\n]+)", ci("font-family"))
);
re!(
    FONT_JS_RE,
    format!("fontFamily{WS}*[:=]{WS}*[\"'`]([^\"'`]+)[\"'`]")
);
re!(
    GOOGLE_FONT_RE,
    format!(
        "{}\\.{}\\.{}/{}2?\\?[^\"'{}){}<>]*",
        ci("fonts"),
        ci("googleapis"),
        ci("com"),
        ci("css"),
        impeccable_core::js::WS_CHARS,
        ""
    )
);
re!(
    BORDER_RADIUS_RE,
    format!("{}{WS}*:{WS}*([^;}}\n]+)", ci("border-radius"))
);
re!(
    BORDER_RADIUS_JS_RE,
    format!("borderRadius{WS}*[:=]{WS}*[\"'`]([^\"'`]+)[\"'`]")
);
re!(
    FONT_SIZE_DECL_RE,
    format!("{}{WS}*:{WS}*([^;}}\n]+)", ci("font-size"))
);
re!(
    FONT_SIZE_JS_RE,
    format!("fontSize{WS}*[:=]{WS}*[\"'`]([^\"'`]+)[\"'`]")
);
re!(
    TAILWIND_FONT_SIZE_RE,
    format!("(?-u:\\b)text-\\[(-?[0-9.]+(?:px|rem))\\]")
);
re!(GOOGLE_FAMILY_PARAM_RE, "[?&]family=([^&]+)");
re!(
    IMPORTANT_TAIL_RE,
    format!("{WS}*{}{WS}*$", ci("!important"))
);
re!(IMPORTANT_TAIL_CS_RE, format!("{WS}*!important{WS}*$"));
re!(EDGE_QUOTE_RE, r#"^["']|["']$"#);
re!(WS_RUN_RE, format!("{WS}+"));
re!(VAR_RE, format!("{}\\(", ci("var")));

fn first_existing(dir: &str, names: &[&str]) -> Option<String> {
    for name in names {
        let abs = jsp::join(&[dir, name]);
        if exists(&abs) {
            return Some(abs);
        }
    }
    None
}

/// `{ path, contextDir }` of the DESIGN.md that governs `cwd`.
#[derive(Debug, Clone, PartialEq)]
pub struct DesignMdPath {
    pub path: String,
    pub context_dir: String,
}

/// JS: design-system.mjs#resolveDesignMdPath
pub fn resolve_design_md_path(cwd: &str) -> Option<DesignMdPath> {
    if let Some(root) = first_existing(cwd, DESIGN_NAMES) {
        return Some(DesignMdPath {
            path: root,
            context_dir: cwd.to_string(),
        });
    }
    for rel in FALLBACK_DIRS {
        let dir = jsp::resolve(cwd, &[rel]);
        if let Some(found) = first_existing(&dir, DESIGN_NAMES) {
            return Some(DesignMdPath {
                path: found,
                context_dir: dir,
            });
        }
    }
    None
}

/// JS: design-system.mjs#resolveDesignSidecarPath
pub fn resolve_design_sidecar_path(cwd: &str, context_dir: &str) -> Option<String> {
    let candidates = [
        jsp::join(&[cwd, ".impeccable", "design.json"]),
        jsp::join(&[cwd, "DESIGN.json"]),
        jsp::join(&[context_dir, "DESIGN.json"]),
    ];
    for (index, candidate) in candidates.iter().enumerate() {
        let first = candidates
            .iter()
            .position(|c| c == candidate)
            .unwrap_or(index);
        if first == index && exists(candidate) {
            return Some(candidate.clone());
        }
    }
    None
}

// ─── Frontmatter YAML subset ─────────────────────────────────────────────────

re!(CRLF_RE, "\r?\n");
re!(COMMENT_LINE_RE, format!("^{WS}*#"));
re!(LEADING_WS_RE, format!("^{WS}*"));

/// JS: design-system.mjs#parseFrontmatter. `None` when there is no
/// `---` block; otherwise the parsed object (possibly empty).
pub fn parse_frontmatter(md: &str) -> Option<Map<String, Value>> {
    let lines: Vec<&str> = CRLF_RE.split(md).collect();
    if js::trim(lines.first().copied().unwrap_or("")) != "---" {
        return None;
    }
    let mut end = None;
    for (i, line) in lines.iter().enumerate().skip(1) {
        if js::trim(line) == "---" {
            end = Some(i);
            break;
        }
    }
    let end = end?;
    Some(parse_yaml_subset(&lines[1..end].join("\n")))
}

/// JS: design-system.mjs#parseYamlSubset (nested maps and scalars only).
pub fn parse_yaml_subset(yaml: &str) -> Map<String, Value> {
    // Build a tree of paths, then materialize: JS mutates nested objects by
    // reference; here we track the key path of each open mapping.
    let mut root = Map::new();
    let mut stack: Vec<(i64, Vec<String>)> = vec![(-1, vec![])];
    for raw in CRLF_RE.split(yaml) {
        if js::trim(raw).is_empty() || COMMENT_LINE_RE.is_match(raw) {
            continue;
        }
        let indent_bytes = LEADING_WS_RE.find(raw).map(|m| m.end()).unwrap_or(0);
        let indent = raw[..indent_bytes]
            .chars()
            .map(|c| c.len_utf16())
            .sum::<usize>() as i64;
        let content = &raw[indent_bytes..];
        let Some(colon_idx) = find_top_level_colon(content) else {
            continue;
        };
        while stack.len() > 1 && stack.last().map(|s| s.0 >= indent).unwrap_or(false) {
            stack.pop();
        }
        let key = unquote_yaml_key(js::trim(&content[..colon_idx])).to_string();
        let rest = strip_inline_yaml_comment(js::trim(&content[colon_idx + 1..]));
        let parent_path = stack.last().map(|s| s.1.clone()).unwrap_or_default();
        let parent = get_path_mut(&mut root, &parent_path);
        if rest.is_empty() {
            parent.insert(key.clone(), Value::Object(Map::new()));
            let mut path = parent_path;
            path.push(key);
            stack.push((indent, path));
        } else {
            parent.insert(key, parse_scalar(&rest));
        }
    }
    root
}

fn get_path_mut<'a>(
    root: &'a mut Map<String, Value>,
    path: &[String],
) -> &'a mut Map<String, Value> {
    let mut cur = root;
    for key in path {
        // A key on the stack was inserted as an object; a later scalar write to
        // the same key at the parent level would already have popped the stack.
        let entry = cur
            .entry(key.clone())
            .or_insert_with(|| Value::Object(Map::new()));
        if !entry.is_object() {
            *entry = Value::Object(Map::new());
        }
        cur = entry.as_object_mut().unwrap();
    }
    cur
}

fn find_top_level_colon(s: &str) -> Option<usize> {
    let mut in_quote: Option<char> = None;
    let mut prev: Option<char> = None;
    for (i, ch) in s.char_indices() {
        if let Some(q) = in_quote {
            if ch == q && prev != Some('\\') {
                in_quote = None;
            }
        } else if ch == '"' || ch == '\'' {
            in_quote = Some(ch);
        } else if ch == ':' {
            return Some(i);
        }
        prev = Some(ch);
    }
    None
}

/// JS: design-system.mjs#unquoteYamlKey
pub fn unquote_yaml_key(key: &str) -> &str {
    if (key.starts_with('"') && key.ends_with('"'))
        || (key.starts_with('\'') && key.ends_with('\''))
    {
        if key.chars().count() >= 2 {
            return &key[1..key.len() - 1];
        }
        // JS slice(1, -1) on a one-char string yields ''.
        return "";
    }
    key
}

fn strip_inline_yaml_comment(s: &str) -> String {
    let mut in_quote: Option<char> = None;
    let mut prev: Option<char> = None;
    for (i, ch) in s.char_indices() {
        if let Some(q) = in_quote {
            if ch == q && prev != Some('\\') {
                in_quote = None;
            }
        } else if ch == '"' || ch == '\'' {
            in_quote = Some(ch);
        } else if ch == '#' && i > 0 && prev.map(js::is_js_whitespace).unwrap_or(false) {
            return s[..i].trim_end_matches(js::is_js_whitespace).to_string();
        }
        prev = Some(ch);
    }
    s.to_string()
}

fn yaml_simple_escape(c: char) -> Option<char> {
    Some(match c {
        '0' => '\0',
        'a' => '\x07',
        'b' => '\x08',
        't' => '\t',
        'n' => '\n',
        'v' => '\x0B',
        'f' => '\x0C',
        'r' => '\r',
        'e' => '\x1b',
        ' ' => ' ',
        '"' => '"',
        '/' => '/',
        '\\' => '\\',
        'N' => '\u{85}',
        '_' => '\u{a0}',
        'L' => '\u{2028}',
        'P' => '\u{2029}',
        _ => return None,
    })
}

fn unescape_yaml_double_quoted(body: &str) -> String {
    let chars: Vec<char> = body.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < chars.len() {
        let ch = chars[i];
        if ch != '\\' || i == chars.len() - 1 {
            out.push(ch);
            i += 1;
            continue;
        }
        let next = chars[i + 1];
        if let Some(mapped) = yaml_simple_escape(next) {
            out.push(mapped);
            i += 2;
            continue;
        }
        let hex_len = match next {
            'x' => Some(2),
            'u' => Some(4),
            'U' => Some(8),
            _ => None,
        };
        if let Some(hex_len) = hex_len {
            let hex: String = chars[(i + 2).min(chars.len())..(i + 2 + hex_len).min(chars.len())]
                .iter()
                .collect();
            let code_point: i64 =
                if hex.chars().count() == hex_len && hex.chars().all(|c| c.is_ascii_hexdigit()) {
                    parse_int(&hex, 16) as i64
                } else {
                    -1
                };
            if (0..=0x10ffff).contains(&code_point) {
                // String.fromCodePoint: a surrogate code point has no char
                // representation; substitute U+FFFD as the closest thing.
                out.push(char::from_u32(code_point as u32).unwrap_or('\u{fffd}'));
                i += 2 + hex_len;
                continue;
            }
        }
        out.push(ch);
        i += 1;
    }
    out
}

re!(INT_RE, "^-?[0-9]+$");
re!(FLOAT_RE, "^-?[0-9]*\\.[0-9]+$");

fn parse_scalar(raw: &str) -> Value {
    let s = js::trim(raw);
    let n = s.chars().count();
    if n >= 2 && s.starts_with('"') && s.ends_with('"') {
        return Value::String(unescape_yaml_double_quoted(&s[1..s.len() - 1]));
    }
    if n >= 2 && s.starts_with('\'') && s.ends_with('\'') {
        return Value::String(s[1..s.len() - 1].replace("''", "'"));
    }
    if s == "true" {
        return Value::Bool(true);
    }
    if s == "false" {
        return Value::Bool(false);
    }
    if s == "null" || s == "~" {
        return Value::Null;
    }
    if INT_RE.is_match(s) || FLOAT_RE.is_match(s) {
        let v = js::string_to_number(s);
        return serde_json::Number::from_f64(v)
            .map(Value::Number)
            .unwrap_or(Value::String(s.to_string()));
    }
    Value::String(s.to_string())
}

// ─── Normalized design system ────────────────────────────────────────────────

/// JS `normalizeFontName`.
pub fn normalize_font_name(value: &str) -> String {
    let t = js::trim(value);
    let t = IMPORTANT_TAIL_RE.replace(t, "");
    let t = js::trim(&t);
    let t = EDGE_QUOTE_RE.replace_all(t, "");
    let t = t.replace('+', " ");
    let t = WS_RUN_RE.replace_all(&t, " ");
    js::to_lower_case(&t)
}

/// JS `splitFontStack`.
pub fn split_font_stack(stack: &str) -> Vec<String> {
    let t = IMPORTANT_TAIL_RE.replace(stack, "");
    t.split(',')
        .map(normalize_font_name)
        .filter(|f| !f.is_empty())
        .collect()
}

fn is_generic_font(font: &str) -> bool {
    GENERIC_FONTS.contains(&font)
}

re!(NON_LITERAL_STACK_RE, format!("[$`{{}}]|{WS}\\+{WS}|\\|\\|"));

fn is_literal_font_stack(stack: &str) -> bool {
    !NON_LITERAL_STACK_RE.is_match(stack)
}

/// JS: design-system.mjs#primaryFont
pub fn primary_font(stack: &str) -> String {
    if stack.is_empty() || VAR_RE.is_match(stack) || !is_literal_font_stack(stack) {
        return String::new();
    }
    split_font_stack(stack)
        .into_iter()
        .find(|f| !is_generic_font(f))
        .unwrap_or_default()
}

/// JS: design-system.mjs#cssColorLabel
pub fn css_color_label(raw: &str) -> String {
    WS_RUN_RE.replace_all(js::trim(raw), " ").into_owned()
}

/// JS `colorKey`.
pub fn color_key(color: &Rgba) -> String {
    format!(
        "{},{},{}",
        number_to_string(color.r),
        number_to_string(color.g),
        number_to_string(color.b)
    )
}

fn colors_close(a: &Rgba, b: &Rgba) -> bool {
    js::math_max3((a.r - b.r).abs(), (a.g - b.g).abs(), (a.b - b.b).abs())
        <= COLOR_CHANNEL_TOLERANCE
}

fn hsl_to_rgb(hh: f64, ss: f64, ll: f64, alpha: f64) -> Rgba {
    let h = (((hh % 360.0) + 360.0) % 360.0) / 360.0;
    let s = js::math_max(0.0, js::math_min(1.0, ss));
    let l = js::math_max(0.0, js::math_min(1.0, ll));
    let hue2rgb = |p: f64, q: f64, mut t: f64| {
        if t < 0.0 {
            t += 1.0;
        }
        if t > 1.0 {
            t -= 1.0;
        }
        if t < 1.0 / 6.0 {
            return p + (q - p) * 6.0 * t;
        }
        if t < 1.0 / 2.0 {
            return q;
        }
        if t < 2.0 / 3.0 {
            return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
        }
        p
    };
    let q = if l < 0.5 {
        l * (1.0 + s)
    } else {
        l + s - l * s
    };
    let p = 2.0 * l - q;
    Rgba::new(
        math_round(hue2rgb(p, q, h + 1.0 / 3.0) * 255.0),
        math_round(hue2rgb(p, q, h) * 255.0),
        math_round(hue2rgb(p, q, h - 1.0 / 3.0) * 255.0),
        alpha,
    )
}

re!(
    HSL_FALLBACK_RE,
    format!(
        "{hsl}[aA]?\\({WS}*([-0-9.]+)(?:{deg})?{WS}*,?{WS}*([0-9.]+)%{WS}*,?{WS}*([0-9.]+)%(?:{WS}*[,/]{WS}*([0-9.]+))?{WS}*\\)",
        hsl = ci("hsl"),
        deg = ci("deg")
    )
);

/// JS: design-system.mjs#parseDesignColor
pub fn parse_design_color(value: &str) -> Option<Rgba> {
    let text = js::trim(value);
    if let Some(parsed) = parse_any_color(Some(text)) {
        return Some(parsed);
    }
    let m = HSL_FALLBACK_RE.captures(text)?;
    Some(hsl_to_rgb(
        parse_float(&m[1]),
        parse_float(&m[2]) / 100.0,
        parse_float(&m[3]) / 100.0,
        m.get(4).map(|a| parse_float(a.as_str())).unwrap_or(1.0),
    ))
}

#[derive(Debug, Clone, PartialEq)]
pub struct AllowedColor {
    pub color: Rgba,
    pub labels: Vec<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AllowedRadius {
    pub name: String,
    pub value: String,
    pub px: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AllowedFontSize {
    pub value: String,
    pub px: f64,
    pub fluid: bool,
}

/// JS `normalizeDesignSystem` result.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct DesignSystem {
    pub present: bool,
    pub source_path: Option<String>,
    pub sidecar_path: Option<String>,
    pub md_newer_than_json: bool,
    /// JS `Set` (insertion order).
    pub allowed_fonts: Vec<String>,
    /// JS `Map<colorKey, { color, labels }>` (insertion order).
    pub allowed_color_keys: Vec<(String, AllowedColor)>,
    pub allowed_radii: Vec<AllowedRadius>,
    pub allowed_font_sizes: Vec<AllowedFontSize>,
    pub allowed_shadow_colors: Vec<Rgba>,
    pub has_pill_radius: bool,
    pub has_fonts: bool,
    pub has_colors: bool,
    pub has_radii: bool,
    pub has_font_sizes: bool,
}

fn add_design_color(out: &mut DesignSystem, value: &str, label: Option<&str>) {
    let Some(parsed) = parse_design_color(value) else {
        return;
    };
    let key = color_key(&parsed);
    let label = label
        .map(|l| l.to_string())
        .unwrap_or_else(|| css_color_label(value));
    if let Some((_, entry)) = out.allowed_color_keys.iter_mut().find(|(k, _)| *k == key) {
        entry.labels.push(label);
    } else {
        out.allowed_color_keys.push((
            key,
            AllowedColor {
                color: parsed,
                labels: vec![label],
            },
        ));
    }
}

fn add_color_object(out: &mut DesignSystem, colors: Option<&Value>, prefix: &str) {
    let Some(Value::Object(colors)) = colors else {
        return;
    };
    for (name, value) in colors {
        if let Value::String(s) = value {
            add_design_color(out, s, Some(&format!("{prefix}.{name}")));
        }
    }
}

fn add_sidecar_colors(out: &mut DesignSystem, sidecar: Option<&Value>) {
    let Some(color_meta) = sidecar
        .and_then(|s| s.get("extensions"))
        .and_then(|e| e.get("colorMeta"))
        .and_then(|c| c.as_object())
    else {
        return;
    };
    for (name, meta) in color_meta {
        let Some(meta) = meta.as_object() else {
            continue;
        };
        if let Some(Value::String(c)) = meta.get("canonical") {
            add_design_color(out, c, Some(&format!("sidecar.{name}")));
        }
        if let Some(Value::Array(ramp)) = meta.get("tonalRamp") {
            for (index, value) in ramp.iter().enumerate() {
                if let Value::String(v) = value {
                    add_design_color(out, v, Some(&format!("sidecar.{name}.tonalRamp[{index}]")));
                }
            }
        }
    }
}

fn add_typography_fonts(out: &mut DesignSystem, typography: Option<&Value>) {
    let Some(Value::Object(typography)) = typography else {
        return;
    };
    for role in typography.values() {
        let Some(role) = role.as_object() else {
            continue;
        };
        let Some(Value::String(ff)) = role.get("fontFamily") else {
            continue;
        };
        for font in split_font_stack(ff) {
            if !is_generic_font(&font) && !out.allowed_fonts.contains(&font) {
                out.allowed_fonts.push(font);
            }
        }
    }
}

fn value_to_string_nullish(v: Option<&Value>) -> String {
    match v {
        None | Some(Value::Null) => String::new(),
        Some(v) => js_string(v),
    }
}

fn add_font_size_step(out: &mut DesignSystem, raw: &str, fluid: bool) {
    let text = js::to_lower_case(js::trim(raw));
    if !FONT_SIZE_LITERAL_RE.is_match(&text) {
        return;
    }
    let Some(px) = resolve_length_px(Some(&text), 16.0) else {
        return;
    };
    if !px.is_finite() || px <= 0.0 {
        return;
    }
    out.allowed_font_sizes.push(AllowedFontSize {
        value: text,
        px,
        fluid,
    });
}

re!(
    CLAMP_RE,
    format!("^{}\\({WS}*({ANY}+){WS}*\\)$", ci("clamp"))
);

fn parse_clamp_args(raw: &str) -> Option<Vec<String>> {
    let m = CLAMP_RE.captures(js::trim(raw))?;
    let args = split_top_level_args(&m[1]);
    if args.len() == 3 {
        Some(args)
    } else {
        None
    }
}

fn add_clamp_endpoints(out: &mut DesignSystem, raw: &str) -> bool {
    let Some(args) = parse_clamp_args(raw) else {
        return false;
    };
    add_font_size_step(out, &args[0], true);
    add_font_size_step(out, &args[2], true);
    true
}

fn split_top_level_args(s: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut depth = 0i32;
    let mut current = String::new();
    for ch in s.chars() {
        if ch == '(' {
            depth += 1;
        } else if ch == ')' {
            depth -= 1;
        }
        if ch == ',' && depth == 0 {
            args.push(js::trim(&current).to_string());
            current.clear();
            continue;
        }
        current.push(ch);
    }
    if !js::trim(&current).is_empty() {
        args.push(js::trim(&current).to_string());
    }
    args
}

fn is_string_or_number(v: &Value) -> bool {
    matches!(v, Value::String(_) | Value::Number(_))
}

fn add_typography_sizes(out: &mut DesignSystem, typography: Option<&Value>) {
    let Some(Value::Object(typography)) = typography else {
        return;
    };
    if let Some(Value::Object(scale)) = typography.get("scale") {
        for value in scale.values() {
            if !is_string_or_number(value) {
                continue;
            }
            add_font_size_step(out, &js_string(value), false);
        }
    }
    for (name, role) in typography {
        if name == "scale" {
            continue;
        }
        let Some(role) = role.as_object() else {
            continue;
        };
        let raw = js::to_lower_case(js::trim(&value_to_string_nullish(role.get("fontSize"))));
        if add_clamp_endpoints(out, &raw) {
            continue;
        }
        add_font_size_step(out, &raw, false);
    }
}

re!(PILL_NAME_RE, "(^|\\.)(full|pill|round|rounded-full)$");
re!(PILL_EXACT_RE, "^(full|pill|round|rounded-full)$");
re!(
    PILL_ROLE_RE,
    format!("^({}|{}|{})$", ci("full"), ci("pill"), ci("round"))
);

fn add_rounded_scale(out: &mut DesignSystem, rounded: Option<&Value>) {
    let Some(Value::Object(rounded)) = rounded else {
        return;
    };
    for (raw_name, value) in rounded {
        let name = js::to_lower_case(unquote_yaml_key(raw_name));
        add_rounded_token(out, &name, value);
    }
}

fn add_rounded_token(out: &mut DesignSystem, name: &str, value: &Value) {
    if !is_string_or_number(value) {
        return;
    }
    let raw = js::trim(&js_string(value)).to_string();
    if raw.is_empty() || VAR_RE.is_match(&raw) || raw.contains('%') {
        return;
    }
    let Some(px) = resolve_length_px(Some(&raw), 16.0) else {
        return;
    };
    if !px.is_finite() {
        return;
    }
    out.allowed_radii.push(AllowedRadius {
        name: name.to_string(),
        value: raw,
        px,
    });
    if PILL_NAME_RE.is_match(name) {
        out.has_pill_radius = true;
    }
}

fn add_sidecar_radii(out: &mut DesignSystem, sidecar: Option<&Value>) {
    let Some(rounded_meta) = sidecar
        .and_then(|s| s.get("extensions"))
        .and_then(|e| e.get("roundedMeta"))
        .and_then(|c| c.as_object())
    else {
        return;
    };
    for (raw_name, meta) in rounded_meta {
        let name = js::to_lower_case(unquote_yaml_key(raw_name));
        if is_string_or_number(meta) {
            add_rounded_token(out, &format!("sidecar.{name}"), meta);
            continue;
        }
        let Some(meta) = meta.as_object() else {
            continue;
        };
        for key in ["canonical", "value"] {
            if let Some(v) = meta.get(key) {
                if is_string_or_number(v) {
                    add_rounded_token(out, &format!("sidecar.{name}.{key}"), v);
                }
            }
        }
        for key in ["values", "aliases"] {
            let Some(Value::Array(list)) = meta.get(key) else {
                continue;
            };
            for (index, value) in list.iter().enumerate() {
                add_rounded_token(out, &format!("sidecar.{name}.{key}[{index}]"), value);
            }
        }
        let role = value_to_string_nullish(meta.get("role"));
        if PILL_EXACT_RE.is_match(&name) || PILL_ROLE_RE.is_match(&role) {
            out.has_pill_radius = true;
        }
    }
}

fn add_sidecar_shadows(out: &mut DesignSystem, sidecar: Option<&Value>) {
    let Some(Value::Array(shadows)) = sidecar
        .and_then(|s| s.get("extensions"))
        .and_then(|e| e.get("shadows"))
    else {
        return;
    };
    for entry in shadows {
        let Some(Value::String(value)) = entry.get("value") else {
            continue;
        };
        for m in CSS_COLOR_RE.find_iter(value) {
            if let Some(parsed) = parse_design_color(m.as_str()) {
                out.allowed_shadow_colors.push(parsed);
            }
        }
    }
}

/// JS: design-system.mjs#normalizeDesignSystem
pub fn normalize_design_system(
    frontmatter: Option<&Map<String, Value>>,
    sidecar: Option<&Value>,
    source_path: Option<&str>,
    sidecar_path: Option<&str>,
    md_newer_than_json: bool,
) -> DesignSystem {
    let empty = Map::new();
    let frontmatter = frontmatter.unwrap_or(&empty);
    let mut out = DesignSystem {
        present: true,
        source_path: source_path.map(|s| s.to_string()),
        sidecar_path: sidecar_path.map(|s| s.to_string()),
        md_newer_than_json,
        ..Default::default()
    };
    add_typography_fonts(&mut out, frontmatter.get("typography"));
    add_typography_sizes(&mut out, frontmatter.get("typography"));
    add_color_object(&mut out, frontmatter.get("colors"), "colors");
    add_sidecar_colors(&mut out, sidecar);
    add_rounded_scale(&mut out, frontmatter.get("rounded"));
    add_sidecar_radii(&mut out, sidecar);
    add_sidecar_shadows(&mut out, sidecar);
    out.has_fonts = !out.allowed_fonts.is_empty();
    out.has_colors = !out.allowed_color_keys.is_empty();
    out.has_radii = !out.allowed_radii.is_empty();
    out.has_font_sizes = out.allowed_font_sizes.iter().any(|e| !e.fluid);
    out
}

fn mtime_ms(p: &str) -> Option<f64> {
    let meta = std::fs::metadata(p).ok()?;
    let m = meta.modified().ok()?;
    let d = m.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some(d.as_secs_f64() * 1000.0)
}

/// JS: design-system.mjs#loadDesignSystemForCwd
pub fn load_design_system_for_cwd(cwd: &str) -> Option<DesignSystem> {
    let md = resolve_design_md_path(cwd)?;
    let md_stat = mtime_ms(&md.path);
    let text = read_text(&md.path)?;
    let frontmatter = parse_frontmatter(&text)?;
    let sidecar_path = resolve_design_sidecar_path(cwd, &md.context_dir);
    let sidecar = sidecar_path.as_deref().and_then(read_json);
    let sidecar_stat = sidecar_path.as_deref().and_then(mtime_ms);
    let md_newer = matches!((md_stat, sidecar_stat), (Some(m), Some(s)) if m > s + 1000.0);
    Some(normalize_design_system(
        Some(&frontmatter),
        sidecar.as_ref(),
        Some(&md.path),
        sidecar_path.as_deref(),
        md_newer,
    ))
}

/// JS `designSystemStartDir(targetPath, cwd)`.
pub fn design_system_start_dir(target_path: &str, cwd: &str) -> String {
    let abs = if jsp::is_absolute(target_path) {
        target_path.to_string()
    } else {
        jsp::resolve(cwd, &[target_path])
    };
    match std::fs::metadata(&abs) {
        Ok(m) => {
            if m.is_dir() {
                abs
            } else {
                jsp::dirname(&abs)
            }
        }
        Err(_) => {
            if !jsp::extname(&abs).is_empty() {
                jsp::dirname(&abs)
            } else {
                abs
            }
        }
    }
}

/// `{ dir, hasDesign }` from `findDesignRoot`.
#[derive(Debug, Clone, PartialEq)]
pub struct DesignRoot {
    pub dir: String,
    pub has_design: bool,
}

/// JS: design-system.mjs#readWorkspacePatternGroups — Impeccable projectRoots
/// govern any path they match (positive or negated); package-manager globs
/// only apply to paths the Impeccable group does not match.
fn read_workspace_pattern_groups(dir: &str) -> (Vec<String>, Vec<String>) {
    let mut impeccable: Vec<String> = Vec::new();
    for name in ["config.json", "config.local.json"] {
        let roots = read_json(&jsp::join(&[dir, ".impeccable", name]))
            .and_then(|v| v.get("projectRoots").cloned());
        if let Some(Value::Array(roots)) = roots {
            for entry in roots {
                if let Value::String(s) = entry {
                    let t = js::trim(&s);
                    if !t.is_empty() {
                        impeccable.push(t.to_string());
                    }
                }
            }
        }
    }
    let mut pkg: Vec<String> = Vec::new();
    let workspaces = read_json(&jsp::join(&[dir, "package.json"])).and_then(|v| v.get("workspaces").cloned());
    match &workspaces {
        Some(Value::Array(ws)) => pkg.extend(ws.iter().map(js_string)),
        Some(other) => {
            if let Some(Value::Array(ws)) = other.get("packages") {
                pkg.extend(ws.iter().map(js_string));
            }
        }
        None => {}
    }
    if let Some(Value::Array(ws)) = read_json(&jsp::join(&[dir, "lerna.json"])).and_then(|v| v.get("packages").cloned()) {
        pkg.extend(ws.iter().map(js_string));
    }
    if let Some(text) = read_text(&jsp::join(&[dir, "pnpm-workspace.yaml"])) {
        let mut in_packages = false;
        for line in text.split("\r\n").flat_map(|l| l.split('\n')) {
            let stripped = strip_inline_yaml_comment(line);
            let trimmed = js::trim(&stripped);
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            if let Some(caps) = PNPM_FLOW_RE.captures(trimmed) {
                for entry in caps.get(1).map(|m| m.as_str()).unwrap_or("").split(',') {
                    let e = EDGE_QUOTE_RE.replace_all(js::trim(entry), "").into_owned();
                    if !e.is_empty() {
                        pkg.push(e);
                    }
                }
                break;
            }
            if PNPM_PACKAGES_RE.is_match(trimmed) {
                in_packages = true;
                continue;
            }
            if !in_packages {
                continue;
            }
            if let Some(caps) = PNPM_ITEM_RE.captures(trimmed) {
                pkg.push(EDGE_QUOTE_RE.replace_all(js::trim(caps.get(1).map(|m| m.as_str()).unwrap_or("")), "").into_owned());
            } else if PNPM_KEY_RE.is_match(trimmed) {
                break;
            }
        }
    }
    (impeccable, pkg)
}

/// JS: design-system.mjs#readWorkspacePatterns
fn read_workspace_patterns(dir: &str) -> Vec<String> {
    let (mut a, mut b) = read_workspace_pattern_groups(dir);
    a.append(&mut b);
    a
}

const MONOREPO_MARKER_FILES: &[&str] = &["pnpm-workspace.yaml", "turbo.json", "nx.json", "lerna.json"];
const MONOREPO_FALLBACK_PROJECT_DIRS: &[&str] = &["apps", "packages"];

re!(PNPM_FLOW_RE, format!("^packages:{WS}*\\[(.*)\\]{WS}*$"));
re!(PNPM_PACKAGES_RE, format!("^packages:{WS}*$"));
re!(PNPM_ITEM_RE, format!("^-{WS}*(.+)$"));
re!(PNPM_KEY_RE, format!("^[A-Za-z0-9_-]+:{WS}*"));

/// JS: design-system.mjs#isMonorepoRoot
fn is_monorepo_root(dir: &str) -> bool {
    if read_workspace_patterns(dir).iter().any(|p| !js::trim(p).starts_with('!')) {
        return true;
    }
    if !MONOREPO_MARKER_FILES.iter().any(|f| exists(&jsp::join(&[dir, f]))) {
        return false;
    }
    MONOREPO_FALLBACK_PROJECT_DIRS.iter().any(|name| {
        std::fs::read_dir(jsp::join(&[dir, name]))
            .map(|entries| {
                entries
                    .flatten()
                    .any(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
            })
            .unwrap_or(false)
    })
}

/// JS: design-system.mjs#monorepoOwnsPath > normalizeWorkspacePattern
fn normalize_workspace_pattern(pattern: &str) -> String {
    let mut s = EDGE_QUOTE_RE.replace_all(js::trim(pattern), "").into_owned();
    if let Some(rest) = s.strip_prefix("./") {
        s = rest.to_string();
    }
    while s.ends_with('/') {
        s.pop();
    }
    s
}

/// JS: design-system.mjs#monorepoOwnsPath > segmentMatches
fn segment_matches(pattern_segment: &str, rel_segment: &str) -> bool {
    if pattern_segment == "*" {
        return true;
    }
    if !pattern_segment.contains('*') {
        return pattern_segment == rel_segment;
    }
    let escaped = regex::escape(pattern_segment).replace("\\*", "[^/]*");
    Regex::new(&format!("^{}$", escaped)).map(|re| re.is_match(rel_segment)).unwrap_or(false)
}

/// JS: design-system.mjs#monorepoOwnsPath > matchGlobSegments
fn match_glob_segments(pattern_segments: &[&str], rel_segments: &[&str]) -> bool {
    fn rec(pattern_segments: &[&str], rel_segments: &[&str], pi: usize, ri: usize) -> bool {
        if pi == pattern_segments.len() {
            return ri == rel_segments.len();
        }
        if pattern_segments[pi] == "**" {
            if pi == pattern_segments.len() - 1 {
                return true;
            }
            for k in ri..=rel_segments.len() {
                if rec(pattern_segments, rel_segments, pi + 1, k) {
                    return true;
                }
            }
            return false;
        }
        if ri >= rel_segments.len() {
            return false;
        }
        if !segment_matches(pattern_segments[pi], rel_segments[ri]) {
            return false;
        }
        rec(pattern_segments, rel_segments, pi + 1, ri + 1)
    }
    rec(pattern_segments, rel_segments, 0, 0)
}

/// JS: design-system.mjs#monorepoOwnsPath
fn monorepo_owns_path(root: &str, boundary_dir: &str) -> bool {
    let rel = jsp::relative("/", root, boundary_dir);
    if rel.is_empty() || rel.starts_with("..") || jsp::is_absolute(&rel) {
        return false;
    }
    let rel_segments: Vec<&str> = rel.split(jsp::SEP_CHAR).filter(|s| !s.is_empty()).collect();

    // Negations like !packages/excluded must also cover nested dirs under
    // that path.
    let matches_negation = |pattern: &str| -> bool {
        let normalized = normalize_workspace_pattern(pattern);
        let pattern_segments: Vec<&str> = normalized.split('/').filter(|s| !s.is_empty()).collect();
        if pattern_segments.is_empty() {
            return false;
        }
        if pattern_segments.contains(&"**") {
            return match_glob_segments(&pattern_segments, &rel_segments);
        }
        if rel_segments.len() < pattern_segments.len() {
            return false;
        }
        pattern_segments
            .iter()
            .zip(rel_segments.iter())
            .all(|(p, r)| segment_matches(p, r))
    };

    // Positive globs identify workspace packages at exact depth (`*` is a
    // direct child). A nested package.json under that package is still owned:
    // the ancestor directory of glob length must itself be a package.
    let positive_owns = |pattern: &str| -> bool {
        let normalized = normalize_workspace_pattern(pattern);
        let pattern_segments: Vec<&str> = normalized.split('/').filter(|s| !s.is_empty()).collect();
        if pattern_segments.is_empty() {
            return false;
        }
        if pattern_segments.contains(&"**") {
            return match_glob_segments(&pattern_segments, &rel_segments);
        }
        if rel_segments.len() < pattern_segments.len() {
            return false;
        }
        if !pattern_segments.iter().zip(rel_segments.iter()).all(|(p, r)| segment_matches(p, r)) {
            return false;
        }
        if rel_segments.len() == pattern_segments.len() {
            return true;
        }
        let mut parts: Vec<&str> = vec![root];
        parts.extend(&rel_segments[..pattern_segments.len()]);
        let ancestor_dir = jsp::join(&parts);
        exists(&jsp::join(&[&ancestor_dir, "package.json"]))
    };

    let group_owns = |raw_patterns: &[String]| -> Option<bool> {
        let patterns: Vec<String> = raw_patterns
            .iter()
            .map(|p| normalize_workspace_pattern(p))
            .filter(|p| !p.is_empty())
            .collect();
        if patterns.is_empty() {
            return None;
        }
        let excluded = patterns
            .iter()
            .any(|pattern| pattern.starts_with('!') && matches_negation(&pattern[1..]));
        let included = patterns
            .iter()
            .filter(|pattern| !pattern.starts_with('!'))
            .any(|pattern| positive_owns(pattern));
        if !excluded && !included {
            return None;
        }
        if excluded {
            return Some(false);
        }
        Some(true)
    };

    let (impeccable, pkg) = read_workspace_pattern_groups(root);
    if let Some(from_impeccable) = group_owns(&impeccable) {
        return from_impeccable;
    }
    if let Some(from_pkg) = group_owns(&pkg) {
        return from_pkg;
    }
    if impeccable
        .iter()
        .chain(pkg.iter())
        .any(|pattern| !normalize_workspace_pattern(pattern).starts_with('!'))
    {
        return false;
    }
    rel_segments.len() >= 2 && MONOREPO_FALLBACK_PROJECT_DIRS.contains(&rel_segments[0])
}

/// JS: design-system.mjs#homeDirForms — both forms of the home directory. The
/// walk compares path strings, and a symlinked home (e.g. /home -> /var/home)
/// never string-matches the physical paths a cwd-resolved target produces,
/// which would let the post-boundary walk sail through $HOME and inherit
/// from it.
fn home_dir_forms(cwd: &str, home: &str) -> Vec<String> {
    let home_dir = jsp::resolve(cwd, &[home]);
    let mut forms = vec![home_dir.clone()];
    if let Ok(real) = std::fs::canonicalize(&home_dir) {
        let real = real.to_string_lossy().into_owned();
        let real = real.strip_prefix("\\\\?\\").map(|s| s.to_string()).unwrap_or(real);
        if !forms.contains(&real) {
            forms.push(real);
        }
    }
    forms
}

/// JS: design-system.mjs#findDesignRoot. `home` is `os.homedir()`.
///
/// A directory carrying a project marker but no DESIGN.md is a project
/// BOUNDARY. A nested package.json inherits the ancestor DESIGN.md only when
/// that ancestor's workspace declarations include the path (negations win; a
/// nested package under a matched workspace still inherits). Marker-only
/// roots (turbo/nx/lerna/pnpm with no globs) still own apps/<name> and
/// packages/<name>. A stray nested package that matches no glob does not
/// inherit, and a nested separate repository (.git with no workspace
/// declaration) still inherits nothing (issue #570).
pub fn find_design_root(start_dir: &str, cwd: &str, home: &str) -> Option<DesignRoot> {
    let mut dir = jsp::resolve(cwd, &[start_dir]);
    let home_dirs = home_dir_forms(cwd, home);
    let mut boundary: Option<DesignRoot> = None;
    loop {
        if boundary.is_none() && resolve_design_md_path(&dir).is_some() {
            return Some(DesignRoot { dir, has_design: true });
        }
        if let Some(b) = &boundary {
            // Past the boundary the walk only looks for the monorepo root
            // that owns the workspace path. Monorepo-root before .git, same
            // order as context.mjs: a workspace root carrying its own .git is
            // still recognized, while a .git that declares no workspaces is a
            // separate repository and stops the walk with nothing inherited.
            // The home directory is never an owning root.
            if !home_dirs.contains(&dir) && is_monorepo_root(&dir) {
                if monorepo_owns_path(&dir, &b.dir) {
                    let has_design = resolve_design_md_path(&dir).is_some();
                    return Some(DesignRoot { dir, has_design });
                }
                return boundary;
            }
            if exists(&jsp::join(&[&dir, ".git"])) {
                return boundary;
            }
        } else if PROJECT_ROOT_MARKERS.iter().any(|marker| exists(&jsp::join(&[&dir, marker]))) {
            boundary = Some(DesignRoot { dir: dir.clone(), has_design: false });
            // A boundary that is itself a monorepo root, or a separate
            // repository with its own .git, inherits nothing from above.
            if is_monorepo_root(&dir) || exists(&jsp::join(&[&dir, ".git"])) {
                return boundary;
            }
        }
        if home_dirs.contains(&dir) {
            return boundary;
        }
        let parent = jsp::dirname(&dir);
        if parent == dir {
            return boundary;
        }
        dir = parent;
    }
}

/// Memo for `load_design_system_for_target`, keyed by design root.
pub type DesignSystemCache = HashMap<String, Option<Rc<DesignSystem>>>;

/// JS: design-system.mjs#loadDesignSystemForTarget
pub fn load_design_system_for_target(
    target_path: &str,
    cache: Option<&mut DesignSystemCache>,
    cwd: &str,
    home: &str,
) -> Option<Rc<DesignSystem>> {
    let start_dir = design_system_start_dir(target_path, cwd);
    let found = find_design_root(&start_dir, cwd, home);
    let key = match &found {
        Some(f) => format!("root:{}", f.dir),
        None => "\0none".to_string(),
    };
    if let Some(cache) = &cache {
        if let Some(hit) = cache.get(&key) {
            return hit.clone();
        }
    }
    let loaded = match &found {
        Some(f) if f.has_design => load_design_system_for_cwd(&f.dir).map(Rc::new),
        _ => None,
    };
    if let Some(cache) = cache {
        cache.insert(key, loaded.clone());
    }
    loaded
}

// ─── Allowlist predicates ────────────────────────────────────────────────────

/// JS: design-system.mjs#isAllowedFont
pub fn is_allowed_font(font: &str, ds: Option<&DesignSystem>) -> bool {
    if font.is_empty() || is_generic_font(font) {
        return true;
    }
    match ds {
        Some(ds) if ds.has_fonts => ds.allowed_fonts.iter().any(|f| f == font),
        _ => true,
    }
}

/// JS: design-system.mjs#isAllowedColorRaw
pub fn is_allowed_color_raw(raw: &str, ds: Option<&DesignSystem>) -> bool {
    let Some(ds) = ds.filter(|d| d.has_colors) else {
        return true;
    };
    let text = js::to_lower_case(js::trim(raw));
    if text.is_empty()
        || text == "transparent"
        || text == "currentcolor"
        || text == "inherit"
        || text == "initial"
    {
        return true;
    }
    if text.contains("var(") {
        return true;
    }
    let Some(parsed) = parse_design_color(&text) else {
        return true;
    };
    if parsed.alpha_or_one() <= 0.05 {
        return true;
    }
    ds.allowed_color_keys
        .iter()
        .any(|(_, entry)| colors_close(&parsed, &entry.color))
}

/// JS: design-system.mjs#isAllowedShadowColorRaw
pub fn is_allowed_shadow_color_raw(raw: &str, ds: Option<&DesignSystem>) -> bool {
    let Some(ds) = ds.filter(|d| !d.allowed_shadow_colors.is_empty()) else {
        return false;
    };
    let Some(parsed) = parse_design_color(&js::to_lower_case(js::trim(raw))) else {
        return false;
    };
    ds.allowed_shadow_colors.iter().any(|entry| {
        colors_close(&parsed, entry)
            && (parsed.alpha_or_one() - entry.alpha_or_one()).abs() <= SHADOW_ALPHA_TOLERANCE
    })
}

/// JS: design-system.mjs#isAllowedRadiusRaw
pub fn is_allowed_radius_raw(raw: &str, ds: Option<&DesignSystem>) -> bool {
    let Some(ds) = ds.filter(|d| d.has_radii) else {
        return true;
    };
    let text = js::to_lower_case(js::trim(raw));
    if text.is_empty() || text == "0" || text == "none" || text == "initial" || text == "inherit" {
        return true;
    }
    if text.contains("var(") || text.contains('%') {
        return true;
    }
    let Some(px) = resolve_length_px(Some(&text), 16.0) else {
        return true;
    };
    if !px.is_finite() || px <= RADIUS_TOLERANCE_PX {
        return true;
    }
    if ds.has_pill_radius && px >= 99.0 {
        return true;
    }
    ds.allowed_radii
        .iter()
        .any(|entry| (entry.px - px).abs() <= RADIUS_TOLERANCE_PX)
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum StepStatus {
    Unjudgeable,
    OnRamp,
    OffRamp,
}

fn font_size_step_status(raw: &str, ds: &DesignSystem) -> StepStatus {
    let text = js::to_lower_case(js::trim(raw));
    if !FONT_SIZE_LITERAL_RE.is_match(&text) {
        return StepStatus::Unjudgeable;
    }
    let Some(px) = resolve_length_px(Some(&text), 16.0) else {
        return StepStatus::Unjudgeable;
    };
    if !px.is_finite() || px <= 0.0 {
        return StepStatus::Unjudgeable;
    }
    if ds
        .allowed_font_sizes
        .iter()
        .any(|entry| (entry.px - px).abs() <= FONT_SIZE_TOLERANCE_PX)
    {
        StepStatus::OnRamp
    } else {
        StepStatus::OffRamp
    }
}

/// JS: design-system.mjs#offRampClampEndpoints. `None` when `raw` is not a
/// fluid value (or the system has no ramp).
pub fn off_ramp_clamp_endpoints(raw: &str, ds: Option<&DesignSystem>) -> Option<Vec<String>> {
    let ds = ds.filter(|d| d.has_font_sizes)?;
    let cleaned = IMPORTANT_TAIL_RE.replace(js::trim(raw), "");
    let args = parse_clamp_args(&cleaned)?;
    Some(
        [args[0].clone(), args[2].clone()]
            .into_iter()
            .filter(|endpoint| font_size_step_status(endpoint, ds) == StepStatus::OffRamp)
            .collect(),
    )
}

/// JS: design-system.mjs#isAllowedFontSizeRaw
pub fn is_allowed_font_size_raw(raw: &str, ds: Option<&DesignSystem>) -> bool {
    let Some(ds) = ds.filter(|d| d.has_font_sizes) else {
        return true;
    };
    let text = js::to_lower_case(js::trim(raw));
    let text = IMPORTANT_TAIL_CS_RE.replace(&text, "");
    if let Some(off) = off_ramp_clamp_endpoints(&text, Some(ds)) {
        return off.is_empty();
    }
    font_size_step_status(&text, ds) != StepStatus::OffRamp
}

fn line_looks_commented(line: &str) -> bool {
    let t = js::trim(line);
    t.starts_with("//") || t.starts_with("/*") || t.starts_with('*') || t.starts_with("<!--")
}

re!(
    STYLE_CONTEXT_RE,
    format!(
        "(?:^|[{{{WS_CHARS};\"'`(,])(?:{color}|{background}(?:-{color}|-{image})?|{border}(?:-(?:{top}|{right}|{bottom}|{left}))?(?:-{color})?|{outline}(?:-{color})?|{box_shadow}|{text_shadow}|{fill}|{stroke}){WS}*:{WS}*[^;{{}}\"'`]*",
        WS_CHARS = impeccable_core::js::WS_CHARS,
        color = ci("color"),
        background = ci("background"),
        image = ci("image"),
        border = ci("border"),
        top = ci("top"),
        right = ci("right"),
        bottom = ci("bottom"),
        left = ci("left"),
        outline = ci("outline"),
        box_shadow = ci("box-shadow"),
        text_shadow = ci("text-shadow"),
        fill = ci("fill"),
        stroke = ci("stroke")
    )
);
re!(
    CSS_FUNCTION_CONTEXT_RE,
    format!(
        "(?:{}|{}|{}|{})\\([^)]*$",
        ci("linear-gradient"),
        ci("radial-gradient"),
        ci("conic-gradient"),
        ci("color-mix")
    )
);
re!(
    JS_COLOR_KEY_CONTEXT_RE,
    format!(
        "(?:^|[,{{]{WS}*)(?:{color}|{background}|{backgroundColor}|{borderColor}|{outlineColor}|{fill}|{stroke}|{boxShadow}|{textShadow}){WS}*[:=]{WS}*[\"'`]?[^\"'`,}}]*",
        color = ci("color"),
        background = ci("background"),
        backgroundColor = ci("backgroundColor"),
        borderColor = ci("borderColor"),
        outlineColor = ci("outlineColor"),
        fill = ci("fill"),
        stroke = ci("stroke"),
        boxShadow = ci("boxShadow"),
        textShadow = ci("textShadow")
    )
);

fn is_probably_color_literal(line: &str, start: usize, raw: &str) -> bool {
    if is_inside_css_attribute_selector(line, start) {
        return false;
    }
    let before = &line[..start];
    let after = &line[start + raw.len()..];
    if raw.starts_with('#') {
        if before.ends_with('&') {
            return false;
        }
        // JS `before.match(/\S(?=\s*$)/)?.[0]` / `after.match(/^\s*(\S)/)?.[1]`.
        let prev_non_space = before.trim_end_matches(js::is_js_whitespace).chars().last();
        let next_non_space = after
            .trim_start_matches(js::is_js_whitespace)
            .chars()
            .next();
        if prev_non_space == Some('>') && next_non_space == Some('<') {
            return false;
        }
    }
    STYLE_CONTEXT_RE.is_match(before)
        || CSS_FUNCTION_CONTEXT_RE.is_match(before)
        || JS_COLOR_KEY_CONTEXT_RE.is_match(before)
}

const QUOTED_STRING_SRC: &str = r#""[^"]*"|'[^']*'"#;
static INTERPOLATION_SRC: Lazy<String> = Lazy::new(|| {
    format!(
        "\\$\\{{(?:{q}|\\{{(?:{q}|[^{{}}\"'`])*\\}}|[^{{}}\"'`])*\\}}",
        q = QUOTED_STRING_SRC
    )
});
static SHADOW_CSS_CONTEXT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        "(?:^|[{{{WS_CHARS};\"'`(,])(?:{box_shadow}|{text_shadow}){WS}*:{WS}*(?:{interp}|[^;{{}}\"'`])*$",
        WS_CHARS = impeccable_core::js::WS_CHARS,
        WS = WS,
        box_shadow = ci("box-shadow"),
        text_shadow = ci("text-shadow"),
        interp = *INTERPOLATION_SRC
    ))
    .unwrap()
});
static SHADOW_JS_CONTEXT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        "(?:^|[,{{]{WS}*)(?:{box_shadow}|{text_shadow}){WS}*[:=]{WS}*[\"'`]?(?:{interp}|[^\"'`}}])*$",
        WS = WS,
        box_shadow = ci("boxShadow"),
        text_shadow = ci("textShadow"),
        interp = *INTERPOLATION_SRC
    ))
    .unwrap()
});

fn is_shadow_property_context(line: &str, start: usize) -> bool {
    let before = &line[..start];
    SHADOW_CSS_CONTEXT_RE.is_match(before) || SHADOW_JS_CONTEXT_RE.is_match(before)
}

fn is_inside_css_attribute_selector(line: &str, index: usize) -> bool {
    let before = &line[..index];
    let Some(last_open) = before.rfind('[') else {
        return false;
    };
    if let Some(last_close) = before.rfind(']') {
        if last_close > last_open {
            return false;
        }
    }
    let after = &line[index..];
    let close = after.find(']');
    let block = after.find('{');
    match close {
        None => false,
        Some(c) => block.map(|b| c < b).unwrap_or(true),
    }
}

/// JS `makeDesignFinding(id, filePath, snippet, line, { ignoreValue })`.
pub fn make_design_finding(
    id: &str,
    file_path: &str,
    snippet: &str,
    line: f64,
    ignore_value: &str,
) -> Finding {
    let mut f = finding(id, file_path, snippet, line);
    f.extras.insert(
        "ignoreValue".into(),
        Value::String(ignore_value.to_string()),
    );
    f
}

fn decode_google_family(value: &str) -> String {
    let family = value.split(':').next().unwrap_or("").replace('+', " ");
    crate::config::decode_uri_component(&family)
}

/// JS `primary.replace(/\b\w/g, ch => ch.toUpperCase())`.
fn title_case_ascii_words(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_word = false;
    for c in s.chars() {
        let is_word = c.is_ascii_alphanumeric() || c == '_';
        if is_word && !prev_word {
            out.push(c.to_ascii_uppercase());
        } else {
            out.push(c);
        }
        prev_word = is_word;
    }
    out
}

fn check_font_stack(
    stack: &str,
    file_path: &str,
    line: f64,
    ds: &DesignSystem,
    context: &str,
) -> Vec<Finding> {
    let primary = primary_font(stack);
    if primary.is_empty() || is_allowed_font(&primary, Some(ds)) {
        return vec![];
    }
    let display = title_case_ascii_words(&primary);
    vec![make_design_finding(
        "design-system-font",
        file_path,
        &format!("{context}: {display} is not declared in DESIGN.md typography"),
        line,
        &display,
    )]
}

re!(SLASH_WS_RE, format!("{WS}*/{WS}*"));

/// JS: design-system.mjs#extractRadiusTokens
pub fn extract_radius_tokens(value: &str) -> Vec<String> {
    let replaced = SLASH_WS_RE.replace_all(value, " ");
    WS_RUN_RE
        .split(&replaced)
        // JS-PARITY: extractRadiusTokens strips a trailing `)+` (regex /\)+$/)
        // after trim so a var() fallback's closing paren (`8px)`) is not parsed
        // as unitless 8rem. (upstream 1bcdf80f / #687)
        .map(|t| js::trim(t).trim_end_matches(')').to_string())
        .filter(|t| !t.is_empty())
        .collect()
}

fn check_radius_value(
    value: &str,
    file_path: &str,
    line: f64,
    ds: &DesignSystem,
    context: &str,
) -> Vec<Finding> {
    let mut findings = Vec::new();
    for token in extract_radius_tokens(value) {
        if is_allowed_radius_raw(&token, Some(ds)) {
            continue;
        }
        findings.push(make_design_finding(
            "design-system-radius",
            file_path,
            &format!("{context}: {token} is outside the DESIGN.md rounded scale"),
            line,
            &token,
        ));
    }
    findings
}

fn check_font_size_value(
    value: &str,
    file_path: &str,
    line: f64,
    ds: &DesignSystem,
    context: &str,
) -> Vec<Finding> {
    let token = js::trim(value).to_string();
    if is_allowed_font_size_raw(&token, Some(ds)) {
        return vec![];
    }
    let off = off_ramp_clamp_endpoints(&token, Some(ds)).unwrap_or_default();
    if !off.is_empty() {
        let plural = if off.len() > 1 { "s" } else { "" };
        return vec![make_design_finding(
            "design-system-font-size",
            file_path,
            &format!(
                "{context}: {token} has fluid endpoint{plural} {} off the DESIGN.md type ramp",
                off.join(" and ")
            ),
            line,
            &off[0],
        )];
    }
    let ignore_value = js::trim(&IMPORTANT_TAIL_RE.replace(&token, "")).to_string();
    vec![make_design_finding(
        "design-system-font-size",
        file_path,
        &format!("{context}: {token} is off the DESIGN.md type ramp"),
        line,
        &ignore_value,
    )]
}

/// JS: design-system.mjs#checkSourceDesignSystem
pub fn check_source_design_system(
    content: &str,
    file_path: &str,
    ds: Option<&DesignSystem>,
) -> Vec<Finding> {
    let Some(ds) = ds.filter(|d| d.present) else {
        return vec![];
    };
    let mut findings = Vec::new();
    for (i, line) in content.split('\n').enumerate() {
        let line_num = (i + 1) as f64;
        if line_looks_commented(line) {
            continue;
        }
        if ds.has_fonts {
            for m in FONT_DECL_RE.captures_iter(line) {
                findings.extend(check_font_stack(
                    &m[1],
                    file_path,
                    line_num,
                    ds,
                    "font-family",
                ));
            }
            for m in FONT_JS_RE.captures_iter(line) {
                findings.extend(check_font_stack(
                    &m[1],
                    file_path,
                    line_num,
                    ds,
                    "fontFamily",
                ));
            }
            for m in GOOGLE_FONT_RE.find_iter(line) {
                let url = m.as_str();
                for fm in GOOGLE_FAMILY_PARAM_RE.captures_iter(url) {
                    let font = normalize_font_name(&decode_google_family(&fm[1]));
                    if font.is_empty() || is_allowed_font(&font, Some(ds)) {
                        continue;
                    }
                    let display = decode_google_family(&fm[1]);
                    findings.push(make_design_finding(
                        "design-system-font",
                        file_path,
                        &format!("Google Fonts: {display} is not declared in DESIGN.md typography"),
                        line_num,
                        &display,
                    ));
                }
            }
        }
        if ds.has_colors {
            for m in CSS_COLOR_RE.find_iter(line) {
                if !is_probably_color_literal(line, m.start(), m.as_str()) {
                    continue;
                }
                let raw = css_color_label(m.as_str());
                if is_allowed_color_raw(&raw, Some(ds)) {
                    continue;
                }
                if is_shadow_property_context(line, m.start())
                    && is_allowed_shadow_color_raw(&raw, Some(ds))
                {
                    continue;
                }
                findings.push(make_design_finding(
                    "design-system-color",
                    file_path,
                    &format!("Undocumented color {raw} is outside DESIGN.md colors"),
                    line_num,
                    &raw,
                ));
            }
        }
        if ds.has_radii {
            for m in BORDER_RADIUS_RE.captures_iter(line) {
                findings.extend(check_radius_value(
                    &m[1],
                    file_path,
                    line_num,
                    ds,
                    "border-radius",
                ));
            }
            for m in BORDER_RADIUS_JS_RE.captures_iter(line) {
                findings.extend(check_radius_value(
                    &m[1],
                    file_path,
                    line_num,
                    ds,
                    "borderRadius",
                ));
            }
        }
        if ds.has_font_sizes {
            for m in FONT_SIZE_DECL_RE.captures_iter(line) {
                findings.extend(check_font_size_value(
                    &m[1],
                    file_path,
                    line_num,
                    ds,
                    "font-size",
                ));
            }
            for m in FONT_SIZE_JS_RE.captures_iter(line) {
                findings.extend(check_font_size_value(
                    &m[1], file_path, line_num, ds, "fontSize",
                ));
            }
            for m in TAILWIND_FONT_SIZE_RE.captures_iter(line) {
                findings.extend(check_font_size_value(
                    &m[1],
                    file_path,
                    line_num,
                    ds,
                    "text-[…] class",
                ));
            }
        }
    }
    dedupe_design_findings(findings)
}

/// JS: design-system.mjs#isTransparentCss
pub fn is_transparent_css(value: &str) -> bool {
    let text = js::to_lower_case(js::trim(value));
    if text.is_empty() || text == "transparent" {
        return true;
    }
    match parse_design_color(&text) {
        Some(p) => p.alpha_or_one() <= 0.05,
        None => false,
    }
}

fn finding_ignore_or_value(item: &Finding) -> String {
    match item.extras.get("ignoreValue") {
        Some(Value::String(s)) if !s.is_empty() => return s.clone(),
        _ => {}
    }
    match item.extras.get("value") {
        Some(Value::String(s)) if !s.is_empty() => s.clone(),
        _ => String::new(),
    }
}

re!(GOOGLE_FONTS_LABEL_RE, ci("google fonts"));

fn canonical_design_finding_key(item: &Finding) -> Option<String> {
    let ap = item.antipattern.as_str();
    if !ap.starts_with("design-system-") {
        return None;
    }
    let value = finding_ignore_or_value(item);
    match ap {
        "design-system-font" => {
            let context = if GOOGLE_FONTS_LABEL_RE.is_match(&item.snippet) {
                "google-font"
            } else {
                "font"
            };
            let font = normalize_font_name(&value);
            if font.is_empty() {
                None
            } else {
                Some(format!("{ap}:{context}:{font}"))
            }
        }
        "design-system-color" => {
            if let Some(parsed) = parse_design_color(&value) {
                return Some(format!("{ap}:color:{}", color_key(&parsed)));
            }
            let label = js::to_lower_case(&css_color_label(&value));
            if label.is_empty() {
                None
            } else {
                Some(format!("{ap}:color:{label}"))
            }
        }
        "design-system-radius" | "design-system-font-size" => {
            let kind = if ap == "design-system-radius" {
                "radius"
            } else {
                "font-size"
            };
            let trimmed = js::trim(&value);
            if let Some(px) = resolve_length_px(Some(trimmed), 16.0) {
                if px.is_finite() {
                    return Some(format!(
                        "{ap}:{kind}:{}",
                        number_to_string(math_round(px * 100.0) / 100.0)
                    ));
                }
            }
            let label = js::to_lower_case(trimmed);
            if label.is_empty() {
                None
            } else {
                Some(format!("{ap}:{kind}:{label}"))
            }
        }
        _ => None,
    }
}

/// JS: design-system.mjs#mergeDesignSystemFindings
pub fn merge_design_system_findings(groups: Vec<Vec<Finding>>) -> Vec<Finding> {
    let mut out: Vec<Finding> = Vec::new();
    let mut seen: Vec<(String, usize)> = Vec::new();
    for group in groups {
        for item in group {
            if let Some(key) = canonical_design_finding_key(&item) {
                if let Some((_, idx)) = seen.iter().find(|(k, _)| *k == key) {
                    let existing = &mut out[*idx];
                    if existing.line <= 0.0 && item.line > 0.0 {
                        existing.line = item.line;
                    }
                    continue;
                }
                seen.push((key, out.len()));
            }
            out.push(item);
        }
    }
    out
}

fn dedupe_design_findings(findings: Vec<Finding>) -> Vec<Finding> {
    let mut out: Vec<Finding> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    for item in findings {
        let value = {
            let iv = finding_ignore_or_value_only(&item);
            if iv.is_empty() {
                item.snippet.clone()
            } else {
                iv
            }
        };
        let key = format!(
            "{}\0{}\0{}",
            item.antipattern,
            number_to_string(if item.line != 0.0 { item.line } else { 0.0 }),
            normalize_font_name(&value)
        );
        if seen.contains(&key) {
            continue;
        }
        seen.push(key);
        out.push(item);
    }
    out
}

fn finding_ignore_or_value_only(item: &Finding) -> String {
    match item.extras.get("ignoreValue") {
        Some(Value::String(s)) if !s.is_empty() => s.clone(),
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── #570 monorepo DESIGN.md inheritance ─────────────────────────────────
    // Mirrors tests/detect-cli-design-monorepo.test.mjs (public repo main,
    // 47e41195 + 5d7c1cce + e975bec4 + 91f2c7b4) at the findDesignRoot level.

    struct TempDir(std::path::PathBuf);
    impl TempDir {
        fn new(prefix: &str) -> TempDir {
            let d = std::env::temp_dir().join(format!(
                "impeccable-ds-{}-{}-{:?}",
                prefix,
                std::process::id(),
                std::thread::current().id()
            ));
            let _ = std::fs::remove_dir_all(&d);
            std::fs::create_dir_all(&d).unwrap();
            TempDir(std::fs::canonicalize(&d).unwrap())
        }
        fn path(&self) -> String {
            self.0.to_string_lossy().into_owned()
        }
        fn write(&self, rel: &str, content: &str) {
            let p = self.0.join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, content).unwrap();
        }
        fn mkdir(&self, rel: &str) {
            std::fs::create_dir_all(self.0.join(rel)).unwrap();
        }
        fn join(&self, rel: &str) -> String {
            self.0.join(rel).to_string_lossy().into_owned()
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    const DESIGN_MD: &str = "---\ntypography:\n  body:\n    fontFamily: \"Palatino, Georgia, serif\"\n---\n# Project A Design System\n";

    fn root_of(dir: &TempDir, rel: &str, home: &str) -> Option<DesignRoot> {
        find_design_root(&dir.join(rel), "/", home)
    }

    /// An isolated home no walk in these fixtures ever reaches.
    fn far_home() -> String {
        "/nonexistent-home-for-design-system-tests".to_string()
    }

    #[test]
    fn monorepo_pnpm_workspace_inherits_root_design() {
        let d = TempDir::new("pnpm");
        d.write("DESIGN.md", DESIGN_MD);
        d.write("pnpm-workspace.yaml", "packages:\n  - 'apps/*'\n");
        d.write("apps/web/package.json", "{\"name\":\"web\"}");
        let found = root_of(&d, "apps/web", &far_home()).unwrap();
        assert_eq!(found.dir, d.path());
        assert!(found.has_design);
    }

    #[test]
    fn monorepo_npm_workspaces_and_yarn_object_form() {
        let d = TempDir::new("npm");
        d.write("DESIGN.md", DESIGN_MD);
        d.write("package.json", "{\"name\":\"mono\",\"workspaces\":[\"packages/*\"]}");
        d.write("packages/ui/package.json", "{\"name\":\"ui\"}");
        let found = root_of(&d, "packages/ui", &far_home()).unwrap();
        assert_eq!((found.dir, found.has_design), (d.path(), true));

        let y = TempDir::new("yarnobj");
        y.write("DESIGN.md", DESIGN_MD);
        y.write("package.json", "{\"name\":\"mono\",\"workspaces\":{\"packages\":[\"packages/*\"]}}");
        y.write("packages/ui/package.json", "{\"name\":\"ui\"}");
        let found = root_of(&y, "packages/ui", &far_home()).unwrap();
        assert_eq!((found.dir, found.has_design), (y.path(), true));
    }

    #[test]
    fn monorepo_marker_roots_own_apps_and_packages() {
        for marker in ["turbo.json", "nx.json"] {
            let d = TempDir::new(&marker.replace('.', "-"));
            d.write("DESIGN.md", DESIGN_MD);
            d.write("package.json", "{\"name\":\"mono\"}");
            d.write(marker, "{}");
            d.write("apps/web/package.json", "{\"name\":\"web\"}");
            let found = root_of(&d, "apps/web", &far_home()).unwrap();
            assert_eq!((found.dir, found.has_design), (d.path(), true), "{}", marker);
        }
    }

    #[test]
    fn monorepo_lerna_and_impeccable_project_roots() {
        let d = TempDir::new("lerna");
        d.write("DESIGN.md", DESIGN_MD);
        d.write("lerna.json", "{\"packages\":[\"modules/*\"]}");
        d.write("modules/web/package.json", "{\"name\":\"web\"}");
        let found = root_of(&d, "modules/web", &far_home()).unwrap();
        assert_eq!((found.dir, found.has_design), (d.path(), true));

        let i = TempDir::new("iroots");
        i.write("DESIGN.md", DESIGN_MD);
        i.write(".impeccable/config.json", "{\"projectRoots\":[\"sites/*\"]}");
        i.write("sites/docs/package.json", "{\"name\":\"docs\"}");
        let found = root_of(&i, "sites/docs", &far_home()).unwrap();
        assert_eq!((found.dir, found.has_design), (i.path(), true));
    }

    #[test]
    fn pnpm_flow_list_with_inline_comment() {
        // 91f2c7b4: an inline YAML comment must not defeat glob recognition.
        let d = TempDir::new("flow");
        d.write("DESIGN.md", DESIGN_MD);
        d.write("pnpm-workspace.yaml", "packages: [\"services/*\"] # deploy targets\n");
        d.write("services/api/package.json", "{\"name\":\"api\"}");
        let found = root_of(&d, "services/api", &far_home()).unwrap();
        assert_eq!((found.dir, found.has_design), (d.path(), true));
    }

    #[test]
    fn workspace_owned_design_md_wins() {
        let d = TempDir::new("wsdesign");
        d.write("DESIGN.md", DESIGN_MD);
        d.write("pnpm-workspace.yaml", "packages:\n  - 'apps/*'\n");
        d.write("apps/web/package.json", "{\"name\":\"web\"}");
        d.write("apps/web/DESIGN.md", DESIGN_MD);
        let found = root_of(&d, "apps/web", &far_home()).unwrap();
        assert_eq!((found.dir, found.has_design), (d.join("apps/web"), true));
    }

    #[test]
    fn negated_workspace_package_does_not_inherit() {
        let d = TempDir::new("negated");
        d.write("DESIGN.md", DESIGN_MD);
        d.write(
            "package.json",
            "{\"name\":\"mono\",\"workspaces\":[\"packages/*\",\"!packages/excluded\"]}",
        );
        d.write("packages/included/package.json", "{\"name\":\"included\"}");
        d.write("packages/excluded/package.json", "{\"name\":\"excluded\"}");
        let inc = root_of(&d, "packages/included", &far_home()).unwrap();
        assert_eq!((inc.dir, inc.has_design), (d.path(), true));
        let exc = root_of(&d, "packages/excluded", &far_home()).unwrap();
        assert_eq!((exc.dir.clone(), exc.has_design), (d.join("packages/excluded"), false));
    }

    #[test]
    fn stray_nested_package_outside_globs_does_not_inherit() {
        let d = TempDir::new("stray");
        d.write("DESIGN.md", DESIGN_MD);
        d.write("pnpm-workspace.yaml", "packages:\n  - 'apps/*'\n");
        d.write("apps/web/package.json", "{\"name\":\"web\"}");
        d.write("vendor/tool/package.json", "{\"name\":\"tool\"}");
        let web = root_of(&d, "apps/web", &far_home()).unwrap();
        assert!(web.has_design);
        let vendor = root_of(&d, "vendor/tool", &far_home()).unwrap();
        assert_eq!((vendor.dir.clone(), vendor.has_design), (d.join("vendor/tool"), false));
    }

    #[test]
    fn nested_separate_repo_inherits_nothing() {
        let d = TempDir::new("nestedrepo");
        d.write("DESIGN.md", DESIGN_MD);
        d.write("pnpm-workspace.yaml", "packages:\n  - 'apps/*'\n");
        d.mkdir("vendor/other/.git");
        d.write("vendor/other/package.json", "{\"name\":\"other\"}");
        let found = root_of(&d, "vendor/other", &far_home()).unwrap();
        assert_eq!((found.dir.clone(), found.has_design), (d.join("vendor/other"), false));
    }

    #[test]
    fn non_monorepo_nested_package_does_not_inherit() {
        let d = TempDir::new("nestedpkg");
        d.write("DESIGN.md", DESIGN_MD);
        d.write("package.json", "{\"name\":\"root\"}");
        d.mkdir(".git");
        d.write("packages/nested/package.json", "{\"name\":\"nested\"}");
        let found = root_of(&d, "packages/nested", &far_home()).unwrap();
        assert_eq!((found.dir.clone(), found.has_design), (d.join("packages/nested"), false));
    }

    #[test]
    fn single_package_repo_and_docs_fallback_still_inherit() {
        let d = TempDir::new("single");
        d.write("DESIGN.md", DESIGN_MD);
        d.write("package.json", "{\"name\":\"app\"}");
        d.mkdir("src");
        let found = root_of(&d, "src", &far_home()).unwrap();
        assert_eq!((found.dir, found.has_design), (d.path(), true));

        let f = TempDir::new("docsfb");
        f.write("docs/DESIGN.md", DESIGN_MD);
        f.write("package.json", "{\"name\":\"app\"}");
        f.mkdir("src");
        let found = root_of(&f, "src", &far_home()).unwrap();
        assert_eq!((found.dir, found.has_design), (f.path(), true));
    }

    #[test]
    fn globstar_negation_spares_sibling_workspaces() {
        let d = TempDir::new("globstar");
        d.write("DESIGN.md", DESIGN_MD);
        d.write(
            "pnpm-workspace.yaml",
            "packages:\n  - 'packages/*'\n  - 'components/**'\n  - '!**/test/**'\n",
        );
        d.write("packages/ui/package.json", "{\"name\":\"ui\"}");
        d.write("components/button/package.json", "{\"name\":\"button\"}");
        d.write("packages/ui/test/fixture/package.json", "{\"name\":\"fixture\"}");
        let ui = root_of(&d, "packages/ui", &far_home()).unwrap();
        assert_eq!((ui.dir, ui.has_design), (d.path(), true));
        let button = root_of(&d, "components/button", &far_home()).unwrap();
        assert_eq!((button.dir, button.has_design), (d.path(), true));
        let test = root_of(&d, "packages/ui/test/fixture", &far_home()).unwrap();
        assert_eq!(
            (test.dir.clone(), test.has_design),
            (d.join("packages/ui/test/fixture"), false)
        );
    }

    #[test]
    fn star_owns_direct_children_and_their_nested_packages_only() {
        let d = TempDir::new("star");
        d.write("DESIGN.md", DESIGN_MD);
        d.write("package.json", "{\"name\":\"mono\",\"workspaces\":[\"*\"]}");
        d.write("web/package.json", "{\"name\":\"web\"}");
        d.write("web/examples/package.json", "{\"name\":\"examples\"}");
        d.write("vendor/tool/package.json", "{\"name\":\"tool\"}");
        let web = root_of(&d, "web", &far_home()).unwrap();
        assert_eq!((web.dir, web.has_design), (d.path(), true));
        // 47e41195: a nested package under a matched workspace is still owned.
        let nested = root_of(&d, "web/examples", &far_home()).unwrap();
        assert_eq!((nested.dir, nested.has_design), (d.path(), true));
        let vendor = root_of(&d, "vendor/tool", &far_home()).unwrap();
        assert_eq!((vendor.dir.clone(), vendor.has_design), (d.join("vendor/tool"), false));
    }

    #[test]
    fn impeccable_project_roots_beat_package_manager_negation() {
        // 47e41195: projectRoots govern a path they match even when
        // package-manager workspaces exclude it.
        let d = TempDir::new("irootswin");
        d.write("DESIGN.md", DESIGN_MD);
        d.write(".impeccable/config.json", "{\"projectRoots\":[\"sites/*\"]}");
        d.write(
            "package.json",
            "{\"name\":\"mono\",\"workspaces\":[\"sites/*\",\"!sites/docs\"]}",
        );
        d.write("sites/docs/package.json", "{\"name\":\"docs\"}");
        let found = root_of(&d, "sites/docs", &far_home()).unwrap();
        assert_eq!((found.dir, found.has_design), (d.path(), true));
    }

    #[test]
    fn home_directory_is_never_an_owning_root() {
        // e975bec4: a workspace-declaring $HOME must not leak its DESIGN.md
        // into every git-less project beneath it.
        let home = TempDir::new("home");
        home.write("DESIGN.md", DESIGN_MD);
        home.write("pnpm-workspace.yaml", "packages:\n  - 'apps/*'\n");
        home.write("project/package.json", "{\"name\":\"p\"}");
        let found = find_design_root(&home.join("project"), "/", &home.path()).unwrap();
        assert_eq!((found.dir.clone(), found.has_design), (home.join("project"), false));
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_home_still_stops_the_walk() {
        let real = TempDir::new("realhome");
        real.write("DESIGN.md", DESIGN_MD);
        real.write("pnpm-workspace.yaml", "packages:\n  - 'apps/*'\n");
        real.write("project/package.json", "{\"name\":\"p\"}");
        let link = std::env::temp_dir().join(format!("impeccable-ds-linkhome-{}", std::process::id()));
        let _ = std::fs::remove_file(&link);
        std::os::unix::fs::symlink(&real.0, &link).unwrap();
        // HOME is the symlink; the target is the physical path, so a
        // logical-only comparison would walk straight past home and inherit.
        let found = find_design_root(&real.join("project"), "/", &link.to_string_lossy()).unwrap();
        let _ = std::fs::remove_file(&link);
        assert_eq!((found.dir.clone(), found.has_design), (real.join("project"), false));
    }

    #[test]
    fn frontmatter_and_fonts() {
        let md = "---\ntypography:\n  body:\n    fontFamily: \"Palatino, Georgia, serif\"\ncolors:\n  primary: \"#1a4d8f\"\n---\nbody";
        let fm = parse_frontmatter(md).unwrap();
        let ds = normalize_design_system(Some(&fm), None, None, None, false);
        assert_eq!(
            ds.allowed_fonts,
            vec!["palatino".to_string(), "georgia".to_string()]
        );
        assert!(ds.has_colors);
        assert!(!is_allowed_font("inter", Some(&ds)));
        let f = check_source_design_system(
            "a { color: #ff0000; font-family: Inter }",
            "x.css",
            Some(&ds),
        );
        assert_eq!(f.len(), 2);
        assert_eq!(
            f[0].snippet,
            "font-family: Inter is not declared in DESIGN.md typography"
        );
    }

    // upstream 1bcdf80f / #687: var() radius fallbacks leave the closing
    // paren on the final token; strip it so `8px)` is not read as unitless.
    #[test]
    fn var_radius_fallback_strips_closing_paren() {
        let md = "---\nrounded:\n  md: \"8px\"\n---\nbody";
        let fm = parse_frontmatter(md).unwrap();
        let ds = normalize_design_system(Some(&fm), None, None, None, false);
        let css = ".good {\n  border-radius: var(--radius-md, 8px);\n}\n.bad {\n  border-radius: var(--radius-custom, 18px);\n}\n";
        let f = check_source_design_system(css, "/tmp/radius-fallbacks.css", Some(&ds));
        let got: Vec<(String, Option<String>)> = f
            .iter()
            .map(|item| {
                (
                    item.antipattern.clone(),
                    item.extras.get("ignoreValue").and_then(|v| v.as_str().map(String::from)),
                )
            })
            .collect();
        assert_eq!(
            got,
            vec![("design-system-radius".to_string(), Some("18px".to_string()))]
        );
    }

    #[test]
    fn yaml_scalars() {
        assert_eq!(parse_scalar("\"a\\\"b\""), Value::String("a\"b".into()));
        assert_eq!(parse_scalar("'it''s'"), Value::String("it's".into()));
        assert_eq!(js_string(&parse_scalar("007")), "7");
    }
}
