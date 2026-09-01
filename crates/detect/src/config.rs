//! Port of `cli/lib/impeccable-config.mjs`: the CLI-side reader/writer for
//! the unified `.impeccable` config (`config.json` shared, `config.local.json`
//! per developer), detector ignore semantics, glob matching, and the
//! `.git/info/exclude` handling.

use impeccable_core::findings::Finding;
use impeccable_core::js::{self, math_round, number_to_string, parse_float, parse_int};
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{Map, Value};

use crate::jsp;
use crate::util::{as_plain_object, js_string, re, read_json, D, DOT, WS};

/// JS: impeccable-config.mjs#getConfigPath
pub fn get_config_path(root: &str) -> String {
    jsp::join(&[root, ".impeccable", "config.json"])
}

/// JS: impeccable-config.mjs#getLocalConfigPath
pub fn get_local_config_path(root: &str) -> String {
    jsp::join(&[root, ".impeccable", "config.local.json"])
}

/// JS `safeReadJson`: a JSON object, or None for a missing / invalid / non-object file.
fn safe_read_json(file_path: &str) -> Option<Map<String, Value>> {
    match read_json(file_path)? {
        Value::Object(m) => Some(m),
        _ => None,
    }
}

fn hook_section(raw: Option<&Map<String, Value>>) -> Option<&Map<String, Value>> {
    as_plain_object(raw?.get("hook"))
}

fn detector_section(raw: Option<&Map<String, Value>>) -> Option<&Map<String, Value>> {
    as_plain_object(raw?.get("detector"))
}

const DETECTOR_CONFIG_KEYS: &[&str] = &[
    "ignoreRules",
    "ignoreFiles",
    "ignoreValues",
    "designSystem",
    "advisoryRules",
];

/// One normalized `ignoreValues` entry, in the JS key order
/// `rule, value, files, createdAt, reason`.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct IgnoreValueEntry {
    pub rule: String,
    pub value: String,
    pub files: Option<Vec<String>>,
    pub created_at: Option<String>,
    pub reason: Option<String>,
}

impl IgnoreValueEntry {
    pub fn to_json(&self) -> Value {
        let mut m = Map::new();
        m.insert("rule".into(), Value::String(self.rule.clone()));
        m.insert("value".into(), Value::String(self.value.clone()));
        if let Some(files) = &self.files {
            m.insert(
                "files".into(),
                Value::Array(files.iter().map(|f| Value::String(f.clone())).collect()),
            );
        }
        if let Some(c) = &self.created_at {
            m.insert("createdAt".into(), Value::String(c.clone()));
        }
        if let Some(r) = &self.reason {
            m.insert("reason".into(), Value::String(r.clone()));
        }
        Value::Object(m)
    }
}

/// The detector config object (`readDetectionConfig` / `readRawDetectionConfig`
/// result). `design_system` is `Some` when the JS object carries a
/// `designSystem` key.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct DetectionConfig {
    pub ignore_rules: Vec<String>,
    pub ignore_files: Vec<String>,
    pub ignore_values: Vec<IgnoreValueEntry>,
    pub design_system_enabled: Option<bool>,
    pub advisory_rules: Option<String>,
}

impl DetectionConfig {
    /// JS `cloneRawDetectionConfig()` (also what `--no-config` builds).
    pub fn raw() -> Self {
        DetectionConfig::default()
    }
    /// JS `cloneDetectionConfig()`.
    pub fn with_defaults() -> Self {
        DetectionConfig {
            design_system_enabled: Some(true),
            ..Default::default()
        }
    }
    /// JS `detectionConfig.designSystem?.enabled !== false`.
    pub fn design_system_not_disabled(&self) -> bool {
        self.design_system_enabled != Some(false)
    }
}

fn apply_detection_config_source(config: &mut DetectionConfig, raw: Option<&Map<String, Value>>) {
    let Some(raw) = raw else { return };
    if let Some(Value::String(s)) = raw.get("advisoryRules") {
        if s == "include" || s == "exclude" {
            config.advisory_rules = Some(s.clone());
        }
    }
    if let Some(ds) = as_plain_object(raw.get("designSystem")) {
        config.design_system_enabled = Some(ds.get("enabled") != Some(&Value::Bool(false)));
    }
    if let Some(Value::Array(rules)) = raw.get("ignoreRules") {
        let mut all: Vec<String> = config.ignore_rules.clone();
        all.extend(rules.iter().map(js_string));
        config.ignore_rules = unique_strings(all);
    }
    if let Some(Value::Array(files)) = raw.get("ignoreFiles") {
        let mut all: Vec<String> = config.ignore_files.clone();
        all.extend(files.iter().map(js_string));
        config.ignore_files = unique_strings(all);
    }
    if let Some(Value::Array(values)) = raw.get("ignoreValues") {
        config.ignore_values = merge_ignore_values(&config.ignore_values, values);
    }
}

fn unique_strings(values: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for v in values {
        if !out.contains(&v) {
            out.push(v);
        }
    }
    out
}

/// JS: impeccable-config.mjs#readDetectionConfig
pub fn read_detection_config(root: &str) -> DetectionConfig {
    let mut config = DetectionConfig::with_defaults();
    for file_path in [get_config_path(root), get_local_config_path(root)] {
        let raw = safe_read_json(&file_path);
        apply_detection_config_source(&mut config, hook_section(raw.as_ref()));
        apply_detection_config_source(&mut config, detector_section(raw.as_ref()));
    }
    config
}

/// JS: impeccable-config.mjs#readRawDetectionConfig
pub fn read_raw_detection_config(root: &str, local: bool) -> DetectionConfig {
    let raw = safe_read_json(&if local {
        get_local_config_path(root)
    } else {
        get_config_path(root)
    });
    let mut config = DetectionConfig::raw();
    apply_detection_config_source(&mut config, hook_section(raw.as_ref()));
    apply_detection_config_source(&mut config, detector_section(raw.as_ref()));
    config
}

/// JS: impeccable-config.mjs#writeDetectionConfig. Returns the written path.
pub fn write_detection_config(
    root: &str,
    detector_config: &DetectionConfig,
    local: bool,
) -> std::io::Result<String> {
    let file_path = if local {
        get_local_config_path(root)
    } else {
        get_config_path(root)
    };
    if local {
        ensure_config_git_exclude(root);
    }
    let existing = safe_read_json(&file_path).unwrap_or_default();
    let existing_hook = hook_section(Some(&existing));
    let next_hook = strip_detector_keys(existing_hook);
    let mut next_detector: Map<String, Value> = detector_section(Some(&existing))
        .cloned()
        .unwrap_or_default();
    for (k, v) in normalize_detection_config_for_write(detector_config) {
        next_detector.insert(k, v);
    }
    let mut next = existing.clone();
    next.insert("detector".into(), Value::Object(next_detector));
    match next_hook {
        Some(h) if !h.is_empty() => {
            next.insert("hook".into(), Value::Object(h));
        }
        _ => {
            next.shift_remove("hook");
        }
    }
    if let Some(dir) = std::path::Path::new(&file_path).parent() {
        std::fs::create_dir_all(dir)?;
    }
    let text = serde_json::to_string_pretty(&Value::Object(next)).unwrap_or_else(|_| "{}".into());
    std::fs::write(&file_path, format!("{text}\n"))?;
    Ok(file_path)
}

fn normalize_detection_config_for_write(config: &DetectionConfig) -> Map<String, Value> {
    let mut out = Map::new();
    out.insert(
        "ignoreRules".into(),
        Value::Array(
            unique_strings(
                config
                    .ignore_rules
                    .iter()
                    .map(|r| normalize_ignore_rule(r))
                    .filter(|r| !r.is_empty())
                    .collect(),
            )
            .into_iter()
            .map(Value::String)
            .collect(),
        ),
    );
    out.insert(
        "ignoreFiles".into(),
        Value::Array(
            unique_strings(
                config
                    .ignore_files
                    .iter()
                    .filter(|v| !js::trim(v).is_empty())
                    .map(|v| js::trim(v).to_string())
                    .collect(),
            )
            .into_iter()
            .map(Value::String)
            .collect(),
        ),
    );
    out.insert(
        "ignoreValues".into(),
        Value::Array(
            normalize_ignore_value_entries_typed(&config.ignore_values)
                .iter()
                .map(IgnoreValueEntry::to_json)
                .collect(),
        ),
    );
    if let Some(a) = &config.advisory_rules {
        if a == "include" || a == "exclude" {
            out.insert("advisoryRules".into(), Value::String(a.clone()));
        }
    }
    if let Some(enabled) = config.design_system_enabled {
        let mut ds = Map::new();
        ds.insert("enabled".into(), Value::Bool(enabled));
        out.insert("designSystem".into(), Value::Object(ds));
    }
    out
}

fn strip_detector_keys(raw: Option<&Map<String, Value>>) -> Option<Map<String, Value>> {
    let raw = raw?;
    let mut out = Map::new();
    for (k, v) in raw {
        if !DETECTOR_CONFIG_KEYS.contains(&k.as_str()) {
            out.insert(k.clone(), v.clone());
        }
    }
    Some(out)
}

re!(EDGE_QUOTE_RE, r#"^["']|["']$"#);
re!(WS_RUN_RE, format!("{WS}+"));

/// JS: impeccable-config.mjs#normalizeIgnoreValue
pub fn normalize_ignore_value(value: &str) -> String {
    let t = js::trim(value);
    let t = EDGE_QUOTE_RE.replace_all(t, "");
    let t = t.replace('+', " ");
    let t = WS_RUN_RE.replace_all(&t, " ");
    js::to_lower_case(&t)
}

/// JS `normalizeIgnoreRule`.
pub fn normalize_ignore_rule(rule: &str) -> String {
    js::to_lower_case(js::trim(rule))
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct IgnoreColor {
    r: f64,
    g: f64,
    b: f64,
    a: f64,
}

fn color_ignore_key(value: &str) -> String {
    match parse_ignore_color(value) {
        None => String::new(),
        Some(c) => format!(
            "{},{},{},{}",
            number_to_string(c.r),
            number_to_string(c.g),
            number_to_string(c.b),
            number_to_string(math_round(c.a * 255.0))
        ),
    }
}

re!(
    HEX_IGNORE_RE,
    "^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$"
);
re!(RGB_IGNORE_RE, r"^[rR][gG][bB][aA]?\((.*)\)$");
re!(HSL_IGNORE_RE, r"^[hH][sS][lL][aA]?\((.*)\)$");

fn parse_ignore_color(value: &str) -> Option<IgnoreColor> {
    let text = js::to_lower_case(js::trim(value));
    if text.is_empty() {
        return None;
    }
    if let Some(m) = HEX_IGNORE_RE.captures(&text) {
        return Some(parse_hex_ignore_color(m.get(1).unwrap().as_str()));
    }
    if let Some(m) = RGB_IGNORE_RE.captures(&text) {
        let parts = split_color_args(m.get(1).unwrap().as_str());
        if parts.len() < 3 || parts.len() > 4 {
            return None;
        }
        let r = parse_color_channel(&parts[0], ChannelFormat::Rgb)?;
        let g = parse_color_channel(&parts[1], ChannelFormat::Rgb)?;
        let b = parse_color_channel(&parts[2], ChannelFormat::Rgb)?;
        let a = match parts.get(3) {
            None => 1.0,
            Some(p) => parse_color_channel(p, ChannelFormat::Alpha)?,
        };
        return Some(IgnoreColor { r, g, b, a });
    }
    if let Some(m) = HSL_IGNORE_RE.captures(&text) {
        let parts = split_color_args(m.get(1).unwrap().as_str());
        if parts.len() < 3 || parts.len() > 4 {
            return None;
        }
        let h = parse_color_channel(&parts[0], ChannelFormat::Hue)?;
        let s = parse_color_channel(&parts[1], ChannelFormat::Percent)?;
        let l = parse_color_channel(&parts[2], ChannelFormat::Percent)?;
        let a = match parts.get(3) {
            None => 1.0,
            Some(p) => parse_color_channel(p, ChannelFormat::Alpha)?,
        };
        return Some(hsl_to_rgb(h, s, l, a));
    }
    None
}

fn parse_hex_ignore_color(hex: &str) -> IgnoreColor {
    let expanded: String = if hex.len() <= 4 {
        hex.chars().flat_map(|c| [c, c]).collect()
    } else {
        hex.to_string()
    };
    let bytes: Vec<f64> = expanded
        .as_bytes()
        .chunks(2)
        .map(|c| parse_int(std::str::from_utf8(c).unwrap_or("0"), 16))
        .collect();
    IgnoreColor {
        r: bytes[0],
        g: bytes[1],
        b: bytes[2],
        a: bytes.get(3).copied().unwrap_or(255.0) / 255.0,
    }
}

re!(SLASH_SEP_RE, format!("{WS}*/{WS}*"));

fn split_color_args(body: &str) -> Vec<String> {
    let text = js::trim(body);
    if text.is_empty() {
        return vec![];
    }
    if text.contains(',') {
        let parts: Vec<String> = text
            .split(',')
            .map(|p| js::trim(p).to_string())
            .filter(|p| !p.is_empty())
            .collect();
        if let Some(last) = parts.last() {
            if last.contains('/') {
                let split: Vec<String> = last
                    .split('/')
                    .map(|p| js::trim(p).to_string())
                    .filter(|p| !p.is_empty())
                    .collect();
                let mut out = parts[..parts.len() - 1].to_vec();
                out.extend(split);
                return out;
            }
        }
        return parts;
    }
    let normalized = SLASH_SEP_RE.replace_all(text, " / ");
    WS_RUN_RE
        .split(&normalized)
        .filter(|p| !p.is_empty() && *p != "/")
        .map(|p| p.to_string())
        .collect()
}

#[derive(Clone, Copy)]
enum ChannelFormat {
    Rgb,
    Alpha,
    Hue,
    Percent,
}

re!(
    CSS_NUMBER_RE,
    format!("^(-?{D}*\\.?{D}+)(%|deg|rad|turn|grad)?$")
);

fn parse_color_channel(raw: &str, format: ChannelFormat) -> Option<f64> {
    let text = js::trim(raw);
    let m = CSS_NUMBER_RE.captures(text)?;
    let unit = m.get(2).map(|u| u.as_str()).unwrap_or("");
    let number = parse_float(m.get(1).unwrap().as_str());
    if !number.is_finite() {
        return None;
    }
    let (value, min, max, round) = match format {
        ChannelFormat::Rgb => match unit {
            "" => (number, 0.0, 255.0, true),
            "%" => (number * 2.55, 0.0, 255.0, true),
            _ => return None,
        },
        ChannelFormat::Alpha => match unit {
            "" => (number, 0.0, 1.0, false),
            "%" => (number / 100.0, 0.0, 1.0, false),
            _ => return None,
        },
        ChannelFormat::Hue => match unit {
            "" | "deg" => (number, f64::NEG_INFINITY, f64::INFINITY, false),
            "rad" => (
                number * (180.0 / std::f64::consts::PI),
                f64::NEG_INFINITY,
                f64::INFINITY,
                false,
            ),
            "turn" => (number * 360.0, f64::NEG_INFINITY, f64::INFINITY, false),
            "grad" => (number * 0.9, f64::NEG_INFINITY, f64::INFINITY, false),
            _ => return None,
        },
        ChannelFormat::Percent => match unit {
            "%" => (number / 100.0, 0.0, 1.0, false),
            _ => return None,
        },
    };
    if value < min || value > max {
        return None;
    }
    Some(if round { math_round(value) } else { value })
}

fn hsl_to_rgb(hue: f64, saturation: f64, lightness: f64, alpha: f64) -> IgnoreColor {
    let h = (((hue % 360.0) + 360.0) % 360.0) / 360.0;
    if saturation == 0.0 {
        let gray = clamp_byte(math_round(lightness * 255.0));
        return IgnoreColor {
            r: gray,
            g: gray,
            b: gray,
            a: alpha,
        };
    }
    let q = if lightness < 0.5 {
        lightness * (1.0 + saturation)
    } else {
        lightness + saturation - lightness * saturation
    };
    let p = 2.0 * lightness - q;
    let to_rgb = |t: f64| {
        let mut channel = t;
        if channel < 0.0 {
            channel += 1.0;
        }
        if channel > 1.0 {
            channel -= 1.0;
        }
        if channel < 1.0 / 6.0 {
            return p + (q - p) * 6.0 * channel;
        }
        if channel < 1.0 / 2.0 {
            return q;
        }
        if channel < 2.0 / 3.0 {
            return p + (q - p) * (2.0 / 3.0 - channel) * 6.0;
        }
        p
    };
    IgnoreColor {
        r: clamp_byte(math_round(to_rgb(h + 1.0 / 3.0) * 255.0)),
        g: clamp_byte(math_round(to_rgb(h) * 255.0)),
        b: clamp_byte(math_round(to_rgb(h - 1.0 / 3.0) * 255.0)),
        a: alpha,
    }
}

fn clamp_byte(value: f64) -> f64 {
    js::math_min(255.0, js::math_max(0.0, value))
}

fn ignore_value_matches(rule: &str, entry_value: &str, finding_value: &str) -> bool {
    if entry_value == finding_value {
        return true;
    }
    if rule != "design-system-color" {
        return false;
    }
    let entry_color = color_ignore_key(entry_value);
    !entry_color.is_empty() && entry_color == color_ignore_key(finding_value)
}

/// JS: impeccable-config.mjs#normalizeIgnoreValueEntries over raw JSON entries.
pub fn normalize_ignore_value_entries(entries: &[Value]) -> Vec<IgnoreValueEntry> {
    let mut out = Vec::new();
    for entry in entries {
        let Value::Object(entry) = entry else {
            continue;
        };
        let rule = normalize_ignore_rule(
            &entry
                .get("rule")
                .map(js_string_or_empty)
                .unwrap_or_default(),
        );
        let value = normalize_ignore_value(
            &entry
                .get("value")
                .map(js_string_or_empty)
                .unwrap_or_default(),
        );
        if rule.is_empty() || value.is_empty() {
            continue;
        }
        let mut files: Vec<String> = Vec::new();
        if let Some(Value::String(f)) = entry.get("file") {
            if !js::trim(f).is_empty() {
                files.push(js::trim(f).to_string());
            }
        }
        if let Some(Value::Array(list)) = entry.get("files") {
            for f in list {
                if let Value::String(f) = f {
                    if !js::trim(f).is_empty() {
                        files.push(js::trim(f).to_string());
                    }
                }
            }
        }
        let files = unique_strings(files);
        let mut normalized = IgnoreValueEntry {
            rule,
            value,
            files: if files.is_empty() { None } else { Some(files) },
            created_at: None,
            reason: None,
        };
        if let Some(Value::String(c)) = entry.get("createdAt") {
            if !js::trim(c).is_empty() {
                normalized.created_at = Some(js::trim(c).to_string());
            }
        }
        if let Some(Value::String(r)) = entry.get("reason") {
            if !js::trim(r).is_empty() {
                normalized.reason = Some(js::trim(r).to_string());
            }
        }
        out.push(normalized);
    }
    out
}

/// JS `String(value || '')` for a JSON value.
fn js_string_or_empty(v: &Value) -> String {
    match v {
        Value::Null | Value::Bool(false) => String::new(),
        Value::Number(n) if n.as_f64() == Some(0.0) => String::new(),
        _ => js_string(v),
    }
}

/// `normalizeIgnoreValueEntries` over already-typed entries (idempotent
/// re-normalization on write).
pub fn normalize_ignore_value_entries_typed(entries: &[IgnoreValueEntry]) -> Vec<IgnoreValueEntry> {
    let raw: Vec<Value> = entries.iter().map(IgnoreValueEntry::to_json).collect();
    normalize_ignore_value_entries(&raw)
}

fn ignore_value_files_key(files: Option<&Vec<String>>) -> String {
    match files {
        Some(f) if !f.is_empty() => {
            let mut sorted = f.clone();
            sorted.sort();
            sorted.join("\u{1f}")
        }
        _ => String::new(),
    }
}

fn entry_key(entry: &IgnoreValueEntry) -> String {
    format!(
        "{}\0{}\0{}",
        entry.rule,
        entry.value,
        ignore_value_files_key(entry.files.as_ref())
    )
}

fn merge_ignore_values(existing: &[IgnoreValueEntry], incoming: &[Value]) -> Vec<IgnoreValueEntry> {
    // JS Map semantics: insertion order, later set replaces the value in place.
    let mut map: Vec<(String, IgnoreValueEntry)> = Vec::new();
    let mut set = |entry: IgnoreValueEntry| {
        let key = entry_key(&entry);
        if let Some(slot) = map.iter_mut().find(|(k, _)| *k == key) {
            slot.1 = entry;
        } else {
            map.push((key, entry));
        }
    };
    for entry in normalize_ignore_value_entries_typed(existing) {
        set(entry);
    }
    for entry in normalize_ignore_value_entries(incoming) {
        set(entry);
    }
    map.into_iter().map(|(_, e)| e).collect()
}

fn escape_glob_char(c: char) -> bool {
    matches!(
        c,
        '.' | '+' | '^' | '$' | '(' | ')' | '|' | '[' | ']' | '\\'
    )
}

/// JS `globToRegex`: `**`, `*`, `?`, `{a,b}`; anchored.
fn glob_to_regex(glob: &str) -> Option<Regex> {
    let chars: Vec<char> = glob.chars().collect();
    let mut re = String::from("^");
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '*' {
            if chars.get(i + 1) == Some(&'*') {
                re.push_str(DOT);
                re.push('*');
                i += 2;
                if chars.get(i) == Some(&'/') {
                    i += 1;
                }
            } else {
                re.push_str("[^/]*");
                i += 1;
            }
        } else if c == '?' {
            re.push_str("[^/]");
            i += 1;
        } else if c == '{' {
            let end = chars[i..].iter().position(|ch| *ch == '}').map(|p| p + i);
            match end {
                None => {
                    re.push_str("\\{");
                    i += 1;
                }
                Some(end) => {
                    let inner: String = chars[i + 1..end].iter().collect();
                    let parts: Vec<String> = inner
                        .split(',')
                        .map(|p| {
                            let mut s = String::new();
                            for ch in p.chars() {
                                if escape_glob_char(ch) {
                                    s.push('\\');
                                }
                                s.push(ch);
                            }
                            s
                        })
                        .collect();
                    re.push_str(&format!("(?:{})", parts.join("|")));
                    i = end + 1;
                }
            }
        } else if escape_glob_char(c) {
            re.push('\\');
            re.push(c);
            i += 1;
        } else {
            // A `}` outside an alternation is a literal in JS; escape it for the
            // regex crate, which treats a stray `}` the same way but is stricter
            // about `{`.
            if c == '}' {
                re.push('\\');
            }
            re.push(c);
            i += 1;
        }
    }
    re.push('$');
    Regex::new(&re).ok()
}

/// JS: impeccable-config.mjs#matchesAnyGlob
pub fn matches_any_glob(file_path: &str, globs: &[String]) -> bool {
    if globs.is_empty() {
        return false;
    }
    let normalized = jsp::to_posix(file_path);
    for glob in globs {
        let Some(re) = glob_to_regex(glob) else {
            continue;
        };
        if re.is_match(&normalized) {
            return true;
        }
        let base = normalized.rsplit('/').next().unwrap_or("");
        if re.is_match(base) {
            return true;
        }
    }
    false
}

/// JS: impeccable-config.mjs#shouldIgnoreDetectionFile
pub fn should_ignore_detection_file(file_path: &str, root: &str, config: &DetectionConfig) -> bool {
    let globs = &config.ignore_files;
    if globs.is_empty() {
        return false;
    }
    let raw = js::trim(file_path);
    if raw.is_empty() {
        return false;
    }
    if matches_any_glob(raw, globs) {
        return true;
    }
    let abs = if jsp::is_absolute(raw) {
        raw.to_string()
    } else {
        jsp::resolve(root, &[raw])
    };
    if matches_any_glob(&abs, globs) {
        return true;
    }
    let rel = jsp::relative(root, root, &abs);
    if !rel.is_empty() && !rel.starts_with("..") && !jsp::is_absolute(&rel) {
        return matches_any_glob(&rel, globs);
    }
    false
}

/// JS: impeccable-config.mjs#filterDetectionFindings
pub fn filter_detection_findings(findings: Vec<Finding>, config: &DetectionConfig) -> Vec<Finding> {
    if findings.is_empty() {
        return vec![];
    }
    let ignore_rules: Vec<String> = config
        .ignore_rules
        .iter()
        .map(|r| normalize_ignore_rule(r))
        .collect();
    let ignore_values = normalize_ignore_value_entries_typed(&config.ignore_values);
    findings
        .into_iter()
        .filter(|f| {
            if ignore_rules.contains(&normalize_ignore_rule(&f.antipattern)) {
                return false;
            }
            !is_ignored_finding_value(f, &ignore_values)
        })
        .collect()
}

fn is_ignored_finding_value(finding: &Finding, ignore_values: &[IgnoreValueEntry]) -> bool {
    if ignore_values.is_empty() {
        return false;
    }
    let rule = normalize_ignore_rule(&finding.antipattern);
    if rule.is_empty() {
        return false;
    }
    let value = extract_finding_ignore_value(finding);
    ignore_values.iter().any(|entry| {
        if entry.rule != rule {
            return false;
        }
        let wildcard = entry.value == "*";
        if !wildcard && (value.is_empty() || !ignore_value_matches(&rule, &entry.value, &value)) {
            return false;
        }
        match &entry.files {
            Some(files) if !files.is_empty() => finding_matches_scoped_ignore_file(finding, files),
            _ => !wildcard,
        }
    })
}

fn finding_matches_scoped_ignore_file(finding: &Finding, globs: &[String]) -> bool {
    let file_path = js::trim(&finding.file);
    if file_path.is_empty() {
        return false;
    }
    if matches_any_glob(file_path, globs) {
        return true;
    }
    let normalized = jsp::to_posix(file_path);
    let parts: Vec<&str> = normalized.split('/').filter(|p| !p.is_empty()).collect();
    for i in 0..parts.len() {
        let suffix = parts[i..].join("/");
        if matches_any_glob(&suffix, globs) {
            return true;
        }
    }
    false
}

const DIRECT_VALUE_RULES: &[&str] = &[
    "overused-font",
    "bounce-easing",
    "design-system-font",
    "design-system-color",
    "design-system-radius",
    "design-system-font-size",
];

/// JS: impeccable-config.mjs#extractFindingIgnoreValue
pub fn extract_finding_ignore_value(finding: &Finding) -> String {
    let rule = normalize_ignore_rule(&finding.antipattern);
    if !DIRECT_VALUE_RULES.contains(&rule.as_str()) {
        return String::new();
    }
    normalize_ignore_value(&extract_finding_ignore_value_raw(finding, &rule))
}

/// JS `extractFindingIgnoreValue({ antipattern: rule, ignoreValue: value })`:
/// what the extractor would produce for a synthetic finding of this rule
/// carrying `value`. Empty means the rule can never extract a value, so an
/// exact ignore entry for it would silently match nothing (issue #662).
/// Shared by `ignores add-value` and `hooks ignore-value`.
pub fn synthetic_ignore_value(rule: &str, value: &str) -> String {
    let mut extras = serde_json::Map::new();
    extras.insert(
        "ignoreValue".into(),
        Value::String(value.to_string()),
    );
    let finding = Finding {
        antipattern: rule.to_string(),
        name: String::new(),
        description: String::new(),
        severity: String::new(),
        category: None,
        file: String::new(),
        line: 0.0,
        snippet: String::new(),
        advisory: None,
        extras,
    };
    extract_finding_ignore_value(&finding)
}

fn extra_str<'a>(finding: &'a Finding, key: &str) -> Option<&'a str> {
    match finding.extras.get(key) {
        Some(Value::String(s)) => Some(s.as_str()),
        _ => None,
    }
}

re!(
    PRIMARY_FONT_RE,
    format!("(?i:Primary font):{WS}*([^()\n;]+)")
);
re!(
    GOOGLE_LABEL_RE,
    format!("(?i:Google Fonts):{WS}*([^()\n;]+)")
);
re!(
    FAMILY_RE,
    format!(r#"(?i:font-family){WS}*:{WS}*["']?([^'",;\n]+)"#)
);
re!(GOOGLE_PARAM_RE, "[?&](?i:family)=([^&:;\n]+)");

fn extract_finding_ignore_value_raw(finding: &Finding, rule: &str) -> String {
    let direct_src = extra_str(finding, "ignoreValue")
        .filter(|s| !s.is_empty())
        .or_else(|| extra_str(finding, "value").filter(|s| !s.is_empty()))
        .unwrap_or("");
    let direct = clean_ignore_value_display(direct_src);
    if !direct.is_empty() {
        return direct;
    }
    let mut candidates: Vec<&str> = Vec::new();
    if let Some(d) = extra_str(finding, "detail") {
        if !d.is_empty() {
            candidates.push(d);
        }
    }
    if !finding.snippet.is_empty() {
        candidates.push(&finding.snippet);
    }
    for text in candidates {
        if rule == "bounce-easing" {
            let motion = extract_motion_ignore_value(text);
            if !motion.is_empty() {
                return motion;
            }
            continue;
        }
        if let Some(m) = PRIMARY_FONT_RE.captures(text) {
            return clean_ignore_value_display(&m[1]);
        }
        if let Some(m) = GOOGLE_LABEL_RE.captures(text) {
            return clean_ignore_value_display(&m[1]);
        }
        if let Some(m) = FAMILY_RE.captures(text) {
            return clean_ignore_value_display(&m[1]);
        }
        if let Some(m) = GOOGLE_PARAM_RE.captures(text) {
            return clean_ignore_value_display(&decode_uri_component(&m[1]));
        }
    }
    String::new()
}

/// JS `decodeURIComponent` with the source's `try { } catch { raw }` fallback.
pub fn decode_uri_component(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 < bytes.len() {
                let hex = &s[i + 1..i + 3];
                if let Ok(v) = u8::from_str_radix(hex, 16) {
                    out.push(v);
                    i += 3;
                    continue;
                }
            }
            return s.to_string();
        }
        out.push(bytes[i]);
        i += 1;
    }
    match String::from_utf8(out) {
        Ok(v) => v,
        Err(_) => s.to_string(),
    }
}

re!(
    ANIMATE_BOUNCE_RE,
    format!("(?-u:\\b)(?i:animate-bounce)(?-u:\\b)")
);
re!(BEZIER_RE, r"(?i:cubic-bezier)\([^)]+\)");
re!(
    ANIMATION_RE,
    format!("(?i:animation)(?:-(?i:name))?{WS}*:{WS}*([^;\n]+)")
);
re!(MOTION_TOKEN_RE, "(?i:bounce|elastic|wobble|jiggle|spring)");
static COMMA_WS_SPLIT_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(&format!("[,{}]+", impeccable_core::js::WS_CHARS)).unwrap());

fn extract_motion_ignore_value(text: &str) -> String {
    if let Some(m) = ANIMATE_BOUNCE_RE.find(text) {
        return clean_ignore_value_display(m.as_str());
    }
    if let Some(m) = BEZIER_RE.find(text) {
        return clean_ignore_value_display(m.as_str());
    }
    if let Some(m) = ANIMATION_RE.captures(text) {
        let token = COMMA_WS_SPLIT_RE
            .split(&m[1])
            .find(|part| MOTION_TOKEN_RE.is_match(part));
        if let Some(t) = token {
            return clean_ignore_value_display(t);
        }
    }
    String::new()
}

fn clean_ignore_value_display(value: &str) -> String {
    let t = js::trim(value);
    let t = EDGE_QUOTE_RE.replace_all(t, "");
    let t = t.replace('+', " ");
    WS_RUN_RE.replace_all(&t, " ").into_owned()
}

/// JS: impeccable-config.mjs#getHookConsent
pub fn get_hook_consent(root: &str) -> Option<String> {
    let mut consent = None;
    for file_path in [get_config_path(root), get_local_config_path(root)] {
        let raw = safe_read_json(&file_path);
        if let Some(hook) = hook_section(raw.as_ref()) {
            if let Some(Value::String(c)) = hook.get("consent") {
                if c == "accepted" || c == "declined" {
                    consent = Some(c.clone());
                }
            }
        }
    }
    consent
}

const EXCLUDE_OPEN: &str = "# impeccable-config-ignore-start";
const EXCLUDE_CLOSE: &str = "# impeccable-config-ignore-end";
const EXCLUDE_PATTERNS: &[&str] = &[".impeccable/config.local.json"];

/// JS: impeccable-config.mjs#ensureConfigGitExclude. Best effort; false when
/// there is no resolvable git dir.
pub fn ensure_config_git_exclude(root: &str) -> bool {
    let Some(git_dir) = resolve_git_dir(root) else {
        return false;
    };
    let target = jsp::join(&[&git_dir, "info", "exclude"]);
    let existing = crate::util::read_text(&target).unwrap_or_default();
    let mut block_lines = vec![EXCLUDE_OPEN];
    block_lines.extend(EXCLUDE_PATTERNS);
    block_lines.push(EXCLUDE_CLOSE);
    let block = block_lines.join("\n");
    let marker_re = Regex::new(&format!(
        "{}(?s:.)*?{}",
        regex::escape(EXCLUDE_OPEN),
        regex::escape(EXCLUDE_CLOSE)
    ))
    .unwrap();
    let updated = if marker_re.is_match(&existing) {
        marker_re.replace(&existing, block.as_str()).into_owned()
    } else {
        let prefix = if existing.is_empty() {
            String::new()
        } else if existing.ends_with('\n') {
            existing.clone()
        } else {
            format!("{existing}\n")
        };
        format!("{prefix}{block}\n")
    };
    if updated != existing {
        if let Some(dir) = std::path::Path::new(&target).parent() {
            if std::fs::create_dir_all(dir).is_err() {
                return false;
            }
        }
        if std::fs::write(&target, updated).is_err() {
            return false;
        }
    }
    true
}

fn resolve_git_dir(root: &str) -> Option<String> {
    let dot_git = jsp::join(&[root, ".git"]);
    let meta = std::fs::metadata(&dot_git).ok()?;
    if meta.is_dir() {
        return Some(dot_git);
    }
    let text = crate::util::read_text(&dot_git)?;
    re!(GITDIR_RE, format!("gitdir:{WS}*({DOT}+)"));
    let m = GITDIR_RE.captures(&text)?;
    let resolved = js::trim(&m[1]).to_string();
    Some(if jsp::is_absolute(&resolved) {
        resolved
    } else {
        jsp::join(&[root, &resolved])
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn globs() {
        assert!(matches_any_glob(
            "src/legacy/a.css",
            &["src/legacy/**".to_string()]
        ));
        assert!(matches_any_glob(
            "/abs/src/demo.css",
            &["demo.css".to_string()]
        ));
        assert!(!matches_any_glob("src/a.css", &["src/*.scss".to_string()]));
        assert!(matches_any_glob("a.scss", &["*.{css,scss}".to_string()]));
    }

    #[test]
    fn colors() {
        assert_eq!(color_ignore_key("#fff"), "255,255,255,255");
        assert_eq!(
            color_ignore_key("rgb(255 255 255 / 50%)"),
            "255,255,255,128"
        );
        assert_eq!(color_ignore_key("hsl(0, 0%, 100%)"), "255,255,255,255");
        assert!(ignore_value_matches(
            "design-system-color",
            "#ffffff",
            "rgb(255,255,255)"
        ));
    }

    #[test]
    fn normalize() {
        assert_eq!(normalize_ignore_value(" 'Open+Sans' "), "open sans");
        assert_eq!(decode_uri_component("Open%20Sans"), "Open Sans");
        assert_eq!(decode_uri_component("bad%zz"), "bad%zz");
    }
}
