//! Git repository layout, read from disk. Nothing here spawns `git`: the hook
//! runs on every edit, and git may not be installed.

use crate::jsp;

/// The gitdir of the checkout at `dir`: `<dir>/.git` itself when it is a
/// directory, or the path a `.git` file names after `gitdir:` (a linked
/// worktree or a submodule), resolved against `dir`.
pub fn git_dir(dir: &str) -> Option<String> {
    let dot_git = jsp::join(&[dir, ".git"]);
    if std::path::Path::new(&dot_git).is_dir() {
        return Some(dot_git);
    }
    let raw = std::fs::read_to_string(&dot_git).ok()?;
    let (key, path) = raw.trim().split_once(':')?;
    key.eq_ignore_ascii_case("gitdir").then(|| jsp::resolve(dir, &[path.trim()]))
}

/// The shared directory a linked worktree's gitdir names in its `commondir`
/// file, relative to itself. `None` for any other gitdir: a main checkout's or
/// a submodule's is its own common dir.
pub fn common_dir(git_dir: &str) -> Option<String> {
    let raw = std::fs::read_to_string(jsp::join(&[git_dir, "commondir"])).ok()?;
    Some(jsp::resolve(git_dir, &[raw.trim()]))
}

/// The `info/exclude` git reads for the repository whose gitdir is the
/// absolute path `git_dir`. Git ignores a linked worktree's own `info`.
pub fn info_exclude(git_dir: &str) -> String {
    let common = common_dir(git_dir).unwrap_or_else(|| git_dir.to_string());
    jsp::join(&[&common, "info", "exclude"])
}

/// The main checkout of the linked worktree at `dir`: the parent of the
/// common dir its gitdir names, when that parent's own `.git` is the common
/// dir. A bare or separate-git-dir repository has no such checkout.
pub fn linked_worktree_checkout(dir: &str) -> Option<String> {
    let common = common_dir(&git_dir(dir)?)?;
    let checkout = jsp::dirname(&common);
    (git_dir(&checkout).as_deref() == Some(common.as_str())).then_some(checkout)
}

/// The header line of every `.gitignore` the engine writes into a runtime
/// directory of the user's project.
pub const RUNTIME_IGNORE_HEADER: &str = "# Written by Impeccable: local runtime state, never committed.";

/// Makes sure `<dir>/.gitignore` ignores each of `patterns`, creating the
/// directory and the file when missing and appending only the patterns it
/// lacks, so it is cheap to call on every write and leaves the user's own
/// lines alone. A directory whose files are all runtime state passes `*`,
/// which also ignores the `.gitignore` itself, so no new file in it, the
/// ignore file included, reaches a commit. Files git already tracks stay
/// tracked: see `serve_question::tracked_runtime_notice`.
/// Best effort: a failure never fails the write it guards.
pub fn ensure_dir_ignored(dir: &str, patterns: &[&str]) {
    let file = jsp::join(&[dir, ".gitignore"]);
    let current = std::fs::read_to_string(&file).unwrap_or_default();
    let have: Vec<&str> = current.lines().map(str::trim).collect();
    let missing: Vec<&str> = patterns.iter().copied().filter(|p| !have.contains(p)).collect();
    if missing.is_empty() {
        return;
    }
    let mut next = current.clone();
    if next.is_empty() {
        next.push_str(RUNTIME_IGNORE_HEADER);
        next.push('\n');
    } else if !next.ends_with('\n') {
        next.push('\n');
    }
    for p in missing {
        next.push_str(p);
        next.push('\n');
    }
    let _ = std::fs::create_dir_all(dir).and_then(|_| std::fs::write(&file, next));
}

/// Undoes [`ensure_dir_ignored`] for `patterns` when a project opts in to
/// committing that directory: removes only those lines (and the header when
/// nothing else is left), keeps every line the user wrote, and deletes the
/// file when it held only what the engine put there. Best effort.
pub fn release_dir_ignored(dir: &str, patterns: &[&str]) {
    let file = jsp::join(&[dir, ".gitignore"]);
    let Ok(current) = std::fs::read_to_string(&file) else { return };
    if !current.lines().next().is_some_and(|l| l.trim() == RUNTIME_IGNORE_HEADER) {
        return; // not a file the engine wrote
    }
    let kept: Vec<&str> = current
        .lines()
        .skip(1)
        .filter(|l| !patterns.contains(&l.trim()))
        .collect();
    if kept.iter().all(|l| l.trim().is_empty()) {
        let _ = std::fs::remove_file(&file);
    } else if kept.len() + 1 != current.lines().count() {
        let _ = std::fs::write(&file, format!("{RUNTIME_IGNORE_HEADER}\n{}\n", kept.join("\n")));
    }
}


/// The comps (`.impeccable/mocks/`) and captures (`.impeccable/review/`) of
/// a design round are runtime output the agent writes with its own tools, so
/// every engine verb that precedes those writes makes both ignore themselves.
pub fn ignore_runtime_output(root: &str) {
    for dir in [".impeccable/mocks", ".impeccable/review"] {
        ensure_dir_ignored(&jsp::join(&[root, dir]), &["*"]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn info_exclude_follows_a_linked_worktrees_commondir() {
        let base = std::env::temp_dir().join(format!("impeccable-common-git-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let tmp = base.to_string_lossy().into_owned();

        let plain = jsp::join(&[&tmp, "plain", ".git"]);
        assert_eq!(info_exclude(&plain), jsp::join(&[&plain, "info", "exclude"]));

        let worktree_git = jsp::join(&[&tmp, "repo", ".git", "worktrees", "wt"]);
        std::fs::create_dir_all(&worktree_git).unwrap();
        std::fs::write(jsp::join(&[&worktree_git, "commondir"]), "../..\n").unwrap();
        assert_eq!(
            info_exclude(&worktree_git),
            jsp::join(&[&tmp, "repo", ".git", "info", "exclude"])
        );

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn linked_worktree_checkout_needs_a_git_file_whose_gitdir_has_commondir() {
        let base = std::env::temp_dir().join(format!("impeccable-common-wt-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let tmp = base.to_string_lossy().into_owned();
        let at = |parts: &[&str]| jsp::join(&[&[tmp.as_str()], parts].concat());

        let linked_git = at(&["repo", ".git", "worktrees", "wt"]);
        std::fs::create_dir_all(&linked_git).unwrap();
        std::fs::write(jsp::join(&[&linked_git, "commondir"]), "../..\n").unwrap();
        std::fs::create_dir_all(at(&["abs"])).unwrap();
        std::fs::write(at(&["abs", ".git"]), format!("gitdir: {}\n", linked_git)).unwrap();
        let checkout = Some(at(&["repo"]));
        assert_eq!(linked_worktree_checkout(&at(&["abs"])), checkout);

        std::fs::create_dir_all(at(&["rel"])).unwrap();
        std::fs::write(at(&["rel", ".git"]), "GitDir: ../repo/.git/worktrees/wt\r\n").unwrap();
        assert_eq!(linked_worktree_checkout(&at(&["rel"])), checkout);

        std::fs::create_dir_all(at(&["plain", ".git"])).unwrap();
        assert_eq!(git_dir(&at(&["plain"])), Some(at(&["plain", ".git"])));
        assert_eq!(linked_worktree_checkout(&at(&["plain"])), None);

        std::fs::create_dir_all(at(&["repo", ".git", "modules", "sub"])).unwrap();
        std::fs::create_dir_all(at(&["repo", "sub"])).unwrap();
        std::fs::write(at(&["repo", "sub", ".git"]), "gitdir: ../.git/modules/sub\n").unwrap();
        assert_eq!(linked_worktree_checkout(&at(&["repo", "sub"])), None);

        let bare_git = at(&["bare.git", "worktrees", "wt"]);
        std::fs::create_dir_all(&bare_git).unwrap();
        std::fs::write(jsp::join(&[&bare_git, "commondir"]), "../..\n").unwrap();
        std::fs::create_dir_all(at(&["unrelated", "wt"])).unwrap();
        std::fs::write(at(&["unrelated", "wt", ".git"]), format!("gitdir: {}\n", bare_git)).unwrap();
        assert_eq!(linked_worktree_checkout(&at(&["unrelated", "wt"])), None);

        // --separate-git-dir: the checkout's `.git` is a file naming the common dir.
        let sep_git = at(&["sep.git", "worktrees", "wt"]);
        std::fs::create_dir_all(&sep_git).unwrap();
        std::fs::write(jsp::join(&[&sep_git, "commondir"]), "../..\n").unwrap();
        std::fs::create_dir_all(at(&["sep"])).unwrap();
        std::fs::write(at(&["sep", ".git"]), format!("gitdir: {}\n", at(&["sep.git"]))).unwrap();
        std::fs::write(at(&["unrelated", "wt", ".git"]), format!("gitdir: {}\n", sep_git)).unwrap();
        assert_eq!(linked_worktree_checkout(&at(&["unrelated", "wt"])), None);

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn ensure_dir_ignored_writes_once_and_keeps_user_lines() {
        let dir = std::env::temp_dir().join(format!("impeccable-ignore-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let d = dir.join("q").to_string_lossy().into_owned();
        ensure_dir_ignored(&d, &["*"]);
        let file = dir.join("q/.gitignore");
        assert_eq!(std::fs::read_to_string(&file).unwrap(), format!("{}\n*\n", RUNTIME_IGNORE_HEADER));
        ensure_dir_ignored(&d, &["*"]);
        assert_eq!(std::fs::read_to_string(&file).unwrap(), format!("{}\n*\n", RUNTIME_IGNORE_HEADER), "idempotent");
        std::fs::write(&file, "mine.txt").unwrap();
        ensure_dir_ignored(&d, &["state.json"]);
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "mine.txt\nstate.json\n");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ignore_runtime_output_covers_mocks_and_review() {
        let dir = std::env::temp_dir().join(format!("impeccable-runtime-ignore-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        ignore_runtime_output(&dir.to_string_lossy());
        for runtime in ["mocks", "review"] {
            let file = dir.join(".impeccable").join(runtime).join(".gitignore");
            assert_eq!(std::fs::read_to_string(file).unwrap(), format!("{}\n*\n", RUNTIME_IGNORE_HEADER));
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
