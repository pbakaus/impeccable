//! `impeccable` binary: verb router.
//!
//! Every skill script and CLI subcommand is a verb here. Verb crates expose
//! `run(args: &[String], io: &mut Io) -> i32` (exit code) and never call
//! `std::process::exit` themselves, so this file is the single place exit codes
//! and stream flushing are decided (contract: docs/CLI-CONTRACT.md in the
//! public repo). Verb names are the JS script basenames; a few carry aliases
//! (`signals` for context-signals, `hooks` for hook-admin).

use std::io::Write;

use impeccable_common::Io;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut io = Io::stdio();
    let code = impeccable::run(&args, &mut io, impeccable::InstalledPack::NONE);
    let _ = io.stdout.flush();
    let _ = io.stderr.flush();
    std::process::exit(code);
}
