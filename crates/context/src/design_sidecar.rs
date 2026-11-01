//! Content provenance for DESIGN.md sidecars. Checking never writes a stamp.
use crate::artifact_schema::DESIGN_SIDECAR_SCHEMA_VERSION;
use crate::context::resolve_context;
use crate::jsp;
use crate::target_args::parse_target_options;
use impeccable_common::{fsx::write_atomic, Io};
use serde_json::Value;
pub use impeccable_common::design_fingerprint::{fingerprint, matches_source};
use std::{fs, path::Path};

/// Call only after document has written or reviewed the sidecar against source.
/// Refuse missing/malformed/old-schema sidecars; never fabricate their contents.
pub fn stamp(design: &Path, sidecar: &Path) -> Result<(), String> {
    let source = fs::read(design).map_err(|e| format!("Cannot read {}: {e}", design.display()))?;
    let original =
        fs::read(sidecar).map_err(|e| format!("Cannot read {}: {e}", sidecar.display()))?;
    let mut value: Value =
        serde_json::from_slice(&original).map_err(|e| format!("Invalid sidecar JSON: {e}"))?;
    if value.get("schemaVersion").and_then(Value::as_u64)
        != Some(DESIGN_SIDECAR_SCHEMA_VERSION as u64)
    {
        return Err(format!("Review and write a schemaVersion {DESIGN_SIDECAR_SCHEMA_VERSION} sidecar with document before stamping."));
    }
    value["designMdFingerprint"] = fingerprint(&source);
    let mut output = serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?;
    output.push(b'\n');
    // Do not certify a different source or overwrite a concurrent sidecar edit.
    if fs::read(design).ok().as_deref() != Some(source.as_slice())
        || fs::read(sidecar).ok().as_deref() != Some(original.as_slice())
    {
        return Err("Design files changed while stamping; review them and retry.".into());
    }
    if output != original {
        write_atomic(sidecar, &output)
            .map_err(|e| format!("Cannot write {}: {e}", sidecar.display()))?;
    }
    Ok(())
}

const USAGE: &str = "Usage: impeccable design-sidecar stamp [--target <path>]\n\nAfter document writes or reviews .impeccable/design.json, stamp its DESIGN.md\ncontent fingerprint. Never use this command just to dismiss a stale warning.\n";

pub fn run(args: &[String], io: &mut Io) -> i32 {
    if args.iter().any(|s| s == "--help" || s == "-h") {
        io.out(USAGE);
        return 0;
    }
    if args.first().map(String::as_str) != Some("stamp") {
        io.err(USAGE);
        return 1;
    }
    let rest = &args[1..];
    let mut i = 0;
    while i < rest.len() {
        match rest[i].as_str() {
            "--target" | "-t" => i += 2,
            s if s.starts_with("--target=") => i += 1,
            s => {
                io.err(&format!("Unknown argument: {s}\n{USAGE}"));
                return 1;
            }
        }
    }
    let options = match parse_target_options(rest, true) {
        Ok(o) => o,
        Err(e) => {
            io.err(&format!("{e}\n"));
            return 1;
        }
    };
    let ctx = resolve_context(&io.cwd.to_string_lossy(), &options, &io.env);
    let Some(design) = ctx.design_path else {
        io.err("No DESIGN.md found. Run document first.\n");
        return 1;
    };
    let sidecar = jsp::join(&[&ctx.project_root, ".impeccable", "design.json"]);
    match stamp(Path::new(&design), Path::new(&sidecar)) {
        Ok(()) => {
            io.out("Stamped DESIGN.md content fingerprint in .impeccable/design.json.\n");
            0
        }
        Err(e) => {
            io.err(&format!("{e}\n"));
            1
        }
    }
}
