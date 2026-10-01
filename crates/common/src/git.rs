//! Git repository layout, read from disk. Nothing here spawns `git`: the hook
//! runs on every edit, and git may not be installed.

use crate::jsp;

/// The `info/exclude` git reads for the repository whose gitdir is the
/// absolute path `git_dir`. A linked worktree's gitdir names the shared
/// directory in a `commondir` file, relative to itself, and git then ignores
/// the worktree's own `info`.
pub fn info_exclude(git_dir: &str) -> String {
    let common = match std::fs::read_to_string(jsp::join(&[git_dir, "commondir"])) {
        Ok(raw) => jsp::resolve(git_dir, &[raw.trim()]),
        Err(_) => git_dir.to_string(),
    };
    jsp::join(&[&common, "info", "exclude"])
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
}
