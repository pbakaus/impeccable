//! Files the agent wrote through a shell, found at Stop.
//!
//! The per-edit pass only sees the harness's own edit tools: Codex reaches
//! PostToolUse through `apply_patch`, Claude through Edit/Write. A heredoc or
//! `cat >` never does, so in about half of Codex runs the cache stayed empty
//! and Stop scanned nothing. Stop now also scans UI files modified since the
//! session started.
//!
//! The session start comes from facts the event carries, never a guess:
//! a UUIDv7 session id (Codex thread ids) holds its creation time, and a
//! transcript file's birth time marks when the session began. With neither,
//! discovery stays off and Stop scans the cache alone, as before.
//!
//! The walk is bounded (depth, entries visited, files kept) because it runs on
//! every Stop. It skips hidden directories, dependency and build output,
//! non-regular files and files over the size limit, and refuses to walk a
//! home directory or a filesystem root (compared as real paths). It runs only
//! in a project root, the rule the per-edit pass keys its cache by. Discovered files
//! carry no baseline, so their findings keep the attribution-unknown note.

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Map, Value};

use crate::hook_lib::{match_configured_extension, ExtensionEntry, ALLOWED_EXTS};
use impeccable_common::jsp;
use impeccable_core::js;

const MAX_DEPTH: usize = 8;
const MAX_ENTRIES: usize = 5_000;
const MAX_FILES: usize = 40;
/// mtime resolution on some filesystems is a second or two.
const SLACK_MS: u64 = 2_000;
const SKIP_DIRS: &[&str] = &[
    "node_modules", "dist", "build", "out", "coverage", "generated", "target", "vendor",
    "__pycache__",
];

/// When this session started, in ms since the epoch, if the event says.
pub fn session_start_ms(event: &Map<String, Value>) -> Option<u64> {
    let now = now_ms();
    let plausible = |ms: u64| ms > 1_577_836_800_000 && ms <= now + 60_000; // after 2020, not in the future
    if let Some(ms) = event.get("session_id").and_then(Value::as_str).and_then(uuid_v7_ms) {
        if plausible(ms) {
            return Some(ms);
        }
    }
    let transcript = event.get("transcript_path").and_then(Value::as_str)?;
    let created = std::fs::metadata(transcript).ok()?.created().ok()?;
    let ms = created.duration_since(UNIX_EPOCH).ok()?.as_millis() as u64;
    plausible(ms).then_some(ms)
}

/// The timestamp of a UUIDv7: its first 48 bits, in ms.
fn uuid_v7_ms(id: &str) -> Option<u64> {
    let b = id.as_bytes();
    if b.len() != 36 || b[8] != b'-' || b[13] != b'-' || b[18] != b'-' || b[23] != b'-' {
        return None;
    }
    if b[14] != b'7' || !matches!(b[19].to_ascii_lowercase(), b'8' | b'9' | b'a' | b'b') {
        return None;
    }
    let hex = format!("{}{}", &id[..8], &id[9..13]);
    u64::from_str_radix(&hex, 16).ok()
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// The project `dir` sits in, found on the walk up to (not including) `home`
/// with the per-edit pass's markers (`.git`, `package.json`, `.impeccable`).
/// A folder above several projects has none.
pub fn owning_project(dir: &str, home: &str) -> Option<String> {
    let mut dir = dir.to_string();
    loop {
        if dir == home {
            return None;
        }
        if crate::hook_lib::looks_like_project_root(&dir) {
            return Some(dir);
        }
        let parent = jsp::dirname(&dir);
        if parent == dir {
            return None;
        }
        dir = parent;
    }
}

/// UI files under `root` modified at or after `since_ms`, newest first.
/// Regular files only (a named pipe would block the read), none over
/// `max_bytes` when that limit is set.
pub fn changed_since(root: &str, home: &str, since_ms: u64, configured: &[ExtensionEntry], max_bytes: f64) -> Vec<String> {
    // Compare real paths: a cwd that is a symlink to the home dir or a
    // filesystem root must not get walked under another name.
    let real = |p: &str| std::fs::canonicalize(p).ok();
    let Some(real_root) = real(root) else { return Vec::new() };
    if real_root.parent().is_none() || real(home).is_some_and(|h| h == real_root) {
        return Vec::new();
    }
    let root_path = Path::new(root);
    let cutoff = UNIX_EPOCH + std::time::Duration::from_millis(since_ms.saturating_sub(SLACK_MS));
    let mut found: Vec<(SystemTime, String)> = Vec::new();
    let mut visited = 0usize;
    let mut stack = vec![(root_path.to_path_buf(), 0usize)];
    while let Some((dir, depth)) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            visited += 1;
            if visited > MAX_ENTRIES {
                return newest(found);
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                if depth + 1 < MAX_DEPTH && !name.starts_with('.') && !SKIP_DIRS.contains(&name.as_str()) {
                    stack.push((entry.path(), depth + 1));
                }
                continue;
            }
            if !kind.is_file() {
                continue;
            }
            let path = entry.path().to_string_lossy().into_owned();
            let ext = js::to_lower_case(&jsp::extname(&path));
            if !ALLOWED_EXTS.contains(&ext.as_str()) && match_configured_extension(&path, configured).is_none() {
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            if max_bytes > 0.0 && meta.len() as f64 > max_bytes {
                continue;
            }
            let Ok(modified) = meta.modified() else { continue };
            if modified >= cutoff {
                found.push((modified, path));
            }
        }
    }
    newest(found)
}

fn newest(mut found: Vec<(SystemTime, String)>) -> Vec<String> {
    found.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
    found.into_iter().take(MAX_FILES).map(|(_, p)| p).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_time_of_a_v7_id() {
        assert_eq!(uuid_v7_ms("01a1be7f-42b5-7d90-805e-6b3dc9694efb"), Some(0x01a1be7f42b5));
        assert_eq!(uuid_v7_ms("01a1be7f-42b5-4d90-805e-6b3dc9694efb"), None, "v4");
        assert_eq!(uuid_v7_ms("01a1be7f-42b5-7d90-c05e-6b3dc9694efb"), None, "variant");
        assert_eq!(uuid_v7_ms("s1"), None);
    }
}
