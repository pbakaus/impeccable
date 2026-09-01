//! JS: live/frameworks/tag-strategy.mjs + script-src.mjs. The generic
//! marker-wrapped `<script src>` block: build, insert, remove, and the CSP
//! meta patch/revert.

use crate::util::{base64_decode, base64_encode, encode_uri_component};
use once_cell::sync::Lazy;
use regex::{Regex, RegexBuilder};

pub const MARKER_OPEN_TEXT: &str = "impeccable-live-start";
pub const MARKER_CLOSE_TEXT: &str = "impeccable-live-end";
pub const CSP_MARKER_ATTR: &str = "data-impeccable-csp-original";
/// JS: TAG_PATCH_MARKERS
pub const TAG_PATCH_MARKERS: [&str; 2] = [MARKER_OPEN_TEXT, CSP_MARKER_ATTR];

/// JS: buildLiveScriptSrc(port, token)
pub fn build_live_script_src(port: i64, token: Option<&str>) -> String {
    let base = format!("http://localhost:{}/live.js", port);
    match token {
        Some(t) if !t.is_empty() => format!("{}?token={}", base, encode_uri_component(t)),
        _ => base,
    }
}

fn comment_open(syntax: &str) -> &'static str {
    if syntax == "jsx" {
        "{/*"
    } else {
        "<!--"
    }
}
fn comment_close(syntax: &str) -> &'static str {
    if syntax == "jsx" {
        "*/}"
    } else {
        "-->"
    }
}

/// JS: buildTagBlock(syntax, port, token, scriptAttrs)
pub fn build_tag_block(syntax: &str, port: i64, token: Option<&str>, script_attrs: &str) -> String {
    let open = comment_open(syntax);
    let close = comment_close(syntax);
    format!(
        "{o} {m1} {c}\n<script {a}src=\"{src}\"></script>\n{o} {m2} {c}\n",
        o = open,
        c = close,
        m1 = MARKER_OPEN_TEXT,
        m2 = MARKER_CLOSE_TEXT,
        a = script_attrs,
        src = build_live_script_src(port, token)
    )
}

fn detect_line_ending(content: &str) -> &'static str {
    if content.contains("\r\n") {
        "\r\n"
    } else if content.contains('\r') {
        "\r"
    } else {
        "\n"
    }
}

fn normalize_line_endings(content: &str, le: &str) -> String {
    if le == "\n" {
        content.to_string()
    } else {
        content.replace('\n', le)
    }
}

fn read_line_ending_at(content: &str, index: usize) -> &'static str {
    let b = content.as_bytes();
    if b.get(index) == Some(&b'\r') && b.get(index + 1) == Some(&b'\n') {
        "\r\n"
    } else if b.get(index) == Some(&b'\n') {
        "\n"
    } else if b.get(index) == Some(&b'\r') {
        "\r"
    } else {
        ""
    }
}

/// JS: insertTag(content, config, port, token, scriptAttrs)
pub fn insert_tag(
    content: &str,
    comment_syntax: &str,
    insert_before: Option<&str>,
    insert_after: Option<&str>,
    port: i64,
    token: Option<&str>,
    script_attrs: &str,
) -> String {
    let le = detect_line_ending(content);
    let block = normalize_line_endings(
        &build_tag_block(comment_syntax, port, token, script_attrs),
        le,
    );
    // JS: `if (config.insertBefore)`: truthy string
    if let Some(anchor) = insert_before.filter(|a| !a.is_empty()) {
        return match content.rfind(anchor) {
            None => content.to_string(),
            Some(idx) => format!("{}{}{}", &content[..idx], block, &content[idx..]),
        };
    }
    let anchor = insert_after.unwrap_or("");
    let Some(idx) = content.find(anchor) else {
        return content.to_string();
    };
    let after = idx + anchor.len();
    let existing_nl = read_line_ending_at(content, after);
    let nl = if existing_nl.is_empty() {
        le
    } else {
        existing_nl
    };
    let prefix = format!("{}{}", &content[..after], nl);
    let rest = &content[after + existing_nl.len()..];
    format!("{}{}{}", prefix, block, rest)
}

static REMOVE_HTML_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"([ \t]*)<!--\s*impeccable-live-start\s*-->[\s\S]*?<!--\s*impeccable-live-end\s*-->([ \t]*(?:\r\n|\n|\r|$)?)").unwrap()
});
static REMOVE_JSX_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"([ \t]*)\{/\*\s*impeccable-live-start\s*\*/\}[\s\S]*?\{/\*\s*impeccable-live-end\s*\*/\}([ \t]*(?:\r\n|\n|\r|$)?)").unwrap()
});

/// JS: removeTag(content). Matches either comment style; indent-preserving.
pub fn remove_tag(content: &str) -> String {
    let mut content = content.to_string();
    for pat in [&*REMOVE_HTML_RE, &*REMOVE_JSX_RE] {
        let mut changed = false;
        loop {
            let next = pat
                .replacen(&content, 1, |caps: &regex::Captures| {
                    let indent = caps.get(1).map(|m| m.as_str()).unwrap_or("");
                    let trailing = caps.get(2).map(|m| m.as_str()).unwrap_or("");
                    if trailing.contains('\r') || trailing.contains('\n') {
                        indent.to_string()
                    } else if !indent.is_empty() {
                        indent.to_string()
                    } else {
                        trailing.to_string()
                    }
                })
                .into_owned();
            if next == content {
                break;
            }
            content = next;
            changed = true;
        }
        if changed {
            return content;
        }
    }
    content
}

struct MetaTag {
    start: usize,
    end: usize,
    full: String,
    attrs: String,
}

static META_TAG_RE: Lazy<Regex> = Lazy::new(|| {
    RegexBuilder::new(r"<meta\s+([^>]*?)/?>")
        .case_insensitive(true)
        .dot_matches_new_line(true)
        .build()
        .unwrap()
});
static HTTP_EQUIV_RE: Lazy<Regex> = Lazy::new(|| {
    RegexBuilder::new(r#"(?:http-equiv|httpEquiv)\s*=\s*(['"])Content-Security-Policy(['"])"#)
        .case_insensitive(true)
        .build()
        .unwrap()
});

fn find_csp_meta_tags(content: &str) -> Vec<MetaTag> {
    let mut out = Vec::new();
    for m in META_TAG_RE.captures_iter(content) {
        let whole = m.get(0).unwrap();
        let attrs = m.get(1).map(|a| a.as_str()).unwrap_or("");
        // JS backreference \2: same quote both sides.
        let mut ok = false;
        for c in HTTP_EQUIV_RE.captures_iter(attrs) {
            if c.get(1).map(|q| q.as_str()) == c.get(2).map(|q| q.as_str()) {
                ok = true;
                break;
            }
        }
        if !ok {
            continue;
        }
        out.push(MetaTag {
            start: whole.start(),
            end: whole.end(),
            full: whole.as_str().to_string(),
            attrs: attrs.to_string(),
        });
    }
    out
}

struct Attr {
    quote: String,
    value: String,
    full: String,
}

fn get_attr(attrs: &str, name: &str) -> Option<Attr> {
    // JS: new RegExp(`\\b${name}\\s*=\\s*(['"])([\\s\\S]*?)\\1`, 'i')
    // Emulate the backreference by trying each quote.
    let mut best: Option<(usize, Attr)> = None;
    for q in ["'", "\""] {
        let re = RegexBuilder::new(&format!(
            "\\b{}\\s*=\\s*{}([\\s\\S]*?){}",
            crate::util::escape_regex(name),
            q,
            q
        ))
        .case_insensitive(true)
        .build()
        .ok()?;
        if let Some(c) = re.captures(attrs) {
            let whole = c.get(0).unwrap();
            let attr = Attr {
                quote: q.to_string(),
                value: c.get(1).map(|v| v.as_str()).unwrap_or("").to_string(),
                full: whole.as_str().to_string(),
            };
            match &best {
                Some((s, _)) if *s <= whole.start() => {}
                _ => best = Some((whole.start(), attr)),
            }
        }
    }
    // JS: `\bname\s*=\s*(['"])` — the earliest match position wins; when both
    // quotes match at the same start (impossible) keep the first.
    best.map(|(_, a)| a)
}

fn append_origin_to_directive(csp: &str, directive: &str, origin: &str) -> String {
    let re = RegexBuilder::new(&format!("(^|;)(\\s*)({})\\s+([^;]*)", directive))
        .case_insensitive(true)
        .build()
        .unwrap();
    if let Some(m) = re.captures(csp) {
        let tokens_str = m.get(4).map(|t| t.as_str()).unwrap_or("");
        let tokens: Vec<&str> = tokens_str.trim().split_whitespace().collect();
        // JS: `m[4].trim().split(/\s+/)`; an empty trimmed string yields ['']
        let tokens: Vec<&str> = if tokens_str.trim().is_empty() {
            vec![""]
        } else {
            tokens
        };
        if tokens.contains(&origin) {
            return csp.to_string();
        }
        let mut joined: Vec<&str> = tokens.clone();
        joined.push(origin);
        let replacement = format!(
            "{}{}{} {}",
            m.get(1).map(|x| x.as_str()).unwrap_or(""),
            m.get(2).map(|x| x.as_str()).unwrap_or(""),
            m.get(3).map(|x| x.as_str()).unwrap_or(""),
            joined.join(" ")
        );
        let whole = m.get(0).unwrap();
        return format!(
            "{}{}{}",
            &csp[..whole.start()],
            replacement,
            &csp[whole.end()..]
        );
    }
    let trimmed = csp.trim();
    // JS: .replace(/;?\s*$/, '')
    let trailing_re = Regex::new(r";?\s*$").unwrap();
    let base = trailing_re.replacen(trimmed, 1, "").into_owned();
    format!("{}; {} 'self' {}", base, directive, origin)
}

/// JS: patchCspMeta(content, port)
pub fn patch_csp_meta(content: &str, port: i64) -> String {
    let tags = find_csp_meta_tags(content);
    if tags.is_empty() {
        return content.to_string();
    }
    let origin = format!("http://localhost:{}", port);
    let mut result = content.to_string();
    for tag in tags.iter().rev() {
        let attrs = &tag.attrs;
        if get_attr(attrs, CSP_MARKER_ATTR).is_some() {
            continue;
        }
        let Some(content_attr) = get_attr(attrs, "content") else {
            continue;
        };
        let original = content_attr.value.clone();
        let mut patched = original.clone();
        patched = append_origin_to_directive(&patched, "script-src", &origin);
        // The detector the overlay loads from that origin is a WebAssembly
        // module (WASM-BUNDLE.md in the detector repo); a script-src that names the origin
        // but not 'wasm-unsafe-eval' still refuses to compile it. Not in the
        // JS patchCspMeta: goldens live-inject-vite-csp-meta,
        // live-inject-csp-meta-no-connect-src and live-inject-next-jsx carry
        // the pre-wasm form (see tests/oracle/DELTAS.md in the public repo).
        patched = append_origin_to_directive(&patched, "script-src", "'wasm-unsafe-eval'");
        patched = append_origin_to_directive(&patched, "connect-src", &origin);
        patched = append_origin_to_directive(&patched, "img-src", "blob:");
        if patched == original {
            continue;
        }
        let new_content_attr = format!(
            "content={}{}{}",
            content_attr.quote, patched, content_attr.quote
        );
        let marker = format!(
            "{}=\"{}\"",
            CSP_MARKER_ATTR,
            base64_encode(original.as_bytes())
        );
        let trailing_ws_len = attrs.len() - attrs.trim_end_matches([' ', '\t']).len();
        let trailing_ws = &attrs[attrs.len() - trailing_ws_len..];
        let attrs_body = &attrs[..attrs.len() - trailing_ws_len];
        let new_attrs = format!(
            "{} {}{}",
            attrs_body.replacen(&content_attr.full, &new_content_attr, 1),
            marker,
            trailing_ws
        );
        let new_tag = tag.full.replacen(attrs.as_str(), &new_attrs, 1);
        result = format!("{}{}{}", &result[..tag.start], new_tag, &result[tag.end..]);
    }
    result
}

/// JS: revertCspMeta(content)
pub fn revert_csp_meta(content: &str) -> String {
    let tags = find_csp_meta_tags(content);
    if tags.is_empty() {
        return content.to_string();
    }
    let mut result = content.to_string();
    for tag in tags.iter().rev() {
        let Some(orig_attr) = get_attr(&tag.attrs, CSP_MARKER_ATTR) else {
            continue;
        };
        let Some(content_attr) = get_attr(&tag.attrs, "content") else {
            continue;
        };
        let original_value = String::from_utf8_lossy(&base64_decode(&orig_attr.value)).into_owned();
        let new_content_attr = format!(
            "content={}{}{}",
            content_attr.quote, original_value, content_attr.quote
        );
        let mut new_attrs = tag.attrs.replacen(&content_attr.full, &new_content_attr, 1);
        // JS: new RegExp(`\\s*${origAttr.full}`) (unescaped; the value is
        // base64 + quotes, which carry no regex metacharacters besides `+`
        // and `/`... `+` IS a metachar; JS would treat `A+` as a quantifier).
        // JS-PARITY: build the same regex the JS builds.
        let re_src = format!("\\s*{}", orig_attr.full);
        match Regex::new(&re_src) {
            Ok(re) => {
                new_attrs = re.replacen(&new_attrs, 1, "").into_owned();
            }
            Err(_) => {
                // A base64 value like `A+B` compiles in JS as a quantifier;
                // fall back to a literal removal when the Rust regex rejects it.
                if let Some(pos) = new_attrs.find(&orig_attr.full) {
                    let before = &new_attrs[..pos];
                    let ws = before.len() - before.trim_end().len();
                    new_attrs = format!(
                        "{}{}",
                        &before[..before.len() - ws],
                        &new_attrs[pos + orig_attr.full.len()..]
                    );
                }
            }
        }
        let new_tag = tag.full.replacen(tag.attrs.as_str(), &new_attrs, 1);
        result = format!("{}{}{}", &result[..tag.start], new_tag, &result[tag.end..]);
    }
    result
}

/// JS: unpatchTagFile(content)
pub fn unpatch_tag_file(content: &str) -> String {
    revert_csp_meta(&remove_tag(content))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csp_meta_patch_adds_wasm_unsafe_eval_to_script_src() {
        let html = "<html><head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; script-src 'self'; img-src 'self'\"></head></html>";
        let patched = patch_csp_meta(html, 8412);
        assert!(
            patched.contains("script-src 'self' http://localhost:8412 'wasm-unsafe-eval'"),
            "{patched}"
        );
        assert!(patched.contains("connect-src 'self' http://localhost:8412"));
        assert!(patched.contains("img-src 'self' blob:"));
        // idempotent
        assert_eq!(patch_csp_meta(&patched, 8412), patched);
        // reverts to the original
        assert_eq!(revert_csp_meta(&patched), html);
    }

    #[test]
    fn csp_meta_patch_creates_script_src_when_missing() {
        let html = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'\">";
        let patched = patch_csp_meta(html, 8412);
        assert!(
            patched.contains("script-src 'self' http://localhost:8412 'wasm-unsafe-eval'"),
            "{patched}"
        );
    }
}
