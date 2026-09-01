//! JS: live-inject.mjs `validateConfig`, `resolveFiles`, `globToRegex`, plus
//! a walker that reproduces `fs.globSync` result order (Node's
//! `internal/fs/glob`: per-directory readdir order for matches, then
//! subdirectories processed last-pushed-first).

use crate::util::{jsp, read_dir_raw};
use regex::Regex;
use serde_json::Value;

/// JS: HARD_EXCLUDES
pub const HARD_EXCLUDES: [&str; 2] = ["**/node_modules/**", "**/.git/**"];

/// The parsed `.impeccable/live/config.json` (kept as JSON so `--check` can
/// echo it verbatim), with typed accessors for the validated fields.
#[derive(Debug, Clone)]
pub struct LiveConfig {
    pub raw: Value,
}

impl LiveConfig {
    pub fn files(&self) -> Vec<String> {
        self.raw
            .get("files")
            .and_then(|f| f.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default()
    }
    pub fn exclude(&self) -> Vec<String> {
        self.raw
            .get("exclude")
            .and_then(|f| f.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default()
    }
    pub fn insert_before(&self) -> Option<&str> {
        self.raw.get("insertBefore").and_then(|v| v.as_str())
    }
    pub fn insert_after(&self) -> Option<&str> {
        self.raw.get("insertAfter").and_then(|v| v.as_str())
    }
    /// `config.commentSyntax` (`'html' | 'jsx'` after validation).
    pub fn comment_syntax(&self) -> &str {
        self.raw
            .get("commentSyntax")
            .and_then(|v| v.as_str())
            .unwrap_or("html")
    }
}

/// JS: validateConfig(cfg). Error strings verbatim.
pub fn validate_config(cfg: &Value) -> Result<(), String> {
    let Some(obj) = cfg.as_object() else {
        return Err("config.json must be an object".to_string());
    };
    let files = obj.get("files").and_then(|f| f.as_array());
    match files {
        Some(f) if !f.is_empty() => {
            if !f
                .iter()
                .all(|x| x.as_str().map(|s| !s.is_empty()).unwrap_or(false))
            {
                return Err("config.files must contain only non-empty strings".to_string());
            }
        }
        _ => return Err("config.files (non-empty string array) required".to_string()),
    }
    if let Some(ex) = obj.get("exclude") {
        // JS: `cfg.exclude !== undefined`; a JSON null is present-but-not-array.
        match ex.as_array() {
            None => return Err("config.exclude, if present, must be a string array".to_string()),
            Some(a) => {
                if !a
                    .iter()
                    .all(|x| x.as_str().map(|s| !s.is_empty()).unwrap_or(false))
                {
                    return Err("config.exclude must contain only non-empty strings".to_string());
                }
            }
        }
    }
    let ib = obj
        .get("insertBefore")
        .map(|v| v.is_string())
        .unwrap_or(false);
    let ia = obj
        .get("insertAfter")
        .map(|v| v.is_string())
        .unwrap_or(false);
    if !ib && !ia {
        return Err("config.insertBefore or config.insertAfter (string) required".to_string());
    }
    match obj.get("commentSyntax").and_then(|v| v.as_str()) {
        Some("html") | Some("jsx") => {}
        _ => return Err("config.commentSyntax must be 'html' or 'jsx'".to_string()),
    }
    if let Some(c) = obj.get("cspChecked") {
        if !c.is_boolean() {
            return Err("config.cspChecked, if present, must be a boolean".to_string());
        }
    }
    Ok(())
}

/// JS: globToRegex(pattern) (live-inject.mjs and live.mjs share it).
pub fn glob_to_regex(pattern: &str) -> Regex {
    let chars: Vec<char> = pattern.chars().collect();
    let mut re = String::from("^");
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '*' {
            if chars.get(i + 1) == Some(&'*') {
                if chars.get(i + 2) == Some(&'/') {
                    re.push_str("(?:.*/)?");
                    i += 3;
                } else {
                    re.push_str(".*");
                    i += 2;
                }
            } else {
                re.push_str("[^/]*");
                i += 1;
            }
        } else if c == '?' {
            re.push_str("[^/]");
            i += 1;
        } else if ".+^${}()|[]\\".contains(c) {
            re.push('\\');
            re.push(c);
            i += 1;
        } else {
            re.push(c);
            i += 1;
        }
    }
    re.push('$');
    Regex::new(&re).unwrap_or_else(|_| Regex::new("^$").unwrap())
}

fn is_glob(s: &str) -> bool {
    s.contains('*') || s.contains('?') || s.contains('[')
}

/// JS: resolveFiles(rootDir, config): literal entries pass through
/// (unfiltered), glob entries expand to existing files (relative, forward
/// slashes) filtered by HARD_EXCLUDES + config.exclude; deduped in order of
/// first appearance.
pub fn resolve_files(root_dir: &str, config: &LiveConfig) -> Vec<String> {
    let mut excludes: Vec<Regex> = HARD_EXCLUDES.iter().map(|p| glob_to_regex(p)).collect();
    excludes.extend(config.exclude().iter().map(|p| glob_to_regex(p)));
    let is_excluded = |rel: &str| excludes.iter().any(|re| re.is_match(rel));
    let mut seen: Vec<String> = Vec::new();
    let mut out: Vec<String> = Vec::new();
    for pat in config.files() {
        if !is_glob(&pat) {
            if !seen.contains(&pat) {
                seen.push(pat.clone());
                out.push(pat);
            }
            continue;
        }
        for rel in glob_sync(root_dir, &pat) {
            let abs = jsp::join(&[root_dir, &rel]);
            if !std::path::Path::new(&abs).is_file() {
                continue;
            }
            let rel = jsp::to_posix(&jsp::relative("/", root_dir, &abs));
            if is_excluded(&rel) || seen.contains(&rel) {
                continue;
            }
            seen.push(rel.clone());
            out.push(rel);
        }
    }
    out
}

#[derive(Debug, Clone)]
enum Seg {
    Literal(String),
    GlobStar,
    Wild(Regex),
}

fn parse_pattern(pattern: &str) -> Option<Vec<Seg>> {
    let mut segs = Vec::new();
    for part in pattern.split('/') {
        if part.is_empty() {
            continue;
        }
        if part == "**" {
            segs.push(Seg::GlobStar);
        } else if is_glob(part) {
            segs.push(Seg::Wild(segment_regex(part)?));
        } else {
            segs.push(Seg::Literal(part.to_string()));
        }
    }
    Some(segs)
}

/// One path segment of a glob as a regex (`*`, `?`, `[...]`), no `/`.
fn segment_regex(seg: &str) -> Option<Regex> {
    let chars: Vec<char> = seg.chars().collect();
    let mut re = String::from("^");
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        match c {
            '*' => re.push_str("[^/]*"),
            '?' => re.push_str("[^/]"),
            '[' => {
                // copy the class through the closing bracket
                let mut j = i + 1;
                let mut cls = String::from("[");
                if chars.get(j) == Some(&'!') {
                    cls.push('^');
                    j += 1;
                }
                let mut closed = false;
                while j < chars.len() {
                    let d = chars[j];
                    if d == ']' && j > i + 1 {
                        closed = true;
                        break;
                    }
                    if d == '\\' || d == '[' {
                        cls.push('\\');
                    }
                    cls.push(d);
                    j += 1;
                }
                if closed {
                    cls.push(']');
                    re.push_str(&cls);
                    i = j;
                } else {
                    re.push_str("\\[");
                }
            }
            _ => {
                if ".+^${}()|\\".contains(c) {
                    re.push('\\');
                }
                re.push(c);
            }
        }
        i += 1;
    }
    re.push('$');
    Regex::new(&re).ok()
}

/// minimatch-style match of one segment; wildcards do not match a leading
/// dot unless the pattern itself starts with one.
fn seg_matches(seg: &Seg, name: &str) -> bool {
    match seg {
        Seg::Literal(l) => l == name,
        Seg::GlobStar => !name.starts_with('.'),
        Seg::Wild(re) => {
            if name.starts_with('.') && !re.as_str().starts_with("^\\.") {
                return false;
            }
            re.is_match(name)
        }
    }
}

/// `fs.globSync(pattern, { cwd })` results in Node's order (relative,
/// forward slashes; both files and directories, the caller filters).
/// Supports literal segments, `*`/`?`/`[...]` segments and `**`.
pub fn glob_sync(root: &str, pattern: &str) -> Vec<String> {
    let Some(segs) = parse_pattern(pattern) else {
        return vec![];
    };
    if segs.is_empty() {
        return vec![];
    }
    let mut results: Vec<String> = Vec::new();
    // stack of (relative dir path or "", active pattern indexes)
    let mut stack: Vec<(String, Vec<usize>)> = vec![(String::new(), vec![0])];
    let last = segs.len() - 1;
    while let Some((dir, indexes)) = stack.pop() {
        let abs = if dir.is_empty() {
            root.to_string()
        } else {
            jsp::join(&[root, &dir])
        };
        // A single literal first index reads just that entry (Node stats
        // `join(fullpath, firstPattern)` instead of readdir).
        let entries: Vec<(String, bool)> = if indexes.len() == 1 {
            if let Seg::Literal(name) = &segs[indexes[0]] {
                let p = jsp::join(&[&abs, name]);
                match std::fs::metadata(&p) {
                    Ok(md) => vec![(name.clone(), md.is_dir())],
                    Err(_) => continue,
                }
            } else {
                match read_dir_raw(&abs) {
                    Some(list) => list.into_iter().map(|e| (e.name, e.is_dir)).collect(),
                    None => continue,
                }
            }
        } else {
            match read_dir_raw(&abs) {
                Some(list) => list.into_iter().map(|e| (e.name, e.is_dir)).collect(),
                None => continue,
            }
        };
        let mut sub: Vec<(String, Vec<usize>)> = Vec::new();
        for (name, is_dir) in entries {
            let entry_path = if dir.is_empty() {
                name.clone()
            } else {
                format!("{}/{}", dir, name)
            };
            let mut next_indexes: Vec<usize> = Vec::new();
            let mut add_result = false;
            for &index in &indexes {
                let seg = &segs[index];
                match seg {
                    Seg::GlobStar => {
                        if name.starts_with('.') {
                            let next_non =
                                (index + 1..=last).find(|&k| !matches!(segs[k], Seg::GlobStar));
                            let matches_dot = next_non
                                .map(|k| seg_matches(&segs[k], &name))
                                .unwrap_or(false);
                            if !matches_dot {
                                continue;
                            }
                        }
                        let next_index = index + 1;
                        let next_matches =
                            next_index <= last && seg_matches(&segs[next_index], &name);
                        if is_dir {
                            push_unique(&mut next_indexes, index);
                        } else if index == last {
                            add_result = true;
                        }
                        if next_matches && next_index == last {
                            add_result = true;
                        } else if next_matches && is_dir {
                            push_unique(&mut next_indexes, index + 2);
                        }
                        if next_matches && is_dir {
                            push_unique(&mut next_indexes, next_index);
                        }
                    }
                    Seg::Literal(_) | Seg::Wild(_) => {
                        if seg_matches(seg, &name) {
                            if index == last {
                                add_result = true;
                            } else if is_dir {
                                push_unique(&mut next_indexes, index + 1);
                            }
                        }
                    }
                }
            }
            if add_result && !results.contains(&entry_path) {
                results.push(entry_path.clone());
            }
            let next_indexes: Vec<usize> =
                next_indexes.into_iter().filter(|&k| k <= last).collect();
            if !next_indexes.is_empty() && is_dir {
                if let Some(existing) = sub.iter_mut().find(|(p, _)| *p == entry_path) {
                    for k in next_indexes {
                        push_unique(&mut existing.1, k);
                    }
                } else {
                    sub.push((entry_path, next_indexes));
                }
            }
        }
        for item in sub {
            stack.push(item);
        }
    }
    results
}

fn push_unique(v: &mut Vec<usize>, k: usize) {
    if !v.contains(&k) {
        v.push(k);
    }
}
