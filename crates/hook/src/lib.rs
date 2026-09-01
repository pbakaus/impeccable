//! impeccable-hook: the design hook verbs (`hook`, `hook-before-edit`,
//! `hooks` / `hook-admin`), ported from `skill/scripts/hook.mjs`,
//! `hook-before-edit.mjs`, `hook-admin.mjs`, and `hook-lib.mjs`.
//!
//! The regex engine and design-system loader come from `impeccable-detect`;
//! the static HTML engine is reached through the `HtmlEngine` seam the `cli`
//! binary wires in (crates/html), so `.html` targets and configured
//! html-engine template extensions get the same DOM rules the JS applied.
//! The native-platform gate reads PRODUCT.md through `impeccable-context`'s
//! `resolve_context` / `extract_platform` (only the platform is observable,
//! so the rest of `loadContext` is skipped).

pub mod admin;
pub mod before_edit;
pub mod hook;
pub mod hook_lib;
pub mod util;

use impeccable_common::Io;
use impeccable_detect::engines::HtmlEngine;

pub use hook_lib::Runtime;

fn runtime<'a>(io: &Io, html: &'a dyn HtmlEngine) -> Runtime<'a> {
    let cwd = io.cwd.to_string_lossy().into_owned();
    let provider = impeccable_context::provider::detect(&io.env, &cwd);
    Runtime::new(
        cwd,
        io.env.clone(),
        provider.command,
        &provider.self_cmd,
        html,
    )
}

/// `impeccable hook` (PostToolUse per-edit pass + Stop deep pass). Exit 0.
pub fn run_hook(_args: &[String], io: &mut Io, html: &dyn HtmlEngine) -> i32 {
    let stdin = io.stdin().to_string();
    let rt = runtime(io, html);
    hook::run(&rt, &stdin, io)
}

/// `impeccable hook-before-edit` (Cursor preToolUse gate). Exit 0.
pub fn run_hook_before_edit(_args: &[String], io: &mut Io, html: &dyn HtmlEngine) -> i32 {
    let stdin = io.stdin().to_string();
    let rt = runtime(io, html);
    before_edit::run(&rt, &stdin, io)
}

/// `impeccable hooks <action> [args]` (hook-admin.mjs).
pub fn run_hook_admin(args: &[String], io: &mut Io) -> i32 {
    static NONE: impeccable_detect::MissingHtmlEngine = impeccable_detect::MissingHtmlEngine;
    let rt = runtime(io, &NONE);
    admin::run(&rt, args, io)
}
