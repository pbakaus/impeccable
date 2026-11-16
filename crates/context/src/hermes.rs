//! Hermes Agent: its home dir and the design-hook plugin installed under it
//! (#1178). The Hermes gateway, which runs every session, loads plugins from
//! `<hermes home>/plugins/` and not from a project's `.hermes/plugins/`, so
//! project and global installs share it.

use crate::jsp;
use crate::util::Env;

pub const PLUGIN_NAME: &str = "impeccable-design-hook";
/// What the installer copies and Hermes needs to load the plugin.
pub const PLUGIN_FILES: [&str; 2] = ["plugin.yaml", "__init__.py"];

/// JS: hermesGlobalHome(home): honor $HERMES_HOME only when it sits under
/// `home` (resolved against cwd like `path.resolve`, which emits the host
/// separator).
pub fn hermes_global_home(env: &Env, cwd: &str, home: &str) -> String {
    if let Some(env_home) = env.get("HERMES_HOME").filter(|v| !v.is_empty()) {
        let resolved_env = jsp::resolve(cwd, &[env_home]);
        let resolved_home = jsp::resolve(cwd, &[home]);
        if resolved_env == resolved_home || resolved_env.starts_with(&format!("{resolved_home}{}", jsp::SEP)) {
            return resolved_env;
        }
    }
    jsp::join(&[home, ".hermes"])
}

/// `<hermes home>/plugins/impeccable-design-hook`
pub fn plugin_dir(hermes_home: &str) -> String {
    jsp::join(&[hermes_home, "plugins", PLUGIN_NAME])
}

/// The plugin's files are present and `<hermes home>/config.yaml` lists it
/// under `plugins.enabled` and not under `plugins.disabled`. A config this
/// scan cannot read with confidence counts as not enabled, so the manual
/// detector fallback keeps firing.
pub fn plugin_enabled(hermes_home: &str) -> bool {
    let dir = plugin_dir(hermes_home);
    if !PLUGIN_FILES.iter().all(|f| std::path::Path::new(&jsp::join(&[&dir, f])).is_file()) {
        return false;
    }
    let Ok(config) = std::fs::read_to_string(jsp::join(&[hermes_home, "config.yaml"])) else {
        return false;
    };
    match (plugins_list(&config, "enabled"), plugins_list(&config, "disabled")) {
        (Some(enabled), Some(disabled)) => enabled.contains(&PLUGIN_NAME) && !disabled.contains(&PLUGIN_NAME),
        _ => false,
    }
}

/// `plugins.<key>` in Hermes' config.yaml, as a block list (`- name` lines)
/// or a flow list (`[a, b]`). Empty when the key is absent; `None` for any
/// other shape. Not a YAML parser: it reads the shape Hermes writes.
fn plugins_list<'a>(config: &'a str, key: &str) -> Option<Vec<&'a str>> {
    let mut lines = Vec::new();
    for line in config.lines() {
        let body = line.trim_start_matches(' ');
        if body.is_empty() || body.starts_with('#') {
            continue;
        }
        lines.push((line.len() - body.len(), strip_comment(body)));
    }
    let Some(start) = lines.iter().position(|(indent, body)| *indent == 0 && key_value(body).is_some_and(|(k, _)| k == "plugins")) else {
        return Some(Vec::new());
    };
    if !key_value(lines[start].1)?.1.is_empty() {
        return None;
    }
    let block: Vec<(usize, &str)> = lines[start + 1..].iter().take_while(|(indent, _)| *indent > 0).copied().collect();
    let child = block.first().map(|(indent, _)| *indent)?;
    let Some(at) = block.iter().position(|(indent, body)| *indent == child && key_value(body).is_some_and(|(k, _)| k == key)) else {
        return Some(Vec::new());
    };
    let value = key_value(block[at].1)?.1;
    if !value.is_empty() {
        let inner = value.strip_prefix('[')?.strip_suffix(']')?;
        return Some(inner.split(',').map(|s| unquote(s.trim())).filter(|s| !s.is_empty()).collect());
    }
    let mut items = Vec::new();
    for (indent, body) in &block[at + 1..] {
        let item = body.strip_prefix('-').filter(|rest| rest.is_empty() || rest.starts_with(' '));
        match item {
            Some(rest) if *indent >= child => items.push(unquote(rest.trim())),
            None if *indent <= child => break,
            _ => return None,
        }
    }
    Some(items)
}

fn key_value(body: &str) -> Option<(&str, &str)> {
    let (k, v) = body.split_once(':')?;
    (v.is_empty() || v.starts_with(' ')).then(|| (unquote(k.trim()), v.trim()))
}

fn strip_comment(body: &str) -> &str {
    body.find(" #").map_or(body, |i| &body[..i]).trim_end()
}

fn unquote(s: &str) -> &str {
    for q in ['"', '\''] {
        if let Some(inner) = s.strip_prefix(q).and_then(|r| r.strip_suffix(q)) {
            return inner;
        }
    }
    s
}
