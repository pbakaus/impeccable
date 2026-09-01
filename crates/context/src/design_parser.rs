//! JS: lib/design-parser.mjs, the subset doctor's coverage check reads:
//! frontmatter (YAML subset) and canonical H2 presence.

use crate::util::js_trim;
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{Map, Value};

pub const CANONICAL_SECTIONS: [&str; 8] =
    ["Overview", "Colors", "Typography", "Layout", "Elevation", "Shapes", "Components", "Do's and Don'ts"];

pub struct DesignModel {
    pub frontmatter: Option<Map<String, Value>>,
    /// canonical section name -> present
    pub sections: Vec<&'static str>,
}

impl DesignModel {
    pub fn has_section(&self, key: &str) -> bool {
        // key: 'colors' | 'typography' | 'components' (lowercase model field)
        self.sections.iter().any(|s| s.to_lowercase() == key)
    }
}

fn split_lines(md: &str) -> Vec<&str> {
    md.split('\n').map(|l| l.strip_suffix('\r').unwrap_or(l)).collect()
}

/// JS: parseFrontmatter(md) -> (frontmatter|null, body)
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
    let Some(end) = end else { return (None, md.to_string()) };
    let yaml = lines[1..end].join("\n");
    let body = lines[end + 1..].join("\n");
    (Some(parse_yaml_subset(&yaml)), body)
}

fn find_top_level_colon(s: &str) -> Option<usize> {
    let chars: Vec<char> = s.chars().collect();
    let mut in_quote: Option<char> = None;
    for i in 0..chars.len() {
        let ch = chars[i];
        if let Some(q) = in_quote {
            if ch == q && (i == 0 || chars[i - 1] != '\\') {
                in_quote = None;
            }
        } else if ch == '"' || ch == '\'' {
            in_quote = Some(ch);
        } else if ch == ':' {
            return Some(i);
        }
    }
    None
}

fn unquote_yaml_key(key: &str) -> String {
    let c: Vec<char> = key.chars().collect();
    if c.len() >= 2 && ((c[0] == '"' && c[c.len() - 1] == '"') || (c[0] == '\'' && c[c.len() - 1] == '\'')) {
        return c[1..c.len() - 1].iter().collect();
    }
    if c.len() == 1 && (c[0] == '"' || c[0] == '\'') {
        // JS: "\"".slice(1,-1) === ''
        return String::new();
    }
    key.to_string()
}

fn strip_inline_yaml_comment(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    let mut in_quote: Option<char> = None;
    for i in 0..chars.len() {
        let ch = chars[i];
        if let Some(q) = in_quote {
            if ch == q && (i == 0 || chars[i - 1] != '\\') {
                in_quote = None;
            }
        } else if ch == '"' || ch == '\'' {
            in_quote = Some(ch);
        } else if ch == '#' && i > 0 && chars[i - 1].is_whitespace() {
            let head: String = chars[..i].iter().collect();
            return head.trim_end().to_string();
        }
    }
    s.to_string()
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
        let simple = match next {
            '0' => Some('\0'),
            'a' => Some('\x07'),
            'b' => Some('\x08'),
            't' => Some('\t'),
            'n' => Some('\n'),
            'v' => Some('\x0b'),
            'f' => Some('\x0c'),
            'r' => Some('\r'),
            'e' => Some('\x1b'),
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
            'x' => Some(2),
            'u' => Some(4),
            'U' => Some(8),
            _ => None,
        };
        if let Some(hl) = hex_len {
            let hex: String = chars[(i + 2).min(chars.len())..(i + 2 + hl).min(chars.len())].iter().collect();
            if hex.chars().count() == hl && hex.chars().all(|c| c.is_ascii_hexdigit()) {
                if let Ok(cp) = u32::from_str_radix(&hex, 16) {
                    if cp <= 0x10ffff {
                        // String.fromCodePoint: lone surrogates would throw in Rust; use replacement
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
    if !d.is_empty() && d.chars().all(|ch| ch.is_ascii_digit()) {
        return crate::util::js_num(crate::critique_storage::js_number(s));
    }
    // /^-?\d*\.\d+$/
    if let Some((a, b)) = d.split_once('.') {
        if a.chars().all(|ch| ch.is_ascii_digit()) && !b.is_empty() && b.chars().all(|ch| ch.is_ascii_digit()) {
            return crate::util::js_num(crate::critique_storage::js_number(s));
        }
    }
    Value::String(s.to_string())
}

fn parse_yaml_subset(yaml: &str) -> Map<String, Value> {
    // Build a tree of maps with a stack of paths (JS mutates nested objects by
    // reference; we replay by path).
    let lines = split_lines(yaml);
    let mut root: Map<String, Value> = Map::new();
    let mut stack: Vec<(i64, Vec<String>)> = vec![(-1, vec![])];
    for raw in lines {
        if js_trim(raw).is_empty() || raw.trim_start().starts_with('#') {
            continue;
        }
        let indent = raw.chars().take_while(|c| c.is_whitespace()).count() as i64;
        let content: String = raw.chars().skip(indent as usize).collect();
        let Some(colon) = find_top_level_colon(&content) else { continue };
        while stack.len() > 1 && stack.last().unwrap().0 >= indent {
            stack.pop();
        }
        let cchars: Vec<char> = content.chars().collect();
        let key_raw: String = cchars[..colon].iter().collect();
        let key = unquote_yaml_key(js_trim(&key_raw));
        let rest_raw: String = cchars[colon + 1..].iter().collect();
        let rest = strip_inline_yaml_comment(js_trim(&rest_raw));
        let path = stack.last().unwrap().1.clone();
        let parent = get_map_mut(&mut root, &path);
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

fn get_map_mut<'a>(root: &'a mut Map<String, Value>, path: &[String]) -> &'a mut Map<String, Value> {
    let mut cur = root;
    for k in path {
        let entry = cur.entry(k.clone()).or_insert_with(|| Value::Object(Map::new()));
        if !entry.is_object() {
            *entry = Value::Object(Map::new());
        }
        cur = entry.as_object_mut().unwrap();
    }
    cur
}

static H2_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^##\s+(?:\d+\.\s*)?([^:\n]+?)(?::\s*(.+))?$").unwrap());

fn normalize_apostrophes(s: &str) -> String {
    s.replace(['\u{2018}', '\u{2019}'], "'")
}

fn match_canonical_section(name: &str) -> Option<&'static str> {
    let normalized = normalize_apostrophes(name).to_lowercase();
    for c in CANONICAL_SECTIONS {
        if normalize_apostrophes(c).to_lowercase() == normalized {
            return Some(c);
        }
    }
    for c in CANONICAL_SECTIONS {
        let key = normalize_apostrophes(c).to_lowercase();
        let pat = format!(r"(?-u:\b){}(?-u:\b)", regex::escape(&key));
        if Regex::new(&pat).map(|r| r.is_match(&normalized)).unwrap_or(false) {
            return Some(c);
        }
    }
    None
}

fn split_sections(md: &str) -> Vec<&'static str> {
    let mut title_seen = false;
    let mut present: Vec<&'static str> = Vec::new();
    for raw in split_lines(md) {
        let line = raw.trim_end();
        if !title_seen && line.starts_with("# ") && !line.starts_with("## ") {
            // JS: title = line.replace(/^#\s+/, '').trim(); an empty title stays falsy
            let t = js_trim(line.trim_start_matches('#').trim_start());
            title_seen = !t.is_empty();
            continue;
        }
        if let Some(m) = H2_RE.captures(line) {
            let raw_name = normalize_apostrophes(js_trim(&m[1]));
            if let Some(c) = match_canonical_section(&raw_name) {
                if !present.contains(&c) {
                    present.push(c);
                }
            }
        }
    }
    present
}

/// JS: parseDesignMd(md), reduced to what doctor needs.
pub fn parse_design_md(md: &str) -> DesignModel {
    let (frontmatter, body) = parse_frontmatter(md);
    DesignModel { frontmatter, sections: split_sections(&body) }
}
