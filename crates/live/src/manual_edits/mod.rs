//! Manual copy edits (staged browser copy edits): the buffer, evidence
//! gathering, the AI batch commit, and the server-side apply controller.
//! JS: live/manual-edits-buffer.mjs, live-manual-edit-evidence.mjs,
//! live-commit-manual-edits.mjs, live-copy-edit-agent.mjs,
//! live/manual-apply.mjs, live/manual-edit-routes.mjs (routes live in
//! `live_server`).

pub mod apply;
pub mod buffer;
pub mod commit;
pub mod evidence;

use crate::util::jsp;
use once_cell::sync::Lazy;
use regex::Regex;

static HEADER_MARKERS: Lazy<Vec<Regex>> = Lazy::new(|| {
    vec![
        Regex::new(r"(?i)@generated\b").unwrap(),
        Regex::new(r"\bGENERATED\s+FILE\b").unwrap(),
        Regex::new(r"(?i)\bAUTO-?GENERATED\b").unwrap(),
        Regex::new(r"(?i)\bDO\s+NOT\s+EDIT\b").unwrap(),
    ]
});

/// JS: lib/is-generated.mjs isGeneratedFile(filePath, { cwd }). Gitignored
/// (via `git check-ignore --quiet`, argv form) or a generated-file header
/// marker within the first 300 bytes.
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

fn has_generated_header(abs: &str) -> bool {
    use std::io::Read;
    let Ok(mut f) = std::fs::File::open(abs) else {
        return false;
    };
    let mut buf = [0u8; 300];
    let mut read = 0usize;
    // Node's readSync may return fewer bytes; loop like a full read.
    while read < buf.len() {
        match f.read(&mut buf[read..]) {
            Ok(0) => break,
            Ok(n) => read += n,
            Err(_) => return false,
        }
    }
    let head = String::from_utf8_lossy(&buf[..read]);
    HEADER_MARKERS.iter().any(|re| re.is_match(&head))
}
