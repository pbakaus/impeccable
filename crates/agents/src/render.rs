use super::Spec;
use serde::de::{DeserializeSeed, MapAccess, SeqAccess, Visitor};
use serde_json::{Value, json};
use std::path::Path;

pub(super) fn render(
    s: &Spec,
    path: &Path,
    before: Option<&[u8]>,
) -> Result<Vec<u8>, (&'static str, String, i32)> {
    if s.harness == "codex" && path.ends_with("config.toml") {
        return render_codex_config(s, before);
    }
    let is_rule = path.ends_with("CLAUDE.md") || path.ends_with("AGENTS.md");
    if is_rule {
        return render_rule(s, before);
    }
    let mut value = if let Some(b) = before {
        parse_unique_json(b).map_err(|_| {
            (
                "invalid_settings",
                format!("Refusing non-plain JSON at {}", path.display()),
                4,
            )
        })?
    } else {
        json!({})
    };
    if !value.is_object() {
        return Err(("invalid_settings", "Expected JSON object".into(), 4));
    }
    let mut changed = false;
    if s.harness == "claude" && path.ends_with("settings.json") && !s.hooks.is_empty() {
        let obj = value.as_object_mut().unwrap();
        if !obj.contains_key("hooks") {
            changed = true;
        }
        let hooks = obj.entry("hooks").or_insert(json!({}));
        if !hooks.is_object() {
            return Err(("invalid_settings", "hooks must be an object".into(), 4));
        }
        for h in &s.hooks {
            if !hooks.as_object().unwrap().contains_key(&h.event) {
                changed = true;
            }
            let ev = hooks
                .as_object_mut()
                .unwrap()
                .entry(&h.event)
                .or_insert(json!([]));
            if !ev.is_array() {
                return Err(("invalid_settings", "hook event must be an array".into(), 4));
            }
            let command = json!({"type":"command","command":h.command});
            let entry = json!({"matcher":h.matcher,"hooks":[command]});
            let arr = ev.as_array_mut().unwrap();
            if !arr.contains(&entry) {
                arr.push(entry);
                changed = true;
            }
        }
    }
    if s.harness == "codex" && path.ends_with("hooks.json") && !s.hooks.is_empty() {
        let obj = value.as_object_mut().unwrap();
        for h in &s.hooks {
            if !obj.contains_key(&h.event) {
                changed = true;
            }
            let ev = obj.entry(&h.event).or_insert(json!([]));
            if !ev.is_array() {
                return Err(("invalid_settings", "hook event must be an array".into(), 4));
            }
            let entry = json!({"command":h.command});
            if !ev.as_array().unwrap().contains(&entry) {
                ev.as_array_mut().unwrap().push(entry);
                changed = true;
            }
        }
    }
    if !changed {
        return Ok(before.map_or_else(|| b"{}\n".to_vec(), ToOwned::to_owned));
    }
    serde_json::to_vec_pretty(&value)
        .map(|mut b| {
            b.push(b'\n');
            b
        })
        .map_err(|_| ("invalid_settings", "Could not serialize settings".into(), 4))
}

pub(super) fn remove_owned(
    s: &Spec,
    path: &Path,
    current: &[u8],
    original: Option<&[u8]>,
) -> Result<Option<Vec<u8>>, (&'static str, String, i32)> {
    if (s.instruction.is_some() || path.ends_with("CLAUDE.md") || path.ends_with("AGENTS.md"))
        && String::from_utf8_lossy(current).contains(&format!("impeccable:{}", s.owner))
    {
        return remove_rule_block(s, current, original).map(Some);
    }
    if s.harness == "claude" && !s.hooks.is_empty() {
        return remove_json_hooks(s, current, original, true);
    }
    if s.harness == "codex" && !s.hooks.is_empty() {
        if current.iter().copied().find(|b| !b.is_ascii_whitespace()) == Some(b'{') {
            return remove_json_hooks(s, current, original, false);
        }
        return remove_codex_hooks(current, original).map(Some);
    }
    let _ = path;
    Ok(None)
}
fn remove_rule_block(
    s: &Spec,
    current: &[u8],
    original: Option<&[u8]>,
) -> Result<Vec<u8>, (&'static str, String, i32)> {
    let mut text = String::from_utf8(current.to_vec()).map_err(|_| {
        (
            "invalid_rule_file",
            "Rule file is not valid UTF-8".into(),
            4,
        )
    })?;
    let marker = format!("impeccable:{}", s.owner);
    let start = format!("<!-- {marker} start -->");
    let end = format!("<!-- {marker} end -->");
    let Some(a) = text.find(&start) else {
        return Ok(current.to_vec());
    };
    let Some(e) = text.find(&end) else {
        return Err((
            "ambiguous_markers",
            "Instruction markers are unbalanced".into(),
            4,
        ));
    };
    let lines: Vec<&str> = text.lines().collect();
    let start_lines = lines.iter().filter(|line| **line == start).count();
    let end_lines = lines.iter().filter(|line| **line == end).count();
    if text.matches(&start).count() != start_lines
        || text.matches(&end).count() != end_lines
        || start_lines != 1
        || end_lines != 1
        || a >= e
    {
        return Err((
            "ambiguous_markers",
            "Instruction markers are duplicated".into(),
            4,
        ));
    }
    if let Some(original) = original.and_then(|b| String::from_utf8(b.to_vec()).ok()) {
        if let (Some(oa), Some(oe)) = (original.find(&start), original.find(&end)) {
            let previous = &original[oa..oe + end.len()];
            let b = e + end.len();
            text.replace_range(a..b, previous);
            return Ok(text.into_bytes());
        }
    }
    let nl = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let line_start = text[..a].rfind('\n').map_or(0, |i| i + 1);
    let after = e + end.len();
    let line_end = if text[after..].starts_with("\r\n") {
        after + 2
    } else if text[after..].starts_with('\n') {
        after + 1
    } else {
        after
    };
    let mut remove_start = line_start;
    if line_start >= nl.len() && text[..line_start].ends_with(&format!("{nl}{nl}")) {
        remove_start -= nl.len();
    }
    text.replace_range(remove_start..line_end, "");
    Ok(text.into_bytes())
}
fn remove_json_hooks(
    s: &Spec,
    current: &[u8],
    original: Option<&[u8]>,
    claude: bool,
) -> Result<Option<Vec<u8>>, (&'static str, String, i32)> {
    let mut cur = parse_unique_json(current).map_err(|_| {
        (
            "invalid_settings",
            "Refusing invalid JSON during undo".into(),
            4,
        )
    })?;
    let orig = original.and_then(|b| parse_unique_json(b).ok());
    let Some(root) = cur.as_object_mut() else {
        return Ok(None);
    };
    let changed = if claude {
        let Some(container) = root.get_mut("hooks").and_then(Value::as_object_mut) else {
            return Ok(None);
        };
        let changed = remove_hook_entries(s, container, orig.as_ref(), true);
        let empty = container.is_empty();
        if empty {
            root.remove("hooks");
        }
        changed
    } else {
        remove_hook_entries(s, root, orig.as_ref(), false)
    };
    if !changed {
        return Ok(None);
    }
    serde_json::to_vec_pretty(&cur)
        .map(|mut b| {
            b.push(b'\n');
            Some(b)
        })
        .map_err(|_| {
            (
                "invalid_settings",
                "Could not serialize hook settings during undo".into(),
                4,
            )
        })
}
fn remove_hook_entries(
    s: &Spec,
    container: &mut serde_json::Map<String, Value>,
    original: Option<&Value>,
    claude: bool,
) -> bool {
    let mut changed = false;
    for h in &s.hooks {
        let key = h.event.as_str();
        let Some(entries) = container.get_mut(key).and_then(Value::as_array_mut) else {
            continue;
        };
        let entry = if claude {
            json!({"matcher":h.matcher,"hooks":[{"type":"command","command":h.command}]})
        } else {
            json!({"command":h.command})
        };
        let existed = original
            .and_then(|v| if claude { v.get("hooks") } else { Some(v) })
            .and_then(|v| v.get(key))
            .and_then(Value::as_array)
            .is_some_and(|a| a.contains(&entry));
        if !existed {
            let n = entries.len();
            entries.retain(|v| v != &entry);
            changed |= entries.len() != n;
        }
    }
    for h in &s.hooks {
        if container
            .get(&h.event)
            .and_then(Value::as_array)
            .is_some_and(Vec::is_empty)
        {
            container.remove(&h.event);
        }
    }
    changed
}
fn remove_codex_hooks(
    current: &[u8],
    original: Option<&[u8]>,
) -> Result<Vec<u8>, (&'static str, String, i32)> {
    let mut text = String::from_utf8(current.to_vec()).map_err(|_| {
        (
            "invalid_settings",
            "Codex config.toml is not UTF-8".into(),
            4,
        )
    })?;
    let original_text = original
        .and_then(|b| String::from_utf8(b.to_vec()).ok())
        .unwrap_or_default();
    let original_setting = original_text.lines().find_map(|l| {
        let t = l.trim();
        t.strip_prefix("hooks = ").and_then(|v| match v {
            "true" => Some(true),
            "false" => Some(false),
            _ => None,
        })
    });
    if original_setting == Some(true) {
        return Ok(text.into_bytes());
    }
    let lines: Vec<&str> = text.lines().collect();
    let mut offsets = Vec::new();
    let mut cursor = 0usize;
    for line in &lines {
        offsets.push(cursor);
        cursor += line.len();
        if text[cursor..].starts_with("\r\n") {
            cursor += 2
        } else if text[cursor..].starts_with('\n') {
            cursor += 1
        }
    }
    let mut section = None;
    let mut feature_table = None;
    let mut hook_line = None;
    let mut feature_other = false;
    for (i, line) in lines.iter().enumerate() {
        let t = line.trim();
        if t.starts_with('[') && t.ends_with(']') {
            section = Some(&t[1..t.len() - 1]);
            if section == Some("features") {
                feature_table = Some(i)
            }
            continue;
        }
        if section == Some("features") && !t.is_empty() {
            if t == "hooks = true" {
                hook_line = Some(i)
            } else {
                feature_other = true
            }
        }
    }
    let Some(hook_i) = hook_line else {
        return Ok(text.into_bytes());
    };
    let hook = lines[hook_i];
    let eq = hook.find('=').unwrap();
    let rest = &hook[eq + 1..];
    let leading = rest.len() - rest.trim_start().len();
    let value_start = offsets[hook_i] + eq + 1 + leading;
    if original_setting == Some(false) {
        text.replace_range(value_start..value_start + 4, "false");
        return Ok(text.into_bytes());
    }
    let mut ranges = vec![(
        offsets[hook_i],
        line_end(&text, offsets[hook_i], hook.len()),
    )];
    if !feature_other && original_text.lines().all(|l| l.trim() != "[features]") {
        if let Some(i) = feature_table {
            let mut start = offsets[i];
            let nl = if text.contains("\r\n") { "\r\n" } else { "\n" };
            if start >= 2 * nl.len() && text[..start].ends_with(&format!("{nl}{nl}")) {
                start -= nl.len();
            }
            ranges.push((start, line_end(&text, offsets[i], lines[i].len())));
        }
    }
    ranges.sort_by(|a, b| b.0.cmp(&a.0));
    for (start, end) in ranges {
        text.replace_range(start..end, "");
    }
    Ok(text.into_bytes())
}
fn line_end(text: &str, start: usize, len: usize) -> usize {
    let end = start + len;
    if text[end..].starts_with("\r\n") {
        end + 2
    } else if text[end..].starts_with('\n') {
        end + 1
    } else {
        end
    }
}

pub(super) fn parse_unique_json(bytes: &[u8]) -> Result<Value, serde_json::Error> {
    struct Unique;
    impl<'de> DeserializeSeed<'de> for Unique {
        type Value = Value;
        fn deserialize<D: serde::Deserializer<'de>>(self, d: D) -> Result<Value, D::Error> {
            d.deserialize_any(UniqueVisitor)
        }
    }
    struct UniqueVisitor;
    impl<'de> Visitor<'de> for UniqueVisitor {
        type Value = Value;
        fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str("JSON without duplicate object keys")
        }
        fn visit_bool<E: serde::de::Error>(self, v: bool) -> Result<Value, E> {
            Ok(Value::Bool(v))
        }
        fn visit_i64<E: serde::de::Error>(self, v: i64) -> Result<Value, E> {
            Ok(Value::Number(v.into()))
        }
        fn visit_u64<E: serde::de::Error>(self, v: u64) -> Result<Value, E> {
            Ok(Value::Number(v.into()))
        }
        fn visit_f64<E: serde::de::Error>(self, v: f64) -> Result<Value, E> {
            serde_json::Number::from_f64(v)
                .map(Value::Number)
                .ok_or_else(|| E::custom("non-finite number"))
        }
        fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<Value, E> {
            Ok(Value::String(v.into()))
        }
        fn visit_string<E: serde::de::Error>(self, v: String) -> Result<Value, E> {
            Ok(Value::String(v))
        }
        fn visit_unit<E: serde::de::Error>(self) -> Result<Value, E> {
            Ok(Value::Null)
        }
        fn visit_none<E: serde::de::Error>(self) -> Result<Value, E> {
            Ok(Value::Null)
        }
        fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Value, A::Error> {
            let mut out = Vec::new();
            while let Some(v) = seq.next_element_seed(Unique)? {
                out.push(v)
            }
            Ok(Value::Array(out))
        }
        fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Value, A::Error> {
            let mut out = serde_json::Map::new();
            while let Some(key) = map.next_key::<String>()? {
                if out.contains_key(&key) {
                    return Err(serde::de::Error::custom("duplicate object key"));
                }
                let value = map.next_value_seed(Unique)?;
                out.insert(key, value);
            }
            Ok(Value::Object(out))
        }
    }
    let mut deserializer = serde_json::Deserializer::from_slice(bytes);
    let value = Unique.deserialize(&mut deserializer)?;
    deserializer.end()?;
    Ok(value)
}
pub(super) fn render_codex_config(
    s: &Spec,
    before: Option<&[u8]>,
) -> Result<Vec<u8>, (&'static str, String, i32)> {
    if s.hooks.is_empty() {
        return Ok(before.unwrap_or_default().to_vec());
    }
    let mut text = match before {
        Some(b) => String::from_utf8(b.to_vec()).map_err(|_| {
            (
                "invalid_settings",
                "Codex config.toml is not UTF-8".into(),
                4,
            )
        })?,
        None => String::new(),
    };
    if text.contains('#') {
        return Err((
            "invalid_settings",
            "Refusing commented Codex TOML".into(),
            4,
        ));
    }
    let lines: Vec<&str> = text.lines().collect();
    let nl = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let mut section: Option<&str> = None;
    let mut features = Vec::new();
    let mut tables = std::collections::HashSet::new();
    let mut seen = std::collections::HashSet::new();
    let mut offsets = Vec::new();
    let mut cursor = 0;
    for line in &lines {
        offsets.push(cursor);
        cursor += line.len();
        if text[cursor..].starts_with("\r\n") {
            cursor += 2;
        } else if text[cursor..].starts_with('\n') {
            cursor += 1;
        }
    }
    let mut hooks_replacement = None;
    for (i, line) in lines.iter().enumerate() {
        let t = line.trim();
        if t.is_empty() {
            continue;
        }
        if t.starts_with('[') {
            if !t.ends_with(']') || t.starts_with("[[") {
                return Err(("invalid_settings", "Unexpected TOML table shape".into(), 4));
            }
            let name = &t[1..t.len() - 1];
            if name.is_empty()
                || name.split('.').any(|part| {
                    part.is_empty()
                        || !part
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
                })
            {
                return Err(("invalid_settings", "Unexpected TOML table shape".into(), 4));
            }
            if !tables.insert(name) {
                return Err(("invalid_settings", "Duplicate TOML table".into(), 4));
            }
            if name == "features" {
                if !features.is_empty() {
                    return Err(("invalid_settings", "Duplicate [features] table".into(), 4));
                }
                features.push(i);
            }
            section = Some(name);
            continue;
        }
        let Some((key, value)) = t.split_once('=') else {
            return Err((
                "invalid_settings",
                "Unexpected TOML setting shape".into(),
                4,
            ));
        };
        let key = key.trim();
        if key.is_empty() || key.contains(['.', '"', '\'']) {
            return Err(("invalid_settings", "Unexpected TOML key shape".into(), 4));
        }
        if !seen.insert((section.unwrap_or(""), key)) {
            return Err(("invalid_settings", "Duplicate TOML key".into(), 4));
        }
        if section == Some("features") && key == "hooks" {
            let value = value.trim();
            if value == "true" {
                return Ok(text.into_bytes());
            }
            if value != "false" {
                return Err((
                    "invalid_settings",
                    "features.hooks must be a boolean".into(),
                    4,
                ));
            }
            let eq = line.find('=').unwrap();
            let rest = &line[eq + 1..];
            let leading = rest.len() - rest.trim_start().len();
            let start = offsets[i] + eq + 1 + leading;
            hooks_replacement = Some((start, start + value.len()));
        }
    }
    if let Some((start, end)) = hooks_replacement {
        text.replace_range(start..end, "true");
        return Ok(text.into_bytes());
    }
    if let Some(table_line) = features.first().copied() {
        let insert_line = (table_line + 1..lines.len())
            .find(|i| lines[*i].trim().starts_with('['))
            .unwrap_or(lines.len());
        let offset = if insert_line == lines.len() {
            text.len()
        } else {
            offsets[insert_line]
        };
        text.insert_str(offset, &format!("hooks = true{nl}"));
        return Ok(text.into_bytes());
    }
    if !text.is_empty() && !text.ends_with('\n') {
        text.push_str(nl);
    }
    if !text.is_empty() && !text.ends_with(&format!("{nl}{nl}")) {
        text.push_str(nl);
    }
    text.push_str(&format!("[features]{nl}hooks = true{nl}"));
    Ok(text.into_bytes())
}
pub(super) fn render_rule(
    s: &Spec,
    before: Option<&[u8]>,
) -> Result<Vec<u8>, (&'static str, String, i32)> {
    let marker = format!("impeccable:{}", s.owner);
    let start = format!("<!-- {marker} start -->");
    let end = format!("<!-- {marker} end -->");
    let mut text = match before {
        Some(bytes) => String::from_utf8(bytes.to_vec()).map_err(|_| {
            (
                "invalid_rule_file",
                "Rule file is not valid UTF-8".into(),
                4,
            )
        })?,
        None => String::new(),
    };
    let lines: Vec<&str> = text.lines().collect();
    let starts: Vec<usize> = lines
        .iter()
        .enumerate()
        .filter_map(|(i, l)| (*l == start).then_some(i))
        .collect();
    let ends: Vec<usize> = lines
        .iter()
        .enumerate()
        .filter_map(|(i, l)| (*l == end).then_some(i))
        .collect();
    if text.matches(&start).count() != starts.len()
        || text.matches(&end).count() != ends.len()
        || starts.len() != ends.len()
        || starts.len() > 1
        || starts
            .first()
            .zip(ends.first())
            .is_some_and(|(a, b)| a >= b)
    {
        return Err((
            "ambiguous_markers",
            "Instruction markers must be unique, balanced, standalone lines in order".into(),
            4,
        ));
    }
    let nl = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let body = s.instruction.as_deref().unwrap_or("");
    let block = if body.is_empty() {
        String::new()
    } else {
        format!("{start}{nl}{body}{nl}{end}")
    };
    if starts.len() == 1 {
        let a = text.find(&start).unwrap();
        let b = text.find(&end).unwrap() + end.len();
        text.replace_range(a..b, &block);
    } else if !block.is_empty() {
        if !text.is_empty() && !text.ends_with('\n') {
            text.push_str(nl)
        }
        if !text.is_empty() && !text.ends_with(&format!("{nl}{nl}")) {
            text.push_str(nl)
        }
        text.push_str(&block);
        text.push_str(nl)
    }
    Ok(text.into_bytes())
}
