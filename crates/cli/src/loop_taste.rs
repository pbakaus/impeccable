//! The taste block `loop connect` keeps in an agent's user-level rule file
//! (`CLAUDE.md` or `AGENTS.md`), so the agent reads and records the person's taste
//! through the Impeccable MCP. The block is fixed text between its own markers: it
//! never holds the person's rules, their taste or any id, and nothing outside the
//! markers is ever changed.
use std::fs;
use std::path::{Path, PathBuf};

pub(crate) const START: &str = "<!-- impeccable:taste -->";
pub(crate) const END: &str = "<!-- /impeccable:taste -->";
/// Matches the MCP server's own instruction text.
pub(crate) const BODY: &str = "Impeccable Taste: before design or UI work, call the impeccable MCP's taste.get once per task (pass since: the rev it last returned, only while those rules are still in your context) and follow its rules; say \"Applied your taste: <rule>\" when one shaped a choice. When the person makes or corrects a design call, record it with taste.note and the lasting rule.";

type Result<T> = std::result::Result<T, String>;

fn block(nl: &str) -> String {
    format!("{START}{nl}{BODY}{nl}{END}")
}

/// Where the block sits in `text`: the start of its start marker to the end of its
/// end marker. Markers that are duplicated, unbalanced, out of order or not on lines
/// of their own are an error, and the file is then left as it is.
fn span(text: &str) -> Result<Option<(usize, usize)>> {
    let starts = text.matches(START).count();
    let ends = text.matches(END).count();
    let own_line = |m: &str| text.lines().filter(|l| l.trim_end_matches('\r') == m).count();
    if starts == 0 && ends == 0 {
        return Ok(None);
    }
    if starts != 1 || ends != 1 || own_line(START) != 1 || own_line(END) != 1 {
        return Err("its taste markers are duplicated or unbalanced".into());
    }
    let (a, e) = (text.find(START).unwrap(), text.find(END).unwrap());
    if a >= e {
        return Err("its taste markers are out of order".into());
    }
    Ok(Some((a, e + END.len())))
}

pub(crate) fn contains(text: &str) -> bool {
    text.contains(START)
}

/// `text` with the block in place: replaced between its markers when they are there,
/// else appended after a blank line.
pub(crate) fn upsert(text: &str) -> Result<String> {
    let nl = if text.contains("\r\n") { "\r\n" } else { "\n" };
    if let Some((a, b)) = span(text)? {
        return Ok(format!("{}{}{}", &text[..a], block(nl), &text[b..]));
    }
    let mut out = text.to_string();
    if !out.is_empty() {
        if !out.ends_with('\n') {
            out.push_str(nl);
        }
        out.push_str(nl);
    }
    out.push_str(&block(nl));
    out.push_str(nl);
    Ok(out)
}

/// `text` without the block or its markers, and without the line break after it and
/// one blank line before it, so an append followed by a removal gives back the bytes
/// that were there. `None` when there is no block.
pub(crate) fn remove(text: &str) -> Result<Option<String>> {
    let Some((a, b)) = span(text)? else {
        return Ok(None);
    };
    let mut after = &text[b..];
    after = after
        .strip_prefix("\r\n")
        .or_else(|| after.strip_prefix('\n'))
        .unwrap_or(after);
    // One blank line before the block goes with it, wherever it stands, as with the
    // engine's own block: the two may end up in either order in the same file.
    let mut before = &text[..a];
    for sep in ["\r\n\r\n", "\n\n"] {
        if before.ends_with(sep) {
            before = &before[..before.len() - sep.len() / 2];
            break;
        }
    }
    // At the top of the file (nothing but line breaks before it, as the engine leaves
    // when it moves its own block below this one), those and the blank line after it go.
    if before.chars().all(|c| c == '\n' || c == '\r') {
        before = "";
        after = after
            .strip_prefix("\r\n")
            .or_else(|| after.strip_prefix('\n'))
            .unwrap_or(after);
    }
    Ok(Some(format!("{before}{after}")))
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

/// Write `bytes` whole: staged beside the file and renamed over it, keeping the
/// file's mode (a new file gets the usual 0644 less the umask).
fn write(path: &Path, bytes: &[u8]) -> Result<()> {
    let path = physical(path)?;
    let parent = path.parent().ok_or("no parent folder")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let name = path.file_name().ok_or("no file name")?.to_string_lossy();
    let staged = parent.join(format!(".{name}.impeccable-{}", std::process::id()));
    let _ = fs::remove_file(&staged);
    let mode = fs::metadata(&path).ok().map(|m| m.permissions());
    fs::write(&staged, bytes).map_err(|e| e.to_string())?;
    if let Some(mode) = mode {
        if let Err(e) = fs::set_permissions(&staged, mode) {
            let _ = fs::remove_file(&staged);
            return Err(e.to_string());
        }
    }
    fs::rename(&staged, &path).map_err(|e| {
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

/// Whether `path` holds the block now. An unreadable file reads as no block.
pub(crate) fn present(path: &Path) -> bool {
    read(path).ok().flatten().is_some_and(|t| contains(&t))
}

/// Put the block in `path`, creating the file when it is missing. Writes nothing
/// when the file already holds exactly this block.
pub(crate) fn add(path: &Path) -> Result<()> {
    let before = read(path)?.unwrap_or_default();
    let after = upsert(&before)?;
    if after == before {
        return Ok(());
    }
    write(path, after.as_bytes())
}

/// Take the block out of `path`. `Ok(false)` when there was none. The file itself
/// stays, even when nothing is left in it.
pub(crate) fn take_out(path: &Path) -> Result<bool> {
    let Some(before) = read(path)? else {
        return Ok(false);
    };
    let Some(after) = remove(&before)? else {
        return Ok(false);
    };
    write(path, after.as_bytes())?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appending_then_removing_gives_back_the_same_bytes() {
        for original in ["", "mine\n", "mine", "a\n\nb\n", "a\r\nb\r\n"] {
            let with = upsert(original).unwrap();
            assert_eq!(with.matches(START).count(), 1, "{original:?}");
            let again = upsert(&with).unwrap();
            assert_eq!(again, with, "upsert is idempotent for {original:?}");
            let back = remove(&with).unwrap().unwrap();
            let expected = if original == "mine" { "mine\n" } else { original };
            assert_eq!(back, expected, "{original:?}");
        }
    }

    #[test]
    fn a_block_between_two_others_takes_one_blank_line_with_it() {
        let text = format!("mine\n\n{START}\n{BODY}\n{END}\n\n<!-- other -->\n");
        assert_eq!(remove(&text).unwrap().unwrap(), "mine\n\n<!-- other -->\n");
    }

    #[test]
    fn a_block_at_the_top_takes_the_blank_line_after_it() {
        for lead in ["", "\n"] {
            let text = format!("{lead}{START}\n{BODY}\n{END}\n\n<!-- other -->\n");
            assert_eq!(remove(&text).unwrap().unwrap(), "<!-- other -->\n");
        }
    }

    #[test]
    fn an_old_block_is_replaced_in_place() {
        let text = format!("top\n{START}\nold words\n{END}\nbottom\n");
        let out = upsert(&text).unwrap();
        assert_eq!(out, format!("top\n{START}\n{BODY}\n{END}\nbottom\n"));
    }

    #[test]
    fn broken_markers_are_left_alone() {
        for text in [
            format!("{START}\nx\n"),
            format!("{START}\n{END}\n{START}\n{END}\n"),
            format!("{END}\n{START}\n"),
            format!("say {START} inline\n{END}\n"),
        ] {
            assert!(upsert(&text).is_err(), "{text:?}");
            assert!(remove(&text).is_err(), "{text:?}");
        }
    }

    #[test]
    fn the_block_names_no_person_and_no_per_message_call() {
        assert!(!BODY.contains("every message"));
        assert_eq!(BODY.lines().count(), 1);
        assert_eq!(block("\n").lines().count(), 3);
    }
}
