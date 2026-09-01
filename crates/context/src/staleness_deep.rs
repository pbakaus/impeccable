//! JS: lib/staleness-deep.mjs (Tier 2, doctor only)

use crate::context::{extract_platform, TargetCandidate};
use crate::design_parser::parse_design_md;
use crate::jsp;
use crate::signals::git_run;
use crate::staleness::{check_native_platform_evidence, finding, js_truthy, to_relative, unique_roots, Finding};
use crate::util::{exists, js_trim, read_json, safe_read};
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{Map, Value};

const VISUAL_SOURCE_DIRS: [&str; 7] = ["src", "app", "pages", "components", "site", "styles", "public"];
const LEGACY_LIVE_PATHS: [&str; 2] = [".impeccable-live.json", ".impeccable-live"];

fn git(args: &[&str], cwd: &str) -> Option<String> {
    git_run(args, cwd, true, Some(5000))
}

/// JS: checkDesignDrift
pub fn check_design_drift(design_path: Option<&str>, project_root: &str, threshold: usize) -> Vec<Finding> {
    let Some(design_path) = design_path else { return vec![] };
    if project_root.is_empty() {
        return vec![];
    }
    match git(&["rev-parse", "--is-inside-work-tree"], project_root) {
        Some(s) if !s.is_empty() => {}
        _ => return vec![],
    }
    let rel_design = to_relative(Some(design_path), project_root).unwrap();
    let last = match git(&["log", "-1", "--format=%H", "--", &rel_design], project_root) {
        Some(s) if !s.is_empty() => s,
        _ => return vec![],
    };
    let dirs: Vec<&str> = VISUAL_SOURCE_DIRS.iter().copied().filter(|d| exists(&jsp::join(&[project_root, d]))).collect();
    if dirs.is_empty() {
        return vec![];
    }
    let mut args: Vec<&str> = vec!["log", "--oneline"];
    let range = format!("{}..HEAD", last);
    args.push(&range);
    args.push("--");
    args.extend(dirs.iter());
    let Some(log) = git(&args, project_root) else { return vec![] };
    let commits = if log.is_empty() { 0 } else { log.split('\n').filter(|l| !l.is_empty()).count() };
    if commits < threshold {
        return vec![];
    }
    let when = git(&["log", "-1", "--format=%ad", "--date=short", "--", &rel_design], project_root).filter(|s| !s.is_empty());
    vec![finding(
        "design-md-drift",
        "DESIGN.md",
        Some(rel_design.clone()),
        "route",
        format!(
            "{} commits have touched {} since {} was last edited{}. This counts commits, not contradictions: it says the document is worth re-reading, not that it is wrong.",
            commits,
            dirs.join(", "),
            rel_design,
            when.map(|w| format!(" ({})", w)).unwrap_or_default()
        ),
        "Read DESIGN.md against the current tokens and components before trusting it as authority. If it has genuinely drifted, `document` regenerates it from the code.".to_string(),
    )]
}

fn has_coverage_value(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Array(a)) => a.iter().any(|x| has_coverage_value(Some(x))),
        Some(Value::Object(o)) => o.values().any(|x| has_coverage_value(Some(x))),
        Some(Value::String(s)) => {
            let t = js_trim(s);
            if t.is_empty() {
                return false;
            }
            // /^(?:\[\s*\]|\{\s*\})$/
            let inner_empty = |open: char, close: char| -> bool {
                t.starts_with(open) && t.ends_with(close) && t.len() >= 2 && t[1..t.len() - 1].chars().all(|c| c.is_whitespace())
            };
            !(inner_empty('[', ']') || inner_empty('{', '}'))
        }
        _ => false,
    }
}

const SEED_MARKER_TAIL: &str = "impeccable document once there's code to capture the actual tokens and components. -->";

/// JS: checkDesignCoverage
pub fn check_design_coverage(design: Option<&str>, design_path: Option<&str>) -> Vec<Finding> {
    let Some(design) = design.filter(|d| !d.is_empty()) else { return vec![] };
    let model = parse_design_md(design);
    let is_seed = ["/", "$"].iter().any(|p| {
        design.contains(&format!("<!-- SEED: established with the user before implementation; re-run {}{}", p, SEED_MARKER_TAIL))
    });
    let required: Vec<&str> = if is_seed { vec!["colors", "typography"] } else { vec!["colors", "typography", "components"] };
    let missing: Vec<&str> = required
        .into_iter()
        .filter(|s| !model.has_section(s) && !has_coverage_value(model.frontmatter.as_ref().and_then(|f| f.get(*s))))
        .collect();
    if missing.is_empty() {
        return vec![];
    }
    vec![finding(
        "design-md-coverage",
        "DESIGN.md",
        design_path.map(|s| s.to_string()),
        "mention",
        format!(
            "{} has no {} section. Agents generating new screens get no normative guidance for those, and the live design panel renders generic approximations in their place.",
            design_path.filter(|p| !p.is_empty()).unwrap_or("DESIGN.md"),
            missing.join(", ")
        ),
        "Ask whether the section never applied or was never written. `document` fills it from the code if the project has the answer in its CSS.".to_string(),
    )]
}

fn wrap_ticks(items: &[String]) -> String {
    items.iter().map(|k| format!("`{}`", k)).collect::<Vec<_>>().join(", ")
}

/// JS String(x) for config list entries.
fn js_string(v: &Value) -> String {
    match v {
        Value::Null => "null".to_string(),
        Value::String(s) => s.clone(),
        other => crate::critique_storage::js_string_value(other),
    }
}

/// JS: checkDetectorIgnores
pub fn check_detector_ignores(project_root: &str, known_rule_ids: Option<&[String]>) -> Vec<Finding> {
    let mut out = Vec::new();
    if project_root.is_empty() {
        return out;
    }
    for name in ["config.json", "config.local.json"] {
        let fp = jsp::join(&[project_root, ".impeccable", name]);
        let Some(raw) = read_json(&fp) else { continue };
        let Some(detector) = raw.get("detector") else { continue };
        if !js_truthy(detector) || !(detector.is_object() || detector.is_array()) {
            continue;
        }
        let rel = to_relative(Some(&fp), project_root).unwrap();
        if let (Some(known), Some(rules)) = (known_rule_ids, detector.get("ignoreRules").and_then(|v| v.as_array())) {
            let unknown: Vec<String> = rules
                .iter()
                .map(|r| js_trim(&js_string_or_empty(r)).to_lowercase())
                .filter(|r| !r.is_empty() && r != "*" && !known.contains(r))
                .collect();
            if !unknown.is_empty() {
                out.push(finding(
                    "detector-ignore-rules-unknown",
                    "config.json",
                    Some(rel.clone()),
                    "mention",
                    format!(
                        "{} ignores rule id(s) the detector does not have: {}. Either the rule was renamed or removed, or the id was mistyped and has never suppressed anything.",
                        rel,
                        wrap_ticks(&unknown)
                    ),
                    "Report the exact ids. Removing them is safe; keeping a dead ignore hides that the rule is gone.".to_string(),
                ));
            }
        }
        if let Some(files) = detector.get("ignoreFiles").and_then(|v| v.as_array()) {
            let missing: Vec<String> = files
                .iter()
                .map(|e| js_trim(&js_string_or_empty(e)).to_string())
                .filter(|e| !e.is_empty() && !e.contains('*') && !exists(&jsp::join(&[project_root, e])))
                .collect();
            if !missing.is_empty() {
                out.push(finding(
                    "detector-ignore-files-missing",
                    "config.json",
                    Some(rel.clone()),
                    "mention",
                    format!("{} ignores file path(s) that no longer exist: {}.", rel, wrap_ticks(&missing)),
                    "Ask whether the file moved (repoint the entry) or was deleted (drop it). A stale entry silently stops covering the file that replaced it.".to_string(),
                ));
            }
        }
    }
    out
}

/// `String(rule || '')`
fn js_string_or_empty(v: &Value) -> String {
    if js_truthy(v) {
        js_string(v)
    } else {
        String::new()
    }
}

fn collect_hook_commands(v: &Value, out: &mut Vec<String>) {
    match v {
        Value::String(s) => {
            if crate::hook_markers::is_design_hook_command(s) {
                out.push(s.clone());
            }
        }
        Value::Array(a) => {
            for e in a {
                collect_hook_commands(e, out);
            }
        }
        Value::Object(o) => {
            for e in o.values() {
                collect_hook_commands(e, out);
            }
        }
        _ => {}
    }
}

static PLACEHOLDER: Lazy<Regex> = Lazy::new(|| Regex::new(r"\$\{[^}]*\}|\$[A-Za-z_]").unwrap());

/// The `.mjs` script (JS-era manifests) or the launcher (binary-era
/// manifests) a hook command runs; see `hook_markers`.
fn hook_script_token_from(command: &str) -> Option<String> {
    crate::hook_markers::hook_program_token(command)
}

fn resolve_hook_script_path(token: &str, root: &str) -> Option<String> {
    if token.is_empty() {
        return None;
    }
    if token.contains("$(") || token.contains('`') {
        return None;
    }
    let expanded = token.replace("${CLAUDE_PROJECT_DIR}", root);
    if PLACEHOLDER.is_match(&expanded) {
        return None;
    }
    Some(if jsp::is_absolute(&expanded) { expanded } else { jsp::join(&[root, &expanded]) })
}

/// JS: checkHookInstallation
pub fn check_hook_installation(project_root: &str, repo_root: Option<&str>, provider_id: &str) -> Vec<Finding> {
    let mut out = Vec::new();
    let manifests = crate::context_cli::hook_manifests_for(provider_id);
    if manifests.is_empty() {
        return out;
    }
    let roots = unique_roots(project_root, repo_root);
    let mut installed_at: Option<String> = None;
    for root in &roots {
        for rel in manifests {
            let mp = jsp::join(&[root, rel]);
            let Some(raw) = read_json(&mp) else { continue };
            let Some(hooks) = raw.get("hooks") else { continue };
            if !js_truthy(hooks) {
                continue;
            }
            let mut commands = Vec::new();
            collect_hook_commands(hooks, &mut commands);
            if commands.is_empty() {
                continue;
            }
            let base = if project_root.is_empty() { root.as_str() } else { project_root };
            installed_at = to_relative(Some(&mp), base);
            let broken: Vec<&String> = commands
                .iter()
                .filter(|c| {
                    let Some(token) = hook_script_token_from(c) else { return false };
                    let Some(abs) = resolve_hook_script_path(&token, root) else { return false };
                    !exists(&abs)
                })
                .collect();
            if !broken.is_empty() {
                let ia = installed_at.clone().unwrap();
                out.push(finding(
                    "hook-script-missing",
                    "hook manifest",
                    Some(ia.clone()),
                    "mention",
                    format!(
                        "{} installs the design hook, but its script path does not exist: {}. The hook runs as a no-op, so UI edits have been going unscanned while the project looks covered.",
                        ia,
                        broken.iter().map(|c| format!("`{}`", c)).collect::<Vec<_>>().join(", ")
                    ),
                    "Reinstall with `impeccable hooks on`, which rewrites the manifest against the skill's current location.".to_string(),
                ));
            }
        }
    }
    if let Some(ia) = installed_at {
        for root in &roots {
            for name in ["config.json", "config.local.json"] {
                let cp = jsp::join(&[root, ".impeccable", name]);
                let Some(raw) = read_json(&cp) else { continue };
                let Some(hook) = raw.get("hook") else { continue };
                if js_truthy(hook) && hook.get("enabled") == Some(&Value::Bool(false)) {
                    let base = if project_root.is_empty() { root.as_str() } else { project_root };
                    out.push(finding(
                        "hook-enabled-conflict",
                        "config.json",
                        to_relative(Some(&cp), base),
                        "mention",
                        format!(
                            "{} installs the design hook while this config sets `hook.enabled: false`, so the hook fires and then declines to scan.",
                            ia
                        ),
                        "Ask which was intended: `impeccable hooks on` to enable, or `impeccable hooks off` to uninstall the manifest entry as well.".to_string(),
                    ));
                    return out;
                }
            }
        }
    }
    out
}

/// JS: checkLegacyLiveState
pub fn check_legacy_live_state(project_root: &str) -> Vec<Finding> {
    if project_root.is_empty() {
        return vec![];
    }
    let present: Vec<&str> = LEGACY_LIVE_PATHS.iter().copied().filter(|rel| exists(&jsp::join(&[project_root, rel]))).collect();
    if present.is_empty() {
        return vec![];
    }
    vec![finding(
        "legacy-live-state",
        "live state",
        Some(present.join(", ")),
        "auto",
        format!(
            "Live-mode state sits in retired location(s): {}. Current live mode writes under `.impeccable/live/`.",
            present.iter().map(|r| format!("`{}`", r)).collect::<Vec<_>>().join(", ")
        ),
        "These are read only through backward-compatible fallbacks and are safe to delete once no live session is running. No user decision is needed.".to_string(),
    )]
}

pub struct WorkspaceRow {
    pub name: String,
    pub path: String,
    pub product_status: &'static str,
    pub product_path: Option<String>,
    pub design_status: &'static str,
    pub design_path: Option<String>,
    pub platform: Option<String>,
}

impl WorkspaceRow {
    pub fn to_value(&self) -> Value {
        let mut m = Map::new();
        m.insert("name".into(), Value::String(self.name.clone()));
        m.insert("path".into(), Value::String(self.path.clone()));
        m.insert("productStatus".into(), Value::String(self.product_status.to_string()));
        m.insert("productPath".into(), self.product_path.clone().map(Value::String).unwrap_or(Value::Null));
        m.insert("designStatus".into(), Value::String(self.design_status.to_string()));
        m.insert("designPath".into(), self.design_path.clone().map(Value::String).unwrap_or(Value::Null));
        m.insert("platform".into(), self.platform.clone().map(Value::String).unwrap_or(Value::Null));
        Value::Object(m)
    }
}

/// JS: checkWorkspaces
pub fn check_workspaces(repo_root: &str, candidates: &[TargetCandidate]) -> (Vec<Finding>, Vec<WorkspaceRow>) {
    if repo_root.is_empty() || candidates.is_empty() {
        return (vec![], vec![]);
    }
    let mut findings = Vec::new();
    let mut workspaces = Vec::new();
    for c in candidates {
        let workspace_root = jsp::join(&[repo_root, &c.path]);
        let product_path = c.product_path.as_deref().map(|p| jsp::join(&[repo_root, p]));
        let product = product_path.as_deref().and_then(safe_read);
        let platform = extract_platform(product.as_deref());
        workspaces.push(WorkspaceRow {
            name: c.name.clone(),
            path: c.path.clone(),
            product_status: c.product_status,
            product_path: c.product_path.clone(),
            design_status: c.design_status,
            design_path: c.design_path.clone(),
            platform: platform.clone().or_else(|| {
                if product.as_deref().map(|p| !p.is_empty()).unwrap_or(false) {
                    Some("web (default)".to_string())
                } else {
                    None
                }
            }),
        });
        let native = check_native_platform_evidence(&workspace_root, platform.as_deref(), product.as_deref(), c.product_path.as_deref());
        for entry in native {
            let inherited = c.product_status == "inherited";
            findings.push(finding(
                "workspace-platform-native-evidence",
                "PRODUCT.md",
                Some(c.product_path.clone().unwrap_or_else(|| format!("{}/PRODUCT.md", c.path))),
                "mention",
                format!(
                    "Workspace `{}` {} that resolves to web, but the workspace itself carries native build files. {}",
                    c.path,
                    if inherited { "inherits the repo-root PRODUCT.md" } else { "has a PRODUCT.md" },
                    entry.summary
                ),
                if inherited {
                    format!(
                        "Give `{}` its own PRODUCT.md with the right `## Platform`. An inherited record cannot describe two platforms at once.",
                        c.path
                    )
                } else {
                    entry.fix
                },
            ));
        }
    }
    let inherited: Vec<&WorkspaceRow> = workspaces.iter().filter(|w| w.product_status == "inherited").collect();
    if !inherited.is_empty() {
        findings.push(finding(
            "workspace-context-inherited",
            "PRODUCT.md",
            None,
            "mention",
            format!(
                "{} of {} workspace(s) inherit the repo-root PRODUCT.md: {}. Inheritance is intended; whether one record truthfully describes these apps is not something this check can tell.",
                inherited.len(),
                workspaces.len(),
                inherited.iter().map(|w| format!("`{}`", w.path)).collect::<Vec<_>>().join(", ")
            ),
            "Ask the user whether the inherited record describes each app. Where it does not, `init` in that workspace writes a child PRODUCT.md that overrides it.".to_string(),
        ));
    }
    (findings, workspaces)
}

/// JS: loadKnownRuleIds -> the bundled registry, lowercased ids.
pub fn load_known_rule_ids() -> Option<Vec<String>> {
    Some(impeccable_core::registry::ANTIPATTERNS.iter().map(|r| r.id.to_lowercase()).collect())
}

#[cfg(test)]
mod tests {
    use super::check_hook_installation;

    fn tmp() -> String {
        let base = std::env::temp_dir().join(format!(
            "impeccable-doctor-hook-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        std::fs::create_dir_all(&base).unwrap();
        std::fs::canonicalize(&base).unwrap().to_string_lossy().into_owned()
    }

    fn write(root: &str, rel: &str, body: &str) {
        let p = std::path::Path::new(root).join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, body).unwrap();
    }

    #[test]
    fn hook_script_missing_resolves_launcher_and_legacy_forms() {
        let root = tmp();
        // Launcher form pointing at a launcher that exists: no finding.
        write(&root, ".claude/skills/impeccable/scripts/impeccable", "#!/bin/sh\n");
        write(
            &root,
            ".claude/settings.local.json",
            r#"{"hooks":{"PostToolUse":[{"hooks":[{"type":"command","command":"\"${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/impeccable\" hook"}]}]}}"#,
        );
        assert!(check_hook_installation(&root, None, "claude-code").is_empty());

        // Launcher form pointing at a missing launcher: reported.
        write(
            &root,
            ".claude/settings.local.json",
            r#"{"hooks":{"PostToolUse":[{"hooks":[{"type":"command","command":"\"${CLAUDE_PROJECT_DIR}/.other/skills/impeccable/scripts/impeccable\" hook"}]}]}}"#,
        );
        let f = check_hook_installation(&root, None, "claude-code");
        assert_eq!(f.len(), 1, "{f:?}");
        assert_eq!(f[0].id, "hook-script-missing");

        // Legacy .mjs form is still resolved: reported when the script is gone.
        write(
            &root,
            ".claude/settings.local.json",
            r#"{"hooks":{"PostToolUse":[{"hooks":[{"type":"command","command":"node \"${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/hook.mjs\""}]}]}}"#,
        );
        let f = check_hook_installation(&root, None, "claude-code");
        assert_eq!(f.len(), 1, "{f:?}");
        write(&root, ".claude/skills/impeccable/scripts/hook.mjs", "");
        assert!(check_hook_installation(&root, None, "claude-code").is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }
}
