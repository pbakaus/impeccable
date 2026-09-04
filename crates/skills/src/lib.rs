//! impeccable-skills: `impeccable help|install|link|update|check` and the
//! legacy `impeccable skills <verb>` namespace, ported from
//! `cli/bin/commands/skills.mjs` (plus the slice of `cli/lib/impeccable-config.mjs`
//! it imports).
//!
//! Deliberate departures from the original JS behavior:
//!
//! 1. After a skill directory is written (fresh install, refresh, update), if
//!    its `scripts/VERSION` exists and `scripts/bin/<os>-<arch>/impeccable`
//!    does not, the matching engine binary is downloaded from this repo's
//!    `engine-v<version>` GitHub Release (`IMPECCABLE_DOWNLOAD_BASE` overrides
//!    the base URL) with `.sha256` verification, so the installed skill is
//!    self-contained. See `engine_binary`.
//! 2. Hook manifests are rewritten to invoke the launcher
//!    (`"<skill>/scripts/impeccable" hook`, `impeccable.cmd` in the Codex
//!    `commandWindows` sibling) instead of `node "<skill>/scripts/hook.mjs"`.
//!    The command forms match what `impeccable hooks on`
//!    (`impeccable_hook::admin`) writes, and both paths recognize a manifest
//!    entry as ours through `impeccable_context::hook_markers`, so the two
//!    never drift on detection. See `hook_manifest`.
//! 3. Remote skill ZIPs require an Ed25519 signature from a compiled-in key
//!    before extraction. Failure is fatal even when an existing install is
//!    present. Explicit local bundle overrides remain unsigned development
//!    inputs. See `bundle_signature` and docs/BUNDLE-SIGNING.md.
//!
//! Everything else (messages, exit codes, endpoints, flags, prompts, file
//! layout) follows the JS byte for byte.

pub mod bundle;
mod bundle_signature;
pub mod commands;
pub mod engine_binary;
pub mod hook_manifest;
pub mod prompt;
pub mod providers;
pub mod util;

use impeccable_common::Io;

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

/// JS: skills.mjs#run, wrapped in cli.js's `main().catch(...)`.
pub fn run(args: &[String], io: &mut Io) -> i32 {
    match commands::run(args, io) {
        Ok(()) => 0,
        Err(Flow::Exit(code)) => code,
        Err(Flow::Abort) => {
            io.out("\nAborted.\n");
            130
        }
        Err(Flow::Throw(msg)) => {
            io.err(&format!("{msg}\n"));
            1
        }
    }
}
