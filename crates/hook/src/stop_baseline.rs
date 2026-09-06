//! Conservative Stop attribution. Never use HEAD as a session baseline: the
//! working tree may already be dirty. Only a verified first Edit/Write preimage
//! from the tool result establishes a baseline, and only for the pure text
//! detector. DOM and design-system findings can depend on other files.

use impeccable_core::findings::Finding;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use crate::hook_lib::{
    detector_detect_text, ensure_file, sessions, Cache, HookScanOptions, Runtime,
};

const FIELD: &str = "stopBaseline";
const MAX_BYTES: usize = 512 * 1024;
const MAX_FINDINGS: usize = 256;
pub const UNKNOWN_NOTE: &str = "Findings marked attribution unknown may predate this session; do not treat them as regressions or broaden the task without asking.";
pub const COMPACT_UNKNOWN_NOTE: &str = "Unknown findings may predate this session; ask before expanding scope.";

fn independent(finding: &Finding) -> bool {
    !finding.antipattern.starts_with("design-system-")
}

// Exclude line numbers so an unrelated insertion/deletion does not make old
// debt new. Preserve multiplicity so adding an identical occurrence is new.
// Hash the detector identity rather than storing source or snippets in cache.
fn key(finding: &Finding) -> String {
    let identity = json!([finding.antipattern, finding.snippet, finding.extras]);
    format!("{:x}", Sha256::digest(identity.to_string().as_bytes()))
}

fn counts(findings: &[Finding]) -> Map<String, Value> {
    let mut counts = Map::new();
    for finding in findings.iter().filter(|f| independent(f)) {
        let key = key(finding);
        let count = counts.get(&key).and_then(Value::as_u64).unwrap_or(0);
        counts.insert(key, Value::from(count + 1));
    }
    counts
}

fn entry<'a>(cache: &'a Cache, session: &str, file: &str) -> Option<&'a Map<String, Value>> {
    sessions(cache)?
        .get(session)?
        .get("files")?
        .get(file)?
        .as_object()
}

fn baseline(cache: &Cache, session: &str, file: &str) -> Option<Map<String, Value>> {
    let value = entry(cache, session, file)?.get(FIELD)?;
    if value.get("version")?.as_u64()? != 1
        || value.get("engine")?.as_str()? != env!("CARGO_PKG_VERSION")
    {
        return None;
    }
    let counts = value.get("counts")?.as_object()?;
    if counts.len() > MAX_FINDINGS
        || counts.iter().any(|(k, v)| {
            k.len() != 64
                || !k.bytes().all(|b| b.is_ascii_hexdigit())
                || !matches!(v.as_u64(), Some(1..=256))
        })
    {
        return None;
    }
    Some(counts.clone())
}

/// Called before the first primary edit is recorded. An entry without a
/// baseline (old cache, co-scan, incomplete payload) must stay unknown rather
/// than adopting a later, already-edited file as its starting point.
pub fn capture(
    rt: &Runtime,
    event: &Map<String, Value>,
    cache: &mut Cache,
    session: &str,
    file: &str,
    html: bool,
) {
    if html || session.is_empty() || session == "unknown" || entry(cache, session, file).is_some() {
        return;
    }
    let Some(response) = event.get("tool_response").and_then(Value::as_object) else {
        return;
    };
    let Some(path) = response.get("filePath").and_then(Value::as_str) else {
        return;
    };
    let cwd = event
        .get("cwd")
        .and_then(Value::as_str)
        .unwrap_or(&rt.proc_cwd);
    if rt.resolve(&[cwd, path]) != file || response.get("userModified") == Some(&Value::Bool(true))
    {
        return;
    }
    let Some(tool) = event.get("tool_name").and_then(Value::as_str) else {
        return;
    };
    let original = match response.get("originalFile") {
        Some(Value::String(text)) if text.len() <= MAX_BYTES => text.as_str(),
        // null on an update may mean "too large", not an empty original.
        Some(Value::Null)
            if tool == "Write"
                && response.get("type").and_then(Value::as_str) == Some("create") =>
        {
            ""
        }
        _ => return,
    };
    let expected = match tool {
        "Edit" => {
            let Some(old) = response.get("oldString").and_then(Value::as_str) else {
                return;
            };
            let Some(new) = response.get("newString").and_then(Value::as_str) else {
                return;
            };
            if old.is_empty() || new.len() > MAX_BYTES || !original.contains(old) {
                return;
            }
            match response.get("replaceAll").and_then(Value::as_bool) {
                Some(true) => {
                    let occurrences = original.matches(old).count();
                    let size = original.len() - occurrences * old.len()
                        + occurrences.saturating_mul(new.len());
                    if size > MAX_BYTES {
                        return;
                    }
                    original.replace(old, new)
                }
                Some(false) if original.matches(old).count() == 1 => original.replacen(old, new, 1),
                _ => return,
            }
        }
        "Write" => {
            if !matches!(
                response.get("type").and_then(Value::as_str),
                Some("create" | "update")
            ) {
                return;
            }
            let Some(content) = response.get("content").and_then(Value::as_str) else {
                return;
            };
            if content.len() > MAX_BYTES {
                return;
            }
            content.to_string()
        }
        _ => return,
    };
    if expected.len() > MAX_BYTES
        || std::fs::metadata(file)
            .map(|m| m.len() > MAX_BYTES as u64)
            .unwrap_or(true)
    {
        return;
    }
    // A formatter, stale event, or concurrent write invalidates attribution.
    if std::fs::read_to_string(file).ok().as_deref() != Some(expected.as_str()) {
        return;
    }
    let findings = detector_detect_text(original, file, &HookScanOptions::default());
    if findings.len() > MAX_FINDINGS {
        return;
    }
    ensure_file(cache, session, file).insert(
        FIELD.into(),
        json!({
            "version": 1, "engine": env!("CARGO_PKG_VERSION"), "counts": counts(&findings),
        }),
    );
}

/// Once existing debt disappears, it cannot exempt a later reintroduction.
pub fn reconcile(cache: &mut Cache, session: &str, file: &str, findings: &[Finding]) {
    let Some(mut old) = baseline(cache, session, file) else {
        return;
    };
    let current = counts(findings);
    old.retain(|key, value| {
        let count = current
            .get(key)
            .and_then(Value::as_u64)
            .unwrap_or(0)
            .min(value.as_u64().unwrap_or(0));
        *value = Value::from(count);
        count > 0
    });
    ensure_file(cache, session, file).get_mut(FIELD).unwrap()["counts"] = Value::Object(old);
}

/// Do not retain an exemption through edits we deliberately stop scanning.
pub fn invalidate(cache: &mut Cache, session: &str, file: &str) {
    ensure_file(cache, session, file).remove(FIELD);
}

#[derive(Default)]
pub struct Classified {
    pub findings: Vec<Finding>,
    pub pre_existing: usize,
    pub new: usize,
    pub unknown: usize,
}

pub fn classify(
    cache: &Cache,
    session: &str,
    file: &str,
    html: bool,
    findings: Vec<Finding>,
) -> Classified {
    let mut baseline = if html {
        None
    } else {
        baseline(cache, session, file)
    };
    let mut result = Classified::default();
    for mut finding in findings {
        let known = baseline.as_mut().filter(|_| independent(&finding));
        if let Some(counts) = known {
            let key = key(&finding);
            let count = counts.get(&key).and_then(Value::as_u64).unwrap_or(0);
            if count > 0 {
                counts.insert(key, Value::from(count - 1));
                result.pre_existing += 1;
                continue;
            }
            result.new += 1;
            finding.name = format!("[new] {}", finding.name);
        } else {
            result.unknown += 1;
            finding.name = format!("[attribution unknown] {}", finding.name);
        }
        result.findings.push(finding);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use impeccable_core::findings::finding;

    #[test]
    fn stop_baseline_dependency_sensitive_findings_stay_unknown() {
        let mut cache = Cache::new();
        let font = finding("design-system-font", "a.css", "font-family: serif", 1.0);
        let css = finding("side-tab", "a.html", "border-left: 4px solid red", 1.0);
        ensure_file(&mut cache, "s", "a.css").insert(
            FIELD.into(),
            json!({
                "version": 1, "engine": env!("CARGO_PKG_VERSION"), "counts": {},
            }),
        );
        // Even a known text preimage cannot establish the state of DESIGN.md
        // before the session, or of the stylesheets a DOM scan reads.
        assert_eq!(classify(&cache, "s", "a.css", false, vec![font]).unknown, 1);
        assert_eq!(classify(&cache, "s", "a.css", true, vec![css]).unknown, 1);
    }

    #[test]
    fn stop_baseline_old_engine_and_malformed_cache_stay_unknown() {
        let mut cache = Cache::new();
        let f = finding("side-tab", "a.css", "border-left: 4px solid red", 1.0);
        for record in [
            json!({"version": 1, "engine": "0.0.0", "counts": {}}),
            json!({"version": 1, "engine": env!("CARGO_PKG_VERSION"), "counts": {"bad": -1}}),
        ] {
            ensure_file(&mut cache, "s", "a.css").insert(FIELD.into(), record);
            assert_eq!(
                classify(&cache, "s", "a.css", false, vec![f.clone()]).unknown,
                1
            );
        }
    }
}
