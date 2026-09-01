//! JS: critique-storage.mjs -> `impeccable critique-storage`

use crate::context::resolve_project_root;
use crate::jsp;
use crate::target_args::TargetOptions;
use crate::target_slug::slug_from_target;
use crate::util::{exists, iso_now, js_trim, json_pretty, node_read_error, read_dir_names, safe_read, Env};
use impeccable_common::Io;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

pub fn get_critique_dir(cwd: &str, env: &Env) -> String {
    jsp::join(&[&resolve_project_root(cwd, &TargetOptions::default(), env), ".impeccable", "critique"])
}

/// JS: nowFilenameStamp(date)
pub fn now_filename_stamp() -> String {
    let iso = iso_now(); // 2026-05-12T18:30:00.123Z
    let replaced: String = iso.chars().map(|c| if c == ':' || c == '.' { '-' } else { c }).collect();
    // remove /-\d+Z$/
    let bytes = replaced.as_bytes();
    let mut i = bytes.len() - 1; // 'Z'
    let mut j = i;
    while j > 0 && bytes[j - 1].is_ascii_digit() {
        j -= 1;
    }
    if j > 0 && bytes[j - 1] == b'-' && j < i {
        let _ = &mut i;
        return format!("{}Z", &replaced[..j - 1]);
    }
    replaced
}

fn serialize_frontmatter(obj: &Map<String, Value>) -> String {
    let mut lines = vec!["---".to_string()];
    for (k, v) in obj {
        if v.is_null() {
            continue;
        }
        let (s, is_string) = match v {
            Value::String(s) => (s.clone(), true),
            Value::Bool(b) => (b.to_string(), false),
            Value::Number(n) => (js_number_value_string(n), false),
            Value::Array(_) | Value::Object(_) => (js_string_of(v), false),
            Value::Null => unreachable!(),
        };
        let needs_quotes = is_string && (s.contains(':') || s.contains('#'));
        lines.push(format!("{}: {}", k, if needs_quotes { serde_json::to_string(&s).unwrap() } else { s }));
    }
    lines.push("---".to_string());
    lines.join("\n")
}

fn js_number_value_string(n: &serde_json::Number) -> String {
    if let Some(i) = n.as_i64() {
        return i.to_string();
    }
    if let Some(u) = n.as_u64() {
        return u.to_string();
    }
    crate::util::js_number_to_string(n.as_f64().unwrap_or(0.0))
}

/// `String(value)` for arrays/objects: arrays join with ',', objects "[object Object]".
fn js_string_of(v: &Value) -> String {
    match v {
        Value::Array(a) => a
            .iter()
            .map(|e| match e {
                Value::Null => String::new(),
                Value::String(s) => s.clone(),
                Value::Bool(b) => b.to_string(),
                Value::Number(n) => js_number_value_string(n),
                other => js_string_of(other),
            })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".to_string(),
        Value::String(s) => s.clone(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => js_number_value_string(n),
        Value::Null => "null".to_string(),
    }
}

/// JS: parseFrontmatter(text) -> object (string values, JSON-quoted parsed, ints -> Number)
pub fn parse_frontmatter(text: &str) -> Map<String, Value> {
    let mut out = Map::new();
    // /^---\r?\n([\s\S]*?)\r?\n---/
    let rest = if let Some(r) = text.strip_prefix("---\r\n") {
        r
    } else if let Some(r) = text.strip_prefix("---\n") {
        r
    } else {
        return out;
    };
    let bytes = rest.as_bytes();
    let mut inner: Option<&str> = None;
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\n' && rest[i + 1..].starts_with("---") {
            let end = if i > 0 && bytes[i - 1] == b'\r' { i - 1 } else { i };
            inner = Some(&rest[..end]);
            break;
        }
        i += 1;
    }
    let Some(inner) = inner else { return out };
    for line in inner.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        let Some(colon) = line.find(':') else { continue };
        let key = js_trim(&line[..colon]);
        let value = js_trim(&line[colon + 1..]);
        let v: Value = if value.len() >= 2 && value.starts_with('"') && value.ends_with('"') && !value[1..].contains('\n') {
            match serde_json::from_str::<Value>(value) {
                Ok(parsed) => parsed,
                Err(_) => Value::String(value.to_string()),
            }
        } else if is_int_literal(value) {
            match value.parse::<i64>() {
                Ok(n) => Value::from(n),
                Err(_) => Value::from(value.parse::<f64>().unwrap_or(0.0)),
            }
        } else if value == "true" || value == "false" {
            // JS #660: frontmatter now carries the boolean `closed` flag.
            Value::Bool(value == "true")
        } else {
            Value::String(value.to_string())
        };
        out.insert(key.to_string(), v);
    }
    out
}

fn is_int_literal(s: &str) -> bool {
    let d = s.strip_prefix('-').unwrap_or(s);
    !d.is_empty() && d.chars().all(|c| c.is_ascii_digit())
}

fn is_snapshot_name(f: &str) -> bool {
    // JS #660: ^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z(?:~\d{4})?__.+\.md$
    let b = f.as_bytes();
    if b.len() < 20 {
        return false;
    }
    let pat = b"0000-00-00T00-00-00Z";
    for (i, p) in pat.iter().enumerate() {
        match p {
            b'0' => {
                if !b[i].is_ascii_digit() {
                    return false;
                }
            }
            _ => {
                if b[i] != *p {
                    return false;
                }
            }
        }
    }
    let mut idx = 20usize;
    // optional collision suffix ~\d{4}
    if b.get(idx) == Some(&b'~') {
        if b.len() < idx + 5 {
            return false;
        }
        for j in idx + 1..idx + 5 {
            if !b[j].is_ascii_digit() {
                return false;
            }
        }
        idx += 5;
    }
    if b.get(idx) != Some(&b'_') || b.get(idx + 1) != Some(&b'_') {
        return false;
    }
    idx += 2;
    let rest = &f[idx..];
    rest.ends_with(".md") && rest.len() > 3 && !rest[..rest.len() - 3].is_empty() && !rest.contains('\n')
}

pub fn list_snapshots(suffix: &str, cwd: &str, env: &Env) -> Vec<String> {
    let dir = get_critique_dir(cwd, env);
    if !exists(&dir) {
        return vec![];
    }
    let Some(names) = read_dir_names(&dir) else { return vec![] };
    let mut names: Vec<String> = names.into_iter().filter(|f| is_snapshot_name(f) && f.ends_with(suffix)).collect();
    names.sort();
    names.into_iter().map(|f| jsp::join(&[&dir, &f])).collect()
}

pub struct Snapshot {
    pub path: String,
    pub body: String,
    pub meta: Map<String, Value>,
}

/// JS #660: `/^https?:\/\//i.test(target)`.
fn is_http(target: &str) -> bool {
    let l = target.to_ascii_lowercase();
    l.starts_with("http://") || l.starts_with("https://")
}

/// JS #660: resolveLocalTargetPath(target, { cwd }).
fn resolve_local_target_path(target: &str, cwd: &str) -> Option<String> {
    if target.is_empty() || is_http(target) {
        return None;
    }
    // path.isAbsolute(target) ? path.resolve(target) : path.resolve(cwd, target)
    Some(jsp::resolve(cwd, &[target]))
}

/// JS #660: resolveTargetIdentity(target, { cwd }).
fn resolve_target_identity(target: &str, cwd: &str) -> Option<String> {
    if target.is_empty() {
        return None;
    }
    if is_http(target) {
        let u = crate::url::parse(target)?;
        // url.pathname.replace(/\/+$/, '') || '/'
        let trimmed = u.pathname.trim_end_matches('/');
        let pathname = if trimmed.is_empty() { "/" } else { trimmed };
        return Some(format!("url:{}{}", u.origin(), pathname));
    }
    resolve_local_target_path(target, cwd).map(|fp| format!("file:{}", fp))
}

/// JS #660: fingerprintTarget(target, { cwd }).
fn fingerprint_target(target: &str, cwd: &str) -> Option<String> {
    let file_path = resolve_local_target_path(target, cwd)?;
    let md = std::fs::metadata(&file_path).ok()?;
    if !md.is_file() {
        return None;
    }
    let bytes = std::fs::read(&file_path).ok()?;
    Some(format!("sha256:{}", hex_lower(&Sha256::digest(&bytes))))
}

fn hex_lower(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

/// JS #660: readSnapshot(filePath).
fn read_snapshot_at(path: &str) -> Option<Snapshot> {
    let body = safe_read(path)?;
    let meta = parse_frontmatter(&body);
    Some(Snapshot { path: path.to_string(), body, meta })
}

/// JS #660: snapshotTargetIdentity(snapshot).
fn snapshot_target_identity(s: &Snapshot) -> Option<String> {
    if let Some(Value::String(id)) = s.meta.get("target_identity") {
        if !id.is_empty() {
            return Some(id.clone());
        }
    }
    if let Some(Value::String(tp)) = s.meta.get("target_path") {
        if !tp.is_empty() {
            return Some(format!("file:{}", tp));
        }
    }
    None
}

fn meta_closed(s: &Snapshot) -> bool {
    matches!(s.meta.get("closed"), Some(Value::Bool(true)))
}

/// JS #660: readNewestSnapshot(slug).
fn read_newest_snapshot(slug: &str, cwd: &str, env: &Env) -> Option<Snapshot> {
    let fp = list_snapshots(&format!("__{}.md", slug), cwd, env).last()?.clone();
    read_snapshot_at(&fp)
}

/// JS #660: readNewestSnapshotForIdentity(slug, targetIdentity).
fn read_newest_snapshot_for_identity(slug: &str, target_identity: Option<&str>, cwd: &str, env: &Env) -> Option<Snapshot> {
    let want = target_identity.map(|s| s.to_string());
    list_snapshots(&format!("__{}.md", slug), cwd, env)
        .iter()
        .filter_map(|f| read_snapshot_at(f))
        .filter(|s| snapshot_target_identity(s) == want)
        .last()
}

/// JS #660: closeSnapshot(snapshotFile, { cwd }). Ok(Some(path)) marks it
/// closed, Ok(None) is a silent no-op, Err mirrors the JS `throw`.
fn close_snapshot(snapshot_file: &str, cwd: &str, env: &Env) -> Result<Option<String>, String> {
    if snapshot_file.is_empty() {
        return Ok(None);
    }
    let dir = jsp::resolve(cwd, &[&get_critique_dir(cwd, env)]);
    let snapshot_path = if jsp::is_absolute(snapshot_file) {
        jsp::resolve(cwd, &[snapshot_file])
    } else {
        jsp::resolve(cwd, &[&dir, snapshot_file])
    };
    let filename = jsp::basename(&snapshot_path);
    if jsp::dirname(&snapshot_path) != dir || !is_snapshot_name(&filename) {
        return Ok(None);
    }
    let md = match std::fs::symlink_metadata(&snapshot_path) {
        Ok(m) => m,
        Err(_) => return Ok(None),
    };
    if !md.is_file() {
        return Ok(None);
    }
    let Some(snapshot) = read_snapshot_at(&snapshot_path) else {
        return Ok(None);
    };
    if meta_closed(&snapshot) {
        return Ok(None);
    }
    // body.replace(/^(---\r?\n[\s\S]*?)(\r?\n---)/, '$1\nclosed: true$2')
    let closed_body = insert_closed_flag(&snapshot.body);
    if closed_body == snapshot.body {
        return Err(format!("Cannot close snapshot without frontmatter: {}", snapshot.path));
    }
    let _ = std::fs::write(&snapshot.path, closed_body);
    Ok(Some(snapshot.path))
}

/// Insert `\nclosed: true` before the closing `---` of the first frontmatter
/// block. Mirrors the JS regex `/^(---\r?\n[\s\S]*?)(\r?\n---)/`.
fn insert_closed_flag(body: &str) -> String {
    static RE: once_cell::sync::Lazy<regex::Regex> =
        once_cell::sync::Lazy::new(|| regex::Regex::new(r"^(---\r?\n[\s\S]*?)(\r?\n---)").expect("closed-flag RE"));
    RE.replace(body, "${1}\nclosed: true${2}").into_owned()
}

/// JS #660: isReadySlug(value).
fn is_ready_slug(value: &str) -> bool {
    !value.is_empty() && value.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

pub fn read_latest_snapshot(slug: &str, cwd: &str, env: &Env) -> Option<Snapshot> {
    let latest = read_newest_snapshot(slug, cwd, env)?;
    if meta_closed(&latest) {
        None
    } else {
        Some(latest)
    }
}

/// JS #660: readLatestSnapshotAcrossTargets({ cwd }).
pub fn read_latest_snapshot_across_targets(cwd: &str, env: &Env) -> Option<Snapshot> {
    let snapshots: Vec<Snapshot> = list_snapshots(".md", cwd, env).iter().filter_map(|f| read_snapshot_at(f)).collect();
    let mut identified_slugs: std::collections::HashSet<String> = std::collections::HashSet::new();
    for s in &snapshots {
        if snapshot_target_identity(s).is_some() {
            if let Some(Value::String(slug)) = s.meta.get("slug") {
                identified_slugs.insert(slug.clone());
            }
        }
    }
    // Insertion-ordered stream map: later (newer) snapshot wins per key.
    let mut latest_by_target: Vec<(String, Snapshot)> = Vec::new();
    for s in snapshots {
        let slug = match s.meta.get("slug") {
            Some(Value::String(v)) if !v.is_empty() => v.clone(),
            _ => continue,
        };
        let target_identity = snapshot_target_identity(&s);
        if target_identity.is_none() && identified_slugs.contains(&slug) {
            continue;
        }
        let stream_key = target_identity.unwrap_or_else(|| format!("slug:{}", slug));
        if let Some(slot) = latest_by_target.iter_mut().find(|(k, _)| *k == stream_key) {
            slot.1 = s;
        } else {
            latest_by_target.push((stream_key, s));
        }
    }
    let mut open: Vec<Snapshot> = latest_by_target.into_iter().map(|(_, s)| s).filter(|s| !meta_closed(s)).collect();
    // JS: .sort((a, b) => a.path.localeCompare(b.path)).at(-1)
    open.sort_by(|a, b| a.path.cmp(&b.path));
    open.pop()
}

fn coerce_slug(value: Option<&str>, cwd: &str) -> Option<String> {
    let v = value?;
    if v.is_empty() {
        return None;
    }
    if is_ready_slug(v) {
        return Some(v.to_string());
    }
    slug_from_target(Some(v), cwd)
}

pub fn run(args: &[String], io: &mut Io) -> i32 {
    let cwd = io.cwd.to_string_lossy().into_owned();
    let env = io.env.clone();
    let cmd = args.first().map(String::as_str).unwrap_or("");
    let rest = if args.is_empty() { &[][..] } else { &args[1..] };
    match cmd {
        "slug" => {
            let slug = slug_from_target(rest.first().map(String::as_str), &cwd);
            match slug {
                Some(s) => {
                    io.out(&format!("{}\n", s));
                    0
                }
                None => {
                    io.err("no stable slug for input\n");
                    1
                }
            }
        }
        "write" => {
            let slug_arg = rest.first().map(String::as_str).unwrap_or("");
            let slug = coerce_slug(rest.first().map(String::as_str), &cwd);
            let body_file = rest.get(1).filter(|s| !s.is_empty());
            let (Some(slug), Some(body_file)) = (slug, body_file) else {
                io.err("usage: write <slug-or-target> <body-file>\n");
                return 1;
            };
            let raw = match std::fs::read(body_file) {
                Ok(b) => String::from_utf8_lossy(&b).into_owned(),
                Err(e) => {
                    // JS: uncaught exception -> stack trace on stderr, exit 1
                    io.err(&format!("{}\n", uncaught(&node_read_error(body_file, &e))));
                    return 1;
                }
            };
            let mut parsed_meta: Map<String, Value> = Map::new();
            if let Some(m) = env.get("IMPECCABLE_CRITIQUE_META").filter(|s| !s.is_empty()) {
                if let Ok(Value::Object(o)) = serde_json::from_str::<Value>(m) {
                    parsed_meta = o;
                }
            }
            // JS #660: the helper, not caller metadata, owns the target
            // fingerprint/identity. Drop any caller-supplied copies (preserving
            // the order of the rest) and append the freshly resolved values.
            let mut meta: Map<String, Value> = Map::new();
            for (k, v) in parsed_meta {
                if k != "target_fingerprint" && k != "target_path" && k != "target_identity" {
                    meta.insert(k, v);
                }
            }
            if let Some(id) = resolve_target_identity(slug_arg, &cwd) {
                meta.insert("target_identity".into(), Value::String(id));
            }
            if let Some(fp) = fingerprint_target(slug_arg, &cwd) {
                meta.insert("target_fingerprint".into(), Value::String(fp));
                if let Some(lp) = resolve_local_target_path(slug_arg, &cwd) {
                    meta.insert("target_path".into(), Value::String(lp));
                }
            }
            let dir = get_critique_dir(&cwd, &env);
            let _ = std::fs::create_dir_all(&dir);
            let timestamp = now_filename_stamp();
            let mut front = meta.clone();
            front.insert("timestamp".into(), Value::String(timestamp.clone()));
            front.insert("slug".into(), Value::String(slug.clone()));
            let contents = format!("{}\n{}\n", serialize_frontmatter(&front), js_trim(&raw));
            // JS #660: exclusive create with a fixed-width collision suffix so a
            // second critique in the same UTC second cannot replace history.
            let mut written: Option<String> = None;
            for collision in 0..=9999u32 {
                let suffix = if collision == 0 { String::new() } else { format!("~{:04}", collision) };
                let file_path = jsp::join(&[&dir, &format!("{}{}__{}.md", timestamp, suffix, slug)]);
                match std::fs::OpenOptions::new().write(true).create_new(true).open(&file_path) {
                    Ok(mut f) => {
                        use std::io::Write;
                        let _ = f.write_all(contents.as_bytes());
                        written = Some(file_path);
                        break;
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(e) => {
                        io.err(&format!("{}\n", uncaught(&e.to_string())));
                        return 1;
                    }
                }
            }
            match written {
                Some(fp) => {
                    io.out(&format!("{}\n", fp));
                    0
                }
                None => {
                    io.err(&format!("{}\n", uncaught(&format!("Too many critique snapshots for {} at {}", slug, timestamp))));
                    1
                }
            }
        }
        "latest" => {
            let target = rest.first().map(String::as_str).unwrap_or("");
            let format = rest.get(1).map(String::as_str);
            let slug_opt = coerce_slug(rest.first().map(String::as_str), &cwd);
            // JS: format && format !== '--json'  (format truthy = non-empty)
            let bad_format = format.map(|f| !f.is_empty() && f != "--json").unwrap_or(false);
            let Some(slug) = slug_opt.filter(|_| !bad_format) else {
                io.err("usage: latest <slug-or-target> [--json]\n");
                return 1;
            };
            let format_is_json = format == Some("--json");
            let target_fingerprint = fingerprint_target(target, &cwd);
            let target_path = resolve_local_target_path(target, &cwd);
            let target_identity = resolve_target_identity(target, &cwd);
            let ready_slug = is_ready_slug(target);
            let Some(newest_for_slug) = read_newest_snapshot(&slug, &cwd, &env) else {
                return 2;
            };
            let mut latest = read_newest_snapshot_for_identity(&slug, target_identity.as_deref(), &cwd, &env);
            if latest.is_none() && !ready_slug {
                // Legacy snapshots have no identity; preserve their old explicit
                // path/URL behavior only when no known identity was selected.
                latest = read_newest_snapshot_for_identity(&slug, None, &cwd, &env);
            }
            let latest = latest.unwrap_or(newest_for_slug);
            if meta_closed(&latest) {
                return 2;
            }
            let recorded_target_identity = snapshot_target_identity(&latest);
            let matching_identity = recorded_target_identity == target_identity;
            if ready_slug && recorded_target_identity.is_none() {
                io.err("ambiguous legacy snapshot target; use an explicit ./path or full URL\n");
                return 2;
            }
            if ready_slug && target_path.as_deref().map(exists).unwrap_or(false) && !matching_identity {
                io.err("ambiguous snapshot slug; use an explicit ./path or remove the local name collision\n");
                return 2;
            }
            let concrete_target = !ready_slug || matching_identity;
            if concrete_target && recorded_target_identity.is_some() && !matching_identity {
                return 2;
            }
            let concrete_local_target = concrete_target && target_path.is_some();
            if concrete_local_target {
                let recorded_fp = match latest.meta.get("target_fingerprint") {
                    Some(Value::String(s)) => Some(s.clone()),
                    _ => None,
                };
                // JS strict `!==`: equal only when both are the same string;
                // undefined/null on either side always differ.
                let differ = !matches!((&recorded_fp, &target_fingerprint), (Some(a), Some(b)) if a == b);
                if differ {
                    return match close_snapshot(&latest.path, &cwd, &env) {
                        Err(e) => {
                            io.err(&format!("{}\n", uncaught(&e)));
                            1
                        }
                        _ => 2,
                    };
                }
            }
            if format_is_json {
                let mut m = Map::new();
                m.insert("snapshot_file".into(), Value::String(jsp::basename(&latest.path)));
                m.insert("body".into(), Value::String(latest.body.clone()));
                io.out(&format!("{}\n", json_pretty(&Value::Object(m))));
            } else {
                io.out(&latest.body);
            }
            0
        }
        "close" => {
            let slug_arg = rest.first().map(String::as_str).unwrap_or("");
            let snapshot_file = rest.get(1).map(String::as_str);
            let slug = coerce_slug(rest.first().map(String::as_str), &cwd);
            let snapshot_file_ok = snapshot_file.map(|s| !s.is_empty()).unwrap_or(false);
            if slug.is_none() || !snapshot_file_ok || rest.len() > 2 {
                io.err("usage: close <resolved-target> <snapshot-file>\n");
                return 1;
            }
            let slug = slug.unwrap();
            let snapshot_file = snapshot_file.unwrap();
            if jsp::basename(snapshot_file) != snapshot_file
                || !is_snapshot_name(snapshot_file)
                || !snapshot_file.ends_with(&format!("__{}.md", slug))
            {
                return 2;
            }
            let snapshot_path = jsp::join(&[&get_critique_dir(&cwd, &env), snapshot_file]);
            let md = match std::fs::symlink_metadata(&snapshot_path) {
                Ok(m) => m,
                Err(_) => return 2,
            };
            if !md.is_file() {
                return 2;
            }
            let Some(snapshot) = read_snapshot_at(&snapshot_path) else {
                return 2;
            };
            // JS #660: a slug + filename does not prove ownership; require the
            // resolved target to match a modern snapshot's recorded identity.
            let recorded_target_identity = snapshot_target_identity(&snapshot);
            if let Some(rid) = &recorded_target_identity {
                if Some(rid.clone()) != resolve_target_identity(slug_arg, &cwd) {
                    return 2;
                }
            }
            match close_snapshot(snapshot_file, &cwd, &env) {
                Err(e) => {
                    io.err(&format!("{}\n", uncaught(&e)));
                    1
                }
                Ok(None) => 2,
                Ok(Some(p)) => {
                    io.out(&format!("{}\n", p));
                    0
                }
            }
        }
        "trend" => {
            let slug = coerce_slug(rest.first().map(String::as_str), &cwd).unwrap_or_else(|| "null".to_string());
            let limit: f64 = match rest.get(1).filter(|s| !s.is_empty()) {
                Some(l) => js_number(l),
                None => 5.0,
            };
            let all = list_snapshots(&format!("__{}.md", slug), &cwd, &env);
            let slice = js_slice_last(&all, limit);
            let rows: Vec<Value> = slice
                .iter()
                .map(|f| Value::Object(parse_frontmatter(&safe_read(f).unwrap_or_default())))
                .collect();
            io.out(&format!("{}\n", json_pretty(&Value::Array(rows))));
            0
        }
        _ => {
            io.err("usage: impeccable critique-storage <slug|write|latest|trend|close> [args]\n");
            1
        }
    }
}

/// `Number(str)`
pub fn js_number(s: &str) -> f64 {
    let t = js_trim(s);
    if t.is_empty() {
        return 0.0;
    }
    if t == "Infinity" || t == "+Infinity" {
        return f64::INFINITY;
    }
    if t == "-Infinity" {
        return f64::NEG_INFINITY;
    }
    if let Some(h) = t.strip_prefix("0x").or_else(|| t.strip_prefix("0X")) {
        return i64::from_str_radix(h, 16).map(|v| v as f64).unwrap_or(f64::NAN);
    }
    // Reject things Rust accepts but JS doesn't (e.g. "nan", "inf")
    if t.chars().any(|c| c.is_ascii_alphabetic() && c != 'e' && c != 'E') {
        return f64::NAN;
    }
    t.parse::<f64>().unwrap_or(f64::NAN)
}

/// `arr.slice(-limit)` for a JS number limit.
fn js_slice_last(all: &[String], limit: f64) -> Vec<String> {
    let n = all.len() as f64;
    // slice(-limit): start = max(n - limit, 0) when limit finite; NaN -> 0 -> whole array
    let start = if limit.is_nan() {
        0.0
    } else {
        let s = -limit;
        let s = s.trunc();
        if s < 0.0 {
            (n + s).max(0.0)
        } else {
            s.min(n)
        }
    };
    all[start as usize..].to_vec()
}

fn uncaught(msg: &str) -> String {
    format!("Error: {}", msg)
}

/// `String(v)` for a JSON value (used where JS coerces sidecar fields).
pub fn js_string_value(v: &Value) -> String {
    js_string_of(v)
}

#[cfg(test)]
mod tests_660 {
    use super::*;
    use impeccable_common::Io;
    use std::collections::HashMap;
    use std::path::PathBuf;

    fn tmp() -> String {
        let base = std::env::temp_dir().join(format!(
            "impeccable-critique-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        std::fs::create_dir_all(&base).unwrap();
        std::fs::canonicalize(&base).unwrap().to_string_lossy().into_owned()
    }

    fn run_capture(cwd: &str, args: &[&str]) -> (i32, String, String) {
        let (mut io, cap) = Io::captured("", PathBuf::from(cwd), HashMap::new());
        let owned: Vec<String> = args.iter().map(|s| s.to_string()).collect();
        let code = run(&owned, &mut io);
        let out = String::from_utf8_lossy(&cap.stdout.borrow()).into_owned();
        let err = String::from_utf8_lossy(&cap.stderr.borrow()).into_owned();
        (code, out, err)
    }

    #[test]
    fn snapshot_name_accepts_collision_suffix() {
        assert!(is_snapshot_name("2026-05-12T18-30-00Z__slug.md"));
        assert!(is_snapshot_name("2026-05-12T18-30-00Z~0001__slug.md"));
        // three-digit suffix is not the fixed width \d{4}
        assert!(!is_snapshot_name("2026-05-12T18-30-00Z~001__slug.md"));
        assert!(!is_snapshot_name("2026-05-12T18-30-00Z__slug.txt"));
        assert!(!is_snapshot_name("2026-05-12T18-30-00Z__.md"));
    }

    #[test]
    fn target_identity_file_url_and_trailing_slash() {
        let cwd = "/work";
        assert_eq!(resolve_target_identity("src/App.tsx", cwd), Some("file:/work/src/App.tsx".to_string()));
        assert_eq!(resolve_target_identity("http://example.com/pricing/", cwd), Some("url:http://example.com/pricing".to_string()));
        assert_eq!(resolve_target_identity("http://example.com", cwd), Some("url:http://example.com/".to_string()));
        assert_eq!(resolve_target_identity("", cwd), None);
    }

    #[test]
    fn ready_slug_shape() {
        assert!(is_ready_slug("foo-bar"));
        assert!(!is_ready_slug("src/App.tsx"));
        assert!(!is_ready_slug(""));
    }

    #[test]
    fn insert_closed_flag_only_with_frontmatter() {
        let with = "---\nslug: x\n---\nbody\n";
        assert!(insert_closed_flag(with).contains("closed: true\n---"));
        let without = "no frontmatter here\n";
        assert_eq!(insert_closed_flag(without), without);
    }

    #[test]
    fn close_verb_round_trip_and_ownership() {
        let cwd = tmp();
        let dir = jsp::join(&[&cwd, ".impeccable", "critique"]);
        std::fs::create_dir_all(&dir).unwrap();
        let name = "2026-05-12T18-30-00Z__app-tsx.md";
        let identity = format!("file:{}/App.tsx", cwd);
        let body = format!("---\ntarget_identity: \"{}\"\nslug: app-tsx\n---\n# Critique\n", identity);
        std::fs::write(jsp::join(&[&dir, name]), &body).unwrap();

        // Wrong target identity: refused (exit 2), snapshot untouched.
        let (code, _, _) = run_capture(&cwd, &["close", "Other.tsx", name]);
        assert_eq!(code, 2);
        assert!(!std::fs::read_to_string(jsp::join(&[&dir, name])).unwrap().contains("closed: true"));

        // Correct target: closes, prints the path, marks the file.
        let (code, out, _) = run_capture(&cwd, &["close", "App.tsx", name]);
        assert_eq!(code, 0);
        assert!(out.trim_end().ends_with(name));
        assert!(std::fs::read_to_string(jsp::join(&[&dir, name])).unwrap().contains("closed: true"));

        // Second close is a silent no-op (already closed) -> exit 2.
        let (code, _, _) = run_capture(&cwd, &["close", "App.tsx", name]);
        assert_eq!(code, 2);

        // latest on a closed snapshot -> exit 2.
        let (code, _, _) = run_capture(&cwd, &["latest", "App.tsx"]);
        assert_eq!(code, 2);

        let _ = std::fs::remove_dir_all(&cwd);
    }

    #[test]
    fn latest_json_emits_snapshot_file_and_body() {
        let cwd = tmp();
        let dir = jsp::join(&[&cwd, ".impeccable", "critique"]);
        std::fs::create_dir_all(&dir).unwrap();
        // A URL-target snapshot: no local fingerprint, so latest stays current.
        let name = "2026-05-12T18-30-00Z__example-com-pricing.md";
        let body = "---\ntarget_identity: \"url:http://example.com/pricing\"\nslug: example-com-pricing\n---\n# Critique\n";
        std::fs::write(jsp::join(&[&dir, name]), body).unwrap();
        let (code, out, _) = run_capture(&cwd, &["latest", "http://example.com/pricing", "--json"]);
        assert_eq!(code, 0);
        assert!(out.contains("\"snapshot_file\": \"2026-05-12T18-30-00Z__example-com-pricing.md\""));
        assert!(out.contains("\"body\":"));
        let _ = std::fs::remove_dir_all(&cwd);
    }
}
