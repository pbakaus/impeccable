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

/// Earlier wording of a switch's line, still read as that switch and replaced by its
/// current line on the next write, so a copy edit never strands an old line. When a
/// line in CATALOG changes, its previous text goes here.
const ALIASES: &[(&str, &str)] = &[];

/// The switch a line stands for, by its current wording or an earlier one.
fn switch_of(line: &str) -> Option<&'static str> {
    CATALOG
        .iter()
        .find(|(_, _, l)| *l == line)
        .map(|(id, _, _)| *id)
        .or_else(|| ALIASES.iter().find(|(_, l)| *l == line).map(|(id, _)| *id))
}



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
        .filter(|l| !l.trim().is_empty() && switch_of(l).is_none())
        .map(str::to_string)
        .collect())
}

/// The switches on in `text`: each catalog line inside the block, plus taste while the
/// old taste block is still there.
pub(crate) fn switches(text: &str) -> Result<Vec<&'static str>> {
    let mut on = Vec::new();
    if let Some((a, b)) = span(text, START, END)? {
        let body: Vec<&str> = text[a..b].lines().map(|l| l.trim_end_matches('\r')).collect();
        for (id, _, _) in CATALOG {
            if body.iter().any(|l| switch_of(l) == Some(id)) {
                on.push(id);
            }
        }
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
    // A block that ends the file with no line break was appended to a file that had
    // none: the whole separator before it goes, so that file gets its bytes back too.
    let unbroken = after.is_empty();
    after = after.strip_prefix("\r\n").or_else(|| after.strip_prefix('\n')).unwrap_or(after);
    // One blank line before the block goes with it, wherever it stands, as with the
    // agents engine's own block: the two may end up in either order in the same file.
    let mut before = &text[..a];
    for sep in ["\r\n\r\n", "\n\n"] {
        if before.ends_with(sep) {
            before = &before[..before.len() - if unbroken { sep.len() } else { sep.len() / 2 }];
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
    // A file without a final line break keeps having none, after the block.
    let unbroken = !out.is_empty() && !out.ends_with('\n');
    if !out.is_empty() {
        if unbroken {
            out.push_str(nl);
        }
        out.push_str(nl);
    }
    out.push_str(&block);
    if !unbroken {
        out.push_str(nl);
    }
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

/// The switches on in `path`: none for a missing file, an error for one that can't be
/// read or has broken markers.
pub(crate) fn switches_in(path: &Path) -> Result<Vec<&'static str>> {
    switches(&read(path)?.unwrap_or_default())
}

/// The switches in `path`'s block, or `None` when the file has no Impeccable block (nor
/// the old taste block) yet; an error for one that can't be read or has broken markers.
pub(crate) fn block_in(path: &Path) -> Result<Option<Vec<&'static str>>> {
    let text = read(path)?.unwrap_or_default();
    let ids = switches(&text)?;
    let has = span(&text, START, END)?.is_some() || span(&text, OLD_TASTE.0, OLD_TASTE.1)?.is_some();
    Ok(has.then_some(ids))
}

/// Whether switch `id` is on in `path`. An unreadable file reads as off.
pub(crate) fn present(path: &Path, id: &str) -> bool {
    read(path).ok().flatten().is_some_and(|t| switches(&t).is_ok_and(|on| on.contains(&id)))
}

/// Put exactly the switches `on` in `path` (lines it doesn't know stay), creating the
/// file only when one is on. `Ok(false)` when nothing changed.
pub(crate) fn write_switches(path: &Path, on: &[&str]) -> Result<bool> {
    locked(path, || write_switches_unlocked(path, on))
}

fn write_switches_unlocked(path: &Path, on: &[&str]) -> Result<bool> {
    let before = read(path)?;
    if before.is_none() && on.is_empty() {
        return Ok(false);
    }
    let before = before.unwrap_or_default();
    let after = with_switches(&before, on)?;
    if after == before {
        return Ok(false);
    }
    write(path, after.as_bytes())?;
    Ok(true)
}

/// Run `f` holding the lock that serializes every read-modify-write of one rule file
/// across processes (`loop connect` and the sync worker): a lock file beside the file
/// itself, taken with `create_new`, treated as stale after 30 s.
fn locked<T>(path: &Path, f: impl FnOnce() -> Result<T>) -> Result<T> {
    use std::time::{Duration, Instant};
    let target = physical(path)?;
    let parent = target.parent().ok_or("no parent folder")?;
    let name = target.file_name().ok_or("no file name")?.to_string_lossy().into_owned();
    let lock = parent.join(format!(".{name}.impeccable-lock"));
    let _ = fs::create_dir_all(parent);
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match fs::OpenOptions::new().write(true).create_new(true).open(&lock) {
            Ok(_) => break,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                let stale = fs::metadata(&lock)
                    .and_then(|m| m.modified())
                    .is_ok_and(|t| t.elapsed().unwrap_or_default() > Duration::from_secs(30));
                if stale {
                    let _ = fs::remove_file(&lock);
                    continue;
                }
                if Instant::now() > deadline {
                    return Err("another Impeccable command is changing it".into());
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
    let out = f();
    let _ = fs::remove_file(&lock);
    out
}

/// Whether `path` can take the block: readable text with no broken markers.
pub(crate) fn writable(path: &Path) -> Result<()> {
    switches(&read(path)?.unwrap_or_default()).map(|_| ())
}

/// Turn switch `id` on or off in `path`, creating the file only to turn one on.
/// `Ok(false)` when the file already said so and nothing was written.
pub(crate) fn set(path: &Path, id: &str, on: bool) -> Result<bool> {
    locked(path, || set_unlocked(path, id, on))
}

fn set_unlocked(path: &Path, id: &str, on: bool) -> Result<bool> {
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

/// The user-level rule file each agent installed here reads alongside a repository's
/// own (REN-2056; checked against each harness's docs, 16 Nov 2026), named for
/// people. An agent counts as installed when its config folder exists.
/// - Claude Code: `CLAUDE.md` in `$CLAUDE_CONFIG_DIR`, else `~/.claude`.
/// - Codex: `AGENTS.override.md` in `$CODEX_HOME` (else `~/.codex`) when it exists, since
///   Codex then reads it instead, else `AGENTS.md`.
/// - Gemini CLI: `~/.gemini/GEMINI.md`.
/// - GitHub Copilot (CLI and VS Code): `copilot-instructions.md` in `$COPILOT_HOME`, else
///   `~/.copilot`.
/// - opencode: `~/.config/opencode/AGENTS.md` only when it already exists. Without it,
///   opencode reads `~/.claude/CLAUDE.md`, which creating it would turn off.
/// Cursor keeps its user rules in its settings, not a file, so it has none here.
pub(crate) fn user_rule_files(io: &impeccable_common::Io) -> Vec<(&'static str, PathBuf)> {
    let home = PathBuf::from(impeccable_context::util::homedir(&io.env));
    let var = |k: &str| io.env.get(k).filter(|v| !v.is_empty()).map(PathBuf::from);
    let mut out = Vec::new();
    let claude = var("CLAUDE_CONFIG_DIR").unwrap_or_else(|| home.join(".claude"));
    if claude.is_dir() {
        out.push(("Claude Code", claude.join("CLAUDE.md")));
    }
    let codex = var("CODEX_HOME").unwrap_or_else(|| home.join(".codex"));
    if codex.is_dir() {
        let over = codex.join("AGENTS.override.md");
        out.push(("Codex", if over.exists() { over } else { codex.join("AGENTS.md") }));
    }
    let gemini = home.join(".gemini");
    if gemini.is_dir() {
        out.push(("Gemini CLI", gemini.join("GEMINI.md")));
    }
    let copilot = var("COPILOT_HOME").unwrap_or_else(|| home.join(".copilot"));
    if copilot.is_dir() {
        out.push(("GitHub Copilot", copilot.join("copilot-instructions.md")));
    }
    let opencode = var("XDG_CONFIG_HOME").unwrap_or_else(|| home.join(".config")).join("opencode").join("AGENTS.md");
    if opencode.is_file() {
        out.push(("opencode", opencode));
    }
    out
}

/// The always-applied Cursor rule that carries personal switches in a repository.
const CURSOR_HEAD: &str = "---\ndescription: Impeccable, your personal switches (kept out of git)\nalwaysApply: true\n---\n";
const CURSOR_RULE: &str = ".cursor/rules/impeccable.mdc";

fn git(cwd: &Path, args: &[&str]) -> Option<String> {
    let out = std::process::Command::new("git").args(args).current_dir(cwd).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Cursor keeps its user rules in its settings, not a file, so its personal switches go
/// into the repository the agent works in (REN-2056): `.cursor/rules/impeccable.mdc`, an
/// always-applied rule kept out of git by `.git/info/exclude`, which is local and never
/// committed. Only when Cursor is installed (`~/.cursor`), the working directory is in a
/// git work tree, and that file isn't tracked (a tracked one is the team's).
pub(crate) fn cursor_personal_file(io: &impeccable_common::Io) -> Option<PathBuf> {
    let home = PathBuf::from(impeccable_context::util::homedir(&io.env));
    if !home.join(".cursor").is_dir() {
        return None;
    }
    let root = PathBuf::from(git(&io.cwd, &["rev-parse", "--show-toplevel"])?);
    // A symlinked `.cursor`, `rules` or rule could lead into a folder the team shares.
    let linked = [".cursor", ".cursor/rules", CURSOR_RULE]
        .iter()
        .any(|p| fs::symlink_metadata(root.join(p)).is_ok_and(|m| m.file_type().is_symlink()));
    let tracked = git(&root, &["ls-files", "--error-unmatch", CURSOR_RULE]).is_some();
    (!linked && !tracked).then(|| root.join(CURSOR_RULE))
}

/// Put exactly the switches `on` in Cursor's personal rule, with its header; the file
/// goes when none is on, and git is told to leave it alone.
pub(crate) fn write_cursor(path: &Path, on: &[&str]) -> Result<bool> {
    locked(path, || {
        let before = read(path)?;
        if before.is_none() && on.is_empty() {
            return Ok(false);
        }
        // A rule there that isn't ours (no header of ours) is left as it is.
        if before.as_ref().is_some_and(|b| !b.starts_with(CURSOR_HEAD)) {
            return Err("a Cursor rule of that name is already there".into());
        }
        let start = before.clone().unwrap_or_else(|| CURSOR_HEAD.to_string());
        let after = with_switches(&start, on)?;
        if after.trim_end() == CURSOR_HEAD.trim_end() {
            if before.is_some() {
                fs::remove_file(path).map_err(|e| e.to_string())?;
                return Ok(true);
            }
            return Ok(false);
        }
        if Some(&after) == before.as_ref() {
            return Ok(false);
        }
        exclude(path)?;
        // The repository's own .gitignore can override a local exclusion (`!*.mdc`): then
        // the rule could be committed, so it isn't written.
        let root = path.ancestors().nth(3).ok_or("no repository folder")?;
        if git(root, &["check-ignore", "-q", "--no-index", CURSOR_RULE]).is_none() {
            return Err("git wouldn't ignore it here".into());
        }
        write(path, after.as_bytes())?;
        Ok(true)
    })
}

/// Name the rule in the repository's `info/exclude` (the shared one for worktrees).
fn exclude(path: &Path) -> Result<()> {
    let root = path.ancestors().nth(3).ok_or("no repository folder")?;
    let common = git(root, &["rev-parse", "--git-common-dir"]).ok_or("not a git repository")?;
    let common = if Path::new(&common).is_absolute() { PathBuf::from(common) } else { root.join(common) };
    let file = common.join("info").join("exclude");
    let line = format!("/{CURSOR_RULE}");
    // Its bytes are kept as they are: only a missing file reads as empty.
    let bytes = match fs::read(&file) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(e) => return Err(e.to_string()),
    };
    if bytes.split(|b| *b == b'\n').any(|l| l.trim_ascii() == line.as_bytes()) {
        return Ok(());
    }
    fs::create_dir_all(file.parent().ok_or("no info folder")?).map_err(|e| e.to_string())?;
    let mut out = bytes;
    if !out.is_empty() && !out.ends_with(b"\n") {
        out.push(b'\n');
    }
    out.extend_from_slice(line.as_bytes());
    out.push(b'\n');
    fs::write(&file, out).map_err(|e| e.to_string())
}

/// One line per installed agent: its user-level rule file and the switches on in it.
pub(crate) fn listing(io: &impeccable_common::Io) -> String {
    let home = PathBuf::from(impeccable_context::util::homedir(&io.env));
    let mut files: Vec<(&str, PathBuf, Option<String>)> =
        user_rule_files(io).into_iter().map(|(n, f)| (n, f, None)).collect();
    if let Some(cursor) = cursor_personal_file(io) {
        files.push(("Cursor", cursor, Some(format!("this repository's {CURSOR_RULE}"))));
    }
    if files.is_empty() {
        return "No agent's user-level rule file found.\n".into();
    }
    let mut out = String::new();
    for (name, file, label) in files {
        let shown = label.unwrap_or_else(|| {
            file.strip_prefix(&home).map_or_else(|_| file.display().to_string(), |r| format!("~/{}", r.display()))
        });
        out.push_str(&match switches_in(&file) {
            Ok(ids) if ids.is_empty() => format!("{name} ({shown}): none\n"),
            Ok(ids) => format!("{name} ({shown}): {}\n", ids.join(", ")),
            Err(e) => format!("{name} ({shown}): unreadable, {e}\n"),
        });
    }
    out
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
            io.out(&listing(io));
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
        // Catches (REN-2056): a file without a final line break gaining one after a connect and disconnect.
        for original in ["", "mine\n", "mine", "a\n\nb\n", "a\r\nb\r\n", "a\r\nb", "a\n\nb"] {
            let with = with_switches(original, &["taste"]).unwrap();
            assert_eq!(with.matches(START).count(), 1, "{original:?}");
            assert_eq!(with_switches(&with, &["taste"]).unwrap(), with, "idempotent for {original:?}");
            assert_eq!(with_switches(&with, &[]).unwrap(), original, "{original:?}");
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
    fn an_alias_reads_as_its_switch() {
        // Copy edits (review): an earlier wording must read as its switch, not as an
        // unknown line kept beside the new one. Every alias names a catalog id.
        for (id, line) in ALIASES {
            assert!(CATALOG.iter().any(|(i, _, _)| i == id), "{id}");
            assert_eq!(switch_of(line), Some(*id));
        }
        assert_eq!(switch_of(TASTE), Some("taste"));
        assert_eq!(switch_of("A newer switch's line."), None);
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
