//! JS: live-discard-manual-edits.mjs -> `impeccable
//! live-discard-manual-edits`. Drops pending manual edits from the buffer
//! without touching source files.

use crate::event_validation::truthy;
use crate::live_commit_manual_edits::arg_val;
use crate::manual_edits::buffer::{read_buffer, remove_entries, truncate_buffer};
use crate::util::{json_compact, println};
use impeccable_common::Io;
use serde_json::{json, Map, Value};

pub fn run(args: &[String], io: &mut Io) -> i32 {
    if args.iter().any(|a| a == "--help" || a == "-h") {
        println(
            io,
            "Usage: impeccable live-discard-manual-edits [--page-url=<url>]",
        );
        return 0;
    }

    let cwd = io.cwd.to_string_lossy().into_owned();
    let env = io.env.clone();
    let page_url_filter = arg_val(args, "--page-url");

    let buffer = read_buffer(&cwd, &env);
    let (entries, discarded) = if truthy(Some(&page_url_filter)) {
        let matches = |entry: &Value| entry.get("pageUrl") == Some(&page_url_filter);
        let entries: Vec<Value> = buffer
            .entries
            .iter()
            .filter(|e| matches(e))
            .cloned()
            .collect();
        let discarded = remove_entries(&cwd, &env, matches).unwrap_or(0);
        (entries, discarded)
    } else {
        let entries = buffer.entries.clone();
        let discarded = truncate_buffer(&cwd, &env).unwrap_or(0);
        (entries, discarded)
    };

    let remaining: usize = read_buffer(&cwd, &env)
        .entries
        .iter()
        .map(|e| {
            e.get("ops")
                .and_then(|o| o.as_array())
                .map(|a| a.len())
                .unwrap_or(0)
        })
        .sum();

    let mut m = Map::new();
    m.insert("discarded".into(), json!(discarded));
    m.insert("entries".into(), Value::Array(entries));
    m.insert("totalCount".into(), json!(remaining));
    println(io, &json_compact(&Value::Object(m)));
    0
}
