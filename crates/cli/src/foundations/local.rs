//! The foundations a project's own files can settle: one bounded, offline
//! walk of the root, then a check per item. Each check answers `Checked`,
//! `Failing`, or nothing (not sent) when the files can't prove either way.
//! Runs in a full `detect` and `impeccable foundations` only, never in the
//! edit hook.

use regex::Regex;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::rc::Rc;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

/// Paths the walk lists before it stops.
const MAX_FILES: usize = 20_000;
/// Directory entries the walk looks at, files and directories alike.
const MAX_ENTRIES: usize = 100_000;
/// Bytes the read cache keeps; past it, files are read but not kept.
const MAX_CACHED: usize = 64 * 1024 * 1024;
/// Bytes the secrets scan reads in all; past it, nothing is proven.
const MAX_SECRET_BYTES: u64 = 256 * 1024 * 1024;
/// Files read for their content.
const MAX_READS: usize = 6_000;
/// Bytes read from one file.
const MAX_BYTES: u64 = 512 * 1024;
/// Larger files are data or bundles, not source anyone wrote: never read.
const MAX_FILE: u64 = 2 * 1024 * 1024;
const GIANT_LINES: usize = 1_000;
/// Tracked files read for key formats.
const MAX_SECRET_READS: usize = 20_000;
const GIT_DEADLINE: Duration = Duration::from_secs(3);

const SKIP_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "dist",
    "build",
    "target",
    "vendor",
    ".next",
    ".svelte-kit",
    ".nuxt",
    ".output",
    "out",
    "coverage",
    "__pycache__",
    ".venv",
    "venv",
    ".turbo",
    ".cache",
    ".vercel",
    ".netlify",
    ".astro",
    ".parcel-cache",
    "bower_components",
    "Pods",
    ".gradle",
    "storybook-static",
    "public/build",
];
/// Hidden directories the checks need; every other one is skipped.
const HIDDEN_KEPT: &[&str] = &[
    ".github",
    ".circleci",
    ".gitlab",
    ".storybook",
    ".renovaterc",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum State {
    Checked,
    Failing,
}

impl State {
    pub fn as_str(self) -> &'static str {
        match self {
            State::Checked => "checked",
            State::Failing => "failing",
        }
    }
}

/// Where a key-shaped string sits in a tracked file. Shown on the terminal
/// only: never uploaded, never in `--json`, and never the value itself.
pub struct SecretHit {
    pub file: String,
    pub line: usize,
    pub kind: &'static str,
}

#[derive(Default)]
pub struct Report {
    pub items: BTreeMap<&'static str, State>,
    pub secrets: Vec<SecretHit>,
    pub giant_files: Vec<(String, usize)>,
    /// No file at all under the root.
    pub empty: bool,
    /// A UI file carries an inline detector ignore, which can hide a finding.
    pub inline_ignores: bool,
    /// An HTML page loads a remote stylesheet or any script, so its styles
    /// aren't all in the files the detector read.
    pub unresolved_pages: bool,
}

struct Project {
    root: PathBuf,
    /// Relative, `/`-separated, sorted.
    files: Vec<String>,
    truncated: bool,
    reads: std::cell::Cell<usize>,
    read_capped: std::cell::Cell<bool>,
    cache: std::cell::RefCell<std::collections::HashMap<String, Option<Rc<str>>>>,
    cached: std::cell::Cell<usize>,
    /// The root package.json's dependencies: they name the framework.
    root_deps: BTreeSet<String>,
    /// Every manifest's, nested ones included: for SDK lookups.
    deps: BTreeSet<String>,
    scripts: BTreeSet<String>,
    package_jsons: Vec<Value>,
    has_manifest: bool,
    /// A web view's file names, mapped back to the real ones.
    alias: std::collections::HashMap<String, String>,
}

pub fn scan(root: &Path) -> Report {
    let mut p = Project::walk(root);
    let mut r = Report {
        empty: p.files.is_empty() && !p.truncated,
        ..Report::default()
    };
    if r.empty {
        return r;
    }
    p.load_manifests();
    // A folder inside a repository: CI and dependency config live at the
    // repository's top.
    let top = repo_top(root).filter(|t| !same_dir(t, root));
    let top_config = top.as_deref().map(Project::repo_config);
    let mut put = |id: &'static str, s: Option<State>| {
        if let Some(s) = s {
            r.items.insert(id, s);
        }
    };
    let ci = match &top_config {
        Some(t) if t.ci_runs_tests() != Some(State::Failing) => t.ci_runs_tests(),
        _ => p.ci_runs_tests(),
    };
    put("ci-runs-tests", ci.filter(|_| !p.notes_only()));
    let configured = p.dependency_configured()
        || top_config
            .as_ref()
            .is_some_and(|t| t.dependency_configured());
    put(
        "dependency-scanning",
        if configured {
            Some(State::Checked)
        } else {
            p.has_manifest.then_some(State::Failing)
        },
    );
    put("infrastructure-as-code", p.infrastructure_as_code());
    // A subfolder without a README of its own isn't judged by the top's.
    put(
        "readme-runs",
        p.readme_runs()
            .filter(|_| top.is_none() || p.readme().is_some()),
    );
    put("reversible-migrations", p.reversible_migrations());
    // The web app may sit in a folder of its own (an Astro srcDir, one app
    // folder beside the config): judge its items there.
    let view = p.web_view();
    let w = view.as_ref().unwrap_or(&p);
    if w.is_web() && w.recognised_layout() {
        put("app-icons", Some(w.app_icons()));
        put("not-found-page", w.not_found_page());
        put("social-previews", Some(w.social_previews()));
        put("legal-pages", Some(w.legal_pages()));
        put("error-tracking", Some(w.error_tracking()));
    }
    let (ignores, unresolved) = p.page_hints();
    r.inline_ignores = ignores;
    r.unresolved_pages = unresolved;
    put("reduced-motion", p.reduced_motion());
    put("design-tokens", p.design_tokens());
    let (giant, giant_state) = p.giant_files();
    put("no-giant-files", giant_state);
    r.giant_files = giant;
    // Past a cap some file went unread: only states a found file proves
    // stand then, never one that rests on not having found something.
    if p.read_capped.get() || p.truncated {
        const FOUND_PASS: &[&str] = &[
            "ci-runs-tests",
            "dependency-scanning",
            "infrastructure-as-code",
            "design-tokens",
            "app-icons",
            "not-found-page",
            "social-previews",
            "legal-pages",
            "error-tracking",
        ];
        const FOUND_FAIL: &[&str] = &[
            "secrets-out-of-repo",
            "no-giant-files",
            "reversible-migrations",
        ];
        r.items.retain(|id, s| match s {
            State::Checked => FOUND_PASS.contains(id),
            State::Failing => FOUND_FAIL.contains(id),
        });
    }
    // Git's file list and its own budget: the walk's caps don't touch it,
    // unless the walk stood in for git.
    let (secrets, secret_state, walked) = p.secrets();
    let incomplete = walked && (p.read_capped.get() || p.truncated);
    if let Some(s) = secret_state.filter(|s| !incomplete || *s == State::Failing) {
        r.items.insert("secrets-out-of-repo", s);
    }
    r.secrets = secrets;
    r
}

fn ext(path: &str) -> &str {
    let name = path.rsplit('/').next().unwrap_or(path);
    match name.rfind('.') {
        Some(i) if i > 0 => &name[i + 1..],
        _ => "",
    }
}

fn name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

fn re(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("valid pattern"))
}

const UI_EXTS: &[&str] = &[
    "html", "htm", "css", "scss", "sass", "less", "jsx", "tsx", "vue", "svelte", "astro",
];
const STYLE_EXTS: &[&str] = &[
    "css", "scss", "sass", "less", "html", "htm", "jsx", "tsx", "vue", "svelte", "astro", "js",
    "ts", "mjs",
];
const PAGE_EXTS: &[&str] = &[
    "html", "htm", "md", "mdx", "astro", "svelte", "vue", "tsx", "jsx", "ts", "js", "erb", "php",
    "liquid", "njk", "hbs", "ejs", "pug", "haml", "slim", "twig", "jinja", "jinja2", "j2",
];
/// Server-side template formats: what makes a server framework a website,
/// and so what every web check must also be able to read.
const TEMPLATE_EXTS: &[&str] = &[
    "erb", "php", "ejs", "pug", "haml", "slim", "twig", "njk", "jinja", "jinja2", "j2", "liquid",
    "hbs",
];

impl Project {
    fn walk(root: &Path) -> Project {
        let mut files = Vec::new();
        let mut truncated = false;
        let mut stack = vec![String::new()];
        let mut seen = 0usize;
        'walk: while let Some(dir) = stack.pop() {
            let Ok(entries) = std::fs::read_dir(root.join(&dir)) else {
                continue;
            };
            let mut listed = Vec::new();
            for e in entries.flatten() {
                seen += 1;
                if seen > MAX_ENTRIES {
                    truncated = true;
                    break 'walk;
                }
                listed.push(e);
            }
            let mut entries = listed;
            entries.sort_by_key(|e| e.file_name());
            let mut subdirs = Vec::new();
            for e in entries {
                let n = e.file_name().to_string_lossy().into_owned();
                let rel = if dir.is_empty() {
                    n.clone()
                } else {
                    format!("{dir}/{n}")
                };
                let Ok(ft) = e.file_type() else { continue };
                if ft.is_dir() {
                    let hidden = n.starts_with('.') && !HIDDEN_KEPT.contains(&n.as_str());
                    if !hidden
                        && !SKIP_DIRS.contains(&n.as_str())
                        && !SKIP_DIRS.contains(&rel.as_str())
                    {
                        subdirs.push(rel);
                    }
                } else if ft.is_file() {
                    if files.len() >= MAX_FILES {
                        truncated = true;
                        break 'walk;
                    }
                    files.push(rel);
                }
            }
            // Depth first, in name order.
            stack.extend(subdirs.into_iter().rev());
        }
        files.sort();
        Project {
            root: root.to_path_buf(),
            files,
            truncated,
            reads: Default::default(),
            read_capped: Default::default(),
            cache: Default::default(),
            cached: Default::default(),
            root_deps: BTreeSet::new(),
            deps: BTreeSet::new(),
            scripts: BTreeSet::new(),
            package_jsons: Vec::new(),
            has_manifest: false,
            alias: Default::default(),
        }
    }

    /// Just the CI and dependency-update config of a repository's top.
    fn repo_config(top: &Path) -> Project {
        let mut files: Vec<String> = [
            ".gitlab-ci.yml",
            ".circleci/config.yml",
            "bitbucket-pipelines.yml",
            "azure-pipelines.yml",
            ".github/dependabot.yml",
            ".github/dependabot.yaml",
            "renovate.json",
            "renovate.json5",
            ".renovaterc",
            ".renovaterc.json",
            ".github/renovate.json",
            ".github/renovate.json5",
            ".gitlab/renovate.json",
            ".snyk",
        ]
        .iter()
        .filter(|f| top.join(f).is_file())
        .map(|f| f.to_string())
        .collect();
        if let Ok(entries) = std::fs::read_dir(top.join(".github/workflows")) {
            for e in entries.flatten().take(200) {
                let n = e.file_name().to_string_lossy().into_owned();
                if e.file_type().is_ok_and(|t| t.is_file()) {
                    files.push(format!(".github/workflows/{n}"));
                }
            }
        }
        files.sort();
        let mut p = Project::walk(Path::new("/nonexistent-impeccable-root"));
        p.root = top.to_path_buf();
        p.files = files;
        p.truncated = false;
        p
    }

    /// The web app's own view when it doesn't sit at the root in the
    /// conventional layout: an Astro `srcDir`/`publicDir`, or the one
    /// folder beside the root that holds a framework config. Paths in the
    /// view are the conventional ones (`src/`, `public/`, the app root).
    fn web_view(&self) -> Option<Project> {
        const CONFIGS: &[&str] = &[
            "astro.config.",
            "next.config.",
            "svelte.config.",
            "nuxt.config.",
            "vite.config.",
            "gatsby-config.",
            "remix.config.",
            "react-router.config.",
            "angular.json",
        ];
        let is_config = |f: &str| CONFIGS.iter().any(|c| name(f).starts_with(c));
        let mut app = String::new();
        if !self.files.iter().any(|f| !f.contains('/') && is_config(f)) {
            let dirs: BTreeSet<&str> = self
                .files
                .iter()
                .filter(|f| f.matches('/').count() == 1 && is_config(f))
                .filter_map(|f| f.split('/').next())
                .collect();
            if dirs.len() == 1 {
                app = format!("{}/", dirs.into_iter().next().unwrap_or_default());
            }
        }
        // Astro names its source and public folders in its config.
        static DIR: OnceLock<Regex> = OnceLock::new();
        let dir = re(
            &DIR,
            r#"\b(srcDir|publicDir)\s*:\s*['"`](?:\./)?([^'"`]+?)/?['"`]"#,
        );
        let (mut src, mut public) = (None, None);
        if let Some(cfg) = self.files.iter().find(|f| {
            f.strip_prefix(app.as_str())
                .is_some_and(|r| !r.contains('/') && r.starts_with("astro.config."))
        }) {
            if let Some(t) = self.read(cfg) {
                for c in dir.captures_iter(&t) {
                    let d = format!("{app}{}/", &c[2]);
                    if &c[1] == "srcDir" {
                        src = Some(d);
                    } else {
                        public = Some(d);
                    }
                }
            }
        }
        if app.is_empty() && src.is_none() && public.is_none() {
            return None;
        }
        let mut alias = std::collections::HashMap::new();
        // A folder the config moved away from isn't the app's any more.
        let moved = |f: &str, dir: &Option<String>, conventional: &str| {
            dir.is_some() && f.starts_with(&format!("{app}{conventional}"))
        };
        for f in &self.files {
            let virt = if let Some(rest) = public.as_deref().and_then(|p| f.strip_prefix(p)) {
                format!("public/{rest}")
            } else if let Some(rest) = src.as_deref().and_then(|p| f.strip_prefix(p)) {
                format!("src/{rest}")
            } else if moved(f, &public, "public/") || moved(f, &src, "src/") {
                continue;
            } else if let Some(rest) = f.strip_prefix(app.as_str()) {
                rest.to_string()
            } else {
                continue;
            };
            alias.entry(virt).or_insert_with(|| f.clone());
        }
        let mut files: Vec<String> = alias.keys().cloned().collect();
        files.sort();
        let mut root_deps = self.root_deps.clone();
        if !app.is_empty() {
            if let Some(v) = self
                .read(&format!("{app}package.json"))
                .and_then(|t| serde_json::from_str::<Value>(&t).ok())
            {
                for key in ["dependencies", "devDependencies", "peerDependencies"] {
                    if let Some(o) = v.get(key).and_then(Value::as_object) {
                        root_deps.extend(o.keys().cloned());
                    }
                }
            }
        }
        Some(Project {
            root: self.root.clone(),
            files,
            truncated: self.truncated,
            reads: Default::default(),
            read_capped: Default::default(),
            cache: Default::default(),
            cached: Default::default(),
            root_deps,
            deps: self.deps.clone(),
            scripts: self.scripts.clone(),
            package_jsons: Vec::new(),
            has_manifest: self.has_manifest,
            alias,
        })
    }

    /// A layout the web checks know where to look in. Anything else sends
    /// nothing for them rather than a failure.
    fn recognised_layout(&self) -> bool {
        const PLACES: &[&str] = &[
            "public/",
            "static/",
            "src/",
            "app/",
            "pages/",
            "routes/",
            "layouts/",
            "_layouts/",
            "templates/",
            "views/",
            "resources/views/",
        ];
        self.any(|f| PLACES.iter().any(|p| f.starts_with(p)) || f == "index.html")
    }

    /// Inline detector ignores in UI files, and HTML pages whose styles
    /// come from outside the files (a remote stylesheet, any script).
    /// Unread files count as both, so a pass is never assumed.
    fn page_hints(&self) -> (bool, bool) {
        static OUTSIDE: OnceLock<Regex> = OnceLock::new();
        let outside = re(
            &OUTSIDE,
            r#"(?is)<script\b[^>]*\bsrc\s*=|<link\b[^>]*\bstylesheet\b[^>]*\bhref\s*=\s*["']?(?:https?:)?//|<link\b[^>]*\bhref\s*=\s*["']?(?:https?:)?//[^>]*\bstylesheet\b"#,
        );
        let (mut ignores, mut unresolved) = (false, false);
        for f in self.files.iter().filter(|f| UI_EXTS.contains(&ext(f))) {
            let Some(t) = self.read(f) else {
                return (true, true);
            };
            ignores |= t.contains("impeccable-disable") || t.contains("impeccable-ignore");
            if matches!(ext(f), "html" | "htm") {
                unresolved |= outside.is_match(&t);
            }
        }
        (ignores, unresolved)
    }

    fn has(&self, rel: &str) -> bool {
        self.files.binary_search_by(|f| f.as_str().cmp(rel)).is_ok()
    }

    fn any(&self, mut f: impl FnMut(&str) -> bool) -> bool {
        self.files.iter().any(|p| f(p))
    }

    /// A file's text, up to [`MAX_BYTES`]; `None` for binary, oversize or
    /// unreadable files, and once [`MAX_READS`] is spent (noted).
    fn read(&self, rel: &str) -> Option<Rc<str>> {
        if let Some(hit) = self.cache.borrow().get(rel) {
            return hit.clone();
        }
        if self.reads.get() >= MAX_READS {
            self.read_capped.set(true);
            return None;
        }
        self.reads.set(self.reads.get() + 1);
        let real = self.alias.get(rel).map_or(rel, String::as_str);
        let text: Option<Rc<str>> = read_capped(&self.root.join(real)).map(Rc::from);
        let size = text.as_ref().map_or(0, |t| t.len());
        if self.cached.get() + size <= MAX_CACHED {
            self.cached.set(self.cached.get() + size);
            self.cache
                .borrow_mut()
                .insert(rel.to_string(), text.clone());
        }
        text
    }

    fn load_manifests(&mut self) {
        let manifests = [
            "Cargo.toml",
            "pyproject.toml",
            "requirements.txt",
            "Pipfile",
            "Gemfile",
            "go.mod",
            "composer.json",
            "pom.xml",
            "build.gradle",
            "build.gradle.kts",
            "mix.exs",
            "package.json",
        ];
        let mut pkgs = Vec::new();
        for f in &self.files {
            let depth = f.matches('/').count();
            if depth > 2 {
                continue;
            }
            if manifests.contains(&name(f)) {
                self.has_manifest = true;
            }
            if name(f) == "package.json" {
                pkgs.push(f.clone());
            }
        }
        for f in pkgs {
            let Some(text) = self.read(&f) else { continue };
            let Ok(v) = serde_json::from_str::<Value>(&text) else {
                continue;
            };
            for key in ["dependencies", "devDependencies", "peerDependencies"] {
                if let Some(o) = v.get(key).and_then(Value::as_object) {
                    self.deps.extend(o.keys().cloned());
                    if f == "package.json" {
                        self.root_deps.extend(o.keys().cloned());
                    }
                }
            }
            // The root README's commands run at the root.
            if f == "package.json" {
                if let Some(o) = v.get("scripts").and_then(Value::as_object) {
                    self.scripts.extend(o.keys().cloned());
                }
            }
            self.package_jsons.push(v);
        }
        // Other ecosystems' dependency names, coarse: for SDK lookups only.
        for f in [
            "requirements.txt",
            "pyproject.toml",
            "Pipfile",
            "Gemfile",
            "go.mod",
            "Cargo.toml",
            "composer.json",
        ] {
            if self.has(f) {
                if let Some(text) = self.read(f) {
                    for word in
                        text.split(|c: char| !(c.is_ascii_alphanumeric() || "-_/@.".contains(c)))
                    {
                        if !word.is_empty() {
                            self.deps
                                .insert(format!("{f}:{}", word.to_ascii_lowercase()));
                        }
                    }
                }
            }
        }
    }

    fn notes_only(&self) -> bool {
        !self.has_manifest
            && !self.files.is_empty()
            && self.files.iter().all(|f| {
                let n = name(f).to_ascii_lowercase();
                let e = ext(&n);
                let prose = matches!(e, "md" | "markdown" | "txt" | "text" | "rst");
                // The papers any repository carries: `LICENSE`, `NOTICE.txt`.
                // By whole name, so `license_check.py` stays source.
                // `LICENSE-MIT`, `COPYING.LESSER` and `LICENSE.txt` too.
                static PAPERS: OnceLock<Regex> = OnceLock::new();
                let papers = re(
                    &PAPERS,
                    r"^(readme|license|licence|notice|copying|authors|codeowners)(-[a-z0-9.-]+)?(\.(md|markdown|txt|text|rst|lesser|mit|apache|bsd|gpl|lgpl|agpl))?$",
                )
                .is_match(&n);
                prose
                    || papers
                    || n.starts_with('.')
                    || matches!(e, "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "pdf")
            })
    }

    fn has_templates(&self) -> bool {
        static PAGE: OnceLock<Regex> = OnceLock::new();
        self.any(|f| {
            let e = ext(f);
            let html = matches!(e, "html" | "htm");
            let served = f.starts_with("public/") || f.starts_with("static/");
            // In a served folder a PHP file is a page only when it writes
            // one: `public/index.php` is also every API's front controller.
            let php_page = || {
                e == "php"
                    && self.read(f).is_some_and(|t| {
                        re(
                            &PAGE,
                            r"(?i)<!doctype html|(?:^|[^<])<(?:html|head|body)[\s>]",
                        )
                        .is_match(&evidence_text(f, &t))
                    })
            };
            !is_test_path(f)
                && ((served && (html || php_page()))
                    || ((html || TEMPLATE_EXTS.contains(&e))
                        && (f.split('/').any(|p| p == "templates")
                            || f.starts_with("app/views/")
                            || f.starts_with("resources/views/")
                            || f.starts_with("views/"))))
        })
    }

    /// A root dependency: what the project at this root is built with.
    fn dep(&self, name: &str) -> bool {
        self.root_deps.contains(name)
    }

    /// A dependency of any package in the repo.
    fn any_dep(&self, name: &str) -> bool {
        self.deps.contains(name)
    }

    fn dep_prefix(&self, prefix: &str) -> bool {
        self.deps.iter().any(|d| d.starts_with(prefix))
    }

    fn other_dep(&self, manifest: &str, word: &str) -> bool {
        self.deps.contains(&format!("{manifest}:{word}"))
    }

    /// A web project at this root: an app framework or its config, an HTML
    /// entry, markup templates, or UI files in page directories.
    /// Nested apps in a monorepo are judged by running on their own folder.
    fn is_web(&self) -> bool {
        // A native app (React Native, Expo) is not a website.
        if self.dep("react-native") || self.dep("expo") {
            return false;
        }
        // Rails API applications may still carry scaffolded HTML views.
        static API_ONLY: OnceLock<Regex> = OnceLock::new();
        if self.other_dep("Gemfile", "rails")
            && self.read("config/application.rb").is_some_and(|t| {
                re(&API_ONLY, r"\bconfig\.api_only\s*=\s*true\b")
                    .is_match(&evidence_text("config/application.rb", &t))
            })
        {
            return false;
        }
        const APP_FRAMEWORKS: &[&str] = &[
            "next",
            "nuxt",
            "@sveltejs/kit",
            "astro",
            "gatsby",
            "@remix-run/react",
            "@react-router/dev",
            "@angular/core",
            "@builder.io/qwik",
            "ember-source",
        ];
        const CONFIGS: &[&str] = &[
            "next.config.",
            "nuxt.config.",
            "svelte.config.",
            "astro.config.",
            "gatsby-config.",
            "remix.config.",
            "react-router.config.",
            "vue.config.",
            "angular.json",
        ];
        // A Vite config alone may build a library; its HTML entry decides.
        if APP_FRAMEWORKS.iter().any(|d| self.dep(d))
            || self.any(|f| !f.contains('/') && CONFIGS.iter().any(|c| f.starts_with(c)))
        {
            return true;
        }
        if [
            "index.html",
            "public/index.html",
            "src/index.html",
            "static/index.html",
        ]
        .iter()
        .any(|f| self.has(f))
        {
            return true;
        }
        if self.has_templates() || self.hugo() || self.jekyll() {
            return true;
        }
        self.any(|f| {
            ["pages/", "routes/", "src/pages/", "src/routes/"]
                .iter()
                .any(|d| f.starts_with(d))
                && UI_EXTS.contains(&ext(f))
        })
    }

    fn hugo(&self) -> bool {
        ["hugo.toml", "hugo.yaml", "hugo.json"]
            .iter()
            .any(|f| self.has(f))
            || (self.has("config.toml")
                && self.any(|f| f.starts_with("layouts/") || f.starts_with("themes/")))
    }

    fn jekyll(&self) -> bool {
        self.has("_config.yml")
            && (self.other_dep("Gemfile", "jekyll") || self.any(|f| f.starts_with("_layouts/")))
    }

    // --- checks ---------------------------------------------------------

    fn ci_runs_tests(&self) -> Option<State> {
        if self.notes_only() {
            return None;
        }
        static TEST: OnceLock<Regex> = OnceLock::new();
        static TRIGGER: OnceLock<Regex> = OnceLock::new();
        let test = re(
            &TEST,
            r#"(?m)(?:^|&&|;|\|\|)[ \t]*['"]?(?:(?:bundle[ \t]+exec)[ \t]+)?(?:\./)?(?:\b(npm|pnpm|yarn|bun)\s+(?:(?:-r|--filter\s+\S+)\s+)?(run\s+)?test\b|\bnpm\s+t\b|\b(npx|pnpx|bunx)\s+(vitest|jest|playwright|mocha|ava)\b|\bvitest\b|\bjest\b|\bplaywright\s+test\b|\bpytest\b|\bcargo\s+(test|nextest)\b|\bgo\s+test\b|\brspec\b|\bphpunit\b|\bpest\b|\bmix\s+test\b|\bdeno\s+test\b|\bgradlew?\s+(test|check)\b|\bmvnw?\b.*\b(test|verify)\b|\bdotnet\s+test\b|\b(turbo|nx)\s+(run\s+)?test\b|\b(make|just)\s+(test|check)\b|\bnode\s+--test\b|\byarn\s+workspaces\b[^\n]*\btest\b|\bnx\s+run-many\b[^\n]*\s(?:-t|--target[= ])\s*test\b|\bbin/rails\s+test\b|\brake\s+(test|spec)\b|\btox\b|\bnox\b|\bswift\s+test\b|\bflutter\s+test\b)"#,
        );
        let trigger = re(&TRIGGER, r"\b(push|pull_request|pull_request_target)\b");
        let ci: Vec<&String> = self
            .files
            .iter()
            .filter(|f| {
                (f.starts_with(".github/workflows/") && matches!(ext(f), "yml" | "yaml"))
                    || matches!(
                        f.as_str(),
                        ".gitlab-ci.yml"
                            | ".circleci/config.yml"
                            | "bitbucket-pipelines.yml"
                            | "azure-pipelines.yml"
                    )
            })
            .collect();
        let mut unknown = false;
        for f in ci {
            let text = self.read(f)?;
            let text = evidence_text(f, &text);
            // A custom action may run tests; its contents are unknown.
            unknown |= text.lines().any(|l| {
                (l.contains("uses:")
                    && !l.contains("actions/checkout@")
                    && !l.contains("actions/setup-"))
                    || l.trim_start().starts_with("- task:")
            });
            let runs = ci_commands(&text);
            unknown |= !ci_known_non_test_commands(&runs);
            if !test.is_match(&runs) {
                continue;
            }
            if f.starts_with(".github/") {
                // The triggers come before `jobs:`.
                let head = text.split("\njobs:").next().unwrap_or(&text);
                if !trigger.is_match(head) {
                    continue;
                }
            }
            return Some(State::Checked);
        }
        (!unknown).then_some(State::Failing)
    }

    fn dependency_configured(&self) -> bool {
        [
            ".github/dependabot.yml",
            ".github/dependabot.yaml",
            "renovate.json",
            "renovate.json5",
            ".renovaterc",
            ".renovaterc.json",
            ".github/renovate.json",
            ".github/renovate.json5",
            ".gitlab/renovate.json",
            ".snyk",
        ]
        .iter()
        .any(|f| self.has(f))
            || self
                .package_jsons
                .iter()
                .any(|p| p.get("renovate").is_some())
    }

    fn infrastructure_as_code(&self) -> Option<State> {
        if self.notes_only() {
            return None;
        }
        // Expo builds and ships through EAS, set up in `eas.json`. A bare
        // React Native app has no one place for it, so nothing is claimed.
        if self.dep("expo") || self.dep("react-native") {
            return if self.has("eas.json") {
                Some(State::Checked)
            } else {
                self.dep("expo").then_some(State::Failing)
            };
        }
        let named = [
            "wrangler.toml",
            "wrangler.jsonc",
            "wrangler.json",
            "vercel.json",
            "netlify.toml",
            "fly.toml",
            "render.yaml",
            "railway.json",
            "railway.toml",
            "app.yaml",
            "serverless.yml",
            "serverless.yaml",
            "Pulumi.yaml",
            "cdk.json",
            "docker-compose.yml",
            "docker-compose.yaml",
            "compose.yml",
            "compose.yaml",
            "Dockerfile",
            "Procfile",
            "Chart.yaml",
            "skaffold.yaml",
            "amplify.yml",
            "firebase.json",
            "apprunner.yaml",
            "nixpacks.toml",
        ];
        let found = self.any(|f| {
            let n = name(f);
            named.contains(&n)
                || n.starts_with("sst.config.")
                || n.starts_with("Dockerfile.")
                || ext(f) == "tf"
                || f.starts_with("k8s/")
                || f.starts_with("kubernetes/")
                || f.starts_with("helm/")
        });
        if found {
            return Some(State::Checked);
        }
        // Package projects without app evidence have nothing to deploy.
        let library = self
            .read("package.json")
            .and_then(|t| serde_json::from_str::<Value>(&t).ok())
            .is_some_and(|p| {
                ["main", "exports", "bin"]
                    .iter()
                    .any(|k| p.get(k).is_some())
            })
            || self.has("Cargo.toml")
            || self.has("pyproject.toml")
            || self.has("setup.py")
            || self.has("setup.cfg")
            || self.any(|f| ext(f) == "gemspec");
        if library && !self.is_web() && !self.dep("expo") && !self.dep("react-native") {
            None
        } else {
            Some(State::Failing)
        }
    }

    fn readme(&self) -> Option<&'static str> {
        [
            "README.md",
            "README",
            "README.markdown",
            "README.rst",
            "README.txt",
            "readme.md",
            "Readme.md",
        ]
        .into_iter()
        .find(|f| self.has(f))
    }

    fn readme_runs(&self) -> Option<State> {
        if self.notes_only() {
            return None;
        }
        Some(self.readme_runs_state())
    }

    fn readme_runs_state(&self) -> State {
        let Some(readme) = self.readme() else {
            return State::Failing;
        };
        let Some(text) = self.read(readme) else {
            return State::Failing;
        };
        let text = readme_commands(&evidence_text(readme, &text));
        static INSTALL: OnceLock<Regex> = OnceLock::new();
        static RUN: OnceLock<Regex> = OnceLock::new();
        static NO_INSTALL: OnceLock<Regex> = OnceLock::new();
        static SCRIPT: OnceLock<Regex> = OnceLock::new();
        let install = re(
            &INSTALL,
            r"(?m)\b(npm|pnpm|yarn|bun)\s+(install|i|ci)\b|^\s*\$?\s*(yarn|pnpm|bun)\s*$|\bpip3?\s+install\b|\bpoetry\s+install\b|\buv\s+sync\b|\bbundle(\s+install)?\s*$|\bbundle\s+install\b|\bcomposer\s+install\b|\bmix\s+deps\.get\b|\bgo\s+mod\s+download\b|\bdeno\s+install\b|\bmake\s+(install|setup|deps)\b|\bbin/setup\b",
        );
        let run = re(
            &RUN,
            r"\b(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve|preview)\b|\b(npm|pnpm|yarn|bun)\s+run\s+[\w:-]+|\bcargo\s+run\b|\bgo\s+run\b|\bpython3?\s+(-m\s+\S+|\S+\.py)|\bflask\s+run\b|\buvicorn\b|\bmanage\.py\s+runserver\b|\brails\s+s(erver)?\b|\bbin/dev\b|\bdocker[\s-]compose\s+up\b|\bmake\s+(run|dev|start|serve)\b|\bdeno\s+(task|run)\b|\bhugo\s+server\b|\bjekyll\s+serve\b|\bartisan\s+serve\b|\bmix\s+phx\.server\b|\bnpx\s+[\w@/.-]+",
        );
        // Tools that fetch their own dependencies on first run.
        let no_install = re(
            &NO_INSTALL,
            r"\bcargo\s+run\b|\bgo\s+run\b|\bdocker[\s-]compose\s+up\b|\bdeno\s+(task|run)\b|\bnpx\s+[\w@/.-]+",
        );
        if !run.is_match(&text) || !(install.is_match(&text) || no_install.is_match(&text)) {
            return State::Failing;
        }
        // Every named script exists.
        let script = re(
            &SCRIPT,
            r"\b(npm|pnpm|yarn|bun)\s+run\s+([\w:.-]+)|\b(npm)\s+(start|test)\b|\b(pnpm|yarn)\s+(dev|start|build|preview|serve|lint)\b",
        );
        if !self.package_jsons.is_empty() {
            for c in script.captures_iter(&text) {
                let s = c
                    .get(2)
                    .or(c.get(4))
                    .or(c.get(6))
                    .map(|m| m.as_str())
                    .unwrap_or("");
                if !s.is_empty() && !self.scripts.contains(s) {
                    if s == "start" && self.has("server.js") {
                        continue;
                    }
                    return State::Failing;
                }
            }
        }
        State::Checked
    }

    fn reversible_migrations(&self) -> Option<State> {
        static UP: OnceLock<Regex> = OnceLock::new();
        static DOWN: OnceLock<Regex> = OnceLock::new();
        let up = re(
            &UP,
            r"\b(exports\.up|function\s+up|async\s+up\s*\(|\bup\s*[:=]\s*(async\s*)?(\(|function)|public\s+async\s+up\s*\()",
        );
        let down = re(
            &DOWN,
            r"\b(exports\.down|function\s+down|async\s+down\s*\(|\bdown\s*[:=]\s*(async\s*)?(\(|function)|public\s+async\s+down\s*\()",
        );
        let mut seen = 0usize;
        let mut missing = 0usize;
        let in_migrations = |f: &str| {
            f.split('/')
                .any(|s| s == "migrations" || s == "migrate" || s == "db")
        };
        for f in &self.files {
            if !in_migrations(f) {
                continue;
            }
            let n = name(f);
            match ext(f) {
                "rb" if f.contains("db/migrate/") => {
                    let Some(t) = self.read(f) else { continue };
                    seen += 1;
                    if !(t.contains("def change") || t.contains("def down")) {
                        missing += 1;
                    }
                }
                "php" if f.contains("migrations/") => {
                    let Some(t) = self.read(f) else { continue };
                    if !t.contains("function up") {
                        continue;
                    }
                    seen += 1;
                    if !t.contains("function down") {
                        missing += 1;
                    }
                }
                "js" | "ts" | "cjs" | "mjs" if f.contains("migrations/") => {
                    let Some(t) = self.read(f) else { continue };
                    if !up.is_match(&t) {
                        continue;
                    }
                    seen += 1;
                    if !down.is_match(&t) {
                        missing += 1;
                    }
                }
                "sql" => {
                    if n.ends_with(".up.sql") {
                        seen += 1;
                        let pair = format!("{}.down.sql", &f[..f.len() - ".up.sql".len()]);
                        if !self.has(&pair) {
                            missing += 1;
                        }
                        continue;
                    }
                    if n.ends_with(".down.sql") {
                        continue;
                    }
                    let Some(t) = self.read(f) else { continue };
                    let marker = if t.contains("-- migrate:up") {
                        "-- migrate:down"
                    } else if t.contains("-- +goose Up") {
                        "-- +goose Down"
                    } else {
                        continue;
                    };
                    seen += 1;
                    let body = t.split(marker).nth(1).unwrap_or("");
                    let has_body = body
                        .lines()
                        .map(str::trim)
                        .any(|l| !l.is_empty() && !l.starts_with("--"));
                    if !has_body {
                        missing += 1;
                    }
                }
                _ => {}
            }
        }
        match (seen, missing) {
            (0, _) => None,
            (_, 0) => Some(State::Checked),
            _ => Some(State::Failing),
        }
    }

    fn app_icons(&self) -> State {
        let dirs = [
            "",
            "public/",
            "static/",
            "app/",
            "src/app/",
            "src/",
            "assets/",
            "src/assets/",
            "web/",
            "public/icons/",
            "static/icons/",
            "public/images/",
        ];
        let in_dirs = |f: &str| {
            dirs.iter()
                .any(|d| f.starts_with(d) && !f[d.len()..].contains('/'))
        };
        let image = |f: &str| {
            matches!(
                ext(f).to_ascii_lowercase().as_str(),
                "ico" | "svg" | "png" | "jpg" | "jpeg" | "webp" | "avif" | "gif"
            )
        };
        // Next's icon routes: `app/icon.tsx` and `app/apple-icon.tsx` draw the
        // icon in code. The exact lower-case name in the app folder only, so
        // a component such as `src/Icon.tsx` is never one.
        let next_route = |f: &str, stem: &str| {
            ["app/", "src/app/"].iter().any(|d| {
                f.strip_prefix(d).is_some_and(|n| {
                    ["tsx", "jsx", "ts", "js"]
                        .iter()
                        .any(|e| n == format!("{stem}.{e}"))
                })
            })
        };
        let mut favicon = self.any(|f| {
            next_route(f, "icon")
                || (in_dirs(f) && image(f) && {
                    let n = name(f).to_ascii_lowercase();
                    n.starts_with("favicon")
                        || matches!(n.as_str(), "icon.svg" | "icon.png" | "icon.ico")
                })
        });
        // A sized PNG named as an icon: `logo192.png`, `pwa-512x512.png`.
        static SIZE: OnceLock<Regex> = OnceLock::new();
        let size = re(&SIZE, r"(^|[^0-9])(180|192|512)([^0-9]|$)");
        let mut large = self.any(|f| {
            in_dirs(f) && image(f) && {
                let n = name(f).to_ascii_lowercase();
                [
                    "apple-touch-icon",
                    "apple-icon",
                    "icon-192",
                    "icon-512",
                    "android-chrome-",
                ]
                .iter()
                .any(|p| n.starts_with(p))
                    || (n.ends_with(".png")
                        && size.is_match(&n)
                        && ["icon", "android-chrome", "logo", "touch", "pwa"]
                            .iter()
                            .any(|w| n.contains(w)))
            }
        }) || self.any(|f| next_route(f, "apple-icon"))
            || self.any(|f| {
                next_route(f, "manifest")
                    && self
                        .read(f)
                        .is_some_and(|t| evidence_text(f, &t).contains("icons"))
            });
        static LINK: OnceLock<Regex> = OnceLock::new();
        static REL: OnceLock<Regex> = OnceLock::new();
        static HREF: OnceLock<Regex> = OnceLock::new();
        for f in self.files.iter().filter(|f| {
            (UI_EXTS.contains(&ext(f)) || TEMPLATE_EXTS.contains(&ext(f))) && !is_test_path(f)
        }) {
            let Some(t) = self.read(f) else { continue };
            let t = evidence_text(f, &t);
            for link in re(&LINK, r"(?is)<link\b[^>]*>").find_iter(&t) {
                let tag = link.as_str();
                let rel = re(&REL, r#"(?i)\brel\s*=\s*["']([^"']+)["']"#).captures(tag);
                let href = re(&HREF, r#"(?i)\bhref\s*=\s*["']([^"']+)["']"#).captures(tag);
                let (Some(rel), Some(href)) = (rel, href) else {
                    continue;
                };
                let rel = rel[1].to_ascii_lowercase();
                // An icon written into the page itself is still an icon.
                if href[1].starts_with("data:image/") {
                    favicon |= rel.split_whitespace().any(|r| r == "icon");
                    continue;
                }
                let Some(target) = self.icon_target(f, &href[1]) else {
                    continue;
                };
                if image(&target) {
                    favicon |= rel.split_whitespace().any(|r| r == "icon");
                    large |= rel == "apple-touch-icon";
                }
                if rel == "manifest" {
                    large |= self.manifest_has_icon(&target);
                }
            }
        }
        for f in &self.files {
            if matches!(
                name(f),
                "manifest.json" | "site.webmanifest" | "manifest.webmanifest"
            ) {
                large |= self.manifest_has_icon(f);
            }
        }
        if favicon && large {
            State::Checked
        } else {
            State::Failing
        }
    }

    /// Resolve local URLs against the source folder and conventional public roots.
    fn icon_target(&self, file: &str, url: &str) -> Option<String> {
        if url.contains(":") || url.starts_with("//") {
            return None;
        }
        let url = url.split(['?', '#']).next()?;
        let path = if url.starts_with('/') {
            PathBuf::from(url.trim_start_matches('/'))
        } else {
            Path::new(file).parent()?.join(url)
        };
        let mut parts = Vec::new();
        for part in path.components() {
            match part {
                std::path::Component::Normal(p) => parts.push(p.to_str()?),
                std::path::Component::ParentDir => {
                    parts.pop()?;
                }
                std::path::Component::CurDir => {}
                _ => return None,
            }
        }
        let target = parts.join("/");
        [
            target.clone(),
            format!("public/{target}"),
            format!("static/{target}"),
        ]
        .into_iter()
        .find(|f| self.has(f))
    }

    fn manifest_has_icon(&self, f: &str) -> bool {
        self.read(f)
            .and_then(|t| serde_json::from_str::<Value>(&t).ok())
            .and_then(|v| v.get("icons").and_then(Value::as_array).cloned())
            .is_some_and(|icons| {
                icons.iter().any(|icon| {
                    icon.get("src").and_then(Value::as_str).is_some_and(|src| {
                        let Some(target) = self.icon_target(f, src) else {
                            return false;
                        };
                        self.has(&target)
                            && matches!(
                                ext(&target).to_ascii_lowercase().as_str(),
                                "png" | "svg" | "ico" | "webp" | "jpg" | "jpeg"
                            )
                    })
                })
            })
    }

    fn not_found_page(&self) -> Option<State> {
        static NEXT_APP: OnceLock<Regex> = OnceLock::new();
        static PAGE_404: OnceLock<Regex> = OnceLock::new();
        static CATCH_ALL: OnceLock<Regex> = OnceLock::new();
        let next_app = re(
            &NEXT_APP,
            r"^(src/)?app/(.*/)?not-found\.(tsx|jsx|ts|js|mdx)$",
        );
        let page_404 = |prefix: &str, f: &str| {
            f.strip_prefix(prefix)
                .is_some_and(|rest| re(&PAGE_404, r"^404(\.[a-z]+|/index\.[a-z]+)$").is_match(rest))
        };
        let found = if self.dep("next") {
            self.any(|f| next_app.is_match(f) || page_404("pages/", f) || page_404("src/pages/", f))
        } else if self.dep("nuxt") {
            ["error.vue", "app/error.vue", "src/error.vue"]
                .iter()
                .any(|f| self.has(f))
        } else if self.dep("@sveltejs/kit") {
            self.any(|f| f.starts_with("src/routes/") && name(f) == "+error.svelte")
        } else if self.dep("astro") {
            self.any(|f| page_404("src/pages/", f))
        } else if self.dep("@remix-run/react") || self.dep("@react-router/dev") {
            let root_boundary = ["app/root.tsx", "app/root.jsx", "app/root.ts", "app/root.js"]
                .iter()
                .any(|f| self.has(f) && self.read(f).is_some_and(|t| t.contains("ErrorBoundary")));
            root_boundary || self.any(|f| f.starts_with("app/routes/") && name(f).starts_with("$."))
        } else if self.dep("gatsby") {
            self.any(|f| page_404("src/pages/", f))
        } else if self.hugo() {
            self.any(|f| {
                f == "layouts/404.html"
                    || (f.starts_with("themes/") && f.ends_with("/layouts/404.html"))
            })
        } else if self.jekyll() {
            ["404.html", "404.md"].iter().any(|f| self.has(f))
        } else if self.other_dep("composer.json", "laravel/framework") {
            self.any(|f| f.starts_with("resources/views/errors/404."))
        } else if self.other_dep("Gemfile", "rails") {
            self.has("public/404.html") || self.any(|f| f.starts_with("app/views/errors/not_found"))
        } else if self.has("index.html") || self.has("public/index.html") {
            // A static 404, or the client router's catch-all route.
            let catch_all = re(
                &CATCH_ALL,
                r#"path\s*[=:]\s*\{?\s*["'`](\*|/\*)["'`]|/:pathMatch\(\.\*\)\*|/:catchAll\(\.\*\)"#,
            );
            ["404.html", "public/404.html", "static/404.html"]
                .iter()
                .any(|f| self.has(f))
                || self
                    .files
                    .iter()
                    .filter(|f| {
                        f.starts_with("src/")
                            && matches!(ext(f), "tsx" | "jsx" | "ts" | "js" | "vue")
                    })
                    .any(|f| self.read(f).is_some_and(|t| catch_all.is_match(&t)))
        } else {
            return None;
        };
        Some(if found {
            State::Checked
        } else {
            State::Failing
        })
    }

    fn social_previews(&self) -> State {
        if self.any(|f| {
            let n = name(f);
            n.starts_with("opengraph-image.") || n.starts_with("twitter-image.")
        }) {
            return State::Checked;
        }
        let found = self
            .files
            .iter()
            .filter(|f| {
                let e = ext(f);
                TEMPLATE_EXTS.contains(&e)
                    || matches!(
                        e,
                        "html" | "htm" | "astro" | "svelte" | "vue" | "tsx" | "jsx" | "ts" | "js"
                    )
            })
            .filter(|f| !is_test_path(f))
            .any(|f| {
                self.read(f).is_some_and(|t| {
                    let t = evidence_text(f, &t);
                    t.contains("og:image")
                        || t.contains("twitter:image")
                        || (t.contains("useSeoMeta") && t.contains("ogImage"))
                        || (t.contains("openGraph") && t.contains("images"))
                })
            });
        if found {
            State::Checked
        } else {
            State::Failing
        }
    }

    /// Pages, routes or content named privacy and terms, at the root or in
    /// the directories pages live in.
    fn legal_pages(&self) -> State {
        const DIRS: &[&str] = &[
            "pages/",
            "app/",
            "routes/",
            "src/pages/",
            "src/app/",
            "src/routes/",
            "src/views/",
            "src/screens/",
            "content/",
            "src/content/",
            "public/",
            "static/",
            "legal/",
            "src/legal/",
            "templates/",
            "views/",
            "app/views/",
            "resources/views/",
            "_pages/",
            "site/",
        ];
        let named = |f: &str, names: &[&str]| {
            let in_place = !f.contains('/') || DIRS.iter().any(|d| f.starts_with(d));
            in_place
                && PAGE_EXTS.contains(&ext(f))
                && !is_test_path(f)
                && f.split('/').any(|seg| {
                    let seg = seg.to_ascii_lowercase();
                    let stem = seg.split('.').next().unwrap_or("");
                    names.contains(&stem.trim_start_matches('(').trim_end_matches(')'))
                })
        };
        let privacy = self.any(|f| {
            named(
                f,
                &[
                    "privacy",
                    "privacy-policy",
                    "privacy_policy",
                    "privacypolicy",
                    "datenschutz",
                ],
            )
        });
        let terms = self.any(|f| {
            named(
                f,
                &[
                    "terms",
                    "tos",
                    "terms-of-service",
                    "terms_of_service",
                    "terms-of-use",
                    "terms_of_use",
                    "terms-and-conditions",
                    "terms_and_conditions",
                    "termsofservice",
                ],
            )
        });
        if privacy && terms {
            State::Checked
        } else {
            State::Failing
        }
    }

    fn error_tracking(&self) -> State {
        let js = [
            "rollbar",
            "logrocket",
            "raygun4js",
            "highlight.run",
            "@datadog/browser-rum",
            "trackjs",
            "airbrake-js",
        ];
        let js_prefixes = [
            "@sentry/",
            "@bugsnag/",
            "@honeybadger-io/",
            "@highlight-run/",
            "@airbrake/",
            "@appsignal/",
        ];
        let other = [
            ("requirements.txt", "sentry-sdk"),
            ("pyproject.toml", "sentry-sdk"),
            ("Pipfile", "sentry-sdk"),
            ("requirements.txt", "bugsnag"),
            ("requirements.txt", "rollbar"),
            ("requirements.txt", "honeybadger"),
            ("Gemfile", "sentry-ruby"),
            ("Gemfile", "sentry-rails"),
            ("Gemfile", "bugsnag"),
            ("Gemfile", "rollbar"),
            ("Gemfile", "honeybadger"),
            ("Gemfile", "airbrake"),
            ("Gemfile", "appsignal"),
            ("Cargo.toml", "sentry"),
            ("go.mod", "github.com/getsentry/sentry-go"),
            ("go.mod", "github.com/bugsnag/bugsnag-go"),
            ("go.mod", "github.com/rollbar/rollbar-go"),
            ("composer.json", "sentry/sentry-laravel"),
            ("composer.json", "sentry/sentry"),
            ("composer.json", "bugsnag/bugsnag-laravel"),
        ];
        let found = js.iter().any(|d| self.any_dep(d))
            || js_prefixes.iter().any(|p| self.dep_prefix(p))
            || other.iter().any(|(m, w)| self.other_dep(m, w));
        if found {
            State::Checked
        } else {
            State::Failing
        }
    }

    fn reduced_motion(&self) -> Option<State> {
        static MOTION: OnceLock<Regex> = OnceLock::new();
        static GUARD: OnceLock<Regex> = OnceLock::new();
        let motion = re(
            &MOTION,
            r#"@keyframes\b|\banimation\s*:|\btransition\s*:|\banimate-[\w\[]+|\.animate\s*\(|\b(?:in|out|transition):[a-z]|\btransition:[a-z]|<motion\."#,
        );
        let guard = re(
            &GUARD,
            r"prefers-reduced-motion|\bmotion-(safe|reduce):|\buseReducedMotion\b|\breducedMotion\b|\bMotionConfig\b",
        );
        let motion_dep = [
            "framer-motion",
            "motion",
            "gsap",
            "animejs",
            "@react-spring/web",
            "react-spring",
            "lottie-web",
            "@formkit/auto-animate",
        ]
        .iter()
        .any(|d| self.any_dep(d));
        let mut has_ui = false;
        let mut has_motion = motion_dep;
        for f in self
            .files
            .iter()
            .filter(|f| STYLE_EXTS.contains(&ext(f)) && !is_test_path(f) && !is_minified(f))
        {
            if UI_EXTS.contains(&ext(f)) {
                has_ui = true;
            }
            let Some(t) = self.read(f) else { continue };
            let t = evidence_text(f, &t);
            if guard.is_match(&t) {
                return Some(State::Checked);
            }
            // `animate-none` turns an animation off; it is not one.
            has_motion |= motion.find_iter(&t).any(|m| m.as_str() != "animate-none")
                || tailwind_transition(&t);
        }
        if !has_ui {
            return None;
        }
        Some(if has_motion {
            State::Failing
        } else {
            State::Checked
        })
    }

    fn design_tokens(&self) -> Option<State> {
        static COLOR_VAR: OnceLock<Regex> = OnceLock::new();
        static COLOR_USE: OnceLock<Regex> = OnceLock::new();
        static HARD: OnceLock<Regex> = OnceLock::new();
        static THEME: OnceLock<Regex> = OnceLock::new();
        let color_var = re(
            &COLOR_VAR,
            r"(?i)--[\w-]+\s*:\s*(#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(|oklab\(|lab\(|lch\(|color-mix\()",
        );
        let color_use = re(&COLOR_USE, r"\bvar\(\s*(--[\w-]+)\s*[,)]");
        let hard = re(&HARD, r"(?i)#[0-9a-f]{6}\b|#[0-9a-f]{3}\b|\brgba?\(\s*\d");
        let theme = re(
            &THEME,
            r"\b(createTheme|extendTheme|createStitches|defineTokens|defineSemanticTokens|createGlobalTheme|createThemeContract)\s*\(",
        );
        if self.any(|f| {
            let n = name(f).to_ascii_lowercase();
            n == "tokens.json"
                || n.ends_with(".tokens.json")
                || n.starts_with("design-tokens")
                || n.starts_with("tokens.css")
        }) {
            return Some(State::Checked);
        }
        let mut project_colors = BTreeSet::new();
        let mut used_colors = BTreeSet::new();
        let mut hardcoded = 0usize;
        let mut ui = false;
        for f in &self.files {
            let e = ext(f);
            let tailwind_config = name(f).starts_with("tailwind.config.");
            if !(tailwind_config || STYLE_EXTS.contains(&e)) || is_test_path(f) || is_minified(f) {
                continue;
            }
            if UI_EXTS.contains(&e) {
                ui = true;
            }
            let Some(t) = self.read(f) else { continue };
            let t = evidence_text(f, &t);
            for m in color_var.find_iter(&t) {
                let property = m.as_str().split(':').next().unwrap_or("");
                if !["--swiper-", "--tw-", "--bs-", "--mdc-"]
                    .iter()
                    .any(|p| property.starts_with(p))
                {
                    project_colors.insert(property.trim().to_string());
                }
            }
            for c in color_use.captures_iter(&t) {
                used_colors.insert(c[1].to_string());
            }
            if (tailwind_config && t.contains("colors"))
                || (t.contains("@theme") && t.contains("--color-"))
                || !project_colors.is_disjoint(&used_colors)
                || theme.is_match(&t)
            {
                return Some(State::Checked);
            }
            if UI_EXTS.contains(&e) {
                // A colour inside a custom property's definition is a
                // token, used or not, never a hard-coded colour.
                let t = color_var.replace_all(&t, "");
                hardcoded += hard
                    .find_iter(&t)
                    .filter(|m| {
                        // Numeric HTML entities aren't CSS colours.
                        m.start() == 0 || t.as_bytes()[m.start() - 1] != b'&'
                    })
                    .count();
            }
        }
        (ui && hardcoded >= 20).then_some(State::Failing)
    }

    fn giant_files(&self) -> (Vec<(String, usize)>, Option<State>) {
        const SOURCE: &[&str] = &[
            "js", "jsx", "ts", "tsx", "mjs", "cjs", "vue", "svelte", "astro", "py", "rb", "go",
            "rs", "java", "kt", "swift", "php", "css", "scss", "sass", "less", "html", "c", "cc",
            "cpp", "h", "hpp", "cs", "ex", "exs", "dart", "scala", "m", "mm", "lua", "zig",
        ];
        let mut giant = Vec::new();
        let mut any = false;
        for f in &self.files {
            let lower = f.to_ascii_lowercase();
            if !SOURCE.contains(&ext(f))
                || lower.ends_with(".d.ts")
                || is_minified(f)
                || is_test_path(f)
                || lower.split('/').any(|s| {
                    matches!(
                        s,
                        "generated"
                            | "__generated__"
                            | "gen"
                            | "migrations"
                            | "migrate"
                            | "fixtures"
                            | "__fixtures__"
                            | "__snapshots__"
                            | "snapshots"
                            | "third_party"
                            | "third-party"
                            | "assets"
                    )
                })
                || lower.contains(".gen.")
                || lower.contains(".generated.")
                || lower.contains("_pb.")
                || lower.contains(".pb.")
                || lower.contains("bundle")
            {
                continue;
            }
            any = true;
            let Some(t) = self.read(f) else { continue };
            let head: String = t
                .lines()
                .take(5)
                .collect::<Vec<_>>()
                .join("\n")
                .to_ascii_lowercase();
            if head.contains("@generated")
                || head.contains("do not edit")
                || head.contains("auto-generated")
                || head.contains("autogenerated")
            {
                continue;
            }
            let lines = t.lines().count();
            // Long lines on average: minified or data, not hand-written.
            if lines > GIANT_LINES && t.len() / lines.max(1) < 200 {
                giant.push((f.clone(), lines));
            }
        }
        let state = if !giant.is_empty() {
            Some(State::Failing)
        } else if any {
            Some(State::Checked)
        } else {
            None
        };
        (giant, state)
    }

    /// Key formats in tracked files, and tracked env files. Without git,
    /// the walked files (env files there are expected, so not counted).
    /// The locations to show (at most five), the state, and whether the
    /// walk stood in for git.
    fn secrets(&self) -> (Vec<SecretHit>, Option<State>, bool) {
        let tracked = git_ls_files(&self.root);
        let in_git = tracked.is_some();
        let files: Vec<String> = match tracked {
            Some(Ok(list)) => list
                .into_iter()
                .filter(|f| !f.split('/').any(|s| s == "node_modules"))
                .collect(),
            // A git that failed or timed out: nothing is proven.
            Some(Err(())) => return (Vec::new(), None, false),
            None => self.files.clone(),
        };
        let mut hits = Vec::new();
        let mut found = false;
        let mut reads = 0usize;
        let mut bytes = 0u64;
        let mut hit = |h: SecretHit, found: &mut bool| {
            *found = true;
            if hits.len() < 5 {
                hits.push(h);
            }
        };
        for f in &files {
            let n = name(f);
            let env = is_env_file(n);
            // Outside git an env file is where keys belong.
            if env && !in_git {
                continue;
            }
            if is_lockfile(n) || is_binary_ext(ext(f)) {
                continue;
            }
            // Its own budget, so the other checks' reads never cost this one.
            reads += 1;
            // The whole file, within what's left of the budget: a key past
            // a per-file cap would pass unseen.
            let left = MAX_SECRET_BYTES.saturating_sub(bytes);
            let (read, raw) = if reads > MAX_SECRET_READS {
                (Whole::OverBudget, 0)
            } else {
                read_whole(&self.root.join(f), left)
            };
            // Every byte read counts, skipped binaries included.
            bytes += raw;
            let t = match read {
                Whole::Text(t) => t,
                Whole::Skip => continue,
                Whole::OverBudget => {
                    drop(hit);
                    return (hits, found.then_some(State::Failing), !in_git);
                }
            };
            // One pass over the file, counting lines as it goes.
            let (mut line, mut at) = (1usize, 0usize);
            // A tracked env file: a value under a secret-looking name.
            if env {
                for l in secret_env_lines(&t) {
                    hit(
                        SecretHit {
                            file: f.clone(),
                            line: l,
                            kind: "secret in an environment file",
                        },
                        &mut found,
                    );
                }
            }
            let firebase = matches!(n, "google-services.json" | "GoogleService-Info.plist")
                || ["authDomain", "firebaseapp.com", "messagingSenderId"]
                    .iter()
                    .any(|m| t.contains(m));
            for m in secrets_regex().find_iter(&t) {
                line += t[at..m.start()].matches('\n').count();
                at = m.start();
                if firebase && m.as_str().starts_with("AIza") {
                    continue;
                }
                // Redaction tests and docs use obvious stand-ins.
                // (A private key's body has long fixed runs: never a stand-in.)
                if !m.as_str().starts_with("-----") && is_placeholder(m.as_str()) {
                    continue;
                }
                hit(
                    SecretHit {
                        file: f.clone(),
                        line,
                        kind: secret_kind(m.as_str()).unwrap_or("key"),
                    },
                    &mut found,
                );
            }
        }
        drop(hit);
        let state = Some(if found {
            State::Failing
        } else {
            State::Checked
        });
        (hits, state, !in_git)
    }
}

fn is_test_path(f: &str) -> bool {
    let lower = f.to_ascii_lowercase();
    lower.split('/').any(|s| {
        matches!(
            s,
            "test"
                | "tests"
                | "__tests__"
                | "spec"
                | "e2e"
                | "fixtures"
                | "__fixtures__"
                | "__mocks__"
        )
    }) || lower.contains(".test.")
        || lower.contains(".spec.")
        || lower.contains(".stories.")
}

fn is_minified(f: &str) -> bool {
    let n = name(f);
    n.contains(".min.") || n.contains("-min.") || n.contains(".bundle.")
}

fn is_env_file(n: &str) -> bool {
    if n != ".env" && !n.starts_with(".env.") {
        return false;
    }
    let lower = n.to_ascii_lowercase();
    ![
        "example", "sample", "template", "dist", "defaults", "schema", "test", "ci",
    ]
    .iter()
    .any(|s| lower.ends_with(&format!(".{s}")) || lower.contains(&format!(".{s}.")))
}

fn is_lockfile(n: &str) -> bool {
    matches!(
        n,
        "package-lock.json"
            | "yarn.lock"
            | "pnpm-lock.yaml"
            | "bun.lockb"
            | "bun.lock"
            | "Cargo.lock"
            | "Gemfile.lock"
            | "poetry.lock"
            | "composer.lock"
            | "go.sum"
            | "uv.lock"
            | "Pipfile.lock"
    )
}

fn is_binary_ext(e: &str) -> bool {
    matches!(
        e.to_ascii_lowercase().as_str(),
        "png"
            | "jpg"
            | "jpeg"
            | "gif"
            | "webp"
            | "avif"
            | "ico"
            | "woff"
            | "woff2"
            | "ttf"
            | "otf"
            | "eot"
            | "pdf"
            | "zip"
            | "gz"
            | "tgz"
            | "br"
            | "wasm"
            | "mp4"
            | "webm"
            | "mov"
            | "mp3"
            | "wav"
            | "jar"
            | "so"
            | "dylib"
            | "dll"
            | "exe"
            | "bin"
            | "psd"
            | "sketch"
            | "fig"
    )
}

/// Well-known key formats with realistic lengths, so docs and the patterns
/// themselves don't match.
const KEY_FORMATS: &[(&str, &str)] = &[
    (r"\bAKIA[0-9A-Z]{16}\b", "AWS access key"),
    (r"\b[sr]k_live_[0-9A-Za-z]{24,}", "Stripe live key"),
    (r"\bwhsec_[0-9A-Za-z+/=]{32,}", "Stripe webhook secret"),
    (r"\bgh[pousr]_[0-9A-Za-z]{36,}", "GitHub token"),
    (r"\bgithub_pat_[0-9A-Za-z_]{60,}", "GitHub token"),
    (r"\bxox[bpas]-[0-9]{8,}-[0-9A-Za-z-]{16,}", "Slack token"),
    (r"\bsk-ant-[0-9A-Za-z_-]{40,}", "Anthropic key"),
    (
        r"\bsk-(proj|svcacct|admin)-[0-9A-Za-z_-]{40,}",
        "OpenAI key",
    ),
    (
        r"\bsk-[0-9A-Za-z]{20}T3BlbkFJ[0-9A-Za-z]{20}\b",
        "OpenAI key",
    ),
    (r"\bAIza[0-9A-Za-z_-]{35}\b", "Google API key"),
    (
        // A header alone (a comment, a string a check looks for) is no key.
        r"-----BEGIN (RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----(?:\s|\\[nr])*[A-Za-z0-9+/=]{64}",
        "private key",
    ),
];

fn secrets_regex() -> &'static Regex {
    static ALL: OnceLock<Regex> = OnceLock::new();
    ALL.get_or_init(|| {
        let alt: Vec<String> = KEY_FORMATS
            .iter()
            .map(|(p, _)| format!("(?:{p})"))
            .collect();
        Regex::new(&alt.join("|")).expect("valid pattern")
    })
}

/// A Tailwind `transition` utility: a specific one (`transition-transform`,
/// `hover:transition`, `transition duration-200`) anywhere, since prose
/// doesn't spell those; a bare `transition` only inside a class value or
/// `@apply`.
fn tailwind_transition(text: &str) -> bool {
    static SPECIFIC: OnceLock<Regex> = OnceLock::new();
    static CLASSES: OnceLock<Regex> = OnceLock::new();
    static BARE: OnceLock<Regex> = OnceLock::new();
    let specific = re(
        &SPECIFIC,
        r#"(?:^|[\s"'`{])(?:[^\s"'`{}]*:)*transition-(?:all|colors|opacity|shadow|transform)(?:$|[\s"'`};])|(?:^|[\s"'`{])(?:[^\s"'`{}]*:)+transition(?:$|[\s"'`};])|\btransition\s+(?:duration|ease|delay)-"#,
    );
    if specific.is_match(text) {
        return true;
    }
    let classes = re(
        &CLASSES,
        r#"(?s)(?:\bclass(?:Name)?|:class)\s*=\s*(?:"[^"]{0,2000}"|'[^']{0,2000}'|`[^`]{0,2000}`)|@apply\b[^;]{0,300};"#,
    );
    let bare = re(&BARE, r#"(?:^|[\s"'`{])transition(?:$|[\s"'`};])"#);
    if classes.find_iter(text).any(|m| bare.is_match(m.as_str())) {
        return true;
    }
    // A braced value (`className={...}`) runs to its matching brace, so
    // template interpolations and nested objects stay inside it.
    static OPEN: OnceLock<Regex> = OnceLock::new();
    let open = re(&OPEN, r#"(?:\bclass(?:Name)?|:class)\s*=\s*\{"#);
    open.find_iter(text).any(|m| {
        let mut depth = 1usize;
        let rest = &text[m.end()..];
        let mut end = rest.len();
        // Braces inside '...', "..." or `...` are text, not code,
        // and so are comments; a backslash escapes the next character.
        let mut quote: Option<char> = None;
        let mut comment: Option<char> = None;
        let mut chars = rest.char_indices().take(4000).peekable();
        while let Some((i, c)) = chars.next() {
            if let Some(kind) = comment {
                let next = chars.peek().map(|(_, n)| *n);
                if (kind == '/' && c == '\n') || (kind == '*' && c == '*' && next == Some('/')) {
                    comment = None;
                    if kind == '*' {
                        chars.next();
                    }
                }
                continue;
            }
            if let Some(q) = quote {
                if c == '\\' {
                    chars.next();
                } else if c == q {
                    quote = None;
                }
                continue;
            }
            if c == '/' {
                if let Some((_, n @ ('/' | '*'))) = chars.peek().copied() {
                    comment = Some(n);
                    chars.next();
                    continue;
                }
            }
            match c {
                // A template is text too; its `${}` braces balance inside it.
                '\'' | '"' | '`' => quote = Some(c),
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        end = i;
                        break;
                    }
                }
                _ => {}
            }
        }
        let end = rest
            .char_indices()
            .nth(4000)
            .map_or(end, |(i, _)| end.min(i));
        bare.is_match(&rest[..end])
    })
}

/// The kind of a matched key. Never returns the value.
fn secret_kind(matched: &str) -> Option<&'static str> {
    static EACH: OnceLock<Vec<(Regex, &'static str)>> = OnceLock::new();
    let each = EACH.get_or_init(|| {
        KEY_FORMATS
            .iter()
            .map(|(p, k)| (Regex::new(p).expect("valid pattern"), *k))
            .collect()
    });
    each.iter()
        .find(|(r, _)| r.is_match(matched))
        .map(|(_, k)| *k)
}

/// A whole text file; `None` for binary or unreadable ones.
enum Whole {
    Text(String),
    /// Binary, unreadable, or not a regular file (a symlink, a device).
    Skip,
    OverBudget,
}

/// The file's text (or why not) and the raw bytes read.
fn read_whole(path: &Path, left: u64) -> (Whole, u64) {
    use std::io::Read;
    if !std::fs::symlink_metadata(path).is_ok_and(|m| m.is_file()) {
        return (Whole::Skip, 0);
    }
    let Ok(file) = std::fs::File::open(path) else {
        return (Whole::Skip, 0);
    };
    // Look at the head first: a binary file isn't read further.
    let mut file = file.take(left + 1);
    let mut buf = Vec::new();
    if (&mut file).take(8192).read_to_end(&mut buf).is_err() {
        return (Whole::Skip, buf.len() as u64);
    }
    if buf.contains(&0) {
        return (Whole::Skip, buf.len() as u64);
    }
    let read = file.read_to_end(&mut buf);
    let raw = buf.len() as u64;
    if read.is_err() {
        return (Whole::Skip, raw);
    }
    if raw > left {
        return (Whole::OverBudget, raw);
    }
    if buf.iter().take(8192).any(|b| *b == 0) {
        return (Whole::Skip, raw);
    }
    (Whole::Text(String::from_utf8_lossy(&buf).into_owned()), raw)
}

fn read_capped(path: &Path) -> Option<String> {
    use std::io::Read;
    let meta = std::fs::symlink_metadata(path).ok()?;
    if !meta.is_file() || meta.len() > MAX_FILE {
        return None;
    }
    let mut buf = Vec::new();
    std::fs::File::open(path)
        .ok()?
        .take(MAX_BYTES)
        .read_to_end(&mut buf)
        .ok()?;
    if buf.iter().take(8192).any(|b| *b == 0) {
        return None;
    }
    Some(String::from_utf8_lossy(&buf).into_owned())
}

/// An obvious stand-in rather than a key: EXAMPLE, an ascending run of
/// six (abcdef, 123456), or one character six times in a row.
fn is_placeholder(key: &str) -> bool {
    if key.to_ascii_uppercase().contains("EXAMPLE") {
        return true;
    }
    let b = key.as_bytes();
    let (mut up, mut same) = (1, 1);
    for w in b.windows(2) {
        up = if w[0].is_ascii_alphanumeric() && w[1] == w[0] + 1 {
            up + 1
        } else {
            1
        };
        same = if w[1] == w[0] { same + 1 } else { 1 };
        if up >= 6 || same >= 6 {
            return true;
        }
    }
    false
}

/// Lines of an env file that hold a non-empty value under a secret-looking
/// name segment (or a URL with a password), skipping public names and stand-ins.
/// Only line numbers leave this function, never names or values.
fn secret_env_lines(text: &str) -> Vec<usize> {
    const PUBLIC: &[&str] = &[
        "PUBLIC_",
        "NEXT_PUBLIC_",
        "VITE_",
        "NUXT_PUBLIC_",
        "EXPO_PUBLIC_",
        "REACT_APP_",
        "GATSBY_",
    ];
    const SECRET: &[&str] = &[
        "KEY",
        "SECRET",
        "TOKEN",
        "PASSWORD",
        "PASSWD",
        "PWD",
        "CREDENTIAL",
        "PRIVATE",
    ];
    static URL_PASSWORD: OnceLock<Regex> = OnceLock::new();
    let url_password = re(&URL_PASSWORD, r"://[^/\s:@]+:[^@\s]+@");
    let mut out = Vec::new();
    for (i, line) in text.lines().enumerate() {
        let line = line.trim();
        let line = line.strip_prefix("export ").unwrap_or(line);
        if line.starts_with('#') {
            continue;
        }
        let Some((name, value)) = line.split_once('=') else {
            continue;
        };
        let name = name.trim().to_ascii_uppercase();
        let value = value.trim().trim_matches(|c| c == '"' || c == '\'');
        if env_placeholder(value) || PUBLIC.iter().any(|p| name.starts_with(p)) {
            continue;
        }
        let password = url_password.is_match(value);
        let secret_name = name.split('_').any(|part| SECRET.contains(&part));
        if password || (secret_name && !value.contains("://")) {
            out.push(i + 1);
        }
    }
    out
}

/// Environment examples and references are not literal credentials.
fn env_placeholder(value: &str) -> bool {
    static REFERENCE: OnceLock<Regex> = OnceLock::new();
    let lower = value.to_ascii_lowercase();
    value.is_empty()
        || re(
            &REFERENCE,
            r"^\$(?:[A-Za-z_][A-Za-z0-9_]*|\{[A-Za-z_][A-Za-z0-9_]*\})$",
        )
        .is_match(value)
        || matches!(
            lower.as_str(),
            "changeme" | "change-me" | "example" | "placeholder" | "todo" | "dummy" | "test"
        )
        || lower.starts_with("your-")
        || lower.starts_with("your_")
        || (lower.len() >= 3 && lower.bytes().all(|b| b == b'x'))
        || (value.starts_with('<') && value.ends_with('>'))
}

/// The nearest folder at or above `root` that holds a `.git`.
fn repo_top(root: &Path) -> Option<PathBuf> {
    root.ancestors()
        .find(|d| d.join(".git").exists())
        .map(Path::to_path_buf)
}

fn same_dir(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

/// Whether `root` or a folder above it holds a `.git`.
fn in_repo(root: &Path) -> bool {
    root.ancestors().any(|d| d.join(".git").exists())
}

/// `None` when `root` isn't in a git work tree; `Some(Err)` when git failed
/// or ran past its deadline.
fn git_ls_files(root: &Path) -> Option<Result<Vec<String>, ()>> {
    let child = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["-c", "core.fsmonitor=false", "ls-files", "-z", "--cached"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn();
    let Ok(mut child) = child else {
        return in_repo(root).then_some(Err(()));
    };
    let mut out = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        use std::io::Read;
        let mut buf = Vec::new();
        let _ = out.read_to_end(&mut buf);
        buf
    });
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break s,
            Ok(None) if started.elapsed() < GIT_DEADLINE => {
                std::thread::sleep(Duration::from_millis(5))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Some(Err(()));
            }
        }
    };
    let buf = reader.join().unwrap_or_default();
    if !status.success() {
        // Not a repository: fall back to the walk. A repository git failed
        // to read: nothing is proven.
        return in_repo(root).then_some(Err(()));
    }
    Some(Ok(String::from_utf8_lossy(&buf)
        .split('\0')
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect()))
}

/// Cheap evidence-only comment removal, never used by the secret scanner.
fn evidence_text(file: &str, text: &str) -> String {
    static BLOCK: OnceLock<Regex> = OnceLock::new();
    static TEMPLATE: OnceLock<Regex> = OnceLock::new();
    let text = re(&BLOCK, r"(?s)<!--.*?-->|/\*.*?\*/").replace_all(text, " ");
    // The template languages' own comments: Jinja and Twig `{# #}`, ERB and
    // EJS `<%# %>`, Blade `{{-- --}}`, Handlebars `{{! }}`, Liquid's block.
    static HANDLEBARS: OnceLock<Regex> = OnceLock::new();
    let text = if TEMPLATE_EXTS.contains(&ext(file)) {
        let text = re(
            &TEMPLATE,
            r"(?s)\{#.*?#\}|<%#.*?%>|\{\{--.*?--\}\}|\{%-?\s*comment\s*-?%\}.*?\{%-?\s*endcomment\s*-?%\}",
        )
        .replace_all(&text, " ");
        // Only in Handlebars: Blade's `{!! $html !!}` opens the same way.
        if ext(file) == "hbs" {
            std::borrow::Cow::Owned(
                re(&HANDLEBARS, r"(?s)\{\{!--.*?--\}\}|\{\{!.*?\}\}")
                    .replace_all(&text, " ")
                    .into_owned(),
            )
        } else {
            text
        }
    } else {
        text
    };
    let slash = matches!(
        ext(file),
        "js" | "jsx" | "ts" | "tsx" | "mjs" | "cjs" | "vue" | "svelte" | "astro" | "scss" | "less"
    );
    let hash = matches!(ext(file), "yml" | "yaml" | "sh" | "py" | "rb" | "toml");
    text.lines()
        .filter(|l| {
            let l = l.trim_start();
            !(slash && l.starts_with("//") || hash && l.starts_with('#'))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// A closed list: anything outside these non-test operations may run tests.
fn ci_known_non_test_commands(text: &str) -> bool {
    static SEPARATOR: OnceLock<Regex> = OnceLock::new();
    static KNOWN: OnceLock<Regex> = OnceLock::new();
    let known = re(
        &KNOWN,
        r"(?x)^(?:
            (?:npm|pnpm|yarn|bun)\s+(?:(?:-r|--filter\s+\S+)\s+)?(?:run\s+)?
                (?:ci|i|install|build|lint|format|fmt|typecheck|type-check|deploy|setup)(?:[ :\s]|$)
            |(?:make|just|cargo|go|gradle|gradlew|mvn|mvnw|dotnet|swift|mix)\s+
                (?:install|build|lint|format|fmt|typecheck|type-check|deploy|setup|check|restore|compile|package)(?:[ :\s]|$)
            |(?:(?:npx|pnpx|bunx)\s+)?(?:eslint|prettier|tsc|biome|ruff|black|rustfmt)\b
            |(?:pip3?|poetry|uv|bundle|composer)\s+(?:install|sync|check|update)\b
            |(?:echo|printf|cd|pwd|true|exit)\b
        )",
    );
    re(&SEPARATOR, r"&&|\|\||[;\n|]")
        .split(text)
        .map(|command| command.trim().trim_matches(['\'', '"']))
        .filter(|command| !command.is_empty())
        .all(|command| known.is_match(command))
}

fn ci_commands(text: &str) -> String {
    static STEP: OnceLock<Regex> = OnceLock::new();
    let step = re(
        &STEP,
        r"^(\s*)(?:-\s*)?(?:run|script|command|bash|powershell|pwsh):\s*(.*)$",
    );
    let mut out = String::new();
    let mut block = None;
    for line in text.lines() {
        if line.trim().is_empty() {
            continue;
        }
        if let Some(c) = step.captures(line) {
            let command = c[2].trim();
            block = matches!(command, "" | "|" | ">" | "|-" | ">-").then_some(c[1].len());
            if block.is_none() {
                // An inline list, `script: [npm ci, npm test]`, is one
                // command per entry.
                match command.strip_prefix('[').and_then(|c| c.strip_suffix(']')) {
                    Some(list) => {
                        // Split on the commas between entries, never on
                        // one inside a quoted entry.
                        let (mut quote, mut entry) = (None, String::new());
                        // A quote opens only at the start of an entry: an
                        // apostrophe inside a plain one is just a letter.
                        for ch in list.chars().chain([',']) {
                            match (quote, ch) {
                                (None, '"' | '\'') if entry.trim().is_empty() => quote = Some(ch),
                                (Some(q), c) if c == q => quote = None,
                                (None, ',') => {
                                    out.push_str(entry.trim());
                                    out.push('\n');
                                    entry.clear();
                                }
                                _ => entry.push(ch),
                            }
                        }
                        // A quote that never closed: keep what's left as one
                        // command nobody can classify, so nothing is claimed.
                        if quote.is_some() {
                            // The marker alone: the entry's own words
                            // must not reach the test matcher.
                            out.push_str("unreadable-list-entry\n");
                        }
                    }
                    None => {
                        out.push_str(command);
                        out.push('\n');
                    }
                }
            }
        } else if let Some(indent) = block {
            if line.len() - line.trim_start().len() > indent {
                out.push_str(line.trim().trim_start_matches("- "));
                out.push('\n');
            } else {
                block = None;
            }
        }
    }
    out
}

/// Only Markdown code containing a command, not surrounding prose.
fn readme_commands(text: &str) -> String {
    static INLINE: OnceLock<Regex> = OnceLock::new();
    static COMMAND: OnceLock<Regex> = OnceLock::new();
    let command = re(
        &COMMAND,
        r"^\s*(?:\$\s*)?(?:npx|npm|pnpm|yarn|bun|pip3?|poetry|uv|bundle|composer|mix|go|deno|make|bin/setup|bin/dev|cargo|python3?|flask|uvicorn|rails|docker|hugo|jekyll|artisan)\b",
    );
    let project_command = |line: &str| {
        let words: Vec<_> = line
            .trim()
            .trim_start_matches('$')
            .split_whitespace()
            .collect();
        command.is_match(line)
            && !(words.first() == Some(&"npx")
                && words.get(1).is_some_and(|w| {
                    w.starts_with("create-") || w.contains("/create-") || *w == "degit"
                }))
    };
    let mut fence = None;
    let mut out = String::new();
    for line in text.lines() {
        let l = line.trim_start();
        let marker = if l.starts_with("```") {
            Some('`')
        } else if l.starts_with("~~~") {
            Some('~')
        } else {
            None
        };
        if let Some(m) = marker {
            if fence == Some(m) {
                fence = None;
            } else if fence.is_none() {
                fence = Some(m);
            }
            continue;
        }
        if fence.is_some() {
            if project_command(line) {
                out.push_str(line);
                out.push('\n');
            }
        } else if (line.starts_with("    ") || line.starts_with('\t')) && project_command(line) {
            // An indented code block, Markdown's or reStructuredText's.
            out.push_str(line);
            out.push('\n');
        } else {
            for c in re(&INLINE, r"`([^`\n]+)`").captures_iter(line) {
                if project_command(&c[1]) {
                    out.push_str(&c[1]);
                    out.push('\n');
                }
            }
        }
    }
    out
}
