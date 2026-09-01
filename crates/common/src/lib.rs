//! Shared plumbing for every verb crate: an `Io` handle (stdout, stderr,
//! stdin, env, cwd) so verbs are testable without touching the process, and
//! the exit-code convention.
//!
//! A verb is `fn run(args: &[String], io: &mut Io) -> i32`. It writes to
//! `io.stdout` / `io.stderr`, reads `io.stdin()` lazily, and returns the exit
//! code. Only the `cli` binary calls `std::process::exit`.

pub mod jsp;
pub mod proc;

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;

/// Ceiling on how much stdin a verb will ever read. Deliberately generous:
/// the largest legitimate payloads (context/detect JSON, hook envelopes
/// carrying a whole proposed file write) are a few MB at most, so 64 MiB
/// never bites in practice - while a hostile or runaway pipe can no longer
/// grow the buffer without bound (the hook verbs run on every editor turn
/// under panic = "abort", where an OOM aborts the process). Reads stop at
/// the cap; the tail is discarded.
pub const STDIN_MAX_BYTES: u64 = 64 * 1024 * 1024;

pub struct Io {
    pub stdout: Box<dyn Write>,
    pub stderr: Box<dyn Write>,
    stdin: Option<Box<dyn Read>>,
    stdin_cache: Option<String>,
    pub env: HashMap<String, String>,
    pub cwd: PathBuf,
    /// True when stdin is a TTY (the JS scripts read '' in that case).
    pub stdin_is_tty: bool,
}

impl Io {
    pub fn stdio() -> Io {
        Io {
            stdout: Box::new(std::io::stdout()),
            stderr: Box::new(std::io::stderr()),
            stdin: Some(Box::new(std::io::stdin())),
            stdin_cache: None,
            env: std::env::vars().collect(),
            cwd: std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
            stdin_is_tty: is_stdin_tty(),
        }
    }

    /// Whole stdin as UTF-8 (lossy), read once. Empty when stdin is a TTY.
    /// Capped at [`STDIN_MAX_BYTES`]; anything past the cap is truncated.
    pub fn stdin(&mut self) -> &str {
        if self.stdin_cache.is_none() {
            let mut buf = Vec::new();
            if !self.stdin_is_tty {
                if let Some(r) = self.stdin.as_mut() {
                    let _ = r.take(STDIN_MAX_BYTES).read_to_end(&mut buf);
                }
            }
            self.stdin_cache = Some(String::from_utf8_lossy(&buf).into_owned());
        }
        self.stdin_cache.as_deref().unwrap()
    }

    pub fn env(&self, key: &str) -> Option<&str> {
        self.env.get(key).map(String::as_str)
    }

    /// JS `truthy()` from hook-lib: `/^(1|true|yes|on)$/i` on a string.
    pub fn env_truthy(&self, key: &str) -> bool {
        matches!(
            self.env(key).map(|v| v.to_ascii_lowercase()).as_deref(),
            Some("1" | "true" | "yes" | "on")
        )
    }

    /// `os.homedir()`: `$HOME` on posix; on Windows Node reads `USERPROFILE`
    /// (a `HOME` left by an MSYS shell is only a fallback here).
    pub fn home(&self) -> Option<PathBuf> {
        let (first, second) = if cfg!(windows) {
            ("USERPROFILE", "HOME")
        } else {
            ("HOME", "USERPROFILE")
        };
        self.env(first)
            .or_else(|| self.env(second))
            .map(PathBuf::from)
    }

    pub fn out(&mut self, s: &str) {
        let _ = self.stdout.write_all(s.as_bytes());
    }
    pub fn err(&mut self, s: &str) {
        let _ = self.stderr.write_all(s.as_bytes());
    }
}

fn is_stdin_tty() -> bool {
    #[cfg(unix)]
    {
        use std::os::fd::AsRawFd;
        unsafe { libc_isatty(std::io::stdin().as_raw_fd()) }
    }
    #[cfg(not(unix))]
    {
        std::io::IsTerminal::is_terminal(&std::io::stdin())
    }
}

#[cfg(unix)]
unsafe fn libc_isatty(fd: i32) -> bool {
    extern "C" {
        fn isatty(fd: i32) -> i32;
    }
    unsafe { isatty(fd) == 1 }
}

/// Test helper: capture output.
pub struct Captured {
    pub stdout: std::rc::Rc<std::cell::RefCell<Vec<u8>>>,
    pub stderr: std::rc::Rc<std::cell::RefCell<Vec<u8>>>,
}

struct SharedBuf(std::rc::Rc<std::cell::RefCell<Vec<u8>>>);
impl Write for SharedBuf {
    fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
        self.0.borrow_mut().extend_from_slice(b);
        Ok(b.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl Io {
    /// An Io whose streams are captured and whose stdin is any reader; for
    /// unit tests that need more than a string (e.g. an unbounded stream).
    pub fn captured_reader(
        stdin: Box<dyn Read>,
        cwd: PathBuf,
        env: HashMap<String, String>,
    ) -> (Io, Captured) {
        let out = std::rc::Rc::new(std::cell::RefCell::new(Vec::new()));
        let err = std::rc::Rc::new(std::cell::RefCell::new(Vec::new()));
        let io = Io {
            stdout: Box::new(SharedBuf(out.clone())),
            stderr: Box::new(SharedBuf(err.clone())),
            stdin: Some(stdin),
            stdin_cache: None,
            env,
            cwd,
            stdin_is_tty: false,
        };
        (
            io,
            Captured {
                stdout: out,
                stderr: err,
            },
        )
    }

    /// An Io whose streams are captured; for unit tests.
    pub fn captured(stdin: &str, cwd: PathBuf, env: HashMap<String, String>) -> (Io, Captured) {
        Io::captured_reader(
            Box::new(std::io::Cursor::new(stdin.as_bytes().to_vec())),
            cwd,
            env,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stdin_is_capped_at_the_ceiling() {
        // An unbounded pipe (here: an infinite reader) must not grow the
        // buffer past STDIN_MAX_BYTES; without the cap this read_to_end
        // would never return.
        let (mut io, _cap) = Io::captured_reader(
            Box::new(std::io::repeat(b'a')),
            PathBuf::from("."),
            HashMap::new(),
        );
        assert_eq!(io.stdin().len() as u64, STDIN_MAX_BYTES);
    }

    #[test]
    fn stdin_below_the_ceiling_is_read_whole() {
        let (mut io, _cap) = Io::captured("hello", PathBuf::from("."), HashMap::new());
        assert_eq!(io.stdin(), "hello");
    }
}
