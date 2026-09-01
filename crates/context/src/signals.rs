//! JS: context-signals.mjs -> `impeccable signals` (alias: context-signals)

use crate::context::{extract_platform, load_context};
use crate::critique_storage::{js_number, read_latest_snapshot_across_targets};
use crate::jsp;
use crate::target_args::TargetOptions;
use crate::util::{exists, js_num, js_trim, json_pretty, opt_string, Env};
use impeccable_common::Io;
use serde_json::{Map, Value};
use std::process::{Command, Stdio};

fn has_code(cwd: &str) -> bool {
    if exists(&jsp::join(&[cwd, "package.json"])) {
        return true;
    }
    ["src", "app", "pages", "site", "public", "components", "lib"].iter().any(|d| exists(&jsp::join(&[cwd, d])))
}

fn latest_critique(cwd: &str, env: &Env) -> Value {
    let Some(latest) = read_latest_snapshot_across_targets(cwd, env) else { return Value::Null };
    let get = |key: &str| -> Value { latest.meta.get(key).cloned().unwrap_or(Value::Null) };
    let num = |v: Value| -> Value {
        match &v {
            Value::Null => Value::Null,
            Value::String(s) if js_trim(s).is_empty() => Value::Null,
            Value::String(s) => {
                let n = js_number(s);
                if n.is_finite() {
                    js_num(n)
                } else {
                    Value::Null
                }
            }
            Value::Number(n) => js_num(n.as_f64().unwrap_or(f64::NAN)),
            Value::Bool(b) => js_num(if *b { 1.0 } else { 0.0 }),
            _ => Value::Null,
        }
    };
    let coalesce = |a: &str, b: &str| -> Value {
        let v = get(a);
        if v.is_null() {
            get(b)
        } else {
            v
        }
    };
    let mut m = Map::new();
    m.insert("slug".into(), get("slug"));
    m.insert("score".into(), num(coalesce("total_score", "score")));
    m.insert("p0".into(), num(coalesce("p0_count", "p0")));
    m.insert("p1".into(), num(coalesce("p1_count", "p1")));
    m.insert("timestamp".into(), get("timestamp"));
    m.insert("file".into(), Value::String(jsp::relative("/", cwd, &latest.path)));
    Value::Object(m)
}

/// git with stdout only; None on non-zero exit / spawn failure.
pub fn git_run(args: &[&str], cwd: &str, trim: bool, timeout_ms: Option<u64>) -> Option<String> {
    let mut cmd = Command::new("git");
    cmd.args(args).current_dir(cwd).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    impeccable_common::proc::hide_window(&mut cmd);
    let mut child = cmd.spawn().ok()?;
    let out = if let Some(t) = timeout_ms {
        // Poll for completion up to the timeout, then kill (execFileSync timeout semantics).
        let start = std::time::Instant::now();
        let mut stdout = child.stdout.take()?;
        let reader = std::thread::spawn(move || {
            let mut buf = Vec::new();
            use std::io::Read;
            let _ = stdout.read_to_end(&mut buf);
            buf
        });
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    let buf = reader.join().unwrap_or_default();
                    if !status.success() {
                        return None;
                    }
                    break String::from_utf8_lossy(&buf).into_owned();
                }
                Ok(None) => {
                    if start.elapsed().as_millis() as u64 > t {
                        let _ = child.kill();
                        let _ = child.wait();
                        return None;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(5));
                }
                Err(_) => return None,
            }
        }
    } else {
        let o = child.wait_with_output().ok()?;
        if !o.status.success() {
            return None;
        }
        String::from_utf8_lossy(&o.stdout).into_owned()
    };
    Some(if trim { js_trim(&out).to_string() } else { out })
}

fn git_signals(cwd: &str) -> Value {
    let run = |args: &[&str]| git_run(args, cwd, true, None);
    let mut m = Map::new();
    if run(&["rev-parse", "--is-inside-work-tree"]).as_deref() != Some("true") {
        m.insert("isRepo".into(), Value::Bool(false));
        m.insert("branch".into(), Value::Null);
        m.insert("base".into(), Value::Null);
        m.insert("changedFiles".into(), Value::Array(vec![]));
        m.insert("changedCount".into(), Value::from(0));
        return Value::Object(m);
    }
    let branch = run(&["rev-parse", "--abbrev-ref", "HEAD"]);
    let remotes: Vec<String> = run(&["remote"]).unwrap_or_default().split('\n').filter(|s| !s.is_empty()).map(|s| s.to_string()).collect();
    let resolve_upstream = || -> Option<(String, String)> {
        let full = run(&["rev-parse", "--symbolic-full-name", "@{u}"])?;
        if full.is_empty() {
            return None;
        }
        if let Some(name) = full.strip_prefix("refs/heads/") {
            return Some((name.to_string(), name.to_string()));
        }
        if let Some(rest) = full.strip_prefix("refs/remotes/") {
            if let Some(i) = rest.find('/') {
                if i > 0 {
                    return Some((rest[i + 1..].to_string(), rest.to_string()));
                }
            }
        }
        None
    };
    let conventional = ["develop", "main", "master"];
    let mut remote_heads: Vec<(String, String)> = Vec::new();
    let mut seen_r: Vec<String> = Vec::new();
    for r in std::iter::once("origin".to_string()).chain(remotes.iter().cloned()) {
        if seen_r.contains(&r) {
            continue;
        }
        seen_r.push(r.clone());
        if let Some(reff) = run(&["symbolic-ref", "--short", &format!("refs/remotes/{}/HEAD", r)]) {
            if !reff.is_empty() {
                if let Some(name) = reff.strip_prefix(&format!("{}/", r)) {
                    remote_heads.push((name.to_string(), reff.clone()));
                }
            }
        }
    }
    let branch_s = branch.clone().unwrap_or_default();
    let on_integration = branch.as_deref() == Some("HEAD")
        || conventional.contains(&branch_s.as_str())
        || remote_heads.iter().any(|(n, _)| Some(n.as_str()) == branch.as_deref());
    let mut base: Option<String> = None;
    let mut base_rev: Option<String> = None;
    if !on_integration {
        let upstream = resolve_upstream();
        let mut remote_order: Vec<String> = vec!["origin".to_string()];
        remote_order.extend(remotes.iter().filter(|n| *n != "origin").cloned());
        let revs_for = |name: &str| -> Vec<String> {
            let mut v = vec![name.to_string()];
            v.extend(remote_order.iter().map(|r| format!("{}/{}", r, name)));
            v
        };
        let mut candidates: Vec<(String, Vec<String>)> = Vec::new();
        let mut seen: Vec<String> = Vec::new();
        let add = |name: &str, revs: Vec<String>, candidates: &mut Vec<(String, Vec<String>)>, seen: &mut Vec<String>| {
            if name.is_empty() || Some(name) == branch.as_deref() || seen.iter().any(|s| s == name) {
                return;
            }
            seen.push(name.to_string());
            candidates.push((name.to_string(), revs));
        };
        if let Some((n, r)) = &upstream {
            add(n, vec![r.clone()], &mut candidates, &mut seen);
        }
        let advertised = |name: &str| -> Vec<String> { remote_heads.iter().filter(|(n, _)| n == name).map(|(_, r)| r.clone()).collect() };
        let uniq = |v: Vec<String>| -> Vec<String> {
            let mut out: Vec<String> = Vec::new();
            for x in v {
                if !out.contains(&x) {
                    out.push(x);
                }
            }
            out
        };
        let mut dev = advertised("develop");
        dev.extend(revs_for("develop"));
        add("develop", uniq(dev), &mut candidates, &mut seen);
        for (n, r) in &remote_heads {
            let mut v = vec![r.clone()];
            v.extend(revs_for(n));
            add(n, uniq(v), &mut candidates, &mut seen);
        }
        for n in ["main", "master"] {
            add(n, revs_for(n), &mut candidates, &mut seen);
        }
        for (name, revs) in &candidates {
            if let Some(rev) = revs.iter().find(|r| run(&["rev-parse", "--verify", "--quiet", r]).is_some()) {
                base = Some(name.clone());
                base_rev = Some(rev.clone());
                break;
            }
        }
    }
    let diff_base = match (&base, &branch) {
        (Some(b), Some(br)) if !b.is_empty() && !br.is_empty() && br != b => Some(b.clone()),
        _ => None,
    };
    let from_diff = if diff_base.is_some() {
        run(&["diff", "--name-only", &format!("{}...HEAD", base_rev.as_deref().unwrap_or(""))])
    } else {
        None
    };
    let from_status = git_run(&["-c", "core.quotepath=false", "status", "--porcelain"], cwd, false, None);
    let mut changed: Vec<String> = Vec::new();
    if let Some(d) = from_diff.filter(|d| !d.is_empty()) {
        changed = d.split('\n').filter(|s| !s.is_empty()).map(|s| s.to_string()).collect();
    } else if let Some(s) = from_status.filter(|s| !s.is_empty()) {
        for l in s.split('\n') {
            let l = l.strip_suffix('\r').unwrap_or(l);
            if l.is_empty() {
                continue;
            }
            let p: String = l.chars().skip(3).collect();
            let entry = match p.find(" -> ") {
                Some(i) => p[i + 4..].to_string(),
                None => p,
            };
            changed.push(entry);
        }
    }
    m.insert("isRepo".into(), Value::Bool(true));
    m.insert("branch".into(), opt_string(&branch));
    m.insert("base".into(), opt_string(&diff_base));
    m.insert("changedFiles".into(), Value::Array(changed.iter().take(50).cloned().map(Value::String).collect()));
    m.insert("changedCount".into(), Value::from(changed.len()));
    Value::Object(m)
}

const COMMON_DEV_PORTS: [u16; 7] = [4321, 3000, 5173, 5174, 8080, 8000, 4200];

fn dev_server_signals() -> Value {
    let handles: Vec<_> = COMMON_DEV_PORTS
        .iter()
        .map(|&p| {
            std::thread::spawn(move || {
                let addr = std::net::SocketAddr::from(([127, 0, 0, 1], p));
                std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(250)).is_ok()
            })
        })
        .collect();
    let mut open: Vec<u16> = Vec::new();
    for (i, h) in handles.into_iter().enumerate() {
        if h.join().unwrap_or(false) {
            open.push(COMMON_DEV_PORTS[i]);
        }
    }
    open.sort();
    let mut m = Map::new();
    m.insert("running".into(), Value::Bool(!open.is_empty()));
    m.insert("ports".into(), Value::Array(open.into_iter().map(|p| Value::from(p)).collect()));
    Value::Object(m)
}

const SCANNABLE_EXT: [&str; 11] = [".html", ".htm", ".css", ".scss", ".jsx", ".tsx", ".js", ".ts", ".vue", ".svelte", ".astro"];
const SOURCE_DIRS: [&str; 5] = ["src", "app", "components", "pages", "public"];

fn is_vendored_path(rel: &str) -> bool {
    let segs: Vec<&str> = rel.split(|c| c == '/' || c == '\\').collect();
    let dirs = &segs[..segs.len().saturating_sub(1)];
    dirs.iter().any(|seg| {
        (seg.starts_with('.') && *seg != ".vitepress" && *seg != ".vuepress" && *seg != ".storybook")
            || *seg == "node_modules"
            || *seg == "dist"
            || *seg == "build"
            || *seg == "__pycache__"
    })
}

fn scan_targets(cwd: &str, git: &Value) -> Value {
    let is_repo = git.get("isRepo").and_then(|v| v.as_bool()).unwrap_or(false);
    let changed: Vec<String> = git
        .get("changedFiles")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default();
    let mut m = Map::new();
    if is_repo && !changed.is_empty() {
        let c: Vec<String> = changed
            .into_iter()
            .filter(|f| SCANNABLE_EXT.contains(&jsp::extname(f).to_lowercase().as_str()))
            .filter(|f| !is_vendored_path(f))
            .filter(|f| exists(&jsp::join(&[cwd, f])))
            .collect();
        if !c.is_empty() {
            m.insert("targets".into(), Value::Array(c.into_iter().take(50).map(Value::String).collect()));
            m.insert("via".into(), Value::String("git-changes".into()));
            return Value::Object(m);
        }
    }
    let dirs: Vec<&str> = SOURCE_DIRS.iter().copied().filter(|d| exists(&jsp::join(&[cwd, d]))).collect();
    if !dirs.is_empty() {
        m.insert("targets".into(), Value::Array(dirs.into_iter().map(|d| Value::String(d.to_string())).collect()));
        m.insert("via".into(), Value::String("source-dir".into()));
        return Value::Object(m);
    }
    if exists(&jsp::join(&[cwd, "index.html"])) {
        m.insert("targets".into(), Value::Array(vec![Value::String("index.html".into())]));
        m.insert("via".into(), Value::String("html".into()));
        return Value::Object(m);
    }
    if has_code(cwd) {
        m.insert("targets".into(), Value::Array(vec![Value::String(".".into())]));
        m.insert("via".into(), Value::String("root".into()));
        return Value::Object(m);
    }
    m.insert("targets".into(), Value::Array(vec![]));
    m.insert("via".into(), Value::Null);
    Value::Object(m)
}

pub fn gather_signals(cwd: &str, env: &Env) -> Value {
    let ctx = load_context(cwd, &TargetOptions::default(), env);
    let git = git_signals(cwd);
    let mut setup = Map::new();
    setup.insert("hasProduct".into(), Value::Bool(ctx.has_product));
    setup.insert("productPath".into(), opt_string(&ctx.product_path));
    setup.insert("hasDesign".into(), Value::Bool(ctx.has_design));
    setup.insert("designPath".into(), opt_string(&ctx.design_path));
    setup.insert("hasCode".into(), Value::Bool(has_code(cwd)));
    setup.insert("platform".into(), opt_string(&extract_platform(ctx.product.as_deref())));
    let mut critique = Map::new();
    critique.insert("latest".into(), latest_critique(cwd, env));
    let dev = dev_server_signals();
    let scan = scan_targets(cwd, &git);
    let mut m = Map::new();
    m.insert("setup".into(), Value::Object(setup));
    m.insert("critique".into(), Value::Object(critique));
    m.insert("git".into(), git);
    m.insert("devServer".into(), dev);
    m.insert("scan".into(), scan);
    Value::Object(m)
}

pub fn run(_args: &[String], io: &mut Io) -> i32 {
    let cwd = io.cwd.to_string_lossy().into_owned();
    let env = io.env.clone();
    let v = gather_signals(&cwd, &env);
    io.out(&format!("{}\n", json_pretty(&v)));
    0
}
