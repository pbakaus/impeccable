//! Provider (harness) directories, aliases, global-skill layouts, harness
//! detection, and the install-tree scans. JS: skills.mjs top section plus
//! `findProjectRoot` / `findInstalledProviders` / `findImpeccableProviders` /
//! `findLinkedProviders` / `resolveUpdateTarget` / `getSkillsVersion`.

use crate::util::{self, jsp, Env};

pub const API_BASE: &str = "https://impeccable.style";

pub const PROVIDER_DIRS: &[&str] = &[
    ".claude", ".cursor", ".devin", ".dsh", ".gemini", ".agents", ".agent", ".github", ".grok", ".hermes", ".kiro",
    ".opencode", ".pi", ".omp", ".qoder", ".trae", ".trae-cn", ".rovodev", ".vibe",
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
    ("deepseek", ".dsh"),
    ("deepseek-harness", ".dsh"),
    ("devin", ".devin"),
    ("dsh", ".dsh"),
    ("gemini", ".gemini"),
    ("github", ".github"),
    ("grok", ".grok"),
    ("grok-build", ".grok"),
    ("hermes", ".hermes"),
    ("xai", ".grok"),
    ("kiro", ".kiro"),
    ("opencode", ".opencode"),
    ("pi", ".pi"),
    ("omp", ".omp"),
    ("oh-my-pi", ".omp"),
    ("qoder", ".qoder"),
    ("replit", ".agents"),
    ("rovo-dev", ".rovodev"),
    ("rovodev", ".rovodev"),
    ("trae", ".trae"),
    ("trae-cn", ".trae-cn"),
    ("vibe", ".vibe"),
    ("windsurf", ".devin"),
];

const PROVIDER_DISPLAY: &[(&str, &str, &str)] = &[
    (".agent", "Antigravity", "antigravity"),
    (".agents", "Codex CLI", "codex"),
    (".claude", "Claude Code", "claude"),
    (".cursor", "Cursor", "cursor"),
    (".devin", "Devin", "devin"),
    (".dsh", "DeepSeek Harness", "dsh"),
    (".gemini", "Gemini CLI", "gemini"),
    (".github", "GitHub Copilot", "github"),
    (".grok", "Grok Build", "grok"),
    (".hermes", "Hermes Agent", "hermes"),
    (".kiro", "Kiro", "kiro"),
    (".opencode", "OpenCode", "opencode"),
    (".pi", "Pi Coding Agent", "pi"),
    (".omp", "Oh My Pi", "omp"),
    (".qoder", "Qoder", "qoder"),
    (".rovodev", "Rovo Dev", "rovo-dev"),
    (".trae", "Trae", "trae"),
    (".trae-cn", "Trae CN", "trae-cn"),
    (".vibe", "Mistral Vibe", "vibe"),
];

/// Harnesses that read another provider's dir: (input name, label, provider
/// dir). Replit Agent loads `.agents/skills` exactly as Codex CLI does, so it
/// is a second harness on `.agents` rather than a provider of its own (#1019).
const SHARED_DIR_HARNESSES: &[(&str, &str, &str)] = &[("replit", "Replit Agent", ".agents")];

pub const PROVIDER_INPUT_ORDER: &[&str] = &[
    "antigravity", "claude", "codex", "replit", "cursor", "devin", "dsh", "gemini", "github", "grok", "hermes", "kiro",
    "opencode", "pi", "omp", "qoder", "trae", "trae-cn", "rovo-dev", "vibe",
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

/// Devin CLI and Desktop share one global config dir: `%APPDATA%\devin` on
/// Windows, else `$XDG_CONFIG_HOME/devin`, else `~/.config/devin`.
pub fn devin_global_config_dir(env: &Env, _cwd: &str, home: &str) -> String {
    if cfg!(windows) {
        if let Some(v) = env.get("APPDATA").filter(|v| !v.is_empty()) {
            return jsp::join(&[v, "devin"]);
        }
    }
    if let Some(v) = env.get("XDG_CONFIG_HOME").filter(|v| !v.is_empty()) {
        return jsp::join(&[v, "devin"]);
    }
    jsp::join(&[home, ".config", "devin"])
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

/// JS: dshGlobalHome(home): honor $DSH_HOME only when it sits under `home`
/// (resolved against cwd like `path.resolve`), mirroring hermesGlobalHome.
pub fn dsh_global_home(env: &Env, cwd: &str, home: &str) -> String {
    if let Some(env_home) = env.get("DSH_HOME").filter(|v| !v.is_empty()) {
        let resolved_env = jsp::resolve(cwd, &[env_home]);
        let resolved_home = jsp::resolve(cwd, &[home]);
        // Native path.relative handles Windows separators, drive/UNC roots,
        // and case folding without accepting a sibling with the same prefix.
        let relative = jsp::relative(cwd, &resolved_home, &resolved_env);
        if !jsp::is_absolute(&relative)
            && relative != ".."
            && !relative.starts_with(&format!("..{}", jsp::SEP))
        {
            return resolved_env;
        }
    }
    jsp::join(&[home, ".dsh"])
}

/// JS: HOME_SKILLS_DIR_OVERRIDES[provider]?.(home)
fn home_skills_dir_override(env: &Env, cwd: &str, provider: &str, home: &str) -> Option<String> {
    match provider {
        ".agent" => Some(jsp::join(&[home, ".gemini", "config", "skills"])),
        ".devin" => Some(jsp::join(&[&devin_global_config_dir(env, cwd, home), "skills"])),
        ".dsh" => Some(jsp::join(&[&dsh_global_home(env, cwd, home), "skills"])),
        ".hermes" => Some(jsp::join(&[&hermes_global_home(env, cwd, home), "skills"])),
        ".pi" => Some(jsp::join(&[home, ".pi", "agent", "skills"])),
        ".omp" => Some(jsp::join(&[home, ".omp", "agent", "skills"])),
        ".opencode" => Some(jsp::join(&[&opencode_global_config_dir(env, home), "skills"])),
        _ => None,
    }
}

fn has_home_override(provider: &str) -> bool {
    matches!(provider, ".agent" | ".devin" | ".dsh" | ".hermes" | ".pi" | ".omp" | ".opencode")
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
        // Shared probe pair for env-relocated config dirs (OpenCode, DSH, Devin):
        // the harness-specific user skills dir plus a direct
        // `<config-dir>/skills` fallback.
        let config_dir_detection = |provider: &'static str, found: String| {
            let probes = unique_paths(vec![
                self.user_provider_skills_dir(home, provider),
                jsp::join(&[&found, "skills"]),
            ]);
            (found, probes)
        };
        let mut hinted = Vec::new();
        for hint in HARNESS_HINTS {
            let harness = hint.harness();
            let Some((provider, _)) = harness_display_name(harness) else { continue };
            let (scope, found_path, probe_paths) = match hint {
                Hint::Project(rel, _) => (Scope::Project, jsp::join(&[root, rel]), vec![jsp::join(&[root, provider, "skills"])]),
                Hint::Home(rel, _) => {
                    let probes = unique_paths(vec![
                        self.user_provider_skills_dir(home, provider),
                        jsp::join(&[home, rel, "skills"]),
                    ]);
                    (Scope::User, jsp::join(&[home, rel]), probes)
                }
                Hint::ConfigDir(dir, _) => {
                    let (found, probes) = config_dir_detection(provider, dir(&self.env, &self.cwd, home));
                    (Scope::User, found, probes)
                }
            };
            if !util::exists(&found_path) {
                continue;
            }
            hinted.push(Detection {
                provider,
                scope,
                found_path,
                has_real_skills: probe_paths.iter().any(|p| has_real_skill_entries(p)),
                harness,
            });
        }
        // A provider dir in the project root is the generic signal; a project
        // hint for the same dir is the specific one and stands in for it.
        let mut detections = Vec::new();
        for provider in PROVIDER_DIRS {
            if hinted.iter().any(|d| d.scope == Scope::Project && d.provider == *provider) {
                continue;
            }
            let found_path = jsp::join(&[root, provider]);
            if !util::exists(&found_path) {
                continue;
            }
            detections.push(Detection {
                provider,
                scope: Scope::Project,
                found_path,
                has_real_skills: has_real_skill_entries(&jsp::join(&[root, provider, "skills"])),
                harness: provider_harness(provider),
            });
        }
        let (project, user): (Vec<Detection>, Vec<Detection>) = hinted.into_iter().partition(|d| d.scope == Scope::Project);
        detections.extend(project);
        detections.extend(user);
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

/// Where a harness leaves its mark, and which harness (by input name).
enum Hint {
    /// A file or dir in the project root: a project-scope detection.
    Project(&'static str, &'static str),
    Home(&'static str, &'static str),
    /// Config root resolved from `(env, cwd, home)`, for harnesses whose root
    /// an env var or OS convention relocates.
    ConfigDir(fn(&Env, &str, &str) -> String, &'static str),
}

fn opencode_hint_dir(env: &Env, _cwd: &str, home: &str) -> String {
    opencode_global_config_dir(env, home)
}

impl Hint {
    fn harness(&self) -> &'static str {
        match self {
            Hint::Project(_, h) | Hint::Home(_, h) | Hint::ConfigDir(_, h) => h,
        }
    }
}

const HARNESS_HINTS: &[Hint] = &[
    // Every Replit project carries `.replit` at its root; Replit Agent reads
    // `.agents/skills`, so this marks the `.agents` install as Replit (#1019).
    Hint::Project(".replit", "replit"),
    Hint::Home(".agent", "antigravity"),
    Hint::Home(".gemini/antigravity", "antigravity"),
    Hint::Home(".gemini/antigravity-cli", "antigravity"),
    Hint::Home(".gemini/antigravity-ide", "antigravity"),
    Hint::Home(".claude", "claude"),
    Hint::Home(".codex", "codex"),
    Hint::Home(".cursor", "cursor"),
    Hint::Home(".codeium/windsurf", "devin"),
    Hint::ConfigDir(devin_global_config_dir, "devin"),
    // `$DSH_HOME` relocates the whole config root, so detection must probe
    // the resolved home (which falls back to `~/.dsh`) rather than a fixed
    // relative path; a plain `Home` hint would miss a DSH_HOME-only setup.
    Hint::ConfigDir(dsh_global_home, "dsh"),
    Hint::Home(".gemini", "gemini"),
    Hint::Home(".grok", "grok"),
    Hint::Home(".hermes", "hermes"),
    Hint::Home(".kiro", "kiro"),
    Hint::Home(".opencode", "opencode"),
    Hint::ConfigDir(opencode_hint_dir, "opencode"),
    Hint::Home(".pi", "pi"),
    Hint::Home(".omp", "omp"),
    Hint::Home(".qoder", "qoder"),
    Hint::Home(".rovodev", "rovo-dev"),
    Hint::Home(".vibe", "vibe"),
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
    /// The harness that produced this detection, as its input name
    /// (`codex`, `replit`); one provider dir can host more than one.
    pub harness: &'static str,
}

impl Detection {
    /// The harness name shown in the detected list.
    pub fn label(&self) -> &'static str {
        harness_display_name(self.harness).map(|(_, label)| label).unwrap_or(self.harness)
    }
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

/// The provider dir and label for a harness input name such as `replit`.
pub fn harness_display_name(input: &str) -> Option<(&'static str, &'static str)> {
    PROVIDER_DISPLAY
        .iter()
        .find(|(_, _, i)| *i == input)
        .map(|(p, name, _)| (*p, *name))
        .or_else(|| SHARED_DIR_HARNESSES.iter().find(|(i, _, _)| *i == input).map(|(_, name, p)| (*p, *name)))
}

/// The harness a provider dir belongs to (its `PROVIDER_DISPLAY` row).
fn provider_harness(provider: &'static str) -> &'static str {
    PROVIDER_DISPLAY.iter().find(|(p, _, _)| *p == provider).map(|(_, _, input)| *input).unwrap_or(provider)
}

/// JS: providerDisplayName(provider)
pub fn provider_display_name(provider: &str) -> String {
    PROVIDER_DISPLAY
        .iter()
        .find(|(p, _, _)| *p == provider)
        .map(|(_, name, _)| name.to_string())
        .unwrap_or_else(|| provider.to_string())
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

/// The harness input names behind a set of detections, in order, once each.
pub fn unique_harnesses(detections: &[&Detection]) -> Vec<&'static str> {
    let mut out: Vec<&'static str> = Vec::new();
    for d in detections {
        if !out.contains(&d.harness) {
            out.push(d.harness);
        }
    }
    out
}

/// JS: defaultDetectedProviders(detections)
pub fn default_detected_providers(detections: &[Detection]) -> Vec<&'static str> {
    unique_providers(&default_detections(detections))
}

/// The detections that preselect harnesses: project ones, else user ones.
pub fn default_detections(detections: &[Detection]) -> Vec<&Detection> {
    let project: Vec<&Detection> = detections.iter().filter(|d| d.scope == Scope::Project).collect();
    if !project.is_empty() {
        return project;
    }
    detections.iter().filter(|d| d.scope == Scope::User).collect()
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
    fn omp_provider_resolves_paths() {
        assert_eq!(normalize_provider_name("omp"), Some(".omp"));
        assert_eq!(normalize_provider_name("oh-my-pi"), Some(".omp"));

        let home = if cfg!(windows) { r"C:\Users\u" } else { "/home/u" };
        let sys = Sys { env: Env::new(), cwd: home.into(), home: home.into() };

        assert_eq!(sys.user_provider_skills_dir(&home, ".omp"), jsp::join(&[&home, ".omp", "agent", "skills"]));
        assert_eq!(sys.provider_skills_dir_candidates("/project", ".omp", Some(Scope::Project)), vec![jsp::join(&["/project", ".omp", "skills"])]);

    }

    #[test]
    fn devin_provider_resolves_paths() {
        assert_eq!(normalize_provider_name("devin"), Some(".devin"));
        assert_eq!(normalize_provider_name("windsurf"), Some(".devin"));

        let home = if cfg!(windows) { r"C:\Users\u" } else { "/home/u" };
        let appdata = if cfg!(windows) { r"C:\Users\u\AppData\Roaming" } else { "/appdata" };
        let xdg = if cfg!(windows) { r"C:\xdg" } else { "/xdg" };
        let with_env = |pairs: &[(&str, &str)]| {
            let mut env = Env::new();
            for (k, v) in pairs {
                env.insert((*k).into(), (*v).into());
            }
            Sys { env, cwd: home.into(), home: home.into() }
        };
        let skills_dir = |sys: &Sys| sys.user_provider_skills_dir(home, ".devin");

        // Neither variable: ~/.config/devin on every OS.
        assert_eq!(skills_dir(&with_env(&[])), jsp::join(&[home, ".config", "devin", "skills"]));
        // XDG_CONFIG_HOME alone relocates the root on every OS.
        assert_eq!(skills_dir(&with_env(&[("XDG_CONFIG_HOME", xdg)])), jsp::join(&[xdg, "devin", "skills"]));
        // APPDATA wins over XDG_CONFIG_HOME on Windows and is ignored elsewhere.
        let both = skills_dir(&with_env(&[("APPDATA", appdata), ("XDG_CONFIG_HOME", xdg)]));
        let expected_root = if cfg!(windows) { appdata } else { xdg };
        assert_eq!(both, jsp::join(&[expected_root, "devin", "skills"]));
        let appdata_only = skills_dir(&with_env(&[("APPDATA", appdata)]));
        let expected = if cfg!(windows) { jsp::join(&[appdata, "devin", "skills"]) } else { jsp::join(&[home, ".config", "devin", "skills"]) };
        assert_eq!(appdata_only, expected);

        let sys = with_env(&[]);
        assert_eq!(sys.provider_skills_dir_candidates("/project", ".devin", Some(Scope::Project)), vec![jsp::join(&["/project", ".devin", "skills"])]);
    }

    #[test]
    fn replit_aliases_agents_without_displacing_codex() {
        assert_eq!(normalize_provider_name("replit"), Some(".agents"));
        assert_eq!(provider_display_name(".agents"), "Codex CLI");
        assert_eq!(provider_input_name(".agents"), "codex");
        assert_eq!(harness_display_name("replit"), Some((".agents", "Replit Agent")));
        assert_eq!(harness_display_name("codex"), Some((".agents", "Codex CLI")));
        assert_eq!(provider_harness(".agents"), "codex");
    }

    #[test]
    fn every_hint_and_picker_entry_names_a_known_harness() {
        for hint in HARNESS_HINTS {
            assert!(harness_display_name(hint.harness()).is_some(), "hint harness {}", hint.harness());
        }
        for input in PROVIDER_INPUT_ORDER {
            assert!(harness_display_name(input).is_some(), "picker input {input}");
        }
        for provider in PROVIDER_DIRS {
            assert!(harness_display_name(provider_harness(provider)).is_some(), "provider dir {provider}");
        }
    }

    #[test]
    fn dsh_provider_resolves() {
        assert_eq!(normalize_provider_name("dsh"), Some(".dsh"));
        assert_eq!(normalize_provider_name("deepseek"), Some(".dsh"));
        assert_eq!(normalize_provider_name("deepseek-harness"), Some(".dsh"));
        assert_eq!(normalize_provider_name(".dsh"), Some(".dsh"));
        assert_eq!(provider_display_name(".dsh"), "DeepSeek Harness");
        assert_eq!(provider_input_name(".dsh"), "dsh");

        // Default global skills dir is ~/.dsh/skills; $DSH_HOME wins only
        // when it sits under home, like $HERMES_HOME for .hermes.
        let cwd = if cfg!(windows) { r"C:\work" } else { "/work" };
        let home = if cfg!(windows) { r"C:\Users\u" } else { "/home/u" };
        let default = jsp::join(&[home, ".dsh"]);
        let custom = jsp::join(&[home, "custom-dsh"]);
        let env = Env::new();
        assert_eq!(dsh_global_home(&env, cwd, home), default);
        let mut env = Env::new();
        env.insert("DSH_HOME".into(), custom.clone());
        assert_eq!(dsh_global_home(&env, cwd, home), custom);
        env.insert("DSH_HOME".into(), "/elsewhere/dsh".into());
        assert_eq!(dsh_global_home(&env, cwd, home), default);
    }

    #[test]
    fn dsh_home_respects_resolved_path_boundaries() {
        let home = if cfg!(windows) { r"C:\Users\Test User" } else { "/home/Test User" };
        let cwd = jsp::join(&[home, "project"]);
        let default = jsp::join(&[home, ".dsh"]);
        for (value, expected) in [
            ("../custom dsh".to_string(), jsp::join(&[home, "custom dsh"])),
            (home.to_string(), home.to_string()),
            (String::new(), default.clone()),
            (format!("{home}-other/dsh"), default.clone()),
            (format!("{home}/../outside"), default),
        ] {
            let env = Env::from([("DSH_HOME".into(), value.clone())]);
            assert_eq!(dsh_global_home(&env, &cwd, home), expected, "DSH_HOME={value}");
        }
        // A drive/filesystem root has no extra separator to append.
        let root = if cfg!(windows) { "C:\\" } else { "/" };
        let child = jsp::join(&[root, "custom dsh"]);
        let env = Env::from([("DSH_HOME".into(), child.clone())]);
        assert_eq!(dsh_global_home(&env, root, root), child);
    }

    #[cfg(windows)]
    #[test]
    fn dsh_home_handles_windows_case_separators_and_devices() {
        for (home, value, expected) in [
            (r"C:\Users\Alice", "c:/users/alice/custom", r"c:\users\alice\custom"),
            (r"C:\Users\Alice", r"D:\Users\Alice\custom", r"C:\Users\Alice\.dsh"),
            (r"\\server\share\Alice", r"\\server\share\Alice\custom", r"\\server\share\Alice\custom"),
            (r"\\server\share\Alice", r"\\server\other\Alice\custom", r"\\server\share\Alice\.dsh"),
        ] {
            let env = Env::from([("DSH_HOME".into(), value.into())]);
            assert_eq!(dsh_global_home(&env, home, home), expected);
        }
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
