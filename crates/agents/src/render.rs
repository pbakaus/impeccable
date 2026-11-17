use super::Spec;
use serde::de::{DeserializeSeed, MapAccess, SeqAccess, Visitor};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use toml_edit::{ImDocument, Item, Value as TomlValue};

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
    let hook_file = (s.harness == "claude" && path.ends_with("settings.json"))
        || (s.harness == "codex" && path.ends_with("hooks.json"));
    if hook_file && !s.hooks.is_empty() {
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
            let entry = h.entry();
            let arr = ev.as_array_mut().unwrap();
            if !arr.contains(&entry) {
                arr.push(entry);
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
        return remove_json_hooks(s, current, original);
    }
    if s.harness == "codex" && (!s.hooks.is_empty() || !s.mcp_approvals.is_empty()) {
        if current.iter().copied().find(|b| !b.is_ascii_whitespace()) == Some(b'{') {
            return remove_json_hooks(s, current, original);
        }
        let features = if s.hooks.is_empty() {
            current.to_vec()
        } else {
            remove_codex_hooks(current, original)?
        };
        return restore_approvals(s, &features, original).map(Some);
    }
    let _ = path;
    Ok(None)
}
/// The rule file whose managed block holds neither what the engine last
/// wrote (`old`, when it wrote an instruction) nor what `new` asks for: the
/// person edited it, and writing `new` would overwrite their edit. This reads
/// the file itself, so a block an earlier apply left behind, or one whose
/// journal was lost, is protected too.
pub(super) fn instruction_drift(
    old: Option<&Spec>,
    new: &Spec,
) -> Result<Option<PathBuf>, (&'static str, String, i32)> {
    let marker = format!("impeccable:{}", new.owner);
    let start = format!("<!-- {marker} start -->");
    let end = format!("<!-- {marker} end -->");
    let body_of = |spec: &Spec| -> Result<Option<String>, (&'static str, String, i32)> {
        let written = render_rule(spec, None)?;
        let written = String::from_utf8_lossy(&written);
        Ok(crate::resources::block_body(&written, &start, &end).map(str::to_string))
    };
    let mut allowed = vec![body_of(new)?];
    if let Some(old) = old.filter(|o| o.instruction.is_some()) {
        allowed.push(body_of(old)?);
    }
    let path = rule_file(new);
    let Ok(text) = fs::read_to_string(&path) else { return Ok(None) };
    if !text.contains(&start) {
        return Ok(None);
    }
    let body = crate::resources::block_body(&text, &start, &end).map(str::to_string);
    Ok((!allowed.contains(&body)).then_some(path))
}

/// The harness's rule file for this account root.
pub(super) fn rule_file(s: &Spec) -> PathBuf {
    s.root.join(if s.harness == "claude" { "CLAUDE.md" } else { "AGENTS.md" })
}

/// Whether this installation's resources are on disk, judged from the files
/// alone (no journal): its instruction block in the rule file, or one of its
/// exact hook entries in a JSON hook file. Shared settings such as Codex's
/// `features.hooks` prove nothing and are not read.
pub(super) fn installed_on_disk(s: &Spec) -> Option<PathBuf> {
    let rules = rule_file(s);
    if fs::read_to_string(&rules).is_ok_and(|t| t.contains(&format!("<!-- impeccable:{} start -->", s.owner))) {
        return Some(rules);
    }
    let hooks = s.root.join(if s.harness == "claude" { "settings.json" } else { "hooks.json" });
    let value = fs::read(&hooks).ok().and_then(|b| parse_unique_json(&b).ok())?;
    s.hooks
        .iter()
        .any(|h| {
            value
                .get("hooks")
                .and_then(|v| v.get(&h.event))
                .and_then(Value::as_array)
                .is_some_and(|a| a.contains(&h.entry()))
        })
        .then_some(hooks)
}

/// The spec's hooks still in `settings` (JSON) in a form the engine didn't
/// write: same command, other fields changed. Undo leaves them, and says so.
pub(super) fn drifted_hooks(s: &Spec, settings: &[u8], original: Option<&[u8]>) -> Vec<String> {
    let Ok(value) = parse_unique_json(settings) else { return vec![] };
    let original = original.and_then(|b| parse_unique_json(b).ok());
    let mut out = Vec::new();
    for h in &s.hooks {
        let Some(entries) = value.get("hooks").and_then(|v| v.get(&h.event)).and_then(Value::as_array) else {
            continue;
        };
        let ours = h.entry();
        let same_command = |e: &Value| {
            e.get("hooks").and_then(Value::as_array).is_some_and(|hs| {
                hs.iter().any(|c| c.get("command").and_then(Value::as_str) == Some(h.command.as_str()))
            })
        };
        // An entry that was there before the install is the person's own.
        let preexisting = |e: &Value| {
            original
                .as_ref()
                .and_then(|o| o.get("hooks"))
                .and_then(|v| v.get(&h.event))
                .and_then(Value::as_array)
                .is_some_and(|a| a.contains(e))
        };
        if entries.iter().any(|e| e != &ours && same_command(e) && !preexisting(e)) {
            out.push(format!("hook:{}:{}", h.event, h.command));
        }
    }
    out
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
    // A block the person edited is theirs now: leave it, and undo reports the conflict.
    let written = render_rule(s, None)?;
    let written = String::from_utf8_lossy(&written);
    if crate::resources::block_body(&text, &start, &end)
        != crate::resources::block_body(&written, &start, &end)
    {
        return Ok(current.to_vec());
    }
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
    let Some(container) = root.get_mut("hooks").and_then(Value::as_object_mut) else {
        return Ok(None);
    };
    let changed = remove_hook_entries(s, container, orig.as_ref());
    if container.is_empty() {
        root.remove("hooks");
    }
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
) -> bool {
    let mut changed = false;
    for h in &s.hooks {
        let key = h.event.as_str();
        let Some(entries) = container.get_mut(key).and_then(Value::as_array_mut) else {
            continue;
        };
        let entry = h.entry();
        let existed = original
            .and_then(|v| v.get("hooks"))
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
    let text = std::str::from_utf8(current).map_err(|_| invalid_toml("Codex TOML is not UTF-8"))?;
    let doc = parse_codex_document(text)?;
    let prior = original
        .map(|bytes| {
            std::str::from_utf8(bytes)
                .map_err(|_| invalid_toml("Original Codex TOML is not UTF-8"))
                .and_then(parse_codex_document)
        })
        .transpose()?;
    let original_hook = feature_hooks(prior.as_ref())?;
    if original_hook == Some(true) {
        return Ok(current.to_vec());
    }
    let Some(feature) = doc.as_table().get("features") else {
        return Ok(current.to_vec());
    };
    let Some(hook) = feature.as_table_like().and_then(|table| table.get("hooks")) else {
        return Ok(current.to_vec());
    };
    if hook.as_value().and_then(TomlValue::as_bool) != Some(true) {
        return Ok(current.to_vec());
    }
    if let Some(value) = original_hook {
        let span = hook
            .span()
            .ok_or_else(|| invalid_toml("Missing hooks value span"))?;
        return Ok(splice(text, span, if value { "true" } else { "false" }).into_bytes());
    }
    match feature {
        Item::Table(table) => {
            let span = hook
                .span()
                .ok_or_else(|| invalid_toml("Missing hooks value span"))?;
            let line = line_range(text, span.start, span.end);
            let mut start = line.start;
            let mut end = line.end;
            if end < text.len() && text[end..].starts_with("\r\n") {
                end += 2;
            } else if end < text.len() && text[end..].starts_with('\n') {
                end += 1;
            }
            if table.len() == 1 {
                let table_span = table
                    .span()
                    .ok_or_else(|| invalid_toml("Missing features span"))?;
                start = line_range(text, table_span.start, table_span.start).start;
                if text[..start].ends_with("\r\n\r\n") {
                    start -= 2;
                } else if text[..start].ends_with("\n\n") {
                    start -= 1;
                }
            }
            Ok(format!("{}{}", &text[..start], &text[end..]).into_bytes())
        }
        Item::Value(TomlValue::InlineTable(table)) => {
            let table_span = table
                .span()
                .ok_or_else(|| invalid_toml("Missing inline features span"))?;
            let value_span = hook
                .span()
                .ok_or_else(|| invalid_toml("Missing hooks value span"))?;
            let before = &text[table_span.start..value_span.start];
            let after = &text[value_span.end..table_span.end];
            let key_start = before
                .rfind("hooks")
                .ok_or_else(|| invalid_toml("Missing hooks key span"))?
                + table_span.start;
            let key_end = key_start + "hooks".len();
            let mut start = key_start;
            let mut end = value_span.end;
            let prefix = &text[table_span.start..start];
            if prefix.contains('=') {
                start = text[..start].rfind(',').unwrap_or(start);
            } else if let Some(comma) = after.find(',') {
                end = value_span.end + comma + 1;
            }
            let _ = key_end;
            Ok(format!("{}{}", &text[..start], &text[end..]).into_bytes())
        }
        _ => Err(invalid_toml("features must be a table or inline table")),
    }
}
fn invalid_toml(message: &str) -> (&'static str, String, i32) {
    ("invalid_settings", message.into(), 4)
}
fn parse_codex_document(text: &str) -> Result<ImDocument<String>, (&'static str, String, i32)> {
    text.parse::<ImDocument<String>>()
        .map_err(|_| invalid_toml("Refusing invalid Codex TOML"))
}
fn feature_hooks(
    doc: Option<&ImDocument<String>>,
) -> Result<Option<bool>, (&'static str, String, i32)> {
    let Some(doc) = doc else {
        return Ok(None);
    };
    let Some(features) = doc.as_table().get("features") else {
        return Ok(None);
    };
    match features {
        Item::Table(table) => table
            .get("hooks")
            .map(|item| {
                item.as_value()
                    .and_then(TomlValue::as_bool)
                    .ok_or_else(|| invalid_toml("features.hooks must be a boolean"))
            })
            .transpose(),
        Item::Value(TomlValue::InlineTable(table)) => table
            .get("hooks")
            .map(|value| {
                value
                    .as_bool()
                    .ok_or_else(|| invalid_toml("features.hooks must be a boolean"))
            })
            .transpose(),
        _ => Err(invalid_toml("features must be a table or inline table")),
    }
}
fn splice(text: &str, range: std::ops::Range<usize>, replacement: &str) -> String {
    format!(
        "{}{}{}",
        &text[..range.start],
        replacement,
        &text[range.end..]
    )
}
fn line_range(text: &str, start: usize, end: usize) -> std::ops::Range<usize> {
    let line_start = text[..start].rfind('\n').map_or(0, |index| index + 1);
    let line_end = text[end..]
        .find('\n')
        .map_or(text.len(), |index| end + index);
    line_start..line_end
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
#[allow(clippy::needless_return)]
pub(super) fn render_codex_config(
    s: &Spec,
    before: Option<&[u8]>,
) -> Result<Vec<u8>, (&'static str, String, i32)> {
    let mut out = render_codex_features(s, before)?;
    for a in &s.mcp_approvals {
        let text =
            std::str::from_utf8(&out).map_err(|_| invalid_toml("Codex TOML is not UTF-8"))?;
        out = set_approval(text, &a.server, Some(&a.mode))?.into_bytes();
    }
    Ok(out)
}
const APPROVAL_KEY: &str = "default_tools_approval_mode";
/// The standard `[mcp_servers.<server>]` table. Inline and dotted forms are
/// refused rather than rewritten, and a missing server is never created here.
fn server_table<'a>(
    doc: &'a ImDocument<String>,
    server: &str,
) -> Result<&'a toml_edit::Table, (&'static str, String, i32)> {
    let missing = || {
        (
            "server_missing",
            format!("Codex has no [mcp_servers.{server}] to set approval on"),
            4,
        )
    };
    let servers = doc.as_table().get("mcp_servers").ok_or_else(missing)?;
    let Some(servers) = servers.as_table() else {
        return Err(invalid_toml("mcp_servers must be a table"));
    };
    match servers.get(server).ok_or_else(missing)? {
        Item::Table(table) if !table.is_dotted() && table.span().is_some() => Ok(table),
        _ => Err(invalid_toml(
            "Inline or dotted MCP server tables need a manual edit",
        )),
    }
}
pub(super) fn approval_value(text: &str, server: &str) -> Option<String> {
    let doc = parse_codex_document(text).ok()?;
    let table = server_table(&doc, server).ok()?;
    table.get(APPROVAL_KEY)?.as_str().map(ToOwned::to_owned)
}
/// Sets (`Some`) or removes (`None`) the server's approval mode, touching only that line.
fn set_approval(
    text: &str,
    server: &str,
    mode: Option<&str>,
) -> Result<String, (&'static str, String, i32)> {
    let doc = parse_codex_document(text)?;
    let table = server_table(&doc, server)?;
    let newline = if text.contains("\r\n") { "\r\n" } else { "\n" };
    match (table.get(APPROVAL_KEY), mode) {
        (Some(item), Some(mode)) => {
            if item.as_str() == Some(mode) {
                return Ok(text.to_owned());
            }
            if item.as_str().is_none() {
                return Err(invalid_toml("default_tools_approval_mode must be a string"));
            }
            let span = item
                .span()
                .ok_or_else(|| invalid_toml("Missing approval value span"))?;
            Ok(splice(text, span, &format!("\"{mode}\"")))
        }
        (Some(item), None) => {
            let span = item
                .span()
                .ok_or_else(|| invalid_toml("Missing approval value span"))?;
            let line = line_range(text, span.start, span.end);
            let end = if text[line.end..].starts_with("\r\n") {
                line.end + 2
            } else if text[line.end..].starts_with('\n') {
                line.end + 1
            } else {
                line.end
            };
            Ok(format!("{}{}", &text[..line.start], &text[end..]))
        }
        (None, Some(mode)) => {
            let header = table.span().unwrap();
            let line = line_range(text, header.start, header.start);
            let at = if line.end < text.len() {
                line.end
                    + if text[line.end..].starts_with("\r\n") {
                        2
                    } else {
                        1
                    }
            } else {
                text.len()
            };
            let lead = if at == text.len() && !text.ends_with('\n') {
                newline
            } else {
                ""
            };
            let mut out = text.to_owned();
            out.insert_str(at, &format!("{lead}{APPROVAL_KEY} = \"{mode}\"{newline}"));
            Ok(out)
        }
        (None, None) => Ok(text.to_owned()),
    }
}
/// Undo: put back each approval the engine changed, if it still holds the written mode.
pub(super) fn restore_approvals(
    s: &Spec,
    current: &[u8],
    original: Option<&[u8]>,
) -> Result<Vec<u8>, (&'static str, String, i32)> {
    let mut text = std::str::from_utf8(current)
        .map_err(|_| invalid_toml("Codex TOML is not UTF-8"))?
        .to_owned();
    let before = original.and_then(|b| std::str::from_utf8(b).ok());
    for a in &s.mcp_approvals {
        let prior = before.and_then(|t| approval_value(t, &a.server));
        if prior.as_deref() == Some(a.mode.as_str())
            || approval_value(&text, &a.server).as_deref() != Some(a.mode.as_str())
        {
            continue;
        }
        text = set_approval(&text, &a.server, prior.as_deref())?;
    }
    Ok(text.into_bytes())
}
fn render_codex_features(
    s: &Spec,
    before: Option<&[u8]>,
) -> Result<Vec<u8>, (&'static str, String, i32)> {
    if s.hooks.is_empty() {
        return Ok(before.unwrap_or_default().to_vec());
    }
    let bytes = before.unwrap_or_default();
    let text = std::str::from_utf8(bytes).map_err(|_| invalid_toml("Codex TOML is not UTF-8"))?;
    let document = parse_codex_document(text)?;
    match feature_hooks(Some(&document))? {
        Some(true) => return Ok(before.unwrap_or_default().to_vec()),
        Some(false) => {
            // An explicit off switch also silences the person's other hooks; never flip it for them.
            return Err((
                "hooks_disabled",
                "Codex hooks are turned off (features.hooks = false); turn them on first".into(),
                4,
            ));
        }
        None => match document.as_table().get("features") {
            Some(Item::Table(table)) => {
                let newline = if text.contains("\r\n") { "\r\n" } else { "\n" };
                let span = table
                    .span()
                    .ok_or_else(|| invalid_toml("Missing features span"))?;
                let line = line_range(text, span.start, span.end);
                let insertion = if line.end < text.len() {
                    line.end
                        + if text[line.end..].starts_with("\r\n") {
                            2
                        } else {
                            1
                        }
                } else {
                    text.len()
                };
                let mut output = text.to_owned();
                output.insert_str(insertion, &format!("hooks = true{newline}"));
                return Ok(output.into_bytes());
            }
            Some(Item::Value(TomlValue::InlineTable(table))) => {
                let span = table
                    .span()
                    .ok_or_else(|| invalid_toml("Missing inline features span"))?;
                let at = span.end.saturating_sub(1);
                let separator = if table.is_empty() {
                    "hooks = true"
                } else {
                    ", hooks = true"
                };
                return Ok(splice(text, at..at, separator).into_bytes());
            }
            None => {
                let newline = if text.contains("\r\n") { "\r\n" } else { "\n" };
                let separator = if text.is_empty() || text.ends_with('\n') {
                    newline
                } else {
                    &format!("{newline}{newline}")
                };
                return Ok(
                    format!("{text}{separator}[features]{newline}hooks = true{newline}")
                        .into_bytes(),
                );
            }
            Some(_) => return Err(invalid_toml("features must be a table or inline table")),
        },
    }
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
