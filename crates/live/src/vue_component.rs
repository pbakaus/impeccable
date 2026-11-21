//! Vue acceptance is compiler-validated before any source write. Existing
//! scripts and global styles are never reconstructed from a preview SFC.
use crate::accept_css::{bake_param_values, parse_stylesheet, reconcile_css, CssNode};
use crate::accept_verify::verify_accepted_source;
use crate::svelte_component::{reindent_preserving_structure, sanitize_accepted_component_css};
use crate::util::{jsp, safe_read};
use serde_json::{json, Map, Value};
use std::{
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

/// Opt-in until the real adapter acceptance/reload suite has passed.
pub fn enabled(file: &str, env: &crate::util::Env) -> bool {
    file.to_ascii_lowercase().ends_with(".vue")
        && env
            .get("IMPECCABLE_LIVE_VUE_COMPONENT")
            .is_some_and(|v| matches!(v.as_str(), "1" | "true"))
}

fn session_directory(id: &str, cwd: &str) -> Result<PathBuf, String> {
    crate::paths::safe_session_id(id)?;
    let mut directory = PathBuf::from(cwd);
    for part in ["node_modules", ".impeccable-live", id] {
        directory.push(part);
        match std::fs::symlink_metadata(&directory) {
            Ok(metadata) => {
                let linked = metadata.file_type().is_symlink();
                #[cfg(windows)]
                let linked = {
                    use std::os::windows::fs::MetadataExt;
                    linked || metadata.file_attributes() & 0x400 != 0
                };
                if linked || !metadata.is_dir() {
                    return Err(
                        "Vue preview paths must be real session directories, not links".into(),
                    );
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(directory)
}

pub fn discard_session(id: &str, cwd: &str) -> Result<(), String> {
    let directory = session_directory(id, cwd)?;
    match std::fs::remove_dir_all(directory) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Cannot discard Vue preview: {error}")),
    }
}

pub fn scaffold(
    id: &str,
    count: i64,
    file: &str,
    start: i64,
    end: i64,
    original: &[String],
    cwd: &str,
) -> crate::svelte_component::Scaffold {
    use crate::svelte_component::{Scaffold, ScaffoldedSession, SVELTE_COMPONENT_ROOT};
    let make = || -> Result<ScaffoldedSession, String> {
        let directory = session_directory(id, cwd)?;
        if !(1..=8).contains(&count) {
            return Err("Vue preview requires 1-8 variants".into());
        }
        let source_file = jsp::resolve(cwd, &[file]);
        let source = safe_read(&source_file).ok_or("Cannot read Vue component")?;
        let parsed = analyze(&source, &source_file, cwd)?;
        if parsed["styles"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|s| s["scoped"] == true)
            .count()
            > 1
        {
            return Err("Vue preview currently requires at most one scoped CSS block; consolidate scoped blocks before wrapping".into());
        }
        let markup = original.join("\n");
        let models = parsed["modelBindings"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        let mut script = format!("defineProps({});", parsed["bindings"]);
        if !models.is_empty() {
            let names = parsed["bindings"].as_array().cloned().unwrap_or_default();
            let unique = |prefix: &str| {
                let mut name = prefix.to_string();
                while names.iter().any(|value| value.as_str() == Some(&name)) {
                    name.push('_');
                }
                name
            };
            let props_name = unique("impeccablePreviewProps");
            let ref_name = unique("impeccablePreviewRef");
            script = format!(
                "import {{ ref as {ref_name} }} from 'vue';\nconst {props_name} = defineProps({});",
                parsed["bindings"]
            );
            for name in models.iter().filter_map(Value::as_str) {
                if !names.iter().any(|value| value.as_str() == Some(name)) {
                    return Err("Vue v-model target is not an available component binding".into());
                }
                script.push_str(&format!(
                    "\nconst {name} = {ref_name}({props_name}[{}]);",
                    json!(name)
                ));
            }
        }
        let props: Vec<Value> = parsed["bindings"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(|name| {
                let event = parsed["eventBindings"]
                    .as_array()
                    .is_some_and(|names| names.iter().any(|value| value.as_str() == Some(name)));
                let render = parsed["renderBindings"]
                    .as_array()
                    .is_some_and(|names| names.iter().any(|value| value.as_str() == Some(name)));
                let kind = if event && render {
                    "vue-callable-mixed"
                } else if event {
                    "vue-handler"
                } else {
                    "vue-binding"
                };
                json!({"prop":name,"expr":name,"kind":kind})
            })
            .collect();
        let all_css = parsed["styles"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|s| s["content"].as_str().unwrap_or(""))
            .collect::<Vec<_>>()
            .join("\n");
        let (seed, _) = crate::svelte_component::extract_matching_source_css(
            &format!("<style>{all_css}</style>"),
            &markup,
        );
        if !safe_variant_css(&parse_stylesheet(&seed)) {
            return Err(
                "Vue preview cannot isolate this selection's global or deep CSS rules".into(),
            );
        }
        let relative = format!("{SVELTE_COMPONENT_ROOT}/{id}");
        let manifest_file = format!("{relative}/manifest.json");
        if directory.exists() {
            let previous: Value = serde_json::from_str(
                &std::fs::read_to_string(directory.join("manifest.json"))
                    .ok()
                    .ok_or("Existing Vue session has no manifest")?,
            )
            .map_err(|e| e.to_string())?;
            if previous["sourceFile"] != file
                || previous["originalMarkup"] != markup
                || previous["sourceStartLine"] != start
                || previous["sourceEndLine"] != end
                || previous["count"] != count
                || previous["previewMode"] != "vue-component"
                || previous["previewScript"] != script
                || previous["propContract"] != json!(props)
                || previous["componentDir"] != relative
                || previous["id"] != id
            {
                return Err("Vue session already has a different source selection or preview contract; use a new session id".into());
            }
            return Ok(ScaffoldedSession {
                manifest: previous,
                manifest_file,
                component_dir: relative,
                prop_contract: props,
                stub_markup: markup,
            });
        }
        std::fs::create_dir_all(directory.parent().ok_or("Missing Vue preview parent")?)
            .map_err(|e| e.to_string())?;
        std::fs::create_dir(&directory).map_err(|e| e.to_string())?;
        let runtime = format!("{SVELTE_COMPONENT_ROOT}/__vue_runtime.js");
        let generated = (|| -> Result<ScaffoldedSession, String> {
            impeccable_common::fsx::write_atomic(Path::new(&jsp::join(&[cwd, &runtime])), b"import { createVNode, render } from 'vue';\nexport function mount(Component, { target, props, appContext }) { const node = createVNode(Component, props); node.appContext = appContext || null; render(node, target); return { target }; }\nexport function unmount(instance) { render(null, instance.target); }\n").map_err(|e| e.to_string())?;
            let manifest = json!({"id":id,"count":count,"previewMode":"vue-component","componentExtension":"vue","sourceFile":file,
            "sourceStartLine":start,"sourceEndLine":end,"originalMarkup":markup,"previewScript":script,"propContract":props,
            "componentDir":relative,"componentDirAbs":jsp::to_posix(&directory.to_string_lossy()),"runtimeModule":format!("/{runtime}"),"runtimeModuleAbs":jsp::join(&[cwd,&runtime])});
            for n in 1..=count {
                let variant = format!("<script setup>\n{script}\n</script>\n<template>\n{markup}\n</template>\n<style scoped>\n{seed}\n</style>\n");
                if let Err(error) = analyze(&variant, &source_file, cwd).and_then(|_| {
                    std::fs::write(directory.join(format!("v{n}.vue")), &variant)
                        .map_err(|e| e.to_string())
                }) {
                    return Err(error);
                }
            }
            std::fs::write(
                directory.join("manifest.json"),
                serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
            Ok(ScaffoldedSession {
                manifest,
                manifest_file,
                component_dir: relative,
                prop_contract: props,
                stub_markup: markup,
            })
        })();
        if generated.is_err() {
            let _ = std::fs::remove_dir_all(&directory);
        }
        generated
    };
    match make() {
        Ok(session) => Scaffold::Session(session),
        Err(error) => Scaffold::Fallback(error),
    }
}

pub fn analyze(source: &str, filename: &str, cwd: &str) -> Result<Value, String> {
    analyze_with_mode(source, filename, cwd, false)
}

fn analyze_with_mode(
    source: &str,
    filename: &str,
    cwd: &str,
    behavior_only: bool,
) -> Result<Value, String> {
    let mut child = Command::new(impeccable_common::proc::node_exe())
        .args([
            "--input-type=module",
            "-e",
            include_str!("vue_bridge_helper.mjs"),
            "--",
            cwd,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            format!("Vue compiler unavailable: {e}. Install @vue/compiler-sfc in the app.")
        })?;
    let request =
        json!({"source":source,"filename":filename,"behaviorOnly":behavior_only}).to_string();
    child
        .stdin
        .take()
        .ok_or("Vue compiler stdin unavailable")?
        .write_all(request.as_bytes())
        .map_err(|e| e.to_string())?;
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    let result: Value = serde_json::from_slice(&output.stdout).map_err(|_| {
        format!(
            "Vue compiler unavailable: {}",
            String::from_utf8_lossy(&output.stderr)
        )
    })?;
    if !output.status.success() || result["ok"] != true {
        return Err(result["error"]
            .as_str()
            .unwrap_or("Vue compiler validation failed")
            .to_string());
    }
    Ok(result)
}

fn range(block: &Value, source: &str) -> Result<std::ops::Range<usize>, String> {
    let start = block["start"].as_u64().ok_or("Missing Vue block offset")? as usize;
    let end = block["end"].as_u64().ok_or("Missing Vue block offset")? as usize;
    if source.get(start..end) != block["content"].as_str() {
        return Err("Vue block offsets do not match source".into());
    }
    Ok(start..end)
}

fn safe_variant_css(nodes: &[CssNode]) -> bool {
    nodes.iter().all(|node| match node {
        CssNode::Comment { .. } => true,
        CssNode::Rule { prelude, .. } => {
            !prelude.contains(":global")
                && !prelude.contains(":deep")
                && !prelude.contains(":slotted")
                && !prelude.contains("::v-global")
                && !prelude.contains("::v-deep")
                && !prelude.contains("::v-slotted")
                && !prelude.contains(">>>")
                && !prelude.contains("/deep/")
        }
        CssNode::At {
            name,
            children: Some(children),
            ..
        } => {
            matches!(name.as_str(), "media" | "supports" | "container" | "layer")
                && safe_variant_css(children)
        }
        _ => false,
    })
}

fn required_behaviors(original: &Value, variant: &Value) -> bool {
    let mut available = variant["behaviors"].as_array().cloned().unwrap_or_default();
    let kept = original["behaviors"]
        .as_array()
        .into_iter()
        .flatten()
        .all(|behavior| {
            if let Some(index) = available.iter().position(|candidate| candidate == behavior) {
                available.remove(index);
                true
            } else {
                false
            }
        });
    kept && available.is_empty()
}

pub fn inline_vue_component_accept(
    manifest: &Map<String, Value>,
    variant: &str,
    values: Option<&Map<String, Value>>,
    cwd: &str,
) -> Result<Value, String> {
    let number = variant
        .parse::<usize>()
        .map_err(|_| "Invalid Vue variant")?;
    let canonical_variant = number.to_string();
    let variant = canonical_variant.as_str();
    let count = manifest.get("count").and_then(Value::as_u64).unwrap_or(0) as usize;
    if number == 0 || number > count {
        return Err("Vue variant must be between 1 and the session count".into());
    }
    let root = Path::new(cwd).canonicalize().map_err(|e| e.to_string())?;
    let source_file = jsp::resolve(
        cwd,
        &[manifest
            .get("sourceFile")
            .and_then(Value::as_str)
            .ok_or("Missing Vue source file")?],
    );
    let source_path = Path::new(&source_file)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !source_path.starts_with(&root)
        || source_path.extension().and_then(|e| e.to_str()) != Some("vue")
    {
        return Err("Vue source must be a .vue file inside the app".into());
    }
    let directory = jsp::resolve(
        cwd,
        &[manifest
            .get("componentDir")
            .and_then(Value::as_str)
            .ok_or("Missing Vue component directory")?],
    );
    let id = manifest
        .get("id")
        .and_then(Value::as_str)
        .ok_or("Missing Vue session id")?;
    crate::paths::safe_session_id(id)?;
    let expected_directory = session_directory(id, cwd)?;
    if Path::new(&directory) != expected_directory.as_path() {
        return Err("Vue preview directory must be this session's exact directory".into());
    }
    let expected = expected_directory
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let directory_path = Path::new(&directory)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if directory_path != expected || !directory_path.starts_with(&root) {
        return Err("Vue preview directory must be this session's directory inside the app".into());
    }
    let variant_file = Path::new(&directory)
        .join(format!("v{number}.vue"))
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if variant_file.parent() != Some(directory_path.as_path()) {
        return Err("Vue variant must stay inside this session's directory".into());
    }
    let source = safe_read(&source_file).ok_or("Cannot read Vue source")?;
    let selected = std::fs::read_to_string(&variant_file).map_err(|e| e.to_string())?;
    let before = analyze(&source, &source_file, cwd)?;
    if before["styles"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|s| s["scoped"] == true)
        .count()
        > 1
    {
        return Err("Vue acceptance currently requires at most one scoped CSS block; consolidate scoped blocks before wrapping".into());
    }
    let next = analyze(&selected, &source_file, cwd)?;
    for script in next["scripts"].as_array().into_iter().flatten() {
        if script["content"].as_str().unwrap_or("").trim()
            != manifest
                .get("previewScript")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
        {
            return Err("Keep the generated Vue preview script unchanged; edits to component scripts must be made in source".into());
        }
    }
    let original = manifest
        .get("originalMarkup")
        .and_then(Value::as_str)
        .ok_or("Missing original Vue markup")?;
    // The fragment has no script metadata. Full source and variant validation
    // already checked event safety; here only compare behavior ownership.
    let original_analysis = analyze_with_mode(
        &format!("<template>{original}</template>"),
        &source_file,
        cwd,
        true,
    )?;
    if !required_behaviors(&original_analysis, &next) {
        return Err("Vue variant removed or changed a binding, directive, or component; preserve component behavior".into());
    }
    let start = manifest
        .get("sourceStartLine")
        .and_then(Value::as_u64)
        .and_then(|n| n.checked_sub(1))
        .ok_or("Invalid Vue source range")? as usize;
    let end = manifest
        .get("sourceEndLine")
        .and_then(Value::as_u64)
        .ok_or("Invalid Vue source range")? as usize;
    let lines: Vec<&str> = source.split('\n').collect();
    if end <= start || end > lines.len() || lines[start..end].join("\n").trim() != original.trim() {
        return Err("Vue source changed since preview; wrap the current source again".into());
    }
    let byte_start: usize = lines[..start].iter().map(|l| l.len() + 1).sum();
    let byte_end = byte_start + lines[start..end].join("\n").len();
    let template_range = range(&before["template"], &source)?;
    if byte_start < template_range.start || byte_end > template_range.end {
        return Err("Vue selection must be inside the template".into());
    }
    let markup = next["template"]["content"]
        .as_str()
        .ok_or("Missing Vue variant template")?;
    let indent: String = lines[start]
        .chars()
        .take_while(|c| c.is_whitespace())
        .collect();
    let markup = reindent_preserving_structure(
        &markup
            .trim_matches(['\r', '\n'])
            .split('\n')
            .map(str::to_owned)
            .collect::<Vec<_>>(),
        &indent,
    )
    .join("\n");
    let mut css = String::new();
    for block in next["styles"].as_array().into_iter().flatten() {
        if block["scoped"] != true {
            return Err("Vue variant styles must be scoped to prevent global CSS leakage".into());
        }
        css.push_str(block["content"].as_str().unwrap_or(""));
        css.push('\n');
    }
    let root_tag = original
        .trim_start()
        .trim_start_matches('<')
        .split(|c: char| !c.is_alphanumeric() && c != '-')
        .next()
        .unwrap_or("div");
    let css_lines = css.lines().map(str::to_owned).collect::<Vec<_>>();
    css = sanitize_accepted_component_css(&css_lines, variant, values, root_tag).join("\n");
    let params: Value = safe_read(&jsp::join(&[&directory, "params.json"]))
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(Value::Null);
    let params = params[variant].as_array().cloned().unwrap_or_default();
    css = bake_param_values(&css, &params, values.unwrap_or(&Map::new()));
    if !safe_variant_css(&parse_stylesheet(&css)) {
        return Err("Vue variant CSS must stay component-scoped; global selectors and global at-rules are unsupported".into());
    }
    let mut edits = vec![(byte_start..byte_end, markup)];
    let scoped = before["styles"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|s| s["scoped"] == true)
        .last();
    let (replaced, appended);
    let mut suffix = String::new();
    if let Some(block) = scoped {
        let merged = reconcile_css(block["content"].as_str().unwrap_or(""), &css);
        replaced = merged.1;
        appended = merged.2;
        edits.push((range(block, &source)?, format!("\n{}\n", merged.0)));
    } else {
        let merged = reconcile_css("", &css);
        replaced = merged.1;
        appended = merged.2;
        suffix = format!("\n<style scoped>\n{}\n</style>\n", merged.0);
    }
    edits.sort_by(|a, b| b.0.start.cmp(&a.0.start));
    let mut accepted = source.clone();
    for (location, replacement) in edits {
        accepted.replace_range(location, &replacement);
    }
    accepted.push_str(&suffix);
    analyze(&accepted, &source_file, cwd)?;
    let (clean, findings) = verify_accepted_source(&accepted);
    if !clean {
        return Err(format!(
            "Vue acceptance left preview artifacts: {findings:?}"
        ));
    }
    if safe_read(&source_file).as_deref() != Some(source.as_str()) {
        return Err("Vue source changed during validation; accept the current source again".into());
    }
    impeccable_common::fsx::write_atomic(&source_path, accepted.as_bytes())
        .map_err(|e| format!("Failed to write Vue source: {e}"))?;
    let cleanup_error = std::fs::remove_dir_all(&expected_directory)
        .err()
        .map(|e| e.to_string());
    Ok(
        json!({"handled":true,"file":manifest.get("sourceFile"),"sourceFile":manifest.get("sourceFile"),"previewMode":"vue-component","carbonize":false,"css":{"replaced":replaced,"appended":appended},"verify":{"clean":clean,"findings":findings},"cleanupError":cleanup_error}),
    )
}
