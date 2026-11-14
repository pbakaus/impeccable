//! The custom properties a project declares across its stylesheets: what a
//! `var(--danger)` in one component holds when the token lives in another
//! file (a `tokens.css`, a theme sheet). The text engine reads one file at a
//! time, so the CLI collects these once per checkout and hands them to every
//! file it scans there, the file's own package first.

use std::collections::HashMap;
use std::rc::Rc;

use impeccable_core::checks::css_scan::{collect_css_custom_props, CustomProps};

use crate::file_system::SKIP_DIRS;
use crate::jsp;
use crate::util::exists;

static COMMENT_RE: once_cell::sync::Lazy<regex::Regex> =
    once_cell::sync::Lazy::new(|| regex::Regex::new(r"(?s)/\*.*?\*/").expect("COMMENT_RE"));

static LINE_COMMENT_RE: once_cell::sync::Lazy<regex::Regex> =
    once_cell::sync::Lazy::new(|| regex::Regex::new(r#"(?m)(^|[^:"'(\\])//[^\n]*"#).expect("LINE_COMMENT_RE"));

const SHEET_EXTS: &[&str] = &[".css", ".scss", ".sass", ".less"];
/// Bounds on the walk: a token sheet is small, and a project with more
/// sheets or entries than this has its tokens among the ones read first or
/// not at all.
const MAX_SHEETS: usize = 2000;
const MAX_ENTRIES: usize = 100_000;
const MAX_SHEET_BYTES: u64 = 512 * 1024;
/// Build output and dependencies the source walk keeps out of, beside the
/// ones `detect` skips.
const SKIP_TOO: &[&str] = &["target", "vendor", "coverage", "out"];

/// The roots whose stylesheets a file's tokens come from, nearest first: its
/// package inside its git checkout, then the checkout (so a sibling app's
/// tokens never shadow its own, and a shared package's still resolve), else
/// the file's own directory. A package above the checkout is not the file's.
pub fn project_roots(file_path: &str) -> Vec<String> {
    let start = jsp::dirname(&jsp::resolve(file_path, &[]));
    let nearest = |marker: &str| {
        let mut dir = start.clone();
        loop {
            if exists(&jsp::join(&[&dir, marker])) {
                return Some(dir);
            }
            let parent = jsp::dirname(&dir);
            if parent == dir {
                return None;
            }
            dir = parent;
        }
    };
    let git = nearest(".git");
    let package = nearest("package.json").filter(|p| git.as_ref().map_or(true, |g| p.len() > g.len()));
    let mut roots: Vec<String> = package.into_iter().chain(git).collect();
    if roots.is_empty() {
        roots.push(start);
    }
    roots
}

/// Every custom property declared in the stylesheets under `root`, first
/// declaration wins (a light theme before its dark override, as the scan
/// reads one file).
pub fn collect_project_tokens(root: &str) -> CustomProps {
    let mut tokens = CustomProps::new();
    for sheet in stylesheets(root) {
        let Some(text) = read_sheet(&sheet) else {
            continue;
        };
        if !text.contains("--") {
            continue;
        }
        // A commented-out declaration is not the token's value: `/* */`
        // everywhere, `//` lines in the preprocessor dialects.
        let mut text = COMMENT_RE.replace_all(&text, " ").into_owned();
        if !sheet.to_ascii_lowercase().ends_with(".css") {
            text = LINE_COMMENT_RE.replace_all(&text, "$1").into_owned();
        }
        for (name, value) in collect_css_custom_props(&text).iter() {
            if !tokens.has(name) {
                tokens.set(name, value.clone());
            }
        }
    }
    tokens
}

/// A sheet's text: a regular file (not a link to a device or elsewhere),
/// read no further than the size bound.
fn read_sheet(path: &str) -> Option<String> {
    use std::io::Read;
    let meta = std::fs::symlink_metadata(path).ok()?;
    if !meta.is_file() || meta.len() > MAX_SHEET_BYTES {
        return None;
    }
    let mut bytes = Vec::new();
    std::fs::File::open(path).ok()?.take(MAX_SHEET_BYTES + 1).read_to_end(&mut bytes).ok()?;
    if bytes.len() as u64 > MAX_SHEET_BYTES {
        return None;
    }
    String::from_utf8(bytes).ok()
}

/// The stylesheets under `root`, breadth first so a shallow token sheet
/// comes before deep ones, within the walk's bounds.
fn stylesheets(root: &str) -> Vec<String> {
    let mut sheets = Vec::new();
    let mut queue = std::collections::VecDeque::from([root.to_string()]);
    let mut entries = 0usize;
    while let Some(dir) = queue.pop_front() {
        let Ok(read) = std::fs::read_dir(&dir) else { continue };
        let mut names: Vec<(String, bool)> = read
            .flatten()
            .map(|e| {
                let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
                (e.file_name().to_string_lossy().into_owned(), is_dir)
            })
            .collect();
        names.sort();
        for (name, is_dir) in names {
            entries += 1;
            if entries > MAX_ENTRIES || sheets.len() >= MAX_SHEETS {
                return sheets;
            }
            if is_dir {
                if !name.starts_with('.')
                    && !SKIP_DIRS.contains(&name.as_str())
                    && !SKIP_TOO.contains(&name.as_str())
                {
                    queue.push_back(jsp::join(&[&dir, &name]));
                }
            } else if SHEET_EXTS.iter().any(|ext| name.to_ascii_lowercase().ends_with(ext)) {
                sheets.push(jsp::join(&[&dir, &name]));
            }
        }
    }
    sheets
}

/// Project tokens, collected once per root and merged once per roots list.
#[derive(Default)]
pub struct ProjectTokens {
    by_root: HashMap<String, Rc<CustomProps>>,
    by_roots: HashMap<Vec<String>, Rc<CustomProps>>,
}

impl ProjectTokens {
    pub fn for_file(&mut self, file_path: &str) -> Rc<CustomProps> {
        let roots = project_roots(file_path);
        if let Some(merged) = self.by_roots.get(&roots) {
            return merged.clone();
        }
        let mut maps = Vec::new();
        for root in &roots {
            maps.push(
                self.by_root
                    .entry(root.clone())
                    .or_insert_with_key(|root| Rc::new(collect_project_tokens(root)))
                    .clone(),
            );
        }
        let merged = if maps.len() == 1 {
            maps.remove(0)
        } else {
            // The widest root's tokens with each nearer root's laid over
            // them, so the nearest wins. A nearer root sits inside the wider
            // one, so its names are already there and `set` replaces them in
            // place rather than growing the map.
            let mut merged = (*maps.pop().expect("two roots")).clone();
            for map in maps.iter().rev() {
                for (name, value) in map.iter() {
                    merged.set(name, value.clone());
                }
            }
            Rc::new(merged)
        };
        self.by_roots.insert(roots, merged.clone());
        merged
    }
}

/// Whether a file could hold a stripe whose colour is a token: the only
/// reader of project tokens, so files without one skip the walk.
pub fn may_need_tokens(content: &str) -> bool {
    content.contains("var(") && (content.contains("inset") || content.contains("border-"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_come_from_every_sheet_in_the_project() {
        let dir = std::env::temp_dir().join(format!("impeccable-tokens-{}", std::process::id()));
        let root = dir.to_string_lossy().into_owned();
        std::fs::create_dir_all(dir.join("design-system")).unwrap();
        std::fs::create_dir_all(dir.join("app/src")).unwrap();
        std::fs::write(dir.join("package.json"), "{}").unwrap();
        std::fs::write(
            dir.join("design-system/tokens.css"),
            "/* --mark-danger: #ddd; */\n:root { --mark-danger: oklch(63% .23 27); }\n[data-theme=dark] { --mark-danger: #f00; }\n",
        )
        .unwrap();
        std::fs::write(dir.join("design-system/theme.scss"), "// --mark-ok: #ddd;\n:root { --mark-ok: #16a34a; }\n").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink("/dev/zero", dir.join("design-system/zero.css")).unwrap();
        let file = dir.join("app/src/Table.svelte").to_string_lossy().into_owned();
        assert_eq!(project_roots(&file), vec![root]);
        let tokens = ProjectTokens::default().for_file(&file);
        assert_eq!(tokens.get("--mark-danger").map(String::as_str), Some("oklch(63% .23 27)"));
        assert_eq!(tokens.get("--mark-ok").map(String::as_str), Some("#16a34a"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn an_apps_own_tokens_beat_a_sibling_apps_and_shared_ones_still_resolve() {
        let dir = std::env::temp_dir().join(format!("impeccable-tokens-{}-monorepo", std::process::id()));
        let root = dir.to_string_lossy().into_owned();
        std::fs::create_dir_all(dir.join(".git")).unwrap();
        std::fs::create_dir_all(dir.join("packages/ui")).unwrap();
        std::fs::write(dir.join("packages/ui/tokens.css"), ":root { --shared: #16a34a; }\n").unwrap();
        for (app, danger) in [("a", "#dc2626"), ("b", "#2563eb")] {
            std::fs::create_dir_all(dir.join(format!("apps/{app}/src"))).unwrap();
            std::fs::write(dir.join(format!("apps/{app}/package.json")), "{}").unwrap();
            std::fs::write(dir.join(format!("apps/{app}/tokens.css")), format!(":root {{ --danger: {danger}; }}\n")).unwrap();
        }
        let file_a = dir.join("apps/a/src/Table.svelte").to_string_lossy().into_owned();
        let file_b = dir.join("apps/b/src/Table.svelte").to_string_lossy().into_owned();
        assert_eq!(project_roots(&file_b), vec![dir.join("apps").join("b").to_string_lossy().into_owned(), root]);
        let mut project = ProjectTokens::default();
        let tokens = project.for_file(&file_b);
        assert_eq!(tokens.get("--danger").map(String::as_str), Some("#2563eb"));
        assert_eq!(tokens.get("--shared").map(String::as_str), Some("#16a34a"));
        let tokens = project.for_file(&file_a);
        assert_eq!(tokens.get("--danger").map(String::as_str), Some("#dc2626"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_package_above_the_checkout_is_not_a_root() {
        let dir = std::env::temp_dir().join(format!("impeccable-tokens-{}-above", std::process::id()));
        std::fs::create_dir_all(dir.join("site/.git")).unwrap();
        std::fs::write(dir.join("package.json"), "{}").unwrap();
        let file = dir.join("site/templates/table.html").to_string_lossy().into_owned();
        assert_eq!(project_roots(&file), vec![dir.join("site").to_string_lossy().into_owned()]);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
