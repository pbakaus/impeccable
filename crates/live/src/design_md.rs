//! JS: lib/design-parser.mjs — the full DESIGN.md model the live server hands
//! to the design panel as `/design-system.json`'s `parsed` field.
//!
//! Byte-for-byte parity target: `JSON.stringify(parseDesignMd(md))`. Every
//! `serde_json::Map` here is built in the same order the JS object literal
//! builds its keys, and a key whose JS value would be `undefined` is omitted.

use impeccable_context::util::js_trim;
use impeccable_core::js::{ci, is_js_whitespace, to_lower_case, to_upper_case, WS_CHARS};
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{Map, Value};

/// JS: CANONICAL_SECTIONS. Array order is also match precedence.
const CANONICAL_SECTIONS: [&str; 8] = [
    "Overview",
    "Colors",
    "Typography",
    "Layout",
    "Elevation",
    "Shapes",
    "Components",
    "Do's and Don'ts",
];

// ---------- small JS string helpers ----------

/// JS `String.prototype.trimEnd()`.
fn js_trim_end(s: &str) -> &str {
    s.trim_end_matches(is_js_whitespace)
}

/// JS `String.prototype.trimStart()`.
fn js_trim_start(s: &str) -> &str {
    s.trim_start_matches(is_js_whitespace)
}

/// JS `md.split(/\r?\n/)`.
fn split_lines(md: &str) -> Vec<&str> {
    md.split('\n')
        .map(|l| l.strip_suffix('\r').unwrap_or(l))
        .collect()
}

/// JS regex `.` — every character except a LineTerminator. The `regex`
/// crate's `.` excludes only `\n`, so a lone CR would be swallowed.
const DOT: &str = r"[^\n\r\x{2028}\x{2029}]";

fn re(pattern: &str) -> Regex {
    Regex::new(pattern).expect("design_md: static regex")
}

// ---------- Frontmatter (Stitch YAML subset) ----------

/// JS `OrdinaryOwnPropertyKeys`: array-index keys come first in ascending
/// numeric order, then every other key in insertion order. `JSON.stringify`
/// walks the object in exactly that order, so a frontmatter map with numeric
/// YAML keys (`typography.scale`) serializes differently from insertion order.
fn array_index(k: &str) -> Option<u32> {
    if k.is_empty() || k.len() > 10 || !k.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    if k.len() > 1 && k.starts_with('0') {
        return None;
    }
    let v: u64 = k.parse().ok()?;
    if v >= 4_294_967_295 {
        return None;
    }
    Some(v as u32)
}

fn js_key_order(m: Map<String, Value>) -> Map<String, Value> {
    let mut idx: Vec<(u32, String, Value)> = Vec::new();
    let mut rest: Vec<(String, Value)> = Vec::new();
    for (k, v) in m {
        let v = match v {
            Value::Object(o) => Value::Object(js_key_order(o)),
            other => other,
        };
        match array_index(&k) {
            Some(i) => idx.push((i, k, v)),
            None => rest.push((k, v)),
        }
    }
    idx.sort_by_key(|(i, _, _)| *i);
    let mut out = Map::new();
    for (_, k, v) in idx {
        out.insert(k, v);
    }
    for (k, v) in rest {
        out.insert(k, v);
    }
    out
}

/// JS: parseFrontmatter(md)
fn parse_frontmatter(md: &str) -> (Option<Map<String, Value>>, String) {
    let lines = split_lines(md);
    if lines.first().map(|l| js_trim(l)) != Some("---") {
        return (None, md.to_string());
    }
    let mut end: Option<usize> = None;
    for (i, l) in lines.iter().enumerate().skip(1) {
        if js_trim(l) == "---" {
            end = Some(i);
            break;
        }
    }
    let Some(end) = end else {
        return (None, md.to_string());
    };
    let yaml = lines[1..end].join("\n");
    let body = lines[end + 1..].join("\n");
    (Some(js_key_order(parse_yaml_subset(&yaml))), body)
}

/// JS: findTopLevelColon(s) — index in chars (used only for slicing the same
/// string, so the unit only has to be self-consistent). Returns a byte offset.
fn find_top_level_colon(s: &str) -> Option<usize> {
    let chars: Vec<(usize, char)> = s.char_indices().collect();
    let mut in_quote: Option<char> = None;
    for i in 0..chars.len() {
        let ch = chars[i].1;
        if let Some(q) = in_quote {
            if ch == q && (i == 0 || chars[i - 1].1 != '\\') {
                in_quote = None;
            }
        } else if ch == '"' || ch == '\'' {
            in_quote = Some(ch);
        } else if ch == ':' {
            return Some(chars[i].0);
        }
    }
    None
}

/// JS: unquoteYamlKey(key)
fn unquote_yaml_key(key: &str) -> String {
    let c: Vec<char> = key.chars().collect();
    if c.len() >= 2
        && ((c[0] == '"' && c[c.len() - 1] == '"') || (c[0] == '\'' && c[c.len() - 1] == '\''))
    {
        return c[1..c.len() - 1].iter().collect();
    }
    // JS-PARITY: `"\"".startsWith('"') && endsWith('"')` is true for the single
    // character too, and `slice(1, -1)` then yields ''.
    if c.len() == 1 && (c[0] == '"' || c[0] == '\'') {
        return String::new();
    }
    key.to_string()
}

/// JS: stripInlineYamlComment(s)
fn strip_inline_yaml_comment(s: &str) -> String {
    let chars: Vec<(usize, char)> = s.char_indices().collect();
    let mut in_quote: Option<char> = None;
    for i in 0..chars.len() {
        let ch = chars[i].1;
        if let Some(q) = in_quote {
            if ch == q && (i == 0 || chars[i - 1].1 != '\\') {
                in_quote = None;
            }
        } else if ch == '"' || ch == '\'' {
            in_quote = Some(ch);
        } else if ch == '#' && i > 0 && is_js_whitespace(chars[i - 1].1) {
            return js_trim_end(&s[..chars[i].0]).to_string();
        }
    }
    s.to_string()
}

/// JS: unescapeYamlDoubleQuoted(body)
fn unescape_yaml_double_quoted(body: &str) -> String {
    let chars: Vec<char> = body.chars().collect();
    let mut out = String::new();
    let mut i = 0usize;
    while i < chars.len() {
        let ch = chars[i];
        if ch != '\\' || i == chars.len() - 1 {
            out.push(ch);
            i += 1;
            continue;
        }
        let next = chars[i + 1];
        let simple = match next {
            '0' => Some('\0'),
            'a' => Some('\u{7}'),
            'b' => Some('\u{8}'),
            't' => Some('\t'),
            'n' => Some('\n'),
            'v' => Some('\u{b}'),
            'f' => Some('\u{c}'),
            'r' => Some('\r'),
            'e' => Some('\u{1b}'),
            ' ' => Some(' '),
            '"' => Some('"'),
            '/' => Some('/'),
            '\\' => Some('\\'),
            'N' => Some('\u{85}'),
            '_' => Some('\u{a0}'),
            'L' => Some('\u{2028}'),
            'P' => Some('\u{2029}'),
            _ => None,
        };
        if let Some(c) = simple {
            out.push(c);
            i += 2;
            continue;
        }
        let hex_len = match next {
            'x' => Some(2usize),
            'u' => Some(4usize),
            'U' => Some(8usize),
            _ => None,
        };
        if let Some(hl) = hex_len {
            let start = (i + 2).min(chars.len());
            let stop = (i + 2 + hl).min(chars.len());
            let hex: String = chars[start..stop].iter().collect();
            if hex.chars().count() == hl && hex.chars().all(|c| c.is_ascii_hexdigit()) {
                if let Ok(cp) = u32::from_str_radix(&hex, 16) {
                    if cp <= 0x10ffff {
                        // JS-PARITY: String.fromCodePoint accepts lone surrogates;
                        // Rust cannot hold one, so it becomes U+FFFD.
                        out.push(char::from_u32(cp).unwrap_or('\u{FFFD}'));
                        i += 2 + hl;
                        continue;
                    }
                }
            }
        }
        out.push(ch);
        i += 1;
    }
    out
}

/// JS `Number(s)` rendered the way `JSON.stringify` would render it.
/// Integral values print without a fraction; the digits come from JS's
/// `Number.prototype.toString`, so 2^53..2^64 integers keep JS's trailing
/// zeros rather than the exact binary value.
///
/// JS-PARITY gap: `|v| >= 1e21` switches JS to `1e+21` exponent form, which
/// serde renders as `1e21`. Unreachable from a DESIGN.md token value.
fn js_number_value(s: &str) -> Value {
    let v: f64 = s.parse().unwrap_or(f64::NAN);
    if !v.is_finite() {
        return Value::Null;
    }
    let text = impeccable_core::js::number_to_string(v);
    if let Ok(i) = text.parse::<i64>() {
        return Value::from(i);
    }
    if let Ok(u) = text.parse::<u64>() {
        return Value::from(u);
    }
    serde_json::Number::from_f64(v)
        .map(Value::Number)
        .unwrap_or(Value::Null)
}

/// JS: parseScalar(raw)
fn parse_scalar(raw: &str) -> Value {
    let s = js_trim(raw);
    let c: Vec<char> = s.chars().collect();
    if c.len() >= 2 && c[0] == '"' && c[c.len() - 1] == '"' {
        let inner: String = c[1..c.len() - 1].iter().collect();
        return Value::String(unescape_yaml_double_quoted(&inner));
    }
    if c.len() >= 2 && c[0] == '\'' && c[c.len() - 1] == '\'' {
        let inner: String = c[1..c.len() - 1].iter().collect();
        return Value::String(inner.replace("''", "'"));
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
    let d = s.strip_prefix('-').unwrap_or(s);
    // /^-?\d+$/
    if !d.is_empty() && d.bytes().all(|b| b.is_ascii_digit()) {
        return js_number_value(s);
    }
    // /^-?\d*\.\d+$/
    if let Some((a, b)) = d.split_once('.') {
        if a.bytes().all(|ch| ch.is_ascii_digit())
            && !b.is_empty()
            && b.bytes().all(|ch| ch.is_ascii_digit())
        {
            return js_number_value(s);
        }
    }
    Value::String(s.to_string())
}

fn yaml_map_at<'a>(
    root: &'a mut Map<String, Value>,
    path: &[String],
) -> &'a mut Map<String, Value> {
    let mut cur = root;
    for k in path {
        let entry = cur
            .entry(k.clone())
            .or_insert_with(|| Value::Object(Map::new()));
        if !entry.is_object() {
            *entry = Value::Object(Map::new());
        }
        cur = entry.as_object_mut().unwrap();
    }
    cur
}

/// JS: parseYamlSubset(yaml)
fn parse_yaml_subset(yaml: &str) -> Map<String, Value> {
    let lines = split_lines(yaml);
    let mut root: Map<String, Value> = Map::new();
    // JS keeps live object references on the stack; we replay by key path,
    // which is equivalent because every stack entry deeper than a rewritten
    // key is popped before the rewrite happens.
    let mut stack: Vec<(i64, Vec<String>)> = vec![(-1, vec![])];

    for raw in lines {
        if js_trim(raw).is_empty() || COMMENT_LINE_RE.is_match(raw) {
            continue;
        }
        // JS: raw.match(/^\s*/)[0].length — UTF-16 length of the leading run,
        // all of which are BMP whitespace characters, so char count matches.
        let ws_bytes: usize = raw
            .chars()
            .take_while(|c| is_js_whitespace(*c))
            .map(|c| c.len_utf8())
            .sum();
        let indent = raw.chars().take_while(|c| is_js_whitespace(*c)).count() as i64;
        let content = &raw[ws_bytes..];

        let Some(colon) = find_top_level_colon(content) else {
            continue;
        };
        while stack.len() > 1 && stack.last().unwrap().0 >= indent {
            stack.pop();
        }

        let key = unquote_yaml_key(js_trim(&content[..colon]));
        let rest = strip_inline_yaml_comment(js_trim(&content[colon + 1..]));
        let path = stack.last().unwrap().1.clone();
        let parent = yaml_map_at(&mut root, &path);

        if rest.is_empty() {
            parent.insert(key.clone(), Value::Object(Map::new()));
            let mut p = path.clone();
            p.push(key);
            stack.push((indent, p));
        } else {
            parent.insert(key, parse_scalar(&rest));
        }
    }

    root
}

// ---------- static regexes ----------

static COMMENT_LINE_RE: Lazy<Regex> = Lazy::new(|| re(&format!(r"^[{WS_CHARS}]*#")));
static HEX_RE: Lazy<Regex> = Lazy::new(|| re(r"#[0-9a-fA-F]{3,8}(?-u:\b)"));
static OKLCH_RE: Lazy<Regex> = Lazy::new(|| re(&format!(r"{}\([^)]+\)", ci("oklch"))));

static H2_RE: Lazy<Regex> = Lazy::new(|| {
    re(&format!(
        r"^##[{WS_CHARS}]+(?:[0-9]+\.[{WS_CHARS}]*)?([^:\n]+?)(?::[{WS_CHARS}]*({DOT}+))?$"
    ))
});
static TITLE_HASH_RE: Lazy<Regex> = Lazy::new(|| re(&format!(r"^#[{WS_CHARS}]+")));
static H3_RE: Lazy<Regex> = Lazy::new(|| re(&format!(r"^###[{WS_CHARS}]+({DOT}+?)[{WS_CHARS}]*$")));

static CANONICAL_WORD_RES: Lazy<Vec<Regex>> = Lazy::new(|| {
    CANONICAL_SECTIONS
        .iter()
        .map(|c| {
            let key = to_lower_case(&normalize_apostrophes(c));
            re(&format!(r"(?-u:\b){}(?-u:\b)", regex::escape(&key)))
        })
        .collect()
});

static HR_RE: Lazy<Regex> = Lazy::new(|| re(r"^(?:-{3,}|\*{3,}|_{3,})$"));
static BULLET_LEAD_RE: Lazy<Regex> = Lazy::new(|| re(&format!(r"^[-*][{WS_CHARS}]")));
static BULLET_RE: Lazy<Regex> =
    Lazy::new(|| re(&format!(r"^[{WS_CHARS}]*[-*][{WS_CHARS}]+({DOT}+)$")));
static BULLET_CONT_RE: Lazy<Regex> =
    Lazy::new(|| re(&format!(r"^[{WS_CHARS}]{{2,}}[^{WS_CHARS}]")));

static BOLD_RE: Lazy<Regex> = Lazy::new(|| re(&format!(r"\*\*({DOT}+?)\*\*")));
static INLINE_RULE_RE: Lazy<Regex> = Lazy::new(|| re(r"\*\*(The [^*]+?Rule)\.\*\*"));
static TRAIL_H2_RE: Lazy<Regex> = Lazy::new(|| re(r"\n##[^\n]*$"));
static TRAIL_H3_RE: Lazy<Regex> = Lazy::new(|| re(r"\n###[^\n]*$"));
static QUOTES_RE: Lazy<Regex> = Lazy::new(|| re("[\"\u{201C}\u{201D}]"));
static RULE_HEADER_RE: Lazy<Regex> = Lazy::new(|| {
    re(&format!(
        r"^{}(?-u:\b){DOT}*(?-u:\b)({}|{}|{})(?-u:\b)",
        ci("The"),
        ci("Rule"),
        ci("Fallback"),
        ci("Principle")
    ))
});
static BREAK_HEADING_RE: Lazy<Regex> =
    Lazy::new(|| re(&format!(r"^##[{WS_CHARS}]|^###[{WS_CHARS}]")));
static NEWLINES_RE: Lazy<Regex> = Lazy::new(|| re(r"\n+"));
static RULE_BULLET_RE: Lazy<Regex> =
    Lazy::new(|| re(&format!(r"^\*\*([^*]+?)\*\*[{WS_CHARS}]*({DOT}+)$")));
static TRAILING_PUNCT_RE: Lazy<Regex> = Lazy::new(|| re(&format!(r"[.:][{WS_CHARS}]*$")));
static RULE_NAME_C_RE: Lazy<Regex> = Lazy::new(|| {
    re(&format!(
        r"^{}(?-u:\b){DOT}+(?-u:\b)({}|{}|{})$",
        ci("The"),
        ci("Rule"),
        ci("Fallback"),
        ci("Principle")
    ))
});

static NORTH_STAR_RE: Lazy<Regex> = Lazy::new(|| {
    re(&format!(
        r#"\*\*Creative North Star:[{WS_CHARS}]*"([^"]+)"\*\*"#
    ))
});
static KEYCHAR_RE: Lazy<Regex> = Lazy::new(|| {
    re(&format!(
        r"\*\*Key Characteristics:\*\*[{WS_CHARS}]*\n((?s:.)+?)(?:\n##|\n###|$)"
    ))
});

static ROLE_KEYWORDS_RE: Lazy<Regex> = Lazy::new(|| {
    re(&format!(
        r"^({}|{}|{}|{}|{})(?-u:\b)",
        ci("primary"),
        ci("secondary"),
        ci("tertiary"),
        ci("neutral"),
        ci("accent")
    ))
});
static NAMED_RULES_RE: Lazy<Regex> = Lazy::new(|| re(&format!("{}[sS]?", ci("Named Rule"))));
static THE_PREFIX_RE: Lazy<Regex> = Lazy::new(|| re(&format!(r"^{}[{WS_CHARS}]", ci("The"))));

static COLOR_BOLD_RE: Lazy<Regex> =
    Lazy::new(|| re(&format!(r"^\*\*({DOT}+?)\*\*[{WS_CHARS}]*({DOT}*)$")));
static COLOR_STITCH_RE: Lazy<Regex> = Lazy::new(|| {
    re(&format!(
        r"^\*\*([^*]+?)[{WS_CHARS}]*\(([^)]+)\):\*\*[{WS_CHARS}]*({DOT}*)$"
    ))
});

static FONT_LINE_RE: Lazy<Regex> = Lazy::new(|| {
    re(&format!(
        r"\*\*([A-Za-z0-9_/{WS_CHARS}]+?)Font:\*\*[{WS_CHARS}]*([^\n(]+?)(?:[{WS_CHARS}]*\(with[{WS_CHARS}]+([^)]+)\))?(?:[{WS_CHARS}]*$|[{WS_CHARS}]*[\n\r\x{{2028}}\x{{2029}}])"
    ))
});
static FONT_STITCH_RE: Lazy<Regex> = Lazy::new(|| {
    re(&format!(
        r"\*\*([A-Za-z0-9_&/{WS_CHARS}]+?)[{WS_CHARS}]*\(([^)]+)\):\*\*[{WS_CHARS}]*({DOT}+)"
    ))
});
static FONT_PARA_A_RE: Lazy<Regex> =
    Lazy::new(|| re(&format!(r"^\*\*[A-Za-z0-9_/&{WS_CHARS}]+{}", ci("Font"))));
static FONT_PARA_B_RE: Lazy<Regex> =
    Lazy::new(|| re(&format!(r"^\*\*[A-Za-z0-9_/&{WS_CHARS}]+\([^)]+\)")));
static WS_RUN_RE: Lazy<Regex> = Lazy::new(|| re(&format!(r"[{WS_CHARS}]+")));
static AMP_RE: Lazy<Regex> = Lazy::new(|| re(&format!(r"[{WS_CHARS}]*&[{WS_CHARS}]*")));
static HIERARCH_RE: Lazy<Regex> = Lazy::new(|| re(&ci("hierarch")));
static TYPE_BULLET_RE: Lazy<Regex> = Lazy::new(|| {
    re(&format!(
        r"^\*\*({DOT}+?)\*\*[{WS_CHARS}]*\(([^)]+)\):[{WS_CHARS}]*({DOT}*)$"
    ))
});

static INLINE_SHADOW_RE: Lazy<Regex> = Lazy::new(|| {
    re(&format!(
        r"{}[{WS_CHARS}]*:[{WS_CHARS}]*([^`;\n]+)",
        ci("box-shadow")
    ))
});
static SHADOW_TRAIL_RE: Lazy<Regex> = Lazy::new(|| re(r"[`.)]+$"));
static SHADOW_NAME_RE: Lazy<Regex> = Lazy::new(|| {
    re(&format!(
        r"(?-u:\b)([A-Za-z][A-Za-z\- ]{{2,40}})[{WS_CHARS}]+{}(?-u:\b)[^A-Za-z0-9]*$",
        ci("shadow")
    ))
});
static NAME_STRIP_VERB_RE: Lazy<Regex> = Lazy::new(|| {
    // JS: /^(?:use|using|apply|applying|is|are|looks? like)\s+/i — the space
    // between `looks?` and `like` is a literal space, not `\s`.
    re(&format!(
        r"^(?:{}|{}|{}|{}|{}|{}|{}[sS]? {})[{WS_CHARS}]+",
        ci("use"),
        ci("using"),
        ci("apply"),
        ci("applying"),
        ci("is"),
        ci("are"),
        ci("look"),
        ci("like")
    ))
});
static NAME_STRIP_ART_RE: Lazy<Regex> = Lazy::new(|| {
    re(&format!(
        r"^(?:{}|{}|{})[{WS_CHARS}]+",
        ci("a"),
        ci("an"),
        ci("the")
    ))
});
static SHADOW_BULLET_RE: Lazy<Regex> = Lazy::new(|| {
    re(&format!(
        r"^\*\*({DOT}+?)\*\*[{WS_CHARS}]*\(`?([^`]+?)`?\):[{WS_CHARS}]*({DOT}*)$"
    ))
});
static BOX_SHADOW_PREFIX_RE: Lazy<Regex> =
    Lazy::new(|| re(&format!(r"^{}:[{WS_CHARS}]*", ci("box-shadow"))));
static LOOKS_LIKE_SHADOW_RE: Lazy<Regex> = Lazy::new(|| {
    re(&format!(
        r"{}|{}[aA]?\(|(?-u:\b){}(?-u:\b)|(?-u:\b){}(?-u:\b)|^-?[0-9]+[{WS_CHARS}]",
        ci("box-shadow"),
        ci("rgb"),
        ci("px"),
        ci("rem")
    ))
});
static HAS_DIGIT_RE: Lazy<Regex> = Lazy::new(|| re(r"[0-9]"));

static COMPONENT_BULLET_RE: Lazy<Regex> =
    Lazy::new(|| re(&format!(r"^\*\*({DOT}+?):?\*\*:?[{WS_CHARS}]*({DOT}+)$")));
static VARIANT_KEY_RE: Lazy<Regex> = Lazy::new(|| {
    let words = [
        "primary",
        "secondary",
        "tertiary",
        "ghost",
        "hover",
        "focus",
        "active",
        "disabled",
        "default",
        "error",
        "selected",
        "unselected",
        "state",
    ];
    let alts: Vec<String> = words.iter().map(|w| ci(w)).collect();
    re(&format!("^({})$", alts.join("|")))
});

static DO_A_RE: Lazy<Regex> = Lazy::new(|| re(&format!(r"^{}'?{}?:?$", ci("do"), ci("t"))));
static DO_B_RE: Lazy<Regex> = Lazy::new(|| re(&format!(r"^{}:?$", ci("do"))));
static DONT_RE: Lazy<Regex> = Lazy::new(|| re(&format!(r"^{}'?{}:?$", ci("don"), ci("t"))));
static DONT_PREFIX_RE: Lazy<Regex> =
    Lazy::new(|| re(&format!(r"^{}'?{}(?-u:\b)", ci("don"), ci("t"))));
static DO_PREFIX_RE: Lazy<Regex> = Lazy::new(|| re(&format!(r"^{}(?-u:\b)", ci("do"))));

// ---------- Section splitting ----------

struct Section {
    subtitle: Option<String>,
    lines: Vec<String>,
}

struct Subsection {
    name: Option<String>,
    lines: Vec<String>,
}

/// JS: normalizeApostrophes(s)
fn normalize_apostrophes(s: &str) -> String {
    s.replace(['\u{2018}', '\u{2019}'], "'")
}

/// JS: matchCanonicalSection(name)
fn match_canonical_section(name: &str) -> Option<&'static str> {
    let normalized = to_lower_case(&normalize_apostrophes(name));
    for c in CANONICAL_SECTIONS {
        if to_lower_case(&normalize_apostrophes(c)) == normalized {
            return Some(c);
        }
    }
    for (i, c) in CANONICAL_SECTIONS.iter().enumerate() {
        if CANONICAL_WORD_RES[i].is_match(&normalized) {
            return Some(c);
        }
    }
    None
}

/// JS: splitSections(md)
fn split_sections(md: &str) -> (Value, Vec<(&'static str, Section)>) {
    let mut title = Value::Null;
    let mut sections: Vec<(&'static str, Section)> = Vec::new();
    let mut current: Option<&'static str> = None;

    let title_falsy =
        |t: &Value| matches!(t, Value::Null) || t.as_str().map(|s| s.is_empty()).unwrap_or(false);

    for raw in split_lines(md) {
        let line = js_trim_end(raw);

        if title_falsy(&title) && line.starts_with("# ") && !line.starts_with("## ") {
            let stripped = TITLE_HASH_RE.replace(line, "");
            title = Value::String(js_trim(&stripped).to_string());
            continue;
        }

        if let Some(h2) = H2_RE.captures(line) {
            let raw_name = normalize_apostrophes(js_trim(h2.get(1).unwrap().as_str()));
            let subtitle = h2.get(2).map(|m| js_trim(m.as_str()).to_string());
            if let Some(canonical) = match_canonical_section(&raw_name) {
                // JS: sections[canonical] = current — a repeat replaces the
                // earlier entry (and its position, per JS object key order,
                // which nothing downstream reads).
                sections.retain(|(k, _)| *k != canonical);
                sections.push((
                    canonical,
                    Section {
                        subtitle,
                        lines: Vec::new(),
                    },
                ));
                current = Some(canonical);
                continue;
            }
            current = None;
            continue;
        }

        if let Some(name) = current {
            if let Some(entry) = sections.iter_mut().find(|(k, _)| *k == name) {
                entry.1.lines.push(raw.to_string());
            }
        }
    }

    (title, sections)
}

fn find_section<'a>(sections: &'a [(&'static str, Section)], name: &str) -> Option<&'a Section> {
    sections.iter().find(|(k, _)| *k == name).map(|(_, s)| s)
}

/// JS: splitSubsections(lines)
fn split_subsections(lines: &[String]) -> Vec<Subsection> {
    let mut subs: Vec<Subsection> = vec![Subsection {
        name: None,
        lines: Vec::new(),
    }];
    for raw in lines {
        if let Some(h3) = H3_RE.captures(raw) {
            subs.push(Subsection {
                name: Some(js_trim(h3.get(1).unwrap().as_str()).to_string()),
                lines: Vec::new(),
            });
            continue;
        }
        subs.last_mut().unwrap().lines.push(raw.clone());
    }
    subs
}

// ---------- Generic helpers ----------

/// JS: collectParagraphs(lines)
fn collect_paragraphs<S: AsRef<str>>(lines: &[S]) -> Vec<String> {
    let mut paragraphs: Vec<String> = Vec::new();
    let mut buf: Vec<String> = Vec::new();
    for raw in lines {
        let raw = raw.as_ref();
        let trimmed = js_trim(raw);
        if trimmed.is_empty() {
            if !buf.is_empty() {
                paragraphs.push(js_trim(&buf.join(" ")).to_string());
                buf.clear();
            }
            continue;
        }
        if HR_RE.is_match(trimmed) || raw.starts_with('#') || BULLET_LEAD_RE.is_match(raw) {
            if !buf.is_empty() {
                paragraphs.push(js_trim(&buf.join(" ")).to_string());
                buf.clear();
            }
            continue;
        }
        buf.push(trimmed.to_string());
    }
    if !buf.is_empty() {
        paragraphs.push(js_trim(&buf.join(" ")).to_string());
    }
    paragraphs.into_iter().filter(|p| !p.is_empty()).collect()
}

/// JS: collectBullets(lines)
fn collect_bullets<S: AsRef<str>>(lines: &[S]) -> Vec<String> {
    let mut bullets: Vec<String> = Vec::new();
    let mut current: Option<String> = None;
    for raw in lines {
        let raw = raw.as_ref();
        if let Some(m) = BULLET_RE.captures(raw) {
            if let Some(c) = current.take() {
                bullets.push(c);
            }
            current = Some(m.get(1).unwrap().as_str().to_string());
            continue;
        }
        if current.is_some() && BULLET_CONT_RE.is_match(raw) {
            let c = current.take().unwrap();
            current = Some(format!("{} {}", c, js_trim(raw)));
            continue;
        }
        if js_trim(raw).is_empty() && current.is_some() {
            bullets.push(current.take().unwrap());
        }
    }
    if let Some(c) = current {
        bullets.push(c);
    }
    bullets
}

/// JS: stripBold(s)
fn strip_bold(s: &str) -> String {
    BOLD_RE.replace_all(s, "${1}").into_owned()
}

struct NamedRule {
    name: String,
    body: String,
}

impl NamedRule {
    fn to_value(&self) -> Value {
        let mut m = Map::new();
        m.insert("name".into(), Value::String(self.name.clone()));
        m.insert("body".into(), Value::String(self.body.clone()));
        Value::Object(m)
    }
}

/// JS: extractNamedRules(lines)
fn extract_named_rules(lines: &[String]) -> Vec<NamedRule> {
    let mut rules: Vec<NamedRule> = Vec::new();
    let mut seen: Vec<String> = Vec::new();

    // Style A (Impeccable)
    let joined = lines.join("\n");
    let inline: Vec<(String, usize, usize)> = INLINE_RULE_RE
        .captures_iter(&joined)
        .map(|c| {
            let whole = c.get(0).unwrap();
            (
                c.get(1).unwrap().as_str().to_string(),
                whole.start(),
                whole.end(),
            )
        })
        .collect();
    for i in 0..inline.len() {
        let (ref rule_name, _, end) = inline[i];
        let body_end = if i + 1 < inline.len() {
            inline[i + 1].1
        } else {
            joined.len()
        };
        let slice = &joined[end..body_end];
        let s1 = TRAIL_H2_RE.replace(slice, "");
        let s2 = TRAIL_H3_RE.replace(&s1, "");
        let body = js_trim(&s2).to_string();
        let name = js_trim(&strip_bold(rule_name)).to_string();
        seen.push(to_lower_case(&name));
        rules.push(NamedRule {
            name,
            body: strip_bold(&body),
        });
    }

    // Style B (Stitch H3 headers)
    for i in 0..lines.len() {
        let Some(h3) = H3_RE.captures(&lines[i]) else {
            continue;
        };
        let stripped = strip_bold(h3.get(1).unwrap().as_str());
        let dequoted = QUOTES_RE.replace_all(&stripped, "");
        let header_name = js_trim(&dequoted).to_string();
        if !RULE_HEADER_RE.is_match(&header_name) {
            continue;
        }
        if seen.contains(&to_lower_case(&header_name)) {
            continue;
        }
        let mut body_lines: Vec<&str> = Vec::new();
        for line in lines.iter().skip(i + 1) {
            if BREAK_HEADING_RE.is_match(line) {
                break;
            }
            body_lines.push(line);
        }
        let joined_body = body_lines.join("\n");
        let spaced = NEWLINES_RE.replace_all(&joined_body, " ");
        let body = js_trim(&strip_bold(&spaced)).to_string();
        if !body.is_empty() {
            seen.push(to_lower_case(&header_name));
            rules.push(NamedRule {
                name: header_name,
                body,
            });
        }
    }

    // Style C (Stitch bullet form)
    for b in collect_bullets(lines) {
        let Some(mm) = RULE_BULLET_RE.captures(&b) else {
            continue;
        };
        let raw_name = mm.get(1).unwrap().as_str();
        let no_punct = TRAILING_PUNCT_RE.replace(raw_name, "");
        let dequoted = QUOTES_RE.replace_all(&no_punct, "");
        let name_raw = js_trim(&dequoted).to_string();
        if !RULE_NAME_C_RE.is_match(&name_raw) {
            continue;
        }
        if seen.contains(&to_lower_case(&name_raw)) {
            continue;
        }
        seen.push(to_lower_case(&name_raw));
        rules.push(NamedRule {
            name: name_raw,
            body: js_trim(&strip_bold(mm.get(2).unwrap().as_str())).to_string(),
        });
    }

    rules
}

fn rules_value(rules: &[NamedRule]) -> Value {
    Value::Array(rules.iter().map(|r| r.to_value()).collect())
}

fn opt_string(v: Option<&str>) -> Value {
    match v {
        Some(s) => Value::String(s.to_string()),
        None => Value::Null,
    }
}

// ---------- Per-section extractors ----------

/// JS: extractOverview(section)
fn extract_overview(section: Option<&Section>) -> Value {
    let Some(section) = section else {
        return Value::Null;
    };
    let text = section.lines.join("\n");
    let north_star = NORTH_STAR_RE.captures(&text);
    let key_char = KEYCHAR_RE.captures(&text);

    let key_chars: Vec<String> = match &key_char {
        Some(c) => {
            let inner: Vec<&str> = c.get(1).unwrap().as_str().split('\n').collect();
            collect_bullets(&inner)
                .iter()
                .map(|b| strip_bold(js_trim(b)))
                .collect()
        }
        None => Vec::new(),
    };

    let prose = match &key_char {
        Some(c) => {
            let m0 = c.get(0).unwrap();
            format!("{}{}", &text[..m0.start()], &text[m0.end()..])
        }
        None => text.clone(),
    };

    let prose_lines: Vec<&str> = prose.split('\n').collect();
    let paragraphs: Vec<Value> = collect_paragraphs(&prose_lines)
        .into_iter()
        .filter(|p| {
            !p.starts_with("**Creative North Star") && !p.starts_with("**Key Characteristics")
        })
        .map(Value::String)
        .collect();

    let mut m = Map::new();
    m.insert("subtitle".into(), opt_string(section.subtitle.as_deref()));
    m.insert(
        "creativeNorthStar".into(),
        match &north_star {
            Some(c) => Value::String(c.get(1).unwrap().as_str().to_string()),
            None => Value::Null,
        },
    );
    m.insert("philosophy".into(), Value::Array(paragraphs));
    m.insert(
        "keyCharacteristics".into(),
        Value::Array(key_chars.into_iter().map(Value::String).collect()),
    );
    Value::Object(m)
}

struct ColorEntry {
    name: Option<String>,
    value: String,
    value_range: Option<Vec<String>>,
    format: &'static str,
    description: Option<String>,
}

impl ColorEntry {
    fn to_value(&self) -> Value {
        let mut m = Map::new();
        m.insert("name".into(), opt_string(self.name.as_deref()));
        m.insert("value".into(), Value::String(self.value.clone()));
        m.insert(
            "valueRange".into(),
            match &self.value_range {
                Some(v) => Value::Array(v.iter().cloned().map(Value::String).collect()),
                None => Value::Null,
            },
        );
        m.insert("format".into(), Value::String(self.format.to_string()));
        m.insert(
            "description".into(),
            opt_string(self.description.as_deref()),
        );
        Value::Object(m)
    }
}

fn role_matches(name: &Option<String>) -> bool {
    match name {
        Some(n) if !n.is_empty() => ROLE_KEYWORDS_RE.is_match(n),
        _ => false,
    }
}

/// JS: extractColors(section)
fn extract_colors(section: Option<&Section>) -> Value {
    let Some(section) = section else {
        return Value::Null;
    };
    let subs = split_subsections(&section.lines);

    let description = collect_paragraphs(&subs[0].lines).join(" ");
    let mut groups: Vec<(String, Vec<ColorEntry>)> = Vec::new();

    for sub in subs.iter().skip(1) {
        let Some(name) = sub.name.as_ref().filter(|n| !n.is_empty()) else {
            continue;
        };
        if NAMED_RULES_RE.is_match(name) || THE_PREFIX_RE.is_match(name) {
            continue;
        }
        let bullets = collect_bullets(&sub.lines);
        let parsed: Vec<ColorEntry> = bullets
            .iter()
            .filter_map(|b| parse_color_bullet(b))
            .collect();
        if parsed.is_empty() {
            continue;
        }
        let all_role = parsed.iter().all(|p| role_matches(&p.name));
        if all_role {
            for p in parsed {
                let role = p.name.clone().unwrap();
                groups.push((role, vec![p]));
            }
        } else {
            groups.push((name.clone(), parsed));
        }
    }

    if groups.is_empty() {
        let flat: Vec<ColorEntry> = collect_bullets(&section.lines)
            .iter()
            .filter_map(|b| parse_color_bullet(b))
            .collect();
        if !flat.is_empty() {
            for p in flat {
                if role_matches(&p.name) {
                    let role = p.name.clone().unwrap();
                    groups.push((role, vec![p]));
                } else if let Some(g) = groups.iter_mut().find(|(r, _)| r == "Palette") {
                    g.1.push(p);
                } else {
                    groups.push(("Palette".to_string(), vec![p]));
                }
            }
        }
    }

    let groups_value: Vec<Value> = groups
        .iter()
        .map(|(role, colors)| {
            let mut m = Map::new();
            m.insert("role".into(), Value::String(role.clone()));
            m.insert(
                "colors".into(),
                Value::Array(colors.iter().map(|c| c.to_value()).collect()),
            );
            Value::Object(m)
        })
        .collect();

    let mut m = Map::new();
    m.insert("subtitle".into(), opt_string(section.subtitle.as_deref()));
    m.insert(
        "description".into(),
        if description.is_empty() {
            Value::Null
        } else {
            Value::String(description)
        },
    );
    m.insert("groups".into(), Value::Array(groups_value));
    m.insert(
        "rules".into(),
        rules_value(&extract_named_rules(&section.lines)),
    );
    Value::Object(m)
}

/// JS: parseColorBullet(bullet)
fn parse_color_bullet(bullet: &str) -> Option<ColorEntry> {
    let text = js_trim(bullet);

    // Case 1 (Impeccable)
    if let Some(bold) = COLOR_BOLD_RE.captures(text) {
        let b2 = bold.get(2).unwrap().as_str();
        if b2.starts_with('(') {
            if let Some(value) = extract_paren_group(b2) {
                let after = js_trim_start(&b2[value.len() + 2..]);
                if let Some(rest) = after.strip_prefix(':') {
                    return Some(build_color(
                        Some(bold.get(1).unwrap().as_str()),
                        value,
                        js_trim(rest),
                    ));
                }
            }
        }
    }

    // Case 2 (Stitch)
    if let Some(stitch) = COLOR_STITCH_RE.captures(text) {
        return Some(build_color(
            Some(js_trim(stitch.get(1).unwrap().as_str())),
            stitch.get(2).unwrap().as_str(),
            stitch.get(3).unwrap().as_str(),
        ));
    }

    // Case 3
    let values = collect_color_values(text);
    if !values.is_empty() {
        return Some(build_color(None, &values.join(" to "), text));
    }
    None
}

/// JS: extractParenGroup(s)
fn extract_paren_group(s: &str) -> Option<&str> {
    if !s.starts_with('(') {
        return None;
    }
    let mut depth = 0i32;
    for (i, ch) in s.char_indices() {
        if ch == '(' {
            depth += 1;
        } else if ch == ')' {
            depth -= 1;
            if depth == 0 {
                return Some(&s[1..i]);
            }
        }
    }
    None
}

/// JS: buildColor(name, rawValue, description)
fn build_color(name: Option<&str>, raw_value: &str, description: &str) -> ColorEntry {
    let values = collect_color_values(raw_value);
    let primary = values
        .first()
        .cloned()
        .unwrap_or_else(|| js_trim(raw_value).to_string());
    ColorEntry {
        name: match name {
            Some(n) if !n.is_empty() => Some(js_trim(&strip_bold(n)).to_string()),
            _ => None,
        },
        format: detect_format(&primary),
        value: primary,
        value_range: if values.len() > 1 { Some(values) } else { None },
        description: {
            let d = js_trim(&strip_bold(description)).to_string();
            if d.is_empty() {
                None
            } else {
                Some(d)
            }
        },
    }
}

/// JS: collectColorValues(s)
fn collect_color_values(s: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for m in HEX_RE.find_iter(s) {
        out.push(m.as_str().to_string());
    }
    for m in OKLCH_RE.find_iter(s) {
        out.push(m.as_str().to_string());
    }
    out
}

/// JS: detectFormat(v)
fn detect_format(v: &str) -> &'static str {
    if v.is_empty() {
        return "unknown";
    }
    if v.starts_with('#') {
        return "hex";
    }
    let lower = to_lower_case(v);
    if lower.starts_with("oklch") {
        return "oklch";
    }
    if lower.starts_with("rgb") {
        return "rgb";
    }
    "unknown"
}

/// JS: normalizeFontRole(raw)
fn normalize_font_role(raw: &str) -> Option<&'static str> {
    let tokens: Vec<&str> = raw
        .split(|c: char| c == '-' || c == '/' || c == '&' || is_js_whitespace(c))
        .filter(|t| !t.is_empty())
        .collect();
    for p in ["display", "headline", "body", "ui", "label", "mono"] {
        if tokens.contains(&p) {
            return Some(match p {
                "headline" => "display",
                "ui" => "body",
                other => other,
            });
        }
    }
    None
}

/// Hand-rolled equivalent of the JS lookahead
/// `/\*\*Character:\*\*\s*([^\n]+(?:\n[^\n]+)*?)(?=\n\n|\n###|\n##|$)/`.
/// The `regex` crate has no lookahead; the greedy/lazy analysis is in the
/// comments below.
fn find_character_capture(text: &str) -> Option<String> {
    const LIT: &str = "**Character:**";
    let mut search_from = 0usize;
    while let Some(rel) = text[search_from..].find(LIT) {
        let lit_end = search_from + rel + LIT.len();
        // Greedy `\s*` then `[^\n]+`. Shrinking `[^\n]+` can never rescue a
        // failed lookahead (it would leave us mid-line, where every
        // alternative needs either `\n` or end-of-string), so only the
        // full-line width is tried; `\s*` is walked back one char at a time.
        let ws_end = lit_end
            + text[lit_end..]
                .chars()
                .take_while(|c| is_js_whitespace(*c))
                .map(|c| c.len_utf8())
                .sum::<usize>();
        let mut starts: Vec<usize> = vec![lit_end];
        let mut pos = lit_end;
        for c in text[lit_end..ws_end].chars() {
            pos += c.len_utf8();
            starts.push(pos);
        }
        starts.reverse();

        for st in starts {
            if st >= text.len() {
                continue;
            }
            if text[st..].starts_with('\n') {
                continue;
            }
            let mut p = st + text[st..].find('\n').unwrap_or(text.len() - st);
            loop {
                let tail = &text[p..];
                if tail.starts_with("\n\n")
                    || tail.starts_with("\n###")
                    || tail.starts_with("\n##")
                    || p == text.len()
                {
                    return Some(text[st..p].to_string());
                }
                // Try one more `\n[^\n]+` repetition.
                if tail.starts_with('\n') && p + 1 < text.len() && !tail[1..].starts_with('\n') {
                    let next = p + 1;
                    p = next + text[next..].find('\n').unwrap_or(text.len() - next);
                    continue;
                }
                break;
            }
        }
        search_from = lit_end;
    }
    None
}

/// JS: extractTypography(section)
fn extract_typography(section: Option<&Section>) -> Value {
    let Some(section) = section else {
        return Value::Null;
    };
    let text = section.lines.join("\n");

    let mut fonts: Map<String, Value> = Map::new();
    for fm in FONT_LINE_RE.captures_iter(&text) {
        let raw_role = WS_RUN_RE
            .replace_all(&to_lower_case(js_trim(fm.get(1).unwrap().as_str())), "-")
            .into_owned();
        let role = normalize_font_role(&raw_role)
            .unwrap_or("display")
            .to_string();
        let mut o = Map::new();
        o.insert(
            "family".into(),
            Value::String(js_trim(fm.get(2).unwrap().as_str()).to_string()),
        );
        o.insert(
            "fallback".into(),
            match fm.get(3) {
                Some(m) if !m.as_str().is_empty() => Value::String(js_trim(m.as_str()).to_string()),
                _ => Value::Null,
            },
        );
        fonts.insert(role, Value::Object(o));
    }

    if fonts.is_empty() {
        for sm in FONT_STITCH_RE.captures_iter(&text) {
            let lowered = to_lower_case(js_trim(sm.get(1).unwrap().as_str()));
            let amped = AMP_RE.replace_all(&lowered, "-").into_owned();
            let raw_role = WS_RUN_RE.replace_all(&amped, "-").into_owned();
            let role = normalize_font_role(&raw_role)
                .map(|s| s.to_string())
                .unwrap_or_else(|| raw_role.clone());
            let mut o = Map::new();
            o.insert(
                "family".into(),
                Value::String(js_trim(sm.get(2).unwrap().as_str()).to_string()),
            );
            o.insert("fallback".into(), Value::Null);
            o.insert(
                "purpose".into(),
                Value::String(js_trim(sm.get(3).unwrap().as_str()).to_string()),
            );
            fonts.insert(role, Value::Object(o));
        }
    }

    let mut character: Option<String> = find_character_capture(&text)
        .map(|c| js_trim(&c.replace('\n', " ")).to_string())
        .filter(|c| !c.is_empty());

    if character.is_none() {
        let paragraphs: Vec<String> = collect_paragraphs(&section.lines)
            .into_iter()
            .filter(|p| !FONT_PARA_A_RE.is_match(p) && !FONT_PARA_B_RE.is_match(p))
            .collect();
        if let Some(first) = paragraphs.into_iter().next() {
            character = Some(first);
        }
    }

    let subs = split_subsections(&section.lines);
    let mut hierarchy: Vec<Value> = Vec::new();
    if let Some(hier) = subs.iter().find(|s| {
        s.name
            .as_ref()
            .is_some_and(|n| !n.is_empty() && HIERARCH_RE.is_match(n))
    }) {
        hierarchy = collect_bullets(&hier.lines)
            .iter()
            .filter_map(|b| parse_type_bullet(b))
            .collect();
    }

    let mut m = Map::new();
    m.insert("subtitle".into(), opt_string(section.subtitle.as_deref()));
    m.insert("fonts".into(), Value::Object(js_key_order(fonts)));
    m.insert("character".into(), opt_string(character.as_deref()));
    m.insert("hierarchy".into(), Value::Array(hierarchy));
    m.insert(
        "rules".into(),
        rules_value(&extract_named_rules(&section.lines)),
    );
    Value::Object(m)
}

/// JS: parseTypeBullet(bullet)
fn parse_type_bullet(bullet: &str) -> Option<Value> {
    let m = TYPE_BULLET_RE.captures(bullet)?;
    let mut o = Map::new();
    o.insert(
        "name".into(),
        Value::String(js_trim(m.get(1).unwrap().as_str()).to_string()),
    );
    o.insert(
        "specs".into(),
        Value::Array(
            m.get(2)
                .unwrap()
                .as_str()
                .split(',')
                .map(|s| Value::String(js_trim(s).to_string()))
                .collect(),
        ),
    );
    let purpose = js_trim(&strip_bold(m.get(3).unwrap().as_str())).to_string();
    o.insert(
        "purpose".into(),
        if purpose.is_empty() {
            Value::Null
        } else {
            Value::String(purpose)
        },
    );
    Some(Value::Object(o))
}

/// JS: extractGuidance(section)
fn extract_guidance(section: Option<&Section>) -> Value {
    let Some(section) = section else {
        return Value::Null;
    };
    let subs = split_subsections(&section.lines);
    let description = collect_paragraphs(&subs[0].lines).join(" ");
    let mut m = Map::new();
    m.insert("subtitle".into(), opt_string(section.subtitle.as_deref()));
    m.insert(
        "description".into(),
        if description.is_empty() {
            Value::Null
        } else {
            Value::String(description)
        },
    );
    m.insert(
        "rules".into(),
        rules_value(&extract_named_rules(&section.lines)),
    );
    Value::Object(m)
}

struct Shadow {
    name: Option<String>,
    value: String,
    purpose: Option<String>,
}

impl Shadow {
    fn to_value(&self) -> Value {
        let mut m = Map::new();
        m.insert("name".into(), opt_string(self.name.as_deref()));
        m.insert("value".into(), Value::String(self.value.clone()));
        m.insert("purpose".into(), opt_string(self.purpose.as_deref()));
        Value::Object(m)
    }
}

/// JS: extractElevation(section)
fn extract_elevation(section: Option<&Section>) -> Value {
    let guidance = extract_guidance(section);
    if guidance.is_null() {
        return Value::Null;
    }
    let section = section.unwrap();

    let mut shadows: Vec<Shadow> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    fn dedupe(entry: Shadow, shadows: &mut Vec<Shadow>, seen: &mut Vec<String>) {
        let key = format!(
            "{}::{}",
            entry.name.clone().unwrap_or_default(),
            entry.value
        );
        if seen.contains(&key) {
            return;
        }
        seen.push(key);
        shadows.push(entry);
    }

    for b in collect_bullets(&section.lines) {
        if let Some(parsed) = parse_shadow_bullet(&b) {
            dedupe(parsed, &mut shadows, &mut seen);
        }
    }
    for p in collect_paragraphs(&section.lines) {
        for inline in extract_inline_shadows(&p) {
            dedupe(inline, &mut shadows, &mut seen);
        }
    }
    for b in collect_bullets(&section.lines) {
        for inline in extract_inline_shadows(&b) {
            dedupe(inline, &mut shadows, &mut seen);
        }
    }

    let mut m = guidance.as_object().unwrap().clone();
    m.insert(
        "shadows".into(),
        Value::Array(shadows.iter().map(|s| s.to_value()).collect()),
    );
    Value::Object(m)
}

/// JS: extractInlineShadows(text)
fn extract_inline_shadows(text: &str) -> Vec<Shadow> {
    let mut out: Vec<Shadow> = Vec::new();
    for m in INLINE_SHADOW_RE.captures_iter(text) {
        let raw = m.get(1).unwrap().as_str();
        let value = js_trim(&SHADOW_TRAIL_RE.replace(raw, "")).to_string();
        if value.is_empty() {
            continue;
        }
        let before = &text[..m.get(0).unwrap().start()];
        let mut name: Option<String> = None;
        if let Some(nm) = SHADOW_NAME_RE.captures(before) {
            let s1 = NAME_STRIP_VERB_RE.replace(nm.get(1).unwrap().as_str(), "");
            let s2 = NAME_STRIP_ART_RE.replace(&s1, "");
            let stripped = js_trim(&s2).to_string();
            if !stripped.is_empty() {
                let mut chars = stripped.chars();
                let first = chars.next().unwrap();
                name = Some(format!(
                    "{}{} shadow",
                    to_upper_case(&first.to_string()),
                    chars.as_str()
                ));
            }
        }
        out.push(Shadow {
            name,
            value,
            purpose: None,
        });
    }
    out
}

/// JS: parseShadowBullet(bullet)
fn parse_shadow_bullet(bullet: &str) -> Option<Shadow> {
    let m = SHADOW_BULLET_RE.captures(bullet)?;
    let raw_value =
        js_trim(&BOX_SHADOW_PREFIX_RE.replace(m.get(2).unwrap().as_str(), "")).to_string();
    let looks_like = LOOKS_LIKE_SHADOW_RE.is_match(&raw_value) && HAS_DIGIT_RE.is_match(&raw_value);
    if !looks_like {
        return None;
    }
    let purpose = js_trim(&strip_bold(m.get(3).unwrap().as_str())).to_string();
    Some(Shadow {
        name: Some(js_trim(&strip_bold(m.get(1).unwrap().as_str())).to_string()),
        value: raw_value,
        purpose: if purpose.is_empty() {
            None
        } else {
            Some(purpose)
        },
    })
}

/// JS: extractComponents(section)
fn extract_components(section: Option<&Section>) -> Value {
    let Some(section) = section else {
        return Value::Null;
    };
    let subs = split_subsections(&section.lines);
    let mut components: Vec<Value> = Vec::new();

    for sub in subs.iter().skip(1) {
        let Some(name) = sub.name.as_ref().filter(|n| !n.is_empty()) else {
            continue;
        };
        let bullets = collect_bullets(&sub.lines);
        let paragraphs = collect_paragraphs(&sub.lines);

        let mut variants: Vec<Value> = Vec::new();
        let mut properties: Map<String, Value> = Map::new();

        for b in bullets {
            let Some(m) = COMPONENT_BULLET_RE.captures(&b) else {
                continue;
            };
            let key = js_trim(&strip_bold(m.get(1).unwrap().as_str())).to_string();
            let value = js_trim(&strip_bold(m.get(2).unwrap().as_str())).to_string();
            let head = key
                .split(|c: char| is_js_whitespace(c) || c == '/')
                .next()
                .unwrap_or("");
            if VARIANT_KEY_RE.is_match(head) {
                let mut v = Map::new();
                v.insert("name".into(), Value::String(key));
                v.insert("description".into(), Value::String(value));
                variants.push(Value::Object(v));
            } else {
                properties.insert(to_lower_case(&key), Value::String(value));
            }
        }

        let description = paragraphs.join(" ");
        let mut c = Map::new();
        c.insert("name".into(), Value::String(name.clone()));
        c.insert(
            "description".into(),
            if description.is_empty() {
                Value::Null
            } else {
                Value::String(description)
            },
        );
        c.insert("properties".into(), Value::Object(js_key_order(properties)));
        c.insert("variants".into(), Value::Array(variants));
        components.push(Value::Object(c));
    }

    let mut m = Map::new();
    m.insert("subtitle".into(), opt_string(section.subtitle.as_deref()));
    m.insert("components".into(), Value::Array(components));
    Value::Object(m)
}

/// JS: extractDosDonts(section)
fn extract_dos_donts(section: Option<&Section>) -> Value {
    let Some(section) = section else {
        return Value::Null;
    };
    let subs = split_subsections(&section.lines);
    let mut dos: Vec<String> = Vec::new();
    let mut donts: Vec<String> = Vec::new();

    for sub in subs.iter().skip(1) {
        let Some(name) = sub.name.as_ref().filter(|n| !n.is_empty()) else {
            continue;
        };
        let sub_name = normalize_apostrophes(name);
        let bullets: Vec<String> = collect_bullets(&sub.lines)
            .iter()
            .map(|b| js_trim(&strip_bold(b)).to_string())
            .collect();
        if DO_A_RE.is_match(&sub_name) || DO_B_RE.is_match(&sub_name) {
            dos.extend(bullets);
        } else if DONT_RE.is_match(&sub_name) {
            donts.extend(bullets);
        }
    }

    for b in collect_bullets(&section.lines) {
        let stripped = normalize_apostrophes(js_trim(&strip_bold(&b)));
        if DONT_PREFIX_RE.is_match(&stripped) {
            if !donts.iter().any(|d| normalize_apostrophes(d) == stripped) {
                donts.push(stripped);
            }
        } else if DO_PREFIX_RE.is_match(&stripped)
            && !dos.iter().any(|d| normalize_apostrophes(d) == stripped)
        {
            dos.push(stripped);
        }
    }

    let mut m = Map::new();
    m.insert(
        "dos".into(),
        Value::Array(dos.into_iter().map(Value::String).collect()),
    );
    m.insert(
        "donts".into(),
        Value::Array(donts.into_iter().map(Value::String).collect()),
    );
    Value::Object(m)
}

// ---------- Main ----------

/// JS: parseDesignMd(md). `Err` is never produced today: the JS only throws
/// for a non-string argument, which this signature rules out.
pub fn parse_design_md(md: &str) -> Result<Value, String> {
    let (frontmatter, body) = parse_frontmatter(md);
    let (title, sections) = split_sections(&body);

    let mut m = Map::new();
    m.insert("schemaVersion".into(), Value::from(2));
    m.insert("title".into(), title);
    m.insert(
        "frontmatter".into(),
        match frontmatter {
            Some(f) => Value::Object(f),
            None => Value::Null,
        },
    );
    m.insert(
        "overview".into(),
        extract_overview(find_section(&sections, "Overview")),
    );
    m.insert(
        "colors".into(),
        extract_colors(find_section(&sections, "Colors")),
    );
    m.insert(
        "typography".into(),
        extract_typography(find_section(&sections, "Typography")),
    );
    m.insert(
        "layout".into(),
        extract_guidance(find_section(&sections, "Layout")),
    );
    m.insert(
        "elevation".into(),
        extract_elevation(find_section(&sections, "Elevation")),
    );
    m.insert(
        "shapes".into(),
        extract_guidance(find_section(&sections, "Shapes")),
    );
    m.insert(
        "components".into(),
        extract_components(find_section(&sections, "Components")),
    );
    m.insert(
        "dosDonts".into(),
        extract_dos_donts(find_section(&sections, "Do's and Don'ts")),
    );
    Ok(Value::Object(m))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(md: &str) -> String {
        serde_json::to_string(&parse_design_md(md).unwrap()).unwrap()
    }

    #[test]
    fn design_md_empty() {
        assert_eq!(
            run(""),
            r##"{"schemaVersion":2,"title":null,"frontmatter":null,"overview":null,"colors":null,"typography":null,"layout":null,"elevation":null,"shapes":null,"components":null,"dosDonts":null}"##
        );
    }

    #[test]
    fn design_md_oracle_fixture() {
        let md = "---\nname: Oracle Fixture\ncolors:\n  ink: \"#111111\"\n  paper: \"#fbf7ef\"\n  accent: \"#1a4d8f\"\ntypography:\n  body:\n    fontFamily: \"Palatino, Georgia, serif\"\n  heading:\n    fontFamily: \"Palatino, Georgia, serif\"\ncomponents:\n  button:\n    backgroundColor: \"{colors.accent}\"\n---\n\n# Design System: Oracle Fixture\n\n## Overview\nA quiet editorial system: warm paper, ink text, one deep blue accent.\n\n## Colors\n\n### Primary\n- **Ink** (#111111): Text.\n- **Paper** (#fbf7ef): Page background.\n- **Accent** (#1a4d8f): Links and primary actions.\n\n## Typography\n\n**Body Font:** Palatino\n\n### Hierarchy\n- **Body** (400, 17px, 1.55): Paragraphs.\n- **H1** (600, 40px, 1.1): Page title.\n\n## Components\n\n### Button\n- Accent fill, paper text, no shadow.\n";
        // Golden captured from Node:
        //   node -e "import('.../design-parser.mjs').then(m=>process.stdout.write(
        //     JSON.stringify(m.parseDesignMd(require('fs').readFileSync(f,'utf8')))))"
        let expected = r##"{"schemaVersion":2,"title":"Design System: Oracle Fixture","frontmatter":{"name":"Oracle Fixture","colors":{"ink":"#111111","paper":"#fbf7ef","accent":"#1a4d8f"},"typography":{"body":{"fontFamily":"Palatino, Georgia, serif"},"heading":{"fontFamily":"Palatino, Georgia, serif"}},"components":{"button":{"backgroundColor":"{colors.accent}"}}},"overview":{"subtitle":null,"creativeNorthStar":null,"philosophy":["A quiet editorial system: warm paper, ink text, one deep blue accent."],"keyCharacteristics":[]},"colors":{"subtitle":null,"description":null,"groups":[{"role":"Primary","colors":[{"name":"Ink","value":"#111111","valueRange":null,"format":"hex","description":"Text."},{"name":"Paper","value":"#fbf7ef","valueRange":null,"format":"hex","description":"Page background."},{"name":"Accent","value":"#1a4d8f","valueRange":null,"format":"hex","description":"Links and primary actions."}]}],"rules":[]},"typography":{"subtitle":null,"fonts":{"body":{"family":"Palatino","fallback":null}},"character":null,"hierarchy":[{"name":"Body","specs":["400","17px","1.55"],"purpose":"Paragraphs."},{"name":"H1","specs":["600","40px","1.1"],"purpose":"Page title."}],"rules":[]},"layout":null,"elevation":null,"shapes":null,"components":{"subtitle":null,"components":[{"name":"Button","description":null,"properties":{},"variants":[]}]},"dosDonts":null}"##;
        assert_eq!(run(md), expected);
    }

    #[test]
    fn design_md_stitch_shapes_and_rules() {
        let md = "# Doc\n\n## Overview\n\n**Creative North Star: \"The Quiet Ledger\"**\n\nA calm system.\n\n**Key Characteristics:**\n*   Calm\n*   Dense\n\n## Elevation & Depth\n\nDepth is tonal, but when a modal opens use an extra-diffused shadow: `box-shadow: 0 12px 40px rgba(0,0,0,0.35)`.\n\n### Shadow Vocabulary\n- **Resting** (`box-shadow: 0 1px 2px rgba(0,0,0,0.08)`): Cards at rest.\n\n*   **The Layering Principle:** Only two levels ever.\n\n## Do's and Don'ts\n\n### Do:\n- **Do** use the accent sparingly.\n\n### Don't:\n- **Don't** add gradients.\n";
        let expected = r##"{"schemaVersion":2,"title":"Doc","frontmatter":null,"overview":{"subtitle":null,"creativeNorthStar":"The Quiet Ledger","philosophy":["A calm system."],"keyCharacteristics":["Calm","Dense"]},"colors":null,"typography":null,"layout":null,"elevation":{"subtitle":null,"description":"Depth is tonal, but when a modal opens use an extra-diffused shadow: `box-shadow: 0 12px 40px rgba(0,0,0,0.35)`.","rules":[{"name":"The Layering Principle","body":"Only two levels ever."}],"shadows":[{"name":"Resting","value":"0 1px 2px rgba(0,0,0,0.08)","purpose":"Cards at rest."},{"name":"When a modal opens use an extra-diffused shadow","value":"0 12px 40px rgba(0,0,0,0.35","purpose":null},{"name":null,"value":"0 1px 2px rgba(0,0,0,0.08","purpose":null}]},"shapes":null,"components":null,"dosDonts":{"dos":["Do use the accent sparingly."],"donts":["Don't add gradients."]}}"##;
        assert_eq!(run(md), expected);
    }
}
