//! JS: live/accept-verify.mjs. Postcondition scanner for accepted/carbonized
//! source: `live-complete` refuses to complete while the file still carries
//! live-mode leftovers.

use crate::util::safe_read;
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{json, Value};

enum Marker {
    Text(&'static str),
    Re(&'static Lazy<Regex>, &'static str),
}

static DATA_P_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\bdata-p-[A-Za-z0-9_-]+\s*(?:=|\])").unwrap());
static VAR_P_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"var\(\s*--p-[A-Za-z0-9_-]+\s*[,)]").unwrap());

fn forbidden() -> Vec<(Marker, &'static str)> {
    vec![
        (
            Marker::Text("impeccable-variants-start"),
            "variant wrapper comment left in source",
        ),
        (
            Marker::Text("impeccable-variants-end"),
            "variant wrapper comment left in source",
        ),
        (
            Marker::Text("impeccable-carbonize-start"),
            "carbonize block not rewritten into permanent form",
        ),
        (
            Marker::Text("impeccable-carbonize-end"),
            "carbonize block not rewritten into permanent form",
        ),
        (
            Marker::Text("impeccable-param-values"),
            "param-values comment not baked and removed",
        ),
        (
            Marker::Text("data-impeccable-"),
            "live-mode plumbing attribute left on markup",
        ),
        (
            Marker::Re(&DATA_P_RE, "data-p-*"),
            "preview parameter attribute left on markup",
        ),
        (
            Marker::Re(&VAR_P_RE, "var(--p-*)"),
            "preview parameter variable not baked to a literal",
        ),
        (
            Marker::Text("--impeccable-variant-ready"),
            "preview readiness sentinel left in CSS",
        ),
    ]
}

/// One finding `{ marker, line, excerpt, why }`.
pub fn verify_accepted_source(text: &str) -> (bool, Vec<Value>) {
    let mut findings = Vec::new();
    let rules = forbidden();
    for (i, line) in text.split('\n').enumerate() {
        for (marker, why) in &rules {
            let (hit, label) = match marker {
                Marker::Text(t) => (line.contains(t), *t),
                Marker::Re(re, label) => (re.is_match(line), *label),
            };
            if hit {
                let trimmed = impeccable_context::util::js_trim(line);
                let excerpt: String = trimmed.chars().take(120).collect();
                findings.push(
                    json!({ "marker": label, "line": i + 1, "excerpt": excerpt, "why": why }),
                );
            }
        }
    }
    (findings.is_empty(), findings)
}

/// JS: verifyAcceptedFile(fs, filePath) -> { clean, findings, missing }
pub fn verify_accepted_file(path: &str) -> (bool, Vec<Value>, bool) {
    match safe_read(path) {
        None => (true, vec![], true),
        Some(text) => {
            let (clean, findings) = verify_accepted_source(&text);
            (clean, findings, false)
        }
    }
}
