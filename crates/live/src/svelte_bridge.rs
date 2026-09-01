//! The documented Node exception: the Svelte scaffold and accept pipeline
//! need the USER app's own `svelte/compiler` (JS: svelte-ast.mjs
//! `loadSvelteCompiler`, which `createRequire(<appRoot>/package.json)`s it).
//! A single binary cannot load it, so this module runs one small embedded
//! JS helper (`svelte_bridge_helper.mjs`) under the project's `node`, which
//! resolves the compiler exactly the way the JS did and answers `parse` /
//! `compile` requests over a JSON-lines pipe. When `node` or a Svelte >= 5
//! compiler is not resolvable the bridge is `None`, which is the JS's
//! `loadSvelteCompiler() === null` degraded path (source-preview fallback,
//! no compile-driven pruning).

use crate::accept_css::UnusedWarning;
use once_cell::sync::Lazy;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};

const HELPER_JS: &str = include_str!("svelte_bridge_helper.mjs");

pub struct Bridge {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    pub version: String,
}

impl Drop for Bridge {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Bridge {
    fn spawn(app_root: &str) -> Option<Bridge> {
        let mut child = Command::new(impeccable_common::proc::node_exe())
            .args(["--input-type=module", "-e", HELPER_JS, "--", app_root])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .ok()?;
        let stdin = child.stdin.take()?;
        let stdout = BufReader::new(child.stdout.take()?);
        let mut bridge = Bridge {
            child,
            stdin,
            stdout,
            version: String::new(),
        };
        let hello = bridge.read_line()?;
        if hello.get("ok").and_then(|v| v.as_bool()) != Some(true) {
            return None;
        }
        bridge.version = hello
            .get("version")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        Some(bridge)
    }

    fn read_line(&mut self) -> Option<Value> {
        let mut line = String::new();
        loop {
            line.clear();
            let n = self.stdout.read_line(&mut line).ok()?;
            if n == 0 {
                return None;
            }
            let t = line.trim();
            if t.is_empty() {
                continue;
            }
            return serde_json::from_str(t).ok();
        }
    }

    fn request(&mut self, req: &Value) -> Option<Value> {
        let mut text = serde_json::to_string(req).ok()?;
        text.push('\n');
        self.stdin.write_all(text.as_bytes()).ok()?;
        self.stdin.flush().ok()?;
        self.read_line()
    }

    /// `parse(source, { modern: true })` → the AST as JSON, or the error
    /// message the compiler threw.
    pub fn parse(&mut self, source: &str) -> Result<Value, String> {
        let res = self
            .request(&json!({ "op": "parse", "source": source }))
            .ok_or_else(|| "svelte bridge unavailable".to_string())?;
        if res.get("ok").and_then(|v| v.as_bool()) == Some(true) {
            Ok(res.get("ast").cloned().unwrap_or(Value::Null))
        } else {
            Err(res
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown error")
                .to_string())
        }
    }

    /// `compile(source, { generate: false })` → the `css_unused_selector`
    /// warnings (UTF-16 offsets), or `Err(CompileError)` when it threw.
    pub fn compile(&mut self, source: &str) -> Result<Vec<UnusedWarning>, CompileError> {
        let res = self
            .request(&json!({ "op": "compile", "source": source }))
            .ok_or_else(|| CompileError {
                message: "svelte bridge unavailable".to_string(),
                line: None,
                column: None,
            })?;
        if res.get("ok").and_then(|v| v.as_bool()) == Some(true) {
            let mut out = Vec::new();
            if let Some(Value::Array(ws)) = res.get("warnings") {
                for w in ws {
                    let (Some(s), Some(e)) = (
                        w.get("start").and_then(|v| v.as_u64()),
                        w.get("end").and_then(|v| v.as_u64()),
                    ) else {
                        continue;
                    };
                    out.push(UnusedWarning {
                        start: s as usize,
                        end: e as usize,
                    });
                }
            }
            Ok(out)
        } else {
            Err(CompileError {
                message: res
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown error")
                    .to_string(),
                line: res.get("line").and_then(|v| v.as_i64()),
                column: res.get("column").and_then(|v| v.as_i64()),
            })
        }
    }
}

#[derive(Debug, Clone)]
pub struct CompileError {
    pub message: String,
    pub line: Option<i64>,
    pub column: Option<i64>,
}

pub type SharedBridge = Arc<Mutex<Bridge>>;

static BRIDGES: Lazy<Mutex<HashMap<String, Option<SharedBridge>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// JS: loadSvelteCompiler(appRoot). `None` reproduces the JS null: no
/// `node`, no resolvable `svelte/compiler`, or a compiler older than 5.
/// Cached per app root for the life of the process (the JS re-required the
/// same module instance each time).
pub fn load_svelte_compiler(app_root: &str) -> Option<SharedBridge> {
    let mut map = BRIDGES.lock().ok()?;
    if let Some(cached) = map.get(app_root) {
        return cached.clone();
    }
    let bridge = Bridge::spawn(app_root).map(|b| Arc::new(Mutex::new(b)));
    map.insert(app_root.to_string(), bridge.clone());
    bridge
}
