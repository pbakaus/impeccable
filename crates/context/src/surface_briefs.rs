//! JS: lib/surface-briefs.mjs

use crate::jsp;
use crate::target_slug::{legacy_slug_from_target, slug_from_target};
use crate::url;
use crate::util::{exists, js_trim, read_dir_names, safe_read};
use serde_json::{Map, Value};

pub const SURFACE_BRIEF_VERSION: u32 = 1;

pub fn get_surface_brief_dir(project_root: &str) -> String {
    jsp::join(&[project_root, ".impeccable", "surfaces"])
}

fn normalize_route_target(route: &str) -> Option<String> {
    if !route.starts_with('/') || route.contains("..") {
        return None;
    }
    let cut = route.split(|c| c == '?' || c == '#').next().unwrap_or("");
    // collapse //+ -> /
    let mut collapsed = String::with_capacity(cut.len());
    let mut prev_slash = false;
    for c in cut.chars() {
        if c == '/' {
            if !prev_slash {
                collapsed.push('/');
            }
            prev_slash = true;
        } else {
            prev_slash = false;
            collapsed.push(c);
        }
    }
    // strip one trailing '/'
    let stripped = collapsed.strip_suffix('/').unwrap_or(&collapsed);
    let normalized = if stripped.is_empty() { "/" } else { stripped };
    Some(format!("route:{}", normalized))
}

/// JS: normalizeSurfaceTarget(target, { projectRoot })
pub fn normalize_surface_target(target: Option<&str>, project_root: &str) -> Option<String> {
    let target = target?;
    let trimmed = js_trim(target);
    if trimmed.is_empty() {
        return None;
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        let mut u = url::parse(trimmed)?;
        u.hash.clear();
        u.search.clear();
        let s = u.to_string();
        let s = s.strip_suffix('/').unwrap_or(&s).to_string();
        return Some(if s.is_empty() { u.origin() } else { s });
    }
    if lower.starts_with("route:") {
        let idx = trimmed.find(':').unwrap();
        return normalize_route_target(js_trim(&trimmed[idx + 1..]));
    }
    if trimmed == "/" {
        return normalize_route_target(trimmed);
    }
    if trimmed.starts_with('/') {
        let absolute = jsp::resolve(project_root, &[trimmed]);
        let rel = jsp::relative(project_root, project_root, &absolute);
        let is_project_file = !rel.is_empty() && !rel.starts_with("..") && !jsp::is_absolute(&rel);
        if !is_project_file && !exists(&absolute) {
            return normalize_route_target(trimmed);
        }
    }
    let abs = if jsp::is_absolute(trimmed) { trimmed.to_string() } else { jsp::resolve(project_root, &[trimmed]) };
    let rel = jsp::relative(project_root, project_root, &abs);
    if rel.is_empty() || rel == "." || rel.starts_with("..") || jsp::is_absolute(&rel) {
        return None;
    }
    Some(jsp::to_posix(&rel))
}

/// JS: surfaceBriefPathForTarget
pub fn surface_brief_path_for_target(target: Option<&str>, project_root: &str) -> Option<String> {
    let normalized = normalize_surface_target(target, project_root)?;
    let slug_input = match normalized.strip_prefix("route:") {
        Some(rest) => format!("route{}", rest),
        None => normalized.clone(),
    };
    let slug = slug_from_target(Some(&slug_input), project_root)?;
    Some(jsp::join(&[&get_surface_brief_dir(project_root), &format!("{}.md", slug)]))
}

fn legacy_surface_brief_path_for_target(target: Option<&str>, project_root: &str) -> Option<String> {
    let normalized = normalize_surface_target(target, project_root)?;
    let slug_input = match normalized.strip_prefix("route:") {
        Some(rest) => format!("route{}", rest),
        None => normalized.clone(),
    };
    let slug = legacy_slug_from_target(Some(&slug_input), project_root)?;
    Some(jsp::join(&[&get_surface_brief_dir(project_root), &format!("{}.md", slug)]))
}

#[derive(Debug, Clone)]
pub struct SurfaceBrief {
    pub path: Option<String>,
    pub text: String,
    pub body: String,
    pub meta: Map<String, Value>,
    pub slug: Option<String>,
    pub primary_target: Option<String>,
    pub related_targets: Vec<String>,
    pub targets: Vec<String>,
}

fn is_json_start(raw: &str) -> bool {
    raw.starts_with('[') || raw.starts_with('{') || raw.starts_with('"')
}

fn is_json_scalar(raw: &str) -> bool {
    if raw == "true" || raw == "false" || raw == "null" {
        return true;
    }
    // -?\d+(\.\d+)?
    let s = raw.strip_prefix('-').unwrap_or(raw);
    let mut parts = s.splitn(2, '.');
    let int = parts.next().unwrap_or("");
    if int.is_empty() || !int.chars().all(|c| c.is_ascii_digit()) {
        return false;
    }
    match parts.next() {
        None => true,
        Some(f) => !f.is_empty() && f.chars().all(|c| c.is_ascii_digit()),
    }
}

/// Split frontmatter per /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/ .
/// Returns (inner, match_len).
pub fn split_frontmatter(text: &str) -> Option<(String, usize)> {
    let after_open = if let Some(r) = text.strip_prefix("---\r\n") {
        (r, 5)
    } else if let Some(r) = text.strip_prefix("---\n") {
        (r, 4)
    } else {
        return None;
    };
    let (rest, open_len) = after_open;
    // find the earliest "\r?\n---" followed by "\r?\n" or end
    let bytes = rest.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\n' && rest[i + 1..].starts_with("---") {
            let inner_end = if i > 0 && bytes[i - 1] == b'\r' { i - 1 } else { i };
            let after = &rest[i + 4..];
            let tail_len = if after.starts_with("\r\n") {
                Some(2)
            } else if after.starts_with('\n') {
                Some(1)
            } else if after.is_empty() {
                Some(0)
            } else {
                None
            };
            if let Some(t) = tail_len {
                let inner = rest[..inner_end].to_string();
                return Some((inner, open_len + i + 4 + t));
            }
        }
        i += 1;
    }
    None
}

/// JS: parseSurfaceBrief(text, filePath)
pub fn parse_surface_brief(text: &str, file_path: Option<&str>) -> SurfaceBrief {
    let mut meta = Map::new();
    let fm = split_frontmatter(text);
    if let Some((inner, _)) = &fm {
        for line in inner.split('\n') {
            let line = line.strip_suffix('\r').unwrap_or(line);
            let Some(colon) = line.find(':') else { continue };
            let key = js_trim(&line[..colon]);
            let raw = js_trim(&line[colon + 1..]);
            if key.is_empty() {
                continue;
            }
            if is_json_start(raw) || is_json_scalar(raw) {
                if let Ok(v) = serde_json::from_str::<Value>(raw) {
                    meta.insert(key.to_string(), v);
                    continue;
                }
            }
            let mut v = raw;
            // /^['"]|['"]$/g : strip one leading and one trailing quote
            if v.starts_with('\'') || v.starts_with('"') {
                v = &v[1..];
            }
            if v.ends_with('\'') || v.ends_with('"') {
                v = &v[..v.len() - 1];
            }
            meta.insert(key.to_string(), Value::String(v.to_string()));
        }
    }
    let primary_target = meta.get("primary_target").and_then(|v| v.as_str()).map(|s| s.to_string());
    let related_targets: Vec<String> = meta
        .get("related_targets")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default();
    let body = match &fm {
        Some((_, len)) => js_trim(&text[*len..]).to_string(),
        None => js_trim(text).to_string(),
    };
    let slug = match meta.get("slug").and_then(|v| v.as_str()) {
        Some(s) => Some(s.to_string()),
        None => file_path.map(|p| jsp::basename_ext(p, ".md")),
    };
    let mut targets: Vec<String> = Vec::new();
    if let Some(p) = &primary_target {
        if !p.is_empty() {
            targets.push(p.clone());
        }
    }
    for r in &related_targets {
        if !r.is_empty() {
            targets.push(r.clone());
        }
    }
    SurfaceBrief {
        path: file_path.map(|s| s.to_string()),
        text: text.to_string(),
        body,
        meta,
        slug,
        primary_target,
        related_targets,
        targets,
    }
}

/// JS: listSurfaceBriefs
pub fn list_surface_briefs(project_root: &str) -> Vec<SurfaceBrief> {
    let dir = get_surface_brief_dir(project_root);
    let Some(names) = read_dir_names(&dir) else { return vec![] };
    let mut names: Vec<String> = names.into_iter().filter(|n| n.ends_with(".md")).collect();
    names.sort();
    names
        .into_iter()
        .filter_map(|name| {
            let fp = jsp::join(&[&dir, &name]);
            safe_read(&fp).map(|t| parse_surface_brief(&t, Some(&fp)))
        })
        .collect()
}

pub struct SurfaceResolution {
    pub brief: Option<SurfaceBrief>,
    pub candidates: Vec<SurfaceBrief>,
    pub reason: &'static str,
}

/// JS: resolveSurfaceBrief(projectRoot, target)
pub fn resolve_surface_brief(project_root: &str, target: Option<&str>) -> SurfaceResolution {
    let briefs = list_surface_briefs(project_root);
    let Some(target) = target.filter(|t| !t.is_empty()) else {
        let n = briefs.len();
        return SurfaceResolution {
            brief: if n == 1 { Some(briefs[0].clone()) } else { None },
            reason: if n == 1 { "only-brief" } else if n > 1 { "ambiguous" } else { "none" },
            candidates: briefs,
        };
    };
    let Some(normalized) = normalize_surface_target(Some(target), project_root) else {
        return SurfaceResolution { brief: None, candidates: briefs, reason: "invalid-target" };
    };
    let exact_path = surface_brief_path_for_target(Some(&normalized), project_root);
    let legacy_path = legacy_surface_brief_path_for_target(Some(&normalized), project_root);
    let exact = briefs
        .iter()
        .find(|b| b.path == exact_path && (b.targets.is_empty() || b.targets.contains(&normalized)))
        .or_else(|| {
            // Pre-hash long slugs can collide because they contain only the
            // target suffix. Require the legacy brief's metadata to prove it
            // belongs to this target before accepting that compatibility path.
            briefs.iter().find(|b| b.path == legacy_path && b.targets.contains(&normalized))
        });
    if let Some(exact) = exact {
        return SurfaceResolution { brief: Some(exact.clone()), candidates: briefs, reason: "slug" };
    }
    let mapped: Vec<SurfaceBrief> = briefs.iter().filter(|b| b.targets.contains(&normalized)).cloned().collect();
    let n = mapped.len();
    SurfaceResolution {
        brief: if n == 1 { Some(mapped[0].clone()) } else { None },
        candidates: if n > 1 { mapped } else { briefs },
        reason: if n == 1 { "mapping" } else if n > 1 { "ambiguous-target" } else { "not-found" },
    }
}

/// JS: writeSurfaceBrief
pub fn write_surface_brief(
    project_root: &str,
    primary_target: &str,
    related_targets: &[String],
    body: &str,
) -> Result<String, String> {
    let normalized_primary = normalize_surface_target(Some(primary_target), project_root)
        .ok_or_else(|| "surface brief requires a concrete project-relative primary target or URL".to_string())?;
    let mut related: Vec<String> = Vec::new();
    for t in related_targets {
        if let Some(n) = normalize_surface_target(Some(t), project_root) {
            if n != normalized_primary && !related.contains(&n) {
                related.push(n);
            }
        }
    }
    let slug = slug_from_target(Some(&normalized_primary), project_root);
    let file_path = surface_brief_path_for_target(Some(&normalized_primary), project_root)
        .ok_or_else(|| "surface brief requires a concrete project-relative primary target or URL".to_string())?;
    let _ = std::fs::create_dir_all(jsp::dirname(&file_path));
    let frontmatter = [
        "---".to_string(),
        format!("version: {}", SURFACE_BRIEF_VERSION),
        format!("slug: {}", serde_json::to_string(&slug).unwrap()),
        format!("primary_target: {}", serde_json::to_string(&normalized_primary).unwrap()),
        format!("related_targets: {}", serde_json::to_string(&related).unwrap()),
        "---".to_string(),
    ]
    .join("\n");
    let content = format!("{}\n\n{}\n", frontmatter, js_trim(body));
    std::fs::write(&file_path, content).map_err(|e| e.to_string())?;
    Ok(file_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static TMP_SEQ: AtomicUsize = AtomicUsize::new(0);

    #[test]
    fn resolves_pre_hash_long_slug_briefs() {
        let root = std::env::temp_dir().join(format!(
            "impeccable-surface-legacy-{}-{}",
            std::process::id(),
            TMP_SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        let root = root.to_string_lossy().into_owned();
        let target = "src/a-very-long-directory-structure-with-many-segments/component-name.tsx";
        let legacy = legacy_surface_brief_path_for_target(Some(target), &root).unwrap();
        let current = surface_brief_path_for_target(Some(target), &root).unwrap();
        assert_ne!(legacy, current);

        std::fs::create_dir_all(get_surface_brief_dir(&root)).unwrap();
        let normalized = normalize_surface_target(Some(target), &root).unwrap();
        let legacy_body = format!(
            "---\nprimary_target: {}\n---\n# Legacy brief\n",
            serde_json::to_string(&normalized).unwrap()
        );
        std::fs::write(&legacy, legacy_body).unwrap();

        let resolved = resolve_surface_brief(&root, Some(target));
        assert_eq!(resolved.reason, "slug");
        assert_eq!(resolved.brief.unwrap().path.as_deref(), Some(legacy.as_str()));

        std::fs::write(&current, "# Current brief\n").unwrap();
        let resolved = resolve_surface_brief(&root, Some(target));
        assert_eq!(resolved.brief.unwrap().path.as_deref(), Some(current.as_str()));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_unmapped_pre_hash_slug_collisions() {
        let root = std::env::temp_dir().join(format!(
            "impeccable-surface-legacy-collision-{}-{}",
            std::process::id(),
            TMP_SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        let root = root.to_string_lossy().into_owned();
        let target = "src/first-prefix-that-is-long-enough/a-very-long-shared-tail/component-name.tsx";
        let collision = "src/second-prefix-that-is-long-enough/a-very-long-shared-tail/component-name.tsx";
        let legacy = legacy_surface_brief_path_for_target(Some(target), &root).unwrap();
        assert_eq!(legacy, legacy_surface_brief_path_for_target(Some(collision), &root).unwrap());
        assert_ne!(
            surface_brief_path_for_target(Some(target), &root),
            surface_brief_path_for_target(Some(collision), &root)
        );

        std::fs::create_dir_all(get_surface_brief_dir(&root)).unwrap();
        std::fs::write(&legacy, "# Unmapped legacy brief\n").unwrap();
        assert_eq!(resolve_surface_brief(&root, Some(target)).reason, "not-found");

        let normalized = normalize_surface_target(Some(target), &root).unwrap();
        let legacy_body = format!(
            "---\nprimary_target: {}\n---\n# Mapped legacy brief\n",
            serde_json::to_string(&normalized).unwrap()
        );
        std::fs::write(&legacy, legacy_body).unwrap();
        assert_eq!(resolve_surface_brief(&root, Some(target)).reason, "slug");
        assert_eq!(resolve_surface_brief(&root, Some(collision)).reason, "not-found");

        let _ = std::fs::remove_dir_all(&root);
    }
}
