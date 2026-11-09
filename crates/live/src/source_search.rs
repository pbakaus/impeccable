//! JS: live/source-search.mjs, lib/template-extensions.mjs (the live
//! subset), lib/is-generated.mjs. The project-source walk wrap and accept
//! share, the template-extension list it matches, and the generated-file
//! guard (git check-ignore + header markers).

use crate::util::{exists, is_dir, jsp, read_json, safe_read};
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::Value;

/// JS: SOURCE_SEARCH_DIRS
pub const SOURCE_SEARCH_DIRS: [&str; 9] = [
    "src",
    "app",
    "pages",
    "components",
    "public",
    "views",
    "templates",
    "lib",
    ".",
];

/// JS: NEVER_SOURCE_DIRS
pub const NEVER_SOURCE_DIRS: [&str; 3] = ["node_modules", ".git", ".impeccable"];

const MAX_DEPTH: usize = 5;

/// JS: LIVE_TEMPLATE_EXTENSIONS
pub const LIVE_TEMPLATE_EXTENSIONS: [&str; 9] = [
    ".html", ".jsx", ".tsx", ".vue", ".svelte", ".astro", ".ex", ".heex", ".eex",
];

/// `fs.readdirSync(dir, { withFileTypes: true })` as libuv returns it: sorted
/// by `strcmp` on the name (uv_fs_scandir sorts). A symlink is neither a file
/// nor a directory.
pub struct DirEnt {
    pub name: String,
    pub is_file: bool,
    pub is_dir: bool,
}

pub fn read_dir_sorted(dir: &str) -> Option<Vec<DirEnt>> {
    let rd = std::fs::read_dir(dir).ok()?;
    let mut out: Vec<DirEnt> = Vec::new();
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let (is_file, is_dir) = match e.file_type() {
            Ok(t) if t.is_symlink() => (false, false),
            Ok(t) => (t.is_file(), t.is_dir()),
            Err(_) => (false, false),
        };
        out.push(DirEnt {
            name,
            is_file,
            is_dir,
        });
    }
    out.sort_by(|a, b| a.name.as_bytes().cmp(b.name.as_bytes()));
    Some(out)
}

/// JS: normalizeExtensionEntries(entries) → the `.ext` strings only.
fn normalize_extension_entries(entries: Option<&Value>) -> Vec<String> {
    let mut out = Vec::new();
    let Some(Value::Array(list)) = entries else {
        return out;
    };
    for entry in list {
        let raw = match entry {
            Value::String(s) => Some(s.as_str()),
            Value::Object(o) => o.get("ext").and_then(|v| v.as_str()),
            _ => None,
        };
        let Some(raw) = raw else { continue };
        let mut ext = impeccable_core::js::trim(raw).to_lowercase();
        if ext.is_empty() {
            continue;
        }
        if !ext.starts_with('.') {
            ext = format!(".{}", ext);
        }
        out.push(ext);
    }
    out
}

/// JS: resolveLiveTemplateExtensions(cwd)
pub fn resolve_live_template_extensions(cwd: &str) -> Vec<String> {
    let mut configured: Vec<String> = Vec::new();
    for name in ["config.json", "config.local.json"] {
        let raw = read_json(&jsp::join(&[cwd, ".impeccable", name]));
        if let Some(Value::Object(o)) = raw {
            if let Some(Value::Object(det)) = o.get("detector") {
                configured.extend(normalize_extension_entries(det.get("extensions")));
            }
        }
    }
    let mut out: Vec<String> = LIVE_TEMPLATE_EXTENSIONS
        .iter()
        .map(|s| s.to_string())
        .collect();
    for ext in configured {
        if out.contains(&ext) {
            continue;
        }
        out.push(ext);
    }
    out
}

/// JS: matchesTemplateExtension(filePath, extensions)
pub fn matches_template_extension(file_path: &str, extensions: &[String]) -> bool {
    let name = jsp::basename(file_path).to_lowercase();
    if name.is_empty() {
        return false;
    }
    let name_len = name.encode_utf16().count();
    for ext in extensions {
        let ext_len = ext.encode_utf16().count();
        if name_len > ext_len && name.ends_with(ext.as_str()) {
            return true;
        }
    }
    false
}

/// JS: isGeneratedFile(filePath, { cwd })
pub fn is_generated_file(file_path: &str, cwd: &str) -> bool {
    let abs = if jsp::is_absolute(file_path) {
        file_path.to_string()
    } else {
        jsp::resolve(cwd, &[file_path])
    };
    if is_git_ignored(&abs, cwd) {
        return true;
    }
    has_generated_header(&abs)
}

fn is_git_ignored(abs: &str, cwd: &str) -> bool {
    let mut cmd = std::process::Command::new("git");
    cmd.args(["check-ignore", "--quiet", abs])
        .current_dir(cwd)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    impeccable_common::proc::hide_window(&mut cmd);
    let status = cmd.status();
    matches!(status, Ok(s) if s.success())
}

static HEADER_MARKERS: Lazy<Vec<Regex>> = Lazy::new(|| {
    vec![
        Regex::new(r"(?i)@generated(?-u:\b)").unwrap(),
        Regex::new(&format!(
            r"(?-u:\b)GENERATED{}+FILE(?-u:\b)",
            impeccable_core::js::WS
        ))
        .unwrap(),
        Regex::new(r"(?i)(?-u:\b)AUTO-?GENERATED(?-u:\b)").unwrap(),
        Regex::new(&format!(
            r"(?i)(?-u:\b)DO{ws}+NOT{ws}+EDIT(?-u:\b)",
            ws = impeccable_core::js::WS
        ))
        .unwrap(),
    ]
});

fn has_generated_header(abs: &str) -> bool {
    use std::io::Read;
    let Ok(mut f) = std::fs::File::open(abs) else {
        return false;
    };
    let mut buf = vec![0u8; 300];
    let mut read = 0;
    loop {
        match f.read(&mut buf[read..]) {
            Ok(0) => break,
            Ok(n) => {
                read += n;
                if read >= 300 {
                    break;
                }
            }
            Err(_) => return false,
        }
    }
    let head = String::from_utf8_lossy(&buf[..read]);
    HEADER_MARKERS.iter().any(|re| re.is_match(&head))
}

/// JS: findSourceFile({ query, cwd, extensions, skipDirs, fileFilter }).
/// Returns the absolute path of the first template file whose contents
/// include `query`.
pub fn find_source_file(
    query: &str,
    cwd: &str,
    extensions: &[String],
    skip_dirs: &[&str],
    file_filter: &dyn Fn(&str) -> bool,
) -> Option<String> {
    let mut first: Option<String> = None;
    visit_source_files(
        query,
        cwd,
        extensions,
        skip_dirs,
        file_filter,
        &mut |path, _| {
            first = Some(path.to_string());
            true
        },
    );
    first
}

/// Every template file whose contents include `query`, in `find_source_file`'s
/// walk order, as (absolute path, contents). Stops once `on_hit` returns true.
pub fn visit_source_files(
    query: &str,
    cwd: &str,
    extensions: &[String],
    skip_dirs: &[&str],
    file_filter: &dyn Fn(&str) -> bool,
    on_hit: &mut dyn FnMut(&str, &str) -> bool,
) {
    let mut seen: Vec<String> = Vec::new();
    for dir in SOURCE_SEARCH_DIRS {
        let abs_dir = jsp::join(&[cwd, dir]);
        if !exists(&abs_dir) {
            continue;
        }
        if walk(
            &abs_dir,
            query,
            extensions,
            skip_dirs,
            file_filter,
            &mut seen,
            0,
            on_hit,
        ) {
            return;
        }
    }
}

/// True once `on_hit` has asked to stop.
#[allow(clippy::too_many_arguments)]
fn walk(
    dir: &str,
    query: &str,
    extensions: &[String],
    skip: &[&str],
    file_filter: &dyn Fn(&str) -> bool,
    seen: &mut Vec<String>,
    depth: usize,
    on_hit: &mut dyn FnMut(&str, &str) -> bool,
) -> bool {
    if depth > MAX_DEPTH {
        return false;
    }
    let Ok(real) = std::fs::canonicalize(dir) else {
        return false;
    };
    let real = real.to_string_lossy().into_owned();
    if seen.contains(&real) {
        return false;
    }
    seen.push(real);
    let Some(entries) = read_dir_sorted(dir) else {
        return false;
    };
    for entry in &entries {
        if !entry.is_file {
            continue;
        }
        if !matches_template_extension(&entry.name, extensions) {
            continue;
        }
        let file_path = jsp::join(&[dir, &entry.name]);
        // Read before filtering: the filter may spawn git, and with text the
        // walk no longer stops at the first hit.
        let Some(text) = safe_read(&file_path) else {
            continue;
        };
        if !text.contains(query) || !file_filter(&file_path) {
            continue;
        }
        if on_hit(&file_path, &text) {
            return true;
        }
    }
    for entry in &entries {
        if !entry.is_dir {
            continue;
        }
        if skip.contains(&entry.name.as_str()) {
            continue;
        }
        let sub = jsp::join(&[dir, &entry.name]);
        if !is_dir(&sub) {
            continue;
        }
        if walk(
            &sub,
            query,
            extensions,
            skip,
            file_filter,
            seen,
            depth + 1,
            on_hit,
        ) {
            return true;
        }
    }
    false
}
