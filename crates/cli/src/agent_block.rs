//! The one Impeccable block in an agent's user-level rule file (`CLAUDE.md` or
//! `AGENTS.md`), REN-2056. Each switch that is on adds one fixed line, in catalog
//! order, between `<!-- impeccable start -->` and `<!-- impeccable end -->`. The lines
//! are compiled in: whatever later says which switches are on (the repo settings page)
//! never supplies text. The block never holds the person's rules, their taste or any
//! id, and nothing outside the markers is ever changed. It replaces the separate
//! taste block, `<!-- impeccable:taste -->`, which the first write here folds in.
use std::fs;
use std::path::{Path, PathBuf};

pub(crate) const START: &str = "<!-- impeccable start -->";
pub(crate) const END: &str = "<!-- impeccable end -->";
/// The taste block before REN-2056: read as the taste switch, removed on the next write.
const OLD_TASTE: (&str, &str) = ("<!-- impeccable:taste -->", "<!-- /impeccable:taste -->");

/// Ask through Loop rather than in a terminal.
pub(crate) const LOOP: &str = "When you need a person's decision or input, use needs_you.post (Impeccable) instead of asking in chat or a built-in question tool. If needs_you says Loop isn't connected, ask normally.";
/// Matches the MCP server's own instruction text.
pub(crate) const TASTE: &str = "Impeccable Taste: before design or UI work, call the impeccable MCP's taste.get once per task (pass since: the rev it last returned, only while those rules are still in your context) and follow its rules; say \"Applied your taste: <rule>\" when one shaped a choice. When the person makes or corrects a design call, record it with taste.note and the lasting rule.";

/// Every switch, its label for the settings page, and its line, in the order the lines
/// appear. The repo settings page mirrors this (`impeccable switches --catalog`), pinned
/// by a test there; ids are what the service stores.
pub(crate) const CATALOG: [(&str, &str, &str); 9] = [
    ("use", "Use Impeccable for design work", "For design or UI work, use the impeccable skill (/impeccable)."),
    ("taste", "Follow my taste", TASTE),
    ("wide", "Go wide before building new UI", "New UI: show three or four quick directions that differ in idea, let the person pick, then build only that one."),
    ("browser", "Check UI in a real browser", "Before calling UI done, check it in a real browser at 1440 and 390 px wide."),
    ("system", "Use the design system", "Use DESIGN.md's tokens and components, not one-off colors, sizes or components."),
    ("critique", "Critique before a pull request", "Before a pull request that changes UI, run /impeccable critique on those pages and fix what it raises."),
    ("loop", "Ask through Loop", LOOP),
    ("voice", "Write in the product's voice", "Write interface copy in the voice PRODUCT.md describes."),
    ("a11y", "Meet WCAG 2.2 AA", "Keep UI at WCAG 2.2 AA: contrast, visible focus, keyboard use, labelled controls."),
];

type Result<T> = std::result::Result<T, String>;

/// Where a block sits in `text`: the start of its start marker to the end of its end
/// marker. Markers that are duplicated, unbalanced, out of order or not on lines of
/// their own are an error, and the file is then left as it is.
fn span(text: &str, start: &str, end: &str) -> Result<Option<(usize, usize)>> {
    let starts = text.matches(start).count();
    let ends = text.matches(end).count();
    let own_line = |m: &str| text.lines().filter(|l| l.trim_end_matches('\r') == m).count();
    if starts == 0 && ends == 0 {
        return Ok(None);
    }
    if starts != 1 || ends != 1 || own_line(start) != 1 || own_line(end) != 1 {
        return Err("its Impeccable markers are duplicated or unbalanced".into());
    }
    let (a, e) = (text.find(start).unwrap(), text.find(end).unwrap());
    if a >= e {
        return Err("its Impeccable markers are out of order".into());
    }
    Ok(Some((a, e + end.len())))
}

/// The lines between the block's markers that aren't a switch's: kept as they are,
/// after the switches' lines, so a newer engine's switch survives an older one's write.
fn other_lines(text: &str) -> Result<Vec<String>> {
    let Some((a, b)) = span(text, START, END)? else { return Ok(vec![]) };
    Ok(text[a + START.len()..b - END.len()]
        .lines()
        .map(|l| l.trim_end_matches('\r'))
        .filter(|l| !l.trim().is_empty() && !CATALOG.iter().any(|(_, _, line)| line == l))
        .map(str::to_string)
        .collect())
}

/// The switches on in `text`: each catalog line inside the block, plus taste while the
/// old taste block is still there.
pub(crate) fn switches(text: &str) -> Result<Vec<&'static str>> {
    let mut on = Vec::new();
    if let Some((a, b)) = span(text, START, END)? {
        let body: Vec<&str> = text[a..b].lines().map(|l| l.trim_end_matches('\r')).collect();
        on.extend(CATALOG.iter().filter(|(_, _, line)| body.contains(line)).map(|(id, _, _)| *id));
    }
    if span(text, OLD_TASTE.0, OLD_TASTE.1)?.is_some() && !on.contains(&"taste") {
        on.push("taste");
    }
    Ok(on)
}

/// `text` without the block between `start` and `end`, nor the line break after it and
/// one blank line before it, so an append followed by a removal gives back the bytes
/// that were there. `None` when there is no such block.
fn remove(text: &str, start: &str, end: &str) -> Result<Option<String>> {
    let Some((a, b)) = span(text, start, end)? else {
        return Ok(None);
    };
    let mut after = &text[b..];
    after = after.strip_prefix("\r\n").or_else(|| after.strip_prefix('\n')).unwrap_or(after);
    // One blank line before the block goes with it, wherever it stands, as with the
    // agents engine's own block: the two may end up in either order in the same file.
    let mut before = &text[..a];
    for sep in ["\r\n\r\n", "\n\n"] {
        if before.ends_with(sep) {
            before = &before[..before.len() - sep.len() / 2];
            break;
        }
    }
    // At the top of the file (nothing but line breaks before it), those and the blank
    // line after it go.
    if before.chars().all(|c| c == '\n' || c == '\r') {
        before = "";
        after = after.strip_prefix("\r\n").or_else(|| after.strip_prefix('\n')).unwrap_or(after);
    }
    Ok(Some(format!("{before}{after}")))
}

/// `text` with exactly the switches `on` (plus any lines it doesn't know): the block
/// replaced in place, appended after a blank line, or taken out when nothing is left;
/// and the old taste block folded in.
pub(crate) fn with_switches(text: &str, on: &[&str]) -> Result<String> {
    let nl = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let others = other_lines(text)?;
    let mut lines: Vec<String> = CATALOG
        .iter()
        .filter(|(id, _, _)| on.contains(id))
        .map(|(_, _, l)| l.to_string())
        .collect();
    lines.extend(others);
    let block = format!("{START}{nl}{}{nl}{END}", lines.join(nl));
    // The old taste block becomes the new block where it stands, unless a new block is
    // already there, which then takes its place.
    let (old, new) = (span(text, OLD_TASTE.0, OLD_TASTE.1)?, span(text, START, END)?);
    if let (Some((a, b)), None, false) = (old, new, lines.is_empty()) {
        return Ok(format!("{}{block}{}", &text[..a], &text[b..]));
    }
    let mut out = remove(text, OLD_TASTE.0, OLD_TASTE.1)?.unwrap_or_else(|| text.to_string());
    if lines.is_empty() {
        return Ok(remove(&out, START, END)?.unwrap_or(out));
    }
    if let Some((a, b)) = span(&out, START, END)? {
        return Ok(format!("{}{block}{}", &out[..a], &out[b..]));
    }
    if !out.is_empty() {
        if !out.ends_with('\n') {
            out.push_str(nl);
        }
        out.push_str(nl);
    }
    out.push_str(&block);
    out.push_str(nl);
    Ok(out)
}

/// The file a write lands in: the target of a symlink at `path` (a rule file kept in
/// a dotfiles folder stays a link), else `path`.
fn physical(path: &Path) -> Result<PathBuf> {
    match fs::symlink_metadata(path) {
        Ok(m) if m.file_type().is_symlink() => {
            fs::canonicalize(path).map_err(|_| format!("{} is a broken symlink", path.display()))
        }
        Ok(m) if !m.is_file() => Err(format!("{} isn't a plain file", path.display())),
        _ => Ok(path.to_path_buf()),
    }
}

/// Write `bytes` whole. An existing file is staged beside itself, readable only by
/// its owner until it takes the file's own mode, and renamed over it; a missing file is
/// created in place with the usual mode (0666 less the umask).
fn write(path: &Path, bytes: &[u8]) -> Result<()> {
    use std::io::Write;
    let path = physical(path)?;
    let parent = path.parent().ok_or("no parent folder")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let Some(mode) = fs::metadata(&path).ok().map(|m| m.permissions()) else {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|e| e.to_string())?;
        return file.write_all(bytes).map_err(|e| e.to_string());
    };
    let name = path.file_name().ok_or("no file name")?.to_string_lossy();
    let staged = parent.join(format!(".{name}.impeccable-{}", std::process::id()));
    let _ = fs::remove_file(&staged);
    let mut open = fs::OpenOptions::new();
    open.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut open, 0o600);
    let done = open
        .open(&staged)
        .and_then(|mut f| f.write_all(bytes))
        .and_then(|()| fs::set_permissions(&staged, mode))
        .and_then(|()| fs::rename(&staged, &path));
    done.map_err(|e| {
        let _ = fs::remove_file(&staged);
        e.to_string()
    })
}

fn read(path: &Path) -> Result<Option<String>> {
    match fs::read(path) {
        Ok(b) => String::from_utf8(b)
            .map(Some)
            .map_err(|_| format!("{} isn't UTF-8 text", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Whether switch `id` is on in `path`. An unreadable file reads as off.
pub(crate) fn present(path: &Path, id: &str) -> bool {
    read(path).ok().flatten().is_some_and(|t| switches(&t).is_ok_and(|on| on.contains(&id)))
}

/// Whether `path` can take the block: readable text with no broken markers.
pub(crate) fn writable(path: &Path) -> Result<()> {
    switches(&read(path)?.unwrap_or_default()).map(|_| ())
}

/// Turn switch `id` on or off in `path`, creating the file only to turn one on.
/// `Ok(false)` when the file already said so and nothing was written.
pub(crate) fn set(path: &Path, id: &str, on: bool) -> Result<bool> {
    let Some(&(id, _, _)) = CATALOG.iter().find(|(i, _, _)| *i == id) else {
        return Err(format!("{id} isn't a switch"));
    };
    let before = read(path)?;
    if before.is_none() && !on {
        return Ok(false);
    }
    let before = before.unwrap_or_default();
    let mut ids = switches(&before)?;
    ids.retain(|i| *i != id);
    if on {
        ids.push(id);
    }
    let after = with_switches(&before, &ids)?;
    if after == before {
        return Ok(false);
    }
    write(path, after.as_bytes())?;
    Ok(true)
}

/// `impeccable switches [--catalog]`: which switches are on in each user-level rule
/// file this machine's agents read, or (`--catalog`) the catalog as JSON for the
/// settings page to mirror.
pub(crate) fn run(args: &[String], io: &mut impeccable_common::Io) -> i32 {
    match args.first().map(String::as_str) {
        Some("--catalog") if args.len() == 1 => {
            let rows: Vec<serde_json::Value> = CATALOG
                .iter()
                .map(|(id, label, line)| serde_json::json!({ "id": id, "label": label, "line": line }))
                .collect();
            io.out(&format!("{}\n", serde_json::json!({ "schema": 1, "start": START, "end": END, "switches": rows })));
            0
        }
        None => {
            let home = std::path::PathBuf::from(impeccable_context::util::homedir(&io.env));
            let var = |k: &str| io.env.get(k).filter(|v| !v.is_empty()).map(std::path::PathBuf::from);
            let codex = var("CODEX_HOME").unwrap_or_else(|| home.join(".codex"));
            let codex = [codex.join("AGENTS.override.md"), codex.join("AGENTS.md")]
                .into_iter()
                .find(|p| p.exists())
                .unwrap_or_else(|| codex.join("AGENTS.md"));
            let claude = var("CLAUDE_CONFIG_DIR").unwrap_or_else(|| home.join(".claude")).join("CLAUDE.md");
            for (name, file) in [("Claude Code", claude), ("Codex", codex)] {
                let shown = file.strip_prefix(&home).map_or_else(|_| file.display().to_string(), |r| format!("~/{}", r.display()));
                let on = match read(&file) {
                    Ok(Some(t)) => switches(&t).map(|ids| if ids.is_empty() { "none".to_string() } else { ids.join(", ") }),
                    Ok(None) => Ok("none".to_string()),
                    Err(e) => Err(e),
                };
                match on {
                    Ok(on) => io.out(&format!("{name} ({shown}): {on}\n")),
                    Err(e) => io.out(&format!("{name} ({shown}): unreadable, {e}\n")),
                }
            }
            0
        }
        _ => {
            io.err("Usage: impeccable switches [--catalog]\n");
            2
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appending_then_removing_gives_back_the_same_bytes() {
        for original in ["", "mine\n", "mine", "a\n\nb\n", "a\r\nb\r\n"] {
            let with = with_switches(original, &["taste"]).unwrap();
            assert_eq!(with.matches(START).count(), 1, "{original:?}");
            assert_eq!(with_switches(&with, &["taste"]).unwrap(), with, "idempotent for {original:?}");
            let back = with_switches(&with, &[]).unwrap();
            let expected = if original == "mine" { "mine\n" } else { original };
            assert_eq!(back, expected, "{original:?}");
        }
    }

    #[test]
    fn lines_follow_the_catalog_order_whatever_the_order_asked() {
        let t = with_switches("", &["loop", "taste"]).unwrap();
        assert_eq!(t, format!("{START}\n{TASTE}\n{LOOP}\n{END}\n"));
        assert_eq!(switches(&t).unwrap(), vec!["taste", "loop"]);
        let only = with_switches(&t, &["taste"]).unwrap();
        assert_eq!(only, format!("{START}\n{TASTE}\n{END}\n"));
    }

    #[test]
    fn the_old_taste_block_is_read_as_on_and_folded_in() {
        // Catches (REN-2056): a machine with the pre-REN-2056 taste block losing its taste,
        // or keeping both blocks, on the first write of the single block.
        let old = format!("mine\n\n{}\nold wording\n{}\n", OLD_TASTE.0, OLD_TASTE.1);
        assert_eq!(switches(&old).unwrap(), vec!["taste"]);
        let mut on = switches(&old).unwrap();
        on.push("loop");
        let new = with_switches(&old, &on).unwrap();
        assert_eq!(new, format!("mine\n\n{START}\n{TASTE}\n{LOOP}\n{END}\n"));
        // Where it stands, between the person's own lines.
        let mid = format!("top\n{}\nold\n{}\nbottom\n", OLD_TASTE.0, OLD_TASTE.1);
        assert_eq!(with_switches(&mid, &["taste"]).unwrap(), format!("top\n{START}\n{TASTE}\n{END}\nbottom\n"));
        assert!(!new.contains(OLD_TASTE.0));
    }

    #[test]
    fn a_line_this_engine_doesnt_know_survives_its_write() {
        let t = format!("{START}\n{TASTE}\nA newer switch's line.\n{END}\n");
        let out = with_switches(&t, &["loop", "taste"]).unwrap();
        assert_eq!(out, format!("{START}\n{TASTE}\n{LOOP}\nA newer switch's line.\n{END}\n"));
    }

    #[test]
    fn a_block_between_two_others_takes_one_blank_line_with_it() {
        let text = format!("mine\n\n{START}\n{TASTE}\n{END}\n\n<!-- other -->\n");
        assert_eq!(with_switches(&text, &[]).unwrap(), "mine\n\n<!-- other -->\n");
    }

    #[test]
    fn broken_markers_are_left_alone() {
        for text in [
            format!("{START}\nx\n"),
            format!("{START}\n{END}\n{START}\n{END}\n"),
            format!("{END}\n{START}\n"),
            format!("say {START} inline\n{END}\n"),
            format!("{}\nx\n", OLD_TASTE.0),
        ] {
            assert!(with_switches(&text, &["loop"]).is_err(), "{text:?}");
        }
    }

    #[test]
    fn each_line_is_one_line_and_names_no_person() {
        for (id, _, line) in CATALOG {
            assert_eq!(line.lines().count(), 1, "{id}");
            assert!(!line.contains("every message"), "{id}");
        }
    }

    #[test]
    fn every_switch_on_stays_under_the_token_budget() {
        // REN-2056: the whole block stays under about 300 tokens (~4 bytes each).
        let all: Vec<&str> = CATALOG.iter().map(|(id, _, _)| *id).collect();
        let block = with_switches("", &all).unwrap();
        assert!(block.len() <= 1200, "{} bytes", block.len());
    }
}
