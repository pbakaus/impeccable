//! JS: live-target.mjs. Library only (`resolveLiveTarget`); running the
//! script directly does nothing, so the verb prints nothing and exits 0.

use crate::util::{jsp, Env};
use impeccable_common::Io;
use impeccable_context::context::resolve_project_root;
use impeccable_context::target_args::{parse_target_path, TargetOptions};

pub struct LiveTarget {
    pub original_cwd: String,
    pub project_root: String,
    pub target_path: Option<String>,
    pub absolute_target_path: Option<String>,
    pub target_options: TargetOptions,
}

/// JS: resolveLiveTarget(cwd, args). `Err(msg)` is the strict `--target`
/// error the caller prints to stderr before exiting 1.
pub fn resolve_live_target(cwd: &str, args: &[String], env: &Env) -> Result<LiveTarget, String> {
    let original_cwd = jsp::resolve(cwd, &[]);
    let target_path = parse_target_path(args, true)?;
    let absolute = target_path.as_ref().map(|t| {
        if jsp::is_absolute(t) {
            t.clone()
        } else {
            jsp::resolve(&original_cwd, &[t])
        }
    });
    let target_options = TargetOptions {
        target_path: absolute.clone(),
    };
    let project_root = match &absolute {
        Some(_) => resolve_project_root(&original_cwd, &target_options, env),
        None => original_cwd.clone(),
    };
    Ok(LiveTarget {
        original_cwd,
        project_root,
        target_path,
        absolute_target_path: absolute,
        target_options,
    })
}

/// `impeccable live-target`: no CLI entry in the JS module.
pub fn run(_args: &[String], _io: &mut Io) -> i32 {
    0
}
