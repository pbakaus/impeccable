//! JS: surface-brief.mjs -> `impeccable surface-brief`

use crate::context::resolve_project_root;
use crate::jsp;
use crate::surface_briefs::*;
use crate::target_args::TargetOptions;
use crate::util::{json_pretty, node_read_error};
use impeccable_common::Io;
use serde_json::{Map, Value};

fn summary(brief: &SurfaceBrief, project_root: &str) -> Value {
    let mut m = Map::new();
    m.insert("slug".into(), brief.slug.clone().map(Value::String).unwrap_or(Value::Null));
    m.insert("path".into(), Value::String(jsp::to_posix(&jsp::relative("/", project_root, brief.path.as_deref().unwrap_or("")))));
    m.insert("primaryTarget".into(), brief.primary_target.clone().map(Value::String).unwrap_or(Value::Null));
    m.insert("relatedTargets".into(), Value::Array(brief.related_targets.iter().cloned().map(Value::String).collect()));
    Value::Object(m)
}

pub fn run(args: &[String], io: &mut Io) -> i32 {
    let cwd = io.cwd.to_string_lossy().into_owned();
    let env = io.env.clone();
    let command = args.first().map(String::as_str);
    let target = args.get(1).map(String::as_str).filter(|s| !s.is_empty());
    let body_file = args.get(2).map(String::as_str).filter(|s| !s.is_empty());
    let related: Vec<String> = if args.len() > 3 { args[3..].to_vec() } else { vec![] };
    let opts = TargetOptions { target_path: target.map(|t| t.to_string()) };
    let project_root = resolve_project_root(&cwd, &opts, &env);
    let rel_out = |p: &str| -> String {
        let r = jsp::relative(&cwd, &cwd, p);
        if r.is_empty() {
            p.to_string()
        } else {
            r
        }
    };
    match command {
        Some("path") => {
            let Some(fp) = surface_brief_path_for_target(target, &project_root) else {
                io.err("surface brief path requires a concrete target\n");
                return 1;
            };
            io.out(&format!("{}\n", rel_out(&fp)));
            0
        }
        Some("list") => {
            let rows: Vec<Value> = list_surface_briefs(&project_root).iter().map(|b| summary(b, &project_root)).collect();
            io.out(&format!("{}\n", json_pretty(&Value::Array(rows))));
            0
        }
        Some("read") => {
            let result = resolve_surface_brief(&project_root, target);
            if let Some(b) = result.brief {
                io.out(&b.text);
                return 0;
            }
            if !result.candidates.is_empty() {
                let rows: Vec<Value> = result.candidates.iter().map(|b| summary(b, &project_root)).collect();
                io.err(&format!("{}\n", json_pretty(&Value::Array(rows))));
            }
            2
        }
        Some("write") => {
            let (Some(t), Some(bf)) = (target, body_file) else {
                io.err("usage: impeccable surface-brief write <primary-target> <body-file>\n");
                return 1;
            };
            let body = match std::fs::read(bf) {
                Ok(b) => String::from_utf8_lossy(&b).into_owned(),
                Err(e) => {
                    io.err(&format!("{}\n", node_read_error(bf, &e)));
                    return 1;
                }
            };
            match write_surface_brief(&project_root, t, &related, &body) {
                Ok(fp) => {
                    io.out(&format!("{}\n", rel_out(&fp)));
                    0
                }
                Err(msg) => {
                    io.err(&format!("{}\n", msg));
                    1
                }
            }
        }
        _ => {
            io.err("usage: impeccable surface-brief <path|list|read|write> [target] [body-file] [related-target ...]\n");
            1
        }
    }
}
