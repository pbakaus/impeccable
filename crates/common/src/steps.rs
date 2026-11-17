//! A verb's steps drawn the way `install` draws its own (`◇` a step done, `◆` one under way, a choice, a closing
//! summary), with a progress line that updates in place while a step waits. Drawn only for a person at an
//! interactive terminal: every caller keeps its plain lines for pipes, agents, CI and `NO_COLOR`, which the CLI
//! contract pins.

use std::io::{IsTerminal, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

use crate::flow::R;
use crate::prompt::{Prompt, RadioOption};
use crate::Io;

const FRAMES: [&str; 10] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/// The steps of one run, or `None` where they aren't drawn (`Steps::new`).
pub struct Steps {
    prompt: Prompt,
    /// OSC 8 hyperlinks: not inside tmux or screen, where some versions print the escape as text.
    hyperlinks: bool,
}

impl Steps {
    /// Drawn when a person can see and answer them: stdin, stdout and stderr all terminals, on unix, with colour
    /// allowed and outside CI. Anything else gets `None`, and the caller prints its plain lines.
    pub fn new(io: &Io) -> Option<Steps> {
        let prompt = Prompt::new(io);
        let terminal = prompt.interactive() && std::io::stderr().is_terminal();
        let plain = plain_for(io);
        let multiplexed = io.env("TMUX").is_some() || io.env("STY").is_some() || io.env("TERM").is_some_and(|t| t.starts_with("screen") || t.starts_with("tmux"));
        (terminal && !plain).then_some(Steps { prompt, hyperlinks: !multiplexed })
    }

    /// `impeccable <verb>`, as `install` opens.
    pub fn header(&self, io: &mut Io, verb: &str) {
        io.err(&format!("{} {}\n\n", self.prompt.accent(&self.prompt.bold("impeccable")), self.prompt.dim(verb)));
    }

    /// `◇ title`, then each detail dim and indented under it, set apart by a blank line as install's steps are.
    pub fn done(&self, io: &mut Io, title: &str, details: &[&str]) {
        io.err("\n");
        self.finished(io, title, details);
    }

    /// `▲ title`: a step that didn't go through, never drawn with the success marker.
    pub fn failed(&self, io: &mut Io, title: &str, details: &[&str]) {
        io.err("\n");
        self.failed_here(io, title, details);
    }

    fn failed_here(&self, io: &mut Io, title: &str, details: &[&str]) {
        io.err(&format!("{} {}\n", self.warn("▲"), self.prompt.bold(title)));
        for d in details {
            io.err(&format!("  {}\n", self.prompt.dim(d)));
        }
    }

    fn warn(&self, v: &str) -> String {
        format!("\x1b[33m{v}\x1b[0m")
    }

    /// The finished step on the line a progress line drew on (no blank line of its own).
    fn finished(&self, io: &mut Io, title: &str, details: &[&str]) {
        io.err(&format!("{} {}\n", self.prompt.accent("◇"), self.prompt.bold(title)));
        for d in details {
            io.err(&format!("  {}\n", self.prompt.dim(d)));
        }
    }

    /// A link to open: its label under the step, then the address alone on a line of its own, never indented or
    /// framed, so a terminal that wraps it keeps it one piece to click or copy (a hyperlink where the terminal has them).
    pub fn link(&self, io: &mut Io, label: &str, url: &str) {
        // Dim: the step under way is what to watch; the link is there for when the browser didn't open.
        io.err(&format!("  {}\n\n{}\n", self.prompt.dim(label), self.linked(url, &self.prompt.dim(url))));
    }

    /// `◆ label` with a spinner, redrawn in place until the returned line is finished or dropped.
    pub fn progress(&self, io: &mut Io, label: &str) -> Progress {
        io.err("\n");
        let _ = io.stderr.flush();
        let stop = Arc::new(AtomicBool::new(false));
        // Clipped to the terminal's width: a frame that wrapped would leave its first row behind on every redraw.
        let label = clip(label, columns());
        let text = format!("{} {}", self.prompt.accent("◆"), self.prompt.bold(&label));
        let spin: Vec<String> = FRAMES.iter().map(|f| self.prompt.accent(f)).collect();
        let running = Arc::clone(&stop);
        interrupt::arm();
        // Its own handle on the terminal: the step it waits on may have taken the run's streams (the first scan does).
        let handle = std::thread::spawn(move || {
            let mut err = std::io::stderr();
            let mut i = 0;
            while !running.load(Ordering::Relaxed) {
                let _ = write!(err, "\r\x1b[2K{text} {}", spin[i % spin.len()]);
                let _ = err.flush();
                i += 1;
                std::thread::sleep(Duration::from_millis(90));
            }
            let _ = write!(err, "\r\x1b[2K");
            let _ = err.flush();
        });
        Progress { stop, handle: Some(handle) }
    }

    /// `◆ question` with its options, as `install` asks (`Prompt::radio`): the option index, or a `Flow` on Ctrl-C.
    pub fn choose(&mut self, io: &mut Io, question: &str, options: &[(&str, Option<&str>)], initial: usize) -> R<usize> {
        let options: Vec<RadioOption> =
            options.iter().map(|(label, hint)| RadioOption { label: (*label).to_string(), hint: hint.map(str::to_string) }).collect();
        io.err("\n");
        // Keys pressed before the question (an extra Enter from an earlier picker) never answer it.
        #[cfg(unix)]
        discard_typeahead(libc::STDIN_FILENO);
        self.prompt.radio(io, question, &options, initial)
    }

    /// The closing summary: `└ title`, then each row's name in a column and its value beside it. A value that is a
    /// link goes alone on the next line, for the same reason as `link`.
    pub fn summary(&self, io: &mut Io, title: &str, rows: &[(&str, String)]) {
        io.err(&format!("\n{} {}\n", self.prompt.accent("└"), self.prompt.bold(title)));
        let width = rows.iter().map(|(name, _)| name.chars().count()).max().unwrap_or(0);
        for (name, value) in rows {
            let pad = " ".repeat(width - name.chars().count());
            match value.split_once("\nhttps://") {
                Some((text, rest)) => {
                    let url = format!("https://{rest}");
                    io.err(&format!("  {}{pad}  {text}\n{}\n", self.prompt.dim(name), self.linked(&url, &self.prompt.accent(&url))));
                }
                None => io.err(&format!("  {}{pad}  {value}\n", self.prompt.dim(name))),
            }
        }
    }

    /// Runs `f` with stderr held back, so nothing it says breaks a progress line still drawing; returns what it
    /// said, for `details` to show under the finished step.
    pub fn held<T>(&self, io: &mut Io, f: impl FnOnce(&mut Io) -> T) -> (T, Vec<String>) {
        let buf = Arc::new(std::sync::Mutex::new(Vec::new()));
        let prev = std::mem::replace(&mut io.stderr, Box::new(Held(Arc::clone(&buf))));
        let out = f(io);
        io.stderr = prev;
        let text = String::from_utf8_lossy(&buf.lock().map(|b| b.clone()).unwrap_or_default()).into_owned();
        (out, text.lines().map(str::trim_end).filter(|l| !l.is_empty()).map(str::to_string).collect())
    }

    /// Lines another part printed, dim and indented under the step above them.
    pub fn details(&self, io: &mut Io, lines: &[String]) {
        for l in lines {
            io.err(&format!("  {}\n", self.prompt.dim(l)));
        }
    }

    /// `shown` as a hyperlink to `url` where the terminal has them; the address itself stays the visible text.
    fn linked(&self, url: &str, shown: &str) -> String {
        if self.hyperlinks { format!("\x1b]8;;{url}\x1b\\{shown}\x1b]8;;\x1b\\") } else { shown.to_string() }
    }

    /// Accent, for a word the caller marks inside its own line.
    pub fn accent(&self, v: &str) -> String {
        self.prompt.accent(v)
    }

    pub fn good(&self, v: &str) -> String {
        self.prompt.good(v)
    }

    pub fn dim(&self, v: &str) -> String {
        self.prompt.dim(v)
    }
}

struct Held(Arc<std::sync::Mutex<Vec<u8>>>);

impl Write for Held {
    fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
        if let Ok(mut v) = self.0.lock() {
            v.extend_from_slice(b);
        }
        Ok(b.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// A progress line under way. Finishing it replaces the spinner with the step's `◇` line; dropping it (an early
/// return, Ctrl-C handled upstream) clears the line, so the terminal is never left mid-frame.
pub struct Progress {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl Progress {
    fn halt(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(h) = self.handle.take() {
            let _ = h.join();
            interrupt::disarm();
        }
    }

    /// Stop the spinner and draw the finished step in its place.
    pub fn done(mut self, steps: &Steps, io: &mut Io, title: &str, details: &[&str]) {
        self.halt();
        steps.finished(io, title, details);
    }

    /// Stop the spinner and draw a step that didn't go through in its place.
    pub fn failed(mut self, steps: &Steps, io: &mut Io, title: &str, details: &[&str]) {
        self.halt();
        steps.failed_here(io, title, details);
    }

    /// Stop the spinner and leave the line empty, for a caller that prints its own outcome.
    pub fn clear(mut self) {
        self.halt();
    }
}

impl Drop for Progress {
    fn drop(&mut self) {
        self.halt();
    }
}

/// While a progress line draws, Ctrl-C clears it before the process ends as Ctrl-C would, so the shell prompt never
/// lands on a half-drawn line.
mod interrupt {
    #[cfg(unix)]
    extern "C" fn clear_then_exit(sig: libc::c_int) {
        const CLEAR: &[u8] = b"\r\x1b[2K";
        // SAFETY: write, signal and raise are async-signal-safe; the default action then ends the process.
        unsafe {
            libc::write(2, CLEAR.as_ptr().cast(), CLEAR.len());
            libc::signal(sig, libc::SIG_DFL);
            libc::raise(sig);
        }
    }

    pub(super) fn arm() {
        #[cfg(unix)]
        // SAFETY: installs a handler that only uses async-signal-safe calls.
        unsafe {
            libc::signal(libc::SIGINT, clear_then_exit as extern "C" fn(libc::c_int) as libc::sighandler_t);
        }
    }

    pub(super) fn disarm() {
        #[cfg(unix)]
        // SAFETY: restores the default disposition.
        unsafe {
            libc::signal(libc::SIGINT, libc::SIG_DFL);
        }
    }
}

/// Whether this run keeps the plain lines whatever the terminal: `NO_COLOR`, `TERM=dumb`, CI, or
/// `login --no-browser` (which sets IMPECCABLE_NO_BROWSER for the rest of the run).
pub fn plain_for(io: &Io) -> bool {
    io.env("NO_COLOR").is_some() || io.env("TERM") == Some("dumb") || io.env("CI").is_some() || io.env_truthy("IMPECCABLE_NO_BROWSER")
}

/// A progress label that fits on one row of a terminal `columns` wide, beside its marker and spinner.
pub(crate) fn clip(label: &str, columns: usize) -> String {
    let room = columns.saturating_sub(5).max(8);
    if label.chars().count() > room { format!("{}…", label.chars().take(room - 1).collect::<String>()) } else { label.to_string() }
}

/// Discards what was typed on `fd` before a question appeared, so an early key never answers it.
#[cfg(unix)]
pub(crate) fn discard_typeahead(fd: libc::c_int) {
    // SAFETY: tcflush only discards unread input on the descriptor given.
    unsafe {
        libc::tcflush(fd, libc::TCIFLUSH);
    }
}

/// The terminal's width on stderr, 80 when it can't be read.
fn columns() -> usize {
    #[cfg(unix)]
    {
        let mut size: libc::winsize = unsafe { std::mem::zeroed() };
        // SAFETY: TIOCGWINSZ only fills the struct passed in.
        if unsafe { libc::ioctl(libc::STDERR_FILENO, libc::TIOCGWINSZ, &mut size) } == 0 && size.ws_col > 0 {
            return size.ws_col as usize;
        }
    }
    80
}

#[cfg(test)]
mod tests {
    use super::*;

    fn io_with(env: &[(&str, &str)]) -> Io {
        let (io, _) = Io::captured("", std::env::temp_dir(), env.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect());
        io
    }

    // Catches a run that must keep the pinned plain lines drawing steps anyway (#1536 review: login --no-browser
    // went on to draw setup, the scan, Loop and the summary).
    #[test]
    fn keeps_the_plain_lines_where_the_contract_pins_them() {
        for (env, plain) in [
            (vec![], false),
            (vec![("IMPECCABLE_NO_BROWSER", "1")], true),
            (vec![("NO_COLOR", "1")], true),
            (vec![("CI", "true")], true),
            (vec![("TERM", "dumb")], true),
            (vec![("TERM", "xterm-256color")], false),
        ] {
            assert_eq!(plain_for(&io_with(&env)), plain, "{env:?}");
        }
    }

    // Catches a progress frame wider than the terminal, which leaves a copy behind on every redraw.
    #[test]
    fn clips_a_progress_label_to_one_row() {
        for (label, columns) in [("Scanning this repository (Ctrl-C skips it)", 40), ("Waiting for you in the browser", 120), ("x".repeat(300).as_str(), 20)] {
            let shown = clip(label, columns);
            assert!(shown.chars().count() + 4 <= columns.max(13), "{shown:?} at {columns}");
            if label.chars().count() + 5 <= columns {
                assert_eq!(shown, label);
            }
        }
    }

    // Catches a key typed before a choice appears answering it (#1536 review: a stray Enter from install's pickers
    // picked Sign in or Install Loop).
    #[cfg(unix)]
    #[test]
    fn a_key_typed_before_the_question_never_answers_it() {
        let (mut master, mut slave) = (0, 0);
        // SAFETY: openpty fills the two descriptors; they are closed below.
        assert_eq!(unsafe { libc::openpty(&mut master, &mut slave, std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut()) }, 0);
        // SAFETY: plain writes and reads on descriptors this test owns.
        unsafe {
            libc::write(master, b"\r".as_ptr().cast(), 1);
            std::thread::sleep(std::time::Duration::from_millis(50));
            discard_typeahead(slave);
            libc::fcntl(slave, libc::F_SETFL, libc::fcntl(slave, libc::F_GETFL) | libc::O_NONBLOCK);
            let mut buf = [0u8; 8];
            let read = libc::read(slave, buf.as_mut_ptr().cast(), buf.len());
            libc::close(master);
            libc::close(slave);
            assert!(read <= 0, "a queued key survived: {:?}", &buf[..read.max(0) as usize]);
        }
    }
}
