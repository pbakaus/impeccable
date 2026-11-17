//! How a verb leaves a prompt (moved from impeccable-skills with `prompt`).

/// How a JS code path leaves the verb: `process.exit(code)`, a thrown
/// `PromptAbortError` (cli.js prints `\nAborted.` and exits 130), or any
/// other uncaught throw (cli.js prints the message to stderr and exits 1).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Flow {
    Exit(i32),
    Abort,
    Throw(String),
}

pub type R<T> = Result<T, Flow>;
