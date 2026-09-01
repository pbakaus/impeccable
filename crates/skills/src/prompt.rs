//! The install/update prompts: `ask` (line prompt; piped answers when stdin
//! is not a TTY), and the raw-mode `promptRadio` / `promptCheckbox` sessions
//! (JS: skills.mjs `promptKeypressSession` and friends), rendered with the
//! same escape sequences so the terminal output matches.

use std::io::Write;

use impeccable_common::Io;

use crate::util::utf16_len;
use crate::{Flow, R};

/// Prompt state for one CLI run: whether the terminal can style, whether raw
/// mode prompts are possible, and the piped answers `ask` consumes when stdin
/// is not a TTY.
pub struct Prompt {
    pub stdin_tty: bool,
    pub stdout_tty: bool,
    style: bool,
    piped: Option<Vec<String>>,
}

impl Prompt {
    pub fn new(io: &Io) -> Prompt {
        let stdout_tty = stdout_is_tty();
        // JS: canStyleTerminal(): stdout TTY, NO_COLOR unset, TERM !== 'dumb'.
        let style = stdout_tty
            && io.env("NO_COLOR").is_none()
            && io.env("TERM") != Some("dumb");
        Prompt { stdin_tty: io.stdin_is_tty, stdout_tty, style, piped: None }
    }

    /// JS: isInteractivePrompt()
    pub fn interactive(&self) -> bool {
        self.stdin_tty && self.stdout_tty && cfg!(unix)
    }

    fn ansi(&self, open: &str, close: &str, value: &str) -> String {
        if self.style {
            format!("{open}{value}{close}")
        } else {
            value.to_string()
        }
    }
    pub fn accent(&self, v: &str) -> String {
        self.ansi("\x1b[36m", "\x1b[0m", v)
    }
    pub fn bold(&self, v: &str) -> String {
        self.ansi("\x1b[1m", "\x1b[22m", v)
    }
    pub fn dim(&self, v: &str) -> String {
        self.ansi("\x1b[2m", "\x1b[22m", v)
    }
    pub fn good(&self, v: &str) -> String {
        self.ansi("\x1b[32m", "\x1b[0m", v)
    }

    /// JS: ask(question): trimmed, lowercased answer. Non-TTY stdin: the
    /// question is echoed to stdout and answers come one per line from the
    /// whole of stdin (blank when exhausted).
    pub fn ask(&mut self, io: &mut Io, question: &str) -> R<String> {
        if !self.stdin_tty {
            io.out(question);
            if self.piped.is_none() {
                let input = io.stdin().to_string();
                let mut lines: Vec<String> = input.split('\n').map(|l| l.strip_suffix('\r').unwrap_or(l).to_string()).collect();
                lines.reverse();
                self.piped = Some(lines);
            }
            let next = self.piped.as_mut().and_then(|v| v.pop()).unwrap_or_default();
            return Ok(next.trim().to_lowercase());
        }
        if self.stdout_tty && io.env("TERM") != Some("dumb") {
            return self.tty_readline(io, question);
        }
        io.out(question);
        let _ = io.stdout.flush();
        let mut line = String::new();
        match std::io::stdin().read_line(&mut line) {
            Ok(_) => Ok(line.trim().to_lowercase()),
            Err(_) => Err(Flow::Abort),
        }
    }

    /// Node's `readline.question` on a TTY: raw mode (its own echo), the
    /// prompt painted through `_refreshLine` (column 1, clear to end of
    /// screen, prompt + line, cursor placed after it), backspace / Ctrl-U
    /// editing that repaints the line, `\r\n` on Enter (the terminal's
    /// ONLCR turns it into `\r\r\n`, exactly what Node's raw mode produces),
    /// Ctrl-C = the JS `SIGINT` -> prompt abort.
    fn tty_readline(&mut self, io: &mut Io, question: &str) -> R<String> {
        let mut session = KeypressSession::start_raw(io)?;
        let mut line = String::new();
        let refresh = |io: &mut Io, line: &str| {
            io.out(&format!("\x1b[1G\x1b[0J{question}{line}\x1b[{}G", utf16_len(question) + utf16_len(line) + 1));
            let _ = io.stdout.flush();
        };
        refresh(io, &line);
        loop {
            let Some(key) = session.next_key() else {
                session.cleanup(io);
                return Err(Flow::Abort);
            };
            match key {
                Key::CtrlC => {
                    session.cleanup(io);
                    return Err(Flow::Abort);
                }
                Key::Enter => {
                    io.out("\r\n");
                    let _ = io.stdout.flush();
                    session.cleanup(io);
                    return Ok(line.trim().to_lowercase());
                }
                Key::Backspace | Key::Delete | Key::Del => {
                    if line.pop().is_some() {
                        refresh(io, &line);
                    }
                }
                Key::CtrlU => {
                    if !line.is_empty() {
                        line.clear();
                        refresh(io, &line);
                    }
                }
                Key::CtrlD => {
                    // readline closes on Ctrl-D at an empty line; the JS
                    // question never resolves and Node exits 0 quietly.
                    if line.is_empty() {
                        session.cleanup(io);
                        return Err(Flow::Exit(0));
                    }
                }
                Key::Char(c) => {
                    line.push(c);
                    io.out(&c.to_string());
                    let _ = io.stdout.flush();
                }
                _ => {}
            }
        }
    }

    /// JS: promptRadio(message, options, {initialIndex})
    pub fn radio(&mut self, io: &mut Io, message: &str, options: &[RadioOption], initial_index: usize) -> R<usize> {
        let mut cursor = clamp_index(initial_index as isize, options.len());
        let render = |this: &Prompt, cursor: usize| -> Vec<String> {
            let mut lines = vec![format!("{} {}", this.accent("◆"), this.bold(message)), String::new()];
            for (index, option) in options.iter().enumerate() {
                let active = index == cursor;
                let pointer = if active { this.accent("›") } else { " ".to_string() };
                let mark = if active { this.good("●") } else { this.dim("○") };
                let label = if active { this.bold(&option.label) } else { option.label.clone() };
                let hint = match &option.hint {
                    Some(h) => format!(" {}", this.dim(h)),
                    None => String::new(),
                };
                lines.push(format!("  {pointer} {mark} {label}{hint}"));
            }
            lines.push(String::new());
            lines.push(format!("  {}", this.dim("↑/↓ move, enter confirm")));
            lines
        };
        let mut session = KeypressSession::start(io)?;
        session.render(io, &render(self, cursor));
        loop {
            let key = match session.next_key() {
                Some(k) => k,
                None => {
                    session.cleanup(io);
                    return Err(Flow::Abort);
                }
            };
            match key {
                Key::CtrlC => {
                    session.cleanup(io);
                    return Err(Flow::Abort);
                }
                Key::Up | Key::Char('k') | Key::Char('K') => cursor = clamp_index(cursor as isize - 1, options.len()),
                Key::Down | Key::Char('j') | Key::Char('J') => cursor = clamp_index(cursor as isize + 1, options.len()),
                Key::Enter => {
                    session.render(io, &render(self, cursor));
                    session.cleanup(io);
                    return Ok(cursor);
                }
                _ => {}
            }
            session.render(io, &render(self, cursor));
        }
    }

    /// JS: promptCheckbox(message, options, {selectedValues}). Returns the
    /// indices of the selected options, in option order.
    pub fn checkbox(&mut self, io: &mut Io, message: &str, options: &[CheckboxOption], selected_values: &[usize]) -> R<Vec<usize>> {
        let mut selected: Vec<usize> = selected_values.to_vec();
        let mut cursor: usize = 0;
        let mut error = String::new();
        let mut query = String::new();
        let rows = terminal_rows().unwrap_or(24) as isize;
        let max_visible = std::cmp::max(5, std::cmp::min(options.len() as isize, std::cmp::min(rows - 9, 10))) as usize;

        let filtered_options = |query: &str| -> Vec<usize> {
            let needle = query.trim().to_lowercase();
            if needle.is_empty() {
                return (0..options.len()).collect();
            }
            (0..options.len())
                .filter(|i| options[*i].search_text.to_lowercase().contains(&needle))
                .collect()
        };
        let selected_summary = |this: &Prompt, selected: &[usize]| -> String {
            let labels: Vec<&str> = (0..options.len())
                .filter(|i| selected.contains(i))
                .map(|i| options[i].label.as_str())
                .collect();
            if labels.is_empty() {
                return this.dim("none");
            }
            if labels.len() <= 4 {
                return labels.join(", ");
            }
            format!("{} {}", labels[..4].join(", "), this.dim(&format!("+{} more", labels.len() - 4)))
        };
        let render = |this: &Prompt, cursor: &mut usize, selected: &[usize], query: &str, error: &str| -> Vec<String> {
            let filtered = filtered_options(query);
            *cursor = clamp_index(*cursor as isize, filtered.len());
            let (start, end) = visible_window(*cursor, filtered.len(), max_visible);
            let mut lines = vec![
                format!("{} {}", this.accent("◆"), this.bold(message)),
                String::new(),
                format!("  Search: {}", if query.is_empty() { this.dim("type to filter") } else { query.to_string() }),
                format!("  {}", this.dim("↑/↓ move, space select, enter confirm")),
                String::new(),
            ];
            if filtered.is_empty() {
                lines.push(format!("  {}", this.dim("No matches")));
            } else if filtered.len() > max_visible {
                lines.push(format!("  {}", this.dim(&format!("Showing {}-{} of {}", start + 1, end, filtered.len()))));
            }
            if !filtered.is_empty() {
                for index in start..end {
                    let option = &options[filtered[index]];
                    let active = index == *cursor;
                    let pointer = if active { this.accent("›") } else { " ".to_string() };
                    let mark = if selected.contains(&filtered[index]) { this.good("●") } else { this.dim("○") };
                    let label = if active { this.bold(&option.label) } else { option.label.clone() };
                    let hint = match &option.hint {
                        Some(h) => format!(" {}", this.dim(h)),
                        None => String::new(),
                    };
                    lines.push(format!("  {pointer} {mark} {label}{hint}"));
                }
            }
            lines.push(String::new());
            lines.push(format!("  Selected: {}", selected_summary(this, selected)));
            if !error.is_empty() {
                lines.push(format!("  {error}"));
            }
            lines
        };

        let mut session = KeypressSession::start(io)?;
        let lines = render(self, &mut cursor, &selected, &query, &error);
        session.render(io, &lines);
        loop {
            let key = match session.next_key() {
                Some(k) => k,
                None => {
                    session.cleanup(io);
                    return Err(Flow::Abort);
                }
            };
            let filtered = filtered_options(&query);
            match key {
                Key::CtrlC => {
                    session.cleanup(io);
                    return Err(Flow::Abort);
                }
                Key::Up => cursor = clamp_index(cursor as isize - 1, filtered.len()),
                Key::Down => cursor = clamp_index(cursor as isize + 1, filtered.len()),
                Key::Char(' ') => {
                    if let Some(&idx) = filtered.get(cursor) {
                        if let Some(pos) = selected.iter().position(|s| *s == idx) {
                            selected.remove(pos);
                        } else {
                            selected.push(idx);
                        }
                        error.clear();
                    }
                }
                Key::Backspace | Key::Delete | Key::Del => {
                    query.pop();
                    cursor = 0;
                    error.clear();
                    // JS-PARITY: promptCheckbox's printable-character test is
                    // `str >= '!'`, which the DEL byte (0x7f) also passes, so a
                    // Backspace that arrives as DEL removes one character and
                    // then appends U+007F to the filter, exactly as the JS does.
                    if matches!(key, Key::Del) {
                        query.push('\x7f');
                    }
                }
                Key::CtrlU => {
                    query.clear();
                    cursor = 0;
                    error.clear();
                }
                Key::Char(c) if c >= '!' && utf16_len(&c.to_string()) == 1 => {
                    query.push(c);
                    cursor = 0;
                    error.clear();
                }
                Key::Enter => {
                    if selected.is_empty() {
                        error = self.dim("Choose at least one harness.");
                        let lines = render(self, &mut cursor, &selected, &query, &error);
                        session.render(io, &lines);
                        continue;
                    }
                    let lines = render(self, &mut cursor, &selected, &query, &error);
                    session.render(io, &lines);
                    session.cleanup(io);
                    let mut out: Vec<usize> = (0..options.len()).filter(|i| selected.contains(i)).collect();
                    out.dedup();
                    return Ok(out);
                }
                _ => {}
            }
            let lines = render(self, &mut cursor, &selected, &query, &error);
            session.render(io, &lines);
        }
    }
}

pub struct RadioOption {
    pub label: String,
    pub hint: Option<String>,
}

pub struct CheckboxOption {
    pub label: String,
    pub hint: Option<String>,
    pub search_text: String,
}

/// JS: clampIndex(index, length)
fn clamp_index(index: isize, length: usize) -> usize {
    if length == 0 {
        return 0;
    }
    if index < 0 {
        return length - 1;
    }
    if index as usize >= length {
        return 0;
    }
    index as usize
}

/// JS: visibleWindow(cursor, total, maxVisible)
fn visible_window(cursor: usize, total: usize, max_visible: usize) -> (usize, usize) {
    let visible = std::cmp::max(1, std::cmp::min(total, max_visible));
    let mut start = cursor.saturating_add(1).saturating_sub(visible);
    if cursor < start {
        start = cursor;
    }
    start = std::cmp::min(start, total.saturating_sub(visible));
    (start, start + visible)
}

enum Key {
    Up,
    Down,
    Enter,
    /// `\b` (Ctrl-H) or the `\x1b[3~` delete key.
    Backspace,
    /// The DEL byte (0x7f) most terminals send for Backspace. Kept apart
    /// from `Backspace` for one JS-parity quirk in the checkbox filter.
    Del,
    Delete,
    CtrlC,
    CtrlU,
    CtrlD,
    Char(char),
    Other,
}

/// A raw-mode keypress session over the real terminal (JS:
/// promptKeypressSession). Renders by moving the cursor up over the previous
/// frame and rewriting each line.
struct KeypressSession {
    last_line_count: usize,
    done: bool,
    hid_cursor: bool,
    #[cfg(unix)]
    saved: libc::termios,
}

impl KeypressSession {
    /// Raw mode plus the hidden cursor of the JS `promptKeypressSession`.
    fn start(io: &mut Io) -> R<KeypressSession> {
        let mut s = Self::start_raw(io)?;
        s.hid_cursor = true;
        io.out("\x1b[?25l");
        let _ = io.stdout.flush();
        Ok(s)
    }

    /// Raw mode only (readline's `setRawMode(true)`).
    fn start_raw(io: &mut Io) -> R<KeypressSession> {
        let _ = &io;
        #[cfg(unix)]
        {
            let mut saved: libc::termios = unsafe { std::mem::zeroed() };
            if unsafe { libc::tcgetattr(0, &mut saved) } != 0 {
                return Err(Flow::Throw("Failed to enter raw mode".to_string()));
            }
            // libuv UV_TTY_MODE_RAW.
            let mut raw = saved;
            raw.c_iflag &= !(libc::BRKINT | libc::ICRNL | libc::INPCK | libc::ISTRIP | libc::IXON);
            raw.c_oflag |= libc::ONLCR;
            raw.c_cflag |= libc::CS8;
            raw.c_lflag &= !(libc::ECHO | libc::ICANON | libc::IEXTEN | libc::ISIG);
            raw.c_cc[libc::VMIN] = 1;
            raw.c_cc[libc::VTIME] = 0;
            unsafe { libc::tcsetattr(0, libc::TCSADRAIN, &raw) };
            Ok(KeypressSession { last_line_count: 0, done: false, saved, hid_cursor: false })
        }
        #[cfg(not(unix))]
        {
            let _ = io;
            Err(Flow::Throw("Interactive prompts are not supported on this platform".to_string()))
        }
    }

    fn render(&mut self, io: &mut Io, lines: &[String]) {
        if self.last_line_count > 0 {
            io.out(&format!("\x1b[{}A", self.last_line_count));
        }
        let line_count = std::cmp::max(self.last_line_count, lines.len());
        for index in 0..line_count {
            let line = lines.get(index).map(String::as_str).unwrap_or("");
            io.out(&format!("\x1b[2K\r{line}\n"));
        }
        self.last_line_count = line_count;
        let _ = io.stdout.flush();
    }

    fn cleanup(&mut self, io: &mut Io) {
        if self.done {
            return;
        }
        self.done = true;
        #[cfg(unix)]
        unsafe {
            libc::tcsetattr(0, libc::TCSADRAIN, &self.saved);
        }
        if self.hid_cursor {
            io.out("\x1b[?25h");
        }
        let _ = io.stdout.flush();
    }

    /// One decoded keypress; `None` on EOF / read error.
    fn next_key(&mut self) -> Option<Key> {
        let b = read_byte()?;
        Some(match b {
            0x03 => Key::CtrlC,
            0x04 => Key::CtrlD,
            0x15 => Key::CtrlU,
            b'\r' | b'\n' => Key::Enter,
            0x7f => Key::Del,
            0x08 => Key::Backspace,
            0x1b => {
                // Escape sequence: `[A`/`[B` arrows, `[3~` delete; a lone ESC
                // (no follow-up within a beat) is just ESC.
                if !byte_ready(50) {
                    return Some(Key::Other);
                }
                let Some(second) = read_byte() else { return Some(Key::Other) };
                if second != b'[' && second != b'O' {
                    return Some(Key::Other);
                }
                let Some(third) = read_byte() else { return Some(Key::Other) };
                match third {
                    b'A' => Key::Up,
                    b'B' => Key::Down,
                    b'3' => {
                        // consume the trailing `~`
                        if byte_ready(50) {
                            let _ = read_byte();
                        }
                        Key::Delete
                    }
                    b'0'..=b'9' => {
                        // consume the rest of a CSI sequence
                        while byte_ready(50) {
                            match read_byte() {
                                Some(c) if (0x40..=0x7e).contains(&c) => break,
                                Some(_) => continue,
                                None => break,
                            }
                        }
                        Key::Other
                    }
                    _ => Key::Other,
                }
            }
            b if b < 0x20 => Key::Other,
            b => {
                // UTF-8 lead byte: gather the continuation bytes.
                let len = if b < 0x80 {
                    1
                } else if b >> 5 == 0b110 {
                    2
                } else if b >> 4 == 0b1110 {
                    3
                } else if b >> 3 == 0b11110 {
                    4
                } else {
                    1
                };
                let mut buf = vec![b];
                for _ in 1..len {
                    match read_byte() {
                        Some(c) => buf.push(c),
                        None => break,
                    }
                }
                match std::str::from_utf8(&buf).ok().and_then(|s| s.chars().next()) {
                    Some(c) => Key::Char(c),
                    None => Key::Other,
                }
            }
        })
    }
}

impl Drop for KeypressSession {
    fn drop(&mut self) {
        #[cfg(unix)]
        if !self.done {
            unsafe {
                libc::tcsetattr(0, libc::TCSADRAIN, &self.saved);
            }
            if self.hid_cursor {
                let mut out = std::io::stdout();
                let _ = out.write_all(b"\x1b[?25h");
                let _ = out.flush();
            }
        }
    }
}

/// One byte straight from fd 0. Deliberately not `std::io::stdin()`: its
/// BufReader would slurp a whole escape sequence into a buffer `poll` cannot
/// see, so a lone ESC and an arrow key would be indistinguishable.
fn read_byte() -> Option<u8> {
    let mut buf = [0u8; 1];
    #[cfg(unix)]
    {
        loop {
            let n = unsafe { libc::read(0, buf.as_mut_ptr() as *mut libc::c_void, 1) };
            if n == 1 {
                return Some(buf[0]);
            }
            if n < 0 && std::io::Error::last_os_error().kind() == std::io::ErrorKind::Interrupted {
                continue;
            }
            return None;
        }
    }
    #[cfg(not(unix))]
    {
        use std::io::Read;
        match std::io::stdin().lock().read(&mut buf) {
            Ok(1) => Some(buf[0]),
            _ => None,
        }
    }
}

/// True when a byte is readable on stdin within `ms` milliseconds.
fn byte_ready(ms: i32) -> bool {
    #[cfg(unix)]
    {
        let mut fds = libc::pollfd { fd: 0, events: libc::POLLIN, revents: 0 };
        unsafe { libc::poll(&mut fds, 1, ms) > 0 }
    }
    #[cfg(not(unix))]
    {
        let _ = ms;
        false
    }
}

/// `process.stdout.isTTY`.
pub fn stdout_is_tty() -> bool {
    #[cfg(unix)]
    {
        unsafe { libc::isatty(1) == 1 }
    }
    #[cfg(not(unix))]
    {
        std::io::IsTerminal::is_terminal(&std::io::stdout())
    }
}

/// `process.stdout.rows`.
fn terminal_rows() -> Option<u16> {
    #[cfg(unix)]
    {
        let mut ws: libc::winsize = unsafe { std::mem::zeroed() };
        if unsafe { libc::ioctl(1, libc::TIOCGWINSZ, &mut ws) } == 0 && ws.ws_row > 0 {
            return Some(ws.ws_row);
        }
        None
    }
    #[cfg(not(unix))]
    {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamp_and_window() {
        assert_eq!(clamp_index(-1, 3), 2);
        assert_eq!(clamp_index(3, 3), 0);
        assert_eq!(clamp_index(1, 3), 1);
        assert_eq!(clamp_index(0, 0), 0);
        assert_eq!(visible_window(0, 16, 10), (0, 10));
        assert_eq!(visible_window(12, 16, 10), (3, 13));
        assert_eq!(visible_window(15, 16, 10), (6, 16));
        assert_eq!(visible_window(2, 3, 10), (0, 3));
    }
}
