//! Provider (harness) directories, aliases, global-skill layouts, harness
//! detection, and the install-tree scans. JS: skills.mjs top section plus
//! `findProjectRoot` / `findInstalledProviders` / `findImpeccableProviders` /
//! `findLinkedProviders` / `resolveUpdateTarget` / `getSkillsVersion`.

use crate::util::{self, jsp, Env};

pub const API_BASE: &str = "https://impeccable.style";

pub const PROVIDER_DIRS: &[&str] = &[
    ".claude", ".cursor", ".gemini", ".agents", ".agent", ".github", ".grok", ".hermes", ".kiro",
    ".opencode", ".pi", ".qoder", ".trae", ".trae-cn", ".rovodev", ".vibe",
];

const PROVIDER_ALIASES: &[(&str, &str)] = &[
    ("agent", ".agent"),
    ("agents", ".agents"),
    ("antigravity", ".agent"),
    ("claude", ".claude"),
    ("claude-code", ".claude"),
    ("codex", ".agents"),
    ("copilot", ".github"),
    ("cursor", ".cursor"),
    ("gemini", ".gemini"),
    ("github", ".github"),
    ("grok", ".grok"),
    ("grok-build", ".grok"),
    ("hermes", ".hermes"),
    ("xai", ".grok"),
    ("kiro", ".kiro"),
    ("opencode", ".opencode"),
    ("pi", ".pi"),
    ("qoder", ".qoder"),
    ("rovo-dev", ".rovodev"),
    ("rovodev", ".rovodev"),
    ("trae", ".trae"),
    ("trae-cn", ".trae-cn"),
    ("vibe", ".vibe"),
];

const PROVIDER_DISPLAY: &[(&str, &str, &str)] = &[
    (".agent", "Antigravity", "antigravity"),
    (".agents", "Codex CLI", "codex"),
    (".claude", "Claude Code", "claude"),
    (".cursor", "Cursor", "cursor"),
    (".gemini", "Gemini CLI", "gemini"),
    (".github", "GitHub Copilot", "github"),
    (".grok", "Grok Build", "grok"),
    (".hermes", "Hermes Agent", "hermes"),
    (".kiro", "Kiro", "kiro"),
    (".opencode", "OpenCode", "opencode"),
    (".pi", "Pi Coding Agent", "pi"),
    (".qoder", "Qoder", "qoder"),
    (".rovodev", "Rovo Dev", "rovo-dev"),
    (".trae", "Trae", "trae"),
    (".trae-cn", "Trae CN", "trae-cn"),
    (".vibe", "Mistral Vibe", "vibe"),
];

pub const PROVIDER_INPUT_ORDER: &[&str] = &[
    "antigravity", "claude", "codex", "cursor", "gemini", "github", "grok", "hermes", "kiro",
    "opencode", "pi", "qoder", "trae", "trae-cn", "rovo-dev", "vibe",
];

pub const DEFAULT_TARGETS: &[&str] = &[".claude", ".agents"];
const IGNORED_SKILL_DIR_NAMES: &[&str] = &["codex-primary-runtime"];

/// JS: opencodeGlobalConfigDir(home)
pub fn opencode_global_config_dir(env: &Env, home: &str) -> String {
    if let Some(v) = env.get("OPENCODE_CONFIG_DIR").filter(|v| !v.is_empty()) {
        return v.clone();
    }
    if let Some(v) = env.get("XDG_CONFIG_HOME").filter(|v| !v.is_empty()) {
        return jsp::join(&[v, "opencode"]);
    }
    jsp::join(&[home, ".config", "opencode"])
}

/// JS: hermesGlobalHome(home): honor $HERMES_HOME only when it sits under
/// `home` (resolved against cwd like `path.resolve`).
pub fn hermes_global_home(env: &Env, cwd: &str, home: &str) -> String {
    if let Some(env_home) = env.get("HERMES_HOME").filter(|v| !v.is_empty()) {
        let resolved_env = jsp::resolve(cwd, &[env_home]);
        let resolved_home = jsp::resolve(cwd, &[home]);
        if resolved_env == resolved_home || resolved_env.starts_with(&format!("{resolved_home}/")) {
            return resolved_env;
        }
    }
    jsp::join(&[home, ".hermes"])
}

/// JS: HOME_SKILLS_DIR_OVERRIDES[provider]?.(home)
fn home_skills_dir_override(env: &Env, cwd: &str, provider: &str, home: &str) -> Option<String> {
    match provider {
        ".agent" => Some(jsp::join(&[home, ".gemini", "config", "skills"])),
        ".hermes" => Some(jsp::join(&[&hermes_global_home(env, cwd, home), "skills"])),
        ".pi" => Some(jsp::join(&[home, ".pi", "agent", "skills"])),
        ".opencode" => Some(jsp::join(&[&opencode_global_config_dir(env, home), "skills"])),
        _ => None,
    }
}

fn has_home_override(provider: &str) -> bool {
    matches!(provider, ".agent" | ".hermes" | ".pi" | ".opencode")
}

/// Everything the scans need from the process: env, cwd, and the resolved
/// home directory (Node `os.homedir()`).
#[derive(Clone)]
pub struct Sys {
    pub env: Env,
    pub cwd: String,
    pub home: String,
}

impl Sys {
    pub fn new(env: Env, cwd: String) -> Sys {
        let home = util::homedir(&env);
        Sys { env, cwd, home }
    }

    /// JS: userProviderSkillsDir(home, provider)
    pub fn user_provider_skills_dir(&self, home: &str, provider: &str) -> String {
        home_skills_dir_override(&self.env, &self.cwd, provider, home)
            .unwrap_or_else(|| jsp::join(&[home, provider, "skills"]))
    }

    /// JS: isHomeDir(root)
    pub fn is_home_dir(&self, root: &str) -> bool {
        if root == self.home {
            return true;
        }
        match (util::realpath(root), util::realpath(&self.home)) {
            (Some(a), Some(b)) => a == b,
            _ => false,
        }
    }

    /// JS: providerSkillsDirCandidates(root, provider, scope)
    pub fn provider_skills_dir_candidates(&self, root: &str, provider: &str, scope: Option<Scope>) -> Vec<String> {
        if scope == Some(Scope::User) {
            return vec![self.user_provider_skills_dir(root, provider)];
        }
        let mut dirs = vec![jsp::join(&[root, provider, "skills"])];
        if scope != Some(Scope::Project) && has_home_override(provider) && self.is_home_dir(root) {
            dirs.insert(0, self.user_provider_skills_dir(root, provider));
        }
        dirs
    }

    /// JS: existingSkillsDirs(root, provider, scope)
    pub fn existing_skills_dirs(&self, root: &str, provider: &str, scope: Option<Scope>) -> Vec<String> {
        self.provider_skills_dir_candidates(root, provider, scope)
            .into_iter()
            .filter(|d| util::exists(d))
            .collect()
    }

    /// JS: findProjectRoot()
    pub fn find_project_root(&self) -> String {
        let mut dir = self.cwd.clone();
        while dir != jsp::dirname(&dir) {
            if util::exists(&jsp::join(&[&dir, ".git"])) {
                return dir;
            }
            dir = jsp::dirname(&dir);
        }
        self.cwd.clone()
    }

    /// JS: formatPathForDisplay(path, home = homedir())
    pub fn format_path_for_display(&self, path: &str) -> String {
        format_path_for_display(path, &self.home)
    }

    /// JS: getSkillsVersion(root, scope)
    pub fn get_skills_version(&self, root: &str, scope: Option<Scope>) -> Option<String> {
        for d in PROVIDER_DIRS {
            for skills_dir in self.provider_skills_dir_candidates(root, d, scope) {
                let skill_md = jsp::join(&[&skills_dir, "impeccable", "SKILL.md"]);
                if !util::exists(&skill_md) {
                    continue;
                }
                let Ok(content) = util::read_text(&skill_md) else { continue };
                if let Some(v) = extract_version(&content) {
                    return Some(v);
                }
            }
        }
        None
    }

    /// JS: isAlreadyInstalled(root, scope): the first provider dir holding an
    /// impeccable skill (canonical, prefixed, or legacy `teach-`).
    pub fn is_already_installed(&self, root: &str, scope: Option<Scope>) -> Option<&'static str> {
        for d in PROVIDER_DIRS {
            for skills_dir in self.existing_skills_dirs(root, d, scope) {
                if let Some(entries) = util::read_dir_names(&skills_dir) {
                    if entries.iter().any(|e| is_impeccable_skill_name(e)) {
                        return Some(d);
                    }
                }
            }
        }
        None
    }

    /// JS: migrateUnprefixImpeccable(root, scope)
    pub fn migrate_unprefix_impeccable(&self, root: &str, scope: Option<Scope>) -> usize {
        let mut migrated = 0;
        for d in PROVIDER_DIRS {
            for skills_dir in self.existing_skills_dirs(root, d, scope) {
                let Some(entries) = util::read_dir_names(&skills_dir) else { continue };
                for name in entries {
                    if name == "impeccable" || name == "teach-impeccable" {
                        continue;
                    }
                    if !name.ends_with("-impeccable") {
                        continue;
                    }
                    if !is_real_skill_dir(&skills_dir, &name) {
                        continue;
                    }
                    let dest = jsp::join(&[&skills_dir, "impeccable"]);
                    util::rm_rf(&dest);
                    if util::rename(&jsp::join(&[&skills_dir, &name]), &dest).is_ok() {
                        migrated += 1;
                    }
                }
            }
        }
        migrated
    }

    /// JS: findInstalledProviders(root, scope)
    pub fn find_installed_providers(&self, root: &str, scope: Option<Scope>) -> Vec<&'static str> {
        let mut found = Vec::new();
        for d in PROVIDER_DIRS {
            for skills_dir in self.existing_skills_dirs(root, d, scope) {
                if let Some(entries) = util::read_dir_names(&skills_dir) {
                    if entries.iter().any(|n| is_skill_dir(&skills_dir, n)) {
                        found.push(*d);
                        break;
                    }
                }
            }
        }
        found
    }

    /// JS: findImpeccableProviders(root, scope)
    pub fn find_impeccable_providers(&self, root: &str, scope: Option<Scope>) -> Vec<&'static str> {
        let mut found = Vec::new();
        for d in PROVIDER_DIRS {
            for skills_dir in self.existing_skills_dirs(root, d, scope) {
                let Some(entries) = util::read_dir_names(&skills_dir) else { continue };
                if entries.iter().any(|e| is_impeccable_skill_name(e)) {
                    found.push(*d);
                    break;
                }
            }
        }
        found
    }

    /// JS: findLinkedProviders(root, providers, scope)
    pub fn find_linked_providers<'a>(&self, root: &str, providers: &[&'a str], scope: Option<Scope>) -> Vec<&'a str> {
        providers
            .iter()
            .copied()
            .filter(|provider| {
                self.provider_skills_dir_candidates(root, provider, scope)
                    .iter()
                    .any(|skills_dir| util::is_symlink(&jsp::join(&[skills_dir, "impeccable"])))
            })
            .collect()
    }

    /// JS: deduplicateProviders(root, providers, scope): one entry per unique
    /// real skills path.
    pub fn deduplicate_providers<'a>(&self, root: &str, providers: &[&'a str], scope: Option<Scope>) -> Vec<(&'a str, String)> {
        let mut seen: Vec<String> = Vec::new();
        let mut out = Vec::new();
        for provider in providers {
            for skills_dir in self.existing_skills_dirs(root, provider, scope) {
                let real = util::realpath(&skills_dir).unwrap_or_else(|| skills_dir.clone());
                if !seen.contains(&real) {
                    seen.push(real);
                    out.push((*provider, skills_dir));
                }
            }
        }
        out
    }

    /// JS: collectInstallDetections(root, home)
    pub fn collect_install_detections(&self, root: &str) -> Vec<Detection> {
        let home = self.home.as_str();
        let mut detections = Vec::new();
        for provider in PROVIDER_DIRS {
            let found_path = jsp::join(&[root, provider]);
            if !util::exists(&found_path) {
                continue;
            }
            detections.push(Detection {
                provider,
                scope: Scope::Project,
                found_path,
                has_real_skills: has_real_skill_entries(&jsp::join(&[root, provider, "skills"])),
            });
        }
        for hint in GLOBAL_HARNESS_HINTS {
            let (found_path, probe_paths) = match hint {
                Hint::Home(rel, provider) => {
                    let found = jsp::join(&[home, rel]);
                    let probes = unique_paths(vec![
                        self.user_provider_skills_dir(home, provider),
                        jsp::join(&[home, rel, "skills"]),
                    ]);
                    (found, probes)
                }
                Hint::OpencodeConfig(provider) => {
                    let found = opencode_global_config_dir(&self.env, home);
                    let probes = unique_paths(vec![
                        self.user_provider_skills_dir(home, provider),
                        jsp::join(&[&found, "skills"]),
                    ]);
                    (found, probes)
                }
            };
            if !util::exists(&found_path) {
                continue;
            }
            detections.push(Detection {
                provider: hint.provider(),
                scope: Scope::User,
                found_path,
                has_real_skills: probe_paths.iter().any(|p| has_real_skill_entries(p)),
            });
        }
        detections
    }

    /// JS: resolveInstallTargets(root, providersValue)
    pub fn resolve_install_targets(&self, root: &str, providers_value: Option<&str>) -> Vec<&'static str> {
        if let Some(v) = providers_value {
            return parse_provider_list(v).0;
        }
        let detected = default_detected_providers(&self.collect_install_detections(root));
        if !detected.is_empty() {
            return detected;
        }
        DEFAULT_TARGETS.to_vec()
    }

    /// JS: resolveUpdateTarget({projectRoot, home, explicitScope})
    pub fn resolve_update_target(&self, project_root: &str, explicit_scope: Option<Scope>) -> Option<UpdateTarget> {
        let home = self.home.clone();
        let home_rooted = self.is_home_dir(project_root);
        if home_rooted && explicit_scope.is_none() {
            let providers = self.find_installed_providers(&home, None);
            return if providers.is_empty() {
                None
            } else {
                // JS: agentScope 'user' — the skill scope stays inferred, but
                // agent freshness and refresh must target the user agent dirs
                // (upstream d2a9efb9).
                Some(UpdateTarget::Resolved { root: home, scope: None, agent_scope: Some(Scope::User), providers, scope_label: "user level" })
            };
        }
        let project_providers = if home_rooted {
            Vec::new()
        } else {
            self.find_impeccable_providers(project_root, Some(Scope::Project))
        };
        let user_providers = self.find_impeccable_providers(&home, Some(Scope::User));
        match explicit_scope {
            Some(Scope::User) => {
                return if user_providers.is_empty() {
                    None
                } else {
                    Some(UpdateTarget::Resolved { root: home, scope: Some(Scope::User), agent_scope: Some(Scope::User), providers: user_providers, scope_label: "user level" })
                };
            }
            Some(Scope::Project) => {
                return if project_providers.is_empty() {
                    None
                } else {
                    Some(UpdateTarget::Resolved { root: project_root.to_string(), scope: Some(Scope::Project), agent_scope: Some(Scope::Project), providers: project_providers, scope_label: "this project" })
                };
            }
            None => {}
        }
        if !project_providers.is_empty() && !user_providers.is_empty() {
            return Some(UpdateTarget::Ambiguous { project_providers, user_providers });
        }
        if !project_providers.is_empty() {
            return Some(UpdateTarget::Resolved { root: project_root.to_string(), scope: Some(Scope::Project), agent_scope: Some(Scope::Project), providers: project_providers, scope_label: "this project" });
        }
        if !user_providers.is_empty() {
            return Some(UpdateTarget::Resolved { root: home, scope: Some(Scope::User), agent_scope: Some(Scope::User), providers: user_providers, scope_label: "user level" });
        }
        None
    }
}

pub enum UpdateTarget {
    /// `agent_scope` is the JS `agentScope = scope` default made explicit:
    /// identical to `scope` everywhere except the home-rooted implicit
    /// branch, which infers 'user' for the agent artifacts (d2a9efb9).
    Resolved { root: String, scope: Option<Scope>, agent_scope: Option<Scope>, providers: Vec<&'static str>, scope_label: &'static str },
    Ambiguous { project_providers: Vec<&'static str>, user_providers: Vec<&'static str> },
}

enum Hint {
    Home(&'static str, &'static str),
    OpencodeConfig(&'static str),
}

impl Hint {
    fn provider(&self) -> &'static str {
        match self {
            Hint::Home(_, p) | Hint::OpencodeConfig(p) => p,
        }
    }
}

const GLOBAL_HARNESS_HINTS: &[Hint] = &[
    Hint::Home(".agent", ".agent"),
    Hint::Home(".gemini/antigravity", ".agent"),
    Hint::Home(".gemini/antigravity-cli", ".agent"),
    Hint::Home(".gemini/antigravity-ide", ".agent"),
    Hint::Home(".claude", ".claude"),
    Hint::Home(".codex", ".agents"),
    Hint::Home(".cursor", ".cursor"),
    Hint::Home(".gemini", ".gemini"),
    Hint::Home(".grok", ".grok"),
    Hint::Home(".hermes", ".hermes"),
    Hint::Home(".kiro", ".kiro"),
    Hint::Home(".opencode", ".opencode"),
    Hint::OpencodeConfig(".opencode"),
    Hint::Home(".pi", ".pi"),
    Hint::Home(".qoder", ".qoder"),
    Hint::Home(".rovodev", ".rovodev"),
    Hint::Home(".vibe", ".vibe"),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scope {
    User,
    Project,
}

impl Scope {
    /// The `'user'` / `'project'` string the JS carried.
    pub fn as_str(self) -> &'static str {
        match self {
            Scope::User => "user",
            Scope::Project => "project",
        }
    }
}

#[derive(Debug, Clone)]
pub struct Detection {
    pub provider: &'static str,
    pub scope: Scope,
    pub found_path: String,
    pub has_real_skills: bool,
}

fn unique_paths(paths: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for p in paths {
        if !out.contains(&p) {
            out.push(p);
        }
    }
    out
}

/// `e === 'impeccable' || e.endsWith('-impeccable') || e === 'teach-impeccable' || e.endsWith('-teach-impeccable')`
fn is_impeccable_skill_name(e: &str) -> bool {
    e == "impeccable" || e.ends_with("-impeccable") || e == "teach-impeccable" || e.ends_with("-teach-impeccable")
}

/// JS: isSkillDir(skillsDir, name)
pub fn is_skill_dir(skills_dir: &str, name: &str) -> bool {
    let full = jsp::join(&[skills_dir, name]);
    util::is_dir(&full) && util::exists(&jsp::join(&[&full, "SKILL.md"]))
}

/// JS: hasRealSkillEntries(skillsDir)
pub fn has_real_skill_entries(skills_dir: &str) -> bool {
    if !util::exists(skills_dir) {
        return false;
    }
    let Some(entries) = util::read_dir_names(skills_dir) else { return false };
    entries.iter().any(|name| {
        !name.starts_with('.') && !IGNORED_SKILL_DIR_NAMES.contains(&name.as_str()) && is_skill_dir(skills_dir, name)
    })
}

/// JS: isRealSkillDir(skillsDir, name)
pub fn is_real_skill_dir(skills_dir: &str, name: &str) -> bool {
    let full = jsp::join(&[skills_dir, name]);
    util::is_real_dir(&full) && util::exists(&jsp::join(&[&full, "SKILL.md"]))
}

/// JS: skills.mjs#parseSkillFrontmatterVersion
///
/// Codex's validator rejects unknown top-level keys, so the Codex and
/// `.agents` skills carry `version` under the spec-defined `metadata:` map
/// (#703). A metadata version wins; a legacy top-level one still reads.
fn extract_version(content: &str) -> Option<String> {
    let body = frontmatter_body(content)?;

    let mut metadata_version: Option<String> = None;
    let mut top_level_version: Option<String> = None;
    let mut in_metadata = false;
    let mut metadata_indent: Option<usize> = None;

    for line in body.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        let trimmed_start = line.trim_start();
        if trimmed_start.is_empty() || trimmed_start.starts_with('#') {
            continue;
        }
        let indent_text: String = line.chars().take_while(|c| *c == ' ' || *c == '\t').collect();
        // JS `indentText.replace(/\t/g, '  ').length`.
        let indent = indent_text.replace('\t', "  ").chars().count();

        if indent == 0 {
            in_metadata = is_metadata_key_line(line);
            metadata_indent = None;
            if let Some(v) = version_value(line) {
                top_level_version = Some(v);
            }
            continue;
        }
        if !in_metadata {
            continue;
        }
        if metadata_indent.is_none() {
            metadata_indent = Some(indent);
        }
        if metadata_indent != Some(indent) {
            continue;
        }
        if let Some(v) = version_value(line.trim()) {
            metadata_version = Some(v);
        }
    }

    let value = metadata_version.or(top_level_version)?;
    let v = value.trim();
    if v.is_empty() {
        return None;
    }
    // JS `.replace(/^(["'])(.*)\1$/, '$2')`: only a matched pair is stripped.
    let chars: Vec<char> = v.chars().collect();
    if chars.len() >= 2 {
        let first = chars[0];
        if (first == '"' || first == '\'') && chars[chars.len() - 1] == first {
            return Some(chars[1..chars.len() - 1].iter().collect());
        }
    }
    Some(v.to_string())
}

/// JS `/^---[ \t]*\r?\n([\s\S]*?)\r?\n---(?:[ \t]*\r?\n|[ \t]*$)/`.
fn frontmatter_body(content: &str) -> Option<&str> {
    let rest = content.strip_prefix("---")?;
    let rest = rest.trim_start_matches([' ', '\t']);
    let rest = rest.strip_prefix("\r\n").or_else(|| rest.strip_prefix('\n'))?;
    let mut from = 0usize;
    while let Some(idx) = rest[from..].find("\n---") {
        let at = from + idx;
        let after = &rest[at + 4..];
        let tail = after.trim_start_matches([' ', '\t']);
        if tail.is_empty() || tail.starts_with('\n') || tail.starts_with("\r\n") {
            let body = &rest[..at];
            return Some(body.strip_suffix('\r').unwrap_or(body));
        }
        from = at + 1;
    }
    None
}

/// JS `/^metadata:\s*(?:#.*)?$/`.
fn is_metadata_key_line(line: &str) -> bool {
    let Some(rest) = line.strip_prefix("metadata:") else { return false };
    let rest = rest.trim_start_matches(|c: char| c.is_whitespace());
    rest.is_empty() || rest.starts_with('#')
}

/// JS `/^version:\s*(.+?)\s*$/` on an already-trimmed line.
fn version_value(line: &str) -> Option<String> {
    let rest = line.strip_prefix("version:")?;
    let v = rest.trim();
    if v.is_empty() {
        None
    } else {
        Some(v.to_string())
    }
}

/// JS: getFlagValue(flags, name): `--name=value` or `--name value`.
pub fn get_flag_value<'a>(flags: &'a [String], name: &str) -> Option<&'a str> {
    let prefix = format!("{name}=");
    if let Some(inline) = flags.iter().find(|f| f.starts_with(&prefix)) {
        return Some(&inline[prefix.len()..]);
    }
    if let Some(index) = flags.iter().position(|f| f == name) {
        if let Some(next) = flags.get(index + 1) {
            if !next.is_empty() && !next.starts_with('-') {
                return Some(next);
            }
        }
    }
    None
}

/// JS: normalizeProviderName(value)
pub fn normalize_provider_name(value: &str) -> Option<&'static str> {
    let raw = value.trim();
    if raw.is_empty() {
        return None;
    }
    if let Some(p) = PROVIDER_DIRS.iter().find(|p| **p == raw) {
        return Some(p);
    }
    let key = raw.strip_prefix('.').unwrap_or(raw).to_lowercase();
    PROVIDER_ALIASES.iter().find(|(k, _)| *k == key).map(|(_, v)| *v)
}

/// JS: parseProviderList(value) -> (providers, invalid)
pub fn parse_provider_list(value: &str) -> (Vec<&'static str>, Vec<String>) {
    let mut providers = Vec::new();
    let mut invalid = Vec::new();
    for raw in value.split(',').map(str::trim).filter(|s| !s.is_empty()) {
        match normalize_provider_name(raw) {
            Some(p) => {
                if !providers.contains(&p) {
                    providers.push(p);
                }
            }
            None => invalid.push(raw.to_string()),
        }
    }
    (providers, invalid)
}

/// JS: providerInputName(provider)
pub fn provider_input_name(provider: &str) -> String {
    PROVIDER_DISPLAY
        .iter()
        .find(|(p, _, _)| *p == provider)
        .map(|(_, _, input)| input.to_string())
        .unwrap_or_else(|| provider.strip_prefix('.').unwrap_or(provider).to_string())
}

/// JS: providerDisplayName(provider)
pub fn provider_display_name(provider: &str) -> String {
    PROVIDER_DISPLAY
        .iter()
        .find(|(p, _, _)| *p == provider)
        .map(|(_, name, _)| name.to_string())
        .unwrap_or_else(|| provider.to_string())
}

/// JS: formatProviderList(providers)
pub fn format_provider_list(providers: &[&str]) -> String {
    providers.iter().map(|p| provider_input_name(p)).collect::<Vec<_>>().join(", ")
}

/// JS: formatPathForDisplay(path, home)
pub fn format_path_for_display(path: &str, home: &str) -> String {
    if path == home {
        return "~".to_string();
    }
    if let Some(rest) = path.strip_prefix(&format!("{home}/")) {
        return format!("~/{rest}");
    }
    path.to_string()
}

/// JS: uniqueProviders(detections)
pub fn unique_providers(detections: &[&Detection]) -> Vec<&'static str> {
    let mut out: Vec<&'static str> = Vec::new();
    for d in detections {
        if !out.contains(&d.provider) {
            out.push(d.provider);
        }
    }
    out
}

/// JS: defaultDetectedProviders(detections)
pub fn default_detected_providers(detections: &[Detection]) -> Vec<&'static str> {
    let project: Vec<&Detection> = detections.iter().filter(|d| d.scope == Scope::Project).collect();
    let project_providers = unique_providers(&project);
    if !project_providers.is_empty() {
        return project_providers;
    }
    let user: Vec<&Detection> = detections.iter().filter(|d| d.scope == Scope::User).collect();
    unique_providers(&user)
}

/// JS: normalizeInstallScope(value)
pub fn normalize_install_scope(value: &str) -> Option<Scope> {
    match value.trim().to_lowercase().as_str() {
        "u" | "user" | "home" | "global" => Some(Scope::User),
        "p" | "project" | "local" | "repo" => Some(Scope::Project),
        _ => None,
    }
}

/// JS: getInstallScopeValue(flags): the raw scope string (`user`/`project`
/// for the boolean flags, else the `--scope`/`--install-scope` value).
pub fn get_install_scope_value(flags: &[String]) -> Option<String> {
    let has = |f: &str| flags.iter().any(|x| x == f);
    if has("--user") || has("--home") || has("--global") {
        return Some("user".to_string());
    }
    if has("--project") || has("--local") {
        return Some("project".to_string());
    }
    get_flag_value(flags, "--scope")
        .or_else(|| get_flag_value(flags, "--install-scope"))
        .map(str::to_string)
}

/// JS: defaultInstallScope(detections, providers)
pub fn default_install_scope(detections: &[Detection], providers: &[&str]) -> Scope {
    if detections.iter().any(|d| providers.contains(&d.provider) && d.scope == Scope::Project) {
        return Scope::Project;
    }
    if detections.iter().any(|d| providers.contains(&d.provider) && d.scope == Scope::User && d.has_real_skills) {
        return Scope::User;
    }
    Scope::Project
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_aliases_resolve() {
        assert_eq!(normalize_provider_name("codex"), Some(".agents"));
        assert_eq!(normalize_provider_name(".Claude"), Some(".claude"));
        assert_eq!(normalize_provider_name(".claude"), Some(".claude"));
        assert_eq!(normalize_provider_name("rovo-dev"), Some(".rovodev"));
        assert_eq!(normalize_provider_name("nope"), None);
        let (p, invalid) = parse_provider_list("claude, codex,claude,zzz");
        assert_eq!(p, vec![".claude", ".agents"]);
        assert_eq!(invalid, vec!["zzz"]);
    }

    #[test]
    fn version_extraction() {
        // Values recorded from origin/main's parseSkillFrontmatterVersion (#703).
        assert_eq!(extract_version("---\nname: x\nversion: \"9.9.9\"\n---").as_deref(), Some("9.9.9"));
        assert_eq!(extract_version("---\nname: x\n---"), None);
        assert_eq!(extract_version("---\nname: x\nversion: 4.1.3\n---\n\nbody\n").as_deref(), Some("4.1.3"));
        assert_eq!(extract_version("---\nname: x\nversion: '4.1.3'\n---\n").as_deref(), Some("4.1.3"));
        assert_eq!(
            extract_version("---\nname: x\nmetadata:\n  version: 4.1.3\n  argument-hint: \"[t]\"\n---\n").as_deref(),
            Some("4.1.3")
        );
        assert_eq!(extract_version("---\nversion: 1.0.0\nmetadata:\n  version: 4.1.3\n---\n").as_deref(), Some("4.1.3"));
        assert_eq!(
            extract_version("---\nmetadata:\n  version: 4.1.3\nname: x\nversion: 2.0.0\n---\n").as_deref(),
            Some("4.1.3")
        );
        assert_eq!(
            extract_version("---\nmetadata:\n  a:\n    version: 9.9.9\n  version: 4.1.3\n---\n").as_deref(),
            Some("4.1.3")
        );
        assert_eq!(extract_version("---\nmetadata:\n\tversion: 4.1.3\n---\n").as_deref(), Some("4.1.3"));
        assert_eq!(extract_version("---\nmetadata: # note\n  version: 4.1.3\n---\n").as_deref(), Some("4.1.3"));
        assert_eq!(extract_version("---\r\nmetadata:\r\n  version: 4.1.3\r\n---\r\n").as_deref(), Some("4.1.3"));
        assert_eq!(extract_version("---\n# version: 9.9.9\nversion: 4.1.3\n---\n").as_deref(), Some("4.1.3"));
        assert_eq!(extract_version("---  \nversion: 4.1.3\n---  \n").as_deref(), Some("4.1.3"));
        assert_eq!(extract_version("version: 4.1.3\n"), None);
        assert_eq!(extract_version("---\nversion:\n---\n"), None);
    }

    #[test]
    fn flag_values() {
        let flags: Vec<String> = ["--providers=claude", "--scope", "user", "--x"].iter().map(|s| s.to_string()).collect();
        assert_eq!(get_flag_value(&flags, "--providers"), Some("claude"));
        assert_eq!(get_flag_value(&flags, "--scope"), Some("user"));
        assert_eq!(get_flag_value(&flags, "--x"), None);
    }
}
