//! `impeccable detect --before` / `--kept` (#1291): a page's wiring, the
//! markup a redesign can drop without changing a pixel (a field's `name`, an
//! `id` a script queries, a test hook, an inline handler, a link's `href`).
//!
//! `--before` records an inventory of each static HTML file under
//! `.impeccable/wiring/`; `--kept` takes the inventory again and compares.
//! An item present before and gone now fails the check; a new item is
//! listed for the agent to justify. Headings and image `alt` text are
//! content, not wiring: they are compared too, but never fail.
//!
//! The inventory itself is read by the static HTML engine
//! ([`crate::engines::HtmlEngine::wiring_inventory`], crates/html); this
//! module owns the item keys' shared helpers, the comparison, the saved file
//! and the CLI output, so all of it is testable without a parser.

use std::collections::BTreeMap;

use impeccable_common::Io;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::engines::{Engines, EngineError};
use crate::file_system::is_html_path;
use crate::jsp;

/// The saved file's schema version. A file with another version is not
/// compared (`--kept` exits 2 and asks for a new `--before`).
pub const INVENTORY_VERSION: u64 = 1;

/// Where inventories live, relative to the working directory.
pub const WIRING_DIR: &str = ".impeccable/wiring";

/// One page's inventory: each item a stable key string. Duplicates are kept
/// (two links to `/` are two items), and both lists are sorted.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct WiringInventory {
    /// Links, forms, fields, buttons, inline handlers, ids, test hooks,
    /// scripts and label targets. A missing one fails `--kept`.
    pub wiring: Vec<String>,
    /// Headings and image alt text. Compared, never failing.
    pub content: Vec<String>,
}

impl WiringInventory {
    /// Sort both lists so the saved file and the comparison do not depend on
    /// document order.
    pub fn sorted(mut self) -> Self {
        self.wiring.sort();
        self.content.sort();
        self
    }
}

/// What `--kept` found for one page. Every list is sorted and keeps
/// duplicates: a link that appeared twice and now appears once is one
/// missing item.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WiringDiff {
    pub missing: Vec<String>,
    pub added: Vec<String>,
    pub content_gone: Vec<String>,
    pub content_added: Vec<String>,
}

/// Compare two inventories as multisets.
pub fn diff(before: &WiringInventory, after: &WiringInventory) -> WiringDiff {
    WiringDiff {
        missing: minus(&before.wiring, &after.wiring),
        added: minus(&after.wiring, &before.wiring),
        content_gone: minus(&before.content, &after.content),
        content_added: minus(&after.content, &before.content),
    }
}

/// The items of `a` left after taking away one occurrence per item of `b`.
fn minus(a: &[String], b: &[String]) -> Vec<String> {
    let mut left: BTreeMap<&str, usize> = BTreeMap::new();
    for item in b {
        *left.entry(item.as_str()).or_default() += 1;
    }
    let mut out = Vec::new();
    for item in a {
        match left.get_mut(item.as_str()) {
            Some(n) if *n > 0 => *n -= 1,
            _ => out.push(item.clone()),
        }
    }
    out.sort();
    out
}

/// An attribute value as it appears in an item key: JSON-quoted, so a value
/// holding spaces or quotes stays one unambiguous token.
pub fn quote(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

/// Collapse whitespace runs to one space and trim, so re-indenting a handler
/// or a heading is not a change.
pub fn collapse_ws(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// A short, stable hash of a body of text (an inline handler or script),
/// whitespace-collapsed first: 8 hex digits of FNV-1a 64. Hand-rolled because
/// `DefaultHasher` may change between Rust releases, and saved inventories
/// must compare across them.
pub fn short_hash(text: &str) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in collapse_ws(text).bytes() {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{:08x}", (h >> 32) as u32 ^ (h as u32))
}

/// The project inventories are kept for: the nearest directory from `cwd` up
/// that holds `.git`, `package.json` or `.impeccable` (the design-system
/// discovery markers), never `home` itself (whose `.impeccable` is the
/// user's), else `cwd`. A run from a subdirectory then shares the project's
/// inventories and never starts a new `.impeccable/` there, which would
/// become a design-system boundary for the files under it.
pub fn project_root(cwd: &str, home: &str) -> String {
    let mut dir = jsp::resolve(cwd, &["."]);
    loop {
        if !home.is_empty() && dir == jsp::resolve(cwd, &[home]) {
            break;
        }
        if crate::design_system::PROJECT_ROOT_MARKERS
            .iter()
            .any(|m| std::path::Path::new(&jsp::join(&[&dir, m])).exists())
        {
            return dir;
        }
        let parent = jsp::dirname(&dir);
        if parent == dir {
            break;
        }
        dir = parent;
    }
    jsp::resolve(cwd, &["."])
}

/// The target's path (resolved against `cwd`) relative to the project root,
/// with `/` separators. `page.html`, `./page.html` and the absolute path all
/// give the same one, and so does `web/page.html` from the root.
pub fn project_relative(cwd: &str, root: &str, target: &str) -> String {
    let resolved = jsp::resolve(cwd, &[target]);
    let rel = jsp::relative(cwd, root, &resolved);
    rel.replace('\\', "/")
}

fn roots(io: &Io) -> (String, String) {
    let cwd = io.cwd.to_string_lossy().into_owned();
    let home = io.home().map(|h| h.to_string_lossy().into_owned()).unwrap_or_default();
    let root = project_root(&cwd, &home);
    (cwd, root)
}

/// The saved file's name for a project-relative path: the path's letters and
/// digits joined by `-`, plus a hash of the path itself, so `a/b.html` and
/// `a-b.html` never share a file.
pub fn inventory_slug(rel: &str) -> String {
    let mut slug = String::new();
    let mut dash = false;
    for c in rel.chars() {
        if c.is_ascii_alphanumeric() {
            if dash && !slug.is_empty() {
                slug.push('-');
            }
            slug.push(c.to_ascii_lowercase());
            dash = false;
        } else {
            dash = true;
        }
    }
    if slug.len() > 80 {
        slug.truncate(80);
    }
    if slug.is_empty() {
        slug.push_str("page");
    }
    format!("{slug}-{}", short_hash(rel))
}

/// The inventory file for a project-relative path, relative to cwd.
pub fn inventory_path(rel: &str) -> String {
    format!("{WIRING_DIR}/{}.json", inventory_slug(rel))
}

#[derive(Debug, Serialize, Deserialize)]
struct SavedInventory {
    version: u64,
    target: String,
    wiring: Vec<String>,
    content: Vec<String>,
}

/// The saved file's text.
pub fn serialize_inventory(rel: &str, inventory: &WiringInventory) -> String {
    let saved = SavedInventory {
        version: INVENTORY_VERSION,
        target: rel.to_string(),
        wiring: inventory.wiring.clone(),
        content: inventory.content.clone(),
    };
    format!("{}\n", serde_json::to_string_pretty(&saved).unwrap_or_default())
}

/// Parse a saved file; `Err` says why it cannot be compared.
pub fn parse_inventory(text: &str) -> Result<WiringInventory, String> {
    let value: Value = serde_json::from_str(text).map_err(|_| "it is not valid JSON".to_string())?;
    let version = value.get("version").and_then(Value::as_u64);
    if version != Some(INVENTORY_VERSION) {
        return Err(match version {
            Some(v) => format!("it has schema version {v}, this build reads {INVENTORY_VERSION}"),
            None => "it has no schema version".to_string(),
        });
    }
    let saved: SavedInventory =
        serde_json::from_value(value).map_err(|_| "it does not hold a wiring inventory".to_string())?;
    Ok(WiringInventory { wiring: saved.wiring, content: saved.content }.sorted())
}

/// Which of the two modes a run is in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Before,
    Kept,
}

/// The usage errors both modes share, checked before any file is read.
pub fn usage_error(mode: Mode, targets: &[String], other: &[&str]) -> Option<String> {
    let flag = match mode {
        Mode::Before => "--before",
        Mode::Kept => "--kept",
    };
    if let Some(bad) = other.first() {
        return Some(format!("Error: {flag} works on local HTML files and cannot be used with {bad}\n"));
    }
    if targets.is_empty() {
        return Some(format!("Error: {flag} needs one or more local .html files, e.g. detect {flag} index.html\n"));
    }
    None
}

/// Why a target cannot be inventoried at all (before it is read).
fn unsupported_target(cwd: &str, target: &str) -> Option<String> {
    let lower = target.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("file:") {
        return Some("URL targets are not supported yet; pass the local .html file".to_string());
    }
    let resolved = jsp::resolve(cwd, &[target]);
    if std::path::Path::new(&resolved).is_dir() {
        return Some("it is a directory; pass each .html file".to_string());
    }
    if !is_html_path(target) {
        return Some("only static .html and .htm files are inventoried".to_string());
    }
    None
}

fn plural(n: usize, one: &str, many: &str) -> String {
    format!("{n} {}", if n == 1 { one } else { many })
}

/// Item lines with repeats folded: `  MISSING  link href="/" (x2)`.
fn item_lines(label: &str, items: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < items.len() {
        let mut j = i + 1;
        while j < items.len() && items[j] == items[i] {
            j += 1;
        }
        let count = j - i;
        let suffix = if count > 1 { format!(" (x{count})") } else { String::new() };
        out.push(format!("{label}{}{suffix}\n", items[i]));
        i = j;
    }
    out
}

/// `detect --before`: save each target's inventory. Exit 0 when every one was
/// saved, 1 when any could not be.
pub fn run_before(targets: &[String], json_mode: bool, io: &mut Io, engines: &Engines) -> i32 {
    let (cwd, root) = roots(io);
    let mut failed = false;
    let mut results: Vec<Value> = Vec::new();
    for target in targets {
        let rel = project_relative(&cwd, &root, target);
        let inv_rel = inventory_path(&rel);
        let outcome = read_inventory(&cwd, target, engines).and_then(|inventory| {
            let dir = jsp::resolve(&root, &[WIRING_DIR]);
            impeccable_common::git::ensure_dir_ignored(&dir, &["*"]);
            let file = jsp::resolve(&root, &[&inv_rel]);
            std::fs::create_dir_all(&dir)
                .and_then(|_| std::fs::write(&file, serialize_inventory(&rel, &inventory)))
                .map_err(|e| format!("cannot write {inv_rel}: {e}"))?;
            Ok(inventory)
        });
        match outcome {
            Ok(inventory) => {
                if json_mode {
                    results.push(json!({
                        "file": rel,
                        "status": "saved",
                        "inventory": inv_rel,
                        "wiring": inventory.wiring.len(),
                        "content": inventory.content.len(),
                    }));
                } else {
                    io.err(&format!(
                        "Saved the wiring of {rel} to {inv_rel} ({}, {}).\n",
                        plural(inventory.wiring.len(), "wiring item", "wiring items"),
                        plural(inventory.content.len(), "content item", "content items"),
                    ));
                }
            }
            Err(message) => {
                failed = true;
                if json_mode {
                    let file = if unsupported_target(&cwd, target).is_some() { target.clone() } else { rel };
                    results.push(json!({ "file": file, "status": "error", "error": message }));
                } else {
                    io.err(&format!("Error: cannot record the wiring of {target}: {message}\n"));
                }
            }
        }
    }
    if json_mode {
        let out = json!({ "mode": "before", "targets": results });
        io.out(&format!("{}\n", serde_json::to_string_pretty(&out).unwrap_or_default()));
    }
    i32::from(failed)
}

fn read_inventory(cwd: &str, target: &str, engines: &Engines) -> Result<WiringInventory, String> {
    if let Some(why) = unsupported_target(cwd, target) {
        return Err(why);
    }
    let resolved = jsp::resolve(cwd, &[target]);
    engines
        .html
        .wiring_inventory(&resolved)
        .map(WiringInventory::sorted)
        .map_err(|EngineError { message }| message)
}

/// `detect --kept`: compare each target with its saved inventory. Exit 2 when
/// any target could not be compared (no saved inventory, an unreadable one,
/// or an unreadable page), else 1 when any wiring item is missing, else 0.
pub fn run_kept(targets: &[String], json_mode: bool, io: &mut Io, engines: &Engines) -> i32 {
    let (cwd, root) = roots(io);
    let mut cannot_compare = false;
    let mut missing_total = 0usize;
    let mut files_missing = 0usize;
    let mut any_new = false;
    let mut compared = 0usize;
    let mut results: Vec<Value> = Vec::new();
    for target in targets {
        if let Some(why) = unsupported_target(&cwd, target) {
            cannot_compare = true;
            let message = format!("cannot read the wiring of {target}: {why}");
            if json_mode {
                results.push(json!({ "file": target, "status": "error", "error": message }));
            } else {
                io.err(&format!("Error: {message}\n"));
            }
            continue;
        }
        let rel = project_relative(&cwd, &root, target);
        let inv_rel = inventory_path(&rel);
        let saved = match std::fs::read_to_string(jsp::resolve(&root, &[&inv_rel])) {
            Ok(text) => parse_inventory(&text).map_err(|why| {
                (
                    "bad-inventory",
                    format!("the saved wiring in {inv_rel} cannot be compared ({why}); run detect --before {rel} again"),
                )
            }),
            Err(_) => Err((
                "no-inventory",
                format!("no saved wiring for {rel}; run detect --before {rel} first"),
            )),
        };
        let now = saved.and_then(|before| {
            read_inventory(&cwd, target, engines)
                .map(|after| (before, after))
                .map_err(|m| ("error", format!("cannot read the wiring of {target}: {m}")))
        });
        let (before, after) = match now {
            Ok(pair) => pair,
            Err((status, message)) => {
                cannot_compare = true;
                if json_mode {
                    results.push(json!({ "file": rel, "status": status, "inventory": inv_rel, "error": message }));
                } else {
                    io.err(&format!("Error: {message}\n"));
                }
                continue;
            }
        };
        compared += 1;
        let d = diff(&before, &after);
        missing_total += d.missing.len();
        if !d.missing.is_empty() {
            files_missing += 1;
        }
        any_new |= !d.added.is_empty();
        if json_mode {
            results.push(json!({
                "file": rel,
                "status": if d.missing.is_empty() { "kept" } else { "missing" },
                "inventory": inv_rel,
                "wiring": { "before": before.wiring.len(), "after": after.wiring.len() },
                "missing": d.missing,
                "new": d.added,
                "content": { "gone": d.content_gone, "new": d.content_added },
            }));
            continue;
        }
        let mut head = if d.missing.is_empty() {
            format!("{rel}: wiring kept ({})", plural(before.wiring.len(), "item", "items"))
        } else {
            format!(
                "{rel}: {} missing of {}",
                plural(d.missing.len(), "wiring item", "wiring items"),
                before.wiring.len()
            )
        };
        if !d.added.is_empty() {
            head.push_str(&format!(", {} new", d.added.len()));
        }
        io.err(&format!("{head}.\n"));
        for line in item_lines("  MISSING  ", &d.missing) {
            io.err(&line);
        }
        for line in item_lines("  NEW      ", &d.added) {
            io.err(&line);
        }
        if !d.content_gone.is_empty() || !d.content_added.is_empty() {
            io.err("  Content changes (informational, never a failure):\n");
            for line in item_lines("    gone   ", &d.content_gone) {
                io.err(&line);
            }
            for line in item_lines("    new    ", &d.content_added) {
                io.err(&line);
            }
        }
    }
    let code = if cannot_compare {
        2
    } else if missing_total > 0 {
        1
    } else {
        0
    };
    if json_mode {
        let out = json!({ "mode": "kept", "ok": code == 0, "targets": results });
        io.out(&format!("{}\n", serde_json::to_string_pretty(&out).unwrap_or_default()));
        return code;
    }
    if any_new {
        io.err("\nNew items are not failures. Justify each one in the handoff: a renamed field shows as one missing and one new.\n");
    }
    if missing_total > 0 {
        io.err(&format!(
            "\nWiring check failed: {} missing in {} of {}.\n",
            plural(missing_total, "item", "items"),
            files_missing,
            plural(compared, "file", "files"),
        ));
    } else if compared > 0 && !cannot_compare {
        io.err(&format!("\nWiring kept in {}.\n", plural(compared, "file", "files")));
    }
    code
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inv(wiring: &[&str], content: &[&str]) -> WiringInventory {
        WiringInventory {
            wiring: wiring.iter().map(|s| s.to_string()).collect(),
            content: content.iter().map(|s| s.to_string()).collect(),
        }
        .sorted()
    }

    #[test]
    fn an_unchanged_page_has_nothing_missing() {
        let a = inv(&["link href=\"/\"", "id \"main\""], &["heading h1 \"Hi\""]);
        assert_eq!(diff(&a, &a.clone()), WiringDiff::default());
    }

    #[test]
    fn a_missing_field_is_missing() {
        let before = inv(&["field input name=\"email\" type=\"email\" required", "link href=\"/\""], &[]);
        let after = inv(&["link href=\"/\""], &[]);
        let d = diff(&before, &after);
        assert_eq!(d.missing, vec!["field input name=\"email\" type=\"email\" required"]);
        assert!(d.added.is_empty());
    }

    #[test]
    fn a_new_item_is_only_new() {
        let before = inv(&["link href=\"/\""], &[]);
        let after = inv(&["link href=\"/\"", "test-hook data-testid=\"cta\""], &[]);
        let d = diff(&before, &after);
        assert!(d.missing.is_empty());
        assert_eq!(d.added, vec!["test-hook data-testid=\"cta\""]);
    }

    #[test]
    fn a_renamed_field_is_missing_and_new() {
        let before = inv(&["field input name=\"email\" type=\"email\""], &[]);
        let after = inv(&["field input name=\"mail\" type=\"email\""], &[]);
        let d = diff(&before, &after);
        assert_eq!(d.missing, vec!["field input name=\"email\" type=\"email\""]);
        assert_eq!(d.added, vec!["field input name=\"mail\" type=\"email\""]);
    }

    #[test]
    fn a_changed_handler_body_counts() {
        let before = inv(&[&format!("handler button onclick #{}", short_hash("save()"))], &[]);
        let after = inv(&[&format!("handler button onclick #{}", short_hash("save(true)"))], &[]);
        let d = diff(&before, &after);
        assert_eq!(d.missing.len(), 1);
        assert_eq!(d.added.len(), 1);
        // Re-indenting the same body is not a change.
        assert_eq!(short_hash("save( a,\n   b )"), short_hash("  save( a, b )  "));
    }

    #[test]
    fn a_dropped_duplicate_is_missing() {
        let before = inv(&["link href=\"/\"", "link href=\"/\""], &[]);
        let after = inv(&["link href=\"/\""], &[]);
        assert_eq!(diff(&before, &after).missing, vec!["link href=\"/\""]);
    }

    #[test]
    fn content_changes_are_kept_apart() {
        let before = inv(&[], &["heading h2 \"Pricing\""]);
        let after = inv(&[], &["heading h2 \"Plans\""]);
        let d = diff(&before, &after);
        assert!(d.missing.is_empty() && d.added.is_empty());
        assert_eq!(d.content_gone, vec!["heading h2 \"Pricing\""]);
        assert_eq!(d.content_added, vec!["heading h2 \"Plans\""]);
    }

    #[test]
    fn paths_and_slugs_are_stable() {
        let cwd = "/work/site";
        assert_eq!(project_relative(cwd, cwd, "page.html"), "page.html");
        assert_eq!(project_relative(cwd, cwd, "./page.html"), "page.html");
        assert_eq!(project_relative(cwd, cwd, "/work/site/page.html"), "page.html");
        assert_eq!(project_relative(cwd, cwd, "src/../page.html"), "page.html");
        assert_eq!(project_relative("/work/site/web", cwd, "page.html"), "web/page.html");
        let a = inventory_slug("a/b.html");
        let b = inventory_slug("a-b.html");
        assert!(a.starts_with("a-b-html-") && b.starts_with("a-b-html-"));
        assert_ne!(a, b);
        assert_eq!(inventory_slug("a/b.html"), a);
    }

    #[test]
    fn a_saved_inventory_round_trips() {
        let a = inv(&["link href=\"/\"", "id \"x\""], &["image alt=\"Logo\""]);
        assert_eq!(parse_inventory(&serialize_inventory("p.html", &a)), Ok(a));
        assert!(parse_inventory("{\"version\": 99, \"wiring\": [], \"content\": []}").is_err());
        assert!(parse_inventory("nope").is_err());
    }
}
