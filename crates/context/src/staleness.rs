//! JS: lib/staleness.mjs (Tier 1)

use crate::artifact_schema::*;
use crate::context::{BriefSummary, Ctx, TargetCandidate};
use crate::jsp;
use crate::util::{exists, js_trim, mtime_ms, read_json};
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{Map, Value};

#[derive(Debug, Clone, serde::Serialize, PartialEq)]
pub struct Finding {
    pub id: String,
    pub artifact: String,
    pub path: Option<String>,
    pub severity: &'static str,
    pub summary: String,
    pub fix: String,
}

impl Finding {
    pub fn to_value(&self) -> Value {
        let mut m = Map::new();
        m.insert("id".into(), Value::String(self.id.clone()));
        m.insert("artifact".into(), Value::String(self.artifact.clone()));
        m.insert("path".into(), self.path.clone().map(Value::String).unwrap_or(Value::Null));
        m.insert("severity".into(), Value::String(self.severity.to_string()));
        m.insert("summary".into(), Value::String(self.summary.clone()));
        m.insert("fix".into(), Value::String(self.fix.clone()));
        Value::Object(m)
    }
}

pub fn finding(id: &str, artifact: &str, path: Option<String>, severity: &'static str, summary: String, fix: String) -> Finding {
    Finding { id: id.to_string(), artifact: artifact.to_string(), path, severity, summary, fix }
}

const KNOWN_CONFIG_KEYS: [&str; 8] =
    ["hook", "detector", "updateCheck", "stalenessCheck", "projectRoots", "buildPath", "$schema", "version"];
const BUILD_PATH_VALUES: [&str; 2] = ["comp", "code"];
const DIRECTION_WORK_PATHS: [&str; 2] = [".impeccable/surfaces", ".impeccable/mocks/decision"];
const KNOWN_DETECTOR_KEYS: [&str; 5] = ["ignoreRules", "ignoreFiles", "ignoreValues", "designSystem", "extensions"];

struct NativeEvidence {
    platform: &'static str,
    reason: &'static str,
}
const NATIVE_EVIDENCE_PATHS: [(&str, &str, &str); 5] = [
    ("pubspec.yaml", "adaptive", "a Flutter pubspec.yaml"),
    ("ios/Podfile", "ios", "an ios/Podfile"),
    ("android/build.gradle", "android", "an android/build.gradle"),
    ("android/build.gradle.kts", "android", "an android/build.gradle.kts"),
    ("ios/Runner.xcodeproj", "ios", "an ios/Runner.xcodeproj"),
];
const NATIVE_EVIDENCE_DEPENDENCIES: [(&str, &str, &str); 3] = [
    ("react-native", "adaptive", "a react-native dependency"),
    ("expo", "adaptive", "an expo dependency"),
    ("@react-native/metro-config", "adaptive", "a React Native metro config dependency"),
];

/// JS: designSidecarCandidatesFor(projectRoot, contextDir)
pub fn design_sidecar_candidates_for(project_root: &str, context_dir: Option<&str>) -> Vec<String> {
    let mut c = vec![jsp::join(&[project_root, ".impeccable", "design.json"]), jsp::join(&[project_root, "DESIGN.json"])];
    let ctx_legacy = jsp::join(&[context_dir.unwrap_or(project_root), "DESIGN.json"]);
    if !c.contains(&ctx_legacy) {
        c.push(ctx_legacy);
    }
    c
}

fn has_section(markdown: &str, heading: &str) -> bool {
    Regex::new(&format!(r"(?im)^##\s+{}\s*$", regex::escape(heading))).map(|r| r.is_match(markdown)).unwrap_or(false)
}

pub fn to_relative(file_path: Option<&str>, root: &str) -> Option<String> {
    let fp = file_path?;
    let rel = jsp::relative("/", root, fp);
    if !rel.is_empty() && !rel.starts_with("..") && !jsp::is_absolute(&rel) {
        Some(jsp::to_posix(&rel))
    } else {
        Some(fp.to_string())
    }
}

fn wrap_ticks(items: &[String]) -> String {
    items.iter().map(|k| format!("`{}`", k)).collect::<Vec<_>>().join(", ")
}

/// JS: checkProduct
pub fn check_product(product: Option<&str>, product_path: &str) -> Vec<Finding> {
    let Some(product) = product.filter(|p| !p.is_empty()) else { return vec![] };
    let mut out = Vec::new();
    for (heading, reason) in PRODUCT_DEPRECATED_SECTIONS {
        if !has_section(product, heading) {
            continue;
        }
        out.push(finding(
            &format!("product-deprecated-{}", heading.to_lowercase()),
            "PRODUCT.md",
            Some(product_path.to_string()),
            "mention",
            format!("PRODUCT.md still carries a `## {}` section. {}", heading, reason),
            format!(
                "Treat `## {}` as absent for every decision this session. Offer to delete the section; do not let its value influence the work either way.",
                heading
            ),
        ));
    }
    let stamped = read_product_schema_version(product);
    if stamped.is_none() && !PRODUCT_V4_SECTIONS.iter().any(|s| has_section(product, s)) {
        out.push(finding(
            "product-schema-legacy",
            "PRODUCT.md",
            Some(product_path.to_string()),
            "route",
            format!(
                "PRODUCT.md has no schema stamp and none of the sections the current record adds ({}), so it predates this version of the product record.",
                PRODUCT_V4_SECTIONS.join(", ")
            ),
            "Offer `init`, which preserves confirmed answers and fills the gaps by interview. Do not rewrite the file from inference.".to_string(),
        ));
    } else if let Some(v) = stamped {
        if v < PRODUCT_SCHEMA_VERSION {
            out.push(finding(
                "product-schema-outdated",
                "PRODUCT.md",
                Some(product_path.to_string()),
                "route",
                format!("PRODUCT.md is stamped product-schema {}; the current record is {}.", v, PRODUCT_SCHEMA_VERSION),
                "Offer `init` to bring the record current, preserving confirmed answers.".to_string(),
            ));
        }
    }
    out
}

/// JS: checkNativePlatformEvidence
pub fn check_native_platform_evidence(
    project_root: &str,
    platform: Option<&str>,
    product: Option<&str>,
    product_path: Option<&str>,
) -> Vec<Finding> {
    if project_root.is_empty() {
        return vec![];
    }
    if let Some(p) = platform {
        if !p.is_empty() && p != "web" {
            return vec![];
        }
    }
    let mut evidence: Vec<NativeEvidence> = Vec::new();
    for (rel, platform, reason) in NATIVE_EVIDENCE_PATHS {
        if exists(&jsp::join(&[project_root, rel])) {
            evidence.push(NativeEvidence { platform, reason });
        }
    }
    if let Some(pkg) = read_json(&jsp::join(&[project_root, "package.json"])) {
        // JS: { ...pkg.dependencies, ...pkg.devDependencies } then deps[name] truthy
        let dep_truthy = |name: &str| -> bool {
            let mut v: Option<&Value> = None;
            if let Some(d) = pkg.get("dependencies").and_then(|d| d.as_object()) {
                if let Some(x) = d.get(name) {
                    v = Some(x);
                }
            }
            if let Some(d) = pkg.get("devDependencies").and_then(|d| d.as_object()) {
                if let Some(x) = d.get(name) {
                    v = Some(x);
                }
            }
            match v {
                None => false,
                Some(x) => js_truthy(x),
            }
        };
        if pkg.is_object() || pkg.is_array() || (!pkg.is_null() && js_truthy(&pkg)) {
            for (name, platform, reason) in NATIVE_EVIDENCE_DEPENDENCIES {
                if dep_truthy(name) {
                    evidence.push(NativeEvidence { platform, reason });
                }
            }
        }
    }
    if evidence.is_empty() {
        return vec![];
    }
    let mut platforms: Vec<&str> = Vec::new();
    for e in &evidence {
        if !platforms.contains(&e.platform) {
            platforms.push(e.platform);
        }
    }
    let suggested = if platforms.len() > 1 || platforms.contains(&"adaptive") { "adaptive" } else { platforms[0] };
    let declared = if platform == Some("web") {
        "PRODUCT.md declares `## Platform: web`"
    } else if product.map(|p| !p.is_empty()).unwrap_or(false) {
        "PRODUCT.md has no `## Platform` section, so the project resolves to web"
    } else {
        "no PRODUCT.md declares a platform, so the project resolves to web"
    };
    vec![finding(
        "platform-native-evidence",
        "PRODUCT.md",
        product_path.map(|s| s.to_string()),
        "mention",
        format!(
            "{}, but the project carries {}. Web guidance is being applied to a native codebase, and the iOS and Android references never load.",
            declared,
            evidence.iter().map(|e| e.reason).collect::<Vec<_>>().join(" and ")
        ),
        format!(
            "Ask the user whether `## Platform` should be `{}`. If it should, write the value and load the matching native reference before designing.",
            suggested
        ),
    )]
}

pub fn js_truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().map(|f| f != 0.0 && !f.is_nan()).unwrap_or(true),
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}

/// JS: checkDesignSidecar
pub fn check_design_sidecar(design_path: Option<&str>, sidecar_candidates: &[String], project_root: &str) -> Vec<Finding> {
    let mut out = Vec::new();
    let canonical = sidecar_candidates.first();
    let Some(present) = sidecar_candidates.iter().find(|c| exists(c)) else { return out };
    let rel_present = to_relative(Some(present), project_root).unwrap();
    if let Some(canon) = canonical {
        if jsp::resolve(present, &[]) != jsp::resolve(canon, &[]) {
            out.push(finding(
                "design-sidecar-legacy-path",
                "design.json",
                Some(rel_present.clone()),
                "auto",
                format!("The design sidecar sits at {}, a location kept only for backward compatibility.", rel_present),
                format!(
                    "Move it to {} the next time the sidecar is written. No user decision is needed.",
                    to_relative(Some(canon), project_root).unwrap()
                ),
            ));
        }
    }
    let sidecar = read_json(present);
    let schema_version = read_sidecar_schema_version(sidecar.as_ref());
    if let Some(sc) = &sidecar {
        if js_truthy(sc) && (schema_version.is_none() || schema_version.unwrap() < DESIGN_SIDECAR_SCHEMA_VERSION) {
            out.push(finding(
                "design-sidecar-schema-outdated",
                "design.json",
                Some(rel_present.clone()),
                "route",
                format!(
                    "{} is schemaVersion {}; the current sidecar is {}. Token primitives moved to the DESIGN.md frontmatter, so the old shape carries values that are now read from two places.",
                    rel_present,
                    schema_version.map(|v| v.to_string()).unwrap_or_else(|| "unset".to_string()),
                    DESIGN_SIDECAR_SCHEMA_VERSION
                ),
                "Offer `document` to regenerate the sidecar. It reads the existing DESIGN.md, so no interview is needed.".to_string(),
            ));
        }
    }
    if let Some(dp) = design_path {
        let dm = mtime_ms(dp);
        let sm = mtime_ms(present);
        if let (Some(d), Some(s)) = (dm, sm) {
            if d > s {
                out.push(finding(
                    "design-sidecar-stale",
                    "design.json",
                    Some(rel_present.clone()),
                    "mention",
                    format!(
                        "DESIGN.md was edited after {} was generated, so the sidecar's ramps, shadows, motion tokens, and component snippets may contradict it.",
                        rel_present
                    ),
                    "Offer `document` to refresh the sidecar, preserving DESIGN.md.".to_string(),
                ));
            }
        }
    }
    out
}

pub fn unique_roots(a: &str, b: Option<&str>) -> Vec<String> {
    let mut roots = vec![jsp::resolve(a, &[])];
    if let Some(b) = b {
        if !b.is_empty() {
            let r = jsp::resolve(b, &[]);
            if !roots.contains(&r) {
                roots.push(r);
            }
        }
    }
    roots
}

/// JS: checkConfig
pub fn check_config(project_root: &str, repo_root: Option<&str>) -> Vec<Finding> {
    let mut out = Vec::new();
    for root in unique_roots(project_root, repo_root) {
        for name in ["config.json", "config.local.json"] {
            let fp = jsp::join(&[&root, ".impeccable", name]);
            let Some(raw) = read_json(&fp) else { continue };
            let Some(obj) = raw.as_object() else { continue };
            let rel = to_relative(Some(&fp), if project_root.is_empty() { &root } else { project_root }).unwrap();
            let unknown: Vec<String> = obj.keys().filter(|k| !KNOWN_CONFIG_KEYS.contains(&k.as_str())).cloned().collect();
            if !unknown.is_empty() {
                out.push(finding(
                    "config-unknown-keys",
                    "config.json",
                    Some(rel.clone()),
                    "mention",
                    format!(
                        "{} has top-level key(s) nothing reads: {}. Recognized keys are {}.",
                        rel,
                        wrap_ticks(&unknown),
                        wrap_ticks(&KNOWN_CONFIG_KEYS.iter().map(|s| s.to_string()).collect::<Vec<_>>())
                    ),
                    "Report the exact keys to the user. A near-miss of a real key is a setting that has never applied.".to_string(),
                ));
            }
            if let Some(bp) = obj.get("buildPath") {
                let ok = bp.as_str().map(|s| BUILD_PATH_VALUES.contains(&s)).unwrap_or(false);
                if !ok {
                    out.push(finding(
                        "config-invalid-build-path",
                        "config.json",
                        Some(rel.clone()),
                        "mention",
                        format!(
                            "{} sets `buildPath` to {}, which nothing reads. The values are {}.",
                            rel,
                            js_json_stringify(bp),
                            BUILD_PATH_VALUES.iter().map(|v| format!("`{}`", v)).collect::<Vec<_>>().join(" and ")
                        ),
                        "Report the value. An unread `buildPath` does not fall back to the other path; it falls back to the default, so a project meaning `code` has been building comp-led.".to_string(),
                    ));
                }
            }
            if let Some(det) = obj.get("detector").and_then(|d| d.as_object()) {
                let unknown_d: Vec<String> = det.keys().filter(|k| !KNOWN_DETECTOR_KEYS.contains(&k.as_str())).cloned().collect();
                if !unknown_d.is_empty() {
                    out.push(finding(
                        "config-unknown-detector-keys",
                        "config.json",
                        Some(rel.clone()),
                        "mention",
                        format!(
                            "{} has `detector` key(s) nothing reads: {}. Recognized keys are {}.",
                            rel,
                            wrap_ticks(&unknown_d),
                            wrap_ticks(&KNOWN_DETECTOR_KEYS.iter().map(|s| s.to_string()).collect::<Vec<_>>())
                        ),
                        "Report the exact keys. `ignoreRule` for `ignoreRules` is the common one, and it silences nothing.".to_string(),
                    ));
                }
            }
        }
    }
    out
}

/// `JSON.stringify(v)` for a single value (undefined -> "undefined" never occurs here since key present).
pub fn js_json_stringify(v: &Value) -> String {
    serde_json::to_string(v).unwrap_or_else(|_| "null".into())
}

/// JS: checkBuildPathUnset
pub fn check_build_path_unset(project_root: &str, repo_root: Option<&str>, product: Option<&str>) -> Vec<Finding> {
    if project_root.is_empty() || !product.map(|p| !p.is_empty()).unwrap_or(false) {
        return vec![];
    }
    for root in unique_roots(project_root, repo_root) {
        for name in ["config.json", "config.local.json"] {
            if let Some(raw) = read_json(&jsp::join(&[&root, ".impeccable", name])) {
                if js_truthy(&raw) && raw.as_object().map(|o| o.contains_key("buildPath")).unwrap_or(false) {
                    return vec![];
                }
            }
        }
    }
    let evidence: Vec<&str> = DIRECTION_WORK_PATHS.iter().copied().filter(|rel| exists(&jsp::join(&[project_root, rel]))).collect();
    if evidence.is_empty() {
        return vec![];
    }
    vec![finding(
        "config-build-path-unset",
        "config.json",
        Some(".impeccable/config.json".to_string()),
        "mention",
        "This project has run visual direction work but records no `buildPath`, so every direction round takes the comp-first default without anyone having chosen it.".to_string(),
        "Only when image generation exists in your tool surface, offer the choice once: **comp-first** (an image sets the bar before any code; bolder composition, slower) or **code-first** (build directly; ambition carried by the direction contract; leaner, faster). Write the answer to `.impeccable/config.json` as `\"buildPath\": \"comp\"` or `\"buildPath\": \"code\"`, merging with the keys already there. Without image generation there is no choice to record: stay silent.".to_string(),
    )]
}

/// JS: checkSurfaceBriefs
pub fn check_surface_briefs(candidates: &[BriefSummary], project_root: &str) -> Vec<Finding> {
    if project_root.is_empty() {
        return vec![];
    }
    let mut orphaned: Vec<&BriefSummary> = Vec::new();
    for b in candidates {
        let Some(t) = b.primary_target.as_deref() else { continue };
        if t.is_empty() {
            continue;
        }
        let lower = t.to_ascii_lowercase();
        if lower.starts_with("http://") || lower.starts_with("https://") || t.starts_with("route:") {
            continue;
        }
        if !exists(&jsp::join(&[project_root, t])) {
            orphaned.push(b);
        }
    }
    if orphaned.is_empty() {
        return vec![];
    }
    let paths: Vec<String> = orphaned.iter().map(|b| b.path.clone()).filter(|p| !p.is_empty()).collect();
    vec![finding(
        "surface-brief-orphaned",
        "surface brief",
        if paths.is_empty() { None } else { Some(paths.join(", ")) },
        "mention",
        format!(
            "{} persisted surface brief(s) name a primary target that no longer exists: {}.",
            orphaned.len(),
            orphaned
                .iter()
                .map(|b| format!("{} → {}", b.path, b.primary_target.as_deref().unwrap_or("")))
                .collect::<Vec<_>>()
                .join("; ")
        ),
        "Ask whether the surface moved (repoint the brief) or was removed (delete the brief). Until then the brief is authority for a file that is gone.".to_string(),
    )]
}

/// JS: checkProjectRoots
pub fn check_project_roots(patterns: &[String], candidates_len: usize) -> Vec<Finding> {
    let positive: Vec<&String> = patterns.iter().filter(|p| !p.is_empty() && !js_trim(p).starts_with('!')).collect();
    if positive.is_empty() || candidates_len > 0 {
        return vec![];
    }
    vec![finding(
        "config-project-roots-match-nothing",
        "config.json",
        Some(".impeccable/config.json".to_string()),
        "mention",
        format!(
            "`projectRoots` declares {}, but no directory matches any of them, so the repo root is being treated as the active project.",
            positive.iter().map(|p| format!("`{}`", p)).collect::<Vec<_>>().join(", ")
        ),
        "Report the patterns and ask which directories they should name. A renamed workspace folder is the usual cause.".to_string(),
    )]
}

pub struct BootExtras {
    pub abs_design_path: Option<String>,
    pub sidecar_candidates: Vec<String>,
    pub project_root_patterns: Option<Vec<String>>,
    pub target_candidates: Vec<TargetCandidate>,
}

/// JS: collectBootFindingGroups(ctx, extras) — the boot artifact checks
/// grouped by artifact, so deeper reports (doctor) can interleave their own
/// checks without rebuilding this policy (upstream 80997663).
pub struct BootFindingGroups {
    pub product: Vec<Finding>,
    pub native_platform: Vec<Finding>,
    pub design_sidecar: Vec<Finding>,
    pub config: Vec<Finding>,
    pub build_path: Vec<Finding>,
    pub surface_briefs: Vec<Finding>,
    pub project_roots: Vec<Finding>,
}

pub fn collect_boot_finding_groups(ctx: &Ctx, cwd: &str, extras: &BootExtras) -> BootFindingGroups {
    let project_root = if ctx.project_root.is_empty() { cwd.to_string() } else { ctx.project_root.clone() };
    BootFindingGroups {
        product: check_product(ctx.product.as_deref(), ctx.product_path.as_deref().unwrap_or("PRODUCT.md")),
        // Only checked once a PRODUCT.md exists. Without one the boot already
        // emits NO_PRODUCT_MD and routes into init, which asks for the
        // platform directly; a second signal saying the same thing is noise.
        native_platform: if ctx.product.as_deref().map(|p| !p.is_empty()).unwrap_or(false) {
            check_native_platform_evidence(
                &project_root,
                ctx.platform.as_deref(),
                ctx.product.as_deref(),
                ctx.product_path.as_deref(),
            )
        } else {
            Vec::new()
        },
        design_sidecar: check_design_sidecar(extras.abs_design_path.as_deref(), &extras.sidecar_candidates, &project_root),
        config: check_config(&project_root, Some(&ctx.repo_root)),
        build_path: check_build_path_unset(&project_root, Some(&ctx.repo_root), ctx.product.as_deref()),
        surface_briefs: check_surface_briefs(&ctx.surface_brief_candidates, &project_root),
        project_roots: match &extras.project_root_patterns {
            Some(patterns) => check_project_roots(patterns, extras.target_candidates.len()),
            None => Vec::new(),
        },
    }
}

/// JS: collectBootFindings(ctx, extras)
pub fn collect_boot_findings(ctx: &Ctx, cwd: &str, extras: &BootExtras) -> Vec<Finding> {
    let groups = collect_boot_finding_groups(ctx, cwd, extras);
    let mut out = Vec::new();
    out.extend(groups.product);
    out.extend(groups.native_platform);
    out.extend(groups.design_sidecar);
    out.extend(groups.config);
    out.extend(groups.build_path);
    out.extend(groups.surface_briefs);
    out.extend(groups.project_roots);
    out
}

pub static _UNUSED: Lazy<()> = Lazy::new(|| ());
