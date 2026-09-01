//! JS: live/frameworks/index.mjs. The live-mode framework registry: detection
//! order is injection priority (SvelteKit → Nuxt → TanStack Start → Astro →
//! Next → Vite → static HTML), source traits resolve by file extension.

pub mod astro;
pub mod detect_utils;
pub mod html;
pub mod next;
pub mod nuxt;
pub mod sveltekit;
pub mod tag_strategy;
pub mod tanstack;

use crate::config::LiveConfig;
use crate::util::jsp;
use serde_json::{json, Value};

/// The patch kind the generic tag strategy records in the journal.
pub const TAG_PATCH_KIND: &str = "live-tag";

/// A registry entry's name (also the `adapter` value in inject JSON).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameworkName {
    SvelteKit,
    Nuxt,
    TanStackStart,
    Astro,
    NextJs,
    ViteGeneric,
    StaticHtml,
}

impl FrameworkName {
    pub fn as_str(&self) -> &'static str {
        match self {
            FrameworkName::SvelteKit => "sveltekit",
            FrameworkName::Nuxt => "nuxt",
            FrameworkName::TanStackStart => "tanstack-start",
            FrameworkName::Astro => "astro",
            FrameworkName::NextJs => "nextjs",
            FrameworkName::ViteGeneric => "vite-generic",
            FrameworkName::StaticHtml => "static-html",
        }
    }
}

/// The detector's project descriptor.
#[derive(Debug, Clone)]
pub enum Project {
    SvelteKit(sveltekit::SvelteKitProject),
    Nuxt(nuxt::NuxtProject),
    TanStack(tanstack::TanStackProject),
    /// astro / nextjs / vite-generic / static-html descriptors (JSON, unused
    /// beyond truthiness).
    Generic(Value),
}

/// JS: `{ framework, project }` from resolveFramework.
#[derive(Debug, Clone)]
pub struct ResolvedFramework {
    pub name: FrameworkName,
    pub project: Project,
}

impl ResolvedFramework {
    /// JS: framework.inject.kind === 'adapter'
    pub fn is_adapter(&self) -> bool {
        matches!(
            self.name,
            FrameworkName::SvelteKit | FrameworkName::Nuxt | FrameworkName::TanStackStart
        )
    }
}

/// JS: resolveFramework(cwd, config). Never None while static-html is last.
pub fn resolve_framework(cwd: &str, config: Option<&LiveConfig>) -> Option<ResolvedFramework> {
    if let Some(p) = sveltekit::detect_sveltekit_project(cwd, config) {
        return Some(ResolvedFramework {
            name: FrameworkName::SvelteKit,
            project: Project::SvelteKit(p),
        });
    }
    if let Some(p) = nuxt::detect_nuxt_project(cwd) {
        return Some(ResolvedFramework {
            name: FrameworkName::Nuxt,
            project: Project::Nuxt(p),
        });
    }
    if let Some(p) = tanstack::detect_tanstack_start_project(cwd) {
        return Some(ResolvedFramework {
            name: FrameworkName::TanStackStart,
            project: Project::TanStack(p),
        });
    }
    if let Some(p) = astro::detect_astro_project(cwd, config) {
        return Some(ResolvedFramework {
            name: FrameworkName::Astro,
            project: Project::Generic(p),
        });
    }
    if let Some(p) = next::detect_next_project(cwd) {
        return Some(ResolvedFramework {
            name: FrameworkName::NextJs,
            project: Project::Generic(p),
        });
    }
    if let Some(p) = html::detect_vite_project(cwd) {
        return Some(ResolvedFramework {
            name: FrameworkName::ViteGeneric,
            project: Project::Generic(p),
        });
    }
    html::detect_static_html().map(|p| ResolvedFramework {
        name: FrameworkName::StaticHtml,
        project: Project::Generic(p),
    })
}

/// JS: SOURCE_TRAIT_DEFAULTS merged with the claiming entry's `source`.
#[derive(Debug, Clone)]
pub struct SourceTraits {
    pub framework: Option<FrameworkName>,
    pub preview: &'static str,
    pub style_mode: &'static str,
    pub style_tag: &'static str,
    pub comment_syntax: &'static str,
    pub inject_script_attrs: &'static str,
}

const DEFAULT_STYLE_TAG: &str = "<style data-impeccable-css=\"SESSION_ID\">";

/// JS: resolveSourceTraits(filePath)
pub fn resolve_source_traits(file_path: &str) -> SourceTraits {
    let ext = jsp::extname(file_path).to_lowercase();
    let base = SourceTraits {
        framework: None,
        preview: "source",
        style_mode: "scoped",
        style_tag: DEFAULT_STYLE_TAG,
        comment_syntax: "html",
        inject_script_attrs: "",
    };
    match ext.as_str() {
        ".svelte" => SourceTraits {
            framework: Some(FrameworkName::SvelteKit),
            preview: "component",
            ..base
        },
        ".vue" => SourceTraits {
            framework: Some(FrameworkName::Nuxt),
            ..base
        },
        ".tsx" | ".jsx" => SourceTraits {
            framework: Some(FrameworkName::TanStackStart),
            comment_syntax: "jsx",
            ..base
        },
        ".astro" => SourceTraits {
            framework: Some(FrameworkName::Astro),
            style_mode: "astro-global-prefixed",
            style_tag: "<style is:inline data-impeccable-css=\"SESSION_ID\">",
            inject_script_attrs: "is:inline ",
            ..base
        },
        ".html" | ".htm" => SourceTraits {
            framework: Some(FrameworkName::StaticHtml),
            ..base
        },
        _ => base,
    }
}

/// JS: frameworkIgnorePatterns(resolved)
pub fn framework_ignore_patterns(resolved: Option<&ResolvedFramework>) -> Vec<String> {
    match resolved.map(|r| &r.project) {
        Some(Project::Nuxt(p)) if !p.plugin_file.is_empty() => vec![p.plugin_file.clone()],
        Some(Project::TanStack(p)) if !p.component_file.is_empty() => {
            vec![p.component_file.clone()]
        }
        _ => vec![],
    }
}

/// JS: describeInjectArtifacts(resolved, { cwd, files })
pub fn describe_inject_artifacts(
    resolved: Option<&ResolvedFramework>,
    files: &[String],
) -> Vec<Value> {
    let Some(resolved) = resolved else {
        return vec![];
    };
    let list: Vec<Value> = match &resolved.project {
        Project::SvelteKit(p) => sveltekit::sveltekit_artifacts(p),
        Project::Nuxt(p) => nuxt::nuxt_artifacts(p),
        Project::TanStack(p) => tanstack::tanstack_artifacts(p),
        Project::Generic(_) => {
            return files
                .iter()
                .map(|f| json!({ "kind": "patched", "path": f, "patch": TAG_PATCH_KIND, "markers": tag_strategy::TAG_PATCH_MARKERS }))
                .collect()
        }
    };
    list.into_iter()
        .filter(|a| {
            a.get("path")
                .and_then(|p| p.as_str())
                .map(|p| !p.is_empty())
                .unwrap_or(false)
        })
        .collect()
}

/// JS: PATCH_UNDOERS[patch]
pub fn undo_patch(patch: &str, content: &str) -> Option<String> {
    match patch {
        "live-tag" => Some(tag_strategy::unpatch_tag_file(content)),
        "sveltekit-layout" => Some(sveltekit::unpatch_svelte_layout(content)),
        "tanstack-root" => Some(tanstack::unpatch_tanstack_root(content)),
        _ => None,
    }
}

/// JS: framework.inject.apply(...) for adapters. `Value::Null` mirrors an
/// adapter returning null (SvelteKit when detection no longer holds).
pub fn adapter_apply(
    resolved: &ResolvedFramework,
    cwd: &str,
    port: i64,
    token: Option<&str>,
    config: Option<&LiveConfig>,
) -> Value {
    match &resolved.project {
        Project::SvelteKit(_) => sveltekit::apply_sveltekit_live_adapter(cwd, port, token, config),
        Project::Nuxt(p) => nuxt::apply_nuxt_live_adapter(cwd, port, token, p),
        Project::TanStack(p) => tanstack::apply_tanstack_live_adapter(cwd, port, token, p),
        Project::Generic(_) => Value::Null,
    }
}

/// JS: framework.inject.remove(...) for adapters.
pub fn adapter_remove(
    resolved: &ResolvedFramework,
    cwd: &str,
    config: Option<&LiveConfig>,
) -> Value {
    match &resolved.project {
        Project::SvelteKit(_) => sveltekit::remove_sveltekit_live_adapter(cwd, config),
        Project::Nuxt(p) => nuxt::remove_nuxt_live_adapter(cwd, p),
        Project::TanStack(p) => tanstack::remove_tanstack_live_adapter(cwd, p),
        Project::Generic(_) => Value::Null,
    }
}
