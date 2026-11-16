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
}

impl Steps {
    /// Drawn when a person can see and answer them: stdin, stdout and stderr all terminals, on unix, with colour
    /// allowed and outside CI. Anything else gets `None`, and the caller prints its plain lines.
    pub fn new(io: &Io) -> Option<Steps> {
        let prompt = Prompt::new(io);
        let terminal = prompt.interactive() && std::io::stderr().is_terminal();
        let plain = io.env("NO_COLOR").is_some() || io.env("TERM") == Some("dumb") || io.env("CI").is_some();
        (terminal && !plain).then_some(Steps { prompt })
    }

    /// `impeccable <verb>`, as `install` opens.
    pub fn header(&self, io: &mut Io, verb: &str) {
        io.err(&format!("{} {}\n\n", self.prompt.accent(&self.prompt.bold("impeccable")), self.prompt.dim(verb)));
    }

    /// `◇ title`, then each detail dim and indented under it.
    pub fn done(&self, io: &mut Io, title: &str, details: &[&str]) {
        io.err(&format!("{} {}\n", self.prompt.accent("◇"), self.prompt.bold(title)));
        for d in details {
            io.err(&format!("  {}\n", self.prompt.dim(d)));
        }
    }

    /// A link to open: its label under the step, then the address alone on a line of its own, never indented or
    /// framed, so a terminal that wraps it keeps it one piece to click or copy (a hyperlink where the terminal has them).
    pub fn link(&self, io: &mut Io, label: &str, url: &str) {
        io.err(&format!("  {}\n\n\x1b]8;;{url}\x1b\\{}\x1b]8;;\x1b\\\n\n", self.prompt.dim(label), self.prompt.accent(url)));
    }

    /// `◆ label` with a spinner, redrawn in place until the returned line is finished or dropped.
    pub fn progress(&self, io: &mut Io, label: &str) -> Progress {
        let _ = io.stderr.flush();
        let stop = Arc::new(AtomicBool::new(false));
        let text = format!("{} {}", self.prompt.accent("◆"), self.prompt.bold(label));
        let spin: Vec<String> = FRAMES.iter().map(|f| self.prompt.accent(f)).collect();
        let running = Arc::clone(&stop);
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
                    io.err(&format!("  {}{pad}  {text}\n\x1b]8;;{url}\x1b\\{}\x1b]8;;\x1b\\\n", self.prompt.dim(name), self.prompt.accent(&url)));
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
        }
    }

    /// Stop the spinner and draw the finished step in its place.
    pub fn done(mut self, steps: &Steps, io: &mut Io, title: &str, details: &[&str]) {
        self.halt();
        steps.done(io, title, details);
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
