//! Live mode: the shared model (roots, paths, config, journal, session store,
//! framework injection, gitignore block, preflight) and the verbs `live`,
//! `live-target`, `live-status`, `live-resume`, `live-complete`,
//! `live-inject`. Parts 2/3 add wrap/insert/accept and the server/poll verbs
//! on top of these modules.

pub mod accept_css;
pub mod accept_verify;
pub mod browser_assets;
pub mod config;
pub mod copy_edit_agent;
pub mod design_md;
pub mod event_validation;
pub mod gitignore;
pub mod inject;
pub mod instructions;
pub mod journal;
pub mod json_error;
pub mod live_http;
pub mod manifests;
pub mod manual_edits;
pub mod paths;
pub mod pending_edits;
pub mod preflight;
pub mod project_ignores;
pub mod random;
pub mod roots;
pub mod server;
pub mod server_state;
pub mod session;
pub mod source_lock;
pub mod source_search;
pub mod svelte_ast;
pub mod svelte_bridge;
pub mod svelte_component;
pub mod svelte_sessions;
pub mod util;
pub mod vocabulary;
pub mod wrap_common;

pub mod live_accept;
pub mod live_boot;
pub mod live_commit_manual_edits;
pub mod live_complete;
pub mod live_discard_manual_edits;
pub mod live_generate;
pub mod live_inject;
pub mod live_insert;
pub mod live_poll;
pub mod live_resume;
pub mod live_server;
pub mod live_status;
pub mod live_target;
pub mod live_wrap;

use impeccable_common::Io;

/// Verb dispatcher for every `live*` verb. Unknown live verbs (parts 2/3
/// until they land) report `not implemented` with exit 70.
pub fn run(verb: &str, args: &[String], io: &mut Io) -> i32 {
    match verb {
        "live" => live_boot::run(args, io),
        "live-target" => live_target::run(args, io),
        "live-status" | "status" => live_status::run(args, io),
        "live-resume" | "resume" => live_resume::run(args, io),
        "live-complete" | "complete" => live_complete::run(args, io),
        "live-inject" | "inject" => live_inject::run(args, io),
        "live-wrap" | "wrap" => live_wrap::run(args, io),
        "live-insert" | "insert" => live_insert::run(args, io),
        "live-accept" | "accept" => live_accept::run(args, io),
        "live-server" => live_server::run(args, io),
        "live-generate" => live_generate::run(args, io),
        "live-poll" | "poll" => live_poll::run(args, io),
        "live-commit-manual-edits" | "commit-manual-edits" => {
            live_commit_manual_edits::run(args, io)
        }
        "live-discard-manual-edits" | "discard-manual-edits" => {
            live_discard_manual_edits::run(args, io)
        }
        other => {
            io.err(&format!(
                "impeccable: verb '{}' is not implemented yet\n",
                other
            ));
            70
        }
    }
}
