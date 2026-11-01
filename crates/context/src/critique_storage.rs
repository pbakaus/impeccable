//! JS: critique-storage.mjs -> `impeccable critique-storage`

use crate::context::resolve_project_root;
use crate::jsp;
use crate::target_args::TargetOptions;
use crate::target_slug::{legacy_slug_from_target, slug_from_target};
use crate::util::{exists, iso_now, js_trim, json_pretty, node_read_error, read_dir_names, safe_read, Env};
use impeccable_common::Io;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};

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

/// `git args` run in `root`, against the throwaway index `index` when given,
/// and never against a repository an outer hook's environment points at.
fn git_cmd(root: &str, index: Option<&str>, args: &[&str]) -> Command {
    let mut cmd = Command::new("git");
    cmd.args(args).current_dir(root).stdin(Stdio::null()).stderr(Stdio::null());
    impeccable_common::proc::hide_window(&mut cmd);
    for var in ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY", "GIT_INDEX_FILE"] {
        cmd.env_remove(var);
    }
    if let Some(path) = index {
        cmd.env("GIT_INDEX_FILE", path);
    }
    cmd
}

/// Stdout of `git_cmd`; `None` when git is missing or the command fails.
fn git(root: &str, index: Option<&str>, args: &[&str]) -> Option<String> {
    let out = git_cmd(root, index, args).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Left out of a change base: runtime state would read as a change on every
/// run, and a base's blobs sit in the object store and its diff goes to a
/// sub-agent, so the common credential files stay out even when nothing
/// ignores them.
const NOT_IN_CHANGE_BASE: [&str; 7] =
    ["**/.impeccable/**", "**/.env*", "**/.npmrc", "**/id_rsa*", "**/*.pem", "**/*.key", "**/*.p12"];

/// Lockfiles count as changed but stay out of `--diff`: megabytes no design
/// review reads.
const NOT_IN_DIFF: [&str; 13] = [
    "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb", "Cargo.lock", "uv.lock", "poetry.lock",
    "Podfile.lock", "pubspec.lock", "Gemfile.lock", "composer.lock", "go.sum",
];

static INDEX_SEQ: AtomicUsize = AtomicUsize::new(0);

/// The change base: a git tree of the whole working tree at this moment
/// (tracked, dirty and untracked-not-ignored files, minus `NOT_IN_CHANGE_BASE`
/// and `leave_out`, a path relative to `root`), built in a throwaway index so
/// the user's index, HEAD and working tree stay untouched. `None` when git is
/// missing, `root` is not in a repo, or no tree can be written; a file git
/// cannot read is left out rather than losing the base.
fn working_tree_id(root: &str, leave_out: Option<&str>) -> Option<String> {
    let real = git(root, None, &["rev-parse", "--git-path", "index"])?;
    let real = std::path::Path::new(root).join(real.trim());
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos());
    let dir = std::env::temp_dir().join(format!(
        "impeccable-critique-{}-{}-{}",
        std::process::id(),
        nanos,
        INDEX_SEQ.fetch_add(1, Ordering::Relaxed)
    ));
    private_dir(&dir).ok()?;
    let temp = dir.join("index");
    let index = temp.to_string_lossy().into_owned();
    let tree = (|| {
        // Seeded from the real index so git rehashes only what changed.
        if real.is_file() {
            std::fs::copy(&real, &temp).ok()?;
            reveal_hidden_edits(root, &index)?;
        }
        // The add pathspec only stops new files; a tracked one already in the
        // copied index has to be dropped too.
        let dropped: Vec<String> = NOT_IN_CHANGE_BASE.iter().map(|p| format!(":(top,glob){p}")).collect();
        let mut rm = vec!["rm", "-r", "-q", "-f", "--cached", "--ignore-unmatch", "--"];
        rm.extend(dropped.iter().map(String::as_str));
        git(root, Some(&index), &rm)?;
        let mut excluded: Vec<String> = NOT_IN_CHANGE_BASE.iter().map(|p| format!(":(top,glob,exclude){p}")).collect();
        excluded.extend(leave_out.map(|p| format!(":(exclude){p}")));
        let mut add = vec!["add", "-A", "--ignore-errors", "--", ":/"];
        add.extend(excluded.iter().map(String::as_str));
        // `--ignore-errors` exits 1 after skipping a file it cannot read, and also
        // when it cannot write objects at all; a fatal or an unwritable store
        // leaves the seeded index, which would read as no change.
        let added = git_cmd(root, Some(&index), &add).output().ok()?;
        match added.status.code() {
            Some(0) => {}
            Some(1) if objects_writable(root) => {}
            _ => return None,
        }
        git(root, Some(&index), &["write-tree"])
    })();
    let _ = std::fs::remove_dir_all(&dir);
    tree.map(|t| t.trim().to_string()).filter(|t| !t.is_empty())
}

/// Creates `dir` for this process alone. It fails on anything already there, a
/// planted symlink included, so the index inside it cannot be redirected.
fn private_dir(dir: &std::path::Path) -> std::io::Result<()> {
    let mut builder = std::fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(dir)
}

/// The seeded index keeps `assume-unchanged` and `skip-worktree`, which make
/// `add` keep the old content of an edited file. Clear them, except on the files
/// a sparse checkout left absent, which would otherwise read as deleted.
fn reveal_hidden_edits(root: &str, index: &str) -> Option<()> {
    let listed = git(root, Some(index), &["ls-files", "-v", "-z", "--", ":/"])?;
    let hidden: Vec<&str> = listed
        .split('\0')
        .filter_map(|entry| {
            let (tag, path) = entry.split_once(' ')?;
            let assumed = tag.chars().next().is_some_and(|c| c.is_ascii_lowercase());
            let skipped = tag == "S" && std::path::Path::new(root).join(path).exists();
            (assumed || skipped).then_some(path)
        })
        .collect();
    // One flag per call: `update-index` acts on the first mark it was given.
    for paths in hidden.chunks(200) {
        for flag in ["--no-assume-unchanged", "--no-skip-worktree"] {
            let mut args = vec!["update-index", flag, "--"];
            args.extend(paths);
            git(root, Some(index), &args)?;
        }
    }
    Some(())
}

/// Whether git can add to this repo's object store, as a sandbox guarding
/// `.git` or another owner's store would not let it.
fn objects_writable(root: &str) -> bool {
    let Some(dir) = git(root, None, &["rev-parse", "--git-path", "objects"]) else { return false };
    let probe = std::path::Path::new(root).join(dir.trim()).join(format!("impeccable-probe-{}", std::process::id()));
    let writable = std::fs::File::create(&probe).is_ok();
    let _ = std::fs::remove_file(&probe);
    writable
}

/// Whether a repo tree can see the target at all. A gitignored file, a path
/// outside the repo, and a remote URL all read as unchanged there whatever
/// happened to them, so they get no verdict from it.
fn target_in_change_base(target: &str, root: &str, cwd: &str) -> bool {
    if is_http(target) {
        return crate::url::parse(target).is_some_and(|u| matches!(u.hostname.as_str(), "localhost" | "127.0.0.1" | "[::1]"));
    }
    let Some(path) = resolve_local_target_path(target, cwd) else { return false };
    // Exit 1 is "inside the repo and not ignored"; 0 is ignored, 128 is outside.
    git_cmd(root, None, &["check-ignore", "-q", "--", &path]).status().ok().and_then(|s| s.code()) == Some(1)
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

fn slug_candidates(value: Option<&str>, cwd: &str) -> Vec<String> {
    let Some(v) = value.filter(|v| !v.is_empty()) else {
        return vec![];
    };
    if is_ready_slug(v) {
        return vec![v.to_string()];
    }
    let mut slugs = Vec::new();
    if let Some(slug) = slug_from_target(Some(v), cwd) {
        slugs.push(slug);
    }
    if let Some(legacy) = legacy_slug_from_target(Some(v), cwd) {
        if !slugs.contains(&legacy) {
            slugs.push(legacy);
        }
    }
    slugs
}

fn read_newest_safe_snapshot_for_slugs(
    slugs: &[String],
    target_identity: Option<&str>,
    cwd: &str,
    env: &Env,
) -> Option<Snapshot> {
    let current = slugs.first().and_then(|slug| read_newest_snapshot(slug, cwd, env));
    let legacy = target_identity.and_then(|identity| {
        slugs.get(1).and_then(|slug| read_newest_snapshot_for_identity(slug, Some(identity), cwd, env))
    });
    current.into_iter().chain(legacy).max_by(|a, b| a.path.cmp(&b.path))
}

fn read_newest_snapshot_for_identity_slugs(
    slugs: &[String],
    target_identity: Option<&str>,
    cwd: &str,
    env: &Env,
) -> Option<Snapshot> {
    let current = slugs.first().and_then(|slug| read_newest_snapshot_for_identity(slug, target_identity, cwd, env));
    let legacy = target_identity.and_then(|identity| {
        slugs.get(1).and_then(|slug| read_newest_snapshot_for_identity(slug, Some(identity), cwd, env))
    });
    current.into_iter().chain(legacy).max_by(|a, b| a.path.cmp(&b.path))
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
                if k != "target_fingerprint" && k != "target_path" && k != "target_identity" && k != "change_base" {
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
            // The helper also owns the change base `changes` diffs against;
            // it is left out when git cannot produce one.
            let root = resolve_project_root(&cwd, &TargetOptions::default(), &env);
            // A body written inside the project is gone by the next run, and
            // its deletion would hand the ledger to a reviewer as `-` lines.
            let body_path = jsp::resolve(&cwd, &[body_file]);
            let leave_out = body_path.strip_prefix(&root).map(|p| p.trim_start_matches(['/', '\\']));
            if let Some(base) = working_tree_id(&root, leave_out) {
                meta.insert("change_base".into(), Value::String(base));
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
            let slugs = slug_candidates(rest.first().map(String::as_str), &cwd);
            // JS: format && format !== '--json'  (format truthy = non-empty)
            let bad_format = format.map(|f| !f.is_empty() && f != "--json").unwrap_or(false);
            if slugs.is_empty() || bad_format {
                io.err("usage: latest <slug-or-target> [--json]\n");
                return 1;
            }
            let format_is_json = format == Some("--json");
            let target_fingerprint = fingerprint_target(target, &cwd);
            let target_path = resolve_local_target_path(target, &cwd);
            let target_identity = resolve_target_identity(target, &cwd);
            let ready_slug = is_ready_slug(target);
            let Some(newest_for_slug) =
                read_newest_safe_snapshot_for_slugs(&slugs, target_identity.as_deref(), &cwd, &env)
            else {
                return 2;
            };
            let mut latest =
                read_newest_snapshot_for_identity_slugs(&slugs, target_identity.as_deref(), &cwd, &env);
            if latest.is_none() && !ready_slug {
                // Identity-less snapshots are safe only under the new/current
                // collision-resistant slug. A pre-hash slug suffix alone cannot
                // prove which long target owned the historical snapshot.
                latest = slugs.first().and_then(|slug| read_newest_snapshot_for_identity(slug, None, &cwd, &env));
            }
            let latest = latest.unwrap_or(newest_for_slug);
            if meta_closed(&latest) {
                return 2;
            }
            let recorded_target_identity = snapshot_target_identity(&latest);
            let matching_identity = recorded_target_identity == target_identity;
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
            let slugs = slug_candidates(rest.first().map(String::as_str), &cwd);
            let snapshot_file_ok = snapshot_file.map(|s| !s.is_empty()).unwrap_or(false);
            if slugs.is_empty() || !snapshot_file_ok || rest.len() > 2 {
                io.err("usage: close <resolved-target> <snapshot-file>\n");
                return 1;
            }
            let snapshot_file = snapshot_file.unwrap();
            if jsp::basename(snapshot_file) != snapshot_file
                || !is_snapshot_name(snapshot_file)
                || !slugs.iter().any(|slug| snapshot_file.ends_with(&format!("__{}.md", slug)))
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
            let legacy_match = slugs.get(1).is_some_and(|slug| snapshot_file.ends_with(&format!("__{}.md", slug)));
            if legacy_match && recorded_target_identity.is_none() {
                return 2;
            }
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
        "changes" => {
            let target = rest.first().map(String::as_str).unwrap_or("");
            let slugs = slug_candidates(rest.first().map(String::as_str), &cwd);
            let flag = rest.get(1).map(String::as_str);
            if slugs.is_empty() || flag.is_some_and(|f| f != "--diff") {
                io.err("usage: changes <resolved-target> [--diff]\n");
                return 1;
            }
            // `latest`'s lookup, minus its closed and fingerprint checks: polish
            // closes snapshots whose findings a rerun still has to verify.
            let target_identity = resolve_target_identity(target, &cwd);
            let mut previous = read_newest_snapshot_for_identity_slugs(&slugs, target_identity.as_deref(), &cwd, &env);
            if previous.is_none() && !is_ready_slug(target) {
                previous = slugs.first().and_then(|slug| read_newest_snapshot_for_identity(slug, None, &cwd, &env));
            }
            let Some(previous) = previous else {
                return 2;
            };
            // Written before the ledger existed: nothing a rerun can verify or score from.
            if !previous.body.contains("All Findings") {
                return 2;
            }
            io.out(&format!("previous: {}\n", jsp::basename(&previous.path)));
            let root = resolve_project_root(&cwd, &TargetOptions::default(), &env);
            let report = (|| {
                // Hex only: the value reaches git's command line from a file.
                let Some(Value::String(base)) = previous.meta.get("change_base") else { return None };
                if base.is_empty() || !base.chars().all(|c| c.is_ascii_hexdigit()) || !target_in_change_base(target, &root, &cwd) {
                    return None;
                }
                let current = working_tree_id(&root, None)?;
                let diff_args = |extra: &[&'_ str]| -> Option<String> {
                    let mut args = vec![
                        "-c", "diff.noprefix=false", "-c", "diff.mnemonicPrefix=false", "-c", "diff.ignoreSubmodules=none", "-c", "core.quotePath=false",
                        "diff", "--no-color", "--no-ext-diff", "--no-textconv",
                    ];
                    args.extend(extra);
                    args.extend([base.as_str(), current.as_str()]);
                    let locks: Vec<String> = NOT_IN_DIFF.iter().map(|f| format!(":(top,glob,exclude)**/{f}")).collect();
                    if extra.is_empty() {
                        args.extend(["--", ":/"]);
                        args.extend(locks.iter().map(String::as_str));
                    }
                    git(&root, None, &args)
                };
                let names = diff_args(&["--name-only"])?;
                let files = names.lines().count();
                if files == 0 {
                    // Same tree but different bytes: a target the base leaves out.
                    let recorded = previous.meta.get("target_fingerprint").and_then(Value::as_str);
                    let moved = recorded.is_some_and(|r| fingerprint_target(target, &cwd).as_deref() != Some(r));
                    return (!moved).then(|| "changes: none\n".to_string());
                }
                let detail = if flag.is_some() { diff_args(&[])? } else { names };
                Some(format!("changes: {files} files\n{detail}"))
            })();
            io.out(&report.unwrap_or_else(|| "changes: unknown\n".to_string()));
            0
        }
        "trend" => {
            let mut slugs = slug_candidates(rest.first().map(String::as_str), &cwd);
            if slugs.is_empty() {
                slugs.push("null".to_string());
            }
            let limit: f64 = match rest.get(1).filter(|s| !s.is_empty()) {
                Some(l) => js_number(l),
                None => 5.0,
            };
            let target = rest.first().map(String::as_str).unwrap_or("");
            let target_identity = resolve_target_identity(target, &cwd);
            let mut all: Vec<String> = slugs
                .first()
                .into_iter()
                .flat_map(|slug| list_snapshots(&format!("__{}.md", slug), &cwd, &env))
                .collect();
            if let Some(legacy) = slugs.get(1) {
                all.extend(
                    list_snapshots(&format!("__{}.md", legacy), &cwd, &env)
                        .into_iter()
                        .filter(|path| {
                            read_snapshot_at(path)
                                .and_then(|snapshot| snapshot_target_identity(&snapshot))
                                .as_deref()
                                == target_identity.as_deref()
                        }),
                );
            }
            all.sort();
            let slice = js_slice_last(&all, limit);
            let rows: Vec<Value> = slice
                .iter()
                .map(|f| Value::Object(parse_frontmatter(&safe_read(f).unwrap_or_default())))
                .collect();
            io.out(&format!("{}\n", json_pretty(&Value::Array(rows))));
            0
        }
        _ => {
            io.err("usage: impeccable critique-storage <slug|write|latest|trend|close|changes> [args]\n");
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

    static TMP_SEQ: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

    fn tmp() -> String {
        let base = std::env::temp_dir().join(format!(
            "impeccable-critique-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos(),
            // A per-process counter: Windows' clock is coarse enough that two
            // parallel tests can share a nanosecond stamp and then delete each
            // other's directories.
            TMP_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&base).unwrap();
        // Like Node's `realpathSync`: no `\\?\` verbatim prefix on Windows,
        // so paths the verb joins with `/` resolve under this root.
        let real = std::fs::canonicalize(&base).unwrap().to_string_lossy().into_owned();
        real.strip_prefix(r"\\?\").map(str::to_string).unwrap_or(real)
    }

    fn run_capture(cwd: &str, args: &[&str]) -> (i32, String, String) {
        run_capture_env(cwd, args, &[])
    }

    fn run_capture_env(cwd: &str, args: &[&str], env: &[(&str, &str)]) -> (i32, String, String) {
        let env: HashMap<String, String> = env.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        let (mut io, cap) = Io::captured("", PathBuf::from(cwd), env);
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
        // The file identity is the platform's resolved path (Node `path.resolve`
        // semantics through `jsp`), so it carries the host's separators.
        let expected_file = format!("file:{}", jsp::resolve(cwd, &["src/App.tsx"]));
        assert_eq!(resolve_target_identity("src/App.tsx", cwd), Some(expected_file));
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
        // The identity exactly as the verb resolves it for this target from this
        // cwd, so the test holds on every platform's path semantics.
        let identity = resolve_target_identity("App.tsx", &cwd).unwrap();
        // Frontmatter values are JSON scalars (`parse_frontmatter` reads them
        // with serde_json), so the identity is JSON-quoted: a Windows path's
        // backslashes must be escaped or the value fails to parse.
        let body = format!(
            "---\ntarget_identity: {}\nslug: app-tsx\n---\n# Critique\n",
            serde_json::to_string(&identity).unwrap()
        );
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

    #[test]
    fn explicit_long_targets_find_and_close_pre_hash_snapshots() {
        let cwd = tmp();
        let dir = jsp::join(&[&cwd, ".impeccable", "critique"]);
        std::fs::create_dir_all(&dir).unwrap();
        let target = "https://example.com/a-very-long-directory-structure-with-many-segments/component-name";
        let legacy_slug = legacy_slug_from_target(Some(target), &cwd).unwrap();
        assert_ne!(legacy_slug, slug_from_target(Some(target), &cwd).unwrap());
        let name = format!("2026-05-12T18-30-00Z__{legacy_slug}.md");
        let identity = resolve_target_identity(target, &cwd).unwrap();
        let body = format!(
            "---\ntarget_identity: {}\nslug: {}\n---\n# Legacy critique\n",
            serde_json::to_string(&identity).unwrap(),
            legacy_slug
        );
        std::fs::write(jsp::join(&[&dir, &name]), body).unwrap();

        let (code, out, _) = run_capture(&cwd, &["latest", target, "--json"]);
        assert_eq!(code, 0);
        assert!(out.contains(&name));

        let (code, out, _) = run_capture(&cwd, &["trend", target, "5"]);
        assert_eq!(code, 0);
        assert!(out.contains(&legacy_slug));

        let (code, _, _) = run_capture(&cwd, &["close", target, &name]);
        assert_eq!(code, 0);
        assert!(std::fs::read_to_string(jsp::join(&[&dir, &name])).unwrap().contains("closed: true"));

        let _ = std::fs::remove_dir_all(&cwd);
    }

    #[test]
    fn pre_hash_slug_collisions_require_matching_identity() {
        let cwd = tmp();
        let dir = jsp::join(&[&cwd, ".impeccable", "critique"]);
        std::fs::create_dir_all(&dir).unwrap();
        let target = "https://example.com/first-prefix-that-is-long-enough/a-very-long-shared-tail/component-name";
        let collision = "https://example.com/second-prefix-that-is-long-enough/a-very-long-shared-tail/component-name";
        let legacy_slug = legacy_slug_from_target(Some(target), &cwd).unwrap();
        assert_eq!(legacy_slug, legacy_slug_from_target(Some(collision), &cwd).unwrap());
        assert_ne!(slug_from_target(Some(target), &cwd), slug_from_target(Some(collision), &cwd));

        let unidentified_name = format!("2026-05-12T18-30-00Z__{legacy_slug}.md");
        let unidentified_body = format!("---\nslug: {legacy_slug}\n---\n# Ambiguous legacy critique\n");
        std::fs::write(jsp::join(&[&dir, &unidentified_name]), unidentified_body).unwrap();

        assert_eq!(run_capture(&cwd, &["latest", target]).0, 2);
        assert_eq!(run_capture(&cwd, &["latest", collision]).0, 2);
        assert_eq!(run_capture(&cwd, &["trend", target, "5"]).1.trim(), "[]");
        assert_eq!(run_capture(&cwd, &["close", target, &unidentified_name]).0, 2);
        let (code, out, _) = run_capture(&cwd, &["latest", &legacy_slug]);
        assert_eq!(code, 0);
        assert!(out.contains("# Ambiguous legacy critique"));
        assert!(run_capture(&cwd, &["trend", &legacy_slug, "5"]).1.contains(&legacy_slug));
        assert_eq!(run_capture(&cwd, &["close", &legacy_slug, &unidentified_name]).0, 0);

        let identified_name = format!("2026-05-12T18-31-00Z__{legacy_slug}.md");
        let identity = resolve_target_identity(target, &cwd).unwrap();
        let identified_body = format!(
            "---\ntarget_identity: {}\nslug: {}\n---\n# Identified legacy critique\n",
            serde_json::to_string(&identity).unwrap(),
            legacy_slug
        );
        std::fs::write(jsp::join(&[&dir, &identified_name]), identified_body).unwrap();

        assert_eq!(run_capture(&cwd, &["latest", target]).0, 0);
        assert_eq!(run_capture(&cwd, &["latest", collision]).0, 2);
        assert!(run_capture(&cwd, &["trend", target, "5"]).1.contains("target_identity"));
        assert_eq!(run_capture(&cwd, &["trend", collision, "5"]).1.trim(), "[]");
        assert_eq!(run_capture(&cwd, &["close", collision, &identified_name]).0, 2);
        assert_eq!(run_capture(&cwd, &["close", target, &identified_name]).0, 0);

        let _ = std::fs::remove_dir_all(&cwd);
    }

    /// Runs git in `cwd` under a fixed identity; false when git is missing or fails.
    fn git_ok(cwd: &str, args: &[&str]) -> bool {
        Command::new("git")
            .args(["-c", "user.name=t", "-c", "user.email=t@t"])
            .args(args)
            .current_dir(cwd)
            .output()
            .is_ok_and(|o| o.status.success())
    }

    /// A project with a fresh git repo (no commits) and a source file, or
    /// `None` when this machine has no git.
    fn repo() -> Option<String> {
        let cwd = tmp();
        if !git_ok(&cwd, &["init", "-q"]) {
            let _ = std::fs::remove_dir_all(&cwd);
            return None;
        }
        std::fs::create_dir_all(jsp::join(&[&cwd, "src"])).unwrap();
        std::fs::write(jsp::join(&[&cwd, "src", "App.tsx"]), "one\n").unwrap();
        Some(cwd)
    }

    /// Writes a critique snapshot for src/App.tsx; returns its path.
    fn snapshot(cwd: &str, meta: &str) -> String {
        let body_dir = tmp();
        let body = jsp::join(&[&body_dir, "body.md"]);
        std::fs::write(&body, "#### All Findings\n").unwrap();
        let (code, out, _) = run_capture_env(cwd, &["write", "src/App.tsx", &body], &[("IMPECCABLE_CRITIQUE_META", meta)]);
        assert_eq!(code, 0);
        let _ = std::fs::remove_dir_all(&body_dir);
        out.trim().to_string()
    }

    #[test]
    fn write_records_a_change_base_only_where_git_can_make_one() {
        let Some(cwd) = repo() else { return };
        let path = snapshot(&cwd, r#"{"change_base":"evil","total_score":3}"#);
        let meta = parse_frontmatter(&std::fs::read_to_string(&path).unwrap());
        let base = meta["change_base"].as_str().unwrap();
        assert!(base.len() >= 40 && base.chars().all(|c| c.is_ascii_hexdigit()), "{base}");
        // The snapshot's own directory is outside the tree, so it is still the base.
        assert_eq!(working_tree_id(&cwd, None).as_deref(), Some(base));
        assert_eq!(meta["total_score"], 3);
        let _ = std::fs::remove_dir_all(&cwd);

        let outside = tmp();
        if git(&outside, None, &["rev-parse", "--git-dir"]).is_some() {
            return; // the temp dir sits inside someone's repo
        }
        std::fs::create_dir_all(jsp::join(&[&outside, "src"])).unwrap();
        std::fs::write(jsp::join(&[&outside, "src", "App.tsx"]), "one\n").unwrap();
        let path = snapshot(&outside, r#"{"change_base":"evil"}"#);
        assert!(!std::fs::read_to_string(&path).unwrap().contains("change_base"));
        let name = jsp::basename(&path);
        assert_eq!(run_capture(&outside, &["changes", "src/App.tsx"]).1, format!("previous: {name}\nchanges: unknown\n"));
        let _ = std::fs::remove_dir_all(&outside);
    }

    #[test]
    fn changes_needs_a_target_and_a_snapshot() {
        let cwd = tmp();
        assert_eq!(run_capture(&cwd, &["changes"]), (1, String::new(), "usage: changes <resolved-target> [--diff]\n".to_string()));
        let _ = std::fs::remove_dir_all(&cwd);
    }

    #[test]
    fn changes_diffs_the_working_tree_against_the_recorded_base() {
        let Some(cwd) = repo() else { return };
        let at = |rel: &str| jsp::join(&[&cwd, rel]);
        std::fs::write(at(".gitignore"), "*.log\n").unwrap();
        std::fs::write(at("ignored.log"), "ignored\n").unwrap();
        std::fs::write(at("notes.txt"), "untracked before the write\n").unwrap();
        assert!(git_ok(&cwd, &["add", "src/App.tsx"]));
        let index = std::fs::read(at(".git/index")).unwrap();
        let name = jsp::basename(&snapshot(&cwd, "{}"));
        let changes = || run_capture(&cwd, &["changes", "src/App.tsx"]);
        assert_eq!(changes(), (0, format!("previous: {name}\nchanges: none\n"), String::new()));

        // Anything under `.impeccable/`, at any depth, is not a change.
        std::fs::create_dir_all(at("pkg/.impeccable")).unwrap();
        std::fs::write(at("pkg/.impeccable/notes.md"), "nested\n").unwrap();
        std::fs::create_dir_all(at(".impeccable/surfaces")).unwrap();
        std::fs::write(at(".impeccable/surfaces/home.md"), "brief\n").unwrap();
        assert_eq!(changes().1, format!("previous: {name}\nchanges: none\n"));

        // A dirty edit and a new untracked file are; the ignored file and the
        // file that was already untracked at write time are not.
        std::fs::write(at("src/App.tsx"), "two\n").unwrap();
        std::fs::write(at("new.txt"), "fresh\n").unwrap();
        std::fs::write(at("ignored.log"), "changed\n").unwrap();
        assert_eq!(changes().1, format!("previous: {name}\nchanges: 2 files\nnew.txt\nsrc/App.tsx\n"));
        let (code, out, _) = run_capture(&cwd, &["changes", "src/App.tsx", "--diff"]);
        assert_eq!(code, 0);
        assert!(out.starts_with(&format!("previous: {name}\nchanges: 2 files\ndiff --git ")), "{out}");
        assert!(out.contains("src/App.tsx") && out.contains("+two") && out.contains("new.txt"), "{out}");
        for left_out in ["notes.txt", "ignored.log", ".gitignore", ".impeccable"] {
            assert!(!out.contains(left_out), "{left_out} in {out}");
        }

        // Polish closes the snapshot it processed; the rerun still diffs against it.
        assert_eq!(run_capture(&cwd, &["close", "src/App.tsx", &name]).0, 0);
        assert_eq!(run_capture(&cwd, &["latest", "src/App.tsx"]).0, 2);
        assert!(changes().1.starts_with(&format!("previous: {name}\nchanges: 2 files\n")));

        // The user's index was never touched.
        assert_eq!(std::fs::read(at(".git/index")).unwrap(), index);
        let _ = std::fs::remove_dir_all(&cwd);
    }

    #[test]
    fn changes_leaves_out_tracked_impeccable_files_even_when_staged() {
        let Some(cwd) = repo() else { return };
        let tracked = jsp::join(&[&cwd, ".impeccable", "tracked.md"]);
        std::fs::create_dir_all(jsp::join(&[&cwd, ".impeccable"])).unwrap();
        std::fs::write(&tracked, "a\n").unwrap();
        assert!(git_ok(&cwd, &["add", "-f", ".impeccable/tracked.md"]));
        assert!(git_ok(&cwd, &["commit", "-qm", "base"]));
        // Staged and then edited again, the state a plain `git rm --cached` refuses.
        std::fs::write(&tracked, "b\n").unwrap();
        assert!(git_ok(&cwd, &["add", "-f", ".impeccable/tracked.md"]));
        std::fs::write(&tracked, "c\n").unwrap();
        let name = jsp::basename(&snapshot(&cwd, "{}"));
        std::fs::write(&tracked, "d\n").unwrap();
        assert_eq!(run_capture(&cwd, &["changes", "src/App.tsx"]).1, format!("previous: {name}\nchanges: none\n"));
        let _ = std::fs::remove_dir_all(&cwd);
    }

    #[test]
    fn changes_is_unknown_when_the_recorded_base_cannot_be_used() {
        let Some(cwd) = repo() else { return };
        let dir = jsp::join(&[&cwd, ".impeccable", "critique"]);
        std::fs::create_dir_all(&dir).unwrap();
        let slug = slug_from_target(Some("src/App.tsx"), &cwd).unwrap();
        let identity = serde_json::to_string(&resolve_target_identity("src/App.tsx", &cwd).unwrap()).unwrap();
        // No base, a base that reads as a git option, and a tree git does not have.
        let bases = ["", "change_base: --output=pwned\n", "change_base: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n"];
        for (i, base) in bases.iter().enumerate() {
            let name = format!("2026-05-12T18-3{i}-00Z__{slug}.md");
            let body = format!("---\ntarget_identity: {identity}\nslug: {slug}\n{base}---\n#### All Findings\n");
            std::fs::write(jsp::join(&[&dir, &name]), body).unwrap();
            let (code, out, _) = run_capture(&cwd, &["changes", "src/App.tsx"]);
            assert_eq!((code, out), (0, format!("previous: {name}\nchanges: unknown\n")));
        }
        assert!(!exists(&jsp::join(&[&cwd, "pwned"])));
        let _ = std::fs::remove_dir_all(&cwd);
    }

    /// A snapshot for `target`, written with the body inside the project when
    /// `body_rel` is given; returns its file name.
    fn snapshot_for(cwd: &str, target: &str, body_rel: &str) -> String {
        let body = jsp::join(&[cwd, body_rel]);
        std::fs::write(&body, "#### All Findings\n").unwrap();
        let (code, out, _) = run_capture_env(cwd, &["write", target, &body], &[]);
        assert_eq!(code, 0);
        std::fs::remove_file(&body).unwrap();
        jsp::basename(out.trim())
    }

    #[test]
    fn changes_gives_no_verdict_on_a_target_the_tree_cannot_see() {
        let Some(cwd) = repo() else { return };
        std::fs::write(jsp::join(&[&cwd, ".gitignore"]), "dist/\n").unwrap();
        std::fs::create_dir_all(jsp::join(&[&cwd, "dist"])).unwrap();
        std::fs::write(jsp::join(&[&cwd, "dist", "page.html"]), "one\n").unwrap();
        let outside_dir = tmp();
        let outside = jsp::join(&[&outside_dir, "page.html"]);
        std::fs::write(&outside, "one\n").unwrap();
        for target in ["dist/page.html", outside.as_str(), "https://example.com/pricing"] {
            let name = snapshot_for(&cwd, target, "body.md");
            assert_eq!(run_capture(&cwd, &["changes", target]).1, format!("previous: {name}\nchanges: unknown\n"), "{target}");
        }
        // A local dev server serves this repo, so its tree does speak for it.
        let name = snapshot_for(&cwd, "http://localhost:3000/pricing", "body.md");
        assert_eq!(run_capture(&cwd, &["changes", "http://localhost:3000/pricing"]).1, format!("previous: {name}\nchanges: none\n"));
        let _ = std::fs::remove_dir_all(&cwd);
        let _ = std::fs::remove_dir_all(&outside_dir);
    }

    #[test]
    fn change_base_holds_no_secrets_body_file_or_lockfile_diff() {
        let Some(cwd) = repo() else { return };
        let at = |rel: &str| jsp::join(&[&cwd, rel]);
        std::fs::write(at(".env"), "STRIPE_SECRET=one\n").unwrap();
        // The body lives in the project and is deleted after the write: no deletion shows.
        let name = snapshot_for(&cwd, "src/App.tsx", "body.md");
        std::fs::write(at(".env"), "STRIPE_SECRET=two\n").unwrap();
        std::fs::write(at("server.key"), "private\n").unwrap();
        assert_eq!(run_capture(&cwd, &["changes", "src/App.tsx"]).1, format!("previous: {name}\nchanges: none\n"));

        std::fs::write(at("pnpm-lock.yaml"), "huge\n").unwrap();
        assert_eq!(run_capture(&cwd, &["changes", "src/App.tsx"]).1, format!("previous: {name}\nchanges: 1 files\npnpm-lock.yaml\n"));
        let (_, diff, _) = run_capture(&cwd, &["changes", "src/App.tsx", "--diff"]);
        assert_eq!(diff, format!("previous: {name}\nchanges: 1 files\n"));
        let _ = std::fs::remove_dir_all(&cwd);
    }

    #[test]
    fn a_snapshot_with_no_ledger_counts_as_no_previous_run() {
        let Some(cwd) = repo() else { return };
        let body = jsp::join(&[&cwd, "body.md"]);
        std::fs::write(&body, "#### Priority Issues\n").unwrap();
        assert_eq!(run_capture(&cwd, &["write", "src/App.tsx", &body]).0, 0);
        std::fs::remove_file(&body).unwrap();
        assert_eq!(run_capture(&cwd, &["changes", "src/App.tsx"]), (2, String::new(), String::new()));
        let _ = std::fs::remove_dir_all(&cwd);
    }

    #[test]
    fn a_fatal_add_or_a_target_the_base_leaves_out_gets_no_verdict() {
        let Some(cwd) = repo() else { return };
        let at = |rel: &str| jsp::join(&[&cwd, rel]);
        // A target the base excludes: the tree cannot move, its bytes can.
        std::fs::write(at("page.key"), "one\n").unwrap();
        let name = snapshot_for(&cwd, "page.key", "body.md");
        assert_eq!(run_capture(&cwd, &["changes", "page.key"]).1, format!("previous: {name}\nchanges: none\n"));
        std::fs::write(at("page.key"), "two\n").unwrap();
        assert_eq!(run_capture(&cwd, &["changes", "page.key"]).1, format!("previous: {name}\nchanges: unknown\n"));

        // A required filter that fails (LFS with git-lfs off PATH): git add dies
        // and the seeded index must not read as "nothing changed".
        let name = snapshot_for(&cwd, "src/App.tsx", "body.md");
        assert!(git_ok(&cwd, &["config", "filter.x.clean", "false"]));
        assert!(git_ok(&cwd, &["config", "filter.x.required", "true"]));
        std::fs::write(at(".gitattributes"), "*.bin filter=x\n").unwrap();
        std::fs::write(at("image.bin"), "bytes\n").unwrap();
        assert_eq!(run_capture(&cwd, &["changes", "src/App.tsx"]).1, format!("previous: {name}\nchanges: unknown\n"));
        let _ = std::fs::remove_dir_all(&cwd);
    }

    #[test]
    fn index_flags_do_not_hide_an_edit_from_the_change_base() {
        let Some(cwd) = repo() else { return };
        let at = |rel: &str| jsp::join(&[&cwd, rel]);
        std::fs::write(at("assumed.css"), "one\n").unwrap();
        std::fs::write(at("skipped.css"), "one\n").unwrap();
        assert!(git_ok(&cwd, &["add", "-A"]));
        assert!(git_ok(&cwd, &["commit", "-qm", "base"]));
        assert!(git_ok(&cwd, &["update-index", "--assume-unchanged", "assumed.css"]));
        assert!(git_ok(&cwd, &["update-index", "--skip-worktree", "skipped.css"]));
        let name = snapshot_for(&cwd, "src/App.tsx", "body.md");
        assert_eq!(run_capture(&cwd, &["changes", "src/App.tsx"]).1, format!("previous: {name}\nchanges: none\n"));
        std::fs::write(at("assumed.css"), "two\n").unwrap();
        std::fs::write(at("skipped.css"), "two\n").unwrap();
        assert_eq!(
            run_capture(&cwd, &["changes", "src/App.tsx"]).1,
            format!("previous: {name}\nchanges: 2 files\nassumed.css\nskipped.css\n")
        );
        // The user's own flags stay set.
        assert!(git(&cwd, None, &["ls-files", "-v"]).unwrap().contains("h assumed.css"));
        let _ = std::fs::remove_dir_all(&cwd);
    }

    #[test]
    fn a_sparse_checkout_does_not_read_its_absent_files_as_deleted() {
        let Some(cwd) = repo() else { return };
        let absent = jsp::join(&[&cwd, "absent.css"]);
        std::fs::write(&absent, "one\n").unwrap();
        assert!(git_ok(&cwd, &["add", "-A"]));
        assert!(git_ok(&cwd, &["commit", "-qm", "base"]));
        assert!(git_ok(&cwd, &["update-index", "--skip-worktree", "absent.css"]));
        std::fs::remove_file(&absent).unwrap();
        let name = snapshot_for(&cwd, "src/App.tsx", "body.md");
        let tree = git(&cwd, None, &["rev-parse", "HEAD^{tree}"]).unwrap();
        let meta = parse_frontmatter(&std::fs::read_to_string(jsp::join(&[&cwd, ".impeccable", "critique", &name])).unwrap());
        assert_eq!(meta["change_base"].as_str(), Some(tree.trim()));
        let _ = std::fs::remove_dir_all(&cwd);
    }

    #[test]
    fn private_dir_refuses_what_is_already_there() {
        let base = tmp();
        let dir = std::path::Path::new(&base).join("index-dir");
        assert!(private_dir(&dir).is_ok());
        assert!(private_dir(&dir).is_err());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777, 0o700);
            let target = std::path::Path::new(&base).join("elsewhere");
            std::fs::create_dir(&target).unwrap();
            let planted = std::path::Path::new(&base).join("planted");
            std::os::unix::fs::symlink(&target, &planted).unwrap();
            assert!(private_dir(&planted).is_err());
        }
        let _ = std::fs::remove_dir_all(&base);
    }

    #[cfg(unix)]
    #[test]
    fn an_unwritable_object_store_gets_no_verdict() {
        use std::os::unix::fs::PermissionsExt;
        let Some(cwd) = repo() else { return };
        let name = snapshot_for(&cwd, "src/App.tsx", "body.md");
        // git refuses every new object once it cannot make their fan-out dirs.
        let objects = jsp::join(&[&cwd, ".git", "objects"]);
        let dirs: Vec<std::path::PathBuf> = std::fs::read_dir(&objects).unwrap().flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
        let lock = |mode: u32| {
            for dir in &dirs {
                std::fs::set_permissions(dir, std::fs::Permissions::from_mode(mode)).unwrap();
            }
            std::fs::set_permissions(&objects, std::fs::Permissions::from_mode(mode)).unwrap();
        };
        std::fs::write(jsp::join(&[&cwd, "other.css"]), "edited\n").unwrap();
        lock(0o555);
        let writable = objects_writable(&cwd);
        let out = run_capture(&cwd, &["changes", "src/App.tsx"]).1;
        lock(0o755);
        if !writable {
            assert_eq!(out, format!("previous: {name}\nchanges: unknown\n"));
        } // Running as root: permissions do not bind, so there is nothing to prove.
        let _ = std::fs::remove_dir_all(&cwd);
    }

    #[cfg(unix)]
    #[test]
    fn an_unreadable_file_does_not_lose_the_change_base() {
        use std::os::unix::fs::PermissionsExt;
        let Some(cwd) = repo() else { return };
        let locked = jsp::join(&[&cwd, "locked.txt"]);
        std::fs::write(&locked, "secret\n").unwrap();
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o000)).unwrap();
        let name = snapshot_for(&cwd, "src/App.tsx", "body.md");
        let out = run_capture(&cwd, &["changes", "src/App.tsx"]).1;
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert_eq!(out, format!("previous: {name}\nchanges: none\n"));
        let _ = std::fs::remove_dir_all(&cwd);
    }
}
