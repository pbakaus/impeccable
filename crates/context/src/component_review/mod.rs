//! Component review is an explicit, opt-in runtime. It does not yet replace the build-phase gates.
pub mod capture;
mod history;
mod manifest;
mod server;
mod store;
#[cfg(test)]
mod tests;
pub mod verify;
mod visual_approval;
use impeccable_common::Io;
use serde_json::json;
use std::path::PathBuf;
fn arg(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|v| v == name)
        .and_then(|i| args.get(i + 1))
        .cloned()
}
fn decode_path(s: &str) -> Result<String, String> {
    let mut out = Vec::new();
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len() {
                return Err("bad path escape".into());
            }
            let pair = std::str::from_utf8(&bytes[i + 1..i + 3]).map_err(|e| e.to_string())?;
            out.push(u8::from_str_radix(pair, 16).map_err(|e| e.to_string())?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    let decoded = String::from_utf8(out).map_err(|e| e.to_string())?;
    if decoded.chars().any(char::is_control) {
        return Err("control character in path".into());
    }
    Ok(decoded)
}
pub fn run(args: &[String], io: &mut Io) -> i32 {
    run_with_capturer(args, io, None)
}
pub fn run_with_capturer(
    args: &[String],
    io: &mut Io,
    mut capturer: Option<&mut dyn capture::ComponentCapturer>,
) -> i32 {
    let result = (|| -> Result<(), String> {
        let store = arg(args, "--store")
            .map(PathBuf::from)
            .or_else(|| io.home().map(|h| h.join(".impeccable/component-reviews")))
            .ok_or("no home directory; supply --store outside the project")?;
        match args.first().map(String::as_str) {
            Some("prepare") | Some("capture") => {
                let path = arg(args, "--manifest")
                    .ok_or("prepare needs --manifest <project-relative file>")?;
                if args[0] == "capture" {
                    if let Some(tool) = io.env("IMPECCABLE_COMPONENT_REVIEW_TOOL") {
                        return Err(format!("This session uses hosted human review. Call {tool} with manifest_path={path:?}; it captures the components and waits for the user's decisions. A failed capture is not approval."));
                    }
                }
                let project = io.cwd.canonicalize().map_err(|e| e.to_string())?;
                let renderer=if args[0]=="capture" {Some(capturer.take().ok_or("native component capturer unavailable")?)}else{None};
                let dir=store::prepare_file(&store,&project,&path,renderer)?;
                let state = store::read(&dir.join("current.json"))?;
                let status = state["receipt"]["visualDecision"]
                    .as_str()
                    .unwrap_or("awaiting-review");
                io.out(&format!("{}\n", json!({
                    "session": dir.file_name().unwrap().to_string_lossy(),
                    "revision": state["packet"]["revision"],
                    "status": status,
                    "capture": state["capture"],
                    "round": state["packet"]["round"]
                })));
                Ok(())
            }
            Some("verify") => {
                let path = arg(args, "--manifest").ok_or("verify needs --manifest <project-relative file>")?;
                let receipt = verify::approved(&store, &io.cwd, &path)?;
                io.out(&format!("{}\n", receipt));
                Ok(())
            }
            Some("serve") | Some("status") | Some("refresh-approvals") => {
                let id = arg(args, "--session").ok_or("needs --session <id from prepare>")?;
                if id.len() != 64 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
                    return Err("invalid session id".into());
                }
                let dir = store.join(id);
                if args[0] == "refresh-approvals" {
                    let count=store::refresh_approvals(&dir)?;
                    io.out(&format!("{}\n",json!({"carried":count})));
                    Ok(())
                } else if args[0] == "serve" {
                    let port = arg(args, "--port")
                        .unwrap_or_else(|| "0".into())
                        .parse::<u16>()
                        .map_err(|e| e.to_string())?;
                    server::serve(&dir, port, io)
                } else {
                    let state = store::read(&dir.join("current.json"))?;
                    io.out(&format!("{}\n", json!({
                        "revision": state["packet"]["revision"],
                        "receipt": state["receipt"],
                        "capture": state["capture"],
                        "sourceStatus": store::sources_current(&state).err(),
                        "service": store::read(&dir.join("service.json")).ok()
                    })));
                    Ok(())
                }
            }
            _ => Err("usage: impeccable component-review prepare|capture|verify --manifest <file> | serve --session <id> [--port 0] | status|refresh-approvals --session <id> [--store <outside-project-dir>]".into())
        }
    })();
    match result {
        Ok(()) => 0,
        Err(e) => {
            io.err(&format!("component-review: {e}\n"));
            1
        }
    }
}
